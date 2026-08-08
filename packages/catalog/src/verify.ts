/**
 * Verifies the catalogue meets the brief's floor: >=100 listings, 10 categories,
 * >=10 brands per category. Run with `npm run verify -w @car/catalog`.
 * Exits non-zero on failure so it can gate a build.
 */
import { CATEGORIES, isPurchase, isRental } from '@car/shared'
import { carArt } from './art.js'
import { generateCatalog } from './generate.js'
import { searchListings } from './query.js'

const all = generateCatalog()
const failures: string[] = []

const brandsByCategory = new Map<string, Set<string>>()
for (const l of all) {
  if (!brandsByCategory.has(l.category)) brandsByCategory.set(l.category, new Set())
  brandsByCategory.get(l.category)!.add(l.brand)
}

console.log(`listings          ${all.length}`)
console.log(`  rent            ${all.filter(isRental).length}`)
console.log(`  buy             ${all.filter(isPurchase).length}`)
console.log(`categories        ${brandsByCategory.size}`)
console.log(`unique ids        ${new Set(all.map((l) => l.id)).size}`)
console.log('')

for (const c of CATEGORIES) {
  const n = brandsByCategory.get(c)?.size ?? 0
  console.log(`  ${c.padEnd(12)} ${String(n).padStart(2)} brands`)
  if (n < 10) failures.push(`${c} has only ${n} brands (need 10)`)
}

if (all.length < 100) failures.push(`only ${all.length} listings (need 100)`)
if (brandsByCategory.size < 10) failures.push(`only ${brandsByCategory.size} categories (need 10)`)
if (new Set(all.map((l) => l.id)).size !== all.length) failures.push('duplicate listing ids')

const rentSuv = all.find((l) => isRental(l) && l.category === 'suv')
const buySuv = all.find((l) => isPurchase(l) && l.category === 'suv')
console.log('\nsample rent:', rentSuv && JSON.stringify(rentSuv))
console.log('\nsample buy: ', buySuv && JSON.stringify(buySuv))

const r = searchListings(all, { mode: 'rent', category: 'suv', budgetMax: 400, bootLitresMin: 450 })
console.log(`\nsearch  suv rent <=400/mo boot>=450  ->  ${r.matched} matched, relaxed: [${r.relaxed}]`)
for (const l of r.listings.slice(0, 5)) {
  const price = isRental(l) ? `EUR ${l.monthlyRate}/mo` : `EUR ${(l as { price: number }).price}`
  console.log(`  ${`${l.brand} ${l.model}`.padEnd(28)} ${price.padEnd(14)} boot ${l.bootLitres}L  ${l.fuel}`)
}

const tight = searchListings(all, { mode: 'buy', category: 'sports', budgetMax: 20000, minYear: 2025 })
console.log(`\nsearch  sports buy <=20k, 2025+     ->  ${tight.matched} matched, relaxed: [${tight.relaxed}]`)
if (tight.matched === 0) failures.push('relaxation failed to rescue an over-tight search')

const art = carArt('Volvo', 'suv')
console.log(`\ncar art           ${art.length} bytes`)
if (!art.startsWith('<svg')) failures.push('car art is not an svg')

if (failures.length) {
  console.error('\nFAILED:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nall checks passed')
