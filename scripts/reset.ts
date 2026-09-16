/** Wipe and reseed the local database. */
import { seed } from '../src/seed'

const summary = seed({ force: true })
const total = Object.values(summary).reduce((s, n) => s + n, 0)

console.log(`Reset complete — ${total} rows across ${Object.keys(summary).length} tables.`)
