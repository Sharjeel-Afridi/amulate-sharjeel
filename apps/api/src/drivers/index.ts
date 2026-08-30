import { MAX_PRIORITIES } from '@car/shared'
import type { TurnContext } from '../session.js'
import {
  type ReorderFn,
  editSpec,
  handleBookingSubmitted,
  handlePaymentConfirmed,
  runSearch,
  showCarDetail,
  showCatalogue,
  startBooking,
} from '../flow/index.js'
import {
  announceStop,
  currentConfidence,
  decideNext,
  draftFor,
  presentQuestion,
  recordAnswer,
  recordSkip,
} from '../flow/interview.js'
import { recordRecommendation } from '../episodes.js'

/**
 * The seam between the app and whatever is driving the conversation.
 *
 * A driver answers exactly one question: what to do with a message the user
 * TYPED. Everything else — a tapped chip, a moved slider, a submitted MCP App —
 * is handled identically for both drivers by the functions below, because the
 * value arrived already constrained by the control that produced it and tagged
 * with the field it fills. There is no ambiguity left for a model to resolve, so
 * routing it through one would only add a round trip, a rate-limit risk, and the
 * chance that a perfectly good answer is silently never recorded.
 *
 * The scripted driver is not only a stand-in for development. It calls the same
 * MCP tools, mutates the same state and emits the same surfaces — only the
 * wording is canned — so if the model API is throttled mid-presentation,
 * flipping one switch still yields a complete run.
 */
export interface Driver {
  readonly name: string
  handleUserMessage(ctx: TurnContext, text: string): Promise<void>
  /**
   * Model-backed reordering of the ranked shortlist, if this driver has one.
   * Absent means searches are ordered by the deterministic scorer.
   */
  readonly reorder?: ReorderFn
}

/**
 * Moves the adaptive interview one step: decide, then either ask or stop and
 * search. Shared by every route into the loop — a tapped answer, a skip, typed
 * text either driver handled — so the stop rule fires identically everywhere.
 */
export async function advanceAdaptive(driver: Driver, ctx: TurnContext): Promise<void> {
  if (ctx.state.phase !== 'interview' || ctx.state.interview.style !== 'adaptive') return

  const decision = decideNext(ctx)
  if (decision.kind === 'ask') return presentQuestion(ctx, decision)

  announceStop(ctx, decision)
  ctx.patchInterview({ confirmed: true, currentQuestionId: undefined })
  await runSearch(ctx, { reorder: driver.reorder })
  recordRecommendation(ctx.state, {
    pTop1: decision.conf.pTop1,
    margin: decision.conf.margin,
    stopReason: decision.reason,
  })
}

/** An action fired by an A2UI-rendered control. Identical for both drivers. */
export async function handleUiAction(
  driver: Driver,
  ctx: TurnContext,
  name: string,
  context: Record<string, unknown>,
): Promise<void> {
  const listingId = String(context.listingId ?? '')
  const questionId = String(context.questionId ?? '')

  switch (name) {
    case 'editSpec':
      return editSpec(ctx, String(context.questionId ?? ''), context.value)

    // The adaptive loop's three verbs. Answers and skips advance the loop;
    // toggles only redraw the card with the draft so far.
    case 'answerQuestion':
      recordAnswer(ctx, questionId, context.value)
      return advanceAdaptive(driver, ctx)

    case 'skipQuestion':
      recordSkip(ctx, questionId)
      return advanceAdaptive(driver, ctx)

    case 'toggleAnswer': {
      const value = String(context.value ?? '')
      const draft = draftFor(ctx.sessionId)
      const limit = questionId.startsWith('priorities') ? MAX_PRIORITIES : Infinity
      if (draft.has(value)) draft.delete(value)
      else if (draft.size < limit) draft.add(value)
      // Redraw so the tapped buttons read as selected. decideNext re-presents
      // the current question, drafts intact.
      const decision = decideNext(ctx)
      if (decision.kind === 'ask') presentQuestion(ctx, decision)
      return
    }

    case 'submitAnswer': {
      recordAnswer(ctx, questionId, [...draftFor(ctx.sessionId)])
      return advanceAdaptive(driver, ctx)
    }

    // Confirming the spec is what hands it to the ranker, which is the point of
    // the product: the interview is a lookup, but ordering cars against what
    // someone said is a judgement.
    case 'confirmSpec':
    case 'searchAgain': {
      const cutShort = ctx.state.phase === 'interview' && ctx.state.interview.style === 'adaptive'
      ctx.patchInterview({ confirmed: true, currentQuestionId: undefined })
      await runSearch(ctx, { reorder: driver.reorder })
      // "Show me the matches now" is a stop too — the user's own, and the
      // episode needs to know the interview ended on their terms.
      if (cutShort) {
        const conf = currentConfidence(ctx.state.preferences)
        recordRecommendation(ctx.state, { pTop1: conf.pTop1, margin: conf.margin, stopReason: 'user' })
      }
      return
    }

    // Selecting opens the car; booking is a separate, deliberate second tap.
    case 'selectCar':
      if (!listingId) return
      if (!showCarDetail(ctx, listingId)) await startBooking(ctx, listingId)
      return

    case 'backToResults':
      return showCatalogue(ctx)

    case 'bookCar':
      if (listingId) await startBooking(ctx, listingId)
      return
  }
}

/** A tool call that originated inside an MCP App iframe. The widget reported a fact. */
export async function handleAppToolResult(
  ctx: TurnContext,
  toolName: string,
  result: unknown,
): Promise<void> {
  if (toolName === 'submit_booking') return handleBookingSubmitted(ctx, result)
  if (toolName === 'confirm_payment') return handlePaymentConfirmed(ctx, result)
}
