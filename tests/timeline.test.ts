import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTimeline } from '../src/lib/timeline'

const box = { width: 380, height: 210, pad: { l: 36, r: 12, t: 14, b: 28 } }
const allFinite = (g: ReturnType<typeof buildTimeline>) => {
  const nums = [g.lo, g.hi, ...g.points.flatMap((p) => [p.x, p.y]), ...g.ticks.map(g.x), g.y(g.lo), g.y(g.hi)]
  const strings = [...g.lines, ...g.areas].join(' ')
  return nums.every(Number.isFinite) && !/NaN|Infinity/.test(strings)
}

test('empty data: no NaN/Infinity, flagged empty, no paths', () => {
  for (const warn of [{}, { low: 40 }, { high: 105 }, { low: 50, high: 105 }]) {
    const g = buildTimeline({ times: [], values: [], windowMs: 120_000, box, warn })
    assert.equal(g.empty, true)
    assert.equal(g.lines.length, 0)
    assert.ok(allFinite(g), JSON.stringify(warn))
  }
})

test('one point and constant series have a finite, non-zero range', () => {
  const one = buildTimeline({ times: [1000], values: [72], windowMs: 120_000, box })
  assert.equal(one.points.length, 1)
  assert.ok(one.hi > one.lo)
  assert.ok(allFinite(one))
  const flat = buildTimeline({ times: [1000, 2000, 3000], values: [4.3, 4.3, 4.3], windowMs: 120_000, box, minPad: 0.05 })
  assert.ok(flat.hi - flat.lo > 0)
  assert.ok(allFinite(flat))
})

test('non-finite values are skipped and split the line', () => {
  const g = buildTimeline({ times: [1000, 2000, 3000, 4000, 5000], values: [70, 71, NaN, 73, 74], windowMs: 120_000, box })
  assert.equal(g.points.length, 4)
  assert.equal(g.lines.length, 2)
  assert.ok(allFinite(g))
})

test('points are placed by real time: irregular intervals and long gaps', () => {
  // 1 Hz, then a 40 s pause (throttled background tab), then 1 Hz again
  const times = [0, 1, 2, 3, 43, 44, 45].map((s) => 100_000 + s * 1000)
  const g = buildTimeline({ times, values: times.map(() => 72), windowMs: 120_000, box })
  assert.equal(g.lines.length, 2, 'gap breaks the line')
  const dx = (a: number, b: number) => g.points[b].x - g.points[a].x
  assert.ok(Math.abs(dx(3, 4) - 40 * dx(0, 1)) < 1e-6, 'x distance proportional to elapsed time')
  assert.equal(g.points[g.points.length - 1].x, box.width - box.pad.r, 'newest sample at the right edge')
})

test('samples older than the window are dropped', () => {
  const g = buildTimeline({ times: [0, 100_000, 200_000], values: [1, 2, 3], windowMs: 120_000, box })
  assert.deepEqual(g.points.map((p) => p.v), [2, 3])
})

test('mismatched array lengths do not throw', () => {
  const g = buildTimeline({ times: [1, 2, 3], values: [5], windowMs: 1000, box })
  assert.equal(g.points.length, 1)
  assert.ok(allFinite(g))
})
