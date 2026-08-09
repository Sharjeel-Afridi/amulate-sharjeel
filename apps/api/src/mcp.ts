import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SpanStatusCode } from '@opentelemetry/api'
import { Kind, semconv, setOutput, withSpan } from './otel/index.js'

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

/**
 * Lazily connect, collapsing concurrent first-callers onto one attempt.
 *
 * The in-flight promise is cleared in `finally`, not on success — caching a
 * rejected promise would mean one failed attempt (the marketplace still booting,
 * say) permanently poisons every later call with no way to recover.
 */
export async function mcp(): Promise<Client> {
  if (client) return client
  connecting ??= connect()
    .then((c) => {
      client = c
      return c
    })
    .finally(() => {
      connecting = undefined
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

/**
 * Every marketplace tool call, traced.
 *
 * This is the only path to the marketplace, including for calls that originate
 * in an MCP App iframe — so one span here covers the tool traffic the model
 * never chose, which the Agents SDK bridge cannot see by definition. Without it
 * a booking made by tapping through the UI shows as a gap in the trace.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  return withSpan(
    `mcp.${name}`,
    {
      kind: Kind.Tool,
      observation: 'tool',
      input: args,
      attributes: { [semconv.TOOL_NAME]: name, 'mcp.server': MCP_URL },
    },
    async (span) => {
      const c = await mcp()
      const result = (await c.callTool({ name, arguments: args })) as {
        content?: ToolContent[]
        isError?: boolean
      }
      const outcome = { content: result.content ?? [], isError: Boolean(result.isError) }

      // A tool that reports failure in its payload rather than by throwing would
      // otherwise show as a green span, which is the most misleading thing a
      // trace can do.
      span?.setAttribute('mcp.is_error', outcome.isError)
      setOutput(outcome.content)
      if (outcome.isError) {
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: outcome.content.find((c) => c.type === 'text')?.text ?? `tool ${name} failed`,
        })
      }
      return outcome
    },
  )
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
