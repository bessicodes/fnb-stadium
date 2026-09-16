/**
 * Storage allocation: who gets which spot, and does it actually fit.
 *
 * A stadium cold room is a shared resource with no natural boundaries. Two
 * vendors told to "use the cold room" will stack into each other, and once
 * pallets are mixed nobody can say whose crate went missing. This system makes
 * the *spot* the unit of allocation — a named bay with a capacity — so every
 * crate in the building belongs to exactly one vendor for the event.
 *
 * Three things can go wrong, and all three are caught here rather than at the
 * door on load-in morning:
 *   - double-letting: one spot promised to two vendors
 *   - over-capacity: more pallets allocated than the bay holds
 *   - wrong class: chilled stock sent to a dry store
 */
import type {
  RoomClass,
  StockItem,
  StorageAllocation,
  StorageRoom,
  StorageSpot,
} from '@/db/schema'

export type SpotUsage = {
  spot: StorageSpot
  allocatedUnits: number
  freeUnits: number
  /** 0–1. Above 1 means the bay is oversubscribed. */
  utilisation: number
  vendorIds: string[]
}

/**
 * Fold allocations onto their spots.
 *
 * Every spot in `spots` comes back, including untouched ones, because the
 * storage screen has to show free space as prominently as used space.
 */
export function spotUsage(
  spots: readonly StorageSpot[],
  allocations: readonly StorageAllocation[],
): SpotUsage[] {
  const bySpot = new Map<string, StorageAllocation[]>()
  for (const a of allocations) {
    const list = bySpot.get(a.spotId)
    if (list) list.push(a)
    else bySpot.set(a.spotId, [a])
  }

  return spots.map((spot) => {
    const mine = bySpot.get(spot.id) ?? []
    const allocatedUnits = mine.reduce((sum, a) => sum + a.unitsAllocated, 0)

    return {
      spot,
      allocatedUnits,
      freeUnits: Math.max(0, spot.capacityUnits - allocatedUnits),
      utilisation: spot.capacityUnits === 0 ? 0 : allocatedUnits / spot.capacityUnits,
      vendorIds: [...new Set(mine.map((a) => a.vendorId))],
    }
  })
}

/**
 * Generic in the room type so callers that read rooms joined to their zone and
 * level keep those columns through the fold, instead of having them widened
 * away to the bare table row.
 */
export type RoomUsage<R extends StorageRoom = StorageRoom> = {
  room: R
  spots: number
  capacityUnits: number
  allocatedUnits: number
  utilisation: number
  vendorIds: string[]
  /** Spots with nothing allocated to them for this event. */
  freeSpots: number
}

export function roomUsage<R extends StorageRoom>(
  rooms: readonly R[],
  spots: readonly StorageSpot[],
  allocations: readonly StorageAllocation[],
): RoomUsage<R>[] {
  const usage = spotUsage(spots, allocations)
  const byRoom = new Map<string, SpotUsage[]>()

  for (const u of usage) {
    const list = byRoom.get(u.spot.roomId)
    if (list) list.push(u)
    else byRoom.set(u.spot.roomId, [u])
  }

  return rooms.map((room) => {
    const mine = byRoom.get(room.id) ?? []
    const capacityUnits = mine.reduce((s, u) => s + u.spot.capacityUnits, 0)
    const allocatedUnits = mine.reduce((s, u) => s + u.allocatedUnits, 0)

    return {
      room,
      spots: mine.length,
      capacityUnits,
      allocatedUnits,
      utilisation: capacityUnits === 0 ? 0 : allocatedUnits / capacityUnits,
      vendorIds: [...new Set(mine.flatMap((u) => u.vendorIds))],
      freeSpots: mine.filter((u) => u.allocatedUnits === 0).length,
    }
  })
}

/** Room classes that hold stock below ambient temperature. */
const COLD_CLASSES: ReadonlySet<RoomClass> = new Set<RoomClass>(['chilled', 'frozen'])

export function isColdRoom(room: Pick<StorageRoom, 'class'>): boolean {
  return COLD_CLASSES.has(room.class)
}

export type AllocationProblem = {
  severity: 'error' | 'warning'
  message: string
}

/**
 * Check one proposed allocation before it is written.
 *
 * `existing` is every allocation already made against this spot for this
 * event. Passing the same allocation's own id in `replacingId` lets an edit
 * re-check itself without colliding with its old row.
 */
export function checkStorageAllocation(input: {
  spot: StorageSpot
  room: StorageRoom
  vendorId: string
  unitsRequested: number
  existing: readonly StorageAllocation[]
  replacingId?: string
}): { allowed: boolean; problems: AllocationProblem[] } {
  const { spot, room, vendorId, unitsRequested, existing, replacingId } = input
  const problems: AllocationProblem[] = []

  const others = existing.filter((a) => a.id !== replacingId)

  if (spot.status === 'out_of_service') {
    problems.push({ severity: 'error', message: `Spot ${spot.code} is out of service` })
  }

  if (room.status !== 'active') {
    problems.push({ severity: 'error', message: `${room.name} is ${room.status}` })
  }

  if (unitsRequested <= 0) {
    problems.push({ severity: 'error', message: 'Allocation must be at least one unit' })
  }

  const takenByOthers = others.reduce((s, a) => s + a.unitsAllocated, 0)
  const otherVendors = new Set(others.map((a) => a.vendorId).filter((v) => v !== vendorId))

  if (otherVendors.size > 0) {
    problems.push({
      severity: 'error',
      message: `Spot ${spot.code} is already let to another vendor for this event`,
    })
  }

  const wouldHold = takenByOthers + unitsRequested
  if (wouldHold > spot.capacityUnits) {
    problems.push({
      severity: 'error',
      message: `Spot ${spot.code} holds ${spot.capacityUnits} ${spot.unit}; ${wouldHold} allocated`,
    })
  } else if (wouldHold === spot.capacityUnits) {
    problems.push({
      severity: 'warning',
      message: `Spot ${spot.code} will be completely full — no room for an over-delivery`,
    })
  }

  return { allowed: !problems.some((p) => p.severity === 'error'), problems }
}

/**
 * Is this room fit to hold this item?
 *
 * Chilled stock in a dry store is a health-certificate problem, not a
 * housekeeping one, so it blocks rather than warns.
 */
export function checkItemFitsRoom(
  item: Pick<StockItem, 'requiresChill' | 'name' | 'category'>,
  room: Pick<StorageRoom, 'class' | 'name'>,
): { allowed: boolean; problems: AllocationProblem[] } {
  const problems: AllocationProblem[] = []

  if (item.requiresChill && !isColdRoom(room)) {
    problems.push({
      severity: 'error',
      message: `${item.name} needs refrigeration; ${room.name} is a ${room.class} store`,
    })
  }

  if (!item.requiresChill && room.class === 'frozen') {
    problems.push({
      severity: 'warning',
      message: `${item.name} does not need freezing — this wastes freezer space`,
    })
  }

  if (item.category === 'merchandise' && isColdRoom(room)) {
    problems.push({
      severity: 'warning',
      message: 'Merchandise in a cold room risks damp damage',
    })
  }

  return { allowed: !problems.some((p) => p.severity === 'error'), problems }
}

/**
 * Suggest where to put a vendor's stock.
 *
 * Ranked by: the right temperature class first, then the tightest bay that
 * still fits. Filling small bays before large ones keeps the big pallet bays
 * open for the vendors who actually need them — a stadium runs out of large
 * bays long before it runs out of shelves.
 */
export function suggestSpots(input: {
  spots: readonly StorageSpot[]
  rooms: readonly StorageRoom[]
  usage: readonly SpotUsage[]
  unitsNeeded: number
  requiresChill: boolean
  limit?: number
}): SpotUsage[] {
  const { spots, rooms, usage, unitsNeeded, requiresChill, limit = 5 } = input
  const roomById = new Map(rooms.map((r) => [r.id, r]))
  const usageBySpot = new Map(usage.map((u) => [u.spot.id, u]))

  return spots
    .map((spot) => usageBySpot.get(spot.id))
    .filter((u): u is SpotUsage => u !== undefined)
    .filter((u) => {
      const room = roomById.get(u.spot.roomId)
      if (!room || room.status !== 'active') return false
      if (u.spot.status === 'out_of_service') return false
      if (u.freeUnits < unitsNeeded) return false
      return requiresChill ? isColdRoom(room) : true
    })
    .sort((a, b) => a.freeUnits - b.freeUnits)
    .slice(0, limit)
}
