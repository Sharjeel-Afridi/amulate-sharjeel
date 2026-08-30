import type { DriverMode, InterviewStyle, SessionState } from '@car/shared'
import cors from 'cors'
import express, { type Request, type Response } from 'express'
import {
  type Driver,
  advanceAdaptive,
  handleAppToolResult,
  handleUiAction,
} from './drivers/index.js'
import { LlmDriver } from './drivers/agent.js'
import { ScriptedDriver } from './drivers/scripted.js'
import { readAgentConfig } from './agents/provider.js'
import { getEpisode, questionStats } from './episodes.js'
import { sseFrame } from './events.js'
import { callToolJson, health } from './mcp.js'
import { readOtelConfig, tracingEnabled, withTurn } from './otel/index.js'
import {
  createSession,
  emit,
  getSession,
  makeContext,
  setSessionMode,
  subscribe,
} from './session.js'
import {
  buildCatalogueSurface,
  buildInterviewFormSurface,
  buildJourneySurface,
  initSurfaces,
} from './surfaces.js'

const PORT = Number(process.env.API_PORT ?? 8080)

/**
 * Both drivers are built at boot, and each session picks one.
 *
 * The model-backed one is optional: no key, or a constructor that throws, leaves
 * it undefined and the UI offers scripted only. An app that boots and works
 * beats one that refuses to start over an optional key.
 */
const scripted = new ScriptedDriver()

const llm: Driver | undefined = (() => {
  const cfg = readAgentConfig()
  if (!cfg) {
    console.log('[api] no AGENT_API_KEY — agent mode unavailable, scripted only')
    return undefined
  }
  try {
    const driver = new LlmDriver(cfg)
    console.log(`[api] agent mode available: ${cfg.provider} / ${cfg.model}`)
    return driver
  } catch (err) {
    console.error('[api] agent setup failed, scripted only:', err)
    return undefined
  }
})()

const DEFAULT_MODE: DriverMode =
  process.env.AGENT_MODE?.trim().toLowerCase() === 'scripted' || !llm ? 'scripted' : 'agent'

/**
 * Adaptive is the product; the form is the fallback and the control arm of the
 * adaptive-vs-form experiment. `INTERVIEW_STYLE=form` flips the default, and a
 * session can ask for either explicitly when it is created.
 */
const DEFAULT_STYLE: InterviewStyle =
  process.env.INTERVIEW_STYLE?.trim().toLowerCase() === 'form' ? 'form' : 'adaptive'

/** Falls back rather than failing: a session asking for an absent driver gets scripted. */
const driverFor = (state: SessionState): Driver =>
  state.mode === 'agent' && llm ? llm : scripted

const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: '2mb' }))

/** Resolves the session named in the path, answering 404 itself if there is none. */
function session(req: Request, res: Response): SessionState | undefined {
  const state = getSession(sessionId(req))
  if (!state) res.status(404).json({ error: 'no such session' })
  return state
}

const sessionId = (req: Request): string => String(req.params.id ?? '')

/**
 * Runs one turn and reports the outcome on the event stream.
 *
 * Every entry point — a typed message, a tapped control, an MCP App result —
 * goes through here, so a turn is traced, its errors reach the transcript rather
 * than only the log, and the client always gets the `idle` that ends it.
 */
async function turn(
  state: SessionState,
  trigger: 'message' | 'action' | 'app-tool',
  label: string,
  input: unknown,
  work: (driver: Driver) => Promise<void>,
): Promise<void> {
  const driver = driverFor(state)
  try {
    await withTurn(
      {
        sessionId: state.sessionId,
        trigger,
        label,
        driver: driver.name,
        phase: state.phase,
        input,
      },
      () => work(driver),
    )
  } catch (err) {
    emit(state.sessionId, {
      type: 'error',
      message: err instanceof Error ? err.message : 'Something went wrong',
    })
  }
  emit(state.sessionId, { type: 'idle' })
}

app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'ok',
    driver: llm && DEFAULT_MODE === 'agent' ? llm.name : scripted.name,
    defaultMode: DEFAULT_MODE,
    agentAvailable: Boolean(llm),
    agentName: llm?.name ?? null,
    mcp: await health(),
    // Reported because "tracing is off" and "tracing is broken" look identical
    // from the outside, and the difference is the first thing to establish.
    tracing: { enabled: tracingEnabled(), backend: readOtelConfig().backend },
  })
})

/** The session's episode — the full question/answer/outcome trail. */
app.get('/api/session/:id/episode', (req, res) => {
  if (!session(req, res)) return
  const episode = getEpisode(sessionId(req))
  if (!episode) return res.status(404).json({ error: 'no episode recorded yet' })
  return res.json(episode)
})

/** Per-question effectiveness over this process's sessions. */
app.get('/api/question-stats', (_req, res) => {
  res.json(questionStats())
})

app.post('/api/session', (req, res) => {
  const asked = String(req.body?.style ?? '').toLowerCase()
  const style: InterviewStyle =
    asked === 'form' || asked === 'adaptive' ? (asked as InterviewStyle) : DEFAULT_STYLE
  const state = createSession(DEFAULT_MODE, style)
  res.json({
    sessionId: state.sessionId,
    state,
    // The client renders the mode toggle from this, so it never offers a driver
    // the server cannot actually run.
    agentAvailable: Boolean(llm),
    agentName: llm?.name ?? null,
  })
})

/**
 * Switch this session's driver.
 *
 * Mid-session is deliberately allowed: the two drivers share the whole flow and
 * operate on the same state, so everything gathered so far carries across.
 */
app.post('/api/session/:id/mode', (req, res) => {
  if (!session(req, res)) return

  const mode = String(req.body?.mode ?? '') as DriverMode
  if (mode !== 'scripted' && mode !== 'agent') {
    return res.status(400).json({ error: 'mode must be "scripted" or "agent"' })
  }
  if (mode === 'agent' && !llm) {
    return res
      .status(409)
      .json({ error: 'Agent mode needs AGENT_API_KEY. Scripted is the only driver available.' })
  }

  setSessionMode(sessionId(req), mode)
  emit(sessionId(req), {
    type: 'step',
    label: mode === 'agent' ? 'Switched to the model-backed agent' : 'Switched to the scripted driver',
    detail: mode === 'agent' ? llm?.name : 'Deterministic: same tools, same surfaces, canned wording',
  })
  return res.json({ mode })
})

/** SSE stream. The browser opens this once and keeps it for the session. */
app.get('/api/session/:id/stream', (req, res) => {
  const state = session(req, res)
  if (!state) return

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this an intervening proxy buffers the stream and nothing appears
    // until the response ends.
    'X-Accel-Buffering': 'no',
  })

  res.write(sseFrame({ type: 'state', state }))
  // Surfaces are created once per connected client — `createSurface` throws on
  // one that already exists, and a reconnecting client rebuilds from scratch.
  res.write(sseFrame({ type: 'a2ui', messages: initSurfaces() }))
  // Replay the catalogue so a reconnect doesn't land on an empty stage.
  if (state.shortlist.length > 0) {
    res.write(sseFrame({ type: 'a2ui', messages: buildCatalogueSurface(state.shortlist) }))
  }
  res.write(sseFrame({ type: 'a2ui', messages: buildJourneySurface(state) }))

  // Open the interview as soon as someone is listening, rather than waiting for
  // the user to guess they should type first. Tagged so a reconnect replaces the
  // greeting rather than stacking a second copy.
  if (state.phase === 'interview') {
    const adaptive = state.interview.style === 'adaptive'
    res.write(
      sseFrame({
        type: 'message',
        text: adaptive
          ? "Let's find you the right car — a few quick taps is all it takes."
          : "Let's find you the right car.",
        tag: 'greeting',
      }),
    )
    if (!adaptive) res.write(sseFrame({ type: 'a2ui', messages: buildInterviewFormSurface(state) }))
  }

  const unsubscribe = subscribe(sessionId(req), (event) => res.write(sseFrame(event)))
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })

  // The adaptive interview's first (or current) question, sent through the
  // subscription so this client and any others render the same thing.
  // Idempotent on reconnect: an open question is re-presented, never re-chosen.
  if (state.phase === 'interview' && state.interview.style === 'adaptive') {
    void advanceAdaptive(driverFor(state), makeContext(state)).catch((err) =>
      console.error('[api] adaptive kick-off failed:', err),
    )
  }
})

app.post('/api/session/:id/message', async (req, res) => {
  const state = session(req, res)
  if (!state) return

  const text = String(req.body?.text ?? '').trim()
  if (!text) return res.status(400).json({ error: 'text required' })
  res.json({ accepted: true })

  const ctx = makeContext(state)
  await turn(state, 'message', 'turn: message', text, (driver) =>
    driver.handleUserMessage(ctx, text),
  )
})

/** Actions fired by A2UI-rendered controls — the interview's hybrid half. */
app.post('/api/session/:id/action', async (req, res) => {
  const state = session(req, res)
  if (!state) return

  const name = String(req.body?.name ?? '')
  if (!name) return res.status(400).json({ error: 'action name required' })
  const context = (req.body?.context ?? {}) as Record<string, unknown>
  res.json({ accepted: true })

  const ctx = makeContext(state)
  // The action name is bounded by the set of controls the surfaces render, so it
  // is safe in the span name — and it is what you group by to ask which control
  // is slow.
  await turn(state, 'action', `turn: action ${name}`, context, (driver) =>
    handleUiAction(driver, ctx, name, context),
  )
})

/**
 * Tool calls originating inside an MCP App iframe.
 *
 * Proxied through here rather than letting the browser reach the MCP server, so
 * every tool call stays on one auditable path and the driver gets a chance to
 * react to what the widget did.
 */
app.post('/api/session/:id/tool', async (req, res) => {
  const state = session(req, res)
  if (!state) return

  const name = String(req.body?.name ?? '')
  if (!name) return res.status(400).json({ error: 'tool name required' })
  const args = (req.body?.arguments ?? {}) as Record<string, unknown>

  // Not routed through `turn`: the widget is waiting on this response, so the
  // tool result has to be answered before the driver reacts to it, and a failure
  // is an HTTP error rather than only a transcript one.
  try {
    await withTurn(
      {
        sessionId: state.sessionId,
        trigger: 'app-tool',
        label: `turn: app-tool ${name}`,
        driver: driverFor(state).name,
        phase: state.phase,
        input: args,
      },
      async () => {
        const result = await callToolJson<Record<string, unknown>>(name, args)
        res.json({ content: [{ type: 'text', text: JSON.stringify(result) }] })
        await handleAppToolResult(makeContext(state), name, result)
        emit(state.sessionId, { type: 'idle' })
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tool call failed'
    res.status(500).json({ error: message })
    emit(state.sessionId, { type: 'error', message })
  }
})

app.listen(PORT, () => {
  console.log(
    `[api] car matchmaker on http://localhost:${PORT} ` +
      `(default: ${DEFAULT_MODE}${llm ? `, agent available: ${llm.name}` : ', scripted only'})`,
  )
})
