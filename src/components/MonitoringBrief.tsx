import { METRIC_KEYS, VITAL_KEYS } from '../config/thresholds'
import { useDomId } from '../hooks/useDomId'

const STEPS = [
  ['Measure', `${VITAL_KEYS.length} vitals and ${METRIC_KEYS.length - VITAL_KEYS.length} suit and environment channels, one sample per second, each tagged with where it comes from.`],
  ['Detect', 'Four detectors on every sample: fixed alert bands, a personal baseline, a trend forecast and a joint test across vitals.'],
  ['Advise', 'Every warning comes with a plain action to take first, because the crew member cannot wait for an answer from Earth.'],
  ['Record', 'An alert journal, an event timeline, a daily check-in and a footprint map of the traverse.'],
] as const

/** The challenge is "create health monitoring software": what this software does, in four steps. */
export function MonitoringBrief({ layout, index = 0 }: { layout: 'desktop' | 'mobile'; index?: number }) {
  const headingId = useDomId('brief-h')
  return (
    <section className="glass rise p-5" aria-labelledby={headingId} style={{ ['--i' as string]: index }}>
      <h2 id={headingId} className="display mb-3 text-[20px]">
        How this software monitors health
      </h2>
      <ol className={layout === 'desktop' ? 'grid grid-cols-4 gap-5' : 'grid gap-3'}>
        {STEPS.map(([title, body], i) => (
          <li key={title}>
            <div className="label" style={{ color: 'var(--ink)', fontSize: 11 }}>
              <span style={{ color: 'var(--lava)' }}>{i + 1}</span> {title}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--ink)', opacity: 0.88 }}>
              {body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
