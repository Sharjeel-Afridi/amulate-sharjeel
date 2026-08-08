import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/**
 * The API is the only MCP client in the system.
 *
 * The browser never talks to the marketplace directly — tool calls originating
 * in an MCP App iframe are proxied through here too. That keeps every tool call
 * on one auditable path and means the agent can see what the widgets did.
 */

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:8081/mcp'

let client: Client | undefined
let connecting: Promise<Client> | undefined

async function connect(): Promise<Client> {
  const c = new Client({ name: 'car-matchmaker-api', version: '0.1.0' })
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)))
  return c
}

/** Lazily connect, and collapse concurrent first-callers onto one connection. */
export async function mcp(): Promise<Client> {
  if (client) return client
  connecting ??= connect().then((c) => {
    client = c
    connecting = undefined
    return c
  })
  return connecting
}

export interface ToolContent {
  type: string
  text?: string
  resource?: { uri?: string; mimeType?: string; text?: string }
}

export interface ToolCallOutcome {
  content: ToolContent[]
  isError: boolean
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  const c = await mcp()
  const result = (await c.callTool({ name, arguments: args })) as {
    content?: ToolContent[]
    isError?: boolean
  }
  return { content: result.content ?? [], isError: Boolean(result.isError) }
}

/** Most marketplace tools answer with a single JSON text block. */
export async function callToolJson<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { content, isError } = await callTool(name, args)
  const text = content.find((c) => c.type === 'text')?.text
  if (!text) throw new Error(`Tool ${name} returned no text content`)
  const parsed = JSON.parse(text) as T & { error?: string }
  if (isError || parsed.error) throw new Error(parsed.error ?? `Tool ${name} failed`)
  return parsed
}

/** The MCP App tools answer with a `ui://` resource carrying the widget HTML. */
export async function callToolForApp(
  name: string,
  args: Record<string, unknown>,
): Promise<{ html: string; uri: string }> {
  const { content } = await callTool(name, args)
  const resource = content.find((c) => c.type === 'resource')?.resource
  if (!resource?.text) {
    // Tool errors come back as a text block rather than a resource, so surface
    // that message instead of a generic "no UI resource" which hides the cause.
    const text = content.find((c) => c.type === 'text')?.text
    throw new Error(text ? JSON.parse(text).error ?? text : `Tool ${name} returned no UI resource`)
  }
  return { html: resource.text, uri: resource.uri ?? '' }
}

export async function health(): Promise<{ connected: boolean; tools: string[] }> {
  try {
    const c = await mcp()
    const { tools } = await c.listTools()
    return { connected: true, tools: tools.map((t) => t.name) }
  } catch {
    return { connected: false, tools: [] }
  }
}
