import { type Listing, type Preferences, type RankedListing, isRental } from '@car/shared'

/**
 * TEMPORARY adapter.
 *
 * A dedicated `@car/ranking` package with per-mode scoring and comparative
 * rationales is being built separately; when it lands this file collapses to a
 * single re-export. Until then this keeps the pipeline runnable end to end.
 */

export function rank(listings: Listing[], prefs: Preferences): RankedListing[] {
  const scored = listings.map((listing) => {
    const factors: RankedListing['factors'] = []
    let score = 60

    if (prefs.category && listing.category === prefs.category) {
      score += 12
      factors.push({ label: 'Category', delta: 12, detail: `Matches the ${prefs.category} you asked for` })
    }

    const price = isRental(listing) ? listing.monthlyRate : listing.price
    if (prefs.budgetMax) {
      const headroom = (prefs.budgetMax - price) / prefs.budgetMax
      const delta = Math.round(Math.max(-20, Math.min(18, headroom * 40)))
      score += delta
      factors.push({
        label: 'Budget',
        delta,
        detail:
          headroom >= 0
            ? `€${Math.round(prefs.budgetMax - price).toLocaleString('en-IE')} under your limit`
            : `€${Math.round(price - prefs.budgetMax).toLocaleString('en-IE')} over your limit`,
      })
    }

    if (prefs.bootLitresMin) {
      const delta = listing.bootLitres >= prefs.bootLitresMin ? 10 : -12
      score += delta
      factors.push({
        label: 'Boot space',
        delta,
        detail: `${listing.bootLitres} L against the ${prefs.bootLitresMin} L you needed`,
      })
    }

    if (prefs.seatsMin) {
      const delta = listing.seats >= prefs.seatsMin ? 8 : -15
      score += delta
      factors.push({ label: 'Seats', delta, detail: `${listing.seats} seats` })
    }

    const ratingDelta = Math.round((listing.rating - 4.2) * 8)
    score += ratingDelta
    factors.push({ label: 'Rating', delta: ratingDelta, detail: `${listing.rating}/5` })

    return { listing, score: Math.max(0, Math.min(100, Math.round(score))), factors }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored.map((entry, i) => ({
    ...entry,
    rank: i + 1,
    rationale: describe(entry.listing, entry.factors, scored.map((s) => s.listing), prefs),
  }))
}

/** Comparative where it can be, and always tied to something the user said. */
function describe(
  listing: Listing,
  factors: RankedListing['factors'],
  peers: Listing[],
  prefs: Preferences,
): string {
  const price = isRental(listing) ? listing.monthlyRate : listing.price

  if (prefs.bootLitresMin && listing.bootLitres === Math.max(...peers.map((p) => p.bootLitres))) {
    return `Biggest boot here at ${listing.bootLitres} L${
      prefs.budgetMax ? ` and still under your €${prefs.budgetMax.toLocaleString('en-IE')}` : ''
    }.`
  }

  if (price === Math.min(...peers.map((p) => (isRental(p) ? p.monthlyRate : p.price)))) {
    return `Cheapest of the shortlist${
      prefs.bootLitresMin ? ` that still clears ${prefs.bootLitresMin} L of boot` : ''
    }.`
  }

  const best = [...factors].sort((a, b) => b.delta - a.delta)[0]
  return best ? `${best.detail}.` : `Solid all-round fit for what you described.`
}
