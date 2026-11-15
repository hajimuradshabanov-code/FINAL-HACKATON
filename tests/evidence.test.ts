import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASELINE, PersonalBaseline } from '../src/science/baseline'
import { analyseOsdr, osdrAnalysis, t975 } from '../src/science/osdr'
import { OSDR_PANELS } from '../src/science/osdrData'
import {
  ACTION, EXAMPLES, GCR_USV_H, RAD, SHIELDS, assessRadiation, cmeAtMars, dbmArrival, goesTail, marsGeometry, parkerOffsetDeg, sepScaling, shieldFactor, spectralIndex, surfaceSepDoseUSvH, tailIndex,
  type Cme,
} from '../src/science/radiation'
import { AU_KM } from '../src/science/models'
import { METHODS } from '../src/science/methods'
import { parseCmeAnalyses } from '../src/data/nasaApi'
import { SimulatedSource, seededRng } from '../src/data/telemetrySimulator'
import { PATTERN, SUBTHRESHOLD_OFFSET, VALIDATION_KEYS, runQuiet, runScenario, summarise, validationPlan, wilson } from '../src/science/validation'
import { JOINT, JointDetector, SIGNATURES, matchSignature } from '../src/science/joint'
import { OBSERVED_EXCESS_UGY_H, runHindcast } from '../src/science/hindcast'
import { SEP2017 } from '../src/science/hindcastData'
import type { BaselineState } from '../src/science/baseline'
import { METRICS, statusOf } from '../src/config/thresholds'
import stored from '../src/science/validationReport.json'

const near = (a: number, b: number, tol: number, msg?: string) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`)

// ---- personal baseline -------------------------------------------------------------------------
function feed(b: PersonalBaseline, t0: number, n: number, hr: (i: number) => number, eva = false) {
  let last = b.update(t0, eva, { heartRate: hr(0) })
  for (let i = 1; i < n; i++) last = b.update(t0 + i * 1000, eva, { heartRate: hr(i) })
  return last
}

test('personal baseline: learns the norm, flags a shift that stays inside the fixed band, ignores a single spike', () => {
  const rng = seededRng(3)
  const noise = () => (rng() - 0.5) * 8 // ±4 bpm, sd ≈ 2.3
  const b = new PersonalBaseline()
  let r = feed(b, 0, 300, () => 66 + noise())
  near(r.heartRate.mean, 66, 1)
  assert.ok(r.heartRate.sd > 1.5 && r.heartRate.sd < 3.5, `sd ${r.heartRate.sd}`)
  assert.equal(r.heartRate.deviating, false)

  // one outlier sample does not persist long enough
  r = b.update(300_000, false, { heartRate: 95 })
  assert.equal(r.heartRate.deviating, false)
  r = feed(b, 301_000, 20, () => 66 + noise())
  assert.equal(r.heartRate.deviating, false)

  // +16 bpm: 82 bpm is "normal" for the fixed band (50–105) but far from this person's norm
  assert.equal(statusOf('heartRate', 82), 'normal')
  r = feed(b, 321_000, 15, () => 82 + noise())
  assert.equal(r.heartRate.deviating, true)
  assert.equal(r.heartRate.direction, 'high')
  assert.ok(r.heartRate.z >= BASELINE.zLimit)
  // while it deviates the norm is frozen, so the anomaly does not become the baseline
  near(r.heartRate.mean, 66, 1.5)
})

test('personal baseline: rest and EVA have separate norms, an EVA start is not a deviation, and a lasting change becomes the new normal', () => {
  const b = new PersonalBaseline()
  let t = 0
  let flagged = 0
  const run = (n: number, eva: boolean, hr: number) => {
    for (let i = 0; i < n; i++) {
      const r = b.update((t += 1000), eva, { heartRate: hr + ((i * 7) % 5) - 2 })
      if (r.heartRate.deviating) flagged++
    }
  }
  for (let c = 0; c < 4; c++) {
    run(120, false, 68)
    run(120, true, 90)
  }
  assert.equal(flagged, 0, 'the 22 bpm jump at every EVA start is expected, not a deviation')
  const s = b.export()
  near(s.heartRate!.rest!.mean, 68, 1.5)
  near(s.heartRate!.eva!.mean, 90, 1.5)

  // stored norms restore the baseline in a new session
  const again = new PersonalBaseline(JSON.parse(JSON.stringify(s)))
  let r = again.update(1, false, { heartRate: 68 })
  assert.equal(r.heartRate.ready, true)
  assert.equal(new PersonalBaseline({ heartRate: { rest: { mean: 'x' } } }).update(1, false, { heartRate: 68 }).heartRate.ready, false, 'bad stored data is ignored')

  // a permanent +14 bpm: flagged first, then accepted as the new norm after maxFreezeS
  run(120, false, 68)
  flagged = 0
  run(BASELINE.maxFreezeS + 400, false, 82)
  assert.ok(flagged > 0)
  r = b.update((t += 1000), false, { heartRate: 82 })
  assert.equal(r.heartRate.deviating, false, 're-baselined')
  assert.ok(r.heartRate.mean > 78, `norm moved to the new level, got ${r.heartRate.mean}`)
})

// ---- OSDR ----------------------------------------------------------------------------------------
test('OSDR Inspiration4 panels: data integrity', () => {
  assert.deepEqual(OSDR_PANELS.map((p) => p.study), ['OSD-569', 'OSD-575'])
  for (const p of OSDR_PANELS) {
    assert.match(p.sha256, /^[0-9a-f]{64}$/)
    assert.deepEqual([...new Set(p.rows.map((r) => r[5]))].sort(), ['C001', 'C002', 'C003', 'C004'])
    assert.equal(new Set(p.rows.map((r) => r[7])).size, 7)
  }
  // a known value straight from the published file: C001 haemoglobin at L-92 = 14.1 g/dL
  const hb = OSDR_PANELS[0].rows.find((r) => r[0] === 'HEMOGLOBIN' && r[5] === 'C001' && r[7] === 'L-92')!
  assert.deepEqual([hb[1], hb[2], hb[3], hb[4]], [14.1, 13.2, 17.1, 'g/dL'])
  // the misaligned draw really is misaligned in the source (MPV listed as 330 fL)
  assert.equal(OSDR_PANELS[0].rows.find((r) => r[0] === 'MPV' && r[5] === 'C003' && r[7] === 'L-92')![1], 330)
})

test('OSDR analysis: index of individuality and personal vs population deviations', () => {
  const a = osdrAnalysis()
  assert.ok(a.analytes.length >= 20)
  for (const x of a.analytes) assert.ok(x.cvI > 0 && x.cvG > 0 && Number.isFinite(x.ii) && x.cvI < 60, `${x.analyte}: CV_I ${x.cvI}`)
  // haemoglobin differs far more between people than within a person (literature II ≈ 0.4)
  const hb = a.analytes.find((x) => x.analyte === 'HEMOGLOBIN')!
  assert.ok(hb.ii < 0.6, `haemoglobin II ${hb.ii}`)
  assert.ok(a.medianIi < 1 && a.lowIiShare > 0.3)
  assert.equal(a.r1.personal, a.r1.both + a.r1.personalOnly)
  assert.ok(a.r1.personalOnly > 0, 'changes after flight that the population range does not see')
  assert.ok(a.preflight.personal / a.preflight.n < 0.05, 'leave-one-out false-flag rate below the nominal 5 %')
  assert.ok(a.flags.every((f) => !(f.subject === 'C003' && f.analyte === 'MPV' && Math.abs(f.personalMean) > 100)))
  near(t975(8), 2.306, 1e-9)

  // synthetic check of the ANOVA: 3 people, means 10/20/30, within-person SD exactly 1
  const rows = (['A', 'B', 'C'] as const).flatMap((s, i) => (['L-92', 'L-44', 'L-3'] as const).map((tp, j) => ['X', 10 * (i + 1) + (j - 1), 0, 100, 'u', s, 'M', tp] as const))
  const syn = analyseOsdr([{ study: 's', panel: 'CBC', file: 'f', url: 'u', sha256: '', rows }])
  near(syn.analytes[0].sw, 1, 1e-9)
  near(syn.analytes[0].cvI, 5, 1e-9)
  near(syn.analytes[0].cvG, (Math.sqrt(100 - 1 / 3) / 20) * 100, 1e-9)
})

// ---- radiation: Earth → Mars -----------------------------------------------------------------------
const T = Date.UTC(2026, 10, 14, 12)

test('Parker spiral and geometry', () => {
  near(parkerOffsetDeg(1, 400), 61.4, 0.3, 'Earth’s footpoint is near W60')
  near(parkerOffsetDeg(1, 800), 30.7, 0.2)
  const g = marsGeometry(T)
  assert.ok(g.rAu > 1.38 && g.rAu < 1.67)
  near(g.footEarthDeg, 61, 1.5)
  // Mars at opposition (12 Jan 2025) sits on the Earth–Sun line
  near(marsGeometry(Date.UTC(2025, 0, 16)).lonDeg, 0, 2)
})

test('SEP scaling: distance and magnetic connection to an extended source', () => {
  const g = { rAu: 1.5, lonDeg: 0, footEarthDeg: 61.4, footMarsDeg: 92.1 }
  const none = sepScaling(g, null)
  near(none.ratio, Math.pow(1.5, -RAD.alpha), 1e-12)
  assert.ok(none.ratioLow < none.ratio && none.ratio < none.ratioHigh)
  // point source on Mars' field line: Mars sees more than Earth
  const mars = sepScaling(g, { lonDeg: 92.1, halfAngleDeg: 0 })
  near(mars.longitudinal, Math.exp(30.7 ** 2 / (2 * 43 ** 2)), 1e-9)
  // point source on Earth's field line: the mirror image
  near(sepScaling(g, { lonDeg: 61.4, halfAngleDeg: 0 }).longitudinal * mars.longitudinal, 1, 1e-9)
  // a CME wide enough to cover both field lines connects both equally
  const wide = sepScaling(g, { lonDeg: 92.1, halfAngleDeg: 40 })
  assert.deepEqual([wide.deltaEarthDeg, wide.deltaMarsDeg, wide.longitudinal], [0, 0, 1])
  // the first model version measured from the axis, whatever the width
  near(sepScaling(g, { lonDeg: 92.1, halfAngleDeg: 40 }, 'point').longitudinal, mars.longitudinal, 1e-12)
  // far-side source: capped and flagged instead of exploding
  const far = sepScaling({ ...g, lonDeg: 170, footMarsDeg: -98 }, { lonDeg: -98, halfAngleDeg: 0 })
  assert.equal(far.unreliable, true)
  assert.equal(far.ratio, RAD.maxRatio)
})

test('spectral index: measured tail above 100 MeV when the ≥500 MeV channel is above background', () => {
  near(tailIndex(50, { energyMeV: 500, flux: 2 })!, Math.log(25) / Math.log(5), 1e-12)
  assert.equal(tailIndex(50, null), null)
  assert.equal(tailIndex(50, { energyMeV: 500, flux: 60 }), null, 'a tail above the ≥100 MeV flux is not a spectrum')
  assert.equal(goesTail(0.21), null, 'quiet level of the channel')
  assert.equal(goesTail(null), null)
  near(goesTail(0.46)!.flux, 0.26, 1e-12)
  const base = { t: T, doseMSv: 0, eva: true, p10: 1000, p100: 50, cmes: [] }
  const low = assessRadiation(base)
  const withTail = assessRadiation({ ...base, tail: { energyMeV: 500, flux: 0.25 } })
  assert.equal(low.gammaFrom, '10-100')
  assert.equal(withTail.gammaFrom, 'tail')
  assert.ok(withTail.gamma > low.gamma && withTail.sep.suit < low.sep.suit, 'a steeper tail means less dose under the atmosphere')
})

test('surface dose: atmospheric cut-off, shielding, units', () => {
  near(spectralIndex(1000, 10), 2, 1e-12)
  assert.equal(spectralIndex(0, 0), 2)
  assert.equal(surfaceSepDoseUSvH(0, 2), 0)
  // hand calculation for 10 pfu ≥100 MeV, γ = 1.77: J(>150) = 10·1.5^-1.77, Ω = π
  const expected = Math.PI * 10 * Math.pow(1.5, -1.77) * 5.4 * 1.602e-10 * 3600 * 1e6
  near(surfaceSepDoseUSvH(10, 1.77), expected, 1e-9)
  near(expected, 47.7, 0.5)
  // the suit is not shielding on Mars; a shelter helps but does not stop >150 MeV protons
  assert.ok(shieldFactor(SHIELDS.suit.gcm2, 2) > 0.97)
  assert.ok(shieldFactor(SHIELDS.shelter.gcm2, 2) < 0.45 && shieldFactor(SHIELDS.shelter.gcm2, 2) > 0.3)
  assert.equal(shieldFactor(0, 2), 1)
  near(GCR_USV_H, 27.2, 0.2, '0.67 mSv/sol')
})

test('drag-based CME model', () => {
  const fast = dbmArrival(1000, AU_KM)
  assert.ok(fast.hours > 41.6 && fast.hours < 104, `between ballistic and solar-wind limits, got ${fast.hours}`)
  near(fast.hours, 52.4, 0.5)
  assert.ok(fast.speedKmS > 400 && fast.speedKmS < 1000)
  const slow = dbmArrival(300, AU_KM)
  assert.ok(slow.speedKmS > 300 && slow.speedKmS < 400, 'a slow CME is accelerated toward the solar wind')
  near(dbmArrival(400, AU_KM).hours, (AU_KM - 21.5 * 695_700) / 400 / 3600, 0.01, 'at the wind speed there is no drag')
  assert.ok(dbmArrival(1000, 1.5 * AU_KM).hours > fast.hours)
  assert.ok(dbmArrival(1000, AU_KM, 1e-7).hours > fast.hours, 'more drag, later arrival')

  const g = marsGeometry(T)
  const cme = (lonDeg: number, latDeg = 0): Cme => ({ id: 'x', t21_5: T, latDeg, lonDeg, halfAngleDeg: 30, speedKmS: 1200, url: '' })
  const hit = cmeAtMars(cme(g.lonDeg + 10), g)
  assert.equal(hit.hitsMars, true)
  assert.ok(hit.arrivalEarliest <= hit.arrival && hit.arrival <= hit.arrivalLatest)
  assert.equal(cmeAtMars(cme(g.lonDeg + 60), g).hitsMars, false)
  assert.equal(cmeAtMars(cme(g.lonDeg, 50), g).hitsMars, false, 'high-latitude CME misses the ecliptic')
})

test('radiation decision rules', () => {
  const base = { t: T, doseMSv: 1.2, eva: true }
  const quiet = assessRadiation({ ...base, p10: 0.3, p100: 0.2, cmes: [] })
  assert.equal(quiet.advice, 'go')
  near(quiet.rateUSvH, GCR_USV_H, 1e-9)
  assert.equal(quiet.sep.suit, 0, 'below the 1 pfu ≥100 MeV event threshold there is no solar-proton term')

  const [connected, earthOnly, blind] = EXAMPLES.map((e) => assessRadiation({ ...base, ...e.build(T) }))
  assert.equal(connected.advice, 'shelter')
  assert.ok(connected.evaSepMSv >= ACTION.shelterMSv)
  assert.match(connected.headline, /return to the storm shelter/)
  assert.ok(earthOnly.sep.suit < connected.sep.suit / 20, 'same GOES reading, very different dose on Mars')
  assert.ok(earthOnly.evaSepMSv < ACTION.cautionMSv && earthOnly.evaSepHighMSv >= ACTION.cautionMSv)
  assert.equal(earthOnly.advice, 'caution', 'the estimate alone would clear the EVA; the hindcast-derived upper bound does not')
  near(connected.evaSepHighMSv / (connected.sepSuitRange[1] * ACTION.evaHours / 1000), 1, 1e-12)
  assert.equal(blind.advice, 'caution')
  assert.match(blind.reasons.join(' '), /GOES would not see/)
  assert.ok(connected.sep.suit > connected.sep.rover && connected.sep.rover > connected.sep.habitat && connected.sep.habitat > connected.sep.shelter)
  assert.ok(connected.sepSuitRange[0] < connected.sep.suit && connected.sep.suit * RAD.transportUncertainty <= connected.sepSuitRange[1])

  // a fast CME aimed at Mars, due within a day
  const g = marsGeometry(T)
  const due = assessRadiation({ ...base, p10: 0.3, p100: 0.2, cmes: [{ id: 'c', t21_5: T - 40 * 3_600_000, latDeg: 0, lonDeg: g.lonDeg, halfAngleDeg: 40, speedKmS: 1500, url: '' }] })
  assert.equal(due.cmes.length, 1)
  assert.match(due.reasons.join(' '), /aimed at Mars/)
  assert.equal(assessRadiation({ ...base, doseMSv: 600, p10: 0.3, p100: 0.2, cmes: [] }).advice, 'shelter', 'career limit reached')
  assert.match(assessRadiation({ ...base, eva: false, p10: 0.3, p100: 0.2, cmes: [] }).headline, /Clear for EVA/)
})

test('DONKI CME analysis parser', () => {
  const cmes = parseCmeAnalyses([
    { time21_5: '2026-11-10T08:14Z', latitude: 2, longitude: 93, halfAngle: 11, speed: 974, associatedCMEID: 'a', link: 'https://x/1' },
    { time21_5: '2026-11-13T09:50Z', latitude: 13, longitude: -46, halfAngle: 17, speed: 525, associatedCMEID: 'b' },
    { time21_5: '2026-11-12T00:00Z', latitude: null, longitude: 10, halfAngle: 17, speed: 500 },
    { time21_5: 'bad', latitude: 1, longitude: 1, halfAngle: 1, speed: 1 },
    'junk',
  ])
  assert.deepEqual(cmes.map((c) => c.id), ['b', 'a'], 'newest first, incomplete entries skipped')
  assert.equal(cmes[1].t21_5, Date.UTC(2026, 10, 10, 8, 14))
  assert.deepEqual(parseCmeAnalyses({}), [])
})

// ---- validation harness ----------------------------------------------------------------------------
test('seeded simulator is reproducible and scripted injections behave as specified', () => {
  const run = (seed: number) => {
    const sim = new SimulatedSource({ rng: seededRng(seed), autoAnomalies: false })
    return Array.from({ length: 200 }, (_, i) => sim.advance(1e9 + i * 1000, false))
  }
  assert.deepEqual(run(5).map((s) => s.heartRate), run(5).map((s) => s.heartRate))
  assert.notDeepEqual(run(5).map((s) => s.heartRate), run(6).map((s) => s.heartRate))
  assert.ok(run(5).every((s) => s.anomaly === null), 'no automatic anomalies when switched off')

  // sub-threshold offsets stay inside the fixed warning band most of the time
  for (const key of VALIDATION_KEYS) {
    const sim = new SimulatedSource({ rng: seededRng(9), autoAnomalies: false })
    for (let i = 0; i < 100; i++) sim.advance(i * 1000, true)
    sim.inject({ key, offset: SUBTHRESHOLD_OFFSET[key], durationTicks: 120 })
    const vals = Array.from({ length: 120 }, (_, i) => sim.advance((100 + i) * 1000, true)[key])
    const inside = vals.filter((v) => statusOf(key, v) === 'normal').length / vals.length
    assert.ok(inside > 0.8, `${METRICS[key].label}: ${inside}`)
  }
  // a ramp reaches its target gradually
  const sim = new SimulatedSource({ rng: seededRng(2), autoAnomalies: false })
  for (let i = 0; i < 100; i++) sim.advance(i * 1000, true)
  sim.inject({ key: 'bodyTemp', target: 37.8, durationTicks: 180, rampTicks: 120 })
  const temps = Array.from({ length: 170 }, (_, i) => sim.advance((100 + i) * 1000, true).bodyTemp)
  assert.ok(temps[20] < 37.2 && temps[60] < 37.5 && temps[160] > 37.6, `${temps[20]} ${temps[60]} ${temps[160]}`)
})

test('validation: a small run reproduces the shape of the stored report', () => {
  const plan = validationPlan(6, 5000)
  assert.equal(plan.length, 6 * 4 * 4)
  const r = summarise(plan.map(runScenario), [runQuiet(9000, 900), runQuiet(9001, 900)], 6, 5000)
  const cell = (f: string, d: string) => r.cells.find((c) => c.family === f && c.key === 'all' && c.detector === d)!
  assert.equal(cell('abrupt', 'fixed').rate, 1, 'a fixed band always catches a jump to warning level')
  assert.ok(cell('abrupt', 'fixed').medianS! <= 6)
  assert.ok(cell('subthreshold', 'personal').rate > cell('subthreshold', 'fixed').rate + 0.3, 'the personal baseline sees what the fixed band cannot')
  assert.ok(cell('gradual', 'personal').rate > 0.7)
  assert.equal(cell('pattern', 'fixed').rate, 0, 'three small shifts never leave the fixed bands')
  assert.ok(cell('pattern', 'joint').rate > cell('pattern', 'personal').rate, 'the joint statistic sees small shifts together better than any single vital')
  assert.ok(cell('pattern', 'joint').ciLow <= cell('pattern', 'joint').rate && cell('pattern', 'joint').rate <= cell('pattern', 'joint').ciHigh)
  assert.equal(r.cells.filter((c) => c.family === 'pattern').length, 4, 'pattern runs have no per-vital rows')
  assert.equal(r.falseAlarms.find((f) => f.detector === 'fixed')!.episodes, 0)
  assert.equal(runScenario(plan[0]).latency.fixed, runScenario(plan[0]).latency.fixed, 'deterministic')

  // the stored report is a complete 30-run report with the same structure
  assert.equal(stored.report.runsPerCell, 30)
  assert.equal(stored.report.cells.length, r.cells.length)
  const at = (f: string, d: string) => stored.report.cells.find((c) => c.family === f && c.key === 'all' && c.detector === d)!
  assert.ok(at('subthreshold', 'personal').rate > 0.6 && at('subthreshold', 'fixed').rate < 0.2)
  assert.ok(at('pattern', 'joint').rate > 0.85 && at('pattern', 'personal').rate < 0.7 && at('pattern', 'fixed').rate === 0)
  assert.ok(stored.report.falseAlarms.find((f) => f.detector === 'personal')!.perHour < 2.5)
  assert.ok(stored.report.falseAlarms.find((f) => f.detector === 'joint')!.perHour < 1)
})

test('Wilson score interval', () => {
  const [lo, hi] = wilson(8, 10)
  near(lo, 0.4902, 0.0005)
  near(hi, 0.9433, 0.0005)
  assert.deepEqual(wilson(0, 0), [0, 1])
  assert.equal(wilson(0, 120)[0], 0)
  near(wilson(0, 120)[1], 0.031, 0.001, 'zero detections in 120 runs still allows up to 3 %')
  near(wilson(120, 120)[0], 0.969, 0.001)
})

test('joint deviation: T² over small shifts, persistence, and signature matching', () => {
  const reading = (z: Partial<Record<string, number>>): BaselineState =>
    Object.fromEntries(['heartRate', 'spo2', 'bodyTemp', 'respRate', 'suitPressure'].map((k) => [k, { key: k, activity: 'rest', mean: 0, sd: 1, value: 0, z: z[k] ?? 0, ready: true, settling: false, deviating: false, direction: null, forS: 0 }])) as unknown as BaselineState
  const d = new JointDetector()
  // each vital 2 σ away: none reaches the single-vital limit of 3.5, together T² = 12
  const hypoxia = reading({ heartRate: 2, spo2: -2, respRate: 2 })
  let r = d.update(1000, hypoxia)
  near(r.t2, 12, 1e-12)
  assert.equal(r.flagged, false, 'not before it has persisted')
  for (let i = 2; i <= 1 + JOINT.persistS; i++) r = d.update(i * 1000, hypoxia)
  assert.equal(r.flagged, true)
  assert.equal(r.match?.signature.id, 'hypoxia')
  near(r.match!.similarity, 1, 1e-12)
  // back to normal clears it at once
  assert.equal(d.update(20_000, reading({})).flagged, false)
  // suit pressure is shown but does not enter T²
  near(new JointDetector().update(1, reading({ suitPressure: -5 })).t2, 0, 1e-12)
  // too few vitals with a norm → no score
  const partial = reading({ heartRate: 3 })
  for (const k of ['spo2', 'bodyTemp'] as const) (partial[k] as { z: number }).z = NaN
  assert.ok(Number.isNaN(new JointDetector().update(1, partial).t2))

  assert.equal(matchSignature([2, 0, 2, 2, 0])?.signature.id, 'heat')
  assert.equal(matchSignature([1, -2, 0, 1, -2])?.signature.id, 'leak')
  assert.equal(matchSignature([-1, 0, -2, -1, 0])?.signature.id, 'cold')
  assert.equal(matchSignature([0, 3, 0, 0, 0]), null, 'a direction that matches nothing is left unnamed')
  assert.equal(matchSignature([0, 0, 0, 0, 0]), null)
  assert.equal(new Set(SIGNATURES.map((x) => x.id)).size, SIGNATURES.length)
})

test('simulator: several vitals can be disturbed at once, including respiration', () => {
  const run = (inject: boolean) => {
    const sim = new SimulatedSource({ rng: seededRng(4), autoAnomalies: false })
    for (let i = 0; i < 100; i++) sim.advance(i * 1000, true)
    if (inject) sim.inject(PATTERN.map((p) => ({ key: p.key, offset: p.offset, durationTicks: 60 })))
    return Array.from({ length: 100 }, (_, i) => sim.advance((100 + i) * 1000, true))
  }
  const a = run(false)
  const b = run(true)
  const meanOf = (xs: typeof a, k: 'heartRate' | 'spo2' | 'respRate', from: number, to: number) => xs.slice(from, to).reduce((s2, x) => s2 + x[k], 0) / (to - from)
  for (const p of PATTERN) {
    const k = p.key as 'heartRate' | 'spo2' | 'respRate'
    near(meanOf(b, k, 15, 60) - meanOf(a, k, 15, 60), p.offset, 0.5, `${k} shifted by its offset while the disturbance lasts`)
    near(meanOf(b, k, 85, 100) - meanOf(a, k, 85, 100), 0, 0.5, `${k} back afterwards`)
    assert.ok(b.slice(0, 60).every((x) => statusOf(k, x[k]) === 'normal' || statusOf(k, a[b.indexOf(x)][k]) !== 'normal'), `${k} stays inside its fixed band`)
  }
  assert.deepEqual(a.map((x) => x.bodyTemp), b.map((x) => x.bodyTemp), 'undisturbed vitals are untouched')
})

// ---- hindcast ------------------------------------------------------------------------------------
test('hindcast data: GOES-15 values for 10 September 2017', () => {
  const d = SEP2017
  assert.equal(d.peakTime.slice(0, 13), '2017-09-10T22')
  assert.ok(d.integral['100'].peak > 40 && d.integral['100'].peak < 70, 'the ≥100 MeV peak was about 50–60 pfu')
  assert.ok(d.integral['10'].peak > d.integral['30'].peak && d.integral['30'].peak > d.integral['50'].peak && d.integral['50'].peak > d.integral['60'].peak && d.integral['60'].peak > d.integral['100'].peak)
  assert.ok(d.above330 > d.above510 && d.above510 > 0 && d.above510 < 1)
  for (const c of Object.values(d.integral)) assert.ok(c.background < 0.5 && c.background > 0)
  assert.equal(d.cme.speedKmS, 2650)
  assert.ok(d.series.length >= 48)
})

test('hindcast: what each model revision changed, and where the measurement falls', () => {
  const h = runHindcast()
  near(h.marsLonDeg, 156, 2)
  near(h.marsAu, 1.66, 0.01)
  near(OBSERVED_EXCESS_UGY_H[0], 244 / 24, 1e-9)
  near(OBSERVED_EXCESS_UGY_H[1], 488 / 24, 1e-9)
  const [original, tail, current] = h.rows
  assert.ok(original.observedOverPredicted > 100, `the first version was more than 100× too low, got ${original.observedOverPredicted}`)
  assert.equal(original.advice, 'go', 'and would have cleared the EVA')
  assert.ok(tail.gamma > original.gamma && tail.predicted < original.predicted, 'the measured tail is steeper, which alone makes it worse')
  assert.ok(current.predicted > 10 * tail.predicted, 'the extended source closes most of the gap')
  assert.ok(current.observedOverPredicted > 5 && current.observedOverPredicted < RAD.transportUncertainty * 1.5, `residual error ${current.observedOverPredicted} is what the upper bound is set from`)
  assert.equal(h.insideBounds, true, 'the measurement lies between the estimate and its upper bound')
  assert.ok(current.high >= OBSERVED_EXCESS_UGY_H[1])
  assert.equal(current.advice, 'caution')
  assert.ok(h.observedEvaMSv[0] < ACTION.cautionMSv && h.observedEvaMSv[1] > ACTION.cautionMSv, 'the measured dose straddles the caution level')
})

test('methods registry: every model has formulas, sources, stated assumptions and a check', () => {
  assert.ok(METHODS.length >= 13)
  assert.equal(new Set(METHODS.map((m) => m.id)).size, METHODS.length)
  for (const m of METHODS) {
    assert.ok(m.formulas.length > 0 && m.sources.length > 0 && m.assumptions.length > 0 && m.check.length > 10, m.id)
    for (const s of m.sources) assert.match(s.href, /^https:\/\//, `${m.id}: ${s.label}`)
  }
})
