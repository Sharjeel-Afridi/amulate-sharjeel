/**
 * The MCP Apps (SEP-1865) host/guest wire contract.
 *
 * UI resources run in a sandboxed iframe and talk to the host over JSON-RPC 2.0
 * carried on postMessage. We implement both halves ourselves rather than using
 * `@mcp-ui/client`'s `AppRenderer`, which additionally requires a separately
 * hosted sandbox-proxy page — but the method names, protocol version and payload
 * shapes here are the spec's, taken from `@modelcontextprotocol/ext-apps`.
 *
 * Handshake (note the direction — the *guest* opens it):
 *   1. guest → host   `ui/initialize`                  { protocolVersion, appCapabilities }
 *   2. host  → guest  result                           { protocolVersion, hostInfo, hostCapabilities, hostContext }
 *   3. guest → host   `ui/notifications/initialized`
 * Then, in either direction:
 *   guest → host      `tools/call`                     { name, arguments }  → CallToolResult
 *   guest → host      `ui/notifications/size-changed`  { width?, height? }
 *   host  → guest     `ui/notifications/tool-result`   { result }
 */

export const MCP_APP_PROTOCOL_VERSION = '2026-01-26'

export const MCP_APP_METHODS = {
  initialize: 'ui/initialize',
  initialized: 'ui/notifications/initialized',
  sizeChanged: 'ui/notifications/size-changed',
  toolResult: 'ui/notifications/tool-result',
  hostContextChanged: 'ui/notifications/host-context-changed',
  openLink: 'ui/open-link',
  message: 'ui/message',
  callTool: 'tools/call',
} as const

export type McpAppMethod = (typeof MCP_APP_METHODS)[keyof typeof MCP_APP_METHODS]

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

export const isJsonRpcRequest = (m: JsonRpcMessage): m is JsonRpcRequest =>
  'method' in m && 'id' in m

export const isJsonRpcNotification = (m: JsonRpcMessage): m is JsonRpcNotification =>
  'method' in m && !('id' in m)

export const isJsonRpcResponse = (m: JsonRpcMessage): m is JsonRpcResponse =>
  !('method' in m) && 'id' in m

/** What the host tells the guest about itself, so widgets can match the theme. */
export interface McpAppHostContext {
  theme?: 'light' | 'dark'
  displayMode?: 'inline' | 'fullscreen'
  locale?: string
  /** CSS custom properties the guest may mirror. */
  styles?: Record<string, string>
}

export interface McpAppInitializeParams {
  protocolVersion: string
  appCapabilities: Record<string, unknown>
}

export interface McpAppInitializeResult {
  protocolVersion: string
  hostInfo: { name: string; version: string }
  hostCapabilities: Record<string, unknown>
  hostContext: McpAppHostContext
}

/** JSON-RPC error codes we actually emit. */
export const RPC_ERRORS = {
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const
