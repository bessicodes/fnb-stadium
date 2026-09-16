import type BetterSqlite3 from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Apply every unapplied file in `drizzle/` and record it.
 *
 * Drizzle ships a migrator, but it resolves its folder relative to the
 * process working directory. Under `next build` that is not reliably the
 * repo root, and a migration that silently does not run is a worse failure
 * than a loud one — so this reads the folder itself and records what it ran
 * in `__migrations`.
 */
export function applyMigrations(sqlite: BetterSqlite3.Database, folder = 'drizzle') {
  sqlite.exec(`
    create table if not exists __migrations (
      name text primary key,
      applied_at integer not null
    )
  `)

  const applied = new Set(
    sqlite
      .prepare('select name from __migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  )

  let files: string[]
  try {
    files = readdirSync(folder)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  } catch {
    // No migrations folder (a consumer vendoring just the schema): nothing to do.
    return
  }

  const record = sqlite.prepare(
    'insert into __migrations (name, applied_at) values (?, ?)',
  )

  for (const file of files) {
    if (applied.has(file)) continue

    const sql = readFileSync(join(folder, file), 'utf8')
    // Drizzle separates statements with this marker; splitting on bare `;`
    // would cut through string literals and trigger bodies.
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)

    const run = sqlite.transaction(() => {
      for (const statement of statements) sqlite.exec(statement)
      record.run(file, Date.now())
    })
    run()
  }
}
