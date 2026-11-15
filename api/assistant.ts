/**
 * AI assistant endpoint backed by Google Gemini.
 *
 * The API key stays on the server: set GEMINI_API_KEY (and optionally GEMINI_MODEL) in `.env`
 * for local dev or in Vercel → Project → Settings → Environment Variables. It is never sent to
 * the browser. On Vercel this file is a serverless function (GET = status, POST = chat); in local
 * dev, vite.config.ts serves the same handlers.
 *
 * Self-contained on purpose (no relative imports) so the Vercel function bundles without
 * module-resolution surprises.
 */

export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash'
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface AssistantEnv {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

export interface AssistantResult {
  status: number
  body: Record<string, unknown>
}

export const LIMITS = { messages: 12, chars: 2000, context: 4000, maxOutputTokens: 1024, timeoutMs: 30_000 }

const PLACEHOLDER_KEY = /^(|your[-_ ].*|.*placeholder.*|x+|changeme)$/i

/** A real-looking key is set (not empty and not the `.env.example` placeholder). */
export function isConfigured(env: AssistantEnv): boolean {
  const k = env.GEMINI_API_KEY?.trim() ?? ''
  return !PLACEHOLDER_KEY.test(k)
}

export const modelOf = (env: AssistantEnv) => {
  const m = env.GEMINI_MODEL?.trim()
  return m && /^[a-z0-9.\-]+$/i.test(m) ? m : GEMINI_DEFAULT_MODEL
}

export function assistantStatus(env: AssistantEnv): AssistantResult {
  return { status: 200, body: { configured: isConfigured(env), model: modelOf(env) } }
}

const SYSTEM_PROMPT = `You are the crew health assistant inside "AreA 51", an astronaut health-monitoring dashboard built for the NASA Space Apps Challenge 2026.
Help crew members understand their vitals, alerts, daily check-in and the space environment (radiation, Mars weather).
Rules:
- Use the telemetry snapshot below when the question is about the crew's current state. Say when the data you need is not in it.
- Crew vitals and suit sensors in this prototype are SIMULATED; environment values are modelled from NASA/NOAA data. Never present them as real measurements of a real person.
- You are not a doctor and this is not a medical device. For anything that sounds serious, tell the user to follow the dashboard's guidance and contact the flight surgeon (or emergency services on Earth).
- Be concise: at most about 120 words, plain sentences or short lists, no Markdown headings or tables.`

/** Validate the browser's request. Returns an error message string when invalid. */
export function parseRequest(body: unknown): { messages: ChatMessage[]; context: string } | string {
  if (typeof body !== 'object' || body === null) return 'Send a JSON body with "messages".'
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.messages) || b.messages.length === 0) return '"messages" must be a non-empty array.'
  const messages: ChatMessage[] = []
  for (const m of b.messages.slice(-LIMITS.messages)) {
    if (typeof m !== 'object' || m === null) return 'Each message needs a role and text.'
    const { role, text } = m as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || !text.trim()) return 'Each message needs role "user" or "assistant" and non-empty text.'
    if (text.length > LIMITS.chars) return `Messages are limited to ${LIMITS.chars} characters.`
    messages.push({ role, text: text.trim() })
  }
  // Gemini expects the conversation to start with the user and end with the user's question;
  // consecutive turns from the same side are merged
  while (messages.length && messages[0].role !== 'user') messages.shift()
  for (let i = messages.length - 1; i > 0; i--) {
    if (messages[i].role === messages[i - 1].role) {
      messages[i - 1] = { role: messages[i].role, text: `${messages[i - 1].text}

${messages[i].text}` }
      messages.splice(i, 1)
    }
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') return 'The last message must be from the user.'
  const context = typeof b.context === 'string' ? b.context.slice(0, LIMITS.context) : ''
  return { messages, context }
}

export function buildGeminiRequest(messages: ChatMessage[], context: string) {
  return {
    systemInstruction: { parts: [{ text: context ? `${SYSTEM_PROMPT}\n\nTelemetry snapshot (from the dashboard; its first line states whether values are measured or simulated):\n${context}` : SYSTEM_PROMPT }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
    generationConfig: { maxOutputTokens: LIMITS.maxOutputTokens, temperature: 0.4 },
  }
}

/** Pull the answer text out of a generateContent response. */
export function extractText(json: unknown): { text: string } | { blocked: string } {
  const j = (json ?? {}) as {
    candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
  }
  if (j.promptFeedback?.blockReason) return { blocked: j.promptFeedback.blockReason }
  const c = j.candidates?.[0]
  const text = (c?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && p.thought !== true)
    .map((p) => p.text as string)
    .join('')
    .trim()
  if (text) return { text }
  return { blocked: c?.finishReason ?? 'EMPTY' }
}

export async function handleAssistant(body: unknown, env: AssistantEnv, fetchImpl: typeof fetch = fetch): Promise<AssistantResult> {
  if (!isConfigured(env)) {
    return { status: 503, body: { error: 'not_configured', message: 'The assistant has no Gemini API key yet. Set GEMINI_API_KEY on the server.' } }
  }
  const req = parseRequest(body)
  if (typeof req === 'string') return { status: 400, body: { error: 'bad_request', message: req } }

  const model = modelOf(env)
  let r: Response
  try {
    r = await fetchImpl(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY!.trim() },
      body: JSON.stringify(buildGeminiRequest(req.messages, req.context)),
      signal: AbortSignal.timeout(LIMITS.timeoutMs),
    })
  } catch {
    return { status: 504, body: { error: 'unreachable', message: 'Gemini did not respond in time. Try again.' } }
  }

  const json: unknown = await r.json().catch(() => null)
  if (!r.ok) {
    const err = (json as { error?: { message?: unknown; details?: { reason?: unknown }[] } } | null)?.error
    const detail = String(err?.message ?? '')
    const reasons = (err?.details ?? []).map((d) => String(d?.reason ?? ''))
    if (reasons.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')) {
      return { status: 502, body: { error: 'key_type_unsupported', message: 'Google rejected this key type (ACCESS_TOKEN_TYPE_UNSUPPORTED). This is a known problem with some new "AQ." keys from AI Studio. Try a key created in Google Cloud Console → Credentials with the Generative Language API enabled.' } }
    }
    if (r.status === 429) return { status: 429, body: { error: 'rate_limited', message: 'The Gemini quota for this key is used up for now. Try again in a minute.' } }
    if (r.status === 404) return { status: 502, body: { error: 'bad_model', message: `Model "${model}" is not available for this key. Set GEMINI_MODEL to a model your key can use.` } }
    if (r.status === 400 && /api key/i.test(detail)) return { status: 502, body: { error: 'bad_key', message: 'Gemini rejected the API key. Check GEMINI_API_KEY.' } }
    if (r.status === 401 || r.status === 403) return { status: 502, body: { error: 'bad_key', message: 'Gemini rejected the API key or it lacks access. Check GEMINI_API_KEY.' } }
    return { status: 502, body: { error: 'upstream', message: 'Gemini could not answer right now. Try again.' } }
  }

  const out = extractText(json)
  if ('blocked' in out) return { status: 200, body: { text: 'I can’t answer that one. Try rephrasing the question about crew health or the mission data.', blocked: out.blocked, model } }
  return { status: 200, body: { text: out.text, model } }
}

// ---- Vercel function (Web signature) ------------------------------------------------------
const env = (): AssistantEnv => ({ GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL })
const json = (r: AssistantResult) => new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/**
 * Only this app's own pages may ask questions, so the key cannot be used as a free proxy from
 * elsewhere. Browsers send Origin on every POST made with fetch, same-origin ones included, so a
 * request without it is a script or a tool, not the dashboard, and is refused.
 */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Questions one client may send per window. A person types a handful a minute; a script does not. */
export const RATE = { perClient: 10, global: 60, windowMs: 60_000, maxClients: 5000 }

const hits = new Map<string, number[]>()

/**
 * Sliding-window limiter, per client address plus one shared budget that caps what the Gemini key
 * can be made to spend. Returns the seconds to wait when the request must be refused, 0 when it
 * may go ahead. State is per server instance: on serverless hosting that makes it a brake on
 * abuse, not an exact quota.
 */
export function rateLimited(client: string, now: number = Date.now()): number {
  const check = (key: string, max: number) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE.windowMs)
    hits.set(key, recent)
    return recent.length >= max ? Math.max(1, Math.ceil((recent[0] + RATE.windowMs - now) / 1000)) : 0
  }
  const wait = Math.max(check(`c:${client || 'unknown'}`, RATE.perClient), check('*', RATE.global))
  if (wait) return wait
  hits.get(`c:${client || 'unknown'}`)!.push(now)
  hits.get('*')!.push(now)
  if (hits.size > RATE.maxClients) for (const [k, v] of hits) if (k !== '*' && !v.some((t) => now - t < RATE.windowMs)) hits.delete(k)
  return 0
}

/** Client address as reported by the hosting proxy (first hop of x-forwarded-for). */
export const clientOf = (forwardedFor: string | null | undefined, fallback = ''): string => forwardedFor?.split(',')[0].trim() || fallback

export const FORBIDDEN: AssistantResult = { status: 403, body: { error: 'forbidden', message: 'Cross-site requests are not allowed.' } }
export const tooMany = (waitS: number): AssistantResult => ({ status: 429, body: { error: 'rate_limited', message: `Too many questions in a short time. Try again in ${waitS} s.`, retryAfter: waitS } })

export function GET(): Response {
  return json(assistantStatus(env()))
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request.headers.get('origin'), request.headers.get('x-forwarded-host') ?? request.headers.get('host'))) return json(FORBIDDEN)
  const wait = rateLimited(clientOf(request.headers.get('x-forwarded-for')))
  if (wait) return json(tooMany(wait))
  const text = await request.text()
  if (text.length > 64_000) return json({ status: 413, body: { error: 'too_large', message: 'Request too large.' } })
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    /* handled as a bad request below */
  }
  return json(await handleAssistant(body, env()))
}
