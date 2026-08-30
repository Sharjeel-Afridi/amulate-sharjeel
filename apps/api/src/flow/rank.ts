import type {
  Criterion,
  Listing,
  ListingAssessment,
  Preferences,
  RankedListing,
} from '@car/shared'
import { affordableFirst, rankListings } from '@car/ranking'
import { Kind, annotate, semconv, setOutput, withSpan } from '../otel/index.js'

/**
 * Ordering the qualifying cars — and the one place the model/scorer branch lives.
 *
 * The flow is:
 *
 *   candidates ──► scorer (always) ──► model reorders it ──► shortlist
 *                       │                     │
 *                       └─────────────────────┴──► model unavailable, throttled,
 *                                                  slow or unparseable ──► scorer's
 *                                                  own order is the shortlist
 *
 * The scorer runs on every path, not just the fallback: it produces the factor
 * trace the detail view expands, it decides which candidates fit in the prompt,
 * and its rationale stands in for any the model omits. The model's entire job is
 * to reorder that list and explain it — it never decides what happens when it
 * fails, which is why `ReorderFn` returns `undefined` rather than a shortlist.
 */

export type RankedBy = 'model' | 'scorer'

export interface Ranking {
  shortlist: RankedListing[]
  /** A line to say out loud. Only the model writes one. */
  summary?: string
  rankedBy: RankedBy
}

/** What a model-backed ranker returns. `undefined` means "use the scorer". */
export interface Reordering {
  entries: RankedListing[]
  summary?: string
}

export type ReorderFn = (
  scored: RankedListing[],
  prefs: Preferences,
  criteria: Criterion[],
) => Promise<Reordering | undefined>

/** Cars sent to the model. Beyond this the prompt gets long and the model vague. */
const MAX_CANDIDATES = 15

/** Cars shown to the user. */
const SHORTLIST_SIZE = 8

export async function rankCandidates(
  candidates: Listing[],
  prefs: Preferences,
  criteria: Criterion[],
  reorder?: ReorderFn,
): Promise<Ranking> {
  if (candidates.length === 0) return { shortlist: [], rankedBy: 'scorer' }

  return withSpan(
    'rank',
    { kind: Kind.Chain, attributes: { [semconv.CAR_CANDIDATES]: candidates.length } },
    async () => {
      const scored = rankListings(candidates, prefs)
      const reordered = reorder
        ? await reorder(scored.slice(0, MAX_CANDIDATES), prefs, criteria)
        : undefined

      // A soft budget is still a budget: nothing over it goes above a car that
      // fits, however the model ordered them. `rankListings` already guarantees
      // this for its own output.
      const ranking: Ranking = reordered
        ? {
            shortlist: affordableFirst(reordered.entries, prefs).slice(0, SHORTLIST_SIZE),
            summary: reordered.summary,
            rankedBy: 'model',
          }
        : { shortlist: scored.slice(0, SHORTLIST_SIZE), rankedBy: 'scorer' }

      // `rankedBy` is the most useful attribute in this trace: the fallback is
      // invisible in the product — the user still gets eight ranked cars with
      // rationales — so recording which path ran is what turns "the explanations
      // felt generic today" into a filterable fact.
      annotate({
        [semconv.CAR_RANKED_BY]: ranking.rankedBy,
        [semconv.CAR_SHORTLIST_SIZE]: ranking.shortlist.length,
      })
      setOutput(
        ranking.shortlist.map((r) => ({ id: r.listing.id, rank: r.rank, score: r.score })),
      )
      return ranking
    },
  )
}

/** How many near-misses are worth offering when nothing qualifies. */
const NEAR_MISS_COUNT = 6

/**
 * The cars that came closest, when nothing cleared every condition.
 *
 * Ordered by how many conditions they fail before how well they score: one that
 * misses a single condition is a better thing to offer than one that misses
 * three, however well the second does on everything else. Each rationale names
 * the conditions and the evidence, so the list doubles as the argument for which
 * constraint is worth relaxing.
 *
 * Only the candidates that survive the miss-count cut are scored — `rankListings`
 * builds a rationale per car by comparing it against every peer, and none of
 * those rationales would survive the rewrite below anyway.
 */
export function nearMisses(ruledOut: ListingAssessment[], prefs: Preferences): RankedListing[] {
  const missed = new Map(
    ruledOut.map((a) => [
      a.listing.id,
      a.verdicts.filter((v) => !v.passed && v.criterion.kind !== 'preference'),
    ]),
  )
  const missCount = (id: string) => missed.get(id)?.length ?? 0

  const closest = [...ruledOut]
    .sort((a, b) => missCount(a.listing.id) - missCount(b.listing.id))
    .slice(0, NEAR_MISS_COUNT)

  return rankListings(
    closest.map((a) => a.listing),
    prefs,
  )
    .sort((a, b) => missCount(a.listing.id) - missCount(b.listing.id) || b.score - a.score)
    .map((entry, i) => ({
      ...entry,
      // Renumbered after the re-sort: the scorer's ordinals would otherwise
      // number the list 4, 1, 7 against the order it is displayed in.
      rank: i + 1,
      rationale: `Misses ${missed
        .get(entry.listing.id)
        ?.map((v) => `${v.criterion.label} (${v.evidence})`)
        .join(' · ')}`,
    }))
}
