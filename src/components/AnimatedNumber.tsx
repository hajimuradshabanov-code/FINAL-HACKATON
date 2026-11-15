import { memo, useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../hooks/useMedia'
import { formatNumber, tween } from '../lib/format'

interface Props {
  value: number
  decimals?: number
  className?: string
  duration?: number
}

/**
 * Tweens between values. The displayed number is React state local to this memoised component, so
 * each animation frame re-renders only this <span> — React stays the sole owner of the DOM text.
 * A new value mid-tween continues from the number currently on screen.
 */
export const AnimatedNumber = memo(function AnimatedNumber({ value, decimals = 0, className, duration = 300 }: Props) {
  const reduce = usePrefersReducedMotion()
  const [shown, setShown] = useState(value)
  const shownRef = useRef(value)

  useEffect(() => {
    const from = shownRef.current
    const animate = !reduce && Number.isFinite(from) && Number.isFinite(value) && from !== value && duration > 0
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = animate ? (now - t0) / duration : 1
      const v = p >= 1 ? value : tween(from, value, p)
      shownRef.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduce])

  // with reduced motion (or a non-finite value) show the target directly
  const display = reduce || !Number.isFinite(value) ? value : shown
  return <span className={`num ${className ?? ''}`}>{formatNumber(display, decimals)}</span>
})
