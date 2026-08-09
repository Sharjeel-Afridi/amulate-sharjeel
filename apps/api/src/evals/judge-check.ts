import type { Listing, RankedListing } from '@car/shared'
import { loadEnv } from '../env.js'

loadEnv()

const { groundednessScores, readJudgeConfig } = await import('./judges.js')

/**
 * Checks the judge, not the product.
 *
 * Two model calls against a fixed car: one rationale that only states facts from
 * its record, and one that invents equipment and a boot size. A judge worth
 * trusting passes the first and fails the second.
 *
 * This exists because the first version of the judge failed BOTH. Its record
 * rendered the monthly rate as `1500` while the rationale under test said
 * "$1,500 a month", and it reported the correct sentence as containing an
 * invented figure. A groundedness check that fails correct rationales is worse
 * than no check at all — it teaches you to ignore the suite — and nothing in the
 * eval run itself would have caught it, because every case would simply have
 * looked bad.
 *
 *   npm run eval:judge -w @car/api
 */

const CAR: Listing = {
  id: 'rent-suv-toyota-0',
  mode: 'rent',
  brand: 'Toyota',
  model: 'RAV4',
  category: 'suv',
  year: 2022,
  fuel: 'hybrid',
  transmission: 'automatic',
  seats: 5,
  doors: 5,
  bootLitres: 460,
  consumption: 5.1,
  co2: 118,
  location: 'Dublin',
  rating: 4.6,
  reviewCount: 214,
  monthlyRate: 1500,
  dailyRate: 62,
  freeKmPerDay: 250,
  minRentalDays: 3,
  excess: 900,
  instantBook: true,
  provider: 'Hertz',
} as Listing

const ranked = (rationale: string): RankedListing =>
  ({ listing: CAR, score: 88, rank: 1, rationale, factors: [] }) as RankedListing

const CHECKS = [
  {
    label: 'grounded rationale, with currency formatting the record does not use',
    rationale:
      '460 L boot, 10 L over your 450 L minimum. $1,500 a month, well inside the $3,000 you set.',
    expectSupported: true,
  },
  {
    label: 'invented equipment and a boot size the record contradicts',
    rationale:
      'Comes with a panoramic sunroof and heated leather seats, and its 780 L boot is the biggest here.',
    expectSupported: false,
  },
]

const cfg = readJudgeConfig()
if (!cfg) {
  console.error('no judge configured — set EVAL_JUDGE_API_KEY (or AGENT_API_KEY)')
  process.exit(1)
}
console.log(`judge · ${cfg.provider} / ${cfg.model}\n`)

const failures: string[] = []

for (const check of CHECKS) {
  const [score] = await groundednessScores([ranked(check.rationale)], cfg, 1)
  const supported = score?.value === 1
  const ok = supported === check.expectSupported
  console.log(
    `  [${ok ? '  ok' : 'FAIL'}] ${check.label}\n` +
      `         expected supported=${check.expectSupported}, got ${supported}` +
      (score?.comment ? `  — ${score.comment}` : ''),
  )
  if (!ok) failures.push(check.label)
}

if (failures.length) {
  console.error(`\nthe judge is unreliable (${failures.length}/${CHECKS.length} wrong) — do not trust an eval run`)
  process.exit(1)
}
console.log('\njudge check passed')
