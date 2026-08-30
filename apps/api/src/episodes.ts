import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { InterviewStyle, SessionState } from '@car/shared'
import type { AuctionResult } from '@car/question-engine'
import type { TurnRecord } from './flow/interview.js'

/**
 * The episode log: question → answer → recommendation → choice, per session.
 *
 * This is the dataset the adaptive interview exists to produce. Every turn
 * records what was asked, what the auction considered, the propensity with
 * which the winner was chosen, and what the answer did to the pool — enough to
 * evaluate "would question B have done better?" from logs alone later, which
 * is impossible to reconstruct after the fact if propensities are not written
 * down now.
 *
 * Storage is deliberately boring: a Map for the session, one JSONL append per
 * event for durability. Analytics reads the Map; the file survives restarts
 * for offline analysis. No database until the data earns one.
 */

export interface EpisodeTurn {
  questionId: string
  skipped: boolean
  answer: unknown
  /** P(this question was the one asked). Null for seeds — nothing was auctioned. */
  propensity: number | null
  /** The auction's top pricings, for "what else could we have asked". */
  considered: { id: string; value: number }[]
  poolBefore: number
  poolAfter: number
  top1Before?: string
  top1After?: string
  flipped: boolean
  marginBefore: number
  marginAfter: number
  /** Milliseconds from the question appearing to the answer landing. */
  ms?: number
  at: string
}

export interface Episode {
  sessionId: string
  style: InterviewStyle
  driver: string
  startedAt: string
  turns: EpisodeTurn[]
  recommendation?: {
    listingIds: string[]
    pTop1: number
    margin: number
    questionsAsked: number
    /** A stop reason from the engine, or 'user' when they cut to the results. */
    stopReason: string
    at: string
  }
  outcome?: {
    kind: 'booked' | 'paid'
    listingId: string
    /** Where the chosen car sat in our shortlist. Null if we never listed it. */
    rank: number | null
    at: string
  }
}

const episodes = new Map<string, Episode>()

/** What was presented and when, so the next answer can carry its context. */
const pending = new Map<string, { questionId: string; auction: AuctionResult | null; at: number }>()

const DATA_DIR = process.env.EPISODES_DIR ?? path.join(process.cwd(), 'data')
const LOG_FILE = path.join(DATA_DIR, 'episodes.jsonl')

function persist(event: Record<string, unknown>): void {
  void mkdir(DATA_DIR, { recursive: true })
    .then(() => appendFile(LOG_FILE, `${JSON.stringify(event)}\n`))
    .catch((err) => console.error('[episodes] append failed:', err))
}

function episodeFor(state: SessionState): Episode {
  let ep = episodes.get(state.sessionId)
  if (!ep) {
    ep = {
      sessionId: state.sessionId,
      style: state.interview.style,
      driver: state.mode,
      startedAt: new Date().toISOString(),
      turns: [],
    }
    episodes.set(state.sessionId, ep)
  }
  return ep
}

export const getEpisode = (sessionId: string): Episode | undefined => episodes.get(sessionId)

export function notePresented(sessionId: string, questionId: string, auction: AuctionResult | null): void {
  const already = pending.get(sessionId)
  // Re-presenting the same question (a reconnect, a toggle redraw) must not
  // reset the answer clock.
  if (already?.questionId === questionId) return
  pending.set(sessionId, { questionId, auction, at: Date.now() })
}

export function recordTurn(state: SessionState, record: TurnRecord): void {
  const ep = episodeFor(state)
  const shown = pending.get(state.sessionId)
  const matched = shown?.questionId === record.questionId ? shown : undefined
  if (matched) pending.delete(state.sessionId)

  const turn: EpisodeTurn = {
    questionId: record.questionId,
    skipped: record.skipped,
    answer: record.answer,
    propensity: matched?.auction?.propensity ?? null,
    considered: (matched?.auction?.considered ?? [])
      .slice(0, 3)
      .map((a) => ({ id: a.id, value: Number(a.value.toFixed(3)) })),
    poolBefore: record.before.qualified,
    poolAfter: record.after.qualified,
    top1Before: record.before.top[0]?.id,
    top1After: record.after.top[0]?.id,
    flipped: Boolean(
      record.before.top[0] && record.after.top[0] && record.before.top[0].id !== record.after.top[0].id,
    ),
    marginBefore: Number(record.confBefore.margin.toFixed(3)),
    marginAfter: Number(record.confAfter.margin.toFixed(3)),
    ...(matched ? { ms: Date.now() - matched.at } : {}),
    at: new Date().toISOString(),
  }
  ep.turns.push(turn)
  persist({ event: 'turn', sessionId: state.sessionId, ...turn })
}

export function recordRecommendation(
  state: SessionState,
  info: { pTop1: number; margin: number; stopReason: string },
): void {
  const ep = episodeFor(state)
  ep.recommendation = {
    listingIds: state.shortlist.slice(0, 3).map((r) => r.listing.id),
    pTop1: Number(info.pTop1.toFixed(3)),
    margin: Number(info.margin.toFixed(3)),
    questionsAsked: state.interview.answered.length + state.interview.skipped.length,
    stopReason: info.stopReason,
    at: new Date().toISOString(),
  }
  persist({ event: 'recommendation', sessionId: state.sessionId, ...ep.recommendation })
}

export function recordOutcome(state: SessionState, kind: 'booked' | 'paid', listingId?: string): void {
  const ep = episodeFor(state)
  const id = listingId ?? ep.outcome?.listingId
  if (!id) return
  const rank = state.shortlist.find((r) => r.listing.id === id)?.rank ?? null
  ep.outcome = { kind, listingId: id, rank, at: new Date().toISOString() }
  persist({ event: 'outcome', sessionId: state.sessionId, ...ep.outcome })
}

/**
 * Per-question effectiveness, aggregated over this process's sessions. The
 * numbers that decide which questions live: how often asked, how often skipped,
 * what an answer does to the pool, how often it flips the leader.
 */
export function questionStats(): Record<
  string,
  {
    asked: number
    skipped: number
    flipRate: number
    avgPoolDelta: number
    avgMarginDelta: number
    avgMs: number | null
    avgPropensity: number | null
  }
> {
  const acc = new Map<
    string,
    { asked: number; skipped: number; flips: number; poolDelta: number; marginDelta: number; ms: number[]; propensity: number[] }
  >()
  for (const ep of episodes.values()) {
    for (const t of ep.turns) {
      let a = acc.get(t.questionId)
      if (!a) {
        a = { asked: 0, skipped: 0, flips: 0, poolDelta: 0, marginDelta: 0, ms: [], propensity: [] }
        acc.set(t.questionId, a)
      }
      if (t.skipped) a.skipped += 1
      else {
        a.asked += 1
        a.flips += t.flipped ? 1 : 0
        a.poolDelta += t.poolBefore - t.poolAfter
        a.marginDelta += t.marginAfter - t.marginBefore
        if (t.ms !== undefined) a.ms.push(t.ms)
        if (t.propensity !== null) a.propensity.push(t.propensity)
      }
    }
  }

  const avg = (xs: number[]): number | null =>
    xs.length ? Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(3)) : null
  const out: ReturnType<typeof questionStats> = {}
  for (const [id, a] of acc) {
    out[id] = {
      asked: a.asked,
      skipped: a.skipped,
      flipRate: a.asked ? Number((a.flips / a.asked).toFixed(3)) : 0,
      avgPoolDelta: a.asked ? Number((a.poolDelta / a.asked).toFixed(1)) : 0,
      avgMarginDelta: a.asked ? Number((a.marginDelta / a.asked).toFixed(3)) : 0,
      avgMs: avg(a.ms),
      avgPropensity: avg(a.propensity),
    }
  }
  return out
}
