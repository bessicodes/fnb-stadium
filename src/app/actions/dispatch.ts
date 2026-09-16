'use server'

import { refresh } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'

import { getDb, schema } from '@/db/client'
import type { RunStatus } from '@/db/schema'
import { advanceRun, SLA_MINUTES } from '@/domain/dispatch'
import { buildBalances, wouldOverdraw, type LedgerMovement } from '@/domain/ledger'
import { findShortfalls, inboundByKioskItem, planRuns } from '@/domain/replenishment'
import { balanceOf } from '@/domain/ledger'

export type ActionResult = { ok: true; message: string } | { ok: false; error: string }

/**
 * Move a run along the dispatch ladder.
 *
 * Confirmation is the only step that touches stock: the kiosk signing for a
 * delivery is what posts the issue movement. Until then the stock is still the
 * storage bay's, however far down the concourse it has physically travelled.
 * The transition and the movement go in one transaction so a run can never be
 * confirmed without its ledger entry, or vice versa.
 */
export async function advanceRunAction(
  runId: string,
  to: RunStatus,
  options: { crewId?: string; qtyDelivered?: number; reason?: string } = {},
): Promise<ActionResult> {
  const db = getDb()
  const now = Date.now()

  const run = db.select().from(schema.loadRuns).where(eq(schema.loadRuns.id, runId)).get()
  if (!run) return { ok: false, error: 'Run not found' }

  const result = advanceRun(run, to, now, options)
  if (!result.ok) return { ok: false, error: result.error }

  try {
    db.transaction((tx) => {
      tx.update(schema.loadRuns).set(result.patch).where(eq(schema.loadRuns.id, runId)).run()

      if (to !== 'confirmed') return

      const qty = run.qtyDelivered ?? result.patch.qtyDelivered ?? run.qty
      if (qty <= 0) return

      // Overdraw check against the live ledger, not against the plan: the bay
      // may have been drawn down by another run since this one was raised.
      const movements = tx
        .select()
        .from(schema.stockMovements)
        .where(eq(schema.stockMovements.eventId, run.eventId))
        .all() as unknown as LedgerMovement[]

      const movement: LedgerMovement = {
        itemId: run.itemId,
        qty,
        kind: 'issue',
        fromType: run.fromSpotId ? 'spot' : 'supplier',
        fromId: run.fromSpotId,
        toType: 'kiosk',
        toId: run.kioskId,
      }

      const check = wouldOverdraw(buildBalances(movements), movement)
      if (check.overdraws) {
        throw new Error(
          `Bay holds only ${check.available} — short by ${check.short}. Recount before confirming.`,
        )
      }

      tx.insert(schema.stockMovements)
        .values({
          id: `mov-${runId}-confirm`,
          eventId: run.eventId,
          itemId: run.itemId,
          vendorId: run.vendorId,
          kind: 'issue',
          qty,
          fromType: movement.fromType,
          fromId: run.fromSpotId,
          toType: 'kiosk',
          toId: run.kioskId,
          actor: run.crewId ?? 'unassigned',
          ref: run.code,
          at: now,
          note: null,
        })
        .run()
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not update the run' }
  }

  // Free the crew when their last open run closes.
  if ((to === 'confirmed' || to === 'cancelled') && run.crewId) {
    const stillOpen = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.loadRuns)
      .where(
        and(
          eq(schema.loadRuns.crewId, run.crewId),
          sql`${schema.loadRuns.status} not in ('confirmed', 'cancelled')`,
        ),
      )
      .get()

    db.update(schema.crews)
      .set({ status: Number(stillOpen?.n ?? 0) > 0 ? 'on_run' : 'available' })
      .where(eq(schema.crews.id, run.crewId))
      .run()
  }

  refresh()
  return { ok: true, message: `${run.code} → ${to.replace(/_/g, ' ')}` }
}

/** Assign a crew and put the run on the floor in one step. */
export async function assignCrewAction(runId: string, crewId: string): Promise<ActionResult> {
  const db = getDb()
  const result = await advanceRunAction(runId, 'assigned', { crewId })
  if (!result.ok) return result

  db.update(schema.crews).set({ status: 'on_run' }).where(eq(schema.crews.id, crewId)).run()
  refresh()
  return result
}

/** Raise a run by hand, from a kiosk page or the shortfall list. */
export async function raiseRunAction(input: {
  eventId: string
  kioskId: string
  itemId: string
  qty: number
  priority: 'routine' | 'urgent' | 'critical'
  requestedBy?: string
}): Promise<ActionResult> {
  const db = getDb()
  const now = Date.now()

  const allocation = db
    .select()
    .from(schema.kioskAllocations)
    .where(
      and(
        eq(schema.kioskAllocations.eventId, input.eventId),
        eq(schema.kioskAllocations.kioskId, input.kioskId),
      ),
    )
    .get()

  if (!allocation) {
    return { ok: false, error: 'No vendor is trading that counter for this event' }
  }
  if (input.qty <= 0) return { ok: false, error: 'Quantity must be more than zero' }

  // Pull from a bay that is allocated to this vendor and actually holds the item.
  const spot = pickSourceSpot(input.eventId, allocation.vendorId, input.itemId, input.qty)

  const code = runCode(nextRunSequence())
  db.insert(schema.loadRuns)
    .values({
      id: `run-${code.toLowerCase()}-${now}`,
      code,
      eventId: input.eventId,
      kioskId: input.kioskId,
      itemId: input.itemId,
      vendorId: allocation.vendorId,
      qty: input.qty,
      qtyDelivered: null,
      priority: input.priority,
      status: 'requested',
      fromSpotId: spot,
      crewId: null,
      requestedBy: input.requestedBy ?? 'Control',
      slaMinutes: SLA_MINUTES[input.priority],
      requestedAt: now,
      assignedAt: null,
      pickedAt: null,
      deliveredAt: null,
      confirmedAt: null,
      cancelledReason: null,
      note: null,
    })
    .run()

  refresh()
  return { ok: true, message: `${code} raised` }
}

/**
 * The par-level sweep: look at every counter, raise what is missing.
 *
 * This is the button that turns the replenishment engine loose. It is
 * deliberately manual — an automatic sweep that fires every minute would bury
 * the crews under duplicate runs the first time a till export was late.
 */
export async function sweepParLevelsAction(eventId: string): Promise<ActionResult> {
  const db = getDb()
  const now = Date.now()

  const event = db.select().from(schema.events).where(eq(schema.events.id, eventId)).get()
  if (!event) return { ok: false, error: 'Event not found' }

  const allocations = db
    .select()
    .from(schema.kioskAllocations)
    .where(eq(schema.kioskAllocations.eventId, eventId))
    .all()

  const tradingKiosks = new Set(allocations.map((a) => a.kioskId))
  const vendorByKiosk = new Map(allocations.map((a) => [a.kioskId, a.vendorId]))

  const pars = db
    .select()
    .from(schema.parLevels)
    .all()
    .filter((p) => tradingKiosks.has(p.kioskId))

  const movements = db
    .select()
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.eventId, eventId))
    .all() as unknown as LedgerMovement[]

  const balances = buildBalances(movements)
  const onHand = new Map<string, number>()
  for (const par of pars) {
    onHand.set(
      `${par.kioskId}:${par.itemId}`,
      balanceOf(balances, { type: 'kiosk', id: par.kioskId }, par.itemId),
    )
  }

  const openRuns = db
    .select()
    .from(schema.loadRuns)
    .where(eq(schema.loadRuns.eventId, eventId))
    .all()

  const shortfalls = findShortfalls({
    pars,
    onHand,
    inbound: inboundByKioskItem(openRuns),
    trading: event.status === 'live',
  })

  if (shortfalls.length === 0) {
    return { ok: true, message: 'Every counter is at or above its floor — nothing raised' }
  }

  // What each bay actually holds, so a run is never planned against empty space.
  const supplyByItem = new Map<string, Array<{ spotId: string; available: number }>>()
  const spots = db.select().from(schema.storageSpots).all()
  const items = db.select().from(schema.stockItems).all()

  for (const item of items) {
    const holding = spots
      .map((s) => ({
        spotId: s.id,
        available: balanceOf(balances, { type: 'spot', id: s.id }, item.id),
      }))
      .filter((s) => s.available > 0)
      .sort((a, b) => b.available - a.available)

    if (holding.length > 0) supplyByItem.set(item.id, holding)
  }

  const { runs, unfulfillable } = planRuns({
    shortfalls,
    vendorByKiosk,
    supplyByItem,
    itemsById: new Map(items.map((i) => [i.id, { packSize: i.packSize }])),
  })

  let seq = nextRunSequence()
  db.transaction((tx) => {
    for (const run of runs) {
      const code = runCode(seq++)
      tx.insert(schema.loadRuns)
        .values({
          id: `run-sweep-${now}-${code}`,
          code,
          eventId,
          kioskId: run.kioskId,
          itemId: run.itemId,
          vendorId: run.vendorId,
          qty: run.qty,
          qtyDelivered: null,
          priority: run.priority,
          status: 'requested',
          fromSpotId: run.fromSpotId,
          crewId: null,
          requestedBy: 'Par sweep',
          slaMinutes: run.slaMinutes,
          requestedAt: now,
          assignedAt: null,
          pickedAt: null,
          deliveredAt: null,
          confirmedAt: null,
          cancelledReason: null,
          note: run.reason,
        })
        .run()
    }
  })

  refresh()

  const tail =
    unfulfillable.length > 0
      ? ` · ${unfulfillable.length} could not be filled — no stock in the building`
      : ''

  return { ok: true, message: `${runs.length} runs raised${tail}` }
}

/* ---- helpers ---- */

function pickSourceSpot(
  eventId: string,
  vendorId: string,
  itemId: string,
  qty: number,
): string | null {
  const db = getDb()

  const movements = db
    .select()
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.eventId, eventId))
    .all() as unknown as LedgerMovement[]
  const balances = buildBalances(movements)

  const allocated = db
    .select()
    .from(schema.storageAllocations)
    .where(
      and(
        eq(schema.storageAllocations.eventId, eventId),
        eq(schema.storageAllocations.vendorId, vendorId),
      ),
    )
    .all()

  const candidates = allocated
    .map((a) => ({
      spotId: a.spotId,
      available: balanceOf(balances, { type: 'spot', id: a.spotId }, itemId),
    }))
    .filter((c) => c.available > 0)
    .sort((a, b) => b.available - a.available)

  return candidates.find((c) => c.available >= qty)?.spotId ?? candidates[0]?.spotId ?? null
}

/**
 * The next free run number.
 *
 * Run codes are unique across the whole database, not per event — control
 * reads them over the radio and "LR-0043" has to mean one run, not one per
 * fixture. So this takes the highest number already issued anywhere rather
 * than counting this event's runs, which would re-issue codes belonging to a
 * previous fixture.
 */
function nextRunSequence(): number {
  const row = getDb()
    .select({
      highest: sql<number>`coalesce(max(cast(substr(${schema.loadRuns.code}, 4) as integer)), 0)`,
    })
    .from(schema.loadRuns)
    .get()

  return Number(row?.highest ?? 0) + 1
}

function runCode(sequence: number): string {
  return `LR-${String(sequence).padStart(4, '0')}`
}
