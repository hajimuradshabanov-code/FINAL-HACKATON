/**
 * Fast-forwards the simulator 10 minutes through the real store, prints value ranges and alerts,
 * and exits non-zero if an invariant is broken. Run with `npm run check:sim`.
 */
import { TelemetryStore } from '../src/data/store'
import { SimulatedSource } from '../src/data/telemetrySimulator'
import type { Sample, TelemetrySource } from '../src/data/types'
import { METRIC_KEYS } from '../src/config/thresholds'

const sim = new SimulatedSource()
const all: Sample[] = []
const now = Date.now()
const src: TelemetrySource = {
  start(cb) {
    for (let i = 120; i > 0; i--) cb(sim.advance(now - i * 1000, true), true)
    for (let i = 0; i < 600; i++) {
      const s = sim.advance(now + i * 1000, false)
      all.push(s)
      cb(s, false)
    }
  },
  stop() {},
}
const store = new TelemetryStore()
store.attach(src)
const snap = store.getSnapshot()
store.detach()

const range = (k: keyof Sample) => {
  const v = all.map((s) => s[k] as number)
  return `${Math.min(...v)}..${Math.max(...v)}`
}
console.log('ticks', all.length)
for (const k of ['heartRate', 'spo2', 'hydration', 'bodyTemp', 'suitPressure', 'radiation', 'signal', 'wind', 'outsideTemp', 'roverRange', 'distanceKm', 'etaMin'] as const) console.log(k.padEnd(13), range(k))
const maxJump = (k: 'heartRate' | 'spo2') => Math.max(...all.slice(1).map((s, i) => Math.abs(s[k] - all[i][k])))
console.log('max 1s jump HR/SpO2 (anomalies included):', maxJump('heartRate'), maxJump('spo2'))
const rad = all.map((s) => s.radiation)
const radMonotonic = rad.every((v, i) => i === 0 || v >= rad[i - 1])
console.log('radiation monotonic:', radMonotonic)
console.log('alerts raised:', snap.alerts.length, 'closed:', snap.alerts.filter((a) => a.resolvedAt).length, 'events:', snap.events.length)
for (const a of snap.alerts.slice(0, 8)) console.log(' ', a.level.padEnd(8), a.key.padEnd(13), a.value, a.resolvedAt ? (a.outcome ?? 'closed') : 'active')

// ---- invariants -----------------------------------------------------------------------
const failures: string[] = []
const check = (ok: boolean, msg: string) => ok || failures.push(msg)

check(all.every((s) => METRIC_KEYS.every((k) => Number.isFinite(s[k]))), 'every metric is a finite number')
check(radMonotonic, 'radiation dose never decreases')
check(maxJump('heartRate') <= 30, 'heart rate never jumps more than 30 bpm in one second')
check(snap.alerts.length > 0, 'anomalies raise at least one alert in 10 minutes')
check(snap.alerts.filter((a) => a.resolvedAt === undefined).length === snap.activeAlerts, 'activeAlerts matches open alerts')
check(new Set(snap.alerts.filter((a) => a.resolvedAt === undefined).map((a) => a.key)).size === snap.activeAlerts, 'at most one open alert per metric')
check(snap.history.heartRate.length === snap.times.length, 'history stays aligned with times')
// ETA: while the traverse is not restarting it must never increase by more than a phase-length estimate error
for (let i = 1; i < all.length; i++) {
  const restarted = all[i].distanceKm > all[i - 1].distanceKm
  if (!restarted && all[i].etaMin > all[i - 1].etaMin + 1) {
    failures.push(`ETA rose from ${all[i - 1].etaMin} to ${all[i].etaMin} min at tick ${i}`)
    break
  }
}

if (failures.length) {
  console.error('\nFAILED:\n - ' + failures.join('\n - '))
  process.exit(1)
}
console.log('\nall simulator invariants hold')
