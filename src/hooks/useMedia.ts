import { useEffect, useState } from 'react'

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

export const useIsDesktop = () => useMedia('(min-width: 1024px) and (pointer: fine), (min-width: 1280px)')
export const usePrefersReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')

/** Scale factor so the phone (design height) fits the window height */
export function useFitScale(designH: number, margin: number) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const on = () => setScale(Math.min(1, (window.innerHeight - margin) / designH))
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [designH, margin])
  return scale
}
