import type { ScoreFactor } from '@car/shared'
import { clamp, round1 } from './util.js'

/** A listing that is exactly average against every active criterion scores 50. */
export const BASE_SCORE = 50

/**
 * One criterion's verdict before it is turned into points. `sub` is -1..1:
 * -1 is the worst this criterion can say about a car, +1 the best, 0 neutral.
 */
export interface Contribution {
  label: string
  /** Relative importance, not points. Meaningful only against the others. */
  weight: number
  sub: number
  detail: string
}

export interface Scored {
  score: number
  factors: ScoreFactor[]
}

/**
 * Turns weighted sub-scores into a 0–100 score plus the signed trace the UI
 * expands.
 *
 * Weights are renormalised over the criteria that are *active* for this
 * search — a preference the user never stated contributes nothing and is not
 * listed as a factor either, since "boot space: 0" would imply we judged it.
 * Renormalising means a thin interview (budget alone) still spreads candidates
 * across the full range instead of bunching everyone around 50.
 */
export function composeScore(contributions: Contribution[]): Scored {
  const totalWeight = contributions.reduce((sum, c) => sum + c.weight, 0)
  if (totalWeight <= 0) return { score: BASE_SCORE, factors: [] }

  const factors: ScoreFactor[] = contributions.map((c) => ({
    label: c.label,
    delta: round1((BASE_SCORE * c.weight * clamp(c.sub, -1, 1)) / totalWeight),
    detail: c.detail,
  }))

  // Each delta is rounded before summing so the expanded trace adds up to the
  // headline number exactly — a user checking our arithmetic should not find
  // a stray 0.1 that came from display rounding.
  const total = factors.reduce((sum, f) => sum + f.delta, 0)
  const score = clamp(round1(BASE_SCORE + total), 0, 100)

  // Biggest wins first, biggest drags last: the trace should read as an
  // argument, not as declaration order.
  factors.sort((a, b) => b.delta - a.delta || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))

  return { score, factors }
}
