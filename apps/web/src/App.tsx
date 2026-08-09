import { PHASES, type Phase, type Preferences, money } from '@car/shared'
import { A2uiHost, type A2uiClientAction } from './a2ui/index.js'
import { Intro, shouldPlayIntro } from './intro/index.js'
import { McpAppCard } from './mcp/index.js'
import { useStickyScroll } from './useStickyScroll.js'
import { type ChatItem, useSession } from './session.js'
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * The cockpit: a journey bar over two working columns.
 *
 * Each region exists because a requirement demanded it. The bar makes multistep
 * agent state visible, the conversation carries the dialogue and the in-chat MCP
 * Apps, and the stage gives the ranked catalogue the width it needs.
 *
 * The journey used to be a 272px left column. It held four dots and five lines
 * of text, and the space it cost came out of the conversation — which is where
 * the booking and payment widgets live, and where the width actually matters.
 * Laid out horizontally the same information fits in one row, and the column it
 * gives back is what lets a transactional form breathe.
 *
 * The bar's spec chips and the stage are both rendered from A2UI messages the
 * API streams; the phase stepper is app chrome and stays native.
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
    '--accent-ink': '#14200a',
    // The iframe has nothing behind it, so it needs an explicit surface or it
    // falls back to white and the dark widget becomes unreadable.
    '--bg': '#15181d',
  },
}

/* -------------------------------------------------------------- top bar */

function Stepper({ phase }: { phase: Phase }) {
  const steps = PHASES.filter((p) => p !== 'done')
  const currentIndex = PHASES.indexOf(phase)

  return (
    <>
      <div className="stepper" aria-label="Journey progress">
        {steps.map((p, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'todo'
          return (
            <div className="stepper__step-wrap" key={p} style={{ display: 'contents' }}>
              {i > 0 && <span className="stepper__rule" aria-hidden="true" />}
              <div
                className={`stepper__step stepper__step--${state}`}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                <span className="stepper__dot" aria-hidden="true">{state === 'done' ? '✓' : ''}</span>
                <span className="stepper__label">{PHASE_LABELS[p]}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="stepper__compact">
        Step {Math.min(currentIndex + 1, steps.length)} of {steps.length} ·{' '}
        <b>{PHASE_LABELS[phase]}</b>
      </div>
    </>
  )
}

/** The three facts worth carrying in the chrome. The rest lives on the spec tab. */
function specChips(p: Preferences): { key: string; label: string; value: string }[] {
  const chips: { key: string; label: string; value: string }[] = []
  if (p.mode) chips.push({ key: 'mode', label: '', value: p.mode === 'rent' ? 'Renting' : 'Buying' })
  if (p.category) chips.push({ key: 'category', label: '', value: p.category.toUpperCase() })
  if (p.budgetMax) {
    chips.push({
      key: 'budget',
      label: 'Budget',
      value: p.mode === 'buy' ? money(p.budgetMax) : `${money(p.budgetMax)}/mo`,
    })
  }
  if (p.seatsMin) chips.push({ key: 'seats', label: 'Seats', value: `${p.seatsMin}+` })
  return chips
}

function SpecChips({ preferences }: { preferences: Preferences }) {
  const chips = specChips(preferences)
  // Newly filled chips flash once. Tracking which keys are new needs the
  // previous render's set, which a ref holds without causing another render.
  const seen = useRef(new Set<string>())
  const fresh = chips.filter((c) => !seen.current.has(c.key)).map((c) => c.key)
  useEffect(() => {
    for (const c of chips) seen.current.add(c.key)
  })

  if (chips.length === 0) {
    return (
      <div className="specchips">
        <span className="chip chip--ghost">Spec — building…</span>
      </div>
    )
  }

  return (
    <div className="specchips" aria-label="Your spec">
      {chips.map((c) => (
        <span className={`chip${fresh.includes(c.key) ? ' chip--new' : ''}`} key={c.key}>
          {c.label && <span>{c.label}</span>}
          <b>{c.value}</b>
        </span>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------- conversation */

type A2uiHostProps = Parameters<typeof A2uiHost>[0]

function Conversation({
  items,
  busy,
  phase,
  a2ui,
  onSend,
  onAction,
  onCallTool,
  onError,
}: {
  items: ChatItem[]
  busy: boolean
  phase: Phase
  a2ui: A2uiHostProps['messages']
  onSend: (text: string) => void
  onAction: (action: A2uiClientAction) => void
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  onError: (e: unknown) => void
}) {
  const [draft, setDraft] = useState('')

  // Scrolling has to survive the iframes, which report their height after they
  // have mounted and again on every step change. Watching content size rather
  // than the message count is the only thing that keeps up with them.
  const scrollerRef = useStickyScroll<HTMLDivElement>()

  // Only the newest MCP App stays interactive. A superseded one — a booking form
  // whose payment screen has already opened — collapses to a receipt line, so
  // the transaction reads as a sequence instead of a stack.
  const liveAppId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item?.kind === 'app') return item.id
    }
    return undefined
  }, [items])

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
        <span className="panel__title">Concierge</span>
        <span className="status" style={{ marginLeft: 'auto' }}>
          <span className={`status__dot${busy ? ' status__dot--busy' : ''}`} aria-hidden="true" />
          {busy ? 'Working' : 'Ready'}
        </span>
      </header>

      <div className="panel__body" ref={scrollerRef}>
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
                    <span className="step__icon" aria-hidden="true">●</span>
                    <span className="step__label">{item.label}</span>
                    <span className="step__rule" aria-hidden="true" />
                  </div>
                )
              case 'app':
                return item.id === liveAppId ? (
                  <McpAppCard
                    key={item.id}
                    label={item.toolName === 'start_booking' ? 'Booking' : item.toolName}
                    html={item.html}
                    hostContext={HOST_CONTEXT}
                    onCallTool={(name, args) => onCallTool(name, args)}
                  />
                ) : (
                  <div className="receipt" key={item.id}>
                    <span className="receipt__check" aria-hidden="true">✓</span>
                    <span className="receipt__label">Booking details captured</span>
                  </div>
                )
            }
          })}

          {/* The interview's form half — the agent asks in prose above, the
              control to answer it renders here, inline in the conversation. It
              is scoped to the interview: leaving it mounted afterwards pinned a
              stale "search on this" card below the booking form for the rest of
              the session. */}
          {phase === 'interview' && (
            <div className="interview">
              <A2uiHost messages={a2ui} surfaceId="interview" onAction={onAction} onError={onError} />
            </div>
          )}

          {busy && (
            <div className="typing" aria-label="The concierge is typing">
              <span /><span /><span />
            </div>
          )}
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

/* ---------------------------------------------------------------- stage */

function Stage({
  a2ui,
  resultCount,
  onAction,
  onError,
}: {
  a2ui: A2uiHostProps['messages']
  resultCount: number
  onAction: (action: A2uiClientAction) => void
  onError: (e: unknown) => void
}) {
  const hasResults = resultCount > 0
  const [tab, setTab] = useState<'matches' | 'spec'>('spec')
  const bodyRef = useRef<HTMLDivElement>(null)

  // The stage swaps whole views — searching, the ranked list, one car in full.
  // Each is a new page and belongs at the top; keeping the old scroll position
  // opens a car's detail half way down its own specification. Counting the
  // messages that actually rebuild the stage avoids reacting to the spec sheet
  // filling in on the other tab.
  const stageUpdates = useMemo(
    () =>
      a2ui.filter(
        (m) => (m as { updateComponents?: { surfaceId?: string } }).updateComponents?.surfaceId === 'stage',
      ).length,
    [a2ui],
  )
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [stageUpdates])

  // Results arriving is the moment the stage has something better to show than
  // the spec, so it switches itself — once. A later manual switch back sticks.
  const announced = useRef(false)
  useEffect(() => {
    if (hasResults && !announced.current) {
      announced.current = true
      setTab('matches')
    }
  }, [hasResults])

  return (
    <section className="panel panel--stage" aria-label="Results">
      <header className="panel__head">
        <span className="panel__title">{tab === 'matches' ? 'Your matches' : 'Your spec'}</span>
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'matches'}
            className={`tab${tab === 'matches' ? ' tab--active' : ''}`}
            onClick={() => setTab('matches')}
            disabled={!hasResults}
          >
            Matches
            {hasResults && <span className="tab__count">{resultCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'spec'}
            className={`tab${tab === 'spec' ? ' tab--active' : ''}`}
            onClick={() => setTab('spec')}
          >
            Your spec
          </button>
        </div>
      </header>

      <div className="panel__body" ref={bodyRef}>
        {tab === 'matches' ? (
          <A2uiHost messages={a2ui} surfaceId="stage" onAction={onAction} onError={onError} />
        ) : (
          <>
            <A2uiHost messages={a2ui} surfaceId="journey" onError={onError} />
            {!hasResults && (
              <p className="empty__hint" style={{ marginTop: 'var(--s5)', maxWidth: '40ch' }}>
                Answer the questions on the left and this fills in. Nothing is searched until
                you approve the finished spec.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ app */

export function App() {
  const { state, items, a2ui, busy, send, sendAction, callTool } = useSession()
  const [renderErrors, setRenderErrors] = useState<string[]>([])

  // Three states, not two: the intro stays mounted through `handover` so the
  // car pulling away and the cockpit arriving are one crossfade rather than a
  // cut. The cockpit renders from the first frame either way — it opens the
  // session and the SSE stream while the intro is still on screen, so the agent
  // has already said hello by the time the user sees it.
  const [entry, setEntry] = useState<'intro' | 'handover' | 'app'>(() =>
    shouldPlayIntro() ? 'intro' : 'app',
  )

  const onError = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    // Surface rather than swallow: a silently dropped A2UI message shows up as a
    // missing card, which is far harder to diagnose than a visible complaint.
    console.error('[a2ui]', e)
    setRenderErrors((prev) => (prev.includes(message) ? prev : [...prev, message]))
  }

  // Every A2UI action goes to the driver, which owns what each one means. The
  // client deliberately does not interpret them — that logic belongs with the
  // agent, not split across two codebases.
  const onAction = (action: A2uiClientAction) => {
    sendAction(action.name, (action.context ?? {}) as Record<string, unknown>)
  }

  const phase = state?.phase ?? 'interview'

  return (
    <>
      <div
        className={`app-shell${entry === 'intro' ? ' app-shell--behind' : ''}`}
        // Nothing behind the intro should be tabbable or announced while it
        // owns the screen — ↑ is the only control that exists at that point.
        inert={entry === 'intro'}
      >
        <main className="cockpit">
          <header className="topbar">
            <div className="brand">
              <span className="brand__mark" aria-hidden="true">C</span>
              <span className="brand__name">Car Matchmaker</span>
            </div>
            <Stepper phase={phase} />
            <SpecChips preferences={state?.preferences ?? {}} />
          </header>

          <div className="cockpit__body">
            <Conversation
              items={items}
              busy={busy}
              phase={phase}
              a2ui={a2ui}
              onSend={send}
              onAction={onAction}
              onCallTool={callTool}
              onError={onError}
            />
            <Stage
              a2ui={a2ui}
              resultCount={state?.shortlist.length ?? 0}
              onAction={onAction}
              onError={onError}
            />
          </div>

          {renderErrors.length > 0 && (
            <div className="render-errors" role="alert">
              {renderErrors.length} UI message(s) failed to render — see console.
            </div>
          )}
        </main>
      </div>

      {entry !== 'app' && (
        <Intro onLaunch={() => setEntry('handover')} onDone={() => setEntry('app')} />
      )}
    </>
  )
}
