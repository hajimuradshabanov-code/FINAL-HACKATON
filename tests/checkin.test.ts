import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessBP, assessGlucose, assessMood, assessSleep } from '../src/config/guidance'
import {
  LIMITS, currentStreak, localDayKey, nextStreak, normalizeCheckinState, parseCheckinState, parseInput, previousDayKey, validateCheckin, selfReportScore,
} from '../src/lib/checkin'

/** run `fn` with the process time zone set to `tz` (Node re-reads TZ when it is assigned) */
function inTz<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  }
}

test('local day in UTC+4 just after midnight is the new local day, not the UTC one', () => {
  inTz('Asia/Baku', () => {
    // 2026-11-14 00:30 local = 2026-11-13 20:30 UTC
    const d = new Date(Date.UTC(2026, 10, 13, 20, 30))
    assert.equal(d.getTimezoneOffset(), -240, 'time zone switch took effect')
    assert.equal(d.toISOString().slice(0, 10), '2026-11-13')
    assert.equal(localDayKey(d), '2026-11-14')
  })
})

test('local day in a negative offset late in the evening is still today', () => {
  inTz('America/New_York', () => {
    // 2026-11-14 22:30 local (UTC-5) = 2026-11-15 03:30 UTC
    const d = new Date(Date.UTC(2026, 10, 15, 3, 30))
    assert.equal(d.getTimezoneOffset(), 300)
    assert.equal(d.toISOString().slice(0, 10), '2026-11-15')
    assert.equal(localDayKey(d), '2026-11-14')
  })
})

test('previous day across month/year ends and DST transitions', () => {
  assert.equal(previousDayKey('2026-03-01'), '2026-02-28')
  assert.equal(previousDayKey('2024-03-01'), '2024-02-29')
  assert.equal(previousDayKey('2027-01-01'), '2026-12-31')
  inTz('America/New_York', () => {
    assert.equal(previousDayKey('2026-03-09'), '2026-03-08') // day after spring-forward (23 h day)
    assert.equal(previousDayKey('2026-11-02'), '2026-11-01') // day after fall-back (25 h day)
  })
})

test('streak: same day keeps it, consecutive day extends it, a missed day restarts it', () => {
  assert.equal(nextStreak({ streak: 3, last: '2026-11-14' }, '2026-11-14'), 3)
  assert.equal(nextStreak({ streak: 3, last: '2026-11-13' }, '2026-11-14'), 4)
  assert.equal(nextStreak({ streak: 3, last: '2026-11-12' }, '2026-11-14'), 1)
  assert.equal(nextStreak({ streak: 0, last: '' }, '2026-11-14'), 1)
  assert.equal(currentStreak({ streak: 5, last: '2026-11-13' }, '2026-11-14'), 5)
  assert.equal(currentStreak({ streak: 5, last: '2026-11-11' }, '2026-11-14'), 0, 'a broken streak is not displayed')
})

test('sleep: one range for form and validation', () => {
  assert.deepEqual(validateCheckin({ sleep: LIMITS.sleep.max }), [])
  assert.deepEqual(validateCheckin({ sleep: 0 }), [])
  for (const bad of [-1, LIMITS.sleep.max + 0.5, 20, NaN, Infinity]) assert.equal(validateCheckin({ sleep: bad }).length, 1, String(bad))
  assert.equal(parseInput(''), undefined)
  assert.equal(parseInput(' 7,5 '), 7.5)
  assert.ok(Number.isNaN(parseInput('abc')!))
})

test('blood pressure / glucose / mood validation', () => {
  assert.deepEqual(validateCheckin({ sys: 120, dia: 80 }), [])
  assert.equal(validateCheckin({ sys: 120 }).length, 1)
  assert.equal(validateCheckin({ sys: 80, dia: 90 }).length, 1)
  assert.equal(validateCheckin({ glucose: 10 }).length, 1)
  assert.equal(validateCheckin({ mood: 2.5 }).length, 1)
})

test('storage: empty, {}, corrupted JSON and garbage never throw', () => {
  for (const raw of [null, '{}', '{oops', 'null', '"text"', '[1,2]', '42']) {
    const s = parseCheckinState(raw)
    assert.deepEqual(s.log, {}, String(raw))
    assert.equal(s.streak, 0)
    assert.equal(s.last, '')
  }
})

test('storage: current shape round-trips; invalid fields are dropped, valid ones kept', () => {
  const s = normalizeCheckinState({ log: { sleep: 7.5, mood: 4, sys: 300, dia: 'x', glucose: '95', day: '2026-11-14' }, streak: 4, last: '2026-11-14' })
  assert.deepEqual(s.log, { sleep: 7.5, mood: 4, glucose: 95, day: '2026-11-14' })
  assert.equal(s.streak, 4)
  const old = normalizeCheckinState({ log: { sleep: 20 }, streak: -3, last: 'yesterday' })
  assert.deepEqual(old, { log: {}, streak: 0, last: '' })
})

test('storage: legacy flat log without the wrapper is migrated', () => {
  const s = normalizeCheckinState({ sleep: 6, mood: 3, sys: 118, dia: 76, day: '2026-11-10' })
  assert.deepEqual(s.log, { sleep: 6, mood: 3, sys: 118, dia: 76, day: '2026-11-10' })
  assert.equal(s.last, '2026-11-10')
  assert.equal(s.streak, 1)
})

test('self-report score: no answers → no score; otherwise the mean of 100 / 50 / 0 per answered item', () => {
  assert.deepEqual(selfReportScore([]), { score: null, answered: 0, of: 4 })
  assert.equal(selfReportScore(['normal']).score, 100)
  assert.equal(selfReportScore(['normal', 'warning']).score, 75)
  assert.equal(selfReportScore(['normal', 'warning', 'critical', 'critical']).score, 38)
  assert.equal(selfReportScore(['critical']).score, 0)
})

test('self-report cut-offs follow the cited guidelines', () => {
  // AASM/SRS: 7 h or more
  assert.equal(assessSleep(7).status, 'normal')
  assert.equal(assessSleep(6.5).status, 'warning')
  assert.equal(assessSleep(5.5).status, 'critical')
  // ACC/AHA 2017
  assert.equal(assessBP(118, 76).status, 'normal')
  assert.equal(assessBP(124, 76).status, 'warning', 'elevated')
  assert.equal(assessBP(118, 84).status, 'warning', 'stage 1 by diastolic')
  assert.equal(assessBP(142, 80).status, 'critical', 'stage 2')
  assert.equal(assessBP(88, 58).status, 'warning', 'low')
  // ADA
  assert.equal(assessGlucose(50).status, 'critical', 'level 2 hypoglycaemia')
  assert.equal(assessGlucose(65).status, 'warning', 'level 1 hypoglycaemia')
  assert.equal(assessGlucose(95).status, 'normal')
  assert.equal(assessGlucose(160).status, 'warning')
  assert.equal(assessGlucose(210).status, 'critical')
  assert.equal(assessMood(2).status, 'critical')
})

