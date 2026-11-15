import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuthError, createAuth, emailError, nameError, passwordChecks, passwordError, type KV } from '../src/auth/auth'

function mem(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}
// low iteration count keeps the suite fast; production uses 150k
const make = (local = mem(), session = mem(), now = () => 1_000) => ({ local, session, a: createAuth({ local, session, now, iterations: 1000 }) })
const user = { name: 'Ava Vasquez', email: 'Ava@Mars.example', password: 'regolith42', role: 'Commander' as const }

test('validation messages', () => {
  assert.equal(emailError(''), 'Enter your email address.')
  assert.ok(emailError('ava@mars'))
  assert.equal(emailError(' ava@mars.example '), null)
  assert.ok(nameError(' '))
  assert.ok(nameError('A'))
  assert.equal(nameError('Ava'), null)
  assert.deepEqual(passwordChecks('short1').map((c) => c.ok), [false, true, true])
  assert.deepEqual(passwordChecks('longenough').map((c) => c.ok), [true, false, true])
  assert.equal(passwordChecks('ava12345', 'ava@mars.example')[2].ok, false, 'must not contain the email name')
  assert.equal(passwordError('regolith42', 'ava@mars.example'), null)
})

test('sign up stores a hashed password, normalises the email and starts a session', async () => {
  const { a, local } = make()
  const s = await a.signUp(user)
  assert.equal(s.email, 'ava@mars.example')
  assert.equal(a.getSession()?.name, 'Ava Vasquez')
  const stored = local.data.get('area51.users.v1')!
  assert.ok(!stored.includes('regolith42'), 'plain password never stored')
  assert.match(JSON.parse(stored)[0].hash, /^[A-Za-z0-9+/=]{40,}$/)
})

test('duplicate email (any case) is rejected', async () => {
  const { a } = make()
  await a.signUp(user)
  await assert.rejects(a.signUp({ ...user, email: 'AVA@mars.example' }), (e: unknown) => e instanceof AuthError && e.code === 'exists' && e.field === 'email')
})

test('sign in: right password works, wrong password and unknown email give the same message', async () => {
  const { a, local, session } = make()
  await a.signUp(user)
  a.signOut()
  assert.equal(a.getSession(), null)
  const wrong = await a.signIn({ email: user.email, password: 'nope12345' }).catch((e: AuthError) => e.message)
  const unknown = await a.signIn({ email: 'x@y.example', password: 'nope12345' }).catch((e: AuthError) => e.message)
  assert.equal(wrong, 'Email or password is incorrect.')
  assert.equal(unknown, wrong)
  await a.signIn({ email: '  ava@MARS.example ', password: user.password, remember: false })
  assert.equal(a.getSession()?.role, 'Commander')
  assert.ok(session.data.has('area51.session.v1'), 'not remembered → session storage')
  assert.ok(!local.data.has('area51.session.v1'))
})

test('remembered session survives a reload; corrupted session or user data does not crash', async () => {
  const local = mem()
  const { a } = make(local)
  await a.signUp(user)
  const reloaded = createAuth({ local, session: mem(), iterations: 1000 })
  assert.equal(reloaded.getSession()?.email, 'ava@mars.example')

  const broken = mem()
  broken.setItem('area51.session.v1', '{oops')
  broken.setItem('area51.users.v1', '{"not":"an array"}')
  const b = createAuth({ local: broken, session: mem(), iterations: 1000 })
  assert.equal(b.getSession(), null)
  await assert.rejects(b.signIn({ email: user.email, password: user.password }), (e: unknown) => e instanceof AuthError && e.code === 'credentials')
})

test('commit:false verifies without starting a session until beginSession', async () => {
  const { a } = make()
  const s = await a.signUp({ ...user, commit: false })
  assert.equal(a.getSession(), null)
  let notified = 0
  a.subscribe(() => notified++)
  a.beginSession(s)
  assert.equal(a.getSession()?.email, s.email)
  assert.equal(notified, 1)
})

test('five failed attempts lock sign-in for 30 s', async () => {
  let now = 0
  const { a } = make(mem(), mem(), () => now)
  await a.signUp(user)
  for (let i = 0; i < 5; i++) await a.signIn({ email: user.email, password: 'wrong1234' }).catch(() => {})
  await assert.rejects(a.signIn({ email: user.email, password: user.password }), (e: unknown) => e instanceof AuthError && e.code === 'locked')
  now += 31_000
  await a.signIn({ email: user.email, password: user.password })
  assert.ok(a.getSession())
})

test('guest session and sign out', () => {
  const { a } = make()
  const g = a.continueAsGuest()
  assert.equal(g.guest, true)
  a.signOut()
  assert.equal(a.getSession(), null)
})

test('no storage: sign up reports a clear error instead of pretending to save', async () => {
  const a = createAuth({ local: null, session: null, iterations: 1000 })
  await assert.rejects(a.signUp(user), (e: unknown) => e instanceof AuthError && e.code === 'storage')
})

// ---- crew roster --------------------------------------------------------------------------
test('crew starts empty; signing up adds only that person', async () => {
  const { a } = make()
  assert.equal(a.getCrew().length, 0)
  await a.signUp(user)
  assert.deepEqual(a.getCrew().map((m) => [m.email, m.name, m.role]), [['ava@mars.example', 'Ava Vasquez', 'Commander']])
})

test('signing in again does not duplicate; lastSeen updates; sign out keeps the member', async () => {
  let now = 1_000
  const { a } = make(mem(), mem(), () => now)
  await a.signUp(user)
  const before = a.getCrew()
  a.signOut()
  assert.equal(a.getCrew().length, 1, 'signing out does not remove you from the crew')
  now = 90_000
  await a.signIn({ email: user.email, password: user.password })
  assert.equal(a.getCrew().length, 1)
  assert.equal(a.getCrew()[0].joinedAt, 1_000)
  assert.equal(a.getCrew()[0].lastSeen, 90_000)
  assert.notEqual(a.getCrew(), before, 'new array reference so React re-renders')
})

test('a second person joins the same roster; guests never join', async () => {
  const local = mem()
  const { a } = make(local)
  await a.signUp(user)
  a.signOut()
  a.continueAsGuest()
  assert.equal(a.getCrew().length, 1)
  a.signOut()
  await a.signUp({ name: 'Kenji Tanaka', email: 'kenji@mars.example', password: 'dustdevil7', role: 'Pilot' })
  assert.deepEqual(a.getCrew().map((m) => m.name), ['Ava Vasquez', 'Kenji Tanaka'])
  // persisted for the next page load
  const reloaded = createAuth({ local, session: mem(), iterations: 1000 })
  assert.equal(reloaded.getCrew().length, 2)
})

test('getCrew is referentially stable between changes (safe for useSyncExternalStore)', async () => {
  const { a } = make()
  await a.signUp(user)
  assert.equal(a.getCrew(), a.getCrew())
})

test('someone already signed in before the roster existed is added on load; corrupted roster is ignored', () => {
  const local = mem()
  local.setItem('area51.session.v1', JSON.stringify({ email: 'ava@mars.example', name: 'Ava', role: 'Commander', guest: false, since: 1 }))
  local.setItem('area51.crew.v1', '{broken')
  const a = createAuth({ local, session: mem(), iterations: 1000 })
  assert.deepEqual(a.getCrew().map((m) => m.email), ['ava@mars.example'])
  local.setItem('area51.crew.v1', JSON.stringify([{ email: 'x@y.z', name: 'X', role: 'Wizard', joinedAt: 1, lastSeen: 1 }, 'junk']))
  local.removeItem('area51.session.v1')
  assert.equal(createAuth({ local, session: mem(), iterations: 1000 }).getCrew().length, 0)
})
