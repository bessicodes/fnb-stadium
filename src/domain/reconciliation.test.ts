import { describe, expect, it } from 'vitest'

import type { StockItem } from '@/db/schema'
import type { LedgerMovement } from './ledger'
import {
  commissionCents,
  reconcileItems,
  settleEvent,
  settleVendor,
  vendorScore,
} from './reconciliation'

const BEER = 'i-beer'

/** R11.50 cost, R35.00 board price. */
const items = new Map<string, Pick<StockItem, 'unitCostCents' | 'unitPriceCents'>>([
  [BEER, { unitCostCents: 1150, unitPriceCents: 3500 }],
])

function move(
  kind: LedgerMovement['kind'],
  qty: number,
  over: Partial<LedgerMovement> = {},
): LedgerMovement {
  return {
    itemId: BEER,
    qty,
    kind,
    fromType: 'spot',
    fromId: 'spot-1',
    toType: 'kiosk',
    toId: 'k-1',
    ...over,
  }
}

describe('reconcileItems', () => {
  it('nets returns and waste out of what was issued', () => {
    const [line] = reconcileItems(
      [
        move('issue', 480),
        move('return', 60, { fromType: 'kiosk', fromId: 'k-1', toType: 'spot', toId: 'spot-1' }),
        move('waste', 20, { fromType: 'kiosk', fromId: 'k-1', toType: 'waste', toId: null }),
        move('sale', 400, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      items,
    )

    expect(line).toMatchObject({ issued: 480, returned: 60, wasted: 20, consumed: 400, sold: 400 })
    expect(line?.varianceUnits).toBe(0)
  })

  it('prices the gap between what left the counter and what was rung up', () => {
    const [line] = reconcileItems(
      [
        move('issue', 480),
        move('sale', 440, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      items,
    )

    expect(line?.varianceUnits).toBe(40)
    expect(line?.varianceCostCents).toBe(40 * 1150)
    expect(line?.varianceRetailCents).toBe(40 * 3500)
  })

  it('reports a negative variance when more was sold than issued', () => {
    const [line] = reconcileItems(
      [
        move('issue', 100),
        move('sale', 120, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      items,
    )

    expect(line?.varianceUnits).toBe(-20)
  })

  it('does not divide by zero for an item that never moved', () => {
    const [line] = reconcileItems([move('transfer', 0)], items)
    expect(line?.variancePct).toBe(0)
  })

  it('values an unknown item at zero rather than throwing', () => {
    const [line] = reconcileItems([move('issue', 10, { itemId: 'ghost' })], new Map())
    expect(line?.varianceRetailCents).toBe(0)
  })
})

describe('commissionCents', () => {
  it('takes 15% at 1500 basis points', () => {
    expect(commissionCents(100_000, 1500)).toBe(15_000)
  })

  it('handles a fractional rate exactly', () => {
    expect(commissionCents(100_000, 1250)).toBe(12_500)
  })

  it('rounds to the cent', () => {
    expect(commissionCents(33_333, 1500)).toBe(5000)
  })

  it('is zero on no sales', () => {
    expect(commissionCents(0, 1500)).toBe(0)
  })
})

describe('settleVendor', () => {
  const vendor = { id: 'v-1', commissionBp: 1500 }

  it('charges commission on what was declared', () => {
    const settlement = settleVendor({
      vendor,
      movements: [
        move('issue', 400),
        move('sale', 400, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      itemsById: items,
      declaredSalesCents: 1_400_000,
    })

    expect(settlement.commissionCents).toBe(210_000)
    expect(settlement.netToVendorCents).toBe(1_190_000)
  })

  it('values the ledger independently of the declaration', () => {
    const settlement = settleVendor({
      vendor,
      movements: [
        move('issue', 400),
        move('sale', 400, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      itemsById: items,
      declaredSalesCents: 1_000_000,
    })

    expect(settlement.ledgerSalesCents).toBe(400 * 3500)
  })

  it('costs the goods that left the counter', () => {
    const settlement = settleVendor({
      vendor,
      movements: [
        move('issue', 400),
        move('return', 100, {
          fromType: 'kiosk',
          fromId: 'k-1',
          toType: 'spot',
          toId: 'spot-1',
        }),
        move('sale', 300, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      itemsById: items,
      declaredSalesCents: 1_050_000,
    })

    expect(settlement.costOfGoodsCents).toBe(300 * 1150)
  })

  it('flags shrinkage above the threshold', () => {
    const settlement = settleVendor({
      vendor,
      movements: [
        move('issue', 1000),
        move('sale', 900, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      itemsById: items,
      declaredSalesCents: 900 * 3500,
    })

    // 100 units missing against 900 sold: over 11%.
    expect(settlement.flags.join(' ')).toContain('Shrinkage')
  })

  it('does not flag a clean night', () => {
    const settlement = settleVendor({
      vendor,
      movements: [
        move('issue', 1000),
        move('sale', 1000, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      itemsById: items,
      declaredSalesCents: 1000 * 3500,
    })

    expect(settlement.flags).toEqual([])
  })

  it('flags a declaration well below what the ledger shows', () => {
    const settlement = settleVendor({
      vendor,
      movements: [
        move('issue', 1000),
        move('sale', 1000, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      itemsById: items,
      declaredSalesCents: 1000 * 3500 * 0.8,
    })

    expect(settlement.flags.join(' ')).toContain('below what the ledger shows')
  })

  it('flags stock that moved with nothing declared at all', () => {
    const settlement = settleVendor({
      vendor,
      movements: [
        move('issue', 500),
        move('sale', 500, { fromType: 'kiosk', fromId: 'k-1', toType: 'sold', toId: null }),
      ],
      itemsById: items,
      declaredSalesCents: 0,
    })

    expect(settlement.flags.join(' ')).toContain('No sales declared')
  })

  it('does not divide by zero for a vendor who never traded', () => {
    const settlement = settleVendor({
      vendor,
      movements: [],
      itemsById: items,
      declaredSalesCents: 0,
    })

    expect(settlement.shrinkagePct).toBe(0)
    expect(settlement.flags).toEqual([])
  })
})

describe('settleEvent', () => {
  const settlement = (over: Partial<ReturnType<typeof settleVendor>> = {}) =>
    ({
      vendorId: 'v-1',
      declaredSalesCents: 1_000_000,
      ledgerSalesCents: 1_000_000,
      costOfGoodsCents: 300_000,
      commissionBp: 1500,
      commissionCents: 150_000,
      netToVendorCents: 850_000,
      varianceRetailCents: 0,
      shrinkagePct: 0,
      lines: [],
      flags: [],
      ...over,
    }) as ReturnType<typeof settleVendor>

  it('totals the night across vendors', () => {
    const event = settleEvent({
      eventId: 'ev-1',
      attendance: 80_000,
      settlements: [
        settlement({ vendorId: 'a', declaredSalesCents: 2_000_000, commissionCents: 300_000 }),
        settlement({ vendorId: 'b', declaredSalesCents: 1_000_000, commissionCents: 150_000 }),
      ],
    })

    expect(event.totalDeclaredCents).toBe(3_000_000)
    expect(event.totalCommissionCents).toBe(450_000)
  })

  it('computes spend per head against attendance', () => {
    const event = settleEvent({
      eventId: 'ev-1',
      attendance: 50_000,
      settlements: [settlement({ declaredSalesCents: 200_000_000 })],
    })

    expect(event.spendPerHeadCents).toBe(4000)
  })

  it('ranks the biggest vendor first', () => {
    const event = settleEvent({
      eventId: 'ev-1',
      attendance: 1000,
      settlements: [
        settlement({ vendorId: 'small', declaredSalesCents: 100 }),
        settlement({ vendorId: 'big', declaredSalesCents: 900 }),
      ],
    })

    expect(event.vendors.map((v) => v.vendorId)).toEqual(['big', 'small'])
  })

  it('does not divide by zero when attendance was never captured', () => {
    const event = settleEvent({ eventId: 'ev-1', attendance: 0, settlements: [settlement()] })
    expect(event.spendPerHeadCents).toBe(0)
  })
})

describe('vendorScore', () => {
  const clean = {
    compliant: true,
    expiringDocs: 0,
    shrinkagePct: 0,
    stockOutIncidents: 0,
    slaBreachesCaused: 0,
  }

  it('gives a clean vendor full marks', () => {
    expect(vendorScore(clean)).toMatchObject({ score: 100, band: 'good' })
  })

  it('punishes a lapsed pack harder than anything else', () => {
    const lapsed = vendorScore({ ...clean, compliant: false })
    const shrinking = vendorScore({ ...clean, shrinkagePct: 0.05 })

    expect(lapsed.score).toBeLessThan(shrinking.score)
  })

  it('never falls below zero however bad it gets', () => {
    const score = vendorScore({
      compliant: false,
      expiringDocs: 10,
      shrinkagePct: 0.9,
      stockOutIncidents: 20,
      slaBreachesCaused: 30,
    })

    expect(score.score).toBe(0)
    expect(score.band).toBe('poor')
  })

  it('explains every deduction it made', () => {
    const score = vendorScore({ ...clean, compliant: false, stockOutIncidents: 2 })
    expect(score.notes).toHaveLength(2)
  })

  it('bands a middling vendor as one to watch', () => {
    const score = vendorScore({ ...clean, shrinkagePct: 0.04, stockOutIncidents: 4 })
    expect(score.band).toBe('watch')
  })
})
