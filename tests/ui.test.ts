import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { formatNumber, tween } from '../src/lib/format'
import { toDomId } from '../src/hooks/useDomId'

test('formatNumber never shows NaN, Infinity or -0', () => {
  assert.equal(formatNumber(NaN), '—')
  assert.equal(formatNumber(Infinity, 2), '—')
  assert.equal(formatNumber(-0.04, 1), '0.0')
  assert.equal(formatNumber(-0.4), '0')
  assert.equal(formatNumber(-1.26, 1), '-1.3')
  assert.equal(formatNumber(4.305, 2), (4.305).toFixed(2))
})

test('tween eases from → to and clamps progress', () => {
  assert.equal(tween(10, 20, 0), 10)
  assert.equal(tween(10, 20, 1), 20)
  assert.equal(tween(10, 20, 5), 20)
  assert.equal(tween(10, 20, -1), 10)
  assert.ok(tween(10, 20, 0.5) > 15, 'ease-out is past halfway at p=0.5')
})

test('React ids are sanitised for HTML ids and url(#…) references', () => {
  for (const raw of [':r1:', '«r2»', '_r_3_', 'r4']) {
    const id = toDomId('tl-fill', raw)
    assert.match(id, /^[A-Za-z0-9_-]+$/)
  }
  assert.notEqual(toDomId('x', ':r1:'), toDomId('x', ':r2:'))
})

test('components use per-instance ids: no hard-coded id="…" or url(#…) literals', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'components')
  const offenders: string[] = []
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
    const src = readFileSync(join(dir, f), 'utf8')
    for (const m of src.matchAll(/\bid="[^"]+"|url\(#[A-Za-z]/g)) offenders.push(`${f}: ${m[0]}`)
  }
  assert.deepEqual(offenders, [])
})

test('AnimatedNumber renders through React only (no direct DOM text writes)', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'AnimatedNumber.tsx'), 'utf8')
  assert.ok(!/textContent|innerHTML|innerText/.test(src))
  assert.ok(/cancelAnimationFrame/.test(src), 'animation frame is cancelled on cleanup / value change')
})
