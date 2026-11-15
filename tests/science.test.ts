import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATMOSPHERES, CAREER_LIMIT_MSV, ECTEMP, MARS_SURFACE_MSV_PER_DAY, NASA_TR_REFERENCE, earthMarsLink, ectempExpectedHr, ectempStep, habitatN2, physiologicalStrainIndex,
  prebreatheMinutes, radiationBudget, tissueRatio, tissueStep, trendForecast,
} from '../src/science/models'

const near = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`)

test('PSI (Moran 1998): 0 at baseline, 10 at 39.5 °C and 180 bpm, components weighted equally', () => {
  assert.equal(physiologicalStrainIndex(37, 70, 37, 70).value, 0)
  near(physiologicalStrainIndex(39.5, 180, 37, 70).value, 10, 1e-9)
  const half = physiologicalStrainIndex(38.25, 125, 37, 70)
  near(half.tcPart, 2.5, 1e-9)
  near(half.hrPart, 2.5, 1e-9)
  assert.equal(half.category, 'moderate')
  assert.equal(physiologicalStrainIndex(36.5, 60, 37, 70).value, 0, 'never negative')
})

test('ECTemp (Buller 2013): model HR at the initial 37.1 °C, convergence to the steady state of a constant HR', () => {
  near(ectempExpectedHr(37.1), 83.08, 0.01)
  let s: { ct: number; v: number } = { ct: ECTEMP.ct0, v: ECTEMP.v0 }
  for (let i = 0; i < 600; i++) s = ectempStep(s, 120)
  near(ectempExpectedHr(s.ct), 120, 0.5, 'filter settles where the observation model predicts the observed HR')
  assert.ok(s.ct > 37.9 && s.ct < 38.3, `120 bpm ↔ ~38 °C, got ${s.ct}`)
  // a resting heart rate pulls the estimate below the initial value; one step moves only a little
  const one = ectempStep({ ct: 37.1, v: 0 }, 65)
  assert.ok(one.ct < 37.1 && one.ct > 37.0)
})

test('Tissue ratio reproduces NASA’s modelled TR ≈ 1.23 for 8.2 psia / 34 % O2 + 15-min prebreathe', () => {
  const expl = ATMOSPHERES.find((a) => a.id === 'exploration')!
  const p0 = habitatN2(expl) // 5.412 psia
  const after15 = tissueStep(p0, 0, 15)
  near(tissueRatio(after15, 4.3), NASA_TR_REFERENCE.tr, 0.01)
  near(prebreatheMinutes(p0, 4.3, tissueRatio(after15, 4.3)), 15, 1e-6, 'prebreathe solver inverts the same model')
  near(prebreatheMinutes(p0, 4.3, NASA_TR_REFERENCE.tr), 12, 0.5, 'dry-gas model reaches TR 1.23 slightly sooner')
  // ISS air needs hours of prebreathe to reach the same TR — the reason for the exploration atmosphere
  const iss = ATMOSPHERES.find((a) => a.id === 'iss')!
  assert.ok(prebreatheMinutes(habitatN2(iss), 4.3, NASA_TR_REFERENCE.tr) > 240)
  near(tissueStep(10, 0, 360), 5, 1e-9, 'one half-time halves the tension')
  assert.equal(prebreatheMinutes(1, 4.3, 1.23), 0)
})

test('Radiation budget against the 600 mSv NASA career limit', () => {
  near(MARS_SURFACE_MSV_PER_DAY, 0.652, 0.001)
  const b = radiationBudget(60, 0.652)
  near(b.usedPct, 10, 1e-9)
  near(b.daysToLimit, 540 / 0.652, 1e-6)
  near(b.stay500SolMsv, 335, 1, '500 sols at the MSL-RAD surface rate')
  assert.equal(radiationBudget(700, 1).usedPct, 100)
  assert.equal(radiationBudget(10, 0).daysToLimit, Infinity)
  assert.equal(CAREER_LIMIT_MSV, 600)
})

test('Earth–Mars ephemeris (JPL Table 1) matches known events', () => {
  // closest approach 12 Jan 2025: ~96 million km (0.642 au)
  const close = earthMarsLink(Date.UTC(2025, 0, 12))
  near(close.distanceAu, 0.642, 0.01, 'Jan 2025 closest approach')
  near(close.oneWayS / 60, 5.3, 0.15, 'one-way light time, minutes')
  assert.ok(close.sunAngleDeg > 160, 'near opposition Mars is opposite the Sun')
  // solar conjunction 9 Jan 2026: Mars behind the Sun, ~2.4 au
  const conj = earthMarsLink(Date.UTC(2026, 0, 9))
  assert.ok(conj.sunAngleDeg < 3, `Sun–Earth–Mars angle at conjunction, got ${conj.sunAngleDeg}`)
  assert.ok(conj.distanceAu > 2.3 && conj.distanceAu < 2.6, `distance at conjunction ${conj.distanceAu}`)
  // physical bounds over a full synodic period
  for (let d = 0; d < 800; d += 10) {
    const l = earthMarsLink(Date.UTC(2026, 0, 1) + d * 86_400_000)
    assert.ok(l.distanceAu > 0.36 && l.distanceAu < 2.68 && l.oneWayS > 180 && l.oneWayS < 1345)
  }
})

test('Trend forecast: steady rise toward a threshold is reported; noise and flat data are not', () => {
  const t = Array.from({ length: 60 }, (_, i) => 1_000_000 + i * 1000)
  const rising = t.map((_, i) => 90 + i * 0.1) // +6 bpm/min, at 95.9 now → 105 in ~1.5 min
  const f = trendForecast(t, rising, { high: 105 })
  assert.ok(f)
  near(f.slopePerMin, 6, 1e-6)
  near(f.minutes, (105 - 95.9) / 6, 0.01)
  assert.equal(f.direction, 'rising')
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 4
  assert.equal(trendForecast(t, t.map(() => 80 + rnd()), { high: 105 }), null, 'noise is not a trend')
  assert.equal(trendForecast(t, t.map(() => 80), { high: 105 }), null)
  assert.equal(trendForecast(t.slice(0, 10), rising.slice(0, 10), { high: 105 }), null, 'too few points')
  const falling = t.map((_, i) => 97 - i * 0.02) // SpO2 dropping 1.2 %/min toward 94
  assert.equal(trendForecast(t, falling, { low: 94 })?.direction, 'falling')
  // heart rate settling after an EVA ends (90 → 69 bpm, exponential, τ = 15 s) is not a fall toward 50
  const settling = t.map((_, i) => 69 + 21 * Math.exp(-i / 15))
  assert.equal(trendForecast(t, settling, { low: 50, high: 105 }), null, 'plateau approach is not reported')
  // a sustained, accelerating rise still is
  const accel = t.map((_, i) => 90 + 0.002 * i * i)
  assert.equal(trendForecast(t, accel, { high: 105 })?.direction, 'rising')
  const slow = t.map((_, i) => 40 + i * 0.01) // +0.6 bpm/min → ~107 min to 105
  assert.equal(trendForecast(t, slow, { high: 105 }), null, 'crossing beyond the 15-min horizon')
})

// ---- engine on the live stream ---------------------------------------------------------------
import { TelemetryStore } from '../src/data/store'
import { SimulatedSource } from '../src/data/telemetrySimulator'
import { habitatSetting } from '../src/science/engine'
import { offlineAnswer } from '../src/assistant/offline'
import { buildContext } from '../src/assistant/assistant'

test('science engine: PSI, ECTemp after a minute, tissue ratio per habitat, and answers that use them', () => {
  habitatSetting.set('exploration')
  const store = new TelemetryStore()
  const sim = new SimulatedSource()
  const t0 = Date.UTC(2026, 10, 14, 9)
  for (let i = 0; i < 180; i++) store.ingest(sim.advance(t0 + i * 1000, true), true)
  let sc = store.getSnapshot().science
  assert.ok(sc.psi && sc.psi.value >= 0 && sc.psi.value <= 10)
  assert.ok(sc.ectemp && sc.ectemp.minutes >= 2, 'one Kalman update per minute')
  assert.ok(Math.abs(sc.ectemp.estimate - 37) < 1, `HR-based estimate in a physiological range, got ${sc.ectemp.estimate}`)
  assert.ok(sc.dcs)
  near(sc.dcs.tr, 5.412 / store.getSnapshot().latest!.suitPressure, 0.02, 'exploration atmosphere, almost no washout in 3 min')

  // switching the habitat re-equilibrates the tissue
  habitatSetting.set('iss')
  store.ingest(sim.advance(t0 + 181_000, true), true)
  sc = store.getSnapshot().science
  assert.equal(sc.dcs?.atmosphere.id, 'iss')
  assert.ok(sc.dcs!.tr > 2.5, `ISS air → TR ≈ 2.7, got ${sc.dcs!.tr}`)
  assert.ok(sc.dcs!.prebreatheMin > 240)

  const snap = store.getSnapshot()
  assert.match(offlineAnswer('do I need a prebreathe?', snap), /ISS cabin .*tissue ratio/s)
  assert.match(offlineAnswer('what is the signal delay to Earth?', snap), /min one way/)
  assert.match(offlineAnswer('how high is my heat strain?', snap), /Physiological Strain Index is/)
  const ctx = buildContext(snap)
  assert.match(ctx, /Earth–Mars one-way signal delay/)
  assert.match(ctx, /Physiological Strain Index/)
  assert.ok(!/NaN|undefined/.test(ctx))
  habitatSetting.set('exploration')
})
