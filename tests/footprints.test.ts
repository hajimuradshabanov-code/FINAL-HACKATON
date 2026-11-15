import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRAIL_STEPS, layFootprints, pointAlong, recordStep, stepsReached, type TrailStep } from '../src/lib/footprints'
import { alertBand, summariseHealth, windowStats } from '../src/lib/health'
import { mixSources, originOf, sourceClassOf } from '../src/lib/provenance'
import { METRIC_KEYS, type MetricKey, type Status } from '../src/config/thresholds'
import { EMPTY_SCIENCE } from '../src/science/engine'
import { TelemetryStore } from '../src/data/store'
import { SimulatedSource, seededRng } from '../src/data/telemetrySimulator'
import { buildLiveSample } from '../src/data/liveSource'
import type { Sample } from '../src/data/types'

// ---- footprints --------------------------------------------------------------------------------
test('the first print is made at the start and the last stretch is reached before arrival', () => {
  assert.equal(stepsReached(0), 1)
  assert.equal(stepsReached(1 / TRAIL_STEPS - 1e-9), 1)
  assert.equal(stepsReached(1 / TRAIL_STEPS), 2)
  assert.equal(stepsReached(1), TRAIL_STEPS)
  assert.equal(stepsReached(NaN), 0)
})

test('a stretch keeps the worst status seen on it, and an unchanged trail keeps its identity', () => {
  let trail: readonly TrailStep[] = []
  trail = recordStep(trail, 0, 1000, 'normal', 70)
  assert.equal(trail.length, 1)
  const same = recordStep(trail, 0.001, 2000, 'normal', 71)
  assert.equal(same, trail, 'no change, same array')
  trail = recordStep(trail, 0.002, 3000, 'critical', 130)
  assert.deepEqual(trail[0], { t: 1000, status: 'critical', hr: 70 }, 'time and heart rate are those on entering the stretch')
  trail = recordStep(trail, 0.003, 4000, 'normal', 72)
  assert.equal(trail[0].status, 'critical', 'recovering does not clean the print')
  trail = recordStep(trail, 2.5 / TRAIL_STEPS, 5000, 'warning', 110)
  assert.equal(trail.length, 3, 'a jump over a stretch fills the gap')
  assert.deepEqual(trail.slice(1).map((s) => s.status), ['warning', 'warning'])
})

test('a new traverse clears the trail; jitter at a boundary does not', () => {
  let trail: readonly TrailStep[] = []
  for (let i = 0; i < 10; i++) trail = recordStep(trail, i / TRAIL_STEPS, i * 1000, 'normal', 70)
  assert.equal(trail.length, 10)
  const jitter = recordStep(trail, 9 / TRAIL_STEPS - 1e-6, 11_000, 'normal', 70)
  assert.equal(jitter, trail)
  const restarted = recordStep(trail, 0, 12_000, 'normal', 70)
  assert.equal(restarted.length, 1)
  assert.equal(restarted[0].t, 12_000)
})

test('positions follow distance along the path, with the heading of travel', () => {
  // an L: 30 units right, then 10 units down (y grows downwards on screen), with a repeated corner point
  const path = [[0, 0], [30, 0], [30, 0], [30, 10]]
  assert.deepEqual(pointAlong(path, 0), { x: 0, y: 0, deg: 0 })
  assert.deepEqual(pointAlong(path, 0.5), { x: 20, y: 0, deg: 0 })
  const end = pointAlong(path, 1)
  assert.deepEqual([end.x, end.y, end.deg], [30, 10, 90])
  assert.deepEqual(pointAlong(path, 7), end, 'clamped')
})

test('prints alternate left and right of the path and carry the status of their stretch', () => {
  const path = [[0, 0], [TRAIL_STEPS, 0]]
  const statuses: Status[] = ['normal', 'critical', 'normal', 'normal', 'warning']
  const trail = statuses.map((status, i) => ({ t: i, status, hr: 60 + i }))
  const prints = layFootprints(path, trail, 2)
  assert.deepEqual(prints.map((p) => p.x), [0, 1, 2, 3, 4])
  assert.deepEqual(prints.map((p) => p.y), [-2, 2, -2, 2, -2], 'left foot first: to the left of the direction of travel')
  assert.deepEqual(prints.map((p) => p.deg), [-9, 9, -9, 9, -9], 'toes point slightly outwards')
  assert.deepEqual(prints.map((p) => p.status), statuses)
  assert.deepEqual(prints.map((p) => p.hr), [60, 61, 62, 63, 64])
})

test('the store leaves footprints while walking, and none in live mode', () => {
  const store = new TelemetryStore({ isHidden: () => false })
  const sim = new SimulatedSource({ rng: seededRng(7), autoAnomalies: false })
  const t0 = Date.UTC(2026, 10, 15)
  for (let i = 0; i < 900; i++) store.ingest(sim.advance(t0 + i * 1000, true), true)
  const { trail, latest } = store.getSnapshot()
  assert.equal(trail.length, stepsReached(latest!.progress))
  assert.ok(trail.length >= 3, `walked far enough for several prints (${trail.length})`)
  assert.ok(trail.every((s, i) => i === 0 || s.t >= trail[i - 1].t), 'prints are in walking order')
  assert.ok(trail.every((s) => s.status === 'normal'), 'no disturbance was injected')

  const live = new TelemetryStore({ isHidden: () => false })
  live.ingest(buildLiveSample(t0, { outsideTemp: -40, doseMSv: 0.1 }), false)
  assert.equal(live.getSnapshot().trail.length, 0, 'there is no traverse without a position')
})

test('a critical vital marks the stretch it happened on', () => {
  const store = new TelemetryStore({ isHidden: () => false })
  const sim = new SimulatedSource({ rng: seededRng(3), autoAnomalies: false })
  const t0 = Date.UTC(2026, 10, 15)
  let s = sim.advance(t0, true)
  for (let i = 1; i < 300; i++) store.ingest((s = sim.advance(t0 + i * 1000, true)), true)
  const before = store.getSnapshot().trail.length
  store.ingest({ ...s, t: s.t + 1000, heartRate: 150 }, false)
  const trail = store.getSnapshot().trail
  assert.equal(trail.length, before)
  assert.equal(trail[trail.length - 1].status, 'critical')
  assert.ok(trail.slice(0, -1).every((p) => p.status === 'normal'))
})

// ---- overall health ----------------------------------------------------------------------------
const normal = Object.fromEntries(METRIC_KEYS.map((k) => [k, 'normal'])) as Record<MetricKey, Status>
const vitals = { heartRate: 72, spo2: 98, hydration: 70, bodyTemp: 36.8, suitPressure: 4.3, radiation: 1.2 }

test('overall health: the worst band decides, softer detectors only raise a watch', () => {
  assert.equal(summariseHealth(vitals, normal, EMPTY_SCIENCE).level, 'nominal')
  const h = summariseHealth(vitals, { ...normal, spo2: 'warning', heartRate: 'critical' }, EMPTY_SCIENCE)
  assert.equal(h.level, 'critical')
  assert.deepEqual(h.outOfBand, ['heartRate', 'spo2'], 'worst first')
  assert.equal(summariseHealth(vitals, { ...normal, spo2: 'warning' }, EMPTY_SCIENCE).level, 'warning')

  const forecast = { key: 'heartRate' as const, direction: 'rising' as const, slopePerMin: 3, threshold: 105, minutes: 4, r2: 0.9 }
  const watch = summariseHealth(vitals, normal, { ...EMPTY_SCIENCE, forecasts: [forecast] })
  assert.equal(watch.level, 'watch')
  assert.deepEqual(watch.trending, ['heartRate'])
  // once the vital is out of band the forecast adds nothing: it is already an alert
  assert.deepEqual(summariseHealth(vitals, { ...normal, heartRate: 'warning' }, { ...EMPTY_SCIENCE, forecasts: [forecast] }).trending, [])
})

test('overall health: without a body reading nothing is called nominal', () => {
  const none = summariseHealth({ radiation: 0.2 }, normal, EMPTY_SCIENCE)
  assert.equal(none.level, 'nodata')
  assert.deepEqual(none.measured, ['radiation'])
  assert.equal(summariseHealth(null, normal, EMPTY_SCIENCE).level, 'nodata')
  // a dose over its limit is still reported
  assert.equal(summariseHealth({ radiation: 3 }, { ...normal, radiation: 'warning' }, EMPTY_SCIENCE).level, 'warning')
})

test('alert bands and window statistics are worded from the configuration', () => {
  assert.equal(alertBand('heartRate'), '50–105')
  assert.equal(alertBand('spo2'), '≥ 94')
  assert.equal(alertBand('radiation'), '≤ 2.5')
  assert.equal(alertBand('bodyTemp'), '36–37.6')
  assert.equal(alertBand('outsideTemp'), '')
  assert.equal(windowStats([NaN, NaN]), null)
  assert.deepEqual(windowStats([2, 4, NaN, 6]), { n: 3, mean: 4, sd: 2, min: 2, max: 6 })
  assert.equal(windowStats([5])!.sd, 0)
})

// ---- provenance --------------------------------------------------------------------------------
test('one simulated value marks a whole card as simulated; nothing is real by default', () => {
  assert.equal(sourceClassOf('simulated'), 'sim')
  assert.equal(sourceClassOf('modelled'), 'model')
  assert.deepEqual((['reported', 'measured', 'self', 'device'] as const).map(sourceClassOf), ['real', 'real', 'real', 'real'])
  assert.equal(sourceClassOf('none'), 'none')
  assert.equal(mixSources(['measured', 'modelled', 'simulated']), 'sim')
  assert.equal(mixSources(['measured', 'modelled', 'none']), 'model')
  assert.equal(mixSources(['measured', 'none']), 'real')
  assert.equal(mixSources(['none']), 'none')
  assert.equal(mixSources([]), 'none')
  // a sample that says nothing about a channel is treated as simulated, never as measured
  assert.equal(originOf(undefined, 'heartRate'), 'simulated')
  assert.equal(originOf({ radiation: 'modelled' }, 'heartRate'), 'simulated')
  assert.equal(originOf({ radiation: 'modelled' }, 'radiation'), 'modelled')
})

test('the training simulation and live mode label their channels differently', () => {
  const classes = (p: Sample['provenance']) => METRIC_KEYS.map((k) => sourceClassOf(originOf(p, k)))
  const sim = new SimulatedSource({ rng: seededRng(1) }).advance(Date.UTC(2026, 10, 15), true)
  assert.ok(classes(sim.provenance).every((c) => c === 'sim'))
  const live = classes(buildLiveSample(Date.UTC(2026, 10, 15), { outsideTemp: -40, doseMSv: 0.1 }).provenance)
  assert.ok(!live.includes('sim'), 'live mode never shows a simulated value')
  assert.equal(live.filter((c) => c === 'model').length, 2)
  assert.equal(live.filter((c) => c === 'none').length, METRIC_KEYS.length - 2)
})
