import { METRIC_KEYS } from '../config/thresholds'
import type { Provenance, Sample, TelemetrySource } from './types'
import { SimulatedSource } from './telemetrySimulator'
import {
  currentProtons, fetchCmes, fetchDonki, fetchMars, fetchOsdr, fetchProtons, sScale,
  type Feed, type MarsSol, type OsdrStudy, type ProtonPoint, type SpaceWeatherNote,
} from './nasaApi'
import type { RemsSol } from './mars'
import { assessRadiation, goesTail, type Cme, type RadiationAssessment } from '../science/radiation'

/**
 * Real-data source. The crew physiology still comes from the telemetry model (no public live
 * astronaut vitals exist), but the *environment* the crew is exposed to is driven by real NASA data:
 *
 *  - outsideTemp / wind  <- modelled from InSight Mars weather (archived; InSight stopped in 2022):
 *                           the sol's real min/avg/max air temperature shapes a diurnal curve, the
 *                           real mean/max wind drives wind + gusts. These are model outputs, not
 *                           live measurements.
 *  - visor / glove / boot temperatures <- still simulated suit sensors, but derived from that same
 *                           modelled outside temperature so all temperatures agree.
 *  - radiation           <- MSL-RAD surface GCR dose rate (0.67 mSv/sol, Hassler et al. 2014, Science)
 *                           plus solar protons: live GOES flux carried from Earth to the Mars surface
 *                           (distance, magnetic connection, atmosphere, shielding) — the full chain
 *                           is in src/science/radiation.ts.
 *  - alerts feed         <- NASA DONKI notifications, OSDR astronaut studies (shown in the data card).
 */

export const GCR_MSV_PER_SOL = 0.67
export const SOL_S = 88775.244

export interface NasaLive {
  ready: boolean
  mars: Feed<MarsSol[]> | null
  /** newest REMS (Curiosity) weather reports; loaded in live mode */
  rems: Feed<RemsSol[]> | null
  protons: Feed<ProtonPoint[]> | null
  donki: Feed<SpaceWeatherNote[]> | null
  osdr: Feed<OsdrStudy[]> | null
  cmes: Feed<Cme[]> | null
  /** radiation assessment for the crew's position on Mars (null until the first sample) */
  rad: RadiationAssessment | null
  /** latest values actually applied to the telemetry */
  outsideTemp: number
  wind: number
  doseRateUSvH: number
  p10: number
  storm: string
}

let live: NasaLive = { ready: false, mars: null, rems: null, protons: null, donki: null, osdr: null, cmes: null, rad: null, outsideTemp: 0, wind: 0, doseRateUSvH: 0, p10: 0, storm: 'S0' }
const subs = new Set<() => void>()
const set = (p: Partial<NasaLive>) => {
  live = { ...live, ...p }
  subs.forEach((f) => f())
}
/** Publish feed data and derived values to everything that shows them (used by the telemetry sources). */
export const publishNasaLive = (p: Partial<NasaLive>) => set(p)
export const nasaLive = {
  subscribe: (f: () => void) => (subs.add(f), () => void subs.delete(f)),
  get: () => live,
}

const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.577 / 2

/**
 * Deterministic part of the outside-temperature model for one InSight sol: coldest around 05:00
 * local, warmest around 14:00, flattened so the average stays close to the real daily mean and
 * clamped to the real daily min/max.
 */
export function modelOutsideTemp(sol: Pick<MarsSol, 'tMin' | 'tAvg' | 'tMax'>, t: number, noise = 0): number {
  const frac = (((t / 1000 / SOL_S) % 1) + 1) % 1
  const mid = (sol.tMax + sol.tMin) / 2
  const amp = (sol.tMax - sol.tMin) / 2
  const cyc = Math.sin(2 * Math.PI * (frac - 0.375))
  const temp = sol.tAvg + (mid - sol.tAvg) * 0.3 + amp * 0.7 * cyc + noise
  return Math.max(sol.tMin, Math.min(sol.tMax, temp))
}

const SIMULATED: Provenance = Object.fromEntries(METRIC_KEYS.map((k) => [k, 'simulated']))
const WITH_INSIGHT: Provenance = { ...SIMULATED, outsideTemp: 'modelled', wind: 'modelled', radiation: 'modelled' }
const RADIATION_ONLY: Provenance = { ...SIMULATED, radiation: 'modelled' }

export class NasaSource implements TelemetrySource {
  readonly timerDriven = true
  private sim = new SimulatedSource({
    outsideTemp: (t) => {
      const sol = live.mars?.data[0]
      return sol ? modelOutsideTemp(sol, t, gauss() * 0.4) : null
    },
    provenance: () => (live.mars?.data[0] ? WITH_INSIGHT : RADIATION_ONLY),
  })
  private timers: ReturnType<typeof setInterval>[] = []
  private dose = 0
  private lastT = 0
  private wind = 5
  private running = false
  private radAt = 0

  start(onSample: (s: Sample, backfill: boolean) => void) {
    this.stop()
    this.running = true
    const load = async () => {
      const [mars, protons, donki, osdr, cmes] = await Promise.all([fetchMars(), fetchProtons(), fetchDonki(), fetchOsdr(), fetchCmes()])
      if (this.running) set({ mars, protons, donki, osdr, cmes, ready: true })
    }
    void load()
    this.timers.push(
      setInterval(() => {
        void fetchProtons().then((protons) => {
          if (this.running) set({ protons })
        })
      }, 5 * 60_000),
    )

    this.dose = 1.2
    this.lastT = 0
    this.sim.start((s, backfill) => onSample(this.apply(s), backfill))
  }

  stop() {
    this.running = false
    this.sim.stop()
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  triggerAnomaly() {
    this.sim.triggerAnomaly()
  }

  private apply(s: Sample): Sample {
    const { mars, protons } = live
    // the whole gap counts (background-tab throttling, sleep): the dose kept accruing meanwhile
    const dt = this.lastT ? Math.max(0, (s.t - this.lastT) / 1000) : 1
    this.lastT = s.t
    const out = { ...s }

    // --- wind modelled from the newest real InSight sol (outside temperature comes through the simulator) ---
    const sol = mars?.data[0]
    if (sol) {
      this.wind = Math.max(0, this.wind + (sol.windAvg - this.wind) * 0.08 + gauss() * (sol.windMax - sol.windAvg) * 0.06)
      out.wind = Math.round(Math.min(60, this.wind * 3.6))
    }

    // --- radiation: GCR baseline + solar protons carried from GOES (Earth) to the Mars surface ---
    const latest = currentProtons(protons, s.t)
    const p10 = latest?.p10 ?? 0
    const rad = assessRadiation({ t: s.t, p10, p100: latest?.p100 ?? null, tail: goesTail(latest?.p500), cmes: live.cmes?.data ?? [], doseMSv: this.dose, eva: s.evaActive, noProtonData: live.ready && !latest })
    const rate = rad.rateUSvH
    this.dose += (rate / 1000 / 3600) * dt
    out.radiation = Number(this.dose.toFixed(3))

    const changed = !live.rad || live.rad.advice !== rad.advice || live.rad.cmes.length !== rad.cmes.length || live.rad.source?.id !== rad.source?.id || s.t - this.radAt >= 60_000
    if (live.ready && (changed || Math.abs(live.outsideTemp - out.outsideTemp) >= 1 || Math.abs(live.wind - out.wind) >= 1 || Math.abs(live.doseRateUSvH - rate) > 0.01)) {
      this.radAt = s.t
      set({ outsideTemp: out.outsideTemp, wind: out.wind, doseRateUSvH: rate, p10, storm: sScale(p10), rad })
    }
    return out
  }
}
