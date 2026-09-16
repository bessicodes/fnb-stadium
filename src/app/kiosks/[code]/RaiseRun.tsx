'use client'

import { useState, useTransition } from 'react'

import { raiseRunAction } from '@/app/actions/dispatch'

type Item = { id: string; name: string; packSize: number }

/** Raise a top-up from the counter's own page, the way a supervisor would. */
export function RaiseRun({
  eventId,
  kioskId,
  items,
}: {
  eventId: string
  kioskId: string
  items: Item[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [itemId, setItemId] = useState(items[0]?.id ?? '')
  const [cases, setCases] = useState(2)
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'critical'>('urgent')

  const item = items.find((i) => i.id === itemId)
  const qty = (item?.packSize ?? 1) * cases

  if (!open) {
    return (
      <button className="btn btn--primary" onClick={() => setOpen(true)}>
        Raise a run
      </button>
    )
  }

  return (
    <div
      className="panel"
      style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
    >
      <label style={{ display: 'grid', gap: 3 }}>
        <span className="statLabel">Item</span>
        <select
          className="btn btn--sm"
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          style={{ minWidth: 190 }}
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'grid', gap: 3 }}>
        <span className="statLabel">Cases</span>
        <input
          className="btn btn--sm"
          type="number"
          min={1}
          max={40}
          value={cases}
          onChange={(e) => setCases(Math.max(1, Number(e.target.value)))}
          style={{ width: 72 }}
        />
      </label>

      <label style={{ display: 'grid', gap: 3 }}>
        <span className="statLabel">Priority</span>
        <select
          className="btn btn--sm"
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
        >
          <option value="routine">Routine — 45 min</option>
          <option value="urgent">Urgent — 20 min</option>
          <option value="critical">Critical — 10 min</option>
        </select>
      </label>

      <button
        className="btn btn--sm btn--primary"
        disabled={pending || !itemId}
        onClick={() =>
          start(async () => {
            const result = await raiseRunAction({
              eventId,
              kioskId,
              itemId,
              qty,
              priority,
              requestedBy: 'Counter supervisor',
            })
            setMessage(result.ok ? result.message : result.error)
            if (result.ok) setOpen(false)
          })
        }
      >
        {pending ? 'Raising…' : `Raise ${qty}`}
      </button>

      <button className="btn btn--sm" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </button>

      {message ? (
        <span className="tiny muted" style={{ flexBasis: '100%' }}>
          {message}
        </span>
      ) : null}
    </div>
  )
}
