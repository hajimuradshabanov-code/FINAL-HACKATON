import type { ReactNode } from 'react'

export const PHONE_W = 390
export const PHONE_H = 844

export function PhoneFrame({ children, scale }: { children: ReactNode; scale: number }) {
  const w = PHONE_W + 20
  const h = PHONE_H + 20
  return (
    <div style={{ width: w * scale, height: h * scale }}>
      <div
        style={{
          width: w,
          height: h,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          padding: 10,
          borderRadius: 56,
          background: 'linear-gradient(145deg, #3b3531, #0e0b09 40%, #2a2420)',
          boxShadow: '0 0 0 1px rgba(255,255,255,.18), 0 40px 90px rgba(0,0,0,.7), 0 0 120px rgba(193,68,14,.18), inset 0 0 0 2px #0a0807',
          position: 'relative',
        }}
      >
        <div style={{ width: PHONE_W, height: PHONE_H, borderRadius: 46, overflow: 'hidden', position: 'relative', background: '#14100e', isolation: 'isolate' }}>
          {children}
          <div aria-hidden="true" style={{ position: 'absolute', top: 10, left: '50%', width: 92, height: 26, marginLeft: -46, borderRadius: 14, background: '#050403', zIndex: 40 }} />
        </div>
      </div>
    </div>
  )
}
