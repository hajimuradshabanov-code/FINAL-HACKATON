import { lazy, Suspense } from 'react'
import { MetricRow } from './MetricRow'
import { EcgLine } from './EcgLine'
import { useDomId } from '../hooks/useDomId'
import { ErrorBoundary } from './ErrorBoundary'
import { useSourceStrip } from './Provenance'

const SuitInspector = lazy(() => import('./SuitInspector'))

export function SuitVitalsCard({ height = 300, compact = false }: { height?: number; compact?: boolean }) {
  const headingId = useDomId('suit-h')
  const strip = useSourceStrip(['o2Tank', 'battery', 'coolantTemp', 'suitPressure', 'visorTemp', 'gloveTemp', 'bootTemp'])
  return (
    <section className={`glass rise p-5 ${strip}`} style={{ ['--i' as string]: 3 }} aria-labelledby={headingId}>
      <header className="mb-2 flex items-center justify-between">
        <h2 id={headingId} className="display text-[20px]">
          Suit &amp; Vitals
        </h2>
        <span className="label">EVA suit inspector</span>
      </header>
      <ErrorBoundary fallback={<div className="label grid place-items-center text-center" role="status" style={{ height }}>3D suit model unavailable on this device</div>}>
        <Suspense fallback={<div className="label grid place-items-center" style={{ height }}>loading 3D model…</div>}>
          <SuitInspector height={height} />
        </Suspense>
      </ErrorBoundary>
      {!compact && (
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <MetricRow k="o2Tank" visual="bar" />
          <MetricRow k="hydration" visual="bar" />
          <div className="col-span-2">
            <MetricRow k="heartRate" />
            <EcgLine height={40} className="mt-1" />
          </div>
          <div className="col-span-2">
            <MetricRow k="suitPressure" visual="spark" />
          </div>
        </div>
      )}
    </section>
  )
}
