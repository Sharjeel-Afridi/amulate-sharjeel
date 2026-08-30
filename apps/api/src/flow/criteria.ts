import {
  type Category,
  type Criterion,
  type FuelType,
  MAX_PRIORITIES,
  type Preferences,
  type Transmission,
  money,
} from '@car/shared'

/**
 * What an interview answer means, and what the answers add up to.
 *
 * Two functions, one direction: an answer becomes a preference patch, and the
 * preferences become the criteria a search screens on. Criteria are never stored
 * alongside preferences and never edited in place — they are derived from
 * scratch at the point of use, so they cannot drift out of step with the answers
 * they came from.
 */

/** What one answered question changes. */
export interface AnswerOutcome {
  patch: Preferences
  /**
   * Fields the answer explicitly *removes* a constraint from — "No preference"
   * on fuel, "Doesn't matter" on mileage. Distinct from being absent from
   * `patch`, which can only ever add or overwrite.
   */
  clear: (keyof Preferences)[]
}

/**
 * Maps one answered question onto preferences.
 *
 * The control already constrained the value to a valid option and the question
 * id already says which field it fills, so there is nothing here for a model to
 * work out.
 */
export function answerToPreferences(questionId: string, raw: unknown): AnswerOutcome {
  const values = (Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')]).map((v) => v.trim())
  const first = values[0] ?? ''
  const num = Number(first) || undefined

  // A number of 0 means "no constraint", not "a limit of zero", so those answers
  // clear the field rather than writing it.
  switch (questionId) {
    case 'mode':
      return first === 'rent' || first === 'buy' ? set({ mode: first }) : none()
    case 'useCase':
      return first ? set({ useCase: first }) : none()
    case 'passengers':
      return num ? set({ seatsMin: num }) : clear('seatsMin')
    case 'category':
      return first && first !== 'unsure' ? set({ category: first as Category }) : clear('category')
    case 'budget':
    case 'budgetBuy':
      return num ? set({ budgetMax: num }) : clear('budgetMax')
    case 'targetDate':
      return first ? set({ targetDate: first.slice(0, 10) }) : clear('targetDate')
    case 'returnDate':
      return first ? set({ returnDate: first.slice(0, 10) }) : clear('returnDate')
    case 'luggage':
      return num ? set({ bootLitresMin: num }) : clear('bootLitresMin')
    case 'mileage':
      return num ? set({ maxMileageKm: num }) : clear('maxMileageKm')
    case 'fuel':
      return first && first !== 'any' ? set({ fuel: first as FuelType }) : clear('fuel')
    case 'transmission':
      return first && first !== 'any'
        ? set({ transmission: first as Transmission })
        : clear('transmission')
    case 'dealbreakers':
      // Replaces rather than appends: unticking one has to actually remove it.
      return set({ dealbreakers: values.filter((v) => v && v !== 'none') })
    case 'priorities':
    case 'prioritiesBuy': {
      // Capped, not just suggested: four "top" priorities dilute the boost each
      // one buys until none of them reorders anything.
      const picks = values.filter(Boolean).slice(0, MAX_PRIORITIES)
      return picks.length > 0 ? set({ priorities: picks }) : clear('priorities')
    }
    default:
      return none()
  }
}

const set = (patch: Preferences): AnswerOutcome => ({ patch, clear: [] })
const clear = (...fields: (keyof Preferences)[]): AnswerOutcome => ({ patch: {}, clear: fields })
const none = (): AnswerOutcome => ({ patch: {}, clear: [] })

/**
 * Relative importance for the soft criteria, mirroring the scorer's weights for
 * the same fields. These only order the soft list the ranking agent is shown —
 * the scorer does the real arithmetic straight from `Preferences`.
 */
const SOFT_WEIGHTS = { budget: 22, boot: 10 } as const

/** Dealbreakers that fail a car outright. Anything unrecognised is ignored. */
const EXCLUSIONS: Record<string, Omit<Criterion, 'kind'>> = {
  'no-diesel': { id: 'no-diesel', label: 'No diesel', field: 'fuel', op: 'neq', value: 'diesel' },
  'no-manual': {
    id: 'no-manual',
    label: 'No manual',
    field: 'transmission',
    op: 'neq',
    value: 'manual',
  },
  'no-old': {
    id: 'no-old',
    label: 'Nothing over 5 years old',
    field: 'year',
    op: 'gte',
    value: new Date().getFullYear() - 5,
  },
  'no-two-door': { id: 'no-two-door', label: 'No two-door', field: 'doors', op: 'gte', value: 4 },
  // 9999 is the catalogue's sentinel for unlimited kilometres.
  'no-km-cap': {
    id: 'no-km-cap',
    label: 'No mileage cap',
    field: 'freeKmPerDay',
    op: 'gte',
    value: 9999,
  },
}

/**
 * The whole spec, as checkable criteria.
 *
 * Pure and idempotent: same preferences in, same criteria out, however many
 * times it runs. That is what lets the search derive them itself rather than
 * relying on some earlier UI handler having kept them up to date.
 *
 * A `requirement` is as absolute as a dealbreaker — `assess` disqualifies on
 * either — so only genuinely pass/fail answers get one. Answers that are our
 * approximation of what someone said (the boot litres behind "pram and big
 * luggage", a budget they did not call strict) come out as `preference`, which
 * ranks rather than filters.
 */
export function buildCriteria(prefs: Preferences): Criterion[] {
  const dealbreakers = prefs.dealbreakers ?? []
  const out: Criterion[] = dealbreakers
    .map((d) => EXCLUSIONS[d])
    .filter((c): c is Omit<Criterion, 'kind'> => c !== undefined)
    .map((c) => ({ ...c, kind: 'exclusion' as const }))

  if (prefs.category) {
    out.push({
      id: 'category',
      kind: 'requirement',
      // "estate" and "suv" need different articles, and this label is on the
      // screen the user is asked to approve.
      label: `${/^[aeiou]/i.test(prefs.category) ? 'An' : 'A'} ${prefs.category}`,
      field: 'category',
      op: 'eq',
      value: prefs.category,
    })
  }
  if (prefs.seatsMin) {
    out.push({
      id: 'seats',
      kind: 'requirement',
      label: `Seats at least ${prefs.seatsMin}`,
      field: 'seats',
      op: 'gte',
      value: prefs.seatsMin,
    })
  }
  if (prefs.maxMileageKm) {
    out.push({
      id: 'mileage',
      kind: 'requirement',
      label: `Under ${prefs.maxMileageKm.toLocaleString('en-IE')} km`,
      field: 'mileageKm',
      op: 'lte',
      value: prefs.maxMileageKm,
    })
  }
  if (prefs.bootLitresMin) {
    // Soft: the litre figure is ours, not theirs. "Pram, sports kit, big
    // luggage" becomes 460 L because the chips have to carry a number, and
    // rejecting a 450 L boot against a threshold we picked is false precision.
    out.push({
      id: 'boot',
      kind: 'preference',
      weight: SOFT_WEIGHTS.boot,
      label: `Boot over ${prefs.bootLitresMin} L`,
      field: 'bootLitres',
      op: 'gte',
      value: prefs.bootLitresMin,
    })
  }
  if (prefs.budgetMax) {
    // A veto only if the user called it one. Otherwise over-budget cars stay on
    // the shortlist and are banded below everything affordable — "a bit over" is
    // often worth seeing, but is never the better answer.
    const strict = dealbreakers.includes('strict-budget')
    out.push({
      id: 'budget',
      kind: strict ? 'exclusion' : 'preference',
      ...(strict ? {} : { weight: SOFT_WEIGHTS.budget }),
      label: `Within ${money(prefs.budgetMax)}`,
      field: 'price',
      op: 'lte',
      value: prefs.budgetMax,
    })
  }

  return out
}
