import { useState } from 'react'
import { Zap } from 'lucide-react'
import { METRICS } from '../config/thresholds'
import { useDataMode, useTelemetry, useTelemetrySelect, useTelemetryStore } from '../hooks/useTelemetry'
import { isSimulation } from '../data/createSource'
import { LIVE_SUMMARY, RemsSourceLine } from './LiveViews'
import { Header } from './Header'
import { LiveBadge } from './LiveBadge'
import { HeroGauge } from './HeroGauge'
import { VitalsCard } from './VitalsCard'
import { SurfaceMap } from './SurfaceMap'
import { TabBar, tabAvailable, type Tab } from './TabBar'
import { AlertToast } from './AlertToast'
import { SuitVitalsCard } from './SuitVitalsCard'
import { MetricRow } from './MetricRow'
import { AnimatedNumber } from './AnimatedNumber'
import { formatNumber } from '../lib/format'
import { Insights, CheckIn, Hazards } from './HealthCheck'
import { NasaDataCard } from './NasaDataCard'
import { CrewRoster } from './CrewRoster'
import { ScienceView } from './SciencePanel'
import { RadiationDecisionCard } from './ScienceEvidence'
import { OriginTag, useOrigin } from './OriginTag'
import { HealthStatusCard } from './HealthStatusCard'
import { MonitoringBrief } from './MonitoringBrief'

function Title({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rise flex items-end justify-between px-4 pb-3 pt-4">
      <div>
        <h1 className="display text-[40px] leading-none">{title}</h1>
        <p className="label mt-2" style={{ color: 'var(--ink)', opacity: 0.75 }}>
          {sub}
        </p>
      </div>
      <LiveBadge />
    </div>
  )
}

export function OutsideFooter() {
  const t = useTelemetrySelect((s) => s.latest?.outsideTemp ?? NaN)
  const origin = useOrigin('outsideTemp')
  const live = useDataMode() === 'live'
  const source = live ? <RemsSourceLine /> : origin === 'modelled' ? 'Modelled from NASA InSight sol data (archive, 2019–2022)' : origin === 'reported' ? 'Reported by suit telemetry' : 'Simulated environment'
  return (
    <div className="rise flex items-end justify-between px-1 pt-1" style={{ ['--i' as string]: 4 }}>
      <div>
        <div className="label flex items-center gap-2">
          {live ? 'Mars air temperature' : 'Outside temperature'} <OriginTag k="outsideTemp" />
        </div>
        <div className="flex items-baseline">
          <AnimatedNumber value={t} className="display text-[64px] leading-none" />
          <span className="display text-[28px]" style={{ color: 'var(--taupe)' }}>
            °C
          </span>
        </div>
      </div>
      <div className="label max-w-[52%] pb-2 text-right" style={{ textTransform: 'none', letterSpacing: '.04em', lineHeight: 1.5 }}>
        {source}
      </div>
    </div>
  )
}

export function AlertsView() {
  const { alerts } = useTelemetry()
  const store = useTelemetryStore()
  const simulation = isSimulation(useDataMode())
  return (
    <div className="grid gap-3 px-4">
      {simulation && (
        <button className="label rounded-xl px-4 py-3 text-left" style={{ border: '1px dashed var(--hair)', background: 'rgba(0,0,0,.25)', cursor: 'pointer' }} onClick={() => store.triggerAnomaly()}>
          <Zap size={12} className="mr-2 inline" />
          Inject anomaly (shortcut: A)
        </button>
      )}
      {alerts.length === 0 && (
        <p className="label py-8 text-center" style={{ textTransform: 'none', letterSpacing: '.04em', fontSize: 12 }}>
          {simulation ? 'No alerts: all systems nominal.' : 'No alerts. An alert is raised when a measured value leaves its safe range, and closes when it recovers or the reading is lost.'}
        </p>
      )}
      {alerts.map((a) => {
        const c = METRICS[a.key]
        const done = a.resolvedAt !== undefined
        return (
          <div key={a.id} className="glass p-3" data-status={done ? 'normal' : a.level} style={{ opacity: done ? 0.6 : 1 }}>
            <div className="flex items-center justify-between">
              <span className="label" style={{ color: 'var(--s)' }}>
                {done ? (a.outcome === 'escalated' ? `${a.level} → escalated` : a.outcome === 'de-escalated' ? `${a.level} → eased` : a.outcome === 'lost' ? `${a.level} · reading lost` : `${a.level} · resolved`) : a.level}
              </span>
              <span className="label num">{new Date(a.t).toISOString().slice(11, 19)} UTC</span>
            </div>
            <div className="num mt-1 text-[16px]">
              {c.label} · {formatNumber(a.value, c.decimals)} {c.unit}
            </div>
            {done && (
              <div className="label mt-1">
                {a.outcome === 'escalated' ? 'superseded by critical' : a.outcome === 'de-escalated' ? 'eased to warning' : a.outcome === 'lost' ? 'sensor stopped reporting' : 'cleared'} {new Date(a.resolvedAt!).toISOString().slice(11, 19)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function MobileApp({ framed = false }: { framed?: boolean }) {
  const [picked, setTab] = useState<Tab>('dashboard')
  const clock = useTelemetrySelect((s) => s.latest?.utc ?? '--:--:--')
  const live = useDataMode() === 'live'
  // the surface traverse only exists in the simulation
  const tab = tabAvailable(picked, live) ? picked : 'dashboard'
  const sub = live
    ? { dashboard: LIVE_SUMMARY, vitals: 'Self-assessment and check-in', science: 'Published models, live NASA / NOAA data', map: '', alerts: 'From measured values only', crew: 'Crew on this device' }[tab]
    : { dashboard: 'Health monitor · training simulation', vitals: 'Crew health', science: 'Published models, simulated stream', map: 'Footprints of the traverse', alerts: 'Event log', crew: 'EVA-1 suit inspector' }[tab]
  const title = { dashboard: live ? 'Live' : 'Health', vitals: 'Vitals', science: 'Science', map: 'Map', alerts: 'Alerts', crew: 'Crew' }[tab]

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#14100e' }}>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: 'url(/bg-wide.webp)', backgroundSize: 'cover', backgroundPosition: '49% 50%' }}
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(16,11,9,.82) 0%, rgba(16,11,9,.35) 28%, rgba(16,11,9,.55) 60%, rgba(16,11,9,.94) 100%)' }} />
      <AlertToast />
      <div className="scroll-hide absolute inset-0 overflow-y-auto pb-[96px]">
        <Header framed={framed} />
        <Title title={title} sub={sub} />
        <div className="grid gap-3 px-3">
          {tab === 'dashboard' && live && (
            <>
              <HealthStatusCard />
              <OutsideFooter />
              <RadiationDecisionCard />
              <VitalsCard index={2} />
              <NasaDataCard />
            </>
          )}
          {tab === 'dashboard' && !live && (
            <>
              <HealthStatusCard />
              <VitalsCard index={2} />
              <SurfaceMap index={3} />
              <OutsideFooter />
              <MonitoringBrief layout="mobile" index={4} />
            </>
          )}
          {tab === 'vitals' && (
            <>
              <VitalsCard />
              <Insights />
              <CheckIn />
              <Hazards />
              <NasaDataCard />
              {!live && (
                <section className="glass rise grid gap-4 p-4" style={{ ['--i' as string]: 1 }}>
                  <div className="label">Suit systems</div>
                  <MetricRow k="o2Tank" visual="bar" />
                  <MetricRow k="battery" visual="bar" />
                  <MetricRow k="coolantTemp" />
                  <MetricRow k="respRate" />
                </section>
              )}
            </>
          )}
          {tab === 'science' && <ScienceView layout="mobile" />}
          {tab === 'map' && (
            <>
              <SurfaceMap tall />
              <HeroGauge />
            </>
          )}
          {tab === 'alerts' && <AlertsView />}
          {tab === 'crew' && (
            <>
              <CrewRoster compact />
              <SuitVitalsCard height={280} compact />
            </>
          )}
          <p className="label num pb-2 pt-1 text-center">MET · {clock} UTC</p>
        </div>
      </div>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  )
}

