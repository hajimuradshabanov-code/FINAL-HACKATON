import { METRICS, METRIC_KEYS, VITAL_KEYS } from '../config/thresholds'
import type { Snapshot } from '../data/store'
import type { NasaLive } from '../data/nasaSource'
import type { DataMode } from '../data/createSource'
import { formatNumber } from '../lib/format'
import { earthMarsLink } from '../science/models'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  /** who answered: Gemini, or the built-in rule-based fallback (not AI) */
  source?: 'gemini' | 'offline'
}

export type AssistantStatus = 'checking' | 'ready' | 'not-configured' | 'unreachable'

export interface AssistantState {
  status: AssistantStatus
  model: string
  messages: ChatMessage[]
  sending: boolean
  error: string | null
  /** why answers currently come from the built-in fallback instead of Gemini */
  fallbackReason: string | null
}

const MAX_HISTORY = 12

/**
 * Compact plain-text summary of what the dashboard currently shows, sent with each question so the
 * model can answer about the crew's state. Contains no account data.
 */
export function buildContext(
  snap: Pick<Snapshot, 'latest' | 'statuses' | 'alerts'> & { science?: Snapshot['science'] },
  env?: (Pick<NasaLive, 'ready' | 'storm' | 'p10' | 'doseRateUSvH'> & { rad?: NasaLive['rad'] }) | null,
  member?: { name: string; role: string } | null,
  mode: DataMode = 'nasa',
): string {
  const s = snap.latest
  if (!s) return 'No telemetry received yet.'
  const live = mode === 'live'
  const line = (k: (typeof METRIC_KEYS)[number]) => {
    const c = METRICS[k]
    const origin = s.provenance?.[k] ?? 'simulated'
    return `${c.label}: ${formatNumber(s[k], c.decimals)} ${c.unit} (${snap.statuses[k]}, ${origin})`
  }
  const vitals = VITAL_KEYS.map(line)
  const suit = (['o2Tank', 'battery', 'coolantTemp', 'respRate', 'outsideTemp', 'visorTemp', 'gloveTemp', 'bootTemp', 'wind', 'signal'] as const).map(line)
  const open = snap.alerts.filter((a) => a.resolvedAt === undefined)
  const recent = snap.alerts.slice(0, 5)
  const parts = [
    live
      ? 'Data mode: LIVE. Nothing is simulated. Only the Mars environment is known. Origin tags: "modelled" = computed from NASA/NOAA data for the Mars surface at Gale crater; "none" = no instrument connected, shown as "—": never guess such a value, say it is not being measured. There are no body sensors and no spacesuit telemetry in this mode.'
      : `Data mode: ${mode === 'ws' ? 'telemetry backend' : 'TRAINING SIMULATION (values tagged simulated are generated, not measured)'}.`,
    live
      ? `Time ${s.iso} (Curiosity sol ${s.sol} at Gale crater). User: ${member ? `${member.name} (${member.role})` : 'guest'}. `
      : `Time ${s.iso} (sol ${s.sol}). Crew member on EVA-1: ${member ? `${member.name} (${member.role})` : 'unnamed (guest view)'}. ${s.evaActive ? 'EVA in progress (walking).' : 'Resting.'} Traverse ${Math.round(s.progress * 100)}% done, ${formatNumber(s.distanceKm, 1)} km to go, ETA ${Number.isFinite(s.etaMin) ? `${s.etaMin} min` : 'unknown'}.`,
    `Vitals: ${vitals.join('; ')}.`,
    `Suit and environment: ${suit.join('; ')}.`,
    open.length ? `Active alerts: ${open.map((a) => `${METRICS[a.key].label} ${a.level} (${formatNumber(a.value, METRICS[a.key].decimals)} ${METRICS[a.key].unit})`).join('; ')}.` : 'No active alerts.',
    recent.length ? `Recent alert log: ${recent.map((a) => `${METRICS[a.key].label} ${a.level}${a.outcome ? ` → ${a.outcome}` : a.resolvedAt === undefined ? ' (open)' : ''}`).join('; ')}.` : '',
    science(snap, s.t),
    env?.ready ? `Space weather: GOES >=10 MeV proton flux ${env.p10.toFixed(2)} pfu, NOAA storm level ${env.storm}, modelled dose rate ${env.doseRateUSvH.toFixed(1)} µSv/h.` : '',
    env?.ready && env.rad ? `Radiation decision for Mars (GOES flux scaled to Mars by distance and magnetic connection, cut by the atmosphere): ${env.rad.headline}. ${env.rad.reasons.join(' ')}` : '',
  ]
  return parts.filter(Boolean).join('\n')
}

function science(snap: { science?: Snapshot['science'] }, t: number): string {
  const sc = snap.science
  const link = earthMarsLink(t)
  const parts = [`Earth–Mars one-way signal delay ${(link.oneWayS / 60).toFixed(1)} min (distance ${(link.distanceKm / 1e6).toFixed(0)} million km).`]
  if (sc?.psi) parts.push(`Physiological Strain Index ${sc.psi.value.toFixed(1)}/10 (${sc.psi.category}).`)
  if (sc?.ectemp) parts.push(`Core temperature estimated from heart rate (ECTemp) ${sc.ectemp.estimate.toFixed(1)} °C vs chest patch ${sc.ectemp.measured.toFixed(1)} °C.`)
  if (sc?.dcs) parts.push(`Decompression: habitat ${sc.dcs.atmosphere.label}, tissue ratio ${sc.dcs.tr.toFixed(2)}${sc.dcs.eva ? ' (in suit)' : ' if EVA started now'}, ${Math.round(sc.dcs.prebreatheMin)} min O2 prebreathe to reach TR 1.23.`)
  const dev = sc?.baseline ? Object.values(sc.baseline).filter((r) => r.deviating) : []
  if (dev.length) parts.push(`Personal baseline: ${dev.map((r) => `${METRICS[r.key].label} is ${Math.abs(r.z).toFixed(1)} SD ${r.direction === 'high' ? 'above' : 'below'} this crew member's own ${r.activity === 'eva' ? 'EVA' : 'resting'} norm (${r.mean.toFixed(1)} ± ${r.sd.toFixed(1)} ${METRICS[r.key].unit})`).join('; ')}.`)
  if (sc?.joint?.flagged) parts.push(`Joint deviation: several vitals are away from this crew member's norm together (T² ${sc.joint.t2.toFixed(1)})${sc.joint.match ? `, matching the app's "${sc.joint.match.signature.label}" signature (a pointer, not a diagnosis)` : ''}.`)
  if (sc?.forecasts.length) parts.push(`Trend forecasts: ${sc.forecasts.map((f) => `${METRICS[f.key].label} ${f.direction}, warning in ~${f.minutes.toFixed(1)} min`).join('; ')}.`)
  return `Models: ${parts.join(' ')}`
}

// ---- store -------------------------------------------------------------------------------
let state: AssistantState = { status: 'checking', model: '', messages: [], sending: false, error: null, fallbackReason: null }
/** bumped whenever the conversation is cleared */
let epoch = 0
const listeners = new Set<() => void>()
const set = (p: Partial<AssistantState>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

export const assistantStore = {
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  get: () => state,
}

const ENDPOINT = '/api/assistant'

/** Ask the server whether a Gemini key is configured. */
export async function checkAssistant(fetchImpl: typeof fetch = fetch): Promise<void> {
  set({ status: 'checking' })
  try {
    const r = await fetchImpl(ENDPOINT, { headers: { accept: 'application/json' } })
    const j = (await r.json()) as { configured?: unknown; model?: unknown }
    if (!r.ok || typeof j.configured !== 'boolean') throw new Error('bad status')
    set({ status: j.configured ? 'ready' : 'not-configured', model: typeof j.model === 'string' ? j.model : '' })
  } catch {
    // static hosting without the /api function, or offline
    set({ status: 'unreachable' })
  }
}

const NOT_CONFIGURED = 'Gemini is not connected (no API key on the server).'
const UNREACHABLE = 'The Gemini service is not reachable from this page.'

/**
 * Ask Gemini through /api/assistant. When Gemini is unavailable (no key, key rejected, quota,
 * outage, offline) the question is answered by `offline()` — the built-in rule-based helper — and
 * the reason is kept in `fallbackReason` so the panel can say so. Only a malformed request is an error.
 */
export async function sendMessage(text: string, context: string, offline: (q: string) => string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const q = text.trim()
  if (!q || state.sending) return
  const messages: ChatMessage[] = [...state.messages, { role: 'user' as const, text: q.slice(0, 2000) }].slice(-MAX_HISTORY)
  set({ messages, sending: true, error: null })
  // an answer that arrives after the conversation was cleared (new conversation, another user
  // signed in) belongs to nobody and is dropped
  const run = epoch
  const stale = () => run !== epoch

  const fallback = (reason: string) => {
    if (!stale()) set({ messages: [...messages, { role: 'assistant', text: offline(q), source: 'offline' }], sending: false, fallbackReason: reason })
  }

  if (state.status === 'not-configured') return fallback(NOT_CONFIGURED)
  if (state.status === 'unreachable') return fallback(UNREACHABLE)
  try {
    const r = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // only the real conversation goes to Gemini, not the fallback's canned answers
      body: JSON.stringify({ messages: messages.filter((m) => m.source !== 'offline').map(({ role, text }) => ({ role, text })), context }),
    })
    const j = (await r.json().catch(() => ({}))) as { text?: unknown; message?: unknown; error?: unknown }
    if (stale()) return
    if (r.ok && typeof j.text === 'string') {
      set({ messages: [...messages, { role: 'assistant', text: j.text, source: 'gemini' }], sending: false, fallbackReason: null })
      return
    }
    if (j.error === 'bad_request') {
      set({ sending: false, error: typeof j.message === 'string' ? j.message : 'The question could not be sent.' })
      return
    }
    if (j.error === 'not_configured') set({ status: 'not-configured' })
    fallback(typeof j.message === 'string' ? j.message : `Gemini could not answer (HTTP ${r.status}).`)
  } catch {
    fallback(UNREACHABLE)
  }
}

/** Start over: also abandons a question that is still waiting for its answer. Called when the signed-in user changes. */
export function clearConversation() {
  epoch++
  set({ messages: [], sending: false, error: null, fallbackReason: null })
}
