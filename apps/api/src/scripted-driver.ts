import type { Listing, Preferences } from '@car/shared'
import type { AgentDriver, TurnContext } from './driver.js'
import {
  advance,
  handleBookingSubmitted,
  handlePaymentConfirmed,
  recordAnswer,
  runResearch,
  showSpec,
  startBooking,
} from './journey.js'
import { extractPreferences } from './extract.js'

/**
 * A deterministic driver that walks the full journey without a model.
 *
 * It calls the real MCP tools, mutates the real session state and emits the real
 * A2UI surfaces — only the choice of words is canned. That makes it a faithful
 * exercise of the whole pipeline, and a dependable fallback for demoing when the
 * model API is unavailable.
 *
 * Every rendered control it handles goes through `journey.ts`, which the
 * model-backed driver shares. The only thing that differs between the two is
 * what happens when someone types: this one reaches for a regex, the other for
 * the model.
 *
 * The interview runs to completion before anything is searched. An earlier
 * version fired the search as soon as the required fields happened to be filled,
 * which meant a single well-phrased sentence skipped straight to results — fast,
 * but it never felt like being listened to.
 */
export class ScriptedDriver implements AgentDriver {
  readonly name = 'scripted'

  async handleUserMessage(ctx: TurnContext, text: string): Promise<void> {
    const { interview } = ctx.state

    // "Book the Volvo" is an instruction, not another interview answer.
    if (isBookingIntent(text) && ctx.state.shortlist.length > 0) {
      const listing = this.findListingInShortlist(ctx, text) ?? ctx.state.shortlist[0]!.listing
      return startBooking(ctx, listing.id)
    }

    // Free text always wins over the controls — someone who types "make it 500"
    // should not have to go back and drag a slider.
    const patch = extractPreferences(text, ctx.state.preferences)
    if (Object.keys(patch).length > 0) {
      ctx.patchPreferences(patch)
      ctx.step(`Noted ${describePatch(patch)}`)
    }

    if (interview.complete && !interview.confirmed) {
      if (/\b(yes|yep|yeah|go|search|do it|confirm|looks good|correct)\b/i.test(text)) {
        return this.confirmSpec(ctx)
      }
      ctx.say("No problem — tell me what to change, or say 'go' when it looks right.")
      showSpec(ctx)
      return
    }

    if (interview.confirmed) {
      ctx.say('Anything else you want me to weigh differently?')
      return
    }

    // With no model to interpret it, a typed reply counts as answering whatever
    // was on screen. The model-backed driver deliberately does not do this — it
    // can tell an answer from an aside, so the control stays up.
    if (interview.pending) {
      ctx.patchInterview({
        answered: [...interview.answered, interview.pending],
        pending: undefined,
      })
    }

    advance(ctx)
  }

  async handleUiAction(
    ctx: TurnContext,
    name: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    if (name === 'confirmSpec') return this.confirmSpec(ctx)

    if (name === 'answerQuestion') {
      recordAnswer(ctx, String(context.questionId ?? ''), context.value)
      advance(ctx)
      return
    }

    if (name === 'selectCar') {
      const listingId = String(context.listingId ?? '')
      if (listingId) return startBooking(ctx, listingId)
    }
  }

  async handleAppToolResult(ctx: TurnContext, toolName: string, result: unknown): Promise<void> {
    if (toolName === 'submit_booking') return handleBookingSubmitted(ctx, result)
    if (toolName === 'confirm_payment') return handlePaymentConfirmed(ctx, result)
  }

  private async confirmSpec(ctx: TurnContext): Promise<void> {
    ctx.patchInterview({ confirmed: true })
    await runResearch(ctx)
  }

  findListingInShortlist(ctx: TurnContext, text: string): Listing | undefined {
    const t = text.toLowerCase()
    return ctx.state.shortlist.find(
      (r) =>
        t.includes(r.listing.brand.toLowerCase()) ||
        t.includes(r.listing.model.toLowerCase()) ||
        t.includes(String(r.rank)),
    )?.listing
  }
}

function describePatch(patch: Preferences): string {
  return Object.entries(patch)
    .filter(([k]) => k !== 'notes')
    .map(([k, v]) => `${k} = ${String(v)}`)
    .join(', ')
}

export const isBookingIntent = (text: string): boolean =>
  /\b(book|reserve|take|choose|pick|go with|i'?ll have)\b/i.test(text)
