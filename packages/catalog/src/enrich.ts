/**
 * Enriches `cars.json` in place.
 *
 * The scrape gives us real cars — real models, real day rates, real photographs
 * — but only a handful of the fields the matchmaker reasons over. This fills the
 * rest in, and the order it tries things in matters:
 *
 *   1. Real, as scraped:      model, seats, bags, per-day price, images, and
 *                             transmission and fuel where they were populated.
 *   2. Real, but buried:      year, colour, door count and body style are all
 *                             encoded in the image filename
 *                             (`bmw-3-stw-black-2023.png`), and the size tier is
 *                             in the Sixt category string. Parsed, not invented.
 *   3. Derived from those:    boot litres from the real bag count and body,
 *                             consumption and CO2 from body/size/fuel, purchase
 *                             price and mileage from the real day rate and the
 *                             real year.
 *   4. Genuinely invented:    rating, review count, pickup location, insurance
 *                             excess, free kilometres, minimum hire, previous
 *                             owners, warranty and dealer. Nothing in the source
 *                             implies these.
 *
 * Everything in 3 and 4 is seeded off the offer id, so this is idempotent: run
 * it twice and the file is byte-identical, and every reviewer sees the same
 * marketplace.
 *
 * Run with: npm run enrich -w @car/catalog
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Category, FuelType, Transmission } from '@car/shared'
import { DEALERS, LOCATIONS } from './models.js'
import { Rng } from './rng.js'

/**
 * The scrape, untouched, so this stays re-runnable and the original is always
 * recoverable. Edit `cars.source.json` to change the fleet, then re-run.
 */
const SOURCE_JSON = new URL('./cars.source.json', import.meta.url)

/** The enriched catalogue the app actually loads. */
const CARS_JSON = new URL('./cars.json', import.meta.url)

/** The year the catalogue is dated against, so ages stay stable. */
const CURRENT_YEAR = 2026

/** A month's hire, as a multiple of the day rate. Long lets run roughly 30% off. */
const MONTHLY_MULTIPLE = 21

/** Day rate as a fraction of resale value, inverted to price the same car to buy. */
const VALUE_PER_DAY_RATE = 420

// --------------------------------------------------------------- source shape

interface SourceOffer {
  offerId: string
  model: string
  category: string
  brandLabel: string | null
  hotOffer: boolean
  seats: number
  bags: number
  transmission: string | null
  fuel: string | null
  range: string | null
  price: { perDay: number; total: number }
  images: { car: string; background: string }
}

interface CarsFile {
  currency: string
  count: number
  offers: SourceOffer[]
}

// ------------------------------------------------------------------- parsing

/** Longest-prefix match, so "Mercedes-Benz" wins over a bare first token. */
const BRANDS: Record<string, string> = {
  'Mercedes-Benz': 'Mercedes-Benz',
  Porsche: 'Porsche',
  Nissan: 'Nissan',
  Cupra: 'Cupra',
  Skoda: 'Škoda',
  Volvo: 'Volvo',
  Audi: 'Audi',
  Opel: 'Opel',
  BMW: 'BMW',
  VW: 'Volkswagen',
}

function splitModel(model: string): { brand: string; name: string } {
  for (const [prefix, brand] of Object.entries(BRANDS)) {
    if (model === prefix) return { brand, name: model }
    if (model.startsWith(`${prefix} `)) return { brand, name: model.slice(prefix.length + 1) }
  }
  const [first = model, ...rest] = model.split(' ')
  return { brand: first, name: rest.join(' ') || first }
}

/** Body style. The filename is more specific than the Sixt category, so it wins. */
function bodyOf(filename: string, sixtCategory: string): Category {
  const f = filename.toLowerCase()
  if (/\bstw\b/.test(f)) return 'estate'
  if (f.includes('convertible') || f.includes('cabrio')) return 'convertible'
  if (f.includes('grancoupe') || f.includes('coupe')) return 'coupe'
  if (f.includes('suv')) return 'suv'
  if (f.includes('van')) return 'mpv'
  if (f.includes('hatch')) return 'hatchback'
  if (f.includes('sedan')) return 'sedan'

  const c = sixtCategory.toLowerCase()
  if (c.includes('wagon')) return 'estate'
  if (c.includes('convertible')) return 'convertible'
  if (c.includes('coupe')) return 'coupe'
  if (c.includes('suv')) return 'suv'
  if (c.includes('van')) return 'mpv'
  return 'sedan'
}

const DEFAULT_DOORS: Record<Category, number> = {
  hatchback: 5,
  sedan: 4,
  suv: 5,
  crossover: 5,
  estate: 5,
  coupe: 2,
  convertible: 2,
  pickup: 4,
  mpv: 5,
  sports: 2,
}

const COLOUR_NAMES: Record<string, string> = {
  black: 'Midnight Black',
  white: 'Pearl White',
  grey: 'Graphite Grey',
  gray: 'Graphite Grey',
  silver: 'Silver Metallic',
  blue: 'Deep Blue',
  red: 'Crimson Red',
  green: 'British Racing Green',
  beige: 'Sand Beige',
}

/**
 * Sixt grades a car by size and trim before body style: "Fullsize Elite Wagon".
 * Collapsed to 1-5, which is what actually drives price, excess and rating.
 */
function tierOf(sixtCategory: string): number {
  const c = sixtCategory.toLowerCase()
  const base = c.includes('extraordinary')
    ? 5
    : c.includes('luxury')
      ? 5
      : c.includes('premium')
        ? 4
        : c.includes('fullsize')
          ? 3
          : c.includes('midsize') || c.includes('standard')
            ? 2
            : 1
  return Math.min(5, base + (c.includes('elite') ? 0.5 : 0))
}

// ---------------------------------------------------------------- derivation

const CONSUMPTION_BASE: Record<Category, number> = {
  hatchback: 5.6,
  sedan: 6.2,
  suv: 7.2,
  crossover: 6.6,
  estate: 6.0,
  coupe: 8.4,
  convertible: 8.0,
  pickup: 9.0,
  mpv: 6.8,
  sports: 10.0,
}

/** Litres of boot per suitcase the listing claims to take, plus a body allowance. */
const BOOT_OFFSET: Record<Category, number> = {
  hatchback: 0,
  sedan: 60,
  suv: 60,
  crossover: 40,
  estate: 120,
  coupe: -60,
  convertible: -100,
  pickup: 300,
  mpv: 200,
  sports: -80,
}

/** kg of CO2 per litre burnt, as g/km once multiplied by L/100km. */
const CO2_PER_LITRE: Record<FuelType, number> = {
  petrol: 23.2,
  diesel: 26.4,
  hybrid: 21.0,
  electric: 0,
}

function deriveFuel(stated: string | null, filename: string, body: Category, tier: number, rng: Rng): FuelType {
  if (stated?.toLowerCase() === 'electric') return 'electric'
  if (filename.includes('hybrid')) return 'hybrid'
  // Vans are overwhelmingly diesel; the performance tiers are overwhelmingly not.
  if (body === 'mpv') return 'diesel'
  if (tier >= 4.5) return 'petrol'
  return rng.chance(0.58) ? 'petrol' : 'diesel'
}

function deriveTransmission(stated: string | null, sixtCategory: string): Transmission {
  const s = (stated ?? '').toLowerCase()
  if (s === 'manual') return 'manual'
  if (s === 'automatic') return 'automatic'
  return sixtCategory.toLowerCase().includes('manual') ? 'manual' : 'automatic'
}

const round = (n: number, to: number) => Math.round(n / to) * to

/** The photo's filename, lowercased — where the year, colour and body live. */
const filenameOf = (url: string): string => url.split('/').pop()?.toLowerCase() ?? ''

// -------------------------------------------------------------------- enrich

function enrich(source: SourceOffer) {
  const rng = new Rng(source.offerId)
  const filename = filenameOf(source.images.car)
  const { brand, name } = splitModel(source.model)

  const body = bodyOf(filename, source.category)
  const tier = tierOf(source.category)
  const year = Number(/(20\d{2})/.exec(filename)?.[1] ?? CURRENT_YEAR - 2)
  const age = Math.max(0, CURRENT_YEAR - year)
  const doorMatch = /-(\d)d-/.exec(filename)
  const doors = doorMatch ? Number(doorMatch[1]) : DEFAULT_DOORS[body]
  const colourKey = Object.keys(COLOUR_NAMES).find((c) => filename.includes(c))
  const colour = colourKey ? COLOUR_NAMES[colourKey]! : 'Graphite Grey'

  const transmission = deriveTransmission(source.transmission, source.category)
  const fuel = deriveFuel(source.fuel, filename, body, tier, rng)

  const consumption =
    fuel === 'electric'
      ? Math.round((14 + tier * 1.6 + (body === 'suv' ? 2 : 0)) * 10) / 10
      : Math.round(
          CONSUMPTION_BASE[body] *
            (1 + (tier - 1) * 0.09) *
            (fuel === 'diesel' ? 0.85 : fuel === 'hybrid' ? 0.7 : 1) *
            10,
        ) / 10

  const co2 = fuel === 'electric' ? 0 : Math.round(consumption * CO2_PER_LITRE[fuel])
  const bootLitres = Math.max(150, source.bags * 100 + BOOT_OFFSET[body])

  const perDay = source.price.perDay
  const monthlyRate = round(perDay * MONTHLY_MULTIPLE, 10)

  // The same car, priced to own. Resale tracks the day rate because both track
  // the vehicle's value, then the real model year does the depreciating.
  const price = round(perDay * VALUE_PER_DAY_RATE * Math.max(0.45, 1 - 0.06 * age), 100)
  const mileageKm = age === 0 ? rng.int(400, 3500) : round(age * rng.int(9000, 17000) + rng.int(0, 4000), 100)

  return {
    offerId: source.offerId,
    brand,
    model: name,
    category: body,
    sixtCategory: source.category,
    brandLabel: source.brandLabel,
    tier,
    year,
    colour,
    doors,
    seats: source.seats,
    bags: source.bags,
    bootLitres,
    fuel,
    transmission,
    consumption,
    co2,
    location: rng.pick(LOCATIONS),
    rating: Math.min(5, Math.round((rng.float(3.8, 4.8) + (tier >= 4 ? 0.15 : 0)) * 10) / 10),
    reviewCount: rng.int(38, 620),
    images: source.images,
    rent: {
      provider: 'Sixt',
      dailyRate: perDay,
      totalFourDay: source.price.total,
      monthlyRate,
      minRentalDays: rng.int(1, 3),
      // 9999 is the catalogue's sentinel for unlimited, which the "no mileage
      // cap" dealbreaker checks against.
      freeKmPerDay: rng.chance(tier >= 4 ? 0.45 : 0.2) ? 9999 : rng.pick([150, 200, 250, 300]),
      excess: round(600 + tier * 340 + rng.int(0, 300), 50),
      instantBook: source.hotOffer,
    },
    buy: {
      dealer: rng.pick(DEALERS),
      price,
      mileageKm,
      previousOwners: age <= 1 ? 0 : age <= 3 ? 1 : age <= 5 ? 2 : rng.int(2, 3),
      warrantyMonths: age <= 1 ? 24 : age <= 3 ? 12 : age <= 6 ? 6 : 3,
      financeMonthly: Math.round((price * 1.12) / 48),
    },
  }
}

const file = JSON.parse(readFileSync(SOURCE_JSON, 'utf8')) as CarsFile
const offers = file.offers.map(enrich)

const output = {
  currency: file.currency,
  source: 'sixt.com',
  note:
    'model, seats, bags, transmission/fuel where present, per-day price and images are as scraped. ' +
    'year, colour, doors and body style are parsed from the image filename. ' +
    'Everything else is derived deterministically from the offer id — see enrich.ts.',
  count: offers.length,
  offers,
}

writeFileSync(CARS_JSON, `${JSON.stringify(output, null, 2)}\n`)

console.log(`enriched ${offers.length} offers`)
const byCategory = offers.reduce<Record<string, number>>((acc, o) => {
  acc[o.category] = (acc[o.category] ?? 0) + 1
  return acc
}, {})
console.log('categories:', byCategory)
console.log(
  'fuel:',
  offers.reduce<Record<string, number>>((acc, o) => {
    acc[o.fuel] = (acc[o.fuel] ?? 0) + 1
    return acc
  }, {}),
)
console.log(
  `rent  ${Math.min(...offers.map((o) => o.rent.monthlyRate))}–${Math.max(...offers.map((o) => o.rent.monthlyRate))}/month`,
)
console.log(
  `buy   ${Math.min(...offers.map((o) => o.buy.price))}–${Math.max(...offers.map((o) => o.buy.price))}`,
)
