import type { DriverMode, Phase, Preferences, RankedListing, SessionState } from '@car/shared'
import cors from 'cors'
import express from 'express'
import type { A2uiMessage } from './a2ui.js'
import type { TurnContext } from './driver.js'
import { type ServerEvent, sseFrame } from './events.js'
import { callToolJson, health } from './mcp.js'
import { LlmAgentDriver, readAgentConfig } from './agent-driver.js'
import type { AgentDriver } from './driver.js'
import { readOtelConfig, recordStep, tracingEnabled, withTurn } from './otel/index.js'
import { ScriptedDriver } from './scripted-driver.js'
import { createSession, emit, getSession, subscribe, update } from './sessions.js'
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
 * This used to be a single process-wide choice made from the environment, which
 * meant recovering from a throttled provider mid-presentation involved
 * restarting the server. The deterministic driver exercises the same journey,
 * the same tools and the same surfaces — only the wording is canned — so having
 * it one click away is worth far more than having it configured.
 *
 * The model-backed driver is optional: no key, or a constructor that throws,
 * leaves `agentDriver` undefined and the UI offers scripted only. An app that
 * boots and works beats one that refuses to start over an optional key.
 */
const scriptedDriver = new ScriptedDriver()

const agentDriver: AgentDriver | undefined = (() => {
  const cfg = readAgentConfig()
  if (!cfg) {
    console.log('[api] no AGENT_API_KEY — agent mode unavailable, scripted only')
    return undefined
  }
  try {
    const driver = new LlmAgentDriver(cfg)
    console.log(`[api] agent mode available: ${cfg.provider} / ${cfg.model}`)
    return driver
  } catch (err) {
    console.error('[api] agent setup failed, scripted only:', err)
    return undefined
  }
})()

/**
 * What a new session starts as. `AGENT_MODE=scripted` still forces the
 * deterministic path, and it remains the default when no key is configured.
 */
const DEFAULT_MODE: DriverMode =
  process.env.AGENT_MODE?.trim().toLowerCase() === 'scripted' || !agentDriver ? 'scripted' : 'agent'

/** Falls back rather than failing: a session asking for an absent driver gets scripted. */
function driverFor(state: SessionState): AgentDriver {
  return state.mode === 'agent' && agentDriver ? agentDriver : scriptedDriver
}

const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: '2mb' }))

/** Everything a driver may do, bound to one session. */
function makeContext(state: SessionState): TurnContext {
  const id = state.sessionId
  const send = (event: ServerEvent) => emit(id, event)

  return {
    sessionId: id,
    state,
    say: (text, tag) => send(tag ? { type: 'message', text, tag } : { type: 'message', text }),
    /*
     * Reasoning chips go to the browser and to the trace.
     *
     * One hook covers every `ctx.step()` call site in both drivers, and these
     * are already the app's own account of what it just did — which makes them
     * the closest thing the deterministic path has to a narrated reasoning
     * trace, for free.
     */
    step: (label, detail) => {
      recordStep(label, detail)
      send({ type: 'step', label, detail })
    },
    a2ui: (messages: A2uiMessage[]) => send({ type: 'a2ui', messages }),
    mcpApp: (toolName, html) => send({ type: 'mcpApp', toolName, html }),
    setPhase: (phase: Phase) => {
      update(id, (s) => {
        s.phase = phase
      })
      send({ type: 'phase', phase })
    },
    patchPreferences: (patch: Preferences) => {
      update(id, (s) => {
        for (const [k, v] of Object.entries(patch)) {
          if (v !== undefined) (s.preferences as Record<string, unknown>)[k] = v
        }
      })
    },
    clearPreferences: (fields) => {
      update(id, (s) => {
        for (const f of fields) delete (s.preferences as Record<string, unknown>)[f]
      })
    },
    setShortlist: (shortlist: RankedListing[]) => {
      update(id, (s) => {
        s.shortlist = shortlist
      })
      send({ type: 'results', shortlist })
    },
    setSearchSummary: (summary) => {
      update(id, (s) => {
        s.search = summary
      })
    },
    patchInterview: (patch) => {
      update(id, (s) => {
        s.interview = { ...s.interview, ...patch }
      })
    },
    setCriteria: (criteria) => {
      update(id, (s) => {
        s.criteria = criteria
      })
    },
    setRuledOut: (ruledOut) => {
      update(id, (s) => {
        s.ruledOut = ruledOut
      })
    },
  }
}

app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'ok',
    driver: agentDriver && DEFAULT_MODE === 'agent' ? agentDriver.name : scriptedDriver.name,
    defaultMode: DEFAULT_MODE,
    agentAvailable: Boolean(agentDriver),
    agentName: agentDriver?.name ?? null,
    mcp: await health(),
    // Reported because "tracing is off" and "tracing is broken" look identical
    // from the outside, and the difference is the first thing to establish.
    tracing: { enabled: tracingEnabled(), backend: readOtelConfig().backend },
  })
})

app.post('/api/session', (_req, res) => {
  const state = createSession(DEFAULT_MODE)
  res.json({
    sessionId: state.sessionId,
    state,
    // The client renders the mode toggle from this, so it never offers a driver
    // the server cannot actually run.
    agentAvailable: Boolean(agentDriver),
    agentName: agentDriver?.name ?? null,
  })
})

/**
 * Switch this session's driver.
 *
 * Mid-session is deliberately allowed. The two drivers share `journey.ts` and
 * operate on the same `SessionState`, so everything gathered so far — answers,
 * criteria, shortlist — carries across intact.
 */
app.post('/api/session/:id/mode', (req, res) => {
  const state = getSession(req.params.id)
  if (!state) return res.status(404).json({ error: 'no such session' })

  const mode = String(req.body?.mode ?? '') as DriverMode
  if (mode !== 'scripted' && mode !== 'agent') {
    return res.status(400).json({ error: 'mode must be "scripted" or "agent"' })
  }
  if (mode === 'agent' && !agentDriver) {
    return res.status(409).json({ error: 'Agent mode needs AGENT_API_KEY. Scripted is the only driver available.' })
  }

  update(req.params.id, (s) => {
    s.mode = mode
  })
  emit(req.params.id, {
    type: 'step',
    label: mode === 'agent' ? 'Switched to the model-backed agent' : 'Switched to the scripted driver',
    detail:
      mode === 'agent'
        ? agentDriver?.name
        : 'Deterministic: same tools, same surfaces, canned wording',
  })
  return res.json({ mode })
})

/** SSE stream. The browser opens this once and keeps it for the session. */
app.get('/api/session/:id/stream', (req, res) => {
  const state = getSession(req.params.id)
  if (!state) return res.status(404).json({ error: 'no such session' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Without this an intervening proxy will buffer the stream and nothing
    // appears until the response ends.
    'X-Accel-Buffering': 'no',
  })

  res.write(sseFrame({ type: 'state', state }))

  // Surfaces are created once per connected client. `createSurface` throws on a
  // surface that already exists, so this cannot be re-sent on every update — and
  // a reconnecting client rebuilds its processor from scratch anyway.
  res.write(sseFrame({ type: 'a2ui', messages: initSurfaces() }))
  if (state.shortlist.length > 0) {
    // Replay the catalogue so a reconnect doesn't land on an empty stage.
    res.write(sseFrame({ type: 'a2ui', messages: buildCatalogueSurface(state.shortlist) }))
  }
  res.write(sseFrame({ type: 'a2ui', messages: buildJourneySurface(state) }))

  const unsubscribe = subscribe(req.params.id, (event) => res.write(sseFrame(event)))

  // Open the interview as soon as someone is listening, rather than waiting for
  // the user to guess that they should type something first. The greeting is
  // tagged so a reconnect replaces it rather than stacking a second copy.
  if (state.phase === 'interview') {
    res.write(
      sseFrame({
        type: 'message',
        // Short on purpose: the client sets the newest interview line in display
        // type, and a paragraph at that size fills the screen before the form
        // it is introducing. The sheet's own lead carries the instructions.
        text: "Let's find you the right car.",
        tag: 'greeting',
      }),
    )
    res.write(sseFrame({ type: 'a2ui', messages: buildInterviewFormSurface(state) }))
  }
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
  return undefined
})

app.post('/api/session/:id/message', async (req, res) => {
  const state = getSession(req.params.id)
  if (!state) return res.status(404).json({ error: 'no such session' })

  const text = String(req.body?.text ?? '').trim()
  if (!text) return res.status(400).json({ error: 'text required' })

  res.json({ accepted: true })

  const ctx = makeContext(state)
  const driver = driverFor(state)
  try {
    await withTurn(
      {
        sessionId: state.sessionId,
        trigger: 'message',
        label: 'turn: message',
        driver: driver.name,
        phase: state.phase,
        input: text,
      },
      () => driver.handleUserMessage(ctx, text),
    )
  } catch (err) {
    emit(state.sessionId, {
      type: 'error',
      message: err instanceof Error ? err.message : 'Something went wrong',
    })
  }
  emit(state.sessionId, { type: 'idle' })
  return undefined
})

/** Actions fired by A2UI-rendered controls — the interview's hybrid half. */
app.post('/api/session/:id/action', async (req, res) => {
  const state = getSession(req.params.id)
  if (!state) return res.status(404).json({ error: 'no such session' })

  const name = String(req.body?.name ?? '')
  const context = (req.body?.context ?? {}) as Record<string, unknown>
  if (!name) return res.status(400).json({ error: 'action name required' })

  res.json({ accepted: true })

  const ctx = makeContext(state)
  const driver = driverFor(state)
  try {
    // The action name is bounded by the set of controls the surfaces render, so
    // it is safe in the span name — and it is the one thing you want to group by
    // when asking which control is slow.
    await withTurn(
      {
        sessionId: state.sessionId,
        trigger: 'action',
        label: `turn: action ${name}`,
        driver: driver.name,
        phase: state.phase,
        input: context,
      },
      () => driver.handleUiAction(ctx, name, context),
    )
  } catch (err) {
    emit(state.sessionId, {
      type: 'error',
      message: err instanceof Error ? err.message : 'Something went wrong',
    })
  }
  emit(state.sessionId, { type: 'idle' })
  return undefined
})

/**
 * Tool calls originating inside an MCP App iframe.
 *
 * They are proxied through here rather than letting the browser reach the MCP
 * server, so every tool call stays on one auditable path and the driver gets a
 * chance to react to what the widget did.
 */
app.post('/api/session/:id/tool', async (req, res) => {
  const state = getSession(req.params.id)
  if (!state) return res.status(404).json({ error: 'no such session' })

  const name = String(req.body?.name ?? '')
  const args = (req.body?.arguments ?? {}) as Record<string, unknown>
  if (!name) return res.status(400).json({ error: 'tool name required' })

  const driver = driverFor(state)
  try {
    // Wrapped as a turn because that is what it is from the journey's point of
    // view: a submitted booking or a confirmed payment advances the same state
    // machine a typed message would, and tracing it separately would leave the
    // transactional half of the product invisible.
    await withTurn(
      {
        sessionId: state.sessionId,
        trigger: 'app-tool',
        label: `turn: app-tool ${name}`,
        driver: driver.name,
        phase: state.phase,
        input: args,
      },
      async () => {
        const result = await callToolJson<Record<string, unknown>>(name, args)
        res.json({ content: [{ type: 'text', text: JSON.stringify(result) }] })

        const ctx = makeContext(state)
        await driver.handleAppToolResult(ctx, name, result)
        emit(state.sessionId, { type: 'idle' })
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tool call failed'
    res.status(500).json({ error: message })
    emit(state.sessionId, { type: 'error', message })
  }
  return undefined
})

app.listen(PORT, () => {
  console.log(
    `[api] car matchmaker on http://localhost:${PORT} ` +
      `(default: ${DEFAULT_MODE}${agentDriver ? `, agent available: ${agentDriver.name}` : ', scripted only'})`,
  )
})
