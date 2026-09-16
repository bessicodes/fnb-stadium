import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  Dl,
  DlRow,
  Empty,
  Meter,
  Panel,
  PageHead,
  Pill,
  RoomClassPill,
  Stat,
  Table,
  utilisationTone,
} from '@/components/ui'
import { spotUsage } from '@/domain/storage'
import { balanceAt } from '@/domain/ledger'
import { num, percent, tempRange } from '@/lib/format'
import {
  balancesForEvent,
  currentEvent,
  getRoomByCode,
  itemsById,
  listHaulRoutes,
  listKiosks,
  listStorageAllocations,
  listStorageSpots,
  listVendors,
} from '@/queries/read'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const room = await getRoomByCode(code)
  return { title: room?.name ?? 'Storage room' }
}

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const room = await getRoomByCode(code)
  if (!room) notFound()

  const event = await currentEvent()
  const [spots, vendors, items, routes, kiosks] = await Promise.all([
    listStorageSpots(room.id),
    listVendors(),
    itemsById(),
    listHaulRoutes(),
    listKiosks(),
  ])

  const allocations = event ? await listStorageAllocations(event.id) : []
  const mine = allocations.filter((a) => spots.some((s) => s.id === a.spotId))
  const usage = spotUsage(spots, mine)
  const vendorById = new Map(vendors.map((v) => [v.id, v]))

  const balances = event ? await balancesForEvent(event.id) : null

  const capacity = usage.reduce((s, u) => s + u.spot.capacityUnits, 0)
  const allocated = usage.reduce((s, u) => s + u.allocatedUnits, 0)
  const utilisation = capacity === 0 ? 0 : allocated / capacity

  const kioskById = new Map(kiosks.map((k) => [k.id, k]))
  const outbound = routes
    .filter((r) => r.roomId === room.id)
    .sort((a, b) => a.minutes - b.minutes)

  // What is physically in each bay, from the ledger.
  const holdings = balances
    ? spots
        .map((spot) => ({ spot, held: balanceAt(balances, { type: 'spot', id: spot.id }) }))
        .filter((h) => h.held.size > 0)
    : []

  return (
    <>
      <PageHead
        eyebrow={`${room.levelCode} · ${room.zoneName}`}
        title={room.code}
        sub={room.name}
        actions={
          <>
            <RoomClassPill klass={room.class} />
            <Pill tone={room.status === 'active' ? 'ok' : 'warn'}>{room.status}</Pill>
          </>
        }
      />

      <div className="grid grid--4">
        <Stat label="Bays" value={spots.length} note={`${usage.filter((u) => u.allocatedUnits === 0).length} free`} />
        <Stat label="Capacity" value={Math.round(capacity)} note={spots[0]?.unit ?? 'units'} />
        <Stat
          label="Let"
          value={percent(utilisation)}
          tone={utilisationTone(utilisation)}
          note={event?.code ?? 'No current event'}
        />
        <Stat label="Vendors" value={new Set(mine.map((a) => a.vendorId)).size} />
      </div>

      <div className="grid grid--main" style={{ marginTop: 14 }}>
        <div className="stack">
          <Panel
            title="Bay map"
            hint={`${spots.length} bays · ${usage.filter((u) => u.allocatedUnits > 0).length} let`}
          >
            <div className="spotGrid">
              {usage.map((u) => {
                const state =
                  u.spot.status === 'out_of_service'
                    ? 'dead'
                    : u.utilisation >= 1
                      ? 'full'
                      : u.utilisation > 0
                        ? 'part'
                        : 'free'

                const vendor = u.vendorIds[0] ? vendorById.get(u.vendorIds[0]) : null

                return (
                  <div className="spot" data-state={state} key={u.spot.id} title={u.spot.code}>
                    <div className="spotCode">{u.spot.code}</div>
                    <div className="spotMeta">
                      {u.spot.status === 'out_of_service'
                        ? 'Out of service'
                        : u.allocatedUnits > 0
                          ? `${Math.round(u.allocatedUnits)}/${u.spot.capacityUnits} ${u.spot.unit}`
                          : `${u.spot.capacityUnits} ${u.spot.unit} free`}
                    </div>
                    {vendor ? (
                      <div className="spotMeta" style={{ marginTop: 2 }}>
                        {vendor.code}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Panel>

          {mine.length > 0 ? (
            <Panel title="Let to" hint={event?.name} flush>
              <Table
                head={
                  <>
                    <th>Bay</th>
                    <th>Kind</th>
                    <th>Vendor</th>
                    <th className="num">Allocated</th>
                    <th>Fill</th>
                  </>
                }
              >
                {usage
                  .filter((u) => u.allocatedUnits > 0)
                  .map((u) => {
                    const vendor = u.vendorIds[0] ? vendorById.get(u.vendorIds[0]) : null
                    return (
                      <tr key={u.spot.id}>
                        <td className="code">{u.spot.code}</td>
                        <td className="tiny muted">{u.spot.kind.replace(/_/g, ' ')}</td>
                        <td>
                          {vendor ? (
                            <Link className="rowLink" href={`/vendors/${vendor.code}`}>
                              {vendor.tradingName}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num">
                          {Math.round(u.allocatedUnits)} / {u.spot.capacityUnits} {u.spot.unit}
                        </td>
                        <td style={{ width: 90 }}>
                          <Meter value={u.utilisation} tone={utilisationTone(u.utilisation)} />
                        </td>
                      </tr>
                    )
                  })}
              </Table>
            </Panel>
          ) : null}

          {holdings.length > 0 ? (
            <Panel title="What is actually in here" hint="From the stock ledger" flush>
              <Table
                head={
                  <>
                    <th>Bay</th>
                    <th>Item</th>
                    <th className="num">Units</th>
                  </>
                }
              >
                {holdings.flatMap(({ spot, held }) =>
                  [...held]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([itemId, q]) => (
                      <tr key={`${spot.id}-${itemId}`}>
                        <td className="code tiny">{spot.code}</td>
                        <td className="tiny">{items.get(itemId)?.name ?? itemId}</td>
                        <td className="num">
                          <span style={q < 0 ? { color: 'var(--crit)' } : undefined}>{num(q)}</span>
                        </td>
                      </tr>
                    )),
                )}
              </Table>
            </Panel>
          ) : null}
        </div>

        <div className="stack">
          <Panel title="The room">
            <Dl>
              <DlRow label="Level">{room.levelCode}</DlRow>
              <DlRow label="Zone">{room.zoneName}</DlRow>
              <DlRow label="Class">{room.class}</DlRow>
              <DlRow label="Temperature">
                {tempRange(room.tempMinC, room.tempMaxC) ?? 'Ambient'}
              </DlRow>
              <DlRow label="Area">{room.areaSqm} m²</DlRow>
              <DlRow label="Security">{room.security}</DlRow>
              <DlRow label="Keyholder">{room.keyholder ?? '—'}</DlRow>
            </Dl>
          </Panel>

          <Panel title="Quickest counters" hint="From this room" flush>
            {outbound.length === 0 ? (
              <Empty>No routes mapped.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th>Counter</th>
                    <th className="num">Walk</th>
                  </>
                }
              >
                {outbound.slice(0, 12).map((route) => (
                  <tr key={route.id}>
                    <td>
                      <Link
                        className="rowLink code"
                        href={`/kiosks/${kioskById.get(route.kioskId)?.code ?? ''}`}
                      >
                        {kioskById.get(route.kioskId)?.code ?? route.kioskId}
                      </Link>
                      <div className="tiny muted">{route.via}</div>
                    </td>
                    <td className="num">{route.minutes} min</td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}
