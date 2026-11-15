import { memo } from 'react'
import { METRICS, STATUS_COLOR, type MetricKey } from '../config/thresholds'
import { useTelemetrySelect } from '../hooks/useTelemetry'
import { AnimatedNumber } from './AnimatedNumber'
import { formatNumber } from '../lib/format'
import { OriginTag } from './OriginTag'
import { alertBand } from '../lib/health'

export function Bar({ value, range, status }: { value: number; range: [number, number]; status: keyof typeof STATUS_COLOR }) {
  const raw = ((value - range[0]) / (range[1] - range[0])) * 100
  const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0
  return (
    <div className="relative h-[3px] w-full rounded-full" style={{ background: 'rgba(255,255,255,.1)' }} aria-hidden="true">
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${pct}%`, background: STATUS_COLOR[status], transition: 'width .5s linear, background .3s', boxShadow: `0 0 10px ${STATUS_COLOR[status]}` }}
      />
    </div>
  )
}

export function BarSpark({ data, range, status }: { data: number[]; range: [number, number]; status: keyof typeof STATUS_COLOR }) {
  const bars = data.filter(Number.isFinite).slice(-24)
  return (
    <div className="flex h-[22px] items-end gap-[2px]" aria-hidden="true">
      {bars.map((v, i) => {
        const r = ((v - range[0]) / (range[1] - range[0])) * 100
        const h = Number.isFinite(r) ? Math.max(8, Math.min(100, r)) : 8
        return <span key={i} style={{ height: `${h}%`, width: 3, background: STATUS_COLOR[status], opacity: 0.25 + (i / bars.length) * 0.75, borderRadius: 1 }} />
      })}
    </div>
  )
}

/** The small print under a value: its fixed alert band (an app setting, not a clinical limit). */
export function MetricMeta({ k }: { k: MetricKey }) {
  const band = alertBand(k)
  if (!band) return null
  return (
    <div className="label num mt-1" style={{ fontSize: 8.5, letterSpacing: '.1em' }}>
      band {band} {METRICS[k].unit}
    </div>
  )
}

interface Props {
  k: MetricKey
  visual?: 'bar' | 'spark' | 'none'
  size?: 'md' | 'lg'
  /** override range for the visual */
  range?: [number, number]
}

/** Label + live value + status dot (+ bar / sparkline). Re-renders only when its own value changes. */
export const MetricRow = memo(function MetricRow({ k, visual = 'none', size = 'md', range }: Props) {
  const cfg = METRICS[k]
  const value = useTelemetrySelect((s) => s.latest?.[k] ?? NaN)
  const status = useTelemetrySelect((s) => s.statuses[k])
  const history = useTelemetrySelect((s) => s.history[k])
  const r = range ?? (cfg.range as [number, number])

  return (
    <div data-status={status} aria-label={`${cfg.label} ${formatNumber(value, cfg.decimals)} ${cfg.unit}, ${status}`} role="group">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label flex items-center gap-2">
          <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: 'var(--s)', boxShadow: status === 'normal' ? 'none' : '0 0 8px var(--s)' }} />
          {cfg.label}
          <OriginTag k={k} />
        </span>
        <span className="flex items-baseline gap-1">
          <AnimatedNumber value={value} decimals={cfg.decimals} className={`display ${size === 'lg' ? 'text-[34px]' : 'text-[24px]'} leading-none`} />
          <span className="unit">{cfg.unit}</span>
        </span>
      </div>
      <MetricMeta k={k} />
      {visual === 'bar' && (
        <div className="mt-2">
          <Bar value={value} range={r} status={status} />
        </div>
      )}
      {visual === 'spark' && (
        <div className="mt-2 flex justify-end">
          <BarSpark data={history} range={r} status={status} />
        </div>
      )}
    </div>
  )
})
