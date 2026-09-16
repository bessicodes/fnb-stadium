'use server'

import { refresh } from 'next/cache'
import { and, eq } from 'drizzle-orm'

import { getDb, schema } from '@/db/client'
import { canAllocateKiosk } from '@/domain/compliance'
import { checkStorageAllocation } from '@/domain/storage'
import type { ActionResult } from './dispatch'

/**
 * Give a vendor a counter for an event.
 *
 * The compliance gate runs here, server-side, judged against kick-off. The UI
 * also shows the verdict up front, but that is a courtesy — this is the check
 * that actually decides, because a disabled button is not access control.
 */
export async function allocateKioskAction(input: {
  eventId: string
  kioskId: string
  vendorId: string
}): Promise<ActionResult> {
  const db = getDb()

  const event = db.select().from(schema.events).where(eq(schema.events.id, input.eventId)).get()
  const kiosk = db.select().from(schema.kiosks).where(eq(schema.kiosks.id, input.kioskId)).get()
  const vendor = db.select().from(schema.vendors).where(eq(schema.vendors.id, input.vendorId)).get()

  if (!event || !kiosk || !vendor) return { ok: false, error: 'Event, kiosk or vendor not found' }

  const documents = db
    .select()
    .from(schema.vendorDocuments)
    .where(eq(schema.vendorDocuments.vendorId, input.vendorId))
    .all()

  const verdict = canAllocateKiosk(vendor, documents, kiosk, event)
  if (!verdict.allowed) {
    return { ok: false, error: verdict.reasons.join('. ') }
  }

  const existing = db
    .select()
    .from(schema.kioskAllocations)
    .where(
      and(
        eq(schema.kioskAllocations.eventId, input.eventId),
        eq(schema.kioskAllocations.kioskId, input.kioskId),
      ),
    )
    .get()

  if (existing) {
    db.update(schema.kioskAllocations)
      .set({ vendorId: input.vendorId })
      .where(eq(schema.kioskAllocations.id, existing.id))
      .run()
  } else {
    db.insert(schema.kioskAllocations)
      .values({
        id: `alloc-${input.eventId}-${input.kioskId}`,
        eventId: input.eventId,
        kioskId: input.kioskId,
        vendorId: input.vendorId,
        status: 'draft',
        staffPlanned: kiosk.tills + 2,
        floatCents: kiosk.tills * 50_000,
        declaredSalesCents: null,
        openedAt: null,
        closedAt: null,
        notes: null,
      })
      .run()
  }

  refresh()
  return {
    ok: true,
    message: `${kiosk.code} allocated to ${vendor.tradingName}${
      verdict.warnings.length > 0 ? ` — ${verdict.warnings.join('; ')}` : ''
    }`,
  }
}

export async function releaseKioskAction(allocationId: string): Promise<ActionResult> {
  const db = getDb()

  const allocation = db
    .select()
    .from(schema.kioskAllocations)
    .where(eq(schema.kioskAllocations.id, allocationId))
    .get()
  if (!allocation) return { ok: false, error: 'Allocation not found' }

  if (allocation.status === 'trading' || allocation.status === 'closed') {
    return { ok: false, error: 'A counter that has traded cannot be released — cancel it instead' }
  }

  db.delete(schema.kioskAllocations).where(eq(schema.kioskAllocations.id, allocationId)).run()
  refresh()
  return { ok: true, message: 'Counter released' }
}

/** Let a storage bay to a vendor for an event. */
export async function allocateSpotAction(input: {
  eventId: string
  spotId: string
  vendorId: string
  units: number
}): Promise<ActionResult> {
  const db = getDb()

  const spot = db
    .select()
    .from(schema.storageSpots)
    .where(eq(schema.storageSpots.id, input.spotId))
    .get()
  if (!spot) return { ok: false, error: 'Spot not found' }

  const room = db
    .select()
    .from(schema.storageRooms)
    .where(eq(schema.storageRooms.id, spot.roomId))
    .get()
  if (!room) return { ok: false, error: 'Room not found' }

  const existing = db
    .select()
    .from(schema.storageAllocations)
    .where(
      and(
        eq(schema.storageAllocations.eventId, input.eventId),
        eq(schema.storageAllocations.spotId, input.spotId),
      ),
    )
    .all()

  const check = checkStorageAllocation({
    spot,
    room,
    vendorId: input.vendorId,
    unitsRequested: input.units,
    existing,
  })

  if (!check.allowed) {
    return { ok: false, error: check.problems.map((p) => p.message).join('. ') }
  }

  db.insert(schema.storageAllocations)
    .values({
      id: `stor-${input.eventId}-${input.spotId}-${input.vendorId}`,
      eventId: input.eventId,
      spotId: input.spotId,
      vendorId: input.vendorId,
      unitsAllocated: input.units,
      notes: null,
    })
    .run()

  refresh()
  const warnings = check.problems.filter((p) => p.severity === 'warning')
  return {
    ok: true,
    message: `${spot.code} let${warnings.length > 0 ? ` — ${warnings[0]?.message}` : ''}`,
  }
}

export async function releaseSpotAction(allocationId: string): Promise<ActionResult> {
  const db = getDb()
  db.delete(schema.storageAllocations)
    .where(eq(schema.storageAllocations.id, allocationId))
    .run()
  refresh()
  return { ok: true, message: 'Bay released' }
}

/** Walk an event along its status ladder. */
export async function setEventStatusAction(
  eventId: string,
  status: 'planned' | 'accreditation' | 'load_in' | 'live' | 'closed' | 'reconciled',
): Promise<ActionResult> {
  const db = getDb()
  const event = db.select().from(schema.events).where(eq(schema.events.id, eventId)).get()
  if (!event) return { ok: false, error: 'Event not found' }

  const order = ['planned', 'accreditation', 'load_in', 'live', 'closed', 'reconciled'] as const
  const from = order.indexOf(event.status)
  const to = order.indexOf(status)

  if (to < from) {
    return { ok: false, error: `An event cannot go back from ${event.status} to ${status}` }
  }
  if (to > from + 1) {
    return { ok: false, error: `Skipping from ${event.status} straight to ${status} is not allowed` }
  }

  const patch: Partial<typeof schema.events.$inferInsert> = { status }

  // Closing the event closes every counter with it.
  if (status === 'closed') {
    db.update(schema.kioskAllocations)
      .set({ status: 'closed', closedAt: Date.now() })
      .where(eq(schema.kioskAllocations.eventId, eventId))
      .run()
  }
  if (status === 'live') {
    db.update(schema.kioskAllocations)
      .set({ status: 'trading', openedAt: Date.now() })
      .where(eq(schema.kioskAllocations.eventId, eventId))
      .run()
  }

  db.update(schema.events).set(patch).where(eq(schema.events.id, eventId)).run()
  refresh()
  return { ok: true, message: `${event.code} is now ${status.replace(/_/g, ' ')}` }
}

/** Mark an incident dealt with. */
export async function resolveIncidentAction(
  incidentId: string,
  resolution: string,
): Promise<ActionResult> {
  const db = getDb()
  db.update(schema.incidents)
    .set({ resolvedAt: Date.now(), resolution: resolution || 'Resolved on shift' })
    .where(eq(schema.incidents.id, incidentId))
    .run()
  refresh()
  return { ok: true, message: 'Incident closed' }
}
