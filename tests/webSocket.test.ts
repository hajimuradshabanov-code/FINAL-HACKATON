import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketSource, mergeFrame } from '../src/data/webSocketSource'
import type { Sample } from '../src/data/types'

test('UTC advances across consecutive frames that carry no utc / timestamp', () => {
  let last: Sample | null = null
  const utcs: string[] = []
  for (let i = 0; i < 4; i++) {
    const s = mergeFrame(last, { heartRate: 70 + i }, Date.UTC(2026, 10, 14, 8, 25, i))
    assert.ok(s)
    utcs.push(s.utc)
    last = s
  }
  assert.deepEqual(utcs, ['08:25:00', '08:25:01', '08:25:02', '08:25:03'])
})

test('frame timestamps win over receive time; utc follows the frame, not the previous frame', () => {
  const a = mergeFrame(null, { timestamp: '2026-11-14T08:25:03.000Z', heartRate: 72 }, 0)!
  assert.equal(a.utc, '08:25:03')
  const b = mergeFrame(a, { iso: '2026-11-14T08:25:09Z' }, 0)!
  assert.equal(b.utc, '08:25:09')
  assert.equal(b.t, Date.parse('2026-11-14T08:25:09Z'))
  const c = mergeFrame(b, { t: Date.parse('2026-11-14T08:26:00Z') }, 0)!
  assert.equal(c.utc, '08:26:00')
  const d = mergeFrame(c, { utc: '12:00:00' }, Date.parse('2026-11-14T08:27:00Z'))!
  assert.equal(d.utc, '12:00:00', 'an explicit utc in this frame is respected')
  const e = mergeFrame(d, {}, Date.parse('2026-11-14T08:28:00Z'))!
  assert.equal(e.utc, '08:28:00', 'but it is not inherited by the next frame')
})

test('invalid timestamps fall back to receive time; zone-less ISO is read as UTC', () => {
  const recv = Date.parse('2026-11-14T09:00:00Z')
  for (const bad of ['garbage', '', 12, -5, NaN, null]) {
    assert.equal(mergeFrame(null, { timestamp: bad }, recv)!.t, recv, String(bad))
  }
  assert.equal(mergeFrame(null, { timestamp: '2026-11-14T08:25:03' }, 0)!.utc, '08:25:03')
  assert.equal(mergeFrame(null, { timestamp: '2026-11-14T12:25:03+04:00' }, 0)!.utc, '08:25:03')
})

test('partial frames keep previous values; first-frame gaps are NaN, not 0; garbage is rejected', () => {
  const a = mergeFrame(null, { heartRate: 72, evaActive: true }, 1e12 + 1)!
  assert.equal(a.heartRate, 72)
  assert.ok(Number.isNaN(a.spo2))
  const b = mergeFrame(a, { spo2: 97, heartRate: 'x' }, 1e12 + 2)!
  assert.equal(b.heartRate, 72)
  assert.equal(b.spo2, 97)
  assert.equal(b.evaActive, true)
  assert.equal(b.provenance?.heartRate, 'reported')
  assert.equal(mergeFrame(a, 'text', 0), null)
  assert.equal(mergeFrame(a, [1, 2], 0), null)
  assert.equal(mergeFrame(a, null, 0), null)
})

// ---- socket lifecycle with a fake WebSocket ------------------------------------------------
class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
}

test('WebSocketSource: messages flow, stop() prevents reconnects and late messages', async (t) => {
  const g = globalThis as { WebSocket?: unknown }
  const orig = g.WebSocket
  g.WebSocket = FakeSocket
  t.after(() => void (g.WebSocket = orig))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  FakeSocket.all = []

  const got: Sample[] = []
  const src = new WebSocketSource('ws://test')
  src.start((s) => got.push(s))
  assert.equal(FakeSocket.all.length, 1)
  FakeSocket.all[0].onmessage?.({ data: JSON.stringify({ heartRate: 80 }) })
  FakeSocket.all[0].onmessage?.({ data: '{broken' })
  assert.equal(got.length, 1)

  // unexpected close → reconnect after backoff
  FakeSocket.all[0].close()
  t.mock.timers.tick(1000)
  assert.equal(FakeSocket.all.length, 2)

  src.stop()
  FakeSocket.all[1].onmessage?.({ data: JSON.stringify({ heartRate: 90 }) })
  t.mock.timers.tick(60_000)
  assert.equal(FakeSocket.all.length, 2, 'no reconnect after stop')
  assert.equal(got.length, 1, 'no samples after stop')
})
