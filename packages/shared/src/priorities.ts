import type { Mode } from './domain.js'

/**
 * The "what matters most" vocabulary — the one weight-shaping question both
 * modes share. Declared here because two sides need the same ids: the
 * interview renders the labels, and the ranking package maps each id onto the
 * scorer weights it should amplify. An id the scorer cannot act on would be a
 * lie in the UI, so the list is exactly what the listing data can support.
 */
export interface PriorityOption {
  id: string
  label: string
  modes: readonly Mode[]
}

export const PRIORITIES: readonly PriorityOption[] = [
  { id: 'economy', label: 'Low running costs', modes: ['rent', 'buy'] },
  { id: 'boot', label: 'Boot space', modes: ['rent', 'buy'] },
  { id: 'seats', label: 'Room for people', modes: ['rent', 'buy'] },
  { id: 'rating', label: 'Well reviewed', modes: ['rent', 'buy'] },
  { id: 'value', label: 'Price headroom', modes: ['rent', 'buy'] },
  { id: 'condition', label: 'Low mileage, newer car', modes: ['buy'] },
  { id: 'cover', label: 'Warranty cover', modes: ['buy'] },
  { id: 'kms', label: 'Generous km allowance', modes: ['rent'] },
  { id: 'flexibility', label: 'Instant booking', modes: ['rent'] },
]

/** How many priorities one person can claim before none of them means anything. */
export const MAX_PRIORITIES = 3

export const prioritiesFor = (mode: Mode): PriorityOption[] =>
  PRIORITIES.filter((p) => p.modes.includes(mode))

export const priorityLabel = (id: string): string =>
  PRIORITIES.find((p) => p.id === id)?.label ?? id
