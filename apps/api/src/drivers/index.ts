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

/** An action fired by an A2UI-rendered control. Identical for both drivers. */
export async function handleUiAction(
  driver: Driver,
  ctx: TurnContext,
  name: string,
  context: Record<string, unknown>,
): Promise<void> {
  const listingId = String(context.listingId ?? '')

  switch (name) {
    case 'editSpec':
      return editSpec(ctx, String(context.questionId ?? ''), context.value)

    // Confirming the spec is what hands it to the ranker, which is the point of
    // the product: the interview is a lookup, but ordering cars against what
    // someone said is a judgement.
    case 'confirmSpec':
    case 'searchAgain':
      ctx.patchInterview({ confirmed: true })
      await runSearch(ctx, { reorder: driver.reorder })
      return

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
