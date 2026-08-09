import { type Span, type Tracer, trace } from '@opentelemetry/api'
import { resourceFromAttributes } from '@opentelemetry/resources'
/*
 * Protobuf, not JSON.
 *
 * `exporter-trace-otlp-http` posts `application/json`, which Phoenix rejects
 * outright with a 415 ("Unsupported content type") — protobuf is OTLP's default
 * wire format and the only one collectors are obliged to accept. This was missed
 * at first because the JSON exporter works perfectly against a hand-written
 * receiver that parses JSON; only a real backend surfaces it.
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

/**
 * OpenTelemetry bootstrap.
 *
 * Tracing is off unless it is configured, and off means genuinely off: no
 * provider registered, no exporter, no background flush loop. That is not
 * defensiveness for its own sake — the demo fallback story in `driver.ts` exists
 * because a live presentation cannot afford a dependency on a remote service,
 * and observability must not quietly reintroduce one. An unset key degrades to
 * the behaviour the app had before this module existed.
 *
 * Both supported backends speak OTLP/HTTP, so they differ only in a URL and an
 * auth header. That is the whole reason for emitting OpenInference attributes
 * (see `semconv.ts`) rather than either vendor's SDK: switching backends is a
 * config change, and neither one is load-bearing.
 */

export type Backend = 'langfuse' | 'phoenix' | 'otlp' | 'none'

export interface OtelConfig {
  backend: Backend
  endpoint: string
  headers: Record<string, string>
  serviceName: string
}

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'car-matchmaker-api'

/**
 * Reads the switch.
 *
 * `OTEL_BACKEND` is deliberately explicit rather than inferred from whichever
 * keys happen to be present. Inferring means a stale `LANGFUSE_*` pair left in
 * a `.env` silently wins over the Phoenix container someone just started, and
 * the resulting "why are there no traces" is a slow thing to debug.
 */
export function readOtelConfig(): OtelConfig {
  const backend = (process.env.OTEL_BACKEND ?? 'none').trim().toLowerCase() as Backend

  if (backend === 'langfuse') {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim()
    const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim()
    const host = (process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com').replace(/\/$/, '')
    if (!publicKey || !secretKey) {
      throw new Error('OTEL_BACKEND=langfuse needs LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY')
    }
    return {
      backend,
      // Langfuse ingests OTLP on its own path rather than at the root.
      endpoint: `${host}/api/public/otel/v1/traces`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
      },
      serviceName: SERVICE_NAME,
    }
  }

  if (backend === 'phoenix') {
    const host = (process.env.PHOENIX_COLLECTOR_ENDPOINT ?? 'http://localhost:6006').replace(/\/$/, '')
    const apiKey = process.env.PHOENIX_API_KEY?.trim()
    return {
      backend,
      endpoint: `${host}/v1/traces`,
      // Self-hosted Phoenix needs no auth; Phoenix Cloud does.
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      serviceName: SERVICE_NAME,
    }
  }

  if (backend === 'otlp') {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
    if (!endpoint) throw new Error('OTEL_BACKEND=otlp needs OTEL_EXPORTER_OTLP_TRACES_ENDPOINT')
    return { backend, endpoint, headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS), serviceName: SERVICE_NAME }
  }

  return { backend: 'none', endpoint: '', headers: {}, serviceName: SERVICE_NAME }
}

/** `key=value,key2=value2`, the format the OTel spec defines for this variable. */
function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {}
  const out: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return out
}

let provider: NodeTracerProvider | undefined
let active = false

/** Whether spans are going anywhere. Callers use this to skip building payloads. */
export const tracingEnabled = (): boolean => active

/**
 * Starts tracing. Safe to call more than once; only the first call does work.
 *
 * Returns whether tracing came up, so `main.ts` can say so on boot — a silent
 * no-op here is indistinguishable from a broken exporter, and the one thing
 * worse than no traces is believing you have them.
 */
export function startTracing(): boolean {
  if (provider) return active

  const cfg = readOtelConfig()
  if (cfg.backend === 'none') {
    console.log('[otel] tracing disabled (set OTEL_BACKEND=langfuse|phoenix|otlp to enable)')
    return false
  }

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: cfg.serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0',
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    }),
    // Batched rather than simple: a turn produces a dozen or more spans and the
    // user is waiting on that turn. Export must not sit in the request path.
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: cfg.endpoint, headers: cfg.headers }),
        // Well under the 5s default: a hackathon demo loop involves watching the
        // trace appear, and five seconds of nothing reads as a broken exporter.
        { scheduledDelayMillis: 1_000 },
      ),
    ],
  })

  provider.register()
  active = true
  console.log(`[otel] tracing → ${cfg.backend} at ${cfg.endpoint}`)

  installFlushHooks()
  return true
}

/** The one tracer everything in the API uses. */
export const tracer = (): Tracer => trace.getTracer('car-matchmaker', '0.1.0')

/**
 * Pushes anything buffered.
 *
 * Load-bearing in two places. `tsx watch` restarts the process on every file
 * change, and the eval runner is a short script that would otherwise exit inside
 * the 1s batch window and report a clean run having sent nothing.
 */
export async function flushTracing(): Promise<void> {
  if (!provider) return
  try {
    await provider.forceFlush()
  } catch (err) {
    // A failed flush must not become the error the caller reports. Whatever they
    // were doing succeeded; only the telemetry about it was lost.
    console.warn('[otel] flush failed:', err instanceof Error ? err.message : err)
  }
}

export async function shutdownTracing(): Promise<void> {
  if (!provider) return
  try {
    await provider.shutdown()
  } catch (err) {
    console.warn('[otel] shutdown failed:', err instanceof Error ? err.message : err)
  }
  provider = undefined
  active = false
}

let hooksInstalled = false

function installFlushHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true

  // `once`, and the listener re-raises: swallowing the signal would leave the
  // dev server unkillable, which is a far worse bug than a dropped span.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdownTracing().finally(() => {
        process.removeAllListeners(signal)
        process.kill(process.pid, signal)
      })
    })
  }

  process.once('beforeExit', () => {
    void flushTracing()
  })
}

export type { Span }
