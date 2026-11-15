import { memo, useEffect, useRef } from 'react'
import { useTelemetryStore } from '../hooks/useTelemetry'
import { STATUS_COLOR } from '../config/thresholds'
import { isSimulation, modeStore } from '../data/createSource'

/** One PQRST beat, phase 0..1 -> amplitude (-1..1). Hand-shaped, not a sine. */
function beat(p: number): number {
  const g = (c: number, w: number, a: number) => a * Math.exp(-Math.pow((p - c) / w, 2))
  return g(0.16, 0.035, 0.14) + g(0.285, 0.011, -0.16) + g(0.31, 0.014, 1) + g(0.335, 0.012, -0.32) + g(0.55, 0.06, 0.24)
}

interface Props {
  height?: number
  className?: string
}

/**
 * Heart trace on canvas. What it draws depends on what is known:
 *  - heart rate from a telemetry backend: the reported rate over the last two minutes
 *  - training simulation: a drawn PQRST beat repeating at the simulated rate
 *  - nothing measured: a flat baseline
 */
export const EcgLine = memo(function EcgLine({ height = 64, className }: Props) {
  const store = useTelemetryStore()
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let w = 0
    let h = 0
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const PX_PER_S = 70
    const trace: number[] = [] // one value per pixel column, newest last
    let phase = 0
    let last = performance.now()
    let acc = 0
    let raf = 0

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const snap = store.getSnapshot()
      const hr = snap.latest?.heartRate
      // a missing / garbage reading must not poison the trace with NaN
      const bpm = typeof hr === 'number' && Number.isFinite(hr) && hr > 0 ? Math.min(250, Math.max(20, hr)) : 72
      const color = STATUS_COLOR[snap.statuses.heartRate]
      acc += dt * PX_PER_S * (reduce ? 0 : 1)
      while (acc >= 1) {
        acc -= 1
        phase = (phase + 1 / PX_PER_S / (60 / bpm)) % 1
        trace.push(beat(phase) + (Math.random() - 0.5) * 0.02)
        if (trace.length > w + 2) trace.shift()
      }
      const simulated = isSimulation(modeStore.get())
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x < w; x += 20) {
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, h)
      }
      ctx.stroke()

      const mid = h * 0.62
      const amp = h * 0.5
      ctx.lineWidth = 1.6
      ctx.lineJoin = 'round'
      ctx.shadowColor = color
      ctx.shadowBlur = 8
      ctx.strokeStyle = color
      ctx.beginPath()
      if (simulated) {
        const off = w - trace.length
        trace.forEach((v, i) => {
          const x = off + i
          const y = mid - v * amp
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
      } else {
        // measured heart rate over the stored history (gaps where there was no reading)
        const hist = snap.history.heartRate
        const times = snap.times
        const end = times[times.length - 1] ?? 0
        const span = 120_000
        const vals = hist.filter(Number.isFinite)
        if (vals.length >= 2) {
          const lo = Math.min(...vals) - 4
          const hi = Math.max(...vals) + 4
          let pen = false
          hist.forEach((v, i) => {
            if (!Number.isFinite(v)) {
              pen = false
              return
            }
            const x = w - ((end - times[i]) / span) * w
            const y = h * 0.88 - ((v - lo) / (hi - lo)) * h * 0.76
            if (pen) ctx.lineTo(x, y)
            else ctx.moveTo(x, y)
            pen = true
          })
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,.22)'
          ctx.shadowBlur = 0
          ctx.moveTo(0, mid)
          ctx.lineTo(w, mid)
        }
      }
      ctx.stroke()
      ctx.shadowBlur = 0
      // fade the tail
      const grad = ctx.createLinearGradient(0, 0, w * 0.3, 0)
      grad.addColorStop(0, 'rgba(26,20,17,1)')
      grad.addColorStop(1, 'rgba(26,20,17,0)')
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w * 0.3, h)
      ctx.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [store])

  return <canvas ref={ref} className={className} style={{ width: '100%', height }} aria-hidden="true" />
})
