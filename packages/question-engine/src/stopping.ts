import { DEFAULT_CONFIG, type EngineConfig } from './types.js'

/**
 * When to stop asking and recommend.
 *
 * Four reasons, checked in the order of how good they are as news: a pool so
 * small the answer is already on screen, a clear leader, nothing left worth
 * asking, and the hard cap. The floor exists because a lucky early gap makes
 * for an unearned-feeling recommendation — three answers is the least an
 * opinion can decently rest on.
 */

export type StopReason = 'tiny-pool' | 'confident' | 'exhausted' | 'cap'

export interface StopInput {
  /** Questions asked so far, answered or skipped. */
  askedCount: number
  /** P(top1) − P(top2) over the current pool. */
  margin: number
  /** Cars passing every hard criterion right now. */
  poolSize: number
  /** Best remaining auction value, or null when no question is eligible. */
  bestValue: number | null
}

export function shouldStop(input: StopInput, cfg: EngineConfig = DEFAULT_CONFIG): StopReason | null {
  const { askedCount, margin, poolSize, bestValue } = input

  // Out of questions is terminal whatever the count — there is nothing to ask.
  if (bestValue === null) return 'exhausted'
  if (askedCount >= cfg.maxQuestions) return 'cap'

  if (askedCount < cfg.minQuestions) {
    // The floor yields only to a pool too small to keep interrogating.
    return poolSize <= cfg.tinyPool ? 'tiny-pool' : null
  }

  if (poolSize <= cfg.tinyPool) return 'tiny-pool'
  if (margin >= cfg.confidentMargin) return 'confident'
  if (bestValue < cfg.minValue) return 'exhausted'
  return null
}
