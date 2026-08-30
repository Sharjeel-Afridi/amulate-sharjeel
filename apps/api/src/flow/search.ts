import {
  type Criterion,
  type Listing,
  type ListingAssessment,
  type Preferences,
  screen,
} from '@car/shared'
import { buildCriteria } from './criteria.js'
import { callToolJson } from '../mcp.js'

/**
 * Fetching the marketplace and applying the spec to it.
 *
 * Criteria are derived here rather than read out of session state. They are a
 * pure function of the preferences, so deriving them at the point of use is both
 * cheaper than keeping a copy in sync and impossible to get wrong — which the
 * previous arrangement was, since only the two form handlers rebuilt them and
 * every other route into a search used whatever they had last left behind.
 */

/** How many listings to pull before screening. */
const FETCH_LIMIT = 30

export interface Screening {
  /** The whole pool the marketplace scanned, before any filter. */
  scanned: number
  /** How many the marketplace's own query matched. */
  matched: number
  /** Filters the marketplace relaxed to return anything, for honest reporting. */
  relaxed: string[]
  /** The criteria actually applied, derived from the preferences. */
  criteria: Criterion[]
  qualified: ListingAssessment[]
  ruledOut: ListingAssessment[]
  /** How many cars each hard criterion eliminated, worst offender first. */
  attribution: { criterion: Criterion; eliminated: number }[]
}

export async function searchAndScreen(prefs: Preferences): Promise<Screening> {
  const criteria = buildCriteria(prefs)

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
    limit: FETCH_LIMIT,
  })

  const { qualified, ruledOut, attribution } = screen(result.listings, criteria)

  return {
    scanned: result.totalScanned,
    matched: result.matched,
    relaxed: result.relaxed,
    criteria,
    qualified,
    ruledOut,
    attribution,
  }
}

/** The criterion that cost the most cars, if any did. */
export function bindingConstraint(
  screening: Screening,
): { label: string; eliminated: number } | null {
  const worst = screening.attribution[0]
  return worst ? { label: worst.criterion.label, eliminated: worst.eliminated } : null
}

/**
 * Shortlist entries that miss something the user only stated a preference for.
 *
 * Soft criteria rank rather than filter, so a shortlist can legitimately hold
 * cars that are over budget or short on boot. Calling those "matches" would be
 * dishonest, so the count is carried into the copy.
 *
 * Read off the verdicts `screen` already produced rather than re-assessing.
 */
export function countStretched(screening: Screening, shortlistIds: string[]): number {
  const stretched = new Set(
    screening.qualified
      .filter((a) => a.verdicts.some((v) => !v.passed && v.criterion.kind === 'preference'))
      .map((a) => a.listing.id),
  )
  return shortlistIds.filter((id) => stretched.has(id)).length
}
