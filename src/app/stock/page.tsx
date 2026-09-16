import Link from 'next/link'

import { Empty, Panel, PageHead, Pill, Stat, Table } from '@/components/ui'
import { flowByItem, negativeBalances, onHand, type LedgerMovement } from '@/domain/ledger'
import { money, num, time } from '@/lib/format'
import {
  balancesForEvent,
  currentEvent,
  itemsById,
  listMovements,
  listStockItems,
  listVendors,
} from '@/queries/read'

export const metadata = { title: 'Stock' }

export default async function StockPage() {
  const [items, event, vendors, byId] = await Promise.all([
    listStockItems(),
    currentEvent(),
    listVendors(),
    itemsById(),
  ])

  const movements = event ? await listMovements(event.id) : []
  const balances = event ? await balancesForEvent(event.id) : null
  const flows = flowByItem(movements as unknown as LedgerMovement[])
  const faults = balances ? negativeBalances(balances) : []
  const vendorById = new Map(vendors.map((v) => [v.id, v]))

  const stockValue = items.reduce((s, item) => {
    const held = balances ? onHand(balances, item.id) : 0
    return s + held * item.unitCostCents
  }, 0)

  const categories = [...new Set(items.map((i) => i.category))]

  return (
    <>
      <PageHead
        eyebrow="Trade"
        title="Stock"
        sub={
          <>
            The catalogue, and the ledger behind it. No balance is stored anywhere — every figure
            here is summed from the movements below, which is what makes a shrinkage claim
            arguable.
          </>
        }
      />

      <div className="grid grid--4">
        <Stat label="Lines" value={items.length} note={`${categories.length} categories`} />
        <Stat
          label="In the building"
          value={money(stockValue)}
          note="At cost, this event"
          small
        />
        <Stat label="Movements" value={num(movements.length)} note={event?.code ?? '—'} />
        <Stat
          label="Ledger faults"
          value={faults.length}
          tone={faults.length > 0 ? 'crit' : 'ok'}
          note={faults.length > 0 ? 'Negative balances' : 'Nothing impossible'}
        />
      </div>

      {faults.length > 0 ? (
        <>
          <div className="sectionTitle">Impossible balances</div>
          <Panel flush>
            <Table
              head={
                <>
                  <th>Location</th>
                  <th>Item</th>
                  <th className="num">Balance</th>
                </>
              }
            >
              {faults.slice(0, 10).map((fault) => (
                <tr key={`${fault.location.type}-${fault.location.id}-${fault.itemId}`}>
                  <td className="code tiny">
                    {fault.location.type}:{fault.location.id}
                  </td>
                  <td>{byId.get(fault.itemId)?.name ?? fault.itemId}</td>
                  <td className="num" style={{ color: 'var(--crit)' }}>
                    {num(fault.qty)}
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            A negative internal balance is physically impossible — it means a run was confirmed
            twice, an issue was posted from the wrong bay, or a delivery was never captured.
          </p>
        </>
      ) : null}

      <div className="sectionTitle">Catalogue</div>

      <Panel flush>
        <Table
          head={
            <>
              <th>SKU</th>
              <th>Item</th>
              <th>Category</th>
              <th className="num">Pack</th>
              <th className="num">Cost</th>
              <th className="num">Board</th>
              <th className="num">Margin</th>
              <th className="num">On hand</th>
              <th className="num">Sold</th>
              <th>Chill</th>
            </>
          }
        >
          {items.map((item) => {
            const flow = flows.get(item.id)
            const held = balances ? onHand(balances, item.id) : 0
            const margin =
              item.unitPriceCents > 0
                ? (item.unitPriceCents - item.unitCostCents) / item.unitPriceCents
                : null

            return (
              <tr key={item.id}>
                <td className="code tiny">{item.sku}</td>
                <td>{item.name}</td>
                <td className="tiny muted">{item.category.replace(/_/g, ' ')}</td>
                <td className="num">{item.packSize}</td>
                <td className="num">{money(item.unitCostCents)}</td>
                <td className="num">
                  {item.unitPriceCents > 0 ? money(item.unitPriceCents) : <span className="muted">—</span>}
                </td>
                <td className="num">
                  {margin === null ? (
                    <span className="muted">—</span>
                  ) : (
                    `${Math.round(margin * 100)}%`
                  )}
                </td>
                <td className="num">{held !== 0 ? num(held) : <span className="muted">—</span>}</td>
                <td className="num">
                  {flow?.sold ? num(flow.sold) : <span className="muted">—</span>}
                </td>
                <td className="tight">
                  {item.requiresChill ? <Pill tone="info">Chilled</Pill> : null}
                </td>
              </tr>
            )
          })}
        </Table>
      </Panel>

      <div className="sectionTitle">
        Ledger {event ? `· ${event.name}` : ''}
      </div>

      <Panel flush>
        {movements.length === 0 ? (
          <Empty>No movements posted for this event.</Empty>
        ) : (
          <Table
            head={
              <>
                <th>Time</th>
                <th>Kind</th>
                <th>Item</th>
                <th className="num">Qty</th>
                <th>From</th>
                <th>To</th>
                <th>Vendor</th>
                <th>Actor</th>
                <th>Ref</th>
              </>
            }
          >
            {movements.slice(0, 60).map((m) => (
              <tr key={m.id}>
                <td className="tiny muted">{time(m.at)}</td>
                <td className="tight">
                  <Pill
                    tone={
                      m.kind === 'delivery'
                        ? 'info'
                        : m.kind === 'issue'
                          ? 'accent'
                          : m.kind === 'sale'
                            ? 'ok'
                            : m.kind === 'waste'
                              ? 'crit'
                              : 'neutral'
                    }
                  >
                    {m.kind}
                  </Pill>
                </td>
                <td className="tiny">{byId.get(m.itemId)?.name ?? m.itemId}</td>
                <td className="num">{num(m.qty)}</td>
                <td className="code tiny muted">
                  {m.fromType}
                  {m.fromId ? `:${m.fromId.slice(-8)}` : ''}
                </td>
                <td className="code tiny muted">
                  {m.toType}
                  {m.toId ? `:${m.toId.slice(-8)}` : ''}
                </td>
                <td className="tiny">
                  <Link className="rowLink" href={`/vendors/${vendorById.get(m.vendorId)?.code ?? ''}`}>
                    {vendorById.get(m.vendorId)?.code ?? '—'}
                  </Link>
                </td>
                <td className="tiny muted">{m.actor}</td>
                <td className="code tiny muted">{m.ref ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      {movements.length > 60 ? (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Showing the 60 most recent of {num(movements.length)} movements.
        </p>
      ) : null}
    </>
  )
}
