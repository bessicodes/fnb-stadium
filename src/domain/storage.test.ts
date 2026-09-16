import { describe, expect, it } from 'vitest'

import type { StockItem, StorageAllocation, StorageRoom, StorageSpot } from '@/db/schema'
import {
  checkItemFitsRoom,
  checkStorageAllocation,
  isColdRoom,
  roomUsage,
  spotUsage,
  suggestSpots,
} from './storage'

function spot(over: Partial<StorageSpot> = {}): StorageSpot {
  return {
    id: 'spot-1',
    code: 'CR2-A-01',
    roomId: 'room-1',
    kind: 'pallet_bay',
    capacityUnits: 4,
    unit: 'pallet',
    status: 'available',
    ...over,
  }
}

function room(over: Partial<StorageRoom> = {}): StorageRoom {
  return {
    id: 'room-1',
    code: 'CR2',
    name: 'Cold Room 2',
    zoneId: 'z-1',
    class: 'chilled',
    tempMinC: 2,
    tempMaxC: 6,
    areaSqm: 48,
    security: 'locked',
    keyholder: 'Ops',
    status: 'active',
    notes: null,
    ...over,
  }
}

function alloc(over: Partial<StorageAllocation> = {}): StorageAllocation {
  return {
    id: 'alloc-1',
    eventId: 'ev-1',
    spotId: 'spot-1',
    vendorId: 'v-1',
    unitsAllocated: 2,
    notes: null,
    ...over,
  }
}

function item(over: Partial<StockItem> = {}): StockItem {
  return {
    id: 'i-1',
    sku: 'BEER-CASTLE-440',
    name: 'Castle Lager 440ml',
    category: 'beer',
    caseUnit: 'case',
    packSize: 24,
    unitWeightKg: 0.46,
    requiresChill: true,
    unitCostCents: 1150,
    unitPriceCents: 3500,
    active: true,
    ...over,
  }
}

describe('spotUsage', () => {
  it('reports free space against capacity', () => {
    const [usage] = spotUsage([spot({ capacityUnits: 4 })], [alloc({ unitsAllocated: 3 })])

    expect(usage).toMatchObject({ allocatedUnits: 3, freeUnits: 1, utilisation: 0.75 })
  })

  it('returns untouched spots so free space is visible', () => {
    const usage = spotUsage([spot({ id: 'a' }), spot({ id: 'b' })], [])

    expect(usage).toHaveLength(2)
    expect(usage.every((u) => u.allocatedUnits === 0)).toBe(true)
  })

  it('never reports negative free space on an oversubscribed bay', () => {
    const [usage] = spotUsage([spot({ capacityUnits: 2 })], [alloc({ unitsAllocated: 5 })])

    expect(usage?.freeUnits).toBe(0)
    expect(usage?.utilisation).toBeGreaterThan(1)
  })

  it('lists every vendor holding part of a spot', () => {
    const [usage] = spotUsage(
      [spot({ capacityUnits: 10 })],
      [alloc({ id: 'a', vendorId: 'v-1' }), alloc({ id: 'b', vendorId: 'v-2' })],
    )

    expect(usage?.vendorIds).toEqual(['v-1', 'v-2'])
  })

  it('does not divide by zero on a zero-capacity spot', () => {
    const [usage] = spotUsage([spot({ capacityUnits: 0 })], [])
    expect(usage?.utilisation).toBe(0)
  })
})

describe('roomUsage', () => {
  it('rolls spots up into their room', () => {
    const spots = [
      spot({ id: 's1', capacityUnits: 4 }),
      spot({ id: 's2', capacityUnits: 6 }),
    ]
    const allocations = [alloc({ spotId: 's1', unitsAllocated: 4 })]

    const [usage] = roomUsage([room()], spots, allocations)

    expect(usage).toMatchObject({ spots: 2, capacityUnits: 10, allocatedUnits: 4, freeSpots: 1 })
  })

  it('reports an empty room rather than omitting it', () => {
    const [usage] = roomUsage([room()], [], [])
    expect(usage).toMatchObject({ spots: 0, capacityUnits: 0, utilisation: 0 })
  })
})

describe('checkStorageAllocation', () => {
  const base = { spot: spot(), room: room(), vendorId: 'v-1', existing: [] as StorageAllocation[] }

  it('allows a request that fits an empty bay', () => {
    const result = checkStorageAllocation({ ...base, unitsRequested: 2 })
    expect(result.allowed).toBe(true)
  })

  it('refuses a bay already let to somebody else', () => {
    const result = checkStorageAllocation({
      ...base,
      unitsRequested: 1,
      existing: [alloc({ vendorId: 'v-2', unitsAllocated: 1 })],
    })

    expect(result.allowed).toBe(false)
    expect(result.problems.map((p) => p.message).join(' ')).toContain('already let')
  })

  it('lets the same vendor add to their own bay', () => {
    const result = checkStorageAllocation({
      ...base,
      unitsRequested: 1,
      existing: [alloc({ vendorId: 'v-1', unitsAllocated: 2 })],
    })

    expect(result.allowed).toBe(true)
  })

  it('refuses more than the bay holds', () => {
    const result = checkStorageAllocation({ ...base, unitsRequested: 5 })

    expect(result.allowed).toBe(false)
    expect(result.problems.map((p) => p.message).join(' ')).toContain('holds 4 pallet')
  })

  it('warns, but allows, filling a bay exactly', () => {
    const result = checkStorageAllocation({ ...base, unitsRequested: 4 })

    expect(result.allowed).toBe(true)
    expect(result.problems[0]?.severity).toBe('warning')
  })

  it('ignores the row being edited when re-checking it', () => {
    const existing = [alloc({ id: 'mine', vendorId: 'v-1', unitsAllocated: 4 })]

    expect(
      checkStorageAllocation({ ...base, unitsRequested: 4, existing }).allowed,
    ).toBe(false)
    expect(
      checkStorageAllocation({ ...base, unitsRequested: 4, existing, replacingId: 'mine' })
        .allowed,
    ).toBe(true)
  })

  it('refuses a spot that is out of service', () => {
    const result = checkStorageAllocation({
      ...base,
      spot: spot({ status: 'out_of_service' }),
      unitsRequested: 1,
    })

    expect(result.allowed).toBe(false)
  })

  it('refuses a room that is closed', () => {
    const result = checkStorageAllocation({
      ...base,
      room: room({ status: 'closed' }),
      unitsRequested: 1,
    })

    expect(result.allowed).toBe(false)
  })

  it('refuses an allocation of nothing', () => {
    expect(checkStorageAllocation({ ...base, unitsRequested: 0 }).allowed).toBe(false)
  })
})

describe('checkItemFitsRoom', () => {
  it('blocks chilled stock in a dry store', () => {
    const result = checkItemFitsRoom(item({ requiresChill: true }), room({ class: 'dry' }))

    expect(result.allowed).toBe(false)
    expect(result.problems[0]?.message).toContain('needs refrigeration')
  })

  it('allows chilled stock in a cold room', () => {
    expect(checkItemFitsRoom(item({ requiresChill: true }), room({ class: 'chilled' })).allowed).toBe(
      true,
    )
  })

  it('warns about wasting freezer space on ambient stock', () => {
    const result = checkItemFitsRoom(item({ requiresChill: false }), room({ class: 'frozen' }))

    expect(result.allowed).toBe(true)
    expect(result.problems[0]?.severity).toBe('warning')
  })

  it('warns about merchandise going damp in a cold room', () => {
    const result = checkItemFitsRoom(
      item({ category: 'merchandise', requiresChill: false }),
      room({ class: 'chilled' }),
    )

    expect(result.problems.map((p) => p.message).join(' ')).toContain('damp')
  })

  it('knows which classes are cold', () => {
    expect(isColdRoom(room({ class: 'frozen' }))).toBe(true)
    expect(isColdRoom(room({ class: 'chilled' }))).toBe(true)
    expect(isColdRoom(room({ class: 'dry' }))).toBe(false)
  })
})

describe('suggestSpots', () => {
  const rooms = [
    room({ id: 'cold', class: 'chilled' }),
    room({ id: 'dry', class: 'dry' }),
    room({ id: 'shut', class: 'chilled', status: 'closed' }),
  ]

  const spots = [
    spot({ id: 'big', roomId: 'cold', capacityUnits: 12 }),
    spot({ id: 'snug', roomId: 'cold', capacityUnits: 3 }),
    spot({ id: 'dry-bay', roomId: 'dry', capacityUnits: 8 }),
    spot({ id: 'shut-bay', roomId: 'shut', capacityUnits: 8 }),
  ]

  const usage = spotUsage(spots, [])

  it('offers only cold bays for stock that needs chilling', () => {
    const suggestions = suggestSpots({
      spots,
      rooms,
      usage,
      unitsNeeded: 2,
      requiresChill: true,
    })

    expect(suggestions.map((s) => s.spot.id)).toEqual(['snug', 'big'])
  })

  it('offers the tightest bay that fits, to keep big bays free', () => {
    const suggestions = suggestSpots({
      spots,
      rooms,
      usage,
      unitsNeeded: 2,
      requiresChill: false,
    })

    expect(suggestions[0]?.spot.id).toBe('snug')
  })

  it('skips bays that are too small', () => {
    const suggestions = suggestSpots({
      spots,
      rooms,
      usage,
      unitsNeeded: 10,
      requiresChill: false,
    })

    expect(suggestions.map((s) => s.spot.id)).toEqual(['big'])
  })

  it('skips rooms that are shut', () => {
    const suggestions = suggestSpots({
      spots,
      rooms,
      usage,
      unitsNeeded: 8,
      requiresChill: true,
    })

    expect(suggestions.map((s) => s.spot.id)).not.toContain('shut-bay')
  })

  it('returns nothing when the building is full, rather than a bad suggestion', () => {
    const full = spotUsage(spots, [
      alloc({ id: 'a', spotId: 'big', unitsAllocated: 12 }),
      alloc({ id: 'b', spotId: 'snug', unitsAllocated: 3 }),
      alloc({ id: 'c', spotId: 'dry-bay', unitsAllocated: 8 }),
    ])

    expect(
      suggestSpots({ spots, rooms, usage: full, unitsNeeded: 1, requiresChill: false }),
    ).toEqual([])
  })
})
