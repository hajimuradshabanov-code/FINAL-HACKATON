import { METRICS, type MetricKey } from '../config/thresholds'
import type { Sample } from '../data/types'
import {
  ATMOSPHERES, ECTEMP, NASA_TR_REFERENCE, ectempStep, habitatN2, physiologicalStrainIndex, prebreatheMinutes, tissueRatio, tissueStep, trendForecast,
  type Atmosphere, type Forecast, type KalmanState, type PsiResult,
} from './models'
import { BASELINE_KEYS, PersonalBaseline, type BaselineState } from './baseline'
import { JointDetector, type JointReading } from './joint'

/** Live outputs of the stateful models, recomputed with every sample. */
export interface ScienceState {
  psi: (PsiResult & { baseline: { hr: number; tc: number } }) | null
  ectemp: { estimate: number; measured: number; diff: number; minutes: number } | null
  dcs: {
    atmosphere: Atmosphere
    habitatN2: number
    tissueN2: number
    /** TR now (in the suit) or if an EVA started now */
    tr: number
    eva: boolean
    /** O2 prebreathe needed to reach NASA's reference TR from the current tissue state */
    prebreatheMin: number
  } | null
  forecasts: ({ key: MetricKey } & Forecast)[]
  /** each vital against this crew member's own norm (src/science/baseline.ts) */
  baseline: BaselineState | null
  /** several vitals deviating together (src/science/joint.ts) */
  joint: JointReading | null
}

export const EMPTY_SCIENCE: ScienceState = { psi: null, ectemp: null, dcs: null, forecasts: [], baseline: null, joint: null }

const BASELINE_STORE = 'area51.baseline.v1:'
const SAVE_EVERY_MS = 30_000
/** trend gate: |z| against the personal baseline, and how long the trend must hold (app choices, see validation) */
export const FORECAST_MIN_Z = 2.5
export const FORECAST_PERSIST_S = 6

/** samples further apart than this leave an unobserved gap (normal spacing is 1 s) */
const MAX_OBSERVED_GAP_S = 5

const FORECAST_KEYS: MetricKey[] = ['heartRate', 'spo2', 'bodyTemp', 'suitPressure', 'hydration']
const BASELINE_SAMPLES = 30

// ---- habitat atmosphere setting (persisted per browser) --------------------------------------
const KEY = 'area51.habitat.v1'
let atmosphereId: Atmosphere['id'] = (() => {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    return ATMOSPHERES.some((a) => a.id === v) ? (v as Atmosphere['id']) : 'exploration'
  } catch {
    return 'exploration'
  }
})()
const atmoListeners = new Set<() => void>()
export const habitatSetting = {
  get: () => atmosphereId,
  set(id: Atmosphere['id']) {
    if (!ATMOSPHERES.some((a) => a.id === id) || id === atmosphereId) return
    atmosphereId = id
    try {
      globalThis.localStorage?.setItem(KEY, id)
    } catch {
      /* ignore */
    }
    atmoListeners.forEach((l) => l())
  },
  subscribe(fn: () => void) {
    atmoListeners.add(fn)
    return () => {
      atmoListeners.delete(fn)
    }
  },
}

/**
 * Runs the stateful models over the telemetry stream:
 *  - PSI against a resting baseline (mean of the first 30 samples)
 *  - ECTemp Kalman filter, one update per minute of mean heart rate
 *  - 360-min tissue-N2 compartment: equilibrates to the habitat atmosphere, washes out in the
 *    100 % O2 suit during EVA
 *  - trend forecasts for the vitals
 */
export class ScienceEngine {
  private baseHr: number[] = []
  private baseTc: number[] = []
  private kalman: KalmanState = { ct: ECTEMP.ct0, v: ECTEMP.v0 }
  private minuteStart = 0
  private minuteHr: number[] = []
  private minutes = 0
  private tissue: number | null = null
  private atmoUsed: Atmosphere['id'] | null = null
  private lastT = 0
  private personal = new PersonalBaseline()
  private subject: string | null = null
  private savedAt = 0
  private trendS = new Map<MetricKey, number>()
  private jointDetector = new JointDetector()

  reset() {
    const subject = this.subject
    Object.assign(this, new ScienceEngine())
    this.setSubject(subject)
  }

  /**
   * Whose baseline this is. Norms learned in earlier sessions are loaded from this browser's
   * storage, so the baseline is personal across sessions, not just within one.
   */
  setSubject(id: string | null) {
    this.subject = id
    let stored: unknown
    try {
      stored = id ? JSON.parse(globalThis.localStorage?.getItem(BASELINE_STORE + id) ?? 'null') : null
    } catch {
      stored = null
    }
    this.personal = new PersonalBaseline(stored)
    this.savedAt = 0
  }

  private save(t: number) {
    if (!this.subject || t - this.savedAt < SAVE_EVERY_MS) return
    this.savedAt = t
    try {
      globalThis.localStorage?.setItem(BASELINE_STORE + this.subject, JSON.stringify(this.personal.export()))
    } catch {
      /* storage unavailable */
    }
  }

  private last: ScienceState = EMPTY_SCIENCE

  update(s: Sample, times: readonly number[], history: Readonly<Record<MetricKey, readonly number[]>>): ScienceState {
    const fin = (v: number) => Number.isFinite(v)

    const dt = this.lastT ? Math.max(0, Math.min(5, (s.t - this.lastT) / 1000)) : 1

    // --- personal baseline (a repeated sample, e.g. after a settings change, is not learned twice) ---
    const baseline = s.t === this.lastT && this.last.baseline ? this.last.baseline : this.personal.update(s.t, s.evaActive, Object.fromEntries(BASELINE_KEYS.map((k) => [k, s[k]])))
    const joint = s.t === this.lastT && this.last.joint ? this.last.joint : this.jointDetector.update(s.t, baseline)
    this.save(s.t)

    // --- PSI ---
    if (this.baseHr.length < BASELINE_SAMPLES && fin(s.heartRate) && fin(s.bodyTemp)) {
      this.baseHr.push(s.heartRate)
      this.baseTc.push(s.bodyTemp)
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const psi =
      this.baseHr.length >= 5 && fin(s.heartRate) && fin(s.bodyTemp)
        ? { ...physiologicalStrainIndex(s.bodyTemp, s.heartRate, mean(this.baseTc), mean(this.baseHr)), baseline: { hr: mean(this.baseHr), tc: mean(this.baseTc) } }
        : null

    // --- ECTemp: one Kalman step per minute of data ---
    if (!this.minuteStart) this.minuteStart = s.t
    if (fin(s.heartRate)) this.minuteHr.push(s.heartRate)
    if (s.t - this.minuteStart >= ECTEMP.stepMs && this.minuteHr.length) {
      this.kalman = ectempStep(this.kalman, mean(this.minuteHr))
      this.minutes++
      this.minuteHr = []
      this.minuteStart = s.t
    }
    const ectemp = this.minutes > 0 && fin(s.bodyTemp) ? { estimate: this.kalman.ct, measured: s.bodyTemp, diff: s.bodyTemp - this.kalman.ct, minutes: this.minutes } : null

    // --- tissue nitrogen / decompression ---
    const atmo = ATMOSPHERES.find((a) => a.id === habitatSetting.get())!
    const n2 = habitatN2(atmo)
    if (this.tissue === null || this.atmoUsed !== atmo.id) {
      this.tissue = n2 // crew assumed equilibrated with the habitat when the setting changes
      this.atmoUsed = atmo.id
    } else {
      // The whole time since the last sample counts (tissueStep is exact for any step length).
      // Across a gap in the data (background tab, sleep) nobody saw whether the crew member was
      // breathing O2, so no washout is credited for it: assuming habitat air can only lengthen
      // the prebreathe, never shorten it.
      const gapS = this.lastT ? Math.max(0, (s.t - this.lastT) / 1000) : 0
      this.tissue = tissueStep(this.tissue, s.evaActive && gapS <= MAX_OBSERVED_GAP_S ? 0 : n2, gapS / 60)
    }
    this.lastT = s.t
    const suit = fin(s.suitPressure) && s.suitPressure > 0 ? s.suitPressure : 4.3
    const dcs = { atmosphere: atmo, habitatN2: n2, tissueN2: this.tissue, tr: tissueRatio(this.tissue, suit), eva: s.evaActive, prebreatheMin: prebreatheMinutes(this.tissue, suit, NASA_TR_REFERENCE.tr) }

    // --- trend forecasts ---
    // A trend is only reported once the vital has left the crew member's own normal band in the
    // same direction and has kept doing so for FORECAST_PERSIST_S: ordinary swings (EVA start,
    // slow breathing-related drift) also look like a straight line for a minute.
    const forecasts = FORECAST_KEYS.flatMap((k) => {
      // hydration drains steadily between drinks by design, so only an imminent crossing is worth reporting
      const f = trendForecast(times, history[k] ?? [], METRICS[k].warn, k === 'hydration' ? { horizonMin: 2 } : {})
      const b = (baseline as Partial<Record<MetricKey, BaselineState[keyof BaselineState]>>)[k]
      const leaving = !b || (Number.isFinite(b.z) && (f?.direction === 'rising' ? b.z >= FORECAST_MIN_Z : b.z <= -FORECAST_MIN_Z))
      const held = f && leaving ? (this.trendS.get(k) ?? 0) + dt : 0
      this.trendS.set(k, held)
      return f && held >= FORECAST_PERSIST_S ? [{ key: k, ...f }] : []
    }).sort((a, b) => a.minutes - b.minutes)

    return (this.last = { psi, ectemp, dcs, forecasts, baseline, joint })
  }
}
