# The domain model

Why the rules in `src/domain/` are what they are. Read this before changing
them — most are load-bearing for a reason that is operational rather than
technical.

---

## The four groups of tables

**Topology** is the building: levels, zones, blocks, kiosks, storage rooms,
storage spots, haul routes. It changes maybe once a season.

**Commerce** is who may trade: vendors, their compliance pack, their people.

**Event** is one match or concert and every allocation made for it — which
vendor runs which counter, which bay holds their stock, who is accredited to be
on site.

**Logistics** is what physically moved: the stock ledger, the load runs that
caused the movements, the par levels that trigger them, the crews that run them,
and incidents raised along the way.

---

## Conventions

### Quantities are base units

A case of 24 cans is `24`, never `1`. Pack size lives on the item and conversion
happens only at the edges — when a crew is told how many boxes to carry, or when
a run is rounded up to whole cases.

Mixing the two units is how a stock system ends up 24× out on one line and
nobody notices until reconciliation. Nothing in the ledger should ever have to
ask "cases or cans?".

### Money is integer cents

`0.1 + 0.2 !== 0.3`, and a vendor invoice that is one cent out is a phone call.
Commission rates are basis points (1500 = 15%) so that 12.5% is exact. Rounding
happens once, at the last step.

### Timestamps are unix milliseconds

SQLite has no date type. Text dates invite timezone drift and cost a parse on
every comparison; milliseconds sort and compare correctly as integers. All
display formatting is `Africa/Johannesburg`, in `src/lib/format.ts`.

---

## The ledger (`ledger.ts`)

**No balance is stored.** Every balance in the app is summed from
`stock_movements`.

This is the single most important decision in the schema, and it is a deliberate
trade of speed for auditability. A stored balance can drift from its own history
— a double-posted confirmation, a migration that missed a row — and once it has,
there is no way to tell which of the two is lying. A derived balance cannot
drift. When a vendor disputes a shrinkage charge the answer has to be a list of
moves, not a number.

Every movement debits its origin and credits its destination, so a run from spot
to kiosk leaves the bay short and the counter long by exactly the same amount.

Four locations are **external** — `supplier`, `sold`, `waste`, `returned`. Stock
crossing those boundaries is created or destroyed as far as the building is
concerned, so their running balance carries no "on hand" meaning and `onHand()`
excludes them. This is why a delivery never trips the overdraw check: the
supplier is not ours to count.

**Negative internal balances are surfaced, not clamped.** A bay holding −40 cans
is physically impossible, so it is a data fault: a run confirmed twice, an issue
posted from the wrong bay, or a delivery never captured. Clamping it to zero
would hide the one thing worth investigating.

---

## Compliance (`compliance.ts`)

**Every check takes the instant to judge against, and callers pass the event's
kick-off — never `Date.now()`.**

This is the whole trick. An allocation drafted in March for a June fixture must
be judged against June. A liquor licence valid today and lapsed by the match is
not compliance, and checking against today is how a venue ends up trading
unlicensed on the night.

Requirements belong to the **counter**, not the vendor: the same caterer needs a
liquor licence for a bar and does not for a coffee cart, and needs a gas
certificate only where there is a burner. `requiredDocuments(kiosk)` decides.

A vendor holding two of the same document is judged on the one that lasts
longest — that is a renewal, not a duplicate.

Expiry inside 30 days is a **warning**, not a block: the allocation goes ahead
and somebody chases the renewal. Past expiry is a block.

`vendorStanding` judges the base pack only, which is why a caterer with no
liquor licence still shows as compliant — they are, right up until you try to
put them behind a bar.

---

## Storage (`storage.ts`)

The unit of allocation is the **spot**, not the room.

A stadium cold room is a shared space with no natural boundaries. Two vendors
told to "use the cold room" will stack into each other, and once pallets are
mixed nobody can say whose crate went missing. Making `CR2-A-04` a named bay
with a capacity, let to one vendor for one event, means every crate in the
building belongs to somebody.

Three failures are caught before load-in morning rather than at the door:
double-letting, over-capacity, and wrong temperature class. Chilled stock in a
dry store blocks (it is a health-certificate problem, not housekeeping);
ambient stock in a freezer warns (it only wastes space).

`suggestSpots` offers the **tightest bay that still fits**. Filling small bays
before large ones keeps the big pallet bays open for vendors who need them — a
stadium runs out of large bays long before it runs out of shelves.

---

## Dispatch (`dispatch.ts`)

The status ladder is deliberately narrow and cannot skip steps:

```
requested → assigned → picking → in_transit → delivered → confirmed
```

Each step stamps its own time, and the gaps between those stamps are the only
honest record of why a counter waited forty minutes. A run may be cancelled from
anywhere before delivery, and cancelling requires a reason.

**`confirmed` is the only status that posts to the ledger.** The kiosk signing
for the stock is what moves it; until then the stock is still the bay's, however
far down the concourse it has physically travelled. This is also why `delivered`
runs stay on the dispatch board — dropping them would leave nobody to sign and
no movement ever posted.

A **short pick is allowed** (bays run out; the sheet said 96 and the shelf had
72). Delivering **more** than the run asked for is refused, because it means the
crew took somebody else's stock.

SLA is judged on **delivery, not confirmation**. Once the stock is at the
counter the crew has done its job; a kiosk slow to sign for it is a different
problem from a slow run.

`slaReport` reports the **median**, not the mean, because one abandoned run at
180 minutes would otherwise swallow a night of good work.

Crew ranking weights travel time first — that is what the kiosk experiences —
with current load as a tiebreak, since a busy crew has to finish first. Crews
off shift or on break are not offered at all.

---

## Replenishment (`replenishment.ts`)

Two judgements separate a useful sweep from an alarm nobody trusts.

**Stock already on its way counts.** A counter with 20 on the shelf and 96 in
transit is not short. Raising a second run for it is how a kiosk ends up with
eight cases and no floor space. A delivered-but-unconfirmed run still counts as
inbound — the stock is physically there even though the ledger has not moved.

**Urgency comes from how far below the floor it has fallen**, not from the fact
that it is below, and only while trading. Before doors open everything is a
routine pre-load; the same gap at half time is critical.

A shortfall with no stock anywhere in the building is **dropped, not proposed**
— raising a run nobody can pick wastes a crew's trip and buries the real
shortage. Those come back as `unfulfillable` so control can see them and go buy
something.

Stock is claimed as it is planned, so two counters short of the same line are
not both promised the last pallet.

---

## Forecasting (`forecast.ts`)

Two questions, asked weeks out: how much will this crowd get through, and do we
have enough counter to serve them?

The spend mixes and purchase rates are **planning assumptions with no history
behind them** — the starting point for a venue with no data, meant to be
replaced by measured figures from reconciliation once a few events have run.
They are in one place so that replacing them is a single edit.

Forecast is based on **buyers, not seats**: well under half a crowd transacts at
all, because groups send one person.

`coverage` is the report that gets forgotten and the one people complain about.
A block with 4 000 seats behind two tills will queue however much lager is in
the cold room. Seats per till is the number that predicts a queue, and naming
the zones where the *building* is the constraint is what justifies capital
spend.

---

## Reconciliation (`reconciliation.ts`)

```
issued − returned − wasted = consumed
consumed − sold           = variance
```

Some variance is honest — a dropped tray, a miscount on load-in. Persistent
one-way variance at one counter is theft, and the only way to argue it with a
vendor is to show the movements.

**Commission is charged on declared turnover**, because that is what the
contract says. But the ledger valuation sits next to it, and the gap between the
two is the flag: a vendor whose ledger says R180 000 and whose till says
R140 000 is either losing stock or under-declaring, and either way somebody
should walk down there.

`vendorScore` is blunt on purpose and weighted towards compliance. A vendor who
sells well while trading on a lapsed health certificate is a bigger problem to
the venue than one who sells modestly and files on time.
