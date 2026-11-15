import { useEffect, useState, type ReactNode } from 'react'
import { useDomId } from '../hooks/useDomId'
import type { Source } from '../science/methods'

export const linkStyle = { color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 2, textDecorationColor: 'rgba(255,106,31,.6)' } as const

export function Sources({ sources }: { sources: readonly Source[] }) {
  return (
    <>
      {sources.map((s, i) => (
        <span key={s.href || s.label}>
          {i > 0 && '; '}
          {s.href ? (
            <a href={s.href} target="_blank" rel="noreferrer" style={linkStyle}>
              {s.label}
            </a>
          ) : (
            s.label
          )}
        </span>
      ))}
    </>
  )
}

/** A model card: title, live content, then the method and its sources in small print. */
export function Card({ title, children, method, sources, className = '' }: { title: string; children: ReactNode; method: ReactNode; sources: readonly Source[]; className?: string }) {
  const id = useDomId('sci-h')
  return (
    <section className={`glass rise grid min-w-0 content-start gap-3 p-5 ${className}`} aria-labelledby={id}>
      <h2 id={id} className="display text-[20px]">
        {title}
      </h2>
      {children}
      <p className="mt-1 border-t pt-3 text-[11.5px] leading-relaxed" style={{ borderColor: 'var(--hair)', color: 'var(--taupe)' }}>
        {method}
        {sources.length > 0 && (
          <>
            {' Source: '}
            <Sources sources={sources} />.
          </>
        )}
      </p>
    </section>
  )
}

export function Big({ value, unit, color, size = 46 }: { value: string; unit?: string; color?: string; size?: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="display num leading-none" style={{ color: color ?? 'var(--ink)', fontSize: size }}>
        {value}
      </span>
      {unit && <span className="unit">{unit}</span>}
    </div>
  )
}

export const Note = ({ children }: { children: ReactNode }) => (
  <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink)', opacity: 0.85 }}>
    {children}
  </p>
)

/** Re-render on an interval for time-driven models (ephemeris). */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export const th = 'label py-1.5 pr-3 text-left font-normal'
export const td = 'num py-1.5 pr-3 align-top'
