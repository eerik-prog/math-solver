// Fails the build if the JavaScript loaded on first visit grows past the budget.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = { entry: 100, worker: 60 }
const dir = 'dist/assets'
const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
const gz = (f) => gzipSync(readFileSync(join(dir, f))).length / 1024

let failed = false
for (const [kind, pattern] of [
  ['entry', /^index-.*\.js$/],
  ['worker', /^solver\.worker-.*\.js$/],
]) {
  const match = files.filter((f) => pattern.test(f))
  if (match.length === 0) {
    console.error(`No ${kind} bundle found in ${dir}`)
    failed = true
    continue
  }
  for (const f of match) {
    const size = gz(f)
    const ok = size <= BUDGET_KB[kind]
    console.log(`${ok ? '✓' : '✗'} ${kind} ${f}: ${size.toFixed(1)} kB gzip (budget ${BUDGET_KB[kind]} kB)`)
    if (!ok) failed = true
  }
}
process.exit(failed ? 1 : 0)
