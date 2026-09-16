import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  Dl,
  DlRow,
  Empty,
  Note,
  Panel,
  PageHead,
  Pill,
  Stat,
  Table,
  VendorStatusPill,
} from '@/components/ui'
import {
  BASE_DOCUMENTS,
  documentLabel,
  requiredDocuments,
  vendorStanding,
} from '@/domain/compliance'
import { settleVendor, vendorScore } from '@/domain/reconciliation'
import { flowByItem, type LedgerMovement } from '@/domain/ledger'
import { bp, date, isoDate, money, num, percent } from '@/lib/format'
import {
  getVendorByCode,
  itemsById,
  listEvents,
  listKioskAllocations,
  listMovements,
  listVendorDocuments,
  listVendorStaff,
} from '@/queries/read'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const vendor = await getVendorByCode(code)
  return { title: vendor?.tradingName ?? 'Vendor' }
}

export default async function VendorPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const vendor = await getVendorByCode(code)
  if (!vendor) notFound()

  const now = Date.now()
  const [documents, staff, events, items] = await Promise.all([
    listVendorDocuments(vendor.id),
    listVendorStaff(vendor.id),
    listEvents(),
    itemsById(),
  ])

  const standing = vendorStanding(vendor, documents, now)

  // Allocations across every event, and the settlement for the last one that
  // actually reconciled.
  const allocationsByEvent = await Promise.all(
    events.map(async (event) => ({
      event,
      allocations: (await listKioskAllocations(event.id)).filter(
        (a) => a.vendorId === vendor.id,
      ),
    })),
  )

  const reconciled = events.filter((e) => e.status === 'reconciled').at(-1)
  let settlement: ReturnType<typeof settleVendor> | null = null

  if (reconciled) {
    const movements = (await listMovements(reconciled.id)).filter(
      (m) => m.vendorId === vendor.id,
    ) as unknown as LedgerMovement[]

    const declared = (await listKioskAllocations(reconciled.id))
      .filter((a) => a.vendorId === vendor.id)
      .reduce((s, a) => s + (a.declaredSalesCents ?? 0), 0)

    if (movements.length > 0) {
      settlement = settleVendor({
        vendor,
        movements,
        itemsById: items,
        declaredSalesCents: declared,
      })
    }
  }

  const score = vendorScore({
    compliant: standing.ok,
    expiringDocs: standing.warnings.length,
    shrinkagePct: settlement?.shrinkagePct ?? 0,
    stockOutIncidents: 0,
    slaBreachesCaused: 0,
  })

  const held = new Set(documents.map((d) => d.kind))
  // Everything this vendor might need, across the counter kinds they trade.
  const relevant = new Set([
    ...BASE_DOCUMENTS,
    ...requiredDocuments({ kind: 'combo', hasGas: true }),
    ...documents.map((d) => d.kind),
  ])

  return (
    <>
      <PageHead
        eyebrow={vendor.code}
        title={vendor.tradingName}
        sub={vendor.category}
        actions={
          <>
            <VendorStatusPill status={vendor.status} />
            {standing.tradeable ? (
              <Pill tone="ok">Cleared to trade</Pill>
            ) : (
              <Pill tone="crit">Allocation blocked</Pill>
            )}
          </>
        }
      />

      {vendor.notes ? (
        <div style={{ marginBottom: 14 }}>
          <Note tone={standing.tradeable ? 'warn' : 'crit'}>{vendor.notes}</Note>
        </div>
      ) : null}

      <div className="grid grid--4">
        <Stat
          label="Scorecard"
          value={score.score}
          tone={score.band === 'good' ? 'ok' : score.band === 'watch' ? 'warn' : 'crit'}
          note={score.notes[0] ?? 'Nothing against them'}
        />
        <Stat label="Accredited staff" value={num(staff.filter((s) => s.active).length)} note={`${staff.length} on file`} />
        <Stat label="Commission" value={bp(vendor.commissionBp)} note="Of declared turnover" small />
        <Stat
          label="Last settlement"
          value={settlement ? money(settlement.declaredSalesCents) : '—'}
          note={reconciled?.name ?? 'No reconciled event yet'}
          small
        />
      </div>

      <div className="grid grid--main" style={{ marginTop: 14 }}>
        <div className="stack">
          <Panel title="Compliance pack" hint="Judged against each event's kick-off" flush>
            <Table
              head={
                <>
                  <th>Document</th>
                  <th>Reference</th>
                  <th>Issuer</th>
                  <th>Expires</th>
                  <th>State</th>
                </>
              }
            >
              {[...relevant].map((kind) => {
                const doc = documents
                  .filter((d) => d.kind === kind)
                  .sort((a, b) => (b.expiresOn ?? Infinity) - (a.expiresOn ?? Infinity))[0]

                const lapsed = doc?.expiresOn != null && doc.expiresOn < now
                const soon =
                  doc?.expiresOn != null &&
                  !lapsed &&
                  doc.expiresOn - now < 30 * 86_400_000

                return (
                  <tr key={kind}>
                    <td>{documentLabel(kind)}</td>
                    <td className="code tiny">{doc?.reference ?? '—'}</td>
                    <td className="tiny muted">{doc?.issuer ?? '—'}</td>
                    <td className="code">
                      {doc ? (doc.expiresOn ? isoDate(doc.expiresOn) : 'No expiry') : '—'}
                    </td>
                    <td className="tight">
                      {!held.has(kind) ? (
                        <Pill tone="crit">Missing</Pill>
                      ) : lapsed ? (
                        <Pill tone="crit">Lapsed</Pill>
                      ) : soon ? (
                        <Pill tone="warn">Expiring</Pill>
                      ) : (
                        <Pill tone="ok">Valid</Pill>
                      )}
                    </td>
                  </tr>
                )
              })}
            </Table>
          </Panel>

          {settlement ? (
            <Panel
              title="Last settlement"
              hint={reconciled?.name}
              action={
                reconciled ? (
                  <Link className="btn btn--sm" href={`/events/${reconciled.code}/reconciliation`}>
                    Full reconciliation
                  </Link>
                ) : null
              }
            >
              <div className="grid grid--3" style={{ gap: 12, marginBottom: 14 }}>
                <div>
                  <div className="statLabel">Declared</div>
                  <strong>{money(settlement.declaredSalesCents)}</strong>
                </div>
                <div>
                  <div className="statLabel">Commission</div>
                  <strong>{money(settlement.commissionCents)}</strong>
                </div>
                <div>
                  <div className="statLabel">Shrinkage</div>
                  <strong
                    style={
                      settlement.shrinkagePct > 0.03 ? { color: 'var(--crit)' } : undefined
                    }
                  >
                    {percent(settlement.shrinkagePct, 1)}
                  </strong>
                </div>
              </div>

              {settlement.flags.length > 0 ? (
                <Note tone="crit">{settlement.flags.join(' · ')}</Note>
              ) : (
                <Note>Reconciled clean — no flags raised.</Note>
              )}

              <div className="sectionTitle" style={{ marginTop: 16 }}>
                Worst variances
              </div>
              <Table
                head={
                  <>
                    <th>Item</th>
                    <th className="num">Issued</th>
                    <th className="num">Sold</th>
                    <th className="num">Variance</th>
                    <th className="num">At retail</th>
                  </>
                }
              >
                {settlement.lines.slice(0, 8).map((line) => (
                  <tr key={line.itemId}>
                    <td>{items.get(line.itemId)?.name ?? line.itemId}</td>
                    <td className="num">{num(line.issued)}</td>
                    <td className="num">{num(line.sold)}</td>
                    <td className="num">
                      <span style={line.varianceUnits > 0 ? { color: 'var(--crit)' } : undefined}>
                        {line.varianceUnits > 0 ? '−' : ''}
                        {num(Math.abs(line.varianceUnits))}
                      </span>
                    </td>
                    <td className="num">{money(line.varianceRetailCents)}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          ) : null}

          <Panel title="People" hint={`${staff.length} on file`} flush>
            <Table
              head={
                <>
                  <th>Name</th>
                  <th>Role</th>
                  <th>ID number</th>
                  <th>Food handler</th>
                  <th>Active</th>
                </>
              }
            >
              {staff.slice(0, 40).map((person) => {
                const certLapsed =
                  person.foodHandlerExpiry !== null && person.foodHandlerExpiry < now
                return (
                  <tr key={person.id}>
                    <td>{person.fullName}</td>
                    <td className="tiny">{person.role}</td>
                    <td className="code tiny">{person.idNumber}</td>
                    <td className="tight">
                      {person.foodHandlerExpiry === null ? (
                        <span className="muted tiny">n/a</span>
                      ) : certLapsed ? (
                        <Pill tone="crit">Lapsed</Pill>
                      ) : (
                        <span className="code tiny">{isoDate(person.foodHandlerExpiry)}</span>
                      )}
                    </td>
                    <td className="tight">
                      {person.active ? <Pill tone="ok">Yes</Pill> : <Pill>No</Pill>}
                    </td>
                  </tr>
                )
              })}
            </Table>
            {staff.length > 40 ? (
              <div className="tiny muted" style={{ padding: '9px 12px' }}>
                Showing 40 of {staff.length}.
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Company">
            <Dl>
              <DlRow label="Registered">{vendor.registeredName}</DlRow>
              <DlRow label="Reg no">
                <span className="code">{vendor.regNo ?? '—'}</span>
              </DlRow>
              <DlRow label="VAT no">
                <span className="code">{vendor.vatNo ?? '—'}</span>
              </DlRow>
              <DlRow label="Contact">{vendor.contactName}</DlRow>
              <DlRow label="Phone">
                <span className="code">{vendor.contactPhone}</span>
              </DlRow>
              <DlRow label="Email">
                <span className="tiny">{vendor.contactEmail}</span>
              </DlRow>
              <DlRow label="On book since">{date(vendor.createdAt)}</DlRow>
            </Dl>
          </Panel>

          <Panel title="Allocations" flush>
            {allocationsByEvent.every((a) => a.allocations.length === 0) ? (
              <Empty>Never allocated a counter.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th>Event</th>
                    <th className="num">Counters</th>
                    <th className="num">Declared</th>
                  </>
                }
              >
                {allocationsByEvent
                  .filter((a) => a.allocations.length > 0)
                  .map(({ event, allocations }) => {
                    const declared = allocations.reduce(
                      (s, a) => s + (a.declaredSalesCents ?? 0),
                      0,
                    )
                    return (
                      <tr key={event.id}>
                        <td>
                          <Link className="rowLink" href={`/events/${event.code}`}>
                            {event.code}
                          </Link>
                          <div className="tiny muted">{date(event.startsAt)}</div>
                        </td>
                        <td className="num">{allocations.length}</td>
                        <td className="num">{declared > 0 ? money(declared) : '—'}</td>
                      </tr>
                    )
                  })}
              </Table>
            )}
          </Panel>

          {score.notes.length > 0 ? (
            <Panel title="Scorecard notes">
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5 }}>
                {score.notes.map((note) => (
                  <li key={note} style={{ marginBottom: 4 }}>
                    {note}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  )
}
