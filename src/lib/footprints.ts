import { STATUS_RANK, type Status } from '../config/thresholds'

/**
 * The walked part of the surface traverse, kept as footprints. The route is divided into
 * TRAIL_STEPS equal stretches; each stretch entered stores one footprint with the time, the heart
 * rate and the worst vital status seen on it, so the map shows where the body was under strain.
 */
export const TRAIL_STEPS = 24

export interface TrailStep {
  /** when the crew member entered this stretch, epoch ms */
  t: number
  /** worst vital status seen while on this stretch */
  status: Status
  /** heart rate on entering the stretch, bpm (NaN when there is no reading) */
  hr: number
}

/** Stretches entered at traverse progress `p` (0..1). The first print is made at the start. */
export function stepsReached(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.min(TRAIL_STEPS, Math.floor(Math.max(0, p) * TRAIL_STEPS) + 1)
}

/**
 * Add the current position to the trail. Returns the same array when nothing changed. A trail more
 * than one stretch ahead of the reported progress belongs to an earlier traverse and is dropped.
 */
export function recordStep(trail: readonly TrailStep[], progress: number, t: number, status: Status, hr: number): readonly TrailStep[] {
  const reached = stepsReached(progress)
  if (reached === 0) return trail
  const kept = reached < trail.length - 1 ? [] : trail
  if (kept.length < reached) {
    const next = kept.slice()
    while (next.length < reached) next.push({ t, status, hr })
    return next
  }
  // still on the newest stretch: it keeps the worst status seen on it
  const last = kept[kept.length - 1]
  if (kept.length === reached && STATUS_RANK[status] > STATUS_RANK[last.status]) return [...kept.slice(0, -1), { ...last, status }]
  return kept
}

export interface PathPoint {
  x: number
  y: number
  /** direction of travel, degrees */
  deg: number
}

/** Point at fraction `f` (0..1) of the length of a polyline, with the heading there. */
export function pointAlong(pts: readonly (readonly number[])[], f: number): PathPoint {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
  let d = Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0)) * seg.reduce((a, b) => a + b, 0)
  let i = 0
  // walk to the segment that holds the distance; zero-length segments are skipped
  while (i < seg.length - 1 && (d > seg[i] || seg[i] === 0)) d -= seg[i++]
  const a = pts[i]
  const b = pts[i + 1] ?? a
  const u = seg[i] > 0 ? Math.min(1, d / seg[i]) : 0
  return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, deg: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI }
}

export interface Footprint extends PathPoint, TrailStep {
  /** fraction of the route at which the print lies */
  at: number
}

/** Lay the trail out as alternating left / right prints, `halfGap` to either side of the path. */
export function layFootprints(pts: readonly (readonly number[])[], trail: readonly TrailStep[], halfGap: number): Footprint[] {
  return trail.map((step, i) => {
    const at = i / TRAIL_STEPS
    const p = pointAlong(pts, at)
    const side = i % 2 === 0 ? -1 : 1
    const rad = (p.deg * Math.PI) / 180
    return { ...step, at, x: p.x - Math.sin(rad) * side * halfGap, y: p.y + Math.cos(rad) * side * halfGap, deg: p.deg + side * 9 }
  })
}
