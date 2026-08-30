import { catalog } from '@car/catalog'
import { rankListings } from '@car/ranking'
import {
  type Confidence,
  DEFAULT_CONFIG,
  type Evaluate,
  type PoolEvaluation,
  type StopReason,
  confidence,
  runAuction,
  shouldStop,
} from '@car/question-engine'
import type { AuctionResult } from '@car/question-engine'
import { type Preferences, screen } from '@car/shared'
import type { TurnContext } from '../session.js'
import { notePresented, recordTurn } from '../episodes.js'
import { type Question, isSlotFilled, questionBank, questionById } from '../questions.js'
import { buildAdaptiveQuestionSurface, buildJourneySurface } from '../surfaces.js'
import { answerToPreferences, buildCriteria } from './criteria.js'

/**
 * The adaptive interview: one question at a time, each one chosen by pricing
 * every candidate against the live pool.
 *
 * The loop is question → answer → re-screen → re-rank → auction → next, and
 * everything in it is deterministic — the auction, the confidence arithmetic
 * and the stopping rule live in @car/question-engine, and the answers land
 * through the same `answerToPreferences` the form uses. A model never chooses
 * a question; if it did, the episode logs could not say why one was asked.
 *
 * This file decides and presents. Acting on a stop — running the search — is
 * the caller's job (drivers/index.ts), which keeps this module free of the
 * flow-pipeline import cycle.
 */

/** Asked before the auction runs: mode splits the bank, use case seeds facts. */
const SEED_QUESTIONS = ['mode', 'useCase'] as const

/**
 * How much of the qualifying pool the simulation ranks. Ranking is O(n²) in
 * rationale-building, and the auction calls it once per plausible answer —
 * a deterministic sample keeps a turn comfortably under a frame.
 */
const SIM_POOL = 40

/** Shortlist depth the confidence sees — mirrors what the user will be shown. */
const TOP_K = 8

/** What the pool looks like under the given preferences. Pure, catalog-backed. */
export const evaluatePool: Evaluate = (prefs: Preferences): PoolEvaluation => {
  const mode = prefs.mode ?? 'rent'
  const pool = catalog().filter((l) => l.mode === mode)
  const { qualified } = screen(pool, buildCriteria(prefs))
  const sample = qualified.slice(0, SIM_POOL).map((a) => a.listing)
  const top = rankListings(sample, prefs)
    .slice(0, TOP_K)
    .map((r) => ({ id: r.listing.id, score: r.score }))
  return { qualified: qualified.length, top }
}

/** One hypothetical answer applied to scratch preferences. Never touches state. */
function applySim(prefs: Preferences, questionId: string, value: unknown): Preferences {
  const { patch, clear } = answerToPreferences(questionId, value)
  const next: Preferences = { ...prefs, ...patch }
  for (const field of clear) delete next[field]
  return next
}

const askedIds = (ctx: TurnContext): string[] => [
  ...ctx.state.interview.answered,
  ...ctx.state.interview.skipped,
]

export type InterviewDecision =
  | {
      kind: 'ask'
      question: Question
      /** Null for seed questions and re-presents — nothing was auctioned. */
      auction: AuctionResult | null
      pool: PoolEvaluation
      conf: Confidence
      /** 1-based position for the "Question N" caption. */
      index: number
    }
  | { kind: 'stop'; reason: StopReason; pool: PoolEvaluation; conf: Confidence }

/**
 * What the interview should do next. Pure with respect to session state —
 * presenting and acting are separate steps.
 */
export function decideNext(ctx: TurnContext): InterviewDecision {
  const prefs = ctx.state.preferences
  const asked = askedIds(ctx)
  const pool = evaluatePool(prefs)
  const conf = confidence(
    pool.top.map((t) => t.score),
    DEFAULT_CONFIG.temperature,
  )
  const index = asked.length + 1

  const present = (question: Question, auction: AuctionResult | null): InterviewDecision => ({
    kind: 'ask',
    question,
    auction,
    pool,
    conf,
    index,
  })

  // A question already on screen stays on screen until its slot fills or the
  // user skips it — re-deciding must not shuffle the question mid-thought.
  const currentId = ctx.state.interview.currentQuestionId
  if (currentId && !asked.includes(currentId) && !isSlotFilled(currentId, prefs)) {
    const current = questionById(currentId)
    if (current) return present(current, null)
  }

  for (const id of SEED_QUESTIONS) {
    if (asked.includes(id) || isSlotFilled(id, prefs)) continue
    const question = questionById(id)
    if (question) return present(question, null)
  }

  const auction = runAuction({
    bank: questionBank(),
    prefs,
    asked,
    apply: applySim,
    evaluate: evaluatePool,
  })

  const reason = shouldStop({
    askedCount: asked.length,
    margin: conf.margin,
    poolSize: pool.qualified,
    bestValue: auction ? (auction.considered[0]?.value ?? null) : null,
  })
  if (reason) return { kind: 'stop', reason, pool, conf }

  // shouldStop only returns null when something is worth asking, so the
  // auction cannot be empty here.
  const question = questionById(auction!.questionId)!
  return present(question, auction)
}

/** Multi-select drafts, per session — accumulated by taps, committed by Done. */
const drafts = new Map<string, Set<string>>()

export const draftFor = (sessionId: string): Set<string> => {
  let draft = drafts.get(sessionId)
  if (!draft) {
    draft = new Set()
    drafts.set(sessionId, draft)
  }
  return draft
}

export const clearDraft = (sessionId: string): void => {
  drafts.delete(sessionId)
}

/** Puts the decided question on screen, with the pool count that rewards answering. */
export function presentQuestion(ctx: TurnContext, decision: InterviewDecision): void {
  if (decision.kind !== 'ask') return
  const { question, auction, pool, index } = decision

  ctx.patchInterview({ currentQuestionId: question.id })
  notePresented(ctx.sessionId, question.id, auction)
  if (auction) {
    const best = auction.considered[0]
    ctx.step(
      `Chose the next question: ${question.id}`,
      `${auction.considered.length} candidates priced · expected impact ${best ? best.value.toFixed(2) : '0'}` +
        (auction.nearTies.length > 1 ? ` · tie of ${auction.nearTies.length} broken at random` : ''),
    )
  }
  ctx.a2ui(
    buildAdaptiveQuestionSurface(question, {
      pool: pool.qualified,
      index,
      draft: [...draftFor(ctx.sessionId)],
      renting: ctx.state.preferences.mode !== 'buy',
      skippable: question.id !== 'mode',
      searchable: ctx.state.interview.answered.length > 0,
    }),
  )
}

export interface TurnRecord {
  questionId: string
  answer: unknown
  skipped: boolean
  before: PoolEvaluation
  after: PoolEvaluation
  confBefore: Confidence
  confAfter: Confidence
}

/**
 * Applies one adaptive answer. Same mapping the spec sheet uses; the extra work
 * here is measurement — how much the pool moved is both the user's feedback
 * line and the episode log's row.
 */
export function recordAnswer(ctx: TurnContext, questionId: string, raw: unknown): TurnRecord | undefined {
  const question = questionById(questionId)
  if (!question) return undefined

  const before = evaluatePool(ctx.state.preferences)
  const confBefore = poolConfidence(before)

  const value =
    question.control === 'multi' && !Array.isArray(raw)
      ? String(raw ?? '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : raw

  const { patch, clear } = answerToPreferences(questionId, value)
  if (Object.keys(patch).length > 0) ctx.patchPreferences(patch)
  if (clear.length > 0) ctx.clearPreferences(clear)

  const { answered } = ctx.state.interview
  ctx.patchInterview({
    answered: answered.includes(questionId) ? answered : [...answered, questionId],
    currentQuestionId: undefined,
    dirty: true,
  })
  clearDraft(ctx.sessionId)

  const after = evaluatePool(ctx.state.preferences)
  ctx.step(
    `Noted ${questionId}`,
    after.qualified === before.qualified
      ? `${after.qualified} cars still in play — reordered, not narrowed`
      : `${before.qualified} → ${after.qualified} cars in play`,
  )
  ctx.a2ui(buildJourneySurface(ctx.state))

  const record: TurnRecord = {
    questionId,
    answer: value,
    skipped: false,
    before,
    after,
    confBefore,
    confAfter: poolConfidence(after),
  }
  recordTurn(ctx.state, record)
  return record
}

/** A skip is an answer about salience — recorded, never re-asked. */
export function recordSkip(ctx: TurnContext, questionId: string): TurnRecord {
  const pool = evaluatePool(ctx.state.preferences)
  const conf = poolConfidence(pool)
  const { skipped } = ctx.state.interview
  ctx.patchInterview({
    skipped: skipped.includes(questionId) ? skipped : [...skipped, questionId],
    currentQuestionId: undefined,
  })
  clearDraft(ctx.sessionId)
  const record: TurnRecord = {
    questionId,
    answer: null,
    skipped: true,
    before: pool,
    after: pool,
    confBefore: conf,
    confAfter: conf,
  }
  recordTurn(ctx.state, record)
  return record
}

const poolConfidence = (pool: PoolEvaluation): Confidence =>
  confidence(
    pool.top.map((t) => t.score),
    DEFAULT_CONFIG.temperature,
  )

/** Confidence over the pool as it stands — for logs written outside the loop. */
export const currentConfidence = (prefs: Preferences): Confidence =>
  poolConfidence(evaluatePool(prefs))

/** The stop, said out loud. All counts ours, as everywhere. */
export function announceStop(ctx: TurnContext, decision: InterviewDecision & { kind: 'stop' }): void {
  const { reason, pool, conf } = decision
  const lines: Record<StopReason, string> = {
    confident: 'One car is clearly ahead now — no point asking more. Here is my call.',
    'tiny-pool': `Only ${pool.qualified} car${pool.qualified === 1 ? '' : 's'} survive${pool.qualified === 1 ? 's' : ''} your requirements, so here they are.`,
    exhausted: 'Nothing left worth asking — every remaining question would change nothing. Searching now.',
    cap: "That's plenty of questions. Searching with what we have.",
  }
  ctx.step(
    `Interview stopped: ${reason}`,
    `confidence ${(conf.pTop1 * 100).toFixed(0)}% · margin ${conf.margin.toFixed(2)} · ` +
      `${askedIds(ctx).length} questions · ${pool.qualified} cars in play`,
  )
  ctx.say(lines[reason])
}
