import { basicCatalog, createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9'
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9'
import { CURRENCY_SYMBOL } from '@car/shared'
import { z } from 'zod'

/**
 * Our custom A2UI component catalog.
 *
 * A2UI resolves exactly one catalog per surface (`createSurface.catalogId`), so
 * "custom components alongside the standard ones" is not a registration of
 * extras — it is a single merged catalog that re-exports everything in
 * `basicCatalog` plus our four domain components. The agent then names this
 * catalog's id and can use `Column`, `Text`, `CarCard`, … interchangeably.
 *
 * Schemas are built from `CommonSchemas` because the Generic Binder detects
 * A2UI primitives structurally: a union containing `{path}` becomes a resolved
 * value (plus an injected `setX` setter), and a union containing `{event}`
 * becomes a ready-to-call `() => void` that dispatches back to the host.
 */

/** Stable identifier the agent must send as `createSurface.catalogId`. */
export const CAR_CATALOG_ID = 'https://car-matchmaker.local/catalogs/v1.json'

/**
 * Schemas are deliberately non-strict (unknown keys are ignored rather than
 * rejected). An LLM-authored message that carries one stray property should
 * degrade to a slightly-wrong card, not abort the whole `updateComponents`
 * batch — the processor throws on the first validation failure.
 */
const commonProps = {
  weight: z.number().optional(),
  accessibility: z
    .object({
      label: CommonSchemas.DynamicString.optional(),
      description: CommonSchemas.DynamicString.optional(),
    })
    .optional(),
}

export const CarCardApi = {
  name: 'CarCard',
  schema: z.object({
    ...commonProps,
    title: CommonSchemas.DynamicString,
    subtitle: CommonSchemas.DynamicString.optional(),
    imageUrl: CommonSchemas.DynamicString.optional(),
    tags: CommonSchemas.DynamicStringList.optional(),
    selected: CommonSchemas.DynamicBoolean.optional(),
    /** Lays the card out horizontally, for results below the leading few. */
    compact: CommonSchemas.DynamicBoolean.optional(),
    /** Id of a component rendered in the card body — use a Row/Column to compose. */
    child: z.string().optional(),
    action: CommonSchemas.Action.optional(),
  }),
}

export const CarCard = createComponentImplementation(CarCardApi, ({ props, buildChild }) => {
  const tags = Array.isArray(props.tags) ? props.tags : []
  const clickable = typeof props.action === 'function'

  return (
    <div
      className={
        'a2ui-carcard' +
        (props.selected ? ' a2ui-carcard--selected' : '') +
        (props.compact ? ' a2ui-carcard--compact' : '')
      }
      // Cards double as the primary "pick this one" affordance, so the whole
      // card is the hit target when the agent attached an action.
      onClick={clickable ? props.action : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                props.action?.()
              }
            }
          : undefined
      }
    >
      {props.imageUrl && (
        <img
          className="a2ui-carcard__img"
          src={props.imageUrl}
          alt=""
          // The photographs are hotlinked from the marketplace, so a flaky
          // network takes them out. Removing the broken image leaves a card that
          // still reads; leaving it shows a torn-page icon on every result.
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      )}
      <div className="a2ui-carcard__body">
        <div className="a2ui-carcard__title">{props.title}</div>
        {props.subtitle && <div className="a2ui-carcard__subtitle">{props.subtitle}</div>}
        {tags.length > 0 && (
          <div className="a2ui-carcard__tags">
            {tags.map((tag, i) => (
              <span key={i} className="a2ui-carcard__tag">
                {tag}
              </span>
            ))}
          </div>
        )}
        {props.child ? buildChild(props.child) : null}
      </div>
    </div>
  )
})

export const MatchScoreApi = {
  name: 'MatchScore',
  schema: z.object({
    ...commonProps,
    score: CommonSchemas.DynamicNumber,
    label: CommonSchemas.DynamicString.optional(),
    /** Upper bound of the score scale; 100 unless the agent says otherwise. */
    max: z.number().optional(),
  }),
}

export const MatchScore = createComponentImplementation(MatchScoreApi, ({ props }) => {
  const max = typeof props.max === 'number' && props.max > 0 ? props.max : 100
  const raw = typeof props.score === 'number' ? props.score : 0
  const pct = Math.max(0, Math.min(100, Math.round((raw / max) * 100)))

  return (
    <div className="a2ui-matchscore" title={`${pct}% match`}>
      <div className="a2ui-matchscore__bar">
        <div className="a2ui-matchscore__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="a2ui-matchscore__value">{pct}%</span>
      {props.label && <span className="a2ui-matchscore__label">{props.label}</span>}
    </div>
  )
})

export const PriceBadgeApi = {
  name: 'PriceBadge',
  schema: z.object({
    ...commonProps,
    amount: CommonSchemas.DynamicNumber,
    currency: CommonSchemas.DynamicString.optional(),
    /** Rate unit such as "day" or "month"; omit for an outright price. */
    period: CommonSchemas.DynamicString.optional(),
    note: CommonSchemas.DynamicString.optional(),
  }),
}

export const PriceBadge = createComponentImplementation(PriceBadgeApi, ({ props }) => {
  const amount = typeof props.amount === 'number' ? props.amount : 0
  const currency = props.currency ?? CURRENCY_SYMBOL

  return (
    <span className="a2ui-pricebadge">
      <span className="a2ui-pricebadge__amount">
        {currency}
        {amount.toLocaleString('en-IE')}
      </span>
      {props.period && <span className="a2ui-pricebadge__period">/{props.period}</span>}
      {props.note && <span className="a2ui-pricebadge__note">{props.note}</span>}
    </span>
  )
})

export const SpecRowApi = {
  name: 'SpecRow',
  schema: z.object({
    ...commonProps,
    label: CommonSchemas.DynamicString,
    value: CommonSchemas.DynamicString.optional(),
    /** False gets the placeholder treatment — a field nobody has filled yet. */
    filled: CommonSchemas.DynamicBoolean.optional(),
  }),
}

/**
 * One line of the assembling spec: what was asked on the left, what the agent
 * recorded on the right.
 *
 * A plain column of sentences ("Budget — not set") technically carried the same
 * information, but nothing lined up, so there was no way to scan for what was
 * still missing. Pairing label and value on one row makes the gaps obvious.
 */
export const SpecRow = createComponentImplementation(SpecRowApi, ({ props }) => {
  const filled = props.filled !== false && Boolean(props.value)

  return (
    <div className={`a2ui-specrow${filled ? ' a2ui-specrow--filled' : ''}`}>
      <span className="a2ui-specrow__label">{props.label}</span>
      <span className="a2ui-specrow__value">{filled ? props.value : 'Not set'}</span>
    </div>
  )
})

export const ReasoningStepApi = {
  name: 'ReasoningStep',
  schema: z.object({
    ...commonProps,
    title: CommonSchemas.DynamicString,
    detail: CommonSchemas.DynamicString.optional(),
    /** "pending" | "active" | "done" — dynamic so a stream can flip it live. */
    status: CommonSchemas.DynamicString.optional(),
  }),
}

const REASONING_STATUSES = new Set(['pending', 'active', 'done'])

export const ReasoningStep = createComponentImplementation(ReasoningStepApi, ({ props }) => {
  const status = typeof props.status === 'string' && REASONING_STATUSES.has(props.status) ? props.status : 'pending'

  return (
    <div className={`a2ui-step a2ui-step--${status}`}>
      <span className="a2ui-step__dot" aria-hidden="true">
        {status === 'done' ? '✓' : ''}
      </span>
      <span className="a2ui-step__text">
        <span className="a2ui-step__title">{props.title}</span>
        {props.detail && <span className="a2ui-step__detail">{props.detail}</span>}
      </span>
    </div>
  )
})

/** Every custom component, in registration order. */
export const CUSTOM_COMPONENTS: ReactComponentImplementation[] = [
  CarCard,
  MatchScore,
  PriceBadge,
  ReasoningStep,
  SpecRow,
]

/**
 * The catalog to hand the MessageProcessor. Spreading `basicCatalog` keeps the
 * eighteen standard components (Row, Column, Card, ChoicePicker, Slider, …) and
 * every basic function (formatCurrency, required, greater_than, …) available.
 */
export const carCatalog = new Catalog<ReactComponentImplementation>(
  CAR_CATALOG_ID,
  [...basicCatalog.components.values(), ...CUSTOM_COMPONENTS],
  [...basicCatalog.functions.values()],
)
