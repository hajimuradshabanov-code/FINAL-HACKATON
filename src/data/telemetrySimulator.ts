import { METRIC_KEYS, type MetricKey } from '../config/thresholds'
import type { Provenance, Sample, TelemetrySource } from './types'

/**
 * Realistic telemetry generator.
 *
 * Every metric is a mean-reverting bounded random walk (small step from the previous
 * value, pulled towards a slowly drifting sine target, hard-clamped to a physiological
 * range) — so heart rate reads 72, 73, 71, 72… never 72, 8, 360.
 *
 * Anomalies are a separate smoothed `delta` layered on top of the natural value, so a
 * spike ramps up over 2-3 ticks and recovers gradually instead of teleporting.
 */

export const TICK_MS = 1000
/** history replayed at start: the charts need 120 s, the personal baseline about 10 min of rest and EVA */
const BACKFILL = 600
export const START_DISTANCE_KM = 14.2
/** mean walking speed during EVA (each tick varies ±10 %) */
export const SPEED_KM_S = 0.0062 // ~38 min of walking for 14.2 km (demo pace)
/** the traverse restarts once the remaining distance drops below this */
export const ARRIVAL_KM = 0.15
const SOL_START = 412
/** EVA and rest phases each last a uniform random 40-75 ticks */
const PHASE_MIN = 40
const PHASE_MAX = 75
const PHASE_MEAN = (PHASE_MIN + PHASE_MAX) / 2

// ---- small helpers -------------------------------------------------------------
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Small seedable PRNG (mulberry32) so validation runs are reproducible. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Walk {
  v: number
  /** pull towards target per tick (0..1) */
  k: number
  /** noise sd per tick */
  n: number
  lo: number
  hi: number
}

export interface EtaInput {
  /** distance still to walk, km */
  distanceKm: number
  /** km per second while walking */
  speedKmS: number
  /** currently in an EVA (walking) phase */
  eva: boolean
  /** seconds left in the current phase */
  phaseRemainingS: number
  /** expected length of future EVA and rest phases, s */
  meanEvaS: number
  meanRestS: number
}

/**
 * Expected seconds until arrival when the crew only walks during EVA phases and stands still
 * during rest phases. The current phase uses its known remaining time; later phases use the mean.
 */
export function estimateEtaSeconds({ distanceKm, speedKmS, eva, phaseRemainingS, meanEvaS, meanRestS }: EtaInput): number {
  if (!(distanceKm > 0)) return 0
  if (!(speedKmS > 0)) return Infinity
  let walk = distanceKm / speedKmS
  let t = 0
  const left = Math.max(0, phaseRemainingS)
  if (eva) {
    const now = Math.min(walk, left)
    t += now
    walk -= now
    if (walk <= 0) return t
    t += meanRestS // the rest phase that follows
  } else {
    t += left // wait out the current rest
  }
  // remaining walking happens in EVA phases of meanEvaS, separated by rest phases
  const evaPhases = Math.ceil(walk / meanEvaS)
  return t + walk + Math.max(0, evaPhases - 1) * meanRestS
}

export interface SimulatorOptions {
  /**
   * Optional real-world outside temperature (°C) for time `t`. When it returns a finite number the
   * simulator uses it instead of its own random walk, and the suit surface temperatures (visor,
   * gloves, boots) are derived from it, so all temperatures share one environment.
   */
  outsideTemp?: (t: number) => number | null
  /** provenance to attach to samples; defaults to everything simulated */
  provenance?: () => Provenance
  /** random source, default Math.random; pass `seededRng(n)` for reproducible runs */
  rng?: () => number
  /** start random anomalies on its own (default true); validation turns this off and injects scripted ones */
  autoAnomalies?: boolean
}

/**
 * A scripted disturbance for validation. Either drive the metric to an absolute `target` or shift
 * it by `offset` from its natural value; `rampTicks` > 0 makes it grow linearly instead of at once.
 */
export interface Injection {
  key: MetricKey
  target?: number
  offset?: number
  durationTicks: number
  rampTicks?: number
}

const ALL_SIMULATED: Provenance = Object.fromEntries(METRIC_KEYS.map((k) => [k, 'simulated']))

type AnomalySpec = { warn: number; crit: number }
const ANOMALIES: Partial<Record<MetricKey, AnomalySpec>> = {
  heartRate: { warn: 112, crit: 135 },
  spo2: { warn: 93, crit: 89 },
  suitPressure: { warn: 4.1, crit: 3.9 },
  bodyTemp: { warn: 37.8, crit: 38.4 },
  hydration: { warn: 34, crit: 18 },
}
const ANOMALY_KEYS = Object.keys(ANOMALIES) as MetricKey[]
/** vitals a scripted disturbance can move: the random ones plus respiration (never picked at random) */
const DISTURBABLE: MetricKey[] = [...ANOMALY_KEYS, 'respRate']
/** warning-level targets used by the anomaly injector (exported for the validation scenarios) */
export const ANOMALY_TARGETS = ANOMALIES

export class SimulatedSource implements TelemetrySource {
  readonly timerDriven = true
  private timer: ReturnType<typeof setInterval> | null = null
  private tick = 0

  // natural state
  private hr: Walk = { v: 72, k: 0.09, n: 0.9, lo: 56, hi: 104 }
  private spo2: Walk = { v: 97.6, k: 0.1, n: 0.12, lo: 95, hi: 100 }
  private temp: Walk = { v: 36.8, k: 0.04, n: 0.012, lo: 36.3, hi: 37.4 }
  private press: Walk = { v: 4.31, k: 0.1, n: 0.008, lo: 4.2, hi: 4.4 }
  private signal: Walk = { v: -46, k: 0.06, n: 0.7, lo: -60, hi: -38 }
  private wind: Walk = { v: 18, k: 0.08, n: 1.3, lo: 5, hi: 40 }
  private ext: Walk = { v: -63, k: 0.03, n: 0.35, lo: -80, hi: -50 }
  private resp: Walk = { v: 15, k: 0.1, n: 0.35, lo: 11, hi: 22 }
  private coolant: Walk = { v: 12.5, k: 0.05, n: 0.12, lo: 9, hi: 16 }
  private visor: Walk = { v: -8, k: 0.05, n: 0.3, lo: -20, hi: 6 }
  private glove: Walk = { v: 21, k: 0.05, n: 0.18, lo: 15, hi: 27 }
  private boot: Walk = { v: 19, k: 0.05, n: 0.18, lo: 14, hi: 25 }

  private hydration = 78
  private radiation = 1.2
  private o2 = 86
  private battery = 91
  private distance = START_DISTANCE_KM
  private range = 12.4

  private eva = false
  private phaseUntil = 0
  private delta: Partial<Record<MetricKey, number>> = {}
  private anomaly: { key: MetricKey; target?: number; offset?: number; start: number; until: number; ramp: number } | null = null
  /** further scripted disturbances running alongside `anomaly` (validation of multi-vital patterns) */
  private extra: NonNullable<SimulatedSource['anomaly']>[] = []
  private nextAnomalyAt = 0
  private random: () => number

  constructor(private opts: SimulatorOptions = {}) {
    this.random = opts.rng ?? Math.random
  }

  private rand(a: number, b: number) {
    return a + this.random() * (b - a)
  }
  /** approx. gaussian, mean 0, sd 1 */
  private gauss() {
    return (this.random() + this.random() + this.random() + this.random() - 2) / 0.577 / 2
  }
  private step(w: Walk, target: number) {
    w.v = clamp(w.v + (target - w.v) * w.k + this.gauss() * w.n, w.lo, w.hi)
    return w.v
  }

  /** Start one scripted disturbance, or several vitals at once, on the next sample (validation). */
  inject(i: Injection | readonly Injection[]) {
    const [first, ...rest] = (Array.isArray(i) ? i : [i]).map((x: Injection) => ({ key: x.key, target: x.target, offset: x.offset, start: this.tick, until: this.tick + x.durationTicks, ramp: x.rampTicks ?? 0 }))
    this.anomaly = first ?? null
    this.extra = rest
  }

  start(onSample: (s: Sample, backfill: boolean) => void) {
    this.stop()
    this.tick = 0
    const now = Date.now()
    this.phaseUntil = 45
    // warm the history so charts are full from the first frame (no anomalies during warm-up)
    for (let i = BACKFILL; i > 0; i--) onSample(this.advance(now - i * TICK_MS, true), true)
    this.nextAnomalyAt = this.tick + this.rand(30, 90)
    this.timer = setInterval(() => onSample(this.advance(Date.now(), false), false), TICK_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Dev shortcut: kick an anomaly now (random metric, 70 % critical / 30 % warning) */
  triggerAnomaly() {
    const key = ANOMALY_KEYS[Math.floor(this.random() * ANOMALY_KEYS.length)]
    const spec = ANOMALIES[key]!
    this.anomaly = { key, target: this.random() < 0.7 ? spec.crit : spec.warn, start: this.tick, until: this.tick + this.rand(6, 14), ramp: 0 }
    this.nextAnomalyAt = this.tick + this.rand(30, 90)
  }

  /**
   * Produce the next sample for time `t`. `warm` samples never start anomalies. Public so offline
   * checks (scripts/sim-check.ts, tests) can fast-forward without timers.
   */
  advance(t: number, warm: boolean): Sample {
    this.tick++
    const s = this.tick
    const d = new Date(t)

    // --- activity phases: rest <-> EVA ---
    if (s >= this.phaseUntil) {
      this.eva = !this.eva
      this.phaseUntil = s + this.rand(PHASE_MIN, PHASE_MAX)
    }

    // --- anomaly scheduling ---
    if (!warm) {
      if (!this.anomaly && this.opts.autoAnomalies !== false && s >= this.nextAnomalyAt) this.triggerAnomaly()
    }
    // disturbances end on time in every mode (scripted ones run with `warm` set)
    if (this.anomaly && s >= this.anomaly.until) this.anomaly = null
    if (this.extra.length) this.extra = this.extra.filter((x) => s < x.until)

    // --- environment: real outside temperature when provided, otherwise a random walk ---
    const provided = this.opts.outsideTemp?.(t)
    const ext = typeof provided === 'number' && Number.isFinite(provided) ? (this.ext.v = provided) : this.step(this.ext, -64 + 9 * Math.sin(s / 61))

    // --- natural values ---
    const hr = this.step(this.hr, (this.eva ? 90 : 69) + 4 * Math.sin(s / 23))
    const spo2 = this.step(this.spo2, 97.7 + 0.7 * Math.sin(s / 31) - (this.eva ? 0.3 : 0))
    const temp = this.step(this.temp, 36.8 + (this.eva ? 0.28 : 0) + 0.12 * Math.sin(s / 47))
    const press = this.step(this.press, 4.31 + 0.04 * Math.sin(s / 19))
    const signal = this.step(this.signal, -48 + 8 * Math.sin(s / 41))
    const wind = this.step(this.wind, 21 + 11 * Math.sin(s / 29))
    const resp = this.step(this.resp, this.eva ? 18.5 : 14.5)
    const coolant = this.step(this.coolant, this.eva ? 14.5 : 11.5)
    // suit surface temperatures follow the outside temperature (heated gloves / boots damp it)
    const visor = this.step(this.visor, ext / 5 + 4)
    const glove = this.step(this.glove, 22 + ext / 25 + (this.eva ? 1.5 : 0))
    const boot = this.step(this.boot, 21 + ext / 30)

    // hydration: slow drain, "drink" event refills
    this.hydration -= 0.1 + (this.eva ? 0.03 : 0)
    if (this.hydration < 52 && this.random() < 0.15) this.hydration = clamp(this.hydration + this.rand(18, 26), 0, 100)

    // cumulative (only goes up)
    this.radiation += (this.eva ? 0.0009 : 0.0004) * (1 + 0.25 * this.random())
    this.o2 = Math.max(0, this.o2 - (this.eva ? 0.0075 : 0.0045))
    this.battery = Math.max(0, this.battery - (this.eva ? 0.0095 : 0.0055))

    // walking happens only during EVA phases
    if (this.eva) {
      this.distance -= SPEED_KM_S * (0.9 + 0.2 * this.random())
      this.range = Math.max(0.2, this.range - 0.0032)
    }
    if (this.distance < ARRIVAL_KM) {
      this.distance = START_DISTANCE_KM
      this.range = 12.4
    }

    const nat: Partial<Record<MetricKey, number>> = {
      heartRate: hr, spo2, bodyTemp: temp, suitPressure: press, hydration: this.hydration, respRate: resp,
    }

    // --- anomaly layer: delta eases towards (target - natural), then recovers ---
    for (const key of DISTURBABLE) {
      const base = nat[key]!
      const a = this.anomaly?.key === key ? this.anomaly : (this.extra.find((x) => x.key === key) ?? null)
      const full = a ? (a.target !== undefined ? a.target - base : (a.offset ?? 0)) : 0
      const want = a && a.ramp > 0 ? full * Math.min(1, (s - a.start) / a.ramp) : full
      const cur = this.delta[key] ?? 0
      const nextDelta = cur + (want - cur) * (want !== 0 ? 0.45 : 0.2)
      this.delta[key] = want === 0 && Math.abs(nextDelta) < 0.02 * Math.max(1, Math.abs(base)) * 0.1 ? 0 : nextDelta
    }
    const out = (key: MetricKey) => (nat[key] as number) + (this.delta[key] ?? 0)

    const round = (v: number, dp: number) => Number(v.toFixed(dp))
    const etaS = estimateEtaSeconds({
      distanceKm: Math.max(0, this.distance - ARRIVAL_KM),
      speedKmS: SPEED_KM_S,
      eva: this.eva,
      phaseRemainingS: (this.phaseUntil - s) * (TICK_MS / 1000),
      meanEvaS: PHASE_MEAN * (TICK_MS / 1000),
      meanRestS: PHASE_MEAN * (TICK_MS / 1000),
    })
    const sample: Sample = {
      t,
      iso: d.toISOString(),
      sol: SOL_START,
      utc: d.toISOString().slice(11, 19),
      heartRate: Math.round(out('heartRate')),
      spo2: Math.round(clamp(out('spo2'), 80, 100)),
      hydration: round(clamp(out('hydration'), 0, 100), 1),
      bodyTemp: round(out('bodyTemp'), 1),
      suitPressure: round(out('suitPressure'), 2),
      radiation: round(this.radiation, 3),
      signal: Math.round(signal),
      wind: Math.round(wind),
      outsideTemp: Math.round(ext),
      roverRange: round(this.range, 1),
      respRate: Math.round(out('respRate')),
      o2Tank: round(this.o2, 1),
      battery: round(this.battery, 1),
      coolantTemp: round(coolant, 1),
      visorTemp: round(visor, 1),
      gloveTemp: round(glove, 1),
      bootTemp: round(boot, 1),
      distanceKm: round(this.distance, 2),
      etaMin: Math.ceil(etaS / 60),
      progress: clamp(1 - this.distance / START_DISTANCE_KM, 0, 1),
      evaActive: this.eva,
      anomaly: this.anomaly?.key ?? null,
      provenance: this.opts.provenance?.() ?? ALL_SIMULATED,
    }
    return sample
  }
}
