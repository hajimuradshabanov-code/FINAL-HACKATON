import { useState } from 'react'
import { LayoutDashboard, HeartPulse, Map as MapIcon, Bell, Users, Atom } from 'lucide-react'
import { useDataMode, useTelemetrySelect } from '../hooks/useTelemetry'
import { LIVE_SUMMARY, MarsClockLabel } from './LiveViews'
import { Wordmark } from './Wordmark'
import { HeaderActions } from './HeaderActions'
import { LiveBadge } from './LiveBadge'
import { HeroGauge } from './HeroGauge'
import { VitalsCard } from './VitalsCard'
import { SurfaceMap } from './SurfaceMap'
import { TimelineChart } from './TimelineChart'
import { SuitVitalsCard } from './SuitVitalsCard'
import { AlertToast } from './AlertToast'
import { NasaDataCard } from './NasaDataCard'
import { MetricRow } from './MetricRow'
import { Insights, CheckIn, Hazards } from './HealthCheck'
import { AlertsView, OutsideFooter } from './MobileApp'
import { CrewRoster } from './CrewRoster'
import { ScienceView } from './SciencePanel'
import { RadiationDecisionCard } from './ScienceEvidence'
import { tabAvailable, type Tab } from './TabBar'
import { HealthStatusCard } from './HealthStatusCard'
import { MonitoringBrief } from './MonitoringBrief'
import { useSourceStrip } from './Provenance'

const TABS: { id: Tab; label: string; icon: typeof Bell }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'vitals', label: 'Vitals', icon: HeartPulse },
  { id: 'science', label: 'Science', icon: Atom },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'crew', label: 'Crew', icon: Users },
]

function Clock() {
  const utc = useTelemetrySelect((s) => s.latest?.utc ?? '--:--:--')
  const sol = useTelemetrySelect((s) => s.latest?.sol)
  const live = useDataMode() === 'live'
  return (
    <div className="text-right">
      <div className="label num">{live ? <MarsClockLabel /> : `SOL ${sol ?? '—'} · MET`}</div>
      <div className="display num text-[22px] leading-tight">{utc} <span className="unit">UTC</span></div>
    </div>
  )
}

function NavTabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const count = useTelemetrySelect((s) => s.activeAlerts)
  const live = useDataMode() === 'live'
  return (
    <nav aria-label="Primary" className="flex gap-1">
      {TABS.filter((t) => tabAvailable(t.id, live)).map(({ id, label, icon: Icon }) => {
        const on = tab === id
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-current={on ? 'page' : undefined}
            className="label relative flex items-center gap-2 rounded-lg px-4 py-2.5"
            style={{ color: on ? 'var(--ink)' : 'var(--taupe)', background: on ? 'rgba(255,255,255,.08)' : 'transparent', border: '1px solid', borderColor: on ? 'var(--hair)' : 'transparent', cursor: 'pointer' }}
          >
            <Icon size={15} strokeWidth={on ? 1.8 : 1.4} />
            {label}
            {id === 'alerts' && count > 0 && (
              <span aria-label={`${count} active alerts`} className="num grid h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[9px]" style={{ background: 'var(--alert)', color: '#fff' }}>
                {count}
              </span>
            )}
            {on && <span className="absolute inset-x-3 -bottom-px h-px" style={{ background: 'var(--lava)', boxShadow: '0 0 8px var(--lava)' }} />}
          </button>
        )
      })}
    </nav>
  )
}

function SuitSystems() {
  return (
    <section className="glass rise grid gap-4 p-4" style={{ ['--i' as string]: 1 }}>
      <div className="label">Suit systems</div>
      <MetricRow k="o2Tank" visual="bar" />
      <MetricRow k="battery" visual="bar" />
      <MetricRow k="coolantTemp" />
      <MetricRow k="respRate" />
    </section>
  )
}

/** Outside temperature in its own card, marked by where the figure comes from. */
function OutsideCard({ index = 0 }: { index?: number }) {
  const strip = useSourceStrip(['outsideTemp'])
  return (
    <div className={`glass rise p-5 ${strip}`} style={{ ['--i' as string]: index }}>
      <OutsideFooter />
    </div>
  )
}

/** Progress of the traverse with radio signal, wind and rover range. */
function TraverseCard() {
  const strip = useSourceStrip(['signal', 'wind', 'roverRange'])
  return (
    <div className={`glass rise grid place-items-center py-4 ${strip}`} style={{ ['--i' as string]: 1 }}>
      <HeroGauge />
    </div>
  )
}

export function DesktopApp() {
  const [picked, setTab] = useState<Tab>('dashboard')
  const live = useDataMode() === 'live'
  // the surface traverse only exists in the simulation
  const tab = tabAvailable(picked, live) ? picked : 'dashboard'
  const title = { dashboard: live ? 'Live Monitor' : 'Health Monitor', vitals: 'Crew Health', science: 'Mission Science', map: 'Footprint Map', alerts: 'Event Log', crew: 'Crew & Suit' }[tab]
  const sub = live
    ? { dashboard: LIVE_SUMMARY, vitals: 'Self-assessment and daily check-in', science: 'Published mission models on live NASA / NOAA data', map: '', alerts: 'Raised from measured values only', crew: 'Crew on this device · suit channels need a suit telemetry link' }[tab]
    : { dashboard: 'Training simulation · one crew member on a Mars surface EVA · EVA-1', vitals: 'Self-assessment and daily check-in', science: 'Published physiological and mission models on the simulated stream', map: 'Every stretch walked, coloured by the vital status on it', alerts: 'Anomalies and resolutions', crew: 'EVA-1 suit inspector' }[tab]

  return (
    <div className="relative min-h-screen">
      <div aria-hidden="true" className="fixed inset-0" style={{ backgroundImage: 'url(/bg-wide.webp)', backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(3px) brightness(.5)', transform: 'scale(1.04)' }} />
      <div aria-hidden="true" className="fixed inset-0" style={{ background: 'linear-gradient(180deg, rgba(14,10,8,.7), rgba(14,10,8,.35) 40%, rgba(14,10,8,.85))' }} />
      <div className="pointer-events-none fixed right-6 top-24 z-50 w-[380px]">
        <div className="pointer-events-auto relative">
          <AlertToast />
        </div>
      </div>

      <header className="sticky top-0 z-40 flex items-center justify-between gap-6 px-8 py-3" style={{ background: 'rgba(16,11,9,.72)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--hair)' }}>
        <div className="flex items-center gap-8">
          <Wordmark height={42} />
          <NavTabs tab={tab} onChange={setTab} />
        </div>
        <div className="flex items-center gap-5">
          <LiveBadge />
          <Clock />
          <HeaderActions showLayoutSwitch />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1680px] px-8 pb-12 pt-8">
        <div className="rise mb-7">
          <p className="label">NASA Space Apps 2026 · Challenge: Create health monitoring software</p>
          <h1 className="display mt-2 text-[56px] leading-none">{title}</h1>
          <p className="label mt-3" style={{ color: 'var(--ink)', opacity: 0.75 }}>
            {sub}
          </p>
        </div>

        {tab === 'dashboard' && live && (
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-4 grid gap-5">
              <HealthStatusCard />
              <Insights />
              <OutsideCard index={1} />
            </div>
            <div className="col-span-4 grid gap-5">
              <RadiationDecisionCard />
            </div>
            <div className="col-span-4 grid gap-5">
              <VitalsCard index={2} />
              <NasaDataCard />
            </div>
          </div>
        )}

        {tab === 'dashboard' && !live && (
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-4 grid gap-5">
              <HealthStatusCard />
              <Insights />
              <OutsideCard index={2} />
            </div>
            <div className="col-span-4 grid gap-5">
              <VitalsCard index={1} />
            </div>
            <div className="col-span-4">
              <SuitVitalsCard height={250} />
            </div>
            <div className="col-span-12">
              <MonitoringBrief layout="desktop" index={3} />
            </div>
            <div className="col-span-7">
              <SurfaceMap height={360} index={3} />
            </div>
            <div className="col-span-5 grid gap-5">
              <TimelineChart />
              <NasaDataCard />
            </div>
          </div>
        )}

        {tab === 'vitals' && (
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-4 grid gap-5">
              <VitalsCard />
              {!live && <SuitSystems />}
            </div>
            <div className="col-span-4 grid gap-5">
              <Insights />
              <Hazards />
              <NasaDataCard />
            </div>
            <div className="col-span-4 grid gap-5">
              <CheckIn />
              <TimelineChart />
            </div>
          </div>
        )}

        {tab === 'science' && <ScienceView layout="desktop" />}

        {tab === 'map' && (
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-8">
              <SurfaceMap height={560} />
            </div>
            <div className="col-span-4 grid gap-5">
              <TraverseCard />
              <OutsideCard />
              <TimelineChart />
            </div>
          </div>
        )}

        {tab === 'alerts' && (
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-5 -mx-4">
              <AlertsView />
            </div>
            <div className="col-span-7 grid gap-5">
              <TimelineChart />
              <VitalsCard />
            </div>
          </div>
        )}

        {tab === 'crew' && (
          <div className="grid grid-cols-12 items-start gap-5">
            <div className="col-span-5">
              <SuitVitalsCard height={420} />
            </div>
            <div className="col-span-4 grid gap-5">
              <VitalsCard />
            </div>
            <div className="col-span-3 grid gap-5">
              <CrewRoster />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
