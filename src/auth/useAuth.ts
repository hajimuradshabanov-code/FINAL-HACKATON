import { useEffect, useSyncExternalStore } from 'react'
import { auth, type CrewMember, type Session } from './auth'

export function useSession(): Session | null {
  return useSyncExternalStore(auth.subscribe, auth.getSession)
}

export function useCrew(): readonly CrewMember[] {
  return useSyncExternalStore(auth.subscribe, auth.getCrew)
}

const readHash = () => (typeof location === 'undefined' ? '' : location.hash)

function subscribeHash(fn: () => void) {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}

export type AuthRoute = 'login' | 'signup'

/** Current auth page from the URL hash (#/login, #/signup). */
export function useAuthRoute(): AuthRoute | null {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => '')
  return hash === '#/signup' ? 'signup' : hash === '#/login' ? 'login' : null
}

/** Once signed in, drop a leftover #/login or #/signup from the URL. */
export function useClearAuthHash(active: boolean) {
  useEffect(() => {
    if (active && /^#\/(login|signup)$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search)
  }, [active])
}
