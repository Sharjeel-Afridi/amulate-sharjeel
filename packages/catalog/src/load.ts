import type { Category, FuelType, Listing, PurchaseListing, RentalListing, Transmission } from '@car/shared'
import { carArtDataUri } from './art.js'
import cars from './cars.json' with { type: 'json' }
import { generatedOffers } from './generate.js'

/**
 * The marketplace: a real scrape, extended deterministically.
 *
 * `cars.json` holds genuine offers — real models, real day rates, real
 * photographs — enriched by `enrich.ts` with the fields the matchmaker reasons
 * over. `generate.ts` widens that core into a full market, priced by the same
 * formulas and seeded so every run sees the same inventory. Each offer becomes
 * two listings, because the same car can be hired or bought and the two are
 * different products off one asset: a hire is priced per day and capped on
 * mileage, a purchase carries the mileage it has already done.
 *
 * Anchoring on the scrape is what makes the rationales worth reading. "A
 * 2023 BMW 3 Series Touring, 520 L boot" is a claim about a car that exists.
 */

export interface RawOffer {
  offerId: string
  brand: string
  model: string
  category: string
  sixtCategory: string
  brandLabel: string | null
  tier: number
  year: number
  colour: string
  doors: number
  seats: number
  bags: number
  bootLitres: number
  fuel: string
  transmission: string
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

interface CarsFile {
  currency: string
  source?: string
  note?: string
  count: number
  offers: RawOffer[]
}

const file = cars as unknown as CarsFile

/** Scraped first, generated after — a stable order the whole app can rely on. */
const allOffers: RawOffer[] = [...file.offers, ...generatedOffers()]

/** Ids are derived from the real offer id, so a listing traces back to its source. */
const idFor = (mode: 'rent' | 'buy', offerId: string) => `${mode}-${offerId.toLowerCase()}`

function baseOf(o: RawOffer) {
  return {
    brand: o.brand,
    model: o.model,
    category: o.category as Category,
    year: o.year,
    fuel: o.fuel as FuelType,
    transmission: o.transmission as Transmission,
    seats: o.seats,
    doors: o.doors,
    bootLitres: o.bootLitres,
    bags: o.bags,
    consumption: o.consumption,
    co2: o.co2,
    colour: o.colour,
    location: o.location,
    rating: o.rating,
    reviewCount: o.reviewCount,
    // No honest photo (the scrape has no pickups) beats a dishonest one —
    // fall back to the parametric side-profile art rather than borrow a body style.
    imageUrl: o.images.car || carArtDataUri(o.brand, o.category),
  }
}

function toRental(o: RawOffer): RentalListing {
  return {
    ...baseOf(o),
    id: idFor('rent', o.offerId),
    mode: 'rent',
    provider: o.rent.provider,
    dailyRate: o.rent.dailyRate,
    monthlyRate: o.rent.monthlyRate,
    minRentalDays: o.rent.minRentalDays,
    freeKmPerDay: o.rent.freeKmPerDay,
    excess: o.rent.excess,
    instantBook: o.rent.instantBook,
  }
}

function toPurchase(o: RawOffer): PurchaseListing {
  return {
    ...baseOf(o),
    id: idFor('buy', o.offerId),
    mode: 'buy',
    dealer: o.buy.dealer,
    price: o.buy.price,
    mileageKm: o.buy.mileageKm,
    previousOwners: o.buy.previousOwners,
    warrantyMonths: o.buy.warrantyMonths,
    financeMonthly: o.buy.financeMonthly,
  }
}

/** Every listing, both modes, in offer order so the catalogue is stable. */
export function loadCatalog(): Listing[] {
  return allOffers.flatMap((o): Listing[] => [toRental(o), toPurchase(o)])
}

/** Categories the inventory actually contains — nothing else is worth offering. */
export function availableCategories(): Category[] {
  const seen = new Set(allOffers.map((o) => o.category as Category))
  return [...seen].sort()
}

/** Price range per mode, so the budget question can be scaled to real stock. */
export function priceRange(mode: 'rent' | 'buy'): { min: number; max: number } {
  const values = allOffers.map((o) => (mode === 'rent' ? o.rent.monthlyRate : o.buy.price))
  return { min: Math.min(...values), max: Math.max(...values) }
}

export const catalogueSource = {
  currency: file.currency,
  source: file.source ?? 'unknown',
  offers: allOffers.length,
}
