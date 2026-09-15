import type { Preferences } from '@car/shared'

/**
 * Stated priorities bend the weight tables; they never filter.
 *
 * Each scorer declares its own mapping from priority id to the weight keys it
 * amplifies, right next to its weight table — the two have to be read together
 * to mean anything. Derived at the point of use from `prefs.priorities`, the
 * same rule criteria follow: nothing here is stored and edited alongside the
 * answer it came from.
 */

/** One stated priority doubles what it touches. Enough to reorder, not to veto. */
const BOOST = 2

export function emphasised<T extends Record<string, number>>(
  weights: T,
  prefs: Preferences,
  mapping: Partial<Record<string, readonly (keyof T)[]>>,
): Record<keyof T, number> {
  const priorities = prefs.priorities ?? []
  const out: Record<string, number> = { ...weights }
  for (const id of priorities) {
    for (const key of mapping[id] ?? []) out[key as string] = (out[key as string] ?? 0) * BOOST
  }
  return out as Record<keyof T, number>
}

export const hasPriority = (prefs: Preferences, id: string): boolean =>
  (prefs.priorities ?? []).includes(id)
