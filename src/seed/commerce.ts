/**
 * Vendors, their compliance packs, their people, and the stock catalogue.
 *
 * The vendors are invented. The *shape* of their paperwork is not: every
 * document kind here is something a caterer genuinely has to hold to trade
 * food or liquor at a South African public venue, and the mix of valid,
 * expiring and lapsed documents is what makes the compliance gate worth
 * looking at on day one.
 */
import type {
  Crew,
  StockItem,
  Vendor,
  VendorDocument,
  VendorStaffMember,
  StaffRole,
} from '@/db/schema'
import { rng } from './rng'

const DAY = 86_400_000

export type Commerce = {
  vendors: Vendor[]
  documents: VendorDocument[]
  staff: VendorStaffMember[]
  items: StockItem[]
  crews: Crew[]
}

type VendorPlan = {
  code: string
  trading: string
  registered: string
  category: string
  contact: [name: string, phone: string, email: string]
  status: Vendor['status']
  commissionBp: number
  /** Document kinds this vendor holds, and how long each has left in days. */
  docs: Partial<Record<VendorDocument['kind'], number | null>>
  staffCount: number
  notes?: string
}

/** Full pack, comfortably valid. */
const HEALTHY: VendorPlan['docs'] = {
  company_registration: null,
  health_certificate: 420,
  public_liability: 300,
  coida: 250,
  tax_clearance: 180,
  food_handler: 400,
}

export function buildCommerce(now: number): Commerce {
  const r = rng(94736) // the stadium's capacity

  const plans: VendorPlan[] = [
    {
      code: 'V-KASI',
      trading: 'Kasi Kitchen',
      registered: 'Kasi Kitchen Catering (Pty) Ltd',
      category: 'Hot food — grills and pap',
      contact: ['Thandiwe Mokoena', '+27 82 441 7720', 'thandiwe@kasikitchen.co.za'],
      status: 'approved',
      commissionBp: 1500,
      docs: { ...HEALTHY, gas_compliance: 210 },
      staffCount: 34,
    },
    {
      code: 'V-HIGHV',
      trading: 'Highveld Beverages',
      registered: 'Highveld Beverage Services (Pty) Ltd',
      category: 'Beer, cider and soft drinks',
      contact: ['Pieter van Wyk', '+27 83 227 1184', 'pieter@highveldbev.co.za'],
      status: 'approved',
      commissionBp: 1800,
      docs: { ...HEALTHY, liquor_licence: 260 },
      staffCount: 48,
    },
    {
      code: 'V-SOWGR',
      trading: 'Soweto Grill Co',
      registered: 'Soweto Grill Company (Pty) Ltd',
      category: 'Shisanyama and boerewors rolls',
      contact: ['Sipho Radebe', '+27 71 508 9931', 'sipho@sowetogrill.co.za'],
      status: 'approved',
      commissionBp: 1500,
      docs: { ...HEALTHY, gas_compliance: 24, liquor_licence: 190 },
      staffCount: 29,
      notes: 'Gas certificate due for renewal — chase before the next home fixture.',
    },
    {
      code: 'V-CALCO',
      trading: 'Nasrec Coffee',
      registered: 'Nasrec Coffee Carts CC',
      category: 'Hot drinks and pastries',
      contact: ['Nomsa Dlamini', '+27 84 116 6042', 'nomsa@nasreccoffee.co.za'],
      status: 'approved',
      commissionBp: 1200,
      docs: { ...HEALTHY },
      staffCount: 16,
    },
    {
      code: 'V-NASRC',
      trading: 'Nasrec Catering',
      registered: 'Nasrec Catering Group (Pty) Ltd',
      category: 'Hospitality and suite service',
      contact: ['Andile Khumalo', '+27 82 903 4417', 'andile@nasreccatering.co.za'],
      status: 'approved',
      commissionBp: 2000,
      docs: { ...HEALTHY, liquor_licence: 340, gas_compliance: 300 },
      staffCount: 41,
    },
    {
      code: 'V-GOLDR',
      trading: 'Gold Reef Foods',
      registered: 'Gold Reef Food Services (Pty) Ltd',
      category: 'Snacks, confectionery and cold food',
      contact: ['Riaan Botha', '+27 76 332 8815', 'riaan@goldreeffoods.co.za'],
      status: 'approved',
      commissionBp: 1400,
      docs: { ...HEALTHY },
      staffCount: 22,
    },
    {
      code: 'V-UBUNT',
      trading: 'Ubuntu Refreshments',
      registered: 'Ubuntu Refreshments (Pty) Ltd',
      category: 'Water and soft drinks',
      contact: ['Lerato Mahlangu', '+27 79 664 2208', 'lerato@ubunturef.co.za'],
      status: 'approved',
      commissionBp: 1600,
      // Lapsed COIDA: this vendor is blocked from allocation until renewed.
      docs: { ...HEALTHY, coida: -12 },
      staffCount: 18,
      notes: 'COIDA letter of good standing lapsed. Allocation blocked.',
    },
    {
      code: 'V-BUNNY',
      trading: 'Bunny Chow Bar',
      registered: 'Bunny Chow Bar (Pty) Ltd',
      category: 'Curry and bunny chow',
      contact: ['Yusuf Patel', '+27 82 775 3390', 'yusuf@bunnychowbar.co.za'],
      status: 'approved',
      commissionBp: 1500,
      docs: { ...HEALTHY, gas_compliance: 150 },
      staffCount: 20,
    },
    {
      code: 'V-CHIEF',
      trading: 'Amakhosi Merchandise',
      registered: 'Amakhosi Retail Concessions CC',
      category: 'Replica kit and merchandise',
      contact: ['Bongani Ndlovu', '+27 73 219 5567', 'bongani@amakhosiretail.co.za'],
      status: 'approved',
      commissionBp: 2200,
      docs: { company_registration: null, public_liability: 280, coida: 240, tax_clearance: 160 },
      staffCount: 14,
    },
    {
      code: 'V-SIZZL',
      trading: "Sipho's Sizzle",
      registered: "Sipho's Sizzle Catering CC",
      category: 'Hot food — fast grill',
      contact: ['Katlego Moeketsi', '+27 81 442 9903', 'katlego@siphossizzle.co.za'],
      status: 'prospect',
      commissionBp: 1500,
      // Half a pack: a genuine prospect, not yet tradeable.
      docs: { company_registration: null, public_liability: 90 },
      staffCount: 8,
      notes: 'Applied for the new season. Awaiting health certificate and COIDA.',
    },
    {
      code: 'V-OLDTN',
      trading: 'Old Town Concessions',
      registered: 'Old Town Concessions (Pty) Ltd',
      category: 'Mixed food and beverage',
      contact: ['Marius Steyn', '+27 82 004 1177', 'marius@oldtownconcessions.co.za'],
      status: 'suspended',
      commissionBp: 1500,
      docs: { ...HEALTHY, liquor_licence: -40 },
      staffCount: 11,
      notes: 'Suspended after repeated shrinkage findings and a lapsed liquor licence.',
    },
  ]

  const vendors: Vendor[] = []
  const documents: VendorDocument[] = []
  const staff: VendorStaffMember[] = []

  const FIRST = [
    'Thabo', 'Nomvula', 'Sibusiso', 'Zanele', 'Mpho', 'Karabo', 'Lesedi', 'Refilwe',
    'Tshepo', 'Ayanda', 'Bheki', 'Dineo', 'Kagiso', 'Palesa', 'Sindi', 'Vusi',
    'Johan', 'Anele', 'Precious', 'Lwazi', 'Naledi', 'Oratile', 'Given', 'Busi',
  ]
  const LAST = [
    'Nkosi', 'Mthembu', 'Sithole', 'Molefe', 'Zulu', 'Ndaba', 'Maseko', 'Khoza',
    'Mabaso', 'Tshabalala', 'Mokwena', 'Baloyi', 'Nene', 'Shabangu', 'Mahlangu',
  ]
  const ROLES: StaffRole[] = [
    'manager', 'supervisor', 'cashier', 'cashier', 'cashier',
    'cook', 'cook', 'barperson', 'barperson', 'loader', 'cleaner',
  ]

  let staffSeq = 0

  for (const plan of plans) {
    const vendorId = `vendor-${plan.code.toLowerCase().replace(/[^a-z0-9]/g, '-')}`

    vendors.push({
      id: vendorId,
      code: plan.code,
      tradingName: plan.trading,
      registeredName: plan.registered,
      regNo: `20${r.int(10, 23)}/${r.int(100000, 999999)}/07`,
      vatNo: `4${r.int(100000000, 999999999)}`,
      category: plan.category,
      contactName: plan.contact[0],
      contactPhone: plan.contact[1],
      contactEmail: plan.contact[2],
      status: plan.status,
      commissionBp: plan.commissionBp,
      notes: plan.notes ?? null,
      createdAt: now - r.int(200, 1400) * DAY,
    })

    for (const [kind, daysLeft] of Object.entries(plan.docs) as [
      VendorDocument['kind'],
      number | null,
    ][]) {
      const expiresOn = daysLeft === null ? null : now + daysLeft * DAY
      documents.push({
        id: `doc-${vendorId}-${kind}`,
        vendorId,
        kind,
        reference: referenceFor(kind, r.int(10000, 99999)),
        issuedOn: expiresOn === null ? now - 900 * DAY : expiresOn - 365 * DAY,
        expiresOn,
        issuer: issuerFor(kind),
        notes: null,
      })
    }

    for (let i = 0; i < plan.staffCount; i++) {
      const role = i === 0 ? 'manager' : i < 4 ? 'supervisor' : r.pick(ROLES)
      staffSeq++
      const needsFoodCert = role === 'cook' || role === 'barperson' || role === 'supervisor'

      staff.push({
        id: `staff-${staffSeq}`,
        vendorId,
        fullName: `${r.pick(FIRST)} ${r.pick(LAST)}`,
        // Plausible-format SA ID, deterministic and obviously synthetic.
        idNumber: `${r.int(70, 99)}${String(r.int(1, 12)).padStart(2, '0')}${String(
          r.int(1, 28),
        ).padStart(2, '0')}${String(staffSeq).padStart(4, '0')}08${r.int(0, 9)}`,
        role,
        phone: `+27 ${r.int(71, 84)} ${r.int(100, 999)} ${r.int(1000, 9999)}`,
        foodHandlerExpiry: needsFoodCert ? now + r.int(-20, 500) * DAY : null,
        active: r.chance(0.94),
      })
    }
  }

  /* ------------------------------------------------------------------ *
   * Stock catalogue
   * ------------------------------------------------------------------ */

  const itemPlans: Array<
    [sku: string, name: string, category: StockItem['category'], pack: number, cost: number, price: number, chill: boolean]
  > = [
    ['BEER-CAS-440', 'Castle Lager 440ml can', 'beer', 24, 1180, 3500, true],
    ['BEER-BLA-440', 'Black Label 440ml can', 'beer', 24, 1190, 3500, true],
    ['BEER-CAL-440', 'Castle Lite 440ml can', 'beer', 24, 1240, 3800, true],
    ['BEER-HAN-500', 'Hansa Pilsener 500ml can', 'beer', 24, 1260, 3800, true],
    ['BEER-DRAUGHT-50', 'Draught lager 50L keg', 'beer', 100, 1050, 3200, true],
    ['CIDR-SAV-440', 'Savanna Dry 440ml can', 'cider', 24, 1420, 4200, true],
    ['CIDR-HUN-440', 'Hunters Gold 440ml can', 'cider', 24, 1410, 4200, true],
    ['SOFT-COK-440', 'Coca-Cola 440ml can', 'soft_drink', 24, 780, 2500, true],
    ['SOFT-FAN-440', 'Fanta Orange 440ml can', 'soft_drink', 24, 780, 2500, true],
    ['SOFT-SPR-440', 'Sprite 440ml can', 'soft_drink', 24, 780, 2500, true],
    ['SOFT-STO-330', 'Stoney Ginger Beer 330ml', 'soft_drink', 24, 760, 2500, true],
    ['WATR-STL-500', 'Still water 500ml', 'water', 24, 480, 2000, false],
    ['WATR-SPK-500', 'Sparkling water 500ml', 'water', 24, 520, 2000, false],
    ['HOTD-COF-BEAN', 'Coffee beans 1kg', 'hot_drink', 1, 22000, 0, false],
    ['HOTD-MLK-2L', 'Long-life milk 2L', 'hot_drink', 6, 3200, 0, false],
    ['HOTD-CUP-12', 'Hot cup 12oz + lid', 'consumable', 100, 180, 0, false],
    ['FOOD-BOE-100', 'Boerewors roll portion', 'food_hot', 40, 1450, 4500, true],
    ['FOOD-BUR-100', 'Beef patty 100g', 'food_hot', 48, 1620, 5500, true],
    ['FOOD-CHI-500', 'Chips, frozen 500g portion', 'food_hot', 20, 780, 3000, true],
    ['FOOD-PAP-STEW', 'Pap & stew portion', 'food_hot', 24, 1850, 5500, true],
    ['FOOD-BUN-CHW', 'Bunny chow quarter', 'food_hot', 20, 2100, 6500, true],
    ['FOOD-ROL-100', 'Bread roll', 'food_cold', 48, 220, 0, false],
    ['FOOD-SAND-MIX', 'Mixed sandwich platter', 'food_cold', 12, 3800, 8500, true],
    ['SNCK-BIL-50', 'Biltong 50g pack', 'snack', 40, 1850, 4500, false],
    ['SNCK-CHP-125', 'Potato crisps 125g', 'snack', 24, 740, 2500, false],
    ['SNCK-NUT-100', 'Salted nuts 100g', 'snack', 30, 890, 3000, false],
    ['SNCK-CHO-BAR', 'Chocolate bar', 'snack', 48, 620, 2200, false],
    ['CONS-CUP-500', 'Cold cup 500ml', 'consumable', 100, 140, 0, false],
    ['CONS-NAP-250', 'Napkins, pack of 250', 'consumable', 20, 380, 0, false],
    ['CONS-GAS-9KG', 'LPG cylinder 9kg', 'consumable', 1, 28500, 0, false],
    ['CONS-TIL-ROLL', 'Till roll', 'consumable', 50, 95, 0, false],
    ['MERC-JER-HOME', 'Home replica jersey', 'merchandise', 10, 32000, 79900, false],
    ['MERC-SCF-STD', 'Supporters scarf', 'merchandise', 20, 6500, 19900, false],
    ['MERC-CAP-STD', 'Supporters cap', 'merchandise', 20, 7800, 24900, false],
  ]

  const items: StockItem[] = itemPlans.map(
    ([sku, name, category, packSize, unitCostCents, unitPriceCents, requiresChill]) => ({
      id: `item-${sku.toLowerCase()}`,
      sku,
      name,
      category,
      caseUnit: sku.includes('DRAUGHT') ? 'keg' : packSize === 1 ? 'each' : 'case',
      packSize,
      unitWeightKg: category === 'merchandise' ? 0.25 : requiresChill ? 0.46 : 0.3,
      requiresChill,
      unitCostCents,
      // Consumables are not sold: price zero, and they are excluded from
      // variance valuation because a napkin has no board price.
      unitPriceCents,
      active: true,
    }),
  )

  /* ------------------------------------------------------------------ *
   * Loading crews
   * ------------------------------------------------------------------ */

  const crewPlans: Array<[code: string, name: string, call: string, zone: string, members: number]> = [
    ['C1', 'Crew 1 — L1 North', 'Alpha', 'zone-l1-n', 4],
    ['C2', 'Crew 2 — L1 East', 'Bravo', 'zone-l1-e', 4],
    ['C3', 'Crew 3 — L1 South', 'Charlie', 'zone-l1-s', 4],
    ['C4', 'Crew 4 — L1 West', 'Delta', 'zone-l1-w', 4],
    ['C5', 'Crew 5 — L3 North', 'Echo', 'zone-l3-n', 5],
    ['C6', 'Crew 6 — L3 East', 'Foxtrot', 'zone-l3-e', 5],
    ['C7', 'Crew 7 — L3 South', 'Golf', 'zone-l3-s', 5],
    ['C8', 'Crew 8 — L3 West', 'Hotel', 'zone-l3-w', 5],
    ['C9', 'Crew 9 — Hospitality', 'India', 'zone-l2-e', 3],
    ['C10', 'Crew 10 — Bulk & Receiving', 'Juliet', 'zone-l0-boh', 6],
  ]

  const crews: Crew[] = crewPlans.map(([code, name, callSign, baseZoneId, memberCount]) => ({
    id: `crew-${code.toLowerCase()}`,
    code,
    name,
    baseZoneId,
    callSign,
    memberCount,
    shift: 'double',
    trolleys: memberCount >= 5 ? 3 : 2,
    status: 'off',
  }))

  return { vendors, documents, staff, items, crews }
}

function referenceFor(kind: VendorDocument['kind'], n: number): string {
  switch (kind) {
    case 'health_certificate':
      return `COA/JHB/${n}`
    case 'liquor_licence':
      return `GLB/${n}/E`
    case 'public_liability':
      return `PL-${n}`
    case 'coida':
      return `LGS${n}`
    case 'tax_clearance':
      return `TCS-${n}`
    case 'gas_compliance':
      return `SANS10087/${n}`
    case 'food_handler':
      return `FH-${n}`
    case 'company_registration':
      return `CIPC-${n}`
  }
}

function issuerFor(kind: VendorDocument['kind']): string {
  switch (kind) {
    case 'health_certificate':
      return 'City of Johannesburg Environmental Health'
    case 'liquor_licence':
      return 'Gauteng Liquor Board'
    case 'public_liability':
      return 'Underwriter'
    case 'coida':
      return 'Compensation Fund'
    case 'tax_clearance':
      return 'SARS'
    case 'gas_compliance':
      return 'Registered LP Gas installer'
    case 'food_handler':
      return 'Accredited training provider'
    case 'company_registration':
      return 'CIPC'
  }
}
