import { CATEGORY_LABELS, type Listing, type Preferences } from '@car/shared'
import type { Contribution } from './compose.js'
import { hasPriority } from './emphasis.js'
import type { CommonStats } from './peers.js'
import {
  clamp,
  consumptionLabel,
  floorSub,
  higherIsBetter,
  litres,
  lowerIsBetter,
  oneDp,
  plural,
  signed,
} from './util.js'

/**
 * The criteria that mean the same thing whether you are hiring the car for a
 * month or keeping it for a decade. Both modes weight them independently, so
 * the shape is shared but the importance is not.
 */
export interface SharedWeights {
  category: number
  bootLitres: number
  seats: number
  fuel: number
  rating: number
  runningCosts: number
}

/**
 * Note which of these are gated on the user having actually said something:
 * category, boot, seats and fuel only appear once stated. Rating and running
 * costs are properties of the car rather than claims about the user, so they
 * are always in play — they are what stops an empty interview producing a
 * flat, arbitrary order.
 */
export function sharedContributions(
  listing: Listing,
  prefs: Preferences,
  stats: CommonStats,
  weights: SharedWeights,
): Contribution[] {
  const out: Contribution[] = []

  if (prefs.category !== undefined) {
    const match = listing.category === prefs.category
    out.push({
      label: 'Category match',
      weight: weights.category,
      sub: match ? 1 : -1,
      detail: match
        ? `${CATEGORY_LABELS[listing.category]}, the body style you asked for`
        : `${CATEGORY_LABELS[listing.category]}, not the ${CATEGORY_LABELS[prefs.category]} you asked for`,
    })
  }

  if (prefs.bootLitresMin !== undefined) {
    const min = prefs.bootLitresMin
    const gap = listing.bootLitres - min
    out.push({
      label: 'Boot space',
      weight: weights.bootLitres,
      // 40% over the stated floor is as much credit as extra boot can earn —
      // past that it is a different car, not a better answer.
      sub: floorSub(listing.bootLitres, min, min * 0.4),
      detail:
        gap >= 0
          ? `${litres(listing.bootLitres)}, ${litres(gap)} over your ${litres(min)} minimum`
          : `${litres(listing.bootLitres)}, ${litres(-gap)} short of your ${litres(min)} minimum`,
    })
  } else if (hasPriority(prefs, 'boot')) {
    // No floor stated, but boot space made the priority list — judge it against
    // the peers, so the stated priority genuinely reorders the shortlist.
    out.push({
      label: 'Boot space',
      weight: weights.bootLitres,
      sub: signed(higherIsBetter(listing.bootLitres, stats.bootLitres)),
      detail: `${litres(listing.bootLitres)}, against ${litres(stats.bootLitres.min)}–${litres(stats.bootLitres.max)} here`,
    })
  }

  if (prefs.seatsMin !== undefined) {
    const min = prefs.seatsMin
    const short = min - listing.seats
    out.push({
      label: 'Seats',
      weight: weights.seats,
      sub: short <= 0 ? floorSub(listing.seats, min, 2) : short === 1 ? -0.6 : -1,
      detail:
        short <= 0
          ? `${plural(listing.seats, 'seat')}, against the ${min} you need`
          : `${plural(listing.seats, 'seat')}, ${short} short of the ${min} you need`,
    })
  } else if (hasPriority(prefs, 'seats')) {
    out.push({
      label: 'Seats',
      weight: weights.seats,
      sub: signed(higherIsBetter(listing.seats, stats.seats)),
      detail: `${plural(listing.seats, 'seat')}, against ${stats.seats.min}–${stats.seats.max} here`,
    })
  }

  if (prefs.fuel !== undefined) {
    const match = listing.fuel === prefs.fuel
    out.push({
      label: 'Fuel type',
      weight: weights.fuel,
      sub: match ? 1 : -1,
      detail: match ? `${listing.fuel}, as requested` : `${listing.fuel}, not the ${prefs.fuel} you asked for`,
    })
  }

  out.push({
    label: 'Owner rating',
    weight: weights.rating,
    sub: signed(higherIsBetter(listing.rating, stats.rating)),
    detail: `Rated ${oneDp(listing.rating)} from ${plural(listing.reviewCount, 'review')}`,
  })

  // CO2 is comparable across every fuel (an EV is a genuine zero); consumption
  // is not, so it is only ever compared with cars burning the same thing.
  const co2Part = signed(lowerIsBetter(listing.co2, stats.co2))
  const fuelRange = stats.consumptionByFuel[listing.fuel]
  const consumptionPart = fuelRange ? signed(lowerIsBetter(listing.consumption, fuelRange)) : 0
  out.push({
    label: 'Running costs',
    weight: weights.runningCosts,
    sub: clamp(fuelRange ? 0.6 * co2Part + 0.4 * consumptionPart : co2Part, -1, 1),
    detail: `${listing.co2} g/km CO2, ${consumptionLabel(listing.consumption, listing.fuel === 'electric')}`,
  })

  return out
}
