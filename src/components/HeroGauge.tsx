import { Wind, Truck, Radio } from 'lucide-react'
import { METRICS } from '../config/thresholds'
import { useTelemetrySelect } from '../hooks/useTelemetry'
import { AnimatedNumber } from './AnimatedNumber'
import { OriginTag } from './OriginTag'

const R = 138
const CX = 170
const CY = 170
const START = 130

const polar = (deg: number, r = R) => {
  const a = (deg * Math.PI) / 180
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const
}
const arc = (from: number, to: number, r = R) => {
  const [x1, y1] = polar(from, r)
  const [x2, y2] = polar(to, r)
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

function Stat({ k, icon, className }: { k: 'signal' | 'wind' | 'roverRange'; icon: React.ReactNode; className: string }) {
  const v = useTelemetrySelect((s) => s.latest?.[k] ?? NaN)
  const st = useTelemetrySelect((s) => s.statuses[k])
  const c = METRICS[k]
  return (
    <div data-status={st} className={`absolute ${className}`}>
      <div className="label flex items-center gap-1.5">
        {icon}
        {c.label}
        <OriginTag k={k} />
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <AnimatedNumber value={v} decimals={c.decimals} className="display text-[26px] leading-none" />
        <span className="unit">{c.unit}</span>
      </div>
    </div>
  )
}

export function HeroGauge() {
  const progress = useTelemetrySelect((s) => (Number.isFinite(s.latest?.progress) ? Math.min(1, Math.max(0, s.latest!.progress)) : 0))
  const eva = useTelemetrySelect((s) => s.latest?.evaActive ?? false)
  const ticks = Array.from({ length: 29 }, (_, i) => START + (i * 280) / 28)
  const fillEnd = START + 280 * Math.max(0.02, progress)

  return (
    <section className="rise relative mx-auto" style={{ width: 340, maxWidth: '100%', height: 366, ['--i' as string]: 1 }} aria-label="Mission traverse gauge">
      <div
        className="absolute overflow-hidden rounded-full"
        style={{
          left: CX - 104,
          top: CY - 104,
          width: 208,
          height: 208,
          backgroundImage: 'url(/bg.webp)',
          backgroundSize: '348% auto',
          backgroundPosition: '49.1% 50.9%',
          boxShadow: 'inset 0 0 40px rgba(0,0,0,.55)',
        }}
      >
        <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 40%, transparent 45%, rgba(20,12,8,.65) 100%)' }} />
      </div>
      <svg viewBox="0 0 340 366" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <path d={arc(START, START + 280)} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1" />
        {ticks.map((d, i) => {
          const [x1, y1] = polar(d, R + 5)
          const [x2, y2] = polar(d, R + (i % 4 === 0 ? 12 : 8))
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,.28)" strokeWidth="1" />
        })}
        <path d={arc(START, fillEnd)} fill="none" stroke="#ff6a1f" strokeWidth="2" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 6px #ff6a1f)', transition: 'all 1s linear' }} />
        <circle cx={polar(fillEnd)[0]} cy={polar(fillEnd)[1]} r="4" fill="#ff6a1f" style={{ transition: 'all 1s linear' }} />
        <circle cx={CX} cy={CY} r="106" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="1" />
        <text x={CX} y={CY + 134} textAnchor="middle" className="label" fill="#a8978a" fontSize="10" letterSpacing="2.4" fontFamily="IBM Plex Mono">
          {eva ? 'EVA ACTIVE' : 'RESTING'} · {(progress * 100).toFixed(0)}% OF TRAVERSE
        </text>
      </svg>
      <Stat k="signal" icon={<Radio size={11} />} className="right-0 top-[92px] text-right" />
      <Stat k="wind" icon={<Wind size={11} />} className="bottom-0 left-0" />
      <Stat k="roverRange" icon={<Truck size={11} />} className="bottom-0 right-0 text-right" />
    </section>
  )
}
