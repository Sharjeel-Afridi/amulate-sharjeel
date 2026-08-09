import {
  CATEGORY_LABELS,
  CURRENCY_SYMBOL,
  type Category,
  type Criterion,
  type FuelType,
  type Mode,
  type Preferences,
  type Transmission,
  money,
} from '@car/shared'
import { availableCategories } from '@car/catalog'

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

/**
 * Only the body styles the fleet actually holds.
 *
 * Offering all ten would let someone pick "pickup" and be told, after eleven
 * questions, that nothing matches — a dead end the data could have prevented.
 */
const categoryOptions = [
  ...availableCategories().map((c) => ({ label: CATEGORY_LABELS[c], value: c })),
  { label: 'Not sure — help me choose', value: 'unsure' },
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
    // The fleet seats 4, 5, 7 or 9 — nothing smaller exists to offer.
    options: [
      { label: 'Up to four', value: '4' },
      { label: 'Five', value: '5' },
      { label: 'Six or seven', value: '7' },
      { label: 'Eight or nine', value: '9' },
    ],
  },
  {
    id: 'category',
    topic: 'category',
    ask: 'Any particular kind of car in mind?',
    control: 'chips',
    options: categoryOptions,
  },
  // Both sliders are scaled to what is actually on the forecourt — hire runs
  // $1,170–$9,400 a month and the same cars sell for $18,900–$165,400. A range
  // the stock cannot fill just teaches people their budget is impossible.
  {
    id: 'budget',
    topic: 'budgetMax',
    ask: "What's the most you'd want to spend?",
    control: 'slider',
    min: 1000,
    max: 10000,
    step: 250,
    unit: `${CURRENCY_SYMBOL}/month`,
    appliesTo: 'rent',
  },
  {
    id: 'budgetBuy',
    topic: 'budgetMax',
    ask: "What's the most you'd want to spend?",
    control: 'slider',
    min: 15000,
    max: 170000,
    step: 5000,
    unit: CURRENCY_SYMBOL,
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
    // Thresholds sit on the real boot distribution, which clusters hard at 460 L.
    options: [
      { label: 'Not much', value: '0' },
      { label: 'Weekly shop, a couple of bags', value: '300' },
      { label: 'Pram, sports kit, big luggage', value: '460' },
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

/**
 * The preference field a question fills.
 *
 * Every topic but `dealbreakers` names a `Preferences` key — that one produces
 * criteria instead, so it has no field and can never be considered already known.
 */
function topicField(q: Question): keyof Preferences | undefined {
  return q.topic === 'dealbreakers' ? undefined : (q.topic as keyof Preferences)
}

/** Whether a question is still worth putting to the user. */
function isPending(q: Question, prefs: Preferences, answered: Set<string>): boolean {
  if (answered.has(q.id)) return false
  if (q.appliesTo && prefs.mode && q.appliesTo !== prefs.mode) return false
  // Mode gates every mode-specific question, so it must be answered first.
  if (q.appliesTo && !prefs.mode) return false
  // Already told us — in an opening sentence, or anywhere else in the chat.
  // Asking again reads as not having listened, and it is the single most common
  // complaint about scripted interviews.
  const field = topicField(q)
  if (field && prefs[field] !== undefined) return false
  return true
}

/** The next question worth asking, respecting mode. Undefined means done. */
export function nextQuestion(prefs: Preferences, answered: Set<string>): Question | undefined {
  return QUESTIONS.find((q) => isPending(q, prefs, answered))
}

export function questionsRemaining(prefs: Preferences, answered: Set<string>): number {
  return QUESTIONS.filter((q) => isPending(q, prefs, answered) && q.optional !== true).length
}

/** What one answered question contributes. */
export interface AnswerOutcome {
  patch: Preferences
  /**
   * Fields the answer explicitly *removes* a constraint from — "No preference"
   * on fuel, "Doesn't matter" on mileage.
   *
   * Distinct from simply being absent from `patch`. During the interview the two
   * coincide, because the field was never set; when editing an existing spec they
   * do not, and a patch alone can only ever add or overwrite. Without this,
   * changing fuel back to "No preference" silently kept the old value.
   */
  clear: (keyof Preferences)[]
  /** Raw dealbreaker values, for `dealbreakerCriteria`. Empty for every other question. */
  dealbreakers: string[]
}

/**
 * Maps one answered question onto preferences.
 *
 * This is the whole of what a form answer means. The control already constrained
 * the value to a valid option and the question id already says which field it
 * fills, so there is nothing here for a model to work out — running this through
 * one would only add latency and a chance to drop the answer.
 */
export function answerToPreferences(questionId: string, raw: unknown): AnswerOutcome {
  const values = (Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')]).map((v) => v.trim())
  const first = values[0] ?? ''
  const patch: Preferences = {}
  const clear: (keyof Preferences)[] = []
  const dealbreakers: string[] = []

  switch (questionId) {
    case 'mode':
      if (first === 'rent' || first === 'buy') patch.mode = first
      break
    case 'useCase':
      if (first) patch.useCase = first
      break
    case 'passengers':
      patch.seatsMin = Number(first) || undefined
      break
    case 'category':
      if (first === 'unsure') clear.push('category')
      else if (first) patch.category = first as Category
      break
    case 'budget':
    case 'budgetBuy':
      patch.budgetMax = Number(first) || undefined
      break
    case 'targetDate':
      if (first) patch.targetDate = first.slice(0, 10)
      break
    case 'returnDate':
      if (first) patch.returnDate = first.slice(0, 10)
      break
    case 'luggage':
      if (Number(first) > 0) patch.bootLitresMin = Number(first)
      else clear.push('bootLitresMin')
      break
    case 'fuel':
      if (first === 'any') clear.push('fuel')
      else if (first) patch.fuel = first as FuelType
      break
    case 'transmission':
      if (first === 'any') clear.push('transmission')
      else if (first) patch.transmission = first as Transmission
      break
    case 'mileage':
      if (Number(first) > 0) patch.maxMileageKm = Number(first)
      else clear.push('maxMileageKm')
      break
    case 'dealbreakers':
      dealbreakers.push(...values.filter((v) => v && v !== 'none'))
      break
  }

  // "Not much luggage" and "mileage doesn't matter" both answer 0, which means
  // no constraint rather than a constraint of zero. Dropping the key entirely is
  // what stops it being written into preferences as a real limit.
  for (const key of Object.keys(patch) as (keyof Preferences)[]) {
    if (patch[key] === undefined) delete patch[key]
  }

  return { patch, clear, dealbreakers }
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
      // The category list includes "estate" and "suv", so a fixed article reads
      // as broken English on the one screen the user is asked to approve.
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
      label: `Within ${money(prefs.budgetMax)}`,
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

export const questionById = (id: string): Question | undefined => QUESTIONS.find((q) => q.id === id)

/**
 * One line of the spec sheet: what it says, and what changes it.
 *
 * The edit metadata rides along with the display text rather than living in the
 * surface builder, because both are answers to the same question — "what does
 * this row mean" — and splitting them is how the sheet and the control that
 * edits it drift apart.
 */
export interface SpecSheetRow {
  label: string
  /** Display text. Empty when nothing has been recorded. */
  value: string
  filled: boolean
  /** Question that edits this row. Empty for rows nothing can change. */
  questionId: string
  /** Control kind, or '' for read-only. `multi` carries comma-joined values. */
  control: string
  options: { label: string; value: string }[]
  /** Current raw value, in the vocabulary the control speaks. */
  editValue: string
  min: number
  max: number
  step: number
  unit: string
}

/** The label an option list gives a raw value, falling back to the value. */
function optionLabel(questionId: string, value: string): string {
  return questionById(questionId)?.options?.find((o) => o.value === value)?.label ?? value
}

/**
 * The whole spec, as editable rows.
 *
 * Every field the interview can ask about appears, whether or not it was
 * answered — a sheet that hides the questions you skipped gives you no way to
 * fill them in later, which was the original dead end: once the search came back
 * empty there was nothing on screen that could change the outcome.
 */
export function specSheet(prefs: Preferences, criteria: Criterion[]): SpecSheetRow[] {
  const renting = prefs.mode !== 'buy'
  const exclusions = criteria.filter((c) => c.kind === 'exclusion')

  const row = (
    label: string,
    questionId: string,
    value: string,
    editValue: string,
    filled = Boolean(value),
  ): SpecSheetRow => {
    const q = questionById(questionId)
    return {
      label,
      value,
      filled,
      questionId: q ? questionId : '',
      control: q?.control ?? '',
      options: q?.options ?? [],
      editValue,
      min: q?.min ?? 0,
      max: q?.max ?? 0,
      step: q?.step ?? 1,
      unit: q?.unit ?? '',
    }
  }

  const budgetQuestion = renting ? 'budget' : 'budgetBuy'
  const rows: SpecSheetRow[] = [
    row(
      'Rent or buy',
      'mode',
      prefs.mode === 'rent' ? 'Renting' : prefs.mode === 'buy' ? 'Buying' : '',
      prefs.mode ?? '',
    ),
    row('Use case', 'useCase', prefs.useCase ?? '', prefs.useCase ?? ''),
    row(
      'Category',
      'category',
      prefs.category ? CATEGORY_LABELS[prefs.category] : '',
      prefs.category ?? 'unsure',
    ),
    row(
      'Budget',
      budgetQuestion,
      prefs.budgetMax ? `Up to ${money(prefs.budgetMax)}${renting ? '/mo' : ''}` : '',
      prefs.budgetMax ? String(prefs.budgetMax) : '',
    ),
    row(
      'Seats',
      'passengers',
      prefs.seatsMin ? `${prefs.seatsMin} or more` : '',
      prefs.seatsMin ? String(prefs.seatsMin) : '',
    ),
    row(
      'Luggage',
      'luggage',
      prefs.bootLitresMin ? optionLabel('luggage', String(prefs.bootLitresMin)) : '',
      String(prefs.bootLitresMin ?? 0),
    ),
    row('Gearbox', 'transmission', prefs.transmission ?? '', prefs.transmission ?? 'any'),
    row('Fuel', 'fuel', prefs.fuel ?? '', prefs.fuel ?? 'any'),
  ]

  if (!renting) {
    rows.push(
      row(
        'Mileage',
        'mileage',
        prefs.maxMileageKm ? optionLabel('mileage', String(prefs.maxMileageKm)) : '',
        String(prefs.maxMileageKm ?? 0),
      ),
    )
  }

  // Split rather than shown as "from → until": a combined row reads well but
  // there is no sensible single control that edits both ends of it.
  rows.push(
    row(renting ? 'From' : 'Collection', 'targetDate', prefs.targetDate ?? '', prefs.targetDate ?? ''),
  )
  if (renting) {
    rows.push(row('Until', 'returnDate', prefs.returnDate ?? '', prefs.returnDate ?? ''))
  }

  // Only the exclusions this question actually produces. `requirementCriteria`
  // also emits the budget as an exclusion when the user called it strict, and
  // that one is owned by the budget row — listing it here would offer to remove
  // a dealbreaker the control cannot express. Strict budget itself lives in
  // notes rather than as a criterion, so it is read back from there.
  const dealbreakerValues = new Set((questionById('dealbreakers')?.options ?? []).map((o) => o.value))
  const chosen = exclusions.filter((c) => dealbreakerValues.has(c.id))
  const labels = chosen.map((c) => c.label)
  const selected = chosen.map((c) => c.id)
  if ((prefs.notes ?? []).includes('strict-budget')) {
    labels.push('Nothing above my budget')
    selected.push('strict-budget')
  }

  rows.push(row('Dealbreakers', 'dealbreakers', labels.join(', '), selected.join(',')))

  return rows
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
