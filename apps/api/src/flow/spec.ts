import type { TurnContext } from '../session.js'
import { answerToPreferences } from './criteria.js'
import { questionById } from '../questions.js'
import {
  buildInterviewFormSurface,
  buildJourneySurface,
  interviewFormData,
} from '../surfaces.js'

/**
 * Editing the spec sheet.
 *
 * The form and the drawer are two views of the same sheet, built from the same
 * rows, so answering a question and correcting it later go through one path and
 * mean exactly the same thing.
 */

/**
 * A row was changed.
 *
 * Deliberately does not re-search. Someone correcting a bad result usually
 * changes more than one thing, and re-running on each edit would spend four
 * searches to show only the last — so the sheet goes amber and the search stays
 * the user's to trigger.
 */
export function editSpec(ctx: TurnContext, questionId: string, raw: unknown): void {
  const question = questionById(questionId)
  if (!question) return

  // The sheet carries multi-selects as one comma-joined string, because a row's
  // value is a single bound field. Split it back into the array the mapping wants.
  const value =
    question.control === 'multi'
      ? String(raw ?? '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : raw

  const { patch, clear } = answerToPreferences(questionId, value)
  if (Object.keys(patch).length > 0) ctx.patchPreferences(patch)
  if (clear.length > 0) ctx.clearPreferences(clear)

  // Answering by editing still counts as answering — otherwise a field filled
  // here for the first time leaves the interview believing it was never asked.
  const { answered } = ctx.state.interview
  ctx.patchInterview({
    answered: answered.includes(questionId) ? answered : [...answered, questionId],
    dirty: true,
  })

  ctx.a2ui(buildJourneySurface(ctx.state))
  // Values only — re-sending the components would remount the inputs and take
  // the caret with them.
  if (ctx.state.phase === 'interview') ctx.a2ui(interviewFormData(ctx.state))
}

/** Puts the whole spec on screen: every row, whether or not it has an answer. */
export function showInterviewForm(ctx: TurnContext): void {
  ctx.a2ui(buildJourneySurface(ctx.state))
  ctx.a2ui(buildInterviewFormSurface(ctx.state))
}
