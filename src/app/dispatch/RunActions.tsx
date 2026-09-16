'use client'

import { useState, useTransition } from 'react'

import { advanceRunAction, assignCrewAction, sweepParLevelsAction } from '@/app/actions/dispatch'
import type { RunStatus } from '@/db/schema'
import { nextStatuses } from '@/domain/dispatch'

type Crew = { id: string; code: string; callSign: string; status: string }

/**
 * The buttons a dispatcher actually presses.
 *
 * The next legal status comes from the same `nextStatuses` table the server
 * validates against, so the board can never offer a step the action would
 * refuse — and if it somehow did, the server still says no.
 */
export function RunActions({
  runId,
  status,
  crews,
  suggestedCrewId,
}: {
  runId: string
  status: RunStatus
  crews: Crew[]
  suggestedCrewId?: string | null
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)

  const next = nextStatuses(status).filter((s) => s !== 'cancelled')

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null)
    start(async () => {
      const result = await fn()
      if (!result.ok) setError(result.error ?? 'Something went wrong')
      else setChoosing(false)
    })
  }

  if (status === 'requested' && choosing) {
    return (
      <div className="stack stack--sm" style={{ minWidth: 190 }}>
        <select
          className="btn btn--sm"
          defaultValue={suggestedCrewId ?? ''}
          disabled={pending}
          onChange={(e) => {
            if (e.target.value) run(() => assignCrewAction(runId, e.target.value))
          }}
        >
          <option value="">Choose a crew…</option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.callSign} ({c.code}){c.status === 'available' ? ' · free' : ''}
            </option>
          ))}
        </select>
        <button className="btn btn--sm" onClick={() => setChoosing(false)} disabled={pending}>
          Cancel
        </button>
        {error ? <ErrorText text={error} /> : null}
      </div>
    )
  }

  return (
    <div className="row" style={{ gap: 5, justifyContent: 'flex-end' }}>
      {error ? <ErrorText text={error} /> : null}

      {status === 'requested' ? (
        <button
          className="btn btn--sm btn--primary"
          onClick={() => setChoosing(true)}
          disabled={pending}
        >
          Assign
        </button>
      ) : (
        next.map((to) => (
          <button
            key={to}
            className={to === 'confirmed' ? 'btn btn--sm btn--primary' : 'btn btn--sm'}
            disabled={pending}
            onClick={() => run(() => advanceRunAction(runId, to))}
          >
            {LABELS[to]}
          </button>
        ))
      )}

      {status !== 'delivered' && next.length > 0 ? (
        <button
          className="btn btn--sm btn--danger"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt('Why is this run being cancelled?')
            if (reason) run(() => advanceRunAction(runId, 'cancelled', { reason }))
          }}
        >
          Cancel
        </button>
      ) : null}
    </div>
  )
}

const LABELS: Partial<Record<RunStatus, string>> = {
  assigned: 'Assign',
  picking: 'Picking',
  in_transit: 'On the way',
  delivered: 'Delivered',
  confirmed: 'Sign for it',
}

function ErrorText({ text }: { text: string }) {
  return (
    <span className="tiny" style={{ color: 'var(--crit)', maxWidth: 240 }}>
      {text}
    </span>
  )
}

/** The par-level sweep button. */
export function SweepButton({ eventId }: { eventId: string }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  return (
    <div className="row" style={{ gap: 8 }}>
      {message ? <span className="tiny muted">{message}</span> : null}
      <button
        className="btn btn--primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await sweepParLevelsAction(eventId)
            setMessage(result.ok ? result.message : result.error)
          })
        }
      >
        {pending ? 'Sweeping…' : 'Sweep par levels'}
      </button>
    </div>
  )
}
