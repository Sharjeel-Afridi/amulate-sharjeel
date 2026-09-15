import type { Criterion } from './criteria.js'
import type { Category, FuelType, Mode, RankedListing, Transmission } from './domain.js'

/** The agent's journey. Transitions are explicit, so the UI can render them. */
export type Phase = 'interview' | 'research' | 'recommend' | 'book' | 'done'

export const PHASES: readonly Phase[] = ['interview', 'research', 'recommend', 'book', 'done']

/**
 * What the interview is trying to fill in. Everything is optional — the point
 * of the interview is that we start knowing nothing and the UI shows the gaps
 * closing.
 *
 * This is the single source of truth for the spec. `criteria` is derived from
 * it (see `buildCriteria`), never edited alongside it.
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
  /** Dealbreaker ids from the interview — 'no-diesel', 'strict-budget', … */
  dealbreakers?: string[]
  /**
   * Priority ids from PRIORITIES, at most MAX_PRIORITIES of them. These shape
   * the scorer's weights rather than filtering — see `emphasised` in ranking.
   */
  priorities?: string[]
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
 * How the interview collects its answers: one adaptively chosen question at a
 * time, or the whole spec as a single form. Both write the same preferences
 * through the same handlers — the style is the pacing, not the meaning.
 */
export type InterviewStyle = 'adaptive' | 'form'

export interface InterviewState {
  /** Question ids already answered, in order. */
  answered: string[]
  /** The user has approved the spec, so searching is allowed. */
  confirmed: boolean
  /**
   * The spec has been edited since the last search. Drives the "Search again"
   * affordance — an edit does not re-search on its own, because changing four
   * fields would otherwise fire four searches.
   */
  dirty: boolean
  style: InterviewStyle
  /** Adaptive only: questions the user declined, never to be re-asked. */
  skipped: string[]
  /** Adaptive only: the question currently on screen, if one is. */
  currentQuestionId?: string
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
 * Which driver runs the conversation.
 *
 * Held per session rather than per process so it can be switched from the UI
 * mid-demo. A provider that starts throttling three minutes into a presentation
 * should cost one click, not a server restart.
 */
export type DriverMode = 'scripted' | 'agent'

/**
 * Single source of truth, shared by the agent and the UI. The web client mirrors
 * this into the A2UI data model, so a patch here updates the journey rail.
 */
export interface SessionState {
  sessionId: string
  /** Which driver answers this session's turns. */
  mode: DriverMode
  phase: Phase
  interview: InterviewState
  preferences: Preferences
  /** The criteria the last search actually applied. Derived from preferences. */
  criteria: Criterion[]
  search?: SearchSummary
  shortlist: RankedListing[]
  createdAt: string
  updatedAt: string
}

export function createSessionState(
  sessionId: string,
  mode: DriverMode = 'scripted',
  style: InterviewStyle = 'form',
): SessionState {
  const now = new Date().toISOString()
  return {
    sessionId,
    mode,
    phase: 'interview',
    interview: { answered: [], confirmed: false, dirty: false, style, skipped: [] },
    preferences: {},
    criteria: [],
    shortlist: [],
    createdAt: now,
    updatedAt: now,
  }
}
