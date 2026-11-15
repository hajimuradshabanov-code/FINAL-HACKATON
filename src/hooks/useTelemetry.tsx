import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { TelemetryStore, type Snapshot } from '../data/store'
import { createSource, isSimulation, modeStore, type DataMode } from '../data/createSource'
import { auth } from '../auth/auth'

const Ctx = createContext<TelemetryStore | null>(null)

/**
 * Owns the single telemetry stream. The store is created without side effects (safe if React
 * calls the initializer twice); the source is attached in an effect and detached in its cleanup,
 * so StrictMode's mount → unmount → mount leaves exactly one running source.
 */
export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new TelemetryStore())
  const mode = useDataMode()

  useEffect(() => {
    const session = auth.getSession()
    // measured and simulated streams must not teach the same personal baseline
    // a guest has no identity to save a norm under: all guests would share (and inherit) one baseline
    const who = session && !session.guest && session.email ? session.email : null
    store.setSubject(who && !isSimulation(mode) ? `${mode}:${who}` : who)
    store.attach(createSource(mode))
    return () => store.detach()
  }, [store, mode])

  useEffect(() => {
    // the anomaly injector exists only in the training simulation
    if (!isSimulation(mode)) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable)) return
      if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey) store.triggerAnomaly()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, mode])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

/** The data mode in use; re-renders when it is switched from the menu. */
export function useDataMode(): DataMode {
  return useSyncExternalStore(modeStore.subscribe, modeStore.get)
}

export function useTelemetryStore(): TelemetryStore {
  const s = useContext(Ctx)
  if (!s) throw new Error('useTelemetry must be used inside <TelemetryProvider>')
  return s
}

/** Whole snapshot — re-renders every second. Prefer useTelemetrySelect for leaf components. */
export function useTelemetry(): Snapshot {
  const store = useTelemetryStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/** Subscribe to a slice. The selector must return a stable value (primitive or array from the snapshot). */
export function useTelemetrySelect<T>(selector: (s: Snapshot) => T): T {
  const store = useTelemetryStore()
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}
