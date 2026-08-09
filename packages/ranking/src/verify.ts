/**
 * Exercises the ranker against two realistic searches and asserts the
 * guarantees the UI relies on: a bounded score, contiguous ranks, a rationale
 * that says something checkable, and genuinely different reasoning for rent
 * and buy. Run with `npm run verify -w @car/ranking`.
 * Exits non-zero on failure so it can gate a build.
 */
import { catalog, searchListings } from '@car/catalog'
import { type Preferences, type RankedListing, isRental } from '@car/shared'
import { rankListings, withinBudget } from './rank.js'

const failures: string[] = []
const all = catalog()

/** Wording that would tell the user nothing. If any of this appears, we failed. */
const FILLER = [
  'great choice',
  'perfect for you',
  'excellent option',
  'a great',
  'ideal for you',
  "you'll love",
  'highly recommended',
  'something for everyone',
]

function report(title: string, ranked: RankedListing[]): void {
  console.log(`\n${title}`)
  console.log('='.repeat(title.length))
  for (const r of ranked.slice(0, 5)) {
    const l = r.listing
    const price = isRental(l) ? `EUR ${l.monthlyRate}/mo` : `EUR ${l.price}`
    console.log(`\n#${r.rank}  ${`${l.brand} ${l.model}`.padEnd(26)} score ${String(r.score).padStart(5)}  ${price}`)
    console.log(`    ${r.rationale}`)
    for (const f of r.factors) {
      const delta = `${f.delta > 0 ? '+' : ''}${f.delta}`
      console.log(`      ${delta.padStart(6)}  ${f.label.padEnd(18)} ${f.detail}`)
    }
  }
}

function check(ranked: RankedListing[], label: string, prefs: Preferences): void {
  if (!ranked.length) {
    failures.push(`${label}: nothing ranked`)
    return
  }

  ranked.forEach((r, i) => {
    const who = `${label} #${i + 1} ${r.listing.brand} ${r.listing.model}`
    const prev = i > 0 ? ranked[i - 1] : undefined
    if (!Number.isFinite(r.score) || r.score < 0 || r.score > 100) failures.push(`${who}: score ${r.score} out of 0..100`)
    if (r.rank !== i + 1) failures.push(`${who}: rank ${r.rank} is not ${i + 1}`)
    // Affordability bands before score does, so the descending-score guarantee
    // holds inside a band rather than across the whole list.
    if (prev && withinBudget(prev.listing, prefs) === withinBudget(r.listing, prefs) && prev.score < r.score) {
      failures.push(`${who}: scored above the listing ranked ahead of it`)
    }
    if (prev && !withinBudget(prev.listing, prefs) && withinBudget(r.listing, prefs)) {
      failures.push(`${who}: is inside the budget but ranked below a car that is not`)
    }
    if (!r.rationale.trim()) failures.push(`${who}: empty rationale`)
    if (!/\d/.test(r.rationale)) failures.push(`${who}: rationale cites no figure — "${r.rationale}"`)
    if (!r.factors.length) failures.push(`${who}: no factors`)

    const lower = r.rationale.toLowerCase()
    for (const phrase of FILLER) {
      if (lower.includes(phrase)) failures.push(`${who}: filler "${phrase}" in "${r.rationale}"`)
    }

    // The trace has to add up, or the expandable panel is theatre.
    const sum = r.factors.reduce((s, f) => s + f.delta, 0)
    const expected = Math.min(100, Math.max(0, Math.round((50 + sum) * 10) / 10))
    if (Math.abs(expected - r.score) > 0.05) failures.push(`${who}: factors sum to ${expected}, score says ${r.score}`)
  })
}

// --- Rentals: family SUV, hard monthly ceiling, hard boot floor -------------
const rentPrefs: Preferences = {
  mode: 'rent',
  useCase: 'family weekends away with a dog and two bikes',
  category: 'suv',
  budgetMax: 400,
  bootLitresMin: 450,
  targetDate: '2026-09-04',
  returnDate: '2026-09-11',
}
const rentSearch = searchListings(all, {
  mode: 'rent',
  category: 'suv',
  budgetMax: rentPrefs.budgetMax,
  bootLitresMin: rentPrefs.bootLitresMin,
})
const rentRanked = rankListings(rentSearch.listings, rentPrefs)
console.log(`rent search   ${rentSearch.matched} matched of ${rentSearch.totalScanned} scanned, relaxed: [${rentSearch.relaxed}]`)
report('RENT — SUV, <= EUR 400/mo, boot >= 450 L', rentRanked)
check(rentRanked, 'rent', rentPrefs)

// --- Purchases: sedan, total budget, mileage ceiling ------------------------
const buyPrefs: Preferences = {
  mode: 'buy',
  useCase: 'daily commute, keeping it five years',
  category: 'sedan',
  budgetMax: 25_000,
  maxMileageKm: 80_000,
  targetDate: '2026-10-01',
}
const buySearch = searchListings(all, {
  mode: 'buy',
  category: 'sedan',
  budgetMax: buyPrefs.budgetMax,
  maxMileageKm: buyPrefs.maxMileageKm,
})
const buyRanked = rankListings(buySearch.listings, buyPrefs)
console.log(`\n\nbuy search    ${buySearch.matched} matched of ${buySearch.totalScanned} scanned, relaxed: [${buySearch.relaxed}]`)
report('BUY — sedan, <= EUR 25,000, <= 80,000 km', buyRanked)
check(buyRanked, 'buy', buyPrefs)

// --- A soft budget: over-budget cars are shown, and never above one that fits --
// The interview only makes the budget a dealbreaker when the user says so, so
// the usual shortlist has over-budget cars on it. They have to be ranked down
// rather than promoted by a good boot and a good rating, and the arithmetic
// alone will not do that — the price is one weight among a dozen.
// The ceiling is chosen so a pure score sort really would get this wrong — see
// the load-bearing assertion below. A scenario the banding does not change would
// pass whether or not the code does anything.
const softPrefs: Preferences = { ...rentPrefs, budgetMax: 1600 }
const softPool = searchListings(all, { mode: 'rent', category: 'suv' }).listings
const softRanked = rankListings(softPool, softPrefs)
const over = softRanked.filter((r) => !withinBudget(r.listing, softPrefs))
const under = softRanked.filter((r) => withinBudget(r.listing, softPrefs))
console.log(
  `\n\nsoft budget   ${softPool.length} SUV hires against a EUR 1,600/mo ceiling: ` +
    `${under.length} inside, ${over.length} over`,
)
report('RENT — SUV, soft EUR 1,600/mo ceiling', softRanked)
check(softRanked, 'soft budget', softPrefs)

if (!over.length || !under.length) {
  failures.push('soft budget: the pool has no cars on both sides of the ceiling, so it proves nothing')
} else {
  // Score alone has to be demonstrably insufficient here, or this scenario is
  // asserting a property that holds by accident.
  const byScore = [...softRanked].sort((a, b) => b.score - a.score)
  const firstOver = byScore.findIndex((r) => !withinBudget(r.listing, softPrefs))
  const lastInside = byScore.map((r) => withinBudget(r.listing, softPrefs)).lastIndexOf(true)
  if (lastInside <= firstOver) {
    failures.push('soft budget: sorting on score alone would already have got this right — pick a tighter ceiling')
  }

  // The banding is only defensible if the score argues for it too, so every
  // over-budget car must carry the penalty in its trace.
  const unpenalised = over.filter((r) => !r.factors.some((f) => f.label === 'Monthly rate' && f.delta < 0))
  if (unpenalised.length) {
    failures.push(`soft budget: ${unpenalised.length} over-budget cars show no negative rate factor`)
  }

  console.log(
    `              best over-budget ${over[0].listing.brand} ${over[0].listing.model} scores ` +
      `${over[0].score} at #${over[0].rank}; worst affordable ${under[under.length - 1].score} at ` +
      `#${under[under.length - 1].rank}. On score alone it would have sat at #${firstOver + 1}.`,
  )
}

// --- Rent and buy must be reasoning about different things ------------------
const rentLabels = new Set(rentRanked.flatMap((r) => r.factors.map((f) => f.label)))
const buyLabels = new Set(buyRanked.flatMap((r) => r.factors.map((f) => f.label)))
const rentOnly = [...rentLabels].filter((l) => !buyLabels.has(l))
const buyOnly = [...buyLabels].filter((l) => !rentLabels.has(l))

console.log('\n\nfactor labels')
console.log('=============')
console.log(`  rent only     ${rentOnly.join(', ')}`)
console.log(`  buy only      ${buyOnly.join(', ')}`)
console.log(`  shared        ${[...rentLabels].filter((l) => buyLabels.has(l)).join(', ')}`)

if (!rentOnly.length || !buyOnly.length) {
  failures.push('rent and buy produced the same factor labels — they are meant to be different products')
}

// The rentals must cite the stated ceiling or the stated boot floor; that is
// the whole promise of the rationale.
const vague = rentRanked
  .slice(0, 5)
  .filter((r) => !r.rationale.includes('400') && !r.rationale.includes('450'))
if (vague.length) {
  failures.push(`${vague.length} of the top 5 rentals cite neither the EUR 400 ceiling nor the 450 L floor`)
}

// A preference the user never stated must not turn up as a factor.
const bare = rankListings(rentSearch.listings, { mode: 'rent' })
const invented = new Set(bare.flatMap((r) => r.factors.map((f) => f.label)))
for (const label of ['Category match', 'Boot space', 'Seats', 'Fuel type']) {
  if (invented.has(label)) failures.push(`bare preferences still scored "${label}" — that criterion was never stated`)
}
console.log(`\nbare prefs    factors: ${[...invented].join(', ')}`)
console.log(`              scores spread ${Math.min(...bare.map((r) => r.score))}..${Math.max(...bare.map((r) => r.score))}`)

if (failures.length) {
  console.error('\nFAILED:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nall checks passed')
