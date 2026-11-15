import { LayoutDashboard, HeartPulse, Map as MapIcon, Bell, Users, Atom } from 'lucide-react'
import { useDataMode, useTelemetrySelect } from '../hooks/useTelemetry'

export type Tab = 'dashboard' | 'vitals' | 'science' | 'map' | 'alerts' | 'crew'

const TABS: { id: Tab; label: string; icon: typeof Bell }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'vitals', label: 'Vitals', icon: HeartPulse },
  { id: 'science', label: 'Science', icon: Atom },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'crew', label: 'Crew', icon: Users },
]

/** The map shows the simulated surface traverse, so it is not offered in live mode. */
export const tabAvailable = (id: Tab, live: boolean) => !(live && id === 'map')

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const count = useTelemetrySelect((s) => s.activeAlerts)
  const live = useDataMode() === 'live'
  return (
    <nav
      aria-label="Primary"
      className="absolute inset-x-0 bottom-0 z-20 flex justify-around px-2 pt-2"
      style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))', background: 'linear-gradient(0deg, rgba(16,11,9,.96) 55%, rgba(16,11,9,0))', backdropFilter: 'blur(10px)' }}
    >
      {TABS.filter((t) => tabAvailable(t.id, live)).map(({ id, label, icon: Icon }) => {
        const on = tab === id
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-current={on ? 'page' : undefined}
            className="relative flex min-w-[52px] flex-col items-center gap-1 py-1.5"
            style={{ color: on ? 'var(--ink)' : 'var(--taupe)', background: 'none', border: 0, cursor: 'pointer' }}
          >
            <span className="relative">
              <Icon size={19} strokeWidth={on ? 1.8 : 1.4} />
              {id === 'alerts' && count > 0 && (
                <span
                  aria-label={`${count} active alerts`}
                  className="num absolute -right-2.5 -top-2 grid h-[15px] min-w-[15px] place-items-center rounded-full px-1 text-[9px] font-medium"
                  style={{ background: 'var(--alert)', color: '#fff' }}
                >
                  {count}
                </span>
              )}
            </span>
            <span className="label" style={{ fontSize: 8.5, letterSpacing: '.12em', color: 'inherit' }}>
              {label}
            </span>
            <span className="absolute -top-px h-px w-6 transition-opacity" style={{ background: 'var(--lava)', opacity: on ? 1 : 0, boxShadow: '0 0 8px var(--lava)' }} />
          </button>
        )
      })}
    </nav>
  )
}
