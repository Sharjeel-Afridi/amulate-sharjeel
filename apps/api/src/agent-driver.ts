import { Agent, MCPServerStreamableHttp, run, setTracingDisabled, tool } from '@openai/agents'
import { setDefaultOpenAIClient, setOpenAIAPI } from '@openai/agents-openai'
import { type Criterion, screen } from '@car/shared'
import OpenAI from 'openai'
import { z } from 'zod'
import {
  buildCatalogueSurface,
  buildJourneySurface,
  buildQuestionSurface,
  buildSearchingSurface,
  buildSpecSurface,
} from './surfaces.js'
import { QUESTIONS, dealbreakerCriteria, describeSpecFull, requirementCriteria } from './interview.js'
import type { AgentDriver, TurnContext } from './driver.js'
import { callToolForApp, callToolJson } from './mcp.js'
import { rank } from './ranking.js'

/**
 * The model-backed driver.
 *
 * Provider-agnostic on purpose: the OpenAI Agents SDK talks to anything exposing
 * an OpenAI-compatible endpoint, so Gemini and Groq free tiers work by changing
 * a base URL. The harness is one of the three the brief allows.
 *
 * The model's job is deliberately narrow — decide which question to ask next,
 * extract preferences from free text, choose tools, and phrase replies. It never
 * scores a car and never composes a structured surface; those are deterministic
 * code, which is why a free-tier model is sufficient here.
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
 * turn simply hanging rather than as an error. `flash-lite` has a far higher
 * allowance and is entirely adequate for this workload.
 */
const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash-lite',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
}

/** A turn that has not resolved by now is throttled or wedged; say so. */
const TURN_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 45_000)

const isRateLimit = (err: unknown): boolean =>
  /\b429\b|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(err instanceof Error ? err.message : String(err))

/**
 * Free tiers throttle aggressively, and a single agent turn makes several model
 * calls while working through tools. Without a retry a burst of typing produces
 * a dead chat; with one it just runs slightly slower.
 */
async function withRateLimitRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isRateLimit(err) || i === attempts - 1) throw err
      const backoff = 2000 * 2 ** i
      console.warn(`[agent] rate limited, retrying in ${backoff}ms (${i + 1}/${attempts - 1})`)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastError
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

function configureProvider(cfg: AgentConfig): void {
  if (configured) return
  const baseURL = BASE_URLS[cfg.provider] ?? process.env.AGENT_BASE_URL
  if (!baseURL) throw new Error(`Unknown AGENT_PROVIDER "${cfg.provider}" and no AGENT_BASE_URL set`)

  setDefaultOpenAIClient(new OpenAI({ apiKey: cfg.apiKey, baseURL }))
  // Only OpenAI implements the Responses API; every compatible provider speaks
  // chat completions, so pin it rather than letting the SDK negotiate.
  setOpenAIAPI('chat_completions')
  // Tracing uploads to OpenAI, which we are not using — without this every turn
  // logs a warning about a missing key that has nothing to do with our provider.
  setTracingDisabled(true)
  configured = true
}

const SYSTEM_PROMPT = `You are a car matchmaking concierge. You help someone rent or buy a car by
interviewing them properly, then searching a marketplace and explaining your recommendations.

## How the conversation goes

1. INTERVIEW. Ask one question at a time using ask_question. Never ask two at once.
   Use record_preferences whenever the person tells you something, including things
   they volunteer that you did not ask about.
   Skip questions you already know the answer to — if they said "renting an SUV for
   the family" you already have mode, category and use case.
   Ask the dealbreakers question last. It is the most useful one.

2. SPEC. When you have enough, call show_spec. This displays what you will search on
   and asks them to confirm. Do NOT search before they confirm.

3. RESEARCH. Once confirmed, call search_and_rank exactly once.

4. RECOMMEND. Describe the top result using the rationale the tool returns. Do not
   invent reasons — the rationale already cites what they told you.

5. BOOK. When they choose a car, call open_booking with its listing id.

## How a turn works — read this carefully

Each user message is ONE turn. In a turn you may call a few tools, and then you
MUST finish by writing a short reply. The reply is what the user reads.

- After calling ask_question, your reply IS that question, phrased naturally.
  Do NOT call ask_question again in the same turn.
- Call record_preferences at most once per turn.
- Never call the same tool twice in one turn.
- If you have already called a tool and know what to say, say it. Do not keep
  calling tools looking for more to do.

A turn that ends without text is a failure — the user sees nothing.

## Rules

- One question per turn. Short, conversational, no preamble.
- Never invent listings, prices or specifications. Everything factual comes from tools.
- Never claim a car has a feature the tool output does not show.
- If a dealbreaker rules out everything, say which one and by how much, and offer to relax it.
- Keep replies to one or two sentences. The UI shows the detail; you provide the thread.
- Currency is euros. Rentals are priced per month, purchases as a total.`

/** Tools are rebuilt each turn so they can write into that turn's context. */
function buildTools(ctx: TurnContext) {
  const askQuestion = tool({
    name: 'ask_question',
    description:
      'Ask the user one interview question and render its input control in the chat. ' +
      `Valid ids: ${QUESTIONS.map((q) => q.id).join(', ')}.`,
    parameters: z.object({ questionId: z.string() }),
    execute: async ({ questionId }) => {
      const q = QUESTIONS.find((x) => x.id === questionId)
      if (!q) return `No question with id ${questionId}`
      ctx.patchInterview({ pending: q.id })
      ctx.a2ui(buildQuestionSurface(q))
      // Directive rather than descriptive: a tool result that reads like a
      // suggestion invites another tool call instead of an answer.
      return `Done. Now STOP calling tools and reply with this question in your own words: "${q.ask}"`
    },
  })

  const recordPreferences = tool({
    name: 'record_preferences',
    description:
      'Save what the user told you. Only include fields they actually stated. ' +
      'Budget is monthly for rentals and total for purchases.',
    parameters: z.object({
      mode: z.enum(['rent', 'buy']).nullable(),
      useCase: z.string().nullable(),
      category: z.string().nullable(),
      budgetMax: z.number().nullable(),
      targetDate: z.string().nullable(),
      returnDate: z.string().nullable(),
      seatsMin: z.number().nullable(),
      bootLitresMin: z.number().nullable(),
      fuel: z.enum(['petrol', 'diesel', 'hybrid', 'electric']).nullable(),
      transmission: z.enum(['manual', 'automatic']).nullable(),
      maxMileageKm: z.number().nullable(),
    }),
    execute: async (patch) => {
      const clean = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== null && v !== undefined),
      )
      if (Object.keys(clean).length === 0) return 'Nothing to record.'
      ctx.patchPreferences(clean as never)
      ctx.step(`Noted ${Object.keys(clean).join(', ')}`)
      ctx.a2ui(buildJourneySurface(ctx.state))
      return `Recorded: ${JSON.stringify(clean)}`
    },
  })

  const addDealbreakers = tool({
    name: 'add_dealbreakers',
    description:
      'Record absolute dealbreakers — things that rule a car out entirely. ' +
      'Valid values: no-diesel, no-manual, no-old, no-two-door, no-km-cap, strict-budget.',
    parameters: z.object({ values: z.array(z.string()) }),
    execute: async ({ values }) => {
      const added = dealbreakerCriteria(values.filter((v) => v !== 'none'))
      ctx.setCriteria([...ctx.state.criteria, ...added])
      if (values.includes('strict-budget')) {
        ctx.patchPreferences({ notes: [...(ctx.state.preferences.notes ?? []), 'strict-budget'] })
      }
      return added.length ? `Added exclusions: ${added.map((c) => c.label).join(', ')}` : 'No dealbreakers.'
    },
  })

  const showSpec = tool({
    name: 'show_spec',
    description:
      'Assemble the spec from everything gathered and show it for confirmation. ' +
      'Call this when the interview is done. Do not search until the user confirms.',
    parameters: z.object({}),
    execute: async () => {
      const strict = (ctx.state.preferences.notes ?? []).includes('strict-budget')
      const criteria: Criterion[] = [
        ...ctx.state.criteria.filter((c) => c.kind === 'exclusion'),
        ...requirementCriteria(ctx.state.preferences, strict),
      ]
      ctx.setCriteria(criteria)
      ctx.patchInterview({ complete: true })
      ctx.a2ui(buildSpecSurface(describeSpecFull(ctx.state.preferences, criteria)))
      return 'Spec shown. Wait for the user to confirm before searching.'
    },
  })

  const searchAndRank = tool({
    name: 'search_and_rank',
    description:
      'Search the marketplace, apply the criteria, rank what qualifies and render the ' +
      'results. Call once, only after the user confirms the spec. Returns the shortlist ' +
      'with rationales you should quote rather than rewrite.',
    parameters: z.object({}),
    execute: async () => {
      const prefs = ctx.state.preferences
      ctx.setPhase('research')
      ctx.a2ui(buildSearchingSurface())

      const result = await callToolJson<{
        totalScanned: number
        matched: number
        relaxed: string[]
        listings: never[]
      }>('search_listings', { mode: prefs.mode ?? 'rent', category: prefs.category, limit: 30 })

      const { qualified, ruledOut, attribution } = screen(result.listings, ctx.state.criteria)
      ctx.setRuledOut(ruledOut)
      ctx.setSearchSummary({
        totalScanned: result.totalScanned,
        matched: result.listings.length,
        shortlisted: qualified.length,
        ruledOut: ruledOut.length,
        relaxed: result.relaxed,
      })
      ctx.step(
        `Screened ${result.listings.length} candidates → ${qualified.length} qualify`,
        attribution.map((a) => `${a.criterion.label} removed ${a.eliminated}`).join(' · ') || 'nothing excluded',
      )

      if (qualified.length === 0) {
        ctx.setPhase('recommend')
        return JSON.stringify({
          qualified: 0,
          bindingConstraint: attribution[0]
            ? { label: attribution[0].criterion.label, eliminated: attribution[0].eliminated }
            : null,
        })
      }

      const shortlist = rank(qualified.map((a) => a.listing), prefs).slice(0, 8)
      ctx.setShortlist(shortlist)
      ctx.setPhase('recommend')
      ctx.a2ui(buildCatalogueSurface(shortlist))

      return JSON.stringify({
        qualified: shortlist.length,
        ruledOut: ruledOut.length,
        top: shortlist.slice(0, 3).map((r) => ({
          listingId: r.listing.id,
          name: `${r.listing.brand} ${r.listing.model}`,
          score: r.score,
          rationale: r.rationale,
        })),
      })
    },
  })

  const openBooking = tool({
    name: 'open_booking',
    description: 'Open the booking form for a listing the user chose. Use the listing id.',
    parameters: z.object({ listingId: z.string() }),
    execute: async ({ listingId }) => {
      ctx.setPhase('book')
      const prefs = ctx.state.preferences
      const { html } = await callToolForApp('start_booking', {
        listingId,
        startDate: prefs.targetDate,
        endDate: prefs.returnDate,
      })
      ctx.step('Opened booking form', 'Rendered in chat as an MCP App')
      ctx.mcpApp('start_booking', html)
      return 'Booking form is on screen. The user fills it in themselves.'
    },
  })

  return [askQuestion, recordPreferences, addDealbreakers, showSpec, searchAndRank, openBooking]
}

export class LlmAgentDriver implements AgentDriver {
  readonly name: string
  private readonly cfg: AgentConfig
  private mcpServer?: MCPServerStreamableHttp

  constructor(cfg: AgentConfig) {
    this.cfg = cfg
    this.name = `${cfg.provider}:${cfg.model}`
    configureProvider(cfg)
  }

  /**
   * The marketplace is attached as a real MCP server, so the model can also call
   * get_listing and check_availability directly when it needs a detail the
   * shortlist did not carry.
   */
  private async mcp(): Promise<MCPServerStreamableHttp | undefined> {
    if (this.mcpServer) return this.mcpServer
    try {
      const server = new MCPServerStreamableHttp({
        url: process.env.MCP_URL ?? 'http://localhost:8081/mcp',
        name: 'car-marketplace',
      })
      await server.connect()
      this.mcpServer = server
      return server
    } catch {
      // The wrapped tools cover the whole journey, so losing direct MCP access
      // degrades detail lookups rather than breaking the flow.
      return undefined
    }
  }

  private async agentFor(ctx: TurnContext): Promise<Agent> {
    const mcpServers = await this.mcp()
    return new Agent({
      name: 'Car Matchmaker',
      instructions: `${SYSTEM_PROMPT}\n\n## Current state\n${summarise(ctx)}`,
      model: this.cfg.model,
      tools: buildTools(ctx),
      mcpServers: mcpServers ? [mcpServers] : [],
    })
  }

  async handleUserMessage(ctx: TurnContext, text: string): Promise<void> {
    const started = Date.now()
    try {
      const agent = await this.agentFor(ctx)
      const result = await Promise.race([
        // A generous ceiling: the loop should end in two or three tool calls, so
        // hitting this means the model is stuck, and the error says so plainly.
        withRateLimitRetry(() => run(agent, text, { maxTurns: 12 })),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `No response after ${TURN_TIMEOUT_MS / 1000}s — the provider is probably rate-limiting. ` +
                    'Set AGENT_MODE=scripted to fall back.',
                ),
              ),
            TURN_TIMEOUT_MS,
          ),
        ),
      ])
      const output = String(result.finalOutput ?? '').trim()
      console.log(`[agent] turn ok in ${Date.now() - started}ms, ${output.length} chars`)
      if (output) ctx.say(output)
      else ctx.say('Sorry — I lost my thread there. Could you say that again?')
    } catch (err) {
      // A provider error must not leave the user staring at a dead chat, so it
      // surfaces in the conversation as well as the log.
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] turn failed after ${Date.now() - started}ms:`, message)
      throw new Error(`The model call failed: ${message}`)
    }
  }

  async handleUiAction(
    ctx: TurnContext,
    name: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    // UI actions are translated into a message so the model sees them as part of
    // the same conversation rather than as a side channel it has to reconcile.
    if (name === 'answerQuestion') {
      const value = Array.isArray(context.value) ? context.value.join(', ') : String(context.value ?? '')
      ctx.patchInterview({
        answered: [...ctx.state.interview.answered, String(context.questionId ?? '')],
        pending: undefined,
      })
      return this.handleUserMessage(ctx, `[answered ${String(context.questionId)}]: ${value}`)
    }
    if (name === 'confirmSpec') {
      ctx.patchInterview({ confirmed: true })
      return this.handleUserMessage(ctx, 'Yes, that spec is right. Please search now.')
    }
    if (name === 'selectCar') {
      return this.handleUserMessage(ctx, `I want to book listing ${String(context.listingId)}.`)
    }
  }

  async handleAppToolResult(ctx: TurnContext, toolName: string, result: unknown): Promise<void> {
    if (toolName === 'submit_booking') {
      const booking = result as { bookingId: string; total: number; listing: string }
      ctx.step('Booking held', `${booking.bookingId} · €${booking.total}`)
      const { html } = await callToolForApp('start_checkout', { bookingId: booking.bookingId })
      ctx.mcpApp('start_checkout', html)
      return this.handleUserMessage(
        ctx,
        `[system] Booking ${booking.bookingId} for ${booking.listing} was held at €${booking.total}. ` +
          'The mock checkout is now on screen. Tell the user briefly.',
      )
    }
    if (toolName === 'confirm_payment') {
      ctx.setPhase('done')
      ctx.step('Payment settled (simulated)')
      const paid = result as { confirmation: string }
      ctx.say(paid.confirmation)
    }
  }
}

/** A compact state summary, so the model never re-asks what it already knows. */
function summarise(ctx: TurnContext): string {
  const { preferences, interview, criteria, phase, shortlist } = ctx.state
  const known = Object.entries(preferences)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')

  return [
    `Phase: ${phase}`,
    `Already known: ${known || '(nothing yet)'}`,
    `Questions answered: ${interview.answered.join(', ') || '(none)'}`,
    `Interview complete: ${interview.complete}. Spec confirmed: ${interview.confirmed}.`,
    `Exclusions: ${criteria.filter((c) => c.kind === 'exclusion').map((c) => c.label).join(', ') || '(none)'}`,
    shortlist.length
      ? `Shortlist: ${shortlist.slice(0, 3).map((r) => `${r.listing.id} ${r.listing.brand} ${r.listing.model}`).join('; ')}`
      : 'No results yet.',
  ].join('\n')
}
