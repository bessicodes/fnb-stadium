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
  Stat,
  Table,
} from '@/components/ui'
import {
  dispatchOrder,
  isBreaching,
  isTerminal,
  minutesToDeadline,
  slaReport,
  suggestCrews,
} from '@/domain/dispatch'
import { duration, num, percent, time } from '@/lib/format'
import {
  currentEvent,
  listCrews,
  listHaulRoutes,
  listRuns,
  openRunsByCrew,
} from '@/queries/read'
import { RunActions, SweepButton } from './RunActions'

export const metadata = { title: 'Loader dispatch' }

export default async function DispatchBoard() {
  const event = await currentEvent()
  if (!event) {
    return (
      <>
        <PageHead title="Loader dispatch" />
        <Panel>
          <Empty>No event to dispatch against.</Empty>
        </Panel>
      </>
    )
  }

  const now = Date.now()
  const [runs, crews, routes, openByCrew] = await Promise.all([
    listRuns(event.id),
    listCrews(),
    listHaulRoutes(),
    openRunsByCrew(event.id),
  ])

  // Everything not yet finished, which deliberately includes `delivered`: the
  // stock is at the counter but nobody has signed for it, so it is still the
  // storage bay's stock and still dispatch's problem. Dropping delivered runs
  // off the board would leave no way to confirm them and no ledger posting.
  const open = runs.filter((r) => !isTerminal(r.status))
  const queue = dispatchOrder(open, now)
  const done = runs
    .filter((r) => r.status === 'confirmed' || r.status === 'cancelled')
    .slice(0, 25)

  const breaching = queue.filter((r) => isBreaching(r, now))
  const sla = slaReport(runs, now)

  const onShift = crews.filter((c) => c.status !== 'off')
  const crewOptions = onShift.map((c) => ({
    id: c.id,
    code: c.code,
    callSign: c.callSign,
    status: c.status,
  }))

  return (
    <>
      <PageHead
        eyebrow={`${event.code} · ${event.name}`}
        title="Loader dispatch"
        sub="Every open run, worst first: past its window, then by urgency, then by how long it has waited."
        actions={
          <>
            <EventStatusPill status={event.status} />
            <SweepButton eventId={event.id} />
          </>
        }
      />

      <div className="grid grid--4">
        <Stat label="Open runs" value={open.length} note={`${queue.length - breaching.length} inside window`} />
        <Stat
          label="Past SLA"
          value={breaching.length}
          tone={breaching.length > 0 ? 'crit' : 'ok'}
          note={breaching.length > 0 ? 'Assign a crew now' : 'Nothing overdue'}
        />
        <Stat
          label="Crews on shift"
          value={onShift.length}
          note={`${crews.filter((c) => c.status === 'available').length} free · ${crews.filter((c) => c.status === 'on_run').length} out`}
        />
        <Stat
          label="On time"
          value={percent(sla.onTimeRate)}
          tone={sla.onTimeRate > 0.9 ? 'ok' : sla.onTimeRate > 0.75 ? 'warn' : 'crit'}
          note={`median ${sla.medianMinutes} min · worst ${sla.worstMinutes} min`}
        />
      </div>

      {breaching.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <Note tone="crit">
            <strong>{breaching.length} past their window.</strong> The counter is waiting and, in
            most cases, not selling.
          </Note>
        </div>
      ) : null}

      <div className="sectionTitle">Queue</div>

      <Panel flush>
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
                <th>From</th>
                <th>Crew</th>
                <th>Priority</th>
                <th>Status</th>
                <th className="num">Clock</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </>
            }
          >
            {queue.map((run) => {
              const late = isBreaching(run, now)
              const left = minutesToDeadline(run, now)

              // Only computed for unassigned runs — the rest already have a crew.
              const suggestion =
                run.status === 'requested'
                  ? suggestCrews({
                      crews: onShift,
                      routes,
                      openRunsByCrew: openByCrew,
                      kioskId: run.kioskId,
                    })[0]
                  : undefined

              return (
                <tr key={run.id}>
                  <td className="code tight">{run.code}</td>
                  <td>
                    <Link className="rowLink" href={`/kiosks/${run.kioskCode}`}>
                      {run.kioskCode}
                    </Link>
                    <div className="tiny muted">{run.zoneName}</div>
                  </td>
                  <td>
                    {run.itemName}
                    {run.note ? <div className="tiny muted">{run.note}</div> : null}
                  </td>
                  <td className="num">
                    {num(run.qty)}
                    {run.packSize > 1 ? (
                      <div className="tiny muted">{(run.qty / run.packSize).toFixed(0)} cases</div>
                    ) : null}
                  </td>
                  <td className="code tiny">{run.spotCode ?? '—'}</td>
                  <td className="tight">
                    {run.crewCallSign ? (
                      <Pill tone="info">{run.crewCallSign}</Pill>
                    ) : suggestion ? (
                      <span className="tiny muted">
                        suggest {suggestion.crew.callSign}
                        <div>{suggestion.reason}</div>
                      </span>
                    ) : (
                      <span className="tiny muted">—</span>
                    )}
                  </td>
                  <td className="tight">
                    <PriorityPill priority={run.priority} />
                  </td>
                  <td className="tight">
                    <RunStatusPill status={run.status} />
                  </td>
                  <td className="num">
                    <span style={late ? { color: 'var(--crit)', fontWeight: 650 } : undefined}>
                      {late ? `+${Math.abs(left)} min` : `${left} min`}
                    </span>
                    <div className="tiny muted">
                      {late ? 'over' : 'left'} · {duration(now - run.requestedAt)} old
                    </div>
                  </td>
                  <td className="tight">
                    <RunActions
                      runId={run.id}
                      status={run.status}
                      crews={crewOptions}
                      suggestedCrewId={suggestion?.crew.id ?? null}
                    />
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
      </Panel>

      <div className="grid grid--main" style={{ marginTop: 18 }}>
        <Panel title="Completed" hint={`${done.length} most recent`} flush>
          {done.length === 0 ? (
            <Empty>Nothing finished yet.</Empty>
          ) : (
            <Table
              head={
                <>
                  <th>Run</th>
                  <th>Counter</th>
                  <th>Item</th>
                  <th className="num">Asked</th>
                  <th className="num">Sent</th>
                  <th>Crew</th>
                  <th>Status</th>
                  <th className="num">Took</th>
                </>
              }
            >
              {done.map((run) => {
                const took =
                  run.deliveredAt !== null
                    ? Math.round((run.deliveredAt - run.requestedAt) / 60_000)
                    : null
                const missed = isBreaching(run, now)

                return (
                  <tr key={run.id}>
                    <td className="code tight">{run.code}</td>
                    <td className="code">{run.kioskCode}</td>
                    <td>{run.itemName}</td>
                    <td className="num">{num(run.qty)}</td>
                    <td className="num">
                      {run.qtyDelivered === null ? (
                        '—'
                      ) : (
                        <span
                          style={
                            run.qtyDelivered < run.qty ? { color: 'var(--warn)' } : undefined
                          }
                        >
                          {num(run.qtyDelivered)}
                        </span>
                      )}
                    </td>
                    <td className="tiny">{run.crewCallSign ?? '—'}</td>
                    <td className="tight">
                      <RunStatusPill status={run.status} />
                    </td>
                    <td className="num">
                      {took === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <span style={missed ? { color: 'var(--crit)' } : undefined}>
                          {took} min
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </Table>
          )}
        </Panel>

        <Panel title="Crews" hint={`${onShift.length} on shift`} flush>
          <Table
            head={
              <>
                <th>Crew</th>
                <th className="num">Open</th>
                <th>Status</th>
              </>
            }
          >
            {crews.map((crew) => {
              const load = openByCrew.get(crew.id) ?? 0
              return (
                <tr key={crew.id}>
                  <td>
                    <strong>{crew.callSign}</strong>
                    <div className="tiny muted">
                      {crew.code} · {crew.memberCount} people · {crew.trolleys} trolleys
                    </div>
                  </td>
                  <td className="num">{load}</td>
                  <td className="tight">
                    <Pill
                      tone={
                        crew.status === 'available'
                          ? 'ok'
                          : crew.status === 'on_run'
                            ? 'accent'
                            : crew.status === 'break'
                              ? 'warn'
                              : 'neutral'
                      }
                    >
                      {crew.status.replace(/_/g, ' ')}
                    </Pill>
                  </td>
                </tr>
              )
            })}
          </Table>
        </Panel>
      </div>

      <p className="tiny muted" style={{ marginTop: 16 }}>
        Board as at {time(now)}. Signing for a run is what posts it to the stock ledger — stock in
        transit still belongs to the storage bay.
      </p>
    </>
  )
}
