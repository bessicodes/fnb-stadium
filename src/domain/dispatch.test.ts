import { describe, expect, it } from 'vitest'

import type { Crew, HaulRoute, LoadRun, RunPriority, RunStatus } from '@/db/schema'
import {
  advanceRun,
  ageMinutes,
  canTransition,
  dispatchOrder,
  isActive,
  isBreaching,
  isTerminal,
  minutesToDeadline,
  SLA_MINUTES,
  slaReport,
  suggestCrews,
} from './dispatch'

const T0 = Date.UTC(2026, 5, 13, 17, 0, 0)
const MIN = 60_000

function run(over: Partial<LoadRun> = {}): LoadRun {
  return {
    id: 'run-1',
    code: 'LR-0001',
    eventId: 'ev-1',
    kioskId: 'k-1',
    itemId: 'i-1',
    vendorId: 'v-1',
    qty: 96,
    qtyDelivered: null,
    priority: 'urgent',
    status: 'requested',
    fromSpotId: 'spot-1',
    crewId: null,
    requestedBy: 'Kiosk 14',
    slaMinutes: SLA_MINUTES.urgent,
    requestedAt: T0,
    assignedAt: null,
    pickedAt: null,
    deliveredAt: null,
    confirmedAt: null,
    cancelledReason: null,
    note: null,
    ...over,
  }
}

function crew(over: Partial<Crew> = {}): Crew {
  return {
    id: 'crew-1',
    code: 'C1',
    name: 'Crew One',
    baseZoneId: 'z-1',
    callSign: 'Alpha',
    memberCount: 3,
    shift: 'double',
    trolleys: 2,
    status: 'available',
    ...over,
  }
}

function route(over: Partial<HaulRoute> = {}): HaulRoute {
  return {
    id: 'route-1',
    roomId: 'room-1',
    kioskId: 'k-1',
    meters: 120,
    minutes: 6,
    via: 'Service lift 3',
    stepFree: true,
    ...over,
  }
}

describe('status ladder', () => {
  it('walks the happy path one step at a time', () => {
    const path: RunStatus[] = [
      'requested',
      'assigned',
      'picking',
      'in_transit',
      'delivered',
      'confirmed',
    ]

    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i] as RunStatus, path[i + 1] as RunStatus)).toBe(true)
    }
  })

  it('refuses to skip the crew ever touching the stock', () => {
    expect(canTransition('requested', 'delivered')).toBe(false)
    expect(canTransition('assigned', 'confirmed')).toBe(false)
  })

  it('refuses to walk backwards', () => {
    expect(canTransition('delivered', 'in_transit')).toBe(false)
    expect(canTransition('confirmed', 'delivered')).toBe(false)
  })

  it('allows cancelling up to delivery but not after', () => {
    expect(canTransition('requested', 'cancelled')).toBe(true)
    expect(canTransition('in_transit', 'cancelled')).toBe(true)
    expect(canTransition('delivered', 'cancelled')).toBe(false)
  })

  it('knows which statuses are finished and which are out on the floor', () => {
    expect(isTerminal('confirmed')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('in_transit')).toBe(false)

    expect(isActive('picking')).toBe(true)
    expect(isActive('requested')).toBe(false)
    expect(isActive('confirmed')).toBe(false)
  })
})

describe('advanceRun', () => {
  it('stamps the time on each step', () => {
    const assigned = advanceRun(run(), 'assigned', T0 + MIN, { crewId: 'crew-2' })
    expect(assigned).toMatchObject({ ok: true })
    if (assigned.ok) {
      expect(assigned.patch).toMatchObject({
        status: 'assigned',
        crewId: 'crew-2',
        assignedAt: T0 + MIN,
      })
    }
  })

  it('will not assign a run without a crew', () => {
    const result = advanceRun(run(), 'assigned', T0)
    expect(result).toEqual({ ok: false, error: 'Assigning a run needs a crew' })
  })

  it('keeps the crew already on the run when none is given', () => {
    const result = advanceRun(run({ crewId: 'crew-9' }), 'assigned', T0)
    expect(result.ok && result.patch.crewId).toBe('crew-9')
  })

  it('defaults the delivered quantity to what was asked for', () => {
    const result = advanceRun(run({ status: 'in_transit' }), 'delivered', T0 + 9 * MIN)
    expect(result.ok && result.patch.qtyDelivered).toBe(96)
  })

  it('accepts a short pick, because bays run out', () => {
    const result = advanceRun(run({ status: 'in_transit' }), 'delivered', T0, {
      qtyDelivered: 72,
    })
    expect(result.ok && result.patch.qtyDelivered).toBe(72)
  })

  it('refuses a delivery larger than the run, which means somebody else is short', () => {
    const result = advanceRun(run({ status: 'in_transit' }), 'delivered', T0, {
      qtyDelivered: 120,
    })
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.error).toContain('Cannot deliver 120')
  })

  it('refuses a delivery of nothing', () => {
    const result = advanceRun(run({ status: 'in_transit' }), 'delivered', T0, {
      qtyDelivered: 0,
    })
    expect(result.ok).toBe(false)
  })

  it('requires a reason to cancel', () => {
    expect(advanceRun(run(), 'cancelled', T0).ok).toBe(false)
    expect(advanceRun(run(), 'cancelled', T0, { reason: 'Kiosk closed early' }).ok).toBe(true)
  })

  it('rejects an illegal jump with a readable message', () => {
    const result = advanceRun(run(), 'confirmed', T0)
    expect(result).toEqual({
      ok: false,
      error: 'A run cannot go from requested to confirmed',
    })
  })
})

describe('deadlines', () => {
  it('ages a run in whole minutes', () => {
    expect(ageMinutes(run(), T0 + 7 * MIN)).toBe(7)
  })

  it('never reports a negative age for a clock skew', () => {
    expect(ageMinutes(run(), T0 - 5 * MIN)).toBe(0)
  })

  it('counts down to the deadline and then past it', () => {
    expect(minutesToDeadline(run(), T0 + 5 * MIN)).toBe(15)
    expect(minutesToDeadline(run(), T0 + 25 * MIN)).toBe(-5)
  })

  it('breaches once an undelivered run passes its window', () => {
    expect(isBreaching(run(), T0 + 19 * MIN)).toBe(false)
    expect(isBreaching(run(), T0 + 21 * MIN)).toBe(true)
  })

  it('judges a delivered run on when it landed, not on now', () => {
    const quick = run({ status: 'delivered', deliveredAt: T0 + 12 * MIN })
    // Hours later, this run is still recorded as on time.
    expect(isBreaching(quick, T0 + 300 * MIN)).toBe(false)

    const slow = run({ status: 'delivered', deliveredAt: T0 + 35 * MIN })
    expect(isBreaching(slow, T0 + 300 * MIN)).toBe(true)
  })

  it('does not hold a cancelled run against the SLA', () => {
    const killed = run({ status: 'cancelled', cancelledReason: 'Kiosk closed' })
    expect(isBreaching(killed, T0 + 500 * MIN)).toBe(false)
  })

  it('gives a critical run a tighter window than a routine one', () => {
    expect(SLA_MINUTES.critical).toBeLessThan(SLA_MINUTES.urgent)
    expect(SLA_MINUTES.urgent).toBeLessThan(SLA_MINUTES.routine)
  })
})

describe('dispatchOrder', () => {
  it('puts breached runs above everything else', () => {
    const fresh = run({ id: 'fresh', priority: 'critical', slaMinutes: 10, requestedAt: T0 })
    const late = run({
      id: 'late',
      priority: 'routine',
      slaMinutes: 45,
      requestedAt: T0 - 60 * MIN,
    })

    expect(dispatchOrder([fresh, late], T0 + MIN).map((r) => r.id)).toEqual(['late', 'fresh'])
  })

  it('orders by priority when nothing has breached', () => {
    const priorities: RunPriority[] = ['routine', 'critical', 'urgent']
    const runs = priorities.map((priority, i) =>
      run({ id: priority, priority, slaMinutes: 999, requestedAt: T0 + i * MIN }),
    )

    expect(dispatchOrder(runs, T0 + 2 * MIN).map((r) => r.id)).toEqual([
      'critical',
      'urgent',
      'routine',
    ])
  })

  it('puts the longest wait first within one priority', () => {
    const older = run({ id: 'older', requestedAt: T0, slaMinutes: 999 })
    const newer = run({ id: 'newer', requestedAt: T0 + 5 * MIN, slaMinutes: 999 })

    expect(dispatchOrder([newer, older], T0 + 6 * MIN).map((r) => r.id)).toEqual([
      'older',
      'newer',
    ])
  })

  it('does not mutate the array it was given', () => {
    const runs = [run({ id: 'a', priority: 'routine' }), run({ id: 'b', priority: 'critical' })]
    dispatchOrder(runs, T0)
    expect(runs.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('suggestCrews', () => {
  const routes = [
    route({ id: 'r-near', roomId: 'room-near', kioskId: 'k-1', minutes: 4 }),
    route({ id: 'r-far', roomId: 'room-far', kioskId: 'k-1', minutes: 18 }),
  ]

  it('prefers a free crew to a loaded one', () => {
    const crews = [crew({ id: 'busy' }), crew({ id: 'free' })]
    const open = new Map([['busy', 3]])

    const ranked = suggestCrews({ crews, routes, openRunsByCrew: open, kioskId: 'k-1' })
    expect(ranked[0]?.crew.id).toBe('free')
  })

  it('leaves off-shift crews out entirely', () => {
    const crews = [crew({ id: 'off', status: 'off' }), crew({ id: 'on' })]

    const ranked = suggestCrews({ crews, routes, openRunsByCrew: new Map(), kioskId: 'k-1' })
    expect(ranked.map((s) => s.crew.id)).toEqual(['on'])
  })

  it('leaves a crew on break out too', () => {
    const crews = [crew({ id: 'break', status: 'break' })]
    expect(suggestCrews({ crews, routes, openRunsByCrew: new Map(), kioskId: 'k-1' })).toEqual([])
  })

  it('uses the quickest route in when no room is nominated', () => {
    const ranked = suggestCrews({
      crews: [crew()],
      routes,
      openRunsByCrew: new Map(),
      kioskId: 'k-1',
    })
    expect(ranked[0]?.travelMinutes).toBe(4)
  })

  it('uses the nominated room rather than the quickest', () => {
    const ranked = suggestCrews({
      crews: [crew()],
      routes,
      openRunsByCrew: new Map(),
      kioskId: 'k-1',
      fromRoomId: 'room-far',
    })
    expect(ranked[0]?.travelMinutes).toBe(18)
  })

  it('reports no travel time when the kiosk has no mapped route', () => {
    const ranked = suggestCrews({
      crews: [crew()],
      routes,
      openRunsByCrew: new Map(),
      kioskId: 'k-unmapped',
    })
    expect(ranked[0]?.travelMinutes).toBeNull()
  })
})

describe('slaReport', () => {
  it('counts an empty night as perfect rather than dividing by zero', () => {
    expect(slaReport([], T0)).toMatchObject({ total: 0, onTimeRate: 1, medianMinutes: 0 })
  })

  it('reports the on-time share of delivered runs', () => {
    const runs = [
      run({ status: 'delivered', deliveredAt: T0 + 10 * MIN }),
      run({ status: 'delivered', deliveredAt: T0 + 12 * MIN }),
      run({ status: 'delivered', deliveredAt: T0 + 40 * MIN }),
      run({ status: 'delivered', deliveredAt: T0 + 15 * MIN }),
    ]

    const report = slaReport(runs, T0 + 60 * MIN)
    expect(report.delivered).toBe(4)
    expect(report.onTimeRate).toBe(0.75)
  })

  it('uses the median so one abandoned run does not sink the night', () => {
    const runs = [
      run({ status: 'delivered', deliveredAt: T0 + 8 * MIN }),
      run({ status: 'delivered', deliveredAt: T0 + 10 * MIN }),
      run({ status: 'delivered', deliveredAt: T0 + 180 * MIN }),
    ]

    const report = slaReport(runs, T0 + 200 * MIN)
    expect(report.medianMinutes).toBe(10)
    expect(report.worstMinutes).toBe(180)
  })

  it('averages the middle pair on an even count', () => {
    const runs = [
      run({ status: 'delivered', deliveredAt: T0 + 10 * MIN }),
      run({ status: 'delivered', deliveredAt: T0 + 20 * MIN }),
    ]

    expect(slaReport(runs, T0 + 30 * MIN).medianMinutes).toBe(15)
  })

  it('counts cancellations separately from breaches', () => {
    const runs = [
      run({ status: 'cancelled', cancelledReason: 'Duplicate' }),
      run({ status: 'requested', requestedAt: T0 - 60 * MIN }),
    ]

    const report = slaReport(runs, T0)
    expect(report.cancelled).toBe(1)
    expect(report.breached).toBe(1)
  })
})
