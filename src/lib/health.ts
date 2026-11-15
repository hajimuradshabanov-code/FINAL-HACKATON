import { METRICS, STATUS_RANK, VITAL_KEYS, type MetricConfig, type MetricKey, type Status } from '../config/thresholds'
import { BASELINE_KEYS } from '../science/baseline'
import type { ScienceState } from '../science/engine'

/**
 * One overall health state for the crew member, from what the detectors report.
 *
 *   critical / warning  a vital is outside its fixed alert band (the worst one decides)
 *   watch               every vital is inside its band, but the personal baseline, the trend
 *                       forecast or the joint test reports something
 *   nominal             nothing reports
 *   nodata              no vital of the body is being measured, so nothing can be said
 *
 * It is a category, not a score: no number is invented from the vitals.
 */
export type HealthLevel = 'critical' | 'warning' | 'watch' | 'nominal' | 'nodata'

/** Vitals that describe the person. A modelled dose or a suit reading alone cannot make someone "nominal". */
export const BODY_KEYS: readonly MetricKey[] = VITAL_KEYS.filter((k) => k !== 'radiation' && k !== 'suitPressure')

export interface HealthSummary {
  level: HealthLevel
  /** vitals outside their alert band, worst first */
  outOfBand: MetricKey[]
  /** vitals away from the crew member's own norm while still inside the band */
  personal: MetricKey[]
  /** vitals heading for their warning level */
  trending: MetricKey[]
  /** several vitals deviating together */
  joint: boolean
  /** vitals that currently have a value */
  measured: MetricKey[]
}

export function summariseHealth(
  latest: Partial<Record<MetricKey, number>> | null,
  statuses: Readonly<Record<MetricKey, Status>>,
  science: Pick<ScienceState, 'baseline' | 'forecasts' | 'joint'>,
): HealthSummary {
  const measured = VITAL_KEYS.filter((k) => Number.isFinite(latest?.[k]))
  const outOfBand = measured.filter((k) => statuses[k] !== 'normal').sort((a, b) => STATUS_RANK[statuses[b]] - STATUS_RANK[statuses[a]])
  const readings = science.baseline ? BASELINE_KEYS.map((k) => science.baseline![k]) : []
  const personal = readings.filter((r) => r.deviating && statuses[r.key] === 'normal').map((r) => r.key as MetricKey)
  const trending = science.forecasts.filter((f) => statuses[f.key] === 'normal').map((f) => f.key)
  const joint = !!science.joint?.flagged
  const body = measured.filter((k) => BODY_KEYS.includes(k))

  let level: HealthLevel
  if (outOfBand.length) level = statuses[outOfBand[0]] === 'critical' ? 'critical' : 'warning'
  else if (body.length === 0) level = 'nodata'
  else if (personal.length || trending.length || joint) level = 'watch'
  else level = 'nominal'

  return { level, outOfBand, personal, trending, joint, measured }
}

const plain = (v: number) => String(Number(v.toFixed(2)))

/** The fixed alert band of a metric as text: "50–105", "≥ 94", "≤ 2.5", or "" when it has none. */
export function alertBand(key: MetricKey): string {
  const { warn } = METRICS[key] as MetricConfig
  if (warn.low !== undefined && warn.high !== undefined) return `${plain(warn.low)}–${plain(warn.high)}`
  if (warn.low !== undefined) return `≥ ${plain(warn.low)}`
  if (warn.high !== undefined) return `≤ ${plain(warn.high)}`
  return ''
}

/** Mean, standard deviation and range of the finite values in a window. */
export function windowStats(values: readonly number[]): { n: number; mean: number; sd: number; min: number; max: number } | null {
  const xs = values.filter(Number.isFinite)
  if (xs.length === 0) return null
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const variance = xs.length > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) : 0
  return { n: xs.length, mean, sd: Math.sqrt(variance), min: Math.min(...xs), max: Math.max(...xs) }
}
