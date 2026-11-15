/**
 * Real NASA / NOAA data feeds. Every fetch is cached in localStorage and falls back to the last
 * known real snapshot (captured from the same endpoints) so the dashboard still works offline
 * or when the shared DEMO_KEY rate limit is exhausted.
 *
 *  - NASA InSight Mars weather (api.nasa.gov/insight_weather)  -> outside temp, wind, pressure
 *  - NOAA SWPC GOES proton flux (live, used by NASA/CCMC)      -> radiation environment
 *  - NASA DONKI notifications (api.nasa.gov/DONKI)             -> space-weather alerts
 *  - NASA DONKI CME analyses (speed, direction, width)         -> CME arrival at Mars, particle source longitude
 *  - NASA OSDR / GeneLab (visualization.osdr.nasa.gov)         -> astronaut-health studies
 */

import type { Cme } from '../science/radiation'

const KEY = (import.meta.env?.VITE_NASA_API_KEY as string | undefined) || 'DEMO_KEY'

/**
 * Where the data in a feed came from. Freshness is a separate question (see `feedFreshness`):
 * data read back from the cache can be perfectly fresh, and data from the network can age.
 */
export type FeedOrigin = 'network' | 'cache' | 'fallback'
export type Freshness = 'fresh' | 'stale' | 'snapshot'

export interface Feed<T> {
  data: T
  origin: FeedOrigin
  /** when this data was successfully fetched from the network (epoch ms); for the fallback, when it was served */
  fetchedAt: number
  /** how long the data counts as fresh after `fetchedAt` */
  ttlMs: number
  /** a network refresh was attempted and failed, so older data is being shown */
  refreshFailed: boolean
}

export function feedFreshness(feed: Pick<Feed<unknown>, 'origin' | 'fetchedAt' | 'ttlMs'>, now = Date.now()): Freshness {
  if (feed.origin === 'fallback') return 'snapshot'
  return now - feed.fetchedAt < feed.ttlMs ? 'fresh' : 'stale'
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export interface CacheOptions {
  storage?: KeyValueStore | null
  now?: () => number
  /** shape check for data read back from storage; invalid entries are ignored */
  isValid?: (data: unknown) => boolean
  /** after a failed fetch, serve cache/snapshot without retrying for this long (capped at the TTL); default 15 min */
  retryAfterFailureMs?: number
}

const inflight = new Map<string, Promise<Feed<unknown>>>()

/**
 * Serve `id` from cache while it is younger than `ttlMs`, otherwise fetch it. If the fetch fails,
 * serve the old cache entry (marked `refreshFailed`) or, failing that, the bundled real snapshot.
 * Concurrent calls for the same id share one request.
 */
export function cached<T>(id: string, ttlMs: number, load: () => Promise<T>, fallback: T, opts: CacheOptions = {}): Promise<Feed<T>> {
  const pending = inflight.get(id)
  if (pending) return pending as Promise<Feed<T>>
  const p = cachedUncoalesced(id, ttlMs, load, fallback, opts).finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

async function cachedUncoalesced<T>(id: string, ttlMs: number, load: () => Promise<T>, fallback: T, opts: CacheOptions): Promise<Feed<T>> {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  const now = opts.now ?? Date.now
  const isValid = opts.isValid ?? (() => true)
  const k = `area51:${id}`

  let stored: { at: number; data: T } | null = null
  try {
    const raw: unknown = JSON.parse(storage?.getItem(k) ?? 'null')
    if (raw && typeof raw === 'object' && 'at' in raw && 'data' in raw) {
      const { at, data } = raw as { at: unknown; data: unknown }
      if (typeof at === 'number' && Number.isFinite(at) && at <= now() && isValid(data)) stored = { at, data: data as T }
    }
  } catch {
    /* storage unavailable or corrupted entry: treat as empty */
  }

  if (stored && now() - stored.at < ttlMs) return { data: stored.data, origin: 'cache', fetchedAt: stored.at, ttlMs, refreshFailed: false }

  const failed = () => (stored ? { data: stored.data, origin: 'cache' as const, fetchedAt: stored.at, ttlMs, refreshFailed: true } : { data: fallback, origin: 'fallback' as const, fetchedAt: now(), ttlMs, refreshFailed: true })

  // after a failed refresh, wait before hitting the endpoint again (e.g. CORS-blocked or retired APIs)
  const failKey = `${k}:failedAt`
  const retryMs = Math.min(ttlMs, opts.retryAfterFailureMs ?? 15 * 60_000)
  try {
    const lastFail = Number(storage?.getItem(failKey))
    if (lastFail > 0 && lastFail <= now() && now() - lastFail < retryMs) return failed()
  } catch {
    /* storage unavailable */
  }

  try {
    const data = await load()
    const at = now()
    try {
      storage?.setItem(k, JSON.stringify({ at, data }))
      storage?.setItem(failKey, '0')
    } catch {
      /* ignore quota */
    }
    return { data, origin: 'network', fetchedAt: at, ttlMs, refreshFailed: false }
  } catch {
    try {
      storage?.setItem(failKey, String(now()))
    } catch {
      /* ignore */
    }
    return failed()
  }
}

const getJson = async (url: string): Promise<unknown> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// ---- InSight Mars weather -----------------------------------------------------------
export interface MarsSol {
  sol: number
  /** air temperature, °C (daily min / avg / max) */
  tMin: number
  tAvg: number
  tMax: number
  /** horizontal wind speed, m/s */
  windAvg: number
  windMax: number
  /** pressure, Pa */
  pressure: number
  season: string
  firstUtc: string
}

// Last real response from api.nasa.gov/insight_weather (InSight stopped transmitting in Dec 2022).
const MARS_FALLBACK: MarsSol[] = [
  { sol: 681, tMin: -95.447, tAvg: -62.434, tMax: -4.444, windAvg: 5.632, windMax: 18.577, pressure: 743.55, season: 'fall', firstUtc: '2020-10-25T22:29:51Z' },
  { sol: 680, tMin: -96.5, tAvg: -62.3, tMax: -15.9, windAvg: 7.2, windMax: 22.5, pressure: 750.6, season: 'fall', firstUtc: '2020-10-24T21:50:00Z' },
]

/** Parse an InSight weather response into sols, newest first. Incomplete sols are skipped. */
export function parseInsight(j: unknown): MarsSol[] {
  if (!isObj(j) || !Array.isArray(j.sol_keys)) return []
  const sols: MarsSol[] = []
  for (const key of j.sol_keys) {
    const d = j[String(key)]
    if (!isObj(d) || !isObj(d.AT) || !isObj(d.HWS) || !isObj(d.PRE)) continue
    const sol = Number(key)
    const tMin = num(d.AT.mn), tAvg = num(d.AT.av), tMax = num(d.AT.mx)
    const windAvg = num(d.HWS.av), windMax = num(d.HWS.mx), pressure = num(d.PRE.av)
    if (!Number.isFinite(sol) || tMin === null || tAvg === null || tMax === null || windAvg === null || windMax === null || pressure === null) continue
    sols.push({ sol, tMin, tAvg, tMax, windAvg, windMax, pressure, season: typeof d.Season === 'string' ? d.Season : '', firstUtc: typeof d.First_UTC === 'string' ? d.First_UTC : '' })
  }
  return sols.sort((a, b) => b.sol - a.sol)
}

export const fetchMars = () =>
  cached<MarsSol[]>(
    'insight',
    6 * 3600_000,
    async () => {
      const sols = parseInsight(await getJson(`https://api.nasa.gov/insight_weather/?api_key=${KEY}&feedtype=json&ver=1.0`))
      if (!sols.length) throw new Error('no sols')
      return sols
    },
    MARS_FALLBACK,
    { isValid: (d) => Array.isArray(d) && d.length > 0 },
  )

// ---- GOES proton flux (radiation environment) ---------------------------------------
export interface ProtonPoint {
  t: number
  /** >=10 MeV integral flux, particles / (cm² s sr) = pfu */
  p10: number
  /** >=100 MeV, null when the channel was missing for this timestamp */
  p100: number | null
  /** >=500 MeV (the high-energy tail), null when missing */
  p500?: number | null
}

/** Group the SWPC rows by timestamp. Timestamps without a valid >=10 MeV value are dropped (no silent zeros). */
export function parseProtons(rows: unknown): ProtonPoint[] {
  if (!Array.isArray(rows)) return []
  const by = new Map<number, { p10: number | null; p100: number | null; p500: number | null }>()
  for (const r of rows) {
    if (!isObj(r) || typeof r.time_tag !== 'string') continue
    const t = Date.parse(r.time_tag.endsWith('Z') ? r.time_tag : `${r.time_tag}Z`)
    const flux = num(r.flux)
    if (!Number.isFinite(t) || flux === null) continue
    const p = by.get(t) ?? { p10: null, p100: null, p500: null }
    if (r.energy === '>=10 MeV') p.p10 = flux
    if (r.energy === '>=100 MeV') p.p100 = flux
    if (r.energy === '>=500 MeV') p.p500 = flux
    by.set(t, p)
  }
  return [...by.entries()]
    .filter((e): e is [number, { p10: number; p100: number | null; p500: number | null }] => e[1].p10 !== null)
    .map(([t, p]) => ({ t, p10: p.p10, p100: p.p100, p500: p.p500 }))
    .sort((a, b) => a.t - b.t)
}

export const fetchProtons = () =>
  cached<ProtonPoint[]>(
    'goes-protons',
    4 * 60_000,
    async () => {
      const pts = parseProtons(await getJson('https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json'))
      if (!pts.length) throw new Error('no proton data')
      return pts
    },
    [{ t: Date.now(), p10: 0.225, p100: 0.226 }],
    { isValid: (d) => Array.isArray(d) && d.length > 0 },
  )

/** GOES publishes a point every 5 min; a newest point older than this says nothing about "now". */
export const PROTON_MAX_AGE_MS = 30 * 60_000

/**
 * The newest proton measurement, or null when there is none that describes the present: the feed
 * is the bundled snapshot (not a measurement of today), or its newest point is too old.
 */
export function currentProtons(feed: Feed<ProtonPoint[]> | null | undefined, now: number): ProtonPoint | null {
  if (!feed || feed.origin === 'fallback') return null
  const latest = feed.data.at(-1)
  return latest && now - latest.t <= PROTON_MAX_AGE_MS ? latest : null
}

/** NOAA solar-radiation storm scale from >=10 MeV flux */
export function sScale(p10: number): string {
  if (p10 >= 1e5) return 'S5'
  if (p10 >= 1e4) return 'S4'
  if (p10 >= 1e3) return 'S3'
  if (p10 >= 1e2) return 'S2'
  if (p10 >= 10) return 'S1'
  return 'S0'
}

// ---- DONKI space-weather notifications ----------------------------------------------
export interface SpaceWeatherNote {
  id: string
  type: string
  issued: string
  url: string
  summary: string
}

const HEADING = /^\s*#/
const SUMMARY_HEADING = /^\s*#+\s*Summary\s*:?/i
const TYPE_HEADING = /^\s*#+\s*Message Type\s*:?/i

/** Collapse whitespace inside paragraphs, keep paragraph breaks as single newlines. */
function normalizeParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`
}

/**
 * Extract the human summary from a DONKI message body. DONKI bodies are Markdown-like: the
 * `## Summary:` heading sits on its own line and the text follows on the next lines, up to the
 * next `##` heading. Falls back to the message-type line, then to any non-heading text.
 */
export function parseDonkiSummary(body: unknown, maxLen = 220): string {
  if (typeof body !== 'string' || !body.trim()) return ''
  const lines = body.replace(/\r\n?/g, '\n').split('\n')

  let text = ''
  const i = lines.findIndex((l) => SUMMARY_HEADING.test(l))
  if (i >= 0) {
    const section = [lines[i].replace(SUMMARY_HEADING, '')]
    for (let j = i + 1; j < lines.length && !HEADING.test(lines[j]); j++) section.push(lines[j])
    text = normalizeParagraphs(section.join('\n'))
  }
  if (!text) {
    const typeLine = lines.find((l) => TYPE_HEADING.test(l))
    if (typeLine) text = normalizeParagraphs(typeLine.replace(TYPE_HEADING, ''))
  }
  if (!text) text = normalizeParagraphs(lines.filter((l) => !HEADING.test(l)).join('\n'))
  return clip(text, maxLen)
}

/** Parse a DONKI notifications response, newest first. */
export function parseDonki(j: unknown, limit = 8): SpaceWeatherNote[] {
  if (!Array.isArray(j)) return []
  const notes: SpaceWeatherNote[] = []
  for (const m of j) {
    if (!isObj(m) || typeof m.messageID !== 'string') continue
    const type = typeof m.messageType === 'string' ? m.messageType : 'Notice'
    notes.push({
      id: m.messageID,
      type,
      issued: typeof m.messageIssueTime === 'string' ? m.messageIssueTime : '',
      url: typeof m.messageURL === 'string' ? m.messageURL : 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/',
      summary: parseDonkiSummary(m.messageBody) || `${type} notification (no summary text)`,
    })
  }
  return notes.sort((a, b) => (Date.parse(b.issued) || 0) - (Date.parse(a.issued) || 0)).slice(0, limit)
}

// Real notification captured from api.nasa.gov/DONKI/notifications on 2026-11-14.
const DONKI_FALLBACK: SpaceWeatherNote[] = [
  {
    id: '20261101-AL-001',
    type: 'RBE',
    issued: '2026-11-01T13:28Z',
    url: 'https://ccmc.gsfc.nasa.gov/DONKI/view/Alert/49352/1',
    summary: 'Significantly elevated energetic electron fluxes in the Earth\'s outer radiation belt. GOES "greater than 2.0 MeV" integral electron flux is above 1000 pfu starting at 2026-11-01T12:45Z.',
  },
]

export const fetchDonki = () =>
  cached<SpaceWeatherNote[]>(
    'donki',
    3 * 3600_000,
    async () => {
      const start = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10)
      const j = await getJson(`https://api.nasa.gov/DONKI/notifications?startDate=${start}&type=all&api_key=${KEY}`)
      if (!Array.isArray(j)) throw new Error('bad donki')
      return parseDonki(j)
    },
    DONKI_FALLBACK,
    { isValid: (d) => Array.isArray(d) && d.every((n) => isObj(n) && typeof n.summary === 'string' && n.summary.length > 0) },
  )

// ---- DONKI CME analyses (speed, direction, width) ---------------------------------------
/** Parse a DONKI CMEAnalysis response. Entries without a finite speed, direction or width are skipped. */
export function parseCmeAnalyses(j: unknown): Cme[] {
  if (!Array.isArray(j)) return []
  const out: Cme[] = []
  for (const c of j) {
    if (!isObj(c) || typeof c.time21_5 !== 'string') continue
    const t21_5 = Date.parse(c.time21_5)
    const latDeg = num(c.latitude), lonDeg = num(c.longitude), halfAngleDeg = num(c.halfAngle), speedKmS = num(c.speed)
    if (!Number.isFinite(t21_5) || latDeg === null || lonDeg === null || halfAngleDeg === null || speedKmS === null || speedKmS <= 0) continue
    out.push({ id: typeof c.associatedCMEID === 'string' ? c.associatedCMEID : c.time21_5, t21_5, latDeg, lonDeg, halfAngleDeg, speedKmS, url: typeof c.link === 'string' ? c.link : 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/' })
  }
  return out.sort((a, b) => b.t21_5 - a.t21_5)
}

// Real analyses captured from api.nasa.gov/DONKI/CMEAnalysis on 2026-11-14 (most accurate only).
const CME_FALLBACK: Cme[] = (
  [
    ['2026-11-13T21:24:00-CME-001', '2026-11-14T04:11Z', -51, 22, 12, 474, 49548],
    ['2026-11-13T09:24:00-CME-001', '2026-11-13T20:44Z', -63, 127, 24, 302, 49538],
    ['2026-11-13T01:26:00-CME-001', '2026-11-13T13:49Z', -67, 54, 38, 308, 49526],
    ['2026-11-13T03:24:00-CME-001', '2026-11-13T09:50Z', 13, -46, 17, 525, 49530],
    ['2026-11-11T23:24:00-CME-001', '2026-11-12T09:21Z', 51, 85, 29, 367, 49506],
    ['2026-11-10T02:12:00-CME-001', '2026-11-10T19:38Z', -3, -88, 34, 346, 49476],
    ['2026-11-10T05:30:00-CME-001', '2026-11-10T08:14Z', 2, 93, 11, 974, 49480],
    ['2026-11-09T18:15:00-CME-001', '2026-11-09T21:40Z', -2, 65, 10, 726, 49469],
    ['2026-11-08T08:48:00-CME-001', '2026-11-08T18:18Z', 43, 144, 27, 367, 49460],
    ['2026-11-08T00:48:00-CME-001', '2026-11-08T06:51Z', 43, 137, 22, 591, 49455],
    ['2026-11-07T18:30:00-CME-001', '2026-11-07T23:35Z', 25, 160, 13, 423, 49452],
    ['2026-11-07T06:24:00-CME-001', '2026-11-07T20:35Z', 54, -56, 10, 245, 49446],
  ] as const
).map(([id, t, latDeg, lonDeg, halfAngleDeg, speedKmS, n]) => ({ id, t21_5: Date.parse(t), latDeg, lonDeg, halfAngleDeg, speedKmS, url: `https://ccmc.gsfc.nasa.gov/DONKI/view/CMEAnalysis/${n}/-1` }))

export const fetchCmes = () =>
  cached<Cme[]>(
    'donki-cme',
    3 * 3600_000,
    async () => {
      const start = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10)
      const j = await getJson(`https://api.nasa.gov/DONKI/CMEAnalysis?startDate=${start}&mostAccurateOnly=true&speed=0&halfAngle=0&catalog=ALL&api_key=${KEY}`)
      if (!Array.isArray(j)) throw new Error('bad cme analysis')
      return parseCmeAnalyses(j)
    },
    CME_FALLBACK,
    { isValid: (d) => Array.isArray(d) && d.every((c) => isObj(c) && typeof c.t21_5 === 'number' && typeof c.speedKmS === 'number') },
  )

// ---- OSDR astronaut-health studies --------------------------------------------------
export interface OsdrStudy {
  id: string
  title: string
  material: string
  url: string
}

const OSDR_IDS = ['OSD-53', 'OSD-174', 'OSD-569', 'OSD-575']
const OSDR_FALLBACK: OsdrStudy[] = [
  { id: 'OSD-53', title: 'Spaceflight Modulates Gene Expression in Astronauts', material: 'Whole Blood', url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-53' },
  { id: 'OSD-174', title: 'Effects of a Closed Space Environment on Gene Expression in Hair Follicles of Astronauts in the ISS', material: 'Hair follicle', url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-174' },
  { id: 'OSD-569', title: 'Inspiration4 crew: whole blood, complete blood count', material: 'Whole Blood', url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-569' },
  { id: 'OSD-575', title: 'Inspiration4 crew: serum, comprehensive metabolic panel', material: 'Serum', url: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-575' },
]

export const fetchOsdr = () =>
  cached<OsdrStudy[]>(
    'osdr',
    24 * 3600_000,
    async () => {
      const out = await Promise.all(
        OSDR_IDS.map(async (id): Promise<OsdrStudy | null> => {
          const j = await getJson(`https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/${id}/`).catch(() => null)
          const entry = isObj(j) ? j[id] : null
          const m = isObj(entry) ? entry.metadata : null
          if (!isObj(m) || typeof m['study title'] !== 'string') return null
          return { id, title: m['study title'], material: m['material type'] == null ? '' : String(m['material type']), url: `https://osdr.nasa.gov/bio/repo/data/studies/${id}` }
        }),
      )
      const ok = out.filter((x): x is OsdrStudy => x !== null)
      if (!ok.length) throw new Error('no osdr')
      return ok
    },
    OSDR_FALLBACK,
    { isValid: (d) => Array.isArray(d) && d.length > 0 },
  )
