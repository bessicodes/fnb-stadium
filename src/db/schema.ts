/**
 * FNB Stadium Admin — the operational model of the venue.
 *
 * Four groups of tables, in dependency order:
 *
 *   1. TOPOLOGY   the building itself: levels, zones, blocks, kiosks,
 *                 storage rooms, storage spots, and the haul routes between
 *                 a room and a kiosk. Changes maybe once a season.
 *   2. COMMERCE   who is allowed to trade: vendors, their compliance pack,
 *                 and their people.
 *   3. EVENT      one match or concert, and every allocation made for it —
 *                 which vendor runs which kiosk, which spot holds their stock,
 *                 who is accredited to be on site.
 *   4. LOGISTICS  what physically moved: the stock ledger, the load runs that
 *                 caused the movements, par levels that trigger them, the
 *                 crews that run them, and incidents raised along the way.
 *
 * Two conventions run through the whole file:
 *
 *   - Timestamps are unix milliseconds in an integer column. SQLite has no
 *     date type and storing text dates invites timezone drift; milliseconds
 *     compare and sort correctly with no parsing.
 *   - Stock quantities are always in BASE UNITS (singles), never cases. A
 *     case of 24 is 24. Pack size lives on the item, and conversion happens
 *     at the edges, so nothing in the ledger has to ask "cases or cans?".
 */
import { sql, relations } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/* ------------------------------------------------------------------ *
 * Shared column helpers
 * ------------------------------------------------------------------ */

const id = () => text('id').primaryKey()
const createdAt = () =>
  integer('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`)

/* ------------------------------------------------------------------ *
 * 1. TOPOLOGY
 * ------------------------------------------------------------------ */

/** A physical tier of the stadium. FNB Stadium runs pitch level to upper tier. */
export const levels = sqliteTable('levels', {
  id: id(),
  /** L0, L1, L2, L3 — used in every location code, so it is short. */
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  /** Display order, ground up. */
  sort: integer('sort').notNull().default(0),
})

export type ZoneKind =
  | 'concourse' // public side, where kiosks face the crowd
  | 'back_of_house' // service corridors, storage, staff only
  | 'hospitality' // suites and club lounges
  | 'perimeter' // outside the bowl: fan park, gates
  | 'pitch'

export type Compass = 'N' | 'E' | 'S' | 'W' | 'NE' | 'SE' | 'SW' | 'NW' | 'ALL'

/**
 * An operational zone: a named quadrant of one level. Zones are the unit of
 * accreditation ("this pass opens L1 North") and the unit an event opens or
 * closes ("a 20 000-seat concert does not open the upper tier").
 */
export const zones = sqliteTable(
  'zones',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    levelId: text('level_id')
      .notNull()
      .references(() => levels.id),
    kind: text('kind').$type<ZoneKind>().notNull(),
    sector: text('sector').$type<Compass>().notNull().default('ALL'),
  },
  (t) => [index('zones_level_idx').on(t.levelId)],
)

/** A seating block. Kiosks are rated against the blocks they serve. */
export const blocks = sqliteTable(
  'blocks',
  {
    id: id(),
    code: text('code').notNull().unique(),
    zoneId: text('zone_id')
      .notNull()
      .references(() => zones.id),
    tier: text('tier').$type<'lower' | 'upper' | 'suite'>().notNull(),
    seats: integer('seats').notNull(),
  },
  (t) => [index('blocks_zone_idx').on(t.zoneId)],
)

export type KioskKind =
  | 'food'
  | 'beverage'
  | 'combo'
  | 'coffee'
  | 'merchandise'
  | 'premium' // suite / lounge service point

export type KioskStatus = 'active' | 'maintenance' | 'decommissioned'

/**
 * A concession outlet. `throughputPerHour` is the honest serving rate of the
 * fit-out — it is what turns an attendance forecast into a stock forecast and
 * what exposes a block with too little counter for its seats.
 */
export const kiosks = sqliteTable(
  'kiosks',
  {
    id: id(),
    /** e.g. K-L1-014 — level is in the code because radio traffic needs it. */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    zoneId: text('zone_id')
      .notNull()
      .references(() => zones.id),
    kind: text('kind').$type<KioskKind>().notNull(),
    tills: integer('tills').notNull().default(2),
    /** Equipment on site, as a JSON array: fryer, grill, taps, slush, urn. */
    fitout: text('fitout', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Served customers per hour with every till staffed. */
    throughputPerHour: integer('throughput_per_hour').notNull().default(180),
    /** Block codes this outlet is the nearest counter for. */
    servesBlocks: text('serves_blocks', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    hasGas: integer('has_gas', { mode: 'boolean' }).notNull().default(false),
    hasWater: integer('has_water', { mode: 'boolean' }).notNull().default(true),
    status: text('status').$type<KioskStatus>().notNull().default('active'),
    notes: text('notes'),
  },
  (t) => [index('kiosks_zone_idx').on(t.zoneId), index('kiosks_status_idx').on(t.status)],
)

export type RoomClass =
  | 'dry'
  | 'chilled'
  | 'frozen'
  | 'beverage'
  | 'gas'
  | 'merchandise'
  | 'waste'

export type RoomSecurity = 'open' | 'locked' | 'caged' | 'alarmed'

/** A bulk storage room. Stock lands here on load-in and is issued from here. */
export const storageRooms = sqliteTable(
  'storage_rooms',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    zoneId: text('zone_id')
      .notNull()
      .references(() => zones.id),
    class: text('class').$type<RoomClass>().notNull(),
    tempMinC: real('temp_min_c'),
    tempMaxC: real('temp_max_c'),
    areaSqm: real('area_sqm').notNull(),
    security: text('security').$type<RoomSecurity>().notNull().default('locked'),
    keyholder: text('keyholder'),
    status: text('status').$type<'active' | 'maintenance' | 'closed'>()
      .notNull()
      .default('active'),
    notes: text('notes'),
  },
  (t) => [index('rooms_zone_idx').on(t.zoneId), index('rooms_class_idx').on(t.class)],
)

export type SpotKind =
  | 'pallet_bay'
  | 'shelf'
  | 'floor_spot'
  | 'cage'
  | 'trolley_park'
  | 'chiller_rack'

/**
 * A single addressable position inside a room — the "spot". This is the level
 * at which stock is actually allocated to a vendor, because two vendors
 * sharing a cold room without named bays is how stock goes missing.
 */
export const storageSpots = sqliteTable(
  'storage_spots',
  {
    id: id(),
    /** e.g. CR2-A-04 — room, aisle, position. */
    code: text('code').notNull().unique(),
    roomId: text('room_id')
      .notNull()
      .references(() => storageRooms.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<SpotKind>().notNull(),
    /** How much fits, counted in `unit`. */
    capacityUnits: real('capacity_units').notNull(),
    unit: text('unit').$type<'pallet' | 'crate' | 'shelf_m' | 'keg'>().notNull(),
    status: text('status').$type<'available' | 'reserved' | 'out_of_service'>()
      .notNull()
      .default('available'),
  },
  (t) => [index('spots_room_idx').on(t.roomId), index('spots_status_idx').on(t.status)],
)

/**
 * The walk from a storage room to a kiosk. Dispatch is only as good as its
 * travel times, and at a stadium the honest number depends on which service
 * lift is working — so the route is data, not a guess.
 */
export const haulRoutes = sqliteTable(
  'haul_routes',
  {
    id: id(),
    roomId: text('room_id')
      .notNull()
      .references(() => storageRooms.id, { onDelete: 'cascade' }),
    kioskId: text('kiosk_id')
      .notNull()
      .references(() => kiosks.id, { onDelete: 'cascade' }),
    meters: integer('meters').notNull(),
    /** One-way minutes with a loaded trolley. */
    minutes: integer('minutes').notNull(),
    /** "Service lift 3, ramp B" — what to say on the radio. */
    via: text('via'),
    /** False means stairs: no trolley, hand-carry only. */
    stepFree: integer('step_free', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [
    uniqueIndex('haul_room_kiosk_idx').on(t.roomId, t.kioskId),
    index('haul_kiosk_idx').on(t.kioskId),
  ],
)

/* ------------------------------------------------------------------ *
 * 2. COMMERCE
 * ------------------------------------------------------------------ */

export type VendorStatus = 'prospect' | 'approved' | 'suspended' | 'blacklisted'

export const vendors = sqliteTable(
  'vendors',
  {
    id: id(),
    code: text('code').notNull().unique(),
    tradingName: text('trading_name').notNull(),
    registeredName: text('registered_name').notNull(),
    /** CIPC company registration, e.g. 2011/123456/07. */
    regNo: text('reg_no'),
    vatNo: text('vat_no'),
    category: text('category').notNull(),
    contactName: text('contact_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    contactEmail: text('contact_email').notNull(),
    status: text('status').$type<VendorStatus>().notNull().default('prospect'),
    /** Stadium's cut of declared turnover, in basis points (1500 = 15%). */
    commissionBp: integer('commission_bp').notNull().default(1500),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('vendors_status_idx').on(t.status)],
)

/**
 * The compliance pack. Every kind here is a real South African requirement for
 * trading food or liquor at a public venue, and every one of them expires —
 * which is the whole point of the table. An allocation is refused when a
 * required document is expired on the day of the event, not on the day it was
 * filed.
 */
export type DocumentKind =
  | 'health_certificate' // Certificate of Acceptability, R638 of 2018
  | 'liquor_licence' // Gauteng Liquor Act / event licence
  | 'public_liability' // insurance cover note
  | 'coida' // Letter of Good Standing, Compensation Fund
  | 'tax_clearance' // SARS pin
  | 'food_handler' // staff training certificate
  | 'gas_compliance' // SANS 10087 certificate of conformity
  | 'company_registration'

export const vendorDocuments = sqliteTable(
  'vendor_documents',
  {
    id: id(),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<DocumentKind>().notNull(),
    reference: text('reference'),
    issuedOn: integer('issued_on'),
    /** Null means it does not expire (company registration, for instance). */
    expiresOn: integer('expires_on'),
    issuer: text('issuer'),
    notes: text('notes'),
  },
  (t) => [
    index('docs_vendor_idx').on(t.vendorId),
    index('docs_expiry_idx').on(t.expiresOn),
  ],
)

export type StaffRole =
  | 'manager'
  | 'supervisor'
  | 'cashier'
  | 'cook'
  | 'barperson'
  | 'loader'
  | 'cleaner'

export const vendorStaff = sqliteTable(
  'vendor_staff',
  {
    id: id(),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => vendors.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    /** SA ID or passport. Needed for accreditation and for the gate. */
    idNumber: text('id_number').notNull(),
    role: text('role').$type<StaffRole>().notNull(),
    phone: text('phone'),
    /** Food handler training expiry, where the role requires it. */
    foodHandlerExpiry: integer('food_handler_expiry'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [
    index('staff_vendor_idx').on(t.vendorId),
    uniqueIndex('staff_id_number_idx').on(t.idNumber),
  ],
)

/* ------------------------------------------------------------------ *
 * 3. EVENT
 * ------------------------------------------------------------------ */

export type EventKind = 'football' | 'rugby' | 'concert' | 'conference' | 'other'

/**
 * Event status is a one-way ladder and the app reads it constantly:
 * allocations may only be edited before `load_in`, movements may only be
 * posted from `load_in` to `closed`, and reconciliation may only run once
 * `closed`.
 */
export type EventStatus =
  | 'planned'
  | 'accreditation' // vendor confirmations and passes being issued
  | 'load_in' // stock arriving, storage filling
  | 'live' // doors open
  | 'closed' // final whistle, counting
  | 'reconciled' // variance signed off, invoices raised

export const events = sqliteTable(
  'events',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    kind: text('kind').$type<EventKind>().notNull(),
    /** Kick-off / curtain up. */
    startsAt: integer('starts_at').notNull(),
    doorsAt: integer('doors_at').notNull(),
    endsAt: integer('ends_at').notNull(),
    expectedAttendance: integer('expected_attendance').notNull(),
    actualAttendance: integer('actual_attendance'),
    /** Forecast food-and-drink spend per head, in cents. Drives the stock plan. */
    spendPerHeadCents: integer('spend_per_head_cents').notNull().default(4500),
    status: text('status').$type<EventStatus>().notNull().default('planned'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('events_start_idx').on(t.startsAt), index('events_status_idx').on(t.status)],
)

/** Which zones the event actually opens. A half-house does not staff the upper tier. */
export const eventZones = sqliteTable(
  'event_zones',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    zoneId: text('zone_id')
      .notNull()
      .references(() => zones.id, { onDelete: 'cascade' }),
    open: integer('open', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.zoneId] })],
)

export type AllocationStatus =
  | 'draft'
  | 'confirmed'
  | 'trading'
  | 'closed'
  | 'cancelled'

/**
 * One vendor in one kiosk for one event. The unique index on (event, kiosk) is
 * the hard guarantee that two vendors are never sent to the same counter.
 */
export const kioskAllocations = sqliteTable(
  'kiosk_allocations',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    kioskId: text('kiosk_id')
      .notNull()
      .references(() => kiosks.id),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => vendors.id),
    status: text('status').$type<AllocationStatus>().notNull().default('draft'),
    staffPlanned: integer('staff_planned').notNull().default(4),
    /** Cash float issued to the till, in cents. */
    floatCents: integer('float_cents').notNull().default(0),
    /** Declared turnover, filled in at cash-up. Drives commission. */
    declaredSalesCents: integer('declared_sales_cents'),
    openedAt: integer('opened_at'),
    closedAt: integer('closed_at'),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('alloc_event_kiosk_idx').on(t.eventId, t.kioskId),
    index('alloc_event_vendor_idx').on(t.eventId, t.vendorId),
  ],
)

/**
 * A storage spot handed to a vendor for an event. Same guarantee as above: the
 * unique index means a spot is let once per event, so nobody arrives to find
 * their bay full of somebody else's pallets.
 */
export const storageAllocations = sqliteTable(
  'storage_allocations',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    spotId: text('spot_id')
      .notNull()
      .references(() => storageSpots.id),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => vendors.id),
    unitsAllocated: real('units_allocated').notNull(),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('storalloc_event_spot_idx').on(t.eventId, t.spotId),
    index('storalloc_event_vendor_idx').on(t.eventId, t.vendorId),
  ],
)

/** A person's pass for one event, and the zones it opens. */
export const accreditations = sqliteTable(
  'accreditations',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    staffId: text('staff_id')
      .notNull()
      .references(() => vendorStaff.id, { onDelete: 'cascade' }),
    passCode: text('pass_code').notNull().unique(),
    /** Zone codes the pass opens. */
    zones: text('zones', { mode: 'json' }).$type<string[]>().notNull().default([]),
    status: text('status')
      .$type<'issued' | 'collected' | 'on_site' | 'departed' | 'revoked'>()
      .notNull()
      .default('issued'),
    checkedInAt: integer('checked_in_at'),
    checkedOutAt: integer('checked_out_at'),
  },
  (t) => [
    uniqueIndex('accred_event_staff_idx').on(t.eventId, t.staffId),
    index('accred_event_idx').on(t.eventId),
  ],
)

/* ------------------------------------------------------------------ *
 * 4. LOGISTICS
 * ------------------------------------------------------------------ */

export type StockCategory =
  | 'beer'
  | 'cider'
  | 'soft_drink'
  | 'water'
  | 'hot_drink'
  | 'food_hot'
  | 'food_cold'
  | 'snack'
  | 'consumable' // cups, napkins, gas, till rolls
  | 'merchandise'

export const stockItems = sqliteTable(
  'stock_items',
  {
    id: id(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    category: text('category').$type<StockCategory>().notNull(),
    /** How it arrives from the supplier. Quantities are still base units. */
    caseUnit: text('case_unit').$type<'case' | 'each' | 'keg' | 'box'>()
      .notNull()
      .default('case'),
    /** Base units per case. A 24-can case is 24. */
    packSize: integer('pack_size').notNull().default(24),
    unitWeightKg: real('unit_weight_kg').notNull().default(0.4),
    requiresChill: integer('requires_chill', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** What the vendor pays per base unit, in cents. */
    unitCostCents: integer('unit_cost_cents').notNull(),
    /** Board price per base unit, in cents. */
    unitPriceCents: integer('unit_price_cents').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('items_category_idx').on(t.category)],
)

/**
 * Where stock can sit or go. Modelling this as (type, id) rather than a column
 * per table keeps the ledger a single, scannable list of moves.
 */
export type LocationType =
  | 'supplier' // outside the building — the source of a delivery
  | 'room'
  | 'spot'
  | 'kiosk'
  | 'sold' // sink: rung up at the till
  | 'waste' // sink: spoiled, broken, expired
  | 'returned' // sink: went back out to the supplier

export type MovementKind =
  | 'delivery' // supplier -> room/spot, on load-in
  | 'issue' // spot/room -> kiosk, the loader's run
  | 'return' // kiosk -> spot/room, at close
  | 'transfer' // spot -> spot, or kiosk -> kiosk
  | 'sale' // kiosk -> sold, from the till export
  | 'waste' // anywhere -> waste
  | 'adjustment' // a count correction, with a reason

/**
 * The stock ledger: append-only, one row per physical move. Balances are never
 * stored — they are summed from here. That is slower and completely worth it,
 * because a stored balance that disagrees with its history cannot be audited,
 * and shrinkage arguments with vendors are won or lost on the history.
 */
export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => stockItems.id),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => vendors.id),
    kind: text('kind').$type<MovementKind>().notNull(),
    /** Always positive, in base units. Direction is carried by from/to. */
    qty: integer('qty').notNull(),
    fromType: text('from_type').$type<LocationType>().notNull(),
    fromId: text('from_id'),
    toType: text('to_type').$type<LocationType>().notNull(),
    toId: text('to_id'),
    /** Who physically did it — a crew code, a staff name, or 'till-export'. */
    actor: text('actor').notNull(),
    /** Load run id, delivery note, or till batch that caused this. */
    ref: text('ref'),
    at: integer('at').notNull(),
    note: text('note'),
  },
  (t) => [
    index('mov_event_idx').on(t.eventId),
    index('mov_event_item_idx').on(t.eventId, t.itemId),
    index('mov_from_idx').on(t.fromType, t.fromId),
    index('mov_to_idx').on(t.toType, t.toId),
    index('mov_ref_idx').on(t.ref),
  ],
)

/** Min/max stock a kiosk should hold. Breaching `minQty` raises a load run. */
export const parLevels = sqliteTable(
  'par_levels',
  {
    id: id(),
    kioskId: text('kiosk_id')
      .notNull()
      .references(() => kiosks.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'cascade' }),
    minQty: integer('min_qty').notNull(),
    maxQty: integer('max_qty').notNull(),
  },
  (t) => [uniqueIndex('par_kiosk_item_idx').on(t.kioskId, t.itemId)],
)

export type CrewStatus = 'off' | 'available' | 'on_run' | 'break'

/** A loading crew: the people who move stock from storage to the counters. */
export const crews = sqliteTable(
  'crews',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    /** Where they stage between runs. */
    baseZoneId: text('base_zone_id').references(() => zones.id),
    /** Radio call sign — what control actually says. */
    callSign: text('call_sign').notNull(),
    memberCount: integer('member_count').notNull().default(3),
    shift: text('shift').$type<'early' | 'late' | 'double'>().notNull().default('double'),
    /** Trolleys, so dispatch knows how much one run can carry. */
    trolleys: integer('trolleys').notNull().default(2),
    status: text('status').$type<CrewStatus>().notNull().default('off'),
  },
  (t) => [index('crews_status_idx').on(t.status)],
)

export type RunPriority = 'routine' | 'urgent' | 'critical'

/**
 * Run status is the dispatch lifecycle. Each step stamps its own time, which
 * is what makes the SLA report possible after the event: requested→delivered
 * is the number that matters when a kiosk says it waited forty minutes.
 */
export type RunStatus =
  | 'requested'
  | 'assigned'
  | 'picking' // crew is at the spot pulling stock
  | 'in_transit'
  | 'delivered' // dropped at the kiosk
  | 'confirmed' // kiosk signed for it — this posts the ledger movement
  | 'cancelled'

/**
 * A replenishment task: get this much of this item to this counter. Raised by
 * a kiosk manager, by the par-level sweep, or by control watching the board.
 */
export const loadRuns = sqliteTable(
  'load_runs',
  {
    id: id(),
    /** Short human code for the radio: LR-0147. */
    code: text('code').notNull().unique(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    kioskId: text('kiosk_id')
      .notNull()
      .references(() => kiosks.id),
    itemId: text('item_id')
      .notNull()
      .references(() => stockItems.id),
    vendorId: text('vendor_id')
      .notNull()
      .references(() => vendors.id),
    /** Base units requested. */
    qty: integer('qty').notNull(),
    /** Base units actually delivered — short picks are normal and must show. */
    qtyDelivered: integer('qty_delivered'),
    priority: text('priority').$type<RunPriority>().notNull().default('routine'),
    status: text('status').$type<RunStatus>().notNull().default('requested'),
    /** Where the stock is pulled from. */
    fromSpotId: text('from_spot_id').references(() => storageSpots.id),
    crewId: text('crew_id').references(() => crews.id),
    requestedBy: text('requested_by').notNull(),
    /** Minutes allowed from request to delivery, by priority. */
    slaMinutes: integer('sla_minutes').notNull().default(30),
    requestedAt: integer('requested_at').notNull(),
    assignedAt: integer('assigned_at'),
    pickedAt: integer('picked_at'),
    deliveredAt: integer('delivered_at'),
    confirmedAt: integer('confirmed_at'),
    cancelledReason: text('cancelled_reason'),
    note: text('note'),
  },
  (t) => [
    index('runs_event_status_idx').on(t.eventId, t.status),
    index('runs_crew_idx').on(t.crewId),
    index('runs_kiosk_idx').on(t.kioskId),
  ],
)

export type IncidentKind =
  | 'stock_out'
  | 'equipment'
  | 'gas'
  | 'spillage'
  | 'hygiene'
  | 'security'
  | 'medical'
  | 'staffing'
  | 'other'

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'

export const incidents = sqliteTable(
  'incidents',
  {
    id: id(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<IncidentKind>().notNull(),
    severity: text('severity').$type<IncidentSeverity>().notNull().default('low'),
    kioskId: text('kiosk_id').references(() => kiosks.id),
    roomId: text('room_id').references(() => storageRooms.id),
    vendorId: text('vendor_id').references(() => vendors.id),
    description: text('description').notNull(),
    reportedBy: text('reported_by').notNull(),
    at: integer('at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolution: text('resolution'),
  },
  (t) => [
    index('inc_event_idx').on(t.eventId),
    index('inc_severity_idx').on(t.severity),
  ],
)

/* ------------------------------------------------------------------ *
 * Relations — used by the query builder for nested reads.
 * ------------------------------------------------------------------ */

export const levelRelations = relations(levels, ({ many }) => ({
  zones: many(zones),
}))

export const zoneRelations = relations(zones, ({ one, many }) => ({
  level: one(levels, { fields: [zones.levelId], references: [levels.id] }),
  blocks: many(blocks),
  kiosks: many(kiosks),
  storageRooms: many(storageRooms),
}))

export const kioskRelations = relations(kiosks, ({ one, many }) => ({
  zone: one(zones, { fields: [kiosks.zoneId], references: [zones.id] }),
  allocations: many(kioskAllocations),
  parLevels: many(parLevels),
  runs: many(loadRuns),
}))

export const storageRoomRelations = relations(storageRooms, ({ one, many }) => ({
  zone: one(zones, { fields: [storageRooms.zoneId], references: [zones.id] }),
  spots: many(storageSpots),
}))

export const storageSpotRelations = relations(storageSpots, ({ one, many }) => ({
  room: one(storageRooms, {
    fields: [storageSpots.roomId],
    references: [storageRooms.id],
  }),
  allocations: many(storageAllocations),
}))

export const vendorRelations = relations(vendors, ({ many }) => ({
  documents: many(vendorDocuments),
  staff: many(vendorStaff),
  kioskAllocations: many(kioskAllocations),
  storageAllocations: many(storageAllocations),
}))

export const vendorDocumentRelations = relations(vendorDocuments, ({ one }) => ({
  vendor: one(vendors, {
    fields: [vendorDocuments.vendorId],
    references: [vendors.id],
  }),
}))

export const vendorStaffRelations = relations(vendorStaff, ({ one, many }) => ({
  vendor: one(vendors, { fields: [vendorStaff.vendorId], references: [vendors.id] }),
  accreditations: many(accreditations),
}))

export const eventRelations = relations(events, ({ many }) => ({
  kioskAllocations: many(kioskAllocations),
  storageAllocations: many(storageAllocations),
  movements: many(stockMovements),
  runs: many(loadRuns),
  incidents: many(incidents),
  accreditations: many(accreditations),
}))

export const kioskAllocationRelations = relations(kioskAllocations, ({ one }) => ({
  event: one(events, { fields: [kioskAllocations.eventId], references: [events.id] }),
  kiosk: one(kiosks, { fields: [kioskAllocations.kioskId], references: [kiosks.id] }),
  vendor: one(vendors, {
    fields: [kioskAllocations.vendorId],
    references: [vendors.id],
  }),
}))

export const storageAllocationRelations = relations(storageAllocations, ({ one }) => ({
  event: one(events, { fields: [storageAllocations.eventId], references: [events.id] }),
  spot: one(storageSpots, {
    fields: [storageAllocations.spotId],
    references: [storageSpots.id],
  }),
  vendor: one(vendors, {
    fields: [storageAllocations.vendorId],
    references: [vendors.id],
  }),
}))

export const loadRunRelations = relations(loadRuns, ({ one }) => ({
  event: one(events, { fields: [loadRuns.eventId], references: [events.id] }),
  kiosk: one(kiosks, { fields: [loadRuns.kioskId], references: [kiosks.id] }),
  item: one(stockItems, { fields: [loadRuns.itemId], references: [stockItems.id] }),
  vendor: one(vendors, { fields: [loadRuns.vendorId], references: [vendors.id] }),
  crew: one(crews, { fields: [loadRuns.crewId], references: [crews.id] }),
  fromSpot: one(storageSpots, {
    fields: [loadRuns.fromSpotId],
    references: [storageSpots.id],
  }),
}))

export const stockMovementRelations = relations(stockMovements, ({ one }) => ({
  event: one(events, { fields: [stockMovements.eventId], references: [events.id] }),
  item: one(stockItems, {
    fields: [stockMovements.itemId],
    references: [stockItems.id],
  }),
  vendor: one(vendors, {
    fields: [stockMovements.vendorId],
    references: [vendors.id],
  }),
}))

export const crewRelations = relations(crews, ({ one, many }) => ({
  baseZone: one(zones, { fields: [crews.baseZoneId], references: [zones.id] }),
  runs: many(loadRuns),
}))

/* ------------------------------------------------------------------ *
 * Inferred row types
 * ------------------------------------------------------------------ */

export type Level = typeof levels.$inferSelect
export type Zone = typeof zones.$inferSelect
export type Block = typeof blocks.$inferSelect
export type Kiosk = typeof kiosks.$inferSelect
export type StorageRoom = typeof storageRooms.$inferSelect
export type StorageSpot = typeof storageSpots.$inferSelect
export type HaulRoute = typeof haulRoutes.$inferSelect
export type Vendor = typeof vendors.$inferSelect
export type VendorDocument = typeof vendorDocuments.$inferSelect
export type VendorStaffMember = typeof vendorStaff.$inferSelect
export type StadiumEvent = typeof events.$inferSelect
export type KioskAllocation = typeof kioskAllocations.$inferSelect
export type StorageAllocation = typeof storageAllocations.$inferSelect
export type Accreditation = typeof accreditations.$inferSelect
export type StockItem = typeof stockItems.$inferSelect
export type StockMovement = typeof stockMovements.$inferSelect
export type ParLevel = typeof parLevels.$inferSelect
export type Crew = typeof crews.$inferSelect
export type LoadRun = typeof loadRuns.$inferSelect
export type Incident = typeof incidents.$inferSelect
