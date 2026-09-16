import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  Empty,
  EventStatusPill,
  Note,
  Panel,
  PageHead,
  Pill,
  Stat,
  Table,
} from '@/components/ui'
import { settleEvent, settleVendor } from '@/domain/reconciliation'
import { slaReport } from '@/domain/dispatch'
import type { LedgerMovement } from '@/domain/ledger'
import { money, num, percent } from '@/lib/format'
import {
  getEventByCode,
  itemsById,
  listKioskAllocations,
  listMovements,
  listRuns,
  listVendors,
} from '@/queries/read'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return { title: `Reconciliation · ${code}` }
}

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const event = await getEventByCode(code)
  if (!event) notFound()

  const now = Date.now()
  const [movements, allocations, vendors, items, runs] = await Promise.all([
    listMovements(event.id),
    listKioskAllocations(event.id),
    listVendors(),
    itemsById(),
    listRuns(event.id),
  ])

  const vendorById = new Map(vendors.map((v) => [v.id, v]))

  // Group the ledger and the declarations by vendor, then settle each one.
  const vendorIds = [...new Set(allocations.map((a) => a.vendorId))]

  const settlements = vendorIds
    .map((vendorId) => {
      const vendor = vendorById.get(vendorId)
      if (!vendor) return null

      const mine = movements.filter(
        (m) => m.vendorId === vendorId,
      ) as unknown as LedgerMovement[]

      const declared = allocations
        .filter((a) => a.vendorId === vendorId)
        .reduce((s, a) => s + (a.declaredSalesCents ?? 0), 0)

      return settleVendor({
        vendor,
        movements: mine,
        itemsById: items,
        declaredSalesCents: declared,
      })
    })
    .filter((s): s is ReturnType<typeof settleVendor> => s !== null)
    .filter((s) => s.ledgerSalesCents > 0 || s.declaredSalesCents > 0)

  const settlement = settleEvent({
    eventId: event.id,
    attendance: event.actualAttendance ?? event.expectedAttendance,
    settlements,
  })

  const sla = slaReport(runs, now)
  const flagged = settlements.filter((s) => s.flags.length > 0)

  const notReady = event.status !== 'closed' && event.status !== 'reconciled'

  return (
    <>
      <PageHead
        eyebrow={
          <>
            <Link href={`/events/${event.code}`}>{event.code}</Link> · reconciliation
          </>
        }
        title={event.name}
        sub="Issued less returns less waste is what left the counter. The gap against the till is shrinkage — and the gap between the till and the declaration is a different conversation entirely."
        actions={<EventStatusPill status={event.status} />}
      />

      {notReady ? (
        <div style={{ marginBottom: 14 }}>
          <Note tone="warn">
            This event is still {event.status.replace(/_/g, ' ')}. The figures below are a running
            position, not a settlement — counters have not returned their stock yet.
          </Note>
        </div>
      ) : null}

      {settlements.length === 0 ? (
        <Panel>
          <Empty>Nothing traded at this event yet.</Empty>
        </Panel>
      ) : (
        <>
          <div className="grid grid--4">
            <Stat
              label="Declared turnover"
              value={money(settlement.totalDeclaredCents)}
              note={`${num(settlement.attendance)} in the ground`}
              small
            />
            <Stat
              label="Stadium commission"
              value={money(settlement.totalCommissionCents)}
              tone="accent"
              small
            />
            <Stat
              label="Spend per head"
              value={money(settlement.spendPerHeadCents)}
              note={`forecast ${money(event.spendPerHeadCents)}`}
              small
            />
            <Stat
              label="Variance at retail"
              value={money(settlement.totalVarianceRetailCents)}
              tone={settlement.totalVarianceRetailCents > 0 ? 'crit' : 'ok'}
              note="Stock that left without being rung up"
              small
            />
          </div>

          {flagged.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <Note tone="crit">
                <strong>
                  {flagged.length} vendor{flagged.length === 1 ? '' : 's'} flagged.
                </strong>{' '}
                {flagged
                  .map((f) => `${vendorById.get(f.vendorId)?.tradingName}: ${f.flags.join('; ')}`)
                  .join(' · ')}
              </Note>
            </div>
          ) : null}

          <div className="sectionTitle">Settlement by vendor</div>

          <Panel flush>
            <Table
              head={
                <>
                  <th>Vendor</th>
                  <th className="num">Declared</th>
                  <th className="num">Ledger</th>
                  <th className="num">Cost of goods</th>
                  <th className="num">Rate</th>
                  <th className="num">Commission</th>
                  <th className="num">Net to vendor</th>
                  <th className="num">Shrinkage</th>
                  <th>Flags</th>
                </>
              }
            >
              {settlement.vendors.map((s) => {
                const vendor = vendorById.get(s.vendorId)
                return (
                  <tr key={s.vendorId}>
                    <td>
                      <Link className="rowLink" href={`/vendors/${vendor?.code ?? ''}`}>
                        {vendor?.tradingName ?? s.vendorId}
                      </Link>
                    </td>
                    <td className="num">{money(s.declaredSalesCents)}</td>
                    <td className="num muted">{money(s.ledgerSalesCents)}</td>
                    <td className="num muted">{money(s.costOfGoodsCents)}</td>
                    <td className="num">{(s.commissionBp / 100).toFixed(0)}%</td>
                    <td className="num">{money(s.commissionCents)}</td>
                    <td className="num">{money(s.netToVendorCents)}</td>
                    <td className="num">
                      <span
                        style={s.shrinkagePct > 0.03 ? { color: 'var(--crit)', fontWeight: 650 } : undefined}
                      >
                        {percent(s.shrinkagePct, 1)}
                      </span>
                    </td>
                    <td className="tight">
                      {s.flags.length === 0 ? (
                        <Pill tone="ok">Clean</Pill>
                      ) : (
                        <Pill tone="crit">{s.flags.length}</Pill>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>{money(settlement.totalDeclaredCents)}</strong>
                </td>
                <td className="num muted">
                  {money(settlements.reduce((s, v) => s + v.ledgerSalesCents, 0))}
                </td>
                <td className="num muted">
                  {money(settlements.reduce((s, v) => s + v.costOfGoodsCents, 0))}
                </td>
                <td />
                <td className="num">
                  <strong>{money(settlement.totalCommissionCents)}</strong>
                </td>
                <td className="num">
                  {money(settlements.reduce((s, v) => s + v.netToVendorCents, 0))}
                </td>
                <td className="num">{money(settlement.totalVarianceRetailCents)}</td>
                <td />
              </tr>
            </Table>
          </Panel>

          <div className="sectionTitle">Worst variances, all vendors</div>

          <Panel flush>
            <Table
              head={
                <>
                  <th>Item</th>
                  <th>Vendor</th>
                  <th className="num">Issued</th>
                  <th className="num">Returned</th>
                  <th className="num">Wasted</th>
                  <th className="num">Consumed</th>
                  <th className="num">Sold</th>
                  <th className="num">Variance</th>
                  <th className="num">At retail</th>
                </>
              }
            >
              {settlements
                .flatMap((s) => s.lines.map((line) => ({ line, vendorId: s.vendorId })))
                .filter(({ line }) => line.varianceUnits !== 0)
                .sort((a, b) => b.line.varianceRetailCents - a.line.varianceRetailCents)
                .slice(0, 20)
                .map(({ line, vendorId }) => (
                  <tr key={`${vendorId}-${line.itemId}`}>
                    <td>{items.get(line.itemId)?.name ?? line.itemId}</td>
                    <td className="tiny">
                      <Link className="rowLink" href={`/vendors/${vendorById.get(vendorId)?.code ?? ''}`}>
                        {vendorById.get(vendorId)?.code}
                      </Link>
                    </td>
                    <td className="num">{num(line.issued)}</td>
                    <td className="num">{num(line.returned)}</td>
                    <td className="num">{num(line.wasted)}</td>
                    <td className="num">{num(line.consumed)}</td>
                    <td className="num">{num(line.sold)}</td>
                    <td className="num">
                      <span style={line.varianceUnits > 0 ? { color: 'var(--crit)' } : { color: 'var(--ok)' }}>
                        {line.varianceUnits > 0 ? '−' : '+'}
                        {num(Math.abs(line.varianceUnits))}
                      </span>
                      <div className="tiny muted">{percent(line.variancePct, 1)}</div>
                    </td>
                    <td className="num">{money(line.varianceRetailCents)}</td>
                  </tr>
                ))}
            </Table>
          </Panel>

          {runs.length > 0 ? (
            <>
              <div className="sectionTitle">Dispatch performance</div>
              <div className="grid grid--4">
                <Stat label="Runs" value={runs.length} />
                <Stat
                  label="On time"
                  value={percent(sla.onTimeRate)}
                  tone={sla.onTimeRate > 0.9 ? 'ok' : 'warn'}
                />
                <Stat label="Median" value={`${sla.medianMinutes} min`} />
                <Stat
                  label="Breached"
                  value={sla.breached}
                  tone={sla.breached > 0 ? 'warn' : 'ok'}
                  note={`worst ${sla.worstMinutes} min`}
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  )
}
