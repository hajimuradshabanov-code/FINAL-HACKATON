import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Menu, Sparkles, Zap, MonitorSmartphone, Database, LogOut, UserRound, Activity, FlaskConical } from 'lucide-react'
import { auth } from '../auth/auth'
import { useSession } from '../auth/useAuth'
import { useDataMode, useTelemetryStore } from '../hooks/useTelemetry'
import { useDomId } from '../hooks/useDomId'
import { counterpartMode, isSimulation, modeStore } from '../data/createSource'
import { AssistantPanel } from './AssistantPanel'

type Panel = 'assistant' | 'menu' | null

const MODE_TEXT = {
  live: 'Live: Mars weather and radiation from NASA/NOAA feeds. Nothing is simulated; no body or suit sensors.',
  nasa: 'Training simulation: simulated crew vitals in the real NASA/NOAA environment',
  sim: 'Fully simulated telemetry',
  ws: 'Telemetry from WebSocket backend',
} as const

const panelStyle = { background: 'rgba(20,15,12,.95)', border: '1px solid var(--hair)', boxShadow: '0 18px 50px rgba(0,0,0,.55)' }

/**
 * The two header buttons. The menu offers real actions; the assistant button opens the Gemini-backed
 * crew assistant (or its setup instructions while no API key is configured on the server). Both close on Escape or an outside
 * click and hand focus back to their trigger.
 */
export function HeaderActions({ showLayoutSwitch = false }: { showLayoutSwitch?: boolean }) {
  const store = useTelemetryStore()
  const session = useSession()
  const mode = useDataMode()
  const simulation = isSimulation(mode)
  const [open, setOpen] = useState<Panel>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const assistantBtn = useRef<HTMLButtonElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const assistantId = useDomId('assistant')
  const assistantTitle = useDomId('assistant-t')
  const menuId = useDomId('menu')

  const close = (restoreFocus = true) => {
    const was = open
    setOpen(null)
    if (restoreFocus) (was === 'menu' ? menuBtn : assistantBtn).current?.focus()
  }

  useEffect(() => {
    if (!open) return
    // move focus into the menu (the assistant panel focuses its own input when ready)
    if (open === 'menu') panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    else panel.current?.querySelector<HTMLElement>('textarea:not([disabled]), button')?.focus()
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(null)
        ;(open === 'menu' ? menuBtn : assistantBtn).current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }

  const showcase = typeof location !== 'undefined' && new URLSearchParams(location.search).has('showcase')
  const itemCls = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px]'
  const itemStyle = { background: 'none', border: 0, cursor: 'pointer', color: 'var(--ink)' }

  return (
    <div ref={wrap} className="relative flex gap-2">
      <button
        ref={assistantBtn}
        className="sq-btn red"
        aria-label="Open AI assistant"
        aria-haspopup="dialog"
        aria-expanded={open === 'assistant'}
        aria-controls={open === 'assistant' ? assistantId : undefined}
        onClick={() => setOpen((o) => (o === 'assistant' ? null : 'assistant'))}
      >
        <Sparkles size={17} />
      </button>
      <button
        ref={menuBtn}
        className="sq-btn"
        aria-label="Open menu"
        aria-haspopup="menu"
        aria-expanded={open === 'menu'}
        aria-controls={open === 'menu' ? menuId : undefined}
        onClick={() => setOpen((o) => (o === 'menu' ? null : 'menu'))}
      >
        <Menu size={17} />
      </button>

      {open === 'assistant' && (
        <div ref={panel} id={assistantId} role="dialog" aria-labelledby={assistantTitle} className="absolute right-0 top-full z-50 mt-2 w-[min(380px,calc(100vw-32px))] rounded-2xl p-4" style={panelStyle}>
          <AssistantPanel titleId={assistantTitle} onClose={() => close()} />
        </div>
      )}

      {open === 'menu' && (
        <div ref={panel} id={menuId} role="menu" aria-label="Main menu" onKeyDown={onMenuKey} className="absolute right-0 top-full z-50 mt-2 w-[290px] rounded-2xl p-2" style={panelStyle}>
          {session && (
            <div className="mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ borderBottom: '1px solid var(--hair)' }}>
              <UserRound size={15} className="shrink-0" style={{ color: 'var(--taupe)' }} />
              <div className="min-w-0">
                <div className="truncate text-[14px]" style={{ color: 'var(--ink)' }}>{session.name}</div>
                <div className="truncate text-[12px]" style={{ color: 'var(--taupe)' }}>{session.guest ? 'Browsing without an account' : `${session.role} · ${session.email}`}</div>
              </div>
            </div>
          )}
          {mode !== 'ws' && (
            <button
              role="menuitem"
              className={itemCls}
              style={itemStyle}
              onClick={() => {
                modeStore.set(counterpartMode(mode))
                close()
              }}
            >
              {simulation ? <Activity size={15} /> : <FlaskConical size={15} />} {simulation ? 'Switch to live NASA data' : 'Open training simulation'}
            </button>
          )}
          {simulation && (
            <button
              role="menuitem"
              className={itemCls}
              style={itemStyle}
              onClick={() => {
                store.triggerAnomaly()
                close()
              }}
            >
              <Zap size={15} /> Inject test anomaly <span className="label ml-auto">A</span>
            </button>
          )}
          {showLayoutSwitch && (
            <a role="menuitem" className={itemCls} style={{ ...itemStyle, textDecoration: 'none' }} href={showcase ? location.pathname : '?showcase'}>
              <MonitorSmartphone size={15} /> {showcase ? 'Standard desktop layout' : 'Showcase layout (phone frame)'}
            </a>
          )}
          <button
            role="menuitem"
            className={itemCls}
            style={itemStyle}
            onClick={() => {
              setOpen(null)
              location.hash = '#/login'
              auth.signOut()
            }}
          >
            <LogOut size={15} /> {session?.guest ? 'Sign in or create account' : 'Sign out'}
          </button>
          <div className="mt-1 flex items-start gap-2.5 rounded-lg px-3 py-2.5" style={{ borderTop: '1px solid var(--hair)' }}>
            <Database size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--taupe)' }} />
            <div>
              <div className="label">Data source</div>
              <div className="text-[12px]" style={{ color: 'var(--ink)' }}>{MODE_TEXT[mode]}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
