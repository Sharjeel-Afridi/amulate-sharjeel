import {
  type Context,
  type Span as OtelSpan,
  SpanKind as OtelSpanKind,
  SpanStatusCode,
  context as otelContext,
  trace as otelTrace,
} from '@opentelemetry/api'
import type {
  GenerationSpanData,
  Span as SdkSpan,
  SpanData,
  Trace as SdkTrace,
  TracingProcessor,
} from '@openai/agents'
import * as sc from './semconv.js'
import { tracer } from './sdk.js'

/**
 * Bridges the Agents SDK's tracing into OpenTelemetry.
 *
 * This exists because the equivalent does not. Every Langfuse and Phoenix guide
 * for the Agents SDK instruments the *Python* package via OpenInference; the JS
 * OpenInference packages cover the bare OpenAI client, Vercel AI SDK and
 * TanStack AI, and nothing covers `@openai/agents`. Wrapping the OpenAI client
 * instead would capture the model calls but flatten the structure — tool calls
 * would appear as message history rather than as spans — and the structure is
 * the thing worth seeing in a multistep agent.
 *
 * The SDK already emits the right shapes (`agent`, `function`, `generation`,
 * `handoff`, `mcp_tools`); `setTracingDisabled(true)` in `agent-driver.ts` only
 * ever silenced them because the default exporter uploads to OpenAI. So this is
 * a translation layer, not instrumentation: register it as a processor and the
 * spans that were always being produced go somewhere useful.
 *
 * Two subtleties drive the implementation.
 *
 * 1. Span payloads are mutated in place as work completes — a `function` span
 *    has its `output` only once the tool returns. So attributes are written at
 *    `onSpanEnd`, and `onSpanStart` does nothing but open the OTel span and fix
 *    its place in the tree.
 * 2. SDK ids are not OTel ids (`span_<24hex>` against 8 raw bytes). Rather than
 *    coerce them and risk emitting invalid ids, OTel generates its own and the
 *    SDK's are recorded as attributes for cross-referencing.
 */

/** Attribute values above this are truncated. Prompts here run to a few KB. */
const MAX_ATTR_CHARS = 24_000

const truncate = (s: string): string =>
  s.length <= MAX_ATTR_CHARS ? s : `${s.slice(0, MAX_ATTR_CHARS)}…[truncated ${s.length - MAX_ATTR_CHARS} chars]`

/** Stringifies whatever a span payload holds, without throwing on a cycle. */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return truncate(value)
  try {
    return truncate(JSON.stringify(value))
  } catch {
    return truncate(String(value))
  }
}

/** ISO string → epoch millis, for handing the SDK's own timings to OTel. */
function at(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : undefined
}

/**
 * A chat message's content, flattened to text.
 *
 * Providers return either a plain string or an array of content parts, and a
 * span showing `[object Object]` where the prompt should be is worse than one
 * showing nothing.
 */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>
          if (typeof p.text === 'string') return p.text
          if (typeof p.content === 'string') return p.content
        }
        return stringify(part)
      })
      .filter(Boolean)
      .join('\n')
  }
  return stringify(content)
}

/**
 * Normalises a generation's `output` into role/content pairs.
 *
 * Two shapes arrive here and only one is a message list. On the chat completions
 * API — which `agent-driver.ts` pins, because it is the only one every
 * OpenAI-compatible provider implements — `output` holds the raw response
 * object, so reading `role` and `content` off it yields an assistant message
 * with empty text. That is worse than useless: it renders in both UIs as a model
 * that replied with nothing.
 *
 * The second correction is tool calls. A turn that decided only to call tools
 * has no content at all, and showing that as an empty completion hides the very
 * thing the span is evidence of. The calls are rendered as text instead.
 */
function outputMessages(output: GenerationSpanData['output']): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = []

  for (const entry of output ?? []) {
    // Raw chat completion: unwrap to the messages inside its choices.
    const choices = (entry as { choices?: unknown }).choices
    const candidates = Array.isArray(choices)
      ? choices.map((c) => (c as { message?: unknown }).message ?? c)
      : [entry]

    for (const candidate of candidates) {
      const m = (candidate ?? {}) as Record<string, unknown>
      const role = typeof m.role === 'string' ? m.role : 'assistant'
      const text = contentToText(m.content)
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : []

      const rendered = calls
        .map((call) => {
          const fn = (call as { function?: { name?: string; arguments?: string } }).function
          return fn?.name ? `${fn.name}(${fn.arguments ?? ''})` : undefined
        })
        .filter(Boolean)

      messages.push({
        role,
        content: text || (rendered.length ? rendered.join('\n') : ''),
      })
    }
  }

  return messages
}

/** How each SDK span type maps onto an OpenInference kind and a display name. */
function classify(data: SpanData): { kind: sc.Kind; name: string; observation: string } {
  switch (data.type) {
    case 'agent':
      return { kind: sc.Kind.Agent, name: data.name, observation: 'agent' }
    case 'function':
      return { kind: sc.Kind.Tool, name: data.name, observation: 'tool' }
    case 'generation':
      return { kind: sc.Kind.Llm, name: data.model ?? 'generation', observation: 'generation' }
    case 'response':
      return { kind: sc.Kind.Llm, name: 'response', observation: 'generation' }
    case 'handoff':
      return {
        kind: sc.Kind.Chain,
        name: `handoff: ${data.from_agent ?? '?'} → ${data.to_agent ?? '?'}`,
        observation: 'span',
      }
    case 'mcp_tools':
      return { kind: sc.Kind.Tool, name: `mcp.list_tools:${data.server ?? 'unknown'}`, observation: 'tool' }
    case 'guardrail':
      return { kind: sc.Kind.Chain, name: `guardrail:${data.name}`, observation: 'span' }
    case 'custom':
      return { kind: sc.Kind.Chain, name: data.name, observation: 'span' }
    case 'task':
      return { kind: sc.Kind.Chain, name: data.name, observation: 'span' }
    case 'turn':
      return { kind: sc.Kind.Chain, name: `turn ${data.turn} · ${data.agent_name}`, observation: 'span' }
    default:
      return { kind: sc.Kind.Chain, name: (data as { type: string }).type, observation: 'span' }
  }
}

/** Writes the per-type payload. Everything here runs at span end. */
function applyPayload(span: OtelSpan, data: SpanData): void {
  switch (data.type) {
    case 'agent': {
      if (data.tools?.length) span.setAttribute('agent.tools', data.tools)
      if (data.handoffs?.length) span.setAttribute('agent.handoffs', data.handoffs)
      if (data.output_type) span.setAttribute('agent.output_type', data.output_type)
      return
    }

    case 'function': {
      span.setAttribute(sc.TOOL_NAME, data.name)
      if (data.input) {
        span.setAttribute(sc.INPUT_VALUE, stringify(data.input))
        span.setAttribute(sc.INPUT_MIME, sc.MIME_JSON)
        span.setAttribute(sc.TOOL_PARAMETERS, stringify(data.input))
      }
      if (data.output) {
        span.setAttribute(sc.OUTPUT_VALUE, stringify(data.output))
        span.setAttribute(sc.OUTPUT_MIME, sc.MIME_TEXT)
      }
      // Present when the tool came from an attached MCP server rather than from
      // `buildTools`. Worth keeping: it is how you tell, in the trace, that the
      // marketplace answered directly instead of the journey code doing it.
      if (data.mcp_data) span.setAttribute('tool.mcp_data', stringify(data.mcp_data))
      return
    }

    case 'generation': {
      applyGeneration(span, data)
      return
    }

    case 'response': {
      if (data.response_id) span.setAttribute('llm.response_id', data.response_id)
      if (data._input) {
        span.setAttribute(sc.INPUT_VALUE, stringify(data._input))
        span.setAttribute(sc.INPUT_MIME, sc.MIME_JSON)
      }
      if (data._response) {
        span.setAttribute(sc.OUTPUT_VALUE, stringify(data._response))
        span.setAttribute(sc.OUTPUT_MIME, sc.MIME_JSON)
      }
      return
    }

    case 'handoff': {
      if (data.from_agent) span.setAttribute('handoff.from', data.from_agent)
      if (data.to_agent) span.setAttribute('handoff.to', data.to_agent)
      return
    }

    case 'mcp_tools': {
      if (data.server) span.setAttribute('mcp.server', data.server)
      if (data.result?.length) {
        span.setAttribute('mcp.tools', data.result)
        span.setAttribute(sc.OUTPUT_VALUE, stringify(data.result))
        span.setAttribute(sc.OUTPUT_MIME, sc.MIME_JSON)
      }
      return
    }

    case 'guardrail': {
      span.setAttribute('guardrail.triggered', data.triggered)
      return
    }

    case 'custom': {
      span.setAttribute(sc.METADATA, stringify(data.data))
      return
    }

    case 'task':
    case 'turn': {
      // `usage` is the only reason these are interesting: it is the SDK's own
      // per-turn token accounting, which is cheaper to trust than summing the
      // generation spans underneath.
      const usage = data.usage
      if (!usage) return
      span.setAttribute(sc.LLM_TOKEN_PROMPT, usage.input_tokens)
      span.setAttribute(sc.LLM_TOKEN_COMPLETION, usage.output_tokens)
      if ('total_tokens' in usage) span.setAttribute(sc.LLM_TOKEN_TOTAL, usage.total_tokens)
      else span.setAttribute(sc.LLM_TOKEN_TOTAL, usage.input_tokens + usage.output_tokens)
      if (usage.cached_input_tokens) {
        span.setAttribute('llm.token_count.prompt_details.cache_read', usage.cached_input_tokens)
      }
      return
    }

    default:
      return
  }
}

function applyGeneration(span: OtelSpan, data: GenerationSpanData): void {
  if (data.model) span.setAttribute(sc.LLM_MODEL, data.model)
  if (data.model_config) {
    span.setAttribute(sc.LLM_INVOCATION_PARAMS, stringify(data.model_config))
    // The Agents SDK stores the provider's base URL here, which is the only
    // place a trace can tell you a "gpt-4o-mini"-shaped call actually went to
    // Groq. Worth lifting out — it is the first thing you check when output
    // quality changes and nothing in the code did.
    const provider = (data.model_config as Record<string, unknown>).base_url
    if (typeof provider === 'string') span.setAttribute(sc.LLM_PROVIDER, provider)
  }

  for (const [i, message] of (data.input ?? []).entries()) {
    const role = typeof message.role === 'string' ? message.role : 'user'
    span.setAttribute(sc.llmInputMessage(i, 'role'), role)
    span.setAttribute(sc.llmInputMessage(i, 'content'), truncate(contentToText(message.content)))
  }
  for (const [i, message] of outputMessages(data.output).entries()) {
    span.setAttribute(sc.llmOutputMessage(i, 'role'), message.role)
    span.setAttribute(sc.llmOutputMessage(i, 'content'), truncate(message.content))
  }

  // Also as input/output values: both UIs fall back to these when they cannot
  // render the message list, and Phoenix's span detail leads with them.
  if (data.input) {
    span.setAttribute(sc.INPUT_VALUE, stringify(data.input))
    span.setAttribute(sc.INPUT_MIME, sc.MIME_JSON)
  }
  if (data.output) {
    span.setAttribute(sc.OUTPUT_VALUE, stringify(data.output))
    span.setAttribute(sc.OUTPUT_MIME, sc.MIME_JSON)
  }

  const usage = data.usage
  if (!usage) return
  const input = Number(usage.input_tokens ?? 0)
  const output = Number(usage.output_tokens ?? 0)
  if (input) span.setAttribute(sc.LLM_TOKEN_PROMPT, input)
  if (output) span.setAttribute(sc.LLM_TOKEN_COMPLETION, output)
  if (input || output) span.setAttribute(sc.LLM_TOKEN_TOTAL, input + output)
}

/**
 * Translates SDK trace/span lifecycles into OTel spans.
 *
 * Registered via `addTraceProcessor`, so it runs alongside (not instead of)
 * anything else listening — including the SDK's own exporter, if a future change
 * ever wants both.
 */
export class OtelTracingProcessor implements TracingProcessor {
  /** SDK trace id → the OTel root span opened for it, and its context. */
  private readonly traces = new Map<string, { span: OtelSpan; ctx: Context }>()
  /** SDK span id → the OTel span opened for it, and its context. */
  private readonly spans = new Map<string, { span: OtelSpan; ctx: Context }>()

  async onTraceStart(sdkTrace: SdkTrace): Promise<void> {
    // Parented to whatever is active, which is how an agent run ends up nested
    // under the turn span that `index.ts` opened rather than floating as its own
    // root. When nothing is active this becomes a root, which is also correct.
    const parent = otelContext.active()
    const span = tracer().startSpan(
      sdkTrace.name || 'agent workflow',
      {
        kind: OtelSpanKind.INTERNAL,
        attributes: {
          [sc.SPAN_KIND]: sc.Kind.Chain,
          [sc.LANGFUSE_OBSERVATION_TYPE]: 'span',
          [sc.AGENTS_TRACE_ID]: sdkTrace.traceId,
          // The SDK's `groupId` is where `withTrace` puts our session id, so
          // this is what stitches a session's per-turn traces together.
          ...(sdkTrace.groupId ? { [sc.SESSION_ID]: sdkTrace.groupId } : {}),
          ...(sdkTrace.metadata ? { [sc.METADATA]: stringify(sdkTrace.metadata) } : {}),
        },
      },
      parent,
    )

    this.traces.set(sdkTrace.traceId, {
      span,
      ctx: otelTrace.setSpan(parent, span),
    })
  }

  async onTraceEnd(sdkTrace: SdkTrace): Promise<void> {
    const entry = this.traces.get(sdkTrace.traceId)
    if (!entry) return
    entry.span.end()
    this.traces.delete(sdkTrace.traceId)

    // Anything still open belonged to this trace and will never be ended by the
    // SDK — a crash mid-run, typically. Close them so they are not lost, and so
    // the maps cannot grow across a long-lived server process.
    for (const [id, open] of this.spans) {
      if (open.span.spanContext().traceId !== entry.span.spanContext().traceId) continue
      open.span.setStatus({ code: SpanStatusCode.ERROR, message: 'span never ended' })
      open.span.end()
      this.spans.delete(id)
    }
  }

  async onSpanStart(sdkSpan: SdkSpan<SpanData>): Promise<void> {
    const { kind, name, observation } = classify(sdkSpan.spanData)

    // Prefer the explicit parent, fall back to the trace root. A span whose
    // parent we never saw is attached to the root rather than dropped —
    // an orphan in the tree is still evidence; a missing span is not.
    const parentCtx =
      (sdkSpan.parentId ? this.spans.get(sdkSpan.parentId)?.ctx : undefined) ??
      this.traces.get(sdkSpan.traceId)?.ctx ??
      otelContext.active()

    const span = tracer().startSpan(
      name,
      {
        kind: OtelSpanKind.INTERNAL,
        // The SDK's own timings, not the callback's, so durations survive any
        // lag between the work finishing and this processor being told.
        startTime: at(sdkSpan.startedAt),
        attributes: {
          [sc.SPAN_KIND]: kind,
          [sc.LANGFUSE_OBSERVATION_TYPE]: observation,
          [sc.AGENTS_TRACE_ID]: sdkSpan.traceId,
          [sc.AGENTS_SPAN_ID]: sdkSpan.spanId,
        },
      },
      parentCtx,
    )

    this.spans.set(sdkSpan.spanId, { span, ctx: otelTrace.setSpan(parentCtx, span) })
  }

  async onSpanEnd(sdkSpan: SdkSpan<SpanData>): Promise<void> {
    const entry = this.spans.get(sdkSpan.spanId)
    if (!entry) return
    this.spans.delete(sdkSpan.spanId)

    const { span } = entry
    try {
      applyPayload(span, sdkSpan.spanData)
    } catch (err) {
      // Never let a mapping bug take down a turn. A span missing its attributes
      // is a reporting problem; an exception thrown from a tracing callback is
      // an outage.
      span.setAttribute('otel.bridge.error', err instanceof Error ? err.message : String(err))
    }

    const error = sdkSpan.error
    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      span.recordException(new Error(error.message))
      if (error.data) span.setAttribute('error.data', stringify(error.data))
    } else {
      span.setStatus({ code: SpanStatusCode.OK })
    }

    span.end(at(sdkSpan.endedAt))
  }

  async shutdown(): Promise<void> {
    // The OTel provider owns exporting; there is nothing of ours to tear down
    // beyond closing whatever is still open.
    for (const [, open] of this.spans) open.span.end()
    this.spans.clear()
    for (const [, open] of this.traces) open.span.end()
    this.traces.clear()
  }

  async forceFlush(): Promise<void> {
    // Likewise a no-op: `flushTracing()` in `sdk.ts` drives the exporter.
  }
}
