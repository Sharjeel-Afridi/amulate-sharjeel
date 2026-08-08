import type { Listing } from './domain.js'

/**
 * The interview turns what someone says into checkable criteria.
 *
 * Three kinds, not two. Splitting hard constraints from soft ones is what lets
 * the shortlist be both short and ranked: exclusions and requirements decide
 * *whether* a car qualifies, preferences decide *where* it places among the ones
 * that do. Collapsing them either over-filters (rejecting a good car for missing
 * a nice-to-have) or under-ranks (everything that passes looks identical).
 */
export type CriterionKind =
  /** A dealbreaker. Fails the car outright, however well it scores elsewhere. */
  | 'exclusion'
  /** Must be satisfied to qualify, but stated as a need rather than a veto. */
  | 'requirement'
  /** Soft. Never disqualifies; drives ranking among the cars that qualified. */
  | 'preference'

export type CriterionOp = 'eq' | 'neq' | 'lte' | 'gte' | 'in' | 'nin'

export interface Criterion {
  id: string
  kind: CriterionKind
  /** The user's own phrasing, so the UI can quote it back verbatim. */
  label: string
  /** A field on Listing, or a derived key the evaluator understands. */
  field: string
  op: CriterionOp
  value: unknown
  /** Preferences only. Relative importance; ignored for hard criteria. */
  weight?: number
}

/** One criterion checked against one listing, with the fact that decided it. */
export interface CriterionVerdict {
  criterion: Criterion
  passed: boolean
  /** The specific detail that decided it — "1.5 L diesel", "635 L boot". */
  evidence: string
}

export interface ListingAssessment {
  listing: Listing
  verdicts: CriterionVerdict[]
  /** Qualifies only if every exclusion and requirement passed. */
  qualified: boolean
  /** The first hard criterion it failed, for the ruled-out explanation. */
  failedOn?: CriterionVerdict
}

/** Derived values that aren't plain Listing fields. */
function fieldValue(listing: Listing, field: string): unknown {
  if (field in listing) return (listing as unknown as Record<string, unknown>)[field]

  switch (field) {
    case 'price':
      return listing.mode === 'buy' ? listing.price : listing.monthlyRate
    case 'monthlyCost':
      return listing.mode === 'rent' ? listing.monthlyRate : listing.financeMonthly
    case 'age':
      return undefined
    default:
      return undefined
  }
}

function compare(op: CriterionOp, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'in':
      return Array.isArray(expected) && expected.includes(actual)
    case 'nin':
      return Array.isArray(expected) && !expected.includes(actual)
  }
}

const UNITS: Record<string, string> = {
  bootLitres: ' L boot',
  seats: ' seats',
  mileageKm: ' km',
  consumption: ' L/100km',
  co2: ' g/km CO2',
  year: '',
}

function describeEvidence(listing: Listing, field: string, actual: unknown): string {
  if (actual === undefined || actual === null) return `no ${field} listed`
  const unit = UNITS[field] ?? ''
  if (field === 'price' || field === 'monthlyCost') {
    const suffix = listing.mode === 'rent' ? '/month' : ''
    return `€${Number(actual).toLocaleString('en-IE')}${suffix}`
  }
  return `${String(actual)}${unit}`
}

export function evaluateCriterion(listing: Listing, criterion: Criterion): CriterionVerdict {
  const actual = fieldValue(listing, criterion.field)
  // An unknown field cannot disqualify a car — silently failing everything on a
  // typo would empty the shortlist with no visible cause.
  const passed = actual === undefined ? true : compare(criterion.op, actual, criterion.value)
  return { criterion, passed, evidence: describeEvidence(listing, criterion.field, actual) }
}

export function assess(listing: Listing, criteria: Criterion[]): ListingAssessment {
  const verdicts = criteria.map((c) => evaluateCriterion(listing, c))
  const hardFailure = verdicts.find((v) => !v.passed && v.criterion.kind !== 'preference')
  return {
    listing,
    verdicts,
    qualified: !hardFailure,
    failedOn: hardFailure,
  }
}

export interface ScreenResult {
  qualified: ListingAssessment[]
  ruledOut: ListingAssessment[]
  /** How many cars each hard criterion eliminated, worst offender first. */
  attribution: { criterion: Criterion; eliminated: number }[]
}

/**
 * Applies the hard criteria and reports what each one cost.
 *
 * The attribution matters as much as the filtering: when a dealbreaker empties
 * the list, the user needs to know which one did it and by how much, so they can
 * make an informed trade rather than staring at an empty result.
 */
export function screen(listings: Listing[], criteria: Criterion[]): ScreenResult {
  const hard = criteria.filter((c) => c.kind !== 'preference')
  const assessments = listings.map((l) => assess(l, criteria))

  const attribution = hard
    .map((criterion) => ({
      criterion,
      eliminated: listings.filter((l) => !evaluateCriterion(l, criterion).passed).length,
    }))
    .filter((a) => a.eliminated > 0)
    .sort((a, b) => b.eliminated - a.eliminated)

  return {
    qualified: assessments.filter((a) => a.qualified),
    ruledOut: assessments.filter((a) => !a.qualified),
    attribution,
  }
}
