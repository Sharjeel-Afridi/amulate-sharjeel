import { catalog, findListing, searchListings } from '@car/catalog'
import { CATEGORIES, type Booking, type Listing, isRental } from '@car/shared'
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createUIResource } from '@mcp-ui/server'
import { z } from 'zod'
import { bookingFormHtml, extrasFor } from './apps/booking-form.js'
import { checkoutHtml } from './apps/checkout.js'
import { getBooking, newBookingId, saveBooking } from './store.js'

export const BOOKING_FORM_URI = 'ui://car-matchmaker/booking-form.html' as const
export const CHECKOUT_URI = 'ui://car-matchmaker/checkout.html' as const

/**
 * The last HTML rendered for each ui:// resource.
 *
 * SEP-1865 predeclares UI resources so hosts can prefetch and review them. Our
 * widgets are per-listing, so we keep the rendered instance here: a host reading
 * the resource gets exactly the bytes the tool embedded, not an approximation.
 */
const rendered = new Map<string, string>()

function placeholder(title: string): string {
  return `<!doctype html><html><body style="font:14px sans-serif;color:#98a1ab;background:transparent;padding:16px">${title} — no instance rendered yet. Call the tool that opens it.</body></html>`
}

/** Trims a listing to the fields the agent needs to reason and write rationales. */
function summarize(l: Listing) {
  const common = {
    id: l.id,
    brand: l.brand,
    model: l.model,
    category: l.category,
    year: l.year,
    fuel: l.fuel,
    transmission: l.transmission,
    seats: l.seats,
    bootLitres: l.bootLitres,
    consumption: l.consumption,
    co2: l.co2,
    location: l.location,
    rating: l.rating,
  }
  return isRental(l)
    ? {
        ...common,
        mode: 'rent' as const,
        dailyRate: l.dailyRate,
        monthlyRate: l.monthlyRate,
        provider: l.provider,
        freeKmPerDay: l.freeKmPerDay,
        instantBook: l.instantBook,
      }
    : {
        ...common,
        mode: 'buy' as const,
        price: l.price,
        financeMonthly: l.financeMonthly,
        mileageKm: l.mileageKm,
        previousOwners: l.previousOwners,
        warrantyMonths: l.warrantyMonths,
        dealer: l.dealer,
      }
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
}

function error(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true }
}

/** Recomputes a booking total server-side. The iframe's figure is never trusted. */
function computeTotal(listing: Listing, extraIds: string[], startDate?: string, endDate?: string) {
  const rental = isRental(listing)
  let days = 1
  if (rental && startDate && endDate) {
    const d = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
    days = Number.isFinite(d) && d > 0 ? d : 1
  }
  const base = rental ? listing.dailyRate * days : listing.price
  const chosen = extrasFor(listing).filter((e) => extraIds.includes(e.id))
  const extrasTotal = chosen.reduce((s, e) => s + (e.perDay ? e.price * days : e.price), 0)
  return { days, base, extrasTotal, total: base + extrasTotal, chosen }
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'car-marketplace', version: '0.1.0' },
    {
      instructions:
        'Mock car marketplace covering both rentals and purchases. Search listings, ' +
        'inspect them, then open the booking form and checkout — both of which are ' +
        'MCP Apps that render as interactive UI in the host. No real payments occur.',
    },
  )

  // ---------------------------------------------------------------- resources

  registerAppResource(
    server,
    'Booking form',
    BOOKING_FORM_URI,
    {
      description: 'Interactive booking form for a specific listing.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: BOOKING_FORM_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: rendered.get(BOOKING_FORM_URI) ?? placeholder('Booking form'),
        },
      ],
    }),
  )

  registerAppResource(
    server,
    'Checkout',
    CHECKOUT_URI,
    {
      description: 'Mock payment and confirmation screen. No real charge is made.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: CHECKOUT_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: rendered.get(CHECKOUT_URI) ?? placeholder('Checkout'),
        },
      ],
    }),
  )

  // -------------------------------------------------------------- search tools

  server.registerTool(
    'search_listings',
    {
      title: 'Search listings',
      description:
        'Search the marketplace. Budget is the monthly rate for rentals and the total ' +
        'price for purchases. If strict filtering finds too little, constraints are ' +
        'relaxed automatically and reported in `relaxed` — mention that to the user.',
      inputSchema: {
        mode: z.enum(['rent', 'buy']).describe('rent or buy'),
        category: z.enum(CATEGORIES as unknown as [string, ...string[]]).optional(),
        brands: z.array(z.string()).optional(),
        budgetMax: z.number().positive().optional(),
        budgetMin: z.number().positive().optional(),
        seatsMin: z.number().int().optional(),
        bootLitresMin: z.number().int().optional(),
        fuel: z.enum(['petrol', 'diesel', 'hybrid', 'electric']).optional(),
        transmission: z.enum(['manual', 'automatic']).optional(),
        maxMileageKm: z.number().int().optional(),
        minYear: z.number().int().optional(),
        location: z.string().optional(),
        limit: z.number().int().min(1).max(30).default(12),
      },
    },
    async (args) => {
      const result = searchListings(catalog(), args as never)
      return json({
        totalScanned: result.totalScanned,
        matched: result.matched,
        relaxed: result.relaxed,
        listings: result.listings.slice(0, args.limit ?? 12).map(summarize),
      })
    },
  )

  server.registerTool(
    'get_listing',
    {
      title: 'Get listing',
      description: 'Full detail for one listing by id.',
      inputSchema: { listingId: z.string() },
    },
    async ({ listingId }) => {
      const l = findListing(listingId)
      return l ? json(l) : error(`No listing with id ${listingId}`)
    },
  )

  server.registerTool(
    'check_availability',
    {
      title: 'Check availability',
      description: 'Check a rental listing is available for a date window.',
      inputSchema: {
        listingId: z.string(),
        startDate: z.string().describe('ISO date, e.g. 2026-09-12'),
        endDate: z.string().describe('ISO date'),
      },
    },
    async ({ listingId, startDate, endDate }) => {
      const l = findListing(listingId)
      if (!l) return error(`No listing with id ${listingId}`)
      if (!isRental(l)) return error('Availability applies to rentals only')

      const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000)
      if (!Number.isFinite(days) || days <= 0) return error('endDate must be after startDate')

      const meetsMinimum = days >= l.minRentalDays
      return json({
        listingId,
        available: meetsMinimum,
        days,
        minRentalDays: l.minRentalDays,
        reason: meetsMinimum ? null : `Minimum rental is ${l.minRentalDays} days`,
        estimatedTotal: l.dailyRate * days,
      })
    },
  )

  // ------------------------------------------------------------- MCP App tools

  registerAppTool(
    server,
    'start_booking',
    {
      title: 'Open booking form',
      description:
        'Opens the interactive booking form for a listing, rendered in the host as an ' +
        'MCP App. The user fills it in and it calls submit_booking itself — do not ask ' +
        'them for these details in chat.',
      inputSchema: {
        listingId: z.string(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      },
      _meta: { ui: { resourceUri: BOOKING_FORM_URI } },
    },
    async ({ listingId, startDate, endDate }) => {
      const listing = findListing(listingId)
      if (!listing) return error(`No listing with id ${listingId}`)

      const html = bookingFormHtml(listing, { startDate, endDate })
      rendered.set(BOOKING_FORM_URI, html)

      return {
        content: [
          createUIResource({
            uri: BOOKING_FORM_URI,
            content: { type: 'rawHtml', htmlString: html },
            encoding: 'text',
          }),
        ],
      }
    },
  )

  server.registerTool(
    'submit_booking',
    {
      title: 'Submit booking',
      description:
        'Called by the booking form itself when the user submits it. Validates and holds ' +
        'the booking, then returns its id so checkout can be opened.',
      inputSchema: {
        listingId: z.string(),
        fullName: z.string(),
        email: z.string(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        extras: z.array(z.string()).default([]),
        expectedTotal: z.number().optional(),
      },
    },
    async ({ listingId, fullName, email, startDate, endDate, extras, expectedTotal }) => {
      const listing = findListing(listingId)
      if (!listing) return error(`No listing with id ${listingId}`)

      const { total, days, chosen } = computeTotal(listing, extras ?? [], startDate, endDate)
      const booking: Booking = {
        id: newBookingId(),
        listingId,
        fullName,
        email,
        startDate,
        endDate,
        extras: extras ?? [],
        total,
        status: 'submitted',
      }
      saveBooking(booking)

      return json({
        bookingId: booking.id,
        listing: `${listing.brand} ${listing.model}`,
        days,
        extras: chosen.map((e) => e.label),
        total,
        // Surfaced rather than swallowed: a mismatch means the widget and the
        // server disagree, and the server's figure is the one that counts.
        totalMismatch: expectedTotal !== undefined && Math.round(expectedTotal) !== Math.round(total),
        nextStep: 'Call start_checkout with this bookingId.',
      })
    },
  )

  registerAppTool(
    server,
    'start_checkout',
    {
      title: 'Open checkout',
      description:
        'Opens the mock payment screen for a submitted booking, rendered in the host as ' +
        'an MCP App. No real payment is processed. The screen calls confirm_payment itself.',
      inputSchema: { bookingId: z.string() },
      _meta: { ui: { resourceUri: CHECKOUT_URI } },
    },
    async ({ bookingId }) => {
      const booking = getBooking(bookingId)
      if (!booking) return error(`No booking with id ${bookingId}`)
      const listing = findListing(booking.listingId)
      if (!listing) return error(`Booking ${bookingId} references a missing listing`)

      const html = checkoutHtml(booking, listing)
      rendered.set(CHECKOUT_URI, html)

      return {
        content: [
          createUIResource({
            uri: CHECKOUT_URI,
            content: { type: 'rawHtml', htmlString: html },
            encoding: 'text',
          }),
        ],
      }
    },
  )

  server.registerTool(
    'confirm_payment',
    {
      title: 'Confirm payment',
      description:
        'Called by the checkout screen once the simulated payment settles. Marks the ' +
        'booking paid and returns the confirmation. Nothing is actually charged.',
      inputSchema: { bookingId: z.string() },
    },
    async ({ bookingId }) => {
      const booking = getBooking(bookingId)
      if (!booking) return error(`No booking with id ${bookingId}`)
      const listing = findListing(booking.listingId)

      saveBooking({ ...booking, status: 'paid' })
      return json({
        bookingId: booking.id,
        status: 'paid',
        simulated: true,
        listing: listing ? `${listing.brand} ${listing.model}` : booking.listingId,
        total: booking.total,
        confirmation: `${booking.id} confirmed. This is a mock transaction — no money moved.`,
      })
    },
  )

  return server
}
