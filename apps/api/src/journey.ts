import {
  type Criterion,
  type Listing,
  type ListingAssessment,
  type Preferences,
  type RankedListing,
  assess,
  money,
  screen,
} from '@car/shared'
import {
  buildCarDetailSurface,
  buildCatalogueSurface,
  buildInterviewFormSurface,
  buildJourneySurface,
  buildSearchingSurface,
  interviewFormData,
} from './surfaces.js'
import {
  answerToPreferences,
  dealbreakerCriteria,
  questionById,
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

/**
 * Writes one answer into preferences and criteria.
 *
 * Shared by the interview and by editing an already-assembled spec, so that a
 * value changed on the sheet means exactly what the same value meant when it was
 * first asked — one mapping, not two that drift.
 */
function applyAnswer(ctx: TurnContext, questionId: string, raw: unknown): void {
  const { patch, clear, dealbreakers } = answerToPreferences(questionId, raw)

  if (Object.keys(patch).length > 0) ctx.patchPreferences(patch)
  if (clear.length > 0) ctx.clearPreferences(clear)

  if (questionId === 'dealbreakers') {
    // Replace rather than append. Appending is right the first time and wrong
    // every time after: unticking a dealbreaker on the sheet has to actually
    // remove it, and re-answering would otherwise only ever add.
    const kept = ctx.state.criteria.filter((c) => c.kind !== 'exclusion')
    ctx.setCriteria([...kept, ...dealbreakerCriteria(dealbreakers)])

    // Not an exclusion in its own right — it changes how the budget requirement
    // is built when the spec is assembled.
    const notes = (ctx.state.preferences.notes ?? []).filter((n) => n !== 'strict-budget')
    if (dealbreakers.includes('strict-budget')) notes.push('strict-budget')
    ctx.patchPreferences({ notes })
  }
}

/**
 * A spec row was changed after the fact.
 *
 * Deliberately does not re-search. Someone correcting a bad result usually
 * changes more than one thing, and re-running on each edit would spend four
 * searches to show the user only the last one — so the sheet goes amber and the
 * search is theirs to trigger.
 */
export function editSpec(ctx: TurnContext, questionId: string, raw: unknown): void {
  const question = questionById(questionId)
  if (!question) return

  // The sheet carries multi-selects as one comma-joined string, because a row's
  // value is a single bound field. Split it back into the array the answer
  // mapping expects.
  const value =
    question.control === 'multi'
      ? String(raw ?? '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : raw

  applyAnswer(ctx, questionId, value)

  // Answering by editing still counts as answering — otherwise a field filled
  // here for the first time leaves the interview believing it is unasked.
  const answered = ctx.state.interview.answered
  if (!answered.includes(questionId)) ctx.patchInterview({ answered: [...answered, questionId] })

  rebuildCriteria(ctx)
  ctx.patchInterview({ dirty: true })
  ctx.a2ui(buildJourneySurface(ctx.state))

  // The form and the drawer are two views of one sheet, so an edit in either has
  // to reach both. Values only — re-sending the components would remount the
  // inputs and take the caret with them.
  if (ctx.state.phase === 'interview') ctx.a2ui(interviewFormData(ctx.state))
}

/**
 * Recomputes the derived half of the spec from current preferences.
 *
 * Dealbreaker exclusions are kept as-is — they come from the dealbreaker answer
 * and are not derivable from preferences — while everything preference-derived
 * is rebuilt, so an edited budget or seat count reaches what actually screens
 * the catalogue.
 *
 * The id filter is what keeps this idempotent. A strict budget is emitted by
 * `requirementCriteria` as an *exclusion*, so keeping "every exclusion" and then
 * appending the rebuilt set would add a second copy of it on each pass.
 */
const DERIVED_IDS = new Set(['category', 'seats', 'boot', 'budget', 'mileage'])

function rebuildCriteria(ctx: TurnContext): void {
  const strict = (ctx.state.preferences.notes ?? []).includes('strict-budget')
  ctx.setCriteria([
    ...ctx.state.criteria.filter((c) => c.kind === 'exclusion' && !DERIVED_IDS.has(c.id)),
    ...requirementCriteria(ctx.state.preferences, strict),
  ])
}

/**
 * Puts the whole interview on screen.
 *
 * There is no next question to choose any more — every row is already visible,
 * so this just rebuilds the sheet from current state. Both the drawer and the
 * form render from the same `specSheet`, which is why answering by typing and
 * answering by picking end up in exactly the same place.
 */
export function showInterviewForm(ctx: TurnContext): void {
  rebuildCriteria(ctx)
  ctx.a2ui(buildJourneySurface(ctx.state))
  ctx.a2ui(buildInterviewFormSurface(ctx.state))
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

/** How many near-misses are worth offering when nothing qualifies. */
const NEAR_MISS_COUNT = 6

/**
 * The cars that came closest, ordered by how little they miss.
 *
 * Ordered by number of failed conditions first and score second: a car that
 * fails one condition is a better thing to offer than one that fails three,
 * however well the second scores on everything else. Each rationale names the
 * conditions and the evidence, so the list doubles as the argument for which
 * constraint is worth relaxing.
 */
function nearMisses(ruledOut: ListingAssessment[], prefs: Preferences): RankedListing[] {
  if (ruledOut.length === 0) return []

  const misses = new Map<string, { count: number; detail: string }>()
  for (const a of ruledOut) {
    const failed = a.verdicts.filter((v) => !v.passed && v.criterion.kind !== 'preference')
    misses.set(a.listing.id, {
      count: failed.length,
      detail: failed.map((v) => `${v.criterion.label} (${v.evidence})`).join(' · '),
    })
  }

  return rank(
    ruledOut.map((a) => a.listing),
    prefs,
  )
    .sort((a, b) => {
      const byMiss = (misses.get(a.listing.id)?.count ?? 0) - (misses.get(b.listing.id)?.count ?? 0)
      return byMiss !== 0 ? byMiss : b.score - a.score
    })
    .slice(0, NEAR_MISS_COUNT)
    // Re-ranked after the re-sort: leaving the scorer's ordinals would number
    // the list 4, 1, 7 against the order it is actually displayed in.
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      rationale: `Misses ${misses.get(r.listing.id)?.detail ?? 'one of your conditions'}`,
    }))
}

/**
 * How many of the shortlist miss something the user only stated a preference for.
 *
 * Soft criteria rank rather than filter, so a shortlist can legitimately hold
 * cars that are over budget or short on boot. Calling those "matches" is the
 * same dishonesty the empty-stage path was built to avoid, so the count is
 * carried into the copy instead of being papered over.
 */
function stretchCount(shortlist: RankedListing[], criteria: Criterion[]): number {
  return shortlist.filter((r) =>
    assess(r.listing, criteria).verdicts.some((v) => !v.passed && v.criterion.kind === 'preference'),
  ).length
}

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

  // Lead with what was actually searched, not with what survived the category
  // filter. The old label opened on the post-filter count, so a thin category
  // reported "Screened 10 candidates" and made a 290-listing marketplace read
  // as ten cars — the search had scanned the whole pool to arrive at those ten.
  // The narrowing is a step worth naming, not the headline.
  const narrowing = [
    prefs.category ? `${result.matched} in your category` : undefined,
    result.listings.length < result.matched ? `${result.listings.length} screened in detail` : undefined,
    ...attribution.map((a) => `${a.criterion.label} removed ${a.eliminated}`),
  ].filter(Boolean)

  ctx.step(
    `Scanned ${result.totalScanned} ${prefs.mode === 'buy' ? 'cars for sale' : 'rentals'} → ${qualified.length} qualify`,
    narrowing.length > 0 ? narrowing.join(' · ') : 'nothing excluded',
  )

  const binding = attribution[0]
    ? { label: attribution[0].criterion.label, eliminated: attribution[0].eliminated }
    : null

  if (qualified.length === 0) {
    // An empty stage is the one outcome that gives the user nothing to act on —
    // no cars to judge, and no evidence about which condition to trade away. So
    // the closest near-misses are shown instead, each labelled with exactly what
    // it fails, and the spec sheet stays editable beside them.
    const near = nearMisses(ruledOut, prefs)
    ctx.setShortlist(near)
    ctx.setPhase('recommend')
    ctx.patchInterview({ dirty: false })
    // The sheet gains its "Search again" button the moment a search has
    // happened, so it has to be rebuilt here — this is exactly the run where
    // the user most needs the way back.
    ctx.a2ui(buildJourneySurface(ctx.state))
    ctx.step(
      'Nothing cleared every condition',
      near.length ? `Showing the ${near.length} closest, with what each one misses` : undefined,
    )
    if (near.length > 0) ctx.a2ui(buildCatalogueSurface(near, { nearMiss: true }))

    if (narrate) {
      const lead = binding
        ? `Nothing clears every condition — "${binding.label}" is the binding one, ruling out ${binding.eliminated} of ${result.listings.length}.`
        : 'Nothing clears every condition.'
      ctx.say(
        near.length
          ? `${lead} Here are the ${near.length} closest anyway, each marked with what it misses. Change anything on the spec sheet and hit Search again.`
          : `${lead} Try widening the budget or the category on the spec sheet.`,
      )
    }
    return { qualified: 0, ruledOut: ruledOut.length, bindingConstraint: binding, top: [] }
  }

  const { shortlist, summary, rankedBy } = await ranker(
    qualified.map((a) => a.listing),
    prefs,
    ctx.state.criteria,
  )

  const stretched = stretchCount(shortlist, ctx.state.criteria)
  const clean = shortlist.length - stretched

  ctx.setShortlist(shortlist)
  ctx.setPhase('recommend')
  ctx.patchInterview({ dirty: false })
  ctx.a2ui(buildJourneySurface(ctx.state))
  ctx.step(
    rankedBy === 'model'
      ? 'Ranked by the agent against your spec'
      : 'Ranked the qualifying cars on your stated priorities',
    stretched > 0
      ? `${clean} clear everything, ${stretched} stretch a preference and rank below them`
      : rankedBy === 'model'
        ? `${shortlist.length} cars, each scored and explained`
        : undefined,
  )
  ctx.a2ui(buildCatalogueSurface(shortlist, { stretched }))

  const top = shortlist[0]
  if (narrate) {
    const excluded = ruledOut.length
      ? ` I set aside ${ruledOut.length} that tripped a dealbreaker — ask if you want to see them.`
      : ''
    // The counts are always ours. A model asked to open with "five cars
    // qualified" will sooner or later say three, and a wrong number in the first
    // sentence discredits the correct reasoning after it. It supplies the
    // judgement; the arithmetic stays here.
    //
    // "Clears every condition" is only said of the cars it is true of. A soft
    // budget puts over-budget cars on this list on purpose, and claiming they
    // matched would undo the reason for showing them.
    const lead =
      stretched === 0
        ? shortlist.length === 1
          ? `One car clears every condition.${excluded}`
          : `${shortlist.length} cars clear every condition.${excluded}`
        : clean === 0
          ? `Nothing here clears everything you asked for.${excluded} These ${shortlist.length} come closest, and each card says what it gives up.`
          : `${clean === 1 ? 'One car clears' : `${clean} cars clear`} every condition.${excluded} ` +
            `${stretched} more miss something you said you'd prefer — each card says what — so they rank below.`
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

/**
 * Opens one car in full on the stage.
 *
 * Selecting a card used to go straight to the booking form. Putting the whole
 * specification and the factor-by-factor scoring in between costs one tap and
 * turns "here is a car, pay for it" into a decision someone can actually check.
 */
export function showCarDetail(ctx: TurnContext, listingId: string): boolean {
  const entry = ctx.state.shortlist.find((r) => r.listing.id === listingId)
  if (!entry) return false

  ctx.a2ui(buildCarDetailSurface(entry))
  ctx.step(`Opened ${entry.listing.brand} ${entry.listing.model}`, 'Full spec and scoring on the stage')
  return true
}

/** Returns the stage to the ranked list. */
export function showResults(ctx: TurnContext): void {
  // Backing out of the booking form is a return to browsing, so the phase moves
  // with the stage — but only from 'book'. 'done' means the (mock) payment
  // settled, and a settled booking is final.
  if (ctx.state.phase === 'book') ctx.setPhase('recommend')
  ctx.a2ui(buildCatalogueSurface(ctx.state.shortlist))
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

/**
 * The booking form held the booking and moved itself on to payment.
 *
 * Nothing is rendered here. The widget owns the whole transaction — dates,
 * extras, driver, payment — and advances between its own steps in place. Pushing
 * a second MCP App at this point is what used to leave the filled-in booking
 * form sitting above the payment screen for the rest of the conversation.
 */
export function handleBookingSubmitted(ctx: TurnContext, result: unknown): void {
  const booking = result as { bookingId: string; total: number; listing: string }
  ctx.step('Booking held', `${booking.bookingId} · ${money(booking.total)}`)
  ctx.say(`Held ${booking.listing} for you — ${money(booking.total)} in total. Payment next, and it's a mock, so no card is charged.`)
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
