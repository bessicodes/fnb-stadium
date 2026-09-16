/**
 * The season: five events across every state the system models.
 *
 * Times are generated relative to *now*, which means one of them — the derby —
 * is always mid-match when you open the app. That is deliberate. A control
 * board, a dispatch queue and an SLA clock are meaningless on a dataset where
 * nothing is happening, and a demo that requires you to imagine the live state
 * teaches nobody anything.
 *
 *   Fixture 1  three weeks ago   reconciled, full stock history, real variance
 *   Fixture 2  right now         LIVE — runs in flight, some already breaching
 *   Fixture 3  in twelve days    accreditation open, allocations confirmed
 *   Fixture 4  in six weeks      concert, planned, half the bowl
 *   Fixture 5  in ten weeks      rugby test, planned
 */
import type {
  Accreditation,
  Crew,
  Incident,
  Kiosk,
  KioskAllocation,
  LoadRun,
  ParLevel,
  StadiumEvent,
  StockItem,
  StockMovement,
  StorageAllocation,
  StorageSpot,
  Vendor,
  VendorStaffMember,
} from '@/db/schema'
import { SLA_MINUTES } from '@/domain/dispatch'
import { rng, type Rng } from './rng'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export type EventData = {
  events: StadiumEvent[]
  eventZones: Array<{ eventId: string; zoneId: string; open: boolean }>
  kioskAllocations: KioskAllocation[]
  storageAllocations: StorageAllocation[]
  parLevels: ParLevel[]
  movements: StockMovement[]
  loadRuns: LoadRun[]
  incidents: Incident[]
  accreditations: Accreditation[]
  crewUpdates: Array<{ id: string; status: Crew['status'] }>
}

/** Interleave spots room by room: A1, B1, A2, B2, … rather than all of A then all of B. */
function stripeByRoom(spots: readonly StorageSpot[]): StorageSpot[] {
  const byRoom = new Map<string, StorageSpot[]>()
  for (const spot of spots) {
    const list = byRoom.get(spot.roomId)
    if (list) list.push(spot)
    else byRoom.set(spot.roomId, [spot])
  }

  const queues = [...byRoom.values()]
  const striped: StorageSpot[] = []
  const deepest = Math.max(0, ...queues.map((q) => q.length))

  for (let i = 0; i < deepest; i++) {
    for (const queue of queues) {
      const spot = queue[i]
      if (spot) striped.push(spot)
    }
  }

  return striped
}

/** Which vendor trades which kind of counter. */
function vendorPlanFor(kind: Kiosk['kind']): string[] {
  switch (kind) {
    case 'beverage':
      return ['vendor-v-highv']
    case 'combo':
      return ['vendor-v-kasi', 'vendor-v-sowgr', 'vendor-v-bunny']
    case 'food':
      return ['vendor-v-sowgr', 'vendor-v-kasi', 'vendor-v-bunny']
    case 'coffee':
      return ['vendor-v-calco']
    case 'merchandise':
      return ['vendor-v-chief']
    case 'premium':
      return ['vendor-v-nasrc']
  }
}

/** What a counter of each kind actually stocks. */
function itemsFor(kind: Kiosk['kind'], items: readonly StockItem[]): StockItem[] {
  const by = (categories: StockItem['category'][]) =>
    items.filter((i) => categories.includes(i.category) && i.unitPriceCents > 0)

  switch (kind) {
    case 'beverage':
      return by(['beer', 'cider', 'soft_drink', 'water'])
    case 'combo':
      return by(['beer', 'soft_drink', 'water', 'food_hot', 'snack'])
    case 'food':
      return by(['food_hot', 'soft_drink', 'water'])
    case 'coffee':
      return by(['snack'])
    case 'merchandise':
      return by(['merchandise'])
    case 'premium':
      return by(['beer', 'cider', 'soft_drink', 'water', 'food_cold'])
  }
}

export function buildEvents(input: {
  now: number
  kiosks: readonly Kiosk[]
  spots: readonly StorageSpot[]
  items: readonly StockItem[]
  vendors: readonly Vendor[]
  staff: readonly VendorStaffMember[]
  crews: readonly Crew[]
  zoneIds: readonly string[]
}): EventData {
  const { now, kiosks, spots, items, staff, crews, zoneIds } = input
  const r = rng(2010071108)

  const out: EventData = {
    events: [],
    eventZones: [],
    kioskAllocations: [],
    storageAllocations: [],
    parLevels: [],
    movements: [],
    loadRuns: [],
    incidents: [],
    accreditations: [],
    crewUpdates: [],
  }

  // Anchor the live fixture so kick-off was 50 minutes ago: first half, the
  // moment when bars start running dry and dispatch actually matters.
  const liveKickOff = now - 50 * MIN

  const fixtures: Array<{
    code: string
    name: string
    kind: StadiumEvent['kind']
    kickOff: number
    attendance: number
    spendPerHead: number
    status: StadiumEvent['status']
    upperTier: boolean
    notes?: string
  }> = [
    {
      code: 'FNB-2601',
      name: 'Kaizer Chiefs vs Orlando Pirates — Soweto Derby',
      kind: 'football',
      kickOff: now - 21 * DAY,
      attendance: 87_400,
      spendPerHead: 4800,
      status: 'reconciled',
      upperTier: true,
    },
    {
      code: 'FNB-2602',
      name: 'Kaizer Chiefs vs Mamelodi Sundowns',
      kind: 'football',
      kickOff: liveKickOff,
      attendance: 78_900,
      spendPerHead: 4500,
      status: 'live',
      upperTier: true,
    },
    {
      code: 'FNB-2603',
      name: 'Kaizer Chiefs vs SuperSport United',
      kind: 'football',
      kickOff: now + 12 * DAY,
      attendance: 52_000,
      spendPerHead: 4200,
      status: 'accreditation',
      upperTier: true,
    },
    {
      code: 'FNB-2604',
      name: 'Global Citizen Festival',
      kind: 'concert',
      kickOff: now + 42 * DAY,
      attendance: 64_000,
      spendPerHead: 6200,
      status: 'planned',
      upperTier: false,
      notes: 'Pitch standing. Upper tier closed — production rigging in the north.',
    },
    {
      code: 'FNB-2605',
      name: 'Springboks vs All Blacks',
      kind: 'rugby',
      kickOff: now + 70 * DAY,
      attendance: 91_200,
      spendPerHead: 7400,
      status: 'planned',
      upperTier: true,
    },
  ]

  let runSeq = 0
  let movementSeq = 0
  let accreditationSeq = 0

  // Par levels belong to a counter, not to an event, so two trading fixtures
  // must not each write their own copy.
  const parsWritten = new Set<string>()

  for (const fixture of fixtures) {
    const eventId = `event-${fixture.code.toLowerCase()}`
    const doorsAt = fixture.kickOff - 2 * HOUR
    const endsAt = fixture.kickOff + 2 * HOUR + 15 * MIN

    out.events.push({
      id: eventId,
      code: fixture.code,
      name: fixture.name,
      kind: fixture.kind,
      startsAt: fixture.kickOff,
      doorsAt,
      endsAt,
      expectedAttendance: fixture.attendance,
      actualAttendance:
        fixture.status === 'reconciled'
          ? fixture.attendance - r.int(200, 3200)
          : fixture.status === 'live'
            ? fixture.attendance - r.int(1000, 4000)
            : null,
      spendPerHeadCents: fixture.spendPerHead,
      status: fixture.status,
      notes: fixture.notes ?? null,
      createdAt: fixture.kickOff - 60 * DAY,
    })

    // Which zones open. A concert with a rigged north stand does not open L3.
    const openZones = zoneIds.filter((z) => {
      if (!fixture.upperTier && z.startsWith('zone-l3')) return false
      return true
    })
    for (const zoneId of zoneIds) {
      out.eventZones.push({ eventId, zoneId, open: openZones.includes(zoneId) })
    }

    const tradingKiosks = kiosks.filter(
      (k) => k.status === 'active' && openZones.includes(k.zoneId),
    )

    // Planned events are only partly allocated — that is what "planned" means.
    const allocationShare =
      fixture.status === 'planned' ? 0.35 : fixture.status === 'accreditation' ? 0.9 : 1

    const allocated = tradingKiosks.slice(
      0,
      Math.floor(tradingKiosks.length * allocationShare),
    )

    const vendorByKiosk = new Map<string, string>()
    const spotByVendorItem = new Map<string, string>()

    /* ---- kiosk allocations ---- */
    for (const [i, kiosk] of allocated.entries()) {
      const candidates = vendorPlanFor(kiosk.kind)
      // Old Town traded the derby and was suspended on the back of what the
      // reconciliation found. They are deliberately still on that event, so the
      // variance report has the case that got them suspended in it.
      const vendorId =
        fixture.status === 'reconciled' && i % 17 === 3
          ? 'vendor-v-oldtn'
          : (candidates[i % candidates.length] as string)
      vendorByKiosk.set(kiosk.id, vendorId)

      const status: KioskAllocation['status'] =
        fixture.status === 'planned'
          ? 'draft'
          : fixture.status === 'accreditation'
            ? 'confirmed'
            : fixture.status === 'live'
              ? 'trading'
              : 'closed'

      out.kioskAllocations.push({
        id: `alloc-${eventId}-${kiosk.id}`,
        eventId,
        kioskId: kiosk.id,
        vendorId,
        status,
        staffPlanned: kiosk.tills + r.int(1, 3),
        floatCents: kiosk.tills * 50_000,
        declaredSalesCents: null, // filled in below for the reconciled fixture
        openedAt: status === 'trading' || status === 'closed' ? doorsAt : null,
        closedAt: status === 'closed' ? endsAt : null,
        notes: null,
      })
    }

    /* ---- storage allocations: one bay per vendor per class of stock ---- */
    const vendorsTrading = [...new Set(vendorByKiosk.values())]
    // Striped by room rather than taken in order, so vendors are spread across
    // both cold rooms the way a real load-in plan spreads them — filling CR1
    // completely before touching CR2 would put every vendor behind one door.
    const chilledSpots = stripeByRoom(
      spots.filter((s) => s.status === 'available' && s.roomId.startsWith('room-cr')),
    )
    const drySpots = stripeByRoom(
      spots.filter(
        (s) => s.status === 'available' && (s.roomId === 'room-mr1' || s.roomId === 'room-bv1'),
      ),
    )

    let chilledCursor = 0
    let dryCursor = 0

    for (const vendorId of vendorsTrading) {
      for (const pool of [chilledSpots, drySpots]) {
        const isChilled = pool === chilledSpots
        const take = isChilled ? 2 : 3
        for (let i = 0; i < take; i++) {
          const cursor = isChilled ? chilledCursor++ : dryCursor++
          const spot = pool[cursor % pool.length]
          if (!spot) continue

          const key = `${vendorId}:${isChilled ? 'chilled' : 'dry'}`
          if (!spotByVendorItem.has(key)) spotByVendorItem.set(key, spot.id)

          const id = `stor-${eventId}-${spot.id}-${vendorId}`
          if (out.storageAllocations.some((a) => a.eventId === eventId && a.spotId === spot.id)) {
            continue
          }

          out.storageAllocations.push({
            id,
            eventId,
            spotId: spot.id,
            vendorId,
            unitsAllocated: Math.max(1, Math.round(spot.capacityUnits * r.float(0.5, 1))),
            notes: null,
          })
        }
      }
    }

    /* ---- par levels and stock, for events that actually trade ---- */
    const trades = fixture.status === 'live' || fixture.status === 'reconciled'
    if (!trades) continue

    const attendance = out.events.at(-1)?.actualAttendance ?? fixture.attendance
    // Rough share of the crowd each counter serves.
    const crowdPerKiosk = attendance / Math.max(1, allocated.length)

    for (const kiosk of allocated) {
      const vendorId = vendorByKiosk.get(kiosk.id)
      if (!vendorId) continue

      const stocked = itemsFor(kiosk.kind, items)
      const chilledSpot = spotByVendorItem.get(`${vendorId}:chilled`)
      const drySpot = spotByVendorItem.get(`${vendorId}:dry`)

      for (const item of stocked) {
        // Expected units for this counter across the event.
        const share = item.category === 'beer' ? 0.28 : item.category === 'food_hot' ? 0.12 : 0.1
        const expected = Math.max(
          item.packSize,
          Math.round((crowdPerKiosk * 0.45 * share) / stocked.length) * 4,
        )

        const minQty = Math.max(item.packSize, Math.round(expected / 4 / item.packSize) * item.packSize)
        const maxQty = Math.max(minQty * 2, Math.round(expected / item.packSize) * item.packSize)

        const parKey = `${kiosk.id}:${item.id}`
        if (!parsWritten.has(parKey)) {
          parsWritten.add(parKey)
          out.parLevels.push({
            id: `par-${kiosk.id}-${item.id}`,
            kioskId: kiosk.id,
            itemId: item.id,
            minQty,
            maxQty,
          })
        }

        const sourceSpot = (item.requiresChill ? chilledSpot : drySpot) ?? drySpot ?? chilledSpot
        if (!sourceSpot) continue

        const push = (
          kind: StockMovement['kind'],
          qty: number,
          at: number,
          from: [StockMovement['fromType'], string | null],
          to: [StockMovement['toType'], string | null],
          actor: string,
          ref: string | null,
        ) => {
          if (qty <= 0) return
          out.movements.push({
            id: `mov-${++movementSeq}`,
            eventId,
            itemId: item.id,
            vendorId,
            kind,
            qty,
            fromType: from[0],
            fromId: from[1],
            toType: to[0],
            toId: to[1],
            actor,
            ref,
            at,
            note: null,
          })
        }

        // Load-in: stock arrives the day before and goes into the bay.
        const deliveredQty = maxQty * 2
        push(
          'delivery',
          deliveredQty,
          doorsAt - 20 * HOUR,
          ['supplier', null],
          ['spot', sourceSpot],
          'Goods Receiving',
          `GRN-${fixture.code}`,
        )

        // Pre-load: the counter is filled to its ceiling before doors open.
        push(
          'issue',
          maxQty,
          doorsAt - r.int(60, 180) * MIN,
          ['spot', sourceSpot],
          ['kiosk', kiosk.id],
          `Crew ${r.int(1, 10)}`,
          'PRELOAD',
        )

        if (fixture.status === 'reconciled') {
          // A full event: two restocks, sales, a little waste, a little
          // shrinkage, and what was left going back to the bay.
          const restock = Math.round(maxQty * r.float(0.6, 1.1))
          push(
            'issue',
            restock,
            fixture.kickOff - 20 * MIN,
            ['spot', sourceSpot],
            ['kiosk', kiosk.id],
            `Crew ${r.int(1, 10)}`,
            'RESTOCK',
          )

          const issued = maxQty + restock
          const wasted = Math.round(issued * r.float(0, 0.012))
          const returned = Math.round(issued * r.float(0.04, 0.16))
          // Most counters reconcile clean; a few lose stock, and one vendor
          // loses it consistently — which is the point of the variance report.
          const leak =
            vendorId === 'vendor-v-oldtn'
              ? r.float(0.05, 0.09)
              : r.chance(0.25)
                ? r.float(0.01, 0.03)
                : 0
          const sold = Math.max(0, Math.round((issued - wasted - returned) * (1 - leak)))

          push('waste', wasted, endsAt - 30 * MIN, ['kiosk', kiosk.id], ['waste', null], 'Kiosk supervisor', null)
          push('sale', sold, endsAt - 10 * MIN, ['kiosk', kiosk.id], ['sold', null], 'till-export', `Z-${kiosk.code}`)
          push('return', returned, endsAt + 40 * MIN, ['kiosk', kiosk.id], ['spot', sourceSpot], `Crew ${r.int(1, 10)}`, 'RETURN')
        } else {
          // Live: sales so far, and counters drawing down at different rates.
          const minutesTrading = Math.max(0, (now - doorsAt) / MIN)
          const burn = r.float(0.35, 0.95)
          const sold = Math.min(
            maxQty,
            Math.round((maxQty * burn * minutesTrading) / ((endsAt - doorsAt) / MIN)),
          )
          push('sale', sold, now - r.int(2, 30) * MIN, ['kiosk', kiosk.id], ['sold', null], 'till-export', `Z-${kiosk.code}`)
        }
      }
    }

    /* ---- declared sales on the reconciled fixture ---- */
    if (fixture.status === 'reconciled') {
      const itemsById = new Map(items.map((i) => [i.id, i]))
      for (const allocation of out.kioskAllocations.filter((a) => a.eventId === eventId)) {
        const sold = out.movements.filter(
          (m) => m.eventId === eventId && m.kind === 'sale' && m.toId === null && m.fromId === allocation.kioskId,
        )
        const ledgerCents = sold.reduce(
          (s, m) => s + m.qty * (itemsById.get(m.itemId)?.unitPriceCents ?? 0),
          0,
        )
        // Most vendors declare what the till says; the suspended one declares
        // rather less, which is why they are suspended.
        const factor = allocation.vendorId === 'vendor-v-oldtn' ? r.float(0.86, 0.93) : 1
        allocation.declaredSalesCents = Math.round(ledgerCents * factor)
      }
    }

    /* ---- load runs ---- */
    if (fixture.status === 'live') {
      buildLiveRuns({ out, r, eventId, now, allocated, vendorByKiosk, items, spotByVendorItem, crews, runSeq: () => ++runSeq })
    }

    if (fixture.status === 'reconciled') {
      // A night's worth of completed runs, so the SLA report has something to
      // say. A handful missed their window, as they always do.
      for (const kiosk of allocated.slice(0, 40)) {
        const vendorId = vendorByKiosk.get(kiosk.id)
        if (!vendorId) continue
        const stocked = itemsFor(kiosk.kind, items)
        const item = stocked[r.int(0, Math.max(0, stocked.length - 1))]
        if (!item) continue

        const priority = r.pick(['routine', 'urgent', 'urgent', 'critical'] as const)
        const requestedAt = fixture.kickOff + r.int(-40, 90) * MIN
        const slaMinutes = SLA_MINUTES[priority]
        const took = r.chance(0.18) ? slaMinutes + r.int(4, 30) : r.int(4, slaMinutes - 2)

        out.loadRuns.push({
          id: `run-${++runSeq}`,
          code: `LR-${String(runSeq).padStart(4, '0')}`,
          eventId,
          kioskId: kiosk.id,
          itemId: item.id,
          vendorId,
          qty: item.packSize * r.int(2, 6),
          qtyDelivered: item.packSize * r.int(2, 6),
          priority,
          status: 'confirmed',
          fromSpotId: spotByVendorItem.get(`${vendorId}:${item.requiresChill ? 'chilled' : 'dry'}`) ?? null,
          crewId: r.pick(crews).id,
          requestedBy: `${kiosk.code} supervisor`,
          slaMinutes,
          requestedAt,
          assignedAt: requestedAt + r.int(1, 4) * MIN,
          pickedAt: requestedAt + r.int(3, 8) * MIN,
          deliveredAt: requestedAt + took * MIN,
          confirmedAt: requestedAt + (took + r.int(1, 4)) * MIN,
          cancelledReason: null,
          note: null,
        })
      }
    }

    /* ---- incidents ---- */
    if (fixture.status === 'live' || fixture.status === 'reconciled') {
      const incidentPlans: Array<[Incident['kind'], Incident['severity'], string]> = [
        ['stock_out', 'high', 'Draught lager ran dry at half time — queue abandoned'],
        ['equipment', 'medium', 'Fryer thermostat failed, hot food suspended'],
        ['spillage', 'low', 'Crate of cans dropped in the service corridor'],
        ['hygiene', 'medium', 'Hand-wash basin at the counter not running'],
        ['staffing', 'medium', 'Two cashiers did not arrive for the shift'],
        ['gas', 'critical', 'Smell of gas reported near the grill — cylinder isolated'],
      ]

      const count = fixture.status === 'live' ? 4 : 6
      for (let i = 0; i < count; i++) {
        const plan = incidentPlans[i % incidentPlans.length]!
        const kiosk = r.pick(allocated)
        const at = fixture.status === 'live' ? now - r.int(5, 110) * MIN : fixture.kickOff + r.int(-30, 100) * MIN
        const resolved = fixture.status === 'reconciled' || r.chance(0.45)

        out.incidents.push({
          id: `inc-${eventId}-${i}`,
          eventId,
          kind: plan[0],
          severity: plan[1],
          kioskId: kiosk?.id ?? null,
          roomId: null,
          vendorId: kiosk ? (vendorByKiosk.get(kiosk.id) ?? null) : null,
          description: plan[2],
          reportedBy: `${kiosk?.code ?? 'Control'} supervisor`,
          at,
          resolvedAt: resolved ? at + r.int(8, 50) * MIN : null,
          resolution: resolved ? 'Resolved on shift' : null,
        })
      }
    }

    /* ---- accreditation ---- */
    if (fixture.status !== 'planned') {
      const tradingVendors = new Set(vendorByKiosk.values())
      const eligible = staff.filter((s) => s.active && tradingVendors.has(s.vendorId))

      for (const person of eligible) {
        const onSite = fixture.status === 'live' ? r.chance(0.88) : false
        out.accreditations.push({
          id: `acc-${eventId}-${person.id}`,
          eventId,
          staffId: person.id,
          passCode: `P${String(++accreditationSeq).padStart(5, '0')}`,
          zones: ['L0-BOH', 'L1-N', 'L1-E', 'L1-S', 'L1-W'],
          status:
            fixture.status === 'reconciled'
              ? 'departed'
              : fixture.status === 'live'
                ? onSite
                  ? 'on_site'
                  : 'collected'
                : 'issued',
          checkedInAt: fixture.status === 'reconciled' ? doorsAt - 3 * HOUR : onSite ? doorsAt - r.int(60, 200) * MIN : null,
          checkedOutAt: fixture.status === 'reconciled' ? endsAt + 2 * HOUR : null,
        })
      }
    }
  }

  // Crews are on shift for the live fixture.
  for (const crew of crews) {
    out.crewUpdates.push({
      id: crew.id,
      status: r.chance(0.72) ? 'on_run' : r.chance(0.8) ? 'available' : 'break',
    })
  }

  return out
}

/**
 * The live dispatch queue.
 *
 * Built to look like a real one at 50 minutes in: a couple of runs sitting
 * unassigned past their window (which is what a dispatcher is shouting about),
 * several out with crews, some delivered but not yet signed for, and a tail of
 * completed work behind them.
 */
function buildLiveRuns(input: {
  out: EventData
  r: Rng
  eventId: string
  now: number
  allocated: readonly Kiosk[]
  vendorByKiosk: ReadonlyMap<string, string>
  items: readonly StockItem[]
  spotByVendorItem: ReadonlyMap<string, string>
  crews: readonly Crew[]
  runSeq: () => number
}) {
  const { out, r, eventId, now, allocated, vendorByKiosk, items, spotByVendorItem, crews, runSeq } =
    input

  // status, how many minutes ago it was raised, priority
  const plan: Array<[LoadRun['status'], number, LoadRun['priority']]> = [
    ['requested', 26, 'critical'], // breaching: 26 min on a 10 min window
    ['requested', 17, 'urgent'], // breaching
    ['requested', 6, 'urgent'],
    ['requested', 3, 'routine'],
    ['assigned', 14, 'urgent'],
    ['assigned', 8, 'critical'],
    ['picking', 11, 'urgent'],
    ['picking', 5, 'routine'],
    ['in_transit', 16, 'urgent'],
    ['in_transit', 9, 'critical'],
    ['in_transit', 7, 'routine'],
    ['delivered', 21, 'urgent'],
    ['delivered', 13, 'routine'],
    ['confirmed', 38, 'urgent'],
    ['confirmed', 47, 'routine'],
    ['confirmed', 55, 'critical'],
    ['confirmed', 62, 'urgent'],
    ['confirmed', 74, 'routine'],
    ['cancelled', 33, 'routine'],
  ]

  const busy = allocated.filter((k) => k.kind === 'beverage' || k.kind === 'combo')

  for (const [i, [status, ageMin, priority]] of plan.entries()) {
    const kiosk = busy[i % busy.length] ?? allocated[i % allocated.length]
    if (!kiosk) continue

    const vendorId = vendorByKiosk.get(kiosk.id)
    if (!vendorId) continue

    const stocked = items.filter(
      (it) => it.unitPriceCents > 0 && (it.category === 'beer' || it.category === 'soft_drink' || it.category === 'water'),
    )
    const item = stocked[i % stocked.length]
    if (!item) continue

    const requestedAt = now - ageMin * MIN
    const qty = item.packSize * r.int(2, 8)
    const slaMinutes = SLA_MINUTES[priority]

    // Each stamp only exists once the run has actually reached that step.
    const reached = (step: LoadRun['status']) => {
      const order: LoadRun['status'][] = [
        'requested',
        'assigned',
        'picking',
        'in_transit',
        'delivered',
        'confirmed',
      ]
      return order.indexOf(status) >= order.indexOf(step)
    }

    const assignedAt = reached('assigned') ? requestedAt + r.int(1, 3) * MIN : null
    const pickedAt = reached('picking') ? requestedAt + r.int(3, 6) * MIN : null
    const deliveredAt = reached('delivered') ? requestedAt + r.int(7, Math.max(8, ageMin - 1)) * MIN : null
    const confirmedAt = reached('confirmed') && deliveredAt ? deliveredAt + r.int(1, 4) * MIN : null

    const seq = runSeq()
    out.loadRuns.push({
      id: `run-${seq}`,
      code: `LR-${String(seq).padStart(4, '0')}`,
      eventId,
      kioskId: kiosk.id,
      itemId: item.id,
      vendorId,
      qty,
      qtyDelivered: deliveredAt ? (r.chance(0.15) ? qty - item.packSize : qty) : null,
      priority,
      status,
      fromSpotId: spotByVendorItem.get(`${vendorId}:${item.requiresChill ? 'chilled' : 'dry'}`) ?? null,
      crewId: status === 'requested' ? null : r.pick(crews).id,
      requestedBy: `${kiosk.code} supervisor`,
      slaMinutes,
      requestedAt,
      assignedAt,
      pickedAt,
      deliveredAt,
      confirmedAt,
      cancelledReason: status === 'cancelled' ? 'Counter closed early — crowd moved to the south' : null,
      note: priority === 'critical' ? 'Counter is dry' : null,
    })
  }
}
