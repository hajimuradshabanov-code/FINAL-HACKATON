import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { Sparkles, X, SendHorizontal, KeyRound, RotateCcw } from 'lucide-react'
import { assistantStore, buildContext, checkAssistant, clearConversation, sendMessage } from '../assistant/assistant'
import { offlineAnswer } from '../assistant/offline'
import { useDataMode, useTelemetryStore } from '../hooks/useTelemetry'
import { nasaLive } from '../data/nasaSource'
import { isSimulation, modeStore } from '../data/createSource'
import { auth } from '../auth/auth'

const SUGGESTIONS = ['How is the crew doing right now?', 'What should I do about the current alert?', 'Explain today’s radiation dose']

const linkBtn = { background: 'none', border: 0, padding: 0, color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', font: 'inherit' } as const

/**
 * Crew assistant. Answers come from Google Gemini when the server has a working key; otherwise from
 * the built-in rule-based helper, which is labelled as such (never presented as AI).
 */
export function AssistantPanel({ titleId, onClose }: { titleId: string; onClose: () => void }) {
  const st = useSyncExternalStore(assistantStore.subscribe, assistantStore.get)
  const telemetry = useTelemetryStore()
  const simulation = isSimulation(useDataMode())
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // re-check on every opening, so a key added on the server is picked up without a reload
  useEffect(() => {
    void checkAssistant()
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [st.messages.length, st.sending])

  useEffect(() => {
    if (st.status !== 'checking') inputRef.current?.focus()
  }, [st.status])

  const ask = (text: string) => {
    if (!text.trim() || st.sending) return
    const mode = modeStore.get()
    const env = mode === 'nasa' || mode === 'live' ? nasaLive.get() : null
    const s = auth.getSession()
    const context = buildContext(telemetry.getSnapshot(), env, s && !s.guest ? { name: s.name, role: s.role } : null, modeStore.get())
    setDraft('')
    // the suggestion button that was clicked disappears; keep focus in the conversation
    inputRef.current?.focus()
    void sendMessage(text, context, (q) => offlineAnswer(q, telemetry.getSnapshot(), env))
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    ask(draft)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      ask(draft)
    }
  }

  const geminiLive = st.status === 'ready' && !st.fallbackReason
  const builtIn = st.status === 'not-configured' || st.status === 'unreachable' || !!st.fallbackReason
  const reason = st.fallbackReason ?? (st.status === 'not-configured' ? 'Gemini is not connected (no API key on the server).' : st.status === 'unreachable' ? 'The Gemini service is not reachable from this page.' : '')

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="display flex items-center gap-2 text-[18px]">
          <Sparkles size={15} /> Crew assistant
        </h2>
        <div className="flex gap-1.5">
          {st.messages.length > 0 && (
            <button className="sq-btn" style={{ width: 30, height: 30 }} aria-label="Start a new conversation" onClick={clearConversation}>
              <RotateCcw size={13} />
            </button>
          )}
          <button className="sq-btn" style={{ width: 30, height: 30 }} aria-label="Close assistant" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      {builtIn && (
        <div className="grid gap-1.5 rounded-lg px-3 py-2.5 text-[12.5px]" style={{ border: '1px solid rgba(242,176,76,.45)', background: 'rgba(242,176,76,.08)', color: 'var(--ink)' }} role="status">
          <p>
            <b style={{ color: 'var(--warn)' }}>Built-in mode.</b> Answers come from the dashboard’s own rules and data, not from AI. {reason}
          </p>
          <details>
            <summary className="flex cursor-pointer items-center gap-1.5" style={{ color: 'var(--taupe)' }}>
              <KeyRound size={12} /> Connect Google Gemini
            </summary>
            <div className="mt-2 grid gap-2">
              <p>Put the key in the server environment (never in the website code), then restart or redeploy:</p>
              <pre className="num overflow-x-auto rounded-md p-2.5 text-[11.5px] leading-relaxed" style={{ background: 'rgba(0,0,0,.45)', border: '1px solid var(--hair)' }}>
                {'# .env (local) or Vercel → Settings → Environment Variables\nGEMINI_API_KEY=your-gemini-api-key\nGEMINI_MODEL=gemini-3.8-flash'}
              </pre>
              <p style={{ color: 'var(--taupe)' }}>
                Keys come from{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  Google AI Studio
                </a>{' '}
                or Google Cloud Console → Credentials (with the Generative Language API enabled).{' '}
                <button onClick={() => void checkAssistant()} style={linkBtn}>
                  Check again
                </button>
              </p>
            </div>
          </details>
        </div>
      )}

      <div ref={listRef} className="grid max-h-[46vh] gap-2.5 overflow-y-auto pr-1" aria-live="polite" aria-busy={st.sending}>
        {st.messages.length === 0 && (
          <div className="grid gap-2">
            <p className="text-[13px]" style={{ color: 'var(--taupe)' }}>
              Ask about the crew’s vitals, alerts or the space environment. Answers use what the dashboard shows right now.
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} disabled={st.status === 'checking'} className="rounded-lg px-3 py-2 text-left text-[13px]" style={{ border: '1px solid var(--hair)', background: 'rgba(0,0,0,.28)', color: 'var(--ink)', cursor: 'pointer' }}>
                {s}
              </button>
            ))}
          </div>
        )}
        {st.messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13.5px] leading-relaxed ${m.role === 'user' ? 'justify-self-end' : 'justify-self-start'}`}
            style={m.role === 'user' ? { background: 'rgba(193,68,14,.35)', border: '1px solid rgba(255,160,110,.35)', color: 'var(--ink)' } : { background: 'rgba(0,0,0,.35)', border: '1px solid var(--hair)', color: 'var(--ink)' }}
          >
            <span className="sr-only">{m.role === 'user' ? 'You: ' : m.source === 'offline' ? 'Built-in answer: ' : 'Assistant: '}</span>
            {m.text}
            {m.role === 'assistant' && (
              <span className="mt-1.5 block text-[10.5px]" style={{ color: 'var(--taupe)' }} aria-hidden="true">
                {m.source === 'offline' ? 'Built-in answer · not AI' : 'Gemini'}
              </span>
            )}
          </div>
        ))}
        {st.sending && (
          <div className="label justify-self-start px-1" role="status">
            Thinking…
          </div>
        )}
      </div>
      {st.error && (
        <p role="alert" className="text-[12.5px]" style={{ color: '#ff8a7f' }}>
          {st.error}
        </p>
      )}
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <label className="sr-only" htmlFor={`${titleId}-q`}>
          Your question
        </label>
        <textarea
          id={`${titleId}-q`}
          ref={inputRef}
          rows={2}
          maxLength={2000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask the assistant…"
          className="min-h-[44px] flex-1 resize-none rounded-lg px-3 py-2 text-[14px] outline-none"
          style={{ background: 'rgba(0,0,0,.4)', border: '1px solid var(--hair)', color: 'var(--ink)' }}
          disabled={st.status === 'checking'}
        />
        <button type="submit" className="sq-btn red" aria-label="Send question" disabled={!draft.trim() || st.sending || st.status === 'checking'} style={{ opacity: !draft.trim() || st.sending ? 0.5 : 1 }}>
          <SendHorizontal size={16} />
        </button>
      </form>
      <p className="text-[11.5px]" style={{ color: 'var(--taupe)' }}>
        {geminiLive ? `Powered by Google Gemini${st.model ? ` (${st.model})` : ''}. ` : ''}Answers can be wrong and are not medical advice. {simulation ? 'Dashboard data is simulated.' : 'Environment values are modelled from NASA/NOAA data.'}
      </p>
    </div>
  )
}
