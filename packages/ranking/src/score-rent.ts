import type { Preferences, RentalListing } from '@car/shared'
import { type Contribution, type Scored, composeScore } from './compose.js'
import { emphasised } from './emphasis.js'
import type { RentalStats } from './peers.js'
import { sharedContributions } from './shared-factors.js'
import {
  UNLIMITED_KM,
  budgetSub,
  daysBetween,
  priceText,
  lowerIsBetter,
  plural,
  position,
  signed,
  thousands,
} from './util.js'

/**
 * Relative importances, not points — only their ratio matters, because
 * composeScore renormalises over whichever criteria are active.
 *
 * A rental is a running cost with a return date, so the monthly rate and the
 * terms bolted to it — mileage allowance, minimum hire, excess, whether you
 * can actually book it today — carry the model. Nothing here cares about
 * kilometres on the clock, previous owners or warranty: those are questions
 * about owning an asset, and the renter never owns it.
 */
export const RENT_WEIGHTS = {
  monthlyRate: 22,
  category: 12,
  bootLitres: 10,
  freeKm: 8,
  seats: 8,
  minRentalDays: 6,
  fuel: 6,
  rating: 6,
  instantBook: 5,
  runningCosts: 5,
  excess: 4,
} as const

/** Which weights a stated priority amplifies. Read alongside the table above. */
const RENT_EMPHASIS: Partial<Record<string, readonly (keyof typeof RENT_WEIGHTS)[]>> = {
  economy: ['runningCosts'],
  boot: ['bootLitres'],
  seats: ['seats'],
  rating: ['rating'],
  value: ['monthlyRate', 'excess'],
  kms: ['freeKm'],
  flexibility: ['instantBook', 'minRentalDays'],
}

export function scoreRental(listing: RentalListing, prefs: Preferences, stats: RentalStats): Scored {
  const W = emphasised(RENT_WEIGHTS, prefs, RENT_EMPHASIS)
  const out: Contribution[] = []

  if (prefs.budgetMax !== undefined) {
    const budget = prefs.budgetMax
    const gap = budget - listing.monthlyRate
    out.push({
      label: 'Monthly rate',
      weight: W.monthlyRate,
      sub: budgetSub(listing.monthlyRate, budget),
      detail:
        gap >= 0
          ? `${priceText(listing.monthlyRate)} a month, ${priceText(gap)} inside your ${priceText(budget)} ceiling`
          : `${priceText(listing.monthlyRate)} a month, ${priceText(-gap)} over your ${priceText(budget)} ceiling`,
    })
  } else {
    // No budget stated, so the rate is judged only against what else came back.
    out.push({
      label: 'Monthly rate',
      weight: W.monthlyRate,
      sub: signed(lowerIsBetter(listing.monthlyRate, stats.monthlyRate)),
      detail: `${priceText(listing.monthlyRate)} a month, against ${priceText(stats.monthlyRate.min)}–${priceText(stats.monthlyRate.max)} here`,
    })
  }

  const unlimited = listing.freeKmPerDay >= UNLIMITED_KM
  out.push({
    label: 'Free kilometres',
    weight: W.freeKm,
    // An absolute scale, not a peer one: 100 km/day is tight and 250 is
    // generous regardless of what else happens to be in this shortlist.
    sub: unlimited ? 1 : signed(position(listing.freeKmPerDay, 100, 250)),
    detail: unlimited
      ? 'Unlimited kilometres, no excess-mileage charge'
      : `${thousands(listing.freeKmPerDay)} free km a day before excess-mileage charges`,
  })

  const tripDays = daysBetween(prefs.targetDate, prefs.returnDate)
  const tooLong = tripDays !== undefined && listing.minRentalDays > tripDays
  out.push({
    label: 'Minimum hire',
    weight: W.minRentalDays,
    // A minimum longer than the trip is a hard problem, not a mild one: the
    // user would be paying for days they cannot use.
    sub: tooLong ? -1 : signed(1 - position(listing.minRentalDays, 1, 3)),
    detail: tooLong
      ? `${plural(listing.minRentalDays, 'day')} minimum, longer than the ${plural(tripDays, 'day')} you want it for`
      : `Hires from ${plural(listing.minRentalDays, 'day')}`,
  })

  out.push({
    label: 'Instant booking',
    weight: W.instantBook,
    // Not bookable on the spot is an inconvenience rather than a fault, so the
    // downside is half the upside.
    sub: listing.instantBook ? 1 : -0.5,
    detail: listing.instantBook
      ? 'Instant booking, confirmed without waiting on the provider'
      : 'Needs provider confirmation before it is yours',
  })

  out.push({
    label: 'Insurance excess',
    weight: W.excess,
    sub: signed(1 - position(listing.excess, 300, 1500)),
    detail: `${priceText(listing.excess)} insurance excess if anything happens`,
  })

  out.push(...sharedContributions(listing, prefs, stats, W))

  return composeScore(out)
}
