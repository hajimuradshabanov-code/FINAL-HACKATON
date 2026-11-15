/**
 * Keeps personal data with the person it belongs to. Several people can use the app in one browser
 * (the crew roster), so whenever the signed-in user changes — sign-out, sign-in, guest — what is
 * held in memory about the previous user is released: the assistant conversation, and any answer
 * still on its way.
 *
 * Imported once for its side effect (src/App.tsx). Per-user storage keys for the daily check-in and
 * the personal baseline are handled where those are read (lib/checkin.ts, hooks/useTelemetry.tsx).
 */
import { auth, type Session } from './auth'
import { clearConversation } from '../assistant/assistant'

// one guest must not inherit another guest's data either, so a guest session is identified by its start time
const identity = (s: Session | null) => (s ? (s.guest ? `guest@${s.since}` : `user:${s.email}`) : '')

let who = identity(auth.getSession())

auth.subscribe(() => {
  const next = identity(auth.getSession())
  if (next === who) return
  who = next
  clearConversation()
})
