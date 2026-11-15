import { memo, useState } from 'react'
import { METRICS, STATUS_COLOR, type MetricConfig, type MetricKey } from '../config/thresholds'
import { HISTORY_WINDOW_MS } from '../data/store'
import { useDataMode, useTelemetrySelect } from '../hooks/useTelemetry'
import { useDomId } from '../hooks/useDomId'
import { buildTimeline } from '../lib/timeline'
import { windowStats } from '../lib/health'
import { formatNumber } from '../lib/format'
import { useSourceStrip } from './Provenance'

const W = 380
const H = 210
const BOX = { width: W, height: H, pad: { l: 36, r: 12, t: 14, b: 28 } }
const KEYS: MetricKey[] = ['heartRate', 'spo2', 'suitPressure', 'hydration']
/** live mode has no suit: respiration takes the place of suit pressure */
const LIVE_KEYS: MetricKey[] = ['heartRate', 'respRate', 'spo2', 'hydration']
const fmt = (t: number) => new Date(t).toISOString().slice(11, 19)

export const TimelineChart = memo(function TimelineChart() {
  const live = useDataMode() === 'live'
  const keys = live ? LIVE_KEYS : KEYS
  const [picked, setKey] = useState<MetricKey>('heartRate')
  const key = keys.includes(picked) ? picked : 'heartRate'
  const data = useTelemetrySelect((s) => s.history[key])
  const times = useTelemetrySelect((s) => s.times)
  const events = useTelemetrySelect((s) => s.events)
  const status = useTelemetrySelect((s) => s.statuses[key])
  const cfg: MetricConfig = METRICS[key]
  const headingId = useDomId('tl-h')
  const fillId = useDomId('tl-fill')
  const strip = useSourceStrip([key])
  const stats = windowStats(data)

  const g = buildTimeline({ times, values: data, windowMs: HISTORY_WINDOW_MS, box: BOX, warn: cfg.warn, minPad: key === 'suitPressure' ? 0.05 : 1 })
  const color = STATUS_COLOR[status]
  const last = g.points[g.points.length - 1]
  // events are pinned to the first sample at or after the event, inside the visible window
  const dots = g.empty
    ? []
    : events
        .filter((e) => e.key === key && e.t >= g.start && e.t <= g.end)
        .map((e) => ({ e, p: g.points.find((p) => p.t >= e.t) }))
        .filter((d): d is { e: (typeof events)[number]; p: NonNullable<typeof d.p> } => d.p !== undefined)

  return (
    <section className={`glass rise p-5 ${strip}`} style={{ ['--i' as string]: 2 }} aria-labelledby={headingId}>
      <header className="mb-3 flex items-center justify-between">
        <h2 id={headingId} className="display text-[20px]">
          {live ? 'Measured timeline' : 'Vital timeline'}
        </h2>
        <span className="label">last {Math.round(HISTORY_WINDOW_MS / 1000)} s · UTC</span>
      </header>
      <div className="mb-3 flex gap-1.5" role="tablist">
        {keys.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={k === key}
            onClick={() => setKey(k)}
            className="label rounded-full px-3 py-1"
            style={{ border: '1px solid', borderColor: k === key ? 'var(--lava)' : 'var(--hair)', color: k === key ? 'var(--ink)' : 'var(--taupe)', background: k === key ? 'rgba(255,106,31,.12)' : 'transparent', cursor: 'pointer' }}
          >
            {METRICS[k].short}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={g.empty ? `${cfg.label}: waiting for telemetry` : `${cfg.label} over the last two minutes`}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {g.empty ? (
          <text x={W / 2} y={H / 2} textAnchor="middle" fill="#a8978a" fontSize="11" fontFamily="IBM Plex Mono" letterSpacing="1.5">
            {live ? `NO ${cfg.label.toUpperCase()} READINGS IN THE LAST 2 MIN` : 'WAITING FOR TELEMETRY…'}
          </text>
        ) : (
          <>
            <text x={BOX.pad.l} y={9} fill="#a8978a" fontSize="8.5" fontFamily="IBM Plex Mono" letterSpacing="1">
              {cfg.unit}
            </text>
            {strip.endsWith('sim') && (
              <text x={W - BOX.pad.r} y={9} textAnchor="end" fill="#c9a8ff" fontSize="8.5" fontFamily="IBM Plex Mono" letterSpacing="1.5">
                SIMULATED SIGNAL
              </text>
            )}
            {[0, 1, 2, 3].map((i) => {
              const v = g.lo + ((g.hi - g.lo) * i) / 3
              return (
                <g key={i}>
                  <line x1={BOX.pad.l} x2={W - BOX.pad.r} y1={g.y(v)} y2={g.y(v)} stroke="rgba(255,255,255,.07)" />
                  <text x={BOX.pad.l - 6} y={g.y(v) + 3} textAnchor="end" fill="#a8978a" fontSize="9" fontFamily="IBM Plex Mono">
                    {v.toFixed(cfg.decimals > 1 ? 1 : 0)}
                  </text>
                </g>
              )
            })}
            {cfg.warn.high !== undefined && cfg.warn.high < g.hi && (
              <line x1={BOX.pad.l} x2={W - BOX.pad.r} y1={g.y(cfg.warn.high)} y2={g.y(cfg.warn.high)} stroke="#f2b04c" strokeDasharray="3 4" opacity=".6" />
            )}
            {cfg.warn.low !== undefined && cfg.warn.low > g.lo && (
              <line x1={BOX.pad.l} x2={W - BOX.pad.r} y1={g.y(cfg.warn.low)} y2={g.y(cfg.warn.low)} stroke="#f2b04c" strokeDasharray="3 4" opacity=".6" />
            )}
            {g.areas.map((d, i) => (
              <path key={`a${i}`} d={d} fill={`url(#${fillId})`} />
            ))}
            {g.lines.map((d, i) => (
              <path key={`l${i}`} d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
            ))}
            {dots.map(({ e, p }) => {
              const c = e.level === 'resolved' ? STATUS_COLOR.normal : STATUS_COLOR[e.level]
              return (
                <g key={e.id}>
                  <circle cx={p.x} cy={p.y} r="6" fill={c} opacity=".25" />
                  <circle cx={p.x} cy={p.y} r="3.2" fill={c} stroke="#14100e" strokeWidth="1">
                    <title>{`${fmt(e.t)} UTC — ${e.label}`}</title>
                  </circle>
                </g>
              )
            })}
            {last && <circle cx={last.x} cy={last.y} r="3" fill={color} />}
            {g.ticks.map((t, i) => (
              <text key={i} x={g.x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === g.ticks.length - 1 ? 'end' : 'middle'} fill="#a8978a" fontSize="8.5" fontFamily="IBM Plex Mono">
                {fmt(t)}
              </text>
            ))}
          </>
        )}
      </svg>
      {stats && (
        <p className="label num mt-2" style={{ color: 'var(--ink)' }}>
          n = {stats.n} · mean {formatNumber(stats.mean, cfg.decimals + 1)} · SD {formatNumber(stats.sd, cfg.decimals + 1)} · range {formatNumber(stats.min, cfg.decimals)}–{formatNumber(stats.max, cfg.decimals)} {cfg.unit}
        </p>
      )}
      <div className="mt-3 flex gap-4">
        {[
          ['Nominal', STATUS_COLOR.normal],
          ['Warning', STATUS_COLOR.warning],
          ['Critical', STATUS_COLOR.critical],
        ].map(([l, c]) => (
          <span key={l} className="label flex items-center gap-1.5">
            <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    </section>
  )
})
