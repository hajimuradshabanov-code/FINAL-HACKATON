/**
 * Personal baseline: how far is each vital from THIS crew member's own norm, in standard deviations?
 *
 * Fixed population bands (src/config/thresholds.ts) answer "is the value dangerous for anyone?".
 * They cannot see a change that stays inside the band — e.g. a resting heart rate that moves from
 * this person's usual 68 bpm to 82 bpm. Real astronaut data shows why that matters: in the
 * Inspiration4 blood panels the within-person variation is much smaller than the between-person
 * variation for most analytes (index of individuality < 0.6, see src/science/osdr.ts).
 *
 * Method
 *  - separate baselines for rest and EVA (activity changes the norm, so one baseline would flag
 *    every EVA start)
 *  - exponentially weighted mean and variance, half-life BASELINE.halfLifeS (West 1979 incremental
 *    weighted statistics). The baseline keeps adapting, so a slow real change of "normal" — as
 *    happens with adaptation to altered gravity — is absorbed instead of alarming forever
 *  - z = (x̄ − μ) / σ, where x̄ is the mean of the last BASELINE.smoothS samples (a Shewhart chart on a
 *    short moving average; NIST/SEMATECH e-Handbook of Statistical Methods)
 *  - a deviation is reported when |z| ≥ zLimit for `persistS` consecutive samples
 *  - while a deviation is being reported the baseline is not updated (the anomaly must not become
 *    the norm), for at most `maxFreezeS`; after that the new level is accepted as the new normal
 *    (re-baselining)
 *  - after a rest↔EVA switch the vital is in transit for `settleS`. It is then expected anywhere
 *    between the rest norm and the EVA norm, so z measures the distance outside that envelope and
 *    nothing is learned (a detector that simply went blind here missed most abrupt events)
 *
 * zLimit, persistS, smoothS and settleS are app choices, tuned on one set of random seeds and
 * reported on another (src/science/validation.ts) — they are not published constants.
 */
import type { MetricKey } from '../config/thresholds'

export const BASELINE = {
  halfLifeS: 120,
  minSamples: 60,
  smoothS: 5,
  zLimit: 3.5,
  persistS: 4,
  clipZ: 3,
  maxFreezeS: 600,
  settleS: 45,
} as const

/** Vitals with a personal (or suit-specific) set-point. Hydration is a drain/refill balance and radiation a running total, so neither has a stationary norm. */
export const BASELINE_KEYS = ['heartRate', 'spo2', 'bodyTemp', 'respRate', 'suitPressure'] as const satisfies readonly MetricKey[]
export type BaselineKey = (typeof BASELINE_KEYS)[number]

/** Smallest SD used for z: the sensor resolution, so a perfectly flat reading cannot produce an infinite z. */
const SD_FLOOR: Record<BaselineKey, number> = { heartRate: 1.5, spo2: 0.5, bodyTemp: 0.06, respRate: 0.6, suitPressure: 0.008 }

export type Activity = 'rest' | 'eva'

export interface Stat {
  mean: number
  variance: number
  /** samples learned (saturates; only used for warm-up) */
  n: number
}

export interface BaselineReading {
  key: BaselineKey
  activity: Activity
  /** personal norm for the current activity */
  mean: number
  sd: number
  /** smoothed current value */
  value: number
  z: number
  /** baseline still warming up, or the vital is settling after an activity change */
  ready: boolean
  settling: boolean
  /** |z| has stayed beyond the limit long enough to report */
  deviating: boolean
  direction: 'high' | 'low' | null
  /** seconds the current deviation has lasted */
  forS: number
}

export type BaselineState = Record<BaselineKey, BaselineReading>

export type StoredBaseline = Partial<Record<BaselineKey, Partial<Record<Activity, Stat>>>>

interface Channel {
  stats: Record<Activity, Stat | null>
  recent: number[]
  /** time of the newest value in `recent`, ms (0 = none) */
  recentT: number
  beyondS: number
  frozenS: number
}

const isStat = (v: unknown): v is Stat =>
  typeof v === 'object' && v !== null && ['mean', 'variance', 'n'].every((k) => Number.isFinite((v as Record<string, unknown>)[k])) && (v as Stat).variance >= 0 && (v as Stat).n >= 0

export class PersonalBaseline {
  private ch = new Map<BaselineKey, Channel>()
  private activity: Activity | null = null
  private settleLeft = 0
  private lastT = 0

  constructor(stored?: unknown) {
    for (const key of BASELINE_KEYS) {
      const s = (typeof stored === 'object' && stored !== null ? (stored as StoredBaseline)[key] : undefined) ?? {}
      this.ch.set(key, { stats: { rest: isStat(s.rest) ? { ...s.rest } : null, eva: isStat(s.eva) ? { ...s.eva } : null }, recent: [], recentT: 0, beyondS: 0, frozenS: 0 })
    }
  }

  /** Learned norms, for persisting per crew member. */
  export(): StoredBaseline {
    const out: StoredBaseline = {}
    for (const [key, c] of this.ch) out[key] = { ...(c.stats.rest ? { rest: { ...c.stats.rest } } : {}), ...(c.stats.eva ? { eva: { ...c.stats.eva } } : {}) }
    return out
  }

  update(t: number, eva: boolean, values: Partial<Record<BaselineKey, number>>): BaselineState {
    const dt = this.lastT ? Math.max(0, Math.min(5, (t - this.lastT) / 1000)) : 1
    this.lastT = t
    const activity: Activity = eva ? 'eva' : 'rest'
    if (this.activity !== null && activity !== this.activity) {
      this.settleLeft = BASELINE.settleS
      for (const c of this.ch.values()) c.frozenS = 0
    } else {
      this.settleLeft = Math.max(0, this.settleLeft - dt)
    }
    this.activity = activity
    const settling = this.settleLeft > 0
    const alpha = 1 - Math.pow(2, -dt / BASELINE.halfLifeS)

    const out = {} as BaselineState
    for (const key of BASELINE_KEYS) {
      const c = this.ch.get(key)!
      const x = values[key]
      const stat = c.stats[activity]
      // a vital that stopped arriving has no current value: old samples must not keep being scored
      if (c.recent.length && t - c.recentT > BASELINE.smoothS * 1000) c.recent = []
      if (typeof x === 'number' && Number.isFinite(x)) {
        c.recent.push(x)
        c.recentT = t
        if (c.recent.length > BASELINE.smoothS) c.recent.shift()
      }
      const value = c.recent.length ? c.recent.reduce((a, b) => a + b, 0) / c.recent.length : NaN
      const other = c.stats[activity === 'eva' ? 'rest' : 'eva']
      const ready = !!stat && stat.n >= BASELINE.minSamples && (!settling || (!!other && other.n >= BASELINE.minSamples))
      let sd = stat ? Math.max(SD_FLOOR[key], Math.sqrt(stat.variance)) : NaN
      let z = stat && Number.isFinite(value) ? (value - stat.mean) / sd : NaN
      if (settling && stat && other && Number.isFinite(value)) {
        sd = Math.max(sd, Math.sqrt(other.variance))
        const lo = Math.min(stat.mean, other.mean)
        const hi = Math.max(stat.mean, other.mean)
        z = value > hi ? (value - hi) / sd : value < lo ? (value - lo) / sd : 0
      }
      const scored = ready && Number.isFinite(z) && c.recent.length >= Math.min(BASELINE.smoothS, 3)

      if (scored && Math.abs(z) >= BASELINE.zLimit) c.beyondS += dt
      else c.beyondS = 0

      // learn, unless the vital is in transit or currently looks abnormal
      if (!settling && typeof x === 'number' && Number.isFinite(x)) {
        // only a confirmed deviation is kept out of the baseline: dropping every value beyond a
        // z cut-off truncates the distribution, which shrinks σ, which drops more values (collapse)
        const abnormal = scored && c.beyondS >= BASELINE.persistS
        if (abnormal && c.frozenS < BASELINE.maxFreezeS) {
          c.frozenS += dt
        } else {
          if (!abnormal) c.frozenS = 0
          if (!stat) c.stats[activity] = { mean: x, variance: 0, n: 1 }
          else {
            // warm-up uses the plain running mean/variance, then the exponential window takes over
            const a = stat.n < BASELINE.minSamples ? 1 / (stat.n + 1) : alpha
            // winsorised learning: one sample can pull the norm by at most clipZ·σ, so the first
            // seconds of a real shift do not inflate σ and hide it; a forced re-baseline learns freely
            const lim = BASELINE.clipZ * Math.max(SD_FLOOR[key], Math.sqrt(stat.variance))
            const raw = x - stat.mean
            const d = stat.n < BASELINE.minSamples || abnormal ? raw : Math.max(-lim, Math.min(lim, raw))
            stat.mean += a * d
            stat.variance = (1 - a) * (stat.variance + a * d * d)
            stat.n = Math.min(stat.n + 1, 1e6)
          }
        }
      }

      const deviating = scored && c.beyondS >= BASELINE.persistS
      out[key] = {
        key, activity, mean: stat?.mean ?? NaN, sd, value, z: scored ? z : NaN, ready, settling,
        deviating, direction: deviating ? (z > 0 ? 'high' : 'low') : null, forS: deviating ? c.beyondS : 0,
      }
    }
    return out
  }
}
