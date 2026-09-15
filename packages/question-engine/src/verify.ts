/**
 * Exercises the auction against a synthetic pool and asserts the guarantees
 * the interview relies on: eligibility is respected, a question that cannot
 * move the outcome never beats one that can, propensities are honest, the
 * result is deterministic under a pinned RNG, and every stop reason fires when
 * it should. Run with `npm run verify -w @car/question-engine`.
 * Exits non-zero on failure so it can gate a build.
 */
import type { Preferences } from '@car/shared'
import { pendingRequired, runAuction } from './auction.js'
import { confidence } from './confidence.js'
import { shouldStop } from './stopping.js'
import { type BankQuestion, DEFAULT_CONFIG, type Evaluate } from './types.js'

const failures: string[] = []
const expect = (ok: boolean, what: string) => {
  if (!ok) failures.push(what)
}

/* ------------------------------------------------------- synthetic world */

interface Car {
  id: string
  price: number
  seats: number
  fuel: 'petrol' | 'diesel' | 'electric'
}

const CARS: Car[] = Array.from({ length: 40 }, (_, i) => ({
  id: `car-${i}`,
  price: 10_000 + i * 2_000,
  seats: i % 3 === 0 ? 7 : 5,
  fuel: (['petrol', 'diesel', 'electric'] as const)[i % 3]!,
}))

const apply = (prefs: Preferences, questionId: string, value: unknown): Preferences => {
  switch (questionId) {
    case 'budget':
      return { ...prefs, budgetMax: Number(value) }
    case 'seats':
      return { ...prefs, seatsMin: Number(value) }
    case 'fuel':
      return value === 'any' ? prefs : { ...prefs, fuel: value as Preferences['fuel'] }
    default:
      // 'colour' — recorded, but nothing in the pool cares.
      return prefs
  }
}

const evaluate: Evaluate = (prefs) => {
  const qualified = CARS.filter(
    (c) =>
      (prefs.budgetMax === undefined || c.price <= prefs.budgetMax) &&
      (prefs.seatsMin === undefined || c.seats >= prefs.seatsMin),
  )
  const top = qualified
    .map((c) => ({
      id: c.id,
      score: 90 - c.price / 2_000 + (prefs.fuel && c.fuel === prefs.fuel ? 15 : 0),
    }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, 8)
  return { qualified: qualified.length, top }
}

const BANK: BankQuestion[] = [
  {
    id: 'budget',
    kind: 'hard',
    cost: 1,
    answers: [20_000, 40_000, 70_000].map((value) => ({ value, prior: 1 })),
    filled: (p) => p.budgetMax !== undefined,
  },
  {
    id: 'seats',
    kind: 'hard',
    cost: 1,
    answers: [5, 7].map((value) => ({ value, prior: 1 })),
    filled: (p) => p.seatsMin !== undefined,
  },
  {
    id: 'fuel',
    kind: 'weight',
    cost: 1,
    answers: ['petrol', 'diesel', 'electric', 'any'].map((value) => ({ value, prior: 1 })),
    filled: (p) => p.fuel !== undefined,
  },
  {
    id: 'colour',
    kind: 'weight',
    cost: 1,
    answers: ['red', 'black'].map((value) => ({ value, prior: 1 })),
  },
  {
    id: 'return-date',
    kind: 'hard',
    cost: 1,
    answers: [{ value: '2026-09-01', prior: 1 }],
    precondition: (p) => p.mode === 'rent',
  },
]

const pinned = (value: number) => () => value

/* ------------------------------------------------------------ eligibility */

{
  const result = runAuction({
    bank: BANK,
    prefs: { budgetMax: 30_000 },
    asked: ['seats'],
    apply,
    evaluate,
    random: pinned(0),
  })
  expect(result !== null, 'eligibility: auction returned nothing')
  expect(result?.questionId !== 'budget', 'eligibility: asked about a filled slot (budget)')
  expect(result?.questionId !== 'seats', 'eligibility: re-asked an asked question (seats)')
  expect(
    result?.questionId !== 'return-date',
    'eligibility: asked a question whose precondition fails',
  )
  for (const a of result?.considered ?? []) {
    expect(
      !['budget', 'seats', 'return-date'].includes(a.id),
      `eligibility: priced ineligible question ${a.id}`,
    )
  }
}

/* --------------------------------------------- value ordering & propensity */

{
  const result = runAuction({ bank: BANK, prefs: {}, asked: [], apply, evaluate, random: pinned(0) })
  expect(result !== null, 'auction: empty prefs found nothing to ask')
  if (result) {
    expect(result.questionId !== 'colour', 'auction: the no-op question beat a discriminating one')
    const colour = result.considered.find((a) => a.id === 'colour')
    const budget = result.considered.find((a) => a.id === 'budget')
    expect((colour?.gain ?? 1) === 0, `auction: no-op question earned gain ${colour?.gain}`)
    expect((budget?.gain ?? 0) > 0, 'auction: budget simulation earned no gain')
    expect(
      Math.abs(result.propensity - 1 / result.nearTies.length) < 1e-9,
      `auction: propensity ${result.propensity} != 1/${result.nearTies.length}`,
    )
    expect(result.nearTies.includes(result.questionId), 'auction: winner not among the near-ties')

    const again = runAuction({ bank: BANK, prefs: {}, asked: [], apply, evaluate, random: pinned(0) })
    expect(
      again?.questionId === result.questionId,
      'auction: same input and RNG produced a different winner',
    )
  }
}

/* ------------------------------------------------------------- confidence */

{
  const single = confidence([80], DEFAULT_CONFIG.temperature)
  expect(single.pTop1 === 1 && single.margin === 1, 'confidence: a lone car is not a certainty')

  const tight = confidence([70, 69, 68], DEFAULT_CONFIG.temperature)
  const clear = confidence([85, 60, 55], DEFAULT_CONFIG.temperature)
  expect(clear.margin > tight.margin, 'confidence: a clear leader does not out-margin a tie')
  expect(
    tight.pTop1 > 0 && tight.pTop1 <= 1 && tight.margin >= 0,
    'confidence: probabilities out of range',
  )
}

/* ---------------------------------------------------------------- stopping */

{
  const base = { askedCount: 4, margin: 0, poolSize: 20, bestValue: 0.3, requiredPending: 0 }
  expect(shouldStop(base) === null, 'stopping: stopped with no reason to')
  expect(shouldStop({ ...base, askedCount: 1 }) === null, 'stopping: ignored the floor')
  expect(
    shouldStop({ ...base, askedCount: 1, poolSize: 2 }) === 'tiny-pool',
    'stopping: floor outranked a tiny pool',
  )
  expect(shouldStop({ ...base, margin: 0.2 }) === 'confident', 'stopping: missed a clear leader')
  expect(
    shouldStop({ ...base, askedCount: 1, margin: 0.9 }) === null,
    'stopping: confident before the floor',
  )
  expect(shouldStop({ ...base, bestValue: null }) === 'exhausted', 'stopping: asked thin air')
  expect(
    shouldStop({ ...base, bestValue: 0.001 }) === 'exhausted',
    'stopping: asked a worthless question',
  )
  expect(shouldStop({ ...base, askedCount: 8 }) === 'cap', 'stopping: blew through the cap')

  // Required slots gate confidence: a clear leader of an unstated spec is not
  // a recommendation, and "nothing worth asking" cannot be true while budget
  // has never come up.
  expect(
    shouldStop({ ...base, margin: 0.9, requiredPending: 1 }) === null,
    'stopping: called itself confident with budget unresolved',
  )
  expect(
    shouldStop({ ...base, bestValue: 0.001, requiredPending: 1 }) === null,
    'stopping: exhausted itself past an unresolved required slot',
  )
  expect(
    shouldStop({ ...base, poolSize: 2, requiredPending: 1 }) === 'tiny-pool',
    'stopping: kept interrogating a tiny pool over a required slot',
  )
}

/* ----------------------------------------------------- required questions */

{
  // Every simulated answer leaves the pool untouched, so both questions price
  // at zero — but budget is required, so it must be asked anyway.
  const lowValueBank: BankQuestion[] = [
    {
      id: 'budget',
      kind: 'hard',
      cost: 1,
      required: true,
      answers: [{ value: 500_000, prior: 1 }],
      filled: (p) => p.budgetMax !== undefined,
    },
    {
      id: 'colour',
      kind: 'weight',
      cost: 1,
      answers: ['red', 'black'].map((value) => ({ value, prior: 1 })),
    },
  ]

  expect(
    pendingRequired(lowValueBank, {}, []).join(',') === 'budget',
    'required: pendingRequired missed the unresolved budget',
  )
  expect(
    pendingRequired(lowValueBank, {}, ['budget']).length === 0,
    'required: a skipped question still counted as pending',
  )
  expect(
    pendingRequired(lowValueBank, { budgetMax: 20_000 }, []).length === 0,
    'required: a filled slot still counted as pending',
  )

  const forced = runAuction({
    bank: lowValueBank,
    prefs: {},
    asked: [],
    apply,
    evaluate,
    random: pinned(0),
  })
  expect(
    forced?.questionId === 'budget' && forced.propensity === 1,
    'required: a zero-value budget question was not forced',
  )

  const done = runAuction({
    bank: lowValueBank,
    prefs: {},
    asked: ['budget'],
    apply,
    evaluate,
    random: pinned(0),
  })
  expect(done === null, 'required: kept asking zero-value questions with nothing pending')
}

/* ------------------------------------------------------------------ report */

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('question-engine verify: all checks passed')
