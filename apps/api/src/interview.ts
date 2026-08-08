import { CATEGORIES, CATEGORY_LABELS, type Criterion, type Mode, type Preferences } from '@car/shared'

/**
 * The interview plan.
 *
 * Deliberately long. An earlier version asked only for whatever the opening
 * sentence hadn't already revealed, which collapsed to two questions and made
 * the agent feel like a search box with manners. Buying or hiring a car is a
 * considered decision; the interview should feel like one.
 *
 * Dealbreakers get their own question because people are far more certain about
 * what they will reject than about what they want — it is the highest-signal
 * answer in the whole conversation, and it is what makes the shortlist short.
 */

export type ControlKind = 'chips' | 'multi' | 'slider' | 'date' | 'text'

export interface Question {
  id: string
  /** Which preference or criteria bucket the answer feeds. */
  topic: string
  ask: string
  control: ControlKind
  options?: { label: string; value: string }[]
  min?: number
  max?: number
  step?: number
  unit?: string
  /** Only asked when renting, or only when buying. Omit for both. */
  appliesTo?: Mode
  /** Skippable without blocking the spec. */
  optional?: boolean
}

const categoryOptions = [
  ...CATEGORIES.map((c) => ({ label: CATEGORY_LABELS[c], value: c })),
  { label: "Not sure — help me choose", value: 'unsure' },
]

export const QUESTIONS: Question[] = [
  {
    id: 'mode',
    topic: 'mode',
    ask: 'First things first — are you looking to rent, or to buy?',
    control: 'chips',
    options: [
      { label: 'Rent', value: 'rent' },
      { label: 'Buy', value: 'buy' },
    ],
  },
  {
    id: 'useCase',
    topic: 'useCase',
    ask: 'What will you mainly use it for? A sentence is plenty.',
    control: 'text',
  },
  {
    id: 'passengers',
    topic: 'seatsMin',
    ask: 'How many people need to fit, most of the time?',
    control: 'chips',
    options: [
      { label: 'Just me, or two of us', value: '2' },
      { label: 'Three or four', value: '4' },
      { label: 'Five', value: '5' },
      { label: 'Six or more', value: '7' },
    ],
  },
  {
    id: 'category',
    topic: 'category',
    ask: 'Any particular kind of car in mind?',
    control: 'chips',
    options: categoryOptions,
  },
  {
    id: 'budget',
    topic: 'budgetMax',
    ask: "What's the most you'd want to spend?",
    control: 'slider',
    min: 150,
    max: 1500,
    step: 25,
    unit: '€/month',
    appliesTo: 'rent',
  },
  {
    id: 'budgetBuy',
    topic: 'budgetMax',
    ask: "What's the most you'd want to spend?",
    control: 'slider',
    min: 5000,
    max: 120000,
    step: 1000,
    unit: '€',
    appliesTo: 'buy',
  },
  {
    id: 'targetDate',
    topic: 'targetDate',
    ask: 'When do you need it from?',
    control: 'date',
  },
  {
    id: 'returnDate',
    topic: 'returnDate',
    ask: 'And until when?',
    control: 'date',
    appliesTo: 'rent',
  },
  {
    id: 'luggage',
    topic: 'bootLitresMin',
    ask: 'How much are you usually carrying?',
    control: 'chips',
    options: [
      { label: 'Not much', value: '0' },
      { label: 'Weekly shop, a couple of bags', value: '350' },
      { label: 'Pram, sports kit, big luggage', value: '450' },
      { label: 'As much as possible', value: '600' },
    ],
  },
  {
    id: 'fuel',
    topic: 'fuel',
    ask: 'Any preference on fuel?',
    control: 'chips',
    options: [
      { label: 'No preference', value: 'any' },
      { label: 'Petrol', value: 'petrol' },
      { label: 'Diesel', value: 'diesel' },
      { label: 'Hybrid', value: 'hybrid' },
      { label: 'Electric', value: 'electric' },
    ],
    optional: true,
  },
  {
    id: 'transmission',
    topic: 'transmission',
    ask: 'Automatic or manual?',
    control: 'chips',
    options: [
      { label: 'No preference', value: 'any' },
      { label: 'Automatic', value: 'automatic' },
      { label: 'Manual', value: 'manual' },
    ],
    optional: true,
  },
  {
    id: 'mileage',
    topic: 'maxMileageKm',
    ask: 'How much mileage would you accept?',
    control: 'chips',
    options: [
      { label: 'Under 30,000 km', value: '30000' },
      { label: 'Under 60,000 km', value: '60000' },
      { label: 'Under 100,000 km', value: '100000' },
      { label: "Doesn't matter", value: '0' },
    ],
    appliesTo: 'buy',
  },
  {
    id: 'dealbreakers',
    topic: 'dealbreakers',
    ask: 'Last one, and the most useful — anything that would rule a car out completely?',
    control: 'multi',
    options: [
      { label: 'No diesel', value: 'no-diesel' },
      { label: 'No manual', value: 'no-manual' },
      { label: 'Nothing over 5 years old', value: 'no-old' },
      { label: 'No two-door', value: 'no-two-door' },
      { label: 'No mileage cap on the hire', value: 'no-km-cap' },
      { label: 'Nothing above my budget', value: 'strict-budget' },
      { label: 'Nothing to rule out', value: 'none' },
    ],
    optional: true,
  },
]

/** The next unanswered question, respecting mode. Undefined means done. */
export function nextQuestion(prefs: Preferences, answered: Set<string>): Question | undefined {
  return QUESTIONS.find((q) => {
    if (answered.has(q.id)) return false
    if (q.appliesTo && prefs.mode && q.appliesTo !== prefs.mode) return false
    // Mode gates every mode-specific question, so it must be answered first.
    if (q.appliesTo && !prefs.mode) return false
    return true
  })
}

export function questionsRemaining(prefs: Preferences, answered: Set<string>): number {
  return QUESTIONS.filter((q) => {
    if (answered.has(q.id)) return false
    if (q.appliesTo && prefs.mode && q.appliesTo !== prefs.mode) return false
    if (q.appliesTo && !prefs.mode) return false
    return q.optional !== true
  }).length
}

/**
 * Turns the dealbreaker answers into hard exclusions.
 *
 * These are the only criteria that can disqualify a car outright, so they are
 * built explicitly rather than inferred from preferences — a user who merely
 * *prefers* petrol has not ruled out diesel.
 */
export function dealbreakerCriteria(values: string[]): Criterion[] {
  const out: Criterion[] = []
  const add = (id: string, label: string, field: string, op: Criterion['op'], value: unknown) =>
    out.push({ id, kind: 'exclusion', label, field, op, value })

  for (const v of values) {
    switch (v) {
      case 'no-diesel':
        add('no-diesel', 'No diesel', 'fuel', 'neq', 'diesel')
        break
      case 'no-manual':
        add('no-manual', 'No manual', 'transmission', 'neq', 'manual')
        break
      case 'no-old':
        add('no-old', 'Nothing over 5 years old', 'year', 'gte', new Date().getFullYear() - 5)
        break
      case 'no-two-door':
        add('no-two-door', 'No two-door', 'doors', 'gte', 4)
        break
      case 'no-km-cap':
        // 9999 is the catalogue's sentinel for unlimited kilometres.
        add('no-km-cap', 'No mileage cap', 'freeKmPerDay', 'gte', 9999)
        break
    }
  }
  return out
}

/** Requirements derived from the interview answers — hard, but not vetoes. */
export function requirementCriteria(prefs: Preferences, strictBudget: boolean): Criterion[] {
  const out: Criterion[] = []

  if (prefs.category) {
    out.push({
      id: 'category',
      kind: 'requirement',
      label: `A ${prefs.category}`,
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
  if (prefs.bootLitresMin) {
    out.push({
      id: 'boot',
      kind: 'requirement',
      label: `Boot over ${prefs.bootLitresMin} L`,
      field: 'bootLitres',
      op: 'gte',
      value: prefs.bootLitresMin,
    })
  }
  if (prefs.budgetMax) {
    out.push({
      id: 'budget',
      // Only a veto if the user said so; otherwise over-budget cars can still
      // appear, ranked down, because "a bit over" is often worth seeing.
      kind: strictBudget ? 'exclusion' : 'requirement',
      label: `Within €${prefs.budgetMax.toLocaleString('en-IE')}`,
      field: 'price',
      op: 'lte',
      value: prefs.budgetMax,
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

  return out
}

/** A one-line spec the agent states back before searching. */
export function describeSpecFull(prefs: Preferences, criteria: Criterion[]): string[] {
  const lines: string[] = []
  lines.push(prefs.mode === 'buy' ? 'Buying' : 'Renting')
  if (prefs.useCase) lines.push(`For: ${prefs.useCase}`)
  for (const c of criteria.filter((c) => c.kind !== 'preference')) {
    lines.push(`${c.kind === 'exclusion' ? '✕' : '✓'} ${c.label}`)
  }
  if (prefs.targetDate) lines.push(`From ${prefs.targetDate}`)
  if (prefs.returnDate) lines.push(`Until ${prefs.returnDate}`)
  return lines
}
