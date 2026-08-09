import { Agent, MCPServerStreamableHttp, run, setTracingDisabled, tool } from '@openai/agents'
import { setDefaultOpenAIClient, setOpenAIAPI } from '@openai/agents-openai'
import { CATEGORIES } from '@car/shared'
import OpenAI from 'openai'
import { z } from 'zod'
import { buildJourneySurface } from './surfaces.js'
import { dealbreakerCriteria } from './interview.js'
import type { AgentDriver, TurnContext } from './driver.js'
import {
  type Ranker,
  editSpec,
  handleBookingSubmitted,
  handlePaymentConfirmed,
  runResearch,
  showCarDetail,
  showInterviewForm,
  showResults,
  startBooking,
} from './journey.js'
import { withRateLimitRetry, withTimeout } from './llm.js'
import { createModelRanker } from './rank-agent.js'

/**
 * The model-backed driver.
 *
 * Provider-agnostic on purpose: the OpenAI Agents SDK talks to anything exposing
 * an OpenAI-compatible endpoint, so Gemini and Groq free tiers work by changing
 * a base URL. The harness is one of the three the brief allows.
 *
 * The model is reached for exactly one thing: a message the user typed. Every
 * rendered control — chips, sliders, the date picker, the spec confirmation, a
 * tapped car, a submitted MCP App — is handled deterministically in `journey.ts`,
 * which this driver shares with the scripted one.
 *
 * That boundary is drawn where the ambiguity is. A chip already carries a value
 * the question plan constrained, tagged with the field it fills; a typed sentence
 * does not. Routing the first kind through a model added a round trip and a
 * rate-limit risk to reach the same answer a switch statement gives — and, worse,
 * made recording it contingent on the model choosing to call a tool, so a
 * perfectly good answer could vanish while the interview moved on regardless.
 *
 * Even for typed text the model's job stays narrow: extract preferences, choose
 * tools, phrase replies. It never scores a car and never composes a structured
 * surface. That is why a free-tier model is sufficient here.
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

/**
 * A stand-in parameter for tools that genuinely take no arguments.
 *
 * `z.object({})` serialises to a schema carrying `required` with no
 * `properties`, which some providers reject outright ("'required' present but
 * 'properties' is missing"). One ignored optional field keeps the schema valid
 * everywhere without giving the model anything to get wrong.
 */
const NO_ARGS = z.object({
  note: z.string().nullable().describe('Unused. Pass null.'),
})

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

const SYSTEM_PROMPT = `You are a car matchmaking concierge. You help someone rent or buy a car, then
explain your recommendations.

## What you drive, and what you do not

The interview drives itself. Its questions appear in the chat as controls the
person taps, and the app records those answers before you ever see them. You do
NOT ask the interview questions, you do NOT decide which one comes next, and you
do NOT need to track how far through it they are. The "Current state" block below
already tells you everything that has been established.

You handle one thing: a message the person TYPED. That is always one of these.

- They told you something about their needs → call record_preferences, once per
  fact, then reply in a sentence. This is the common case. It works at any point,
  including in the middle of the interview: "actually make it 500 a month" should
  land immediately.
- They named an absolute dealbreaker → call add_dealbreakers.
- They gave an instruction — "that's enough questions", "search now", "book the
  Volvo" → call show_spec, search_and_rank or open_booking to match.
- They asked something about a car or the results → answer from the tool output.
- Anything else → just reply. Not every message needs a tool.

Do not re-ask something the state block already shows. Do not narrate the
interview's progress; the person can see it.

## How a turn works — read this carefully

Each user message is ONE turn. In a turn you may call a few tools, and then you
MUST finish by writing a short reply. The reply is what the user reads.

- record_preferences saves ONE fact per call. If they told you three things, call
  it three times, then reply.
- If you have already called a tool and know what to say, say it. Do not keep
  calling tools looking for more to do.

A turn that ends without text is a failure — the user sees nothing.

## Rules

- Short, conversational, no preamble. One or two sentences.
- Never invent listings, prices or specifications. Everything factual comes from tools.
- Never claim a car has a feature the tool output does not show.
- When describing results, use the rationale search_and_rank returns rather than
  writing your own — it already cites what they told you.
- If a dealbreaker rules out everything, say which one and by how much, and offer
  to relax it.
- Currency is euros. Rentals are priced per month, purchases as a total.`

/**
 * Tools are rebuilt each turn so they can write into that turn's context.
 *
 * There is deliberately no `ask_question` tool. The interview's sequence belongs
 * to the question plan and the rendered controls, and giving the model a way to
 * push a different question mid-flow only lets the two disagree about where the
 * conversation is.
 */
function buildTools(ctx: TurnContext, ranker: Ranker) {
  const recordPreferences = tool({
    name: 'record_preferences',
    description:
      'Save ONE thing the user told you. Call once per fact. ' +
      'field is one of: mode (rent|buy), useCase (free text), category, ' +
      'budgetMax (number, monthly for rent / total for buy), targetDate (2026-09-12), ' +
      'returnDate, seatsMin (number), bootLitresMin (number), ' +
      'fuel (petrol|diesel|hybrid|electric), transmission (manual|automatic), ' +
      'maxMileageKm (number). value is always a string.',
    /*
     * Two always-present string parameters, one fact per call.
     *
     * A single eleven-field object is the obvious shape, but tool calls are
     * validated strictly: every property in the schema must be present, and a
     * smaller model reliably omits the ones it has no value for — which rejects
     * the entire call and loses the fields it *did* get right. Narrowing to two
     * required strings makes a malformed call almost impossible.
     */
    parameters: z.object({
      field: z.string(),
      value: z.string(),
    }),
    execute: async ({ field, value }) => {
      const ALLOWED: Record<string, readonly string[]> = {
        mode: ['rent', 'buy'],
        fuel: ['petrol', 'diesel', 'hybrid', 'electric'],
        transmission: ['manual', 'automatic'],
        category: CATEGORIES as readonly string[],
      }
      const NUMERIC = new Set(['budgetMax', 'seatsMin', 'bootLitresMin', 'maxMileageKm'])
      const KNOWN = new Set([
        'mode', 'useCase', 'category', 'budgetMax', 'targetDate', 'returnDate',
        'seatsMin', 'bootLitresMin', 'fuel', 'transmission', 'maxMileageKm',
      ])

      const key = field.trim()
      if (!KNOWN.has(key)) return `"${key}" is not a field I track. Ignored.`
      if (!value?.trim()) return `No value given for ${key}. Ignored.`

      let parsed: unknown = value.trim()
      if (NUMERIC.has(key)) {
        const n = Number(String(value).replace(/[^\d.]/g, ''))
        if (!Number.isFinite(n) || n <= 0) return `"${value}" is not a usable number for ${key}.`
        parsed = n
      } else if (ALLOWED[key]) {
        const lower = String(value).trim().toLowerCase()
        if (!ALLOWED[key]!.includes(lower)) {
          return `"${value}" is not valid for ${key}. Allowed: ${ALLOWED[key]!.join(', ')}.`
        }
        parsed = lower
      }

      ctx.patchPreferences({ [key]: parsed } as never)
      ctx.step(`Noted ${key}`, String(parsed))
      ctx.a2ui(buildJourneySurface(ctx.state))
      return `Saved ${key}=${String(parsed)}.`
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

  const showSpecTool = tool({
    name: 'show_spec',
    description:
      'Repaint the interview form so it reflects everything recorded so far. Call this ' +
      'after recording preferences, so the user sees their answers land. The form is ' +
      'always on screen — do not search until the user asks you to.',
    parameters: NO_ARGS,
    execute: async () => {
      showInterviewForm(ctx)
      return 'Form updated. Wait for the user to ask before searching.'
    },
  })

  const searchAndRank = tool({
    name: 'search_and_rank',
    description:
      'Search the marketplace, apply the criteria, rank what qualifies and render the ' +
      'results. Call once, only after the user confirms the spec. Returns the shortlist ' +
      'with rationales you should quote rather than rewrite.',
    parameters: NO_ARGS,
    execute: async () => {
      // `narrate: false` — the reply is this turn's job, and the same results
      // described twice in two voices reads as a bug.
      const summary = await runResearch(ctx, { narrate: false, ranker })
      return JSON.stringify(summary)
    },
  })

  const openBooking = tool({
    name: 'open_booking',
    description: 'Open the booking form for a listing the user chose. Use the listing id.',
    parameters: z.object({ listingId: z.string() }),
    execute: async ({ listingId }) => {
      await startBooking(ctx, listingId)
      return 'Booking form is on screen. The user fills it in themselves.'
    },
  })

  return [recordPreferences, addDealbreakers, showSpecTool, searchAndRank, openBooking]
}

export class LlmAgentDriver implements AgentDriver {
  readonly name: string
  private readonly cfg: AgentConfig
  private readonly ranker: Ranker
  private mcpServer?: MCPServerStreamableHttp

  constructor(cfg: AgentConfig) {
    this.cfg = cfg
    this.name = `${cfg.provider}:${cfg.model}`
    configureProvider(cfg)
    this.ranker = createModelRanker(cfg.model)
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
      tools: buildTools(ctx, this.ranker),
      mcpServers: mcpServers ? [mcpServers] : [],
    })
  }

  async handleUserMessage(ctx: TurnContext, text: string): Promise<void> {
    const started = Date.now()
    try {
      const agent = await this.agentFor(ctx)
      const result = await withTimeout(
        // A generous ceiling: the loop should end in two or three tool calls, so
        // hitting this means the model is stuck, and the error says so plainly.
        () => withRateLimitRetry(() => run(agent, text, { maxTurns: 12 })),
        TURN_TIMEOUT_MS,
        `No response after ${TURN_TIMEOUT_MS / 1000}s — the provider is probably rate-limiting. ` +
          'Set AGENT_MODE=scripted to fall back.',
      )
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

  /**
   * Rendered controls never reach the model.
   *
   * The value arrived constrained by the question plan and labelled with the
   * field it fills, so the whole of its meaning is a lookup. Handling it here
   * costs nothing, cannot be dropped, and leaves the free tier's request budget
   * for the messages that actually need reading.
   */
  async handleUiAction(
    ctx: TurnContext,
    name: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    // Editing the spec sheet. Deterministic like every other control: the value
    // came from a control the question plan constrained, so there is nothing for
    // a model to resolve.
    if (name === 'editSpec') {
      editSpec(ctx, String(context.questionId ?? ''), context.value)
      return
    }

    if (name === 'searchAgain') {
      await runResearch(ctx, { ranker: this.ranker })
      return
    }

    if (name === 'confirmSpec') {
      // The one place a button does reach a model. Confirming the spec is what
      // hands it to the ranking agent, which is the whole point of the product —
      // the interview is a lookup, but ordering cars against what someone said
      // is a judgement, and that is the agent's to make.
      ctx.patchInterview({ confirmed: true })
      await runResearch(ctx, { ranker: this.ranker })
      return
    }

    // Selecting opens the car; booking is a separate, deliberate second tap.
    if (name === 'selectCar') {
      const listingId = String(context.listingId ?? '')
      if (listingId && showCarDetail(ctx, listingId)) return
      if (listingId) await startBooking(ctx, listingId)
      return
    }

    if (name === 'backToResults') return showResults(ctx)

    if (name === 'bookCar') {
      const listingId = String(context.listingId ?? '')
      if (listingId) await startBooking(ctx, listingId)
    }
  }

  /** Likewise for MCP Apps: the widget reported a fact, not an opinion. */
  async handleAppToolResult(ctx: TurnContext, toolName: string, result: unknown): Promise<void> {
    if (toolName === 'submit_booking') return handleBookingSubmitted(ctx, result)
    if (toolName === 'confirm_payment') return handlePaymentConfirmed(ctx, result)
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
