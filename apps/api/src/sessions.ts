import { type Preferences, type SessionState, createSessionState } from '@car/shared'
import { randomUUID } from 'node:crypto'
import type { ServerEvent } from './events.js'

/**
 * Session state plus the set of SSE listeners watching it.
 *
 * State is the single source of truth shared by the agent and the UI: the agent
 * mutates it through tools, and every mutation is broadcast, so the journey rail
 * is never derived from a separate copy that can drift.
 *
 * In-memory by design — a demo has no reason to outlive its process, and there
 * is nothing here worth persisting.
 */

type Listener = (event: ServerEvent) => void

interface Session {
  state: SessionState
  listeners: Set<Listener>
}

const sessions = new Map<string, Session>()

export function createSession(): SessionState {
  const state = createSessionState(randomUUID())
  sessions.set(state.sessionId, { state, listeners: new Set() })
  return state
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id)?.state
}

export function subscribe(id: string, listener: Listener): () => void {
  const session = sessions.get(id)
  if (!session) throw new Error(`No session ${id}`)
  session.listeners.add(listener)
  return () => session.listeners.delete(listener)
}

export function emit(id: string, event: ServerEvent): void {
  const session = sessions.get(id)
  if (!session) return
  for (const listener of session.listeners) {
    try {
      listener(event)
    } catch {
      // A broken pipe on one browser tab must not stop the others receiving.
    }
  }
}

/** Mutate state and broadcast the new snapshot in one step, so they cannot diverge. */
export function update(id: string, mutate: (state: SessionState) => void): SessionState | undefined {
  const session = sessions.get(id)
  if (!session) return undefined
  mutate(session.state)
  session.state.updatedAt = new Date().toISOString()
  emit(id, { type: 'state', state: session.state })
  return session.state
}

/** Merge preferences, ignoring undefined so a partial update never clears a field. */
export function mergePreferences(id: string, patch: Preferences): SessionState | undefined {
  return update(id, (state) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        ;(state.preferences as Record<string, unknown>)[key] = value
      }
    }
  })
}

export function sessionCount(): number {
  return sessions.size
}
