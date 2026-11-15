/**
 * Mars weather relay: the newest sols of the Curiosity REMS weather feed.
 *
 * The public feed (mars.nasa.gov) is about 1.7 MB for the whole mission and does not reliably send
 * CORS headers, so browsers cannot read it directly. This endpoint fetches it on the server and
 * returns only the newest reports. On Vercel this file is a serverless function; in local dev,
 * vite.config.ts serves the same handler.
 *
 * Self-contained on purpose (no relative imports), like api/assistant.ts.
 */

export const REMS_UPSTREAM = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json'
export const REMS_KEEP = 10
/** the feed changes at most once a day: let the CDN and the browser hold the answer for an hour */
export const REMS_CACHE_S = 3600

export interface RemsResult {
  status: number
  body: Record<string, unknown>
}

/** Newest `keep` entries of the feed's `soles` array (by sol number); null if the payload is not the feed. */
export function newestSols(payload: unknown, keep: number = REMS_KEEP): unknown[] | null {
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { soles?: unknown }).soles)) return null
  const solOf = (s: unknown) => Number((s as { sol?: unknown } | null)?.sol)
  return ((payload as { soles: unknown[] }).soles)
    .filter((s) => typeof s === 'object' && s !== null && Number.isFinite(solOf(s)))
    .sort((a, b) => solOf(b) - solOf(a))
    .slice(0, keep)
}

export async function handleRems(fetchImpl: typeof fetch = fetch): Promise<RemsResult> {
  try {
    const r = await fetchImpl(REMS_UPSTREAM, { signal: AbortSignal.timeout(25_000), headers: { accept: 'application/json' } })
    if (!r.ok) return { status: 502, body: { error: 'upstream', message: `The REMS feed answered ${r.status}.` } }
    const soles = newestSols(await r.json())
    if (!soles || !soles.length) return { status: 502, body: { error: 'upstream', message: 'The REMS feed returned no weather reports.' } }
    return { status: 200, body: { source: REMS_UPSTREAM, soles } }
  } catch {
    return { status: 504, body: { error: 'unreachable', message: 'The REMS feed could not be reached.' } }
  }
}

export const remsHeaders = (status: number): Record<string, string> => ({
  'content-type': 'application/json',
  'cache-control': status === 200 ? `public, max-age=${REMS_CACHE_S}, s-maxage=${REMS_CACHE_S}` : 'no-store',
})

// ---- Vercel function (Web signature) ------------------------------------------------------
export async function GET(): Promise<Response> {
  const r = await handleRems()
  return new Response(JSON.stringify(r.body), { status: r.status, headers: remsHeaders(r.status) })
}
