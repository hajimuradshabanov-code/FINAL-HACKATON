/**
 * Single source of truth for every status threshold in the UI.
 * A value is "critical" outside crit.low/high, "warning" outside warn.low/high,
 * otherwise "normal". Edit numbers here, nothing else needs to change.
 *
 * `range` is only the display scale for bars / charts; it is deliberately separate from the alert
 * bands and wide enough for real values (e.g. InSight air temperature spans about -100…+20 °C).
 */
export type Status = 'normal' | 'warning' | 'critical'

export interface Band {
  low?: number
  high?: number
}

export interface MetricConfig {
  label: string
  short: string
  unit: string
  decimals: number
  /** Visual range used by bars / charts */
  range: [number, number]
  warn: Band
  crit: Band
  /** Only vitals raise alerts / toasts / timeline dots */
  alerting: boolean
}

export const METRICS = {
  heartRate:    { label: 'Heart rate',     short: 'HR',   unit: 'bpm',  decimals: 0, range: [40, 140],   warn: { low: 50,  high: 105 }, crit: { low: 42,  high: 130 }, alerting: true },
  spo2:         { label: 'Blood oxygen',   short: 'SpO₂', unit: '%',    decimals: 0, range: [85, 100],   warn: { low: 94 },              crit: { low: 90 },              alerting: true },
  hydration:    { label: 'Hydration',      short: 'H₂O',  unit: '%',    decimals: 1, range: [0, 100],    warn: { low: 40 },              crit: { low: 22 },              alerting: true },
  bodyTemp:     { label: 'Body temp',      short: 'TEMP', unit: '°C',   decimals: 1, range: [35, 39],    warn: { low: 36.0, high: 37.6 }, crit: { low: 35.4, high: 38.2 }, alerting: true },
  suitPressure: { label: 'Suit pressure',  short: 'PSI',  unit: 'psi',  decimals: 2, range: [3.6, 4.8],  warn: { low: 4.12, high: 4.5 }, crit: { low: 4.0, high: 4.6 },  alerting: true },
  radiation:    { label: 'Radiation dose', short: 'DOSE', unit: 'mSv',  decimals: 3, range: [0, 5],      warn: { high: 2.5 },            crit: { high: 4 },              alerting: true },
  signal:       { label: 'Signal',         short: 'SIG',  unit: 'dBm',  decimals: 0, range: [-70, -30],  warn: { low: -56 },             crit: { low: -64 },             alerting: false },
  wind:         { label: 'Wind',           short: 'WIND', unit: 'km/h', decimals: 0, range: [0, 60],     warn: { high: 45 },             crit: { high: 55 },             alerting: false },
  outsideTemp:  { label: 'Outside temp',   short: 'EXT',  unit: '°C',   decimals: 0, range: [-110, 20],  warn: {},                        crit: {},                       alerting: false },
  roverRange:   { label: 'Rover range',    short: 'RNG',  unit: 'km',   decimals: 1, range: [0, 14],     warn: { low: 3 },               crit: { low: 1 },               alerting: false },
  respRate:     { label: 'Respiration',    short: 'RESP', unit: '/min', decimals: 0, range: [8, 30],     warn: { low: 10, high: 24 },    crit: { low: 8,  high: 30 },    alerting: false },
  o2Tank:       { label: 'O₂ reserve',     short: 'O₂',   unit: '%',    decimals: 1, range: [0, 100],    warn: { low: 25 },              crit: { low: 10 },              alerting: false },
  battery:      { label: 'PLSS battery',   short: 'BAT',  unit: '%',    decimals: 1, range: [0, 100],    warn: { low: 25 },              crit: { low: 10 },              alerting: false },
  coolantTemp:  { label: 'Coolant loop',   short: 'COOL', unit: '°C',   decimals: 1, range: [5, 25],     warn: { high: 18 },             crit: { high: 22 },             alerting: false },
  visorTemp:    { label: 'Visor temp',     short: 'VIS',  unit: '°C',   decimals: 1, range: [-40, 30],   warn: {},                        crit: {},                       alerting: false },
  gloveTemp:    { label: 'Glove temp',     short: 'GLV',  unit: '°C',   decimals: 1, range: [0, 40],     warn: { low: 12 },              crit: { low: 5 },               alerting: false },
  bootTemp:     { label: 'Boot temp',      short: 'BOOT', unit: '°C',   decimals: 1, range: [0, 40],     warn: { low: 12 },              crit: { low: 5 },               alerting: false },
} as const satisfies Record<string, MetricConfig>

export type MetricKey = keyof typeof METRICS
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[]
export const VITAL_KEYS = METRIC_KEYS.filter((k) => METRICS[k].alerting)

export function statusOf(key: MetricKey, v: number): Status {
  const { warn, crit } = METRICS[key] as MetricConfig
  if ((crit.low !== undefined && v < crit.low) || (crit.high !== undefined && v > crit.high)) return 'critical'
  if ((warn.low !== undefined && v < warn.low) || (warn.high !== undefined && v > warn.high)) return 'warning'
  return 'normal'
}

export const STATUS_RANK: Record<Status, number> = { normal: 0, warning: 1, critical: 2 }

/** UI colours per status (kept next to thresholds so they stay in sync) */
export const STATUS_COLOR: Record<Status, string> = {
  normal: '#8FD6A4',
  warning: '#F2B04C',
  critical: '#FF4B3E',
}
