import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Eye, EyeOff, Info } from 'lucide-react'
import { AuthError, CREW_ROLES, auth, emailError, nameError, passwordChecks, passwordError, type CrewRole } from '../auth/auth'
import type { AuthRoute } from '../auth/useAuth'
import { useDomId } from '../hooks/useDomId'
import { usePrefersReducedMotion } from '../hooks/useMedia'
import { Wordmark } from './Wordmark'

// ---- the airlock porthole -------------------------------------------------------------------
const R = 150
const C = 170
const START = 130
const SWEEP = 280
const polar = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const
}
const arc = (from: number, to: number, r = R) => {
  const [x1, y1] = polar(from, r)
  const [x2, y2] = polar(to, r)
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

/**
 * Porthole onto the Martian surface. The ring is the airlock pressure: it fills as the form's
 * checks pass and closes completely when access is granted.
 */
function Airlock({ passed, total, open }: { passed: number; total: number; open: boolean }) {
  const p = open ? 1 : total ? passed / total : 0
  const end = START + SWEEP * Math.max(0.015, p)
  const ticks = Array.from({ length: 36 }, (_, i) => START + (i * SWEEP) / 35)
  const status = open ? 'Pressure equalised — opening' : passed === 0 ? 'Airlock sealed' : passed < total ? `Pressurising · ${passed} of ${total} checks` : 'Ready to cycle'
  return (
    <figure className="m-0 grid justify-items-center gap-4">
      <div className="relative aspect-square w-[min(72vw,340px)] lg:w-[min(36vw,460px)]">
        <div
          className="absolute overflow-hidden rounded-full"
          style={{
            inset: '17%',
            backgroundImage: 'url(/bg.webp)',
            backgroundSize: '348% auto',
            backgroundPosition: '49.1% 50.9%',
            boxShadow: 'inset 0 0 60px rgba(0,0,0,.65)',
            transform: open ? 'scale(1.06)' : 'none',
            transition: 'transform 1.2s cubic-bezier(.2,.7,.2,1)',
          }}
        >
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 38%, transparent 42%, rgba(20,12,8,.7) 100%)' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(115deg, rgba(255,255,255,.10), transparent 38%)' }} />
        </div>
        <svg viewBox="0 0 340 340" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <circle cx={C} cy={C} r={R - 34} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1" />
          <circle cx={C} cy={C} r={R - 29} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
          {ticks.map((d, i) => {
            const [x1, y1] = polar(d, R + 6)
            const [x2, y2] = polar(d, R + (i % 5 === 0 ? 14 : 10))
            const lit = (d - START) / SWEEP <= p && passed + (open ? 1 : 0) > 0
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={lit ? '#ff9a52' : 'rgba(255,255,255,.26)'} strokeWidth="1" style={{ transition: 'stroke .4s' }} />
          })}
          <path d={arc(START, START + SWEEP)} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1" />
          <path d={arc(START, end)} fill="none" stroke="#ff6a1f" strokeWidth="2.4" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 7px #ff6a1f)', transition: 'd .6s cubic-bezier(.2,.7,.2,1)' }} />
          <circle cx={polar(end)[0]} cy={polar(end)[1]} r="4.5" fill="#ff6a1f" style={{ transition: 'cx .6s cubic-bezier(.2,.7,.2,1), cy .6s cubic-bezier(.2,.7,.2,1)' }} />
        </svg>
      </div>
      <figcaption className="label num" aria-live="polite" style={{ color: open ? 'var(--ok)' : passed === total ? 'var(--ink)' : 'var(--taupe)' }}>
        {status}
      </figcaption>
    </figure>
  )
}

// ---- form building blocks ----------------------------------------------------------------------
const inputCls = 'w-full rounded-lg px-3.5 py-3 text-[15px] outline-none transition-colors'
const inputStyle = (bad: boolean) => ({ background: 'rgba(0,0,0,.38)', border: `1px solid ${bad ? 'var(--alert)' : 'var(--hair)'}`, color: 'var(--ink)' })

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string | null; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label">
          {label}
        </label>
        {hint}
      </div>
      {children}
      {error && (
        <p id={`${id}-err`} className="text-[12.5px]" style={{ color: '#ff8a7f' }}>
          {error}
        </p>
      )}
    </div>
  )
}

function PasswordInput({ id, value, onChange, onBlur, autoComplete, invalid, describedBy }: { id: string; value: string; onChange: (v: string) => void; onBlur?: () => void; autoComplete: string; invalid: boolean; describedBy?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        className={`${inputCls} pr-12`}
        style={inputStyle(invalid)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        maxLength={128}
        required
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md"
        style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--taupe)' }}
      >
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px]"
      style={{ border: `1px solid ${tone === 'error' ? 'rgba(255,75,62,.55)' : 'var(--hair)'}`, background: tone === 'error' ? 'rgba(60,14,10,.55)' : 'rgba(0,0,0,.28)', color: 'var(--ink)' }}
    >
      <Info size={15} className="mt-0.5 shrink-0" style={{ color: tone === 'error' ? 'var(--alert)' : 'var(--taupe)' }} />
      <div>{children}</div>
    </div>
  )
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-xl py-3.5 text-[15px] font-medium"
      style={{ background: 'var(--rust)', border: '1px solid rgba(255,160,110,.5)', color: '#fff', cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.75 : 1, boxShadow: '0 10px 30px rgba(193,68,14,.28)' }}
    >
      {busy ? 'Cycling airlock…' : children}
    </button>
  )
}

const linkStyle = { color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'rgba(255,106,31,.7)' }

type Progress = (passed: number, total: number) => void
type Granted = (start: () => void) => void

// ---- sign in ----------------------------------------------------------------------------------
function SignInForm({ onProgress, onGranted }: { onProgress: Progress; onGranted: Granted }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [touched, setTouched] = useState({ email: false, password: false })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const emailId = useDomId('si-email')
  const passId = useDomId('si-pass')
  const rememberId = useDomId('si-remember')

  const eErr = emailError(email)
  const pErr = password ? null : 'Enter your password.'
  const passed = [!eErr, !pErr].filter(Boolean).length
  useEffect(() => onProgress(passed, 2), [passed, onProgress])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched({ email: true, password: true })
    setError(null)
    if (eErr || pErr) return
    setBusy(true)
    try {
      // verify first, then let the airlock close before switching to the dashboard
      const s = await auth.signIn({ email, password, remember, commit: false })
      onGranted(() => auth.beginSession(s, remember))
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-in failed. Try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <Field id={emailId} label="Email" error={touched.email ? eErr : null}>
        <input
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="email"
          className={inputCls}
          style={inputStyle(touched.email && !!eErr)}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          aria-invalid={(touched.email && !!eErr) || undefined}
          aria-describedby={touched.email && eErr ? `${emailId}-err` : undefined}
          required
        />
      </Field>
      <Field
        id={passId}
        label="Password"
        error={touched.password ? pErr : null}
        hint={
          <button type="button" onClick={() => setForgot((f) => !f)} aria-expanded={forgot} className="text-[12.5px]" style={{ ...linkStyle, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
            Forgot password?
          </button>
        }
      >
        <PasswordInput id={passId} value={password} onChange={setPassword} onBlur={() => setTouched((t) => ({ ...t, password: true }))} autoComplete="current-password" invalid={touched.password && !!pErr} describedBy={touched.password && pErr ? `${passId}-err` : undefined} />
      </Field>
      {forgot && (
        <Notice tone="info">
          Accounts are stored only in this browser, so there is no reset email. Create a new account, or continue without one.
        </Notice>
      )}
      <label htmlFor={rememberId} className="flex cursor-pointer items-center gap-2.5 text-[14px]" style={{ color: 'var(--ink)' }}>
        <input id={rememberId} type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" style={{ accentColor: '#ff6a1f' }} />
        Keep me signed in on this device
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <SubmitButton busy={busy}>Sign in</SubmitButton>
    </form>
  )
}

// ---- sign up ----------------------------------------------------------------------------------
function SignUpForm({ onProgress, onGranted }: { onProgress: Progress; onGranted: Granted }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<CrewRole | ''>('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [consent, setConsent] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ids = { name: useDomId('su-name'), role: useDomId('su-role'), email: useDomId('su-email'), pass: useDomId('su-pass'), confirm: useDomId('su-confirm'), consent: useDomId('su-consent'), checks: useDomId('su-checks') }

  const errs = {
    name: nameError(name),
    role: role ? null : 'Choose your crew role.',
    email: emailError(email),
    password: passwordError(password, email),
    confirm: !confirm ? 'Repeat your password.' : confirm !== password ? 'Passwords do not match.' : null,
    consent: consent ? null : 'Confirm that you understand how this demo stores data.',
  }
  const checks = passwordChecks(password, email)
  const passed = Object.values(errs).filter((e) => !e).length
  const total = Object.keys(errs).length
  useEffect(() => onProgress(passed, total), [passed, total, onProgress])

  const show = (k: keyof typeof errs) => (touched[k] ? errs[k] : null)
  const touch = (k: keyof typeof errs) => () => setTouched((t) => ({ ...t, [k]: true }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched({ name: true, role: true, email: true, password: true, confirm: true, consent: true })
    setError(null)
    if (Object.values(errs).some(Boolean) || !role) {
      // move focus to the first problem
      const first = (['name', 'role', 'email', 'password', 'confirm', 'consent'] as const).find((k) => errs[k])
      const id = first === 'password' ? ids.pass : first ? ids[first] : null
      if (id) document.getElementById(id)?.focus()
      return
    }
    setBusy(true)
    try {
      const s = await auth.signUp({ name, email, password, role, remember: true, commit: false })
      onGranted(() => auth.beginSession(s, true))
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not create the account. Try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id={ids.name} label="Full name" error={show('name')}>
          <input id={ids.name} autoComplete="name" className={inputCls} style={inputStyle(!!show('name'))} value={name} onChange={(e) => setName(e.target.value)} onBlur={touch('name')} maxLength={60} aria-invalid={!!show('name') || undefined} aria-describedby={show('name') ? `${ids.name}-err` : undefined} required />
        </Field>
        <Field id={ids.role} label="Crew role" error={show('role')}>
          <select
            id={ids.role}
            className={`${inputCls} cursor-pointer appearance-none`}
            style={{ ...inputStyle(!!show('role')), backgroundImage: 'linear-gradient(45deg, transparent 50%, #a8978a 50%), linear-gradient(135deg, #a8978a 50%, transparent 50%)', backgroundPosition: 'calc(100% - 18px) 55%, calc(100% - 13px) 55%', backgroundSize: '5px 5px', backgroundRepeat: 'no-repeat' }}
            value={role}
            onChange={(e) => setRole(e.target.value as CrewRole)}
            onBlur={touch('role')}
            aria-invalid={!!show('role') || undefined}
            aria-describedby={show('role') ? `${ids.role}-err` : undefined}
            required
          >
            <option value="" disabled>
              Select…
            </option>
            {CREW_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id={ids.email} label="Email" error={show('email')}>
        <input id={ids.email} type="email" inputMode="email" autoComplete="email" className={inputCls} style={inputStyle(!!show('email'))} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={touch('email')} aria-invalid={!!show('email') || undefined} aria-describedby={show('email') ? `${ids.email}-err` : undefined} required />
      </Field>
      <Field id={ids.pass} label="Password">
        <PasswordInput id={ids.pass} value={password} onChange={setPassword} onBlur={touch('password')} autoComplete="new-password" invalid={!!show('password')} describedBy={ids.checks} />
        <ul id={ids.checks} className="grid gap-1 text-[12.5px]" aria-label="Password requirements">
          {checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2" style={{ color: c.ok ? 'var(--ok)' : touched.password ? '#ff8a7f' : 'var(--taupe)' }}>
              <Check size={13} style={{ opacity: c.ok ? 1 : 0.35 }} aria-hidden="true" />
              {c.label}
              <span className="sr-only">{c.ok ? '(met)' : '(not met)'}</span>
            </li>
          ))}
        </ul>
      </Field>
      <Field id={ids.confirm} label="Repeat password" error={show('confirm')}>
        <PasswordInput id={ids.confirm} value={confirm} onChange={setConfirm} onBlur={touch('confirm')} autoComplete="new-password" invalid={!!show('confirm')} describedBy={show('confirm') ? `${ids.confirm}-err` : undefined} />
      </Field>
      <div className="grid gap-1.5">
        <label htmlFor={ids.consent} className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-snug" style={{ color: 'var(--ink)' }}>
          <input id={ids.consent} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} onBlur={touch('consent')} className="mt-0.5 h-4 w-4 shrink-0" style={{ accentColor: '#ff6a1f' }} aria-describedby={show('consent') ? `${ids.consent}-err` : undefined} />
          I understand this is a demo: my account is stored only in this browser, so I won’t use a password I use anywhere else.
        </label>
        {show('consent') && (
          <p id={`${ids.consent}-err`} className="text-[12.5px]" style={{ color: '#ff8a7f' }}>
            {show('consent')}
          </p>
        )}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <SubmitButton busy={busy}>Create crew account</SubmitButton>
    </form>
  )
}

// ---- page ---------------------------------------------------------------------------------------
const COPY = {
  login: {
    title: 'Welcome back',
    lead: 'Sign in to see live vitals, your daily check-in and space-weather alerts for the crew.',
    switchText: 'New to the mission?',
    switchLink: 'Create an account',
    switchHref: '#/signup',
  },
  signup: {
    title: 'Join the crew',
    lead: 'Create an account to keep your daily check-ins and follow your EVA vitals on this device.',
    switchText: 'Already have an account?',
    switchLink: 'Sign in',
    switchHref: '#/login',
  },
} as const

export function AuthPage({ mode }: { mode: AuthRoute }) {
  const [progress, setProgress] = useState({ passed: 0, total: 2 })
  const [open, setOpen] = useState(false)
  const reduce = usePrefersReducedMotion()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useDomId('auth-h')
  const c = COPY[mode]

  // keep the stable callback identity so the forms' effects don't loop
  const onProgress = useRef<Progress>((passed, total) => setProgress({ passed, total })).current

  useEffect(() => {
    document.title = `${mode === 'login' ? 'Sign in' : 'Create account'} · AreA 51`
    headingRef.current?.focus({ preventScroll: true })
    return () => {
      document.title = 'AreA 51 - Mission Dashboard'
    }
  }, [mode])

  // Credentials are verified: close the ring, then start the session (the app switches to the dashboard).
  const onGranted: Granted = (start) => {
    setOpen(true)
    setTimeout(start, reduce ? 0 : 900)
  }

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden">
      <div aria-hidden="true" className="fixed inset-0" style={{ backgroundImage: 'url(/bg-wide.webp)', backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(4px) brightness(.42)', transform: 'scale(1.05)' }} />
      <div aria-hidden="true" className="fixed inset-0" style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(20,14,11,.15), rgba(14,10,8,.88) 75%)' }} />

      <div className="relative z-10 mx-auto grid min-h-[100dvh] max-w-[1280px] grid-rows-[auto_1fr_auto] px-4 sm:px-8">
        <header className="flex items-center justify-between py-5">
          <Wordmark height={42} />
          <a href={c.switchHref} className="text-[14px]" style={linkStyle}>
            {c.switchLink}
          </a>
        </header>

        <main className="grid items-center gap-8 py-6 lg:grid-cols-[1fr_minmax(0,500px)] lg:gap-16">
          <div className={`grid justify-items-center ${reduce ? '' : 'rise'}`}>
            <Airlock passed={progress.passed} total={progress.total} open={open} />
          </div>

          <section aria-labelledby={headingId} className="glass w-full p-6 sm:p-8" style={{ background: 'rgba(22,16,13,.72)' }}>
            <h1 id={headingId} ref={headingRef} tabIndex={-1} className="display text-[40px] leading-none sm:text-[48px]" style={{ outline: 'none' }}>
              {c.title}
            </h1>
            <p className="mb-7 mt-3 max-w-[44ch] text-[15px] leading-relaxed" style={{ color: 'var(--taupe)' }}>
              {c.lead}
            </p>

            {mode === 'login' ? <SignInForm key="login" onProgress={onProgress} onGranted={onGranted} /> : <SignUpForm key="signup" onProgress={onProgress} onGranted={onGranted} />}

            <div className="mt-6 grid gap-3 text-[14px]" style={{ color: 'var(--taupe)' }}>
              <p>
                {c.switchText}{' '}
                <a href={c.switchHref} style={linkStyle}>
                  {c.switchLink}
                </a>
              </p>
              <p>
                Just looking around?{' '}
                <button type="button" onClick={() => auth.continueAsGuest()} style={{ ...linkStyle, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
                  Continue without an account
                </button>
              </p>
            </div>
          </section>
        </main>

        <footer className="py-5 text-[12.5px] leading-relaxed" style={{ color: 'var(--taupe)' }}>
          NASA Space Apps 2026 prototype. Accounts are stored only in this browser and are not a secure login; do not reuse a real password.
        </footer>
      </div>
    </div>
  )
}
