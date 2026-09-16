import { getDb, schema } from '@/db/client'
import { buildTopology } from './topology'
import { buildCommerce } from './commerce'
import { buildEvents } from './events'

export type SeedSummary = Record<string, number>

/**
 * Fill an empty database with a season of FNB Stadium.
 *
 * Idempotent by default: if the stadium is already there it does nothing, so
 * `npm run dev` can call it on every start without flattening work in progress.
 * Pass `force` to rebuild from scratch.
 */
export function seed(options: { force?: boolean; now?: number } = {}): SeedSummary {
  const db = getDb()
  const now = options.now ?? Date.now()

  const existing = db.select({ id: schema.levels.id }).from(schema.levels).limit(1).all()
  if (existing.length > 0 && !options.force) return {}

  if (options.force) clear()

  const topology = buildTopology()
  const commerce = buildCommerce(now)
  const events = buildEvents({
    now,
    kiosks: topology.kiosks,
    spots: topology.spots,
    items: commerce.items,
    vendors: commerce.vendors,
    staff: commerce.staff,
    crews: commerce.crews,
    zoneIds: topology.zones.map((z) => z.id),
  })

  const summary: SeedSummary = {}

  // One transaction: a half-seeded stadium is worse than an empty one.
  db.transaction((tx) => {
    const insert = <T,>(
      label: string,
      // Drizzle's insert types are per-table; the seed feeds twenty of them
      // through one helper, so the table is deliberately untyped here and the
      // row types are guaranteed by the builders that produced them.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      table: any,
      rows: readonly T[],
    ) => {
      if (rows.length === 0) return
      // SQLite caps bound parameters per statement, so chunk wide tables.
      for (let i = 0; i < rows.length; i += 200) {
        tx.insert(table).values(rows.slice(i, i + 200) as never).run()
      }
      summary[label] = (summary[label] ?? 0) + rows.length
    }

    insert('levels', schema.levels, topology.levels)
    insert('zones', schema.zones, topology.zones)
    insert('blocks', schema.blocks, topology.blocks)
    insert('kiosks', schema.kiosks, topology.kiosks)
    insert('storageRooms', schema.storageRooms, topology.rooms)
    insert('storageSpots', schema.storageSpots, topology.spots)
    insert('haulRoutes', schema.haulRoutes, topology.routes)

    insert('vendors', schema.vendors, commerce.vendors)
    insert('vendorDocuments', schema.vendorDocuments, commerce.documents)
    insert('vendorStaff', schema.vendorStaff, commerce.staff)
    insert('stockItems', schema.stockItems, commerce.items)

    const crews = commerce.crews.map((crew) => ({
      ...crew,
      status: events.crewUpdates.find((u) => u.id === crew.id)?.status ?? crew.status,
    }))
    insert('crews', schema.crews, crews)

    insert('events', schema.events, events.events)
    insert('eventZones', schema.eventZones, events.eventZones)
    insert('kioskAllocations', schema.kioskAllocations, events.kioskAllocations)
    insert('storageAllocations', schema.storageAllocations, events.storageAllocations)
    insert('parLevels', schema.parLevels, events.parLevels)
    insert('stockMovements', schema.stockMovements, events.movements)
    insert('loadRuns', schema.loadRuns, events.loadRuns)
    insert('incidents', schema.incidents, events.incidents)
    insert('accreditations', schema.accreditations, events.accreditations)
  })

  return summary
}

/** Drop every row, leaving the schema in place. */
export function clear() {
  const db = getDb()

  db.transaction((tx) => {
    // Children before parents: foreign keys are enforced.
    tx.delete(schema.accreditations).run()
    tx.delete(schema.incidents).run()
    tx.delete(schema.loadRuns).run()
    tx.delete(schema.stockMovements).run()
    tx.delete(schema.parLevels).run()
    tx.delete(schema.storageAllocations).run()
    tx.delete(schema.kioskAllocations).run()
    tx.delete(schema.eventZones).run()
    tx.delete(schema.events).run()
    tx.delete(schema.crews).run()
    tx.delete(schema.stockItems).run()
    tx.delete(schema.vendorStaff).run()
    tx.delete(schema.vendorDocuments).run()
    tx.delete(schema.vendors).run()
    tx.delete(schema.haulRoutes).run()
    tx.delete(schema.storageSpots).run()
    tx.delete(schema.storageRooms).run()
    tx.delete(schema.kiosks).run()
    tx.delete(schema.blocks).run()
    tx.delete(schema.zones).run()
    tx.delete(schema.levels).run()
  })
}
