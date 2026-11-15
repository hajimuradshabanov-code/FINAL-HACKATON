import { METRIC_KEYS, type MetricKey } from '../config/thresholds'
import type { DataOrigin, Provenance, Sample, TelemetrySource } from './types'
import { currentProtons, fetchCmes, fetchDonki, fetchOsdr, fetchProtons, sScale } from './nasaApi'
import { GCR_MSV_PER_SOL, nasaLive, publishNasaLive } from './nasaSource'
import { fetchRems, marsClock, modelAirTemp } from './mars'
import { assessRadiation } from '../science/radiation'

/**
 * Live telemetry: only what NASA and NOAA are publishing now, computed for the Mars surface at
 * Gale crater. Nothing is generated. This build has no instrument on the person or the suit, so
 * every body and suit quantity is NaN, which the dashboard renders as "—" with the tag NO SENSOR.
 *
 *   outside temperature       REMS (Curiosity) min/max of the newest sol, placed on the real local
 *                             solar time at Gale crater                       (modelled)
 *   radiation dose            MSL-RAD background + GOES protons carried to Mars, accumulated over
 *                             the current sol                                 (modelled)
 *   everything else           no instrument is connected, so no value         (none)
 */

export const LIVE_TICK_MS = 1000

const NONE: Provenance = Object.fromEntries(METRIC_KEYS.map((k) => [k, 'none']))

export interface LiveEnvironment {
  /** °C at the site now, NaN when no weather report is loaded */
  outsideTemp: number
  /** dose accumulated this sol, mSv */
  doseMSv: number
}

/** Build one sample for time `t`. Pure. */
export function buildLiveSample(t: number, env: LiveEnvironment): Sample {
  const iso = new Date(t).toISOString()
  const provenance: Provenance = { ...NONE }
  const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, NaN])) as Record<MetricKey, number>
  const put = (k: MetricKey, v: number, origin: DataOrigin, decimals: number) => {
    if (!Number.isFinite(v)) return
    values[k] = Number(v.toFixed(decimals))
    provenance[k] = origin
  }
  put('outsideTemp', env.outsideTemp, 'modelled', 0)
  put('radiation', env.doseMSv, 'modelled', 3)

  return {
    ...values,
    t,
    iso,
    utc: iso.slice(11, 19),
    sol: marsClock(t).sol,
    distanceKm: NaN,
    etaMin: NaN,
    progress: 0,
    evaActive: false,
    anomaly: null,
    provenance,
  }
}

/** Fraction of the current sol that has passed at the site (0 at local midnight). */
export const solFraction = (t: number) => marsClock(t).lmstHours / 24

export class LiveSource implements TelemetrySource {
  readonly timerDriven = true
  private timers: ReturnType<typeof setInterval>[] = []
  private running = false
  private dose = 0
  private doseSol = -1
  private lastT = 0
  private publishedAt = 0

  start(onSample: (s: Sample, backfill: boolean) => void) {
    this.stop()
    this.running = true
    void Promise.all([fetchRems(), fetchProtons(), fetchDonki(), fetchOsdr(), fetchCmes()]).then(([rems, protons, donki, osdr, cmes]) => {
      if (this.running) publishNasaLive({ rems, protons, donki, osdr, cmes, ready: true })
    })
    this.timers.push(
      setInterval(() => void fetchProtons().then((protons) => this.running && publishNasaLive({ protons })), 5 * 60_000),
      setInterval(() => void fetchRems().then((rems) => this.running && publishNasaLive({ rems })), 60 * 60_000),
    )
    this.doseSol = -1
    this.lastT = 0
    const tick = () => onSample(this.sample(Date.now()), false)
    tick()
    this.timers.push(setInterval(tick, LIVE_TICK_MS))
  }

  stop() {
    this.running = false
    this.timers.forEach(clearInterval)
    this.timers = []
  }

  /** Public so tests can step the source without timers. */
  sample(t: number): Sample {
    const live = nasaLive.get()
    const clock = marsClock(t)
    const report = live.rems?.data[0]
    const outsideTemp = report ? modelAirTemp(report, clock.lmstHours) : NaN

    // dose of the current sol: the background accrued since local midnight, then the modelled rate
    if (clock.sol !== this.doseSol) {
      this.doseSol = clock.sol
      this.dose = GCR_MSV_PER_SOL * (clock.lmstHours / 24)
      this.lastT = t
    }
    // only a current measurement may drive the dose and the advice; an old one is "no data"
    const latest = currentProtons(live.protons, t)
    const p10 = latest?.p10 ?? 0
    const rad = assessRadiation({ t, p10, p100: latest?.p100 ?? null, cmes: live.cmes?.data ?? [], doseMSv: this.dose, eva: false, noProtonData: live.ready && !latest })
    // the whole time since the last sample counts: timers are throttled in background tabs and
    // stop during sleep, and that time was still spent in the radiation field
    const dt = Math.max(0, (t - this.lastT) / 1000)
    this.lastT = t
    this.dose += (rad.rateUSvH / 1000 / 3600) * dt

    const temp = Number.isFinite(outsideTemp) ? Math.round(outsideTemp) : NaN
    const changed = !live.rad || live.rad.advice !== rad.advice || live.rad.cmes.length !== rad.cmes.length || live.rad.source?.id !== rad.source?.id || t - this.publishedAt >= 60_000
    if (live.ready && (changed || live.outsideTemp !== temp || Math.abs(live.doseRateUSvH - rad.rateUSvH) > 0.01)) {
      this.publishedAt = t
      publishNasaLive({ outsideTemp: temp, wind: NaN, doseRateUSvH: rad.rateUSvH, p10, storm: sScale(p10), rad })
    }
    return buildLiveSample(t, { outsideTemp, doseMSv: this.dose })
  }
}
