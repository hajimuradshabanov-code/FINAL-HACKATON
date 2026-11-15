/**
 * Builds src/science/hindcastData.ts: the real inputs for testing the Earth→Mars radiation model on
 * the 10 September 2017 solar particle event, the largest that MSL-RAD has measured on the surface
 * of Mars with published dosimetry. Run with `npm run fetch:hindcast`.
 *
 *  - NOAA NCEI GOES-15 EPEAD corrected integral proton flux, 5-min averages (≥10 … ≥100 MeV)
 *  - NOAA NCEI GOES-15 HEPAD, 5-min averages (330–420, 420–510, 510–700, >700 MeV)
 *  - NASA DONKI CME analysis and flare record for the event
 *
 * Uses the west-looking EPEAD detector. Background = mean of 1–3 September 2017 (before the
 * activity of 4–10 September), subtracted from every channel.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const NCEI = 'https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/avg/2017/09/goes15/csv'
const EPEAD = `${NCEI}/g15_epead_cpflux_5m_20170901_20170930.csv`
const HEPAD = `${NCEI}/g15_hepad_ap_5m_20170901_20170930.csv`

function apiKey(): string {
  if (process.env.VITE_NASA_API_KEY) return process.env.VITE_NASA_API_KEY
  for (const f of ['.env.local', '.env']) {
    try {
      const m = /^VITE_NASA_API_KEY=(.+)$/m.exec(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
      if (m) return m[1].trim()
    } catch {
      /* no such file */
    }
  }
  return 'DEMO_KEY'
}

async function table(url: string) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  const lines = (await r.text()).split(/\r?\n/)
  const i = lines.findIndex((l) => l.trim().startsWith('data:'))
  const head = lines[i + 1].split(',')
  const rows = lines.slice(i + 2).filter((l) => l.trim()).map((l) => l.split(','))
  const t = rows.map((r) => Date.parse(`${r[0].replace(' ', 'T')}Z`))
  const col = (name: string) => {
    const k = head.indexOf(name)
    if (k < 0) throw new Error(`no column ${name}`)
    return rows.map((r) => Number(r[k]))
  }
  return { t, col }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const good = (x: number) => Number.isFinite(x) && x >= 0

async function main() {
  const e = await table(EPEAD)
  const h = await table(HEPAD)
  const bgEnd = Date.UTC(2017, 8, 4)
  const bg = (t: number[], c: number[]) => mean(c.filter((x, i) => t[i] < bgEnd && good(x)))

  const names = { 10: 'ZPGT10W', 30: 'ZPGT30W', 50: 'ZPGT50W', 60: 'ZPGT60W', 100: 'ZPGT100W' } as const
  const cols = Object.fromEntries(Object.entries(names).map(([k, n]) => [k, e.col(n)])) as Record<string, number[]>
  const j100 = cols[100]
  const peakI = j100.reduce((best, x, i) => (good(x) && x > j100[best] ? i : best), 0)
  const peakT = e.t[peakI]
  // one-hour window centred on the ≥100 MeV peak
  const inWin = (t: number) => Math.abs(t - peakT) <= 30 * 60_000
  const win = (t: number[], c: number[]) => mean(c.filter((x, i) => inWin(t[i]) && good(x)))

  const integral = Object.fromEntries(Object.keys(names).map((k) => [k, { peak: win(e.t, cols[k]), background: bg(e.t, cols[k]) }]))
  const hep = { P8: [330, 420], P9: [420, 510], P10: [510, 700] } as const
  let above330 = 0
  let above510 = 0
  const hepad: Record<string, { peak: number; background: number }> = {}
  for (const [name, [lo, hi]] of Object.entries(hep)) {
    const c = h.col(`${name}_FLUX`)
    hepad[name] = { peak: win(h.t, c), background: bg(h.t, c) }
    const part = Math.max(0, hepad[name].peak - hepad[name].background) * (hi - lo)
    above330 += part
    if (lo >= 510) above510 += part
  }
  const p11 = h.col('P11_FLUX')
  hepad.P11 = { peak: win(h.t, p11), background: bg(h.t, p11) }
  above330 += Math.max(0, hepad.P11.peak - hepad.P11.background)
  above510 += Math.max(0, hepad.P11.peak - hepad.P11.background)

  // hourly ≥100 MeV series for the chart, 10 Sep 12:00 – 13 Sep 00:00 UTC
  const series: [number, number][] = []
  for (let t = Date.UTC(2017, 8, 10, 12); t < Date.UTC(2017, 8, 13); t += 3_600_000) {
    const v = j100.filter((x, i) => e.t[i] >= t && e.t[i] < t + 3_600_000 && good(x))
    if (v.length) series.push([t, Number(mean(v).toPrecision(4))])
  }

  const key = apiKey()
  const donki = async (path: string) => {
    const r = await fetch(`https://api.nasa.gov/DONKI/${path}&api_key=${key}`)
    if (!r.ok) throw new Error(`DONKI ${r.status} for ${path.split('?')[0]}`)
    return (await r.json()) as Record<string, unknown>[]
  }
  // DONKI values as quoted by Bruno et al. 2019 (arXiv:1902.03969, Table 1):
  // CME first seen 16:09 UT, 2650 km/s, width 108°, direction S12W85; X8.2 flare at S08W88, peak 16:06 UT.
  let cmeSource = 'NASA DONKI CMEAnalysis (live query)'
  let cme = { id: '2017-09-10T16:09:00-CME-001', latDeg: -12, lonDeg: 85, halfAngleDeg: 54, speedKmS: 2650, url: 'https://arxiv.org/abs/1902.03969' }
  const flare = { peakTime: '2017-09-10T16:06Z', classType: 'X8.2', sourceLocation: 'S08W88', url: 'https://arxiv.org/abs/1902.03969' }
  try {
    const cmes = await donki('CMEAnalysis?startDate=2017-09-10&endDate=2017-09-11&mostAccurateOnly=true&speed=0&halfAngle=0&catalog=ALL')
    const c = cmes.filter((x) => typeof x.speed === 'number').sort((a, b) => (b.speed as number) - (a.speed as number))[0]
    cme = { id: String(c.associatedCMEID), latDeg: c.latitude as number, lonDeg: c.longitude as number, halfAngleDeg: c.halfAngle as number, speedKmS: c.speed as number, url: String(c.link) }
  } catch (err) {
    cmeSource = 'NASA DONKI values as published in Bruno et al. 2019, Table 1 (DONKI was unreachable when this file was generated)'
    console.warn(`${String(err)} — using the published DONKI values`)
  }

  const sig = (x: number) => Number(x.toPrecision(4))
  const data = {
    generated: new Date().toISOString().slice(0, 10),
    sources: { epead: EPEAD, hepad: HEPAD, donki: 'https://api.nasa.gov/DONKI/CMEAnalysis?startDate=2017-09-10&endDate=2017-09-11' },
    peakTime: new Date(peakT).toISOString(),
    integral: Object.fromEntries(Object.entries(integral).map(([k, v]) => [k, { peak: sig(v.peak), background: sig(v.background) }])),
    hepad: Object.fromEntries(Object.entries(hepad).map(([k, v]) => [k, { peak: sig(v.peak), background: sig(v.background) }])),
    above330: sig(above330),
    above510: sig(above510),
    cme: { ...cme, source: cmeSource },
    flare,
    series,
  }
  console.log(JSON.stringify({ ...data, series: `${series.length} hourly points` }, null, 1))
  writeFileSync(
    new URL('../src/science/hindcastData.ts', import.meta.url),
    `// GENERATED by scripts/fetch-hindcast.ts on ${data.generated} — do not edit by hand.\n// GOES-15 measurements (NOAA NCEI) and DONKI records for the 10 September 2017 solar particle event.\n// Fluxes in pfu = particles/(cm² s sr); HEPAD differential channels in pfu/MeV; background = 1–3 Sep 2017.\n\nexport const SEP2017 = ${JSON.stringify(data, null, 1)} as const\n`,
  )
  console.log('wrote src/science/hindcastData.ts')
}

void main()
