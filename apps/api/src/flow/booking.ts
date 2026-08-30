import { money } from '@car/shared'
import type { TurnContext } from '../session.js'
import { recordOutcome } from '../episodes.js'
import { callToolForApp } from '../mcp.js'

/**
 * Booking and checkout, which happen inside an MCP App rather than here.
 *
 * The widget owns the whole transaction — dates, extras, driver, payment — and
 * advances between its own steps in place. This module opens it and reacts to
 * what it reports back; it renders nothing itself, because pushing a second MCP
 * App mid-transaction leaves the filled-in booking form sitting above the
 * payment screen for the rest of the conversation.
 */

/** Opens the booking form for a listing, as an MCP App in the conversation. */
export async function startBooking(ctx: TurnContext, listingId: string): Promise<void> {
  ctx.setPhase('book')
  const { targetDate, returnDate, mode } = ctx.state.preferences
  const endDate = returnDate ?? (mode !== 'buy' && targetDate ? addDays(targetDate, 7) : undefined)

  const { html } = await callToolForApp('start_booking', {
    listingId,
    startDate: targetDate,
    endDate,
  })
  ctx.step('Opened booking form', 'Rendered in chat as an MCP App')
  ctx.mcpApp('start_booking', html)
  // The choice is the outcome the whole interview is scored against: which car,
  // and where our ranking had put it.
  recordOutcome(ctx.state, 'booked', listingId)
}

/** The booking form held the booking and moved itself on to payment. */
export function handleBookingSubmitted(ctx: TurnContext, result: unknown): void {
  const booking = result as { bookingId: string; total: number; listing: string }
  ctx.step('Booking held', `${booking.bookingId} · ${money(booking.total)}`)
  ctx.say(
    `Held ${booking.listing} for you — ${money(booking.total)} in total. ` +
      "Payment next, and it's a mock, so no card is charged.",
  )
}

/** The checkout settled its simulated payment. */
export function handlePaymentConfirmed(ctx: TurnContext, result: unknown): void {
  const paid = result as { confirmation: string }
  ctx.setPhase('done')
  ctx.step('Payment settled (simulated)')
  ctx.say(paid.confirmation)
  recordOutcome(ctx.state, 'paid')
}

/** Shifts an ISO date by whole days, staying in UTC to avoid a local-tz slip. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
