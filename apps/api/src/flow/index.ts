import type { TurnContext } from '../session.js'
import { Kind, annotate, semconv, setOutput, withSpan } from '../otel/index.js'
import { type Ranking, type ReorderFn, nearMisses, rankCandidates } from './rank.js'
import { type Screening, bindingConstraint, countStretched, searchAndScreen } from './search.js'
import { buildSearchingSurface } from '../surfaces.js'
import { showNearMisses, showResults, stepScanned } from './present.js'

export * from './booking.js'
export * from './criteria.js'
export * from './spec.js'
export { showCarDetail, showCatalogue } from './present.js'
export type { ReorderFn, Reordering } from './rank.js'

/**
 * The journey, as one pipeline.
 *
 * Both drivers run this. The scripted one passes no `reorder`, so the scorer's
 * order is the answer; the model-backed one passes the ranking agent. Nothing
 * else about the search differs between them, which is the point — a difference
 * that existed in more than one place is a difference nobody can keep straight.
 *
 *   preferences ──► criteria ──► marketplace ──► screen ──► rank ──► present
 *                                                   │
 *                                                   └── nothing qualified ──► near misses
 */

export interface SearchOptions {
  /**
   * Whether to write the conversational reply. Off when the model is going to
   * write it from the returned summary — the same results described twice in
   * two voices reads as a bug.
   */
  narrate?: boolean
  /** Model-backed reordering. Absent means the scorer decides the order. */
  reorder?: ReorderFn
}

/** What a search reports back to whoever asked for it. */
export interface SearchSummary {
  qualified: number
  ruledOut: number
  bindingConstraint: { label: string; eliminated: number } | null
  top: { listingId: string; name: string; score: number; rationale: string }[]
}

export async function runSearch(
  ctx: TurnContext,
  { narrate = true, reorder }: SearchOptions = {},
): Promise<SearchSummary> {
  const prefs = ctx.state.preferences

  return withSpan(
    'research',
    {
      kind: Kind.Chain,
      input: { preferences: prefs },
      attributes: { [semconv.CAR_PHASE]: 'research' },
    },
    async () => {
      ctx.setPhase('research')
      if (narrate) ctx.say('Searching the marketplace now.')
      ctx.a2ui(buildSearchingSurface())

      const screening = await searchAndScreen(prefs)
      ctx.setSearch(screening.criteria, {
        totalScanned: screening.scanned,
        matched: screening.qualified.length + screening.ruledOut.length,
        shortlisted: screening.qualified.length,
        ruledOut: screening.ruledOut.length,
        relaxed: screening.relaxed,
      })
      stepScanned(ctx, screening, prefs)

      const ranking =
        screening.qualified.length === 0
          ? undefined
          : await rankCandidates(
              screening.qualified.map((a) => a.listing),
              prefs,
              screening.criteria,
              reorder,
            )

      if (ranking) {
        const stretched = countStretched(
          screening,
          ranking.shortlist.map((r) => r.listing.id),
        )
        showResults(ctx, screening, ranking, stretched, narrate)
      } else {
        showNearMisses(ctx, screening, nearMisses(screening.ruledOut, prefs), narrate)
      }

      return report(screening, ranking)
    },
  )
}

function report(screening: Screening, ranking?: Ranking): SearchSummary {
  const summary: SearchSummary = {
    qualified: ranking?.shortlist.length ?? 0,
    ruledOut: screening.ruledOut.length,
    bindingConstraint: bindingConstraint(screening),
    top: (ranking?.shortlist ?? []).slice(0, 3).map((r) => ({
      listingId: r.listing.id,
      name: `${r.listing.brand} ${r.listing.model}`,
      score: r.score,
      rationale: r.rationale,
    })),
  }

  annotate({
    [semconv.CAR_SHORTLIST_SIZE]: summary.top.length,
    'car.qualified': screening.qualified.length,
    'car.ruled_out': summary.ruledOut,
    ...(summary.bindingConstraint
      ? { 'car.binding_constraint': summary.bindingConstraint.label }
      : {}),
  })
  setOutput(summary)
  return summary
}
