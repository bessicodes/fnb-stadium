/**
 * Replenishment: turning "that counter is running low" into a load run before
 * anyone has to notice.
 *
 * Every kiosk has a par level per item — a floor and a ceiling. The sweep in
 * here compares live ledger balances against those pars and proposes runs to
 * top the counter back up to its ceiling.
 *
 * Two judgements make the difference between a useful sweep and an alarm
 * nobody trusts:
 *
 *   - Stock already on its way counts. A counter with 20 on the shelf and 96
 *     in transit is not short, and raising a second run for it is how a kiosk
 *     ends up with eight cases and no floor space.
 *   - Urgency comes from how far below the floor the counter has fallen, not
 *     from the fact that it is below. Down to 80% of par is a routine top-up;
 *     empty, mid-match, is critical.
 */
import type { LoadRun, ParLevel, RunPriority, StockItem } from '@/db/schema'
import { SLA_MINUTES } from './dispatch'
import { isTerminal } from './dispatch'

export type Shortfall = {
  kioskId: string
  itemId: string
  /** On the counter now. */
  onHand: number
  /** Already assigned or moving towards the counter. */
  inbound: number
  /** onHand + inbound. */
  effective: number
  minQty: number
  maxQty: number
  /** How much to move to reach the ceiling. */
  suggestedQty: number
  priority: RunPriority
  /** effective / minQty, so 0 is empty and 1 is exactly at the floor. */
  coverage: number
}

/**
 * Inbound stock per (kiosk, item): runs that are live but not yet signed for.
 *
 * A delivered-but-unconfirmed run still counts as inbound, because the stock
 * is physically at the counter even though the ledger has not moved yet.
 */
export function inboundByKioskItem(
  runs: readonly Pick<LoadRun, 'kioskId' | 'itemId' | 'qty' | 'qtyDelivered' | 'status'>[],
): Map<string, number> {
  const inbound = new Map<string, number>()

  for (const r of runs) {
    if (isTerminal(r.status)) continue
    const key = `${r.kioskId}:${r.itemId}`
    inbound.set(key, (inbound.get(key) ?? 0) + (r.qtyDelivered ?? r.qty))
  }

  return inbound
}

/** How urgent a shortfall is, from how much of the floor is left. */
export function priorityFor(coverage: number, trading: boolean): RunPriority {
  if (!trading) return 'routine'
  if (coverage <= 0.05) return 'critical'
  if (coverage < 0.5) return 'urgent'
  return 'routine'
}

/**
 * Compare counter balances against par and propose top-ups.
 *
 * `trading` is whether the event is live. Before doors open everything is a
 * routine pre-load; once people are queuing the same gap is an emergency.
 */
export function findShortfalls(input: {
  pars: readonly ParLevel[]
  /** Base units on the counter, keyed `kioskId:itemId`. */
  onHand: ReadonlyMap<string, number>
  inbound: ReadonlyMap<string, number>
  trading: boolean
}): Shortfall[] {
  const { pars, onHand, inbound, trading } = input
  const shortfalls: Shortfall[] = []

  for (const par of pars) {
    const key = `${par.kioskId}:${par.itemId}`
    const have = onHand.get(key) ?? 0
    const coming = inbound.get(key) ?? 0
    const effective = have + coming

    if (effective >= par.minQty) continue

    const coverage = par.minQty === 0 ? 1 : Math.max(0, effective) / par.minQty

    shortfalls.push({
      kioskId: par.kioskId,
      itemId: par.itemId,
      onHand: have,
      inbound: coming,
      effective,
      minQty: par.minQty,
      maxQty: par.maxQty,
      suggestedQty: Math.max(0, par.maxQty - effective),
      priority: priorityFor(coverage, trading),
      coverage,
    })
  }

  // Emptiest counters first — that is the order control wants to act in.
  return shortfalls.sort((a, b) => a.coverage - b.coverage)
}

export type ProposedRun = {
  kioskId: string
  itemId: string
  vendorId: string
  qty: number
  priority: RunPriority
  slaMinutes: number
  fromSpotId: string | null
  reason: string
}

/**
 * Turn shortfalls into runs that can actually be executed.
 *
 * A shortfall with no stock anywhere in the building is dropped rather than
 * proposed: raising a run nobody can pick wastes a crew's trip and buries the
 * real shortage. Those come back in `unfulfillable` so control can see them
 * and go buy something.
 */
export function planRuns(input: {
  shortfalls: readonly Shortfall[]
  /** Which vendor is trading each kiosk for this event. */
  vendorByKiosk: ReadonlyMap<string, string>
  /** Spots holding each item, best-first, keyed by itemId. */
  supplyByItem: ReadonlyMap<string, ReadonlyArray<{ spotId: string; available: number }>>
  /** Round a run up to a whole case, where the item has one. */
  itemsById?: ReadonlyMap<string, Pick<StockItem, 'packSize'>>
}): { runs: ProposedRun[]; unfulfillable: Shortfall[] } {
  const { shortfalls, vendorByKiosk, supplyByItem, itemsById } = input

  const runs: ProposedRun[] = []
  const unfulfillable: Shortfall[] = []

  // Claim stock as it is planned, so two counters short of the same item are
  // not both promised the last pallet.
  const remaining = new Map<string, number>()
  for (const [itemId, spots] of supplyByItem) {
    for (const s of spots) remaining.set(`${itemId}:${s.spotId}`, s.available)
  }

  for (const short of shortfalls) {
    const vendorId = vendorByKiosk.get(short.kioskId)
    if (!vendorId) {
      unfulfillable.push(short)
      continue
    }

    const packSize = itemsById?.get(short.itemId)?.packSize ?? 1
    const wanted = roundUpToPack(short.suggestedQty, packSize)

    const spots = supplyByItem.get(short.itemId) ?? []
    const usable = spots.find((s) => (remaining.get(`${short.itemId}:${s.spotId}`) ?? 0) > 0)

    if (!usable) {
      unfulfillable.push(short)
      continue
    }

    const key = `${short.itemId}:${usable.spotId}`
    const available = remaining.get(key) ?? 0
    const qty = Math.min(wanted, available)

    if (qty <= 0) {
      unfulfillable.push(short)
      continue
    }

    remaining.set(key, available - qty)

    runs.push({
      kioskId: short.kioskId,
      itemId: short.itemId,
      vendorId,
      qty,
      priority: short.priority,
      slaMinutes: SLA_MINUTES[short.priority],
      fromSpotId: usable.spotId,
      reason:
        short.onHand <= 0
          ? 'Counter is empty'
          : `${short.onHand} on hand against a floor of ${short.minQty}`,
    })
  }

  return { runs, unfulfillable }
}

/** Cases, not loose cans: a crew carries whole boxes. */
export function roundUpToPack(qty: number, packSize: number): number {
  if (packSize <= 1) return Math.ceil(qty)
  return Math.ceil(qty / packSize) * packSize
}

/**
 * Par levels derived from a forecast.
 *
 * Used when a new kiosk opens and has no history: set the floor at roughly one
 * hour of expected selling and the ceiling at what the counter can physically
 * hold, so a crew is not sent every fifteen minutes.
 */
export function derivePar(input: {
  forecastUnits: number
  tradingHours: number
  packSize: number
  /** Base units the counter can physically stock behind it. */
  counterCapacity: number
}): { minQty: number; maxQty: number } {
  const { forecastUnits, tradingHours, packSize, counterCapacity } = input

  const perHour = tradingHours <= 0 ? forecastUnits : forecastUnits / tradingHours
  const minQty = roundUpToPack(perHour, packSize)
  const maxQty = Math.max(
    minQty * 2,
    roundUpToPack(Math.min(counterCapacity, perHour * 3), packSize),
  )

  return { minQty, maxQty }
}
