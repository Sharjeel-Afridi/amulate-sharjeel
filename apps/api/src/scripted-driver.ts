import type { Listing, Preferences } from '@car/shared'
import type { AgentDriver, TurnContext } from './driver.js'
import {
  editSpec,
  handleBookingSubmitted,
  handlePaymentConfirmed,
  runResearch,
  showCarDetail,
  showInterviewForm,
  showResults,
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
    // "Book the Volvo" is an instruction, not a description of what you want.
    if (isBookingIntent(text) && ctx.state.shortlist.length > 0) {
      const listing = this.findListingInShortlist(ctx, text) ?? ctx.state.shortlist[0]!.listing
      return startBooking(ctx, listing.id)
    }

    // Typing fills the form. "An SUV under $2,000 for five" lands in the same
    // rows the pickers write to, so describing what you want and picking it are
    // two routes to one sheet rather than two competing inputs.
    const patch = extractPreferences(text, ctx.state.preferences)
    if (Object.keys(patch).length > 0) {
      ctx.patchPreferences(patch)
      ctx.step(`Noted ${describePatch(patch)}`)
    }

    // "Go" is the typed equivalent of the Search button, and it has to work
    // whether or not the form is complete — the whole point of the form is that
    // every row is optional.
    if (/\b(yes|yep|yeah|go|search|do it|confirm|looks good|correct)\b/i.test(text)) {
      return this.confirmSpec(ctx)
    }

    if (ctx.state.interview.confirmed) {
      ctx.say('Anything else you want me to weigh differently?')
      return
    }

    ctx.say(
      Object.keys(patch).length > 0
        ? "Got it — I've filled that in. Change anything else, then hit Search."
        : "Tell me what you're after, or fill in the rows below and hit Search.",
    )
    showInterviewForm(ctx)
  }

  async handleUiAction(
    ctx: TurnContext,
    name: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    if (name === 'confirmSpec') return this.confirmSpec(ctx)

    // Editing a row, whether on the form or in the drawer. No search — the user
    // is usually changing several things, and Search is how they say they are
    // done.
    if (name === 'editSpec') {
      editSpec(ctx, String(context.questionId ?? ''), context.value)
      return
    }

    if (name === 'searchAgain') return this.confirmSpec(ctx)

    // Selecting opens the car; booking is a separate, deliberate second tap.
    if (name === 'selectCar') {
      const listingId = String(context.listingId ?? '')
      if (listingId && showCarDetail(ctx, listingId)) return
      if (listingId) return startBooking(ctx, listingId)
    }

    if (name === 'backToResults') return showResults(ctx)

    if (name === 'bookCar') {
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
