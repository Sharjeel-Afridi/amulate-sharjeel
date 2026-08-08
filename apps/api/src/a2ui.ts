/**
 * A2UI v0.9 message builders.
 *
 * The protocol is a flat adjacency list: every component carries an `id`, and
 * parents reference children by id rather than nesting them. That is what makes
 * the stream incremental — we can patch one component without resending a tree.
 *
 * Data binding is by JSON Pointer (`{path: '/preferences/budgetMax'}`), so the
 * agent's session state and the rendered UI are the same object: patch the model
 * and every bound component updates itself.
 *
 * These builders exist so the structured surfaces are deterministic and free.
 * Only the comparison view is authored by the model.
 */

export const A2UI_VERSION = 'v0.9' as const

/** The standard component set. */
export const BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

/**
 * Our catalog: the basic set merged with `CarCard`, `MatchScore`, `PriceBadge`
 * and `ReasoningStep`. A surface resolves exactly one catalog by exact id match,
 * so custom components cannot be registered alongside the standard set — they
 * have to ship as one merged catalog under its own id. Must stay in step with
 * `CAR_CATALOG_ID` in `apps/web/src/a2ui/catalog.tsx`.
 */
export const CAR_CATALOG = 'https://car-matchmaker.local/catalogs/v1.json'

/** A value that is either literal or bound to a path in the data model. */
export type Dynamic<T> = T | { path: string }

export interface A2uiComponent {
  id: string
  component: string
  [prop: string]: unknown
}

export interface CreateSurfaceMessage {
  version: typeof A2UI_VERSION
  createSurface: {
    surfaceId: string
    catalogId: string
    theme?: Record<string, unknown>
    sendDataModel?: boolean
  }
}

export interface UpdateComponentsMessage {
  version: typeof A2UI_VERSION
  updateComponents: { surfaceId: string; components: A2uiComponent[] }
}

export interface UpdateDataModelMessage {
  version: typeof A2UI_VERSION
  updateDataModel: { surfaceId: string; path?: string; value?: unknown }
}

export interface DeleteSurfaceMessage {
  version: typeof A2UI_VERSION
  deleteSurface: { surfaceId: string }
}

export type A2uiMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage

/** The surfaces this app drives. One per zone of the cockpit. */
export const SURFACES = {
  /** Left rail: phase stepper plus the spec assembling live. */
  journey: 'journey',
  /** Right panel: catalogue, comparison, detail. */
  stage: 'stage',
  /** Inline interview controls rendered into the chat stream. */
  interview: 'interview',
} as const

export type SurfaceId = (typeof SURFACES)[keyof typeof SURFACES]

export function createSurface(
  surfaceId: SurfaceId,
  catalogId: string = BASIC_CATALOG,
): CreateSurfaceMessage {
  return { version: A2UI_VERSION, createSurface: { surfaceId, catalogId } }
}

export function updateComponents(
  surfaceId: SurfaceId,
  components: A2uiComponent[],
): UpdateComponentsMessage {
  return { version: A2UI_VERSION, updateComponents: { surfaceId, components } }
}

/**
 * Patch the surface's data model. Omitting `path` replaces the whole model;
 * a JSON Pointer patches one node and only the components bound to it re-render.
 */
export function updateDataModel(
  surfaceId: SurfaceId,
  path: string,
  value: unknown,
): UpdateDataModelMessage {
  return { version: A2UI_VERSION, updateDataModel: { surfaceId, path, value } }
}

export function deleteSurface(surfaceId: SurfaceId): DeleteSurfaceMessage {
  return { version: A2UI_VERSION, deleteSurface: { surfaceId } }
}

// --------------------------------------------------------------- components

export const text = (
  id: string,
  value: Dynamic<string>,
  variant: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'body' | 'caption' = 'body',
): A2uiComponent => ({ id, component: 'Text', text: value, variant })

export const column = (
  id: string,
  children: string[],
  extra: Record<string, unknown> = {},
): A2uiComponent => ({ id, component: 'Column', children, ...extra })

export const row = (
  id: string,
  children: string[],
  extra: Record<string, unknown> = {},
): A2uiComponent => ({ id, component: 'Row', children, ...extra })

export const list = (
  id: string,
  children: string[],
  direction: 'vertical' | 'horizontal' = 'vertical',
): A2uiComponent => ({ id, component: 'List', children, direction })

export const card = (id: string, child: string): A2uiComponent => ({
  id,
  component: 'Card',
  child,
})

export const image = (
  id: string,
  url: Dynamic<string>,
  description?: string,
): A2uiComponent => ({ id, component: 'Image', url, description, fit: 'contain' })

export const divider = (id: string): A2uiComponent => ({ id, component: 'Divider' })

export const button = (
  id: string,
  child: string,
  action: Record<string, unknown>,
  variant: 'default' | 'primary' | 'borderless' = 'default',
): A2uiComponent => ({ id, component: 'Button', child, action, variant })

/** Multi- or single-select chips — the interview's main input. */
export const choicePicker = (
  id: string,
  label: string,
  options: { label: string; value: string }[],
  value: Dynamic<string[]>,
  variant: 'mutuallyExclusive' | 'multipleSelection' = 'mutuallyExclusive',
): A2uiComponent => ({
  id,
  component: 'ChoicePicker',
  label,
  options,
  value,
  variant,
  displayStyle: 'chips',
})

export const slider = (
  id: string,
  label: string,
  max: number,
  value: Dynamic<number>,
  min = 0,
): A2uiComponent => ({ id, component: 'Slider', label, min, max, value })

export const dateTimeInput = (
  id: string,
  label: string,
  value: Dynamic<string>,
  min?: string,
): A2uiComponent => ({
  id,
  component: 'DateTimeInput',
  label,
  value,
  enableDate: true,
  enableTime: false,
  min,
})

export const textField = (
  id: string,
  label: string,
  value: Dynamic<string>,
): A2uiComponent => ({ id, component: 'TextField', label, value, variant: 'shortText' })
