import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVAL_KM, SPEED_KM_S, SimulatedSource, estimateEtaSeconds } from '../src/data/telemetrySimulator'
import { modelOutsideTemp } from '../src/data/nasaSource'
import { METRICS } from '../src/config/thresholds'

const phases = { meanEvaS: 60, meanRestS: 60 }

test('ETA: finishing within the current EVA phase is pure walking time', () => {
  const eta = estimateEtaSeconds({ distanceKm: SPEED_KM_S * 30, speedKmS: SPEED_KM_S, eva: true, phaseRemainingS: 50, ...phases })
  assert.ok(Math.abs(eta - 30) < 1e-9)
})

test('ETA: rest phases are counted, so ETA keeps falling while the crew stands still', () => {
  const d = SPEED_KM_S * 150 // 150 s of walking
  const resting = [40, 39, 38].map((left) => estimateEtaSeconds({ distanceKm: d, speedKmS: SPEED_KM_S, eva: false, phaseRemainingS: left, ...phases }))
  assert.deepEqual(resting.map((e) => Math.round(resting[0] - e)), [0, 1, 2], 'drops 1 s per second during rest')
  // 40 s rest + 150 s walking split over 3 EVA phases → 2 rest phases in between
  assert.ok(Math.abs(resting[0] - (40 + 150 + 2 * 60)) < 1e-6)
  // EVA: 20 s left in phase → walk 20, rest 60, then 130 s walking (3 phases, 2 rests)
  const walking = estimateEtaSeconds({ distanceKm: d, speedKmS: SPEED_KM_S, eva: true, phaseRemainingS: 20, ...phases })
  assert.ok(Math.abs(walking - (20 + 60 + 130 + 2 * 60)) < 1e-6)
})

test('ETA: arrived → 0; no movement possible → Infinity (never a fake countdown)', () => {
  assert.equal(estimateEtaSeconds({ distanceKm: 0, speedKmS: SPEED_KM_S, eva: true, phaseRemainingS: 10, ...phases }), 0)
  assert.equal(estimateEtaSeconds({ distanceKm: 1, speedKmS: 0, eva: true, phaseRemainingS: 10, ...phases }), Infinity)
})

test('simulated ETA never rises except when the traverse restarts', () => {
  const sim = new SimulatedSource()
  let prev = sim.advance(0, true)
  for (let i = 1; i < 3000; i++) {
    const s = sim.advance(i * 1000, true)
    const restarted = s.distanceKm > prev.distanceKm
    if (!restarted) assert.ok(s.etaMin <= prev.etaMin + 1, `tick ${i}: ${prev.etaMin} → ${s.etaMin}`)
    if (s.evaActive === false && prev.evaActive === false && !restarted) assert.equal(s.distanceKm, prev.distanceKm, 'no movement while resting')
    assert.ok(s.distanceKm >= ARRIVAL_KM - 0.05)
    prev = s
  }
})

test('outside-temperature provider drives outsideTemp and the derived suit temperatures; provenance is reported', () => {
  const cold = new SimulatedSource({ outsideTemp: () => -95, provenance: () => ({ outsideTemp: 'modelled' }) })
  const mild = new SimulatedSource({ outsideTemp: () => -5 })
  let c = cold.advance(0, true)
  let m = mild.advance(0, true)
  for (let i = 1; i < 300; i++) {
    c = cold.advance(i * 1000, true)
    m = mild.advance(i * 1000, true)
  }
  assert.equal(c.outsideTemp, -95)
  assert.equal(m.outsideTemp, -5)
  assert.ok(c.visorTemp < m.visorTemp, 'visor follows the same environment')
  assert.equal(c.provenance?.outsideTemp, 'modelled')
  assert.equal(m.provenance?.visorTemp, 'simulated')
})

test('InSight diurnal model stays within the real daily min/max; display range fits real Mars values', () => {
  const sol = { tMin: -95.4, tAvg: -62.4, tMax: -4.4 }
  for (let t = 0; t < 90_000_000; t += 600_000) {
    const v = modelOutsideTemp(sol, t)
    assert.ok(v >= sol.tMin && v <= sol.tMax)
  }
  const [lo, hi] = METRICS.outsideTemp.range
  assert.ok(lo <= sol.tMin && hi >= sol.tMax, 'chart/bar scale does not clip InSight values')
})
