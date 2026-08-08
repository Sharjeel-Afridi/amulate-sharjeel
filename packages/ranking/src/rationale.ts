import { budgetValue } from '@car/catalog'
import {
  CATEGORY_LABELS,
  type Listing,
  type Preferences,
  type ScoreFactor,
  isPurchase,
  isRental,
} from '@car/shared'
import { UNLIMITED_KM, euro, kms, litres, oneDp, plural, thousands } from './util.js'

/**
 * At most two clauses. One is often too thin to be convincing and three reads
 * like a brochure — and the whole point is that this line is checkable.
 */
const MAX_CLAIMS = 2

/**
 * Priority convention: claims that cite something the user actually said are
 * numbered 40 and up, claims that are merely true about the car below it. So
 * sorting by priority guarantees a stated criterion leads whenever one exists,
 * and the comparative forms ("biggest", "only one") outrank the flat ones.
 */
interface Claim {
  /** Only one claim per topic survives, so we never say "big boot" twice. */
  topic: string
  priority: number
  /** A sentence fragment, capitalised, without a trailing full stop. */
  text: string
}

interface StatedCriterion {
  label: string
  test: (l: Listing) => boolean
}

/**
 * Which topic each score factor is really talking about, so a fallback clause
 * lifted from the trace cannot repeat a point the comparative claims already
 * made — "Instant booking, from 1 day. Hires from 1 day." is two sentences
 * saying one thing.
 */
const FACTOR_TOPICS: Record<string, string> = {
  'Monthly rate': 'price',
  'Purchase price': 'price',
  'Finance monthly': 'price',
  'Category match': 'category',
  'Boot space': 'boot',
  Seats: 'seats',
  'Fuel type': 'fuel',
  'Free kilometres': 'mileage',
  Mileage: 'mileage',
  'Minimum hire': 'availability',
  'Instant booking': 'availability',
  'Insurance excess': 'excess',
  Age: 'age',
  Warranty: 'warranty',
  'Previous owners': 'owners',
  'Owner rating': 'rating',
  'Running costs': 'emissions',
}

/**
 * The hard criteria the user actually gave us, as testable predicates. Used
 * both for the "only one that clears every box" claim and to phrase it.
 */
function statedCriteria(prefs: Preferences, listing: Listing): StatedCriterion[] {
  const out: StatedCriterion[] = []
  const perMonth = isRental(listing) ? ' a month' : ''

  if (prefs.category !== undefined) {
    const c = prefs.category
    out.push({ label: CATEGORY_LABELS[c], test: (l) => l.category === c })
  }
  if (prefs.budgetMax !== undefined) {
    const b = prefs.budgetMax
    out.push({ label: `under ${euro(b)}${perMonth}`, test: (l) => budgetValue(l) <= b })
  }
  if (prefs.bootLitresMin !== undefined) {
    const m = prefs.bootLitresMin
    out.push({ label: `${litres(m)} of boot`, test: (l) => l.bootLitres >= m })
  }
  if (prefs.seatsMin !== undefined) {
    const m = prefs.seatsMin
    out.push({ label: `${m} seats`, test: (l) => l.seats >= m })
  }
  if (prefs.fuel !== undefined) {
    const f = prefs.fuel
    out.push({ label: f, test: (l) => l.fuel === f })
  }
  if (prefs.transmission !== undefined) {
    const t = prefs.transmission
    out.push({ label: t, test: (l) => l.transmission === t })
  }
  if (prefs.location !== undefined) {
    const loc = prefs.location.toLowerCase()
    out.push({ label: `in ${prefs.location}`, test: (l) => l.location.toLowerCase() === loc })
  }
  if (prefs.maxMileageKm !== undefined) {
    const cap = prefs.maxMileageKm
    out.push({ label: `under ${kms(cap)}`, test: (l) => !isPurchase(l) || l.mileageKm <= cap })
  }
  if (prefs.minYear !== undefined) {
    const y = prefs.minYear
    out.push({ label: `${y} or newer`, test: (l) => l.year >= y })
  }

  return out
}

/**
 * The deterministic rationale. An LLM may later rewrite the wording, but this
 * is the version that has to be defensible on its own: every clause cites a
 * number off this listing, and every comparative claim ("biggest", "only one")
 * is checked against `peers` before it is made.
 *
 * `peers` is the candidate set this listing is being ranked within; the listing
 * itself may be included and is filtered out. Preferences the user never stated
 * produce no clause at all — we would rather say less than invent a motive.
 */
export function buildRationale(
  listing: Listing,
  prefs: Preferences,
  factors: ScoreFactor[],
  peers: Listing[],
): string {
  // Comparing a rental against a purchase on price would be meaningless, so
  // superlatives are only ever claimed within the same product.
  const others = peers.filter((p) => p.id !== listing.id && p.mode === listing.mode)
  const claims: Claim[] = []
  const add = (topic: string, priority: number, text: string) => claims.push({ topic, priority, text })

  const strictMax = (select: (l: Listing) => number) =>
    others.length > 0 && others.every((o) => select(o) < select(listing))
  const strictMin = (select: (l: Listing) => number) =>
    others.length > 0 && others.every((o) => select(o) > select(listing))
  // Ties are common — boot capacity is quoted in 5 L steps and rates in 5s — so
  // "joint biggest" is worth saying rather than dropping the comparison.
  const jointMax = (select: (l: Listing) => number) =>
    others.length > 0 && others.every((o) => select(o) <= select(listing)) && !strictMax(select)
  const jointMin = (select: (l: Listing) => number) =>
    others.length > 0 && others.every((o) => select(o) >= select(listing)) && !strictMin(select)
  const onlyOne = (test: (l: Listing) => boolean) =>
    test(listing) && others.length > 0 && others.every((o) => !test(o))

  const value = budgetValue(listing)
  const perMonth = isRental(listing) ? ' a month' : ''
  const budget = prefs.budgetMax

  // "of anything under your €400" is only honest if every peer really is under
  // €400 and so is this one; otherwise the superlative is scoped to the set.
  // Not used for the price claims themselves, which would then say "€400 a
  // month" twice in one breath.
  const budgetHolds =
    budget !== undefined && value <= budget && others.every((o) => budgetValue(o) <= budget)
  const scope = budgetHolds ? `of anything under your ${euro(budget)}${perMonth}` : 'in this shortlist'

  // --- Strongest claim available: it alone clears the whole brief -----------
  const criteria = statedCriteria(prefs, listing)
  if (criteria.length >= 2) {
    const meetsAll = (l: Listing) => criteria.every((c) => c.test(l))
    if (onlyOne(meetsAll)) {
      add('all', 100, `The only one here that clears every box you set — ${criteria.map((c) => c.label).join(', ')}`)
    }
  }

  // --- Budget --------------------------------------------------------------
  if (budget !== undefined) {
    const gap = budget - value
    if (gap >= 0 && strictMin(budgetValue)) {
      add('price', 90, `Cheapest in this shortlist at ${euro(value)}${perMonth}, leaving ${euro(gap)} of your ${euro(budget)}`)
    } else if (gap >= 0 && jointMin(budgetValue)) {
      add('price', 85, `Joint cheapest here at ${euro(value)}${perMonth}, leaving ${euro(gap)} of your ${euro(budget)}`)
    } else if (gap >= 0) {
      add('price', 50, `${euro(value)}${perMonth}, ${euro(gap)} inside the ${euro(budget)} you set`)
    } else {
      add('price', 45, `${euro(value)}${perMonth}, ${euro(-gap)} above the ${euro(budget)} you set`)
    }
  }

  // --- Boot ----------------------------------------------------------------
  if (prefs.bootLitresMin !== undefined) {
    const min = prefs.bootLitresMin
    const gap = listing.bootLitres - min
    if (gap >= 0 && strictMax((l) => l.bootLitres)) {
      add(
        'boot',
        95,
        `Biggest boot at ${litres(listing.bootLitres)} ${scope}, ${litres(gap)} past the ${litres(min)} you asked for`,
      )
    } else if (gap >= 0 && jointMax((l) => l.bootLitres)) {
      add(
        'boot',
        86,
        `Joint biggest boot at ${litres(listing.bootLitres)} ${scope}, ${litres(gap)} past the ${litres(min)} you asked for`,
      )
    } else if (gap > 0) {
      add('boot', 60, `${litres(listing.bootLitres)} of boot, ${litres(gap)} over your ${litres(min)} minimum`)
    } else if (gap === 0) {
      add('boot', 60, `Exactly the ${litres(min)} of boot you asked for`)
    } else {
      add('boot', 55, `${litres(listing.bootLitres)} of boot, ${litres(-gap)} short of your ${litres(min)} minimum`)
    }
  }

  // --- Seats ---------------------------------------------------------------
  if (prefs.seatsMin !== undefined) {
    const min = prefs.seatsMin
    if (listing.seats >= min && strictMax((l) => l.seats)) {
      add('seats', 70, `Most seats ${scope} at ${listing.seats}, against the ${min} you need`)
    } else if (listing.seats >= min) {
      add('seats', 40, `${plural(listing.seats, 'seat')}, meeting the ${min} you need`)
    } else {
      add('seats', 44, `${plural(listing.seats, 'seat')}, ${min - listing.seats} short of the ${min} you need`)
    }
  }

  // --- Fuel and location ---------------------------------------------------
  if (prefs.fuel !== undefined && listing.fuel === prefs.fuel) {
    const fuel = prefs.fuel
    if (onlyOne((l) => l.fuel === fuel)) add('fuel', 80, `The only ${fuel} car in this shortlist`)
    else add('fuel', 41, `${fuel[0].toUpperCase()}${fuel.slice(1)}, as you asked`)
  }
  if (prefs.location !== undefined && listing.location.toLowerCase() === prefs.location.toLowerCase()) {
    add('location', 43, `Sitting in ${listing.location}, where you wanted it`)
  }

  // --- Rental-only ---------------------------------------------------------
  if (isRental(listing)) {
    const unlimited = listing.freeKmPerDay >= UNLIMITED_KM
    if (unlimited && onlyOne((l) => isRental(l) && l.freeKmPerDay >= UNLIMITED_KM)) {
      add('mileage', 75, 'The only one here with unlimited kilometres')
    } else if (unlimited) {
      add('mileage', 34, 'Unlimited kilometres a day, so no excess-mileage charge to watch')
    } else if (strictMax((l) => (isRental(l) ? l.freeKmPerDay : 0))) {
      add('mileage', 62, `Most generous allowance here at ${thousands(listing.freeKmPerDay)} free km a day`)
    }
    if (listing.instantBook && onlyOne((l) => isRental(l) && l.instantBook)) {
      add('availability', 33, 'The only one here you can book instantly')
    } else if (listing.instantBook) {
      add('availability', 31, `Instant booking, from ${plural(listing.minRentalDays, 'day')}`)
    }
    if (strictMin((l) => (isRental(l) ? l.excess : 0))) {
      add('excess', 32, `Lowest insurance excess here at ${euro(listing.excess)}`)
    }
  }

  // --- Purchase-only -------------------------------------------------------
  if (isPurchase(listing)) {
    const odo = (l: Listing) => (isPurchase(l) ? l.mileageKm : 0)
    if (prefs.maxMileageKm !== undefined) {
      const cap = prefs.maxMileageKm
      const gap = cap - listing.mileageKm
      if (gap >= 0 && strictMin(odo)) {
        add('mileage', 88, `Lowest mileage ${scope} at ${kms(listing.mileageKm)}, ${kms(gap)} inside your ${kms(cap)} limit`)
      } else if (gap >= 0 && jointMin(odo)) {
        add('mileage', 84, `Joint lowest mileage ${scope} at ${kms(listing.mileageKm)}, ${kms(gap)} inside your ${kms(cap)} limit`)
      } else if (gap >= 0) {
        add('mileage', 52, `${kms(listing.mileageKm)} on the clock, ${kms(gap)} inside your ${kms(cap)} limit`)
      } else {
        add('mileage', 47, `${kms(listing.mileageKm)} on the clock, ${kms(-gap)} past your ${kms(cap)} limit`)
      }
    } else if (strictMin(odo)) {
      add('mileage', 36, `Lowest mileage here at ${kms(listing.mileageKm)}`)
    }

    if (prefs.minYear !== undefined && listing.year >= prefs.minYear) {
      const gap = listing.year - prefs.minYear
      if (strictMax((l) => l.year)) add('age', 58, `Newest ${scope} at ${listing.year}`)
      else if (gap > 0) add('age', 42, `A ${listing.year} car, ${plural(gap, 'year')} past your ${prefs.minYear} cut-off`)
      else add('age', 42, `A ${listing.year} car, exactly your cut-off`)
    } else if (strictMax((l) => l.year)) {
      add('age', 37, `Newest here at ${listing.year}`)
    }

    if (listing.warrantyMonths > 0 && strictMax((l) => (isPurchase(l) ? l.warrantyMonths : 0))) {
      add('warranty', 38, `Longest cover here at ${plural(listing.warrantyMonths, 'month')} of warranty`)
    }
    if (listing.previousOwners === 1 && onlyOne((l) => isPurchase(l) && l.previousOwners === 1)) {
      add('owners', 35, 'The only one-owner car in this shortlist')
    }
  }

  // --- Claims about the car rather than about the user ---------------------
  if (strictMax((l) => l.rating)) {
    add('rating', 25, `Highest rated here at ${oneDp(listing.rating)} from ${plural(listing.reviewCount, 'review')}`)
  }
  if (listing.co2 === 0 && onlyOne((l) => l.co2 === 0)) {
    add('emissions', 22, 'The only zero-emission car in this shortlist')
  }

  // Last resorts for a thin interview, so the line is never empty and never
  // vague: the two things the score liked most, in its own words, and failing
  // that a plain factual summary. Each gets its own topic so the two cannot
  // collapse into one, and the summary sits last because it partly restates
  // whatever led.
  factors
    .filter((f) => f.delta > 0)
    .slice(0, 2)
    .forEach((f, i) => add(FACTOR_TOPICS[f.label] ?? `factor:${f.label}`, 10 - i * 5, f.detail))
  add('summary', 0, summarise(listing))

  const ordered = [...claims].sort(
    (a, b) => b.priority - a.priority || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0),
  )
  const chosen: Claim[] = []
  for (const claim of ordered) {
    if (chosen.length >= MAX_CLAIMS) break
    if (chosen.some((c) => c.topic === claim.topic)) continue
    chosen.push(claim)
  }

  let text = chosen.map((c) => c.text).join('. ')
  // A rationale with no number in it is exactly the kind of filler this
  // function exists to avoid, so fall back to the factual summary.
  if (!/\d/.test(text)) text += `. ${summarise(listing)}`
  return `${text}.`
}

function summarise(listing: Listing): string {
  if (isRental(listing)) {
    return `${euro(listing.monthlyRate)} a month, ${litres(listing.bootLitres)} of boot, rated ${oneDp(listing.rating)}`
  }
  return `${euro(listing.price)}, ${kms(listing.mileageKm)} on the clock, rated ${oneDp(listing.rating)}`
}
