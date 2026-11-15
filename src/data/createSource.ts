import type { TelemetrySource } from './types'
import { SimulatedSource } from './telemetrySimulator'
import { NasaSource } from './nasaSource'
import { WebSocketSource } from './webSocketSource'
import { LiveSource } from './liveSource'

/**
 *  - `live`  real data only: Mars weather and radiation from NASA/NOAA feeds; no body or suit sensors
 *  - `nasa`  (default) training simulation: a simulated crew member in the real NASA/NOAA environment
 *  - `sim`   fully simulated telemetry
 *  - `ws`    telemetry from a WebSocket backend
 */
export type DataMode = 'live' | 'nasa' | 'sim' | 'ws'
const MODES: readonly DataMode[] = ['live', 'nasa', 'sim', 'ws']
export const isDataMode = (v: unknown): v is DataMode => MODES.includes(v as DataMode)
/** modes in which values are generated rather than measured */
export const isSimulation = (m: DataMode) => m === 'nasa' || m === 'sim'

export const MODE_STORAGE_KEY = 'area51.mode.v1'

/** Mode from the build configuration: VITE_DATA_SOURCE=live | nasa | sim | ws (default nasa). */
export function configuredMode(): DataMode {
  const v = import.meta.env?.VITE_DATA_SOURCE
  return isDataMode(v) ? v : 'nasa'
}

const stored = (): DataMode | null => {
  try {
    const v = globalThis.localStorage?.getItem(MODE_STORAGE_KEY)
    return isDataMode(v) ? v : null
  } catch {
    return null
  }
}

let mode: DataMode = stored() ?? configuredMode()
const listeners = new Set<() => void>()

/** The data mode in use: the choice made in the menu on this browser, otherwise the configured one. */
export const dataMode = (): DataMode => mode

export const modeStore = {
  get: dataMode,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  set(next: DataMode) {
    if (next === mode) return
    mode = next
    try {
      globalThis.localStorage?.setItem(MODE_STORAGE_KEY, next)
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
    listeners.forEach((l) => l())
  },
}

/** Where the "switch data mode" action leads: the training simulation ↔ live NASA data. */
export const counterpartMode = (m: DataMode): DataMode =>
  // the training simulation keeps the real NASA environment unless the build asks for the fully synthetic one
  isSimulation(m) ? 'live' : configuredMode() === 'sim' ? 'sim' : 'nasa'

export function createSource(m: DataMode = mode): TelemetrySource {
  switch (m) {
    case 'ws': return new WebSocketSource()
    case 'sim': return new SimulatedSource()
    case 'nasa': return new NasaSource()
    default: return new LiveSource()
  }
}
