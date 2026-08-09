import { PHASES, type DriverMode, type Phase, type Preferences, money } from '@car/shared'
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

/**
 * Theme tokens handed to MCP App iframes so widgets match the host.
 *
 * `--guide-ring` is how the guided highlight reaches inside the sandbox. The
 * host cannot style a cross-origin iframe, but it can hand the guest a token,
 * and the widget paints its primary button with it — so the booking steps join
 * the same highlight as everything else instead of being the one place the
 * trail goes cold.
 */
function hostContext(guided: boolean) {
  return {
    theme: 'dark' as const,
    displayMode: 'inline' as const,
    locale: 'en-IE',
    styles: {
      '--accent': '#c8ff3d',
      '--accent-ink': '#14200a',
      // The iframe has nothing behind it, so it needs an explicit surface or it
      // falls back to white and the dark widget becomes unreadable.
      '--bg': '#15181d',
      '--guide-ring': guided ? 'rgba(200, 255, 61, 0.55)' : 'transparent',
    },
  }
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

/**
 * Driver switch.
 *
 * Front and centre rather than buried, because the failure it covers is a live
 * one: a free-tier provider throttling in the middle of a demo. Scripted runs
 * the same journey through the same tools and surfaces, so flipping it is a
 * recovery, not a downgrade — and it takes the session's gathered state with it.
 */
function ModeToggle({
  mode,
  agentAvailable,
  agentName,
  onChange,
}: {
  mode: DriverMode
  agentAvailable: boolean
  agentName: string | null
  onChange: (mode: DriverMode) => void
}) {
  return (
    <div className="modeswitch" role="group" aria-label="Driver mode">
      <button
        type="button"
        className={`modeswitch__opt${mode === 'scripted' ? ' modeswitch__opt--on' : ''}`}
        aria-pressed={mode === 'scripted'}
        onClick={() => onChange('scripted')}
        title="Deterministic driver — no model, no API key, no rate limits. Highlights the controls to click."
      >
        Scripted
      </button>
      <button
        type="button"
        className={`modeswitch__opt${mode === 'agent' ? ' modeswitch__opt--on' : ''}`}
        aria-pressed={mode === 'agent'}
        disabled={!agentAvailable}
        onClick={() => onChange('agent')}
        title={
          agentAvailable
            ? `Model-backed agent${agentName ? ` — ${agentName}` : ''}`
            : 'Needs AGENT_API_KEY on the server'
        }
      >
        Agent
      </button>
    </div>
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
  guided,
  a2ui,
  onSend,
  onAction,
  onCallTool,
  onError,
}: {
  items: ChatItem[]
  busy: boolean
  phase: Phase
  /** Scripted mode — the widget gets a highlight token with its theme. */
  guided: boolean
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

  // The newest thing the agent said, while the interview is running, is the
  // question being asked — so it is set in display type rather than left to look
  // like one more line of chat. Everything above it recedes to transcript.
  const askId = useMemo(() => {
    if (phase !== 'interview') return undefined
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]?.kind === 'agent') return items[i]!.id
    }
    return undefined
  }, [items, phase])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  return (
    <section className="panel panel--chat" aria-label="Conversation">
      <div className="panel__body" ref={scrollerRef}>
        <div className="chat">
          {items.map((item) => {
            switch (item.kind) {
              case 'agent':
                return (
                  <div
                    className={`msg msg--agent${item.id === askId ? ' msg--ask' : ''}`}
                    key={item.id}
                  >
                    {item.text}
                  </div>
                )
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
                    hostContext={hostContext(guided)}
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

/**
 * The ranked catalogue, given the whole window.
 *
 * No panel chrome and no tabs. Both used to be necessary when this shared the
 * width with the conversation and had to host the spec sheet as well; now the
 * spec lives in its own drawer and the cars get every pixel, which is what makes
 * a photograph of a car read as a car rather than a thumbnail.
 */
function Stage({
  a2ui,
  onAction,
  onError,
}: {
  a2ui: A2uiHostProps['messages']
  onAction: (action: A2uiClientAction) => void
  onError: (e: unknown) => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)

  // The stage swaps whole views — searching, the ranked list, one car in full.
  // Each is a new page and belongs at the top; keeping the old scroll position
  // opens a car's detail half way down its own specification.
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

  return (
    <section className="stage" aria-label="Results" ref={bodyRef}>
      <div className="stage__inner">
        <A2uiHost messages={a2ui} surfaceId="stage" onAction={onAction} onError={onError} />
      </div>
    </section>
  )
}

/**
 * The conversation, reduced to a dock, while the catalogue has the window.
 *
 * The agent's summary of the results and the ability to answer it are not
 * optional extras — "book the Volvo" is a supported way through this product,
 * and the sentence explaining why one car placed first is the reason the ranking
 * is trustworthy. Both survive the full-width view as a single strip.
 */
function Dock({
  items,
  busy,
  onSend,
}: {
  items: ChatItem[]
  busy: boolean
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')

  const latest = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item?.kind === 'agent') return item.text
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
    <div className="dock">
      <div className="dock__inner">
        {latest && (
          <p className="dock__say">
            <span className={`status__dot${busy ? ' status__dot--busy' : ''}`} aria-hidden="true" />
            {latest}
          </p>
        )}
        <form className="composer" onSubmit={submit}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask for a change, or say “book the first one”…"
            aria-label="Message the agent"
            autoComplete="off"
          />
          <button type="submit" disabled={!draft.trim()}>Send</button>
        </form>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- spec drawer */

/**
 * The spec, docked out of the way.
 *
 * Once there are cars on screen the spec stops being the thing you are working
 * on and becomes the thing you occasionally correct — so it earns a toggle
 * rather than half the window. It stays mounted while closed: the surface is
 * live and patched by the stream, and unmounting it would drop the edits made
 * to a row the moment the drawer shut.
 */
function SpecDrawer({
  open,
  onClose,
  a2ui,
  onAction,
  onError,
}: {
  open: boolean
  onClose: () => void
  a2ui: A2uiHostProps['messages']
  onAction: (action: A2uiClientAction) => void
  onError: (e: unknown) => void
}) {
  // Escape is the expected way out of anything that overlays.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div
        className={`drawer__scrim${open ? ' drawer__scrim--on' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`drawer${open ? ' drawer--open' : ''}`}
        aria-label="Your spec"
        aria-hidden={!open}
        inert={!open}
      >
        <header className="drawer__head">
          <span className="panel__title">Your spec</span>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close spec">
            ✕
          </button>
        </header>
        <div className="drawer__body">
          <p className="drawer__hint">
            Change anything here, then search again. Every line is the answer the interview
            recorded.
          </p>
          <A2uiHost messages={a2ui} surfaceId="journey" onAction={onAction} onError={onError} />
        </div>
      </aside>
    </>
  )
}

/* ------------------------------------------------------------------ app */

export function App() {
  const { state, items, a2ui, busy, agent, send, sendAction, callTool, setMode } = useSession()
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
  const mode: DriverMode = state?.mode ?? 'scripted'

  // Two layouts, chosen by what the user is actually doing.
  //
  // `form` is one centred column: the interview, and later the booking and
  // checkout widgets — both are a single task at a time and read better narrow.
  // `browse` hands the whole window to the catalogue. Splitting the difference
  // with two permanent columns is what made the question small and the cars
  // small at the same time.
  const view: 'form' | 'browse' = phase === 'research' || phase === 'recommend' ? 'browse' : 'form'

  // A question reads best at a book's measure; a four-step booking widget with
  // dates, extras and a card form does not. Same centred column, more of it.
  const wide = phase === 'book' || phase === 'done'

  const [specOpen, setSpecOpen] = useState(false)

  return (
    <>
      <div
        className={`app-shell${entry === 'intro' ? ' app-shell--behind' : ''}`}
        // Scripted mode turns on the guided highlight: every control the
        // deterministic driver handles gets a ring, so whoever is demoing can
        // see the path without having read the driver.
        data-guide={mode === 'scripted' ? 'on' : 'off'}
        // Nothing behind the intro should be tabbable or announced while it
        // owns the screen — ↑ is the only control that exists at that point.
        inert={entry === 'intro'}
      >
        <main className={`cockpit cockpit--${view}${wide ? ' cockpit--wide' : ''}`}>
          <header className="topbar">
            <div className="brand">
              <span className="brand__mark" aria-hidden="true">C</span>
              <span className="brand__name">Car Matchmaker</span>
            </div>
            <Stepper phase={phase} />
            <div className="topbar__right">
              <ModeToggle
                mode={mode}
                agentAvailable={agent.available}
                agentName={agent.name}
                onChange={(next) => void setMode(next)}
              />
              <SpecChips preferences={state?.preferences ?? {}} />
              <button
                type="button"
                className={`specbtn${specOpen ? ' specbtn--on' : ''}`}
                aria-expanded={specOpen}
                onClick={() => setSpecOpen((v) => !v)}
              >
                Your spec
              </button>
            </div>
          </header>

          {mode === 'scripted' && (
            <div className="guidebar" role="status">
              <span className="guidebar__dot" aria-hidden="true" />
              Scripted demo — no model is called. Click the{' '}
              <span className="guidebar__swatch" aria-hidden="true" /> highlighted controls to walk
              the journey. Typing still works, but it is pattern-matched rather than understood.
            </div>
          )}

          <div className="cockpit__body">
            {view === 'browse' ? (
              <>
                <Stage a2ui={a2ui} onAction={onAction} onError={onError} />
                <Dock items={items} busy={busy} onSend={send} />
              </>
            ) : (
              <Conversation
                items={items}
                busy={busy}
                phase={phase}
                guided={mode === 'scripted'}
                a2ui={a2ui}
                onSend={send}
                onAction={onAction}
                onCallTool={callTool}
                onError={onError}
              />
            )}
          </div>

          <SpecDrawer
            open={specOpen}
            onClose={() => setSpecOpen(false)}
            a2ui={a2ui}
            onAction={onAction}
            onError={onError}
          />

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
