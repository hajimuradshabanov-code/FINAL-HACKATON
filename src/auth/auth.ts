/**
 * Demo authentication that lives entirely in this browser.
 *
 * There is no server: accounts are kept in localStorage with PBKDF2-SHA-256 password hashes, and
 * the session sits in localStorage ("keep me signed in") or sessionStorage. This is good enough to
 * personalise a demo, NOT real security — anyone with access to the browser can read or replace the
 * stored data. Swap `createAuth` for a backend client before handling real accounts.
 */

export const CREW_ROLES = ['Commander', 'Pilot', 'Mission specialist', 'Flight surgeon', 'Ground control'] as const
export type CrewRole = (typeof CREW_ROLES)[number]

export interface Session {
  email: string
  name: string
  role: CrewRole | 'Guest'
  guest: boolean
  since: number
}

interface Account {
  email: string
  name: string
  role: CrewRole
  salt: string
  hash: string
  iterations: number
  createdAt: number
}

export type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** A member of the crew roster: everyone who has signed in on this device (guests excluded). */
export interface CrewMember {
  email: string
  name: string
  role: CrewRole
  joinedAt: number
  lastSeen: number
}

const USERS_KEY = 'area51.users.v1'
const SESSION_KEY = 'area51.session.v1'
const CREW_KEY = 'area51.crew.v1'
const ITERATIONS = 150_000

// ---- validation (pure, shared by the forms and the service) ---------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const normalizeEmail = (e: string) => e.trim().toLowerCase()

export function emailError(email: string): string | null {
  const e = email.trim()
  if (!e) return 'Enter your email address.'
  if (!EMAIL_RE.test(e) || e.length > 254) return 'Enter an email like name@example.com.'
  return null
}

export function nameError(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Enter your name.'
  if (n.length < 2) return 'Use at least 2 characters.'
  if (n.length > 60) return 'Use 60 characters or fewer.'
  return null
}

export interface PasswordCheck {
  id: 'length' | 'mix' | 'notEmail'
  label: string
  ok: boolean
}

export function passwordChecks(password: string, email = ''): PasswordCheck[] {
  const address = normalizeEmail(email)
  const local = address.split('@')[0]
  const pw = password.toLowerCase()
  // "contains the email name" is only meaningful for a name of some length: with a one- or
  // two-letter name (a@…, jo@…) it rejected every ordinary password containing those letters
  const usesEmail = !!local && (pw === address || pw === local || (local.length >= 3 && pw.includes(local)))
  return [
    { id: 'length', label: 'At least 8 characters', ok: password.length >= 8 },
    { id: 'mix', label: 'Letters and at least one number', ok: /\p{L}/u.test(password) && /\d/.test(password) },
    { id: 'notEmail', label: 'Not based on your email name', ok: password.length > 0 && !usesEmail },
  ]
}

export function passwordError(password: string, email = ''): string | null {
  if (!password) return 'Create a password.'
  if (password.length > 128) return 'Use 128 characters or fewer.'
  const failed = passwordChecks(password, email).find((c) => !c.ok)
  return failed ? `Password needs: ${failed.label.toLowerCase()}.` : null
}

// ---- crypto helpers -------------------------------------------------------------------------
const toB64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new AuthError('unsupported', 'This browser blocks secure sign-in on this address. Open the app over https or on localhost.')
  return s
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)
  return toB64(bits)
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export class AuthError extends Error {
  constructor(
    readonly code: 'exists' | 'invalid' | 'credentials' | 'unsupported' | 'storage' | 'locked',
    message: string,
    readonly field?: 'name' | 'email' | 'password',
  ) {
    super(message)
  }
}

// ---- service --------------------------------------------------------------------------------
export interface AuthOptions {
  local: KV | null
  session: KV | null
  now?: () => number
  iterations?: number
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function readAccounts(kv: KV | null): Account[] {
  try {
    const raw: unknown = JSON.parse(kv?.getItem(USERS_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (a): a is Account =>
        isObj(a) && typeof a.email === 'string' && typeof a.name === 'string' && typeof a.salt === 'string' && typeof a.hash === 'string' && typeof a.iterations === 'number' && (CREW_ROLES as readonly unknown[]).includes(a.role),
    )
  } catch {
    return []
  }
}

function readSession(kv: KV | null): Session | null {
  try {
    const s: unknown = JSON.parse(kv?.getItem(SESSION_KEY) ?? 'null')
    if (isObj(s) && typeof s.email === 'string' && typeof s.name === 'string' && typeof s.role === 'string' && typeof s.since === 'number') {
      return { email: s.email, name: s.name, role: s.role as Session['role'], guest: s.guest === true, since: s.since }
    }
  } catch {
    /* corrupted session: treat as signed out */
  }
  return null
}

function readCrew(kv: KV | null): CrewMember[] {
  try {
    const raw: unknown = JSON.parse(kv?.getItem(CREW_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    return raw.filter((m): m is CrewMember => {
      const ok = isObj(m) && typeof m.email === 'string' && !!m.email && typeof m.name === 'string' && (CREW_ROLES as readonly unknown[]).includes(m.role) && typeof m.joinedAt === 'number' && typeof m.lastSeen === 'number' && !seen.has(m.email)
      if (ok) seen.add(m.email as string)
      return ok
    })
  } catch {
    return []
  }
}

export function createAuth({ local, session, now = Date.now, iterations = ITERATIONS }: AuthOptions) {
  let current: Session | null = readSession(session) ?? readSession(local)
  // the roster starts empty and only grows when someone signs in on this device
  let crew: CrewMember[] = readCrew(local)
  const listeners = new Set<() => void>()
  let failures = 0
  let lockedUntil = 0

  const emit = () => listeners.forEach((l) => l())

  /** Add the signed-in person to the roster, or refresh their name / role / last seen. Guests never join. */
  function joinCrew(s: Session) {
    if (s.guest || !s.email || !(CREW_ROLES as readonly string[]).includes(s.role)) return
    const t = now()
    const existing = crew.find((m) => m.email === s.email)
    const member: CrewMember = { email: s.email, name: s.name, role: s.role as CrewRole, joinedAt: existing?.joinedAt ?? t, lastSeen: t }
    crew = existing ? crew.map((m) => (m.email === s.email ? member : m)) : [...crew, member]
    try {
      local?.setItem(CREW_KEY, JSON.stringify(crew))
    } catch {
      /* storage blocked: roster kept for this page view */
    }
  }

  // someone already signed in from before the roster existed is added right away
  if (current && !current.guest && !crew.some((m) => m.email === current!.email)) joinCrew(current)

  function persistSession(s: Session, remember: boolean) {
    try {
      ;(remember ? session : local)?.removeItem(SESSION_KEY)
      ;(remember ? local : session)?.setItem(SESSION_KEY, JSON.stringify(s))
    } catch {
      /* storage blocked: the session still works for this page view */
    }
    current = s
    joinCrew(s)
    emit()
  }

  return {
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getSession: () => current,
    /** Crew roster in join order (stable reference between changes, for useSyncExternalStore). */
    getCrew: (): readonly CrewMember[] => crew,

    /** Create an account. With `commit: false` the session is returned but not started (call `beginSession`). */
    async signUp(input: { name: string; email: string; password: string; role: CrewRole; remember?: boolean; commit?: boolean }): Promise<Session> {
      const nErr = nameError(input.name)
      if (nErr) throw new AuthError('invalid', nErr, 'name')
      const eErr = emailError(input.email)
      if (eErr) throw new AuthError('invalid', eErr, 'email')
      const pErr = passwordError(input.password, input.email)
      if (pErr) throw new AuthError('invalid', pErr, 'password')
      if (!CREW_ROLES.includes(input.role)) throw new AuthError('invalid', 'Choose your crew role.')

      const email = normalizeEmail(input.email)
      const accounts = readAccounts(local)
      if (accounts.some((a) => a.email === email)) throw new AuthError('exists', 'An account with this email already exists on this device. Sign in instead.', 'email')

      const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
      const account: Account = { email, name: input.name.trim(), role: input.role, salt: toB64(salt), hash: await derive(input.password, salt, iterations), iterations, createdAt: now() }
      try {
        if (!local) throw new Error('no storage')
        local.setItem(USERS_KEY, JSON.stringify([...accounts, account]))
      } catch {
        throw new AuthError('storage', 'This browser is not allowed to save data for this site, so an account cannot be created. Continue without an account instead.')
      }
      const s: Session = { email, name: account.name, role: account.role, guest: false, since: now() }
      if (input.commit !== false) persistSession(s, input.remember ?? true)
      return s
    },

    /** Verify credentials. With `commit: false` the session is returned but not started (call `beginSession`). */
    async signIn(input: { email: string; password: string; remember?: boolean; commit?: boolean }): Promise<Session> {
      if (now() < lockedUntil) {
        throw new AuthError('locked', `Too many attempts. Try again in ${Math.ceil((lockedUntil - now()) / 1000)} s.`)
      }
      const eErr = emailError(input.email)
      if (eErr) throw new AuthError('invalid', eErr, 'email')
      if (!input.password) throw new AuthError('invalid', 'Enter your password.', 'password')

      const email = normalizeEmail(input.email)
      const account = readAccounts(local).find((a) => a.email === email)
      // derive even for unknown emails so both failures take the same time
      const salt = account ? fromB64(account.salt) : new Uint8Array(16)
      const hash = await derive(input.password, salt, account?.iterations ?? iterations)
      if (!account || !safeEqual(hash, account.hash)) {
        failures++
        if (failures >= 5) {
          lockedUntil = now() + 30_000
          failures = 0
        }
        throw new AuthError('credentials', 'Email or password is incorrect.')
      }
      failures = 0
      const s: Session = { email, name: account.name, role: account.role, guest: false, since: now() }
      if (input.commit !== false) persistSession(s, input.remember ?? true)
      return s
    },

    beginSession(s: Session, remember = true) {
      persistSession(s, remember)
    },

    continueAsGuest(): Session {
      const s: Session = { email: '', name: 'Guest', role: 'Guest', guest: true, since: now() }
      persistSession(s, false)
      return s
    },

    signOut() {
      try {
        local?.removeItem(SESSION_KEY)
        session?.removeItem(SESSION_KEY)
      } catch {
        /* ignore */
      }
      current = null
      emit()
    },
  }
}

export type Auth = ReturnType<typeof createAuth>

function browserKV(kind: 'localStorage' | 'sessionStorage'): KV | null {
  try {
    return globalThis[kind] ?? null
  } catch {
    return null
  }
}

/** The app-wide instance. */
export const auth: Auth = createAuth({ local: browserKV('localStorage'), session: browserKV('sessionStorage') })
