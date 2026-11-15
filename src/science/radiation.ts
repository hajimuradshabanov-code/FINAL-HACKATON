/**
 * Radiation at the crew's position on Mars, derived from measurements made near Earth.
 *
 * GOES measures solar protons in Earth orbit. Mars is at a different distance from the Sun AND on a
 * different interplanetary magnetic field line, and its surface sits under ~21 g/cm² of CO2. Each
 * step from "GOES flux" to "dose in the suit" is written out below with its source. Everything
 * marked "app assumption" is a choice made here, not a published value.
 *
 * 1. Where is Mars?  Heliocentric positions from JPL Keplerian elements (models.ts). Longitude is
 *    measured from the Earth–Sun line, positive west (Stonyhurst convention, the one DONKI uses);
 *    the 7.25° tilt between the ecliptic and the solar equator is ignored.
 * 2. Magnetic connection.  Particles follow the Parker spiral. The solar footpoint of the field line
 *    through a point at distance r lies west of it by Ω·r/v_sw (Parker 1958) — about 61° for Earth
 *    at 400 km/s.
 * 3. Longitude.  Peak intensity falls off as a Gaussian in the angle Δ between the source and the
 *    observer's footpoint, σ ≈ 43° (Richardson et al. 2014, Sol Phys 289:3059, STEREO + near-Earth
 *    >25 MeV events; Lario et al. 2013 find 45°). The source is the CME-driven shock, not a point:
 *    Δ is measured from the edge of the CME (its DONKI half-width), so every observer inside the
 *    CME's angular extent counts as connected. Measuring Δ from a point source was the first version
 *    of this model; the hindcast below showed it to be wrong by two orders of magnitude.
 * 4. Distance.  Peak intensity ∝ r^-α. Lario et al. 2006 (ApJ 653:1531, Helios + IMP 8) give
 *    α = 1.9 for 27–37 MeV and 2.7 for 4–13 MeV, measured inside 1 au; using them out to Mars is an
 *    extrapolation (app assumption), so the result is shown with the α = 1.0…2.7 range.
 *       J_Mars / J_Earth = r_M^-α · exp(−(Δ_M² − Δ_E²) / 2σ²)
 *    The source longitude is taken from the newest fast DONKI CME. With no source the longitude
 *    term is 1 and the estimate is flagged as unconnected.
 * 5. Atmosphere.  Protons below ~150 MeV stop before the surface (Hassler et al. 2014, Science
 *    343:1244797; column ≈ 21 g/cm² at Gale). The ≥10 MeV channel that defines NOAA's S-scale is
 *    therefore irrelevant on the surface; the ≥100 MeV channel is what matters. The integral
 *    spectrum index between the two GOES channels, γ = log10(J10/J100), extends it to 150 MeV:
 *       J(>150) = J100 · 1.5^-γ
 *    Real spectra steepen above ~100 MeV, so when the ≥500 MeV channel is above background the index
 *    is taken between ≥100 and ≥500 MeV instead (measured tail). Without it the 10–100 MeV index is
 *    used, which overestimates the tail and is therefore conservative.
 * 6. Slant paths and extra shielding.  Range grows as E^p, p = 1.77 (Bragg–Kleeman; Bortfeld 1997,
 *    Med Phys 24:2024), so the cut-off energy rises as (column)^(1/p). Integrating over the upper
 *    hemisphere (the planet blocks the lower one) gives an effective solid angle
 *       Ω_eff = 2π / (1 + γ/p)
 *    and x g/cm² of extra shielding multiplies the flux by ((X + x)/X)^(-γ/p). For a 0.5 g/cm² suit
 *    under X = 21 g/cm² that factor is ≈ 0.98: on the surface of Mars the suit is not radiation
 *    shielding, the atmosphere is. Shielding areal densities are app assumptions.
 * 7. Dose.  D = Ω_eff · J · S · 1.602e-10 Gy/s with S = 5.4 MeV cm²/g, the stopping power of 150 MeV
 *    protons in water (NIST PSTAR). Quality factor 1 (LET ≈ 0.5 keV/µm, ICRP 60). Secondary neutrons
 *    are not modelled.
 * 8. Background.  Galactic cosmic rays: 0.67 mSv/sol measured by MSL-RAD (Hassler et al. 2014).
 *    Thin shielding does not reduce it, so it is the same in the suit and in the habitat here.
 *
 * Tested on one real event (src/science/hindcast.ts): 10 Sep 2017, GOES-15 at Earth, MSL-RAD on the
 * surface of Mars, 156° away in longitude. RAD saw the dose rate rise to 2–3 times background
 * (Zeitlin et al. 2018, Geophys Res Lett 45:5845). The model above is still about 20 times too
 * low for that event, so every estimate carries RAD.transportUncertainty as its upper
 * bound and decisions are taken on the upper bound. That factor comes from the same single event:
 * it is a calibration, not an independent validation.
 */
import { AU_KM, CAREER_LIMIT_MSV, MARS_SURFACE_MSV_PER_DAY, heliocentric } from './models'

export const RAD = {
  sigmaDeg: 43,
  alpha: 1.9,
  alphaRange: [1.0, 2.7],
  /** sidereal solar rotation, 25.38 d (Carrington) */
  omegaRadS: (2 * Math.PI) / (25.38 * 86_400),
  solarWindKmS: 400,
  columnGcm2: 21,
  cutoffMeV: 150,
  braggP: 1.77,
  stoppingMeVcm2g: 5.4,
  /** NOAA SWPC ≥100 MeV proton event threshold, pfu */
  p100EventPfu: 1,
  /** largest Earth→Mars scaling accepted before the estimate is called unreliable (app assumption) */
  maxRatio: 30,
  /** a ≥500 MeV reading counts as an event tail above this flux, pfu (the channel's quiet level is ≈0.2) */
  tailBackgroundPfu: 0.2,
  tailMinNetPfu: 0.1,
  /**
   * Upper bound = estimate × this. From the Sept 2017 hindcast, where the model was ≈20× below what
   * MSL-RAD measured (one event; see src/science/hindcast.ts).
   */
  transportUncertainty: 20,
} as const

const D2R = Math.PI / 180
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Extra shielding around the crew, g/cm² (app assumptions; the atmosphere's 21 g/cm² is separate). */
export const SHIELDS = {
  suit: { label: 'EVA suit', gcm2: 0.5 },
  rover: { label: 'Pressurised rover', gcm2: 5 },
  habitat: { label: 'Habitat', gcm2: 10 },
  shelter: { label: 'Storm shelter', gcm2: 30 },
} as const
export type ShieldId = keyof typeof SHIELDS

export interface MarsGeometry {
  /** heliocentric distance of Mars, au */
  rAu: number
  /** Mars' longitude from the Earth–Sun line, degrees, positive west */
  lonDeg: number
  /** solar footpoints of the field lines through Earth and Mars, same convention */
  footEarthDeg: number
  footMarsDeg: number
}

export const parkerOffsetDeg = (rAu: number, vsw: number = RAD.solarWindKmS) => ((RAD.omegaRadS * rAu * AU_KM) / vsw) / D2R

export function marsGeometry(ms: number, vsw: number = RAD.solarWindKmS): MarsGeometry {
  const e = heliocentric('emb', ms)
  const m = heliocentric('mars', ms)
  const rAu = Math.hypot(m[0], m[1], m[2])
  const rE = Math.hypot(e[0], e[1], e[2])
  const lonDeg = wrap180((Math.atan2(m[1], m[0]) - Math.atan2(e[1], e[0])) / D2R)
  return { rAu, lonDeg, footEarthDeg: wrap180(parkerOffsetDeg(rE, vsw)), footMarsDeg: wrap180(lonDeg + parkerOffsetDeg(rAu, vsw)) }
}

export interface SepScaling {
  /** J_Mars / J_Earth for the central α */
  ratio: number
  ratioLow: number
  ratioHigh: number
  radial: number
  longitudinal: number
  /** angle between the source and each footpoint; null when no source is known */
  deltaEarthDeg: number | null
  deltaMarsDeg: number | null
  /** the scaling hit the cap: Earth is so badly connected that GOES says little about Mars */
  unreliable: boolean
}

export interface SepSource {
  lonDeg: number
  /** angular half-width of the CME; the shock it drives is the particle source */
  halfAngleDeg: number
}
/** 'extended': Δ from the edge of the CME (current model). 'point': Δ from its axis (first version, kept for the hindcast). */
export type Connection = 'extended' | 'point'

export function sepScaling(geo: MarsGeometry, source: SepSource | null, connection: Connection = 'extended'): SepScaling {
  const radial = (a: number) => Math.pow(geo.rAu, -a)
  let longitudinal = 1
  let dE: number | null = null
  let dM: number | null = null
  if (source && Number.isFinite(source.lonDeg)) {
    const reach = connection === 'extended' ? Math.max(0, source.halfAngleDeg) : 0
    dE = Math.max(0, Math.abs(wrap180(source.lonDeg - geo.footEarthDeg)) - reach)
    dM = Math.max(0, Math.abs(wrap180(source.lonDeg - geo.footMarsDeg)) - reach)
    longitudinal = Math.exp(-(dM * dM - dE * dE) / (2 * RAD.sigmaDeg ** 2))
  }
  const raw = radial(RAD.alpha) * longitudinal
  const capped = (r: number) => Math.min(RAD.maxRatio, r)
  return {
    ratio: capped(raw),
    ratioLow: capped(radial(RAD.alphaRange[1]) * longitudinal),
    ratioHigh: capped(radial(RAD.alphaRange[0]) * longitudinal),
    radial: radial(RAD.alpha),
    longitudinal,
    deltaEarthDeg: dE,
    deltaMarsDeg: dM,
    unreliable: raw > RAD.maxRatio,
  }
}

/** Integral spectrum index between the GOES ≥10 and ≥100 MeV channels. */
export const spectralIndex = (p10: number, p100: number) => (p10 > 0 && p100 > 0 ? clamp(Math.log10(p10 / p100), 0.5, 4) : 2)

/** Integral spectrum index above 100 MeV from a higher channel, e.g. ≥500 MeV (net of background). */
export function tailIndex(p100: number, tail: { energyMeV: number; flux: number } | null | undefined): number | null {
  if (!tail || !(tail.energyMeV > 100) || !(tail.flux > 0) || !(p100 > tail.flux)) return null
  return clamp(Math.log(p100 / tail.flux) / Math.log(tail.energyMeV / 100), 0.5, 6)
}

/** The live GOES ≥500 MeV reading as a tail point, or null while it is at its quiet level. */
export function goesTail(p500: number | null | undefined): { energyMeV: number; flux: number } | null {
  if (typeof p500 !== 'number' || !Number.isFinite(p500)) return null
  const net = p500 - RAD.tailBackgroundPfu
  return net >= RAD.tailMinNetPfu ? { energyMeV: 500, flux: net } : null
}

/** Flux multiplier for `gcm2` of shielding added under the atmosphere. */
export const shieldFactor = (gcm2: number, gamma: number) => Math.pow((RAD.columnGcm2 + Math.max(0, gcm2)) / RAD.columnGcm2, -gamma / RAD.braggP)

/** Solar-proton dose rate on the Mars surface, µSv/h, for a ≥100 MeV flux (pfu) at Mars above the atmosphere. */
export function surfaceSepDoseUSvH(p100AtMars: number, gamma: number, shieldGcm2 = 0): number {
  if (!(p100AtMars > 0)) return 0
  const j = p100AtMars * Math.pow(RAD.cutoffMeV / 100, -gamma) * shieldFactor(shieldGcm2, gamma)
  const omega = (2 * Math.PI) / (1 + gamma / RAD.braggP)
  return omega * j * RAD.stoppingMeVcm2g * 1.602e-10 * 3600 * 1e6
}

export const GCR_USV_H = (MARS_SURFACE_MSV_PER_DAY * 1000) / 24

// ---- CME propagation: drag-based model --------------------------------------------------------
// Vršnak B, Žic T, Vrbanec D, et al. Propagation of interplanetary coronal mass ejections: the
// drag-based model. Sol Phys 2013;285:295. dv/dt = −γ (v − w)|v − w| with constant drag γ and
// solar-wind speed w, valid beyond ~20 solar radii:
//   r(t) = ±(1/γ) ln(1 ± γ (v0 − w) t) + w t + r0,   v(t) = (v0 − w)/(1 ± γ (v0 − w) t) + w
export const R_SUN_KM = 695_700
export const DBM = { gammaPerKm: 0.2e-7, wKmS: 400, r0Rs: 21.5, gammas: [0.1e-7, 0.2e-7, 0.5e-7, 1.0e-7], winds: [350, 400, 450, 500] } as const

export function dbmArrival(v0: number, targetKm: number, gamma: number = DBM.gammaPerKm, w: number = DBM.wKmS, r0Km: number = DBM.r0Rs * R_SUN_KM): { hours: number; speedKmS: number } {
  if (!(v0 > 0) || !(targetKm > r0Km)) return { hours: NaN, speedKmS: NaN }
  const dv = Math.abs(v0 - w)
  const sign = v0 >= w ? 1 : -1
  const r = (t: number) => (dv === 0 ? 0 : (sign / gamma) * Math.log(1 + gamma * dv * t)) + w * t + r0Km
  let lo = 0
  let hi = (targetKm - r0Km) / Math.min(v0, w) // the CME is never slower than the slower of the two speeds
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (r(mid) < targetKm) lo = mid
    else hi = mid
  }
  const t = (lo + hi) / 2
  return { hours: t / 3600, speedKmS: (v0 - w) / (1 + gamma * dv * t) + w }
}

export interface Cme {
  id: string
  /** time the leading edge passed 21.5 solar radii, epoch ms */
  t21_5: number
  latDeg: number
  lonDeg: number
  halfAngleDeg: number
  speedKmS: number
  url: string
}

export interface CmeForecast {
  cme: Cme
  /** angle between the CME axis and the Sun–Mars line */
  separationDeg: number
  hitsMars: boolean
  arrival: number
  arrivalEarliest: number
  arrivalLatest: number
  arrivalSpeedKmS: number
}

export function cmeAtMars(cme: Cme, geo: MarsGeometry): CmeForecast {
  const cos = Math.cos(cme.latDeg * D2R) * Math.cos(wrap180(cme.lonDeg - geo.lonDeg) * D2R)
  const separationDeg = Math.acos(clamp(cos, -1, 1)) / D2R
  const target = geo.rAu * AU_KM
  const central = dbmArrival(cme.speedKmS, target)
  const all = DBM.gammas.flatMap((g) => DBM.winds.map((w) => dbmArrival(cme.speedKmS, target, g, w).hours))
  const at = (h: number) => cme.t21_5 + h * 3_600_000
  return { cme, separationDeg, hitsMars: separationDeg <= cme.halfAngleDeg, arrival: at(central.hours), arrivalEarliest: at(Math.min(...all)), arrivalLatest: at(Math.max(...all)), arrivalSpeedKmS: central.speedKmS }
}

// ---- decision ---------------------------------------------------------------------------------
/** App action levels (ALARA), expressed against cited quantities: see `decide`. */
export const ACTION = {
  evaHours: 8,
  /** solar-proton dose over one EVA that triggers a return to shelter: ≈ 1.5 sols of background */
  shelterMSv: 1,
  /** … and that triggers caution: half the background dose of the same EVA */
  cautionMSv: 0.1,
  /** CMEs slower than this rarely drive shocks that accelerate protons */
  fastCmeKmS: 800,
  sourceCmeKmS: 500,
  sourceWindowH: 72,
  lookaheadH: 24,
} as const

export type Advice = 'go' | 'caution' | 'shelter'

export interface RadiationInput {
  t: number
  /** GOES integral proton flux at Earth, pfu */
  p10: number
  p100: number | null
  cmes: readonly Cme[]
  /** accumulated mission dose, mSv */
  doseMSv: number
  eva: boolean
  vsw?: number
  /** a GOES integral channel above 100 MeV, net of background (live: ≥500 MeV) */
  tail?: { energyMeV: number; flux: number } | null
  /** no current GOES measurement (feed down or too old): pass p10 = 0, p100 = null and set this */
  noProtonData?: boolean
  /** model variants, only used by the hindcast to show what each revision changed */
  model?: { connection?: Connection; spectrum?: 'tail' | 'low' }
}

export interface RadiationAssessment {
  geo: MarsGeometry
  /** CME used as the particle source, if any */
  source: Cme | null
  scaling: SepScaling
  gamma: number
  /** which channels gave the spectral index */
  gammaFrom: 'tail' | '10-100'
  eventAtEarth: boolean
  /** ≥100 MeV flux estimated at Mars above the atmosphere, pfu */
  p100Mars: number
  /** surface dose rates behind each shielding, µSv/h (solar protons only) */
  sep: Record<ShieldId, number>
  /** suit dose rate: lowest plausible (steepest radial law) and upper bound (flattest law × transportUncertainty) */
  sepSuitRange: [number, number]
  /** solar-proton dose of one full EVA at the upper bound, mSv — decisions use this */
  evaSepHighMSv: number
  gcrUSvH: number
  /** total rate where the crew is now (suit during EVA, habitat otherwise) */
  rateUSvH: number
  /** solar-proton dose of one full EVA at the current rate, mSv */
  evaSepMSv: number
  cmes: CmeForecast[]
  careerUsedPct: number
  advice: Advice
  headline: string
  reasons: string[]
}

export function assessRadiation(inp: RadiationInput): RadiationAssessment {
  const geo = marsGeometry(inp.t, inp.vsw)
  const recent = inp.cmes.filter((c) => c.t21_5 <= inp.t && inp.t - c.t21_5 <= ACTION.sourceWindowH * 3_600_000)
  const source = recent.filter((c) => c.speedKmS >= ACTION.sourceCmeKmS).sort((a, b) => b.speedKmS - a.speedKmS)[0] ?? null
  const scaling = sepScaling(geo, source, inp.model?.connection)
  const p100 = inp.p100 ?? 0
  const eventAtEarth = p100 >= RAD.p100EventPfu
  const tail = inp.model?.spectrum === 'low' ? null : tailIndex(p100, inp.tail)
  const gamma = tail ?? spectralIndex(inp.p10, p100)
  const p100Mars = eventAtEarth ? p100 * scaling.ratio : 0
  const sep = Object.fromEntries((Object.keys(SHIELDS) as ShieldId[]).map((id) => [id, surfaceSepDoseUSvH(p100Mars, gamma, SHIELDS[id].gcm2)])) as Record<ShieldId, number>
  const suitAt = (ratio: number) => surfaceSepDoseUSvH(eventAtEarth ? p100 * ratio : 0, gamma, SHIELDS.suit.gcm2)
  const rateUSvH = GCR_USV_H + (inp.eva ? sep.suit : sep.habitat)
  const evaSepMSv = (sep.suit * ACTION.evaHours) / 1000
  const sepSuitRange: [number, number] = [suitAt(scaling.ratioLow), suitAt(scaling.ratioHigh) * RAD.transportUncertainty]
  const evaSepHighMSv = (sepSuitRange[1] * ACTION.evaHours) / 1000
  const cmes = inp.cmes
    .map((c) => cmeAtMars(c, geo))
    .filter((f) => f.hitsMars && f.arrivalLatest >= inp.t)
    .sort((a, b) => a.arrival - b.arrival)
  const careerUsedPct = (inp.doseMSv / CAREER_LIMIT_MSV) * 100

  const reasons: string[] = []
  let advice: Advice = 'go'
  const RANK: Record<Advice, number> = { go: 0, caution: 1, shelter: 2 }
  const raise = (to: Advice, why: string) => {
    if (RANK[to] > RANK[advice]) advice = to
    reasons.push(why)
  }
  const h = (ms: number) => Math.max(0, (ms - inp.t) / 3_600_000)

  if (careerUsedPct >= 100) raise('shelter', `Mission dose has reached NASA's ${CAREER_LIMIT_MSV} mSv career limit.`)
  const est = `estimate ${evaSepMSv < 0.1 ? evaSepMSv.toFixed(3) : evaSepMSv.toFixed(2)} mSv, upper bound ${evaSepHighMSv < 10 ? evaSepHighMSv.toFixed(2) : evaSepHighMSv.toFixed(0)} mSv`
  if (evaSepHighMSv >= ACTION.shelterMSv) raise('shelter', `Solar protons could add ${ACTION.shelterMSv} mSv or more over an ${ACTION.evaHours}-hour EVA (${est}; the decision uses the upper bound).`)
  else if (evaSepHighMSv >= ACTION.cautionMSv) raise('caution', `Solar protons could add ${ACTION.cautionMSv} mSv or more over an ${ACTION.evaHours}-hour EVA (${est}; the decision uses the upper bound).`)
  if (eventAtEarth && scaling.unreliable) raise('caution', 'A proton event is in progress and Mars is far better connected to its source than Earth is, so GOES underestimates it.')
  // an eruption GOES cannot see: fast, recent, magnetically connected to Mars but not to Earth
  const blind = recent.find((c) => {
    if (c.speedKmS < ACTION.fastCmeKmS) return false
    const s = sepScaling(geo, c)
    // Mars within one σ of the shock, Earth far enough to see under 40 % of the peak
    return (s.deltaMarsDeg ?? 180) <= RAD.sigmaDeg && Math.exp(-((s.deltaEarthDeg ?? 0) ** 2) / (2 * RAD.sigmaDeg ** 2)) <= 0.4
  })
  if (blind && !eventAtEarth) raise('caution', `A ${Math.round(blind.speedKmS)} km/s eruption is magnetically connected to Mars but not to Earth: GOES would not see its protons.`)
  const soon = cmes.find((f) => f.cme.speedKmS >= ACTION.sourceCmeKmS && f.arrivalEarliest <= inp.t + ACTION.lookaheadH * 3_600_000)
  if (soon) raise('caution', `A ${Math.round(soon.cme.speedKmS)} km/s CME is aimed at Mars; its shock arrives in ${h(soon.arrivalEarliest).toFixed(0)}–${h(soon.arrivalLatest).toFixed(0)} h (drag-based model).`)
  if (inp.noProtonData) raise('caution', 'There is no current GOES proton measurement (feed unavailable or out of date), so a proton event cannot be ruled out. The dose rate shown is the cosmic-ray background only.')
  if (!reasons.length) reasons.push(eventAtEarth ? 'A proton event is in progress at Earth, but the dose it adds on the Mars surface is below the caution level.' : 'No proton event (GOES ≥100 MeV below 1 pfu) and no Mars-directed CME due in the next 24 h.')

  const headline =
    (advice as Advice) === 'shelter' ? (inp.eva ? 'Stop the EVA and return to the storm shelter' : 'Stay in the storm shelter; no EVA')
    : (advice as Advice) === 'caution' ? (inp.eva ? 'Continue only within 30 min of shelter' : 'Do not start a long EVA')
    : inp.eva ? 'EVA can continue' : 'Clear for EVA'

  return { geo, source, scaling, gamma, gammaFrom: tail === null ? '10-100' : 'tail', eventAtEarth, p100Mars, sep, sepSuitRange, evaSepHighMSv, gcrUSvH: GCR_USV_H, rateUSvH, evaSepMSv, cmes, careerUsedPct, advice, headline, reasons }
}

// ---- worked examples (hypothetical inputs, for demonstration when the Sun is quiet) ---------------
export interface Example {
  id: string
  label: string
  note: string
  build: (t: number) => Pick<RadiationInput, 'p10' | 'p100' | 'cmes'>
}

const exampleCme = (t: number, lonDeg: number, speedKmS: number): Cme => ({ id: 'example', t21_5: t - 5 * 3_600_000, latDeg: 0, lonDeg, halfAngleDeg: 30, speedKmS, url: '' })
/** A point 150° of connection angle away from Mars' field line, on the side nearer Earth's. */
const farFromMars = (g: MarsGeometry) => g.footMarsDeg + (wrap180(g.footEarthDeg - g.footMarsDeg) >= 0 ? 150 : -150)

export const EXAMPLES: readonly Example[] = [
  {
    id: 'connected',
    label: 'Strong event connected to Mars',
    note: 'Hypothetical: GOES reads 1000 pfu ≥10 MeV and 50 pfu ≥100 MeV; the eruption sits on the field line to Mars.',
    build: (t) => ({ p10: 1000, p100: 50, cmes: [exampleCme(t, marsGeometry(t).footMarsDeg, 1800)] }),
  },
  {
    id: 'earthOnly',
    label: 'Same event, far from Mars’ field line',
    note: 'Hypothetical: identical GOES readings, but the eruption is 150° of connection angle away from Mars. The estimate drops by orders of magnitude; the upper bound, set by the 2017 hindcast, keeps the crew cautious.',
    build: (t) => ({ p10: 1000, p100: 50, cmes: [exampleCme(t, farFromMars(marsGeometry(t)), 1800)] }),
  },
  {
    id: 'blind',
    label: 'Eruption GOES cannot see',
    note: 'Hypothetical: GOES is quiet, but a fast eruption is connected to Mars and far from Earth’s field line.',
    build: (t) => {
      const g = marsGeometry(t)
      return { p10: 0.3, p100: 0.2, cmes: [exampleCme(t, g.footMarsDeg, 1500)] }
    },
  },
]
