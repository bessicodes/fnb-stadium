/**
 * Seed the local database.
 *
 *   npm run db:seed            fill it if it is empty, otherwise do nothing
 *   npm run db:seed -- --force rebuild from scratch, discarding everything
 */
import { seed } from '../src/seed'

const force = process.argv.includes('--force')
const summary = seed({ force })

if (Object.keys(summary).length === 0) {
  console.log('Stadium already seeded — nothing to do. Use --force to rebuild.')
} else {
  const rows = Object.entries(summary).sort((a, b) => b[1] - a[1])
  const width = Math.max(...rows.map(([label]) => label.length))

  console.log('Seeded FNB Stadium:\n')
  for (const [label, count] of rows) {
    console.log(`  ${label.padEnd(width)}  ${String(count).padStart(6)}`)
  }
  console.log(`\n  ${'total'.padEnd(width)}  ${String(rows.reduce((s, [, n]) => s + n, 0)).padStart(6)}`)
}
