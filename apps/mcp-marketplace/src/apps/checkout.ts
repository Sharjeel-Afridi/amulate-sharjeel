import { carArt } from '@car/catalog'
import type { Booking, Listing } from '@car/shared'
import { isRental } from '@car/shared'
import { BRIDGE_JS, esc, layout } from '../theme.js'
import { extrasFor } from './booking-form.js'

/**
 * Mock checkout, as an MCP App.
 *
 * The card fields are deliberately `readonly` and pre-filled with the universal
 * test number: this flow must be impossible to use with a real card, not merely
 * discouraged from it. Nothing entered here is transmitted, stored, or charged.
 */
export function checkoutHtml(booking: Booking, listing: Listing): string {
  const rental = isRental(listing)
  const extras = extrasFor(listing)
  const chosen = extras.filter((e) => booking.extras.includes(e.id))

  const days =
    rental && booking.startDate && booking.endDate
      ? Math.max(
          1,
          Math.ceil(
            (new Date(booking.endDate).getTime() - new Date(booking.startDate).getTime()) / 86400000,
          ),
        )
      : 1

  const baseTotal = rental ? listing.dailyRate * days : listing.price
  const money = (v: number) => `€${Math.round(v).toLocaleString('en-IE')}`

  const lines = [
    `<div class="line"><span>${
      rental ? `${money(listing.dailyRate)} × ${days} day${days === 1 ? '' : 's'}` : 'Vehicle'
    }</span><span>${money(baseTotal)}</span></div>`,
    ...chosen.map(
      (e) =>
        `<div class="line"><span>${esc(e.label)}</span><span>${money(
          e.perDay ? e.price * days : e.price,
        )}</span></div>`,
    ),
  ].join('')

  const body = `
<div class="card stack" id="pay-card">
  <div class="mock-banner">
    <span aria-hidden="true">⚠</span>
    <span><strong>Mock checkout.</strong> No payment is processed and no card details are collected or stored.</span>
  </div>

  <div class="row">
    <div class="art">${carArt(listing.brand, listing.category)}</div>
    <div style="min-width:0">
      <h1>${esc(listing.brand)} ${esc(listing.model)}</h1>
      <div class="tiny muted">Booking ${esc(booking.id)}${
        booking.startDate ? ` · from ${esc(booking.startDate)}` : ''
      }${booking.endDate ? ` to ${esc(booking.endDate)}` : ''}</div>
    </div>
  </div>

  <div class="divider"></div>
  <div class="stack" style="gap:0">${lines}</div>
  <div class="divider"></div>

  <div class="between">
    <span class="muted tiny">Total</span>
    <span class="total">${money(booking.total)}</span>
  </div>

  <div>
    <label class="label" for="card">Card number — demo value, not editable</label>
    <input id="card" type="text" value="4242 4242 4242 4242" readonly tabindex="-1" aria-readonly="true">
  </div>
  <div class="grid2">
    <div>
      <label class="label" for="exp">Expiry</label>
      <input id="exp" type="text" value="12 / 30" readonly tabindex="-1" aria-readonly="true">
    </div>
    <div>
      <label class="label" for="cvc">CVC</label>
      <input id="cvc" type="text" value="•••" readonly tabindex="-1" aria-readonly="true">
    </div>
  </div>

  <button class="primary" id="pay">Pay ${money(booking.total)} (simulated)</button>
  <div class="tiny muted" style="text-align:center">This button settles a fake transaction only.</div>
</div>

<div class="card done" id="done" style="display:none">
  <div class="check" aria-hidden="true">✓</div>
  <h1>Booking confirmed</h1>
  <div class="tiny muted" style="margin-top:6px">
    ${esc(booking.id)} · ${esc(listing.brand)} ${esc(listing.model)} · ${money(booking.total)}
  </div>
  <div class="tiny muted" style="margin-top:12px">A mock confirmation has been generated. No charge was made.</div>
</div>`

  const script = `${BRIDGE_JS}
const BOOKING_ID = ${JSON.stringify(booking.id)};
const pay = document.getElementById('pay');

pay.addEventListener('click', () => {
  pay.disabled = true;
  pay.textContent = 'Processing…';
  // A short delay so the simulated settle reads as a real step rather than a jump.
  setTimeout(() => {
    document.getElementById('pay-card').style.display = 'none';
    document.getElementById('done').style.display = 'block';
    reportSize();
    callTool('confirm_payment', { bookingId: BOOKING_ID });
  }, 900);
});
`

  return layout(body, script)
}
