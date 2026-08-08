import { type Listing, isRental, missingFields } from '@car/shared'
import { buildCatalogueSurface, buildJourneySurface, buildSearchingSurface } from './surfaces.js'
import { callToolForApp, callToolJson } from './mcp.js'
import { describeSpec, extractPreferences } from './extract.js'
import type { AgentDriver, TurnContext } from './driver.js'
import { rank } from './ranking.js'

/**
 * A deterministic driver that walks the full journey without a model.
 *
 * It calls the real MCP tools, mutates the real session state and emits the real
 * A2UI surfaces — only the choice of words is canned. That makes it a faithful
 * exercise of the whole pipeline, and a dependable fallback for demoing when the
 * model API is unavailable.
 */

const QUESTIONS: { field: string; ask: string }[] = [
  { field: 'mode', ask: 'Are you looking to rent, or to buy?' },
  { field: 'category', ask: 'What kind of car did you have in mind?' },
  { field: 'budgetMax', ask: "What's your budget?" },
  { field: 'targetDate', ask: 'When do you need it by?' },
]

export class ScriptedDriver implements AgentDriver {
  readonly name = 'scripted'

  async handleUserMessage(ctx: TurnContext, text: string): Promise<void> {
    const patch = extractPreferences(text, ctx.state.preferences)

    if (Object.keys(patch).length > 0) {
      ctx.patchPreferences(patch)
      ctx.step(
        `Captured ${Object.keys(patch).length} preference${Object.keys(patch).length === 1 ? '' : 's'}`,
        Object.entries(patch)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(' · '),
      )
    }

    ctx.a2ui(buildJourneySurface(ctx.state))

    const missing = missingFields(ctx.state.preferences)
    const next = QUESTIONS.find((q) => missing.includes(q.field as never))

    if (next) {
      ctx.say(next.ask)
      return
    }

    await this.research(ctx)
  }

  private async research(ctx: TurnContext): Promise<void> {
    const prefs = ctx.state.preferences

    // State the spec back before searching — the user's chance to correct course
    // before any work happens, and the moment the multistep flow becomes legible.
    ctx.setPhase('research')
    ctx.say(`Right — ${describeSpec(prefs)}. Searching now.`)
    ctx.a2ui(buildSearchingSurface())

    const result = await callToolJson<{
      totalScanned: number
      matched: number
      relaxed: string[]
      listings: Listing[]
    }>('search_listings', {
      mode: prefs.mode ?? 'rent',
      category: prefs.category,
      budgetMax: prefs.budgetMax,
      seatsMin: prefs.seatsMin,
      bootLitresMin: prefs.bootLitresMin,
      fuel: prefs.fuel,
      transmission: prefs.transmission,
      limit: 8,
    })

    ctx.setSearchSummary({
      totalScanned: result.totalScanned,
      matched: result.matched,
      shortlisted: Math.min(result.listings.length, 8),
      relaxed: result.relaxed,
    })

    ctx.step(
      `Searched ${result.totalScanned} listings → ${result.matched} match`,
      result.relaxed.length ? `Relaxed: ${result.relaxed.join(', ')}` : 'No constraints relaxed',
    )

    const shortlist = rank(result.listings, prefs)
    ctx.setShortlist(shortlist)
    ctx.setPhase('recommend')

    ctx.step('Ranked by fit against your stated priorities')
    ctx.a2ui(buildCatalogueSurface(shortlist))

    const top = shortlist[0]
    const relaxNote = result.relaxed.length
      ? ` I had to relax ${result.relaxed.join(' and ')} to find enough — worth knowing.`
      : ''

    ctx.say(
      `${shortlist.length} good matches.${relaxNote} Top of the list is the ${top?.listing.brand} ` +
        `${top?.listing.model} — ${top?.rationale} Say "book the ${top?.listing.brand}" when you're ready.`,
    )
  }

  async handleAppToolResult(
    ctx: TurnContext,
    toolName: string,
    result: unknown,
  ): Promise<void> {
    if (toolName === 'submit_booking') {
      const booking = result as { bookingId: string; total: number; listing: string }
      ctx.step('Booking held', `${booking.bookingId} · €${booking.total}`)
      ctx.say(`Held ${booking.listing} for you. Here's the checkout — it's a mock, no card is charged.`)

      const { html } = await callToolForApp('start_checkout', { bookingId: booking.bookingId })
      ctx.mcpApp('start_checkout', html)
      return
    }

    if (toolName === 'confirm_payment') {
      const paid = result as { bookingId: string; confirmation: string }
      ctx.setPhase('done')
      ctx.step('Payment settled (simulated)')
      ctx.say(paid.confirmation)
    }
  }

  /** Open the booking form for a listing the user named. */
  async startBooking(ctx: TurnContext, listingId: string): Promise<void> {
    ctx.setPhase('book')
    const prefs = ctx.state.preferences

    // A rental with no return date opens the form on "0 days, €0" and a
    // validation error, which reads as broken. Default to a week — the user can
    // change it, but they start from something plausible.
    const startDate = prefs.targetDate
    const endDate =
      prefs.returnDate ??
      (prefs.mode !== 'buy' && startDate ? addDays(startDate, 7) : undefined)

    const { html } = await callToolForApp('start_booking', {
      listingId,
      startDate,
      endDate,
    })
    ctx.step('Opened booking form', 'Rendered in chat as an MCP App')
    ctx.mcpApp('start_booking', html)
  }

  /** Match a free-text "book the volvo" against the shortlist. */
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

export const isBookingIntent = (text: string): boolean =>
  /\b(book|reserve|take|choose|pick|go with|i'?ll have)\b/i.test(text)

export const listingLabel = (l: Listing): string =>
  `${l.brand} ${l.model} — ${isRental(l) ? `€${l.monthlyRate}/mo` : `€${l.price.toLocaleString('en-IE')}`}`

/** Shifts an ISO date by whole days, staying in UTC to avoid a local-tz slip. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
