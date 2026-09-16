/**
 * The stock ledger.
 *
 * Nothing in this system stores a stock balance. Every balance in the app is
 * summed from `stock_movements` by the functions here. A stored balance can
 * drift from its own history and then there is no way to tell which one lied;
 * a derived balance cannot. When a vendor disputes a shrinkage charge, the
 * answer has to be a list of moves, not a number.
 *
 * Quantities are base units throughout — see the note at the top of schema.ts.
 */
import type { LocationType, MovementKind } from '@/db/schema'

/** A place stock can be. `id` is null for the abstract ones (sold, waste). */
export type LocationRef = {
  type: LocationType
  id?: string | null
}

/** The minimum a movement needs for balance maths. */
export type LedgerMovement = {
  itemId: string
  qty: number
  kind: MovementKind
  fromType: LocationType
  fromId?: string | null
  toType: LocationType
  toId?: string | null
}

/**
 * Locations outside the building. Stock crossing one of these boundaries is
 * created or destroyed as far as the stadium is concerned, so their running
 * balance is meaningless and deliberately not reported as stock on hand.
 */
const EXTERNAL: ReadonlySet<LocationType> = new Set<LocationType>([
  'supplier',
  'sold',
  'waste',
  'returned',
])

export function isExternal(type: LocationType): boolean {
  return EXTERNAL.has(type)
}

/** Stable string key for a location, so balances can live in a plain Map. */
export function locationKey(ref: LocationRef): string {
  return `${ref.type}:${ref.id ?? '-'}`
}

export function parseLocationKey(key: string): LocationRef {
  const idx = key.indexOf(':')
  const type = key.slice(0, idx) as LocationType
  const id = key.slice(idx + 1)
  return { type, id: id === '-' ? null : id }
}

export type Balances = Map<string, Map<string, number>>

/**
 * Sum movements into `location -> item -> qty`.
 *
 * Every movement debits its origin and credits its destination, so a run of
 * spot -> kiosk leaves the spot short and the kiosk long by the same amount
 * and the two always cancel. External locations are summed too (that is how
 * `sold` and `waste` totals are read back) but carry no "on hand" meaning.
 */
export function buildBalances(movements: readonly LedgerMovement[]): Balances {
  const balances: Balances = new Map()

  const add = (loc: LocationRef, itemId: string, delta: number) => {
    const key = locationKey(loc)
    let byItem = balances.get(key)
    if (!byItem) {
      byItem = new Map()
      balances.set(key, byItem)
    }
    byItem.set(itemId, (byItem.get(itemId) ?? 0) + delta)
  }

  for (const m of movements) {
    add({ type: m.fromType, id: m.fromId }, m.itemId, -m.qty)
    add({ type: m.toType, id: m.toId }, m.itemId, m.qty)
  }

  return balances
}

/** Stock on hand of one item at one location. */
export function balanceOf(
  balances: Balances,
  loc: LocationRef,
  itemId: string,
): number {
  return balances.get(locationKey(loc))?.get(itemId) ?? 0
}

/** Everything held at one location, zero-balance items dropped. */
export function balanceAt(
  balances: Balances,
  loc: LocationRef,
): Map<string, number> {
  const held = new Map<string, number>()
  for (const [itemId, qty] of balances.get(locationKey(loc)) ?? []) {
    if (qty !== 0) held.set(itemId, qty)
  }
  return held
}

/**
 * Total of one item across every internal location — what is physically in the
 * building. External sinks are excluded, so this does not double-count stock
 * that has already been sold.
 */
export function onHand(balances: Balances, itemId: string): number {
  let total = 0
  for (const [key, byItem] of balances) {
    if (isExternal(parseLocationKey(key).type)) continue
    total += byItem.get(itemId) ?? 0
  }
  return total
}

/**
 * Locations holding a negative balance of something.
 *
 * Negative internal stock is physically impossible, so any row here is a data
 * fault: a run confirmed twice, an issue posted from the wrong spot, or a
 * delivery that was never captured. Control should see these, not have them
 * quietly clamped to zero.
 */
export function negativeBalances(
  balances: Balances,
): Array<{ location: LocationRef; itemId: string; qty: number }> {
  const faults: Array<{ location: LocationRef; itemId: string; qty: number }> = []

  for (const [key, byItem] of balances) {
    const location = parseLocationKey(key)
    if (isExternal(location.type)) continue
    for (const [itemId, qty] of byItem) {
      if (qty < 0) faults.push({ location, itemId, qty })
    }
  }

  return faults.sort((a, b) => a.qty - b.qty)
}

/**
 * Would this movement overdraw its origin?
 *
 * Called before posting, so a short pick is caught at the spot — while
 * somebody is standing there and can count the shelf — rather than in the
 * reconciliation report three days later.
 */
export function wouldOverdraw(
  balances: Balances,
  movement: LedgerMovement,
): { overdraws: boolean; available: number; short: number } {
  const from = { type: movement.fromType, id: movement.fromId }
  if (isExternal(from.type)) {
    return { overdraws: false, available: Infinity, short: 0 }
  }

  const available = balanceOf(balances, from, movement.itemId)
  const short = movement.qty - available
  return { overdraws: short > 0, available, short: Math.max(0, short) }
}

/** Movement kinds that represent stock leaving the building for good. */
export const SINK_KINDS: ReadonlySet<MovementKind> = new Set<MovementKind>([
  'sale',
  'waste',
])

/**
 * The shape of one item's event: what came in, what moved, what left.
 * This is the row behind every reconciliation line.
 */
export type ItemFlow = {
  itemId: string
  delivered: number
  issued: number
  returned: number
  sold: number
  wasted: number
  adjusted: number
}

export function flowByItem(movements: readonly LedgerMovement[]): Map<string, ItemFlow> {
  const flows = new Map<string, ItemFlow>()

  const flowFor = (itemId: string): ItemFlow => {
    let f = flows.get(itemId)
    if (!f) {
      f = {
        itemId,
        delivered: 0,
        issued: 0,
        returned: 0,
        sold: 0,
        wasted: 0,
        adjusted: 0,
      }
      flows.set(itemId, f)
    }
    return f
  }

  for (const m of movements) {
    const f = flowFor(m.itemId)
    switch (m.kind) {
      case 'delivery':
        f.delivered += m.qty
        break
      case 'issue':
        f.issued += m.qty
        break
      case 'return':
        f.returned += m.qty
        break
      case 'sale':
        f.sold += m.qty
        break
      case 'waste':
        f.wasted += m.qty
        break
      case 'adjustment':
        // Adjustments are signed by direction: into a real location is a gain.
        f.adjusted += isExternal(m.toType) ? -m.qty : m.qty
        break
      case 'transfer':
        // Moves stock sideways; changes no total.
        break
    }
  }

  return flows
}
