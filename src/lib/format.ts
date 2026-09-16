/** Display helpers. Everything user-facing is South African: ZAR, 24-hour, SAST. */

const ZAR = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

const ZAR_EXACT = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  minimumFractionDigits: 2,
})

const NUM = new Intl.NumberFormat('en-ZA')

/** Cents to rand, no decimals — the right resolution for a turnover figure. */
export function money(cents: number): string {
  return ZAR.format(cents / 100)
}

/** Cents to rand with cents — for anything that has to reconcile. */
export function moneyExact(cents: number): string {
  return ZAR_EXACT.format(cents / 100)
}

/** Thousands separators. */
export function num(n: number): string {
  return NUM.format(Math.round(n))
}

/** A quantity in base units, with its case count when it has one. */
export function qty(units: number, packSize?: number): string {
  if (!packSize || packSize <= 1) return num(units)
  const cases = units / packSize
  if (Number.isInteger(cases)) return `${num(units)} (${num(cases)} × ${packSize})`
  return num(units)
}

export function percent(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(digits)}%`
}

const TIME = new Intl.DateTimeFormat('en-ZA', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Africa/Johannesburg',
})

const DATE = new Intl.DateTimeFormat('en-ZA', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Africa/Johannesburg',
})

const DATE_FULL = new Intl.DateTimeFormat('en-ZA', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Africa/Johannesburg',
})

export function time(ms: number): string {
  return TIME.format(ms)
}

export function date(ms: number): string {
  return DATE.format(ms)
}

export function dateFull(ms: number): string {
  return DATE_FULL.format(ms)
}

export function dateTime(ms: number): string {
  return `${DATE.format(ms)} ${TIME.format(ms)}`
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * A duration in the shortest form that is still precise enough to act on:
 * minutes up to an hour, then hours, then days.
 */
export function duration(ms: number): string {
  const abs = Math.abs(ms)
  const minutes = Math.round(abs / 60_000)

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`

  const hours = abs / 3_600_000
  if (hours < 24) {
    const h = Math.floor(hours)
    const m = Math.round((hours - h) * 60)
    return m === 0 ? `${h} hr` : `${h} hr ${m} min`
  }

  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/** "12 min ago" / "in 3 days". */
export function relative(ms: number, now: number): string {
  const delta = ms - now
  if (Math.abs(delta) < 45_000) return 'just now'
  return delta < 0 ? `${duration(delta)} ago` : `in ${duration(delta)}`
}

/** Turn any snake_case enum into something readable. */
export function label(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Basis points as a percentage: 1500 -> "15%". */
export function bp(basisPoints: number): string {
  const pct = basisPoints / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`
}

/** Temperature range for a storage room. */
export function tempRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null
  if (min === null) return `≤ ${max}°C`
  if (max === null) return `≥ ${min}°C`
  return `${min}° to ${max}°C`
}
