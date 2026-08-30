import { CURRENCY_SYMBOL, type RankedListing, type SessionState, isRental, money } from '@car/shared'
import {
  type A2uiComponent,
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
import { type Question, specSheet } from './questions.js'

/**
 * Server-side A2UI surface builders.
 *
 * Typed and deterministic on purpose: having the model author every surface
 * would be slower, costlier and far more fragile. Everything structural is
 * built here.
 *
 * Two things to know before editing. Bindings inside a templated fan-out
 * (`children: { componentId, path }`) are relative and carry no leading slash —
 * `'/score'` there resolves to a broken pointer. And component ids are global
 * per surface, which is why the shared blocks below take an id prefix.
 */

/**
 * Create the surfaces once, at session start.
 *
 * `createSurface` throws if the surface already exists, so creation is separated
 * from update rather than re-sent on every turn — which also matches the
 * protocol's intent that surfaces are long-lived and patched incrementally.
 *
 * All three use our merged catalog, so `SpecRow`, `CarCard` and friends resolve
 * on any of them.
 */
export function initSurfaces(): A2uiMessage[] {
  return [
    createSurface(SURFACES.journey, CAR_CATALOG),
    createSurface(SURFACES.stage, CAR_CATALOG),
    createSurface(SURFACES.interview, CAR_CATALOG),
  ]
}

/* ------------------------------------------------------------ shared blocks */

/** The score-and-price line every card carries. `base` is '' inside a template. */
function metaRow(prefix: string, base = ''): A2uiComponent[] {
  return [
    row(`${prefix}Meta`, [`${prefix}Score`, `${prefix}Price`], {
      justify: 'spaceBetween',
      align: 'center',
    }),
    { id: `${prefix}Score`, component: 'MatchScore', score: { path: `${base}score` }, label: 'match' },
    {
      id: `${prefix}Price`,
      component: 'PriceBadge',
      amount: { path: `${base}price` },
      currency: CURRENCY_SYMBOL,
      period: { path: `${base}period` },
    },
  ]
}

/** A read-only label/value row, bound to the item a template is fanned over. */
const readOnlyRow = (id: string): A2uiComponent => ({
  id,
  component: 'SpecRow',
  label: { path: 'label' },
  value: { path: 'value' },
  filled: { path: 'filled' },
})

/**
 * An editable spec row.
 *
 * The form and the drawer render the same rows from the same `specSheet`, so
 * this template is shared: a value means exactly what it meant when it was
 * asked. `wide` is only bound on the form, which is the one laid out as a grid.
 *
 * Context is resolved against the data model when the action fires, so the row
 * writes its new value to `editValue` first and this picks it up at dispatch.
 */
const editableRow = (id: string, wide: boolean): A2uiComponent => ({
  ...readOnlyRow(id),
  questionId: { path: 'questionId' },
  control: { path: 'control' },
  options: { path: 'options' },
  editValue: { path: 'editValue' },
  min: { path: 'min' },
  max: { path: 'max' },
  step: { path: 'step' },
  unit: { path: 'unit' },
  ...(wide ? { wide: { path: 'wide' } } : {}),
  action: {
    event: {
      name: 'editSpec',
      context: { questionId: { path: 'questionId' }, value: { path: 'editValue' } },
    },
  },
})

const button = (
  id: string,
  labelId: string,
  event: string,
  variant: string,
  context: Record<string, unknown> = {},
): A2uiComponent => ({
  id,
  component: 'Button',
  child: labelId,
  variant,
  action: { event: { name: event, context } },
})

/** A component list fanned out over an array in the data model. */
const templated = (id: string, componentId: string, path: string): A2uiComponent => ({
  id,
  component: 'Column',
  children: { componentId, path },
})

/* ----------------------------------------------------------------- journey */

/**
 * The spec sheet, assembling as the interview proceeds.
 *
 * Label/value rows rather than a column of sentences: only the paired form lets
 * someone scan the right-hand column and see at a glance what is still blank,
 * which is the whole job of showing the spec before anything is searched.
 */
export function buildJourneySurface(state: SessionState): A2uiMessage[] {
  // Re-searching only means anything once a search has happened. Before that the
  // spec is still being assembled and the interview form's button is the way in.
  const searched = state.interview.confirmed
  const { dirty } = state.interview

  return [
    // The whole row set goes into the data model so the template fans out over
    // it and a later answer is a data patch, not a component rebuild.
    updateDataModel(SURFACES.journey, '/', {
      phase: state.phase,
      preferences: state.preferences,
      search: state.search ?? null,
      rows: specSheet(state.preferences),
      againLabel: dirty ? 'Search again with these changes' : 'Search again',
    }),
    updateComponents(SURFACES.journey, [
      column('root', searched ? ['sheet', 'again'] : ['sheet']),
      templated('sheet', 'specRow', '/rows'),
      editableRow('specRow', false),
      ...(searched
        ? [
            button('again', 'againLabel', 'searchAgain', dirty ? 'primary' : 'borderless'),
            text('againLabel', { path: '/againLabel' }),
          ]
        : []),
    ]),
  ]
}

/* ------------------------------------------------------------------- stage */

/** Stage while the agent is searching — a live note rather than a dead spinner. */
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
function cardData(entry: RankedListing, nearMiss: boolean) {
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
 * The headline over the ranked catalogue.
 *
 * Near-misses are never called matches, and neither are the cars a soft budget
 * put on the list deliberately: "3 matches" over three cards each captioned
 * "misses your budget" reads as a bug.
 */
function headline(total: number, nearMiss: boolean, stretched: number): string {
  if (nearMiss) return 'Nothing cleared every condition — closest first'
  if (stretched >= total) return `Nothing matches everything — closest ${total}, ranked`
  if (stretched > 0) return `${total - stretched} matching, then ${stretched} that stretch your spec`
  return total === 1 ? '1 match' : `${total} matches, ranked`
}

/**
 * Stage: the ranked catalogue, as a leading few and a compact tail.
 *
 * Eight identical full-height cards is five screens of scrolling in which every
 * result argues for itself as loudly as the winner, which is the opposite of
 * what a ranking is for. The first three keep the staged treatment; the rest
 * state their case in a row apiece and open in full when tapped.
 *
 * Every card carries its rationale — that is what separates this from a listings
 * page, so it is structural, not decorative.
 */
export function buildCatalogueSurface(
  shortlist: RankedListing[],
  { nearMiss = false, stretched = 0 }: { nearMiss?: boolean; stretched?: number } = {},
): A2uiMessage[] {
  const lead = shortlist.slice(0, LEAD_COUNT).map((e) => cardData(e, nearMiss))
  const tail = shortlist.slice(LEAD_COUNT).map((e) => cardData(e, nearMiss))

  // Declared once as a template and fanned out over the arrays, so re-ranking is
  // a data-model patch instead of a full component rebuild.
  const card = (id: string, bodyId: string, compact: boolean): A2uiComponent => ({
    id,
    component: 'CarCard',
    title: { path: 'title' },
    subtitle: { path: 'subtitle' },
    imageUrl: { path: 'imageUrl' },
    tags: { path: 'tags' },
    selected: { path: 'selected' },
    compact,
    child: bodyId,
    action: {
      event: { name: 'selectCar', context: { listingId: { path: 'id' }, title: { path: 'title' } } },
    },
  })

  return [
    updateDataModel(SURFACES.stage, '/', {
      headline: headline(shortlist.length, nearMiss, stretched),
      restHeadline: nearMiss ? 'Further off' : `${tail.length} more worth a look`,
      cars: lead,
      rest: tail,
    }),
    updateComponents(SURFACES.stage, [
      column('root', tail.length > 0 ? ['heading', 'grid', 'restHeading', 'rest'] : ['heading', 'grid']),
      text('heading', { path: '/headline' }, 'h4'),

      templated('grid', 'carRow', '/cars'),
      card('carRow', 'carBody', false),
      column('carBody', ['carMeta', 'carWhy']),
      ...metaRow('car'),
      // The rationale is structural, not decorative — it is what makes this a
      // recommendation rather than a listings page.
      { id: 'carWhy', component: 'ReasoningStep', title: { path: 'rationale' }, status: 'done' },

      text('restHeading', { path: '/restHeadline' }, 'h5'),
      templated('rest', 'restRow', '/rest'),
      card('restRow', 'restMeta', true),
      ...metaRow('rest'),
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
  const spec = (label: string, value: string) => ({ label, value, filled: true })

  const specs = [
    spec('Category', listing.category.toUpperCase()),
    spec('Year', String(listing.year)),
    spec('Fuel', listing.fuel),
    spec('Gearbox', listing.transmission),
    spec('Seats', String(listing.seats)),
    spec('Doors', String(listing.doors)),
    spec('Boot', `${listing.bootLitres} L · ${listing.bags} bags`),
    spec('Consumption', `${listing.consumption} ${listing.fuel === 'electric' ? 'kWh' : 'L'}/100km`),
    spec('CO₂', `${listing.co2} g/km`),
    spec('Colour', listing.colour),
    spec('Location', listing.location),
    spec('Rating', `${listing.rating} from ${listing.reviewCount} reviews`),
    rental
      ? spec('Rate', `${money(listing.monthlyRate)}/month`)
      : spec('Price', money(listing.price)),
    rental
      ? spec('Minimum hire', `${listing.minRentalDays} days`)
      : spec('Mileage', `${listing.mileageKm.toLocaleString('en-IE')} km`),
  ]

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
      // Signed so the trade-offs read as trade-offs — a card that only lists what
      // a car is good at is marketing, not a recommendation.
      scoreRows: factors.map((f) => ({
        label: f.label,
        value: `${f.delta >= 0 ? '+' : ''}${Math.round(f.delta)} · ${f.detail}`,
        filled: true,
      })),
    }),
    updateComponents(SURFACES.stage, [
      column('root', [
        'backRow',
        'hero',
        'whyHeading',
        'why',
        'specHeading',
        'specs',
        'scoreHeading',
        'scores',
        'bookBtn',
      ]),
      // A Column stretches its children, which turns a back link into a
      // full-width button competing with the booking CTA. The Row lets it shrink
      // to its own content.
      row('backRow', ['backBtn'], { justify: 'start' }),
      button('backBtn', 'backLabel', 'backToResults', 'borderless'),
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
      ...metaRow('hero', '/car/'),
      text('whyHeading', 'Why it placed here', 'h5'),
      { id: 'why', component: 'ReasoningStep', title: { path: '/car/rationale' }, status: 'done' },
      text('specHeading', 'Specification', 'h5'),
      templated('specs', 'specLine', '/specs'),
      readOnlyRow('specLine'),
      text('scoreHeading', 'How it scored', 'h5'),
      templated('scores', 'scoreLine', '/scoreRows'),
      readOnlyRow('scoreLine'),
      button('bookBtn', 'bookLabel', 'bookCar', 'primary', { listingId: listing.id }),
      text('bookLabel', rental ? 'Book this car' : 'Reserve this car'),
    ]),
  ]
}

/* ------------------------------------------------------ adaptive interview */

/** Everything the one-question card needs to know beyond the question itself. */
export interface AdaptiveQuestionInfo {
  /** Cars currently passing every hard criterion — the narrowing counter. */
  pool: number
  /** 1-based "Question N" position. */
  index: number
  /** Multi-select picks accumulated so far, before Done commits them. */
  draft: string[]
  renting: boolean
  skippable: boolean
  /** Whether "show matches now" is worth offering yet. */
  searchable: boolean
}

/** Option buttons, paired into rows once the list gets tall. */
function optionGrid(
  options: { label: string; value: string }[],
  make: (opt: { label: string; value: string }, i: number) => [A2uiComponent, A2uiComponent],
): { rootIds: string[]; components: A2uiComponent[] } {
  const components: A2uiComponent[] = []
  const ids: string[] = []
  for (const [i, opt] of options.entries()) {
    const [btn, label] = make(opt, i)
    components.push({ ...btn, weight: 1 }, label)
    ids.push(String(btn.id))
  }
  if (options.length <= 4) return { rootIds: ids, components }

  const rowIds: string[] = []
  for (let i = 0; i < ids.length; i += 2) {
    const rowId = `qOptRow${i / 2}`
    rowIds.push(rowId)
    components.push(row(rowId, ids.slice(i, i + 2), { align: 'stretch' }))
  }
  return { rootIds: rowIds, components }
}

/**
 * The adaptive interview's one-question card.
 *
 * Everything is a tap: chip questions render as real buttons, the budget
 * slider as quick-pick bands off the same values the auction simulates, and
 * multi-selects as toggles committed by one Done. Free text falls back to the
 * SpecRow input. The pool counter at the top is the reward loop — every answer
 * visibly narrows the pool, which is what keeps people answering.
 */
export function buildAdaptiveQuestionSurface(
  question: Question,
  info: AdaptiveQuestionInfo,
): A2uiMessage[] {
  const components: A2uiComponent[] = []
  const bodyIds: string[] = []
  const answerAction = (value: string) => ({
    event: { name: 'answerQuestion', context: { questionId: question.id, value } },
  })

  const optionButton = (
    opt: { label: string; value: string },
    i: number,
    selected = false,
    toggle = false,
  ): [A2uiComponent, A2uiComponent] => [
    {
      id: `qOpt${i}`,
      component: 'Button',
      child: `qOpt${i}Label`,
      variant: selected ? 'primary' : 'default',
      action: toggle
        ? { event: { name: 'toggleAnswer', context: { questionId: question.id, value: opt.value } } }
        : answerAction(opt.value),
    },
    text(`qOpt${i}Label`, opt.label),
  ]

  switch (question.control) {
    case 'chips': {
      const grid = optionGrid(question.options ?? [], (opt, i) => optionButton(opt, i))
      components.push(...grid.components)
      bodyIds.push(...grid.rootIds)
      break
    }
    case 'slider': {
      // The quick-pick bands are the auction's own simulated answers — the
      // question is priced on exactly the values it offers.
      const bands = (question.simValues ?? []).map((v) => ({
        label: `Up to ${money(Number(v))}${info.renting ? '/mo' : ''}`,
        value: String(v),
      }))
      const grid = optionGrid(bands, (opt, i) => optionButton(opt, i))
      components.push(...grid.components)
      bodyIds.push(...grid.rootIds)
      break
    }
    case 'multi': {
      const grid = optionGrid(question.options ?? [], (opt, i) =>
        optionButton(opt, i, info.draft.includes(opt.value), true),
      )
      components.push(...grid.components)
      bodyIds.push(...grid.rootIds)
      components.push(
        {
          id: 'qDone',
          component: 'Button',
          child: 'qDoneLabel',
          variant: 'primary',
          action: { event: { name: 'submitAnswer', context: { questionId: question.id } } },
        },
        text(
          'qDoneLabel',
          info.draft.length > 0 ? `Done — ${info.draft.length} picked` : 'None of these',
        ),
      )
      bodyIds.push('qDone')
      break
    }
    default: {
      // Free text (and any future control) rides the same SpecRow the form
      // uses, pointed at answerQuestion instead of editSpec.
      components.push({
        id: 'qInput',
        component: 'SpecRow',
        label: '',
        value: { path: '/q/value' },
        filled: { path: '/q/filled' },
        questionId: { path: '/q/questionId' },
        control: { path: '/q/control' },
        options: { path: '/q/options' },
        editValue: { path: '/q/editValue' },
        min: question.min ?? 0,
        max: question.max ?? 0,
        step: question.step ?? 1,
        unit: question.unit ?? '',
        action: {
          event: {
            name: 'answerQuestion',
            context: { questionId: { path: '/q/questionId' }, value: { path: '/q/editValue' } },
          },
        },
      })
      bodyIds.push('qInput')
    }
  }

  const footerIds: string[] = []
  if (info.skippable) {
    components.push(button('qSkip', 'qSkipLabel', 'skipQuestion', 'borderless', { questionId: question.id }))
    components.push(text('qSkipLabel', 'Skip this one'))
    footerIds.push('qSkip')
  }
  if (info.searchable) {
    components.push(button('qSearchNow', 'qSearchNowLabel', 'confirmSpec', 'borderless'))
    components.push(text('qSearchNowLabel', 'Show me the matches now'))
    footerIds.push('qSearchNow')
  }
  if (footerIds.length > 0) components.push(row('qFooter', footerIds, { justify: 'start' }))

  return [
    updateDataModel(SURFACES.interview, '/', {
      progress: `Question ${info.index} · ${info.pool} cars in play`,
      q: {
        questionId: question.id,
        control: question.control,
        options: question.options ?? [],
        value: '',
        editValue: '',
        filled: false,
      },
    }),
    updateComponents(SURFACES.interview, [
      column('root', ['qProgress', 'qAsk', ...bodyIds, ...(footerIds.length ? ['qFooter'] : [])]),
      text('qProgress', { path: '/progress' }, 'caption'),
      text('qAsk', question.ask, 'h5'),
      ...components,
    ]),
  ]
}

/* --------------------------------------------------------------- interview */

/**
 * The interview, as one form.
 *
 * Everything is on screen at once rather than one question at a time behind a
 * Continue button. The rows are the same `SpecRow`s the drawer edits, built from
 * the same `specSheet`, so revising is re-picking a row rather than navigating,
 * and the sheet you approve is literally the sheet you filled.
 *
 * Mode-dependent rows come out of `specSheet` already resolved — mileage for
 * buying, the return date for renting — so switching rent to buy re-renders the
 * form with the right questions rather than branching here.
 */
export function interviewFormData(state: SessionState): A2uiMessage[] {
  return [
    updateDataModel(SURFACES.interview, '/', {
      rows: specSheet(state.preferences),
      searchLabel: state.preferences.mode === 'buy' ? 'Search cars for sale' : 'Search rentals',
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
      templated('sheet', 'formRow', '/rows'),
      editableRow('formRow', true),
      button('search', 'searchLabel', 'confirmSpec', 'primary'),
      text('searchLabel', { path: '/searchLabel' }),
      text('note', 'You can change any of this after the results come back.', 'caption'),
    ]),
  ]
}
