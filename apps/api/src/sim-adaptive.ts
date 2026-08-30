/**
 * Headless dry-run of the adaptive interview: walks decide → answer → decide
 * with canned answers and prints each auction's pricing, so a change to the
 * engine or the bank can be judged in one screenful without starting the app.
 * Run with `npm run sim -w @car/api` (optionally `-- rent convertible`).
 */
import { createSession, makeContext } from './session.js'
import { decideNext, recordAnswer, recordSkip } from './flow/interview.js'

const state = createSession('scripted', 'adaptive')
const ctx = makeContext(state)

const canned: Record<string, unknown> = {
  mode: process.argv[2] ?? 'buy',
  useCase: 'city commuting, tight parking',
  passengers: '4',
  category: process.argv[3] ?? 'hatchback',
  budgetBuy: 22000,
  budget: 2500,
  luggage: '300',
  fuel: 'petrol',
  transmission: 'automatic',
  mileage: '60000',
  priorities: ['economy', 'rating'],
  prioritiesBuy: ['economy', 'rating'],
  dealbreakers: ['no-old'],
}

for (let turn = 0; turn < 12; turn++) {
  const d = decideNext(ctx)
  if (d.kind === 'stop') {
    console.log(
      `STOP after ${turn} turns: ${d.reason} · pool ${d.pool.qualified} · ` +
        `pTop1 ${(d.conf.pTop1 * 100).toFixed(0)}% · margin ${d.conf.margin.toFixed(2)}`,
    )
    break
  }
  const best = d.auction?.considered[0]
  console.log(
    `Q${d.index}: ${d.question.id.padEnd(14)} pool=${String(d.pool.qualified).padStart(3)} ` +
      `margin=${d.conf.margin.toFixed(2)}` +
      (d.auction
        ? ` [auction: value=${best?.value.toFixed(3)} elim=${best?.eliminationShare.toFixed(2)} flip=${best?.flipProbability.toFixed(2)} propensity=${d.auction.propensity.toFixed(2)} ties=${d.auction.nearTies.join(',')}]`
        : ' [seed]'),
  )
  ctx.patchInterview({ currentQuestionId: d.question.id })
  const answer = canned[d.question.id]
  if (answer === undefined) {
    console.log(`   (no canned answer — skipping)`)
    recordSkip(ctx, d.question.id)
    continue
  }
  recordAnswer(ctx, d.question.id, answer)
}
console.log('answered:', state.interview.answered.join(', '))
console.log('prefs:', JSON.stringify(state.preferences))
