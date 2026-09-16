/**
 * Post-event reconciliation.
 *
 * After the final whistle, one question decides whether the night was
 * profitable and whether the vendor is honest:
 *
 *   issued − returned − wasted  =  what left the counter
 *   versus
 *   what the till says was sold
 *
 * The gap is shrinkage. Some of it is honest — a dropped tray, a miscount on
 * load-in. Persistent one-way shrinkage at one counter is theft, and the only
 * way to argue it with a vendor is to show the movements.
 *
 * Money convention: everything is integer cents. No floats touch a rand
 * figure anywhere in this file, because 0.1 + 0.2 is not 0.3 and a vendor
 * invoice that is one cent out is a phone call.
 */
import type { StockItem, Vendor } from '@/db/schema'
import type { LedgerMovement } from './ledger'
import { flowByItem } from './ledger'

export type ItemReconciliation = {
  itemId: string
  issued: number
  returned: number
  wasted: number
  /** issued − returned − wasted: units that left the counter. */
  consumed: number
  /** What the till reported. */
  sold: number
  /** consumed − sold. Positive means stock left without being rung up. */
  varianceUnits: number
  /** Variance valued at cost — what it cost the vendor. */
  varianceCostCents: number
  /** Variance valued at board price — revenue nobody took. */
  varianceRetailCents: number
  /** varianceUnits / consumed, 0 when nothing moved. */
  variancePct: number
}

/** Reconcile one vendor's movements, item by item. */
export function reconcileItems(
  movements: readonly LedgerMovement[],
  itemsById: ReadonlyMap<string, Pick<StockItem, 'unitCostCents' | 'unitPriceCents'>>,
): ItemReconciliation[] {
  const flows = flowByItem(movements)
  const lines: ItemReconciliation[] = []

  for (const flow of flows.values()) {
    const item = itemsById.get(flow.itemId)
    const consumed = flow.issued - flow.returned - flow.wasted
    const varianceUnits = consumed - flow.sold

    lines.push({
      itemId: flow.itemId,
      issued: flow.issued,
      returned: flow.returned,
      wasted: flow.wasted,
      consumed,
      sold: flow.sold,
      varianceUnits,
      varianceCostCents: varianceUnits * (item?.unitCostCents ?? 0),
      varianceRetailCents: varianceUnits * (item?.unitPriceCents ?? 0),
      variancePct: consumed === 0 ? 0 : varianceUnits / consumed,
    })
  }

  return lines.sort((a, b) => b.varianceRetailCents - a.varianceRetailCents)
}

/**
 * The stadium's cut of declared turnover.
 *
 * Rounded half-up at the last step only. Basis points rather than a percentage
 * so a 12.5% rate is exact.
 */
export function commissionCents(declaredSalesCents: number, commissionBp: number): number {
  return Math.round((declaredSalesCents * commissionBp) / 10_000)
}

export type VendorSettlement = {
  vendorId: string
  /** What the vendor's tills reported across every counter they ran. */
  declaredSalesCents: number
  /** What the ledger says they should have sold, at board price. */
  ledgerSalesCents: number
  /** Cost of the stock that left their counters. */
  costOfGoodsCents: number
  commissionBp: number
  commissionCents: number
  /** Declared sales less the stadium's cut. */
  netToVendorCents: number
  /** Total variance across every item, at board price. */
  varianceRetailCents: number
  /** varianceRetailCents / ledgerSalesCents. */
  shrinkagePct: number
  lines: ItemReconciliation[]
  flags: string[]
}

/** A vendor shrinking more than this share of turnover gets flagged. */
export const SHRINKAGE_FLAG_PCT = 0.03

/** A gap this wide between declared and ledger sales is worth a conversation. */
export const DECLARATION_GAP_FLAG_PCT = 0.05

/**
 * Settle one vendor for one event.
 *
 * Commission is charged on *declared* sales, because that is what the contract
 * says — but the ledger figure sits next to it, and the gap between them is
 * the flag. A vendor whose ledger says R180 000 and whose till says R140 000
 * is either losing stock or under-declaring, and either way somebody should
 * walk down there.
 */
export function settleVendor(input: {
  vendor: Pick<Vendor, 'id' | 'commissionBp'>
  movements: readonly LedgerMovement[]
  itemsById: ReadonlyMap<string, Pick<StockItem, 'unitCostCents' | 'unitPriceCents'>>
  declaredSalesCents: number
}): VendorSettlement {
  const { vendor, movements, itemsById, declaredSalesCents } = input

  const lines = reconcileItems(movements, itemsById)
  const flows = flowByItem(movements)

  let ledgerSalesCents = 0
  let costOfGoodsCents = 0
  for (const flow of flows.values()) {
    const item = itemsById.get(flow.itemId)
    if (!item) continue
    ledgerSalesCents += flow.sold * item.unitPriceCents
    const consumed = flow.issued - flow.returned - flow.wasted
    costOfGoodsCents += consumed * item.unitCostCents
  }

  const varianceRetailCents = lines.reduce((s, l) => s + l.varianceRetailCents, 0)
  const commission = commissionCents(declaredSalesCents, vendor.commissionBp)
  const shrinkagePct =
    ledgerSalesCents === 0 ? 0 : varianceRetailCents / ledgerSalesCents

  const flags: string[] = []
  if (shrinkagePct > SHRINKAGE_FLAG_PCT) {
    flags.push(`Shrinkage at ${(shrinkagePct * 100).toFixed(1)}% of turnover`)
  }
  if (declaredSalesCents === 0 && ledgerSalesCents > 0) {
    flags.push('No sales declared against stock that moved')
  } else if (ledgerSalesCents > 0) {
    const gap = (ledgerSalesCents - declaredSalesCents) / ledgerSalesCents
    if (gap > DECLARATION_GAP_FLAG_PCT) {
      flags.push(`Declared ${(gap * 100).toFixed(1)}% below what the ledger shows`)
    }
  }

  return {
    vendorId: vendor.id,
    declaredSalesCents,
    ledgerSalesCents,
    costOfGoodsCents,
    commissionBp: vendor.commissionBp,
    commissionCents: commission,
    netToVendorCents: declaredSalesCents - commission,
    varianceRetailCents,
    shrinkagePct,
    lines,
    flags,
  }
}

export type EventSettlement = {
  eventId: string
  vendors: VendorSettlement[]
  totalDeclaredCents: number
  totalCommissionCents: number
  totalVarianceRetailCents: number
  /** Declared turnover divided by attendance — the headline venue metric. */
  spendPerHeadCents: number
  attendance: number
}

export function settleEvent(input: {
  eventId: string
  attendance: number
  settlements: readonly VendorSettlement[]
}): EventSettlement {
  const { eventId, attendance, settlements } = input

  const totalDeclaredCents = settlements.reduce((s, v) => s + v.declaredSalesCents, 0)

  return {
    eventId,
    vendors: [...settlements].sort((a, b) => b.declaredSalesCents - a.declaredSalesCents),
    totalDeclaredCents,
    totalCommissionCents: settlements.reduce((s, v) => s + v.commissionCents, 0),
    totalVarianceRetailCents: settlements.reduce((s, v) => s + v.varianceRetailCents, 0),
    spendPerHeadCents: attendance === 0 ? 0 : Math.round(totalDeclaredCents / attendance),
    attendance,
  }
}

/**
 * Rate a vendor out of 100 for the scorecard.
 *
 * Deliberately blunt and deliberately weighted towards compliance: a vendor
 * who sells well but trades on a lapsed health certificate is a bigger problem
 * to the venue than one who sells modestly and files on time.
 */
export function vendorScore(input: {
  compliant: boolean
  expiringDocs: number
  shrinkagePct: number
  stockOutIncidents: number
  slaBreachesCaused: number
}): { score: number; band: 'good' | 'watch' | 'poor'; notes: string[] } {
  const { compliant, expiringDocs, shrinkagePct, stockOutIncidents, slaBreachesCaused } = input

  const notes: string[] = []
  let score = 100

  if (!compliant) {
    score -= 40
    notes.push('Compliance pack incomplete or lapsed')
  }
  if (expiringDocs > 0) {
    score -= Math.min(10, expiringDocs * 3)
    notes.push(`${expiringDocs} document${expiringDocs === 1 ? '' : 's'} expiring soon`)
  }
  if (shrinkagePct > 0) {
    const penalty = Math.min(30, Math.round(shrinkagePct * 100 * 4))
    if (penalty > 0) {
      score -= penalty
      notes.push(`Shrinkage at ${(shrinkagePct * 100).toFixed(1)}%`)
    }
  }
  if (stockOutIncidents > 0) {
    score -= Math.min(15, stockOutIncidents * 3)
    notes.push(`${stockOutIncidents} stock-out${stockOutIncidents === 1 ? '' : 's'}`)
  }
  if (slaBreachesCaused > 0) {
    score -= Math.min(10, slaBreachesCaused * 2)
  }

  score = Math.max(0, Math.min(100, score))
  const band = score >= 80 ? 'good' : score >= 55 ? 'watch' : 'poor'

  return { score, band, notes }
}
