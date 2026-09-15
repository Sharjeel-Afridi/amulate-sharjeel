import { Agent, MCPServerStreamableHttp, run, withTrace } from '@openai/agents'
import { type Driver, advanceAdaptive } from './index.js'
import type { ReorderFn } from '../flow/index.js'
import type { TurnContext } from '../session.js'
import { type AgentConfig, configureProvider } from '../agents/provider.js'
import { buildTools } from '../agents/tools.js'
import { createRanker } from '../agents/ranker.js'
import { withRateLimitRetry, withTimeout } from '../llm.js'

/**
 * The model-backed driver.
 *
 * It reaches the model for exactly one thing: a message the user typed. Every
 * rendered control is handled deterministically by `drivers/index.ts`, which
 * both drivers share — see the note there for why that line is drawn where it is.
 *
 * Even for typed text the model's job stays narrow: extract preferences, choose
 * tools, phrase replies. It never scores a car and never composes a structured
 * surface. Ranking is a separate agent (`agents/ranker.ts`), reached through
 * `reorder`, so a bad ranking degrades to the scorer instead of breaking a turn.
 */

/** A turn that has not resolved by now is throttled or wedged; say so. */
const TURN_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 45_000)

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

export class LlmDriver implements Driver {
  readonly name: string
  readonly reorder: ReorderFn
  private readonly model: string
  private mcpServer?: MCPServerStreamableHttp

  constructor(cfg: AgentConfig) {
    configureProvider(cfg)
    this.name = `${cfg.provider}:${cfg.model}`
    this.model = cfg.model
    this.reorder = createRanker(cfg.model)
  }

  async handleUserMessage(ctx: TurnContext, text: string): Promise<void> {
    const started = Date.now()
    try {
      const agent = new Agent({
        name: 'Car Matchmaker',
        instructions: `${SYSTEM_PROMPT}\n\n## Current state\n${summarise(ctx)}`,
        model: this.model,
        tools: buildTools(ctx, this.reorder),
        mcpServers: await this.mcpServers(),
      })

      const result = await withTimeout(
        // `withTrace` names the workflow and carries the session id as the
        // trace's group, which is what lets a backend stitch a session's
        // per-turn traces back into one conversation.
        () =>
          withRateLimitRetry(() =>
            withTrace('chat turn', () => run(agent, text, { maxTurns: 12 }), {
              groupId: ctx.sessionId,
              metadata: { phase: ctx.state.phase, model: this.model },
            }),
          ),
        TURN_TIMEOUT_MS,
        `No response after ${TURN_TIMEOUT_MS / 1000}s — the provider is probably rate-limiting. ` +
          'Switch to the scripted driver to carry on.',
      )

      const output = String(result.finalOutput ?? '').trim()
      console.log(`[agent] turn ok in ${Date.now() - started}ms, ${output.length} chars`)
      ctx.say(output || 'Sorry — I lost my thread there. Could you say that again?')

      // Whatever facts the model recorded, the deterministic loop re-decides:
      // a filled slot is never asked, an open question stays on screen.
      await advanceAdaptive(this, ctx)
    } catch (err) {
      // A provider error must not leave the user staring at a dead chat, so it
      // surfaces in the conversation as well as the log.
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] turn failed after ${Date.now() - started}ms:`, message)
      throw new Error(`The model call failed: ${message}`)
    }
  }

  /**
   * The marketplace is attached as a real MCP server, so the model can also call
   * get_listing and check_availability directly when it needs a detail the
   * shortlist did not carry. The wrapped tools cover the whole journey, so
   * losing this degrades detail lookups rather than breaking the flow.
   */
  private async mcpServers(): Promise<MCPServerStreamableHttp[]> {
    if (this.mcpServer) return [this.mcpServer]
    try {
      const server = new MCPServerStreamableHttp({
        url: process.env.MCP_URL ?? 'http://localhost:8081/mcp',
        name: 'car-marketplace',
      })
      await server.connect()
      this.mcpServer = server
      return [server]
    } catch {
      return []
    }
  }
}

/** A compact state summary, so the model never re-asks what it already knows. */
function summarise(ctx: TurnContext): string {
  const { preferences, interview, shortlist } = ctx.state
  const known = Object.entries(preferences)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')

  return [
    `Phase: ${ctx.state.phase}`,
    `Already known: ${known || '(nothing yet)'}`,
    `Questions answered: ${interview.answered.join(', ') || '(none)'}`,
    `Spec confirmed: ${interview.confirmed}.`,
    shortlist.length
      ? `Shortlist: ${shortlist
          .slice(0, 3)
          .map((r) => `${r.listing.id} ${r.listing.brand} ${r.listing.model}`)
          .join('; ')}`
      : 'No results yet.',
  ].join('\n')
}
