/** Whether the user wants to rent a car or buy one. Drives the whole flow. */
export type Mode = 'rent' | 'buy'

/** Body-style categories. Exactly ten, each with ten or more brands. */
export type Category =
  | 'hatchback'
  | 'sedan'
  | 'suv'
  | 'crossover'
  | 'estate'
  | 'coupe'
  | 'convertible'
  | 'pickup'
  | 'mpv'
  | 'sports'

export const CATEGORIES: readonly Category[] = [
  'hatchback',
  'sedan',
  'suv',
  'crossover',
  'estate',
  'coupe',
  'convertible',
  'pickup',
  'mpv',
  'sports',
]

export const CATEGORY_LABELS: Record<Category, string> = {
  hatchback: 'Hatchback',
  sedan: 'Sedan',
  suv: 'SUV',
  crossover: 'Crossover',
  estate: 'Estate',
  coupe: 'Coupé',
  convertible: 'Convertible',
  pickup: 'Pickup',
  mpv: 'MPV',
  sports: 'Sports',
}

export type FuelType = 'petrol' | 'diesel' | 'hybrid' | 'electric'
export type Transmission = 'manual' | 'automatic'

/** Attributes every listing carries, regardless of mode. */
interface ListingBase {
  id: string
  brand: string
  model: string
  category: Category
  year: number
  fuel: FuelType
  transmission: Transmission
  seats: number
  doors: number
  /** Boot capacity in litres — the single most-asked-about practical number. */
  bootLitres: number
  /**
   * Suitcases the marketplace says it takes. Kept alongside litres because it is
   * the figure the source actually publishes, and it is how people describe
   * their own luggage — "three bags", not "380 litres".
   */
  bags: number
  /**
   * Photograph of the car, cut out on transparency.
   *
   * The scrape also carried a `background` url, but every offer pointed at the
   * same one and it 404s, so it is left in `cars.json` as scraped and not
   * surfaced here — a field that is always broken is worse than no field.
   */
  imageUrl: string
  /** L/100km for combustion, kWh/100km for electric. */
  consumption: number
  /** g/km. Zero for electric. */
  co2: number
  colour: string
  location: string
  rating: number
  reviewCount: number
}

/** A car offered for rental. Priced per day and per month. */
export interface RentalListing extends ListingBase {
  mode: 'rent'
  provider: string
  dailyRate: number
  monthlyRate: number
  minRentalDays: number
  freeKmPerDay: number
  /** Insurance excess in euros. */
  excess: number
  instantBook: boolean
}

/** A car offered for sale by a dealer. */
export interface PurchaseListing extends ListingBase {
  mode: 'buy'
  dealer: string
  price: number
  mileageKm: number
  previousOwners: number
  warrantyMonths: number
  /** Indicative monthly finance payment over 48 months. */
  financeMonthly: number
}

export type Listing = RentalListing | PurchaseListing

export const isRental = (l: Listing): l is RentalListing => l.mode === 'rent'
export const isPurchase = (l: Listing): l is PurchaseListing => l.mode === 'buy'

/**
 * A listing plus the agent's assessment of it. The rationale is what separates
 * this from a listings page — it must reference the specific car, not be filler.
 */
export interface RankedListing {
  listing: Listing
  /** 0–100. */
  score: number
  rank: number
  /** One line, specific to this listing and this user's stated needs. */
  rationale: string
  /** Where the score came from, for the expandable reasoning trace. */
  factors: ScoreFactor[]
}

export interface ScoreFactor {
  label: string
  /** Signed contribution to the score. */
  delta: number
  detail: string
}
