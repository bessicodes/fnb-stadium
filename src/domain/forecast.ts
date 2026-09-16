/**
 * Demand forecasting and counter coverage.
 *
 * Two questions, asked weeks before an event:
 *
 *   1. How much stock does this crowd drink and eat? (`forecastEvent`)
 *   2. Do we have enough counter to serve them? (`coverage`)
 *
 * The second one is the one that gets forgotten, and it is the one people
 * complain about. A block with 4 000 seats behind two tills will queue no
 * matter how much lager is in the cold room.
 */
import type { Block, EventKind, Kiosk, StadiumEvent, StockCategory } from '@/db/schema'

/**
 * Share of food-and-drink spend by category, by event type.
 *
 * These are planning assumptions, not measurements — they are the starting
 * point for a venue with no history, and are meant to be replaced by the
 * actual mix from `reconcileEvent` once a few events have been run.
 */
export const SPEND_MIX: Record<EventKind, Partial<Record<StockCategory, number>>> = {
  football: {
    beer: 0.32,
    soft_drink: 0.16,
    water: 0.09,
    food_hot: 0.28,
    snack: 0.08,
    hot_drink: 0.04,
    cider: 0.03,
  },
  rugby: {
    beer: 0.41,
    cider: 0.05,
    soft_drink: 0.12,
    water: 0.08,
    food_hot: 0.24,
    snack: 0.07,
    hot_drink: 0.03,
  },
  concert: {
    beer: 0.3,
    cider: 0.08,
    soft_drink: 0.17,
    water: 0.17,
    food_hot: 0.18,
    snack: 0.1,
  },
  conference: {
    hot_drink: 0.3,
    water: 0.2,
    soft_drink: 0.15,
    food_cold: 0.2,
    snack: 0.15,
  },
  other: {
    beer: 0.25,
    soft_drink: 0.2,
    water: 0.15,
    food_hot: 0.25,
    snack: 0.15,
  },
}

/**
 * Not everyone buys. This is the share of the crowd that transacts at all —
 * well under half, even at a full house, because groups send one person.
 */
export const PURCHASE_RATE: Record<EventKind, number> = {
  football: 0.42,
  rugby: 0.55,
  concert: 0.48,
  conference: 0.7,
  other: 0.4,
}

export type CategoryForecast = {
  category: StockCategory
  /** Rand-cents of expected turnover in this category. */
  revenueCents: number
  /** Base units expected to sell, at the given blended unit price. */
  units: number
}

/**
 * Expected spend and volume for an event, split by category.
 *
 * `unitPriceByCategory` is the blended board price per base unit — pass the
 * average of what is actually on the menu, not a list price.
 */
export function forecastEvent(
  event: Pick<StadiumEvent, 'kind' | 'expectedAttendance' | 'spendPerHeadCents'>,
  unitPriceByCategory: ReadonlyMap<StockCategory, number>,
): { totalRevenueCents: number; byCategory: CategoryForecast[] } {
  const mix = SPEND_MIX[event.kind]
  const buyers = Math.round(event.expectedAttendance * PURCHASE_RATE[event.kind])
  const totalRevenueCents = buyers * event.spendPerHeadCents

  const byCategory: CategoryForecast[] = []

  for (const [category, share] of Object.entries(mix) as [StockCategory, number][]) {
    const revenueCents = Math.round(totalRevenueCents * share)
    const price = unitPriceByCategory.get(category) ?? 0
    byCategory.push({
      category,
      revenueCents,
      units: price > 0 ? Math.ceil(revenueCents / price) : 0,
    })
  }

  return {
    totalRevenueCents,
    byCategory: byCategory.sort((a, b) => b.revenueCents - a.revenueCents),
  }
}

/**
 * Split a category forecast across the counters that sell it.
 *
 * Weighted by throughput, because a six-till bar should be sent more than a
 * two-till kiosk. Rounding is absorbed by the largest counter so the parts add
 * back up to the whole.
 */
export function splitAcrossKiosks(
  units: number,
  kiosks: readonly Pick<Kiosk, 'id' | 'throughputPerHour'>[],
): Map<string, number> {
  const split = new Map<string, number>()
  if (kiosks.length === 0 || units <= 0) return split

  const totalThroughput = kiosks.reduce((s, k) => s + k.throughputPerHour, 0)
  if (totalThroughput === 0) return split

  let assigned = 0
  for (const k of kiosks) {
    const share = Math.floor((units * k.throughputPerHour) / totalThroughput)
    split.set(k.id, share)
    assigned += share
  }

  const biggest = [...kiosks].sort((a, b) => b.throughputPerHour - a.throughputPerHour)[0]
  if (biggest) split.set(biggest.id, (split.get(biggest.id) ?? 0) + (units - assigned))

  return split
}

export type ZoneCoverage = {
  zoneId: string
  seats: number
  kiosks: number
  tills: number
  throughputPerHour: number
  /** Seats per till — the number that predicts a queue. */
  seatsPerTill: number
  /** Minutes to serve every likely buyer in the zone once. */
  minutesToServeAll: number
  verdict: 'comfortable' | 'tight' | 'under_served'
}

/** Above this many seats per till, expect visible queues. */
export const SEATS_PER_TILL_TIGHT = 350
export const SEATS_PER_TILL_UNDER = 550

/**
 * Counter capacity against seats, by zone.
 *
 * This is the report that justifies capital spend: it names the zones where
 * the building, not the vendor, is the reason people are not buying.
 */
export function coverage(input: {
  blocks: readonly Block[]
  kiosks: readonly Kiosk[]
  eventKind: EventKind
  /** Zone ids that are open for the event. Omit to include all. */
  openZoneIds?: ReadonlySet<string>
}): ZoneCoverage[] {
  const { blocks, kiosks, eventKind, openZoneIds } = input
  const purchaseRate = PURCHASE_RATE[eventKind]

  const zoneIds = new Set<string>()
  for (const b of blocks) if (!openZoneIds || openZoneIds.has(b.zoneId)) zoneIds.add(b.zoneId)

  return [...zoneIds]
    .map((zoneId) => {
      const zoneBlocks = blocks.filter((b) => b.zoneId === zoneId)
      const zoneKiosks = kiosks.filter((k) => k.zoneId === zoneId && k.status === 'active')

      const seats = zoneBlocks.reduce((s, b) => s + b.seats, 0)
      const tills = zoneKiosks.reduce((s, k) => s + k.tills, 0)
      const throughputPerHour = zoneKiosks.reduce((s, k) => s + k.throughputPerHour, 0)

      const seatsPerTill = tills === 0 ? Infinity : Math.round(seats / tills)
      const buyers = Math.round(seats * purchaseRate)
      const minutesToServeAll =
        throughputPerHour === 0 ? Infinity : Math.round((buyers / throughputPerHour) * 60)

      const verdict: ZoneCoverage['verdict'] =
        seatsPerTill >= SEATS_PER_TILL_UNDER
          ? 'under_served'
          : seatsPerTill >= SEATS_PER_TILL_TIGHT
            ? 'tight'
            : 'comfortable'

      return {
        zoneId,
        seats,
        kiosks: zoneKiosks.length,
        tills,
        throughputPerHour,
        seatsPerTill,
        minutesToServeAll,
        verdict,
      }
    })
    .sort((a, b) => b.seatsPerTill - a.seatsPerTill)
}

/** Trading hours for an event: doors open until the crowd is out. */
export function tradingHours(
  event: Pick<StadiumEvent, 'doorsAt' | 'endsAt'>,
): number {
  return Math.max(1, (event.endsAt - event.doorsAt) / 3_600_000)
}
