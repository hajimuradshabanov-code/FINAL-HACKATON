import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GALE, formatHours, marsClock, modelAirTemp, parseRems, PEAK_HOUR } from '../src/data/mars'

test('Mars clock: Curiosity sol numbers match the dates in the REMS feed', () => {
  // (Earth date at 12:00 UTC, sol reported by REMS for that date)
  const pairs: [string, number][] = [['2026-08-25', 4995], ['2026-08-23', 4993], ['2023-09-04', 3938], ['2012-08-16', 10], ['2012-08-07', 1]]
  for (const [date, sol] of pairs) assert.equal(marsClock(Date.parse(`${date}T12:00:00Z`)).sol, sol, date)
})

test('Mars clock: landing was sol 0 at about 15:03 local mean solar time', () => {
  const c = marsClock(Date.UTC(2012, 7, 6, 5, 17, 57))
  assert.equal(c.sol, 0)
  assert.ok(Math.abs(c.lmstHours - 15.05) < 0.05, `${c.lmstHours}`)
  // Mars24 reference: MSD 44796.0 at 2000-01-06 00:00:00 UTC is ~44795.9998
  assert.ok(Math.abs(marsClock(Date.UTC(2000, 0, 6)).msd - 44795.9998) < 0.0005)
  // local time runs ahead of the prime meridian by the east longitude
  const dh = (c.lmstHours - c.mtcHours + 24) % 24
  assert.ok(Math.abs(dh - GALE.lonEastDeg / 15) < 1e-6)
  assert.equal(formatHours(15.06), '15:03')
  assert.equal(formatHours(-0.5), '23:30')
})

test('REMS parser: newest first, "--" sols skipped, numbers from strings', () => {
  const feed = {
    soles: [
      { sol: '9', terrestrial_date: '2012-08-15', min_temp: '--', max_temp: '--', pressure: '--', sunrise: '05:28', sunset: '17:22' },
      { sol: '4994', terrestrial_date: '2026-08-24', min_temp: '-70', max_temp: '-7', pressure: '777', sunrise: '06:46', sunset: '18:52', ls: '340', atmo_opacity: 'Sunny', local_uv_irradiance_index: 'Moderate', min_gts_temp: '-82', max_gts_temp: '4' },
      { sol: '4995', terrestrial_date: '2026-08-25', min_temp: '-71', max_temp: '-5', pressure: '777', sunrise: '06:46', sunset: '18:51', ls: '341', atmo_opacity: 'Sunny', local_uv_irradiance_index: '--', min_gts_temp: '--', max_gts_temp: '4' },
      { sol: '5000', min_temp: '20', max_temp: '-20' },
      null,
    ],
  }
  const sols = parseRems(feed)
  assert.deepEqual(sols.map((s) => s.sol), [4995, 4994])
  assert.deepEqual([sols[0].airMin, sols[0].airMax, sols[0].pressurePa, sols[0].groundMin, sols[0].uv], [-71, -5, 777, null, ''])
  assert.ok(Math.abs(sols[0].sunriseH - (6 + 46 / 60)) < 1e-9)
  assert.deepEqual(parseRems({}), [])
  assert.deepEqual(parseRems(null), [])
})

test('air temperature model: measured minimum at sunrise, maximum mid-afternoon, never outside the two', () => {
  const sol = { airMin: -71, airMax: -5, sunriseH: 6.77 }
  assert.ok(Math.abs(modelAirTemp(sol, 6.77) - -71) < 1e-9)
  assert.ok(Math.abs(modelAirTemp(sol, PEAK_HOUR) - -5) < 1e-9)
  let prev = modelAirTemp(sol, 0)
  for (let h = 0.25; h <= 24; h += 0.25) {
    const v = modelAirTemp(sol, h)
    assert.ok(v >= -71 - 1e-9 && v <= -5 + 1e-9)
    assert.ok(Math.abs(v - prev) < 6, `no jump at ${h} h`)
    prev = v
  }
  assert.ok(Math.abs(modelAirTemp(sol, 24) - modelAirTemp(sol, 0)) < 1e-9, 'continuous over midnight')
  assert.ok(modelAirTemp(sol, 22) < modelAirTemp(sol, 18), 'cooling through the evening')
})

// ---- live source: only what an instrument reports ------------------------------------------------
import { METRIC_KEYS } from '../src/config/thresholds'
import { LiveSource, buildLiveSample } from '../src/data/liveSource'
import { TelemetryStore } from '../src/data/store'
import { newestSols, handleRems } from '../api/rems'
import { configuredMode, isDataMode, isSimulation } from '../src/data/createSource'

const T = Date.UTC(2026, 10, 14, 15)

test('live sample: every body and suit value is absent, never invented', () => {
  const s = buildLiveSample(T, { outsideTemp: NaN, doseMSv: 0.3 })
  for (const k of METRIC_KEYS) {
    if (k === 'radiation') continue
    assert.ok(Number.isNaN(s[k]), `${k} = ${s[k]}`)
    assert.equal(s.provenance?.[k], 'none')
  }
  assert.equal(s.radiation, 0.3)
  assert.equal(s.provenance?.radiation, 'modelled')
  assert.equal(s.sol, 5074)
  assert.equal(s.anomaly, null)
  assert.equal(s.evaActive, false)
  assert.ok(Number.isNaN(s.distanceKm) && Number.isNaN(s.etaMin))
  const warm = buildLiveSample(T, { outsideTemp: -10.4, doseMSv: 0.3 })
  assert.equal(warm.outsideTemp, -10)
  assert.equal(warm.provenance?.outsideTemp, 'modelled')
})

test('live source: dose is the background accrued this sol and only grows within it', () => {
  const src = new LiveSource()
  const a = src.sample(T)
  const b = src.sample(T + 1000)
  const c = src.sample(T + 2000)
  assert.ok(a.radiation > 0 && a.radiation < 0.67, `${a.radiation}`)
  assert.ok(b.radiation >= a.radiation && c.radiation >= b.radiation)
})

test('store: when a reading disappears its alert closes as "lost" and the status is no longer critical', () => {
  const store = new TelemetryStore({ now: () => T, isHidden: () => false })
  const env = { outsideTemp: -10, doseMSv: 0.3 }
  // a backend that reports a heart rate and then stops
  store.ingest({ ...buildLiveSample(T, env), heartRate: 72 }, false)
  store.ingest({ ...buildLiveSample(T + 1000, env), heartRate: 150 }, false)
  assert.equal(store.getSnapshot().statuses.heartRate, 'critical')
  assert.equal(store.getSnapshot().activeAlerts, 1)
  store.ingest(buildLiveSample(T + 9000, env), false)
  const snap = store.getSnapshot()
  assert.equal(snap.statuses.heartRate, 'normal')
  assert.equal(snap.activeAlerts, 0)
  assert.equal(snap.alerts[0].outcome, 'lost')
  assert.match(snap.events.at(-1)!.label, /reading lost/)
})

test('Mars weather relay: newest sols only; upstream failures become 502 / 504', async () => {
  const feed = { soles: [{ sol: '9' }, { sol: '4995' }, { sol: '4994' }, null, { sol: 'x' }] }
  assert.deepEqual(newestSols(feed, 2), [{ sol: '4995' }, { sol: '4994' }])
  assert.equal(newestSols({ nope: 1 }), null)
  const ok = await handleRems((async () => ({ ok: true, json: async () => feed })) as unknown as typeof fetch)
  assert.equal(ok.status, 200)
  assert.equal((ok.body.soles as unknown[]).length, 3)
  assert.equal((await handleRems((async () => ({ ok: false, status: 503 })) as unknown as typeof fetch)).status, 502)
  assert.equal((await handleRems((async () => ({ ok: true, json: async () => ({ soles: [] }) })) as unknown as typeof fetch)).status, 502)
  assert.equal((await handleRems((async () => { throw new Error('down') }) as unknown as typeof fetch)).status, 504)
})

test('data modes: the simulation on NASA data is the default; live is not a simulation', () => {
  assert.equal(configuredMode(), 'nasa')
  assert.deepEqual(['live', 'nasa', 'sim', 'ws'].map((m) => isDataMode(m) && isSimulation(m)), [false, true, true, false])
  assert.equal(isDataMode('demo'), false)
})
