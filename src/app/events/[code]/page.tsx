import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  Dl,
  DlRow,
  Empty,
  EventStatusPill,
  Meter,
  Note,
  Panel,
  PageHead,
  Pill,
  Stat,
  Table,
  utilisationTone,
} from '@/components/ui'
import { coverage, forecastEvent, splitAcrossKiosks, tradingHours } from '@/domain/forecast'
import { roomUsage } from '@/domain/storage'
import { slaReport } from '@/domain/dispatch'
import { vendorStanding } from '@/domain/compliance'
import type { StockCategory } from '@/db/schema'
import { date, dateTime, duration, money, num, percent, time } from '@/lib/format'
import {
  accreditationSummary,
  documentsByVendor,
  getEventByCode,
  listBlocks,
  listIncidents,
  listKioskAllocations,
  listKiosks,
  listRuns,
  listStockItems,
  listStorageAllocations,
  listStorageRooms,
  listStorageSpots,
  listVendors,
} from '@/queries/read'
import { EventStatusControl } from './EventStatusControl'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const event = await getEventByCode(code)
  return { title: event?.name ?? 'Event' }
}

export default async function EventPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const event = await getEventByCode(code)
  if (!event) notFound()

  const now = Date.now()

  const [
    allocations,
    kiosks,
    blocks,
    vendors,
    docsByVendor,
    items,
    rooms,
    spots,
    storageAllocations,
    runs,
    incidents,
    accreditation,
  ] = await Promise.all([
    listKioskAllocations(event.id),
    listKiosks(),
    listBlocks(),
    listVendors(),
    documentsByVendor(),
    listStockItems(),
    listStorageRooms(),
    listStorageSpots(),
    listStorageAllocations(event.id),
    listRuns(event.id),
    listIncidents(event.id),
    accreditationSummary(event.id),
  ])

  /* ---- forecast ---- */
  const prices = new Map<StockCategory, number>()
  const sums = new Map<StockCategory, { total: number; n: number }>()
  for (const item of items) {
    if (item.unitPriceCents <= 0) continue
    const s = sums.get(item.category) ?? { total: 0, n: 0 }
    s.total += item.unitPriceCents
    s.n += 1
    sums.set(item.category, s)
  }
  for (const [category, s] of sums) prices.set(category, Math.round(s.total / s.n))

  const forecast = forecastEvent(event, prices)
  const hours = tradingHours(event)

  /* ---- allocation state ---- */
  const allocatedKioskIds = new Set(allocations.map((a) => a.kioskId))
  const activeKiosks = kiosks.filter((k) => k.status === 'active')
  const unallocated = activeKiosks.filter((k) => !allocatedKioskIds.has(k.id))

  const openZoneIds = new Set(
    allocations.map((a) => kiosks.find((k) => k.id === a.kioskId)?.zoneId ?? ''),
  )
  const zoneCoverage = coverage({ blocks, kiosks, eventKind: event.kind, openZoneIds })

  const byVendor = new Map<string, number>()
  for (const a of allocations) byVendor.set(a.vendorId, (byVendor.get(a.vendorId) ?? 0) + 1)

  const blockedVendors = vendors.filter(
    (v) => !vendorStanding(v, docsByVendor.get(v.id) ?? [], event.startsAt).tradeable,
  )

  const storage = roomUsage(rooms, spots, storageAllocations).filter((r) => r.spots > 0)
  const sla = slaReport(runs, now)

  /* ---- by level, for the allocation board ---- */
  const levels = [...new Set(allocations.map((a) => a.levelCode))]

  return (
    <>
      <PageHead
        eyebrow={`${event.code} · ${event.kind}`}
        title={event.name}
        sub={`${dateTime(event.startsAt)} · doors ${time(event.doorsAt)} · ${hours.toFixed(1)} trading hours`}
        actions={
          <>
            <EventStatusPill status={event.status} />
            {event.status === 'closed' || event.status === 'reconciled' ? (
              <Link className="btn btn--primary" href={`/events/${event.code}/reconciliation`}>
                Reconciliation
              </Link>
            ) : null}
            <EventStatusControl eventId={event.id} status={event.status} />
          </>
        }
      />

      {event.notes ? (
        <div style={{ marginBottom: 14 }}>
          <Note>{event.notes}</Note>
        </div>
      ) : null}

      <div className="grid grid--4">
        <Stat
          label={event.actualAttendance ? 'Attendance' : 'Expected'}
          value={num(event.actualAttendance ?? event.expectedAttendance)}
          note={`${percent((event.actualAttendance ?? event.expectedAttendance) / 94736)} of capacity`}
        />
        <Stat
          label="Counters allocated"
          value={allocations.length}
          note={`${unallocated.length} still open`}
          tone={unallocated.length > 0 && event.status !== 'planned' ? 'warn' : 'neutral'}
        />
        <Stat label="F&B forecast" value={money(forecast.totalRevenueCents)} note={`${money(event.spendPerHeadCents)} per buyer`} small />
        <Stat
          label="Accredited"
          value={num(accreditation.total)}
          note={accreditation.onSite > 0 ? `${num(accreditation.onSite)} on site` : 'None on site'}
        />
      </div>

      <div className="grid grid--main" style={{ marginTop: 14 }}>
        <div className="stack">
          <Panel
            title="Allocation board"
            hint={`${allocations.length} counters · ${byVendor.size} vendors`}
            flush
          >
            {allocations.length === 0 ? (
              <Empty>No counters allocated yet.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th>Counter</th>
                    <th>Zone</th>
                    <th>Type</th>
                    <th>Vendor</th>
                    <th className="num">Staff</th>
                    <th className="num">Float</th>
                    <th>Status</th>
                  </>
                }
              >
                {levels.flatMap((levelCode) => {
                  const rows = allocations.filter((a) => a.levelCode === levelCode)
                  return [
                    <tr key={`lvl-${levelCode}`}>
                      <td colSpan={7} style={{ background: 'var(--panel-2)' }}>
                        <span className="statLabel">{levelCode}</span>
                        <span className="tiny muted"> · {rows.length} counters</span>
                      </td>
                    </tr>,
                    ...rows.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link className="rowLink" href={`/kiosks/${a.kioskCode}`}>
                            {a.kioskCode}
                          </Link>
                        </td>
                        <td className="tiny muted">{a.zoneName}</td>
                        <td className="tiny">{a.kioskKind}</td>
                        <td>
                          <Link className="rowLink" href={`/vendors/${a.vendorCode}`}>
                            {a.vendorName}
                          </Link>
                        </td>
                        <td className="num">{a.staffPlanned}</td>
                        <td className="num">{money(a.floatCents)}</td>
                        <td className="tight">
                          <Pill
                            tone={
                              a.status === 'trading'
                                ? 'accent'
                                : a.status === 'confirmed'
                                  ? 'ok'
                                  : a.status === 'closed'
                                    ? 'neutral'
                                    : 'info'
                            }
                          >
                            {a.status}
                          </Pill>
                        </td>
                      </tr>
                    )),
                  ]
                })}
              </Table>
            )}
          </Panel>

          <Panel title="Stock forecast" hint="What the crowd is expected to get through" flush>
            <Table
              head={
                <>
                  <th>Category</th>
                  <th className="num">Revenue</th>
                  <th className="num">Units</th>
                  <th className="num">Per hour</th>
                  <th>Share</th>
                </>
              }
            >
              {forecast.byCategory.map((row) => (
                <tr key={row.category}>
                  <td>{row.category.replace(/_/g, ' ')}</td>
                  <td className="num">{money(row.revenueCents)}</td>
                  <td className="num">{num(row.units)}</td>
                  <td className="num">{num(row.units / hours)}</td>
                  <td style={{ width: 110 }}>
                    <Meter value={row.revenueCents / forecast.totalRevenueCents} tone="accent" />
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel title="Counter coverage" hint="Seats per till, by zone" flush>
            <Table
              head={
                <>
                  <th>Zone</th>
                  <th className="num">Seats</th>
                  <th className="num">Counters</th>
                  <th className="num">Tills</th>
                  <th className="num">Seats/till</th>
                  <th className="num">Serve all</th>
                  <th>Verdict</th>
                </>
              }
            >
              {zoneCoverage.map((z) => (
                <tr key={z.zoneId}>
                  <td className="code tiny">{z.zoneId.replace('zone-', '').toUpperCase()}</td>
                  <td className="num">{num(z.seats)}</td>
                  <td className="num">{z.kiosks}</td>
                  <td className="num">{z.tills}</td>
                  <td className="num">
                    {Number.isFinite(z.seatsPerTill) ? num(z.seatsPerTill) : '∞'}
                  </td>
                  <td className="num">
                    {Number.isFinite(z.minutesToServeAll) ? `${z.minutesToServeAll} min` : '—'}
                  </td>
                  <td className="tight">
                    <Pill
                      tone={
                        z.verdict === 'comfortable'
                          ? 'ok'
                          : z.verdict === 'tight'
                            ? 'warn'
                            : 'crit'
                      }
                    >
                      {z.verdict.replace(/_/g, '-')}
                    </Pill>
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Schedule">
            <Dl>
              <DlRow label="Doors">{time(event.doorsAt)}</DlRow>
              <DlRow label="Start">{time(event.startsAt)}</DlRow>
              <DlRow label="Ends">{time(event.endsAt)}</DlRow>
              <DlRow label="Date">{date(event.startsAt)}</DlRow>
              <DlRow label="Trading">{duration(event.endsAt - event.doorsAt)}</DlRow>
              <DlRow label="Spend/head">{money(event.spendPerHeadCents)}</DlRow>
            </Dl>
          </Panel>

          <Panel title="Vendors on site" hint={`${byVendor.size}`} flush>
            <Table
              head={
                <>
                  <th>Vendor</th>
                  <th className="num">Counters</th>
                </>
              }
            >
              {[...byVendor]
                .sort((a, b) => b[1] - a[1])
                .map(([vendorId, count]) => {
                  const vendor = vendors.find((v) => v.id === vendorId)
                  return (
                    <tr key={vendorId}>
                      <td>
                        <Link className="rowLink" href={`/vendors/${vendor?.code ?? ''}`}>
                          {vendor?.tradingName ?? vendorId}
                        </Link>
                      </td>
                      <td className="num">{count}</td>
                    </tr>
                  )
                })}
            </Table>
          </Panel>

          {blockedVendors.length > 0 ? (
            <Panel title="Blocked from allocation" hint="As at kick-off">
              <div className="stack stack--sm">
                {blockedVendors.map((v) => (
                  <div className="rowBetween" key={v.id}>
                    <Link className="rowLink tiny" href={`/vendors/${v.code}`}>
                      {v.tradingName}
                    </Link>
                    <Pill tone="crit">{v.status === 'approved' ? 'Documents' : v.status}</Pill>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {storage.length > 0 ? (
            <Panel title="Storage let" flush>
              <Table
                head={
                  <>
                    <th>Room</th>
                    <th className="num">Bays</th>
                    <th>Fill</th>
                  </>
                }
              >
                {storage.map((r) => (
                  <tr key={r.room.id}>
                    <td>
                      <Link className="rowLink" href={`/storage/${r.room.code}`}>
                        {r.room.code}
                      </Link>
                    </td>
                    <td className="num">
                      {r.spots - r.freeSpots}/{r.spots}
                    </td>
                    <td style={{ width: 70 }}>
                      <Meter value={r.utilisation} tone={utilisationTone(r.utilisation)} />
                    </td>
                  </tr>
                ))}
              </Table>
            </Panel>
          ) : null}

          {runs.length > 0 ? (
            <Panel title="Dispatch">
              <Dl>
                <DlRow label="Runs">{runs.length}</DlRow>
                <DlRow label="Delivered">{sla.delivered}</DlRow>
                <DlRow label="On time">{percent(sla.onTimeRate)}</DlRow>
                <DlRow label="Median">{sla.medianMinutes} min</DlRow>
                <DlRow label="Worst">{sla.worstMinutes} min</DlRow>
                <DlRow label="Cancelled">{sla.cancelled}</DlRow>
              </Dl>
            </Panel>
          ) : null}

          {incidents.length > 0 ? (
            <Panel title="Incidents" hint={`${incidents.filter((i) => !i.resolvedAt).length} open`}>
              <div className="stack stack--sm">
                {incidents.slice(0, 6).map((i) => (
                  <div key={i.id} className="tiny">
                    <span className="muted">{time(i.at)}</span> · {i.description}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  )
}
