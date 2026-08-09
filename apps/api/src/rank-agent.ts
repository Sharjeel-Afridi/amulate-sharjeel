import { Agent, run } from '@openai/agents'
import {
  type Criterion,
  type Listing,
  type Preferences,
  type RankedListing,
  isRental,
  money,
} from '@car/shared'
import { z } from 'zod'
import { withRateLimitRetry, withTimeout } from './llm.js'
import type { Ranker } from './journey.js'
import { affordableFirst, rank as scoreListings } from './ranking.js'

/**
 * The agent that ranks.
 *
 * This is where the model does the work the product is actually about: it reads
 * the spec the interview assembled — in the user's own words wherever we kept
 * them — and orders the candidates against it, writing the reason each one is
 * placed where it is.
 *
 * It is a separate, single-purpose agent rather than a tool on the conversational
 * one. Ranking is a judgement over a list, made once, with no dialogue around it;
 * running it as its own call with a narrow output schema means it cannot be
 * derailed by the chat, and one bad response degrades to the deterministic scorer
 * instead of breaking the turn.
 *
 * The scorer has not gone away. It still supplies the factor trace, still trims
 * an over-long candidate set to something that fits in a prompt, and still stands
 * in whenever the model is unavailable, throttled or wrong — so the shortlist is
 * always populated and always explained.
 */

/** Cars sent to the model. Beyond this the prompt gets long and the model gets vague. */
const MAX_CANDIDATES = 15

/** Cars shown to the user. */
const SHORTLIST_SIZE = 8

const RANK_TIMEOUT_MS = Number(process.env.RANK_TIMEOUT_MS ?? 30_000)

/**
 * Deliberately flat, small and almost entirely optional.
 *
 * No nested factor objects and no numeric breakdowns: the arithmetic trace comes
 * from the scorer, which cannot get it wrong, and every extra required field is
 * another thing a model omits and so invalidates an otherwise usable response.
 * Only the listing id is mandatory — without it a row means nothing. A missing
 * score or rationale falls back to the scorer's for that one car rather than
 * discarding the whole ranking.
 *
 * This validates a parsed response; it is not sent to the provider as a schema.
 * `outputType` would be tidier, but it compiles to `response_format: json_schema`,
 * which Groq's llama-3.3-70b rejects outright — and pinning the feature would
 * quietly undo the point of being provider-agnostic.
 */
const RankingSchema = z.object({
  summary: z.string().optional(),
  ranking: z
    .array(
      z.object({
        listingId: z.string(),
        score: z.coerce.number().optional(),
        rationale: z.string().optional(),
      }),
    )
    .min(1),
})

/**
 * Pulls the ranking out of whatever the model actually returned.
 *
 * Models wrap JSON in prose, in ```json fences, or in both, so the outermost
 * brace pair is taken rather than trusting the whole response to parse.
 */
function parseRanking(raw: string): z.infer<typeof RankingSchema> | undefined {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = RankingSchema.safeParse(JSON.parse(raw.slice(start, end + 1)))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

const RANKER_INSTRUCTIONS = `You rank cars against one person's stated requirements.

You are given their spec — in their own words where we have them — and candidate
cars that have already passed their hard conditions. Order the candidates
best-first for THIS person, and explain each one.

## score

0-100, and use the range. The best fit should sit clearly above the worst; a
shortlist where everything scores 80 tells them nothing. Judge only against what
they actually said: a big boot matters if they asked for space, and a low price
matters relative to the budget they gave, not in the abstract.

## rationale — this is the part that matters

- One sentence. Two at the very most.
- It MUST cite something they actually stated, and give the specific number from
  that car's line that meets it. Good: "500 L boot, 50 L over the 450 L you asked
  for." "$305 a month, $95 inside your $400." "37,275 km, well under
  your 80,000 limit."
- Name a car the way its owner would — "the Toyota RAV4". The id at the start of
  each line is a key for the listingId field and never something to say out
  loud; quoting it at the user reads as the software leaking.
- Generic filler is a failure. Never write "great choice", "perfect for you",
  "excellent option" or anything else that would fit any car on the list.
- Never state a fact that is not on that car's line. Do not invent trim levels,
  features, colours, history or equipment.
- Write to them as "you".

## summary

One or two sentences to say out loud about the TOP PICK: which car it is and why
it wins, in their terms. Name it by brand and model — never by its id. No
preamble, no "here are your results".

Do NOT state how many cars qualified or were ruled out. Those counts are added
for you, and a miscounted total in the first sentence undermines everything
after it.

## Output

Reply with JSON and nothing else — no prose around it, no code fence. Every
candidate appears exactly once, best first, with the id copied exactly as given.

{"summary":"...","ranking":[{"listingId":"rent-suv-toyota-0","score":88,"rationale":"..."}]}`

/** One candidate, as a single line of facts the model may cite and nothing more. */
function describeCandidate(l: Listing): string {
  const common =
    `${l.id} | ${l.brand} ${l.model} | ${l.category} | ${l.year} | ${l.fuel} | ${l.transmission} | ` +
    `${l.seats} seats | ${l.doors} doors | ${l.bootLitres} L boot | ${l.consumption} L/100km | ` +
    `${l.co2} g/km CO2 | ${l.location} | rated ${l.rating} from ${l.reviewCount} reviews`

  return isRental(l)
    ? `${common} | ${money(l.monthlyRate)}/month | ${money(l.dailyRate)}/day | ` +
        `${l.freeKmPerDay >= 9999 ? 'unlimited km' : `${l.freeKmPerDay} free km/day`} | ` +
        `minimum ${l.minRentalDays} days | ${money(l.excess)} excess | ` +
        `${l.instantBook ? 'instant book' : 'request to book'} | via ${l.provider}`
    : `${common} | ${money(l.price)} | ${l.mileageKm} km | ${l.previousOwners} previous owners | ` +
        `${l.warrantyMonths} months warranty | ${money(l.financeMonthly)}/month on finance | from ${l.dealer}`
}

/** The spec, phrased so the model can quote it back rather than paraphrase it. */
function describeSpec(prefs: Preferences, criteria: Criterion[]): string {
  const lines: string[] = []

  lines.push(prefs.mode === 'buy' ? 'They want to BUY a car.' : 'They want to RENT a car.')
  if (prefs.useCase) lines.push(`What for, in their words: "${prefs.useCase}"`)
  if (prefs.budgetMax) {
    lines.push(
      prefs.mode === 'buy'
        ? `Budget: up to ${money(prefs.budgetMax)} in total`
        : `Budget: up to ${money(prefs.budgetMax)} per month`,
    )
  }
  if (prefs.seatsMin) lines.push(`Needs to seat at least ${prefs.seatsMin}`)
  if (prefs.bootLitresMin) lines.push(`Needs a boot of at least ${prefs.bootLitresMin} L`)
  if (prefs.maxMileageKm) lines.push(`Will not go above ${prefs.maxMileageKm.toLocaleString('en-IE')} km`)
  if (prefs.fuel) lines.push(`Prefers ${prefs.fuel}`)
  if (prefs.transmission) lines.push(`Prefers ${prefs.transmission}`)
  if (prefs.targetDate) lines.push(`Needs it from ${prefs.targetDate}`)
  if (prefs.returnDate) lines.push(`Until ${prefs.returnDate}`)
  if (prefs.location) lines.push(`Around ${prefs.location}`)

  const hard = criteria.filter((c) => c.kind !== 'preference')
  if (hard.length > 0) {
    lines.push('Conditions they set:')
    for (const c of hard) {
      lines.push(`  - ${c.kind === 'exclusion' ? 'DEALBREAKER' : 'requires'}: ${c.label}`)
    }
  }

  // The soft ones have to be spelled out, because candidates that miss them are
  // in the list. Told only that every car "passed their hard conditions", the
  // model reads an over-budget car as being inside the budget and writes a
  // rationale that says so.
  const soft = [...criteria.filter((c) => c.kind === 'preference')].sort(
    (a, b) => (b.weight ?? 0) - (a.weight ?? 0),
  )
  if (soft.length > 0) {
    lines.push('Preferences — rank on these, never exclude on them, most important first:')
    for (const c of soft) lines.push(`  - prefers: ${c.label}`)
    lines.push('Some candidates miss one of these. Say which, and rank them below the ones that do not.')
  }

  return lines.join('\n')
}

function buildInput(pool: RankedListing[], prefs: Preferences, criteria: Criterion[]): string {
  return [
    '## Their spec',
    describeSpec(prefs, criteria),
    '',
    `## Candidates (${pool.length})`,
    ...pool.map((r) => describeCandidate(r.listing)),
    '',
    'Rank these and explain each one.',
  ].join('\n')
}

const clampScore = (n: number, fallback: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : fallback

/**
 * Builds a `Ranker` backed by the model, with the deterministic scorer behind it.
 *
 * The scorer runs first regardless: it produces the factor trace the UI expands,
 * and it decides which candidates make it into the prompt when there are more
 * than will fit.
 */
export function createModelRanker(model: string): Ranker {
  return async (candidates, prefs, criteria) => {
    if (candidates.length === 0) return { shortlist: [], rankedBy: 'scorer' }

    const scored = scoreListings(candidates, prefs)
    const pool = scored.slice(0, MAX_CANDIDATES)
    const byId = new Map(pool.map((r) => [r.listing.id, r]))
    const fallback = () => ({
      shortlist: scored.slice(0, SHORTLIST_SIZE),
      rankedBy: 'scorer' as const,
    })

    try {
      const agent = new Agent({
        name: 'Car Ranker',
        instructions: RANKER_INSTRUCTIONS,
        model,
      })

      const started = Date.now()
      const result = await withTimeout(
        () => withRateLimitRetry(() => run(agent, buildInput(pool, prefs, criteria))),
        RANK_TIMEOUT_MS,
        `Ranking timed out after ${RANK_TIMEOUT_MS / 1000}s`,
      )

      const output = parseRanking(String(result.finalOutput ?? ''))
      if (!output) {
        console.warn('[rank] could not parse a ranking from the response, using the scorer')
        return fallback()
      }

      const seen = new Set<string>()
      const ordered: RankedListing[] = []

      for (const row of output.ranking) {
        const base = byId.get(String(row.listingId ?? '').trim())
        // An id with no car behind it is a hallucination; there is nothing to
        // show for it, so it is dropped rather than guessed at.
        if (!base || seen.has(base.listing.id)) continue
        seen.add(base.listing.id)
        ordered.push({
          listing: base.listing,
          score: clampScore(Number(row.score), base.score),
          rank: ordered.length + 1,
          rationale: row.rationale?.trim() || base.rationale,
          // The trace stays the scorer's arithmetic. It is checkable, and asking
          // a model for signed point contributions invites numbers that do not
          // add up to the score printed beside them.
          factors: base.factors,
        })
      }

      if (ordered.length === 0) return fallback()

      // A car the model simply left out of the array still qualified, and losing
      // it would be a silent hole in the results rather than a judgement.
      for (const base of pool) {
        if (seen.has(base.listing.id)) continue
        ordered.push({ ...base, rank: ordered.length + 1 })
      }

      console.log(
        `[rank] model ranked ${ordered.length} in ${Date.now() - started}ms ` +
          `(${output.ranking.length} returned, ${pool.length} sent)`,
      )

      // The model may order these however it likes, except for this: a soft
      // budget is still a budget, and nothing over it goes above a car that
      // fits. Enforced after the fact rather than left to the instructions,
      // because the top card is presented as the answer and "usually obeys" is
      // not good enough for that slot.
      return {
        shortlist: affordableFirst(ordered, prefs).slice(0, SHORTLIST_SIZE),
        summary: output.summary?.trim() || undefined,
        rankedBy: 'model',
      }
    } catch (err) {
      // The results are the product; a throttled or malformed ranking must not
      // empty the stage. The scorer is always right here, just less articulate.
      console.warn(
        '[rank] model ranking failed, falling back to the scorer:',
        err instanceof Error ? err.message : err,
      )
      return fallback()
    }
  }
}
