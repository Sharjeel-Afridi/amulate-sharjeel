import { carArtDataUri } from '@car/catalog'
import { type RankedListing, type SessionState, isRental } from '@car/shared'
import {
  type A2uiMessage,
  SURFACES,
  card,
  column,
  createSurface,
  divider,
  image,
  list,
  row,
  text,
  updateComponents,
  updateDataModel,
} from './a2ui.js'

/**
 * Server-side A2UI surface builders.
 *
 * These are typed and deterministic on purpose. Having the model author every
 * surface would be slower, costlier and far more fragile; it earns its place on
 * the comparison view, where the layout genuinely depends on what is being
 * compared. Everything structural is built here.
 */

const money = (n: number) => `€${Math.round(n).toLocaleString('en-IE')}`

/** Journey rail: the spec assembling as the interview proceeds. */
export function buildJourneySurface(state: SessionState): A2uiMessage[] {
  const p = state.preferences

  return [
    createSurface(SURFACES.journey),
    // The whole preference object goes into the data model so bound components
    // update themselves on the next patch rather than being rebuilt.
    updateDataModel(SURFACES.journey, '/', {
      phase: state.phase,
      preferences: p,
      search: state.search ?? null,
    }),
    updateComponents(SURFACES.journey, [
      column('root', ['title', 'spec']),
      text('title', 'Your spec', 'h5'),
      column('spec', ['mode', 'useCase', 'category', 'budget', 'date']),
      text('mode', p.mode ? (p.mode === 'rent' ? 'Renting' : 'Buying') : 'Rent or buy — not set'),
      text('useCase', p.useCase ?? 'Use case — not set'),
      text('category', p.category ?? 'Category — not set'),
      text(
        'budget',
        p.budgetMax
          ? p.mode === 'buy'
            ? `Up to ${money(p.budgetMax)}`
            : `Up to ${money(p.budgetMax)}/month`
          : 'Budget — not set',
      ),
      text('date', p.targetDate ?? 'Date — not set'),
    ]),
  ]
}

/** Stage while the agent is searching — live counters rather than a dead spinner. */
export function buildSearchingSurface(): A2uiMessage[] {
  return [
    createSurface(SURFACES.stage),
    updateComponents(SURFACES.stage, [
      column('root', ['heading', 'note']),
      text('heading', 'Searching the marketplace…', 'h4'),
      text('note', 'Scanning listings and scoring them against your spec.', 'caption'),
    ]),
  ]
}

/**
 * Stage: the ranked catalogue.
 *
 * Every card carries its rationale — that is what separates this from a listings
 * page, so it is structural, not decorative.
 */
export function buildCatalogueSurface(shortlist: RankedListing[]): A2uiMessage[] {
  const components = [
    column('root', ['heading', 'grid']),
    text('heading', `${shortlist.length} matches, ranked`, 'h4'),
    list('grid', shortlist.map((r) => `card-${r.listing.id}`)),
  ]

  for (const entry of shortlist) {
    const { listing, rank, score, rationale } = entry
    const id = listing.id
    const price = isRental(listing)
      ? `${money(listing.monthlyRate)}/mo`
      : money(listing.price)

    const spec = [
      listing.category,
      String(listing.year),
      listing.fuel,
      `${listing.bootLitres} L boot`,
      `${listing.seats} seats`,
    ].join(' · ')

    components.push(
      card(`card-${id}`, `body-${id}`),
      column(`body-${id}`, [
        `art-${id}`,
        `name-${id}`,
        `spec-${id}`,
        `price-${id}`,
        `rule-${id}`,
        `why-${id}`,
      ]),
      image(`art-${id}`, carArtDataUri(listing.brand, listing.category), `${listing.brand} ${listing.model}`),
      text(`name-${id}`, `${rank}. ${listing.brand} ${listing.model}  ·  ${score}`, 'h5'),
      text(`spec-${id}`, spec, 'caption'),
      text(`price-${id}`, price, 'h5'),
      divider(`rule-${id}`),
      text(`why-${id}`, rationale, 'caption'),
    )
  }

  return [
    createSurface(SURFACES.stage),
    updateDataModel(SURFACES.stage, '/', { count: shortlist.length }),
    updateComponents(SURFACES.stage, components),
  ]
}

/** Inline interview controls, rendered into the chat stream. */
export function buildInterviewControls(
  question: string,
  controlId: string,
  control: ReturnType<typeof row>,
): A2uiMessage[] {
  return [
    createSurface(SURFACES.interview),
    updateComponents(SURFACES.interview, [
      column('root', ['q', controlId]),
      text('q', question),
      control,
    ]),
  ]
}
