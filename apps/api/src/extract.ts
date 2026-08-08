import { CATEGORIES, type Category, type Mode, type Preferences } from '@car/shared'

/**
 * Best-effort preference extraction from free text.
 *
 * The scripted driver uses this to feel genuinely responsive to what the user
 * typed rather than replaying a fixed script regardless of input. The real agent
 * does this far better with the model, but keeping a deterministic extractor
 * around is useful: it makes the fallback demo coherent, and it gives us a cheap
 * sanity check on what the model extracts.
 */

const CATEGORY_SYNONYMS: Record<Category, string[]> = {
  suv: ['suv', '4x4', 'off road', 'off-road'],
  mpv: ['mpv', 'people carrier', 'minivan', 'people mover'],
  estate: ['estate', 'wagon', 'touring', 'avant'],
  hatchback: ['hatchback', 'hatch', 'city car', 'small car', 'runaround'],
  sedan: ['sedan', 'saloon'],
  pickup: ['pickup', 'pick-up', 'ute', 'truck'],
  convertible: ['convertible', 'cabrio', 'cabriolet', 'drop top', 'roadster', 'soft top'],
  coupe: ['coupe', 'coupé', 'two door', '2 door'],
  sports: ['sports car', 'sportscar', 'performance car', 'fast car'],
  crossover: ['crossover'],
}

const RENT_WORDS = ['rent', 'rental', 'lease', 'hire', 'subscription', 'per month', 'a month', 'monthly']
const BUY_WORDS = ['buy', 'purchase', 'own', 'buying', 'finance', 'part exchange', 'trade in']

function detectMode(t: string): Mode | undefined {
  const buy = BUY_WORDS.some((w) => t.includes(w))
  const rent = RENT_WORDS.some((w) => t.includes(w))
  // "buy" is the stronger signal: "£300 a month" also appears in finance talk.
  if (buy && !rent) return 'buy'
  if (rent && !buy) return 'rent'
  if (buy && rent) return t.indexOf('buy') < t.indexOf('rent') ? 'buy' : 'rent'
  return undefined
}

function detectCategory(t: string): Category | undefined {
  for (const category of CATEGORIES) {
    const synonyms = CATEGORY_SYNONYMS[category] ?? []
    if (synonyms.some((s) => t.includes(s))) return category
  }
  return undefined
}

const MONTHS =
  'january|february|march|april|may|june|july|august|september|october|november|december'

/**
 * Pull a money figure, handling "25k" and "1,200" forms.
 *
 * Every pattern demands monetary context — a currency marker, a money word, or
 * a "per month" suffix. A bare number is never a budget: "from 12 September"
 * previously parsed as a €12 budget, which silently destroyed the real figure
 * the user had given and wrecked the search that followed.
 */
function detectBudget(t: string): number | undefined {
  const patterns = [
    /(?:€|eur|£|\$)\s?(\d[\d,.]*)\s*(k\b)?/i,
    /\b(\d[\d,.]*)\s*(k\b)?\s*(?:€|eur|euros?|quid|pounds?|dollars?)\b/i,
    /\b(?:budget|spend|spending|around|about|up to|under|below|max(?:imum)?|roughly|circa)\b\D{0,14}?(\d[\d,.]*)\s*(k\b)?/i,
    /\b(\d[\d,.]*)\s*(k\b)?\s*(?:a|per|\/)\s*(?:month|mo|year|yr)\b/i,
  ]

  for (const pattern of patterns) {
    const match = t.match(pattern)
    if (!match) continue

    // Reject anything that is really a date: "about 12 September".
    const tail = t.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 12)
    if (new RegExp(`^\\s*(?:${MONTHS})`, 'i').test(tail)) continue

    const raw = Number(match[1]!.replace(/[,.](?=\d{3}\b)/g, '').replace(/,/g, ''))
    if (!Number.isFinite(raw) || raw <= 0) continue
    return match[2] ? raw * 1000 : raw
  }

  return undefined
}

function detectSeats(t: string): number | undefined {
  if (/\b(seven|7)[\s-]?seat/.test(t)) return 7
  if (/\b(five|5)[\s-]?seat/.test(t)) return 5
  const m = t.match(/\b(\d)\s*(?:seats|people|passengers)\b/)
  if (m) return Number(m[1])
  return undefined
}

/** Rough ISO date for relative phrases the demo is likely to hit. */
function detectDate(t: string, now: Date): string | undefined {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december']
  const monthIndex = months.findIndex((m) => t.includes(m))
  if (monthIndex >= 0) {
    const day = Number(t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+[a-z]+/)?.[1] ?? 1)
    const year = monthIndex < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear()
    return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10)
  }
  const plusDays = (n: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }
  if (t.includes('tomorrow')) return plusDays(1)
  if (t.includes('next week')) return plusDays(7)
  if (t.includes('next month')) return plusDays(30)
  if (t.includes('asap') || t.includes('as soon as')) return plusDays(2)
  return undefined
}

export function extractPreferences(
  text: string,
  existing: Preferences,
  now = new Date(),
): Preferences {
  const t = text.toLowerCase()
  const patch: Preferences = {}

  const mode = detectMode(t)
  if (mode && !existing.mode) patch.mode = mode

  const category = detectCategory(t)
  if (category) patch.category = category

  const budget = detectBudget(t)
  if (budget !== undefined) {
    // A monthly figure and a purchase price live on wildly different scales, so
    // use the resolved mode to decide whether a bare number is plausible.
    const resolvedMode = patch.mode ?? existing.mode
    const plausible = resolvedMode === 'buy' ? budget >= 2000 : budget <= 5000
    if (plausible) patch.budgetMax = budget
  }

  const seats = detectSeats(t)
  if (seats) patch.seatsMin = seats

  const date = detectDate(t, now)
  if (date) patch.targetDate = date

  if (/\b(boot|luggage|space|storage|bags?)\b/.test(t)) patch.bootLitresMin = 450
  if (/\b(electric|ev)\b/.test(t)) patch.fuel = 'electric'
  else if (/\bhybrid\b/.test(t)) patch.fuel = 'hybrid'
  else if (/\bdiesel\b/.test(t)) patch.fuel = 'diesel'
  if (/\bautomatic\b/.test(t)) patch.transmission = 'automatic'
  else if (/\bmanual\b/.test(t)) patch.transmission = 'manual'

  // The first substantive thing said is usually the use case, and it is what
  // rationales quote back, so keep the user's own wording rather than a label.
  if (!existing.useCase && text.trim().length > 12) {
    patch.useCase = text.trim().replace(/\s+/g, ' ').slice(0, 120)
  }

  return patch
}

/** Human-readable spec line the agent states back before searching. */
export function describeSpec(prefs: Preferences): string {
  const parts: string[] = []
  parts.push(prefs.mode === 'buy' ? 'buying' : 'renting')
  if (prefs.category) parts.push(`a ${prefs.category}`)
  if (prefs.budgetMax) {
    parts.push(
      prefs.mode === 'buy'
        ? `up to €${prefs.budgetMax.toLocaleString('en-IE')}`
        : `up to €${prefs.budgetMax.toLocaleString('en-IE')}/month`,
    )
  }
  if (prefs.targetDate) parts.push(`from ${prefs.targetDate}`)
  if (prefs.seatsMin && prefs.seatsMin > 5) parts.push(`${prefs.seatsMin} seats`)
  if (prefs.bootLitresMin) parts.push(`boot over ${prefs.bootLitresMin} L`)
  if (prefs.fuel) parts.push(String(prefs.fuel))
  return parts.join(', ')
}
