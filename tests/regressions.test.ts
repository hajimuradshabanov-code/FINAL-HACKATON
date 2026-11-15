import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASELINE, PersonalBaseline } from '../src/science/baseline'
import { ScienceEngine } from '../src/science/engine'
import { habitatN2, ATMOSPHERES, tissueStep } from '../src/science/models'
import { assessRadiation } from '../src/science/radiation'
import { PROTON_MAX_AGE_MS, currentProtons, type Feed, type ProtonPoint } from '../src/data/nasaApi'
import { GCR_MSV_PER_SOL, SOL_S, publishNasaLive } from '../src/data/nasaSource'
import { LiveSource } from '../src/data/liveSource'
import { marsClock } from '../src/data/mars'
import { SimulatedSource } from '../src/data/telemetrySimulator'
import { passwordChecks, passwordError } from '../src/auth/auth'
import { checkinStorage } from '../src/lib/checkin'
import { assistantStore, checkAssistant, clearConversation, sendMessage } from '../src/assistant/assistant'

test('baseline: a vital that stopped arriving is not scored from its last samples', () => {
  const b = new PersonalBaseline()
  let t = 1_000_000
  for (let i = 0; i < 200; i++) b.update((t += 1000), false, { heartRate: 68 + (i % 3) - 1 })
  let r = b.update((t += 1000), false, { heartRate: 95 })
  for (let i = 0; i < 5; i++) r = b.update((t += 1000), false, { heartRate: 95 })
  assert.ok(r.heartRate.deviating, 'the jump itself is reported')
  // a minute without heart-rate data (other vitals may still arrive)
  for (let i = 0; i < 60; i++) r = b.update((t += 1000), false, { spo2: 98 })
  assert.equal(r.heartRate.deviating, false)
  assert.ok(Number.isNaN(r.heartRate.z) && Number.isNaN(r.heartRate.value), 'no value, no z')
  assert.equal(r.heartRate.forS, 0)
  // already gone a few seconds after the last sample, not only after a minute
  const c = new PersonalBaseline()
  t = 5_000_000
  for (let i = 0; i < 100; i++) c.update((t += 1000), false, { heartRate: 70 })
  assert.ok(Number.isNaN(c.update(t + (BASELINE.smoothS + 1) * 1000, false, {}).heartRate.value))
})

test('radiation: only a current GOES measurement counts; without one the advice is not "clear"', () => {
  const now = Date.UTC(2026, 10, 14, 12)
  const feed = (ageMs: number, origin: Feed<ProtonPoint[]>['origin'] = 'network'): Feed<ProtonPoint[]> => ({ data: [{ t: now - ageMs, p10: 5000, p100: 200 }], origin, fetchedAt: now, ttlMs: 240_000, refreshFailed: false })
  assert.equal(currentProtons(feed(5 * 60_000), now)?.p10, 5000)
  assert.equal(currentProtons(feed(PROTON_MAX_AGE_MS + 1), now), null, 'an old storm reading is not "now"')
  assert.equal(currentProtons(feed(0, 'fallback'), now), null, 'the bundled snapshot is not a measurement of today')
  assert.equal(currentProtons(null, now), null)

  const quiet = assessRadiation({ t: now, p10: 0, p100: null, cmes: [], doseMSv: 1, eva: false })
  const blind = assessRadiation({ t: now, p10: 0, p100: null, cmes: [], doseMSv: 1, eva: false, noProtonData: true })
  assert.equal(quiet.advice, 'go')
  assert.equal(blind.advice, 'caution')
  assert.match(blind.reasons.join(' '), /no current GOES proton measurement/)
})

test('live source: a stale proton feed does not drive the dose, and a pause does not lose dose', () => {
  const src = new LiveSource()
  // start one hour into a sol so the pause below does not cross local midnight
  let t0 = Date.UTC(2026, 10, 14, 12)
  t0 += ((1 - marsClock(t0).lmstHours + 24) % 24) * (SOL_S / 24) * 1000
  const storm: Feed<ProtonPoint[]> = { data: [{ t: t0 - 6 * 3_600_000, p10: 50_000, p100: 5000 }], origin: 'cache', fetchedAt: t0 - 6 * 3_600_000, ttlMs: 240_000, refreshFailed: true }
  publishNasaLive({ ready: true, protons: storm, cmes: null, rems: null, rad: null })
  const first = src.sample(t0).radiation
  const hourLater = src.sample(t0 + 3_600_000).radiation
  const gcrPerHour = GCR_MSV_PER_SOL / (SOL_S / 3600)
  // the tab slept for an hour: the whole hour of background dose is there (it used to count 5 s) …
  assert.ok(Math.abs(hourLater - first - gcrPerHour) < 0.002, `gained ${(hourLater - first).toFixed(4)} mSv, expected ${gcrPerHour.toFixed(4)}`)
  // … and nothing from the six-hour-old storm reading
  publishNasaLive({ ready: false, protons: null })
})

test('tissue nitrogen: a gap in the data advances the model by the real time and credits no washout', () => {
  const sim = new SimulatedSource()
  const base = sim.advance(Date.UTC(2026, 10, 14, 9), false)
  const run = (gapMs: number, eva: boolean) => {
    const e = new ScienceEngine()
    const hist = {} as never
    e.update({ ...base, evaActive: true }, [], hist)
    // 30 min in the suit, sampled every second: washout
    let t = base.t
    for (let i = 0; i < 1800; i++) e.update({ ...base, t: (t += 1000), evaActive: true }, [], hist)
    const before = e.update({ ...base, t: (t += 1000), evaActive: true }, [], hist).dcs!
    const after = e.update({ ...base, t: t + gapMs, evaActive: eva }, [], hist).dcs!
    return { before, after }
  }
  const n2 = habitatN2(ATMOSPHERES.find((a) => a.id === 'exploration')!)
  const washed = run(1000, true)
  assert.ok(washed.before.tissueN2 < n2, 'the suit washes nitrogen out')
  // one hour without samples, still flagged EVA when data returns: no O2 credit for the unseen hour
  const gap = run(3_600_000, true)
  assert.ok(gap.after.tissueN2 >= gap.before.tissueN2, 'tissue N2 is not lowered across an unobserved gap')
  assert.ok(gap.after.prebreatheMin >= gap.before.prebreatheMin, 'so the prebreathe is never shortened by it')
  // and the hour really passes: back in the habitat the tissue re-saturates by an hour, not by 5 s
  const expected = tissueStep(gap.before.tissueN2, n2, 60)
  assert.ok(Math.abs(run(3_600_000, false).after.tissueN2 - expected) < 1e-6)
})

test('sign-up: ordinary passwords are accepted whatever the email name is', () => {
  assert.equal(passwordError('regolith42', 'a@mars.example'), null, 'a one-letter email name must not ban the letter')
  assert.equal(passwordError('sunrise2026', 'su@mars.example'), null)
  assert.equal(passwordError('пароль2026', 'ava@mars.example'), null, 'letters are not only A–Z')
  assert.equal(passwordChecks('ava12345', 'ava@mars.example')[2].ok, false)
  assert.equal(passwordChecks('AVA@mars.example', 'ava@mars.example')[2].ok, false)
  assert.equal(passwordChecks('jo', 'jo@mars.example')[2].ok, false)
})

test('per-user data: check-in keys and the assistant conversation do not cross users', async () => {
  const a = checkinStorage({ email: 'ava@mars.example', guest: false, since: 1 })!
  const b = checkinStorage({ email: 'ben@mars.example', guest: false, since: 2 })!
  assert.equal(a.kind, 'localStorage')
  assert.notEqual(a.key, b.key)
  const g1 = checkinStorage({ email: '', guest: true, since: 10 })!
  const g2 = checkinStorage({ email: '', guest: true, since: 20 })!
  assert.equal(g1.kind, 'sessionStorage')
  assert.notEqual(g1.key, g2.key, 'the next guest does not see the previous guest')
  assert.equal(checkinStorage(null), null)

  // an answer that arrives after the conversation was cleared is dropped
  const fake = (body: unknown, gate?: Promise<void>) => (async () => {
    await gate
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
  clearConversation()
  await checkAssistant(fake({ configured: true, model: 'm' }))
  let release!: () => void
  const pending = sendMessage('private question', 'ctx', () => 'LOCAL', fake({ text: 'private answer' }, new Promise<void>((r) => (release = r))))
  clearConversation() // the user signed out
  release()
  await pending
  assert.deepEqual(assistantStore.get().messages, [])
  assert.equal(assistantStore.get().sending, false)
})
