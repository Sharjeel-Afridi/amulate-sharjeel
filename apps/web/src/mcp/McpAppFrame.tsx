import {
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  MCP_APP_METHODS,
  MCP_APP_PROTOCOL_VERSION,
  type McpAppHostContext,
  type McpAppInitializeResult,
  RPC_ERRORS,
  isJsonRpcNotification,
  isJsonRpcRequest,
} from '@car/shared'
import { useEffect, useRef, useState } from 'react'

/**
 * The host half of the MCP Apps (SEP-1865) bridge.
 *
 * A widget arrives from the MCP server as a complete HTML document. We drop it
 * into a sandboxed iframe and answer the JSON-RPC 2.0 traffic it sends over
 * postMessage — see `packages/shared/src/mcp-app-protocol.ts` for the contract
 * and `apps/mcp-marketplace/src/theme.ts` (`BRIDGE_JS`) for the guest we talk to.
 *
 * The guest opens the handshake, so ordering matters: the window listener has to
 * be installed before the document can parse. That is why `srcdoc` is assigned
 * imperatively inside the effect rather than passed as a JSX attribute.
 */

const HOST_INFO = { name: 'car-matchmaker-web', version: '0.1.0' } as const

/**
 * Presence of a key means "supported", as in MCP proper. We answer `tools/call`
 * and we push host-context updates, and that is the whole of it.
 */
const HOST_CAPABILITIES: Record<string, unknown> = {
  tools: {},
  ui: { hostContext: {} },
}

export type McpAppCallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>

export interface McpAppFrameProps {
  /** A complete HTML document, as returned in the tool result's ui:// resource. */
  html: string
  /** Forwards a guest `tools/call` to the API. Resolve with a CallToolResult. */
  onCallTool: McpAppCallTool
  /** Theme and locale handed to the guest at initialize, and on later changes. */
  hostContext?: McpAppHostContext
  onError?: (error: Error) => void
  /** Every frame in and out, for logging or a protocol inspector. */
  onProtocolMessage?: (direction: 'in' | 'out', message: JsonRpcMessage) => void
  /** Height before the guest has reported one. */
  minHeight?: number
  title?: string
}

interface CallToolParams {
  name: string
  arguments: Record<string, unknown>
}

/** Anything that is not a well-formed JSON-RPC 2.0 frame is not ours to answer. */
function asJsonRpcMessage(data: unknown): JsonRpcMessage | null {
  if (typeof data !== 'object' || data === null) return null
  const m = data as { jsonrpc?: unknown; method?: unknown; id?: unknown }
  if (m.jsonrpc !== '2.0') return null
  const hasMethod = typeof m.method === 'string'
  const hasId = typeof m.id === 'string' || typeof m.id === 'number'
  if (!hasMethod && !hasId) return null
  return data as JsonRpcMessage
}

function asCallToolParams(params: unknown): CallToolParams | null {
  if (typeof params !== 'object' || params === null) return null
  const p = params as { name?: unknown; arguments?: unknown }
  if (typeof p.name !== 'string' || p.name.length === 0) return null
  const args = p.arguments
  if (args === undefined || args === null) return { name: p.name, arguments: {} }
  if (typeof args !== 'object' || Array.isArray(args)) return null
  return { name: p.name, arguments: args as Record<string, unknown> }
}

function reportedHeight(params: unknown): number | null {
  if (typeof params !== 'object' || params === null) return null
  const h = (params as { height?: unknown }).height
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0) return null
  // A runaway widget should not be able to push a multi-screen iframe into chat.
  return Math.min(Math.ceil(h), 4000)
}

export function McpAppFrame({
  html,
  onCallTool,
  hostContext,
  onError,
  onProtocolMessage,
  minHeight = 160,
  title = 'MCP App',
}: McpAppFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(minHeight)

  // Props are read through a ref so a parent re-render with fresh inline
  // callbacks cannot tear down the listener and reload the iframe mid-handshake.
  // Only `html` may do that.
  const latest = useRef({ onCallTool, hostContext, onError, onProtocolMessage, minHeight })
  latest.current = { onCallTool, hostContext, onError, onProtocolMessage, minHeight }

  const initializedRef = useRef(false)
  const contextKey = JSON.stringify(hostContext ?? {})

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    let disposed = false
    initializedRef.current = false
    setHeight(latest.current.minHeight)

    const send = (message: JsonRpcMessage): void => {
      if (disposed) return
      // targetOrigin has to be '*'. `srcdoc` plus `allow-scripts` (and no
      // `allow-same-origin`) gives the guest an opaque origin, which serialises
      // as the string "null" and is not a value postMessage accepts as a target.
      // The exposure is bounded: we address one window we created ourselves, and
      // only ever send it answers to questions it asked.
      frame.contentWindow?.postMessage(message, '*')
      latest.current.onProtocolMessage?.('out', message)
    }

    const respond = (id: JsonRpcRequest['id'], result: unknown): void =>
      send({ jsonrpc: '2.0', id, result })

    const fail = (id: JsonRpcRequest['id'], code: number, message: string): void =>
      send({ jsonrpc: '2.0', id, error: { code, message } })

    const handleRequest = (request: JsonRpcRequest): void => {
      switch (request.method) {
        case MCP_APP_METHODS.initialize: {
          const params = request.params as { protocolVersion?: unknown } | undefined
          const guestVersion = params?.protocolVersion
          if (typeof guestVersion === 'string' && guestVersion !== MCP_APP_PROTOCOL_VERSION) {
            // Not fatal: we still answer with our version and let the guest
            // decide, rather than leaving a blank iframe in the conversation.
            console.warn(
              `[mcp-app] guest speaks ${guestVersion}, host speaks ${MCP_APP_PROTOCOL_VERSION}`,
            )
          }
          const result: McpAppInitializeResult = {
            protocolVersion: MCP_APP_PROTOCOL_VERSION,
            hostInfo: { ...HOST_INFO },
            hostCapabilities: HOST_CAPABILITIES,
            hostContext: latest.current.hostContext ?? {},
          }
          respond(request.id, result)
          return
        }

        case MCP_APP_METHODS.callTool: {
          const params = asCallToolParams(request.params)
          if (!params) {
            fail(request.id, RPC_ERRORS.invalidParams, 'tools/call needs a name and object arguments')
            return
          }
          latest.current
            .onCallTool(params.name, params.arguments)
            .then((result) => respond(request.id, result))
            .catch((cause: unknown) => {
              const error = cause instanceof Error ? cause : new Error(String(cause))
              latest.current.onError?.(error)
              fail(request.id, RPC_ERRORS.internalError, error.message)
            })
          return
        }

        default:
          fail(request.id, RPC_ERRORS.methodNotFound, `Unsupported method ${request.method}`)
      }
    }

    const handleNotification = (note: JsonRpcNotification): void => {
      switch (note.method) {
        case MCP_APP_METHODS.initialized:
          initializedRef.current = true
          return

        case MCP_APP_METHODS.sizeChanged: {
          const next = reportedHeight(note.params)
          if (next !== null) setHeight(next)
          return
        }

        default:
          // Notifications carry no reply, so an unknown one is simply dropped.
          return
      }
    }

    const onMessage = (event: MessageEvent): void => {
      // `event.origin` is the string "null" for every message from this iframe:
      // an opaque origin has no origin to compare against. Window identity is
      // the check that actually distinguishes our guest from every other frame
      // and extension on the page, so that is what we verify.
      if (event.source !== frame.contentWindow) return

      const message = asJsonRpcMessage(event.data)
      if (!message) return
      latest.current.onProtocolMessage?.('in', message)

      if (isJsonRpcRequest(message)) handleRequest(message)
      else if (isJsonRpcNotification(message)) handleNotification(message)
      // Responses are ignored: the host sends the guest notifications only, so
      // there is never an outstanding request for one to answer.
    }

    window.addEventListener('message', onMessage)
    // Only now is it safe to let the document run: the guest opens the
    // handshake, and a request sent before this listener exists is lost.
    frame.srcdoc = html

    return () => {
      disposed = true
      window.removeEventListener('message', onMessage)
    }
  }, [html])

  // A theme switch after the handshake still has to reach the guest, which
  // mirrors these tokens into its own :root. Keyed on the serialised context so
  // an inline object literal does not re-notify on every render.
  useEffect(() => {
    if (!initializedRef.current) return
    const frame = frameRef.current
    if (!frame) return
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: MCP_APP_METHODS.hostContextChanged,
      params: { hostContext: latest.current.hostContext ?? {} },
    }
    frame.contentWindow?.postMessage(message, '*')
    latest.current.onProtocolMessage?.('out', message)
  }, [contextKey])

  return (
    <iframe
      ref={frameRef}
      title={title}
      // No `allow-same-origin`: paired with `allow-scripts` it would hand the
      // widget our origin, and with it our storage, cookies and DOM. The guest
      // needs neither, so it stays in an opaque origin.
      sandbox="allow-scripts"
      scrolling="no"
      style={{
        display: 'block',
        width: '100%',
        height,
        border: 0,
        background: 'transparent',
        // Height is applied outright, with no transition. An animated height
        // lags the guest's own layout, and in a backgrounded tab the animation
        // never advances at all, leaving the widget stuck at its opening size.
      }}
    />
  )
}
