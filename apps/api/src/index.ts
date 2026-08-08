import type { Phase, Preferences, RankedListing, SessionState } from '@car/shared'
import cors from 'cors'
import express from 'express'
import type { A2uiMessage } from './a2ui.js'
import type { TurnContext } from './driver.js'
import { type ServerEvent, sseFrame } from './events.js'
import { callToolJson, health } from './mcp.js'
import { ScriptedDriver, isBookingIntent } from './scripted-driver.js'
import { createSession, emit, getSession, subscribe, update } from './sessions.js'
import {
  buildCatalogueSurface,
  buildJourneySurface,
  buildQuestionSurface,
  initSurfaces,
} from './surfaces.js'
import { nextQuestion } from './interview.js'

const PORT = Number(process.env.API_PORT ?? 8080)

// One driver for now. When an API key is present this becomes a choice between
// the scripted driver and the Claude Agent SDK one, behind the same interface.
const driver = new ScriptedDriver()

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
    say: (text) => send({ type: 'message', text }),
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
  res.json({ status: 'ok', driver: driver.name, mcp: await health() })
})

app.post('/api/session', (_req, res) => {
  const state = createSession()
  res.json({ sessionId: state.sessionId, state })
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
      res.write(sseFrame({ type: 'message', text: `Let's find you the right car. ${first.ask}` }))
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
    // "Book the Volvo" is a booking intent, not another interview answer.
    if (isBookingIntent(text) && state.shortlist.length > 0) {
      const listing = driver.findListingInShortlist(ctx, text) ?? state.shortlist[0]!.listing
      await driver.startBooking(ctx, listing.id)
    } else {
      await driver.handleUserMessage(ctx, text)
    }
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
    await driver.handleUiAction(ctx, name, context)
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
    await driver.handleAppToolResult(ctx, name, result)
    emit(state.sessionId, { type: 'idle' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tool call failed'
    res.status(500).json({ error: message })
    emit(state.sessionId, { type: 'error', message })
  }
  return undefined
})

app.listen(PORT, () => {
  console.log(`[api] car matchmaker on http://localhost:${PORT} (driver: ${driver.name})`)
})
