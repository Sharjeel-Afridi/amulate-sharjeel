import type { A2uiMessage } from '@a2ui/web_core/v0_9'
import type { DriverMode, Phase, RankedListing, SessionState } from '@car/shared'
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
  | { type: 'message'; text: string; tag?: string }
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
  | { kind: 'agent'; id: string; text: string; tag?: string }
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
  /** Whether the server has a model-backed driver at all. */
  const [agent, setAgent] = useState<{ available: boolean; name: string | null }>({
    available: false,
    name: null,
  })
  const sessionRef = useRef<string | undefined>(undefined)

  // Create a session once, then hold the stream open for its lifetime.
  useEffect(() => {
    let cancelled = false
    let source: EventSource | undefined

    void (async () => {
      const res = await fetch('/api/session', { method: 'POST' })
      const body = (await res.json()) as {
        sessionId: string
        state: SessionState
        agentAvailable?: boolean
        agentName?: string | null
      }
      if (cancelled) return

      sessionRef.current = body.sessionId
      setSessionId(body.sessionId)
      setState(body.state)
      setAgent({ available: Boolean(body.agentAvailable), name: body.agentName ?? null })

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
            // A tag the transcript already holds is a rewind, not a repeat:
            // going back through the interview re-asks an earlier question,
            // and everything from its first asking onwards — the old ask, the
            // answer, the questions after it — is the branch being abandoned.
            return setItems((prev) => {
              const item: ChatItem = { kind: 'agent', id: nextId(), text: event.text, tag: event.tag }
              if (event.tag) {
                for (let i = prev.length - 1; i >= 0; i--) {
                  const it = prev[i]
                  if (it?.kind === 'agent' && it.tag === event.tag) {
                    return [...prev.slice(0, i), item]
                  }
                }
              }
              return [...prev, item]
            })
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

  /** Forwards an action fired by an A2UI control — the interview's tap answers. */
  const sendAction = useCallback((name: string, context: Record<string, unknown>) => {
    const id = sessionRef.current
    if (!id) return
    setBusy(true)
    void fetch(`/api/session/${id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, context }),
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
    // Busy goes up before the request, not after it resolves. The API answers
    // the widget first and only then runs the driver, so the `idle` that closes
    // this turn could arrive while we were still awaiting the response — and a
    // busy flag raised after its own reset never comes down again. That is the
    // whole of the "thinking…" that used to stay on screen forever.
    setBusy(true)
    try {
      const res = await fetch(`/api/session/${id}/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'tool call failed')
      return body
    } catch (err) {
      setBusy(false)
      throw err
    }
  }, [])

  /**
   * Switch the driver mid-session.
   *
   * Optimistic, then reconciled: the toggle has to feel instant, and the server
   * broadcasts the authoritative state right after. A rejection (asking for the
   * agent with no key configured) surfaces in the transcript rather than
   * silently leaving the switch in the wrong position.
   */
  const setMode = useCallback(async (mode: DriverMode) => {
    const id = sessionRef.current
    if (!id) return
    setState((s) => (s ? { ...s, mode } : s))
    const res = await fetch(`/api/session/${id}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setState((s) => (s ? { ...s, mode: mode === 'agent' ? 'scripted' : 'agent' } : s))
      setItems((prev) => [
        ...prev,
        { kind: 'error', id: nextId(), text: body.error ?? 'Could not switch mode.' },
      ])
    }
  }, [])

  return { sessionId, state, items, a2ui, busy, connected, agent, send, sendAction, callTool, setMode }
}
