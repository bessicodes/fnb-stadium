/**
 * Compliance gating.
 *
 * The rule this module exists to enforce: a vendor may not be allocated a
 * counter for an event unless every document that vendor's trade requires is
 * on file and still valid ON THE DAY OF THE EVENT.
 *
 * The "on the day" part is the whole trick. A liquor licence valid when the
 * allocation is drafted in March and expired by the match in June is not
 * compliant, and checking against today instead of against kick-off is how
 * venues end up trading unlicensed. Every function here takes the instant to
 * judge against, and callers pass the event's start.
 */
import type {
  DocumentKind,
  Kiosk,
  StadiumEvent,
  Vendor,
  VendorDocument,
} from '@/db/schema'

/** Documents every trading vendor must hold, whatever they sell. */
export const BASE_DOCUMENTS: readonly DocumentKind[] = [
  'company_registration',
  'health_certificate',
  'public_liability',
  'coida',
]

/** Kiosk kinds where alcohol is served, and so a liquor licence is required. */
const LIQUOR_KIOSKS = new Set(['beverage', 'combo', 'premium'])

/** Kiosk kinds that cook, and so need valid food-handler training on site. */
const COOKING_KIOSKS = new Set(['food', 'combo', 'premium'])

export type ComplianceSeverity = 'blocking' | 'warning'

export type ComplianceFinding = {
  kind: DocumentKind
  severity: ComplianceSeverity
  /** 'missing' | 'expired' | 'expiring' */
  reason: 'missing' | 'expired' | 'expiring'
  message: string
  expiresOn?: number | null
}

/** A document expiring within this window is a warning, not yet a block. */
export const EXPIRY_WARNING_DAYS = 30

const DAY_MS = 86_400_000

const LABELS: Record<DocumentKind, string> = {
  company_registration: 'Company registration',
  health_certificate: 'Certificate of Acceptability',
  public_liability: 'Public liability insurance',
  coida: 'COIDA letter of good standing',
  tax_clearance: 'Tax clearance',
  liquor_licence: 'Liquor licence',
  food_handler: 'Food handler certificate',
  gas_compliance: 'Gas compliance certificate',
}

export function documentLabel(kind: DocumentKind): string {
  return LABELS[kind]
}

/**
 * Which documents this vendor needs for this particular counter.
 *
 * Requirements are a property of the kiosk, not of the vendor: the same caterer
 * needs a liquor licence for a bar and does not for a coffee cart.
 */
export function requiredDocuments(kiosk: Pick<Kiosk, 'kind' | 'hasGas'>): DocumentKind[] {
  const required = [...BASE_DOCUMENTS]

  if (LIQUOR_KIOSKS.has(kiosk.kind)) required.push('liquor_licence')
  if (COOKING_KIOSKS.has(kiosk.kind)) required.push('food_handler')
  if (kiosk.hasGas) required.push('gas_compliance')

  return required
}

/**
 * Judge one document kind against an instant.
 *
 * Returns null when the document is fine. A document with no expiry (a company
 * registration) never expires and only has to be present.
 */
function judge(
  kind: DocumentKind,
  documents: readonly VendorDocument[],
  at: number,
): ComplianceFinding | null {
  const held = documents.filter((d) => d.kind === kind)

  if (held.length === 0) {
    return {
      kind,
      severity: 'blocking',
      reason: 'missing',
      message: `${LABELS[kind]} is not on file`,
    }
  }

  // A vendor may have renewed: judge on the one that lasts longest.
  const best = held.reduce((a, b) => {
    if (a.expiresOn === null) return a
    if (b.expiresOn === null) return b
    return (b.expiresOn ?? 0) > (a.expiresOn ?? 0) ? b : a
  })

  if (best.expiresOn === null || best.expiresOn === undefined) return null

  if (best.expiresOn < at) {
    return {
      kind,
      severity: 'blocking',
      reason: 'expired',
      message: `${LABELS[kind]} expired ${formatDate(best.expiresOn)}`,
      expiresOn: best.expiresOn,
    }
  }

  if (best.expiresOn - at <= EXPIRY_WARNING_DAYS * DAY_MS) {
    return {
      kind,
      severity: 'warning',
      reason: 'expiring',
      message: `${LABELS[kind]} expires ${formatDate(best.expiresOn)}`,
      expiresOn: best.expiresOn,
    }
  }

  return null
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export type ComplianceReport = {
  ok: boolean
  findings: ComplianceFinding[]
  blocking: ComplianceFinding[]
  warnings: ComplianceFinding[]
}

/** Judge a set of required documents against an instant. */
export function checkDocuments(
  required: readonly DocumentKind[],
  documents: readonly VendorDocument[],
  at: number,
): ComplianceReport {
  const findings = required
    .map((kind) => judge(kind, documents, at))
    .filter((f): f is ComplianceFinding => f !== null)

  const blocking = findings.filter((f) => f.severity === 'blocking')
  const warnings = findings.filter((f) => f.severity === 'warning')

  return { ok: blocking.length === 0, findings, blocking, warnings }
}

/**
 * The vendor's standing overall, judged on the base pack only.
 *
 * This is what the vendor list shows. It deliberately does not include
 * kiosk-specific documents — a caterer without a liquor licence is perfectly
 * compliant right up until you try to put them behind a bar.
 */
export function vendorStanding(
  vendor: Pick<Vendor, 'status'>,
  documents: readonly VendorDocument[],
  at: number,
): ComplianceReport & { tradeable: boolean } {
  const report = checkDocuments(BASE_DOCUMENTS, documents, at)
  const approved = vendor.status === 'approved'

  return { ...report, tradeable: approved && report.ok }
}

export type AllocationVerdict = {
  allowed: boolean
  reasons: string[]
  warnings: string[]
  required: DocumentKind[]
}

/**
 * The gate itself: may this vendor be given this counter for this event?
 *
 * Judged against the event's start, never against now — see the note at the
 * top of the file.
 */
export function canAllocateKiosk(
  vendor: Pick<Vendor, 'status' | 'tradingName'>,
  documents: readonly VendorDocument[],
  kiosk: Pick<Kiosk, 'kind' | 'hasGas' | 'status' | 'code'>,
  event: Pick<StadiumEvent, 'startsAt' | 'status'>,
): AllocationVerdict {
  const reasons: string[] = []
  const warnings: string[] = []
  const required = requiredDocuments(kiosk)

  if (vendor.status !== 'approved') {
    reasons.push(`${vendor.tradingName} is ${vendor.status}, not approved`)
  }

  if (kiosk.status !== 'active') {
    reasons.push(`Kiosk ${kiosk.code} is ${kiosk.status}`)
  }

  if (event.status === 'closed' || event.status === 'reconciled') {
    reasons.push('Event is closed — allocations can no longer be changed')
  }

  const report = checkDocuments(required, documents, event.startsAt)
  for (const f of report.blocking) reasons.push(f.message)
  for (const f of report.warnings) warnings.push(f.message)

  return { allowed: reasons.length === 0, reasons, warnings, required }
}

/**
 * Documents expiring across the whole vendor book, soonest first.
 *
 * This is the screen that stops the scramble: it is read weeks out, so a
 * renewal is chased before it becomes a blocked allocation on match day.
 */
export function expiringDocuments(
  documents: readonly VendorDocument[],
  at: number,
  withinDays = 60,
): VendorDocument[] {
  const horizon = at + withinDays * DAY_MS

  return documents
    .filter((d) => d.expiresOn !== null && d.expiresOn !== undefined)
    .filter((d) => (d.expiresOn as number) <= horizon)
    .sort((a, b) => (a.expiresOn as number) - (b.expiresOn as number))
}
