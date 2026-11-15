import { useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'
import { auth } from '../auth/auth'
import { useCrew, useSession } from '../auth/useAuth'
import { useDomId } from '../hooks/useDomId'

function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

/**
 * The crew: everyone who has signed in on this device. It starts empty; signing in adds you.
 * The signed-in member is online; everyone else shows when they were last seen.
 */
export function CrewRoster({ compact = false }: { compact?: boolean }) {
  const crew = useCrew()
  const session = useSession()
  const headingId = useDomId('crew-h')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const join = () => {
    location.hash = '#/signup'
    auth.signOut()
  }
  // you first, then the most recently seen
  const members = [...crew].sort((a, b) => Number(b.email === session?.email) - Number(a.email === session?.email) || b.lastSeen - a.lastSeen)

  return (
    <section className={`glass rise grid gap-3 ${compact ? 'p-3' : 'p-4'}`} aria-labelledby={headingId} style={{ ['--i' as string]: 2 }}>
      <header className="flex items-baseline justify-between">
        <h2 id={headingId} className="display text-[20px]">
          Crew
        </h2>
        <span className="label num">
          {crew.length} {crew.length === 1 ? 'member' : 'members'}
        </span>
      </header>

      {members.length === 0 && (
        <p className="text-[13.5px]" style={{ color: 'var(--taupe)' }}>
          No crew yet. Members appear here when they sign in on this device.
        </p>
      )}

      {members.length > 0 && (
        <ul className="grid gap-2">
          {members.map((m) => {
            const me = m.email === session?.email
            return (
              <li key={m.email} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ border: `1px solid ${me ? 'rgba(255,106,31,.45)' : 'var(--hair)'}`, background: me ? 'rgba(193,68,14,.14)' : 'rgba(0,0,0,.22)' }}>
                <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px]" style={{ background: me ? 'var(--rust)' : 'rgba(255,255,255,.08)', color: 'var(--ink)', border: '1px solid var(--hair)' }}>
                  {initials(m.name) || '?'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 truncate text-[15px]" style={{ color: 'var(--ink)' }}>
                    <span className="truncate">{m.name}</span>
                    {me && (
                      <span className="label rounded px-1.5 py-px" style={{ fontSize: 8.5, border: '1px solid rgba(255,106,31,.6)', color: 'var(--lava)' }}>
                        You
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12.5px]" style={{ color: 'var(--taupe)' }}>
                    {m.role}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[12px]" style={{ color: me ? 'var(--ok)' : 'var(--taupe)' }}>
                  <span className={`inline-block h-[6px] w-[6px] rounded-full ${me ? 'pulse-dot' : ''}`} style={{ background: me ? 'var(--ok)' : 'var(--taupe)' }} data-status="normal" />
                  {me ? 'Online' : `Seen ${ago(now - m.lastSeen)}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {session?.guest && (
        <button onClick={join} className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-[14px]" style={{ background: 'var(--rust)', border: '1px solid rgba(255,160,110,.5)', color: '#fff', cursor: 'pointer' }}>
          <UserPlus size={15} /> Create an account to join the crew
        </button>
      )}
    </section>
  )
}
