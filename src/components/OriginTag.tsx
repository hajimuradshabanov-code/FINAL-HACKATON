import type { MetricKey } from '../config/thresholds'
import type { DataOrigin } from '../data/types'
import { useTelemetrySelect } from '../hooks/useTelemetry'
import { originOf, sourceClassOf } from '../lib/provenance'

const LABEL: Record<DataOrigin, { short: string; long: string }> = {
  reported: { short: 'FEED', long: 'reported by the telemetry backend' },
  modelled: { short: 'MODEL', long: 'modelled from NASA/NOAA data' },
  simulated: { short: 'SIM', long: 'simulated value, not a measurement' },
  measured: { short: 'SENSOR', long: 'measured on you by a connected sensor' },
  self: { short: 'SELF', long: 'entered by you' },
  device: { short: 'DEVICE', long: 'read from this device' },
  none: { short: 'NO SENSOR', long: 'no instrument connected for this value' },
}

export function useOrigin(k: MetricKey): DataOrigin {
  return useTelemetrySelect((s) => originOf(s.latest?.provenance, k))
}

export const originText = (o: DataOrigin) => LABEL[o].long

/**
 * Small badge stating where a value comes from. Simulated values are hatched violet with a dashed
 * outline, modelled ones blue, measured ones solid white: three looks that cannot be confused.
 */
export function OriginTag({ k }: { k: MetricKey }) {
  const o = useOrigin(k)
  return (
    <span className={`stamp stamp-${sourceClassOf(o)}`} title={LABEL[o].long} aria-label={LABEL[o].long} style={{ fontSize: 8, padding: '0 4px', borderRadius: 3 }}>
      {LABEL[o].short}
    </span>
  )
}
