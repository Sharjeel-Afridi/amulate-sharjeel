import type { Phase, RankedListing, SessionState } from '@car/shared'
import type { A2uiMessage } from './a2ui.js'

/**
 * What the API streams to the browser over SSE.
 *
 * Deliberately a closed union: the web client switches on `type` exhaustively,
 * so adding a server event without handling it is a compile error rather than a
 * silently ignored message.
 */
export type ServerEvent =
  /** Full state snapshot. Sent on connect and after any mutation. */
  | { type: 'state'; state: SessionState }
  /**
   * A turn of conversation from the agent.
   *
   * `tag` names the message's identity across re-emissions. When the client
   * sees a tag it already holds, it rewinds the transcript to the previous
   * occurrence instead of appending — which is how going back through the
   * interview un-piles the questions it walked past.
   */
  | { type: 'message'; text: string; tag?: string }
  /** A collapsed reasoning chip in the chat stream — what the agent just did. */
  | { type: 'step'; label: string; detail?: string }
  /** Declarative UI for one of the A2UI surfaces. */
  | { type: 'a2ui'; messages: A2uiMessage[] }
  /** An MCP App to render inline in the conversation. */
  | { type: 'mcpApp'; toolName: string; html: string }
  /** Phase machine advanced. */
  | { type: 'phase'; phase: Phase }
  /** Ranked results, for clients that want them structured as well as as A2UI. */
  | { type: 'results'; shortlist: RankedListing[] }
  /** The agent has finished this turn and is waiting on the user. */
  | { type: 'idle' }
  | { type: 'error'; message: string }

export function sseFrame(event: ServerEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
