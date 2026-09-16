import { Panel, PageHead, Pill, Stat, Table } from '@/components/ui'
import { isActive, isBreaching, slaReport } from '@/domain/dispatch'
import { duration, num, percent } from '@/lib/format'
import { currentEvent, listCrews, listRuns, listZones } from '@/queries/read'

export const metadata = { title: 'Crews' }

export default async function CrewsPage() {
  const now = Date.now()
  const [crews, zones, event] = await Promise.all([listCrews(), listZones(), currentEvent()])
  const runs = event ? await listRuns(event.id) : []

  const zoneById = new Map(zones.map((z) => [z.id, z]))

  const rows = crews.map((crew) => {
    const mine = runs.filter((r) => r.crewId === crew.id)
    const open = mine.filter((r) => isActive(r.status))
    const sla = slaReport(mine, now)

    return {
      crew,
      open,
      done: mine.filter((r) => r.status === 'confirmed').length,
      breaching: open.filter((r) => isBreaching(r, now)).length,
      sla,
      carried: mine
        .filter((r) => r.status === 'confirmed')
        .reduce((s, r) => s + (r.qtyDelivered ?? 0), 0),
    }
  })

  const onShift = crews.filter((c) => c.status !== 'off')

  return (
    <>
      <PageHead
        eyebrow="The building"
        title="Loading crews"
        sub="The teams that move stock from the stores to the counters. A run's whole SLA is spent walking, so a crew's base zone matters more than its size."
      />

      <div className="grid grid--4">
        <Stat label="Crews" value={crews.length} note={`${onShift.length} on shift`} />
        <Stat label="People" value={num(crews.reduce((s, c) => s + c.memberCount, 0))} />
        <Stat label="Trolleys" value={num(crews.reduce((s, c) => s + c.trolleys, 0))} />
        <Stat
          label="Runs in hand"
          value={rows.reduce((s, r) => s + r.open.length, 0)}
          tone={rows.some((r) => r.breaching > 0) ? 'crit' : 'neutral'}
        />
      </div>

      <div className="sectionTitle">On the floor</div>

      <Panel flush>
        <Table
          head={
            <>
              <th>Call sign</th>
              <th>Crew</th>
              <th>Base</th>
              <th className="num">People</th>
              <th className="num">Trolleys</th>
              <th className="num">Open</th>
              <th className="num">Done</th>
              <th className="num">Units carried</th>
              <th className="num">On time</th>
              <th>Status</th>
            </>
          }
        >
          {rows.map(({ crew, open, done, breaching, sla, carried }) => (
            <tr key={crew.id}>
              <td>
                <strong>{crew.callSign}</strong>
                <div className="tiny muted code">{crew.code}</div>
              </td>
              <td className="tiny">{crew.name}</td>
              <td className="tiny muted">
                {crew.baseZoneId ? (zoneById.get(crew.baseZoneId)?.name ?? '—') : '—'}
              </td>
              <td className="num">{crew.memberCount}</td>
              <td className="num">{crew.trolleys}</td>
              <td className="num">
                <span style={breaching > 0 ? { color: 'var(--crit)', fontWeight: 650 } : undefined}>
                  {open.length}
                </span>
                {breaching > 0 ? <div className="tiny" style={{ color: 'var(--crit)' }}>{breaching} late</div> : null}
              </td>
              <td className="num">{done}</td>
              <td className="num">{carried > 0 ? num(carried) : '—'}</td>
              <td className="num">
                {sla.delivered === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <span
                    style={
                      sla.onTimeRate < 0.8 ? { color: 'var(--warn)' } : { color: 'var(--ok)' }
                    }
                  >
                    {percent(sla.onTimeRate)}
                  </span>
                )}
                {sla.delivered > 0 ? (
                  <div className="tiny muted">median {sla.medianMinutes} min</div>
                ) : null}
              </td>
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
          ))}
        </Table>
      </Panel>

      {rows.some((r) => r.open.length > 0) ? (
        <>
          <div className="sectionTitle">What each crew is carrying</div>
          <Panel flush>
            <Table
              head={
                <>
                  <th>Crew</th>
                  <th>Run</th>
                  <th>Counter</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Waiting</th>
                </>
              }
            >
              {rows.flatMap(({ crew, open }) =>
                open.map((run) => (
                  <tr key={run.id}>
                    <td className="tiny">{crew.callSign}</td>
                    <td className="code tight">{run.code}</td>
                    <td className="code">{run.kioskCode}</td>
                    <td className="tiny">{run.itemName}</td>
                    <td className="num">{num(run.qty)}</td>
                    <td className="num">
                      <span
                        style={
                          isBreaching(run, now) ? { color: 'var(--crit)', fontWeight: 650 } : undefined
                        }
                      >
                        {duration(now - run.requestedAt)}
                      </span>
                    </td>
                  </tr>
                )),
              )}
            </Table>
          </Panel>
        </>
      ) : null}
    </>
  )
}
