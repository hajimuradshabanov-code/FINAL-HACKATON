import { VITAL_KEYS, STATUS_RANK, type Status } from '../config/thresholds'
import { useDataMode, useTelemetrySelect } from '../hooks/useTelemetry'
import { isSimulation } from '../data/createSource'
import { OriginTag } from './OriginTag'
import { MetricMeta, MetricRow } from './MetricRow'
import { useSourceStrip } from './Provenance'
import { EcgLine } from './EcgLine'
import { AnimatedNumber } from './AnimatedNumber'
import { useDomId } from '../hooks/useDomId'
import { useSession } from '../auth/useAuth'

function useWorstVital(): Status {
  return useTelemetrySelect((s) =>
    VITAL_KEYS.reduce<Status>((w, k) => (STATUS_RANK[s.statuses[k]] > STATUS_RANK[w] ? s.statuses[k] : w), 'normal'),
  )
}

/** What the trace under the heart rate is showing right now. */
function useTraceCaption(): string {
  const mode = useDataMode()
  if (isSimulation(mode)) return 'Simulated rhythm, not a recording'
  if (mode === 'ws') return 'Heart rate from the telemetry backend · last 2 min'
  return 'No pulse sensor connected'
}

function HeartBlock() {
  const hr = useTelemetrySelect((s) => s.latest?.heartRate ?? NaN)
  const st = useTelemetrySelect((s) => s.statuses.heartRate)
  const caption = useTraceCaption()
  return (
    <div data-status={st}>
      <div className="flex items-end justify-between">
        <div>
          <div className="label flex items-center gap-2">
            <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: 'var(--s)', boxShadow: '0 0 8px var(--s)' }} />
            Heart rate
            <OriginTag k="heartRate" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <AnimatedNumber value={hr} className="display text-[56px] leading-[0.95]" />
            <span className="unit">bpm</span>
          </div>
          <MetricMeta k="heartRate" />
        </div>
        <span className="label" style={{ color: 'var(--s)' }}>
          {Number.isFinite(hr) ? st : 'no reading'}
        </span>
      </div>
      <EcgLine height={62} className="mt-2" />
      <p className="label mt-1" style={{ fontSize: 9 }}>
        {caption}
      </p>
    </div>
  )
}

export function VitalsCard({ index = 0 }: { index?: number }) {
  const worst = useWorstVital()
  const headingId = useDomId('vitals-h')
  const session = useSession()
  const mode = useDataMode()
  // a suit only exists in the simulation and on a telemetry backend; live mode shows what is measured on the person
  const suit = mode !== 'live'
  const strip = useSourceStrip(suit ? ['heartRate', 'spo2', 'hydration', 'bodyTemp', 'radiation', 'suitPressure'] : ['heartRate', 'spo2', 'hydration', 'bodyTemp', 'radiation', 'respRate'])
  const who = suit ? (session && !session.guest ? `EVA-1 · ${session.name}` : 'EVA-1') : session && !session.guest ? session.name : 'Guest'
  return (
    <section data-status={worst} aria-labelledby={headingId} className={`glass rise p-4 ${strip}`} style={{ ['--i' as string]: index }}>
      <header className="mb-3 flex items-center justify-between">
        <h2 id={headingId} className="display text-[20px]">
          Crew Vitals
        </h2>
        <span className="label max-w-[50%] truncate">{who}</span>
      </header>
      <HeartBlock />
      <div className="my-3 h-px" style={{ background: 'var(--hair)' }} />
      <div className="grid gap-4">
        <MetricRow k="spo2" visual="bar" />
        <MetricRow k="hydration" visual="bar" />
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <MetricRow k="bodyTemp" />
          <MetricRow k="radiation" />
        </div>
        {suit ? <MetricRow k="suitPressure" visual="spark" /> : <MetricRow k="respRate" visual="spark" />}
      </div>
    </section>
  )
}
