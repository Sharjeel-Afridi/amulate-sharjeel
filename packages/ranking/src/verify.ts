/**
 * Exercises the ranker against two realistic searches and asserts the
 * guarantees the UI relies on: a bounded score, contiguous ranks, a rationale
 * that says something checkable, and genuinely different reasoning for rent
 * and buy. Run with `npm run verify -w @car/ranking`.
 * Exits non-zero on failure so it can gate a build.
 */
import { catalog, searchListings } from '@car/catalog'
import { type Preferences, type RankedListing, isRental } from '@car/shared'
import { rankListings } from './rank.js'

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

function check(ranked: RankedListing[], label: string): void {
  if (!ranked.length) {
    failures.push(`${label}: nothing ranked`)
    return
  }

  ranked.forEach((r, i) => {
    const who = `${label} #${i + 1} ${r.listing.brand} ${r.listing.model}`
    if (!Number.isFinite(r.score) || r.score < 0 || r.score > 100) failures.push(`${who}: score ${r.score} out of 0..100`)
    if (r.rank !== i + 1) failures.push(`${who}: rank ${r.rank} is not ${i + 1}`)
    if (i > 0 && ranked[i - 1].score < r.score) failures.push(`${who}: scored above the listing ranked ahead of it`)
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
check(rentRanked, 'rent')

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
check(buyRanked, 'buy')

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
