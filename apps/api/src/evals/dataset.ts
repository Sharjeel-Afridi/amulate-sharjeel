/**
 * The eval dataset: whole journeys, not single prompts.
 *
 * The unit is a journey because that is the unit the product ships. A prompt-level
 * dataset would score the ranker's wording while saying nothing about whether the
 * interview reached a spec, whether screening left anything to rank, or whether
 * the model quietly fell back to the scorer — and those are the failures that
 * actually reach a user.
 *
 * Turns are typed text rather than control actions on purpose: text is the only
 * path that reaches a model, so it is the only path where an eval can regress.
 * Tapped controls are deterministic by design and covered by `smoke.ts`.
 *
 * Answers are sized to the real fleet — rentals run 550–9,400 a month and
 * purchases 7,800–165,400 — because a case built on invented numbers fails on the
 * budget rather than on the thing it meant to test.
 */

export interface EvalCase {
  id: string
  /** What this case is for, printed in the report. */
  intent: string
  /** One answer per interview question, ending with the spec confirmation. */
  turns: string[]
  /** What the run has to produce to be judged at all. */
  expect: {
    /** Fewer than this and the case is a hard failure, not a low score. */
    minShortlist: number
    /** `true` when the case is built to exhaust the catalogue. */
    expectNearMisses?: boolean
    mode: 'rent' | 'buy'
  }
}

export const CASES: EvalCase[] = [
  {
    id: 'rent-suv-family',
    intent: 'The happy path: a roomy rental well inside a generous budget.',
    turns: [
      'rent',
      'weekend trips with two kids',
      'five',
      'suv',
      '3000 a month',
      '12 September',
      '19 September',
      'pram and big luggage',
      'no preference',
      'automatic',
      'nothing to rule out',
      'yes, go ahead and search',
    ],
    expect: { minShortlist: 3, mode: 'rent' },
  },
  {
    id: 'buy-hatchback-commuter',
    intent: 'The buy branch, which asks a different question set (mileage, no return date).',
    turns: [
      'buy',
      'commuting to work on my own',
      'four',
      'hatchback',
      '20000',
      '1 October',
      'just a laptop bag',
      'petrol',
      'manual',
      '120000',
      'nothing to rule out',
      'yes, search',
    ],
    expect: { minShortlist: 3, mode: 'buy' },
  },
  {
    id: 'rent-dealbreakers-tight',
    intent:
      'Exclusion criteria plus a tight budget on a thin category. Against the ' +
      'current fleet this still fills a shortlist, so it is not a near-miss case ' +
      'today — it guards the dealbreaker path, and will start covering the ' +
      'near-miss fallback if the catalogue thins.',
    turns: [
      'rent',
      'moving house at the weekend',
      'seven',
      'mpv',
      '800 a month',
      '5 September',
      '8 September',
      'furniture, so as much space as possible',
      'no preference',
      'automatic',
      'no diesel and no manual',
      'yes, search',
    ],
    // A deliberately over-constrained case: it may legitimately return
    // near-misses instead of matches, and the eval judges the explanation either
    // way rather than treating an empty shortlist as a bug.
    expect: { minShortlist: 0, expectNearMisses: true, mode: 'rent' },
  },
]
