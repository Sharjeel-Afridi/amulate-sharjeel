/**
 * A2UI integration for the web app.
 *
 * The lead wires `<A2uiHost />` into the cockpit; the API builds v0.9 messages
 * that name `CAR_CATALOG_ID` in `createSurface`. Everything an outside module
 * needs is re-exported here so nothing has to reach into @a2ui/* directly.
 */

export { A2uiHost, type A2uiDataChange, type A2uiHostHandle, type A2uiHostProps } from './A2uiHost.js'
export {
  CAR_CATALOG_ID,
  CUSTOM_COMPONENTS,
  CarCard,
  CarCardApi,
  MatchScore,
  MatchScoreApi,
  PriceBadge,
  PriceBadgeApi,
  ReasoningStep,
  ReasoningStepApi,
  carCatalog,
} from './catalog.js'

// Protocol types, re-exported so callers import from one place.
export type {
  A2uiClientAction,
  A2uiClientDataModel,
  A2uiMessage,
  CreateSurfaceMessage,
  DeleteSurfaceMessage,
  UpdateComponentsMessage,
  UpdateDataModelMessage,
} from '@a2ui/web_core/v0_9'
