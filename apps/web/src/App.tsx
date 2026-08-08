import { PHASES, type Phase, type Preferences } from '@car/shared'
import { useState } from 'react'

/**
 * The three-zone cockpit.
 *
 * Each zone exists because a requirement demanded it: the rail makes multistep
 * agent state visible, the centre carries the conversation and the in-chat MCP
 * Apps, and the stage gives the catalogue the width it needs. Content is still
 * local state — the SSE wiring to the API replaces it next.
 */

const PHASE_LABELS: Record<Phase, string> = {
  interview: 'Interview',
  research: 'Research',
  recommend: 'Recommend',
  book: 'Book',
  done: 'Done',
}

const SPEC_ROWS: { key: keyof Preferences; label: string; format?: (v: unknown) => string }[] = [
  { key: 'mode', label: 'Mode', format: (v) => (v === 'rent' ? 'Rent' : 'Buy') },
  { key: 'useCase', label: 'Use case' },
  { key: 'category', label: 'Category' },
  { key: 'budgetMax', label: 'Budget', format: (v) => `€${Number(v).toLocaleString('en-IE')}` },
  { key: 'targetDate', label: 'From' },
]

function JourneyRail({ phase, preferences }: { phase: Phase; preferences: Preferences }) {
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
            <div key={p}>
              <div className={`phase phase--${state}`}>
                <span className="phase__dot" aria-hidden="true">{state === 'done' ? '✓' : ''}</span>
                <span className="phase__label">{PHASE_LABELS[p]}</span>
              </div>

              {p === 'interview' && (
                <div className="spec">
                  {SPEC_ROWS.map(({ key, label, format }) => {
                    const value = preferences[key]
                    const filled = value !== undefined && value !== null
                    return (
                      <div key={key} className={`spec__row${filled ? ' spec__row--filled' : ''}`}>
                        <span className="spec__key">{label}</span>
                        <span className={`spec__val${filled ? '' : ' spec__val--empty'}`}>
                          {filled ? (format ? format(value) : String(value)) : 'not set'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

interface ChatMessage {
  id: string
  role: 'agent' | 'user'
  text: string
}

function Conversation({
  messages,
  onSend,
}: {
  messages: ChatMessage[]
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')

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
      </header>

      <div className="panel__body">
        <div className="chat">
          {messages.map((m) => (
            <div key={m.id} className={`msg msg--${m.role}`}>
              {m.text}
            </div>
          ))}
        </div>
      </div>

      {/* A real form so Enter submits natively and screen readers announce it. */}
      <form className="composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tell me what you need a car for…"
          aria-label="Message the agent"
          autoComplete="off"
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}

function Stage() {
  return (
    <section className="panel panel--stage" aria-label="Results">
      <header className="panel__head">
        <span className="panel__title">Stage</span>
      </header>

      <div className="panel__body">
        <div className="empty">
          <div className="empty__title">Your matches will appear here</div>
          <p className="empty__hint">
            Tell the agent what you need and it will search the marketplace, then
            rank what it finds and explain each choice.
          </p>
        </div>
      </div>
    </section>
  )
}

export function App() {
  const [phase] = useState<Phase>('interview')
  const [preferences] = useState<Preferences>({})
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      text: "Hi — I'll help you find the right car to rent or buy. What do you need it for?",
    },
  ])

  const handleSend = (text: string) => {
    setMessages((prev) => [...prev, { id: `u${prev.length}`, role: 'user', text }])
  }

  return (
    <main className="cockpit">
      <JourneyRail phase={phase} preferences={preferences} />
      <Conversation messages={messages} onSend={handleSend} />
      <Stage />
    </main>
  )
}
