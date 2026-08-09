import { CURRENCY_SYMBOL, type Listing, isRental, money, moneyExact } from '@car/shared'
import { BRIDGE_JS, esc, layout } from '../theme.js'

export interface Extra {
  id: string
  label: string
  /** One line on what it actually buys you — a price with no context is a tax. */
  note: string
  price: number
  /** Rental extras are charged per day; purchase extras are one-off. */
  perDay: boolean
}

export const RENTAL_EXTRAS: Extra[] = [
  {
    id: 'insurance',
    label: 'Full protection',
    note: 'Zero excess. Damage and theft covered outright.',
    price: 12,
    perDay: true,
  },
  {
    id: 'additional-driver',
    label: 'Additional driver',
    note: 'A second named driver on the same cover.',
    price: 7,
    perDay: true,
  },
  {
    id: 'child-seat',
    label: 'Child seat',
    note: 'Group 1–3, fitted before collection.',
    price: 5,
    perDay: true,
  },
  {
    id: 'winter-tyres',
    label: 'Winter tyres',
    note: 'Required in some regions from November.',
    price: 4,
    perDay: true,
  },
]

export const PURCHASE_EXTRAS: Extra[] = [
  {
    id: 'warranty',
    label: 'Extended warranty',
    note: '24 months, parts and labour, transferable.',
    price: 890,
    perDay: false,
  },
  {
    id: 'delivery',
    label: 'Home delivery',
    note: 'Delivered to your address within 14 days.',
    price: 249,
    perDay: false,
  },
  {
    id: 'winter-set',
    label: 'Winter tyre set',
    note: 'Four tyres on steel rims, unfitted.',
    price: 640,
    perDay: false,
  },
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
 * The booking journey, as a single self-contained MCP App.
 *
 * Four steps — when, what cover, who, and paying — with exactly one on screen at
 * a time and every step after the first walkable back. This replaces a pair of
 * widgets that each rendered as one long page and then stacked on top of one
 * another in the conversation, which meant a filled-in booking form sat above
 * the payment screen for the rest of the session. Nobody spending several
 * hundred euros should have to scroll past their own answers to find the button.
 *
 * The arithmetic runs live in the iframe so the effect of each extra is visible
 * before committing, and is re-run server-side on submit, because nothing the
 * iframe reports is trusted.
 */
export function bookingFormHtml(listing: Listing, defaults: BookingFormDefaults = {}): string {
  const rental = isRental(listing)
  const extras = extrasFor(listing)
  const base = rental ? listing.dailyRate : listing.price
  const start = defaults.startDate ?? isoPlusDays(7)
  const end = defaults.endDate ?? isoPlusDays(14)

  const rateLabel = rental ? `${moneyExact(listing.dailyRate)}` : money(listing.price)
  const ratePeriod = rental ? 'per day' : 'total'

  const stepNames = rental
    ? ['Rental period', 'Protection', 'Driver', 'Payment']
    : ['Collection', 'Add-ons', 'Your details', 'Payment']

  const stepsNav = stepNames
    .map(
      (name, i) => `${i > 0 ? '<span class="steps__rule"></span>' : ''}
      <button type="button" class="steps__item" data-goto="${i}" data-active="${i === 0 ? 1 : 0}" data-done="0">
        <span class="steps__num">${i + 1}</span>
        <span class="steps__label">${esc(name)}</span>
      </button>`,
    )
    .join('')

  const periodStep = rental
    ? `<div class="field">
        <span class="field__label">Pick-up location</span>
        <div class="readonly"><span aria-hidden="true">📍</span>${esc(listing.location)}</div>
      </div>
      <div class="grid2">
        <div class="field" id="f-start">
          <label class="field__label" for="start">Pick-up date</label>
          <input id="start" type="date" value="${start}">
        </div>
        <div class="field" id="f-end">
          <label class="field__label" for="end">Return date</label>
          <input id="end" type="date" value="${end}">
        </div>
      </div>
      <div class="field__hint" id="duration"></div>
      <div class="field__error" id="e-period"></div>`
    : `<div class="field">
        <span class="field__label">Collect from</span>
        <div class="readonly"><span aria-hidden="true">📍</span>${esc(listing.location)}</div>
      </div>
      <div class="field" id="f-start">
        <label class="field__label" for="start">Preferred collection date</label>
        <input id="start" type="date" value="${start}">
        <div class="field__hint">We will confirm the slot by email.</div>
      </div>
      <div class="field__error" id="e-period"></div>`

  const extrasStep = extras
    .map(
      (e) => `<label class="option">
      <input type="checkbox" data-extra="${e.id}" data-price="${e.price}" data-perday="${e.perDay}">
      <span class="option__body">
        <span class="option__name">${esc(e.label)}</span>
        <span class="option__note">${esc(e.note)}</span>
      </span>
      <span class="option__price">${money(e.price)}${e.perDay ? '<small>/day</small>' : ''}</span>
    </label>`,
    )
    .join('')

  const body = `
<div class="app">
  <div class="summary">
    <div class="summary__art"><img src="${esc(listing.imageUrl)}" alt="" loading="lazy"></div>
    <div class="summary__body">
      <div class="summary__name">${esc(listing.brand)} ${esc(listing.model)}</div>
      <div class="summary__meta">${esc(listing.year)} · ${esc(listing.fuel)} · ${esc(listing.transmission)} · ${esc(listing.seats)} seats</div>
    </div>
    <div class="summary__rate"><b>${rateLabel}</b><span>${ratePeriod}</span></div>
  </div>

  <nav class="steps" id="steps" aria-label="Booking steps">${stepsNav}</nav>

  <section class="step" data-step="0" data-current="1">
    <h2 class="step__title">${rental ? 'When do you need it?' : 'When would you collect?'}</h2>
    <p class="step__lede">${
      rental
        ? 'Prices are per day and update as you change the dates.'
        : 'Pick a date that suits you — nothing is committed yet.'
    }</p>
    ${periodStep}
  </section>

  <section class="step" data-step="1">
    <h2 class="step__title">${rental ? 'Protection and extras' : 'Add-ons'}</h2>
    <p class="step__lede">${
      rental ? 'Optional. Skip anything you do not want.' : 'Optional, and all of it can be added later.'
    }</p>
    ${extrasStep}
    <div class="lines" id="lines"></div>
  </section>

  <section class="step" data-step="2">
    <h2 class="step__title">${rental ? 'Who is driving?' : 'Your details'}</h2>
    <p class="step__lede">We hold the ${rental ? 'booking' : 'vehicle'} against this name.</p>
    <div class="grid2">
      <div class="field" id="f-name">
        <label class="field__label" for="name">Full name</label>
        <input id="name" type="text" placeholder="Alex Moreau" autocomplete="off">
      </div>
      <div class="field" id="f-email">
        <label class="field__label" for="email">Email</label>
        <input id="email" type="email" placeholder="alex@example.com" autocomplete="off">
      </div>
    </div>
    <div class="field" id="f-phone">
      <label class="field__label" for="phone">Phone <span style="color:var(--faint)">(optional)</span></label>
      <input id="phone" type="text" placeholder="+49 170 0000000" autocomplete="off">
    </div>
    <div class="field__error" id="e-driver"></div>
  </section>

  <section class="step" data-step="3">
    <h2 class="step__title">Payment</h2>
    <div class="mock-banner" style="margin-bottom:14px">
      <span aria-hidden="true">⚠</span>
      <span><strong>Mock checkout.</strong> No payment is processed and no card details are collected or stored.</span>
    </div>
    <div class="lines" id="pay-lines" style="border-top:0;margin-top:0;padding-top:0"></div>
    <div class="field" style="margin-top:16px">
      <label class="field__label" for="card">Card number — demo value, not editable</label>
      <input id="card" type="text" value="4242 4242 4242 4242" readonly tabindex="-1" aria-readonly="true">
    </div>
    <div class="grid2">
      <div class="field">
        <label class="field__label" for="exp">Expiry</label>
        <input id="exp" type="text" value="12 / 30" readonly tabindex="-1" aria-readonly="true">
      </div>
      <div class="field">
        <label class="field__label" for="cvc">CVC</label>
        <input id="cvc" type="text" value="•••" readonly tabindex="-1" aria-readonly="true">
      </div>
    </div>
    <div class="field__error" id="e-pay"></div>
  </section>

  <section class="step" data-step="4">
    <div class="done">
      <div class="check" aria-hidden="true">✓</div>
      <h1>${rental ? 'Booking confirmed' : 'Purchase confirmed'}</h1>
      <div class="tiny muted" style="margin-top:6px" id="done-detail"></div>
    </div>
    <div class="lines" id="done-lines"></div>
    <div class="note">A mock confirmation has been generated. No charge was made.</div>
  </section>

  <div class="bar" id="bar">
    <div class="bar__total"><span id="total-label">Total</span><b id="total">${money(0)}</b></div>
    <button type="button" class="btn btn--back" id="back" style="display:none">← Back</button>
    <button type="button" class="btn btn--primary" id="next">Continue</button>
  </div>
  <div class="note" id="note">No payment is taken until the last step.</div>
</div>`

  const script = `${BRIDGE_JS}
const RENTAL = ${rental};
const BASE = ${base};
const LISTING_ID = ${JSON.stringify(listing.id)};
const CAR = ${JSON.stringify(`${listing.brand} ${listing.model}`)};
const MIN_DAYS = ${rental ? listing.minRentalDays : 1};
const LAST_STEP = 3;
const el = (id) => document.getElementById(id);

var step = 0;
var booking = null;

function money(v) { return ${JSON.stringify(CURRENCY_SYMBOL)} + Math.round(v).toLocaleString('en-US'); }

function days() {
  if (!RENTAL) return 1;
  const a = new Date(el('start').value), b = new Date(el('end').value);
  const d = Math.ceil((b - a) / 86400000);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function selectedExtras() {
  return [].slice.call(document.querySelectorAll('[data-extra]'))
    .filter(function (c) { return c.checked; })
    .map(function (c) {
      return {
        id: c.dataset.extra,
        label: c.closest('.option').querySelector('.option__name').textContent,
        price: Number(c.dataset.price),
        perDay: c.dataset.perday === 'true',
      };
    });
}

function compute() {
  const n = days();
  const baseTotal = RENTAL ? BASE * n : BASE;
  const extras = selectedExtras();
  const extrasTotal = extras.reduce(function (s, e) { return s + (e.perDay ? e.price * n : e.price); }, 0);
  return { n: n, baseTotal: baseTotal, extras: extras, extrasTotal: extrasTotal, total: baseTotal + extrasTotal };
}

function lineRows() {
  const c = compute();
  const rows = ['<div class="line"><span>' +
    (RENTAL ? money(BASE) + ' × ' + c.n + ' day' + (c.n === 1 ? '' : 's') : 'Vehicle') +
    '</span><span>' + money(c.baseTotal) + '</span></div>'];
  for (var i = 0; i < c.extras.length; i++) {
    var e = c.extras[i];
    rows.push('<div class="line"><span>' + e.label + '</span><span>' +
      money(e.perDay ? e.price * c.n : e.price) + '</span></div>');
  }
  if (!c.extras.length) rows.push('<div class="line"><span>No extras</span><span>' + money(0) + '</span></div>');

  // The server recomputes the total and its figure is the one charged. If the
  // two ever disagree, showing the difference is the only honest option — a
  // breakdown that does not add up to the amount payable is worse than no
  // breakdown at all.
  if (booking && Math.round(booking.total) !== Math.round(c.total)) {
    rows.push('<div class="line"><span>Adjusted by the provider</span><span>' +
      money(booking.total - c.total) + '</span></div>');
  }
  return rows.join('');
}

/** The receipt shown once the simulated payment settles. */
function receiptRows() {
  const c = compute();
  const rows = [];
  rows.push('<div class="line"><span>' + (RENTAL ? 'Hire' : 'Vehicle') + '</span><span>' + CAR + '</span></div>');
  if (RENTAL) {
    rows.push('<div class="line"><span>Dates</span><span>' +
      el('start').value + ' → ' + el('end').value + ' (' + c.n + ' days)</span></div>');
  } else {
    rows.push('<div class="line"><span>Collection</span><span>' + el('start').value + '</span></div>');
  }
  rows.push('<div class="line"><span>' + (RENTAL ? 'Driver' : 'Buyer') + '</span><span>' + el('name').value.trim() + '</span></div>');
  rows.push('<div class="line"><span>Confirmation sent to</span><span>' + el('email').value.trim() + '</span></div>');
  if (c.extras.length) {
    rows.push('<div class="line"><span>Extras</span><span>' +
      c.extras.map(function (e) { return e.label; }).join(', ') + '</span></div>');
  }
  rows.push('<div class="line"><span>Paid (simulated)</span><span>' + money(booking ? booking.total : c.total) + '</span></div>');
  return rows.join('');
}

/** Redraws every derived figure. Cheap enough to run on any input. */
function recalc() {
  const c = compute();
  if (RENTAL) {
    el('duration').textContent = c.n > 0
      ? c.n + ' day' + (c.n === 1 ? '' : 's') + ' · ' + money(c.baseTotal) + ' before extras'
      : '';
  }
  el('lines').innerHTML = lineRows();
  el('pay-lines').innerHTML = lineRows();
  // Once the server has held the booking its figure is the one that counts.
  el('total').textContent = money(booking ? booking.total : c.total);
  el('total-label').textContent = step >= LAST_STEP ? 'Amount payable' : (RENTAL ? 'Estimated total' : 'Total');
}

/** Returns an error message for the current step, or null when it may advance. */
function problem() {
  if (step === 0) {
    if (!el('start').value) return 'Pick a date to continue.';
    if (RENTAL) {
      if (days() <= 0) return 'The return date has to be after the pick-up date.';
      if (days() < MIN_DAYS) return 'This car has a ' + MIN_DAYS + '-day minimum hire.';
    }
    return null;
  }
  if (step === 2) {
    const name = el('name').value.trim();
    const email = el('email').value.trim();
    el('f-name').classList.toggle('field--bad', !name);
    el('f-email').classList.toggle('field--bad', !/.+@.+\\..+/.test(email));
    if (!name) return 'We need a name to hold this.';
    if (!/.+@.+\\..+/.test(email)) return 'That email address does not look right.';
    return null;
  }
  return null;
}

function clearErrors() {
  el('e-period').textContent = '';
  el('e-driver').textContent = '';
  el('e-pay').textContent = '';
}

function show(next) {
  step = next;
  const sections = document.querySelectorAll('.step');
  for (var i = 0; i < sections.length; i++) {
    sections[i].setAttribute('data-current', Number(sections[i].dataset.step) === step ? '1' : '0');
  }
  const items = document.querySelectorAll('.steps__item');
  for (var j = 0; j < items.length; j++) {
    items[j].setAttribute('data-active', j === step ? '1' : '0');
    items[j].setAttribute('data-done', j < step ? '1' : '0');
  }

  const done = step > LAST_STEP;
  el('steps').style.display = done ? 'none' : '';
  el('bar').style.display = done ? 'none' : 'flex';
  el('note').style.display = done ? 'none' : '';
  // Back is hidden on the first step and once the booking is held: the details
  // are with the server by then, so "back" would be a lie.
  el('back').style.display = step > 0 && step < LAST_STEP ? '' : 'none';
  el('next').textContent = step === LAST_STEP
    ? 'Pay ' + el('total').textContent + ' (simulated)'
    : (step === 2 ? 'Confirm and continue' : 'Continue');
  el('note').textContent = step === LAST_STEP
    ? 'This button settles a fake transaction only.'
    : 'No payment is taken until the last step.';

  clearErrors();
  recalc();
  if (step === LAST_STEP) el('next').textContent = 'Pay ' + el('total').textContent + ' (simulated)';
  reportSize();
}

/** Holds the booking server-side, then moves on to payment. */
function submitBooking() {
  const c = compute();
  el('next').disabled = true;
  el('next').textContent = 'Holding…';

  return callTool('submit_booking', {
    listingId: LISTING_ID,
    fullName: el('name').value.trim(),
    email: el('email').value.trim(),
    startDate: el('start').value,
    endDate: RENTAL ? el('end').value : undefined,
    extras: c.extras.map(function (e) { return e.id; }),
    expectedTotal: c.total,
  }).then(function (result) {
    booking = parseResult(result) || { total: c.total };
    el('next').disabled = false;
    show(3);
  }).catch(function (err) {
    el('next').disabled = false;
    el('next').textContent = 'Confirm and continue';
    el('e-driver').textContent = (err && err.message) || 'Could not hold that — please try again.';
    reportSize();
  });
}

function pay() {
  el('next').disabled = true;
  el('next').textContent = 'Processing…';

  // A short delay so the simulated settle reads as a step rather than a jump —
  // but the confirmation is gated on the server actually confirming, never on
  // the timer alone.
  const settled = new Promise(function (r) { setTimeout(r, 900); });

  Promise.all([settled, callTool('confirm_payment', { bookingId: booking && booking.bookingId })])
    .then(function (all) {
      const paid = parseResult(all[1]) || {};
      el('done-detail').textContent = 'Reference ' + (paid.bookingId || (booking && booking.bookingId) || '—');
      el('done-lines').innerHTML = receiptRows();
      show(4);
    })
    .catch(function (err) {
      el('next').disabled = false;
      el('next').textContent = 'Retry payment (simulated)';
      el('e-pay').textContent = (err && err.message) || 'Could not confirm — please try again.';
      reportSize();
    });
}

/** Tool results come back as MCP content blocks carrying JSON text. */
function parseResult(result) {
  try {
    const block = result && result.content && result.content[0];
    return block && block.text ? JSON.parse(block.text) : null;
  } catch (e) {
    return null;
  }
}

el('next').addEventListener('click', function () {
  const issue = problem();
  if (issue) {
    el(step === 0 ? 'e-period' : 'e-driver').textContent = issue;
    reportSize();
    return;
  }
  clearErrors();
  if (step === 2) return submitBooking();
  if (step === LAST_STEP) return pay();
  show(step + 1);
});

el('back').addEventListener('click', function () {
  if (step > 0) show(step - 1);
});

// Only steps already completed are reachable from the progress bar; jumping
// ahead would skip the validation that guards each one.
el('steps').addEventListener('click', function (event) {
  const item = event.target.closest('[data-goto]');
  if (!item || item.getAttribute('data-done') !== '1') return;
  if (step > LAST_STEP - 1) return;
  show(Number(item.dataset.goto));
});

document.addEventListener('input', recalc);
document.addEventListener('change', recalc);

show(0);
`

  return layout(body, script)
}
