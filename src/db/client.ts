import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import * as schema from './schema'
import { applyMigrations } from './migrate'

export type Db = ReturnType<typeof build>

/**
 * Where the database lives.
 *
 * Kept as a statically scoped `join(cwd, 'data', …)` rather than a resolve of
 * an arbitrary string: Turbopack traces dynamic filesystem access and, failing
 * to narrow it, bundles the entire project into the server output. An explicit
 * override is still honoured, marked so the tracer leaves it alone.
 */
function databaseFile(): string {
  const override = process.env.STADIUM_DB
  if (override) return join(/* turbopackIgnore: true */ override)
  return join(process.cwd(), 'data', 'stadium.db')
}

function build() {
  const file = databaseFile()
  mkdirSync(dirname(file), { recursive: true })

  const sqlite = new Database(file)
  // WAL lets the dev server read while a seed or an action writes, instead of
  // throwing SQLITE_BUSY at whoever lost the race.
  sqlite.pragma('journal_mode = WAL')
  // SQLite ignores foreign keys unless asked, and half this schema's integrity
  // is foreign keys.
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  applyMigrations(sqlite, join(process.cwd(), 'drizzle'))

  return drizzle(sqlite, { schema })
}

/**
 * One connection per process, cached on globalThis.
 *
 * Next's dev server re-evaluates modules on every hot reload. Without this
 * cache each reload would open another handle to the same file and leak them
 * until the process runs out.
 */
const globalForDb = globalThis as unknown as { __stadiumDb?: Db }

export function getDb(): Db {
  globalForDb.__stadiumDb ??= build()
  return globalForDb.__stadiumDb
}

export { schema }
