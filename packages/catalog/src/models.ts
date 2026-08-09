/**
 * The few things the scrape does not carry.
 *
 * The fleet itself is real and lives in `cars.json`; these are the two details
 * an offer listing has no reason to publish — which branch you collect from, and
 * which forecourt would sell you the same car. `enrich.ts` assigns them per
 * offer, seeded, so they stay put between runs.
 *
 * German cities because that is where this fleet is: the inventory is Volkswagen,
 * BMW, Opel, Škoda and Porsche, quoted to an international customer in dollars.
 */

export const DEALERS = [
  'Autohaus Mitte',
  'Northgate Motors',
  'Rheinland Automobile',
  'City Car Centre',
  'Bavaria Select',
  'Hanseatic Motors',
  'Continental Autos',
  'Westfield Cars',
] as const

export const LOCATIONS = [
  'Munich',
  'Berlin',
  'Hamburg',
  'Frankfurt',
  'Cologne',
  'Stuttgart',
  'Düsseldorf',
  'Leipzig',
] as const
