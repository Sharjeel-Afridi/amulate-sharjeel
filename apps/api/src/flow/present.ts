import type { Preferences, RankedListing } from '@car/shared'
import type { Ranking } from './rank.js'
import type { Screening } from './search.js'
import { bindingConstraint } from './search.js'
import {
  buildCarDetailSurface,
  buildCatalogueSurface,
  buildJourneySurface,
} from '../surfaces.js'
import type { TurnContext } from '../session.js'

/**
 * Turning a finished search into what the user sees and hears.
 *
 * All of the English lives here, and none of the deciding does. The counts are
 * always ours: a model asked to open with "five cars qualified" will sooner or
 * later say three, and a wrong number in the first sentence discredits the
 * correct reasoning after it. It supplies the judgement, this file supplies the
 * arithmetic.
 */

/** What the search narrowed, as a step-chip detail line. */
function narrowing(screening: Screening, prefs: Preferences, screened: number): string {
  const parts = [
    prefs.category ? `${screening.matched} in your category` : undefined,
    screened < screening.matched ? `${screened} screened in detail` : undefined,
    ...screening.attribution.map((a) => `${a.criterion.label} removed ${a.eliminated}`),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'nothing excluded'
}

export function stepScanned(ctx: TurnContext, screening: Screening, prefs: Preferences): void {
  const screened = screening.qualified.length + screening.ruledOut.length
  ctx.step(
    `Scanned ${screening.scanned} ${prefs.mode === 'buy' ? 'cars for sale' : 'rentals'} → ` +
      `${screening.qualified.length} qualify`,
    narrowing(screening, prefs, screened),
  )
}

/**
 * Nothing cleared every condition.
 *
 * The one outcome that gives the user nothing to act on — no cars to judge and
 * no evidence about which condition to trade away. So the closest misses are
 * shown instead, each labelled with exactly what it fails, and the spec sheet
 * stays editable beside them.
 */
export function showNearMisses(
  ctx: TurnContext,
  screening: Screening,
  near: RankedListing[],
  narrate: boolean,
): void {
  ctx.setShortlist(near)
  ctx.setPhase('recommend')
  ctx.patchInterview({ dirty: false })
  // The sheet gains its "Search again" button once a search has happened, so it
  // is rebuilt here — this is the run where the user most needs the way back.
  ctx.a2ui(buildJourneySurface(ctx.state))
  ctx.step(
    'Nothing cleared every condition',
    near.length ? `Showing the ${near.length} closest, with what each one misses` : undefined,
  )
  if (near.length > 0) {
    ctx.a2ui(buildCatalogueSurface(near, { nearMiss: true, criteria: screening.criteria }))
  }
  if (narrate) ctx.say(nearMissCopy(screening, near.length))
}

function nearMissCopy(screening: Screening, shown: number): string {
  const binding = bindingConstraint(screening)
  const screened = screening.qualified.length + screening.ruledOut.length
  const lead = binding
    ? `Nothing clears every condition — "${binding.label}" is the binding one, ruling out ${binding.eliminated} of ${screened}.`
    : 'Nothing clears every condition.'

  return shown > 0
    ? `${lead} Here are the ${shown} closest anyway, each marked with what it misses. ` +
        'Change anything on the spec sheet and hit Search again.'
    : `${lead} Try widening the budget or the category on the spec sheet.`
}

export function showResults(
  ctx: TurnContext,
  screening: Screening,
  ranking: Ranking,
  stretched: number,
  narrate: boolean,
): void {
  const { shortlist, summary, rankedBy } = ranking
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
  ctx.a2ui(buildCatalogueSurface(shortlist, { stretched, criteria: screening.criteria }))

  if (!narrate) return
  const lead = resultsLead(shortlist.length, stretched, screening.ruledOut.length)
  const top = shortlist[0]
  ctx.say(
    summary
      ? `${lead} ${summary}`
      : `${lead} Best fit is the ${top?.listing.brand} ${top?.listing.model} — ${top?.rationale} ` +
          `Tap a card, or say "book the ${top?.listing.brand}".`,
  )
}

/**
 * "Clears every condition" is only said of the cars it is true of. A soft budget
 * puts over-budget cars on this list on purpose, and claiming they matched would
 * undo the reason for showing them.
 */
function resultsLead(total: number, stretched: number, excluded: number): string {
  const aside = excluded
    ? ` I set aside ${excluded} that tripped a dealbreaker — ask if you want to see them.`
    : ''
  const clean = total - stretched

  if (stretched === 0) return `${clears(total)} every condition.${aside}`
  if (clean === 0) {
    return (
      `Nothing here clears everything you asked for.${aside} ` +
      `These ${total} come closest, and each card says what it gives up.`
    )
  }
  return (
    `${clears(clean)} every condition.${aside} ${stretched} more miss something ` +
    "you said you'd prefer — each card says what — so they rank below."
  )
}

const clears = (n: number) => (n === 1 ? 'One car clears' : `${n} cars clear`)

/**
 * Opens one car in full on the stage. Returns false if it is not on the
 * shortlist, which is the caller's cue to treat the tap as a booking instead.
 *
 * Selecting a card used to go straight to the booking form. Putting the whole
 * specification and the factor-by-factor scoring in between costs one tap and
 * turns "here is a car, pay for it" into a decision someone can check.
 */
export function showCarDetail(ctx: TurnContext, listingId: string): boolean {
  const entry = ctx.state.shortlist.find((r) => r.listing.id === listingId)
  if (!entry) return false

  ctx.a2ui(buildCarDetailSurface(entry, ctx.state.criteria, ctx.state.preferences))
  ctx.step(
    `Opened ${entry.listing.brand} ${entry.listing.model}`,
    'Your criteria checked against it, scoring, and the full spec',
  )
  return true
}

/** Returns the stage to the ranked list. */
export function showCatalogue(ctx: TurnContext): void {
  // Backing out of the booking form is a return to browsing, so the phase moves
  // with the stage — but only from 'book'. 'done' means the (mock) payment
  // settled, and a settled booking is final.
  if (ctx.state.phase === 'book') ctx.setPhase('recommend')
  ctx.a2ui(buildCatalogueSurface(ctx.state.shortlist, { criteria: ctx.state.criteria }))
}
