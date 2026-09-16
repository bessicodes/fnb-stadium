/**
 * Loader dispatch.
 *
 * A kiosk in block 23 runs dry at half time. Somebody has to get four cases of
 * lager from cold room 2 to that counter before the queue gives up. That job
 * is a *load run*, and this module is the logic that moves it along: what a
 * run's deadline is, which crew should take it, and which runs control should
 * be looking at right now.
 *
 * The status ladder is deliberately narrow. A run goes
 *
 *   requested -> assigned -> picking -> in_transit -> delivered -> confirmed
 *
 * and may be cancelled from anywhere before delivery. It cannot skip steps,
 * because each step stamps a time and the gaps between those stamps are the
 * only honest record of why a counter waited forty minutes.
 *
 * `confirmed` is special: it is the kiosk signing for the stock, and it is the
 * only status that posts a movement to the ledger. Stock that a crew says it
 * delivered but nobody signed for is not stock on hand.
 */
import type { Crew, HaulRoute, LoadRun, RunPriority, RunStatus } from '@/db/schema'

/** Minutes from request to delivery, by how badly it is needed. */
export const SLA_MINUTES: Record<RunPriority, number> = {
  /** Pre-event top-ups, planned from par levels. */
  routine: 45,
  /** Running low while trading. */
  urgent: 20,
  /** Counter is dry and selling nothing. */
  critical: 10,
}

export const PRIORITY_RANK: Record<RunPriority, number> = {
  critical: 0,
  urgent: 1,
  routine: 2,
}

/** Legal next statuses. Anything not listed here is rejected. */
const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  requested: ['assigned', 'cancelled'],
  assigned: ['picking', 'cancelled'],
  picking: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
  delivered: ['confirmed'],
  confirmed: [],
  cancelled: [],
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function nextStatuses(from: RunStatus): readonly RunStatus[] {
  return TRANSITIONS[from]
}

/** A run that has reached one of these is finished and no longer on the board. */
export function isTerminal(status: RunStatus): boolean {
  return status === 'confirmed' || status === 'cancelled'
}

/** A run in one of these is out on the floor with a crew against it. */
export function isActive(status: RunStatus): boolean {
  return status === 'assigned' || status === 'picking' || status === 'in_transit'
}

export type TransitionResult =
  | { ok: true; patch: Partial<LoadRun> }
  | { ok: false; error: string }

/**
 * Move a run along, returning the columns to write.
 *
 * Returning a patch rather than mutating keeps this function pure and lets the
 * caller decide whether to also post a ledger movement — which it must, on
 * `confirmed`.
 */
export function advanceRun(
  run: Pick<LoadRun, 'status' | 'crewId' | 'qty'>,
  to: RunStatus,
  at: number,
  options: { crewId?: string; qtyDelivered?: number; reason?: string } = {},
): TransitionResult {
  if (!canTransition(run.status, to)) {
    return {
      ok: false,
      error: `A run cannot go from ${run.status} to ${to}`,
    }
  }

  const patch: Partial<LoadRun> = { status: to }

  switch (to) {
    case 'assigned': {
      const crewId = options.crewId ?? run.crewId
      if (!crewId) return { ok: false, error: 'Assigning a run needs a crew' }
      patch.crewId = crewId
      patch.assignedAt = at
      break
    }
    case 'picking':
      patch.pickedAt = at
      break
    case 'in_transit':
      break
    case 'delivered': {
      // A short pick is normal — the bay had less than the sheet said. What is
      // not allowed is delivering more than was asked for, which means the
      // crew took someone else's stock.
      const delivered = options.qtyDelivered ?? run.qty
      if (delivered <= 0) {
        return { ok: false, error: 'Delivered quantity must be more than zero' }
      }
      if (delivered > run.qty) {
        return {
          ok: false,
          error: `Cannot deliver ${delivered} against a run for ${run.qty}`,
        }
      }
      patch.qtyDelivered = delivered
      patch.deliveredAt = at
      break
    }
    case 'confirmed':
      patch.confirmedAt = at
      break
    case 'cancelled':
      if (!options.reason) return { ok: false, error: 'Cancelling a run needs a reason' }
      patch.cancelledReason = options.reason
      break
  }

  return { ok: true, patch }
}

/** Minutes since the run was raised. */
export function ageMinutes(run: Pick<LoadRun, 'requestedAt'>, now: number): number {
  return Math.max(0, Math.round((now - run.requestedAt) / 60_000))
}

/** Minutes left before the SLA is missed. Negative means already missed. */
export function minutesToDeadline(
  run: Pick<LoadRun, 'requestedAt' | 'slaMinutes'>,
  now: number,
): number {
  return Math.round((run.requestedAt + run.slaMinutes * 60_000 - now) / 60_000)
}

/**
 * Whether a run has missed its window.
 *
 * Judged on delivery, not confirmation: once the stock is at the counter the
 * crew has done its job, and a kiosk slow to sign for it is a different
 * problem from a slow run.
 */
export function isBreaching(
  run: Pick<LoadRun, 'requestedAt' | 'slaMinutes' | 'status' | 'deliveredAt'>,
  now: number,
): boolean {
  if (run.status === 'cancelled') return false

  const deadline = run.requestedAt + run.slaMinutes * 60_000
  const finishedAt = run.deliveredAt
  return finishedAt ? finishedAt > deadline : now > deadline
}

/**
 * Sort for the control board: what should a dispatcher look at first?
 *
 * Runs that have already missed their window come first — those are the ones a
 * kiosk manager is on the radio about. Then by priority, then by age, so the
 * longest-waiting run of a given urgency is always at the top of its group.
 */
export function dispatchOrder<
  T extends Pick<LoadRun, 'requestedAt' | 'slaMinutes' | 'status' | 'deliveredAt' | 'priority'>,
>(runs: readonly T[], now: number): T[] {
  return [...runs].sort((a, b) => {
    const aBreach = isBreaching(a, now) ? 0 : 1
    const bBreach = isBreaching(b, now) ? 0 : 1
    if (aBreach !== bBreach) return aBreach - bBreach

    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (byPriority !== 0) return byPriority

    return a.requestedAt - b.requestedAt
  })
}

export type CrewSuggestion = {
  crew: Crew
  /** Lower is better. */
  score: number
  /** One-way minutes from the crew's base to the counter, where a route is known. */
  travelMinutes: number | null
  openRuns: number
  reason: string
}

/**
 * Rank crews for a run.
 *
 * Travel time dominates, because that is what the kiosk experiences. Current
 * load is a tiebreak: an idle crew ten minutes away beats a busy crew five
 * minutes away, since the busy crew has to finish first. A crew off shift or
 * on break is not offered at all.
 */
export function suggestCrews(input: {
  crews: readonly Crew[]
  routes: readonly HaulRoute[]
  openRunsByCrew: ReadonlyMap<string, number>
  kioskId: string
  /** Where the stock is coming from, when it is already decided. */
  fromRoomId?: string | null
}): CrewSuggestion[] {
  const { crews, routes, openRunsByCrew, kioskId, fromRoomId } = input

  const relevant = routes.filter(
    (r) => r.kioskId === kioskId && (!fromRoomId || r.roomId === fromRoomId),
  )
  // Without a nominated room, judge each crew on the quickest way in.
  const bestRoute = relevant.reduce<HaulRoute | null>(
    (best, r) => (best === null || r.minutes < best.minutes ? r : best),
    null,
  )

  return crews
    .filter((c) => c.status === 'available' || c.status === 'on_run')
    .map((crew) => {
      const openRuns = openRunsByCrew.get(crew.id) ?? 0
      const travelMinutes = bestRoute?.minutes ?? null

      // Each open run costs the crew roughly an SLA window of availability.
      const score = (travelMinutes ?? 15) + openRuns * 12 + (crew.status === 'on_run' ? 5 : 0)

      const reason =
        openRuns === 0
          ? `Free${travelMinutes !== null ? `, ${travelMinutes} min out` : ''}`
          : `${openRuns} run${openRuns === 1 ? '' : 's'} in hand`

      return { crew, score, travelMinutes, openRuns, reason }
    })
    .sort((a, b) => a.score - b.score)
}

export type SlaReport = {
  total: number
  delivered: number
  cancelled: number
  breached: number
  /** Share of delivered runs that made their window, 0–1. */
  onTimeRate: number
  /** Median request-to-delivery minutes. */
  medianMinutes: number
  /** Slowest run, in minutes. */
  worstMinutes: number
}

/**
 * How dispatch actually performed. Read after the final whistle.
 *
 * The median is reported rather than the mean because one abandoned run at
 * 180 minutes would otherwise swallow a night of good work.
 */
export function slaReport(
  runs: readonly Pick<
    LoadRun,
    'status' | 'requestedAt' | 'deliveredAt' | 'slaMinutes' | 'priority'
  >[],
  now: number,
): SlaReport {
  const delivered = runs.filter((r) => r.deliveredAt !== null && r.deliveredAt !== undefined)
  const cancelled = runs.filter((r) => r.status === 'cancelled')
  const breached = runs.filter((r) => isBreaching(r, now))

  const durations = delivered
    .map((r) => Math.round(((r.deliveredAt as number) - r.requestedAt) / 60_000))
    .sort((a, b) => a - b)

  const median = durations.length === 0 ? 0 : medianOf(durations)
  const onTime = delivered.filter((r) => !isBreaching(r, now)).length

  return {
    total: runs.length,
    delivered: delivered.length,
    cancelled: cancelled.length,
    breached: breached.length,
    onTimeRate: delivered.length === 0 ? 1 : onTime / delivered.length,
    medianMinutes: median,
    worstMinutes: durations.length === 0 ? 0 : (durations[durations.length - 1] as number),
  }
}

function medianOf(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] as number
  return Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2)
}
