import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  Dl,
  DlRow,
  Empty,
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
import { balanceAt, balanceOf } from '@/domain/ledger'
import { isBreaching } from '@/domain/dispatch'
import { duration, num, time } from '@/lib/format'
import {
  balancesForEvent,
  currentEvent,
  getKioskByCode,
  itemsById,
  listHaulRoutes,
  listKioskAllocations,
  listParLevels,
  listRuns,
  listStorageRooms,
} from '@/queries/read'
import { RaiseRun } from './RaiseRun'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return { title: code }
}

export default async function KioskPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const kiosk = await getKioskByCode(code)
  if (!kiosk) notFound()

  const now = Date.now()
  const event = await currentEvent()

  const [items, pars, routes, rooms] = await Promise.all([
    itemsById(),
    listParLevels(kiosk.id),
    listHaulRoutes(),
    listStorageRooms(),
  ])

  const allocations = event ? await listKioskAllocations(event.id) : []
  const allocation = allocations.find((a) => a.kioskId === kiosk.id)

  const runs = event
    ? (await listRuns(event.id)).filter((r) => r.kioskId === kiosk.id)
    : []

  const balances = event ? await balancesForEvent(event.id) : null
  const onCounter = balances ? balanceAt(balances, { type: 'kiosk', id: kiosk.id }) : new Map()

  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const myRoutes = routes
    .filter((r) => r.kioskId === kiosk.id)
    .sort((a, b) => a.minutes - b.minutes)

  const openRuns = runs.filter(
    (r) => r.status !== 'confirmed' && r.status !== 'cancelled',
  )

  // Par table: what should be here, what is here, and how much cover is left.
  const parRows = pars
    .map((par) => {
      const have = balances
        ? balanceOf(balances, { type: 'kiosk', id: kiosk.id }, par.itemId)
        : 0
      const inbound = openRuns
        .filter((r) => r.itemId === par.itemId)
        .reduce((s, r) => s + (r.qtyDelivered ?? r.qty), 0)
      return {
        par,
        item: items.get(par.itemId),
        have,
        inbound,
        coverage: par.minQty === 0 ? 1 : (have + inbound) / par.minQty,
      }
    })
    .sort((a, b) => a.coverage - b.coverage)

  const below = parRows.filter((r) => r.coverage < 1)

  return (
    <>
      <PageHead
        eyebrow={`${kiosk.levelCode} · ${kiosk.zoneName}`}
        title={kiosk.code}
        sub={kiosk.name}
        actions={
          <>
            <Pill
              tone={
                kiosk.status === 'active'
                  ? 'ok'
                  : kiosk.status === 'maintenance'
                    ? 'warn'
                    : 'neutral'
              }
            >
              {kiosk.status}
            </Pill>
            {allocation ? (
              <Link className="btn" href={`/vendors/${allocation.vendorCode}`}>
                {allocation.vendorName}
              </Link>
            ) : null}
            {event && allocation ? (
              <RaiseRun
                eventId={event.id}
                kioskId={kiosk.id}
                items={[...items.values()]
                  .filter((i) => i.unitPriceCents > 0)
                  .map((i) => ({ id: i.id, name: i.name, packSize: i.packSize }))}
              />
            ) : null}
          </>
        }
      />

      {kiosk.notes ? (
        <div style={{ marginBottom: 14 }}>
          <Note tone={kiosk.status === 'maintenance' ? 'crit' : 'warn'}>{kiosk.notes}</Note>
        </div>
      ) : null}

      <div className="grid grid--4">
        <Stat label="Tills" value={kiosk.tills} />
        <Stat label="Served per hour" value={num(kiosk.throughputPerHour)} note="Fully staffed" />
        <Stat
          label="Lines below par"
          value={below.length}
          tone={below.length > 0 ? 'warn' : 'ok'}
          note={`of ${parRows.length} stocked`}
        />
        <Stat
          label="Open runs"
          value={openRuns.length}
          tone={openRuns.some((r) => isBreaching(r, now)) ? 'crit' : 'neutral'}
        />
      </div>

      <div className="grid grid--main" style={{ marginTop: 14 }}>
        <div className="stack">
          <Panel
            title="Stock on the counter"
            hint={event ? event.name : 'No current event'}
            flush
          >
            {parRows.length === 0 ? (
              <Empty>No par levels set for this counter.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th>Item</th>
                    <th className="num">On hand</th>
                    <th className="num">Inbound</th>
                    <th className="num">Floor</th>
                    <th className="num">Ceiling</th>
                    <th>Cover</th>
                  </>
                }
              >
                {parRows.map(({ par, item, have, inbound, coverage }) => (
                  <tr key={par.id}>
                    <td>
                      {item?.name ?? par.itemId}
                      <div className="tiny muted code">{item?.sku}</div>
                    </td>
                    <td className="num">
                      <strong>{num(have)}</strong>
                      {item && item.packSize > 1 ? (
                        <div className="tiny muted">{(have / item.packSize).toFixed(1)} cases</div>
                      ) : null}
                    </td>
                    <td className="num">{inbound > 0 ? num(inbound) : '—'}</td>
                    <td className="num muted">{num(par.minQty)}</td>
                    <td className="num muted">{num(par.maxQty)}</td>
                    <td style={{ width: 100 }}>
                      <Meter
                        value={Math.min(1, coverage)}
                        tone={coverage < 0.25 ? 'crit' : coverage < 1 ? 'warn' : 'ok'}
                      />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          <Panel title="Runs to this counter" hint={`${runs.length} this event`} flush>
            {runs.length === 0 ? (
              <Empty>No runs raised.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th>Run</th>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Crew</th>
                    <th className="num">Raised</th>
                  </>
                }
              >
                {runs.slice(0, 20).map((run) => (
                  <tr key={run.id}>
                    <td className="code tight">{run.code}</td>
                    <td>{run.itemName}</td>
                    <td className="num">{num(run.qty)}</td>
                    <td className="tight">
                      <PriorityPill priority={run.priority} />
                    </td>
                    <td className="tight">
                      <RunStatusPill status={run.status} />
                    </td>
                    <td className="tiny">{run.crewCallSign ?? '—'}</td>
                    <td className="num tiny muted">{time(run.requestedAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="The counter">
            <Dl>
              <DlRow label="Level">{kiosk.levelCode}</DlRow>
              <DlRow label="Zone">{kiosk.zoneName}</DlRow>
              <DlRow label="Type">{kiosk.kind}</DlRow>
              <DlRow label="Tills">{kiosk.tills}</DlRow>
              <DlRow label="Fit-out">{kiosk.fitout.join(', ') || '—'}</DlRow>
              <DlRow label="Gas">{kiosk.hasGas ? 'Yes' : 'No'}</DlRow>
              <DlRow label="Water">{kiosk.hasWater ? 'Yes' : 'No'}</DlRow>
              <DlRow label="Serves">
                <span className="code tiny">
                  {kiosk.servesBlocks.join(', ') || 'No blocks mapped'}
                </span>
              </DlRow>
            </Dl>
          </Panel>

          <Panel title="Haul routes" hint="From the stores" flush>
            <Table
              head={
                <>
                  <th>From</th>
                  <th className="num">Walk</th>
                  <th>Via</th>
                </>
              }
            >
              {myRoutes.map((route) => (
                <tr key={route.id}>
                  <td>
                    <Link className="rowLink code" href={`/storage/${roomById.get(route.roomId)?.code ?? ''}`}>
                      {roomById.get(route.roomId)?.code ?? route.roomId}
                    </Link>
                    <div className="tiny muted">{roomById.get(route.roomId)?.name}</div>
                  </td>
                  <td className="num">
                    {route.minutes} min
                    <div className="tiny muted">{route.meters} m</div>
                  </td>
                  <td className="tiny muted">{route.via ?? '—'}</td>
                </tr>
              ))}
            </Table>
          </Panel>

          {onCounter.size > 0 ? (
            <Panel title="Everything on hand" hint={`${onCounter.size} lines`} flush>
              <Table
                head={
                  <>
                    <th>Item</th>
                    <th className="num">Units</th>
                  </>
                }
              >
                {[...onCounter]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 15)
                  .map(([itemId, q]) => (
                    <tr key={itemId}>
                      <td className="tiny">{items.get(itemId)?.name ?? itemId}</td>
                      <td className="num">{num(q)}</td>
                    </tr>
                  ))}
              </Table>
            </Panel>
          ) : null}
        </div>
      </div>

      {openRuns.some((r) => isBreaching(r, now)) ? (
        <p className="tiny" style={{ marginTop: 14, color: 'var(--crit)' }}>
          {openRuns.filter((r) => isBreaching(r, now)).length} run(s) to this counter are past
          their window — oldest has been waiting{' '}
          {duration(now - Math.min(...openRuns.map((r) => r.requestedAt)))}.
        </p>
      ) : null}
    </>
  )
}
