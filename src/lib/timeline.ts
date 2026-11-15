import type { Band } from '../config/thresholds'

export interface TimelineBox {
  width: number
  height: number
  pad: { l: number; r: number; t: number; b: number }
}

export interface TimelineInput {
  /** sample times (epoch ms), aligned index-for-index with `values` */
  times: readonly number[]
  values: readonly number[]
  /** visible time span ending at the newest sample */
  windowMs: number
  box: TimelineBox
  /** warning band is always kept in view so the threshold lines are visible */
  warn?: Band
  /** minimum vertical padding in value units */
  minPad?: number
  /** explicit right edge of the window; defaults to the newest finite sample time */
  end?: number
}

export interface TimelinePoint {
  /** index into the input arrays */
  i: number
  t: number
  v: number
  x: number
  y: number
}

export interface TimelineGeometry {
  empty: boolean
  lo: number
  hi: number
  start: number
  end: number
  /** visible points with finite values, oldest first */
  points: TimelinePoint[]
  /** one SVG path per contiguous run; a new run starts after a gap */
  lines: string[]
  areas: string[]
  /** x for a time, y for a value (both always finite) */
  x: (t: number) => number
  y: (v: number) => number
  /** axis tick times within the window */
  ticks: number[]
  gapMs: number
}

const finite = (n: number) => Number.isFinite(n)

function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Compute chart geometry from timestamped samples. Points are placed by their real time, so
 * irregular intervals and gaps (throttled background tabs, dropped frames, missing metrics) are
 * drawn as gaps rather than squeezed together. Never produces NaN or Infinity coordinates.
 */
export function buildTimeline({ times, values, windowMs, box, warn = {}, minPad = 1, end: endIn }: TimelineInput): TimelineGeometry {
  const { width: W, height: H, pad } = box
  const n = Math.min(times.length, values.length)

  let newest = -Infinity
  for (let i = 0; i < n; i++) if (finite(times[i]) && finite(values[i]) && times[i] > newest) newest = times[i]
  const end = endIn !== undefined && finite(endIn) ? endIn : finite(newest) ? newest : 0
  const span = windowMs > 0 && finite(windowMs) ? windowMs : 1
  const start = end - span

  const raw: { i: number; t: number; v: number }[] = []
  for (let i = 0; i < n; i++) {
    const t = times[i]
    const v = values[i]
    if (finite(t) && finite(v) && t >= start && t <= end) raw.push({ i, t, v })
  }
  raw.sort((a, b) => a.t - b.t)

  // value range: data plus the warning band, padded; constant series get a fixed pad
  let lo0 = Infinity
  let hi0 = -Infinity
  for (const p of raw) {
    if (p.v < lo0) lo0 = p.v
    if (p.v > hi0) hi0 = p.v
  }
  if (warn.low !== undefined && finite(warn.low)) lo0 = Math.min(lo0, warn.low)
  if (warn.high !== undefined && finite(warn.high)) hi0 = Math.max(hi0, warn.high)
  if (!finite(lo0) && !finite(hi0)) {
    lo0 = 0
    hi0 = 1
  } else if (!finite(lo0)) lo0 = hi0
  else if (!finite(hi0)) hi0 = lo0
  const padv = Math.max((hi0 - lo0) * 0.15, minPad > 0 ? minPad : 1)
  const lo = lo0 - padv
  const hi = hi0 + padv

  const innerW = Math.max(1, W - pad.l - pad.r)
  const innerH = Math.max(1, H - pad.t - pad.b)
  const x = (t: number) => {
    const r = (t - start) / span
    return pad.l + (finite(r) ? Math.min(1, Math.max(0, r)) : 0) * innerW
  }
  const y = (v: number) => {
    const r = (v - lo) / (hi - lo)
    return pad.t + (1 - (finite(r) ? r : 0.5)) * innerH
  }

  const points: TimelinePoint[] = raw.map((p) => ({ ...p, x: x(p.t), y: y(p.v) }))

  // a gap is a jump of more than 3x the typical interval (at least 2.5 s), or a missing value in between
  const deltas: number[] = []
  for (let k = 1; k < points.length; k++) deltas.push(points[k].t - points[k - 1].t)
  const typical = median(deltas)
  const gapMs = Math.max(2500, finite(typical) ? typical * 3 : 2500)

  const runs: TimelinePoint[][] = []
  for (const p of points) {
    const run = runs[runs.length - 1]
    const prev = run?.[run.length - 1]
    if (!prev || p.t - prev.t > gapMs || p.i - prev.i > 1) runs.push([p])
    else run.push(p)
  }
  const fmt = (p: TimelinePoint) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  const base = (H - pad.b).toFixed(1)
  const lines = runs.map((r) => 'M' + r.map(fmt).join('L'))
  const areas = runs.filter((r) => r.length > 1).map((r) => `M${fmt(r[0])}L${r.slice(1).map(fmt).join('L')}L${r[r.length - 1].x.toFixed(1)} ${base}L${r[0].x.toFixed(1)} ${base}Z`)

  const ticks = points.length ? [0, 0.25, 0.5, 0.75, 1].map((f) => start + f * span) : []

  return { empty: points.length === 0, lo, hi, start, end, points, lines, areas, x, y, ticks, gapMs }
}
