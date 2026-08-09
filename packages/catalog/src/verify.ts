/**
 * Checks the loaded catalogue is coherent before anything reasons over it.
 *
 * The thresholds are the hackathon's floor: at least 100 listings, ten body
 * styles, ten brands in each — the scrape plus the generated extension must
 * clear all three or the market is thinner than promised. Volume alone is not
 * enough, though: every listing must also be complete, because a missing boot
 * figure or a NaN price is invisible until a rationale quotes it at someone.
 *
 * Run with `npm run verify -w @car/catalog`. Exits non-zero so it can gate a build.
 */
import { type Listing, isPurchase, isRental, money } from '@car/shared'
import { availableCategories, catalogueSource, loadCatalog, priceRange } from './load.js'
import { searchListings } from './query.js'

const all = loadCatalog()
const failures: string[] = []

const brandsByCategory = new Map<string, Set<string>>()
for (const l of all) {
  if (!brandsByCategory.has(l.category)) brandsByCategory.set(l.category, new Set())
  brandsByCategory.get(l.category)!.add(l.brand)
}

console.log(`source            ${catalogueSource.source} (${catalogueSource.currency})`)
console.log(`offers            ${catalogueSource.offers}`)
console.log(`listings          ${all.length}`)
console.log(`  rent            ${all.filter(isRental).length}`)
console.log(`  buy             ${all.filter(isPurchase).length}`)
console.log(`categories        ${brandsByCategory.size}`)
console.log(`brands            ${new Set(all.map((l) => l.brand)).size}`)
console.log(`unique ids        ${new Set(all.map((l) => l.id)).size}`)
console.log('')

for (const c of availableCategories()) {
  const brands = brandsByCategory.get(c)
  console.log(`  ${c.padEnd(12)} ${String(brands?.size ?? 0).padStart(2)} brands`)
}

if (all.length !== catalogueSource.offers * 2) {
  failures.push(`expected two listings per offer, got ${all.length} from ${catalogueSource.offers}`)
}
if (all.filter(isRental).length !== all.filter(isPurchase).length) {
  failures.push('rent and buy counts differ — every car should be available both ways')
}
if (new Set(all.map((l) => l.id)).size !== all.length) failures.push('duplicate listing ids')
if (all.length < 100) failures.push(`only ${all.length} listings — the floor is 100`)
if (brandsByCategory.size < 10) failures.push(`only ${brandsByCategory.size} categories — the floor is 10`)
for (const [category, brands] of brandsByCategory) {
  if (brands.size < 10) failures.push(`${category}: only ${brands.size} brands — the floor is 10`)
}

/**
 * Completeness, field by field.
 *
 * NaN survives JSON as null and an absent string renders as "undefined" in the
 * middle of a sentence, so this asserts values rather than shapes.
 */
const positive = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0
const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0

for (const l of all) {
  const problems: string[] = []
  if (!nonEmpty(l.brand) || !nonEmpty(l.model)) problems.push('brand/model')
  if (!positive(l.year) || l.year < 2000 || l.year > 2030) problems.push(`year=${l.year}`)
  if (!positive(l.seats) || !positive(l.doors)) problems.push('seats/doors')
  if (!positive(l.bootLitres) || !positive(l.bags)) problems.push('boot/bags')
  if (!positive(l.co2) && l.fuel !== 'electric') problems.push('co2')
  if (!positive(l.consumption)) problems.push('consumption')
  if (!positive(l.rating) || l.rating > 5) problems.push(`rating=${l.rating}`)
  if (!nonEmpty(l.location) || !nonEmpty(l.colour)) problems.push('location/colour')
  const imageOk =
    nonEmpty(l.imageUrl) && (l.imageUrl.startsWith('https://') || l.imageUrl.startsWith('data:image/svg'))
  if (!imageOk) problems.push('imageUrl')
  if (isRental(l) && (!positive(l.dailyRate) || !positive(l.monthlyRate) || !positive(l.excess))) {
    problems.push('rental pricing')
  }
  if (isPurchase(l) && (!positive(l.price) || !positive(l.financeMonthly))) {
    problems.push('purchase pricing')
  }
  if (problems.length) failures.push(`${l.id}: ${problems.join(', ')}`)
}

const rentRange = priceRange('rent')
const buyRange = priceRange('buy')
console.log(`\nrent              ${money(rentRange.min)}–${money(rentRange.max)} per month`)
console.log(`buy               ${money(buyRange.min)}–${money(buyRange.max)}`)

const describe = (l: Listing) =>
  `${l.year} ${l.brand} ${l.model} · ${l.category} · ${l.fuel} · ${l.bootLitres} L · ` +
  (isRental(l) ? `${money(l.monthlyRate)}/mo` : `${money(l.price)}, ${l.mileageKm.toLocaleString('en-US')} km`)

console.log('\nsample rent:', describe(all.find(isRental)!))
console.log('sample buy: ', describe(all.find(isPurchase)!))

const suv = searchListings(all, { mode: 'rent', category: 'suv', budgetMax: 2500, bootLitresMin: 450 })
console.log(`\nsearch  suv rent <=${money(2500)}/mo boot>=450  ->  ${suv.matched} matched, relaxed: [${suv.relaxed}]`)
for (const l of suv.listings.slice(0, 5)) console.log(`  ${describe(l)}`)
if (suv.matched === 0) failures.push('a reasonable SUV search returned nothing')

const tight = searchListings(all, { mode: 'buy', category: 'coupe', budgetMax: 5000, minYear: 2026 })
console.log(`\nsearch  coupe buy <=${money(5000)}, 2026+   ->  ${tight.matched} matched, relaxed: [${tight.relaxed}]`)
if (tight.matched === 0) failures.push('relaxation failed to rescue an over-tight search')

if (failures.length) {
  console.error('\nFAILED:')
  for (const f of failures.slice(0, 20)) console.error(`  - ${f}`)
  if (failures.length > 20) console.error(`  … and ${failures.length - 20} more`)
  process.exit(1)
}
console.log('\nall checks passed')
