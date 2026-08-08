import {
  type Category,
  type Criterion,
  type FuelType,
  type Listing,
  type Preferences,
  type Transmission,
  isRental,
  screen,
} from '@car/shared'
import {
  buildCatalogueSurface,
  buildJourneySurface,
  buildQuestionSurface,
  buildSearchingSurface,
  buildSpecSurface,
} from './surfaces.js'
import { callToolForApp, callToolJson } from './mcp.js'
import {
  dealbreakerCriteria,
  describeSpecFull,
  nextQuestion,
  questionsRemaining,
  requirementCriteria,
} from './interview.js'
import type { AgentDriver, TurnContext } from './driver.js'
import { extractPreferences } from './extract.js'
import { rank } from './ranking.js'

/**
 * A deterministic driver that walks the full journey without a model.
 *
 * It calls the real MCP tools, mutates the real session state and emits the real
 * A2UI surfaces — only the choice of words is canned. That makes it a faithful
 * exercise of the whole pipeline, and a dependable fallback for demoing when the
 * model API is unavailable.
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
      return this.showSpec(ctx)
    }

    if (interview.confirmed) {
      ctx.say('Anything else you want me to weigh differently?')
      return
    }

    // A free-text answer counts as answering whatever was on screen.
    if (interview.pending) {
      ctx.patchInterview({
        answered: [...interview.answered, interview.pending],
        pending: undefined,
      })
    }

    await this.advance(ctx)
  }

  async handleUiAction(
    ctx: TurnContext,
    name: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    if (name === 'confirmSpec') return this.confirmSpec(ctx)

    if (name === 'answerQuestion') {
      const questionId = String(context.questionId ?? '')
      const value = context.value
      this.recordAnswer(ctx, questionId, value)
      ctx.patchInterview({
        answered: [...ctx.state.interview.answered, questionId],
        pending: undefined,
      })
      return this.advance(ctx)
    }

    if (name === 'selectCar') {
      const listingId = String(context.listingId ?? '')
      if (listingId) return this.startBooking(ctx, listingId)
    }
  }

  /** Maps one answer onto preferences, or onto criteria for dealbreakers. */
  private recordAnswer(ctx: TurnContext, questionId: string, raw: unknown): void {
    const first = Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '')
    const patch: Preferences = {}

    switch (questionId) {
      case 'mode':
        if (first === 'rent' || first === 'buy') patch.mode = first
        break
      case 'useCase':
        if (first.trim()) patch.useCase = first.trim()
        break
      case 'passengers':
        patch.seatsMin = Number(first) || undefined
        break
      case 'category':
        if (first && first !== 'unsure') patch.category = first as Category
        break
      case 'budget':
      case 'budgetBuy':
        patch.budgetMax = Number(first) || undefined
        break
      case 'targetDate':
        if (first) patch.targetDate = first.slice(0, 10)
        break
      case 'returnDate':
        if (first) patch.returnDate = first.slice(0, 10)
        break
      case 'luggage':
        patch.bootLitresMin = Number(first) || undefined
        break
      case 'fuel':
        if (first && first !== 'any') patch.fuel = first as FuelType
        break
      case 'transmission':
        if (first && first !== 'any') patch.transmission = first as Transmission
        break
      case 'mileage':
        patch.maxMileageKm = Number(first) || undefined
        break
      case 'dealbreakers': {
        const values = (Array.isArray(raw) ? raw.map(String) : [first]).filter((v) => v && v !== 'none')
        ctx.setCriteria([...ctx.state.criteria, ...dealbreakerCriteria(values)])
        if (values.includes('strict-budget')) {
          ctx.patchPreferences({ notes: [...(ctx.state.preferences.notes ?? []), 'strict-budget'] })
        }
        break
      }
    }

    if (Object.keys(patch).length) ctx.patchPreferences(patch)
  }

  /** Ask the next question, or close the interview and present the spec. */
  private async advance(ctx: TurnContext): Promise<void> {
    const answered = new Set(ctx.state.interview.answered)
    const question = nextQuestion(ctx.state.preferences, answered)

    ctx.a2ui(buildJourneySurface(ctx.state))

    if (question) {
      const left = questionsRemaining(ctx.state.preferences, answered)
      ctx.patchInterview({ pending: question.id })
      ctx.say(question.ask)
      ctx.a2ui(buildQuestionSurface(question))
      if (left > 1) ctx.step(`${left - 1} more to go`)
      return
    }

    ctx.patchInterview({ complete: true })
    await this.showSpec(ctx)
  }

  /** The gate: nothing is searched until the user approves this. */
  private async showSpec(ctx: TurnContext): Promise<void> {
    const strict = (ctx.state.preferences.notes ?? []).includes('strict-budget')
    const requirements = requirementCriteria(ctx.state.preferences, strict)
    const exclusions = ctx.state.criteria.filter((c) => c.kind === 'exclusion')
    const criteria = [...exclusions, ...requirements]
    ctx.setCriteria(criteria)

    ctx.say("That's everything I need. Here's the spec I'll search on — change anything before I start.")
    ctx.a2ui(buildSpecSurface(describeSpecFull(ctx.state.preferences, criteria)))
  }

  private async confirmSpec(ctx: TurnContext): Promise<void> {
    ctx.patchInterview({ confirmed: true })
    await this.research(ctx)
  }

  private async research(ctx: TurnContext): Promise<void> {
    const prefs = ctx.state.preferences
    ctx.setPhase('research')
    ctx.say('Searching the marketplace now.')
    ctx.a2ui(buildSearchingSurface())

    // Fetch broadly and screen locally: applying the hard criteria here rather
    // than in the query is what lets us report *which* criterion removed *what*.
    const result = await callToolJson<{
      totalScanned: number
      matched: number
      relaxed: string[]
      listings: Listing[]
    }>('search_listings', {
      mode: prefs.mode ?? 'rent',
      category: prefs.category,
      limit: 30,
    })

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
      const worst = attribution[0]
      ctx.setPhase('recommend')
      ctx.say(
        worst
          ? `Nothing clears every condition. "${worst.criterion.label}" is the binding one — it ruled out ${worst.eliminated} of ${result.listings.length}. Want me to relax it?`
          : 'Nothing matched. Try widening the budget or the category.',
      )
      return
    }

    const shortlist = rank(qualified.map((a) => a.listing), prefs).slice(0, 8)
    ctx.setShortlist(shortlist)
    ctx.setPhase('recommend')
    ctx.step('Ranked the qualifying cars on your stated priorities')
    ctx.a2ui(buildCatalogueSurface(shortlist))

    const top = shortlist[0]
    const excluded = ruledOut.length
      ? ` I set aside ${ruledOut.length} that tripped a dealbreaker — ask if you want to see them.`
      : ''

    ctx.say(
      `${shortlist.length} cars clear every condition.${excluded} Best fit is the ${top?.listing.brand} ` +
        `${top?.listing.model} — ${top?.rationale} Tap a card, or say "book the ${top?.listing.brand}".`,
    )
  }

  async handleAppToolResult(ctx: TurnContext, toolName: string, result: unknown): Promise<void> {
    if (toolName === 'submit_booking') {
      const booking = result as { bookingId: string; total: number; listing: string }
      ctx.step('Booking held', `${booking.bookingId} · €${booking.total}`)
      ctx.say(`Held ${booking.listing} for you. Here's the checkout — a mock, so no card is charged.`)
      const { html } = await callToolForApp('start_checkout', { bookingId: booking.bookingId })
      ctx.mcpApp('start_checkout', html)
      return
    }

    if (toolName === 'confirm_payment') {
      const paid = result as { confirmation: string }
      ctx.setPhase('done')
      ctx.step('Payment settled (simulated)')
      ctx.say(paid.confirmation)
    }
  }

  async startBooking(ctx: TurnContext, listingId: string): Promise<void> {
    ctx.setPhase('book')
    const prefs = ctx.state.preferences
    const startDate = prefs.targetDate
    const endDate =
      prefs.returnDate ?? (prefs.mode !== 'buy' && startDate ? addDays(startDate, 7) : undefined)

    const { html } = await callToolForApp('start_booking', { listingId, startDate, endDate })
    ctx.step('Opened booking form', 'Rendered in chat as an MCP App')
    ctx.mcpApp('start_booking', html)
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

/** Shifts an ISO date by whole days, staying in UTC to avoid a local-tz slip. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
