import { PHASES, type Phase } from '@car/shared'
import { A2uiHost, type A2uiClientAction } from './a2ui/index.js'
import { McpAppCard } from './mcp/index.js'
import { type ChatItem, useSession } from './session.js'
import { useEffect, useRef, useState } from 'react'

/**
 * The three-zone cockpit.
 *
 * Each zone exists because a requirement demanded it: the rail makes multistep
 * agent state visible, the centre carries the conversation and the in-chat MCP
 * Apps, and the stage gives the ranked catalogue the width it needs. The rail's
 * spec and the stage are both rendered from A2UI messages the API streams — the
 * phase stepper is app chrome and stays native.
 */

const PHASE_LABELS: Record<Phase, string> = {
  interview: 'Interview',
  research: 'Research',
  recommend: 'Recommend',
  book: 'Book',
  done: 'Done',
}

/** Theme tokens handed to MCP App iframes so widgets match the host. */
const HOST_CONTEXT = {
  theme: 'dark' as const,
  displayMode: 'inline' as const,
  locale: 'en-IE',
  styles: {
    '--accent': '#c8ff3d',
    '--accent-ink': '#16200a',
  },
}

function JourneyRail({
  phase,
  a2ui,
  onError,
}: {
  phase: Phase
  a2ui: A2uiHostProps['messages']
  onError: (e: unknown) => void
}) {
  const currentIndex = PHASES.indexOf(phase)

  return (
    <section className="panel panel--journey" aria-label="Journey">
      <header className="panel__head">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">C</span>
          <span className="brand__name">Car Matchmaker</span>
        </div>
      </header>

      <div className="panel__body">
        {PHASES.filter((p) => p !== 'done').map((p, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'todo'
          return (
            <div className={`phase phase--${state}`} key={p}>
              <span className="phase__dot" aria-hidden="true">{state === 'done' ? '✓' : ''}</span>
              <span className="phase__label">{PHASE_LABELS[p]}</span>
            </div>
          )
        })}

        <div className="rail-spec">
          <A2uiHost messages={a2ui} surfaceId="journey" onError={onError} />
        </div>
      </div>
    </section>
  )
}

type A2uiHostProps = Parameters<typeof A2uiHost>[0]

function Conversation({
  items,
  busy,
  onSend,
  onCallTool,
}: {
  items: ChatItem[]
  busy: boolean
  onSend: (text: string) => void
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
}) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items.length])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  return (
    <section className="panel panel--chat" aria-label="Conversation">
      <header className="panel__head">
        <span className="panel__title">Conversation</span>
        {busy && <span className="panel__title">thinking…</span>}
      </header>

      <div className="panel__body">
        <div className="chat">
          {items.map((item) => {
            switch (item.kind) {
              case 'agent':
                return <div className="msg msg--agent" key={item.id}>{item.text}</div>
              case 'user':
                return <div className="msg msg--user" key={item.id}>{item.text}</div>
              case 'error':
                return <div className="msg msg--error" key={item.id}>{item.text}</div>
              case 'step':
                return (
                  <div className="step" key={item.id} title={item.detail}>
                    <span className="step__icon" aria-hidden="true">▸</span>
                    <span>{item.label}</span>
                  </div>
                )
              case 'app':
                return (
                  <McpAppCard
                    key={item.id}
                    label={item.toolName}
                    html={item.html}
                    hostContext={HOST_CONTEXT}
                    onCallTool={(name, args) => onCallTool(name, args)}
                  />
                )
            }
          })}
          <div ref={endRef} />
        </div>
      </div>

      <form className="composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tell me what you need a car for…"
          aria-label="Message the agent"
          autoComplete="off"
        />
        <button type="submit" disabled={!draft.trim()}>Send</button>
      </form>
    </section>
  )
}

function Stage({
  a2ui,
  hasResults,
  onAction,
  onError,
}: {
  a2ui: A2uiHostProps['messages']
  hasResults: boolean
  onAction: (action: A2uiClientAction) => void
  onError: (e: unknown) => void
}) {
  return (
    <section className="panel panel--stage" aria-label="Results">
      <header className="panel__head">
        <span className="panel__title">Stage</span>
      </header>

      <div className="panel__body">
        {hasResults ? (
          <A2uiHost messages={a2ui} surfaceId="stage" onAction={onAction} onError={onError} />
        ) : (
          <div className="empty">
            <div className="empty__title">Your matches will appear here</div>
            <p className="empty__hint">
              Tell the agent what you need and it will search the marketplace, then
              rank what it finds and explain each choice.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

export function App() {
  const { state, items, a2ui, busy, send, callTool } = useSession()
  const [renderErrors, setRenderErrors] = useState<string[]>([])

  const onError = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    // Surface rather than swallow: a silently dropped A2UI message shows up as a
    // missing card, which is far harder to diagnose than a visible complaint.
    console.error('[a2ui]', e)
    setRenderErrors((prev) => (prev.includes(message) ? prev : [...prev, message]))
  }

  const onAction = (action: A2uiClientAction) => {
    if (action.name === 'selectCar') {
      const title = String(action.context?.title ?? '')
      send(`book ${title.replace(/^\d+\.\s*/, '')}`)
    }
  }

  const hasResults = (state?.shortlist.length ?? 0) > 0 || busy

  return (
    <main className="cockpit">
      <JourneyRail phase={state?.phase ?? 'interview'} a2ui={a2ui} onError={onError} />
      <Conversation items={items} busy={busy} onSend={send} onCallTool={callTool} />
      <Stage a2ui={a2ui} hasResults={hasResults} onAction={onAction} onError={onError} />
      {renderErrors.length > 0 && (
        <div className="render-errors" role="alert">
          {renderErrors.length} UI message(s) failed to render — see console.
        </div>
      )}
    </main>
  )
}
