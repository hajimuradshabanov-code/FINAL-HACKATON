import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cached, feedFreshness, parseDonki, parseDonkiSummary, parseInsight, parseProtons, type KeyValueStore } from '../src/data/nasaApi'

// Shape of a real api.nasa.gov/DONKI/notifications body (captured 2026-11-14), trimmed.
const RBE_BODY = [
  '## Community Coordinated Modeling Center Database Of Notifications, Knowledge, Information ( CCMC DONKI )',
  '## Message Type: Space Weather Notification - Radiation Belt Enhancement',
  '##',
  '## Message Issue Date: 2026-11-01T13:28:39Z',
  '## Message ID: 20261101-AL-001',
  '##',
  '## Disclaimer: NOAA\'s Space Weather Prediction Center is the United States Government official source for space weather forecasts.',
  '',
  '',
  '## Summary:',
  '',
  'Significantly elevated energetic electron fluxes in the Earth\'s outer radiation belt. GOES "greater than 2.0 MeV" integral electron flux is above 1000 pfu starting at 2026-11-01T12:45Z. ',
  '',
  'The elevated energetic electron flux levels are caused by the arrival of a coronal hole high speed stream.',
  '',
  '## Notes: ',
  '',
  'The arrival of this coronal hole high speed stream was associated with a moderate geomagnetic storm.',
].join('\n')

test('DONKI: summary text on the lines after "## Summary:" is extracted', () => {
  const s = parseDonkiSummary(RBE_BODY, 1000)
  assert.ok(s.startsWith('Significantly elevated energetic electron fluxes'), s)
  assert.ok(s.includes('coronal hole high speed stream.'), 'second paragraph kept')
  assert.ok(!s.includes('moderate geomagnetic storm'), 'stops at the next ## heading')
  assert.ok(!s.includes('##'))
  assert.equal(s.split('\n').length, 2, 'paragraph break preserved as a newline')
})

test('DONKI: CRLF bodies and inline summary text work', () => {
  assert.equal(parseDonkiSummary('## Message Type: X\r\n## Summary: Inline text\r\nmore text\r\n## Notes:\r\nno'), 'Inline text more text')
})

test('DONKI: long summaries are clipped on a word boundary with an ellipsis', () => {
  const s = parseDonkiSummary(RBE_BODY, 80)
  assert.ok(s.length <= 80)
  assert.ok(s.endsWith('…'))
})

test('DONKI: falls back to message type, then plain text; empty/garbage gives ""', () => {
  assert.equal(parseDonkiSummary('## Message Type: Space Weather Notification - CME\n## Summary:\n\n## Notes:\nx'), 'Space Weather Notification - CME')
  assert.equal(parseDonkiSummary('just a plain body\nwith two lines'), 'just a plain body with two lines')
  assert.equal(parseDonkiSummary(''), '')
  assert.equal(parseDonkiSummary(undefined), '')
  assert.equal(parseDonkiSummary(42), '')
})

test('DONKI: response parsing sorts newest first, skips malformed entries, never leaves an empty summary', () => {
  const notes = parseDonki([
    { messageType: 'CME', messageID: 'a', messageURL: 'u1', messageIssueTime: '2026-11-01T10:00Z', messageBody: RBE_BODY },
    null,
    { messageType: 'FLR' }, // no id
    { messageType: 'IPS', messageID: 'b', messageURL: 'u2', messageIssueTime: '2026-11-03T10:00Z', messageBody: '' },
  ])
  assert.deepEqual(notes.map((n) => n.id), ['b', 'a'])
  assert.equal(notes[0].summary, 'IPS notification (no summary text)')
  assert.ok(notes[1].summary.startsWith('Significantly'))
  assert.deepEqual(parseDonki({ error: 'rate limited' }), [])
})

test('InSight: incomplete or malformed sols are skipped, newest first', () => {
  const sols = parseInsight({
    sol_keys: ['680', '681', '682'],
    '680': { AT: { mn: -96, av: -62, mx: -16 }, HWS: { av: 7, mx: 22 }, PRE: { av: 750 }, Season: 'fall', First_UTC: '2020-10-24T21:50:00Z' },
    '681': { AT: { mn: -95, av: -62, mx: -4 }, HWS: { av: 5.6, mx: 18.6 }, PRE: { av: 743 } },
    '682': { AT: { mn: null, av: -60, mx: -10 }, HWS: { av: 1, mx: 2 }, PRE: { av: 700 } },
  })
  assert.deepEqual(sols.map((s) => s.sol), [681, 680])
  assert.equal(sols[0].season, '')
  assert.deepEqual(parseInsight({ sol_keys: [] }), [])
  assert.deepEqual(parseInsight('nope'), [])
})

test('GOES: timestamps without a >=10 MeV value are dropped instead of reading as 0 pfu', () => {
  const pts = parseProtons([
    { time_tag: '2026-11-14T10:00:00Z', flux: 0.3, energy: '>=10 MeV' },
    { time_tag: '2026-11-14T10:00:00Z', flux: 0.2, energy: '>=100 MeV' },
    { time_tag: '2026-11-14T10:05:00Z', flux: 0.25, energy: '>=100 MeV' }, // newest, but p10 missing
    { time_tag: 'garbage', flux: 1, energy: '>=10 MeV' },
    { time_tag: '2026-11-14T10:10:00Z', flux: null, energy: '>=10 MeV' },
  ])
  assert.equal(pts.length, 1)
  assert.equal(pts[0].p10, 0.3)
  assert.equal(pts[0].p100, 0.2)
})

// ---- cache freshness -------------------------------------------------------------------
function memoryStorage(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init }
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) }
}
let n = 0
const uid = () => `test-${++n}`
const HOUR = 3600_000

test('cache: entry younger than TTL is served from cache and counts as fresh', async () => {
  const id = uid()
  const now = 10 * HOUR
  const storage = memoryStorage({ [`area51:${id}`]: JSON.stringify({ at: now - 2 * 60_000, data: [1] }) })
  let calls = 0
  const f = await cached(id, HOUR, async () => (calls++, [2]), [0], { storage, now: () => now })
  assert.equal(calls, 0)
  assert.deepEqual(f.data, [1])
  assert.equal(f.origin, 'cache')
  assert.equal(feedFreshness(f, now), 'fresh')
})

test('cache: expired entry triggers a fetch; success is fresh network data and is stored', async () => {
  const id = uid()
  const now = 10 * HOUR
  const storage = memoryStorage({ [`area51:${id}`]: JSON.stringify({ at: now - 2 * HOUR, data: [1] }) })
  const f = await cached(id, HOUR, async () => [2], [0], { storage, now: () => now })
  assert.deepEqual(f.data, [2])
  assert.equal(f.origin, 'network')
  assert.equal(f.fetchedAt, now)
  assert.equal(feedFreshness(f, now), 'fresh')
  assert.equal(JSON.parse(storage.data[`area51:${id}`]).at, now)
  // the same data ages into "stale" once its TTL passes
  assert.equal(feedFreshness(f, now + HOUR + 1), 'stale')
})

test('cache: expired entry + failed fetch serves the old data as stale with refreshFailed', async () => {
  const id = uid()
  const now = 10 * HOUR
  const storage = memoryStorage({ [`area51:${id}`]: JSON.stringify({ at: now - 2 * HOUR, data: [1] }) })
  const f = await cached(id, HOUR, async () => Promise.reject(new Error('offline')), [0], { storage, now: () => now })
  assert.deepEqual(f.data, [1])
  assert.equal(f.refreshFailed, true)
  assert.equal(feedFreshness(f, now), 'stale')
})

test('cache: nothing cached + failed fetch serves the bundled snapshot', async () => {
  const f = await cached(uid(), HOUR, async () => Promise.reject(new Error('offline')), ['snap'], { storage: memoryStorage(), now: () => 5 })
  assert.deepEqual(f.data, ['snap'])
  assert.equal(f.origin, 'fallback')
  assert.equal(feedFreshness(f, 5), 'snapshot')
})

test('cache: corrupted, future-dated or invalid entries are ignored; no storage at all still works', async () => {
  const now = 10 * HOUR
  for (const raw of ['{not json', JSON.stringify({ at: now + HOUR, data: [1] }), JSON.stringify({ at: now, data: 'x' }), JSON.stringify({ data: [1] })]) {
    const id = uid()
    const f = await cached(id, HOUR, async () => [9], [0], { storage: memoryStorage({ [`area51:${id}`]: raw }), now: () => now, isValid: Array.isArray })
    assert.equal(f.origin, 'network', raw)
  }
  const f = await cached(uid(), HOUR, async () => [9], [0], { storage: null })
  assert.equal(f.origin, 'network')
})

test('cache: after a failure the endpoint is not retried until the back-off passes', async () => {
  const id = uid()
  let now = 10 * HOUR
  const storage = memoryStorage()
  let calls = 0
  const failing = async () => {
    calls++
    throw new Error('CORS')
  }
  const opts = { storage, now: () => now, retryAfterFailureMs: 15 * 60_000 }
  assert.equal((await cached(id, HOUR, failing, ['snap'], opts)).origin, 'fallback')
  now += 5 * 60_000
  const second = await cached(id, HOUR, failing, ['snap'], opts)
  assert.equal(calls, 1, 'no request inside the back-off window')
  assert.equal(second.refreshFailed, true)
  now += 11 * 60_000
  const third = await cached(id, HOUR, async () => (calls++, ['live']), ['snap'], opts)
  assert.equal(calls, 2)
  assert.equal(third.origin, 'network')
})

test('cache: concurrent calls for one id share a single request', async () => {
  const id = uid()
  let calls = 0
  const load = async () => {
    calls++
    await new Promise((r) => setTimeout(r, 10))
    return [1]
  }
  const [a, b] = await Promise.all([cached(id, HOUR, load, [0], { storage: memoryStorage() }), cached(id, HOUR, load, [0], { storage: memoryStorage() })])
  assert.equal(calls, 1)
  assert.equal(a, b)
})
