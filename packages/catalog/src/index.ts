import type { Listing } from '@car/shared'
import { loadCatalog } from './load.js'

export * from './art.js'
export * from './load.js'
export * from './models.js'
export * from './query.js'
export { Rng, hashString } from './rng.js'

let cached: Listing[] | undefined

/** The catalogue, loaded once per process from the scraped inventory. */
export function catalog(): Listing[] {
  cached ??= loadCatalog()
  return cached
}

export function findListing(id: string): Listing | undefined {
  return catalog().find((l) => l.id === id)
}
