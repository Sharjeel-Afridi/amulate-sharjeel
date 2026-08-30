import type { Preferences } from '@car/shared'
import type { Driver } from './index.js'
import type { TurnContext } from '../session.js'
import { runSearch, showInterviewForm, startBooking } from '../flow/index.js'
import { extractPreferences } from '../extract.js'

/**
 * The deterministic driver: typed text goes through a regex, not a model.
 *
 * Nothing else about it is a simulation. It calls the real MCP tools, mutates
 * the real state and emits the real surfaces, so it exercises the whole pipeline
 * and stands in as the fallback when the model API is unavailable.
 */

const BOOKING_INTENT = /\b(book|reserve|take|choose|pick|go with|i'?ll have)\b/i
const SEARCH_INTENT = /\b(yes|yep|yeah|go|search|do it|confirm|looks good|correct)\b/i

export class ScriptedDriver implements Driver {
  readonly name = 'scripted'

  async handleUserMessage(ctx: TurnContext, text: string): Promise<void> {
    // "Book the Volvo" is an instruction, not a description of what you want.
    if (BOOKING_INTENT.test(text) && ctx.state.shortlist.length > 0) {
      const listing = findInShortlist(ctx, text) ?? ctx.state.shortlist[0]!.listing
      return startBooking(ctx, listing.id)
    }

    // Typing fills the form: "an SUV under €2,000 for five" lands in the same
    // rows the pickers write to, so describing what you want and picking it are
    // two routes to one sheet rather than two competing inputs.
    const patch = extractPreferences(text, ctx.state.preferences)
    const extracted = Object.keys(patch).length > 0
    if (extracted) {
      ctx.patchPreferences(patch)
      ctx.step(`Noted ${describe(patch)}`)
    }

    // "Go" is the typed equivalent of the Search button, and it has to work
    // whether or not the form is complete — every row is optional.
    if (SEARCH_INTENT.test(text)) {
      ctx.patchInterview({ confirmed: true })
      await runSearch(ctx)
      return
    }

    if (ctx.state.interview.confirmed) {
      ctx.say('Anything else you want me to weigh differently?')
      return
    }

    ctx.say(
      extracted
        ? "Got it — I've filled that in. Change anything else, then hit Search."
        : "Tell me what you're after, or fill in the rows below and hit Search.",
    )
    showInterviewForm(ctx)
  }
}

function findInShortlist(ctx: TurnContext, text: string) {
  const t = text.toLowerCase()
  return ctx.state.shortlist.find(
    (r) =>
      t.includes(r.listing.brand.toLowerCase()) ||
      t.includes(r.listing.model.toLowerCase()) ||
      t.includes(String(r.rank)),
  )?.listing
}

const describe = (patch: Preferences): string =>
  Object.entries(patch)
    .map(([k, v]) => `${k} = ${String(v)}`)
    .join(', ')
