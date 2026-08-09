import { CURRENCY_SYMBOL, type RankedListing, type SessionState, isRental, money } from '@car/shared'
import {
  type A2uiMessage,
  CAR_CATALOG,
  SURFACES,
  column,
  createSurface,
  row,
  text,
  updateComponents,
  updateDataModel,
} from './a2ui.js'
import { specSheet } from './interview.js'

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
    // All three use our merged catalog, so SpecRow, CarCard and friends resolve
    // on any of them. The interview used to be enough with the basic set, back
    // when it rendered one stock control at a time; it is a SpecRow sheet now.
    createSurface(SURFACES.journey, CAR_CATALOG),
    createSurface(SURFACES.stage, CAR_CATALOG),
    createSurface(SURFACES.interview, CAR_CATALOG),
  ]
}

/**
 * The spec sheet, assembling as the interview proceeds.
 *
 * Rendered as label/value rows rather than a column of sentences. Both carry the
 * same words, but only the paired form lets someone scan down the right-hand
 * column and see at a glance what is still blank — which is the entire job of
 * showing the spec before anything is searched.
 */
export function buildJourneySurface(state: SessionState): A2uiMessage[] {
  const rows = specSheet(state.preferences, state.criteria)

  // Re-searching only means anything once a search has happened. Before that the
  // spec is still being assembled and "Search on this" on the interview surface
  // is the way in.
  const canResearch = state.interview.confirmed
  const roots = canResearch ? ['sheet', 'again'] : ['sheet']

  return [
    // The whole row set goes into the data model so the template fans out over
    // it and a later answer is a data patch, not a component rebuild.
    updateDataModel(SURFACES.journey, '/', {
      phase: state.phase,
      preferences: state.preferences,
      search: state.search ?? null,
      rows,
      againLabel: state.interview.dirty ? 'Search again with these changes' : 'Search again',
    }),
    updateComponents(SURFACES.journey, [
      column('root', roots),
      { id: 'sheet', component: 'Column', children: { componentId: 'specRow', path: '/rows' } },
      {
        id: 'specRow',
        component: 'SpecRow',
        label: { path: 'label' },
        value: { path: 'value' },
        filled: { path: 'filled' },
        // Everything below is what makes the row editable. A row with no
        // questionId renders exactly as before.
        questionId: { path: 'questionId' },
        control: { path: 'control' },
        options: { path: 'options' },
        editValue: { path: 'editValue' },
        min: { path: 'min' },
        max: { path: 'max' },
        step: { path: 'step' },
        unit: { path: 'unit' },
        // Context is resolved against the data model when the action fires, so
        // the row writes the new value to `editValue` first and this picks it up.
        action: {
          event: {
            name: 'editSpec',
            context: { questionId: { path: 'questionId' }, value: { path: 'editValue' } },
          },
        },
      },
      ...(canResearch
        ? [
            {
              id: 'again',
              component: 'Button',
              child: 'againLabel',
              variant: state.interview.dirty ? 'primary' : 'borderless',
              action: { event: { name: 'searchAgain', context: {} } },
            },
            text('againLabel', { path: '/againLabel' }),
          ]
        : []),
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

/** One card's worth of data, shared by the shortlist and the tail. */
function cardData(entry: RankedListing, nearMiss = false) {
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
    // The winner's highlight is a claim that this one is the answer. Nothing
    // qualified, so nothing gets it.
    selected: rank === 1 && !nearMiss,
  }
}

/** How many results get the full-height treatment before the tail compacts. */
const LEAD_COUNT = 3

/**
 * Stage: the ranked catalogue.
 *
 * Split into a leading few and a compact tail. Eight identical full-height
 * cards is five screens of scrolling in which every result argues for itself
 * just as loudly as the winner, which is the opposite of what a ranking is for.
 * The first three keep the staged treatment; the rest state their case in a row
 * apiece and open in full when tapped.
 *
 * Every card carries its rationale — that is what separates this from a listings
 * page, so it is structural, not decorative.
 */
export function buildCatalogueSurface(
  shortlist: RankedListing[],
  { nearMiss = false, stretched = 0 }: { nearMiss?: boolean; stretched?: number } = {},
): A2uiMessage[] {
  // Data-driven rather than one component per car: the card is declared once as
  // a template and fanned out over the arrays, so re-ranking is a data-model
  // patch instead of a full component rebuild.
  const lead = shortlist.slice(0, LEAD_COUNT).map((e) => cardData(e, nearMiss))
  const tail = shortlist.slice(LEAD_COUNT).map((e) => cardData(e, nearMiss))

  const roots = ['heading', 'grid']
  if (tail.length > 0) roots.push('restHeading', 'rest')

  // The two templates differ only in layout, so the shared parts are built once.
  const cardTemplate = (id: string, compact: boolean) => ({
    id,
    component: 'CarCard',
    title: { path: 'title' },
    subtitle: { path: 'subtitle' },
    imageUrl: { path: 'imageUrl' },
    tags: { path: 'tags' },
    selected: { path: 'selected' },
    compact,
    child: compact ? 'restBody' : 'carBody',
    action: {
      event: {
        name: 'selectCar',
        context: { listingId: { path: 'id' }, title: { path: 'title' } },
      },
    },
  })

  return [
    updateDataModel(SURFACES.stage, '/', {
      // Near-misses are never called matches. The whole point of showing them is
      // that they failed something, and a headline that says "3 matches" over
      // three cars each captioned "misses your budget" reads as a bug.
      //
      // `stretched` is the softer version of the same problem: a soft budget puts
      // over-budget cars on the ranked list deliberately, so the count of real
      // matches is the count that clears everything, not the length of the list.
      headline: nearMiss
        ? 'Nothing cleared every condition — closest first'
        : stretched >= shortlist.length
          ? `Nothing matches everything — closest ${shortlist.length}, ranked`
          : stretched > 0
            ? `${shortlist.length - stretched} matching, then ${stretched} that stretch your spec`
            : shortlist.length === 1
              ? '1 match'
              : `${shortlist.length} matches, ranked`,
      restHeadline: nearMiss
        ? 'Further off'
        : tail.length === 1
          ? '1 more worth a look'
          : `${tail.length} more worth a look`,
      cars: lead,
      rest: tail,
    }),
    updateComponents(SURFACES.stage, [
      column('root', roots),
      text('heading', { path: '/headline' }, 'h4'),
      // Templated fan-out. Bindings inside the template are relative and carry
      // no './' prefix — that would resolve to a broken pointer.
      { id: 'grid', component: 'Column', children: { componentId: 'carRow', path: '/cars' } },
      cardTemplate('carRow', false),
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

      text('restHeading', { path: '/restHeadline' }, 'h5'),
      { id: 'rest', component: 'Column', children: { componentId: 'restRow', path: '/rest' } },
      cardTemplate('restRow', true),
      row('restBody', ['restScore', 'restPrice'], { justify: 'spaceBetween', align: 'center' }),
      { id: 'restScore', component: 'MatchScore', score: { path: 'score' }, label: 'match' },
      {
        id: 'restPrice',
        component: 'PriceBadge',
        amount: { path: 'price' },
        currency: CURRENCY_SYMBOL,
        period: { path: 'period' },
      },
    ]),
  ]
}

/**
 * Stage: one car, in full.
 *
 * Tapping a card used to open the booking form directly, which asked someone to
 * commit to several hundred euros off four spec chips and a one-line rationale.
 * This is the step in between: the whole specification, and the scoring broken
 * out factor by factor, so the ranking can be argued with before it is acted on.
 */
export function buildCarDetailSurface(entry: RankedListing): A2uiMessage[] {
  const { listing, score, rationale, factors } = entry
  const rental = isRental(listing)

  const specs: { label: string; value: string; filled: boolean }[] = [
    { label: 'Category', value: listing.category.toUpperCase(), filled: true },
    { label: 'Year', value: String(listing.year), filled: true },
    { label: 'Fuel', value: listing.fuel, filled: true },
    { label: 'Gearbox', value: listing.transmission, filled: true },
    { label: 'Seats', value: String(listing.seats), filled: true },
    { label: 'Doors', value: String(listing.doors), filled: true },
    { label: 'Boot', value: `${listing.bootLitres} L · ${listing.bags} bags`, filled: true },
    {
      label: 'Consumption',
      value: `${listing.consumption} ${listing.fuel === 'electric' ? 'kWh' : 'L'}/100km`,
      filled: true,
    },
    { label: 'CO₂', value: `${listing.co2} g/km`, filled: true },
    { label: 'Colour', value: listing.colour, filled: true },
    { label: 'Location', value: listing.location, filled: true },
    {
      label: 'Rating',
      value: `${listing.rating} from ${listing.reviewCount} reviews`,
      filled: true,
    },
    rental
      ? { label: 'Rate', value: `${money(listing.monthlyRate)}/month`, filled: true }
      : { label: 'Price', value: money(listing.price), filled: true },
    rental
      ? { label: 'Minimum hire', value: `${listing.minRentalDays} days`, filled: true }
      : { label: 'Mileage', value: `${listing.mileageKm.toLocaleString('en-IE')} km`, filled: true },
  ]

  // Signed so the trade-offs read as trade-offs — a card that only ever lists
  // what a car is good at is marketing, not a recommendation.
  const scoreRows = factors.map((f) => ({
    label: f.label,
    value: `${f.delta >= 0 ? '+' : ''}${Math.round(f.delta)} · ${f.detail}`,
    filled: true,
  }))

  return [
    updateDataModel(SURFACES.stage, '/', {
      car: {
        id: listing.id,
        title: `${listing.brand} ${listing.model}`,
        subtitle: [listing.category, listing.year, listing.fuel, listing.transmission].join(' · '),
        imageUrl: listing.imageUrl,
        tags: [
          `${listing.bootLitres} L boot`,
          `${listing.seats} seats`,
          `${listing.bags} bags`,
          listing.location,
        ],
        score,
        price: rental ? listing.monthlyRate : listing.price,
        period: rental ? 'month' : '',
        rationale,
      },
      specs,
      scoreRows,
    }),
    updateComponents(SURFACES.stage, [
      column('root', ['backRow', 'hero', 'whyHeading', 'why', 'specHeading', 'specs', 'scoreHeading', 'scores', 'bookBtn']),
      // A Column stretches its children, which turns a back link into a
      // full-width button competing with the booking CTA. The Row lets it
      // shrink to its own content.
      row('backRow', ['backBtn'], { justify: 'start' }),
      {
        id: 'backBtn',
        component: 'Button',
        child: 'backLabel',
        variant: 'borderless',
        action: { event: { name: 'backToResults', context: {} } },
      },
      text('backLabel', '← All matches'),
      {
        id: 'hero',
        component: 'CarCard',
        title: { path: '/car/title' },
        subtitle: { path: '/car/subtitle' },
        imageUrl: { path: '/car/imageUrl' },
        tags: { path: '/car/tags' },
        selected: true,
        child: 'heroMeta',
      },
      row('heroMeta', ['heroScore', 'heroPrice'], { justify: 'spaceBetween', align: 'center' }),
      { id: 'heroScore', component: 'MatchScore', score: { path: '/car/score' }, label: 'match' },
      {
        id: 'heroPrice',
        component: 'PriceBadge',
        amount: { path: '/car/price' },
        currency: CURRENCY_SYMBOL,
        period: { path: '/car/period' },
      },
      text('whyHeading', 'Why it placed here', 'h5'),
      { id: 'why', component: 'ReasoningStep', title: { path: '/car/rationale' }, status: 'done' },
      text('specHeading', 'Specification', 'h5'),
      { id: 'specs', component: 'Column', children: { componentId: 'specLine', path: '/specs' } },
      {
        id: 'specLine',
        component: 'SpecRow',
        label: { path: 'label' },
        value: { path: 'value' },
        filled: { path: 'filled' },
      },
      text('scoreHeading', 'How it scored', 'h5'),
      { id: 'scores', component: 'Column', children: { componentId: 'scoreLine', path: '/scoreRows' } },
      {
        id: 'scoreLine',
        component: 'SpecRow',
        label: { path: 'label' },
        value: { path: 'value' },
        filled: { path: 'filled' },
      },
      {
        id: 'bookBtn',
        component: 'Button',
        child: 'bookLabel',
        variant: 'primary',
        action: { event: { name: 'bookCar', context: { listingId: listing.id } } },
      },
      text('bookLabel', rental ? 'Book this car' : 'Reserve this car'),
    ]),
  ]
}

/**
 * The interview, as one form.
 *
 * It used to be a wizard: one question on screen, a Continue under it, eleven
 * times. Every answer cost a tap on the control and a tap on Continue, and the
 * only way to revise question three was to walk back through the four after it
 * — which is why "back" had to exist at all.
 *
 * Everything is on screen at once instead. The rows are the same `SpecRow`s the
 * drawer edits, built from the same `specSheet`, so a value means exactly what
 * it meant when it was asked one at a time, and the sheet you approve is
 * literally the sheet you filled. Revising is re-picking a row rather than
 * navigating, and the whole interview costs one click to submit.
 *
 * Mode-dependent rows come out of `specSheet` already resolved — the mileage row
 * for buying, the return date for renting — so switching rent to buy re-renders
 * the form with the right questions rather than branching here.
 */
export function interviewFormData(state: SessionState): A2uiMessage[] {
  const buying = state.preferences.mode === 'buy'
  return [
    updateDataModel(SURFACES.interview, '/', {
      rows: specSheet(state.preferences, state.criteria),
      searchLabel: buying ? 'Search cars for sale' : 'Search rentals',
    }),
  ]
}

/**
 * The form's components plus its first data load.
 *
 * Split from `interviewFormData` because an edit only ever changes values: the
 * component tree is a fixed template, and re-sending it on every keystroke
 * remounts the inputs and steals focus mid-answer.
 */
export function buildInterviewFormSurface(state: SessionState): A2uiMessage[] {
  return [
    ...interviewFormData(state),
    updateComponents(SURFACES.interview, [
      column('root', ['lead', 'sheet', 'search', 'note']),
      text('lead', 'Fill in what matters and leave the rest — every line is optional.', 'caption'),
      { id: 'sheet', component: 'Column', children: { componentId: 'formRow', path: '/rows' } },
      {
        id: 'formRow',
        component: 'SpecRow',
        label: { path: 'label' },
        value: { path: 'value' },
        filled: { path: 'filled' },
        questionId: { path: 'questionId' },
        control: { path: 'control' },
        options: { path: 'options' },
        editValue: { path: 'editValue' },
        min: { path: 'min' },
        max: { path: 'max' },
        step: { path: 'step' },
        unit: { path: 'unit' },
        // Same contract as the drawer: the row writes its new value into the
        // model first, and the action reads it back at dispatch time.
        action: {
          event: {
            name: 'editSpec',
            context: { questionId: { path: 'questionId' }, value: { path: 'editValue' } },
          },
        },
      },
      {
        id: 'search',
        component: 'Button',
        child: 'searchLabel',
        variant: 'primary',
        action: { event: { name: 'confirmSpec', context: {} } },
      },
      text('searchLabel', { path: '/searchLabel' }),
      text('note', 'You can change any of this after the results come back.', 'caption'),
    ]),
  ]
}
