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
    options: [
      { label: 'Rent', value: 'rent' },
      { label: 'Buy', value: 'buy' },
    ],
  },
  { id: 'useCase', ask: 'What will you mainly use it for? A sentence is plenty.', control: 'text' },
  {
    id: 'passengers',
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
    ask: 'Any particular kind of car in mind?',
    control: 'chips',
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
  },
  {
    id: 'budgetBuy',
    ask: "What's the most you'd want to spend?",
    control: 'slider',
    min: 15000,
    max: 170000,
    step: 5000,
    unit: CURRENCY_SYMBOL,
  },
  { id: 'targetDate', ask: 'When do you need it from?', control: 'date' },
  { id: 'returnDate', ask: 'And until when?', control: 'date' },
  {
    id: 'luggage',
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
    ask: 'Any preference on fuel?',
    control: 'chips',
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
    options: prioritiesFor('rent').map((p) => ({ label: p.label, value: p.id })),
  },
  {
    id: 'prioritiesBuy',
    ask: `What matters most to you? Pick up to ${MAX_PRIORITIES}.`,
    control: 'multi',
    options: prioritiesFor('buy').map((p) => ({ label: p.label, value: p.id })),
  },
  {
    id: 'dealbreakers',
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
  },
]

export const questionById = (id: string): Question | undefined => QUESTIONS.find((q) => q.id === id)

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
