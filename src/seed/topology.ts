/**
 * The building.
 *
 * FNB Stadium — the Calabash — seats 94 736 across a lower tier, a suite ring
 * and an upper tier, on the Nasrec side of Johannesburg. The layout below is a
 * faithful *operational* model of that: four quadrants per concourse level,
 * blocks sized to add up to the real capacity, and counters and stores placed
 * where a stadium of that shape puts them.
 *
 * It is not a survey drawing. Block numbering and room codes follow the
 * conventions a venue this size uses; swap them for the real asset register
 * when one is to hand — everything downstream reads codes, not positions.
 */
import type {
  Block,
  Compass,
  HaulRoute,
  Kiosk,
  KioskKind,
  Level,
  RoomClass,
  SpotKind,
  StorageRoom,
  StorageSpot,
  Zone,
} from '@/db/schema'
import { rng } from './rng'

export type Topology = {
  levels: Level[]
  zones: Zone[]
  blocks: Block[]
  kiosks: Kiosk[]
  rooms: StorageRoom[]
  spots: StorageSpot[]
  routes: HaulRoute[]
}

const QUADRANTS: { sector: Compass; name: string }[] = [
  { sector: 'N', name: 'North' },
  { sector: 'E', name: 'East' },
  { sector: 'S', name: 'South' },
  { sector: 'W', name: 'West' },
]

export function buildTopology(): Topology {
  const r = rng(20100711) // the date of the World Cup final played here
  const levels: Level[] = [
    {
      id: 'lvl-0',
      code: 'L0',
      name: 'Pitch & Service',
      description: 'Tunnel, service road, main receiving and bulk stores. Staff only.',
      sort: 0,
    },
    {
      id: 'lvl-1',
      code: 'L1',
      name: 'Lower Concourse',
      description: 'Lower-tier public concourse. The busiest trading level.',
      sort: 1,
    },
    {
      id: 'lvl-2',
      code: 'L2',
      name: 'Suite Level',
      description: 'Hospitality suites, club lounges and their service corridor.',
      sort: 2,
    },
    {
      id: 'lvl-3',
      code: 'L3',
      name: 'Upper Concourse',
      description: 'Upper-tier public concourse. Longest haul from the stores.',
      sort: 3,
    },
    {
      id: 'lvl-p',
      code: 'PE',
      name: 'Perimeter',
      description: 'Outside the bowl: fan park, gates and vehicle marshalling.',
      sort: 4,
    },
  ]

  const zones: Zone[] = []
  const blocks: Block[] = []
  const kiosks: Kiosk[] = []
  const rooms: StorageRoom[] = []
  const spots: StorageSpot[] = []
  const routes: HaulRoute[] = []

  /* ---- Level 0: back of house ---- */
  zones.push({
    id: 'zone-l0-boh',
    code: 'L0-BOH',
    name: 'L0 Back of House',
    levelId: 'lvl-0',
    kind: 'back_of_house',
    sector: 'ALL',
  })
  zones.push({
    id: 'zone-l0-pitch',
    code: 'L0-PITCH',
    name: 'Pitch',
    levelId: 'lvl-0',
    kind: 'pitch',
    sector: 'ALL',
  })

  /* ---- Level 1 and 3: public concourses, four quadrants each ---- */
  for (const level of ['lvl-1', 'lvl-3'] as const) {
    const code = level === 'lvl-1' ? 'L1' : 'L3'
    for (const q of QUADRANTS) {
      zones.push({
        id: `zone-${code.toLowerCase()}-${q.sector.toLowerCase()}`,
        code: `${code}-${q.sector}`,
        name: `${code} ${q.name}`,
        levelId: level,
        kind: 'concourse',
        sector: q.sector,
      })
    }
  }

  /* ---- Level 2: hospitality, split east/west like the suite ring ---- */
  for (const q of [QUADRANTS[1]!, QUADRANTS[3]!]) {
    zones.push({
      id: `zone-l2-${q.sector.toLowerCase()}`,
      code: `L2-${q.sector}`,
      name: `L2 ${q.name} Suites`,
      levelId: 'lvl-2',
      kind: 'hospitality',
      sector: q.sector,
    })
  }

  /* ---- Perimeter ---- */
  zones.push({
    id: 'zone-pe-fanpark',
    code: 'PE-FP',
    name: 'Fan Park',
    levelId: 'lvl-p',
    kind: 'perimeter',
    sector: 'ALL',
  })

  /* ------------------------------------------------------------------ *
   * Blocks — sized so the tiers add up to 94 736.
   * Lower 32 640 + upper 57 096 + suites 5 000 = 94 736.
   * ------------------------------------------------------------------ */

  // Lower tier: blocks 1–48, twelve per quadrant.
  let lowerSeatsLeft = 32_640
  let lowerBlocksLeft = 48
  for (let i = 0; i < 48; i++) {
    const q = QUADRANTS[Math.floor(i / 12)]!
    const remainingAvg = lowerSeatsLeft / lowerBlocksLeft
    const seats =
      lowerBlocksLeft === 1 ? lowerSeatsLeft : Math.round(remainingAvg + r.int(-60, 60))
    lowerSeatsLeft -= seats
    lowerBlocksLeft--

    blocks.push({
      id: `block-${i + 1}`,
      code: String(i + 1).padStart(2, '0'),
      zoneId: `zone-l1-${q.sector.toLowerCase()}`,
      tier: 'lower',
      seats,
    })
  }

  // Upper tier: blocks 101–160, fifteen per quadrant.
  let upperSeatsLeft = 57_096
  let upperBlocksLeft = 60
  for (let i = 0; i < 60; i++) {
    const q = QUADRANTS[Math.floor(i / 15)]!
    const remainingAvg = upperSeatsLeft / upperBlocksLeft
    const seats =
      upperBlocksLeft === 1 ? upperSeatsLeft : Math.round(remainingAvg + r.int(-90, 90))
    upperSeatsLeft -= seats
    upperBlocksLeft--

    blocks.push({
      id: `block-${101 + i}`,
      code: String(101 + i),
      zoneId: `zone-l3-${q.sector.toLowerCase()}`,
      tier: 'upper',
      seats,
    })
  }

  // Suite ring: 195 suites, averaging just under 26 seats.
  for (const [idx, q] of [QUADRANTS[1]!, QUADRANTS[3]!].entries()) {
    blocks.push({
      id: `block-suite-${q.sector.toLowerCase()}`,
      code: `SUITE-${q.sector}`,
      zoneId: `zone-l2-${q.sector.toLowerCase()}`,
      tier: 'suite',
      seats: idx === 0 ? 2560 : 2440,
    })
  }

  /* ------------------------------------------------------------------ *
   * Kiosks
   * ------------------------------------------------------------------ */

  const FITOUT: Record<KioskKind, string[]> = {
    beverage: ['chest coolers', 'draught taps', 'ice well'],
    food: ['griddle', 'fryer', 'bain-marie', 'warming cabinet'],
    combo: ['griddle', 'fryer', 'chest coolers', 'ice well'],
    coffee: ['espresso machine', 'water urn', 'milk fridge'],
    merchandise: ['display racking', 'hanging rail'],
    premium: ['plated service pass', 'wine fridge', 'ice well'],
  }

  const blocksByZone = new Map<string, Block[]>()
  for (const b of blocks) {
    const list = blocksByZone.get(b.zoneId)
    if (list) list.push(b)
    else blocksByZone.set(b.zoneId, [b])
  }

  const addKiosk = (
    levelCode: string,
    sector: Compass,
    n: number,
    kind: KioskKind,
    servesBlocks: string[],
  ) => {
    const zoneId = `zone-${levelCode.toLowerCase()}-${sector.toLowerCase()}`
    const tills = kind === 'premium' ? 2 : kind === 'merchandise' ? 2 : r.int(3, 6)
    // A beverage counter serves faster than one plating hot food.
    const perTill = kind === 'beverage' ? 85 : kind === 'coffee' ? 55 : kind === 'food' ? 45 : 60
    const code = `K-${levelCode}-${String(n).padStart(3, '0')}`

    kiosks.push({
      id: `kiosk-${code.toLowerCase()}`,
      code,
      name: `${levelCode} ${sector} ${titleFor(kind)} ${n}`,
      zoneId,
      kind,
      tills,
      fitout: FITOUT[kind],
      throughputPerHour: tills * perTill,
      servesBlocks,
      hasGas: kind === 'food' || kind === 'combo',
      hasWater: kind !== 'merchandise',
      status: 'active',
      notes: null,
    })
  }

  // Lower concourse: ten counters per quadrant, mixed.
  let kioskNo = 1
  for (const q of QUADRANTS) {
    const zoneBlocks = blocksByZone.get(`zone-l1-${q.sector.toLowerCase()}`) ?? []
    const plan: KioskKind[] = [
      'beverage',
      'combo',
      'food',
      'beverage',
      'combo',
      'beverage',
      'food',
      'coffee',
      'combo',
      'merchandise',
    ]
    for (const [i, kind] of plan.entries()) {
      // Each counter is the nearest one for two or three blocks.
      const serves = zoneBlocks
        .slice(Math.floor((i * zoneBlocks.length) / plan.length), Math.floor(((i + 1) * zoneBlocks.length) / plan.length) + 1)
        .map((b) => b.code)
      addKiosk('L1', q.sector, kioskNo++, kind, serves)
    }
  }

  // Upper concourse: nine per quadrant — a longer haul, so fewer, bigger.
  kioskNo = 1
  for (const q of QUADRANTS) {
    const zoneBlocks = blocksByZone.get(`zone-l3-${q.sector.toLowerCase()}`) ?? []
    const plan: KioskKind[] = [
      'beverage',
      'combo',
      'beverage',
      'food',
      'combo',
      'beverage',
      'combo',
      'coffee',
      'merchandise',
    ]
    for (const [i, kind] of plan.entries()) {
      const serves = zoneBlocks
        .slice(Math.floor((i * zoneBlocks.length) / plan.length), Math.floor(((i + 1) * zoneBlocks.length) / plan.length) + 1)
        .map((b) => b.code)
      addKiosk('L3', q.sector, kioskNo++, kind, serves)
    }
  }

  // Suite level: service points, not public counters.
  kioskNo = 1
  for (const q of [QUADRANTS[1]!, QUADRANTS[3]!]) {
    for (let i = 0; i < 5; i++) {
      addKiosk('L2', q.sector, kioskNo++, 'premium', [`SUITE-${q.sector}`])
    }
  }

  // Fan park, outside the turnstiles.
  for (let i = 1; i <= 6; i++) {
    kiosks.push({
      id: `kiosk-k-pe-${String(i).padStart(3, '0')}`,
      code: `K-PE-${String(i).padStart(3, '0')}`,
      name: `Fan Park ${i}`,
      zoneId: 'zone-pe-fanpark',
      kind: i <= 4 ? 'beverage' : 'combo',
      tills: 4,
      fitout: FITOUT[i <= 4 ? 'beverage' : 'combo'],
      throughputPerHour: 4 * 80,
      servesBlocks: [],
      hasGas: i > 4,
      hasWater: true,
      status: 'active',
      notes: 'Trades from gates-open to kick-off only.',
    })
  }

  // One counter out of service, because there always is one.
  const broken = kiosks.find((k) => k.code === 'K-L3-004')
  if (broken) {
    broken.status = 'maintenance'
    broken.notes = 'Fryer extraction failed inspection — closed pending repair.'
  }

  /* ------------------------------------------------------------------ *
   * Storage rooms and spots
   * ------------------------------------------------------------------ */

  const roomPlan: Array<{
    code: string
    name: string
    zoneId: string
    class: RoomClass
    areaSqm: number
    tempMinC?: number
    tempMaxC?: number
    security?: StorageRoom['security']
    keyholder: string
    spots: Array<{ kind: SpotKind; count: number; capacity: number; unit: StorageSpot['unit'] }>
  }> = [
    {
      code: 'MR1',
      name: 'Main Receiving',
      zoneId: 'zone-l0-boh',
      class: 'dry',
      areaSqm: 420,
      security: 'alarmed',
      keyholder: 'Logistics Manager',
      spots: [
        { kind: 'pallet_bay', count: 24, capacity: 4, unit: 'pallet' },
        { kind: 'floor_spot', count: 12, capacity: 20, unit: 'crate' },
      ],
    },
    {
      code: 'CR1',
      name: 'Cold Room 1',
      zoneId: 'zone-l0-boh',
      class: 'chilled',
      areaSqm: 96,
      tempMinC: 1,
      tempMaxC: 5,
      keyholder: 'F&B Manager',
      spots: [
        { kind: 'pallet_bay', count: 10, capacity: 3, unit: 'pallet' },
        { kind: 'chiller_rack', count: 8, capacity: 12, unit: 'crate' },
      ],
    },
    {
      code: 'CR2',
      name: 'Cold Room 2',
      zoneId: 'zone-l0-boh',
      class: 'chilled',
      areaSqm: 96,
      tempMinC: 1,
      tempMaxC: 5,
      keyholder: 'F&B Manager',
      spots: [
        { kind: 'pallet_bay', count: 10, capacity: 3, unit: 'pallet' },
        { kind: 'chiller_rack', count: 8, capacity: 12, unit: 'crate' },
      ],
    },
    {
      code: 'FZ1',
      name: 'Freezer Store',
      zoneId: 'zone-l0-boh',
      class: 'frozen',
      areaSqm: 64,
      tempMinC: -22,
      tempMaxC: -18,
      keyholder: 'F&B Manager',
      spots: [
        { kind: 'pallet_bay', count: 6, capacity: 2, unit: 'pallet' },
        { kind: 'shelf', count: 10, capacity: 6, unit: 'shelf_m' },
      ],
    },
    {
      code: 'BV1',
      name: 'Beverage Store',
      zoneId: 'zone-l0-boh',
      class: 'beverage',
      areaSqm: 180,
      security: 'caged',
      keyholder: 'Beverage Controller',
      spots: [
        { kind: 'pallet_bay', count: 18, capacity: 4, unit: 'pallet' },
        { kind: 'cage', count: 6, capacity: 10, unit: 'keg' },
      ],
    },
    {
      code: 'GS1',
      name: 'Gas Cage',
      zoneId: 'zone-l0-boh',
      class: 'gas',
      areaSqm: 24,
      security: 'caged',
      keyholder: 'Safety Officer',
      spots: [{ kind: 'cage', count: 4, capacity: 12, unit: 'crate' }],
    },
    {
      code: 'MD1',
      name: 'Merchandise Store',
      zoneId: 'zone-l0-boh',
      class: 'merchandise',
      areaSqm: 110,
      security: 'alarmed',
      keyholder: 'Retail Manager',
      spots: [
        { kind: 'shelf', count: 16, capacity: 8, unit: 'shelf_m' },
        { kind: 'cage', count: 4, capacity: 12, unit: 'crate' },
      ],
    },
    {
      code: 'WS1',
      name: 'Waste Marshalling',
      zoneId: 'zone-l0-boh',
      class: 'waste',
      areaSqm: 140,
      security: 'open',
      keyholder: 'Cleaning Supervisor',
      spots: [{ kind: 'floor_spot', count: 8, capacity: 30, unit: 'crate' }],
    },
  ]

  // Satellite stores on each public level, one per quadrant.
  for (const levelCode of ['L1', 'L3'] as const) {
    for (const q of QUADRANTS) {
      roomPlan.push({
        code: `${levelCode}S-${q.sector}`,
        name: `${levelCode} ${q.name} Satellite`,
        zoneId: `zone-${levelCode.toLowerCase()}-${q.sector.toLowerCase()}`,
        class: q.sector === 'N' || q.sector === 'S' ? 'chilled' : 'dry',
        areaSqm: 38,
        tempMinC: q.sector === 'N' || q.sector === 'S' ? 2 : undefined,
        tempMaxC: q.sector === 'N' || q.sector === 'S' ? 6 : undefined,
        keyholder: `${levelCode} ${q.name} Supervisor`,
        spots: [
          { kind: 'pallet_bay', count: 4, capacity: 2, unit: 'pallet' },
          { kind: 'trolley_park', count: 4, capacity: 6, unit: 'crate' },
        ],
      })
    }
  }

  roomPlan.push({
    code: 'L2S-E',
    name: 'L2 Hospitality Pantry',
    zoneId: 'zone-l2-e',
    class: 'chilled',
    areaSqm: 44,
    tempMinC: 2,
    tempMaxC: 6,
    keyholder: 'Hospitality Manager',
    spots: [
      { kind: 'chiller_rack', count: 8, capacity: 8, unit: 'crate' },
      { kind: 'shelf', count: 6, capacity: 5, unit: 'shelf_m' },
    ],
  })

  const AISLES = ['A', 'B', 'C', 'D', 'E', 'F']

  for (const plan of roomPlan) {
    const roomId = `room-${plan.code.toLowerCase()}`
    rooms.push({
      id: roomId,
      code: plan.code,
      name: plan.name,
      zoneId: plan.zoneId,
      class: plan.class,
      tempMinC: plan.tempMinC ?? null,
      tempMaxC: plan.tempMaxC ?? null,
      areaSqm: plan.areaSqm,
      security: plan.security ?? 'locked',
      keyholder: plan.keyholder,
      status: 'active',
      notes: null,
    })

    let n = 0
    for (const group of plan.spots) {
      for (let i = 0; i < group.count; i++) {
        const aisle = AISLES[Math.floor(n / 8) % AISLES.length] as string
        const position = (n % 8) + 1
        const code = `${plan.code}-${aisle}-${String(position).padStart(2, '0')}`
        spots.push({
          id: `spot-${code.toLowerCase()}`,
          code,
          roomId,
          kind: group.kind,
          capacityUnits: group.capacity,
          unit: group.unit,
          status: 'available',
        })
        n++
      }
    }
  }

  // A bay out of service, so the storage screen has a real edge case in it.
  const deadSpot = spots.find((s) => s.code === 'CR1-B-03')
  if (deadSpot) deadSpot.status = 'out_of_service'

  /* ------------------------------------------------------------------ *
   * Haul routes — every kiosk gets a route from the bulk stores and from
   * its own level's satellite. Times reflect the real problem: the upper
   * concourse is a long way from the cold rooms.
   * ------------------------------------------------------------------ */

  const bulkRooms = ['room-mr1', 'room-cr1', 'room-cr2', 'room-bv1', 'room-fz1', 'room-md1']
  const zoneById = new Map(zones.map((z) => [z.id, z]))

  for (const kiosk of kiosks) {
    const zone = zoneById.get(kiosk.zoneId)
    if (!zone) continue
    const levelSort = levels.find((l) => l.id === zone.levelId)?.sort ?? 0

    for (const roomId of bulkRooms) {
      // Base walk plus a climb penalty per level, plus quadrant spread.
      const climb = levelSort * 5
      const spread = r.int(0, 4)
      const minutes = 4 + climb + spread
      routes.push({
        id: `route-${roomId}-${kiosk.id}`,
        roomId,
        kioskId: kiosk.id,
        meters: minutes * 62,
        minutes,
        via:
          levelSort >= 2
            ? `Service lift ${r.int(1, 4)}, ${zone.name} corridor`
            : `Ramp ${r.pick(['A', 'B', 'C'])}, ${zone.name} corridor`,
        stepFree: true,
      })
    }

    // The satellite on the kiosk's own level and quadrant — the short hop
    // that makes upper-tier trading possible at all.
    const satelliteCode =
      zone.kind === 'concourse'
        ? `${levels.find((l) => l.id === zone.levelId)?.code}S-${zone.sector}`
        : zone.kind === 'hospitality'
          ? 'L2S-E'
          : null

    if (satelliteCode) {
      const satellite = rooms.find((room) => room.code === satelliteCode)
      if (satellite) {
        const minutes = r.int(2, 4)
        routes.push({
          id: `route-${satellite.id}-${kiosk.id}`,
          roomId: satellite.id,
          kioskId: kiosk.id,
          meters: minutes * 58,
          minutes,
          via: `${zone.name} concourse`,
          stepFree: true,
        })
      }
    }
  }

  return { levels, zones, blocks, kiosks, rooms, spots, routes }
}

function titleFor(kind: KioskKind): string {
  switch (kind) {
    case 'beverage':
      return 'Bar'
    case 'food':
      return 'Grill'
    case 'combo':
      return 'Kiosk'
    case 'coffee':
      return 'Coffee'
    case 'merchandise':
      return 'Merch'
    case 'premium':
      return 'Suite Pass'
  }
}
