import { describe, expect, it } from 'vitest'

import type { DocumentKind, Kiosk, StadiumEvent, Vendor, VendorDocument } from '@/db/schema'
import {
  BASE_DOCUMENTS,
  canAllocateKiosk,
  checkDocuments,
  expiringDocuments,
  requiredDocuments,
  vendorStanding,
} from './compliance'

const DAY = 86_400_000
const MARCH = Date.UTC(2026, 2, 1)
const JUNE = Date.UTC(2026, 5, 1)

function doc(kind: DocumentKind, expiresOn: number | null): VendorDocument {
  return {
    id: `doc-${kind}`,
    vendorId: 'v1',
    kind,
    reference: 'REF-1',
    issuedOn: Date.UTC(2025, 0, 1),
    expiresOn,
    issuer: 'City of Johannesburg',
    notes: null,
  }
}

/** A full base pack, all valid well past the event. */
function basePack(expiresOn = Date.UTC(2027, 0, 1)): VendorDocument[] {
  return BASE_DOCUMENTS.map((kind) => doc(kind, expiresOn))
}

const approvedVendor = { status: 'approved', tradingName: 'Shisanyama Bros' } as Pick<
  Vendor,
  'status' | 'tradingName'
>

function kiosk(over: Partial<Pick<Kiosk, 'kind' | 'hasGas' | 'status' | 'code'>> = {}) {
  return {
    kind: 'beverage' as const,
    hasGas: false,
    status: 'active' as const,
    code: 'K-L1-014',
    ...over,
  }
}

function event(over: Partial<Pick<StadiumEvent, 'startsAt' | 'status'>> = {}) {
  return { startsAt: JUNE, status: 'planned' as const, ...over }
}

describe('requiredDocuments', () => {
  it('asks a bar for a liquor licence', () => {
    expect(requiredDocuments(kiosk({ kind: 'beverage' }))).toContain('liquor_licence')
  })

  it('does not ask a coffee cart for one', () => {
    expect(requiredDocuments(kiosk({ kind: 'coffee' }))).not.toContain('liquor_licence')
  })

  it('asks anywhere that cooks for food handler training', () => {
    expect(requiredDocuments(kiosk({ kind: 'food' }))).toContain('food_handler')
  })

  it('asks for a gas certificate only where there is gas', () => {
    expect(requiredDocuments(kiosk({ kind: 'food', hasGas: true }))).toContain(
      'gas_compliance',
    )
    expect(requiredDocuments(kiosk({ kind: 'food', hasGas: false }))).not.toContain(
      'gas_compliance',
    )
  })

  it('always asks for the base pack', () => {
    const required = requiredDocuments(kiosk({ kind: 'merchandise' }))
    for (const kind of BASE_DOCUMENTS) expect(required).toContain(kind)
  })
})

describe('checkDocuments', () => {
  it('passes a complete, valid pack', () => {
    expect(checkDocuments(BASE_DOCUMENTS, basePack(), MARCH).ok).toBe(true)
  })

  it('blocks on a document that is simply absent', () => {
    const partial = basePack().filter((d) => d.kind !== 'coida')
    const report = checkDocuments(BASE_DOCUMENTS, partial, MARCH)

    expect(report.ok).toBe(false)
    expect(report.blocking).toHaveLength(1)
    expect(report.blocking[0]).toMatchObject({ kind: 'coida', reason: 'missing' })
  })

  it('treats a document with no expiry as permanently valid', () => {
    const pack = basePack()
    pack[0] = doc('company_registration', null)

    expect(checkDocuments(['company_registration'], pack, JUNE).ok).toBe(true)
  })

  it('warns, without blocking, when expiry is inside the window', () => {
    const pack = [doc('coida', MARCH + 10 * DAY)]
    const report = checkDocuments(['coida'], pack, MARCH)

    expect(report.ok).toBe(true)
    expect(report.warnings[0]).toMatchObject({ reason: 'expiring' })
  })

  it('judges on the renewal when a vendor holds two of the same document', () => {
    const pack = [doc('coida', MARCH - DAY), { ...doc('coida', JUNE + 90 * DAY), id: 'doc-renewed' }]

    expect(checkDocuments(['coida'], pack, JUNE).ok).toBe(true)
  })
})

describe('canAllocateKiosk', () => {
  it('allows an approved vendor with the right documents', () => {
    const docs = [...basePack(), doc('liquor_licence', Date.UTC(2027, 0, 1))]
    const verdict = canAllocateKiosk(approvedVendor, docs, kiosk(), event())

    expect(verdict.allowed).toBe(true)
    expect(verdict.reasons).toEqual([])
  })

  it('refuses a vendor who is only a prospect', () => {
    const docs = [...basePack(), doc('liquor_licence', Date.UTC(2027, 0, 1))]
    const verdict = canAllocateKiosk(
      { status: 'prospect', tradingName: 'New Co' },
      docs,
      kiosk(),
      event(),
    )

    expect(verdict.allowed).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('not approved')
  })

  it('refuses a suspended vendor even with a perfect pack', () => {
    const docs = [...basePack(), doc('liquor_licence', Date.UTC(2027, 0, 1))]
    const verdict = canAllocateKiosk(
      { status: 'suspended', tradingName: 'Old Co' },
      docs,
      kiosk(),
      event(),
    )

    expect(verdict.allowed).toBe(false)
  })

  it('refuses a bar to a vendor with no liquor licence', () => {
    const verdict = canAllocateKiosk(approvedVendor, basePack(), kiosk({ kind: 'beverage' }), event())

    expect(verdict.allowed).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('Liquor licence')
  })

  it('judges expiry against kick-off, not against today', () => {
    // Valid in March when the allocation is drafted, expired by the June match.
    const docs = [...basePack(), doc('liquor_licence', Date.UTC(2026, 3, 15))]

    expect(canAllocateKiosk(approvedVendor, docs, kiosk(), event({ startsAt: MARCH })).allowed).toBe(
      true,
    )
    expect(canAllocateKiosk(approvedVendor, docs, kiosk(), event({ startsAt: JUNE })).allowed).toBe(
      false,
    )
  })

  it('refuses a kiosk that is out for maintenance', () => {
    const docs = [...basePack(), doc('liquor_licence', Date.UTC(2027, 0, 1))]
    const verdict = canAllocateKiosk(approvedVendor, docs, kiosk({ status: 'maintenance' }), event())

    expect(verdict.allowed).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('maintenance')
  })

  it('refuses to change an allocation once the event is closed', () => {
    const docs = [...basePack(), doc('liquor_licence', Date.UTC(2027, 0, 1))]
    const verdict = canAllocateKiosk(approvedVendor, docs, kiosk(), event({ status: 'closed' }))

    expect(verdict.allowed).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('closed')
  })

  it('collects every reason at once rather than stopping at the first', () => {
    const verdict = canAllocateKiosk(
      { status: 'suspended', tradingName: 'Trouble Co' },
      [],
      kiosk({ kind: 'food', hasGas: true }),
      event(),
    )

    // Not approved, plus the whole base pack, plus food handler, plus gas.
    expect(verdict.reasons.length).toBeGreaterThan(5)
  })

  it('reports an expiring document as a warning while still allowing the allocation', () => {
    const docs = [
      ...basePack(),
      doc('liquor_licence', JUNE + 5 * DAY),
    ]
    const verdict = canAllocateKiosk(approvedVendor, docs, kiosk(), event())

    expect(verdict.allowed).toBe(true)
    expect(verdict.warnings.join(' ')).toContain('Liquor licence')
  })
})

describe('vendorStanding', () => {
  it('is tradeable when approved with a clean base pack', () => {
    expect(vendorStanding(approvedVendor, basePack(), MARCH).tradeable).toBe(true)
  })

  it('is not tradeable when a base document has lapsed', () => {
    const lapsed = basePack().map((d) =>
      d.kind === 'health_certificate' ? doc('health_certificate', MARCH - DAY) : d,
    )

    expect(vendorStanding(approvedVendor, lapsed, MARCH).tradeable).toBe(false)
  })

  it('ignores a missing liquor licence, which is not part of the base pack', () => {
    expect(vendorStanding(approvedVendor, basePack(), MARCH).tradeable).toBe(true)
  })
})

describe('expiringDocuments', () => {
  it('returns what lapses inside the horizon, soonest first', () => {
    const docs = [
      doc('coida', MARCH + 50 * DAY),
      doc('liquor_licence', MARCH + 10 * DAY),
      doc('tax_clearance', MARCH + 400 * DAY),
    ]

    expect(expiringDocuments(docs, MARCH, 60).map((d) => d.kind)).toEqual([
      'liquor_licence',
      'coida',
    ])
  })

  it('includes documents that have already lapsed', () => {
    const docs = [doc('coida', MARCH - 5 * DAY)]
    expect(expiringDocuments(docs, MARCH, 60)).toHaveLength(1)
  })

  it('skips documents that never expire', () => {
    expect(expiringDocuments([doc('company_registration', null)], MARCH, 3650)).toEqual([])
  })
})
