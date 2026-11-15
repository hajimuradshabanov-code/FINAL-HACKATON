/** Fixed-decimal formatting that never shows "NaN", "Infinity" or "-0". */
export function formatNumber(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return '—'
  const s = v.toFixed(decimals)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}

/** Cubic ease-out tween from `from` to `to` at progress `p` (clamped to 0..1). */
export function tween(from: number, to: number, p: number): number {
  const q = Math.max(0, Math.min(1, p))
  return from + (to - from) * (1 - Math.pow(1 - q, 3))
}
