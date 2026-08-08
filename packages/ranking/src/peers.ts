import type { FuelType, PurchaseListing, RentalListing } from '@car/shared'
import { type Range, rangeOf } from './util.js'

/**
 * Spreads over the candidate set. Several criteria have no meaningful absolute
 * scale — "€28,400 is cheap" is only true relative to what else came back — so
 * they are scored against the peers the user is actually choosing between.
 */
export interface CommonStats {
  count: number
  bootLitres: Range
  seats: Range
  rating: Range
  co2: Range
  /**
   * Consumption is L/100km for combustion and kWh/100km for electric, so the
   * two are not on the same axis. Comparing an EV's 17.4 against a petrol's
   * 6.2 would rank every EV last on economy, hence one range per fuel.
   */
  consumptionByFuel: Partial<Record<FuelType, Range>>
}

export interface RentalStats extends CommonStats {
  monthlyRate: Range
  dailyRate: Range
  freeKmPerDay: Range
  minRentalDays: Range
  excess: Range
}

export interface PurchaseStats extends CommonStats {
  price: Range
  mileageKm: Range
  year: Range
  previousOwners: Range
  warrantyMonths: Range
  financeMonthly: Range
}

function commonStats(listings: readonly (RentalListing | PurchaseListing)[]): CommonStats {
  const consumptionByFuel: Partial<Record<FuelType, Range>> = {}
  for (const fuel of ['petrol', 'diesel', 'hybrid', 'electric'] as const) {
    const sameFuel = listings.filter((l) => l.fuel === fuel)
    if (sameFuel.length) consumptionByFuel[fuel] = rangeOf(sameFuel, (l) => l.consumption)
  }

  return {
    count: listings.length,
    bootLitres: rangeOf(listings, (l) => l.bootLitres),
    seats: rangeOf(listings, (l) => l.seats),
    rating: rangeOf(listings, (l) => l.rating),
    co2: rangeOf(listings, (l) => l.co2),
    consumptionByFuel,
  }
}

export function rentalStats(listings: readonly RentalListing[]): RentalStats {
  return {
    ...commonStats(listings),
    monthlyRate: rangeOf(listings, (l) => l.monthlyRate),
    dailyRate: rangeOf(listings, (l) => l.dailyRate),
    freeKmPerDay: rangeOf(listings, (l) => l.freeKmPerDay),
    minRentalDays: rangeOf(listings, (l) => l.minRentalDays),
    excess: rangeOf(listings, (l) => l.excess),
  }
}

export function purchaseStats(listings: readonly PurchaseListing[]): PurchaseStats {
  return {
    ...commonStats(listings),
    price: rangeOf(listings, (l) => l.price),
    mileageKm: rangeOf(listings, (l) => l.mileageKm),
    year: rangeOf(listings, (l) => l.year),
    previousOwners: rangeOf(listings, (l) => l.previousOwners),
    warrantyMonths: rangeOf(listings, (l) => l.warrantyMonths),
    financeMonthly: rangeOf(listings, (l) => l.financeMonthly),
  }
}
