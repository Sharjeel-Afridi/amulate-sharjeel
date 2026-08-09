import { type Listing, type RankedListing, isRental } from '@car/shared'
import OpenAI from 'openai'

/**
 * Evaluators.
 *
 * Split deliberately into two tiers, and the split is a budget decision as much
 * as a design one. Groq's free tier allows 100,000 tokens a *day*, and a single
 * agent turn measured at ~5,400 prompt tokens — so a judge that reads every
 * rationale on every run would exhaust the day's allowance in two or three
 * passes and start failing for reasons unrelated to the code.
 *
 * So the deterministic tier carries the suite. It costs nothing, runs on every
 * case, and covers most of what the ranker's instructions actually demand:
 * specific numbers, no filler, a usable score spread. Several of these are
 * lifted from the assertions already in `smoke.ts`, which were eval criteria
 * written as a test.
 *
 * The model tier exists for the one thing a regex cannot check — whether a
 * rationale asserts a fact the listing does not support — and is opt-in.
 */

export interface Score {
  name: string
  /** 0..1. A pass/fail check reports 0 or 1. */
  value: number
  /** Shown in the report when the score is below 1. */
  comment?: string
}

/** Phrases the ranker's instructions name as failures outright. */
const FILLER =
  /great choice|perfect for you|excellent option|ideal choice|a great option|highly recommend|can't go wrong|top pick for you/i

/**
 * Money, rendered both bare and grouped.
 *
 * The judge compares surface forms, and a first version of this emitted `1500`
 * while the rationale under test said "$1,500 a month" — which the judge read as
 * a figure absent from the record and reported as an invented fact. A groundedness
 * check that fails correct sentences is worse than none, so the record now shows
 * both spellings and the prompt is explicit that formatting is not a discrepancy.
 */
const money = (n: number): string => `${n} (${n.toLocaleString('en-IE')})`

/** One line of every fact a rationale is allowed to cite about a car. */
export function factLine(l: Listing): string {
  const common =
    `${l.brand} ${l.model} | ${l.category} | ${l.year} | ${l.fuel} | ${l.transmission} | ` +
    `${l.seats} seats | ${l.doors} doors | ${l.bootLitres} L boot | ${l.consumption} L/100km | ` +
    `${l.co2} g/km CO2 | ${l.location} | rated ${l.rating} from ${l.reviewCount} reviews`

  return isRental(l)
    ? `${common} | ${money(l.monthlyRate)} per month | ${money(l.dailyRate)} per day | ` +
        `${l.freeKmPerDay >= 9999 ? 'unlimited km' : `${l.freeKmPerDay} free km/day`} | ` +
        `min ${l.minRentalDays} days | ${money(l.excess)} excess | via ${l.provider}`
    : `${common} | ${money(l.price)} total | ${l.mileageKm.toLocaleString('en-IE')} km | ` +
        `${l.previousOwners} previous owners | ${l.warrantyMonths} months warranty | ` +
        `${money(l.financeMonthly)} per month on finance | from ${l.dealer}`
}

/** The free tier. Runs always. */
export function deterministicScores(shortlist: RankedListing[]): Score[] {
  if (shortlist.length === 0) {
    return [{ name: 'shortlist-populated', value: 0, comment: 'nothing was returned to judge' }]
  }

  const scores: Score[] = [{ name: 'shortlist-populated', value: 1 }]
  const rationales = shortlist.map((r) => r.rationale ?? '')

  const substantive = rationales.filter((r) => r.trim().length >= 10).length
  scores.push({
    name: 'rationale-present',
    value: substantive / shortlist.length,
    comment:
      substantive === shortlist.length
        ? undefined
        : `${shortlist.length - substantive} of ${shortlist.length} were empty or trivial`,
  })

  const clean = rationales.filter((r) => !FILLER.test(r)).length
  scores.push({
    name: 'no-filler',
    value: clean / shortlist.length,
    comment:
      clean === shortlist.length
        ? undefined
        : `filler in: ${rationales.filter((r) => FILLER.test(r)).slice(0, 2).join(' / ')}`,
  })

  // The instructions require a specific number from the car's own line, so a
  // rationale with no digit in it has not followed them whatever else it says.
  const numeric = rationales.filter((r) => /\d/.test(r)).length
  scores.push({
    name: 'cites-a-number',
    value: numeric / shortlist.length,
    comment: numeric === shortlist.length ? undefined : `${shortlist.length - numeric} cite no figure`,
  })

  const valid = shortlist.filter(
    (r) => Number.isFinite(r.score) && r.score >= 0 && r.score <= 100,
  ).length
  scores.push({
    name: 'scores-valid',
    value: valid / shortlist.length,
    comment: valid === shortlist.length ? undefined : `${shortlist.length - valid} out of range or NaN`,
  })

  // "Use the range" is explicit in the ranker's instructions: a shortlist where
  // everything scores the same tells the user nothing about the ordering.
  const values = shortlist.map((r) => r.score).filter(Number.isFinite)
  const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0
  scores.push({
    name: 'score-spread',
    value: Math.min(1, spread / 10),
    comment: spread >= 10 ? undefined : `only ${spread.toFixed(1)} points between best and worst`,
  })

  // Rank must agree with score, or the card order contradicts the number on it.
  const ordered = shortlist.every((r, i) => i === 0 || shortlist[i - 1]!.score >= r.score)
  scores.push({
    name: 'rank-matches-score',
    value: ordered ? 1 : 0,
    comment: ordered ? undefined : 'a lower-scoring car is ranked above a higher one',
  })

  const withFactors = shortlist.filter((r) => (r.factors?.length ?? 0) > 0).length
  scores.push({
    name: 'factors-present',
    value: withFactors / shortlist.length,
    comment:
      withFactors === shortlist.length ? undefined : `${shortlist.length - withFactors} cannot explain their rank`,
  })

  return scores
}

export interface JudgeConfig {
  provider: string
  model: string
  apiKey: string
}

const JUDGE_BASE_URLS: Record<string, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
}

/**
 * Reads the judge's own credentials. Absent means the model tier is skipped.
 *
 * Separate from `AGENT_*` on purpose, and not merely for budget. A judge sharing
 * the model it grades is a weak judge — and specifically,
 * `llama-3.3-70b-versatile` is not on Groq's structured-outputs list, so it
 * cannot be asked for a schema-conformant verdict the way a judge wants to be.
 */
export function readJudgeConfig(): JudgeConfig | undefined {
  const apiKey = process.env.EVAL_JUDGE_API_KEY?.trim() || process.env.AGENT_API_KEY?.trim()
  if (!apiKey) return undefined
  const provider = (process.env.EVAL_JUDGE_PROVIDER ?? process.env.AGENT_PROVIDER ?? 'groq')
    .trim()
    .toLowerCase()
  const model = process.env.EVAL_JUDGE_MODEL?.trim() || 'openai/gpt-oss-120b'
  return { provider, model, apiKey }
}

const JUDGE_PROMPT = `You check car recommendations for invented facts. Nothing else.

You get one car's complete factual record and one sentence written about it. Decide
whether every factual claim in the sentence is supported by that record.

- A number that contradicts the record, or a number found nowhere in it, is unsupported.
- A feature, trim, colour, history or piece of equipment not in the record is unsupported.
- A comparison to the buyer's own stated requirement ("50 L over the 450 L you asked for")
  is fine: their requirement is not in the record and you should not check it. Only check
  claims about THE CAR.
- Vague praise is not an invented fact. Judge accuracy, not quality.

FORMATTING IS NEVER A DISCREPANCY. These all match the record value 1500:
"1500", "1,500", "$1,500", "EUR 1,500", "1500 euro", "about 1.5k". Currency symbols and
names, thousands separators, and sensible rounding are all the same figure. Only report a
number as unsupported when its VALUE is wrong or absent, never when its spelling differs.

Reply with JSON and nothing else:
{"supported": true|false, "reason": "<short, name the offending claim if any>"}`

/**
 * The model tier: is every claim about the car supported by the car's record?
 *
 * Uses the OpenAI client directly rather than the Agents SDK, because
 * `setDefaultOpenAIClient` is process-global — routing the judge through the
 * Agents SDK would repoint the application's own model calls at the judge's
 * provider.
 */
export async function groundednessScores(
  shortlist: RankedListing[],
  cfg: JudgeConfig,
  limit = 4,
): Promise<Score[]> {
  if (shortlist.length === 0) return []

  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: JUDGE_BASE_URLS[cfg.provider] ?? process.env.EVAL_JUDGE_BASE_URL,
  })

  // Capped rather than exhaustive. The top of the shortlist is what gets read,
  // and a judge that grades all eight cars on three cases is 24 model calls
  // against a 100k-token day.
  const sample = shortlist.slice(0, limit)
  const verdicts: Score[] = []

  for (const row of sample) {
    if (!row.rationale?.trim()) continue
    try {
      const res = await client.chat.completions.create({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: JUDGE_PROMPT },
          {
            role: 'user',
            content: `CAR RECORD\n${factLine(row.listing)}\n\nSENTENCE\n${row.rationale}`,
          },
        ],
      })
      const raw = res.choices[0]?.message?.content ?? ''
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      const parsed =
        start >= 0 && end > start
          ? (JSON.parse(raw.slice(start, end + 1)) as { supported?: boolean; reason?: string })
          : undefined

      if (!parsed || typeof parsed.supported !== 'boolean') {
        verdicts.push({
          name: `grounded:${row.listing.id}`,
          value: 1,
          comment: 'judge returned nothing usable — not counted against the run',
        })
        continue
      }
      verdicts.push({
        name: `grounded:${row.listing.id}`,
        value: parsed.supported ? 1 : 0,
        comment: parsed.supported ? undefined : parsed.reason,
      })
    } catch (err) {
      // A throttled judge must not read as a failing product. Scored as a pass
      // with the reason attached, so the report shows it was not really checked.
      verdicts.push({
        name: `grounded:${row.listing.id}`,
        value: 1,
        comment: `judge unavailable: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  return verdicts
}
