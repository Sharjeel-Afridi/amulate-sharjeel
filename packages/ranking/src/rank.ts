import { budgetValue } from '@car/catalog'
import { type Listing, type Preferences, type RankedListing, isPurchase, isRental } from '@car/shared'
import { purchaseStats, rentalStats } from './peers.js'
import { buildRationale } from './rationale.js'
import { scorePurchase } from './score-buy.js'
import { scoreRental } from './score-rent.js'

/**
 * Whether a listing sits inside the stated budget.
 *
 * An unstated ceiling cannot be exceeded, so a search with no budget treats
 * every car as affordable.
 */
export function withinBudget(listing: Listing, prefs: Preferences): boolean {
  return prefs.budgetMax === undefined || budgetValue(listing) <= prefs.budgetMax
}

/**
 * Re-orders an already-ranked list so nothing over budget sits above something
 * inside it, renumbering to match.
 *
 * Stable, so the order the caller decided survives inside each band. `rankListings`
 * gets the same guarantee from its sort key; this is for the rankings we did not
 * produce — the model ranker returns its own order, and it is not allowed to
 * promote an over-budget car either.
 */
export function affordableFirst(entries: RankedListing[], prefs: Preferences): RankedListing[] {
  if (prefs.budgetMax === undefined) return entries
  const inside = entries.filter((e) => withinBudget(e.listing, prefs))
  if (inside.length === 0 || inside.length === entries.length) return entries
  return [...inside, ...entries.filter((e) => !withinBudget(e.listing, prefs))].map((e, i) => ({
    ...e,
    rank: i + 1,
  }))
}

/**
 * Scores every listing against the stated preferences and returns them ordered
 * best first, with contiguous ranks from 1.
 *
 * Rentals and purchases are scored inside their own peer group: "cheap" and
 * "low mileage" only mean anything relative to the other cars of the same
 * product, and a €320-a-month hire has no business being compared with a
 * €22,000 sale. The two groups are then merged on score, which is safe because
 * both models emit the same 0–100 scale.
 *
 * Score is not the first sort key, though — affordability is. A soft budget puts
 * over-budget cars on the shortlist rather than filtering them out, so the score
 * alone would sometimes rank one above a car that actually fits. The scores
 * themselves stay honest, which means they can read out of order across the band
 * boundary; that is the visible cost of showing the near misses at all.
 */
export function rankListings(listings: Listing[], prefs: Preferences): RankedListing[] {
  const rentals = listings.filter(isRental)
  const purchases = listings.filter(isPurchase)
  const rentStats = rentals.length ? rentalStats(rentals) : undefined
  const buyStats = purchases.length ? purchaseStats(purchases) : undefined

  const scored = listings.map((listing) => {
    if (isRental(listing)) {
      const { score, factors } = scoreRental(listing, prefs, rentStats!)
      return { listing, score, factors, peers: rentals as Listing[] }
    }
    const { score, factors } = scorePurchase(listing, prefs, buyStats!)
    return { listing, score, factors, peers: purchases as Listing[] }
  })

  // Affordability bands the list before score gets a say. The weighted score
  // cannot carry this on its own: the budget is one weight among a dozen, so a
  // car $50 over with a bigger boot and a better rating out-scores one that fits,
  // and the top card is presented as *the* answer. Banding is what makes "shown,
  // but ranked down" true however the other factors fall.
  //
  // Remaining ties break by the cheaper car, then the better rated, then the id,
  // so the same input always comes back in the same order — a re-rank after a
  // budget tweak should only move what the tweak actually changed.
  scored.sort(
    (a, b) =>
      Number(withinBudget(b.listing, prefs)) - Number(withinBudget(a.listing, prefs)) ||
      b.score - a.score ||
      budgetValue(a.listing) - budgetValue(b.listing) ||
      b.listing.rating - a.listing.rating ||
      (a.listing.id < b.listing.id ? -1 : a.listing.id > b.listing.id ? 1 : 0),
  )

  return scored.map((s, i) => ({
    listing: s.listing,
    score: s.score,
    rank: i + 1,
    rationale: buildRationale(s.listing, prefs, s.factors, s.peers),
    factors: s.factors,
  }))
}
