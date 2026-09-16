<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FNB Stadium Admin

Vendor, kiosk, storage and load-out operations for FNB Stadium. Read
`docs/domain.md` before changing anything in `src/domain/` — the rules encoded
there are operational, not arbitrary.

## Shape of the code

```
src/db/          Drizzle schema, migrations, the SQLite connection
src/domain/      Pure logic, fully unit-tested, no database imports
src/queries/     Every read the app does
src/seed/        Builders for the demo stadium
src/app/         Routes, plus server actions in src/app/actions/
```

## Rules that matter

- **`src/domain/` never imports `src/db/client` or `src/queries`.** It takes
  plain data and returns plain data. That is what makes it testable without a
  database, and every rule in there has tests.
- **Stock quantities are base units, never cases.** A case of 24 is 24. Pack
  size lives on the item; convert at the edges only.
- **Money is integer cents.** No float ever touches a rand figure.
- **Timestamps are unix milliseconds** in integer columns.
- **Balances are never stored.** They are summed from `stock_movements` by
  `src/domain/ledger.ts`. Do not add a cached balance column — a stored total
  that disagrees with its own history cannot settle a dispute with a vendor.
- **Reads call `await connection()` first** (see `src/queries/read.ts`).
  better-sqlite3 is synchronous, so without it Next runs the queries during the
  production prerender and bakes a frozen stadium into the build.
- **Server actions are the security boundary.** The compliance gate runs in
  `src/app/actions/allocation.ts`, not in the button that calls it.
- **Run codes (`LR-####`) are unique across the whole database**, not per event
  — control reads them over the radio.

## Checks

```bash
npm test          # unit tests over the domain layer
npm run typecheck
npm run build
```

Changing the schema means regenerating the migration:

```bash
npx drizzle-kit generate --name <what-changed>
```
