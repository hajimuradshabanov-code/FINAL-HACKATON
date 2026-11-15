import { useEffect, useState } from 'react'
import { Flame, ChevronDown, ShieldCheck, Stethoscope, TrendingUp, UserRound } from 'lucide-react'
import { METRICS, STATUS_COLOR, STATUS_RANK, VITAL_KEYS, type Status } from '../config/thresholds'
import { GUIDE, HAZARDS, SELF_REPORT_SOURCES, assessBP, assessGlucose, assessMood, assessSleep } from '../config/guidance'
import { useTelemetry, useTelemetrySelect } from '../hooks/useTelemetry'
import { useDomId } from '../hooks/useDomId'
import { BASELINE_KEYS } from '../science/baseline'
import { formatNumber } from '../lib/format'
import { auth } from '../auth/auth'
import {
  ITEM_POINTS, LIMITS, checkinStorage, currentStreak, localDayKey, nextStreak, parseCheckinState, parseInput, selfReportScore, validateCheckin,
  type CheckinLog, type CheckinState,
} from '../lib/checkin'

type Log = CheckinLog

/** The signed-in person's own check-in store (never another user's). */
function store() {
  const where = checkinStorage(auth.getSession())
  return where ? { area: globalThis[where.kind], key: where.key } : null
}

function load(): CheckinState {
  try {
    const s = store()
    return parseCheckinState(s ? s.area.getItem(s.key) : null)
  } catch {
    return parseCheckinState(null) // storage unavailable (private mode, blocked site data)
  }
}

function Pill({ s, children }: { s: Status; children: React.ReactNode }) {
  return (
    <span className="label rounded-full px-2 py-0.5" style={{ border: `1px solid ${STATUS_COLOR[s]}`, color: STATUS_COLOR[s] }}>
      {children}
    </span>
  )
}

export function Insights() {
  const { statuses, latest, science } = useTelemetry()
  const early = science.forecasts.filter((f) => statuses[f.key] === 'normal')
  // vitals that have left this crew member's own norm while still inside the fixed safe range
  const personal = science.baseline ? BASELINE_KEYS.map((k) => science.baseline![k]).filter((r) => r.deviating && statuses[r.key] === 'normal') : []
  const issues = VITAL_KEYS.filter((k) => statuses[k] !== 'normal').sort((a, b) => STATUS_RANK[statuses[b]] - STATUS_RANK[statuses[a]])
  const worst = issues[0] ? statuses[issues[0]] : 'normal'
  // only what actually has a value can be called safe
  const known = VITAL_KEYS.filter((k) => Number.isFinite(latest?.[k]))
  // "all clear" is a statement about the person: a modelled radiation dose alone does not earn it
  const body = known.filter((k) => k !== 'radiation' && k !== 'suitPressure')
  const unknown = VITAL_KEYS.filter((k) => !known.includes(k))
  const quote = (k: (typeof VITAL_KEYS)[number]) => `${METRICS[k].short} ${formatNumber(latest![k], METRICS[k].decimals)} ${METRICS[k].unit}`
  const headingId = useDomId('ins-h')
  return (
    <section className="glass rise p-4" data-status={worst} aria-labelledby={headingId} style={{ ['--i' as string]: 1 }}>
      <header className="mb-3 flex items-center justify-between">
        <h2 id={headingId} className="display text-[20px]">
          Self-assessment
        </h2>
        <Pill s={worst}>{worst !== 'normal' ? worst : body.length ? 'all clear' : 'no data'}</Pill>
      </header>
      {early.length > 0 && (
        <div className="mb-3 grid gap-1.5">
          {early.map((f) => (
            <p key={f.key} className="flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]" style={{ border: `1px solid ${STATUS_COLOR.warning}55`, background: 'rgba(242,176,76,.07)', color: 'var(--ink)' }}>
              <TrendingUp size={15} color={STATUS_COLOR.warning} className="mt-0.5 shrink-0" />
              <span>
                <b>Early warning:</b> {METRICS[f.key].label.toLowerCase()} is {f.direction} and will reach its warning level in about {f.minutes < 1 ? `${Math.max(1, Math.round(f.minutes * 60))} s` : `${f.minutes.toFixed(1)} min`}. {GUIDE[f.key]?.act.warning ?? ''}
              </span>
            </p>
          ))}
        </div>
      )}
      {science.joint?.flagged && (
        <p className="mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]" style={{ border: `1px solid ${STATUS_COLOR.warning}55`, background: 'rgba(242,176,76,.07)', color: 'var(--ink)' }}>
          <UserRound size={15} color={STATUS_COLOR.warning} className="mt-0.5 shrink-0" />
          <span>
            <b>{science.joint.match ? science.joint.match.signature.label : 'Several vitals are moving together'}:</b>{' '}
            {science.joint.match ? `${science.joint.match.signature.why} ${science.joint.match.signature.act}` : 'no single vital is out of range, but together they are unusual for you. Re-check in a minute and tell a crewmate how you feel.'}
          </span>
        </p>
      )}
      {personal.length > 0 && (
        <div className="mb-3 grid gap-1.5">
          {personal.map((r) => (
            <p key={r.key} className="flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]" style={{ border: `1px solid ${STATUS_COLOR.warning}55`, background: 'rgba(242,176,76,.07)', color: 'var(--ink)' }}>
              <UserRound size={15} color={STATUS_COLOR.warning} className="mt-0.5 shrink-0" />
              <span>
                <b>Unusual for you:</b> {METRICS[r.key].label.toLowerCase()} is {formatNumber(Math.abs(r.z), 1)} σ {r.direction === 'high' ? 'above' : 'below'} your {r.activity === 'eva' ? 'EVA' : 'resting'} norm ({formatNumber(r.mean, METRICS[r.key].decimals)} ± {formatNumber(r.sd, METRICS[r.key].decimals + 1)} {METRICS[r.key].unit}), although it is still inside the general safe range. Re-check in a minute and note how you feel.
              </span>
            </p>
          ))}
        </div>
      )}
      {issues.length === 0 && body.length === 0 && (
        <p className="flex items-start gap-2 text-[14px]" style={{ color: 'var(--ink)' }}>
          <Stethoscope size={18} color="var(--taupe)" className="mt-0.5 shrink-0" />
          No body or suit instrument is connected in live mode, so there is nothing to assess. The daily check-in still works; the training simulation (menu) shows the full dashboard.
        </p>
      )}
      {issues.length === 0 && body.length > 0 && (
        <p className="flex items-start gap-2 text-[14px]" style={{ color: 'var(--ink)' }}>
          <ShieldCheck size={18} color={STATUS_COLOR.normal} className="mt-0.5 shrink-0" />
          <span>
            {unknown.length ? 'Everything being measured is' : 'All monitored indicators are'} inside the safe range ({known.slice(0, 3).map(quote).join(', ')}){personal.length ? ', but see the note above' : ''}.
            {unknown.length > 0 && <span style={{ color: 'var(--taupe)' }}> Not measured: {unknown.map((k) => METRICS[k].label.toLowerCase()).join(', ')}.</span>}
          </span>
        </p>
      )}
      <div className="grid gap-3">
        {issues.map((k) => {
          const g = GUIDE[k]
          const st = statuses[k] as Exclude<Status, 'normal'>
          if (!g) return null
          return (
            <div key={k} className="rounded-xl p-3" style={{ border: `1px solid ${STATUS_COLOR[st]}55`, background: 'rgba(0,0,0,.25)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[15px]">{METRICS[k].label}</span>
                <Pill s={st}>{st}</Pill>
              </div>
              <p className="mt-2 text-[13px]" style={{ color: 'var(--ink)' }}>
                <b className="label" style={{ color: 'var(--taupe)' }}>
                  Do now{' '}
                </b>
                {g.act[st]}
              </p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--taupe)' }}>
                {g.hazard}
              </p>
              {st === 'critical' && (
                <p className="label mt-2 flex items-center gap-1.5" style={{ color: STATUS_COLOR.critical }}>
                  <Stethoscope size={12} /> Contact flight surgeon
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {hint}
      </div>
      {children}
    </div>
  )
}

const input = 'num w-full rounded-lg px-3 py-2 text-[15px] outline-none'
const inputStyle = { background: 'rgba(0,0,0,.35)', border: '1px solid var(--hair)', color: 'var(--ink)' }

export function CheckIn() {
  const [state, setState] = useState(load)
  const { log, streak, last } = state
  const [draft, setDraft] = useState<Log>(() => (log.day === localDayKey() ? log : {}))
  const [errors, setErrors] = useState<string[]>([])
  const [showMethod, setShowMethod] = useState(false)
  const headingId = useDomId('ci-h')
  const errorId = useDomId('ci-err')

  useEffect(() => {
    try {
      const s = store()
      s?.area.setItem(s.key, JSON.stringify({ log, streak, last }))
    } catch {
      /* storage unavailable: keep working in memory */
    }
  }, [log, streak, last])

  const valid = (v: number | undefined, f: keyof typeof LIMITS) => v !== undefined && Number.isFinite(v) && v >= LIMITS[f].min && v <= LIMITS[f].max
  const sleep = valid(draft.sleep, 'sleep') ? assessSleep(draft.sleep!) : null
  const mood = valid(draft.mood, 'mood') ? assessMood(draft.mood!) : null
  const bp = valid(draft.sys, 'sys') && valid(draft.dia, 'dia') && draft.sys! > draft.dia! ? assessBP(draft.sys!, draft.dia!) : null
  const glu = valid(draft.glucose, 'glucose') ? assessGlucose(draft.glucose!) : null

  const answered = [sleep, mood, bp, glu].filter((x): x is NonNullable<typeof x> => x !== null)
  const done = answered.length
  const entered = [draft.sleep, draft.mood, draft.sys, draft.dia, draft.glucose].some((v) => v !== undefined)
  const { score } = selfReportScore(answered.map((x) => x.status))
  const scoreColor = score === null ? 'var(--taupe)' : score > 80 ? STATUS_COLOR.normal : score > 55 ? STATUS_COLOR.warning : STATUS_COLOR.critical
  const items = [
    { name: 'Sleep', a: sleep, src: SELF_REPORT_SOURCES.sleep },
    { name: 'Mood', a: mood, src: SELF_REPORT_SOURCES.mood },
    { name: 'Blood pressure', a: bp, src: SELF_REPORT_SOURCES.bp },
    { name: 'Glucose', a: glu, src: SELF_REPORT_SOURCES.glucose },
  ]

  const update = (patch: Partial<Log>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors([])
  }

  const submit = () => {
    const errs = validateCheckin(draft)
    setErrors(errs)
    if (errs.length) return
    const t = localDayKey()
    setState((prev) => ({ log: { ...draft, day: t }, streak: nextStreak(prev, t), last: t }))
  }
  const today = localDayKey()
  const saved = last === today
  const shownStreak = currentStreak(state, today)

  return (
    <section className="glass rise grid gap-4 p-4" aria-labelledby={headingId} style={{ ['--i' as string]: 2 }}>
      <header className="flex items-center justify-between">
        <h2 id={headingId} className="display text-[20px]">
          Daily check-in
        </h2>
        <span className="label flex items-center gap-1.5" style={{ color: shownStreak ? 'var(--lava)' : 'var(--taupe)' }}>
          <Flame size={13} /> {shownStreak} day streak
        </span>
      </header>

      <div className="flex items-center gap-4">
        <div className="relative grid h-[76px] w-[76px] shrink-0 place-items-center">
          <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="2" />
            {score !== null && <circle cx="18" cy="18" r="16" fill="none" stroke={scoreColor} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${score} 100`} pathLength={100} style={{ transition: 'stroke-dasharray .6s' }} />}
          </svg>
          <span className="display num text-[24px]" style={{ color: score === null ? 'var(--taupe)' : 'var(--ink)' }}>{score ?? '–'}</span>
        </div>
        <div>
          <div className="label">Self-report score</div>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--taupe)' }}>
            {score === null ? 'No score yet: it is calculated from your answers, so enter at least one.' : `Based on ${done} of 4 answers${done === 4 ? ' · +50 XP' : ''}.`}{' '}
            <button onClick={() => setShowMethod((v) => !v)} aria-expanded={showMethod} style={{ background: 'none', border: 0, padding: 0, color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer', font: 'inherit' }}>
              {showMethod ? 'Hide the formula' : 'How is it calculated?'}
            </button>
          </p>
        </div>
      </div>

      {showMethod && (
        <div className="rounded-xl p-3 text-[12px] leading-relaxed" style={{ border: '1px solid var(--hair)', background: 'rgba(0,0,0,.25)', color: 'var(--taupe)' }}>
          <p style={{ color: 'var(--ink)' }}>
            Score = average points of the items you answered. Each item: {ITEM_POINTS.normal} in the guideline’s normal range, {ITEM_POINTS.warning} borderline, {ITEM_POINTS.critical} out of range. Equal weights; live vitals are not included. It summarises your answers and is not a validated clinical index.
          </p>
          <table className="mt-2 w-full">
            <tbody>
              {items.map((it) => (
                <tr key={it.name} style={{ borderTop: '1px solid var(--hair)' }}>
                  <td className="py-1.5 pr-2 align-top" style={{ color: 'var(--ink)' }}>{it.name}</td>
                  <td className="num py-1.5 pr-2 align-top" style={{ color: it.a ? STATUS_COLOR[it.a.status] : 'var(--taupe)' }}>{it.a ? ITEM_POINTS[it.a.status] : '–'}</td>
                  <td className="py-1.5 align-top">
                    {it.src.rule}.{' '}
                    {it.src.href ? (
                      <a href={it.src.href} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 2 }}>{it.src.label}</a>
                    ) : (
                      it.src.label
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Field label="Sleep last night (h)" hint={sleep && <Pill s={sleep.status}>{sleep.status}</Pill>}>
        <input className={input} style={inputStyle} type="number" min={LIMITS.sleep.min} max={LIMITS.sleep.max} step={LIMITS.sleep.step} inputMode="decimal" aria-label="Hours slept" aria-describedby={errors.length ? errorId : undefined} value={draft.sleep ?? ''} onChange={(e) => update({ sleep: parseInput(e.target.value) })} />
        {sleep && <p className="text-[12px]" style={{ color: 'var(--taupe)' }}>{sleep.advice}</p>}
      </Field>

      <Field label="Mood today" hint={mood && <Pill s={mood.status}>{mood.status}</Pill>}>
        <div className="flex gap-2" role="radiogroup" aria-label="Mood from 1 to 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={draft.mood === n} onClick={() => update({ mood: n })} className="num h-10 flex-1 rounded-lg" style={{ border: '1px solid', borderColor: draft.mood === n ? 'var(--lava)' : 'var(--hair)', background: draft.mood === n ? 'rgba(255,106,31,.18)' : 'rgba(0,0,0,.3)', cursor: 'pointer' }}>
              {n}
            </button>
          ))}
        </div>
        {mood && <p className="text-[12px]" style={{ color: 'var(--taupe)' }}>{mood.advice}</p>}
      </Field>

      <Field label="Blood pressure (mmHg)" hint={bp && <Pill s={bp.status}>{bp.status}</Pill>}>
        <div className="flex items-center gap-2">
          <input className={input} style={inputStyle} type="number" min={LIMITS.sys.min} max={LIMITS.sys.max} inputMode="numeric" placeholder="120" aria-label="Systolic" value={draft.sys ?? ''} onChange={(e) => update({ sys: parseInput(e.target.value) })} />
          <span>/</span>
          <input className={input} style={inputStyle} type="number" min={LIMITS.dia.min} max={LIMITS.dia.max} inputMode="numeric" placeholder="80" aria-label="Diastolic" value={draft.dia ?? ''} onChange={(e) => update({ dia: parseInput(e.target.value) })} />
        </div>
        {bp && <p className="text-[12px]" style={{ color: 'var(--taupe)' }}>{bp.advice}</p>}
      </Field>

      <Field label="Blood glucose (mg/dL)" hint={glu && <Pill s={glu.status}>{glu.status}</Pill>}>
        <input className={input} style={inputStyle} type="number" min={LIMITS.glucose.min} max={LIMITS.glucose.max} inputMode="numeric" placeholder="90" aria-label="Blood glucose" value={draft.glucose ?? ''} onChange={(e) => update({ glucose: parseInput(e.target.value) })} />
        {glu && <p className="text-[12px]" style={{ color: 'var(--taupe)' }}>{glu.advice}</p>}
      </Field>

      {errors.length > 0 && (
        <ul id={errorId} role="alert" className="grid gap-1 rounded-xl p-3 text-[12px]" style={{ border: `1px solid ${STATUS_COLOR.critical}88`, background: 'rgba(60,14,10,.5)', color: 'var(--ink)' }}>
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}

      <button onClick={submit} disabled={!entered} className="label rounded-xl py-3" style={{ background: entered ? 'var(--rust)' : 'rgba(255,255,255,.08)', border: '1px solid var(--hair)', color: 'var(--ink)', cursor: entered ? 'pointer' : 'not-allowed' }}>
        {saved ? 'Update today’s log' : 'Save check-in'}
      </button>
    </section>
  )
}

export function Hazards() {
  const [open, setOpen] = useState<string | null>(null)
  const { statuses } = useTelemetry()
  const headingId = useDomId('hz-h')
  return (
    <section className="glass rise p-4" aria-labelledby={headingId} style={{ ['--i' as string]: 3 }}>
      <h2 id={headingId} className="display mb-3 text-[20px]">
        Spaceflight hazards
      </h2>
      <div className="grid">
        {HAZARDS.map((h) => {
          const on = open === h.id
          const worst = (h.metrics as readonly string[]).reduce<Status>((w, k) => (STATUS_RANK[statuses[k as keyof typeof statuses]] > STATUS_RANK[w] ? statuses[k as keyof typeof statuses] : w), 'normal')
          return (
            <div key={h.id} style={{ borderTop: '1px solid var(--hair)' }}>
              <button onClick={() => setOpen(on ? null : h.id)} aria-expanded={on} className="flex w-full items-center justify-between py-3 text-left" style={{ background: 'none', border: 0, cursor: 'pointer' }}>
                <span className="flex items-center gap-2 text-[14px]">
                  <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: STATUS_COLOR[worst] }} />
                  {h.name}
                </span>
                <ChevronDown size={16} style={{ transform: on ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </button>
              {on && (
                <p className="pb-3 text-[13px]" style={{ color: 'var(--taupe)' }}>
                  {h.note}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
