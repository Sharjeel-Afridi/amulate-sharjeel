import { carArtDataUri } from '@car/catalog'
import { type RankedListing, type SessionState, isRental } from '@car/shared'
import {
  type A2uiMessage,
  BASIC_CATALOG,
  CAR_CATALOG,
  SURFACES,
  column,
  createSurface,
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

/**
 * Create the surfaces once, at session start.
 *
 * `createSurface` throws if the surface already exists, so creation is separated
 * from update rather than being re-sent on every turn. This also matches the
 * protocol's intent: surfaces are long-lived and patched incrementally.
 */
export function initSurfaces(): A2uiMessage[] {
  return [
    createSurface(SURFACES.journey, BASIC_CATALOG),
    // The stage uses our merged catalog so CarCard and friends resolve.
    createSurface(SURFACES.stage, CAR_CATALOG),
  ]
}

/** Journey rail: the spec assembling as the interview proceeds. */
export function buildJourneySurface(state: SessionState): A2uiMessage[] {
  const p = state.preferences

  return [
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
  // Data-driven rather than one component per car: the card is declared once as
  // a template and fanned out over `/cars`, so re-ranking is a data-model patch
  // instead of a full component rebuild.
  const cars = shortlist.map((entry) => {
    const { listing, rank, score, rationale } = entry
    const rental = isRental(listing)
    return {
      id: listing.id,
      title: `${rank}. ${listing.brand} ${listing.model}`,
      subtitle: [listing.category, listing.year, listing.fuel, listing.transmission].join(' · '),
      imageUrl: carArtDataUri(listing.brand, listing.category),
      tags: [`${listing.bootLitres} L boot`, `${listing.seats} seats`, `${listing.consumption} ${rental ? 'L/100km' : 'L/100km'}`],
      score,
      price: rental ? listing.monthlyRate : listing.price,
      period: rental ? 'month' : '',
      rationale,
      selected: rank === 1,
    }
  })

  return [
    updateDataModel(SURFACES.stage, '/', {
      headline: `${shortlist.length} matches, ranked`,
      cars,
    }),
    updateComponents(SURFACES.stage, [
      column('root', ['heading', 'grid']),
      text('heading', { path: '/headline' }, 'h4'),
      // Templated fan-out. Bindings inside the template are relative and carry
      // no './' prefix — that would resolve to a broken pointer.
      { id: 'grid', component: 'Column', children: { componentId: 'carRow', path: '/cars' } },
      {
        id: 'carRow',
        component: 'CarCard',
        title: { path: 'title' },
        subtitle: { path: 'subtitle' },
        imageUrl: { path: 'imageUrl' },
        tags: { path: 'tags' },
        selected: { path: 'selected' },
        child: 'carBody',
        action: {
          event: {
            name: 'selectCar',
            context: { listingId: { path: 'id' }, title: { path: 'title' } },
          },
        },
      },
      column('carBody', ['carMeta', 'carWhy']),
      row('carMeta', ['carScore', 'carPrice'], { justify: 'spaceBetween', align: 'center' }),
      { id: 'carScore', component: 'MatchScore', score: { path: 'score' }, label: 'match' },
      {
        id: 'carPrice',
        component: 'PriceBadge',
        amount: { path: 'price' },
        currency: '€',
        period: { path: 'period' },
      },
      // The rationale is structural, not decorative — it is what makes this a
      // recommendation rather than a listings page.
      { id: 'carWhy', component: 'ReasoningStep', title: { path: 'rationale' }, status: 'done' },
    ]),
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
