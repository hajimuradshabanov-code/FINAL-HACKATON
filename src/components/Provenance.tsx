import type { MetricKey } from '../config/thresholds'
import { useTelemetrySelect } from '../hooks/useTelemetry'
import { mixSources, originOf } from '../lib/provenance'

/** Class names for the provenance strip along the top edge of a card showing these metrics. */
export function useSourceStrip(keys: readonly MetricKey[]): string {
  const cls = useTelemetrySelect((s) => (s.latest ? mixSources(keys.map((k) => originOf(s.latest!.provenance, k))) : 'none'))
  return `src src-${cls}`
}
