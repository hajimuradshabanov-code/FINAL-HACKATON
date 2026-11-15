/**
 * Measured performance of the anomaly detectors.
 *
 * Each run drives the seeded telemetry simulator through the real TelemetryStore — the same code
 * path as the live dashboard — injects one scripted disturbance at a known time and records when
 * each detector first reports it:
 *
 *   fixed     value outside the fixed warning band (what an ordinary monitor does)
 *   personal  |z| against the crew member's own baseline (src/science/baseline.ts)
 *   trend     least-squares forecast of a threshold crossing (src/science/models.ts)
 *
 * Disturbance families
 *   abrupt        jump to the warning-level target of the anomaly injector, 60 s
 *   gradual       linear drift to the same target over 120 s, then 60 s hold
 *   subthreshold  a shift that stays inside the fixed band (e.g. heart rate +12 bpm), 120 s
 *   pattern       three vitals shift a little together (SpO₂ −1.1 %, heart rate +7 bpm,
 *                 respiration +1.4 /min: a low-oxygen pattern), 120 s; a detector counts if it
 *                 reports any of the three
 *
 *   joint         the fourth detector: T² over the personal z-scores (src/science/joint.ts)
 *
 * Detection rates carry 95 % Wilson score intervals (Wilson 1927).
 *
 * False alarms are counted on separate runs with no disturbance at all.
 * Limits: the stream is simulated, so these are properties of the algorithms on this signal model
 * (noise level, EVA/rest pattern), not clinical sensitivity or specificity.
 */
import { METRICS, statusOf, type MetricKey } from '../config/thresholds'
import { TelemetryStore } from '../data/store'
import { ANOMALY_TARGETS, SimulatedSource, seededRng, type Injection } from '../data/telemetrySimulator'
import type { BaselineKey } from './baseline'

export const FAMILIES = ['abrupt', 'gradual', 'subthreshold', 'pattern'] as const
export type Family = (typeof FAMILIES)[number]
export const DETECTORS = ['fixed', 'personal', 'joint', 'trend'] as const
export type Detector = (typeof DETECTORS)[number]
export const VALIDATION_KEYS = ['heartRate', 'spo2', 'bodyTemp', 'suitPressure'] as const satisfies readonly BaselineKey[]
export type ValidationKey = (typeof VALIDATION_KEYS)[number]

/** Shifts that keep the value inside the fixed warning band (see METRICS). */
export const SUBTHRESHOLD_OFFSET: Record<ValidationKey, number> = { heartRate: 12, spo2: -2, bodyTemp: 0.35, suitPressure: -0.1 }

/** The low-oxygen pattern: each shift is below what the single-vital detector reports on its own. */
export const PATTERN: readonly { key: MetricKey; offset: number }[] = [
  { key: 'spo2', offset: -1.1 },
  { key: 'heartRate', offset: 7 },
  { key: 'respRate', offset: 1.4 },
]

const WARMUP_S = 600
const TAIL_S = 30
export const FALSE_ALARM_RUN_S = 1800

export interface Scenario {
  family: Family
  key: ValidationKey
  seed: number
}

export interface RunResult extends Scenario {
  /** seconds from disturbance onset to first report; null = missed */
  latency: Record<Detector, number | null>
  /** detector was already reporting when the disturbance began (run not counted for it) */
  preExisting: Record<Detector, boolean>
}

function injection(family: Family, key: ValidationKey): Injection | Injection[] {
  if (family === 'pattern') return PATTERN.map((p) => ({ key: p.key, offset: p.offset, durationTicks: 120 }))
  const target = ANOMALY_TARGETS[key]!.warn
  if (family === 'abrupt') return { key, target, durationTicks: 60 }
  if (family === 'gradual') return { key, target, durationTicks: 180, rampTicks: 120 }
  return { key, offset: SUBTHRESHOLD_OFFSET[key], durationTicks: 120 }
}

const T0 = Date.UTC(2026, 0, 1)

function makeRun(seed: number) {
  const rng = seededRng(seed)
  const sim = new SimulatedSource({ rng, autoAnomalies: false })
  let t = T0
  const store = new TelemetryStore({ now: () => t, isHidden: () => false })
  const tick = (backfill: boolean) => {
    t += 1000
    store.ingest(sim.advance(t, true), backfill)
    return store.getSnapshot()
  }
  return { rng, sim, tick }
}

type Snap = ReturnType<TelemetryStore['getSnapshot']>
const firing = (snap: Snap, keys: readonly MetricKey[]): Record<Detector, boolean> => ({
  fixed: keys.some((key) => statusOf(key, snap.latest![key]) !== 'normal'),
  personal: keys.some((key) => !!snap.science.baseline?.[key as BaselineKey]?.deviating),
  joint: !!snap.science.joint?.flagged,
  trend: keys.some((key) => snap.science.forecasts.some((f) => f.key === key)),
})
const keysOf = (sc: Scenario): readonly MetricKey[] => (sc.family === 'pattern' ? PATTERN.map((p) => p.key) : [sc.key])

export function runScenario(sc: Scenario): RunResult {
  const { rng, sim, tick } = makeRun(sc.seed)
  for (let i = 0; i < WARMUP_S; i++) tick(true)
  // random extra lead-in so the onset lands anywhere in the rest/EVA cycle
  const lead = 30 + Math.floor(rng() * 90)
  let snap = tick(false)
  for (let i = 1; i < lead; i++) snap = tick(false)
  const keys = keysOf(sc)
  const before = firing(snap, keys)
  const inj = injection(sc.family, sc.key)
  sim.inject(inj)
  const duration = Math.max(...(Array.isArray(inj) ? inj : [inj]).map((i) => i.durationTicks))
  const latency: Record<Detector, number | null> = { fixed: null, personal: null, joint: null, trend: null }
  for (let s = 1; s <= duration + TAIL_S; s++) {
    const now = firing(tick(false), keys)
    for (const d of DETECTORS) if (latency[d] === null && now[d] && !before[d]) latency[d] = s
  }
  return { ...sc, latency, preExisting: before }
}

export interface FalseAlarmResult {
  seed: number
  seconds: number
  /** new reports (off → on) per detector over all validated vitals */
  episodes: Record<Detector, number>
}

export function runQuiet(seed: number, seconds = FALSE_ALARM_RUN_S): FalseAlarmResult {
  const { tick } = makeRun(seed)
  for (let i = 0; i < WARMUP_S; i++) tick(true)
  const episodes: Record<Detector, number> = { fixed: 0, personal: 0, joint: 0, trend: 0 }
  let prev: Record<string, Record<Detector, boolean>> = {}
  // per-vital detectors are counted on the four validated vitals plus respiration (part of the pattern)
  const watched: MetricKey[] = [...VALIDATION_KEYS, 'respRate']
  for (let s = 0; s < seconds; s++) {
    const snap = tick(false)
    const cur: typeof prev = {}
    for (const key of watched) {
      cur[key] = firing(snap, [key])
      for (const d of DETECTORS) if (d !== 'joint' && cur[key][d] && prev[key] && !prev[key][d]) episodes[d]++
    }
    // the joint detector is one alarm for the whole crew member, not one per vital
    if (cur[watched[0]].joint && prev[watched[0]] && !prev[watched[0]].joint) episodes.joint++
    prev = cur
  }
  return { seed, seconds, episodes }
}

// ---- summary ---------------------------------------------------------------------------------
export interface Cell {
  family: Family
  key: ValidationKey | 'all'
  detector: Detector
  runs: number
  detected: number
  /** share of runs detected, 0..1, with its 95 % Wilson score interval */
  rate: number
  ciLow: number
  ciHigh: number
  medianS: number | null
  p90S: number | null
}

export interface ValidationReport {
  runsPerCell: number
  seedBase: number
  cells: Cell[]
  /** median seconds by which `personal` reported before `fixed`, over runs where both did */
  leadOverFixedS: Record<Family, number | null>
  falseAlarms: { detector: Detector; episodes: number; hours: number; perHour: number }[]
  quietRuns: number
}

/** 95 % Wilson score interval for k successes in n trials (Wilson 1927, JASA 22:209). */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1]
  const z = 1.959964
  const p = k / n
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo)
}

export function validationPlan(runsPerCell: number, seedBase: number): Scenario[] {
  const plan: Scenario[] = []
  let n = 0
  // the pattern family moves three vitals at once, so its "vital" is only a label for the run
  for (const family of FAMILIES) for (const key of VALIDATION_KEYS) for (let i = 0; i < runsPerCell; i++) plan.push({ family, key, seed: seedBase + n++ })
  return plan
}

export function summarise(results: readonly RunResult[], quiet: readonly FalseAlarmResult[], runsPerCell: number, seedBase: number): ValidationReport {
  const cells: Cell[] = []
  const cell = (family: Family, key: ValidationKey | 'all', detector: Detector): Cell => {
    const rs = results.filter((r) => r.family === family && (key === 'all' || r.key === key) && !r.preExisting[detector])
    const lat = rs.map((r) => r.latency[detector]).filter((x): x is number => x !== null)
    const [ciLow, ciHigh] = wilson(lat.length, rs.length)
    return { family, key, detector, runs: rs.length, detected: lat.length, rate: rs.length ? lat.length / rs.length : 0, ciLow, ciHigh, medianS: quantile(lat, 0.5), p90S: quantile(lat, 0.9) }
  }
  for (const family of FAMILIES) for (const detector of DETECTORS) {
    cells.push(cell(family, 'all', detector))
    if (family !== 'pattern') for (const key of VALIDATION_KEYS) cells.push(cell(family, key, detector))
  }
  const leadOverFixedS = Object.fromEntries(
    FAMILIES.map((f) => {
      const both = results.filter((r) => r.family === f && r.latency.fixed !== null && r.latency.personal !== null).map((r) => r.latency.fixed! - r.latency.personal!)
      return [f, quantile(both, 0.5)]
    }),
  ) as Record<Family, number | null>
  const hours = quiet.reduce((a, q) => a + q.seconds, 0) / 3600
  const falseAlarms = DETECTORS.map((detector) => {
    const episodes = quiet.reduce((a, q) => a + q.episodes[detector], 0)
    return { detector, episodes, hours, perHour: hours ? episodes / hours : 0 }
  })
  return { runsPerCell, seedBase, cells, leadOverFixedS, falseAlarms, quietRuns: quiet.length }
}

/** Full validation, synchronously (tests, scripts). The UI runs the same plan in slices. */
export function runValidation(runsPerCell = 30, seedBase = 1000, quietRuns = 20): ValidationReport {
  const results = validationPlan(runsPerCell, seedBase).map(runScenario)
  const quiet = Array.from({ length: quietRuns }, (_, i) => runQuiet(seedBase + 100_000 + i))
  return summarise(results, quiet, runsPerCell, seedBase)
}

export const unitOf = (key: ValidationKey) => METRICS[key].unit
