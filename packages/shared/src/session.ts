import type { Criterion, ListingAssessment } from './criteria.js'
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
  /** Ruled out by a hard criterion, shown separately with the reason. */
  ruledOut: number
  /** Filters that were relaxed to get usable results, for honest reporting. */
  relaxed: string[]
}

/**
 * Interview progress.
 *
 * `complete` and `confirmed` are separate on purpose: finishing the questions is
 * not permission to go searching. The user sees the assembled spec and approves
 * it first, which is their chance to correct a misheard answer before any work
 * happens.
 */
export interface InterviewState {
  /** Question ids already answered, in order. */
  answered: string[]
  /** The question currently on screen, if any. */
  pending?: string
  complete: boolean
  confirmed: boolean
  /**
   * The spec has been edited since the last search, so what is on the stage no
   * longer answers what is on the sheet. Drives the "Search again" affordance —
   * an edit does not re-search on its own, because changing four fields would
   * otherwise fire four searches and leave the user watching the last one win.
   */
  dirty: boolean
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
/**
 * Which driver runs the conversation.
 *
 * Held per session rather than per process so it can be switched from the UI
 * mid-demo. A provider that starts throttling three minutes into a presentation
 * should cost one click, not a server restart.
 */
export type DriverMode = 'scripted' | 'agent'

export interface SessionState {
  sessionId: string
  /** Which driver answers this session's turns. */
  mode: DriverMode
  phase: Phase
  interview: InterviewState
  preferences: Preferences
  /** The spec: what the interview answers became. */
  criteria: Criterion[]
  search?: SearchSummary
  shortlist: RankedListing[]
  /** Cars a hard criterion removed, kept so the user can see what and why. */
  ruledOut: ListingAssessment[]
  comparing: string[]
  booking?: Booking
  createdAt: string
  updatedAt: string
}

export function createSessionState(sessionId: string, mode: DriverMode = 'scripted'): SessionState {
  const now = new Date().toISOString()
  return {
    sessionId,
    mode,
    phase: 'interview',
    interview: { answered: [], complete: false, confirmed: false, dirty: false },
    preferences: {},
    criteria: [],
    shortlist: [],
    ruledOut: [],
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
