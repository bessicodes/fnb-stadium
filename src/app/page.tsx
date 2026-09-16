import Link from 'next/link'

import {
  Empty,
  EventStatusPill,
  Meter,
  Note,
  Panel,
  PageHead,
  Pill,
  PriorityPill,
  RunStatusPill,
  SeverityPill,
  Stat,
  Table,
  utilisationTone,
} from '@/components/ui'
import { balanceOf } from '@/domain/ledger'
import { dispatchOrder, isBreaching, isTerminal, slaReport } from '@/domain/dispatch'
import { findShortfalls, inboundByKioskItem } from '@/domain/replenishment'
import { coverage } from '@/domain/forecast'
import { roomUsage } from '@/domain/storage'
import { date, dateTime, duration, num, percent, relative, time } from '@/lib/format'
import {
  accreditationSummary,
  balancesForEvent,
  currentEvent,
  listBlocks,
  listCrews,
  listIncidents,
  listKioskAllocations,
  listKiosks,
  listParLevels,
  listRuns,
  listStorageAllocations,
  listStorageRooms,
  listStorageSpots,
  itemsById,
} from '@/queries/read'

export default async function ControlBoard() {
  const event = await currentEvent()

  if (!event) {
    return (
      <>
        <PageHead title="Control board" />
        <Panel>
          <Empty>
            No events in the calendar. Run <code className="code">npm run db:seed</code> to load a
            season.
          </Empty>
        </Panel>
      </>
    )
  }

  const now = Date.now()
  const live = event.status === 'live'

  const [
    allocations,
    runs,
    crews,
    incidents,
    accreditation,
    kiosks,
    blocks,
    items,
    pars,
    rooms,
    spots,
    storageAllocations,
  ] = await Promise.all([
    listKioskAllocations(event.id),
    listRuns(event.id),
    listCrews(),
    listIncidents(event.id),
    accreditationSummary(event.id),
    listKiosks(),
    listBlocks(),
    itemsById(),
    listParLevels(),
    listStorageRooms(),
    listStorageSpots(),
    listStorageAllocations(event.id),
  ])

  /* ---- dispatch ---- */
  // Includes `delivered` — stock at the counter that nobody has signed for yet
  // is still an open run, and still belongs to the bay it came from.
  const openRuns = runs.filter((r) => !isTerminal(r.status))
  const breaching = openRuns.filter((r) => isBreaching(r, now))
  const queue = dispatchOrder(openRuns, now).slice(0, 8)
  const sla = slaReport(runs, now)

  /* ---- stock shortfalls on the counters actually trading ---- */
  const tradingKioskIds = new Set(allocations.map((a) => a.kioskId))
  const balances = await balancesForEvent(event.id)
  const onHand = new Map<string, number>()
  for (const par of pars) {
    if (!tradingKioskIds.has(par.kioskId)) continue
    onHand.set(
      `${par.kioskId}:${par.itemId}`,
      balanceOf(balances, { type: 'kiosk', id: par.kioskId }, par.itemId),
    )
  }

  const shortfalls = findShortfalls({
    pars: pars.filter((p) => tradingKioskIds.has(p.kioskId)),
    onHand,
    inbound: inboundByKioskItem(runs),
    trading: live,
  }).slice(0, 8)

  const kioskByCode = new Map(kiosks.map((k) => [k.id, k]))

  /* ---- coverage and storage ---- */
  const openZoneIds = new Set(allocations.map((a) => kioskByCode.get(a.kioskId)?.zoneId ?? ''))
  const zoneCoverage = coverage({
    blocks,
    kiosks,
    eventKind: event.kind,
    openZoneIds,
  }).filter((z) => z.verdict !== 'comfortable')

  const storage = roomUsage(rooms, spots, storageAllocations)
    .filter((r) => r.allocatedUnits > 0)
    .sort((a, b) => b.utilisation - a.utilisation)
    .slice(0, 6)

  const openIncidents = incidents.filter((i) => i.resolvedAt === null)
  const crewsOut = crews.filter((c) => c.status === 'on_run').length
  const crewsFree = crews.filter((c) => c.status === 'available').length

  const clock = live
    ? `Kick-off ${relative(event.startsAt, now)} · ${duration(event.endsAt - now)} of trading left`
    : `${dateTime(event.startsAt)} · ${relative(event.startsAt, now)}`

  return (
    <>
      <PageHead
        eyebrow={`${event.code} · ${date(event.startsAt)}`}
        title={event.name}
        sub={clock}
        actions={
          <>
            <EventStatusPill status={event.status} />
            <Link className="btn" href={`/events/${event.code}`}>
              Event detail
            </Link>
            <Link className="btn btn--primary" href="/dispatch">
              Dispatch board
            </Link>
          </>
        }
      />

      <div className="grid grid--4">
        <Stat
          label={live ? 'In the ground' : 'Expected'}
          value={num(event.actualAttendance ?? event.expectedAttendance)}
          note={
            event.actualAttendance
              ? `${percent(event.actualAttendance / 94736)} of capacity`
              : `${percent(event.expectedAttendance / 94736)} of capacity`
          }
        />
        <Stat
          label="Counters trading"
          value={allocations.filter((a) => a.status === 'trading' || a.status === 'confirmed').length}
          note={`of ${kiosks.filter((k) => k.status === 'active').length} active`}
        />
        <Stat
          label="Open load runs"
          value={openRuns.length}
          note={`${crewsOut} crews out · ${crewsFree} free`}
          tone={openRuns.length > 12 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Past SLA"
          value={breaching.length}
          note={breaching.length === 0 ? 'Everything inside its window' : 'Needs a crew now'}
          tone={breaching.length > 0 ? 'crit' : 'ok'}
        />
      </div>

      {breaching.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <Note tone="crit">
            <strong>{breaching.length} runs past their window.</strong>{' '}
            {breaching
              .slice(0, 3)
              .map((r) => `${r.code} → ${r.kioskCode}`)
              .join(', ')}
            {breaching.length > 3 ? `, and ${breaching.length - 3} more` : ''}.
          </Note>
        </div>
      ) : null}

      <div className="grid grid--main" style={{ marginTop: 14 }}>
        <div className="stack">
          <Panel
            title="Dispatch queue"
            hint={`${openRuns.length} open · median ${sla.medianMinutes} min`}
            action={
              <Link className="btn btn--sm" href="/dispatch">
                Open board
              </Link>
            }
            flush
          >
            {queue.length === 0 ? (
              <Empty>Nothing waiting. Every counter is stocked.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th>Run</th>
                    <th>Counter</th>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th className="num">Waiting</th>
                  </>
                }
              >
                {queue.map((run) => {
                  const late = isBreaching(run, now)
                  return (
                    <tr key={run.id}>
                      <td className="code tight">{run.code}</td>
                      <td>
                        <Link className="rowLink" href={`/kiosks/${run.kioskCode}`}>
                          {run.kioskCode}
                        </Link>
                        <div className="tiny muted">{run.zoneName}</div>
                      </td>
                      <td>{run.itemName}</td>
                      <td className="num">{num(run.qty)}</td>
                      <td className="tight">
                        <PriorityPill priority={run.priority} />
                      </td>
                      <td className="tight">
                        <RunStatusPill status={run.status} />
                      </td>
                      <td className="num">
                        <span style={late ? { color: 'var(--crit)', fontWeight: 600 } : undefined}>
                          {duration(now - run.requestedAt)}
                        </span>
                        <div className="tiny muted">of {run.slaMinutes} min</div>
                      </td>
                    </tr>
                  )
                })}
              </Table>
            )}
          </Panel>

          <Panel
            title="Counters below par"
            hint={shortfalls.length === 0 ? undefined : 'Top-ups not yet raised'}
            flush
          >
            {shortfalls.length === 0 ? (
              <Empty>Every counter is at or above its floor.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th>Counter</th>
                    <th>Item</th>
                    <th className="num">On hand</th>
                    <th className="num">Inbound</th>
                    <th className="num">Floor</th>
                    <th>Cover</th>
                    <th>Raise</th>
                  </>
                }
              >
                {shortfalls.map((s) => {
                  const kiosk = kioskByCode.get(s.kioskId)
                  const item = items.get(s.itemId)
                  return (
                    <tr key={`${s.kioskId}-${s.itemId}`}>
                      <td>
                        <Link className="rowLink" href={`/kiosks/${kiosk?.code ?? ''}`}>
                          {kiosk?.code ?? '—'}
                        </Link>
                      </td>
                      <td>{item?.name ?? s.itemId}</td>
                      <td className="num">{num(s.onHand)}</td>
                      <td className="num">{s.inbound > 0 ? num(s.inbound) : '—'}</td>
                      <td className="num muted">{num(s.minQty)}</td>
                      <td style={{ width: 90 }}>
                        <Meter
                          value={s.coverage}
                          tone={s.coverage < 0.25 ? 'crit' : s.coverage < 0.6 ? 'warn' : 'ok'}
                        />
                      </td>
                      <td className="tight">
                        <PriorityPill priority={s.priority} />
                      </td>
                    </tr>
                  )
                })}
              </Table>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Open incidents" hint={`${openIncidents.length} unresolved`} flush>
            {openIncidents.length === 0 ? (
              <Empty>Nothing outstanding.</Empty>
            ) : (
              <div style={{ padding: 4 }}>
                {openIncidents.slice(0, 6).map((incident) => (
                  <div
                    key={incident.id}
                    style={{
                      padding: '9px 10px',
                      borderBottom: '1px solid var(--line)',
                    }}
                  >
                    <div className="rowBetween">
                      <SeverityPill severity={incident.severity} />
                      <span className="tiny muted">{time(incident.at)}</span>
                    </div>
                    <div style={{ marginTop: 5, fontSize: 12.5 }}>{incident.description}</div>
                    <div className="tiny muted" style={{ marginTop: 3 }}>
                      {incident.kioskCode ?? 'Control'} · {incident.reportedBy}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Dispatch performance" flush>
            <div style={{ padding: '12px 14px' }}>
              <div className="rowBetween" style={{ marginBottom: 8 }}>
                <span className="muted tiny">On time</span>
                <strong>{percent(sla.onTimeRate)}</strong>
              </div>
              <Meter
                value={sla.onTimeRate}
                tone={sla.onTimeRate > 0.9 ? 'ok' : sla.onTimeRate > 0.75 ? 'warn' : 'crit'}
              />
              <div
                className="grid grid--3"
                style={{ gap: 10, marginTop: 14, fontSize: 12 }}
              >
                <div>
                  <div className="statLabel">Delivered</div>
                  <strong>{sla.delivered}</strong>
                </div>
                <div>
                  <div className="statLabel">Median</div>
                  <strong>{sla.medianMinutes} min</strong>
                </div>
                <div>
                  <div className="statLabel">Worst</div>
                  <strong>{sla.worstMinutes} min</strong>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Accreditation" flush>
            <div style={{ padding: '12px 14px' }}>
              <div className="rowBetween">
                <span className="muted tiny">On site now</span>
                <strong>
                  {num(accreditation.onSite)} / {num(accreditation.total)}
                </strong>
              </div>
              <div style={{ marginTop: 8 }}>
                <Meter
                  value={accreditation.total === 0 ? 0 : accreditation.onSite / accreditation.total}
                  tone="ok"
                />
              </div>
              <div className="row wrap" style={{ marginTop: 10, gap: 5 }}>
                {[...accreditation.byStatus].map(([status, n]) => (
                  <Pill key={status}>
                    {status.replace(/_/g, ' ')} {n}
                  </Pill>
                ))}
              </div>
            </div>
          </Panel>

          {storage.length > 0 ? (
            <Panel title="Storage in use" flush>
              <Table
                head={
                  <>
                    <th>Room</th>
                    <th className="num">Used</th>
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
                      <div className="tiny muted">{r.room.name}</div>
                    </td>
                    <td className="num">
                      {Math.round(r.allocatedUnits)}/{Math.round(r.capacityUnits)}
                    </td>
                    <td style={{ width: 70 }}>
                      <Meter value={r.utilisation} tone={utilisationTone(r.utilisation)} />
                    </td>
                  </tr>
                ))}
              </Table>
            </Panel>
          ) : null}

          {zoneCoverage.length > 0 ? (
            <Panel title="Counter coverage" hint="Seats per till">
              <div className="stack stack--sm">
                {zoneCoverage.slice(0, 5).map((z) => (
                  <div className="rowBetween" key={z.zoneId}>
                    <span className="tiny">{z.zoneId.replace('zone-', '').toUpperCase()}</span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="code">
                        {Number.isFinite(z.seatsPerTill) ? z.seatsPerTill : '∞'}
                      </span>
                      <Pill tone={z.verdict === 'under_served' ? 'crit' : 'warn'}>
                        {z.verdict === 'under_served' ? 'Under-served' : 'Tight'}
                      </Pill>
                    </span>
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
