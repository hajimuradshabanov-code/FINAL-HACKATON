import { useEffect, useState, useSyncExternalStore } from 'react'
import { GALE, formatHours, marsClock } from '../data/mars'
import { nasaLive } from '../data/nasaSource'

/** Re-render every `ms` and return the current time. */
export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

const useNasa = () => useSyncExternalStore(nasaLive.subscribe, nasaLive.get)

/** Real local time at the reference site, updated every 10 s (a Mars minute is 61.6 s). */
export function useMarsClock() {
  return marsClock(useTick(10_000))
}

/** Where the outside-temperature figure comes from, in live mode. */
export function RemsSourceLine() {
  const rems = useNasa().rems?.data[0]
  const clock = useMarsClock()
  if (!rems) return <>Loading the latest Curiosity weather report…</>
  return (
    <>
      {GALE.name}, {formatHours(clock.lmstHours)} local solar time. Curiosity REMS measured {rems.airMin}…{rems.airMax} °C on sol {rems.sol} ({rems.date}); this is that range placed on the time of day.
    </>
  )
}

/** Sol and local time for the header clock. */
export function MarsClockLabel() {
  const clock = useMarsClock()
  return (
    <>
      SOL {clock.sol} · GALE {formatHours(clock.lmstHours)} LMST
    </>
  )
}

/** What live mode shows, for the page subtitle. */
export const LIVE_SUMMARY = 'Mars weather and radiation from NASA / NOAA, now · nothing is simulated'
