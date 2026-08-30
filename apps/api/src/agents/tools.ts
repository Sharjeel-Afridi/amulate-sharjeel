import { CATEGORIES } from '@car/shared'
import { tool } from '@openai/agents'
import { z } from 'zod'
import type { ReorderFn } from '../flow/index.js'
import { runSearch, showInterviewForm, startBooking } from '../flow/index.js'
import { buildJourneySurface } from '../surfaces.js'
import { questionById } from '../questions.js'
import type { TurnContext } from '../session.js'

/**
 * What the conversational agent is allowed to do.
 *
 * Rebuilt each turn so they can write into that turn's context. There is
 * deliberately no `ask_question` tool: the interview's sequence belongs to the
 * question plan and the rendered controls, and giving the model a way to push a
 * different question mid-flow only lets the two disagree about where the
 * conversation is.
 */

/**
 * A stand-in parameter for tools that genuinely take no arguments.
 *
 * `z.object({})` serialises to a schema carrying `required` with no
 * `properties`, which some providers reject outright. One ignored optional field
 * keeps the schema valid everywhere without giving the model anything to get wrong.
 */
const NO_ARGS = z.object({ note: z.string().nullable().describe('Unused. Pass null.') })

const ENUMS: Record<string, readonly string[]> = {
  mode: ['rent', 'buy'],
  fuel: ['petrol', 'diesel', 'hybrid', 'electric'],
  transmission: ['manual', 'automatic'],
  category: CATEGORIES,
}
const NUMERIC = new Set(['budgetMax', 'seatsMin', 'bootLitresMin', 'maxMileageKm'])
const TEXTUAL = new Set(['useCase', 'targetDate', 'returnDate'])

/** Parses one field=value pair, or explains to the model why it could not. */
function parseField(key: string, value: string): { value: unknown } | { error: string } {
  if (NUMERIC.has(key)) {
    const n = Number(value.replace(/[^\d.]/g, ''))
    return Number.isFinite(n) && n > 0
      ? { value: n }
      : { error: `"${value}" is not a usable number for ${key}.` }
  }
  const allowed = ENUMS[key]
  if (allowed) {
    const lower = value.toLowerCase()
    return allowed.includes(lower)
      ? { value: lower }
      : { error: `"${value}" is not valid for ${key}. Allowed: ${allowed.join(', ')}.` }
  }
  return TEXTUAL.has(key) ? { value } : { error: `"${key}" is not a field I track. Ignored.` }
}

export function buildTools(ctx: TurnContext, reorder: ReorderFn) {
  const recordPreferences = tool({
    name: 'record_preferences',
    description:
      'Save ONE thing the user told you. Call once per fact. ' +
      'field is one of: mode (rent|buy), useCase (free text), category, ' +
      'budgetMax (number, monthly for rent / total for buy), targetDate (2026-09-12), ' +
      'returnDate, seatsMin (number), bootLitresMin (number), ' +
      'fuel (petrol|diesel|hybrid|electric), transmission (manual|automatic), ' +
      'maxMileageKm (number). value is always a string.',
    /*
     * Two always-present string parameters, one fact per call.
     *
     * A single eleven-field object is the obvious shape, but tool calls are
     * validated strictly: every property in the schema must be present, and a
     * smaller model reliably omits the ones it has no value for — which rejects
     * the entire call and loses the fields it *did* get right.
     */
    parameters: z.object({ field: z.string(), value: z.string() }),
    execute: async ({ field, value }) => {
      const key = field.trim()
      const raw = value?.trim()
      if (!raw) return `No value given for ${key}. Ignored.`

      const parsed = parseField(key, raw)
      if ('error' in parsed) return parsed.error

      ctx.patchPreferences({ [key]: parsed.value } as never)
      ctx.step(`Noted ${key}`, String(parsed.value))
      ctx.a2ui(buildJourneySurface(ctx.state))
      return `Saved ${key}=${String(parsed.value)}.`
    },
  })

  const addDealbreakers = tool({
    name: 'add_dealbreakers',
    description:
      'Record absolute dealbreakers — things that rule a car out entirely. ' +
      'Valid values: no-diesel, no-manual, no-old, no-two-door, no-km-cap, strict-budget.',
    parameters: z.object({ values: z.array(z.string()) }),
    execute: async ({ values }) => {
      // A Set because the model will name the same dealbreaker twice across a
      // conversation, and the spec sheet renders whatever is stored verbatim.
      const valid = new Set((questionById('dealbreakers')?.options ?? []).map((o) => o.value))
      const chosen = new Set(ctx.state.preferences.dealbreakers ?? [])
      const added = values.filter((v) => v !== 'none' && valid.has(v) && !chosen.has(v))
      for (const v of added) chosen.add(v)

      ctx.patchPreferences({ dealbreakers: [...chosen] })
      ctx.a2ui(buildJourneySurface(ctx.state))
      return added.length ? `Added exclusions: ${added.join(', ')}` : 'No new dealbreakers.'
    },
  })

  const showSpec = tool({
    name: 'show_spec',
    description:
      'Repaint the interview form so it reflects everything recorded so far. Call this ' +
      'after recording preferences, so the user sees their answers land. The form is ' +
      'always on screen — do not search until the user asks you to.',
    parameters: NO_ARGS,
    execute: async () => {
      showInterviewForm(ctx)
      return 'Form updated. Wait for the user to ask before searching.'
    },
  })

  const searchAndRank = tool({
    name: 'search_and_rank',
    description:
      'Search the marketplace, apply the criteria, rank what qualifies and render the ' +
      'results. Call once, only after the user confirms the spec. Returns the shortlist ' +
      'with rationales you should quote rather than rewrite.',
    parameters: NO_ARGS,
    // `narrate: false` — the reply is this turn's job, and the same results
    // described twice in two voices reads as a bug.
    execute: async () => JSON.stringify(await runSearch(ctx, { narrate: false, reorder })),
  })

  const openBooking = tool({
    name: 'open_booking',
    description: 'Open the booking form for a listing the user chose. Use the listing id.',
    parameters: z.object({ listingId: z.string() }),
    execute: async ({ listingId }) => {
      await startBooking(ctx, listingId)
      return 'Booking form is on screen. The user fills it in themselves.'
    },
  })

  return [recordPreferences, addDealbreakers, showSpec, searchAndRank, openBooking]
}
