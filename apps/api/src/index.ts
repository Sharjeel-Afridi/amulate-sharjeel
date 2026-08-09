import type { DriverMode, Phase, Preferences, RankedListing, SessionState } from '@car/shared'
import cors from 'cors'
import express from 'express'
import type { A2uiMessage } from './a2ui.js'
import type { TurnContext } from './driver.js'
import { type ServerEvent, sseFrame } from './events.js'
import { callToolJson, health } from './mcp.js'
import { LlmAgentDriver, readAgentConfig } from './agent-driver.js'
import type { AgentDriver } from './driver.js'
import { ScriptedDriver } from './scripted-driver.js'
import { createSession, emit, getSession, subscribe, update } from './sessions.js'
import {
  buildCatalogueSurface,
  buildJourneySurface,
  buildQuestionSurface,
  initSurfaces,
} from './surfaces.js'
import { nextQuestion } from './interview.js'

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
    step: (label, detail) => send({ type: 'step', label, detail }),
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
  // the user to guess that they should type something first.
  if (state.interview.answered.length === 0 && !state.interview.pending) {
    const first = nextQuestion(state.preferences, new Set())
    if (first) {
      update(req.params.id, (s) => {
        s.interview.pending = first.id
      })
      // Tagged as the first question's asking: this greeting *is* the mode
      // question, and without the tag, backing all the way up appends a second
      // copy of it under this one instead of rewinding the thread to the top.
      res.write(
        sseFrame({ type: 'message', text: `Let's find you the right car. ${first.ask}`, tag: `ask:${first.id}` }),
      )
      res.write(sseFrame({ type: 'a2ui', messages: buildQuestionSurface(first) }))
    }
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
  try {
    await driverFor(state).handleUserMessage(ctx, text)
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
  try {
    await driverFor(state).handleUiAction(ctx, name, context)
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

  try {
    const result = await callToolJson<Record<string, unknown>>(name, args)
    res.json({ content: [{ type: 'text', text: JSON.stringify(result) }] })

    const ctx = makeContext(state)
    await driverFor(state).handleAppToolResult(ctx, name, result)
    emit(state.sessionId, { type: 'idle' })
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
