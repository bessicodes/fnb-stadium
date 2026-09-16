import { describe, expect, it } from 'vitest'

import type { Block, Kiosk, StockCategory } from '@/db/schema'
import {
  coverage,
  forecastEvent,
  PURCHASE_RATE,
  SPEND_MIX,
  splitAcrossKiosks,
  tradingHours,
} from './forecast'

const prices = new Map<StockCategory, number>([
  ['beer', 3500],
  ['soft_drink', 2500],
  ['water', 2000],
  ['food_hot', 5500],
  ['snack', 2500],
  ['hot_drink', 2500],
  ['cider', 3800],
  ['food_cold', 4500],
])

function block(over: Partial<Block> = {}): Block {
  return { id: 'b-1', code: 'B1', zoneId: 'z-1', tier: 'lower', seats: 1200, ...over }
}

function kiosk(over: Partial<Kiosk> = {}): Kiosk {
  return {
    id: 'k-1',
    code: 'K-L1-01',
    name: 'Kiosk 1',
    zoneId: 'z-1',
    kind: 'combo',
    tills: 4,
    fitout: [],
    throughputPerHour: 240,
    servesBlocks: [],
    hasGas: false,
    hasWater: true,
    status: 'active',
    notes: null,
    ...over,
  }
}

describe('SPEND_MIX', () => {
  it('assigns the whole spend for every event kind', () => {
    for (const [kind, mix] of Object.entries(SPEND_MIX)) {
      const total = Object.values(mix).reduce((s, v) => s + (v ?? 0), 0)
      expect(total, `${kind} mix`).toBeCloseTo(1, 5)
    }
  })

  it('has rugby drinking more beer than football', () => {
    expect(SPEND_MIX.rugby.beer!).toBeGreaterThan(SPEND_MIX.football.beer!)
  })

  it('has a conference buying coffee rather than lager', () => {
    expect(SPEND_MIX.conference.hot_drink!).toBeGreaterThan(0.2)
    expect(SPEND_MIX.conference.beer).toBeUndefined()
  })
})

describe('forecastEvent', () => {
  const event = {
    kind: 'football' as const,
    expectedAttendance: 80_000,
    spendPerHeadCents: 4500,
  }

  it('bases turnover on buyers, not on every seat', () => {
    const { totalRevenueCents } = forecastEvent(event, prices)
    const buyers = Math.round(80_000 * PURCHASE_RATE.football)

    expect(totalRevenueCents).toBe(buyers * 4500)
  })

  it('splits revenue across categories in the event mix', () => {
    const { totalRevenueCents, byCategory } = forecastEvent(event, prices)
    const summed = byCategory.reduce((s, c) => s + c.revenueCents, 0)

    // Rounding per category, so allow a rand of drift on a six-figure total.
    expect(Math.abs(summed - totalRevenueCents)).toBeLessThan(100)
  })

  it('converts revenue to units at the category price', () => {
    const { byCategory } = forecastEvent(event, prices)
    const beer = byCategory.find((c) => c.category === 'beer')!

    expect(beer.units).toBe(Math.ceil(beer.revenueCents / 3500))
  })

  it('ranks the biggest category first', () => {
    const { byCategory } = forecastEvent(event, prices)
    expect(byCategory[0]?.category).toBe('beer')
  })

  it('reports zero units, not Infinity, for a category with no price', () => {
    const { byCategory } = forecastEvent(event, new Map())
    expect(byCategory.every((c) => c.units === 0)).toBe(true)
  })

  it('scales with attendance', () => {
    const half = forecastEvent({ ...event, expectedAttendance: 40_000 }, prices)
    const full = forecastEvent(event, prices)

    expect(full.totalRevenueCents / half.totalRevenueCents).toBeCloseTo(2, 1)
  })
})

describe('splitAcrossKiosks', () => {
  it('weights the split by throughput', () => {
    const split = splitAcrossKiosks(1000, [
      kiosk({ id: 'big', throughputPerHour: 300 }),
      kiosk({ id: 'small', throughputPerHour: 100 }),
    ])

    expect(split.get('big')).toBe(750)
    expect(split.get('small')).toBe(250)
  })

  it('always adds back up to the total', () => {
    const split = splitAcrossKiosks(1000, [
      kiosk({ id: 'a', throughputPerHour: 333 }),
      kiosk({ id: 'b', throughputPerHour: 333 }),
      kiosk({ id: 'c', throughputPerHour: 334 }),
    ])

    const total = [...split.values()].reduce((s, v) => s + v, 0)
    expect(total).toBe(1000)
  })

  it('returns nothing when there are no counters open', () => {
    expect(splitAcrossKiosks(1000, []).size).toBe(0)
  })

  it('does not divide by zero when every counter is rated at nothing', () => {
    const split = splitAcrossKiosks(1000, [kiosk({ throughputPerHour: 0 })])
    expect(split.size).toBe(0)
  })
})

describe('coverage', () => {
  it('reports seats per till for a zone', () => {
    const [zone] = coverage({
      blocks: [block({ seats: 2000 })],
      kiosks: [kiosk({ tills: 4 })],
      eventKind: 'football',
    })

    expect(zone?.seatsPerTill).toBe(500)
  })

  it('calls a well-served zone comfortable', () => {
    const [zone] = coverage({
      blocks: [block({ seats: 1000 })],
      kiosks: [kiosk({ tills: 6 })],
      eventKind: 'football',
    })

    expect(zone?.verdict).toBe('comfortable')
  })

  it('calls a zone with too little counter under-served', () => {
    const [zone] = coverage({
      blocks: [block({ seats: 4000 })],
      kiosks: [kiosk({ tills: 2 })],
      eventKind: 'football',
    })

    expect(zone?.verdict).toBe('under_served')
  })

  it('treats a zone with no counter at all as infinitely under-served', () => {
    const [zone] = coverage({
      blocks: [block({ seats: 4000 })],
      kiosks: [],
      eventKind: 'football',
    })

    expect(zone?.seatsPerTill).toBe(Infinity)
    expect(zone?.verdict).toBe('under_served')
  })

  it('ignores kiosks that are out of service', () => {
    const [zone] = coverage({
      blocks: [block({ seats: 1000 })],
      kiosks: [kiosk({ tills: 6, status: 'maintenance' })],
      eventKind: 'football',
    })

    expect(zone?.tills).toBe(0)
  })

  it('reports the worst zone first', () => {
    const zones = coverage({
      blocks: [
        block({ id: 'b1', zoneId: 'good', seats: 500 }),
        block({ id: 'b2', zoneId: 'bad', seats: 5000 }),
      ],
      kiosks: [
        kiosk({ id: 'k1', zoneId: 'good', tills: 6 }),
        kiosk({ id: 'k2', zoneId: 'bad', tills: 2 }),
      ],
      eventKind: 'football',
    })

    expect(zones[0]?.zoneId).toBe('bad')
  })

  it('leaves out zones the event does not open', () => {
    const zones = coverage({
      blocks: [
        block({ id: 'b1', zoneId: 'open', seats: 500 }),
        block({ id: 'b2', zoneId: 'shut', seats: 500 }),
      ],
      kiosks: [kiosk({ zoneId: 'open' })],
      eventKind: 'football',
      openZoneIds: new Set(['open']),
    })

    expect(zones.map((z) => z.zoneId)).toEqual(['open'])
  })

  it('estimates longer service for a rugby crowd than a football one', () => {
    const args = { blocks: [block({ seats: 2000 })], kiosks: [kiosk()] }
    const football = coverage({ ...args, eventKind: 'football' })[0]!
    const rugby = coverage({ ...args, eventKind: 'rugby' })[0]!

    expect(rugby.minutesToServeAll).toBeGreaterThan(football.minutesToServeAll)
  })
})

describe('tradingHours', () => {
  it('measures doors open to the crowd being out', () => {
    const hours = tradingHours({
      doorsAt: Date.UTC(2026, 5, 13, 15, 0),
      endsAt: Date.UTC(2026, 5, 13, 21, 0),
    })

    expect(hours).toBe(6)
  })

  it('never returns zero, so nothing downstream divides by it', () => {
    const t = Date.UTC(2026, 5, 13, 15, 0)
    expect(tradingHours({ doorsAt: t, endsAt: t })).toBe(1)
  })
})
