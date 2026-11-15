import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GEMINI_DEFAULT_MODEL, RATE, buildGeminiRequest, handleAssistant, isConfigured, parseRequest, rateLimited, sameOrigin } from '../api/assistant'
import { buildContext } from '../src/assistant/assistant'
import { SimulatedSource } from '../src/data/telemetrySimulator'
import { TelemetryStore } from '../src/data/store'

const KEY = { GEMINI_API_KEY: 'AIzaTestKey123' }
const ask = { messages: [{ role: 'user', text: 'How is the crew?' }], context: 'HR 72' }

function fakeFetch(status: number, body: unknown, calls: { url: string; init: RequestInit }[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

test('placeholder or empty key counts as not configured, and no request is made', async () => {
  for (const k of [undefined, '', '  ', 'your-gemini-api-key', 'PLACEHOLDER', 'xxxx']) assert.equal(isConfigured({ GEMINI_API_KEY: k }), false, String(k))
  assert.equal(isConfigured(KEY), true)
  const calls: { url: string; init: RequestInit }[] = []
  const r = await handleAssistant(ask, { GEMINI_API_KEY: 'your-gemini-api-key' }, fakeFetch(200, {}, calls))
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'not_configured')
  assert.equal(calls.length, 0)
})

test('calls Gemini generateContent with the key in a header (not the URL) and returns the text', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const r = await handleAssistant(ask, KEY, fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'All vitals are normal.' }] } }] }, calls))
  assert.equal(r.status, 200)
  assert.equal(r.body.text, 'All vitals are normal.', 'thought parts are not shown')
  assert.equal(calls[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`)
  assert.ok(!calls[0].url.includes('AIza'))
  assert.equal((calls[0].init.headers as Record<string, string>)['x-goog-api-key'], 'AIzaTestKey123')
  const sent = JSON.parse(String(calls[0].init.body))
  assert.match(sent.systemInstruction.parts[0].text, /HR 72/)
  assert.deepEqual(sent.contents, [{ role: 'user', parts: [{ text: 'How is the crew?' }] }])
})

test('GEMINI_MODEL overrides the model; unsafe values fall back to the default', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  await handleAssistant(ask, { ...KEY, GEMINI_MODEL: 'gemini-3.1-pro-preview' }, fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }, calls))
  await handleAssistant(ask, { ...KEY, GEMINI_MODEL: '../../evil?x=1' }, fakeFetch(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }, calls))
  assert.match(calls[0].url, /models\/gemini-3\.1-pro-preview:generateContent$/)
  assert.match(calls[1].url, new RegExp(`models/${GEMINI_DEFAULT_MODEL}:generateContent$`))
})

test('upstream errors map to clear messages without leaking the key', async () => {
  const cases: [number, unknown, string][] = [
    [400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, 'bad_key'],
    [403, { error: { message: 'denied' } }, 'bad_key'],
    [404, { error: { message: 'models/x is not found' } }, 'bad_model'],
    [429, { error: { message: 'quota' } }, 'rate_limited'],
    [500, {}, 'upstream'],
    [401, { error: { message: 'API key not valid.', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }] } }, 'key_type_unsupported'],
  ]
  for (const [status, body, code] of cases) {
    const r = await handleAssistant(ask, KEY, fakeFetch(status, body))
    assert.equal(r.body.error, code, String(status))
    assert.ok(!JSON.stringify(r.body).includes('AIza'))
  }
  const timeout = await handleAssistant(ask, KEY, (async () => Promise.reject(new Error('timeout'))) as unknown as typeof fetch)
  assert.equal(timeout.status, 504)
})

test('blocked or empty answers return a polite message', async () => {
  const r = await handleAssistant(ask, KEY, fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } }))
  assert.equal(r.status, 200)
  assert.equal(r.body.blocked, 'SAFETY')
  assert.ok(String(r.body.text).length > 0)
})

test('request validation', () => {
  assert.equal(typeof parseRequest(null), 'string')
  assert.equal(typeof parseRequest({ messages: [] }), 'string')
  assert.equal(typeof parseRequest({ messages: [{ role: 'system', text: 'x' }] }), 'string')
  assert.equal(typeof parseRequest({ messages: [{ role: 'user', text: 'x'.repeat(2001) }] }), 'string')
  assert.equal(typeof parseRequest({ messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }] }), 'string', 'must end with the user')
  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}` }))
  long.push({ role: 'user', text: 'last' })
  const ok = parseRequest({ messages: long, context: 'c'.repeat(10_000) })
  assert.ok(typeof ok !== 'string')
  assert.ok(ok.messages.length <= 12)
  assert.equal(ok.messages[0].role, 'user', 'history starts with the user')
  assert.equal(ok.context.length, 4000)
  const req = buildGeminiRequest([{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }, { role: 'user', text: 'q2' }], '')
  assert.deepEqual(req.contents.map((c) => c.role), ['user', 'model', 'user'])
})

test('same-origin check blocks other websites', () => {
  assert.equal(sameOrigin('https://area51.vercel.app', 'area51.vercel.app'), true)
  assert.equal(sameOrigin('https://evil.example', 'area51.vercel.app'), false)
  assert.equal(sameOrigin(null, 'area51.vercel.app'), false, 'a POST without Origin is not the dashboard')
  assert.equal(sameOrigin('https://area51.vercel.app', null), false)
  assert.equal(sameOrigin('not a url', 'x'), false)
})

test('rate limit: a client gets a few questions a minute, then is told how long to wait', () => {
  const t0 = 1_000_000
  for (let i = 0; i < RATE.perClient; i++) assert.equal(rateLimited('10.0.0.1', t0 + i), 0)
  assert.ok(rateLimited('10.0.0.1', t0 + 500) > 0)
  assert.equal(rateLimited('10.0.0.2', t0 + 500), 0, 'other clients are not affected')
  assert.equal(rateLimited('10.0.0.1', t0 + RATE.windowMs + 1000), 0, 'the window slides')
  // many addresses together still cannot exceed the shared budget
  const t1 = t0 + 10 * RATE.windowMs
  let passed = 0
  for (let i = 0; i < RATE.global + 20; i++) if (rateLimited(`172.16.0.${i}`, t1) === 0) passed++
  assert.equal(passed, RATE.global)
})

test('telemetry context summarises vitals, provenance and alerts without NaN', () => {
  const store = new TelemetryStore()
  const sim = new SimulatedSource()
  store.ingest(sim.advance(Date.UTC(2026, 10, 14, 9), false), false)
  store.ingest({ ...sim.advance(Date.UTC(2026, 10, 14, 9, 0, 1), false), heartRate: 140 }, false)
  const ctx = buildContext(store.getSnapshot(), { ready: true, storm: 'S0', p10: 0.25, doseRateUSvH: 27.2 })
  assert.match(ctx, /Heart rate: 140 bpm \(critical, simulated\)/)
  const activeLine = ctx.split('\n').find((l) => l.startsWith('Active alerts:')) ?? ''
  assert.ok(activeLine.includes('Heart rate critical (140 bpm)'), activeLine)
  assert.match(ctx, /storm level S0/)
  assert.ok(!/NaN|undefined/.test(ctx))
  assert.ok(ctx.length < 4000, 'fits the server limit')
  assert.equal(buildContext({ latest: null, statuses: store.getSnapshot().statuses, alerts: [] }), 'No telemetry received yet.')
})

// ---- built-in fallback ----------------------------------------------------------------------
import { offlineAnswer } from '../src/assistant/offline'
import { assistantStore, checkAssistant, clearConversation, sendMessage } from '../src/assistant/assistant'

function snapWith(patch: Record<string, number> = {}) {
  const store = new TelemetryStore()
  const sim = new SimulatedSource()
  store.ingest({ ...sim.advance(Date.UTC(2026, 10, 14, 9), false), heartRate: 72, spo2: 98, bodyTemp: 36.8, hydration: 70, suitPressure: 4.3 }, false)
  store.ingest({ ...sim.advance(Date.UTC(2026, 10, 14, 9, 0, 1), false), heartRate: 72, spo2: 98, bodyTemp: 36.8, hydration: 70, suitPressure: 4.3, ...patch }, false)
  return store.getSnapshot()
}

test('built-in answers: status, alert guidance, radiation, a vital, Russian keywords, help', () => {
  const calm = snapWith()
  assert.match(offlineAnswer('How is the crew doing?', calm), /All monitored vitals are in the safe range/)
  assert.match(offlineAnswer('What should I do about the current alert?', calm), /No active alerts/)
  const sick = snapWith({ heartRate: 140 })
  assert.match(offlineAnswer('what should I do', sick), /Heart rate critical \(140 bpm\): Halt the EVA task/)
  assert.match(offlineAnswer('how are we?', sick), /Attention needed: heart rate is critical/)
  assert.match(offlineAnswer('Explain the radiation dose', calm, { ready: true, storm: 'S0', p10: 0.2, doseRateUSvH: 27.2 }), /Accumulated dose is .* mSv.*storm level S0/s)
  assert.match(offlineAnswer('is my hydration ok?', calm), /^Hydration is 70.0 %/)
  assert.match(offlineAnswer('какой пульс?', calm), /^Heart rate is 72 bpm/)
  assert.match(offlineAnswer('tell me a joke', calm), /I can answer from the dashboard/)
  assert.match(offlineAnswer('status', { latest: null, statuses: calm.statuses, alerts: [] }), /No telemetry/)
  for (const q of ['status', 'alert', 'radiation', 'heart', 'hazards', 'sleep', '?']) assert.ok(!/NaN|undefined/.test(offlineAnswer(q, sick)), q)
})

test('sendMessage falls back to the built-in answer when Gemini rejects the key, and labels it', async () => {
  clearConversation()
  await checkAssistant(fakeFetch(200, { configured: true, model: 'gemini-3.8-flash' }))
  assert.equal(assistantStore.get().status, 'ready')
  await sendMessage('how is the crew?', 'ctx', () => 'RULE ANSWER', fakeFetch(502, { error: 'key_type_unsupported', message: 'Google rejected this key type.' }))
  const st = assistantStore.get()
  assert.equal(st.error, null)
  assert.equal(st.fallbackReason, 'Google rejected this key type.')
  assert.deepEqual(st.messages.at(-1), { role: 'assistant', text: 'RULE ANSWER', source: 'offline' })

  // when Gemini works again, its answer is used and the fallback note clears; canned answers are not sent to Gemini
  const calls: { url: string; init: RequestInit }[] = []
  await sendMessage('and now?', 'ctx', () => 'RULE', fakeFetch(200, { text: 'Gemini says hi' }, calls))
  const sent = JSON.parse(String(calls[0].init.body)).messages
  assert.ok(sent.every((m: { text: string }) => m.text !== 'RULE ANSWER'))
  assert.equal(assistantStore.get().messages.at(-1)?.source, 'gemini')
  assert.equal(assistantStore.get().fallbackReason, null)
})

test('sendMessage answers locally without calling the server when no key is configured or the API is unreachable', async () => {
  clearConversation()
  await checkAssistant(fakeFetch(200, { configured: false, model: 'gemini-3.8-flash' }))
  const calls: { url: string; init: RequestInit }[] = []
  await sendMessage('status', 'ctx', () => 'LOCAL', fakeFetch(200, {}, calls))
  assert.equal(calls.length, 0)
  assert.equal(assistantStore.get().messages.at(-1)?.text, 'LOCAL')
  await checkAssistant((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)
  assert.equal(assistantStore.get().status, 'unreachable')
})

test('consecutive same-role turns are merged for Gemini', () => {
  const r = parseRequest({ messages: [{ role: 'user', text: 'a' }, { role: 'user', text: 'b' }, { role: 'assistant', text: 'c' }, { role: 'user', text: 'd' }] })
  assert.ok(typeof r !== 'string')
  assert.deepEqual(r.messages.map((m) => m.role), ['user', 'assistant', 'user'])
  assert.equal(r.messages[0].text, 'a\n\nb')
})
