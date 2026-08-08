import type { Listing } from '@car/shared'
import { generateCatalog } from './generate.js'

export * from './art.js'
export * from './generate.js'
export * from './models.js'
export * from './query.js'
export { Rng, hashString } from './rng.js'

let cached: Listing[] | undefined

/** The catalogue, generated once per process. Deterministic across runs. */
export function catalog(): Listing[] {
  cached ??= generateCatalog()
  return cached
}

export function findListing(id: string): Listing | undefined {
  return catalog().find((l) => l.id === id)
}
