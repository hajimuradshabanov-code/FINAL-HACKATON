import { memo, useMemo } from 'react'
import { STATUS_COLOR, type Status } from '../config/thresholds'
import { isSimulation } from '../data/createSource'
import { useDataMode, useTelemetrySelect } from '../hooks/useTelemetry'
import { useDomId } from '../hooks/useDomId'
import { formatNumber } from '../lib/format'
import { TRAIL_STEPS, layFootprints, pointAlong } from '../lib/footprints'

/** the route fits in this box (map units); the terrain continues beyond it so any card shape is filled */
const W = 340
const H = 230
const GROUND = '#1a0f0a'
/** a footprint made while every vital was inside its band is the colour of pressed dust, not a status colour */
const PRINT_COLOR: Record<Status, string> = { normal: '#eadbcd', warning: STATUS_COLOR.warning, critical: STATUS_COLOR.critical }
const STATUS_WORD: Record<Status, string> = { normal: 'nominal', warning: 'warning', critical: 'critical' }
/** length of a boot print in map units */
const PRINT = 9.5

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Schematic relief: closed contour lines around a few hills. Drawn for orientation, not surveyed. */
function buildContours() {
  const r = rng(51)
  const hills = [
    { x: 90, y: 70, n: 11, s: 9 },
    { x: 250, y: 150, n: 13, s: 8 },
    { x: 180, y: 40, n: 6, s: 7 },
    { x: 60, y: 190, n: 7, s: 8 },
    // beyond the route, so a wide or tall card is not empty at the edges
    { x: -90, y: 50, n: 9, s: 9 },
    { x: 430, y: 20, n: 10, s: 9 },
    { x: 440, y: 220, n: 8, s: 8 },
    { x: 170, y: 310, n: 9, s: 9 },
    { x: -60, y: 270, n: 6, s: 8 },
    { x: 210, y: -90, n: 8, s: 9 },
  ]
  const paths: { d: string; o: number }[] = []
  for (const h of hills) {
    const ph = [r() * 6, r() * 6, r() * 6]
    for (let i = 1; i <= h.n; i++) {
      const base = i * h.s
      const pts: string[] = []
      for (let a = 0; a <= 72; a++) {
        const t = (a / 72) * Math.PI * 2
        const wob = 1 + 0.16 * Math.sin(2 * t + ph[0] + i * 0.2) + 0.1 * Math.sin(3 * t + ph[1]) + 0.06 * Math.sin(5 * t + ph[2])
        pts.push(`${(h.x + Math.cos(t) * base * wob * 1.25).toFixed(1)} ${(h.y + Math.sin(t) * base * wob * 0.8).toFixed(1)}`)
      }
      paths.push({ d: `M${pts.join('L')}Z`, o: 0.25 + (i / h.n) * 0.6 })
    }
  }
  return paths
}

const bez = (p: number[][], t: number) => {
  const u = 1 - t
  return [0, 1].map((i) => u * u * u * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t * t * t * p[3][i])
}
const SEG = [
  [[292, 38], [248, 52], [236, 108], [190, 124]],
  [[190, 124], [146, 140], [104, 168], [62, 184]],
]
const ROUTE = SEG.flatMap((s) => Array.from({ length: 61 }, (_, i) => bez(s, i / 60)))
const ROUTE_LENGTH = ROUTE.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - ROUTE[i][0], p[1] - ROUTE[i][1]), 0)
const [START, END] = [ROUTE[0], ROUTE[ROUTE.length - 1]]
const line = (pts: number[][]) => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')
const utc = (t: number) => new Date(t).toISOString().slice(11, 19)
const LABEL = { fill: '#f2e9e1', fontSize: 8, fontFamily: 'IBM Plex Mono', letterSpacing: 1 }

/** One boot print, toe towards +x, 6 units long before scaling: heel, sole and the tread bars. */
function BootPrint({ color }: { color: string }) {
  return (
    <>
      <rect x="-3" y="-0.95" width="1.75" height="1.9" rx="0.8" fill={color} />
      <rect x="-0.85" y="-1.25" width="3.85" height="2.5" rx="1.2" fill={color} />
      <path d="M-2.12 -0.95V0.95M0.2 -1.25V1.25M1.15 -1.25V1.25M2.1 -1.25V1.25" stroke={GROUND} strokeWidth="0.34" fill="none" />
    </>
  )
}

/**
 * Major surface features of Mars at their catalogued coordinates (IAU / USGS Gazetteer of Planetary
 * Nomenclature): [name, latitude °N, longitude °E, label placement].
 */
const FEATURES: readonly [string, number, number, 'above' | 'below' | 'left' | 'right'][] = [
  ['Olympus Mons', 18.65, 226.2, 'above'],
  ['Tharsis Montes', 1.48, 247.04, 'left'],
  ['Valles Marineris', -13.9, 300.8, 'below'],
  ['Argyre Planitia', -49.7, 316, 'below'],
  ['Syrtis Major', 8.4, 69.5, 'left'],
  ['Jezero crater', 18.38, 77.58, 'right'],
  ['Hellas Planitia', -42.4, 70.5, 'below'],
  ['Utopia Planitia', 46.7, 117.5, 'above'],
  ['Elysium Mons', 25.02, 147.21, 'above'],
  ['Gale crater', -5.4, 137.8, 'below'],
]
/** The simulated EVA is placed at the InSight landing site, where the simulation's weather was measured. */
const EVA_SITE = { lat: 4.5, lonEast: 135.62 }
/** Position on the map image: simple cylindrical projection, 0° longitude in the centre. */
const onGlobe = (lat: number, lonEast: number) => [(lonEast + 180) % 360, 90 - lat] as const
const PLACE = { above: [0, -4, 'middle'], below: [0, 8, 'middle'], left: [-4, 1.8, 'end'], right: [4, 1.8, 'start'] } as const
const GLOBE_LABEL = { fontSize: 5, fontFamily: 'IBM Plex Mono', letterSpacing: 0.3, paintOrder: 'stroke', stroke: '#14100e', strokeWidth: 1.5 }

/** Where on Mars: the real global map with its major surface features, and the site of the EVA. */
function MarsFeatures({ site }: { site: boolean }) {
  const [sx, sy] = onGlobe(EVA_SITE.lat, EVA_SITE.lonEast)
  return (
    <div className="grid gap-2.5 border-t p-4" style={{ borderColor: 'var(--hair)' }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="label" style={{ color: 'var(--ink)', fontSize: 11 }}>
          Mars · major surface features
        </h3>
        <span className="stamp stamp-real">Real map</span>
      </div>
      <div className="scroll-hide overflow-x-auto rounded-lg">
        <svg viewBox="0 0 360 180" className="block w-full min-w-[560px]" role="img" aria-label={`Global map of Mars with its major surface features: ${FEATURES.map((f) => f[0]).join(', ')}, and the polar caps.${site ? ' The simulated EVA site is marked in Elysium Planitia.' : ''}`}>
          <image href="/mars-mdim21.webp" width="360" height="180" preserveAspectRatio="none" style={{ filter: 'brightness(.82) saturate(.95)' }} />
          <path d="M0 90H360" stroke="rgba(242,233,225,.25)" strokeWidth=".4" strokeDasharray="2 3" />
          {FEATURES.map(([name, lat, lon, where]) => {
            const [x, y] = onGlobe(lat, lon)
            const [dx, dy, anchor] = PLACE[where]
            return (
              <g key={name}>
                <circle cx={x} cy={y} r="1.6" fill="none" stroke="#f2e9e1" strokeWidth=".7" />
                <text x={x + dx} y={y + dy} textAnchor={anchor} fill="#f2e9e1" {...GLOBE_LABEL}>
                  {name.toUpperCase()}
                </text>
              </g>
            )
          })}
          <text x="180" y="9" textAnchor="middle" fill="#f2e9e1" {...GLOBE_LABEL}>
            PLANUM BOREUM · NORTH POLAR CAP
          </text>
          <text x="180" y="175" textAnchor="middle" fill="#f2e9e1" {...GLOBE_LABEL}>
            PLANUM AUSTRALE · SOUTH POLAR CAP
          </text>
          {site && (
            <g>
              <circle cx={sx} cy={sy} r="3.2" fill="none" stroke="#c9a8ff" strokeWidth=".8" strokeDasharray="1.4 1">
                <animate attributeName="r" values="2.4;4.6;2.4" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx={sx} cy={sy} r="1.3" fill="#c9a8ff" />
              <text x={sx - 6} y={sy + 1.8} textAnchor="end" fill="#c9a8ff" {...GLOBE_LABEL}>
                EVA-1 SITE
              </text>
            </g>
          )}
        </svg>
      </div>
      <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--taupe)' }}>
        Real map: Viking colour mosaic of Mars (NASA / JPL / USGS), 0° longitude in the centre, with the features at their catalogued coordinates.
        {site && ' The EVA-1 site in violet is part of the simulation: it is placed at the InSight landing site in Elysium Planitia (4.50° N, 135.62° E), where the simulation’s weather data was measured.'}
      </p>
    </div>
  )
}

/**
 * The surface traverse as a trail of boot prints. Every print marks one stretch of the walked route
 * and is coloured by the worst vital status on that stretch; the dashed line is the route ahead.
 */
export const SurfaceMap = memo(function SurfaceMap({ tall = false, index = 0, height }: { tall?: boolean; index?: number; height?: number }) {
  const contours = useMemo(buildContours, [])
  const progress = useTelemetrySelect((s) => (Number.isFinite(s.latest?.progress) ? Math.min(1, Math.max(0, s.latest!.progress)) : 0))
  const dist = useTelemetrySelect((s) => s.latest?.distanceKm ?? NaN)
  const eta = useTelemetrySelect((s) => s.latest?.etaMin ?? NaN)
  const eva = useTelemetrySelect((s) => s.latest?.evaActive ?? false)
  const trail = useTelemetrySelect((s) => s.trail)
  const simulation = isSimulation(useDataMode())
  const headingId = useDomId('map-h')
  const glowId = useDomId('map-glow')

  const here = pointAlong(ROUTE, progress)
  const split = Math.round(progress * (ROUTE.length - 1))
  const totalKm = progress < 0.999 ? dist / (1 - progress) : NaN
  const prints = useMemo(() => layFootprints(ROUTE, trail, PRINT * 0.4), [trail])
  const count = (st: Status) => trail.filter((s) => s.status === st).length
  const barKm = 2
  const bar = (barKm * ROUTE_LENGTH) / totalKm

  return (
    <section className={`glass rise overflow-hidden src ${simulation ? 'src-sim' : 'src-real'}`} style={{ ['--i' as string]: index }} aria-labelledby={headingId}>
      <header className="p-4 pb-2">
        <h2 id={headingId} className="display text-[20px]">
          Footprint map
        </h2>
        <p className="label mt-1">{simulation ? 'Simulated traverse' : 'Traverse from telemetry'} · schematic terrain</p>
      </header>
      <div className="relative" style={{ height: height ?? (tall ? 420 : 230), background: GROUND }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`Map of the surface traverse. ${trail.length} of ${TRAIL_STEPS} stretches walked, shown as boot prints: ${count('normal')} nominal, ${count('warning')} warning, ${count('critical')} critical.`}>
          <defs>
            <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
          </defs>
          <g filter={`url(#${glowId})`} fill="none" stroke="#ff6a1f" strokeWidth="1.6">
            {contours.map((c, i) => (
              <path key={i} d={c.d} opacity={c.o * 0.4} />
            ))}
          </g>
          <g fill="none" stroke="#ff9a52" strokeWidth=".7">
            {contours.map((c, i) => (
              <path key={i} d={c.d} opacity={c.o * 0.75} />
            ))}
          </g>

          <path d={line([[here.x, here.y], ...ROUTE.slice(split + 1)])} fill="none" stroke="#f2e9e1" strokeWidth="1.2" strokeDasharray="4 4" opacity=".8" />
          <circle cx={START[0]} cy={START[1]} r="3.5" fill={GROUND} stroke="#f2e9e1" strokeWidth="1.1" />
          <text x={START[0] + 7} y={START[1] - 6} {...LABEL}>
            START
          </text>
          <rect x="-3.5" y="-3.5" width="7" height="7" transform={`translate(${END[0]} ${END[1]}) rotate(45)`} fill={GROUND} stroke="#f2e9e1" strokeWidth="1.1" />
          <text x={END[0] + 9} y={END[1] + 12} {...LABEL}>
            LANDING SITE
          </text>

          {prints.map((p, i) => (
            <g key={i} transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.deg.toFixed(1)}) scale(${PRINT / 6})`} opacity={p.status === 'normal' ? 0.55 + (0.45 * (i + 1)) / prints.length : 1}>
              <title>{`${formatNumber(p.at * totalKm, 2)} km · ${utc(p.t)} UTC · HR ${formatNumber(p.hr, 0)} bpm · ${STATUS_WORD[p.status]}`}</title>
              <g className={i === prints.length - 1 ? 'print-in' : undefined}>
                <BootPrint color={PRINT_COLOR[p.status]} />
              </g>
            </g>
          ))}

          <g style={{ transform: `translate(${here.x}px, ${here.y}px)`, transition: 'transform 1s linear' }}>
            <circle r="11" fill="#ff6a1f" opacity=".18">
              <animate attributeName="r" values="5;16" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values=".45;0" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <circle r="4.5" fill="#ff6a1f" stroke="#f2e9e1" strokeWidth="1.2" />
          </g>

          {Number.isFinite(bar) && (
            <g transform={`translate(12 ${H - 12})`}>
              <path d={`M0 -4V0H${bar.toFixed(1)}V-4`} fill="none" stroke="#f2e9e1" strokeWidth="1" />
              <text x={bar + 6} y="0" {...LABEL}>
                {barKm} KM
              </text>
            </g>
          )}
        </svg>
        <div className="label num pointer-events-none absolute left-3 top-3 rounded-full px-3 py-1.5" style={{ background: 'rgba(20,14,11,.82)', border: '1px solid var(--hair)', color: 'var(--ink)' }}>
          {eva ? 'Walking' : 'Resting'} · {formatNumber(dist, 1)} km to go · ETA {Number.isFinite(eta) ? `${eta} min` : '—'}
        </div>
      </div>

      <div className="grid gap-2.5 p-4 pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="label num" style={{ color: 'var(--ink)' }}>
            Walked {formatNumber(totalKm * progress, 2)} km · {trail.length} / {TRAIL_STEPS} prints
          </span>
          {(['normal', 'warning', 'critical'] as const).map((st) => (
            <span key={st} className="label num flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
              <svg width="18" height="9" viewBox="-3.4 -1.6 6.8 3.2" aria-hidden="true">
                <BootPrint color={PRINT_COLOR[st]} />
              </svg>
              {count(st)} {STATUS_WORD[st]}
            </span>
          ))}
        </div>
        <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--taupe)' }}>
          Each boot print marks one stretch of the walked route and takes the colour of the worst vital status on it. Prints are drawn far larger than life, and the terrain is schematic, not a survey of Mars.
        </p>
      </div>
      <MarsFeatures site={simulation} />
    </section>
  )
})
