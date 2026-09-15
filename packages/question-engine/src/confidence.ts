/**
 * Score-to-probability conversion, shared by the auction and the stopping rule.
 *
 * A softmax over the shortlist's 0–100 scores reads as "which car would this
 * customer pick if forced now". The temperature is a claim about how much a
 * score point means, and it is deliberately a config value: once real
 * acceptance data exists it gets calibrated, not argued about.
 */

/** P(choice) per score, same order as the input. Empty in, empty out. */
export function choiceProbabilities(scores: number[], temperature: number): number[] {
  if (scores.length === 0) return []
  const hottest = Math.max(...scores)
  const exps = scores.map((s) => Math.exp((s - hottest) / temperature))
  const total = exps.reduce((sum, e) => sum + e, 0)
  return exps.map((e) => e / total)
}

export interface Confidence {
  /** Probability the current #1 is the pick. 1 when it is the only car. */
  pTop1: number
  /** P(top1) − P(top2). The stopping rule's number. */
  margin: number
}

export function confidence(scores: number[], temperature: number): Confidence {
  const probs = [...choiceProbabilities(scores, temperature)].sort((a, b) => b - a)
  if (probs.length === 0) return { pTop1: 0, margin: 0 }
  return { pTop1: probs[0]!, margin: probs[0]! - (probs[1] ?? 0) }
}
