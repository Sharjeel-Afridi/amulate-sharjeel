import type { Booking } from '@car/shared'

/**
 * In-memory booking store. The MCP server runs as one long-lived process, so a
 * Map is enough — there is nothing here worth persisting past a demo session,
 * and no real customer data ever enters it.
 */
const bookings = new Map<string, Booking>()

let counter = 0

export function newBookingId(): string {
  counter += 1
  return `BK-${String(counter).padStart(4, '0')}`
}

export function saveBooking(b: Booking): Booking {
  bookings.set(b.id, b)
  return b
}

export function getBooking(id: string): Booking | undefined {
  return bookings.get(id)
}

export function allBookings(): Booking[] {
  return [...bookings.values()]
}
