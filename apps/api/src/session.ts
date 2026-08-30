import {
  type DriverMode,
  type Phase,
  type Preferences,
  type RankedListing,
  type SessionState,
  createSessionState,
} from '@car/shared'
import { randomUUID } from 'node:crypto'
import type { A2uiMessage } from './a2ui.js'
import type { ServerEvent } from './events.js'
import { recordStep } from './otel/index.js'

/**
 * Session state plus the SSE listeners watching it.
 *
 * State is the single source of truth shared by the drivers and the UI: a driver
 * mutates it through the turn context, every mutation is broadcast, so the
 * journey rail is never derived from a separate copy that can drift.
 *
 * In-memory by design — a demo has no reason to outlive its process.
 */

type Listener = (event: ServerEvent) => void

const sessions = new Map<string, { state: SessionState; listeners: Set<Listener> }>()

export function createSession(mode: DriverMode): SessionState {
  const state = createSessionState(randomUUID(), mode)
  sessions.set(state.sessionId, { state, listeners: new Set() })
  return state
}

export const getSession = (id: string): SessionState | undefined => sessions.get(id)?.state

export function subscribe(id: string, listener: Listener): () => void {
  const session = sessions.get(id)
  if (!session) throw new Error(`No session ${id}`)
  session.listeners.add(listener)
  return () => session.listeners.delete(listener)
}

export function emit(id: string, event: ServerEvent): void {
  for (const listener of sessions.get(id)?.listeners ?? []) {
    // A broken pipe on one browser tab must not stop the others receiving.
    try {
      listener(event)
    } catch {}
  }
}

/** Mutate state and broadcast the new snapshot in one step, so they cannot diverge. */
function update(id: string, mutate: (state: SessionState) => void): void {
  const session = sessions.get(id)
  if (!session) return
  mutate(session.state)
  session.state.updatedAt = new Date().toISOString()
  emit(id, { type: 'state', state: session.state })
}

/**
 * Everything a driver is allowed to do to the outside world.
 *
 * The drivers never touch the session map or the SSE stream directly — this is
 * the whole of their reach, which is what makes a driver testable and what keeps
 * the scripted and model-backed paths genuinely interchangeable.
 */
export interface TurnContext {
  readonly sessionId: string
  readonly state: SessionState
  /**
   * Emit a conversational turn. A `tag` gives the message an identity: emitting
   * the same tag again tells the client to rewind the transcript to the earlier
   * occurrence rather than append.
   */
  say(text: string, tag?: string): void
  /** Emit a collapsed reasoning chip — what the agent just did and why. */
  step(label: string, detail?: string): void
  /** Push declarative UI to one of the A2UI surfaces. */
  a2ui(messages: A2uiMessage[]): void
  /** Render an MCP App inline in the conversation. */
  mcpApp(toolName: string, html: string): void
  setPhase(phase: Phase): void
  patchPreferences(patch: Preferences): void
  /** Drop constraints entirely. A patch can only add or overwrite. */
  clearPreferences(fields: (keyof Preferences)[]): void
  setShortlist(shortlist: RankedListing[]): void
  setSearch(criteria: SessionState['criteria'], summary: SessionState['search']): void
  patchInterview(patch: Partial<SessionState['interview']>): void
}

export function makeContext(state: SessionState): TurnContext {
  const id = state.sessionId
  const send = (event: ServerEvent) => emit(id, event)

  return {
    sessionId: id,
    state,
    say: (text, tag) => send(tag ? { type: 'message', text, tag } : { type: 'message', text }),
    // Reasoning chips go to the browser and to the trace: they are already the
    // app's own account of what it just did, which makes them the closest thing
    // the deterministic path has to a narrated reasoning trace.
    step: (label, detail) => {
      recordStep(label, detail)
      send({ type: 'step', label, detail })
    },
    a2ui: (messages) => send({ type: 'a2ui', messages }),
    mcpApp: (toolName, html) => send({ type: 'mcpApp', toolName, html }),
    setPhase: (phase) => {
      update(id, (s) => {
        s.phase = phase
      })
      send({ type: 'phase', phase })
    },
    patchPreferences: (patch) => {
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
    setShortlist: (shortlist) => {
      update(id, (s) => {
        s.shortlist = shortlist
      })
      send({ type: 'results', shortlist })
    },
    setSearch: (criteria, summary) => {
      update(id, (s) => {
        s.criteria = criteria
        s.search = summary
      })
    },
    patchInterview: (patch) => {
      update(id, (s) => {
        s.interview = { ...s.interview, ...patch }
      })
    },
  }
}

/** Switch a session's driver. Returns false when the session is unknown. */
export function setSessionMode(id: string, mode: DriverMode): boolean {
  if (!sessions.has(id)) return false
  update(id, (s) => {
    s.mode = mode
  })
  return true
}
