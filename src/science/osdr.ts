/**
 * Analysis of real astronaut data from NASA OSDR: the Inspiration4 crew's clinical blood panels
 * (OSD-569 CBC, OSD-575 CMP; 4 crew, 3 pre-flight draws L-92/L-44/L-3, then R+1 … R+194).
 *
 * Question answered: is a fixed population range or a personal baseline the better yardstick for an
 * astronaut? Method (biological-variation theory):
 *
 *  - one-way ANOVA over the pre-flight draws gives within-subject variance s_w² and between-subject
 *    variance s_g² = (MS_between − MS_within)/n
 *  - index of individuality II = CV_I / CV_G (Harris EK, Clin Chem 1974;20:1535). II < 0.6: the
 *    population reference interval is insensitive for an individual; II > 1.4: it works well.
 *    Here CV_I includes analytical variation (the dataset has no replicate measurements).
 *  - a post-flight value is a personal deviation when |x − mean_i| > t(0.975, df) · s_w · √(1 + 1/n_i)
 *    (prediction interval for one new value; the same idea as Fraser's reference change value)
 *  - it is a population deviation when it falls outside the laboratory reference range in the file
 *
 * The numbers are small-sample (4 people); they justify the approach, they are not clinical norms.
 */
import { OSDR_PANELS, type OsdrPanel } from './osdrData'

/**
 * Draws left out, with the reason. In the published CBC file the C003 / L-92 draw has 19 rows
 * instead of 20: the MCH row is missing and every later value sits one label too low (it lists
 * "MPV = 330 fL", which is the platelet count). The draw is excluded rather than repaired.
 */
export const EXCLUDED_DRAWS = [{ panel: 'CBC', subject: 'C003', timepoint: 'L-92', reason: 'rows misaligned in the published file (MCH missing, later values shifted by one label)' }] as const
const excluded = (panel: string, subject: string, timepoint: string) => EXCLUDED_DRAWS.some((d) => d.panel === panel && d.subject === subject && d.timepoint === timepoint)

export const PRE_FLIGHT = ['L-92', 'L-44', 'L-3'] as const
export const POST_FLIGHT = ['R+1', 'R+45', 'R+82', 'R+194'] as const

/** two-sided 95 % Student t quantile */
const T975 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131]
export const t975 = (df: number) => (df < 1 ? NaN : df < T975.length ? T975[Math.floor(df)] : 1.96 + 2.4 / df)

export interface AnalyteStats {
  analyte: string
  panel: OsdrPanel['panel']
  study: string
  unit: string
  /** subjects with a complete pre-flight series */
  subjects: number
  mean: number
  /** within-subject CV (biological + analytical), % */
  cvI: number
  /** between-subject CV, % */
  cvG: number
  /** index of individuality CV_I / CV_G */
  ii: number
  /** pooled within-subject SD and its degrees of freedom */
  sw: number
  df: number
}

export interface FlightFlag {
  analyte: string
  subject: string
  timepoint: string
  value: number
  personalMean: number
  /** deviation in units of the personal prediction SD */
  z: number
  personal: boolean
  population: boolean
}

export interface OsdrAnalysis {
  analytes: AnalyteStats[]
  /** share of analytes with II < 0.6 (personal baseline clearly better) */
  lowIiShare: number
  medianIi: number
  /** every post-flight value judged both ways */
  flags: FlightFlag[]
  /** counts at R+1, the day after landing */
  r1: { n: number; personal: number; population: number; both: number; personalOnly: number; populationOnly: number }
  /** false-alarm check: leave-one-out on the pre-flight draws, where nothing should be flagged */
  preflight: { n: number; personal: number; population: number }
  sources: { study: string; panel: string; file: string; url: string; sha256: string }[]
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}

export function analyseOsdr(panels: readonly OsdrPanel[] = OSDR_PANELS): OsdrAnalysis {
  const analytes: AnalyteStats[] = []
  const flags: FlightFlag[] = []
  const preflight = { n: 0, personal: 0, population: 0 }

  for (const p of panels) {
    const names = [...new Set(p.rows.map((r) => r[0]))]
    for (const analyte of names) {
      const rows = p.rows.filter((r) => r[0] === analyte && r[1] !== null && !excluded(p.panel, r[5], r[7]))
      // only analytes with a two-sided reference range can be judged against the population
      if (!rows.length || rows.some((r) => r[2] === null || r[3] === null)) continue
      const subjects = [...new Set(rows.map((r) => r[5]))]
      const pre = new Map<string, number[]>()
      for (const s of subjects) {
        const v = PRE_FLIGHT.map((tp) => rows.find((r) => r[5] === s && r[7] === tp)?.[1]).filter((x): x is number => typeof x === 'number')
        if (v.length === PRE_FLIGHT.length) pre.set(s, v)
      }
      if (pre.size < 3) continue
      const n = PRE_FLIGHT.length
      const means = [...pre.values()].map(mean)
      const grand = mean(means)
      const df = pre.size * (n - 1)
      const msW = [...pre.values()].reduce((a, v) => a + v.reduce((b, x) => b + (x - mean(v)) ** 2, 0), 0) / df
      const msB = (n * means.reduce((a, m) => a + (m - grand) ** 2, 0)) / (pre.size - 1)
      const sg2 = (msB - msW) / n
      if (!(grand > 0) || !(msW > 0) || !(sg2 > 0)) continue // no measurable spread (e.g. basophils at the resolution limit)
      const sw = Math.sqrt(msW)
      const cvI = (sw / grand) * 100
      const cvG = (Math.sqrt(sg2) / grand) * 100
      analytes.push({ analyte, panel: p.panel, study: p.study, unit: rows[0][4], subjects: pre.size, mean: grand, cvI, cvG, ii: cvI / cvG, sw, df })

      const tCrit = t975(df)
      for (const [s, v] of pre) {
        const m = mean(v)
        for (const tp of POST_FLIGHT) {
          const r = rows.find((x) => x[5] === s && x[7] === tp)
          if (!r || r[1] === null) continue
          const z = (r[1] - m) / (sw * Math.sqrt(1 + 1 / n))
          flags.push({ analyte, subject: s, timepoint: tp, value: r[1], personalMean: m, z, personal: Math.abs(z) > tCrit, population: r[1] < r[2]! || r[1] > r[3]! })
        }
        // leave-one-out on pre-flight draws: predict each draw from the other two
        for (let i = 0; i < n; i++) {
          const rest = v.filter((_, j) => j !== i)
          const z = (v[i] - mean(rest)) / (sw * Math.sqrt(1 + 1 / rest.length))
          const r = rows.find((x) => x[5] === s && x[7] === PRE_FLIGHT[i])!
          preflight.n++
          if (Math.abs(z) > tCrit) preflight.personal++
          if (r[1]! < r[2]! || r[1]! > r[3]!) preflight.population++
        }
      }
    }
  }

  analytes.sort((a, b) => a.ii - b.ii)
  const at1 = flags.filter((f) => f.timepoint === 'R+1')
  const count = (f: (x: FlightFlag) => boolean) => at1.filter(f).length
  return {
    analytes,
    lowIiShare: analytes.length ? analytes.filter((a) => a.ii < 0.6).length / analytes.length : NaN,
    medianIi: median(analytes.map((a) => a.ii)),
    flags,
    r1: {
      n: at1.length,
      personal: count((f) => f.personal),
      population: count((f) => f.population),
      both: count((f) => f.personal && f.population),
      personalOnly: count((f) => f.personal && !f.population),
      populationOnly: count((f) => !f.personal && f.population),
    },
    preflight,
    sources: panels.map(({ study, panel, file, url, sha256 }) => ({ study, panel, file, url, sha256 })),
  }
}

let memo: OsdrAnalysis | null = null
/** Analysis of the bundled OSDR data (computed once). */
export const osdrAnalysis = () => (memo ??= analyseOsdr())
