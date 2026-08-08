import { budgetValue } from '@car/catalog'
import { type Listing, type Preferences, type RankedListing, isPurchase, isRental } from '@car/shared'
import { purchaseStats, rentalStats } from './peers.js'
import { buildRationale } from './rationale.js'
import { scorePurchase } from './score-buy.js'
import { scoreRental } from './score-rent.js'

/**
 * Scores every listing against the stated preferences and returns them ordered
 * best first, with contiguous ranks from 1.
 *
 * Rentals and purchases are scored inside their own peer group: "cheap" and
 * "low mileage" only mean anything relative to the other cars of the same
 * product, and a €320-a-month hire has no business being compared with a
 * €22,000 sale. The two groups are then merged on score, which is safe because
 * both models emit the same 0–100 scale.
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

  // Ties are broken by the cheaper car, then the better rated, then the id, so
  // the same input always comes back in the same order — a re-rank after a
  // budget tweak should only move what the tweak actually changed.
  scored.sort(
    (a, b) =>
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
