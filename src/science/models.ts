/**
 * Published physiological and mission models used by the dashboard. Every constant below comes
 * from the cited source; anything that is an app choice rather than a published value is marked
 * "app heuristic".
 */

// ============================================================================================
// 1. Physiological Strain Index (PSI)
//    Moran DS, Shitzer A, Pandolf KB. A physiological strain index to evaluate heat stress.
//    Am J Physiol Regul Integr Comp Physiol 1998;275:R129–R134.
//    PSI = 5(Tc_t − Tc_0)/(39.5 − Tc_0) + 5(HR_t − HR_0)/(180 − HR_0), scale 0–10.
//    (Original uses rectal temperature; here the chest-patch core temperature stands in.)
// ============================================================================================
export interface PsiResult {
  value: number
  /** contribution of heart rate (cardiovascular strain), 0–5 */
  hrPart: number
  /** contribution of core temperature (thermal strain), 0–5 */
  tcPart: number
  category: 'none' | 'low' | 'moderate' | 'high' | 'very high'
}

export function physiologicalStrainIndex(tc: number, hr: number, tc0: number, hr0: number): PsiResult {
  const tcPart = Math.max(0, Math.min(5, (5 * (tc - tc0)) / (39.5 - tc0)))
  const hrPart = Math.max(0, Math.min(5, (5 * (hr - hr0)) / (180 - hr0)))
  const value = tcPart + hrPart
  // banding of the 0–10 scale into words is an app heuristic; PSI ≥ 7.5 was the "at risk" cut-off
  // used by Buller et al. 2008 (Physiol Meas 29:N79)
  const category = value < 3 ? 'none' : value < 5 ? 'low' : value < 7 ? 'moderate' : value < 9 ? 'high' : 'very high'
  return { value, hrPart, tcPart, category }
}

// ============================================================================================
// 2. ECTemp — core temperature estimated from heart rate (extended Kalman filter)
//    Buller MJ, Tharion WJ, Cheuvront SN, et al. Estimation of human core temperature from
//    sequential heart rate observations. Physiol Meas 2013;34:781–798. Parameters as published
//    in the paper's code and US patent 10,702,165: a = 1, γ = 0.022, b0 = −7887.1,
//    b1 = 384.4286, b2 = −4.5714, σ = 18.88, CT0 = 37.1 °C, v0 = 0; one update per minute.
// ============================================================================================
export const ECTEMP = { a: 1, gamma2: 0.022 ** 2, b0: -7887.1, b1: 384.4286, b2: -4.5714, sigma2: 18.88 ** 2, ct0: 37.1, v0: 0, stepMs: 60_000 } as const

export interface KalmanState {
  ct: number
  v: number
}

/** One ECTemp update with the mean heart rate of the last minute. */
export function ectempStep(prev: KalmanState, hr: number): KalmanState {
  const { a, gamma2, b0, b1, b2, sigma2 } = ECTEMP
  const ctHat = a * prev.ct
  const vHat = a * a * prev.v + gamma2
  const c = 2 * b2 * ctHat + b1
  const k = (vHat * c) / (c * c * vHat + sigma2)
  const ct = ctHat + k * (hr - (b2 * ctHat * ctHat + b1 * ctHat + b0))
  const v = (1 - k * c) * vHat
  return { ct, v }
}

/** Heart rate the ECTemp observation model expects at core temperature `ct`. */
export const ectempExpectedHr = (ct: number) => ECTEMP.b2 * ct * ct + ECTEMP.b1 * ct + ECTEMP.b0

// ============================================================================================
// 3. Decompression sickness: tissue ratio (TR) with NASA's 360-min half-time compartment
//    TR = N2 tension in a theoretical 360-min half-time tissue / ambient (suit) pressure.
//    Conkin J. NASA/TP-2020-220529; NASA Human Research Program, Evidence Report: Risk of
//    Decompression Sickness. Reference point: NASA modelled TR ≈ 1.23 for the first EVA from the
//    8.2 psia / 34 % O2 exploration atmosphere with a 15-min prebreathe (NASA/TP-2020-220529).
//    TR is a relative stress measure, not a go/no-go limit.
//    Simplification (app): dry-gas partial pressures, no water-vapour or CO2 correction.
// ============================================================================================
export const TISSUE_HALF_TIME_MIN = 360

export interface Atmosphere {
  id: 'iss' | 'staged' | 'exploration'
  label: string
  psia: number
  fo2: number
  source: string
}

export const ATMOSPHERES: readonly Atmosphere[] = [
  { id: 'iss', label: 'ISS cabin (sea-level air)', psia: 14.7, fo2: 0.21, source: 'ISS nominal cabin atmosphere' },
  { id: 'staged', label: 'Shuttle staged decompression', psia: 10.2, fo2: 0.265, source: 'Space Shuttle 10.2 psia / 26.5 % O2 staged protocol' },
  { id: 'exploration', label: 'NASA exploration atmosphere', psia: 8.2, fo2: 0.34, source: 'NASA Exploration Atmospheres Working Group, 8.2 psia / 34 % O2' },
]

export const NASA_TR_REFERENCE = { tr: 1.23, label: '8.2 psia / 34 % O2 + 15-min prebreathe, NASA model' }

export const habitatN2 = (a: Pick<Atmosphere, 'psia' | 'fo2'>) => a.psia * (1 - a.fo2)

/** Tissue N2 tension after `dtMin` minutes exposed to ambient N2 partial pressure `ambientN2`. */
export function tissueStep(p: number, ambientN2: number, dtMin: number): number {
  return ambientN2 + (p - ambientN2) * Math.pow(2, -Math.max(0, dtMin) / TISSUE_HALF_TIME_MIN)
}

export const tissueRatio = (tissueN2: number, suitPsia: number) => (suitPsia > 0 ? tissueN2 / suitPsia : NaN)

/** Minutes of 100 % O2 prebreathe needed to bring TR down to `targetTr` (0 if already there). */
export function prebreatheMinutes(tissueN2: number, suitPsia: number, targetTr: number): number {
  if (!(tissueN2 > 0) || !(suitPsia > 0) || !(targetTr > 0)) return 0
  return Math.max(0, TISSUE_HALF_TIME_MIN * Math.log2(tissueN2 / (targetTr * suitPsia)))
}

// ============================================================================================
// 4. Radiation budget against NASA's career limit
//    NASA-STD-3001 Vol. 1: career effective dose from spaceflight < 600 mSv (all ages, sexes).
//    Mars surface GCR baseline 0.67 mSv/sol (Hassler et al., Science 2014, MSL-RAD).
// ============================================================================================
export const CAREER_LIMIT_MSV = 600
export const SOL_S = 88775.244
export const MARS_SURFACE_MSV_PER_DAY = (0.67 * 86400) / SOL_S

export interface RadiationBudget {
  usedPct: number
  remainingMsv: number
  /** days until the career limit at the given dose rate */
  daysToLimit: number
  /** dose a 500-sol surface stay would add at this rate */
  stay500SolMsv: number
}

export function radiationBudget(doseMsv: number, rateMsvPerDay: number): RadiationBudget {
  const remainingMsv = Math.max(0, CAREER_LIMIT_MSV - doseMsv)
  return {
    usedPct: Math.max(0, Math.min(100, (doseMsv / CAREER_LIMIT_MSV) * 100)),
    remainingMsv,
    daysToLimit: rateMsvPerDay > 0 ? remainingMsv / rateMsvPerDay : Infinity,
    stay500SolMsv: rateMsvPerDay * ((500 * SOL_S) / 86400),
  }
}

// ============================================================================================
// 5. Earth–Mars geometry and signal delay
//    JPL Solar System Dynamics, "Approximate Positions of the Planets", Table 1 (Keplerian
//    elements and rates, J2000 ecliptic, valid 1800–2050), E. M. Standish. Algorithm as given there.
// ============================================================================================
type Elem = readonly [number, number] // value at J2000, rate per Julian century
interface Orbit {
  a: Elem
  e: Elem
  I: Elem
  L: Elem
  peri: Elem
  node: Elem
}
export const JPL_TABLE1: Record<'emb' | 'mars', Orbit> = {
  emb: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], peri: [102.93768193, 0.32327364], node: [0.0, 0.0] },
  mars: { a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], peri: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343] },
}
export const AU_KM = 149_597_870.7
export const C_KM_S = 299_792.458
const D2R = Math.PI / 180

/** Julian ephemeris date (TDB ≈ TT = UTC + 69.184 s) for a Unix time in ms. */
export const julianEphemerisDate = (ms: number) => (ms + 69_184) / 86_400_000 + 2_440_587.5

/** Heliocentric J2000-ecliptic position (au). */
export function heliocentric(body: keyof typeof JPL_TABLE1, ms: number): [number, number, number] {
  const o = JPL_TABLE1[body]
  const T = (julianEphemerisDate(ms) - 2_451_545.0) / 36_525
  const at = (x: Elem) => x[0] + x[1] * T
  const a = at(o.a), e = at(o.e), I = at(o.I), L = at(o.L), peri = at(o.peri), node = at(o.node)
  const w = peri - node
  let M = (L - peri) % 360
  if (M > 180) M -= 360
  if (M < -180) M += 360
  const eStar = (180 / Math.PI) * e
  let E = M + eStar * Math.sin(M * D2R)
  for (let i = 0; i < 30; i++) {
    const dM = M - (E - eStar * Math.sin(E * D2R))
    const dE = dM / (1 - e * Math.cos(E * D2R))
    E += dE
    if (Math.abs(dE) <= 1e-6) break
  }
  const xp = a * (Math.cos(E * D2R) - e)
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E * D2R)
  const cw = Math.cos(w * D2R), sw = Math.sin(w * D2R), cO = Math.cos(node * D2R), sO = Math.sin(node * D2R), cI = Math.cos(I * D2R), sI = Math.sin(I * D2R)
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ]
}

export interface EarthMarsLink {
  distanceAu: number
  distanceKm: number
  /** one-way light time, seconds */
  oneWayS: number
  /** Sun–Earth–Mars angle (Mars' elongation as seen from Earth), degrees */
  sunAngleDeg: number
}

export function earthMarsLink(ms: number): EarthMarsLink {
  const e = heliocentric('emb', ms)
  const m = heliocentric('mars', ms)
  const d = [m[0] - e[0], m[1] - e[1], m[2] - e[2]]
  const distanceAu = Math.hypot(d[0], d[1], d[2])
  const toSun = [-e[0], -e[1], -e[2]]
  const cos = (d[0] * toSun[0] + d[1] * toSun[1] + d[2] * toSun[2]) / (distanceAu * Math.hypot(toSun[0], toSun[1], toSun[2]))
  return { distanceAu, distanceKm: distanceAu * AU_KM, oneWayS: (distanceAu * AU_KM) / C_KM_S, sunAngleDeg: Math.acos(Math.max(-1, Math.min(1, cos))) / D2R }
}

// ============================================================================================
// 6. Trend forecast: least-squares slope over the last minute → time until a warning threshold.
//    Standard linear regression. Acceptance rules are app heuristics so that noise or a value that
//    is settling onto a new plateau (e.g. heart rate after an EVA ends) is not reported as a trend:
//    ≥ 20 points, R² ≥ 0.6, the newer half of the window must still move at ≥ 50 % of the older
//    half's rate in the same direction, and the crossing (at the newer half's rate) within 15 min.
// ============================================================================================
export interface Forecast {
  /** minutes until the value reaches the warning band at the current trend */
  minutes: number
  direction: 'rising' | 'falling'
  slopePerMin: number
  r2: number
  threshold: number
}

function fit(xs: number[], ys: number[]) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    sxy += (xs[i] - mx) * (ys[i] - my)
    syy += (ys[i] - my) ** 2
  }
  const slope = sxx ? sxy / sxx : 0
  return { slope, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0, at: (x: number) => my + slope * (x - mx) }
}

export interface ForecastOptions {
  windowMs?: number
  horizonMin?: number
  minR2?: number
}

export function trendForecast(times: readonly number[], values: readonly number[], band: { low?: number; high?: number }, opts: ForecastOptions = {}): Forecast | null {
  const { windowMs = 60_000, horizonMin = 15, minR2 = 0.6 } = opts
  const n0 = Math.min(times.length, values.length)
  if (!n0) return null
  const end = times[n0 - 1]
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < n0; i++) {
    if (times[i] >= end - windowMs && Number.isFinite(values[i]) && Number.isFinite(times[i])) {
      xs.push((times[i] - end) / 60_000)
      ys.push(values[i])
    }
  }
  if (xs.length < 20) return null
  const all = fit(xs, ys)
  if (all.r2 < minR2 || all.slope === 0) return null
  const h = Math.floor(xs.length / 2)
  const older = fit(xs.slice(0, h), ys.slice(0, h))
  const newer = fit(xs.slice(h), ys.slice(h))
  // decelerating or reversing → settling onto a plateau, not heading for the threshold
  if (Math.sign(newer.slope) !== Math.sign(all.slope) || Math.abs(newer.slope) < 0.5 * Math.abs(older.slope)) return null
  const slope = newer.slope
  const now = newer.at(0)
  const candidates: Forecast[] = []
  if (band.high !== undefined && slope > 0 && now < band.high) candidates.push({ minutes: (band.high - now) / slope, direction: 'rising', slopePerMin: slope, r2: all.r2, threshold: band.high })
  if (band.low !== undefined && slope < 0 && now > band.low) candidates.push({ minutes: (band.low - now) / slope, direction: 'falling', slopePerMin: slope, r2: all.r2, threshold: band.low })
  return candidates.filter((c) => c.minutes > 0 && c.minutes <= horizonMin).sort((a, b) => a.minutes - b.minutes)[0] ?? null
}
