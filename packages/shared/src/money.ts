/**
 * One place decides how money is written.
 *
 * The catalogue is priced in whatever the marketplace quoted — the scrape came
 * back in USD — and that has to reach the interview's budget slider, the ranked
 * cards, the rationales, the booking form and the checkout without any of them
 * disagreeing. Before this it was thirteen files each hard-coding a symbol,
 * which is exactly the kind of thing that survives right up until a demo.
 */

export const CURRENCY_CODE = 'USD'
export const CURRENCY_SYMBOL = '$'

const LOCALE = 'en-US'

/** `$1,520`. Whole units — how a car is priced when you talk about it. */
export function money(amount: number): string {
  return `${CURRENCY_SYMBOL}${Math.round(amount).toLocaleString(LOCALE)}`
}

/** `$72.37`, but `$1,520` when there is nothing after the point. */
export function moneyExact(amount: number): string {
  return Number.isInteger(amount)
    ? money(amount)
    : `${CURRENCY_SYMBOL}${amount.toLocaleString(LOCALE, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
}

/** `$1,520/month` for rentals; purchases are quoted outright. */
export function moneyPerMonth(amount: number): string {
  return `${money(amount)}/month`
}
