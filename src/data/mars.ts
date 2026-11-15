import { cached, type Feed } from './nasaApi'

/**
 * Mars as it is right now: the real clock at a real place, and the newest weather actually measured
 * there.
 *
 *  - Time: Mars Sol Date and local mean solar time, Allison & McEwen 2000 ("A post-Pathfinder
 *    evaluation of areocentric solar coordinates…", Planet. Space Sci. 48) as used by NASA GISS
 *    Mars24. Checked against the sol numbers and dates in the REMS feed (tests/live.test.ts).
 *  - Weather: REMS, the weather station on the Curiosity rover in Gale crater, published per sol by
 *    Centro de Astrobiología / NASA JPL at mars.nasa.gov. It is the only station currently
 *    reporting from the surface on a public feed; reports arrive with a delay of days to weeks.
 */

/** Curiosity / Bradbury Landing, Gale crater (planetocentric). */
export const GALE = { name: 'Gale crater', latDeg: -4.5895, lonEastDeg: 137.4417 } as const
export const SOL_SECONDS = 88_775.244
/** TT − UTC, seconds (TAI − UTC = 37 s since 2017, plus 32.184 s) */
const TT_MINUS_UTC = 69.184
/** MSL sol 0 is the local solar day of landing (2012-08-06 05:17:57 UTC, about 15:03 local) */
const MSL_SOL_OFFSET = 49_268

export interface MarsClock {
  /** Mars Sol Date: sols since 1873-12-29, at the prime meridian */
  msd: number
  /** Coordinated Mars Time (mean solar time at 0° longitude), hours 0..24 */
  mtcHours: number
  /** local mean solar time at the site, hours 0..24 */
  lmstHours: number
  /** Curiosity mission sol at the site */
  sol: number
}

export function marsClock(ms: number, lonEastDeg: number = GALE.lonEastDeg): MarsClock {
  const jdTt = ms / 86_400_000 + 2_440_587.5 + TT_MINUS_UTC / 86_400
  const msd = (jdTt - 2_405_522.0028779) / 1.0274912517
  const local = msd - (360 - lonEastDeg) / 360
  const frac = (x: number) => ((x % 1) + 1) % 1
  return { msd, mtcHours: frac(msd) * 24, lmstHours: frac(local) * 24, sol: Math.floor(local) - MSL_SOL_OFFSET }
}

/** "14:07" from fractional hours. */
export const formatHours = (h: number) => {
  const total = Math.floor((((h % 24) + 24) % 24) * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

// ---- REMS weather ------------------------------------------------------------------------
export interface RemsSol {
  sol: number
  /** Earth date of the sol (UTC), YYYY-MM-DD */
  date: string
  /** air temperature 1.5 m above ground, °C */
  airMin: number
  airMax: number
  /** ground temperature, °C (null when not reported) */
  groundMin: number | null
  groundMax: number | null
  /** mean surface pressure, Pa */
  pressurePa: number | null
  /** local sunrise / sunset, hours */
  sunriseH: number
  sunsetH: number
  /** areocentric solar longitude, degrees (season) */
  ls: number | null
  opacity: string
  uv: string
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const toNum = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const clock = (v: unknown): number | null => {
  const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) + Number(m[2]) / 60 : null
}

/** Parse the REMS feed into sols, newest first. Sols without both air temperatures are skipped ("--" in the feed). */
export function parseRems(j: unknown, limit = 7): RemsSol[] {
  if (!isObj(j) || !Array.isArray(j.soles)) return []
  const out: RemsSol[] = []
  for (const s of j.soles) {
    if (!isObj(s)) continue
    const sol = toNum(s.sol)
    const airMin = toNum(s.min_temp)
    const airMax = toNum(s.max_temp)
    if (sol === null || airMin === null || airMax === null || airMin > airMax || airMin < -140 || airMax > 40) continue
    out.push({
      sol,
      date: typeof s.terrestrial_date === 'string' ? s.terrestrial_date : '',
      airMin,
      airMax,
      groundMin: toNum(s.min_gts_temp),
      groundMax: toNum(s.max_gts_temp),
      pressurePa: toNum(s.pressure),
      sunriseH: clock(s.sunrise) ?? 6,
      sunsetH: clock(s.sunset) ?? 18,
      ls: toNum(s.ls),
      opacity: typeof s.atmo_opacity === 'string' && s.atmo_opacity !== '--' ? s.atmo_opacity : '',
      uv: typeof s.local_uv_irradiance_index === 'string' && s.local_uv_irradiance_index !== '--' ? s.local_uv_irradiance_index : '',
    })
  }
  return out.sort((a, b) => b.sol - a.sol).slice(0, limit)
}

// Real report from the feed, captured 2026-11-14, served when the feed cannot be reached.
const REMS_FALLBACK: RemsSol[] = [
  { sol: 4995, date: '2026-08-25', airMin: -71, airMax: -5, groundMin: -84, groundMax: 4, pressurePa: 777, sunriseH: 6 + 46 / 60, sunsetH: 18 + 51 / 60, ls: 341, opacity: 'Sunny', uv: 'Moderate' },
  { sol: 4994, date: '2026-08-24', airMin: -70, airMax: -7, groundMin: -82, groundMax: 4, pressurePa: 777, sunriseH: 6 + 46 / 60, sunsetH: 18 + 52 / 60, ls: 340, opacity: 'Sunny', uv: 'Moderate' },
]

export const REMS_URL = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json'
/** this app's own relay (api/rems.ts): the feed itself does not reliably allow browser requests */
export const REMS_RELAY = '/api/rems'

export const fetchRems = (): Promise<Feed<RemsSol[]>> =>
  cached<RemsSol[]>(
    'rems',
    6 * 3600_000,
    async () => {
      // relay first; the feed directly as a second try for a static deployment without the function
      for (const url of [REMS_RELAY, REMS_URL]) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
          if (!r.ok) continue
          const sols = parseRems(await r.json())
          if (sols.length) return sols
        } catch {
          /* try the next source */
        }
      }
      throw new Error('REMS feed unreachable')
    },
    REMS_FALLBACK,
    { isValid: (d) => Array.isArray(d) && d.length > 0 && typeof (d[0] as RemsSol).airMin === 'number' },
  )

/** hour of the afternoon air-temperature maximum on Mars (REMS diurnal cycles peak around 14–15 h local) */
export const PEAK_HOUR = 14.5

/**
 * Air temperature at local time `lmstHours`, shaped from one sol's measured minimum and maximum:
 * coldest at sunrise, warmest mid-afternoon, with a half-cosine rise between the two and a slower
 * half-cosine fall through the night. A model between two measured values, not a measurement.
 */
export function modelAirTemp(sol: Pick<RemsSol, 'airMin' | 'airMax' | 'sunriseH'>, lmstHours: number): number {
  const h = ((lmstHours % 24) + 24) % 24
  const rise = Math.min(Math.max(sol.sunriseH, 3), 9)
  const ease = (x: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, x)))) / 2
  const span = sol.airMax - sol.airMin
  if (h >= rise && h <= PEAK_HOUR) return sol.airMin + span * ease((h - rise) / (PEAK_HOUR - rise))
  const sinceMax = h > PEAK_HOUR ? h - PEAK_HOUR : h + 24 - PEAK_HOUR
  return sol.airMax - span * ease(sinceMax / (24 - PEAK_HOUR + rise))
}
