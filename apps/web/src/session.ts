import type { A2uiMessage } from '@a2ui/web_core/v0_9'
import type { Phase, RankedListing, SessionState } from '@car/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Client half of the session.
 *
 * The API owns the state; this hook mirrors it from the SSE stream and never
 * derives its own copy, so the journey rail cannot drift from what the agent
 * actually knows.
 */

type ServerEvent =
  | { type: 'state'; state: SessionState }
  | { type: 'message'; text: string }
  | { type: 'step'; label: string; detail?: string }
  | { type: 'a2ui'; messages: A2uiMessage[] }
  | { type: 'mcpApp'; toolName: string; html: string }
  | { type: 'phase'; phase: Phase }
  | { type: 'results'; shortlist: RankedListing[] }
  | { type: 'idle' }
  | { type: 'error'; message: string }

/**
 * One ordered stream so MCP Apps land inline in the conversation rather than in
 * a separate panel — the brief requires booking to happen without leaving chat.
 */
export type ChatItem =
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'user'; id: string; text: string }
  | { kind: 'step'; id: string; label: string; detail?: string }
  | { kind: 'app'; id: string; toolName: string; html: string }
  | { kind: 'error'; id: string; text: string }

let seq = 0
const nextId = () => `i${++seq}`

export function useSession() {
  const [sessionId, setSessionId] = useState<string>()
  const [state, setState] = useState<SessionState>()
  const [items, setItems] = useState<ChatItem[]>([])
  const [a2ui, setA2ui] = useState<A2uiMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const sessionRef = useRef<string | undefined>(undefined)

  // Create a session once, then hold the stream open for its lifetime.
  useEffect(() => {
    let cancelled = false
    let source: EventSource | undefined

    void (async () => {
      const res = await fetch('/api/session', { method: 'POST' })
      const body = (await res.json()) as { sessionId: string; state: SessionState }
      if (cancelled) return

      sessionRef.current = body.sessionId
      setSessionId(body.sessionId)
      setState(body.state)

      source = new EventSource(`/api/session/${body.sessionId}/stream`)
      source.onopen = () => setConnected(true)
      source.onerror = () => setConnected(false)
      source.onmessage = (e) => {
        const event = JSON.parse(e.data) as ServerEvent
        switch (event.type) {
          case 'state':
            return setState(event.state)
          case 'phase':
            return setState((s) => (s ? { ...s, phase: event.phase } : s))
          case 'results':
            return setState((s) => (s ? { ...s, shortlist: event.shortlist } : s))
          case 'message':
            setBusy(false)
            return setItems((prev) => [...prev, { kind: 'agent', id: nextId(), text: event.text }])
          case 'step':
            return setItems((prev) => [
              ...prev,
              { kind: 'step', id: nextId(), label: event.label, detail: event.detail },
            ])
          case 'mcpApp':
            setBusy(false)
            return setItems((prev) => [
              ...prev,
              { kind: 'app', id: nextId(), toolName: event.toolName, html: event.html },
            ])
          case 'error':
            setBusy(false)
            return setItems((prev) => [...prev, { kind: 'error', id: nextId(), text: event.message }])
          case 'a2ui':
            // Append-only: the host applies just the new tail.
            return setA2ui((prev) => [...prev, ...event.messages])
          case 'idle':
            return setBusy(false)
        }
      }
    })()

    return () => {
      cancelled = true
      source?.close()
    }
  }, [])

  const send = useCallback((text: string) => {
    const id = sessionRef.current
    if (!id) return
    setItems((prev) => [...prev, { kind: 'user', id: nextId(), text }])
    setBusy(true)
    void fetch(`/api/session/${id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  }, [])

  /**
   * Forwards a tool call that originated inside an MCP App iframe. It goes to
   * the API rather than the MCP server so every tool call stays on one path and
   * the driver can react to what the widget did.
   */
  const callTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    const id = sessionRef.current
    if (!id) throw new Error('no session')
    const res = await fetch(`/api/session/${id}/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    })
    const body = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(body.error ?? 'tool call failed')
    setBusy(true)
    return body
  }, [])

  return { sessionId, state, items, a2ui, busy, connected, send, callTool }
}
