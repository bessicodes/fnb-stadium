/**
 * Every read the app does.
 *
 * `await connection()` runs first in each entry point. better-sqlite3 is
 * synchronous, so without it Next would happily run these queries during the
 * production prerender and bake a snapshot of the stadium into the build —
 * a control board frozen at the moment of deployment. The Next docs name this
 * exact case; see `node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/connection.md`.
 */
import { connection } from 'next/server'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import { getDb, schema } from '@/db/client'
import type {
  Crew,
  EventStatus,
  Kiosk,
  LoadRun,
  StadiumEvent,
  StockItem,
  StorageRoom,
  StorageSpot,
  Vendor,
  VendorDocument,
  Zone,
} from '@/db/schema'
import { buildBalances, type LedgerMovement } from '@/domain/ledger'

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export async function listEvents(): Promise<StadiumEvent[]> {
  await connection()
  return getDb().select().from(schema.events).orderBy(asc(schema.events.startsAt)).all()
}

export async function getEventByCode(code: string): Promise<StadiumEvent | undefined> {
  await connection()
  return getDb().select().from(schema.events).where(eq(schema.events.code, code)).get()
}

/**
 * The event the control board should open on.
 *
 * A live event always wins. Otherwise the next one that has not finished, and
 * failing that the most recent — so the board is never blank between seasons.
 */
export async function currentEvent(): Promise<StadiumEvent | undefined> {
  await connection()
  const db = getDb()
  const now = Date.now()

  const live = db
    .select()
    .from(schema.events)
    .where(eq(schema.events.status, 'live'))
    .orderBy(asc(schema.events.startsAt))
    .get()
  if (live) return live

  const upcoming = db
    .select()
    .from(schema.events)
    .where(sql`${schema.events.endsAt} >= ${now}`)
    .orderBy(asc(schema.events.startsAt))
    .get()
  if (upcoming) return upcoming

  return db.select().from(schema.events).orderBy(desc(schema.events.startsAt)).get()
}

/* ------------------------------------------------------------------ *
 * Topology
 * ------------------------------------------------------------------ */

export async function listZones(): Promise<Array<Zone & { levelCode: string; levelName: string }>> {
  await connection()
  return getDb()
    .select({
      id: schema.zones.id,
      code: schema.zones.code,
      name: schema.zones.name,
      levelId: schema.zones.levelId,
      kind: schema.zones.kind,
      sector: schema.zones.sector,
      levelCode: schema.levels.code,
      levelName: schema.levels.name,
    })
    .from(schema.zones)
    .innerJoin(schema.levels, eq(schema.zones.levelId, schema.levels.id))
    .orderBy(asc(schema.levels.sort), asc(schema.zones.code))
    .all()
}

export type KioskRow = Kiosk & {
  zoneName: string
  zoneCode: string
  levelCode: string
  levelSort: number
}

export async function listKiosks(): Promise<KioskRow[]> {
  await connection()
  return getDb()
    .select({
      id: schema.kiosks.id,
      code: schema.kiosks.code,
      name: schema.kiosks.name,
      zoneId: schema.kiosks.zoneId,
      kind: schema.kiosks.kind,
      tills: schema.kiosks.tills,
      fitout: schema.kiosks.fitout,
      throughputPerHour: schema.kiosks.throughputPerHour,
      servesBlocks: schema.kiosks.servesBlocks,
      hasGas: schema.kiosks.hasGas,
      hasWater: schema.kiosks.hasWater,
      status: schema.kiosks.status,
      notes: schema.kiosks.notes,
      zoneName: schema.zones.name,
      zoneCode: schema.zones.code,
      levelCode: schema.levels.code,
      levelSort: schema.levels.sort,
    })
    .from(schema.kiosks)
    .innerJoin(schema.zones, eq(schema.kiosks.zoneId, schema.zones.id))
    .innerJoin(schema.levels, eq(schema.zones.levelId, schema.levels.id))
    .orderBy(asc(schema.levels.sort), asc(schema.kiosks.code))
    .all()
}

export async function getKioskByCode(code: string): Promise<KioskRow | undefined> {
  const all = await listKiosks()
  return all.find((k) => k.code === code)
}

export async function listBlocks() {
  await connection()
  return getDb().select().from(schema.blocks).orderBy(asc(schema.blocks.code)).all()
}

export type RoomRow = StorageRoom & { zoneName: string; levelCode: string; levelSort: number }

export async function listStorageRooms(): Promise<RoomRow[]> {
  await connection()
  return getDb()
    .select({
      id: schema.storageRooms.id,
      code: schema.storageRooms.code,
      name: schema.storageRooms.name,
      zoneId: schema.storageRooms.zoneId,
      class: schema.storageRooms.class,
      tempMinC: schema.storageRooms.tempMinC,
      tempMaxC: schema.storageRooms.tempMaxC,
      areaSqm: schema.storageRooms.areaSqm,
      security: schema.storageRooms.security,
      keyholder: schema.storageRooms.keyholder,
      status: schema.storageRooms.status,
      notes: schema.storageRooms.notes,
      zoneName: schema.zones.name,
      levelCode: schema.levels.code,
      levelSort: schema.levels.sort,
    })
    .from(schema.storageRooms)
    .innerJoin(schema.zones, eq(schema.storageRooms.zoneId, schema.zones.id))
    .innerJoin(schema.levels, eq(schema.zones.levelId, schema.levels.id))
    .orderBy(asc(schema.levels.sort), asc(schema.storageRooms.code))
    .all()
}

export async function getRoomByCode(code: string): Promise<RoomRow | undefined> {
  const rooms = await listStorageRooms()
  return rooms.find((r) => r.code === code)
}

export async function listStorageSpots(roomId?: string): Promise<StorageSpot[]> {
  await connection()
  const db = getDb()
  const q = db.select().from(schema.storageSpots)
  const rows = roomId
    ? q.where(eq(schema.storageSpots.roomId, roomId)).orderBy(asc(schema.storageSpots.code)).all()
    : q.orderBy(asc(schema.storageSpots.code)).all()
  return rows
}

export async function listHaulRoutes() {
  await connection()
  return getDb().select().from(schema.haulRoutes).all()
}

/* ------------------------------------------------------------------ *
 * Vendors
 * ------------------------------------------------------------------ */

export async function listVendors(): Promise<Vendor[]> {
  await connection()
  return getDb().select().from(schema.vendors).orderBy(asc(schema.vendors.tradingName)).all()
}

export async function getVendorByCode(code: string): Promise<Vendor | undefined> {
  await connection()
  return getDb().select().from(schema.vendors).where(eq(schema.vendors.code, code)).get()
}

export async function listVendorDocuments(vendorId?: string): Promise<VendorDocument[]> {
  await connection()
  const db = getDb()
  const q = db.select().from(schema.vendorDocuments)
  return vendorId ? q.where(eq(schema.vendorDocuments.vendorId, vendorId)).all() : q.all()
}

export async function listVendorStaff(vendorId?: string) {
  await connection()
  const db = getDb()
  const q = db.select().from(schema.vendorStaff)
  return vendorId
    ? q.where(eq(schema.vendorStaff.vendorId, vendorId)).orderBy(asc(schema.vendorStaff.fullName)).all()
    : q.orderBy(asc(schema.vendorStaff.fullName)).all()
}

/** Documents grouped by vendor — one query instead of one per vendor. */
export async function documentsByVendor(): Promise<Map<string, VendorDocument[]>> {
  const docs = await listVendorDocuments()
  const map = new Map<string, VendorDocument[]>()
  for (const d of docs) {
    const list = map.get(d.vendorId)
    if (list) list.push(d)
    else map.set(d.vendorId, [d])
  }
  return map
}

/* ------------------------------------------------------------------ *
 * Stock
 * ------------------------------------------------------------------ */

export async function listStockItems(): Promise<StockItem[]> {
  await connection()
  return getDb().select().from(schema.stockItems).orderBy(asc(schema.stockItems.name)).all()
}

export async function itemsById(): Promise<Map<string, StockItem>> {
  const items = await listStockItems()
  return new Map(items.map((i) => [i.id, i]))
}

export async function listMovements(eventId: string, limit?: number) {
  await connection()
  const db = getDb()
  const q = db
    .select()
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.eventId, eventId))
    .orderBy(desc(schema.stockMovements.at))
  return limit ? q.limit(limit).all() : q.all()
}

/** Ledger balances for one event, as the domain layer wants them. */
export async function balancesForEvent(eventId: string) {
  const movements = await listMovements(eventId)
  return buildBalances(movements as unknown as LedgerMovement[])
}

export async function listParLevels(kioskId?: string) {
  await connection()
  const db = getDb()
  const q = db.select().from(schema.parLevels)
  return kioskId ? q.where(eq(schema.parLevels.kioskId, kioskId)).all() : q.all()
}

/* ------------------------------------------------------------------ *
 * Allocations
 * ------------------------------------------------------------------ */

export type AllocationRow = {
  id: string
  eventId: string
  kioskId: string
  vendorId: string
  status: string
  staffPlanned: number
  floatCents: number
  declaredSalesCents: number | null
  kioskCode: string
  kioskName: string
  kioskKind: Kiosk['kind']
  zoneName: string
  levelCode: string
  levelSort: number
  vendorName: string
  vendorCode: string
}

export async function listKioskAllocations(eventId: string): Promise<AllocationRow[]> {
  await connection()
  return getDb()
    .select({
      id: schema.kioskAllocations.id,
      eventId: schema.kioskAllocations.eventId,
      kioskId: schema.kioskAllocations.kioskId,
      vendorId: schema.kioskAllocations.vendorId,
      status: schema.kioskAllocations.status,
      staffPlanned: schema.kioskAllocations.staffPlanned,
      floatCents: schema.kioskAllocations.floatCents,
      declaredSalesCents: schema.kioskAllocations.declaredSalesCents,
      kioskCode: schema.kiosks.code,
      kioskName: schema.kiosks.name,
      kioskKind: schema.kiosks.kind,
      zoneName: schema.zones.name,
      levelCode: schema.levels.code,
      levelSort: schema.levels.sort,
      vendorName: schema.vendors.tradingName,
      vendorCode: schema.vendors.code,
    })
    .from(schema.kioskAllocations)
    .innerJoin(schema.kiosks, eq(schema.kioskAllocations.kioskId, schema.kiosks.id))
    .innerJoin(schema.zones, eq(schema.kiosks.zoneId, schema.zones.id))
    .innerJoin(schema.levels, eq(schema.zones.levelId, schema.levels.id))
    .innerJoin(schema.vendors, eq(schema.kioskAllocations.vendorId, schema.vendors.id))
    .where(eq(schema.kioskAllocations.eventId, eventId))
    .orderBy(asc(schema.levels.sort), asc(schema.kiosks.code))
    .all()
}

export async function listStorageAllocations(eventId: string) {
  await connection()
  return getDb()
    .select()
    .from(schema.storageAllocations)
    .where(eq(schema.storageAllocations.eventId, eventId))
    .all()
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

export type RunRow = LoadRun & {
  kioskCode: string
  kioskName: string
  zoneName: string
  levelCode: string
  itemName: string
  itemSku: string
  packSize: number
  vendorName: string
  crewName: string | null
  crewCallSign: string | null
  spotCode: string | null
}

export async function listRuns(
  eventId: string,
  options: { statuses?: LoadRun['status'][]; limit?: number } = {},
): Promise<RunRow[]> {
  await connection()

  const where = options.statuses?.length
    ? and(eq(schema.loadRuns.eventId, eventId), inArray(schema.loadRuns.status, options.statuses))
    : eq(schema.loadRuns.eventId, eventId)

  const q = getDb()
    .select({
      id: schema.loadRuns.id,
      code: schema.loadRuns.code,
      eventId: schema.loadRuns.eventId,
      kioskId: schema.loadRuns.kioskId,
      itemId: schema.loadRuns.itemId,
      vendorId: schema.loadRuns.vendorId,
      qty: schema.loadRuns.qty,
      qtyDelivered: schema.loadRuns.qtyDelivered,
      priority: schema.loadRuns.priority,
      status: schema.loadRuns.status,
      fromSpotId: schema.loadRuns.fromSpotId,
      crewId: schema.loadRuns.crewId,
      requestedBy: schema.loadRuns.requestedBy,
      slaMinutes: schema.loadRuns.slaMinutes,
      requestedAt: schema.loadRuns.requestedAt,
      assignedAt: schema.loadRuns.assignedAt,
      pickedAt: schema.loadRuns.pickedAt,
      deliveredAt: schema.loadRuns.deliveredAt,
      confirmedAt: schema.loadRuns.confirmedAt,
      cancelledReason: schema.loadRuns.cancelledReason,
      note: schema.loadRuns.note,
      kioskCode: schema.kiosks.code,
      kioskName: schema.kiosks.name,
      zoneName: schema.zones.name,
      levelCode: schema.levels.code,
      itemName: schema.stockItems.name,
      itemSku: schema.stockItems.sku,
      packSize: schema.stockItems.packSize,
      vendorName: schema.vendors.tradingName,
      crewName: schema.crews.name,
      crewCallSign: schema.crews.callSign,
      spotCode: schema.storageSpots.code,
    })
    .from(schema.loadRuns)
    .innerJoin(schema.kiosks, eq(schema.loadRuns.kioskId, schema.kiosks.id))
    .innerJoin(schema.zones, eq(schema.kiosks.zoneId, schema.zones.id))
    .innerJoin(schema.levels, eq(schema.zones.levelId, schema.levels.id))
    .innerJoin(schema.stockItems, eq(schema.loadRuns.itemId, schema.stockItems.id))
    .innerJoin(schema.vendors, eq(schema.loadRuns.vendorId, schema.vendors.id))
    .leftJoin(schema.crews, eq(schema.loadRuns.crewId, schema.crews.id))
    .leftJoin(schema.storageSpots, eq(schema.loadRuns.fromSpotId, schema.storageSpots.id))
    .where(where)
    .orderBy(desc(schema.loadRuns.requestedAt))

  return (options.limit ? q.limit(options.limit).all() : q.all()) as RunRow[]
}

export async function listCrews(): Promise<Crew[]> {
  await connection()
  return getDb().select().from(schema.crews).orderBy(asc(schema.crews.code)).all()
}

/** Open runs per crew, for the dispatch suggester. */
export async function openRunsByCrew(eventId: string): Promise<Map<string, number>> {
  await connection()
  const rows = getDb()
    .select({ crewId: schema.loadRuns.crewId, n: sql<number>`count(*)` })
    .from(schema.loadRuns)
    .where(
      and(
        eq(schema.loadRuns.eventId, eventId),
        ne(schema.loadRuns.status, 'confirmed'),
        ne(schema.loadRuns.status, 'cancelled'),
      ),
    )
    .groupBy(schema.loadRuns.crewId)
    .all()

  const map = new Map<string, number>()
  for (const r of rows) if (r.crewId) map.set(r.crewId, Number(r.n))
  return map
}

/* ------------------------------------------------------------------ *
 * Incidents
 * ------------------------------------------------------------------ */

export async function listIncidents(eventId: string) {
  await connection()
  return getDb()
    .select({
      id: schema.incidents.id,
      eventId: schema.incidents.eventId,
      kind: schema.incidents.kind,
      severity: schema.incidents.severity,
      kioskId: schema.incidents.kioskId,
      roomId: schema.incidents.roomId,
      vendorId: schema.incidents.vendorId,
      description: schema.incidents.description,
      reportedBy: schema.incidents.reportedBy,
      at: schema.incidents.at,
      resolvedAt: schema.incidents.resolvedAt,
      resolution: schema.incidents.resolution,
      kioskCode: schema.kiosks.code,
    })
    .from(schema.incidents)
    .leftJoin(schema.kiosks, eq(schema.incidents.kioskId, schema.kiosks.id))
    .where(eq(schema.incidents.eventId, eventId))
    .orderBy(desc(schema.incidents.at))
    .all()
}

/* ------------------------------------------------------------------ *
 * Accreditation
 * ------------------------------------------------------------------ */

export async function accreditationSummary(eventId: string) {
  await connection()
  const rows = getDb()
    .select({ status: schema.accreditations.status, n: sql<number>`count(*)` })
    .from(schema.accreditations)
    .where(eq(schema.accreditations.eventId, eventId))
    .groupBy(schema.accreditations.status)
    .all()

  const byStatus = new Map(rows.map((r) => [r.status, Number(r.n)]))
  const total = rows.reduce((s, r) => s + Number(r.n), 0)
  return { byStatus, total, onSite: byStatus.get('on_site') ?? 0 }
}

/** Counts used by the nav badges and the landing stats. */
export async function stadiumCounts() {
  await connection()
  const db = getDb()
  const count = (table: Parameters<typeof db.select>[0] extends never ? never : never) => table

  void count
  const one = (q: { all: () => Array<{ n: unknown }> }) => Number(q.all()[0]?.n ?? 0)

  return {
    kiosks: one(db.select({ n: sql`count(*)` }).from(schema.kiosks)),
    rooms: one(db.select({ n: sql`count(*)` }).from(schema.storageRooms)),
    spots: one(db.select({ n: sql`count(*)` }).from(schema.storageSpots)),
    vendors: one(db.select({ n: sql`count(*)` }).from(schema.vendors)),
    crews: one(db.select({ n: sql`count(*)` }).from(schema.crews)),
    items: one(db.select({ n: sql`count(*)` }).from(schema.stockItems)),
    seats: one(db.select({ n: sql`sum(seats)` }).from(schema.blocks)),
  }
}

export type { EventStatus }
