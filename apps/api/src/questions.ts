import {
  CATEGORY_LABELS,
  CURRENCY_SYMBOL,
  MAX_PRIORITIES,
  type Preferences,
  money,
  prioritiesFor,
  priorityLabel,
} from '@car/shared'
import { availableCategories } from '@car/catalog'
import type { BankQuestion } from '@car/question-engine'

/**
 * The interview: what it asks, and how the answers read back as a spec sheet.
 *
 * Declarative on purpose — this file states the questions and projects the
 * current preferences into editable rows. What an answer *means* lives in
 * `flow/criteria.ts`; what happens when one changes lives in `flow/spec.ts`.
 *
 * Dealbreakers get their own question because people are far more certain about
 * what they will reject than about what they want. It is the highest-signal
 * answer in the conversation, and it is what makes the shortlist short.
 */

export type ControlKind = 'chips' | 'multi' | 'slider' | 'date' | 'text'

export interface Question {
  id: string
  ask: string
  control: ControlKind
  options?: { label: string; value: string }[]
  min?: number
  max?: number
  step?: number
  unit?: string
  /**
   * How the answer earns its keep in the adaptive interview: `hard` filters the
   * pool, `weight` re-ranks it, `context` seeds several fields at once.
   */
  kind?: 'hard' | 'weight' | 'context'
  /**
   * Values the auction simulates as plausible answers. Options double as the
   * default; sliders and multi-selects need explicit representative points.
   */
  simValues?: unknown[]
  /**
   * False keeps the question out of the adaptive loop — free text the auction
   * cannot simulate, and dates the booking form collects anyway.
   */
  adaptive?: boolean
}

/**
 * Only the body styles the fleet actually holds. Offering all ten would let
 * someone pick "pickup" and be told, eleven questions later, that nothing
 * matches — a dead end the data could have prevented.
 */
const categoryOptions = [
  ...availableCategories().map((c) => ({ label: CATEGORY_LABELS[c], value: c })),
  { label: 'Not sure — help me choose', value: 'unsure' },
]

export const QUESTIONS: Question[] = [
  {
    id: 'mode',
    ask: 'First things first — are you looking to rent, or to buy?',
    control: 'chips',
    kind: 'hard',
    options: [
      { label: 'Rent', value: 'rent' },
      { label: 'Buy', value: 'buy' },
    ],
  },
  {
    id: 'useCase',
    ask: 'What will you mainly use it for? A sentence is plenty.',
    control: 'text',
    kind: 'context',
    // Free text cannot be simulated, so the auction never prices it — the
    // adaptive flow seeds it by hand instead, for what its extraction unlocks.
    adaptive: false,
  },
  {
    id: 'passengers',
    ask: 'How many people need to fit, most of the time?',
    control: 'chips',
    kind: 'hard',
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
    ask: 'Any particular kind of car in mind?',
    control: 'chips',
    kind: 'hard',
    options: categoryOptions,
  },
  // Both sliders are scaled to what is actually on the forecourt — hire runs
  // €1,170–€9,400 a month and the same cars sell for €18,900–€165,400. A range
  // the stock cannot fill just teaches people their budget is impossible.
  {
    id: 'budget',
    ask: "What's the most you'd want to spend?",
    control: 'slider',
    min: 1000,
    max: 10000,
    step: 250,
    unit: `${CURRENCY_SYMBOL}/month`,
    kind: 'hard',
    simValues: [1500, 2500, 4000, 6500, 9000],
  },
  {
    id: 'budgetBuy',
    ask: "What's the most you'd want to spend?",
    control: 'slider',
    min: 15000,
    max: 170000,
    step: 5000,
    unit: CURRENCY_SYMBOL,
    kind: 'hard',
    simValues: [20000, 35000, 60000, 100000, 150000],
  },
  { id: 'targetDate', ask: 'When do you need it from?', control: 'date', adaptive: false },
  { id: 'returnDate', ask: 'And until when?', control: 'date', adaptive: false },
  {
    id: 'luggage',
    ask: 'How much are you usually carrying?',
    control: 'chips',
    kind: 'weight',
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
    ask: 'Any preference on fuel?',
    control: 'chips',
    kind: 'weight',
    options: [
      { label: 'No preference', value: 'any' },
      { label: 'Petrol', value: 'petrol' },
      { label: 'Diesel', value: 'diesel' },
      { label: 'Hybrid', value: 'hybrid' },
      { label: 'Electric', value: 'electric' },
    ],
  },
  {
    id: 'transmission',
    ask: 'Automatic or manual?',
    control: 'chips',
    kind: 'hard',
    options: [
      { label: 'No preference', value: 'any' },
      { label: 'Automatic', value: 'automatic' },
      { label: 'Manual', value: 'manual' },
    ],
  },
  {
    id: 'mileage',
    ask: 'How much mileage would you accept?',
    control: 'chips',
    kind: 'hard',
    options: [
      { label: 'Under 30,000 km', value: '30000' },
      { label: 'Under 60,000 km', value: '60000' },
      { label: 'Under 100,000 km', value: '100000' },
      { label: "Doesn't matter", value: '0' },
    ],
  },
  // Split by mode like budget/budgetBuy: the options differ because the data
  // differs — warranty is a purchase concept, a km allowance a rental one.
  {
    id: 'priorities',
    ask: `What matters most to you? Pick up to ${MAX_PRIORITIES}.`,
    control: 'multi',
    kind: 'weight',
    options: prioritiesFor('rent').map((p) => ({ label: p.label, value: p.id })),
    simValues: prioritiesFor('rent').map((p) => [p.id]),
  },
  {
    id: 'prioritiesBuy',
    ask: `What matters most to you? Pick up to ${MAX_PRIORITIES}.`,
    control: 'multi',
    kind: 'weight',
    options: prioritiesFor('buy').map((p) => ({ label: p.label, value: p.id })),
    simValues: prioritiesFor('buy').map((p) => [p.id]),
  },
  {
    id: 'dealbreakers',
    ask: 'Last one, and the most useful — anything that would rule a car out completely?',
    control: 'multi',
    kind: 'hard',
    // Single-exclusion approximations: the auction wants "what would knowing
    // one dealbreaker do", not the power set.
    simValues: [['no-diesel'], ['no-manual'], ['no-old'], ['strict-budget'], []],
    options: [
      { label: 'No diesel', value: 'no-diesel' },
      { label: 'No manual', value: 'no-manual' },
      { label: 'Nothing over 5 years old', value: 'no-old' },
      { label: 'No two-door', value: 'no-two-door' },
      { label: 'No mileage cap on the hire', value: 'no-km-cap' },
      { label: 'Nothing above my budget', value: 'strict-budget' },
      { label: 'Nothing to rule out', value: 'none' },
    ],
  },
]

export const questionById = (id: string): Question | undefined => QUESTIONS.find((q) => q.id === id)

/* ------------------------------------------------------- the adaptive bank */

/** Friction per control: roughly how much reading and thinking one answer costs. */
const CONTROL_COST: Record<ControlKind, number> = {
  chips: 1,
  slider: 1.2,
  multi: 1.4,
  date: 1.5,
  text: 2.5,
}

/**
 * Whether the slot a question fills already holds an answer — however it got
 * there: a tapped control, typed text the extractor parsed, an edited spec row.
 * The auction never asks about a filled slot, which is what makes "actually,
 * 30k a month" land without the budget question following it.
 */
const FILLED: Record<string, (p: Preferences) => boolean> = {
  mode: (p) => p.mode !== undefined,
  useCase: (p) => p.useCase !== undefined,
  passengers: (p) => p.seatsMin !== undefined,
  category: (p) => p.category !== undefined,
  budget: (p) => p.budgetMax !== undefined,
  budgetBuy: (p) => p.budgetMax !== undefined,
  luggage: (p) => p.bootLitresMin !== undefined,
  fuel: (p) => p.fuel !== undefined,
  transmission: (p) => p.transmission !== undefined,
  mileage: (p) => p.maxMileageKm !== undefined,
  priorities: (p) => (p.priorities?.length ?? 0) > 0,
  prioritiesBuy: (p) => (p.priorities?.length ?? 0) > 0,
  dealbreakers: (p) => p.dealbreakers !== undefined,
}

/** Hard gates on what must be known first. Mode splits the bank in two. */
const PRECONDITION: Record<string, (p: Preferences) => boolean> = {
  budget: (p) => p.mode !== 'buy',
  budgetBuy: (p) => p.mode === 'buy',
  mileage: (p) => p.mode === 'buy',
  priorities: (p) => p.mode !== 'buy',
  prioritiesBuy: (p) => p.mode === 'buy',
  returnDate: (p) => p.mode !== 'buy',
}

/** Whether the slot a question fills already holds an answer. */
export const isSlotFilled = (id: string, prefs: Preferences): boolean =>
  FILLED[id]?.(prefs) ?? false

/**
 * The auction-facing projection of the interview. Wording and controls stay in
 * `QUESTIONS`; this hands the engine only what it needs to price each one.
 */
export function questionBank(): BankQuestion[] {
  return QUESTIONS.filter((q) => q.adaptive !== false)
    .map((q) => ({
      id: q.id,
      kind: q.kind ?? 'hard',
      cost: CONTROL_COST[q.control],
      answers: (q.simValues ?? q.options?.map((o) => o.value) ?? []).map((value) => ({
        value,
        prior: 1,
      })),
      precondition: PRECONDITION[q.id],
      filled: FILLED[q.id],
    }))
    .filter((q) => q.answers.length > 0)
}

/** The label an option list gives a raw value, falling back to the value. */
const optionLabel = (questionId: string, value: string): string =>
  questionById(questionId)?.options?.find((o) => o.value === value)?.label ?? value

/** One line of the spec sheet: what it says, and what changes it. */
export interface SpecSheetRow {
  label: string
  /** Display text. Empty when nothing has been recorded. */
  value: string
  filled: boolean
  questionId: string
  control: string
  options: { label: string; value: string }[]
  /** Current raw value, in the vocabulary the control speaks. */
  editValue: string
  min: number
  max: number
  step: number
  unit: string
  /**
   * Wants the full width of the form's two-column grid. Priorities and
   * dealbreakers: both modes emit ten other rows, so two full-width rows at the
   * end leave five clean pairs above them and no orphan half-row anywhere.
   */
  wide: boolean
}

const WIDE_ROWS = new Set(['priorities', 'prioritiesBuy', 'dealbreakers'])

/**
 * The whole spec, as editable rows.
 *
 * Every field the interview can ask about appears, whether or not it was
 * answered — a sheet that hides the questions you skipped gives you no way to
 * fill them in later, which is a dead end once a search comes back empty.
 */
export function specSheet(prefs: Preferences): SpecSheetRow[] {
  const renting = prefs.mode !== 'buy'
  const dealbreakers = prefs.dealbreakers ?? []

  const row = (label: string, questionId: string, value: string, editValue: string): SpecSheetRow => {
    const q = questionById(questionId)
    return {
      label,
      value,
      filled: Boolean(value),
      questionId: q ? questionId : '',
      control: q?.control ?? '',
      options: q?.options ?? [],
      editValue,
      min: q?.min ?? 0,
      max: q?.max ?? 0,
      step: q?.step ?? 1,
      unit: q?.unit ?? '',
      wide: WIDE_ROWS.has(questionId),
    }
  }

  const rows = [
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
      renting ? 'budget' : 'budgetBuy',
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

  // Mileage is a purchase question; a return date is a hire one. Splitting the
  // dates rather than showing "from → until" because no single control edits
  // both ends of a range.
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
  rows.push(
    row(renting ? 'From' : 'Collection', 'targetDate', prefs.targetDate ?? '', prefs.targetDate ?? ''),
  )
  if (renting) rows.push(row('Until', 'returnDate', prefs.returnDate ?? '', prefs.returnDate ?? ''))

  const priorities = prefs.priorities ?? []
  rows.push(
    row(
      'Top priorities',
      renting ? 'priorities' : 'prioritiesBuy',
      priorities.map(priorityLabel).join(', '),
      priorities.join(','),
    ),
  )

  rows.push(
    row(
      'Dealbreakers',
      'dealbreakers',
      dealbreakers.map((d) => optionLabel('dealbreakers', d)).join(', '),
      dealbreakers.join(','),
    ),
  )

  return rows
}
