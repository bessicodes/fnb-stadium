import { describe, expect, it } from 'vitest'

import type { LoadRun, ParLevel } from '@/db/schema'
import {
  derivePar,
  findShortfalls,
  inboundByKioskItem,
  planRuns,
  priorityFor,
  roundUpToPack,
  type Shortfall,
} from './replenishment'

function par(over: Partial<ParLevel> = {}): ParLevel {
  return { id: 'p-1', kioskId: 'k-1', itemId: 'i-1', minQty: 96, maxQty: 288, ...over }
}

function runRow(
  over: Partial<Pick<LoadRun, 'kioskId' | 'itemId' | 'qty' | 'qtyDelivered' | 'status'>> = {},
) {
  return {
    kioskId: 'k-1',
    itemId: 'i-1',
    qty: 96,
    qtyDelivered: null,
    status: 'assigned' as const,
    ...over,
  }
}

describe('inboundByKioskItem', () => {
  it('counts stock on its way to a counter', () => {
    const inbound = inboundByKioskItem([runRow(), runRow({ status: 'in_transit' })])
    expect(inbound.get('k-1:i-1')).toBe(192)
  })

  it('ignores runs that are finished or cancelled', () => {
    const inbound = inboundByKioskItem([
      runRow({ status: 'confirmed' }),
      runRow({ status: 'cancelled' }),
    ])
    expect(inbound.get('k-1:i-1')).toBeUndefined()
  })

  it('still counts a delivered run nobody has signed for', () => {
    const inbound = inboundByKioskItem([runRow({ status: 'delivered', qtyDelivered: 72 })])
    expect(inbound.get('k-1:i-1')).toBe(72)
  })

  it('uses the short-picked quantity rather than what was asked for', () => {
    const inbound = inboundByKioskItem([
      runRow({ status: 'in_transit', qty: 96, qtyDelivered: 48 }),
    ])
    expect(inbound.get('k-1:i-1')).toBe(48)
  })

  it('keeps counters and items separate', () => {
    const inbound = inboundByKioskItem([
      runRow({ kioskId: 'k-1', itemId: 'i-1' }),
      runRow({ kioskId: 'k-2', itemId: 'i-1' }),
      runRow({ kioskId: 'k-1', itemId: 'i-2' }),
    ])

    expect(inbound.get('k-1:i-1')).toBe(96)
    expect(inbound.get('k-2:i-1')).toBe(96)
    expect(inbound.get('k-1:i-2')).toBe(96)
  })
})

describe('priorityFor', () => {
  it('treats everything as routine before doors open', () => {
    expect(priorityFor(0, false)).toBe('routine')
  })

  it('calls an empty counter critical while trading', () => {
    expect(priorityFor(0, true)).toBe('critical')
  })

  it('calls a half-empty counter urgent', () => {
    expect(priorityFor(0.3, true)).toBe('urgent')
  })

  it('calls a nearly-stocked counter routine', () => {
    expect(priorityFor(0.8, true)).toBe('routine')
  })
})

describe('findShortfalls', () => {
  it('ignores a counter at or above its floor', () => {
    const shortfalls = findShortfalls({
      pars: [par({ minQty: 96 })],
      onHand: new Map([['k-1:i-1', 96]]),
      inbound: new Map(),
      trading: true,
    })

    expect(shortfalls).toEqual([])
  })

  it('proposes topping up to the ceiling, not just to the floor', () => {
    const shortfalls = findShortfalls({
      pars: [par({ minQty: 96, maxQty: 288 })],
      onHand: new Map([['k-1:i-1', 24]]),
      inbound: new Map(),
      trading: true,
    })

    expect(shortfalls[0]?.suggestedQty).toBe(264)
  })

  it('does not raise a second run for stock already on its way', () => {
    const shortfalls = findShortfalls({
      pars: [par({ minQty: 96 })],
      onHand: new Map([['k-1:i-1', 20]]),
      inbound: new Map([['k-1:i-1', 96]]),
      trading: true,
    })

    expect(shortfalls).toEqual([])
  })

  it('treats a counter with nothing recorded as empty', () => {
    const shortfalls = findShortfalls({
      pars: [par()],
      onHand: new Map(),
      inbound: new Map(),
      trading: true,
    })

    expect(shortfalls[0]).toMatchObject({ onHand: 0, priority: 'critical' })
  })

  it('puts the emptiest counter first', () => {
    const shortfalls = findShortfalls({
      pars: [
        par({ id: 'p-a', kioskId: 'k-a', minQty: 100 }),
        par({ id: 'p-b', kioskId: 'k-b', minQty: 100 }),
      ],
      onHand: new Map([
        ['k-a:i-1', 80],
        ['k-b:i-1', 5],
      ]),
      inbound: new Map(),
      trading: true,
    })

    expect(shortfalls.map((s) => s.kioskId)).toEqual(['k-b', 'k-a'])
  })

  it('does not divide by zero on a par with no floor', () => {
    const shortfalls = findShortfalls({
      pars: [par({ minQty: 0 })],
      onHand: new Map(),
      inbound: new Map(),
      trading: true,
    })

    expect(shortfalls).toEqual([])
  })
})

describe('planRuns', () => {
  const shortfall = (over: Partial<Shortfall> = {}): Shortfall => ({
    kioskId: 'k-1',
    itemId: 'i-1',
    onHand: 0,
    inbound: 0,
    effective: 0,
    minQty: 96,
    maxQty: 240,
    suggestedQty: 240,
    priority: 'critical',
    coverage: 0,
    ...over,
  })

  const vendorByKiosk = new Map([
    ['k-1', 'v-1'],
    ['k-2', 'v-1'],
  ])

  it('plans a run from a spot that holds the stock', () => {
    const { runs } = planRuns({
      shortfalls: [shortfall()],
      vendorByKiosk,
      supplyByItem: new Map([['i-1', [{ spotId: 'spot-a', available: 480 }]]]),
    })

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ kioskId: 'k-1', qty: 240, fromSpotId: 'spot-a' })
  })

  it('rounds a run up to whole cases', () => {
    const { runs } = planRuns({
      shortfalls: [shortfall({ suggestedQty: 100 })],
      vendorByKiosk,
      supplyByItem: new Map([['i-1', [{ spotId: 'spot-a', available: 480 }]]]),
      itemsById: new Map([['i-1', { packSize: 24 }]]),
    })

    expect(runs[0]?.qty).toBe(120)
  })

  it('does not promise the same pallet to two counters', () => {
    const { runs, unfulfillable } = planRuns({
      shortfalls: [shortfall({ kioskId: 'k-1' }), shortfall({ kioskId: 'k-2' })],
      vendorByKiosk,
      supplyByItem: new Map([['i-1', [{ spotId: 'spot-a', available: 300 }]]]),
    })

    const promised = runs.reduce((s, r) => s + r.qty, 0)
    expect(promised).toBeLessThanOrEqual(300)
    expect(runs.length + unfulfillable.length).toBe(2)
  })

  it('short-fills from what is actually on the shelf', () => {
    const { runs } = planRuns({
      shortfalls: [shortfall({ suggestedQty: 240 })],
      vendorByKiosk,
      supplyByItem: new Map([['i-1', [{ spotId: 'spot-a', available: 100 }]]]),
    })

    expect(runs[0]?.qty).toBe(100)
  })

  it('reports a shortfall with no stock anywhere instead of raising a doomed run', () => {
    const { runs, unfulfillable } = planRuns({
      shortfalls: [shortfall()],
      vendorByKiosk,
      supplyByItem: new Map(),
    })

    expect(runs).toEqual([])
    expect(unfulfillable).toHaveLength(1)
  })

  it('cannot plan for a counter with no vendor trading it', () => {
    const { runs, unfulfillable } = planRuns({
      shortfalls: [shortfall({ kioskId: 'k-unlet' })],
      vendorByKiosk,
      supplyByItem: new Map([['i-1', [{ spotId: 'spot-a', available: 480 }]]]),
    })

    expect(runs).toEqual([])
    expect(unfulfillable).toHaveLength(1)
  })

  it('carries the shortfall priority onto the run and sets its SLA', () => {
    const { runs } = planRuns({
      shortfalls: [shortfall({ priority: 'critical' })],
      vendorByKiosk,
      supplyByItem: new Map([['i-1', [{ spotId: 'spot-a', available: 480 }]]]),
    })

    expect(runs[0]?.priority).toBe('critical')
    expect(runs[0]?.slaMinutes).toBe(10)
  })

  it('explains itself in the reason line', () => {
    const { runs } = planRuns({
      shortfalls: [shortfall({ onHand: 12 })],
      vendorByKiosk,
      supplyByItem: new Map([['i-1', [{ spotId: 'spot-a', available: 480 }]]]),
    })

    expect(runs[0]?.reason).toBe('12 on hand against a floor of 96')
  })
})

describe('roundUpToPack', () => {
  it('rounds up to the next whole case', () => {
    expect(roundUpToPack(100, 24)).toBe(120)
  })

  it('leaves an exact multiple alone', () => {
    expect(roundUpToPack(96, 24)).toBe(96)
  })

  it('does nothing for singles', () => {
    expect(roundUpToPack(7, 1)).toBe(7)
  })
})

describe('derivePar', () => {
  it('sets the floor at about an hour of selling', () => {
    const { minQty } = derivePar({
      forecastUnits: 1200,
      tradingHours: 5,
      packSize: 24,
      counterCapacity: 2000,
    })

    // 240/hour, rounded to whole cases.
    expect(minQty).toBe(240)
  })

  it('keeps the ceiling inside what the counter can physically hold', () => {
    const { maxQty } = derivePar({
      forecastUnits: 1200,
      tradingHours: 5,
      packSize: 24,
      counterCapacity: 300,
    })

    expect(maxQty).toBeLessThanOrEqual(480)
  })

  it('always leaves the ceiling above the floor', () => {
    const { minQty, maxQty } = derivePar({
      forecastUnits: 100,
      tradingHours: 1,
      packSize: 24,
      counterCapacity: 24,
    })

    expect(maxQty).toBeGreaterThan(minQty)
  })

  it('does not divide by zero when an event has no trading hours', () => {
    const { minQty } = derivePar({
      forecastUnits: 100,
      tradingHours: 0,
      packSize: 10,
      counterCapacity: 500,
    })

    expect(Number.isFinite(minQty)).toBe(true)
  })
})
