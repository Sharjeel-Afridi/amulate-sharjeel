import {
  CATEGORIES,
  type Category,
  type FuelType,
  type Listing,
  type Mode,
  type PurchaseListing,
  type RentalListing,
  type Transmission,
} from '@car/shared'
import { COLOURS, DEALERS, LOCATIONS, MODELS, RENTAL_PROVIDERS } from './models.js'
import { Rng } from './rng.js'

/** The year the catalogue is generated against. Fixed so data stays stable. */
const CURRENT_YEAR = 2026

interface CategorySpec {
  /** Weighted options rather than a range — an SUV is a 5-seater far more often than a 6. */
  seats: number[]
  doors: number
  boot: [number, number]
  /** Petrol baseline, L/100km. Other fuels are derived from this. */
  consumption: [number, number]
  /** Purchase price in euros for a mid-tier brand at current model year. */
  price: [number, number]
  fuels: FuelType[]
}

/**
 * Rental pricing is derived from the vehicle's value, not invented separately —
 * a daily hire and a monthly subscription are different products off the same
 * asset. Roughly 0.22% of value per day, 1.1% per month.
 */
const DAILY_RATE_OF_VALUE = 0.0022
const MONTHLY_RATE_OF_VALUE = 0.011

const SPECS: Record<Category, CategorySpec> = {
  hatchback: { seats: [5], doors: 5, boot: [270, 380], consumption: [4.8, 6.4], price: [11000, 26000], fuels: ['petrol', 'diesel', 'hybrid', 'electric'] },
  sedan: { seats: [5], doors: 4, boot: [420, 530], consumption: [5.2, 7.2], price: [17000, 44000], fuels: ['petrol', 'diesel', 'hybrid', 'electric'] },
  suv: { seats: [5, 5, 5, 7], doors: 5, boot: [450, 650], consumption: [6.2, 8.6], price: [26000, 62000], fuels: ['petrol', 'diesel', 'hybrid', 'electric'] },
  crossover: { seats: [5], doors: 5, boot: [380, 520], consumption: [5.4, 7.2], price: [19000, 37000], fuels: ['petrol', 'diesel', 'hybrid', 'electric'] },
  estate: { seats: [5], doors: 5, boot: [540, 700], consumption: [5.2, 7.0], price: [21000, 47000], fuels: ['petrol', 'diesel', 'hybrid', 'electric'] },
  coupe: { seats: [4], doors: 2, boot: [290, 420], consumption: [7.0, 10.0], price: [34000, 74000], fuels: ['petrol', 'hybrid', 'electric'] },
  convertible: { seats: [2, 4], doors: 2, boot: [200, 330], consumption: [6.6, 9.4], price: [29000, 84000], fuels: ['petrol', 'hybrid'] },
  pickup: { seats: [5], doors: 4, boot: [1000, 1250], consumption: [7.6, 10.2], price: [29000, 54000], fuels: ['diesel', 'petrol'] },
  mpv: { seats: [7, 7, 5], doors: 5, boot: [600, 850], consumption: [5.6, 7.6], price: [24000, 49000], fuels: ['diesel', 'petrol', 'hybrid', 'electric'] },
  sports: { seats: [2, 2, 4], doors: 2, boot: [130, 280], consumption: [8.4, 12.0], price: [54000, 138000], fuels: ['petrol', 'hybrid', 'electric'] },
}

const PREMIUM_BRANDS = new Set([
  'BMW', 'Mercedes-Benz', 'Audi', 'Porsche', 'Jaguar', 'Land Rover',
  'Lexus', 'Volvo', 'Lotus', 'Alfa Romeo', 'Ram',
])

const VALUE_BRANDS = new Set([
  'Dacia', 'Fiat', 'SsangYong', 'Isuzu', 'Škoda', 'Kia',
  'Hyundai', 'Seat', 'Citroën', 'Opel', 'Suzuki',
])

function brandFactor(brand: string): number {
  if (PREMIUM_BRANDS.has(brand)) return 1.28
  if (VALUE_BRANDS.has(brand)) return 0.84
  return 1
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Consumption and CO2 both depend on fuel, so they're derived together. */
function drivetrain(rng: Rng, spec: CategorySpec, fuel: FuelType) {
  const base = rng.float(spec.consumption[0], spec.consumption[1])
  switch (fuel) {
    case 'electric':
      return { consumption: rng.float(14, 22), co2: 0 }
    case 'hybrid':
      return { consumption: Math.round(base * 0.68 * 10) / 10, co2: Math.round(base * 0.68 * 23.2) }
    case 'diesel':
      return { consumption: Math.round(base * 0.86 * 10) / 10, co2: Math.round(base * 0.86 * 26.5) }
    default:
      return { consumption: base, co2: Math.round(base * 23.2) }
  }
}

function common(rng: Rng, brand: string, model: string, category: Category, year: number) {
  const spec = SPECS[category]
  const fuel = rng.pick(spec.fuels)
  const { consumption, co2 } = drivetrain(rng, spec, fuel)
  const transmission: Transmission =
    fuel === 'electric' ? 'automatic' : rng.chance(0.62) ? 'automatic' : 'manual'

  return {
    brand,
    model,
    category,
    year,
    fuel,
    transmission,
    seats: rng.pick(spec.seats),
    doors: spec.doors,
    bootLitres: rng.step(spec.boot[0], spec.boot[1], 5),
    consumption,
    co2,
    colour: rng.pick(COLOURS),
    location: rng.pick(LOCATIONS),
    rating: rng.float(3.6, 4.9, 1),
    reviewCount: rng.int(12, 480),
  }
}

function makeRental(seed: string, brand: string, model: string, category: Category): RentalListing {
  const rng = new Rng(seed)
  const spec = SPECS[category]
  const year = rng.int(CURRENT_YEAR - 2, CURRENT_YEAR)
  const base = common(rng, brand, model, category, year)

  // Fleet cars are near-new, so their value is close to sticker.
  const evUplift = base.fuel === 'electric' ? 1.12 : 1
  const value = rng.float(spec.price[0], spec.price[1]) * brandFactor(brand) * evUplift
  const daily = Math.round(value * DAILY_RATE_OF_VALUE)
  const monthly = Math.round((value * MONTHLY_RATE_OF_VALUE) / 5) * 5

  return {
    ...base,
    id: seed,
    mode: 'rent',
    provider: rng.pick(RENTAL_PROVIDERS),
    dailyRate: daily,
    monthlyRate: monthly,
    minRentalDays: rng.int(1, 3),
    freeKmPerDay: rng.pick([100, 150, 200, 250, 9999]),
    excess: rng.step(300, 1500, 100),
    instantBook: rng.chance(0.6),
  }
}

function makePurchase(seed: string, brand: string, model: string, category: Category): PurchaseListing {
  const rng = new Rng(seed)
  const spec = SPECS[category]
  const year = rng.int(CURRENT_YEAR - 8, CURRENT_YEAR - 1)
  const base = common(rng, brand, model, category, year)
  const age = CURRENT_YEAR - year

  const evUplift = base.fuel === 'electric' ? 1.15 : 1
  const sticker = rng.float(spec.price[0], spec.price[1]) * brandFactor(brand) * evUplift
  const price = Math.round((sticker * 0.93 ** age) / 100) * 100

  return {
    ...base,
    id: seed,
    mode: 'buy',
    dealer: rng.pick(DEALERS),
    price,
    mileageKm: age * rng.int(9000, 21000) + rng.int(0, 5000),
    previousOwners: Math.min(3, Math.max(1, Math.round(age / 3) + (rng.chance(0.3) ? 1 : 0))),
    warrantyMonths: rng.pick([0, 6, 12, 24]),
    financeMonthly: Math.round((price * 1.12) / 48),
  }
}

/**
 * Builds the full catalogue: 10 categories × 10 brands × 2 modes × 2 variants
 * = 400 listings. Comfortably clears the brief's floor of 100 listings /
 * 10 categories / 10 brands per category — in both rent and buy.
 */
export function generateCatalog(): Listing[] {
  const listings: Listing[] = []
  const modes: Mode[] = ['rent', 'buy']

  for (const category of CATEGORIES) {
    const brands = MODELS[category]
    for (const [brand, model] of Object.entries(brands)) {
      for (const mode of modes) {
        for (let variant = 0; variant < 2; variant++) {
          const seed = `${mode}-${category}-${slug(brand)}-${variant}`
          listings.push(
            mode === 'rent'
              ? makeRental(seed, brand, model, category)
              : makePurchase(seed, brand, model, category),
          )
        }
      }
    }
  }

  return listings
}
