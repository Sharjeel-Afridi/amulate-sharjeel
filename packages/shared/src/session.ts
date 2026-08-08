import type { Category, FuelType, Mode, RankedListing, Transmission } from './domain.js'

/** The agent's journey. Transitions are explicit, so the UI can render them. */
export type Phase = 'interview' | 'research' | 'recommend' | 'book' | 'done'

export const PHASES: readonly Phase[] = ['interview', 'research', 'recommend', 'book', 'done']

/**
 * What the interview is trying to fill in. Everything is optional — the point
 * of the interview is that we start knowing nothing and the UI shows the gaps
 * closing.
 */
export interface Preferences {
  mode?: Mode
  /** Free text, in the user's own words. Drives rationale wording. */
  useCase?: string
  category?: Category
  /** Monthly budget in euros for rentals; total price for purchases. */
  budgetMax?: number
  budgetMin?: number
  /** ISO date the user wants the car by. */
  targetDate?: string
  /** Rentals only. */
  returnDate?: string
  location?: string
  seatsMin?: number
  bootLitresMin?: number
  fuel?: FuelType
  transmission?: Transmission
  /** Purchases only. */
  maxMileageKm?: number
  minYear?: number
  /** Anything else worth weighting that doesn't fit a field. */
  notes?: string[]
}

/** Which preference fields the interview still needs, by mode. */
export const REQUIRED_FIELDS: Record<Mode, (keyof Preferences)[]> = {
  rent: ['mode', 'useCase', 'category', 'budgetMax', 'targetDate'],
  buy: ['mode', 'useCase', 'category', 'budgetMax', 'targetDate'],
}

export interface SearchSummary {
  totalScanned: number
  matched: number
  shortlisted: number
  /** Filters that were relaxed to get usable results, for honest reporting. */
  relaxed: string[]
}

export interface Booking {
  id: string
  listingId: string
  fullName?: string
  email?: string
  startDate?: string
  endDate?: string
  extras: string[]
  total: number
  status: 'draft' | 'submitted' | 'paid'
}

/**
 * Single source of truth, shared by the agent and the UI. The web client mirrors
 * this into the A2UI data model, so a patch here updates the journey rail.
 */
export interface SessionState {
  sessionId: string
  phase: Phase
  preferences: Preferences
  search?: SearchSummary
  shortlist: RankedListing[]
  comparing: string[]
  booking?: Booking
  createdAt: string
  updatedAt: string
}

export function createSessionState(sessionId: string): SessionState {
  const now = new Date().toISOString()
  return {
    sessionId,
    phase: 'interview',
    preferences: {},
    shortlist: [],
    comparing: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** Fields still missing before research can start. Empty means ready. */
export function missingFields(prefs: Preferences): (keyof Preferences)[] {
  const required = REQUIRED_FIELDS[prefs.mode ?? 'rent']
  return required.filter((f) => prefs[f] === undefined || prefs[f] === null)
}
