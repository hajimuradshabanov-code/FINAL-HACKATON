import { METRICS, METRIC_KEYS, STATUS_RANK, VITAL_KEYS, statusOf, type MetricKey, type Status } from '../config/thresholds'
import type { Alert, Connection, Sample, TelemetrySource, TimelineEvent } from './types'
import { EMPTY_SCIENCE, ScienceEngine, habitatSetting, type ScienceState } from '../science/engine'
import { recordStep, type TrailStep } from '../lib/footprints'

/** max samples kept per metric */
export const HISTORY = 120
/** time span the timeline shows */
export const HISTORY_WINDOW_MS = 120_000
export const LOST_AFTER_MS = 3000
const MAX_ALERTS = 60
const EVENT_WINDOW_MS = 30 * 60_000
const MAX_EVENTS = 80

export interface Snapshot {
  latest: Sample | null
  /**
   * Per-metric values aligned index-for-index with `times`. A metric missing from a sample is
   * stored as NaN so gaps stay gaps instead of shifting later values in time.
   */
  history: Record<MetricKey, number[]>
  times: number[]
  statuses: Record<MetricKey, Status>
  /** journal: newest first; the open alert for a metric has no `resolvedAt` */
  alerts: Alert[]
  events: TimelineEvent[]
  toast: Alert | null
  connection: Connection
  activeAlerts: number
  /** outputs of the physiological / mission models (src/science) */
  science: ScienceState
  /** the walked part of the traverse, one footprint per stretch (src/lib/footprints.ts) */
  trail: readonly TrailStep[]
}

const emptyHistory = () => Object.fromEntries(METRIC_KEYS.map((k) => [k, [] as number[]])) as Record<MetricKey, number[]>
const normalStatuses = () => Object.fromEntries(METRIC_KEYS.map((k) => [k, 'normal'])) as Record<MetricKey, Status>

function initial(): Snapshot {
  return { latest: null, history: emptyHistory(), times: [], statuses: normalStatuses(), alerts: [], events: [], toast: null, connection: 'connecting', activeAlerts: 0, science: EMPTY_SCIENCE, trail: [] }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Keep every open alert, then fill up with the newest closed ones. Order (newest first) is preserved. */
function trimAlerts(alerts: Alert[]): Alert[] {
  if (alerts.length <= MAX_ALERTS) return alerts
  const open = alerts.filter((a) => a.resolvedAt === undefined).length
  let closedRoom = Math.max(0, MAX_ALERTS - open)
  return alerts.filter((a) => a.resolvedAt === undefined || closedRoom-- > 0)
}

export interface StoreOptions {
  now?: () => number
  /** whether the page is currently hidden (background tab) */
  isHidden?: () => boolean
}

const browserHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/** One shared telemetry stream. React subscribes through useSyncExternalStore. */
export class TelemetryStore {
  private snap: Snapshot = initial()
  private listeners = new Set<() => void>()
  private source: TelemetrySource | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastArrival = 0
  /** start of the current grace period after the page became visible again */
  private resumedAt = 0
  private seq = 1
  private science = new ScienceEngine()
  private unsubHabitat: (() => void) | null = null
  private now: () => number
  private isHidden: () => boolean

  constructor(opts: StoreOptions = {}) {
    this.now = opts.now ?? Date.now
    this.isHidden = opts.isHidden ?? browserHidden
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getSnapshot = () => this.snap

  /** Whose telemetry this is: selects the stored personal baseline (crew member id, null for none). */
  setSubject(id: string | null) {
    this.science.setSubject(id)
  }
  get attached() {
    return this.source !== null
  }

  private emit(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((l) => l())
  }

  private onVisibility = () => {
    if (!this.isHidden()) {
      this.resumedAt = this.now()
      this.checkConnection()
    }
  }

  attach(source: TelemetrySource) {
    this.detach()
    this.snap = initial()
    this.science.reset()
    this.listeners.forEach((l) => l())
    this.source = source
    // a new habitat atmosphere re-equilibrates the tissue model on the next sample
    this.unsubHabitat = habitatSetting.subscribe(() => this.snap.latest && this.ingest(this.snap.latest, true, true))
    this.lastArrival = this.now()
    this.resumedAt = 0
    // samples from a source that has since been detached are ignored
    source.start((s, backfill) => {
      if (this.source === source) this.ingest(s, backfill)
    })
    this.watchdog = setInterval(() => this.checkConnection(), 500)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility)
  }

  detach() {
    this.source?.stop()
    this.source = null
    this.unsubHabitat?.()
    this.unsubHabitat = null
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
  }

  /**
   * Decide whether the link is lost. Timer-driven sources are throttled by the browser while the
   * tab is hidden, so silence from them in the background (and for a short grace period after the
   * tab returns) is scheduling, not signal loss. Network sources are judged by arrival time only.
   */
  checkConnection() {
    const src = this.source
    if (!src) return
    const now = this.now()
    let lost: boolean
    if (src.timerDriven) {
      if (this.isHidden()) return
      lost = now - Math.max(this.lastArrival, this.resumedAt) > LOST_AFTER_MS
    } else {
      lost = now - this.lastArrival > LOST_AFTER_MS
    }
    const next: Connection = lost ? 'lost' : this.snap.connection === 'lost' ? 'live' : this.snap.connection
    if (next !== this.snap.connection) this.emit({ connection: next })
  }

  triggerAnomaly() {
    this.source?.triggerAnomaly?.()
  }

  dismissToast() {
    if (this.snap.toast) this.emit({ toast: null })
  }

  /** Feed one sample in directly (used by sources through `attach`, and by tests). */
  ingest(s: Sample, backfill: boolean, recomputeOnly = false) {
    if (!isNum(s.t)) return
    const prev = this.snap
    if (recomputeOnly) {
      this.emit({ science: this.science.update(s, prev.times, prev.history) })
      return
    }
    if (!backfill) this.lastArrival = this.now()

    const trim = <T,>(arr: T[], v: T) => (arr.length >= HISTORY ? arr.slice(1 - HISTORY) : arr).concat(v)
    const history = { ...prev.history }
    for (const k of METRIC_KEYS) history[k] = trim(prev.history[k], isNum(s[k]) ? s[k] : NaN)
    const times = trim(prev.times, s.t)

    const statuses = { ...prev.statuses }
    let alerts = prev.alerts
    let events = prev.events
    let toast = prev.toast

    // a metric with no value has no status: a reading that stopped arriving must not stay "critical"
    for (const k of METRIC_KEYS) statuses[k] = isNum(s[k]) ? statusOf(k, s[k]) : 'normal'

    if (!backfill) {
      for (const k of VITAL_KEYS) {
        const now = statuses[k]
        const before = prev.statuses[k]
        if (now === before) continue
        const open = alerts.find((a) => a.key === k && a.resolvedAt === undefined)
        if (now === 'normal') {
          if (open) {
            const lost = !isNum(s[k])
            alerts = alerts.map((a) => (a === open ? { ...a, resolvedAt: s.t, outcome: lost ? ('lost' as const) : ('resolved' as const) } : a))
            events = [...events, { id: this.seq++, t: s.t, key: k, level: 'resolved', label: lost ? `${METRICS[k].label}: reading lost` : `${METRICS[k].label} back to normal` }]
          }
        } else {
          // new alert, or escalation / de-escalation: the previous alert stays in the journal, closed
          let previousId: number | undefined
          if (open) {
            const outcome = STATUS_RANK[now] > STATUS_RANK[open.level] ? ('escalated' as const) : ('de-escalated' as const)
            alerts = alerts.map((a) => (a === open ? { ...a, resolvedAt: s.t, outcome } : a))
            previousId = open.id
          }
          const alert: Alert = { id: this.seq++, key: k, level: now, value: s[k], t: s.t, ...(previousId !== undefined ? { previousId } : {}) }
          alerts = trimAlerts([alert, ...alerts])
          events = [...events, { id: this.seq++, t: s.t, key: k, level: now, label: `${METRICS[k].label} ${open ? `${now} (${STATUS_RANK[now] > STATUS_RANK[open.level] ? 'escalated' : 'eased'})` : now}` }]
          if (now === 'critical') toast = alert
        }
      }
      events = events.filter((e) => e.t > s.t - EVENT_WINDOW_MS).slice(-MAX_EVENTS)
    }

    // footprints: where on the route the crew member was, and how the body was doing there
    const worstVital = VITAL_KEYS.reduce<Status>((w, k) => (STATUS_RANK[statuses[k]] > STATUS_RANK[w] ? statuses[k] : w), 'normal')
    const trail = isNum(s.distanceKm) && isNum(s.progress) ? recordStep(prev.trail, s.progress, s.t, worstVital, s.heartRate) : prev.trail

    const connection: Connection = backfill ? prev.connection : 'live'
    this.emit({
      latest: s,
      history,
      times,
      statuses,
      alerts,
      events,
      toast,
      connection,
      activeAlerts: alerts.filter((a) => a.resolvedAt === undefined).length,
      science: this.science.update(s, times, history),
      trail,
    })
  }
}
