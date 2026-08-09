import {
  type Attributes,
  type Span,
  SpanStatusCode,
  context as otelContext,
  trace as otelTrace,
} from '@opentelemetry/api'
import * as sc from './semconv.js'
import { tracer, tracingEnabled } from './sdk.js'

/**
 * Manual spans for the parts of the journey no model touches.
 *
 * The Agents SDK bridge only sees work the model drove, and by design most of
 * this product's journey is not that: `agent-driver.ts` routes every chip,
 * slider, date picker, spec confirmation, car tap and MCP App submission
 * straight into `journey.ts`, because those arrive already constrained by the
 * question plan. That decision is right — but it means a user who taps their way
 * through the whole interview would produce an empty trace, and "the agent did
 * nothing" is precisely the wrong conclusion to hand someone debugging it.
 *
 * So the deterministic path is instrumented by hand. The spans it produces are
 * the same shape as the model-driven ones, which is what makes a tapped journey
 * and a typed journey comparable in the same trace list.
 */

interface SpanOpts {
  kind?: sc.Kind
  observation?: string
  attributes?: Attributes
  /** Recorded as `input.value`. Stringified if not already a string. */
  input?: unknown
}

const stringify = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)

/**
 * Runs `fn` inside a span.
 *
 * Returns whatever `fn` returns, and rethrows what it throws after marking the
 * span — instrumentation that changes control flow is worse than none.
 */
export async function withSpan<T>(
  name: string,
  opts: SpanOpts,
  fn: (span: Span | undefined) => Promise<T>,
): Promise<T> {
  if (!tracingEnabled()) return fn(undefined)

  const span = tracer().startSpan(name, {
    attributes: {
      [sc.SPAN_KIND]: opts.kind ?? sc.Kind.Chain,
      [sc.LANGFUSE_OBSERVATION_TYPE]: opts.observation ?? 'span',
      ...(opts.input !== undefined
        ? { [sc.INPUT_VALUE]: stringify(opts.input), [sc.INPUT_MIME]: sc.MIME_JSON }
        : {}),
      ...opts.attributes,
    },
  })

  // `with` rather than `startActiveSpan` so the SDK bridge, which reads
  // `context.active()` at `onTraceStart`, nests underneath this.
  const ctx = otelTrace.setSpan(otelContext.active(), span)
  try {
    const result = await otelContext.with(ctx, () => fn(span))
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (err) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    })
    if (err instanceof Error) span.recordException(err)
    throw err
  } finally {
    span.end()
  }
}

/**
 * Opens the root span for one turn.
 *
 * One trace per turn, grouped by `session.id` — not one trace per session. A
 * session lives as long as the browser tab, so tracing it as a unit would give
 * one span that never closes and no way to compare turns against each other.
 */
export async function withTurn<T>(
  args: { sessionId: string; trigger: string; label: string; driver: string; phase: string },
  fn: (span: Span | undefined) => Promise<T>,
): Promise<T> {
  return withSpan(
    args.label,
    {
      kind: sc.Kind.Chain,
      attributes: {
        [sc.SESSION_ID]: args.sessionId,
        [sc.CAR_DRIVER]: args.driver,
        [sc.CAR_PHASE]: args.phase,
        [sc.TAGS]: ['turn', args.trigger],
        'turn.trigger': args.trigger,
      },
    },
    fn,
  )
}

/** Annotates the span currently in context. No-op when nothing is active. */
export function annotate(attributes: Attributes): void {
  if (!tracingEnabled()) return
  otelTrace.getActiveSpan()?.setAttributes(attributes)
}

/** Records `output.value` on the active span. */
export function setOutput(value: unknown, mime = sc.MIME_JSON): void {
  if (!tracingEnabled()) return
  const span = otelTrace.getActiveSpan()
  if (!span) return
  span.setAttribute(sc.OUTPUT_VALUE, stringify(value))
  span.setAttribute(sc.OUTPUT_MIME, mime)
}

/**
 * Mirrors a `ctx.step()` reasoning chip onto the trace as a span event.
 *
 * These already exist as the user-visible explanation of what the agent just
 * did, which makes them the closest thing the deterministic path has to a
 * narrated reasoning trace. An event rather than a span: a step is a moment,
 * not an interval, and eleven extra one-millisecond spans per journey would bury
 * the ones that have duration worth looking at.
 */
export function recordStep(label: string, detail?: string): void {
  if (!tracingEnabled()) return
  otelTrace.getActiveSpan()?.addEvent('step', {
    [sc.CAR_STEP_LABEL]: label,
    ...(detail ? { [sc.CAR_STEP_DETAIL]: detail } : {}),
  })
}

export { sc }
