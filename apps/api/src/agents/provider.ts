import { setTraceProcessors, setTracingDisabled } from '@openai/agents'
import { setDefaultOpenAIClient, setOpenAIAPI } from '@openai/agents-openai'
import OpenAI from 'openai'
import { OtelTracingProcessor, tracingEnabled } from '../otel/index.js'

/**
 * Which model provider the agents talk to.
 *
 * Provider-agnostic on purpose: the OpenAI Agents SDK talks to anything exposing
 * an OpenAI-compatible endpoint, so the Gemini and Groq free tiers work by
 * changing a base URL.
 */

const BASE_URLS: Record<string, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
}

/**
 * Free-tier friendly defaults.
 *
 * `gemini-2.5-flash` allows only 5 requests a minute on the free tier, and a
 * single agent turn makes several model calls while it works through tools — so
 * it 429s immediately. The SDK retries those internally, which presents as the
 * turn hanging rather than as an error. `flash-lite` has a far higher allowance
 * and is entirely adequate for this workload.
 */
const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash-lite',
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
}

export interface AgentConfig {
  provider: string
  apiKey: string
  model: string
}

/** Reads the switch. Returns undefined when no key is configured. */
export function readAgentConfig(): AgentConfig | undefined {
  const apiKey = process.env.AGENT_API_KEY?.trim()
  if (!apiKey) return undefined

  const provider = (process.env.AGENT_PROVIDER ?? 'gemini').trim().toLowerCase()
  const model = process.env.AGENT_MODEL?.trim() || DEFAULT_MODELS[provider] || 'gpt-4o-mini'
  return { provider, apiKey, model }
}

let configured = false

/** Points the Agents SDK at the configured provider. Idempotent; called at boot. */
export function configureProvider(cfg: AgentConfig): void {
  if (configured) return
  const baseURL = BASE_URLS[cfg.provider] ?? process.env.AGENT_BASE_URL
  if (!baseURL) throw new Error(`Unknown AGENT_PROVIDER "${cfg.provider}" and no AGENT_BASE_URL set`)

  setDefaultOpenAIClient(new OpenAI({ apiKey: cfg.apiKey, baseURL }))
  // Only OpenAI implements the Responses API; every compatible provider speaks
  // chat completions, so pin it rather than letting the SDK negotiate.
  setOpenAIAPI('chat_completions')

  // `setTraceProcessors` rather than `addTraceProcessor`: the former *replaces*
  // the default list, and the default uploads to OpenAI — which on a Groq or
  // Gemini key logs a missing-credential warning on every turn.
  if (tracingEnabled()) {
    setTraceProcessors([new OtelTracingProcessor()])
    setTracingDisabled(false)
  } else {
    setTracingDisabled(true)
  }
  configured = true
}
