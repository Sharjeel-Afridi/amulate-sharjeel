import type { Phase, Preferences, RankedListing, SessionState } from '@car/shared'
import type { A2uiMessage } from './a2ui.js'

/**
 * The seam between the app and whatever is driving the conversation.
 *
 * Two implementations exist: a scripted driver that replays a deterministic
 * journey, and (once an API key is available) one backed by the Claude Agent
 * SDK. Both call the same real MCP tools, mutate the same session state and emit
 * the same events — only the decision of *what to say next* differs.
 *
 * The scripted driver is not only a stand-in for development. It is the demo
 * fallback: if the model API is unreachable or rate-limited mid-presentation,
 * flipping one environment variable still yields a complete, working run.
 */
export interface AgentDriver {
  readonly name: string
  /** Handle one user turn. Should emit through `ctx` and resolve when idle. */
  handleUserMessage(ctx: TurnContext, text: string): Promise<void>
  /** Handle a tool call that originated inside an MCP App iframe. */
  handleAppToolResult(ctx: TurnContext, toolName: string, result: unknown): Promise<void>
}

/** Everything a driver is allowed to do to the outside world. */
export interface TurnContext {
  readonly sessionId: string
  readonly state: SessionState
  /** Emit a conversational turn. */
  say(text: string): void
  /** Emit a collapsed reasoning chip — what the agent just did and why. */
  step(label: string, detail?: string): void
  /** Push declarative UI to one of the A2UI surfaces. */
  a2ui(messages: A2uiMessage[]): void
  /** Render an MCP App inline in the conversation. */
  mcpApp(toolName: string, html: string): void
  setPhase(phase: Phase): void
  patchPreferences(patch: Preferences): void
  setShortlist(shortlist: RankedListing[]): void
  setSearchSummary(summary: SessionState['search']): void
}
