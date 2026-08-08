import {
  type Criterion,
  type Listing,
  type Preferences,
  type RankedListing,
  missingFields,
  screen,
} from '@car/shared'
import {
  buildCatalogueSurface,
  buildJourneySurface,
  buildQuestionSurface,
  buildSearchingSurface,
  buildSpecSurface,
} from './surfaces.js'
import {
  answerToPreferences,
  dealbreakerCriteria,
  describeSpecFull,
  nextQuestion,
  questionsRemaining,
  requirementCriteria,
} from './interview.js'
import { callToolForApp, callToolJson } from './mcp.js'
import type { TurnContext } from './driver.js'
import { rank } from './ranking.js'

/**
 * The deterministic half of the journey.
 *
 * Everything a rendered control can trigger lives here: answering a question,
 * confirming the spec, picking a car, and what happens when an MCP App reports
 * back. None of it calls a model.
 *
 * That is a deliberate division rather than an optimisation. A chip carries a
 * value the question plan already constrained, tagged with the id of the field
 * it fills — there is no ambiguity left for a model to resolve, so putting one in
 * the path buys nothing and costs a round trip, a rate-limit risk, and the
 * chance that the answer is silently never recorded. The model's judgement is
 * spent on the composer, where the input really is open-ended.
 *
 * Both drivers share this. The scripted one adds regex extraction for typed
 * text; the model-backed one adds an agent turn. The journey itself is the same.
 */

/** Records one answered question and closes it out. */
export function recordAnswer(ctx: TurnContext, questionId: string, raw: unknown): void {
  const { patch, dealbreakers } = answerToPreferences(questionId, raw)

  if (Object.keys(patch).length > 0) ctx.patchPreferences(patch)

  if (dealbreakers.length > 0) {
    ctx.setCriteria([...ctx.state.criteria, ...dealbreakerCriteria(dealbreakers)])
    // Not an exclusion in its own right — it changes how the budget requirement
    // is built when the spec is assembled.
    if (dealbreakers.includes('strict-budget')) {
      ctx.patchPreferences({ notes: [...(ctx.state.preferences.notes ?? []), 'strict-budget'] })
    }
  }

  ctx.patchInterview({
    answered: [...ctx.state.interview.answered, questionId],
    pending: undefined,
  })
}

/** Ask the next question, or close the interview and present the spec. */
export function advance(ctx: TurnContext): void {
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
  showSpec(ctx)
}

/**
 * The gate: nothing is searched until the user approves this.
 *
 * Gaps are reported rather than re-asked. "Not sure — help me choose" is a valid
 * answer to the category question that deliberately sets no category, so looping
 * until every required field is filled would never terminate. The spec on screen
 * is the real safety net: a missing line is visible, and the user can correct it
 * before anything is searched.
 */
export function showSpec(ctx: TurnContext): void {
  const strict = (ctx.state.preferences.notes ?? []).includes('strict-budget')
  const criteria: Criterion[] = [
    ...ctx.state.criteria.filter((c) => c.kind === 'exclusion'),
    ...requirementCriteria(ctx.state.preferences, strict),
  ]
  ctx.setCriteria(criteria)

  const gaps = missingFields(ctx.state.preferences)
  if (gaps.length > 0) ctx.step('Spec has gaps', `no ${gaps.join(', ')} — searching without ${gaps.length === 1 ? 'it' : 'them'}`)

  ctx.say("That's everything I need. Here's the spec I'll search on — change anything before I start.")
  ctx.a2ui(buildSpecSurface(describeSpecFull(ctx.state.preferences, criteria)))
}

export interface ResearchSummary {
  qualified: number
  ruledOut: number
  bindingConstraint: { label: string; eliminated: number } | null
  top: { listingId: string; name: string; score: number; rationale: string }[]
}

/** The outcome of ordering the qualifying cars. */
export interface RankingResult {
  shortlist: RankedListing[]
  /** A line to say out loud, when whatever ranked them also wrote one. */
  summary?: string
  /** Which one did it — surfaced as a reasoning step so the user can see. */
  rankedBy: 'model' | 'scorer'
}

/**
 * Orders the cars that qualified, and says why each is where it is.
 *
 * Injected rather than fixed so the journey stays driver-agnostic: the scripted
 * driver has no model and uses the scorer, the model-backed one hands the spec
 * and the candidates to a ranking agent. Both return the same shape, so
 * everything downstream — the surface, the state, the shortlist — is identical.
 */
export type Ranker = (
  candidates: Listing[],
  prefs: Preferences,
  criteria: Criterion[],
) => Promise<RankingResult>

/** Pure arithmetic over the stated preferences. No model, no network. */
export const scorerRanker: Ranker = async (candidates, prefs) => ({
  shortlist: rank(candidates, prefs).slice(0, 8),
  rankedBy: 'scorer',
})

/**
 * Search, screen, rank and render.
 *
 * `narrate` is off when the conversational model asked for this, because it
 * writes the reply itself from the returned summary — the same results described
 * twice in two voices reads as a bug.
 */
export async function runResearch(
  ctx: TurnContext,
  { narrate = true, ranker = scorerRanker }: { narrate?: boolean; ranker?: Ranker } = {},
): Promise<ResearchSummary> {
  const prefs = ctx.state.preferences
  ctx.setPhase('research')
  if (narrate) ctx.say('Searching the marketplace now.')
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

  const binding = attribution[0]
    ? { label: attribution[0].criterion.label, eliminated: attribution[0].eliminated }
    : null

  if (qualified.length === 0) {
    ctx.setPhase('recommend')
    if (narrate) {
      ctx.say(
        binding
          ? `Nothing clears every condition. "${binding.label}" is the binding one — it ruled out ${binding.eliminated} of ${result.listings.length}. Want me to relax it?`
          : 'Nothing matched. Try widening the budget or the category.',
      )
    }
    return { qualified: 0, ruledOut: ruledOut.length, bindingConstraint: binding, top: [] }
  }

  const { shortlist, summary, rankedBy } = await ranker(
    qualified.map((a) => a.listing),
    prefs,
    ctx.state.criteria,
  )

  ctx.setShortlist(shortlist)
  ctx.setPhase('recommend')
  ctx.step(
    rankedBy === 'model'
      ? 'Ranked by the agent against your spec'
      : 'Ranked the qualifying cars on your stated priorities',
    rankedBy === 'model' ? `${shortlist.length} cars, each scored and explained` : undefined,
  )
  ctx.a2ui(buildCatalogueSurface(shortlist))

  const top = shortlist[0]
  if (narrate) {
    const excluded = ruledOut.length
      ? ` I set aside ${ruledOut.length} that tripped a dealbreaker — ask if you want to see them.`
      : ''
    // The counts are always ours. A model asked to open with "five cars
    // qualified" will sooner or later say three, and a wrong number in the first
    // sentence discredits the correct reasoning after it. It supplies the
    // judgement; the arithmetic stays here.
    const lead = `${shortlist.length} cars clear every condition.${excluded}`
    ctx.say(
      summary
        ? `${lead} ${summary}`
        : `${lead} Best fit is the ${top?.listing.brand} ${top?.listing.model} — ${top?.rationale} ` +
            `Tap a card, or say "book the ${top?.listing.brand}".`,
    )
  }

  return {
    qualified: shortlist.length,
    ruledOut: ruledOut.length,
    bindingConstraint: binding,
    top: shortlist.slice(0, 3).map((r) => ({
      listingId: r.listing.id,
      name: `${r.listing.brand} ${r.listing.model}`,
      score: r.score,
      rationale: r.rationale,
    })),
  }
}

/** Opens the booking form for a listing, as an MCP App in the conversation. */
export async function startBooking(ctx: TurnContext, listingId: string): Promise<void> {
  ctx.setPhase('book')
  const prefs = ctx.state.preferences
  const startDate = prefs.targetDate
  const endDate =
    prefs.returnDate ?? (prefs.mode !== 'buy' && startDate ? addDays(startDate, 7) : undefined)

  const { html } = await callToolForApp('start_booking', { listingId, startDate, endDate })
  ctx.step('Opened booking form', 'Rendered in chat as an MCP App')
  ctx.mcpApp('start_booking', html)
}

/** The booking form submitted itself; hand the user straight to checkout. */
export async function handleBookingSubmitted(ctx: TurnContext, result: unknown): Promise<void> {
  const booking = result as { bookingId: string; total: number; listing: string }
  ctx.step('Booking held', `${booking.bookingId} · €${booking.total}`)
  ctx.say(`Held ${booking.listing} for you. Here's the checkout — a mock, so no card is charged.`)

  const { html } = await callToolForApp('start_checkout', { bookingId: booking.bookingId })
  ctx.mcpApp('start_checkout', html)
}

/** The checkout settled its simulated payment. */
export function handlePaymentConfirmed(ctx: TurnContext, result: unknown): void {
  const paid = result as { confirmation: string }
  ctx.setPhase('done')
  ctx.step('Payment settled (simulated)')
  ctx.say(paid.confirmation)
}

/** Shifts an ISO date by whole days, staying in UTC to avoid a local-tz slip. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
