import Link from 'next/link'

import { EventStatusPill, Panel, PageHead, Stat, Table } from '@/components/ui'
import { forecastEvent, PURCHASE_RATE } from '@/domain/forecast'
import type { StockCategory } from '@/db/schema'
import { date, money, num, relative, time } from '@/lib/format'
import { listEvents, listStockItems } from '@/queries/read'

export const metadata = { title: 'Events' }

export default async function EventsPage() {
  const now = Date.now()
  const [events, items] = await Promise.all([listEvents(), listStockItems()])

  // Blended board price per category, for the revenue forecast.
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

  const upcoming = events.filter((e) => e.endsAt >= now)
  const past = events.filter((e) => e.endsAt < now).reverse()

  const rows = (list: typeof events) =>
    list.map((event) => {
      const forecast = forecastEvent(event, prices)
      return (
        <tr key={event.id}>
          <td>
            <Link className="rowLink" href={`/events/${event.code}`}>
              {event.name}
            </Link>
            <div className="tiny muted code">{event.code}</div>
          </td>
          <td className="tiny">{event.kind}</td>
          <td>
            {date(event.startsAt)}
            <div className="tiny muted">
              {time(event.doorsAt)} doors · {time(event.startsAt)} start
            </div>
          </td>
          <td className="num">
            {num(event.actualAttendance ?? event.expectedAttendance)}
            {event.actualAttendance ? <div className="tiny muted">actual</div> : null}
          </td>
          <td className="num">{money(forecast.totalRevenueCents)}</td>
          <td className="tight">
            <EventStatusPill status={event.status} />
          </td>
          <td className="tiny muted">{relative(event.startsAt, now)}</td>
        </tr>
      )
    })

  const head = (
    <>
      <th>Event</th>
      <th>Type</th>
      <th>When</th>
      <th className="num">Attendance</th>
      <th className="num">F&amp;B forecast</th>
      <th>Status</th>
      <th>&nbsp;</th>
    </>
  )

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Events"
        sub="Every fixture in the calendar, its stage in the operational ladder, and what the crowd is forecast to spend behind the counters."
      />

      <div className="grid grid--4">
        <Stat label="In the calendar" value={events.length} />
        <Stat label="Upcoming" value={upcoming.length} />
        <Stat
          label="Live now"
          value={events.filter((e) => e.status === 'live').length}
          tone={events.some((e) => e.status === 'live') ? 'crit' : 'neutral'}
        />
        <Stat
          label="Awaiting reconciliation"
          value={events.filter((e) => e.status === 'closed').length}
          tone={events.some((e) => e.status === 'closed') ? 'warn' : 'ok'}
        />
      </div>

      <div className="sectionTitle">Upcoming and live</div>
      <Panel flush>
        <Table head={head}>{rows(upcoming)}</Table>
      </Panel>

      {past.length > 0 ? (
        <>
          <div className="sectionTitle">Past</div>
          <Panel flush>
            <Table head={head}>{rows(past)}</Table>
          </Panel>
        </>
      ) : null}

      <p className="tiny muted" style={{ marginTop: 14 }}>
        Forecast assumes {Math.round(PURCHASE_RATE.football * 100)}% of a football crowd buys
        something, and the category mix for the event type. Replace the mix with measured figures
        from reconciliation once a few events have run.
      </p>
    </>
  )
}
