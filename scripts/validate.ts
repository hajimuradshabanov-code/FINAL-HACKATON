/**
 * Runs the detector validation (src/science/validation.ts) and prints the tables.
 * `npm run validate` — reported seeds; `npm run validate -- 1` — the seeds used for tuning.
 */
import { writeFileSync } from 'node:fs'
import { DETECTORS, FAMILIES, VALIDATION_KEYS, runValidation } from '../src/science/validation'

const seedBase = Number(process.argv[2] ?? 1000)
const t0 = Date.now()
const r = runValidation(30, seedBase, 20)
const f = (v: number | null) => (v === null ? '  –' : v.toFixed(0).padStart(3))
console.log(`runs per cell ${r.runsPerCell}, seed base ${r.seedBase}, ${((Date.now() - t0) / 1000).toFixed(1)} s`)
for (const fam of FAMILIES) {
  console.log(`\n${fam}`)
  for (const key of ['all', ...VALIDATION_KEYS] as const) {
    if (!r.cells.some((x) => x.family === fam && x.key === key)) continue
    const row = DETECTORS.map((d) => {
      const c = r.cells.find((x) => x.family === fam && x.key === key && x.detector === d)!
      return `${d} ${(c.rate * 100).toFixed(0).padStart(3)} % [${(c.ciLow * 100).toFixed(0)}–${(c.ciHigh * 100).toFixed(0)}] med ${f(c.medianS)} s p90 ${f(c.p90S)} s`
    })
    console.log(`  ${key.padEnd(13)} ${row.join(' | ')}`)
  }
  console.log(`  personal ahead of fixed by (median): ${r.leadOverFixedS[fam] ?? '–'} s`)
}
console.log('\nfalse alarms, no disturbance:')
for (const a of r.falseAlarms) console.log(`  ${a.detector.padEnd(9)} ${a.episodes} in ${a.hours.toFixed(1)} h = ${a.perHour.toFixed(2)} / h`)

// the reported run (default seeds) is stored so the app can show it without recomputing
if (seedBase === 1000) {
  writeFileSync(new URL('../src/science/validationReport.json', import.meta.url), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), report: r }, null, 1))
  console.log('wrote src/science/validationReport.json')
}
