import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'ok' | 'warn' | 'crit' | 'info' | 'accent'

/* ------------------------------------------------------------------ *
 * Page furniture
 * ------------------------------------------------------------------ */

export function PageHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="pageHead">
      <div>
        {eyebrow ? <div className="pageEyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {sub ? <div className="pageSub">{sub}</div> : null}
      </div>
      {actions ? <div className="pageActions">{actions}</div> : null}
    </header>
  )
}

export function Panel({
  title,
  hint,
  action,
  flush,
  children,
}: {
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  flush?: boolean
  children: ReactNode
}) {
  return (
    <section className="panel">
      {title ? (
        <div className="panelHead">
          <div className="row">
            <span className="panelTitle">{title}</span>
            {hint ? <span className="panelHint">{hint}</span> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={flush ? 'panelBody panelBody--flush' : 'panelBody'}>{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  note,
  tone,
  small,
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: Tone
  small?: boolean
}) {
  return (
    <div className="panel stat">
      <div className="statLabel">{label}</div>
      <div
        className={small ? 'statValue statValue--sm' : 'statValue'}
        data-tone={tone && tone !== 'neutral' ? tone : undefined}
      >
        {value}
      </div>
      {note ? <div className="statNote">{note}</div> : null}
    </div>
  )
}

export function Pill({
  tone = 'neutral',
  dot,
  pulse,
  children,
}: {
  tone?: Tone
  dot?: boolean
  pulse?: boolean
  children: ReactNode
}) {
  return (
    <span className="pill" data-tone={tone}>
      {dot ? <span className={pulse ? 'dot livePulse' : 'dot'} /> : null}
      {children}
    </span>
  )
}

export function Meter({ value, tone }: { value: number; tone?: Tone }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div
      className="meter"
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="meterFill"
        data-tone={tone && tone !== 'neutral' ? tone : undefined}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Note({ tone, children }: { tone?: 'crit' | 'warn'; children: ReactNode }) {
  return (
    <div className="note" data-tone={tone}>
      {children}
    </div>
  )
}

export function Dl({ children }: { children: ReactNode }) {
  return <dl className="dl">{children}</dl>
}

export function DlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

export function Table({
  head,
  children,
}: {
  head: ReactNode
  children: ReactNode
}) {
  return (
    <div className="tableWrap">
      <table className="t">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Domain-flavoured badges
 *
 * One place that decides what colour a status is, so the same word never
 * means two different things on two different screens.
 * ------------------------------------------------------------------ */

const EVENT_TONES: Record<string, Tone> = {
  planned: 'neutral',
  accreditation: 'info',
  load_in: 'accent',
  live: 'crit',
  closed: 'warn',
  reconciled: 'ok',
}

export function EventStatusPill({ status }: { status: string }) {
  const live = status === 'live'
  return (
    <Pill tone={EVENT_TONES[status] ?? 'neutral'} dot={live} pulse={live}>
      {live ? 'Live' : titleise(status)}
    </Pill>
  )
}

const RUN_TONES: Record<string, Tone> = {
  requested: 'warn',
  assigned: 'info',
  picking: 'info',
  in_transit: 'accent',
  delivered: 'ok',
  confirmed: 'neutral',
  cancelled: 'neutral',
}

export function RunStatusPill({ status }: { status: string }) {
  return <Pill tone={RUN_TONES[status] ?? 'neutral'}>{titleise(status)}</Pill>
}

const PRIORITY_TONES: Record<string, Tone> = {
  routine: 'neutral',
  urgent: 'warn',
  critical: 'crit',
}

export function PriorityPill({ priority }: { priority: string }) {
  return <Pill tone={PRIORITY_TONES[priority] ?? 'neutral'}>{titleise(priority)}</Pill>
}

const VENDOR_TONES: Record<string, Tone> = {
  approved: 'ok',
  prospect: 'info',
  suspended: 'warn',
  blacklisted: 'crit',
}

export function VendorStatusPill({ status }: { status: string }) {
  return <Pill tone={VENDOR_TONES[status] ?? 'neutral'}>{titleise(status)}</Pill>
}

const SEVERITY_TONES: Record<string, Tone> = {
  low: 'neutral',
  medium: 'warn',
  high: 'crit',
  critical: 'crit',
}

export function SeverityPill({ severity }: { severity: string }) {
  return <Pill tone={SEVERITY_TONES[severity] ?? 'neutral'}>{titleise(severity)}</Pill>
}

const ROOM_TONES: Record<string, Tone> = {
  chilled: 'info',
  frozen: 'info',
  dry: 'neutral',
  beverage: 'accent',
  gas: 'crit',
  merchandise: 'neutral',
  waste: 'neutral',
}

export function RoomClassPill({ klass }: { klass: string }) {
  return <Pill tone={ROOM_TONES[klass] ?? 'neutral'}>{titleise(klass)}</Pill>
}

export function titleise(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Utilisation tone: comfortable, filling, full. */
export function utilisationTone(fraction: number): Tone {
  if (fraction >= 1) return 'crit'
  if (fraction >= 0.85) return 'warn'
  return 'ok'
}
