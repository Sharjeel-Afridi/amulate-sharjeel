import type { Preferences } from '@car/shared'
import { confidence } from './confidence.js'
import {
  type ApplyAnswer,
  type BankQuestion,
  DEFAULT_CONFIG,
  type EngineConfig,
  type Evaluate,
  type PoolEvaluation,
} from './types.js'

/**
 * The auction: every eligible question priced by what its answer would do to
 * the live pool, best value wins.
 *
 * "What is the most valuable thing I could learn right now?" is answered by
 * simulation, not by a hand-drawn branch tree: each plausible answer is applied
 * to a scratch copy of the preferences, the pool is re-screened and re-ranked,
 * and the question is credited with how much the outcome moved. Branching
 * emerges — after "city driving", the questions that slice a city-suitable pool
 * hard start winning — which is what makes this an engine rather than a script.
 *
 * Everything here is deterministic given `random`, and the near-tie
 * randomisation records its propensity. That is not a nicety: off-policy
 * learning later needs P(this question was the one asked), and it cannot be
 * reconstructed after the fact.
 */

export interface QuestionAssessment {
  id: string
  kind: BankQuestion['kind']
  /** Expected outcome shift across the simulated answers, 0..1. */
  gain: number
  cost: number
  /** gain / cost — the number the auction ranks on. */
  value: number
  eliminationShare: number
  flipProbability: number
  marginShift: number
}

export interface AuctionResult {
  questionId: string
  /** P(this question won), given the near-tie randomisation. */
  propensity: number
  /** Ids that tied within the band; the winner came from these. */
  nearTies: string[]
  /** Every question priced this turn, best first — the audit trail. */
  considered: QuestionAssessment[]
}

export interface AuctionInput {
  bank: BankQuestion[]
  prefs: Preferences
  /** Question ids already asked (answered or skipped) this session. */
  asked: string[]
  apply: ApplyAnswer
  evaluate: Evaluate
  /** Injected so tests and replays can pin the tie-break. */
  random?: () => number
}

/** Prices one question against the current pool. Exported for the logs. */
export function assessQuestion(
  question: BankQuestion,
  prefs: Preferences,
  base: PoolEvaluation,
  apply: ApplyAnswer,
  evaluate: Evaluate,
  cfg: EngineConfig,
): QuestionAssessment {
  const priorTotal = question.answers.reduce((sum, a) => sum + a.prior, 0) || 1
  const baseMargin = confidence(
    base.top.map((t) => t.score),
    cfg.temperature,
  ).margin

  let elimination = 0
  let flip = 0
  let margin = 0

  for (const answer of question.answers) {
    const p = answer.prior / priorTotal
    const next = evaluate(apply(prefs, question.id, answer.value))

    if (base.qualified > 0) {
      elimination += (p * Math.max(0, base.qualified - next.qualified)) / base.qualified
    }
    if (base.top[0] && next.top[0] && next.top[0].id !== base.top[0].id) flip += p

    const nextMargin = confidence(
      next.top.map((t) => t.score),
      cfg.temperature,
    ).margin
    margin += p * Math.min(1, Math.abs(nextMargin - baseMargin) / cfg.marginFullSwing)
  }

  const { gainWeights: w } = cfg
  const gain = w.elimination * elimination + w.flip * flip + w.margin * margin
  return {
    id: question.id,
    kind: question.kind,
    gain,
    cost: question.cost,
    value: gain / Math.max(question.cost, 0.01),
    eliminationShare: elimination,
    flipProbability: flip,
    marginShift: margin,
  }
}

/** The questions whose slots are non-negotiable and still unresolved. */
export function pendingRequired(bank: BankQuestion[], prefs: Preferences, asked: string[]): string[] {
  const askedSet = new Set(asked)
  return bank
    .filter(
      (q) =>
        q.required &&
        !askedSet.has(q.id) &&
        (q.precondition?.(prefs) ?? true) &&
        !(q.filled?.(prefs) ?? false),
    )
    .map((q) => q.id)
}

/**
 * Runs the auction. Null means nothing left is worth asking — the caller's cue
 * to stop and recommend, not an error.
 */
export function runAuction(input: AuctionInput, cfg: EngineConfig = DEFAULT_CONFIG): AuctionResult | null {
  const { bank, prefs, asked, apply, evaluate } = input
  const random = input.random ?? Math.random
  const askedSet = new Set(asked)

  const eligible = bank.filter(
    (q) =>
      !askedSet.has(q.id) && (q.precondition?.(prefs) ?? true) && !(q.filled?.(prefs) ?? false),
  )
  if (eligible.length === 0) return null

  const base = evaluate(prefs)
  const considered = eligible
    .map((q) => assessQuestion(q, prefs, base, apply, evaluate, cfg))
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1))

  const best = considered[0]!
  if (best.value < cfg.minValue) {
    // Nothing clears the bar, but a required slot may not be skipped over by
    // the pricing: ask the best of the unresolved required questions anyway.
    // Deterministic, so the propensity is honestly 1.
    const forced = considered.find((a) => pendingRequired(bank, prefs, asked).includes(a.id))
    if (!forced) return null
    return { questionId: forced.id, propensity: 1, nearTies: [forced.id], considered }
  }

  // Near-ties are broken at random on purpose: the controlled wobble is what
  // makes "would question B have done better?" answerable from logs later.
  const nearTies = considered
    .filter((a) => a.value >= best.value * (1 - cfg.tieBand) && a.value >= cfg.minValue)
    .map((a) => a.id)
  const winner = nearTies[Math.min(Math.floor(random() * nearTies.length), nearTies.length - 1)]!

  return { questionId: winner, propensity: 1 / nearTies.length, nearTies, considered }
}
