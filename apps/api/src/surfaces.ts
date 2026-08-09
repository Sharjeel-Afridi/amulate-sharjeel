import { CURRENCY_SYMBOL, type RankedListing, type SessionState, isRental, money } from '@car/shared'
import {
  type A2uiComponent,
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
import type { Question } from './interview.js'

/**
 * Server-side A2UI surface builders.
 *
 * These are typed and deterministic on purpose. Having the model author every
 * surface would be slower, costlier and far more fragile; it earns its place on
 * the comparison view, where the layout genuinely depends on what is being
 * compared. Everything structural is built here.
 */

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
    createSurface(SURFACES.interview, BASIC_CATALOG),
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
      // The real photograph from the marketplace listing, not a generated one.
      imageUrl: listing.imageUrl,
      tags: [
        `${listing.bootLitres} L boot`,
        `${listing.seats} seats`,
        `${listing.bags} bags`,
        `${listing.consumption} ${listing.fuel === 'electric' ? 'kWh' : 'L'}/100km`,
      ],
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
        currency: CURRENCY_SYMBOL,
        period: { path: 'period' },
      },
      // The rationale is structural, not decorative — it is what makes this a
      // recommendation rather than a listings page.
      { id: 'carWhy', component: 'ReasoningStep', title: { path: 'rationale' }, status: 'done' },
    ]),
  ]
}

/**
 * The interview question, rendered as an inline control in the chat.
 *
 * This is the hybrid: the agent asks conversationally, but the answer is one tap
 * on the right kind of control rather than a sentence the user has to compose.
 * Free text stays available in the composer throughout and overrides whatever
 * the control holds.
 */
export function buildQuestionSurface(q: Question): A2uiMessage[] {
  const control: A2uiComponent = (() => {
    switch (q.control) {
      case 'chips':
        return {
          id: 'control',
          component: 'ChoicePicker',
          label: '',
          options: q.options ?? [],
          value: { path: '/answer' },
          variant: 'mutuallyExclusive',
          displayStyle: 'chips',
        }
      case 'multi':
        return {
          id: 'control',
          component: 'ChoicePicker',
          label: '',
          options: q.options ?? [],
          value: { path: '/answer' },
          variant: 'multipleSelection',
          displayStyle: 'chips',
        }
      case 'slider':
        return {
          id: 'control',
          component: 'Slider',
          label: q.unit ?? '',
          min: q.min ?? 0,
          max: q.max ?? 100,
          value: { path: '/number' },
        }
      case 'date':
        return {
          id: 'control',
          component: 'DateTimeInput',
          label: '',
          value: { path: '/date' },
          enableDate: true,
          enableTime: false,
        }
      case 'text':
        return {
          id: 'control',
          component: 'TextField',
          label: '',
          value: { path: '/text' },
          variant: 'shortText',
        }
    }
  })()

  // Which data-model path the answer lands in depends on the control, so the
  // submit action reads the matching one rather than a single shared field.
  const answerPath =
    q.control === 'slider' ? '/number' : q.control === 'date' ? '/date' : q.control === 'text' ? '/text' : '/answer'

  return [
    updateDataModel(SURFACES.interview, '/', {
      question: q.ask,
      answer: [],
      number: q.min ?? 0,
      date: '',
      text: '',
    }),
    updateComponents(SURFACES.interview, [
      // No question text here — the agent already asked it in the chat above.
      // Repeating it inside the control reads as a form, which is the opposite
      // of what this is meant to feel like.
      column('root', ['control', 'submit']),
      control,
      {
        id: 'submit',
        component: 'Button',
        child: 'submitLabel',
        variant: 'primary',
        action: {
          event: {
            name: 'answerQuestion',
            context: { questionId: q.id, value: { path: answerPath } },
          },
        },
      },
      text('submitLabel', q.optional ? 'Continue (or skip)' : 'Continue'),
    ]),
  ]
}

/** The assembled spec, shown for approval before any searching happens. */
export function buildSpecSurface(lines: string[]): A2uiMessage[] {
  return [
    updateDataModel(SURFACES.interview, '/', { lines }),
    updateComponents(SURFACES.interview, [
      column('root', ['title', 'list', 'confirm']),
      text('title', "Here's what I'll search on", 'h5'),
      { id: 'list', component: 'Column', children: { componentId: 'line', path: '/lines' } },
      { id: 'line', component: 'Text', text: { path: '' }, variant: 'caption' },
      {
        id: 'confirm',
        component: 'Button',
        child: 'confirmLabel',
        variant: 'primary',
        action: { event: { name: 'confirmSpec', context: {} } },
      },
      text('confirmLabel', 'Search on this'),
    ]),
  ]
}
