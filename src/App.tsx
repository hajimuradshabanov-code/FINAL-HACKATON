import { TelemetryProvider } from './hooks/useTelemetry'
import { useFitScale, useIsDesktop } from './hooks/useMedia'
import { MobileApp } from './components/MobileApp'
import { DesktopApp } from './components/DesktopApp'
import { PhoneFrame } from './components/PhoneFrame'
import { TimelineChart } from './components/TimelineChart'
import { SuitVitalsCard } from './components/SuitVitalsCard'
import { AuthPage } from './components/AuthPage'
import { useAuthRoute, useClearAuthHash, useSession } from './auth/useAuth'
import './auth/userScope'

function Desktop() {
  const scale = useFitScale(864, 56)
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: 'url(/bg-wide.webp)', backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(6px) brightness(.45)', transform: 'scale(1.06)' }} />
      <div aria-hidden="true" className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(20,14,11,.2), rgba(14,10,8,.9))' }} />
      <svg aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 w-[1500px] -translate-x-1/2 -translate-y-1/2" viewBox="0 0 1500 360">
        <text x="750" y="270" textAnchor="middle" fill="none" stroke="rgba(242,233,225,.09)" strokeWidth="1.5" fontSize="330" fontWeight="200" fontFamily="Archivo Variable" style={{ fontStretch: '125%' }}>
          AREA 51
        </text>
      </svg>
      <div className="relative z-10 mx-auto grid max-w-[1560px] grid-cols-[minmax(340px,1fr)_auto_minmax(340px,1fr)] items-center gap-8 px-10 py-8" style={{ minHeight: '100vh' }}>
        <div className="grid gap-6 self-center">
          <div>
            <p className="label">NASA Space Apps 2026 · Create health monitoring software</p>
            <h1 className="display mt-2 text-[56px] leading-[1.02]">Health Monitor</h1>
          </div>
          <TimelineChart />
        </div>
        <PhoneFrame scale={scale}>
          <MobileApp framed />
        </PhoneFrame>
        <div className="self-center">
          <SuitVitalsCard height={290} />
        </div>
      </div>
    </div>
  )
}

function Shell() {
  const desktop = useIsDesktop()
  const showcase = typeof location !== 'undefined' && location.search.includes('showcase')
  return desktop ? (
    showcase ? <Desktop /> : <DesktopApp />
  ) : (
    <div className="h-[100dvh] w-full">
      <MobileApp />
    </div>
  )
}

export default function App() {
  const session = useSession()
  const route = useAuthRoute()
  useClearAuthHash(session !== null)
  // telemetry (and the NASA fetches) only start once someone is signed in
  if (!session) return <AuthPage mode={route ?? 'login'} />
  return (
    <TelemetryProvider>
      <Shell />
    </TelemetryProvider>
  )
}

