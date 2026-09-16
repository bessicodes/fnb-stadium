import Link from 'next/link'

import { Panel, PageHead, Pill, Stat, Table } from '@/components/ui'
import { coverage } from '@/domain/forecast'
import { num } from '@/lib/format'
import { currentEvent, listBlocks, listKiosks, listKioskAllocations } from '@/queries/read'

export const metadata = { title: 'Kiosks' }

export default async function KiosksPage() {
  const [kiosks, blocks, event] = await Promise.all([listKiosks(), listBlocks(), currentEvent()])
  const allocations = event ? await listKioskAllocations(event.id) : []
  const vendorByKiosk = new Map(allocations.map((a) => [a.kioskId, a]))

  const levels = [...new Set(kiosks.map((k) => k.levelCode))]
  const active = kiosks.filter((k) => k.status === 'active')
  const totalTills = active.reduce((s, k) => s + k.tills, 0)
  const totalThroughput = active.reduce((s, k) => s + k.throughputPerHour, 0)

  const underServed = coverage({
    blocks,
    kiosks,
    eventKind: event?.kind ?? 'football',
  }).filter((z) => z.verdict === 'under_served')

  return (
    <>
      <PageHead
        eyebrow="The building"
        title="Kiosks"
        sub="Every counter in the bowl: what it is fitted with, how fast it can serve, and who is trading it for the current event."
      />

      <div className="grid grid--4">
        <Stat label="Counters" value={kiosks.length} note={`${active.length} active`} />
        <Stat label="Tills" value={num(totalTills)} />
        <Stat
          label="Served per hour"
          value={num(totalThroughput)}
          note="All counters, fully staffed"
        />
        <Stat
          label="Under-served zones"
          value={underServed.length}
          tone={underServed.length > 0 ? 'warn' : 'ok'}
          note="Over 550 seats a till"
        />
      </div>

      {levels.map((levelCode) => {
        const rows = kiosks.filter((k) => k.levelCode === levelCode)
        return (
          <div key={levelCode}>
            <div className="sectionTitle">
              {levelCode} · {rows.length} counters
            </div>
            <Panel flush>
              <Table
                head={
                  <>
                    <th>Code</th>
                    <th>Zone</th>
                    <th>Type</th>
                    <th className="num">Tills</th>
                    <th className="num">Per hour</th>
                    <th>Fit-out</th>
                    <th>Serves</th>
                    <th>Trading</th>
                    <th>Status</th>
                  </>
                }
              >
                {rows.map((kiosk) => {
                  const allocation = vendorByKiosk.get(kiosk.id)
                  return (
                    <tr key={kiosk.id}>
                      <td>
                        <Link className="rowLink code" href={`/kiosks/${kiosk.code}`}>
                          {kiosk.code}
                        </Link>
                      </td>
                      <td className="tiny muted">{kiosk.zoneName}</td>
                      <td className="tiny">{kiosk.kind}</td>
                      <td className="num">{kiosk.tills}</td>
                      <td className="num">{num(kiosk.throughputPerHour)}</td>
                      <td className="tiny muted">{kiosk.fitout.join(', ') || '—'}</td>
                      <td className="tiny muted code">
                        {kiosk.servesBlocks.length > 0
                          ? kiosk.servesBlocks.slice(0, 4).join(' ')
                          : '—'}
                      </td>
                      <td className="tiny">
                        {allocation ? (
                          <Link className="rowLink" href={`/vendors/${allocation.vendorCode}`}>
                            {allocation.vendorName}
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="tight">
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
                      </td>
                    </tr>
                  )
                })}
              </Table>
            </Panel>
          </div>
        )
      })}
    </>
  )
}
