import { CURRENCY_SYMBOL, type Listing, isRental, money, moneyExact } from '@car/shared'
import { BRIDGE_JS, esc, layout } from '../theme.js'

export interface Extra {
  id: string
  label: string
  price: number
  /** Rental extras are charged per day; purchase extras are one-off. */
  perDay: boolean
}

export const RENTAL_EXTRAS: Extra[] = [
  { id: 'insurance', label: 'Full insurance (zero excess)', price: 12, perDay: true },
  { id: 'additional-driver', label: 'Additional driver', price: 7, perDay: true },
  { id: 'child-seat', label: 'Child seat', price: 5, perDay: true },
  { id: 'winter-tyres', label: 'Winter tyres', price: 4, perDay: true },
]

export const PURCHASE_EXTRAS: Extra[] = [
  { id: 'warranty', label: 'Extended warranty, 24 months', price: 890, perDay: false },
  { id: 'delivery', label: 'Home delivery', price: 249, perDay: false },
  { id: 'winter-set', label: 'Winter tyre set', price: 640, perDay: false },
]

export function extrasFor(listing: Listing): Extra[] {
  return isRental(listing) ? RENTAL_EXTRAS : PURCHASE_EXTRAS
}

export interface BookingFormDefaults {
  startDate?: string
  endDate?: string
}

function isoPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The booking form, as a self-contained MCP App. Prices recalculate live in the
 * iframe so the user sees the effect of each extra before committing; the same
 * arithmetic is re-run server-side on submit, because nothing the iframe reports
 * is trusted.
 */
export function bookingFormHtml(listing: Listing, defaults: BookingFormDefaults = {}): string {
  const rental = isRental(listing)
  const extras = extrasFor(listing)
  const base = rental ? listing.dailyRate : listing.price
  const start = defaults.startDate ?? isoPlusDays(7)
  const end = defaults.endDate ?? isoPlusDays(14)

  const priceLabel = rental
    ? `${moneyExact(listing.dailyRate)}/day · ${money(listing.monthlyRate)}/mo`
    : money(listing.price)

  const body = `
<div class="card stack">
  <div class="row">
    <div class="art"><img src="${esc(listing.imageUrl)}" alt="" loading="lazy"></div>
    <div style="min-width:0">
      <h1>${esc(listing.brand)} ${esc(listing.model)}</h1>
      <div class="tiny muted">${esc(listing.year)} · ${esc(listing.fuel)} · ${esc(listing.transmission)} · ${esc(listing.location)}</div>
    </div>
    <div style="margin-left:auto;text-align:right" class="tiny muted">${priceLabel}</div>
  </div>

  <div class="divider"></div>

  <div class="grid2">
    <div>
      <label class="label" for="name">Full name</label>
      <input id="name" type="text" placeholder="Alex Moreau" autocomplete="off">
    </div>
    <div>
      <label class="label" for="email">Email</label>
      <input id="email" type="email" placeholder="alex@example.com" autocomplete="off">
    </div>
  </div>

  ${
    rental
      ? `<div class="grid2">
    <div>
      <label class="label" for="start">Pick-up</label>
      <input id="start" type="date" value="${start}">
    </div>
    <div>
      <label class="label" for="end">Return</label>
      <input id="end" type="date" value="${end}">
    </div>
  </div>`
      : `<div>
      <label class="label" for="start">Preferred collection date</label>
      <input id="start" type="date" value="${start}">
    </div>`
  }

  <div>
    <h2 style="margin-bottom:8px">Extras</h2>
    <div class="stack" style="gap:8px">
      ${extras
        .map(
          (e) => `<label class="extra">
        <input type="checkbox" data-extra="${e.id}" data-price="${e.price}" data-perday="${e.perDay}">
        <span>${esc(e.label)}</span>
        <span class="price">${money(e.price)}${e.perDay ? '/day' : ''}</span>
      </label>`,
        )
        .join('')}
    </div>
  </div>

  <div class="divider"></div>

  <div id="lines" class="stack" style="gap:0"></div>

  <div class="between" style="margin-top:6px">
    <span class="muted tiny">${rental ? 'Total for the period' : 'Total payable'}</span>
    <span class="total" id="total">${money(0)}</span>
  </div>

  <div class="err" id="err"></div>
  <button class="primary" id="submit">Continue to payment</button>
  <div class="tiny muted" style="text-align:center">No payment is taken at this step.</div>
</div>`

  const script = `${BRIDGE_JS}
const RENTAL = ${rental};
const BASE = ${base};
const LISTING_ID = ${JSON.stringify(listing.id)};
const el = (id) => document.getElementById(id);

function days() {
  if (!RENTAL) return 1;
  const a = new Date(el('start').value), b = new Date(el('end').value);
  const d = Math.ceil((b - a) / 86400000);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function selectedExtras() {
  return [...document.querySelectorAll('[data-extra]')]
    .filter((c) => c.checked)
    .map((c) => ({
      id: c.dataset.extra,
      label: c.closest('.extra').querySelector('span').textContent,
      price: Number(c.dataset.price),
      perDay: c.dataset.perday === 'true',
    }));
}

function compute() {
  const n = days();
  const baseTotal = RENTAL ? BASE * n : BASE;
  const extras = selectedExtras();
  const extrasTotal = extras.reduce((s, e) => s + (e.perDay ? e.price * n : e.price), 0);
  return { n, baseTotal, extras, extrasTotal, total: baseTotal + extrasTotal };
}

function money(v) { return ${JSON.stringify(CURRENCY_SYMBOL)} + Math.round(v).toLocaleString('en-US'); }

function render() {
  const { n, baseTotal, extras, extrasTotal, total } = compute();
  const rows = [];
  rows.push('<div class="line"><span>' + (RENTAL ? money(BASE) + ' x ' + n + ' day' + (n === 1 ? '' : 's') : 'Vehicle') + '</span><span>' + money(baseTotal) + '</span></div>');
  for (const e of extras) {
    rows.push('<div class="line"><span>' + e.label + '</span><span>' + money(e.perDay ? e.price * n : e.price) + '</span></div>');
  }
  if (extras.length === 0) rows.push('<div class="line"><span>No extras</span><span>' + money(0) + '</span></div>');
  el('lines').innerHTML = rows.join('');
  el('total').textContent = money(total);

  const validDates = !RENTAL || n > 0;
  el('err').textContent = validDates ? '' : 'Return date must be after pick-up.';
  el('submit').disabled = !validDates;
  reportSize();
}

document.addEventListener('input', render);
document.addEventListener('change', render);
render();

el('submit').addEventListener('click', () => {
  const name = el('name').value.trim();
  const email = el('email').value.trim();
  if (!name || !email) {
    el('err').textContent = 'Name and email are both needed to hold the booking.';
    el('name').setAttribute('aria-invalid', String(!name));
    el('email').setAttribute('aria-invalid', String(!email));
    return;
  }
  const { extras, total } = compute();
  el('submit').disabled = true;
  el('submit').textContent = 'Submitting…';
  el('err').textContent = '';

  callTool('submit_booking', {
    listingId: LISTING_ID,
    fullName: name,
    email: email,
    startDate: el('start').value,
    endDate: RENTAL ? el('end').value : undefined,
    extras: extras.map((e) => e.id),
    expectedTotal: total,
  }).catch(function (err) {
    // The host owns what happens next on success; we only handle the failure
    // path, so a dropped call doesn't leave the button stuck on "Submitting…".
    el('err').textContent = (err && err.message) || 'Could not submit — please try again.';
    el('submit').disabled = false;
    el('submit').textContent = 'Continue to payment';
    reportSize();
  });
});
`

  return layout(body, script)
}
