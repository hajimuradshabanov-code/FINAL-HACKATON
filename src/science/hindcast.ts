/**
 * Hindcast: the Earth→Mars radiation model run on a real event and compared with what was measured
 * on the surface of Mars.
 *
 * Event: 10 September 2017, X8.2 flare and a 2650 km/s CME. GOES-15 measured the protons at Earth;
 * MSL-RAD, in Gale crater, 156° away from Earth in heliographic longitude, recorded the largest
 * particle event of its mission up to then.
 *
 * Inputs (src/science/hindcastData.ts, built by `npm run fetch:hindcast`): GOES-15 EPEAD/HEPAD peak
 * fluxes from NOAA NCEI, background-subtracted; CME direction and width from NASA DONKI.
 * Observation: surface dose rate rose to 2–3 times the pre-event background of 244 µGy/day
 * (RAD B detector, in water; Zeitlin et al. 2018, Geophys Res Lett 45:5845), i.e. an excess of
 * 244–488 µGy/day = 10–20 µGy/h at the peak.
 *
 * Three model versions are run so the effect of each revision is visible:
 *   1. original   point source at the CME axis, spectral index from the ≥10 and ≥100 MeV channels
 *   2. + tail     spectral index from the ≥100 and ≥510 MeV channels (the recipe used live)
 *   3. current    + source extended over the CME width
 * The comparison is on peak dose rate only. The model has no time dependence: GOES peaked at
 * 22:20 UTC on 10 Sep, RAD between 04:00 and 14:00 UTC on 11 Sep.
 *
 * This is one event. The revisions were made after seeing it, and RAD.transportUncertainty was set
 * from its residual, so it is a calibration case, not an independent validation. Independent tests
 * would be the 28 Oct 2021 and 20 May 2024 events (GOES-16/18 SGPS archives), not done here.
 */
import { SEP2017 } from './hindcastData'
import { ACTION, RAD, assessRadiation, type Advice, type Cme, type RadiationInput } from './radiation'

/** RAD B-detector dose rate before the event and the published peak factor (Zeitlin et al. 2018). */
export const RAD_OBSERVED = { backgroundUGyDay: 244, peakFactor: [2, 3] as const }
export const OBSERVED_EXCESS_UGY_H: [number, number] = [
  (RAD_OBSERVED.backgroundUGyDay * (RAD_OBSERVED.peakFactor[0] - 1)) / 24,
  (RAD_OBSERVED.backgroundUGyDay * (RAD_OBSERVED.peakFactor[1] - 1)) / 24,
]

export interface HindcastRow {
  id: 'original' | 'tail' | 'current'
  label: string
  /** predicted solar-proton dose rate on the surface (no extra shielding), µGy/h */
  predicted: number
  low: number
  high: number
  gamma: number
  ratio: number
  /** observed mid-point ÷ predicted: how many times too low (>1) or too high (<1) */
  observedOverPredicted: number
  advice: Advice
}

export interface Hindcast {
  peakTime: number
  marsLonDeg: number
  marsAu: number
  deltaEarthDeg: number
  deltaMarsDeg: number
  net: { p10: number; p100: number; p510: number }
  observed: [number, number]
  rows: HindcastRow[]
  /** does the observation fall inside the current model's [estimate, upper bound]? */
  insideBounds: boolean
  /** what the measured peak would have meant for an 8 h EVA, mSv (quality factor 1) */
  observedEvaMSv: [number, number]
}

export function runHindcast(): Hindcast {
  const d = SEP2017
  const t = Date.parse(d.peakTime)
  const net = (k: keyof typeof d.integral) => d.integral[k].peak - d.integral[k].background
  const cme: Cme = { id: d.cme.id, t21_5: Date.parse('2017-09-10T17:45Z'), latDeg: d.cme.latDeg, lonDeg: d.cme.lonDeg, halfAngleDeg: d.cme.halfAngleDeg, speedKmS: d.cme.speedKmS, url: d.cme.url }
  const base: RadiationInput = { t, p10: net('10'), p100: net('100'), tail: { energyMeV: 510, flux: d.above510 }, cmes: [cme], doseMSv: 0, eva: true }
  const mid = (OBSERVED_EXCESS_UGY_H[0] + OBSERVED_EXCESS_UGY_H[1]) / 2

  const variant = (id: HindcastRow['id'], label: string, model: RadiationInput['model']): HindcastRow => {
    const a = assessRadiation({ ...base, model })
    // surface dose with no extra shielding: RAD sits under the atmosphere only
    const scale = a.sep.suit > 0 ? 1 / Math.pow((RAD.columnGcm2 + 0.5) / RAD.columnGcm2, -a.gamma / RAD.braggP) : 0
    const predicted = a.sep.suit * scale
    return { id, label, predicted, low: a.sepSuitRange[0] * scale, high: a.sepSuitRange[1] * scale, gamma: a.gamma, ratio: a.scaling.ratio, observedOverPredicted: mid / predicted, advice: a.advice }
  }
  const rows = [
    variant('original', 'Original: point source, 10–100 MeV spectrum', { connection: 'point', spectrum: 'low' }),
    variant('tail', '+ measured ≥100/≥510 MeV tail', { connection: 'point', spectrum: 'tail' }),
    variant('current', 'Current: + source extended over the CME width', { connection: 'extended', spectrum: 'tail' }),
  ]
  const cur = assessRadiation(base)
  const current = rows[2]
  // the first versions had no hindcast-derived upper bound: show their own α-range only
  for (const r of rows.slice(0, 2)) r.high /= RAD.transportUncertainty
  return {
    peakTime: t,
    marsLonDeg: cur.geo.lonDeg,
    marsAu: cur.geo.rAu,
    deltaEarthDeg: cur.scaling.deltaEarthDeg ?? NaN,
    deltaMarsDeg: cur.scaling.deltaMarsDeg ?? NaN,
    net: { p10: net('10'), p100: net('100'), p510: d.above510 },
    observed: OBSERVED_EXCESS_UGY_H,
    rows,
    insideBounds: OBSERVED_EXCESS_UGY_H[1] >= current.predicted && OBSERVED_EXCESS_UGY_H[0] <= current.high,
    observedEvaMSv: [(OBSERVED_EXCESS_UGY_H[0] * ACTION.evaHours) / 1000, (OBSERVED_EXCESS_UGY_H[1] * ACTION.evaHours) / 1000],
  }
}

let memo: Hindcast | null = null
export const hindcast = () => (memo ??= runHindcast())
export { SEP2017 }
