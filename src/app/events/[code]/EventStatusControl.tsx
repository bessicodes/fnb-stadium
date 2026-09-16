'use client'

import { useState, useTransition } from 'react'

import { setEventStatusAction } from '@/app/actions/allocation'
import type { EventStatus } from '@/db/schema'

const LADDER: EventStatus[] = [
  'planned',
  'accreditation',
  'load_in',
  'live',
  'closed',
  'reconciled',
]

const NEXT_LABEL: Partial<Record<EventStatus, string>> = {
  accreditation: 'Open accreditation',
  load_in: 'Start load-in',
  live: 'Go live',
  closed: 'Close event',
  reconciled: 'Mark reconciled',
}

/**
 * Advance the event one rung.
 *
 * Only ever offers the single next step — the server refuses anything else, and
 * an event that could jump from planned straight to closed would leave every
 * allocation and every ledger posting behind it in an undefined state.
 */
export function EventStatusControl({
  eventId,
  status,
}: {
  eventId: string
  status: EventStatus
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const next = LADDER[LADDER.indexOf(status) + 1]
  if (!next) return null

  return (
    <div className="row" style={{ gap: 8 }}>
      {error ? (
        <span className="tiny" style={{ color: 'var(--crit)' }}>
          {error}
        </span>
      ) : null}
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const result = await setEventStatusAction(eventId, next)
            if (!result.ok) setError(result.error)
          })
        }
      >
        {pending ? 'Working…' : (NEXT_LABEL[next] ?? next)}
      </button>
    </div>
  )
}
