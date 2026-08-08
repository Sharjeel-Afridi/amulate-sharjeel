/**
 * Numeric and formatting helpers shared by both scoring models.
 *
 * Formatting is hand-rolled rather than done with `toLocaleString` because a
 * rationale has to come out byte-identical on every machine — an LLM may
 * rewrite the wording later, but the deterministic fallback is what gets
 * asserted on, cached and diffed.
 */

/**
 * Ages are measured against a fixed year rather than the wall clock. The
 * catalogue is generated against 2026 (see CURRENT_YEAR in @car/catalog), and
 * a ranking that quietly changes every 1 January is not testable.
 */
export const REFERENCE_YEAR = 2026

/**
 * The catalogue encodes "no mileage cap" as a sentinel rather than a real
 * figure, so anything at or above it means unlimited, not 9,999 km a day.
 */
export const UNLIMITED_KM = 9999

export interface Range {
  min: number
  max: number
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function rangeOf<T>(items: readonly T[], select: (item: T) => number): Range {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const item of items) {
    const v = select(item)
    if (v < min) min = v
    if (v > max) max = v
  }
  // An empty set has no spread, so report a degenerate range that `position`
  // reads as "neutral" rather than letting Infinity leak into the arithmetic.
  return items.length ? { min, max } : { min: 0, max: 0 }
}

/**
 * Where `value` sits in [lo, hi] as 0..1. A degenerate range sits dead centre,
 * so a field every candidate happens to share never moves anyone's score.
 */
export function position(value: number, lo: number, hi: number): number {
  if (!(hi > lo)) return 0.5
  return clamp((value - lo) / (hi - lo), 0, 1)
}

export function higherIsBetter(value: number, r: Range): number {
  return position(value, r.min, r.max)
}

export function lowerIsBetter(value: number, r: Range): number {
  return 1 - position(value, r.min, r.max)
}

/** Turns a 0..1 desirability into the -1..1 sub-score the scorers work in. */
export function signed(desirability: number): number {
  return clamp(desirability, 0, 1) * 2 - 1
}

/**
 * How a price sits against a stated budget. Meeting it exactly is neutral —
 * it fits, but it leaves the user nothing — and going over is punished from
 * the first euro rather than fading in gently.
 */
export function budgetSub(value: number, budget: number): number {
  if (budget <= 0) return 0
  if (value <= budget) return clamp((budget - value) / (budget * 0.35), 0, 1)
  return -clamp(0.2 + (value - budget) / (budget * 0.3), 0.2, 1)
}

/**
 * How a value sits against a stated floor (boot litres, seats). Clearing the
 * floor is worth a little on its own and more with headroom; missing it starts
 * at a real penalty rather than at zero, because a floor is a floor.
 */
export function floorSub(value: number, floor: number, headroomFor1: number): number {
  if (floor <= 0) return 0
  if (value >= floor) return 0.15 + 0.85 * clamp((value - floor) / headroomFor1, 0, 1)
  return -clamp(0.25 + (floor - value) / (floor * 0.3), 0.25, 1)
}

/** Whole days between two ISO dates, or undefined if either is missing or unparseable. */
export function daysBetween(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return undefined
  return Math.round((b - a) / 86_400_000)
}

export function thousands(n: number): string {
  const rounded = Math.round(n)
  const sign = rounded < 0 ? '-' : ''
  const digits = String(Math.abs(rounded))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return sign + out
}

export function euro(n: number): string {
  return `€${thousands(n)}`
}

export function kms(n: number): string {
  return `${thousands(n)} km`
}

export function litres(n: number): string {
  return `${thousands(n)} L`
}

export function plural(n: number, word: string): string {
  return `${thousands(n)} ${word}${n === 1 ? '' : 's'}`
}

/** Always one decimal place, so a 4.0 rating does not print as a bare "4". */
export function oneDp(n: number): string {
  return n.toFixed(1)
}

/** Consumption reads in different units per fuel, so the unit follows the car. */
export function consumptionLabel(consumption: number, electric: boolean): string {
  return `${oneDp(consumption)} ${electric ? 'kWh' : 'L'}/100km`
}
