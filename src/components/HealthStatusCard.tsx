import { HeartPulse } from 'lucide-react'
import { METRICS, STATUS_COLOR, type MetricKey } from '../config/thresholds'
import { GUIDE } from '../config/guidance'
import { useDataMode, useTelemetry } from '../hooks/useTelemetry'
import { useDomId } from '../hooks/useDomId'
import { formatNumber } from '../lib/format'
import { BODY_KEYS, summariseHealth, type HealthLevel, type HealthSummary } from '../lib/health'
import { useSourceStrip } from './Provenance'

const LEVEL: Record<HealthLevel, { word: string; color: string; status: 'normal' | 'warning' | 'critical' }> = {
  nominal: { word: 'Nominal', color: STATUS_COLOR.normal, status: 'normal' },
  watch: { word: 'Watch', color: STATUS_COLOR.warning, status: 'normal' },
  warning: { word: 'Attention', color: STATUS_COLOR.warning, status: 'warning' },
  critical: { word: 'Act now', color: STATUS_COLOR.critical, status: 'critical' },
  nodata: { word: 'No data', color: 'var(--taupe)', status: 'normal' },
}

const names = (keys: readonly MetricKey[]) => keys.map((k) => METRICS[k].label.toLowerCase()).join(', ')

/** One sentence: what the state means and, when something is wrong, what to do first. */
function sentence(h: HealthSummary, latest: Partial<Record<MetricKey, number>> | null, live: boolean): string {
  if (h.level === 'nodata') return live ? 'No body sensor is connected in live mode, so there is nothing to assess. The modelled radiation dose is still tracked.' : 'Waiting for the first readings.'
  if (h.level === 'critical' || h.level === 'warning') {
    const k = h.outOfBand[0]
    const c = METRICS[k]
    const more = h.outOfBand.length > 1 ? ` (and ${h.outOfBand.length - 1} more)` : ''
    return `${c.label} is outside its alert band: ${formatNumber(latest?.[k] ?? NaN, c.decimals)} ${c.unit}${more}. ${GUIDE[k]?.act[h.level] ?? ''}`
  }
  if (h.level === 'watch') {
    const why = [
      h.personal.length ? `${names(h.personal)} ${h.personal.length > 1 ? 'are' : 'is'} unusual for you` : '',
      h.trending.length ? `${names(h.trending)} ${h.trending.length > 1 ? 'are' : 'is'} heading for a warning level` : '',
      h.joint ? 'several vitals are shifting together' : '',
    ].filter(Boolean)
    return `Every vital is inside its alert band, but ${why.join('; ')}. Re-check in a minute and note how you feel.`
  }
  return `All ${h.measured.length} monitored vitals are inside their alert bands and close to your own norm.`
}

/** The answer to "how is the crew member right now?": one state, the reason for it, and what each detector reports. */
export function HealthStatusCard({ index = 0 }: { index?: number }) {
  const { latest, statuses, science } = useTelemetry()
  const live = useDataMode() === 'live'
  const h = summariseHealth(latest, statuses, science)
  const L = LEVEL[h.level]
  const strip = useSourceStrip(BODY_KEYS)
  const headingId = useDomId('hs-h')
  const detectors: [string, number][] = [
    ['Fixed alert bands', h.outOfBand.length],
    ['Personal baseline', h.personal.length],
    ['Trend forecast', h.trending.length],
    ['Joint test', h.joint ? 1 : 0],
  ]

  return (
    <section data-status={L.status} aria-labelledby={headingId} className={`glass rise grid gap-4 p-5 ${strip}`} style={{ ['--i' as string]: index }}>
      <h2 id={headingId} className="label flex items-center gap-2" style={{ color: 'var(--ink)', fontSize: 11 }}>
        <HeartPulse size={15} /> Health status
      </h2>
      <div role="status" aria-live="polite">
        <div className="display leading-[0.95]" style={{ color: L.color, fontSize: 60 }}>
          {L.word}
        </div>
        <p className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--ink)' }}>
          {sentence(h, latest, live)}
        </p>
      </div>
      {h.level !== 'nodata' && (
        <div className="grid gap-1.5 border-t pt-3" style={{ borderColor: 'var(--hair)' }}>
          {detectors.map(([name, flagged]) => {
            const color = flagged ? STATUS_COLOR.warning : STATUS_COLOR.normal
            return (
              <div key={name} className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink)' }}>
                  <span className="inline-block h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: color }} />
                  {name}
                </span>
                <span className="label num" style={{ color }}>
                  {flagged ? `${flagged} flagged` : 'clear'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
