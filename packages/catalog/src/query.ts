import {
  type Category,
  type FuelType,
  type Listing,
  type Mode,
  type Transmission,
  isPurchase,
  isRental,
} from '@car/shared'

export interface SearchQuery {
  mode: Mode
  category?: Category
  brands?: string[]
  /** Monthly rate for rentals, total price for purchases. */
  budgetMax?: number
  budgetMin?: number
  seatsMin?: number
  bootLitresMin?: number
  fuel?: FuelType
  transmission?: Transmission
  maxMileageKm?: number
  minYear?: number
  location?: string
  limit?: number
}

export interface SearchResult {
  listings: Listing[]
  totalScanned: number
  matched: number
  /** Constraints dropped to reach a usable result set, newest first. */
  relaxed: string[]
}

/** The number a listing is judged against for budget purposes. */
export function budgetValue(l: Listing): number {
  return isRental(l) ? l.monthlyRate : l.price
}

type Predicate = { key: string; test: (l: Listing) => boolean }

function predicates(q: SearchQuery): Predicate[] {
  const p: Predicate[] = []

  if (q.category) p.push({ key: 'category', test: (l) => l.category === q.category })
  if (q.brands?.length) {
    const set = new Set(q.brands.map((b) => b.toLowerCase()))
    p.push({ key: 'brands', test: (l) => set.has(l.brand.toLowerCase()) })
  }
  if (q.budgetMax !== undefined) p.push({ key: 'budgetMax', test: (l) => budgetValue(l) <= q.budgetMax! })
  if (q.budgetMin !== undefined) p.push({ key: 'budgetMin', test: (l) => budgetValue(l) >= q.budgetMin! })
  if (q.seatsMin !== undefined) p.push({ key: 'seatsMin', test: (l) => l.seats >= q.seatsMin! })
  if (q.bootLitresMin !== undefined) p.push({ key: 'bootLitresMin', test: (l) => l.bootLitres >= q.bootLitresMin! })
  if (q.fuel) p.push({ key: 'fuel', test: (l) => l.fuel === q.fuel })
  if (q.transmission) p.push({ key: 'transmission', test: (l) => l.transmission === q.transmission })
  if (q.location) p.push({ key: 'location', test: (l) => l.location.toLowerCase() === q.location!.toLowerCase() })
  if (q.minYear !== undefined) p.push({ key: 'minYear', test: (l) => l.year >= q.minYear! })
  if (q.maxMileageKm !== undefined) {
    p.push({ key: 'maxMileageKm', test: (l) => !isPurchase(l) || l.mileageKm <= q.maxMileageKm! })
  }

  return p
}

/**
 * Order in which constraints get dropped when a strict search comes back too
 * thin. Softest first — we'd rather show a car with a smaller boot than one in
 * the wrong city. Budget is stretched rather than dropped.
 */
const RELAX_ORDER = ['transmission', 'fuel', 'bootLitresMin', 'minYear', 'maxMileageKm', 'location', 'seatsMin']

const MIN_USEFUL_RESULTS = 4

/**
 * Filters the catalogue. If strict filtering returns fewer than a handful of
 * results, constraints are progressively relaxed and the caller is told which —
 * so the agent can report honestly rather than silently widening the search.
 */
export function searchListings(catalog: Listing[], q: SearchQuery): SearchResult {
  const pool = catalog.filter((l) => l.mode === q.mode)
  const all = predicates(q)
  const relaxed: string[] = []

  let active = all
  let matches = pool.filter((l) => active.every((p) => p.test(l)))

  for (const key of RELAX_ORDER) {
    if (matches.length >= MIN_USEFUL_RESULTS) break
    if (!active.some((p) => p.key === key)) continue
    active = active.filter((p) => p.key !== key)
    relaxed.push(key)
    matches = pool.filter((l) => active.every((p) => p.test(l)))
  }

  // Stretch the budget before dropping it — a 20% overshoot is still a useful answer.
  if (matches.length < MIN_USEFUL_RESULTS && q.budgetMax !== undefined) {
    const stretched = q.budgetMax * 1.2
    const withoutBudget = active.filter((p) => p.key !== 'budgetMax')
    const stretchedMatches = pool.filter(
      (l) => withoutBudget.every((p) => p.test(l)) && budgetValue(l) <= stretched,
    )
    if (stretchedMatches.length > matches.length) {
      active = [...withoutBudget, { key: 'budgetMax', test: (l) => budgetValue(l) <= stretched }]
      relaxed.push('budgetMax+20%')
      matches = stretchedMatches
    }
  }

  // Nothing exists at this budget at all. Returning an empty set tells the user
  // nothing useful, so return the cheapest that meet every other constraint and
  // report the budget as dropped — the agent can then say "nothing under X, but".
  if (matches.length === 0 && q.budgetMax !== undefined) {
    const withoutBudget = active.filter((p) => p.key !== 'budgetMax')
    const cheapest = pool
      .filter((l) => withoutBudget.every((p) => p.test(l)))
      .sort((a, b) => budgetValue(a) - budgetValue(b))
    if (cheapest.length) {
      matches = cheapest
      relaxed.splice(relaxed.indexOf('budgetMax+20%'), 1)
      relaxed.push('budgetMax:dropped')
    }
  }

  // Absolute floor: keep mode and category, drop everything else.
  if (matches.length === 0) {
    matches = pool.filter((l) => !q.category || l.category === q.category)
    if (matches.length) relaxed.push('all-but-category:dropped')
  }

  return {
    listings: q.limit ? matches.slice(0, q.limit) : matches,
    totalScanned: pool.length,
    matched: matches.length,
    relaxed,
  }
}
