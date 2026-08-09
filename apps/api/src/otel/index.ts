/**
 * Observability. Import from here, not from the files beneath.
 *
 * Everything is a no-op until `OTEL_BACKEND` is set, so call sites do not need
 * to guard — see `sdk.ts` for why that matters to the demo.
 */
export { OtelTracingProcessor } from './agents-bridge.js'
export {
  type Backend,
  type OtelConfig,
  flushTracing,
  readOtelConfig,
  shutdownTracing,
  startTracing,
  tracer,
  tracingEnabled,
} from './sdk.js'
export { annotate, recordStep, setOutput, withSpan, withTurn } from './trace.js'
export * as semconv from './semconv.js'
export { Kind } from './semconv.js'
