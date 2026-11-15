import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HISTORY, LOST_AFTER_MS, TelemetryStore } from '../src/data/store'
import { SimulatedSource } from '../src/data/telemetrySimulator'
import type { Sample, TelemetrySource } from '../src/data/types'

const base = new SimulatedSource().advance(Date.UTC(2026, 10, 14), true)
const sample = (t: number, patch: Partial<Sample> = {}): Sample => ({ ...base, heartRate: 72, spo2: 98, hydration: 70, bodyTemp: 36.8, suitPressure: 4.3, radiation: 1.2, ...patch, t })

/** a source that only records lifecycle calls and lets the test push samples */
class ManualSource implements TelemetrySource {
  static running = 0
  cb: ((s: Sample, backfill: boolean) => void) | null = null
  constructor(readonly timerDriven = false) {}
  start(cb: (s: Sample, backfill: boolean) => void) {
    ManualSource.running++
    this.cb = cb
  }
  stop() {
    if (this.cb) ManualSource.running--
    this.cb = null
  }
}

test('warning → critical → normal keeps the warning in the journal with its outcome', () => {
  const store = new TelemetryStore({ isHidden: () => false })
  const t0 = 1_000_000
  store.ingest(sample(t0), false)
  store.ingest(sample(t0 + 1000, { heartRate: 110 }), false) // warning (>105)
  store.ingest(sample(t0 + 2000, { heartRate: 135 }), false) // critical (>130)
  let s = store.getSnapshot()
  assert.equal(s.activeAlerts, 1)
  assert.equal(s.alerts.length, 2)
  const [crit, warn] = s.alerts
  assert.equal(warn.level, 'warning')
  assert.equal(warn.outcome, 'escalated')
  assert.equal(warn.resolvedAt, t0 + 2000)
  assert.equal(crit.level, 'critical')
  assert.equal(crit.previousId, warn.id)
  assert.equal(crit.resolvedAt, undefined)
  assert.equal(s.toast?.id, crit.id)

  store.ingest(sample(t0 + 3000, { heartRate: 72 }), false)
  s = store.getSnapshot()
  assert.equal(s.activeAlerts, 0)
  assert.equal(s.alerts[0].outcome, 'resolved')
  assert.equal(s.alerts[1].id, warn.id, 'ids stay stable')
  assert.deepEqual(s.events.map((e) => e.level), ['warning', 'critical', 'resolved'])
})

test('critical → warning is recorded as de-escalation, not a duplicate active alert', () => {
  const store = new TelemetryStore()
  store.ingest(sample(1000), false)
  store.ingest(sample(2000, { spo2: 88 }), false)
  store.ingest(sample(3000, { spo2: 92 }), false)
  const s = store.getSnapshot()
  assert.equal(s.activeAlerts, 1)
  assert.equal(s.alerts[1].outcome, 'de-escalated')
  assert.equal(s.alerts[0].level, 'warning')
})

test('backfill samples never raise alerts', () => {
  const store = new TelemetryStore()
  store.ingest(sample(1000, { heartRate: 150 }), true)
  assert.equal(store.getSnapshot().alerts.length, 0)
})

test('history stays aligned with times; missing values become NaN gaps; capped at HISTORY', () => {
  const store = new TelemetryStore()
  store.ingest(sample(1000), false)
  store.ingest({ ...sample(2000), heartRate: undefined as unknown as number }, false)
  let s = store.getSnapshot()
  assert.equal(s.history.heartRate.length, s.times.length)
  assert.ok(Number.isNaN(s.history.heartRate[1]))
  for (let i = 0; i < HISTORY + 30; i++) store.ingest(sample(3000 + i * 1000), true)
  s = store.getSnapshot()
  assert.equal(s.times.length, HISTORY)
  assert.equal(s.history.spo2.length, HISTORY)
})

test('StrictMode-style attach → detach → attach leaves exactly one running source; old source is ignored', () => {
  ManualSource.running = 0
  const store = new TelemetryStore()
  const first = new ManualSource()
  store.attach(first)
  const firstCb = first.cb!
  store.detach()
  const second = new ManualSource()
  store.attach(second)
  assert.equal(ManualSource.running, 1)
  firstCb(sample(5000, { heartRate: 150 }), false) // late sample from the detached source
  assert.equal(store.getSnapshot().latest, null)
  second.cb!(sample(6000), false)
  assert.equal(store.getSnapshot().latest?.t, 6000)
  store.detach()
  assert.equal(ManualSource.running, 0)
})

test('connection: timer-driven source in a hidden tab is not "lost"; a network source is', () => {
  let now = 0
  let hidden = true
  const timerStore = new TelemetryStore({ now: () => now, isHidden: () => hidden })
  const timer = new ManualSource(true)
  timerStore.attach(timer)
  timer.cb!(sample(1), false)
  now = 60_000 // a minute of browser throttling
  timerStore.checkConnection()
  assert.equal(timerStore.getSnapshot().connection, 'live')

  // tab returns: grace period before judging, then a real silence is reported
  hidden = false
  ;(timerStore as unknown as { onVisibility: () => void }).onVisibility()
  assert.equal(timerStore.getSnapshot().connection, 'live')
  now += LOST_AFTER_MS + 1
  timerStore.checkConnection()
  assert.equal(timerStore.getSnapshot().connection, 'lost')
  timer.cb!(sample(2), false)
  assert.equal(timerStore.getSnapshot().connection, 'live')
  timerStore.detach()

  now = 0
  hidden = true
  const netStore = new TelemetryStore({ now: () => now, isHidden: () => hidden })
  const net = new ManualSource(false)
  netStore.attach(net)
  net.cb!(sample(1), false)
  now = LOST_AFTER_MS + 1
  netStore.checkConnection()
  assert.equal(netStore.getSnapshot().connection, 'lost', 'background tab does not hide a dead socket')
  netStore.detach()
})
