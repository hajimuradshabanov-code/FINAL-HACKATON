import { METRIC_KEYS, type MetricKey } from '../config/thresholds'
import type { Provenance, Sample, TelemetrySource } from './types'

const EARLIEST_VALID_T = Date.UTC(2000, 0, 1)
const TRAVERSE_KEYS = ['sol', 'distanceKm', 'etaMin', 'progress'] as const
const REPORTED: Provenance = Object.fromEntries(METRIC_KEYS.map((k) => [k, 'reported']))

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Parse a timestamp from a frame. ISO strings without a zone offset are read as UTC. */
function parseTime(v: unknown): number | null {
  if (finite(v)) return v >= EARLIEST_VALID_T ? v : null
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s)
  const t = Date.parse(hasZone || !s.includes('T') ? s : `${s}Z`)
  return Number.isFinite(t) && t >= EARLIEST_VALID_T ? t : null
}

/**
 * Merge one decoded frame onto the previous sample. Timestamp precedence: `t` (epoch ms), `iso`,
 * `timestamp`, then the receive time — never the previous frame's time, so the clock cannot freeze.
 * `utc` is always derived from this frame's time unless the frame itself carries a valid `utc`.
 * Missing numeric fields keep their previous value (NaN on the first frame, which the UI renders as "—").
 */
export function mergeFrame(last: Sample | null, msg: unknown, receivedAt: number): Sample | null {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null
  const m = msg as Record<string, unknown>
  const t = parseTime(m.t) ?? parseTime(m.iso) ?? parseTime(m.timestamp) ?? receivedAt
  const iso = new Date(t).toISOString()
  const utc = typeof m.utc === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(m.utc) ? m.utc : iso.slice(11, 19)

  const pick = (k: string): number => (finite(m[k]) ? (m[k] as number) : last ? (last as unknown as Record<string, number>)[k] : NaN)
  const metrics = Object.fromEntries(METRIC_KEYS.map((k) => [k, pick(k)])) as Record<MetricKey, number>
  const traverse = Object.fromEntries(TRAVERSE_KEYS.map((k) => [k, pick(k)])) as Record<(typeof TRAVERSE_KEYS)[number], number>
  const anomaly = typeof m.anomaly === 'string' && (METRIC_KEYS as string[]).includes(m.anomaly) ? (m.anomaly as MetricKey) : m.anomaly === null ? null : (last?.anomaly ?? null)

  return {
    ...metrics,
    ...traverse,
    t,
    iso,
    utc,
    evaActive: typeof m.evaActive === 'boolean' ? m.evaActive : (last?.evaActive ?? false),
    anomaly,
    provenance: REPORTED,
  }
}

/**
 * Client for the Java backend. Expects one JSON object per message (see README for the
 * full schema). Missing optional fields fall back to the previous value so a partial
 * frame never produces NaN in the UI once a full frame has been seen.
 */
export class WebSocketSource implements TelemetrySource {
  readonly timerDriven = false
  private ws: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private closed = true
  private last: Sample | null = null
  private attempts = 0

  constructor(private url: string = import.meta.env?.VITE_WS_URL ?? 'ws://localhost:8080/telemetry') {}

  start(onSample: (s: Sample, backfill: boolean) => void) {
    this.closed = false
    const connect = () => {
      if (this.closed) return
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => {
        this.attempts = 0
      }
      ws.onmessage = (ev) => {
        if (this.closed || this.ws !== ws) return
        let decoded: unknown
        try {
          decoded = JSON.parse(String(ev.data))
        } catch {
          return // ignore malformed frame
        }
        const merged = mergeFrame(this.last, decoded, Date.now())
        if (!merged) return
        this.last = merged
        onSample(merged, false)
      }
      ws.onclose = () => {
        if (this.closed || this.ws !== ws) return
        // reconnect with capped backoff: 1 s, 2 s, 4 s ... 15 s
        const delay = Math.min(15_000, 1000 * 2 ** this.attempts++)
        this.retry = setTimeout(connect, delay)
      }
      ws.onerror = () => ws.close()
    }
    connect()
  }

  stop() {
    this.closed = true
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    const ws = this.ws
    this.ws = null
    ws?.close()
  }
}
