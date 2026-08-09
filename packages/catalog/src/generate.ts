import type { Category, FuelType, Transmission } from '@car/shared'
import cars from './cars.json' with { type: 'json' }
import { DEALERS, LOCATIONS } from './models.js'
import { Rng } from './rng.js'

/**
 * The generated half of the marketplace.
 *
 * The scrape gives us 45 real offers across seven body styles, but a
 * marketplace worth searching needs ten categories with ten brands in each.
 * This fills the gap deterministically: a curated plan of real-world models
 * per category, priced and specced by the same formulas `enrich.ts` applies to
 * the scraped fleet, seeded off each offer's identity so every run and every
 * reviewer sees the same inventory.
 *
 * Photographs are never borrowed across body styles — a generated estate only
 * ever wears a scraped estate's photo, and within a category an image of the
 * same brand wins when one exists. Pickups, which the scrape has no honest
 * photo for, fall back to the parametric side-profile art in `art.ts` rather
 * than wearing an SUV's picture.
 */

/** Matches the enriched offer shape `load.ts` consumes. */
export interface GeneratedOffer {
  offerId: string
  brand: string
  model: string
  category: Category
  sixtCategory: string
  brandLabel: string | null
  tier: number
  year: number
  colour: string
  doors: number
  seats: number
  bags: number
  bootLitres: number
  fuel: FuelType
  transmission: Transmission
  consumption: number
  co2: number
  location: string
  rating: number
  reviewCount: number
  images: { car: string; background: string }
  rent: {
    provider: string
    dailyRate: number
    totalFourDay: number
    monthlyRate: number
    minRentalDays: number
    freeKmPerDay: number
    excess: number
    instantBook: boolean
  }
  buy: {
    dealer: string
    price: number
    mileageKm: number
    previousOwners: number
    warrantyMonths: number
    financeMonthly: number
  }
}

/** [brand, model, tier 1–5, seats, bags, flags?] — flags: e=electric, h=hybrid, d=diesel, m=manual */
type PlanEntry = [string, string, number, number, number, string?]

/**
 * Real models, chosen so each category's brand set (union of scraped and
 * generated) clears ten. The scrape already covers the German premiums, so the
 * plan leans on the volume brands the forecourt is otherwise missing.
 */
const PLAN: Record<Category, PlanEntry[]> = {
  hatchback: [
    ['Volkswagen', 'Polo', 1, 5, 2, 'm'],
    ['Toyota', 'Yaris', 1, 5, 2, 'h'],
    ['Honda', 'Civic', 2, 5, 3, 'h'],
    ['Ford', 'Focus', 2, 5, 3],
    ['Renault', 'Clio', 1, 5, 2, 'm'],
    ['Peugeot', '208', 1, 5, 2],
    ['Škoda', 'Fabia', 1, 5, 2, 'm'],
    ['Seat', 'Ibiza', 1, 5, 2, 'm'],
    ['Mini', 'Cooper', 2, 4, 2],
    ['Hyundai', 'i20', 1, 5, 2],
    ['Opel', 'Corsa', 1, 5, 2],
    ['Audi', 'A1 Sportback', 2, 5, 2],
  ],
  sedan: [
    ['Toyota', 'Camry', 3, 5, 4, 'h'],
    ['Honda', 'Accord', 3, 5, 4, 'h'],
    ['Škoda', 'Superb', 3, 5, 4],
    ['Peugeot', '508', 3, 5, 3],
    ['Volvo', 'S60', 3, 5, 3],
    ['Hyundai', 'Ioniq 6', 3, 5, 3, 'e'],
    ['Kia', 'Stinger', 4, 5, 3],
    ['Mazda', '6', 2, 5, 3],
    ['Renault', 'Talisman', 2, 5, 3, 'd'],
    ['Opel', 'Insignia', 2, 5, 3, 'd'],
  ],
  suv: [
    ['Toyota', 'RAV4', 3, 5, 4, 'h'],
    ['Hyundai', 'Tucson', 2, 5, 4, 'h'],
    ['Kia', 'Sportage', 2, 5, 4],
    ['Mercedes-Benz', 'GLC', 4, 5, 4],
    ['Ford', 'Kuga', 2, 5, 4, 'h'],
    ['Mazda', 'CX-5', 2, 5, 4],
    ['Honda', 'CR-V', 3, 5, 4, 'h'],
    ['Nissan', 'X-Trail', 3, 7, 5],
    ['Seat', 'Tarraco', 3, 7, 5],
    ['Renault', 'Austral', 2, 5, 4, 'h'],
  ],
  crossover: [
    ['Toyota', 'C-HR', 2, 5, 3, 'h'],
    ['Nissan', 'Juke', 1, 5, 3],
    ['Renault', 'Captur', 1, 5, 3],
    ['Peugeot', '2008', 2, 5, 3],
    ['Kia', 'Niro', 2, 5, 3, 'e'],
    ['Hyundai', 'Kona', 2, 5, 3, 'e'],
    ['Mazda', 'CX-30', 2, 5, 3],
    ['Honda', 'HR-V', 2, 5, 3, 'h'],
    ['Ford', 'Puma', 1, 5, 3],
    ['Opel', 'Mokka', 1, 5, 3],
    ['Škoda', 'Kamiq', 1, 5, 3],
    ['Volkswagen', 'T-Cross', 1, 5, 3],
  ],
  estate: [
    ['Mercedes-Benz', 'C-Class Estate', 4, 5, 5],
    ['Volvo', 'V60', 3, 5, 5],
    ['Škoda', 'Octavia Combi', 2, 5, 5],
    ['Peugeot', '308 SW', 2, 5, 4],
    ['Toyota', 'Corolla Touring Sports', 2, 5, 4, 'h'],
    ['Ford', 'Focus Estate', 2, 5, 4],
    ['Opel', 'Astra Sports Tourer', 2, 5, 4, 'd'],
    ['Seat', 'Leon Sportstourer', 2, 5, 4],
    ['Kia', 'Ceed SW', 2, 5, 4],
    ['Mazda', '6 Tourer', 2, 5, 4],
  ],
  coupe: [
    ['Mercedes-Benz', 'CLE Coupé', 4, 4, 2],
    ['Audi', 'A5 Coupé', 4, 4, 2],
    ['Toyota', 'GR86', 3, 4, 2, 'm'],
    ['Ford', 'Mustang', 4, 4, 2],
    ['Nissan', 'Z', 4, 2, 2, 'm'],
    ['Lexus', 'RC', 4, 4, 2, 'h'],
    ['Jaguar', 'F-Type', 5, 2, 2],
    ['Chevrolet', 'Camaro', 4, 4, 2],
  ],
  convertible: [
    ['Mercedes-Benz', 'CLE Cabriolet', 4, 4, 2],
    ['Audi', 'A5 Cabriolet', 4, 4, 2],
    ['Mini', 'Convertible', 2, 4, 1],
    ['Mazda', 'MX-5', 3, 2, 1, 'm'],
    ['Fiat', '500C', 1, 4, 1, 'm'],
    ['Ford', 'Mustang Convertible', 4, 4, 2],
    ['Jaguar', 'F-Type Convertible', 5, 2, 1],
    ['Lexus', 'LC Convertible', 5, 4, 1, 'h'],
  ],
  pickup: [
    ['Ford', 'Ranger', 3, 5, 4, 'd'],
    ['Toyota', 'Hilux', 3, 5, 4, 'd'],
    ['Volkswagen', 'Amarok', 3, 5, 4, 'd'],
    ['Nissan', 'Navara', 2, 5, 4, 'd'],
    ['Mitsubishi', 'L200', 2, 5, 4, 'd'],
    ['Isuzu', 'D-Max', 2, 5, 4, 'd'],
    ['SsangYong', 'Musso', 2, 5, 4, 'd'],
    ['Jeep', 'Gladiator', 4, 5, 4],
    ['RAM', '1500', 4, 5, 5],
    ['Mercedes-Benz', 'X-Class', 3, 5, 4, 'd'],
  ],
  mpv: [
    ['Mercedes-Benz', 'V-Class', 5, 7, 6, 'd'],
    ['Ford', 'Tourneo Custom', 3, 9, 6, 'd'],
    ['Renault', 'Espace', 3, 7, 5],
    ['Citroën', 'SpaceTourer', 3, 8, 6, 'd'],
    ['Toyota', 'Proace Verso', 3, 8, 6, 'd'],
    ['Peugeot', 'Traveller', 3, 8, 6, 'd'],
    ['Opel', 'Zafira Life', 3, 8, 6, 'd'],
    ['Kia', 'Carnival', 3, 7, 5],
    ['Hyundai', 'Staria', 3, 9, 6, 'd'],
    ['Volkswagen', 'Multivan', 4, 7, 6],
  ],
  sports: [
    ['Porsche', '718 Cayman', 5, 2, 1],
    ['Alpine', 'A110', 4, 2, 1],
    ['Toyota', 'GR Supra', 4, 2, 1],
    ['Nissan', 'GT-R', 5, 2, 1],
    ['Mercedes-AMG', 'GT', 5, 2, 1],
    ['Audi', 'TT RS', 4, 2, 1],
    ['Lotus', 'Emira', 5, 2, 1, 'm'],
    ['Jaguar', 'F-Type R', 5, 2, 1],
    ['Chevrolet', 'Corvette', 5, 2, 1],
    ['BMW', 'Z4', 4, 2, 1],
  ],
}

// -------------------------------------------------------- image pools

interface ScrapedOffer {
  brand: string
  category: string
  images: { car: string }
}

const scraped = (cars as unknown as { offers: ScrapedOffer[] }).offers

/**
 * Which scraped photos may stand in for a generated car.
 *
 * Keyed by the body style the photo actually shows. Crossovers borrow only the
 * subcompact-SUV photos (a Taigo or a Kona are the same silhouette); sports
 * cars borrow only the 911s. Nothing in the scrape looks like a pickup, so
 * that pool is empty on purpose — `load.ts` falls back to drawn art.
 */
function imagePools(): Record<Category, { url: string; brand: string }[]> {
  const pools: Record<Category, { url: string; brand: string }[]> = {
    hatchback: [], sedan: [], suv: [], crossover: [], estate: [],
    coupe: [], convertible: [], pickup: [], mpv: [], sports: [],
  }
  const isSubcompact = /taigo|t-roc-suv|q2|ex30|frontera|elroq/
  const isSports = /911/

  for (const o of scraped) {
    const cat = o.category as Category
    const file = o.images.car.toLowerCase()
    const entry = { url: o.images.car, brand: o.brand }
    if (pools[cat]) pools[cat].push(entry)
    if (cat === 'suv' && isSubcompact.test(file)) pools.crossover.push(entry)
    if (isSports.test(file)) pools.sports.push(entry)
  }
  return pools
}

// ---------------------------------------------------- shared derivations
// Mirrors enrich.ts, so a generated car is priced by the same physics as a
// scraped one and neither half of the catalogue reads as the odd one out.

const CONSUMPTION_BASE: Record<Category, number> = {
  hatchback: 5.6, sedan: 6.2, suv: 7.2, crossover: 6.6, estate: 6.0,
  coupe: 8.4, convertible: 8.0, pickup: 9.0, mpv: 6.8, sports: 10.0,
}

const BOOT_OFFSET: Record<Category, number> = {
  hatchback: 0, sedan: 60, suv: 60, crossover: 40, estate: 120,
  coupe: -60, convertible: -100, pickup: 300, mpv: 200, sports: -80,
}

const CO2_PER_LITRE: Record<FuelType, number> = {
  petrol: 23.2, diesel: 26.4, hybrid: 21.0, electric: 0,
}

const DEFAULT_DOORS: Record<Category, number> = {
  hatchback: 5, sedan: 4, suv: 5, crossover: 5, estate: 5,
  coupe: 2, convertible: 2, pickup: 4, mpv: 5, sports: 2,
}

/** Day rate by tier, before the body-style factor. Tracks the scraped fleet. */
const TIER_PER_DAY: Record<number, number> = { 1: 34, 2: 48, 3: 68, 4: 105, 5: 170 }

const CATEGORY_PRICE_FACTOR: Record<Category, number> = {
  hatchback: 0.85, sedan: 1, suv: 1.12, crossover: 0.95, estate: 1.02,
  coupe: 1.22, convertible: 1.3, pickup: 1.08, mpv: 1.1, sports: 1.65,
}

const COLOURS = [
  'Midnight Black', 'Pearl White', 'Graphite Grey', 'Silver Metallic',
  'Deep Blue', 'Crimson Red', 'British Racing Green', 'Sand Beige',
] as const

/** Colour words the photo filenames carry, so paint matches the picture. */
const FILENAME_COLOURS: Record<string, string> = {
  black: 'Midnight Black', white: 'Pearl White', grey: 'Graphite Grey',
  silver: 'Silver Metallic', blue: 'Deep Blue', red: 'Crimson Red',
}

const CURRENT_YEAR = 2026
const MONTHLY_MULTIPLE = 21
const VALUE_PER_DAY_RATE = 420

const round = (n: number, to: number) => Math.round(n / to) * to
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

function generate(category: Category, entry: PlanEntry, pool: { url: string; brand: string }[]): GeneratedOffer {
  const [brand, model, tier, seats, bags, flags = ''] = entry
  const offerId = `GEN-${slug(category)}-${slug(brand)}-${slug(model)}`
  const rng = new Rng(offerId)

  // Same brand's photo when the pool has one; any same-body photo otherwise.
  const own = pool.filter((p) => p.brand === brand)
  const image = own.length > 0 ? rng.pick(own) : pool.length > 0 ? rng.pick(pool) : undefined

  const year = rng.pick([2021, 2022, 2022, 2023, 2023, 2024, 2024, 2025, 2025, 2026])
  const age = CURRENT_YEAR - year

  const fuel: FuelType = flags.includes('e')
    ? 'electric'
    : flags.includes('h')
      ? 'hybrid'
      : flags.includes('d')
        ? 'diesel'
        : tier >= 4.5
          ? 'petrol'
          : rng.chance(0.62)
            ? 'petrol'
            : 'diesel'

  const transmission: Transmission = flags.includes('m') ? 'manual' : 'automatic'

  const colourKey = image && Object.keys(FILENAME_COLOURS).find((c) => image.url.toLowerCase().includes(c))
  const colour = colourKey ? FILENAME_COLOURS[colourKey]! : rng.pick(COLOURS)

  const consumption =
    fuel === 'electric'
      ? Math.round((14 + tier * 1.6 + (category === 'suv' ? 2 : 0)) * 10) / 10
      : Math.round(
          CONSUMPTION_BASE[category] *
            (1 + (tier - 1) * 0.09) *
            (fuel === 'diesel' ? 0.85 : fuel === 'hybrid' ? 0.7 : 1) *
            10,
        ) / 10

  const perDay =
    Math.round(TIER_PER_DAY[Math.round(tier)]! * CATEGORY_PRICE_FACTOR[category] * rng.float(0.9, 1.16, 2) * 100) / 100
  const monthlyRate = round(perDay * MONTHLY_MULTIPLE, 10)
  const price = round(perDay * VALUE_PER_DAY_RATE * Math.max(0.45, 1 - 0.06 * age), 100)

  return {
    offerId,
    brand,
    model,
    category,
    sixtCategory: 'Generated',
    brandLabel: null,
    tier,
    year,
    colour,
    doors: DEFAULT_DOORS[category],
    seats,
    bags,
    bootLitres: Math.max(150, bags * 100 + BOOT_OFFSET[category]),
    fuel,
    transmission,
    consumption,
    co2: fuel === 'electric' ? 0 : Math.round(consumption * CO2_PER_LITRE[fuel]),
    location: rng.pick(LOCATIONS),
    rating: Math.min(5, Math.round((rng.float(3.8, 4.8) + (tier >= 4 ? 0.15 : 0)) * 10) / 10),
    reviewCount: rng.int(38, 620),
    images: { car: image?.url ?? '', background: '' },
    rent: {
      provider: 'Sixt',
      dailyRate: perDay,
      totalFourDay: Math.round(perDay * 4 * 100) / 100,
      monthlyRate,
      minRentalDays: rng.int(1, 3),
      freeKmPerDay: rng.chance(tier >= 4 ? 0.45 : 0.2) ? 9999 : rng.pick([150, 200, 250, 300]),
      excess: round(600 + tier * 340 + rng.int(0, 300), 50),
      instantBook: rng.chance(0.3),
    },
    buy: {
      dealer: rng.pick(DEALERS),
      price,
      mileageKm: age === 0 ? rng.int(400, 3500) : round(age * rng.int(9000, 17000) + rng.int(0, 4000), 100),
      previousOwners: age <= 1 ? 0 : age <= 3 ? 1 : age <= 5 ? 2 : rng.int(2, 3),
      warrantyMonths: age <= 1 ? 24 : age <= 3 ? 12 : age <= 6 ? 6 : 3,
      financeMonthly: Math.round((price * 1.12) / 48),
    },
  }
}

let cached: GeneratedOffer[] | undefined

/** Every generated offer, in plan order. Deterministic across runs. */
export function generatedOffers(): GeneratedOffer[] {
  if (cached) return cached
  const pools = imagePools()
  cached = (Object.keys(PLAN) as Category[]).flatMap((category) =>
    PLAN[category].map((entry) => generate(category, entry, pools[category])),
  )
  return cached
}
