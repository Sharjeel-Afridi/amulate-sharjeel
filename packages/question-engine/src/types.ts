import type { Preferences } from '@car/shared'

/**
 * What the engine needs to know about a question to price it — and nothing
 * about how it renders. Wording, controls and options stay in the app's
 * question bank; this is the auction-facing projection of one entry.
 */
export interface BankQuestion {
  id: string
  /**
   * How the answer earns its keep: a `hard` answer filters the pool, a `weight`
   * answer re-ranks it, a `context` answer seeds several fields at once and is
   * asked for what it unlocks rather than what it filters.
   */
  kind: 'hard' | 'weight' | 'context'
  /**
   * Relative friction: 1 is one tap, higher means reading, thinking or typing.
   * The auction maximises gain per unit of this.
   */
  cost: number
  /**
   * The answers a customer plausibly gives, with priors that need not sum to
   * one — the auction normalises. Simulating these against the live pool is
   * where a question's value comes from.
   */
  answers: SimAnswer[]
  /** Gate on what is already known — a return date needs `mode = rent` first. */
  precondition?: (prefs: Preferences) => boolean
  /**
   * True when the slot this question fills already holds an answer, however it
   * got there — a tapped chip, typed text, an edited spec row. A filled slot is
   * never asked about, which is what keeps "actually, 30k" from being followed
   * by the budget question.
   */
  filled?: (prefs: Preferences) => boolean
  /**
   * A non-negotiable: the interview may not call itself confident, or run out
   * of things worth asking, while this slot is unresolved — unanswered and
   * unskipped. Budget is the canonical case: a "confident" recommendation
   * before the budget question is confidence about a spec nobody stated.
   */
  required?: boolean
}

export interface SimAnswer {
  value: unknown
  /** Relative likelihood of this answer. Uniform is an honest starting point. */
  prior: number
}

/** Applies one hypothetical answer, returning new preferences. Must be pure. */
export type ApplyAnswer = (prefs: Preferences, questionId: string, value: unknown) => Preferences

/** What the live pool looks like under a given set of preferences. */
export interface PoolEvaluation {
  /** Cars that pass every hard criterion. */
  qualified: number
  /** The ranked front-runners, best first. Scores on the scorer's 0–100 scale. */
  top: { id: string; score: number }[]
}

/** Screens and ranks the pool under hypothetical preferences. Must be pure. */
export type Evaluate = (prefs: Preferences) => PoolEvaluation

export interface EngineConfig {
  /**
   * Softmax temperature over 0–100 scores. Smaller sharpens: at 8, a five-point
   * lead over one rival is already a ~0.3 margin.
   */
  temperature: number
  /** Below this gain-per-cost, a question is not worth the customer's tap. */
  minValue: number
  /** Questions within this fraction of the best are a tie the RNG may break. */
  tieBand: number
  /** The mix that turns simulated effects into one gain number. */
  gainWeights: { elimination: number; flip: number; margin: number }
  /** A margin swing this large counts as a full tie-break effect. */
  marginFullSwing: number
  minQuestions: number
  maxQuestions: number
  /** Stop once P(top1) − P(top2) clears this. */
  confidentMargin: number
  /** Stop once this few cars survive the filters — just show them. */
  tinyPool: number
}

export const DEFAULT_CONFIG: EngineConfig = {
  temperature: 8,
  minValue: 0.02,
  tieBand: 0.1,
  gainWeights: { elimination: 0.45, flip: 0.35, margin: 0.2 },
  marginFullSwing: 0.25,
  minQuestions: 3,
  maxQuestions: 8,
  confidentMargin: 0.15,
  tinyPool: 3,
}
