import { useEffect, useState, useSyncExternalStore } from 'react'
import { ExternalLink, Satellite } from 'lucide-react'
import { nasaLive } from '../data/nasaSource'
import { useDataMode } from '../hooks/useTelemetry'
import { formatHours, marsClock } from '../data/mars'
import { feedFreshness, type Feed, type Freshness } from '../data/nasaApi'
import { useDomId } from '../hooks/useDomId'

const useLive = () => useSyncExternalStore(nasaLive.subscribe, nasaLive.get)

/** Re-render once a minute so "updated N min ago" and freshness stay current. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function age(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

const COLOR: Record<Freshness, string> = { fresh: 'var(--ok)', stale: '#F2B04C', snapshot: 'var(--taupe)' }

function Src({ name, feed, now, children }: { name: string; feed: Feed<unknown> | null; now: number; children: React.ReactNode }) {
  const f = feed ? feedFreshness(feed, now) : null
  const color = f ? COLOR[f] : 'var(--taupe)'
  const tag = !feed || !f ? 'loading' : f === 'snapshot' ? 'offline snapshot' : `${f} · ${feed.origin === 'cache' ? 'cached ' : 'updated '}${age(now - feed.fetchedAt)}`
  const title = !feed
    ? 'Fetching…'
    : f === 'snapshot'
      ? 'Feed unreachable from this browser (offline, blocked by CORS, rate-limited or retired): showing a bundled real snapshot captured earlier'
      : `${feed.origin === 'cache' ? 'Read from local cache' : 'Fetched from the network'}; fresh for ${Math.round(feed.ttlMs / 60_000)} min${feed.refreshFailed ? ' — latest refresh failed' : ''}`
  return (
    <div className="rounded-xl p-3" style={{ border: '1px solid var(--hair)', background: 'rgba(0,0,0,.25)' }}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label">{name}</span>
        <span className="label flex shrink-0 items-center gap-1.5" style={{ color }} title={title}>
          <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: color }} />
          {tag}
        </span>
      </div>
      <div className="text-[13px]" style={{ color: 'var(--ink)' }}>{children}</div>
    </div>
  )
}

/** Shows which NASA/NOAA datasets are driving the numbers on screen, and their live status. */
export function NasaDataCard() {
  const l = useLive()
  const now = useMinuteClock()
  const headingId = useDomId('nasa-h')
  const sol = l.mars?.data[0]
  const stormColor = l.storm === 'S0' ? 'var(--ok)' : '#F2B04C'
  const archiveYear = sol?.firstUtc ? sol.firstUtc.slice(0, 4) : ''
  const mode = useDataMode()
  const rems = l.rems?.data[0]
  if (mode === 'sim' || mode === 'ws') {
    return (
      <section className="glass rise p-4" aria-labelledby={headingId} style={{ ['--i' as string]: 2 }}>
        <header className="mb-2 flex items-center gap-2">
          <Satellite size={16} />
          <h2 id={headingId} className="display text-[20px]">NASA data feeds</h2>
        </header>
        <p className="text-[13px]" style={{ color: 'var(--taupe)' }}>
          Not used in this data mode ({mode === 'sim' ? 'fully simulated telemetry' : 'telemetry from the WebSocket backend'}). Switch to live NASA data in the menu to use the NASA/NOAA feeds.
        </p>
      </section>
    )
  }
  return (
    <section className="glass rise src src-real p-4" aria-labelledby={headingId} style={{ ['--i' as string]: 2 }}>
      <header className="mb-3 flex items-center gap-2">
        <Satellite size={16} />
        <h2 id={headingId} className="display text-[20px]">NASA data feeds</h2>
      </header>
      <div className="grid gap-2.5">
        {mode === 'live' && (
          <Src name="Curiosity REMS weather · mars.nasa.gov" feed={l.rems} now={now}>
            {rems ? (
              <>
                Newest report, sol {rems.sol} ({rems.date}) at Gale crater: air <b className="num">{rems.airMin}…{rems.airMax} °C</b>
                {rems.groundMin !== null && rems.groundMax !== null ? <>, ground {rems.groundMin}…{rems.groundMax} °C</> : null}
                {rems.pressurePa !== null ? <>, pressure <b className="num">{rems.pressurePa} Pa</b></> : null}
                {rems.opacity ? `, ${rems.opacity.toLowerCase()}` : ''}
                {rems.uv ? `, UV ${rems.uv.toLowerCase()}` : ''}. Sunrise {formatHours(rems.sunriseH)}, sunset {formatHours(rems.sunsetH)}.{' '}
                Placed on the local time there now ({formatHours(marsClock(now).lmstHours)}): <b className="num">{Number.isFinite(l.outsideTemp) ? l.outsideTemp : '—'} °C</b>.{' '}
                <span style={{ opacity: 0.7 }}>Reports reach the public feed days to weeks after the sol; the feed carries no wind data.</span>
              </>
            ) : (
              'Loading…'
            )}
          </Src>
        )}
        {mode !== 'live' && <Src name="InSight Mars weather · api.nasa.gov" feed={l.mars} now={now}>
          {sol ? (
            <>
              Measured sol {sol.sol}{archiveYear ? ` (${archiveYear}, archive — InSight ended 2022)` : ''}{sol.season ? ` · ${sol.season}` : ''}: air {sol.tMin.toFixed(0)}…{sol.tMax.toFixed(0)} °C · wind avg {sol.windAvg.toFixed(1)} m/s, gust {sol.windMax.toFixed(0)} m/s.{' '}
              Modelled now from that sol: <b className="num">{l.outsideTemp} °C</b>, <b className="num">{l.wind} km/h</b>.{' '}
              <span style={{ opacity: 0.7 }}>Suit surface temperatures are simulated from this value.</span>
            </>
          ) : (
            'Loading…'
          )}
        </Src>}
        <Src name="GOES proton flux · NOAA SWPC" feed={l.protons} now={now}>
          ≥10 MeV <b className="num">{l.p10.toFixed(2)}</b> pfu at Earth · storm <b style={{ color: stormColor }}>{l.storm}</b> · modelled dose rate on Mars <b className="num">{l.doseRateUSvH.toFixed(2)}</b> µSv/h <span style={{ opacity: 0.7 }}>(MSL-RAD background + GOES protons scaled to Mars; chain on the Science tab)</span>
          {l.rad && l.rad.advice !== 'go' && <b className="mt-1 block" style={{ color: '#F2B04C' }}>{l.rad.headline}</b>}
        </Src>
        <Src name="DONKI space weather · NASA CCMC" feed={l.donki} now={now}>
          {l.donki
            ? l.donki.data.length
              ? l.donki.data.slice(0, 3).map((n) => (
                  <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="mb-1 flex items-start gap-1.5 last:mb-0" style={{ color: 'inherit' }}>
                    <ExternalLink size={11} className="mt-1 shrink-0" />
                    <span>
                      <b>{n.type}</b> · {n.issued.slice(0, 10)} · {n.summary}
                    </span>
                  </a>
                ))
              : 'No notifications in the last 14 days.'
            : 'Loading…'}
        </Src>
        <Src name="OSDR astronaut studies · GeneLab" feed={l.osdr} now={now}>
          <span className="mb-1 block">
            Used in a calculation: the Inspiration4 crew’s blood panels (<b>OSD-569</b>, <b>OSD-575</b>) give the within-person vs between-person variation that justifies the personal baseline — see Science → Evidence.
          </span>
          {l.osdr?.data.map((s) => (
            <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="mb-1 flex items-start gap-1.5 last:mb-0" style={{ color: 'inherit' }}>
              <ExternalLink size={11} className="mt-1 shrink-0" />
              <span><b>{s.id}</b> · {s.title}{s.material ? ` (${s.material})` : ''}</span>
            </a>
          )) ?? 'Loading…'}
        </Src>
      </div>
    </section>
  )
}
