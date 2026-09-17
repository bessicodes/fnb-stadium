# FNB Stadium Admin

Vendor, kiosk, storage and load-out operations for **FNB Stadium** — 94 736
seats, Nasrec, Johannesburg.

A match day at a stadium this size is a logistics problem wearing a catering
costume. Ninety-odd counters, a dozen concessionaires, seventeen stores holding
two hundred-odd numbered bays, ten loading crews, and a two-hour window in which
every one of those counters will run out of something. This is the system
that runs that day: who is allowed to trade, where their stock sits, who is
carrying it to the counter right now, and — when it is over — what is missing and
who owes whom.

## Two editions

Both run the same operational rules. They differ only in where records live.

| | **Hosted** (`index.html`) | **Server** (`src/`) |
|---|---|---|
| Runs on | GitHub Pages — a link, nothing to install | Node 20+, Next.js 16 |
| Records live in | the operator's own browser | SQLite, on the server |
| Shared between people | no | yes |
| Audit trail, ledger, reconciliation | — | yes |
| Seeded demo data | no, starts empty | yes, a full season |

**Seat map** draws Level 1 from SMSA's own general-seating sticker
schedule: blocks 101-150, 32 624 seats, 1 815 rows, every block sheet
reconciling exactly with its summary. The bowl is a raked 3D view you can
zoom and drag; open a block and it redraws flat, pitch-side down, with every
seat individually placed and numbered and the row label at both ends. Seat
counts are SMSA's; the *shape* is derived, because the schedule carries no
survey coordinates — block width follows mean row width and depth follows
row count, so drawn area tracks seats. The screen says as much.

**History** ships with what this stadium is publicly recorded as having
hosted: twenty events from Mandela's 1990 address to the 2019 Carling Cup,
each carrying its source. These are press-and-almanac figures, not SMSA gate
receipts, and the loader says so — they are a starting point to reconcile
against the real returns, and where a figure is contested the record says
that rather than picking a number and looking certain. Start times are blank
unless the time itself is published; three of the twenty are.

Every list exports to Excel or PDF, sorts by any column, and **History**
collects events whose date has passed — grouped by year, with gate totals, average fill and the
best-attended night, and a full record per event. An export carries what is
on screen, filter included, and says so in its own subtitle.

The hosted edition is the one to open on a phone in a concourse or to hand
someone to try. It says so on screen — the dashboard states plainly that
records are kept in that browser alone, because mistaking it for a shared
system loses work.

### Hosted

Served straight off the branch, with no build step and no CI: **Settings ->
Pages**, source *Deploy from a branch*, branch `main`, folder `/ (root)`.
GitHub publishes `index.html` and republishes on every push.

`.nojekyll` sits beside it because this is a hand-written page, not a Jekyll
site; without it GitHub would treat `README.md` as the site index and serve
this file instead of the dashboard.

### Server

```bash
npm install
npm run dev          # http://localhost:3000
```

The first run seeds a full season of realistic data and opens on a match that is
**live right now**, mid-first-half, with load runs in flight and some of them
already past their window. There is no external database, no account to create
and no API key: everything runs against a local SQLite file.

Deploying this edition to a public URL means moving off SQLite — a serverless
host gives every request a fresh read-only filesystem, so the file would be
empty on arrival and gone on exit. Point `src/db/client.ts` at Turso or
Postgres and the rest of the app is unchanged, because nothing above
`src/db/` knows what the database is.

---

## What it does

### Compliance gating

A vendor cannot be given a counter unless every document their trade requires is
on file and valid **on the day of the event** — not on the day the allocation was
drafted. A liquor licence that is valid in March and lapsed by the June fixture
is not compliance, and that distinction is the difference between a licensed
venue and an unlicensed one.

The document kinds are the real South African ones: Certificate of Acceptability
(R638), Gauteng liquor licence, public liability cover, COIDA letter of good
standing, SARS tax clearance, food handler certificates, SANS 10087 gas
compliance. Which ones apply depends on the counter — a bar needs a liquor
licence, a coffee cart does not, anything with a burner needs the gas
certificate.

The gate runs server-side, in the action. A disabled button is not access
control.

### Storage down to the bay

Rooms are not the unit of allocation — **spots** are. `CR2-A-04` is a named
pallet bay with a capacity, let to exactly one vendor for exactly one event. Two
vendors told to "use the cold room" will stack into each other, and once pallets
are mixed nobody can say whose crate went missing.

The system refuses double-letting, refuses over-capacity, and refuses chilled
stock sent to a dry store.

### Loader dispatch

The heart of it. A kiosk runs dry in block 23; somebody has to get four cases
from cold room 2 to that counter before the queue gives up. That is a **load
run**, and it walks a strict ladder:

```
requested → assigned → picking → in_transit → delivered → confirmed
```

Each step stamps its own time, which is the only honest record of why a counter
waited forty minutes. Runs are ranked by whether they have already missed their
window, then by urgency, then by age. Crews are suggested by travel time along
mapped haul routes — because at a stadium the honest ETA depends on which
service lift is working, so the route is data, not a guess.

`confirmed` is special: the kiosk signing for the stock is the **only** thing
that posts a movement to the ledger. Stock a crew says it delivered but nobody
signed for is not stock on hand.

### The stock ledger

No balance is stored anywhere in this system. Every figure in the app is summed
from an append-only movement ledger. That is slower and completely worth it: a
stored balance that drifts from its own history cannot be audited, and arguments
with vendors about shrinkage are won or lost on the history.

Negative internal balances are surfaced as faults rather than clamped to zero —
they are physically impossible, so each one is a run confirmed twice, an issue
posted from the wrong bay, or a delivery never captured.

### Replenishment

Every counter has a floor and a ceiling per line. The par sweep compares live
balances against them and proposes runs to top counters back up — counting stock
already in transit, so a counter with 20 on the shelf and 96 on the way is not
short. Urgency comes from how far below the floor it has fallen: before doors
open everything is routine; empty at half time is critical.

### Reconciliation

```
issued − returned − wasted = what left the counter
                           vs
                    what the till says was sold
```

The gap is shrinkage. Commission is charged on declared turnover because that is
what the contract says — but the ledger figure sits next to it, and the gap
between the two is its own conversation. The seeded data includes a vendor who
was suspended on the back of exactly that finding.

---

## Architecture

```
src/db/        Drizzle schema (20 tables), generated migrations, SQLite client
src/domain/    Pure, tested logic — no database imports anywhere in here
src/queries/   Every read the app performs
src/seed/      Builders for the demo stadium
src/app/       Routes and server actions
```

**Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript** strict ·
**Drizzle** over **SQLite** · **Vitest**.

The domain layer is the point. It holds the rules — compliance, ledger,
allocation, dispatch, replenishment, forecasting, reconciliation — as pure
functions over plain data, with **182 unit tests** covering them and no database
anywhere in sight. The web app is a way to look at those rules; it is not where
they live.

```bash
npm test          # 182 tests
npm run typecheck
npm run build
```

### Why SQLite

An ops system for one building does not need a database server. One file, no
network hop, no connection pool, and a concourse tablet that keeps working when
the venue wifi does not. Drizzle means moving to Postgres later is a dialect
change, not a rewrite.

```bash
npm run db:seed              # fill an empty database
npm run db:seed -- --force   # rebuild from scratch
npm run db:reset             # wipe and reseed
```

Set `STADIUM_DB` to put the file somewhere else.

---

## The seeded stadium

| | |
|---|---|
| Seats | 94 736 across 110 blocks — lower, suite ring, upper |
| Levels | L0 service · L1 lower concourse · L2 suites · L3 upper · perimeter |
| Kiosks | 92 counters, with fit-out, till counts and served-per-hour ratings |
| Storage | 17 rooms, 222 named bays — chilled, frozen, dry, beverage, gas, merch, waste |
| Haul routes | 638 timed room-to-counter walks |
| Vendors | 11, with full compliance packs and 261 staff |
| Crews | 10 loading crews with call signs and base zones |
| Stock | 34 SKUs with cost and board prices |
| Events | 5 — one reconciled, one **live**, one in accreditation, two planned |
| Ledger | ~10 000 stock movements |

The topology is a faithful operational model, not a survey drawing. Block
numbering and room codes follow the conventions a venue this size uses; swap
them for the real asset register when one is to hand — everything downstream
reads codes, not positions.

## What is deliberately not here

- **No authentication.** Every screen assumes an authorised operator. Roles
  (control, kiosk supervisor, crew lead, vendor) are the obvious next layer.
- **No till integration.** Sales arrive as ledger movements tagged
  `till-export`; a real deployment reads them from the POS.
- **No offline mode.** Concourse wifi is bad and a crew's phone will lose it.
  The run lifecycle is designed to queue offline — that work has not been done.
- **The par sweep is blunt.** Mid-match it will raise a run for every line below
  its floor, which can be hundreds at once. Real use wants a cap and a
  per-counter batch.

---

Built for Stadium Management, Nasrec.
