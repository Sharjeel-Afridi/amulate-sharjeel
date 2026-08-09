import type { Preferences, PurchaseListing } from '@car/shared'
import { type Contribution, type Scored, composeScore } from './compose.js'
import type { PurchaseStats } from './peers.js'
import { sharedContributions } from './shared-factors.js'
import {
  REFERENCE_YEAR,
  budgetSub,
  clamp,
  priceText,
  higherIsBetter,
  kms,
  lowerIsBetter,
  plural,
  position,
  signed,
} from './util.js'

/**
 * Relative importances, not points — see composeScore for the renormalisation.
 *
 * Buying is a one-off outlay against an asset that has already been used, so
 * after the price it is the car's history that decides: kilometres on the
 * clock, how old it is, how many hands it has been through, and how much of
 * the risk the dealer is still carrying in the form of warranty. None of that
 * exists in the rental model, and the rental terms do not exist here.
 */
export const BUY_WEIGHTS = {
  price: 22,
  category: 12,
  mileageKm: 12,
  bootLitres: 10,
  age: 9,
  warrantyMonths: 8,
  seats: 8,
  previousOwners: 7,
  fuel: 6,
  rating: 6,
  financeMonthly: 5,
  runningCosts: 5,
} as const

/** Rough European average annual mileage, used when the user set no cap. */
const KM_PER_YEAR = 15_000

export function scorePurchase(listing: PurchaseListing, prefs: Preferences, stats: PurchaseStats): Scored {
  const out: Contribution[] = []
  const age = Math.max(0, REFERENCE_YEAR - listing.year)

  if (prefs.budgetMax !== undefined) {
    const budget = prefs.budgetMax
    const gap = budget - listing.price
    out.push({
      label: 'Purchase price',
      weight: BUY_WEIGHTS.price,
      sub: budgetSub(listing.price, budget),
      detail:
        gap >= 0
          ? `${priceText(listing.price)}, ${priceText(gap)} inside your ${priceText(budget)} budget`
          : `${priceText(listing.price)}, ${priceText(-gap)} over your ${priceText(budget)} budget`,
    })
  } else {
    out.push({
      label: 'Purchase price',
      weight: BUY_WEIGHTS.price,
      sub: signed(lowerIsBetter(listing.price, stats.price)),
      detail: `${priceText(listing.price)}, against ${priceText(stats.price.min)}–${priceText(stats.price.max)} here`,
    })
  }

  if (prefs.maxMileageKm !== undefined) {
    const cap = prefs.maxMileageKm
    const gap = cap - listing.mileageKm
    out.push({
      label: 'Mileage',
      weight: BUY_WEIGHTS.mileageKm,
      // Full marks at 40% of the stated cap; below that the extra kilometres
      // saved stop being what the user is choosing on.
      sub: gap >= 0 ? clamp(gap / (cap * 0.6), 0, 1) : -clamp(0.2 + -gap / (cap * 0.3), 0.2, 1),
      detail:
        gap >= 0
          ? `${kms(listing.mileageKm)}, ${kms(gap)} inside your ${kms(cap)} limit`
          : `${kms(listing.mileageKm)}, ${kms(-gap)} past your ${kms(cap)} limit`,
    })
  } else {
    // No cap stated, so judge the odometer against what is normal for the age
    // rather than inventing a threshold the user never gave us.
    const expected = Math.max(1, age) * KM_PER_YEAR
    out.push({
      label: 'Mileage',
      weight: BUY_WEIGHTS.mileageKm,
      sub: clamp((expected - listing.mileageKm) / expected, -1, 1),
      detail: `${kms(listing.mileageKm)} at ${plural(age, 'year')} old, against ${kms(expected)} typical`,
    })
  }

  if (prefs.minYear !== undefined) {
    const minYear = prefs.minYear
    const gap = listing.year - minYear
    out.push({
      label: 'Age',
      weight: BUY_WEIGHTS.age,
      sub: gap >= 0 ? 0.15 + 0.85 * clamp(gap / 4, 0, 1) : -clamp(0.3 + -gap / 4, 0.3, 1),
      detail:
        gap >= 0
          ? `${listing.year}, ${gap === 0 ? 'exactly your' : `${plural(gap, 'year')} past your`} ${minYear} cut-off`
          : `${listing.year}, ${plural(-gap, 'year')} older than your ${minYear} cut-off`,
    })
  } else {
    out.push({
      label: 'Age',
      weight: BUY_WEIGHTS.age,
      sub: signed(higherIsBetter(listing.year, stats.year)),
      detail: age === 0 ? `${listing.year}, current model year` : `${listing.year}, ${plural(age, 'year')} old`,
    })
  }

  out.push({
    label: 'Previous owners',
    weight: BUY_WEIGHTS.previousOwners,
    sub: signed(1 - position(listing.previousOwners, 1, 3)),
    detail:
      listing.previousOwners === 1
        ? 'One previous owner'
        : `${plural(listing.previousOwners, 'previous owner')}`,
  })

  out.push({
    label: 'Warranty',
    weight: BUY_WEIGHTS.warrantyMonths,
    sub: signed(position(listing.warrantyMonths, 0, 24)),
    detail: listing.warrantyMonths
      ? `${plural(listing.warrantyMonths, 'month')} of warranty from ${listing.dealer}`
      : `No warranty from ${listing.dealer}`,
  })

  out.push({
    label: 'Finance monthly',
    weight: BUY_WEIGHTS.financeMonthly,
    sub: signed(lowerIsBetter(listing.financeMonthly, stats.financeMonthly)),
    detail: `${priceText(listing.financeMonthly)} a month over 48 months if financed`,
  })

  out.push(...sharedContributions(listing, prefs, stats, BUY_WEIGHTS))

  return composeScore(out)
}
