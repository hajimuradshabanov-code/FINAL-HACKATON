import type { Status } from '../config/thresholds'

/** Daily check-in record. All fields optional; `day` is the local calendar day it was saved for. */
export interface CheckinLog {
  sleep?: number
  mood?: number
  sys?: number
  dia?: number
  glucose?: number
  day?: string
}

export interface CheckinState {
  log: CheckinLog
  streak: number
  /** local day key (YYYY-MM-DD) of the last saved check-in, '' if never */
  last: string
}

const CHECKIN_STORAGE_KEY = 'area51.checkin.v1'

/**
 * Where one person's check-in is kept. Several people use the app in one browser, so the record is
 * stored per account (localStorage). A guest's record lives in sessionStorage under the start time
 * of that guest session: it survives a reload but is never shown to the next guest or user.
 */
export function checkinStorage(who: { email: string; guest: boolean; since: number } | null): { kind: 'localStorage' | 'sessionStorage'; key: string } | null {
  if (!who) return null
  if (who.guest || !who.email) return { kind: 'sessionStorage', key: `${CHECKIN_STORAGE_KEY}:guest:${who.since}` }
  return { kind: 'localStorage', key: `${CHECKIN_STORAGE_KEY}:${who.email}` }
}

/** Single source of truth for input limits: used by the form attributes, validation and storage normalisation. */
export const LIMITS = {
  /** hours slept in one night; > 16 h is not a plausible single sleep period */
  sleep: { min: 0, max: 16, step: 0.5 },
  mood: { min: 1, max: 5, step: 1 },
  sys: { min: 50, max: 300, step: 1 },
  dia: { min: 30, max: 200, step: 1 },
  glucose: { min: 20, max: 800, step: 1 },
} as const

type Field = keyof typeof LIMITS

export const EMPTY_STATE: CheckinState = { log: {}, streak: 0, last: '' }

// ---- local calendar days -------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar day of `d` as YYYY-MM-DD (not UTC: 01:00 in UTC+4 is still "today" locally). */
export function localDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDayKey(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = DAY_RE.exec(s)
  if (!m) return false
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return localDayKey(d) === s
}

/** The local calendar day before `key`. Uses calendar arithmetic, so DST days (23 h / 25 h) are handled. */
export function previousDayKey(key: string): string {
  const m = DAY_RE.exec(key)
  if (!m) throw new Error(`bad day key: ${key}`)
  return localDayKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1, 12))
}

/** Streak after saving on `today`: unchanged if already saved today, +1 after yesterday, else restart at 1. */
export function nextStreak(prev: Pick<CheckinState, 'streak' | 'last'>, today: string): number {
  const streak = Math.max(0, Math.floor(prev.streak) || 0)
  if (prev.last === today) return Math.max(1, streak)
  if (prev.last && prev.last === previousDayKey(today)) return streak + 1
  return 1
}

/** Streak to display on `today`: a streak whose last day is older than yesterday is broken. */
export function currentStreak(state: Pick<CheckinState, 'streak' | 'last'>, today: string): number {
  if (state.last === today || (state.last && state.last === previousDayKey(today))) return state.streak
  return 0
}

// ---- validation --------------------------------------------------------------------
const inRange = (f: Field, v: number) => Number.isFinite(v) && v >= LIMITS[f].min && v <= LIMITS[f].max

/** Human-readable errors for impossible values; empty when the draft can be saved. */
export function validateCheckin(d: CheckinLog): string[] {
  const errs: string[] = []
  if (d.sleep !== undefined && !inRange('sleep', d.sleep)) errs.push(`Sleep must be between ${LIMITS.sleep.min} and ${LIMITS.sleep.max} hours.`)
  if (d.mood !== undefined && (!Number.isInteger(d.mood) || !inRange('mood', d.mood))) errs.push('Mood must be a whole number from 1 to 5.')
  if (d.sys !== undefined && !inRange('sys', d.sys)) errs.push(`Systolic pressure must be between ${LIMITS.sys.min} and ${LIMITS.sys.max} mmHg.`)
  if (d.dia !== undefined && !inRange('dia', d.dia)) errs.push(`Diastolic pressure must be between ${LIMITS.dia.min} and ${LIMITS.dia.max} mmHg.`)
  if (d.sys !== undefined && d.dia !== undefined && Number.isFinite(d.sys) && Number.isFinite(d.dia) && d.sys <= d.dia) errs.push('Systolic pressure must be higher than diastolic.')
  if ((d.sys === undefined) !== (d.dia === undefined)) errs.push('Enter both systolic and diastolic pressure.')
  if (d.glucose !== undefined && !inRange('glucose', d.glucose)) errs.push(`Blood glucose must be between ${LIMITS.glucose.min} and ${LIMITS.glucose.max} mg/dL.`)
  return errs
}

/** Convert raw input text to a draft value: '' → undefined, anything non-numeric → NaN (caught by validation). */
export function parseInput(text: string): number | undefined {
  const t = text.trim()
  if (t === '') return undefined
  return Number(t.replace(',', '.'))
}

// ---- persisted state ----------------------------------------------------------------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const LOG_FIELDS: Field[] = ['sleep', 'mood', 'sys', 'dia', 'glucose']

function normalizeLog(raw: unknown): CheckinLog {
  if (!isObj(raw)) return {}
  const log: CheckinLog = {}
  for (const f of LOG_FIELDS) {
    const v = typeof raw[f] === 'string' ? Number(raw[f]) : raw[f]
    if (typeof v === 'number' && inRange(f, v) && (f !== 'mood' || Number.isInteger(v))) log[f] = v
  }
  // blood pressure is only meaningful as a valid pair
  if (log.sys === undefined || log.dia === undefined || log.sys <= log.dia) {
    delete log.sys
    delete log.dia
  }
  if (isDayKey(raw.day)) log.day = raw.day
  return log
}

/**
 * Turn whatever is in storage into a valid state. Accepts the current shape, `{}`, a legacy flat
 * log (`{ sleep, mood, ..., day }` without the wrapper) and garbage; keeps every valid field.
 */
export function normalizeCheckinState(raw: unknown): CheckinState {
  if (!isObj(raw)) return { ...EMPTY_STATE, log: {} }
  const legacyFlat = !('log' in raw) && LOG_FIELDS.some((f) => f in raw)
  const log = normalizeLog(legacyFlat ? raw : raw.log)
  let last = isDayKey(raw.last) ? raw.last : ''
  if (!last && legacyFlat && log.day) last = log.day
  const s = typeof raw.streak === 'number' && Number.isFinite(raw.streak) ? Math.max(0, Math.floor(raw.streak)) : 0
  const streak = last ? Math.max(s, 1) : 0
  return { log, streak, last }
}

/** Parse the stored JSON string (or null). Corrupted JSON yields the empty state, never an exception. */
export function parseCheckinState(text: string | null): CheckinState {
  if (text === null) return { ...EMPTY_STATE, log: {} }
  try {
    return normalizeCheckinState(JSON.parse(text))
  } catch {
    return { ...EMPTY_STATE, log: {} }
  }
}

// ---- self-report score ---------------------------------------------------------------
/** Points per answered item: in the guideline's normal range 100, borderline 50, out of range 0. */
export const ITEM_POINTS: Record<Status, number> = { normal: 100, warning: 50, critical: 0 }
export const SELF_REPORT_ITEMS = 4

export interface SelfReportScore {
  /** mean of the answered items' points; null when nothing has been answered (no data, no score) */
  score: number | null
  answered: number
  of: number
}

/**
 * Self-report score = mean of ITEM_POINTS over the items answered today, equal weights. It is a
 * summary of the four check-in answers only: live vitals are not mixed in, and it is not a
 * validated clinical index. With no answers there is no score.
 */
export function selfReportScore(statuses: readonly Status[]): SelfReportScore {
  const answered = statuses.length
  return { score: answered ? Math.round(statuses.reduce((a, s) => a + ITEM_POINTS[s], 0) / answered) : null, answered, of: SELF_REPORT_ITEMS }
}
