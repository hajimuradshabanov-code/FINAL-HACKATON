import { Wordmark } from './Wordmark'
import { HeaderActions } from './HeaderActions'

export function Header({ framed = false }: { framed?: boolean }) {
  return (
    <header className="relative z-30 flex items-center justify-between px-4 pb-1" style={{ paddingTop: framed ? 50 : 'max(18px, env(safe-area-inset-top))' }}>
      <Wordmark height={40} />
      <HeaderActions showLayoutSwitch={framed} />
    </header>
  )
}
