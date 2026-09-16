import Link from 'next/link'

import { Panel, PageHead, Pill, Stat, Table, VendorStatusPill } from '@/components/ui'
import { documentLabel, expiringDocuments, vendorStanding } from '@/domain/compliance'
import { bp, isoDate, num } from '@/lib/format'
import { documentsByVendor, listVendors, listVendorStaff } from '@/queries/read'

export const metadata = { title: 'Vendors' }

export default async function VendorsPage() {
  const now = Date.now()
  const [vendors, docsByVendor, staff] = await Promise.all([
    listVendors(),
    documentsByVendor(),
    listVendorStaff(),
  ])

  const rows = vendors.map((vendor) => {
    const documents = docsByVendor.get(vendor.id) ?? []
    const standing = vendorStanding(vendor, documents, now)
    return {
      vendor,
      standing,
      documents,
      staff: staff.filter((s) => s.vendorId === vendor.id && s.active).length,
      expiring: expiringDocuments(documents, now, 60),
    }
  })

  const blocked = rows.filter((r) => !r.standing.tradeable)
  const expiringSoon = rows.flatMap((r) =>
    r.expiring.map((d) => ({ vendor: r.vendor, doc: d })),
  )

  return (
    <>
      <PageHead
        eyebrow="Trade"
        title="Vendors"
        sub="Every concessionaire and the paperwork that lets them trade. A vendor with a lapsed document cannot be allocated a counter — the gate is checked against the day of the event, not today."
      />

      <div className="grid grid--4">
        <Stat label="On the book" value={vendors.length} />
        <Stat
          label="Cleared to trade"
          value={rows.filter((r) => r.standing.tradeable).length}
          tone="ok"
        />
        <Stat
          label="Blocked"
          value={blocked.length}
          tone={blocked.length > 0 ? 'crit' : 'ok'}
          note={blocked.length > 0 ? 'Not allocatable' : 'Nothing outstanding'}
        />
        <Stat
          label="Documents expiring"
          value={expiringSoon.length}
          tone={expiringSoon.length > 0 ? 'warn' : 'ok'}
          note="Within 60 days"
        />
      </div>

      <div className="sectionTitle">The book</div>

      <Panel flush>
        <Table
          head={
            <>
              <th>Vendor</th>
              <th>Category</th>
              <th>Status</th>
              <th>Compliance</th>
              <th className="num">Staff</th>
              <th className="num">Commission</th>
              <th>Contact</th>
            </>
          }
        >
          {rows.map(({ vendor, standing, staff: staffCount }) => (
            <tr key={vendor.id}>
              <td>
                <Link className="rowLink" href={`/vendors/${vendor.code}`}>
                  {vendor.tradingName}
                </Link>
                <div className="tiny muted code">{vendor.code}</div>
              </td>
              <td className="tiny">{vendor.category}</td>
              <td className="tight">
                <VendorStatusPill status={vendor.status} />
              </td>
              <td>
                {standing.blocking.length > 0 ? (
                  <Pill tone="crit">{standing.blocking.length} blocking</Pill>
                ) : standing.warnings.length > 0 ? (
                  <Pill tone="warn">{standing.warnings.length} expiring</Pill>
                ) : (
                  <Pill tone="ok">Clear</Pill>
                )}
              </td>
              <td className="num">{num(staffCount)}</td>
              <td className="num">{bp(vendor.commissionBp)}</td>
              <td className="tiny muted">
                {vendor.contactName}
                <div>{vendor.contactPhone}</div>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      {expiringSoon.length > 0 ? (
        <>
          <div className="sectionTitle">Renewals due</div>
          <Panel flush>
            <Table
              head={
                <>
                  <th>Vendor</th>
                  <th>Document</th>
                  <th>Reference</th>
                  <th>Expires</th>
                  <th>State</th>
                </>
              }
            >
              {expiringSoon
                .sort((a, b) => (a.doc.expiresOn ?? 0) - (b.doc.expiresOn ?? 0))
                .map(({ vendor, doc }) => {
                  const lapsed = (doc.expiresOn ?? 0) < now
                  return (
                    <tr key={doc.id}>
                      <td>
                        <Link className="rowLink" href={`/vendors/${vendor.code}`}>
                          {vendor.tradingName}
                        </Link>
                      </td>
                      <td>{documentLabel(doc.kind)}</td>
                      <td className="code tiny">{doc.reference ?? '—'}</td>
                      <td className="code">{doc.expiresOn ? isoDate(doc.expiresOn) : '—'}</td>
                      <td className="tight">
                        <Pill tone={lapsed ? 'crit' : 'warn'}>
                          {lapsed ? 'Lapsed' : 'Expiring'}
                        </Pill>
                      </td>
                    </tr>
                  )
                })}
            </Table>
          </Panel>
        </>
      ) : null}
    </>
  )
}
