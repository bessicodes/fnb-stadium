import { describe, expect, it } from 'vitest'

import {
  balanceAt,
  balanceOf,
  buildBalances,
  flowByItem,
  negativeBalances,
  onHand,
  wouldOverdraw,
  type LedgerMovement,
} from './ledger'

const CASTLE = 'item-castle-lager'
const WATER = 'item-water-500'

/** A delivery of `qty` into a spot — the normal way stock enters the building. */
function delivery(itemId: string, qty: number, spotId: string): LedgerMovement {
  return {
    itemId,
    qty,
    kind: 'delivery',
    fromType: 'supplier',
    fromId: null,
    toType: 'spot',
    toId: spotId,
  }
}

/** A loader's run: spot to counter. */
function issue(itemId: string, qty: number, spotId: string, kioskId: string): LedgerMovement {
  return {
    itemId,
    qty,
    kind: 'issue',
    fromType: 'spot',
    fromId: spotId,
    toType: 'kiosk',
    toId: kioskId,
  }
}

function sale(itemId: string, qty: number, kioskId: string): LedgerMovement {
  return {
    itemId,
    qty,
    kind: 'sale',
    fromType: 'kiosk',
    fromId: kioskId,
    toType: 'sold',
    toId: null,
  }
}

describe('buildBalances', () => {
  it('moves stock from origin to destination', () => {
    const balances = buildBalances([
      delivery(CASTLE, 480, 'spot-a'),
      issue(CASTLE, 120, 'spot-a', 'kiosk-14'),
    ])

    expect(balanceOf(balances, { type: 'spot', id: 'spot-a' }, CASTLE)).toBe(360)
    expect(balanceOf(balances, { type: 'kiosk', id: 'kiosk-14' }, CASTLE)).toBe(120)
  })

  it('nets a return back against the spot it came from', () => {
    const balances = buildBalances([
      delivery(CASTLE, 240, 'spot-a'),
      issue(CASTLE, 240, 'spot-a', 'kiosk-14'),
      {
        itemId: CASTLE,
        qty: 40,
        kind: 'return',
        fromType: 'kiosk',
        fromId: 'kiosk-14',
        toType: 'spot',
        toId: 'spot-a',
      },
    ])

    expect(balanceOf(balances, { type: 'spot', id: 'spot-a' }, CASTLE)).toBe(40)
    expect(balanceOf(balances, { type: 'kiosk', id: 'kiosk-14' }, CASTLE)).toBe(200)
  })

  it('keeps items independent of each other', () => {
    const balances = buildBalances([
      delivery(CASTLE, 240, 'spot-a'),
      delivery(WATER, 600, 'spot-a'),
      issue(WATER, 200, 'spot-a', 'kiosk-14'),
    ])

    expect(balanceOf(balances, { type: 'spot', id: 'spot-a' }, CASTLE)).toBe(240)
    expect(balanceOf(balances, { type: 'spot', id: 'spot-a' }, WATER)).toBe(400)
  })

  it('reports an unknown location as empty rather than throwing', () => {
    const balances = buildBalances([delivery(CASTLE, 10, 'spot-a')])
    expect(balanceOf(balances, { type: 'kiosk', id: 'nowhere' }, CASTLE)).toBe(0)
  })
})

describe('balanceAt', () => {
  it('lists what a location holds and drops items that netted to zero', () => {
    const balances = buildBalances([
      delivery(CASTLE, 100, 'spot-a'),
      delivery(WATER, 100, 'spot-a'),
      issue(WATER, 100, 'spot-a', 'kiosk-14'),
    ])

    const held = balanceAt(balances, { type: 'spot', id: 'spot-a' })
    expect(held.get(CASTLE)).toBe(100)
    expect(held.has(WATER)).toBe(false)
  })
})

describe('onHand', () => {
  it('counts stock in the building and ignores what has been sold', () => {
    const balances = buildBalances([
      delivery(CASTLE, 480, 'spot-a'),
      issue(CASTLE, 200, 'spot-a', 'kiosk-14'),
      sale(CASTLE, 150, 'kiosk-14'),
    ])

    // 480 delivered, 150 rung up: 330 still physically here.
    expect(onHand(balances, CASTLE)).toBe(330)
  })

  it('is unchanged by a transfer between two internal locations', () => {
    const base: LedgerMovement[] = [delivery(CASTLE, 480, 'spot-a')]
    const moved: LedgerMovement[] = [
      ...base,
      {
        itemId: CASTLE,
        qty: 200,
        kind: 'transfer',
        fromType: 'spot',
        fromId: 'spot-a',
        toType: 'spot',
        toId: 'spot-b',
      },
    ]

    expect(onHand(buildBalances(moved), CASTLE)).toBe(onHand(buildBalances(base), CASTLE))
  })
})

describe('negativeBalances', () => {
  it('flags an internal location that has been overdrawn', () => {
    const balances = buildBalances([
      delivery(CASTLE, 100, 'spot-a'),
      issue(CASTLE, 140, 'spot-a', 'kiosk-14'),
    ])

    const faults = negativeBalances(balances)
    expect(faults).toHaveLength(1)
    expect(faults[0]).toMatchObject({ itemId: CASTLE, qty: -40 })
    expect(faults[0]?.location).toMatchObject({ type: 'spot', id: 'spot-a' })
  })

  it('does not flag the supplier, which is drawn down by every delivery', () => {
    const balances = buildBalances([delivery(CASTLE, 480, 'spot-a')])
    expect(negativeBalances(balances)).toEqual([])
  })

  it('sorts the worst overdraft first', () => {
    const balances = buildBalances([
      issue(CASTLE, 10, 'spot-a', 'kiosk-1'),
      issue(WATER, 90, 'spot-b', 'kiosk-1'),
    ])

    expect(negativeBalances(balances).map((f) => f.qty)).toEqual([-90, -10])
  })
})

describe('wouldOverdraw', () => {
  it('catches a pick larger than the spot holds', () => {
    const balances = buildBalances([delivery(CASTLE, 100, 'spot-a')])
    const check = wouldOverdraw(balances, issue(CASTLE, 150, 'spot-a', 'kiosk-14'))

    expect(check).toEqual({ overdraws: true, available: 100, short: 50 })
  })

  it('allows a pick the spot can cover exactly', () => {
    const balances = buildBalances([delivery(CASTLE, 100, 'spot-a')])
    const check = wouldOverdraw(balances, issue(CASTLE, 100, 'spot-a', 'kiosk-14'))

    expect(check).toEqual({ overdraws: false, available: 100, short: 0 })
  })

  it('never blocks a delivery, because the supplier is not ours to count', () => {
    const balances = buildBalances([])
    const check = wouldOverdraw(balances, delivery(CASTLE, 5000, 'spot-a'))

    expect(check.overdraws).toBe(false)
    expect(check.available).toBe(Infinity)
  })
})

describe('flowByItem', () => {
  it('splits an item event into its in, out and sideways parts', () => {
    const flows = flowByItem([
      delivery(CASTLE, 480, 'spot-a'),
      issue(CASTLE, 300, 'spot-a', 'kiosk-14'),
      sale(CASTLE, 250, 'kiosk-14'),
      {
        itemId: CASTLE,
        qty: 12,
        kind: 'waste',
        fromType: 'kiosk',
        fromId: 'kiosk-14',
        toType: 'waste',
        toId: null,
      },
      {
        itemId: CASTLE,
        qty: 38,
        kind: 'return',
        fromType: 'kiosk',
        fromId: 'kiosk-14',
        toType: 'spot',
        toId: 'spot-a',
      },
    ])

    expect(flows.get(CASTLE)).toEqual({
      itemId: CASTLE,
      delivered: 480,
      issued: 300,
      returned: 38,
      sold: 250,
      wasted: 12,
      adjusted: 0,
    })
  })

  it('signs an adjustment by which way the stock went', () => {
    const flows = flowByItem([
      {
        itemId: WATER,
        qty: 24,
        kind: 'adjustment',
        fromType: 'supplier',
        fromId: null,
        toType: 'spot',
        toId: 'spot-a',
      },
      {
        itemId: WATER,
        qty: 6,
        kind: 'adjustment',
        fromType: 'spot',
        fromId: 'spot-a',
        toType: 'waste',
        toId: null,
      },
    ])

    expect(flows.get(WATER)?.adjusted).toBe(18)
  })

  it('leaves totals alone for a transfer', () => {
    const flows = flowByItem([
      {
        itemId: CASTLE,
        qty: 100,
        kind: 'transfer',
        fromType: 'spot',
        fromId: 'spot-a',
        toType: 'spot',
        toId: 'spot-b',
      },
    ])

    expect(flows.get(CASTLE)).toMatchObject({ delivered: 0, issued: 0, sold: 0 })
  })
})
