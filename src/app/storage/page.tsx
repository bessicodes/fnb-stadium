import Link from 'next/link'

import {
  Meter,
  Panel,
  PageHead,
  Pill,
  RoomClassPill,
  Stat,
  Table,
  utilisationTone,
} from '@/components/ui'
import { roomUsage, spotUsage } from '@/domain/storage'
import { num, percent, tempRange } from '@/lib/format'
import {
  currentEvent,
  listStorageAllocations,
  listStorageRooms,
  listStorageSpots,
  listVendors,
} from '@/queries/read'

export const metadata = { title: 'Storage' }

export default async function StoragePage() {
  const [rooms, spots, vendors, event] = await Promise.all([
    listStorageRooms(),
    listStorageSpots(),
    listVendors(),
    currentEvent(),
  ])

  const allocations = event ? await listStorageAllocations(event.id) : []
  const usage = roomUsage(rooms, spots, allocations)
  const spots_ = spotUsage(spots, allocations)
  const vendorById = new Map(vendors.map((v) => [v.id, v]))

  const totalCapacity = usage.reduce((s, r) => s + r.capacityUnits, 0)
  const totalAllocated = usage.reduce((s, r) => s + r.allocatedUnits, 0)
  const deadSpots = spots.filter((s) => s.status === 'out_of_service').length
  const freeSpots = spots_.filter((u) => u.allocatedUnits === 0 && u.spot.status === 'available').length

  const levels = [...new Set(usage.map((u) => u.room.levelCode))]

  return (
    <>
      <PageHead
        eyebrow="The building"
        title="Storage"
        sub="Every room and every addressable bay inside it. Stock is let to a vendor at the bay, not at the room — two vendors sharing a cold room without named bays is how crates go missing."
      />

      <div className="grid grid--4">
        <Stat label="Rooms" value={rooms.length} note={`${num(rooms.reduce((s, r) => s + r.areaSqm, 0))} m² total`} />
        <Stat label="Bays" value={spots.length} note={`${freeSpots} free · ${deadSpots} out of service`} />
        <Stat
          label="Let this event"
          value={percent(totalCapacity === 0 ? 0 : totalAllocated / totalCapacity)}
          note={event ? event.code : 'No current event'}
          tone={utilisationTone(totalCapacity === 0 ? 0 : totalAllocated / totalCapacity)}
        />
        <Stat label="Vendors holding space" value={new Set(allocations.map((a) => a.vendorId)).size} />
      </div>

      {levels.map((levelCode) => (
        <div key={levelCode}>
          <div className="sectionTitle">{levelCode}</div>
          <Panel flush>
            <Table
              head={
                <>
                  <th>Room</th>
                  <th>Class</th>
                  <th>Temp</th>
                  <th className="num">Area</th>
                  <th className="num">Bays</th>
                  <th className="num">Capacity</th>
                  <th>Let</th>
                  <th>Vendors</th>
                  <th>Security</th>
                </>
              }
            >
              {usage
                .filter((u) => u.room.levelCode === levelCode)
                .map((u) => (
                  <tr key={u.room.id}>
                    <td>
                      <Link className="rowLink code" href={`/storage/${u.room.code}`}>
                        {u.room.code}
                      </Link>
                      <div className="tiny muted">{u.room.name}</div>
                    </td>
                    <td className="tight">
                      <RoomClassPill klass={u.room.class} />
                    </td>
                    <td className="tiny muted code">
                      {tempRange(u.room.tempMinC, u.room.tempMaxC) ?? 'Ambient'}
                    </td>
                    <td className="num">{u.room.areaSqm} m²</td>
                    <td className="num">
                      {u.spots - u.freeSpots}/{u.spots}
                    </td>
                    <td className="num">{Math.round(u.capacityUnits)}</td>
                    <td style={{ width: 110 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <Meter value={u.utilisation} tone={utilisationTone(u.utilisation)} />
                        <span className="tiny muted">{percent(u.utilisation)}</span>
                      </div>
                    </td>
                    <td className="tiny muted">
                      {u.vendorIds.length === 0
                        ? '—'
                        : u.vendorIds
                            .map((id) => vendorById.get(id)?.tradingName ?? id)
                            .slice(0, 2)
                            .join(', ')}
                      {u.vendorIds.length > 2 ? ` +${u.vendorIds.length - 2}` : ''}
                    </td>
                    <td className="tight">
                      <Pill tone={u.room.security === 'open' ? 'warn' : 'neutral'}>
                        {u.room.security}
                      </Pill>
                    </td>
                  </tr>
                ))}
            </Table>
          </Panel>
        </div>
      ))}
    </>
  )
}
