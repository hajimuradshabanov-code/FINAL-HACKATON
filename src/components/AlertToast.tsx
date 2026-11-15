import { useEffect } from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { METRICS } from '../config/thresholds'
import { formatNumber } from '../lib/format'
import { useTelemetrySelect, useTelemetryStore } from '../hooks/useTelemetry'

export function AlertToast() {
  const store = useTelemetryStore()
  const toast = useTelemetrySelect((s) => s.toast)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => store.dismissToast(), 6000)
    return () => clearTimeout(id)
  }, [toast, store])

  if (!toast) return null
  const c = METRICS[toast.key]
  return (
    <div
      role="alert"
      key={toast.id}
      className="glass absolute inset-x-3 top-3 z-30 flex items-center gap-3 p-3"
      style={{ borderColor: 'var(--alert)', background: 'rgba(60,14,10,.82)', animation: 'toast-in .35s cubic-bezier(.2,.7,.2,1) both' }}
    >
      <TriangleAlert size={20} color="var(--alert)" />
      <div className="min-w-0 flex-1">
        <div className="label" style={{ color: 'var(--alert)' }}>
          Critical · {c.label}
        </div>
        <div className="num text-[15px]">
          {formatNumber(toast.value, c.decimals)} {c.unit} — outside safe range
        </div>
      </div>
      <button className="sq-btn" style={{ width: 30, height: 30 }} aria-label="Dismiss alert" onClick={() => store.dismissToast()}>
        <X size={14} />
      </button>
    </div>
  )
}
