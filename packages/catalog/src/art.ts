import type { Category } from '@car/shared'
import { hashString } from './rng.js'

/**
 * Car art: parametric side-profile illustrations, generated per brand and body
 * style.
 *
 * Deliberately 2D. The cards paint this at roughly 130 x 90 px — no 3D detail is
 * perceptible at that size, and a WebGL context per card would cost hundreds of
 * kilobytes to render something nobody can see. What actually reads at this
 * scale is silhouette, colour and a handful of well-placed detail marks, so
 * that is what this spends its effort on.
 *
 * An earlier version drew straight line segments in one flat fill, which is why
 * the cars looked like doorstops. Everything here is curved, lit, and detailed:
 * bezier bodywork, a vertical body gradient, glass with its own sheen, wheel
 * arches, multi-spoke alloys, lights, mirror, door line and a soft contact
 * shadow.
 */

const W = 260
const H = 120
/** Where the wheels sit. Everything else is measured against this. */
const GROUND = 96

type Style = 'standard' | 'fastback' | 'pickup' | 'convertible' | 'boxy'

interface Profile {
  noseX: number
  tailX: number
  /** Top of the roof. */
  roofY: number
  /** Beltline — where glass meets bodywork. */
  beltY: number
  /** Bottom of the body, above the ground line. */
  sillY: number
  /** Bonnet height at the front. */
  bonnetY: number
  /** Where the windscreen meets the bonnet, and where it meets the roof. */
  wsBase: number
  wsTop: number
  /** Where the rear glass leaves the roof, and meets the body. */
  blTop: number
  blBase: number
  frontWheelX: number
  rearWheelX: number
  wheelR: number
  style: Style
}

const PROFILES: Record<Category, Profile> = {
  hatchback: {
    noseX: 26, tailX: 232, roofY: 34, beltY: 60, sillY: 84, bonnetY: 62,
    wsBase: 84, wsTop: 108, blTop: 186, blBase: 208, frontWheelX: 74, rearWheelX: 196, wheelR: 20, style: 'standard',
  },
  sedan: {
    noseX: 18, tailX: 244, roofY: 36, beltY: 60, sillY: 84, bonnetY: 62,
    wsBase: 88, wsTop: 114, blTop: 168, blBase: 196, frontWheelX: 70, rearWheelX: 198, wheelR: 20, style: 'standard',
  },
  suv: {
    noseX: 20, tailX: 242, roofY: 24, beltY: 56, sillY: 80, bonnetY: 54,
    wsBase: 80, wsTop: 104, blTop: 198, blBase: 220, frontWheelX: 70, rearWheelX: 196, wheelR: 25, style: 'boxy',
  },
  crossover: {
    noseX: 24, tailX: 238, roofY: 30, beltY: 58, sillY: 82, bonnetY: 58,
    wsBase: 82, wsTop: 106, blTop: 190, blBase: 214, frontWheelX: 72, rearWheelX: 196, wheelR: 22, style: 'standard',
  },
  estate: {
    noseX: 18, tailX: 248, roofY: 34, beltY: 60, sillY: 84, bonnetY: 62,
    wsBase: 88, wsTop: 112, blTop: 222, blBase: 238, frontWheelX: 70, rearWheelX: 202, wheelR: 20, style: 'standard',
  },
  coupe: {
    noseX: 16, tailX: 242, roofY: 40, beltY: 64, sillY: 86, bonnetY: 66,
    wsBase: 92, wsTop: 124, blTop: 158, blBase: 214, frontWheelX: 70, rearWheelX: 198, wheelR: 22, style: 'fastback',
  },
  convertible: {
    noseX: 18, tailX: 240, roofY: 58, beltY: 62, sillY: 86, bonnetY: 66,
    wsBase: 96, wsTop: 116, blTop: 120, blBase: 132, frontWheelX: 70, rearWheelX: 196, wheelR: 21, style: 'convertible',
  },
  pickup: {
    noseX: 16, tailX: 250, roofY: 28, beltY: 56, sillY: 82, bonnetY: 56,
    wsBase: 70, wsTop: 92, blTop: 138, blBase: 152, frontWheelX: 62, rearWheelX: 206, wheelR: 25, style: 'pickup',
  },
  mpv: {
    noseX: 22, tailX: 244, roofY: 20, beltY: 54, sillY: 82, bonnetY: 54,
    wsBase: 62, wsTop: 92, blTop: 216, blBase: 234, frontWheelX: 68, rearWheelX: 200, wheelR: 22, style: 'boxy',
  },
  sports: {
    noseX: 12, tailX: 246, roofY: 46, beltY: 68, sillY: 88, bonnetY: 74,
    wsBase: 96, wsTop: 126, blTop: 154, blBase: 212, frontWheelX: 68, rearWheelX: 200, wheelR: 22, style: 'fastback',
  },
}

/**
 * A curated automotive palette.
 *
 * Hashing a brand straight onto a 360-degree hue wheel put several brands on
 * muddy olive and sickly yellow-green. These are all colours a car is actually
 * sold in, so every brand lands on something plausible.
 */
const PAINT: { name: string; light: string; mid: string; dark: string }[] = [
  { name: 'midnight', light: '#3d5a8a', mid: '#27406b', dark: '#16284a' },
  { name: 'crimson', light: '#c0453f', mid: '#942c28', dark: '#5f1a17' },
  { name: 'silver', light: '#d3d8dd', mid: '#aeb5bd', dark: '#7d858e' },
  { name: 'graphite', light: '#5b6169', mid: '#41464d', dark: '#2a2e34' },
  { name: 'racing green', light: '#2f6b4f', mid: '#1d4c37', dark: '#102e21' },
  { name: 'pearl', light: '#f2f3f5', mid: '#d9dce0', dark: '#a8adb4' },
  { name: 'copper', light: '#c97a3c', mid: '#a35c25', dark: '#6b3a15' },
  { name: 'navy', light: '#334a75', mid: '#22335a', dark: '#131f39' },
  { name: 'slate', light: '#7d8b99', mid: '#5d6b79', dark: '#3b4753' },
  { name: 'sand', light: '#c9b48b', mid: '#a8916a', dark: '#6f5e43' },
  { name: 'ink', light: '#33383f', mid: '#212429', dark: '#121417' },
  { name: 'teal', light: '#2f6d75', mid: '#1c4f56', dark: '#0f3036' },
]

export function brandPaint(brand: string) {
  return PAINT[hashString(brand) % PAINT.length]!
}

/** Backwards-compatible: some callers still colour UI chrome by brand. */
export function brandHue(brand: string): number {
  return hashString(brand) % 360
}

/**
 * The bodywork, as one closed bezier path.
 *
 * Cars are curves. Every join here is a quadratic so the roofline, bonnet and
 * tail read as sheet metal rather than as a polygon.
 */
function bodyPath(p: Profile): string {
  const { noseX, tailX, roofY, beltY, sillY, bonnetY, wsBase, wsTop, blTop, blBase } = p

  if (p.style === 'pickup') {
    const bedFloor = beltY + 4
    return [
      `M ${noseX} ${sillY}`,
      `L ${noseX} ${bonnetY + 8}`,
      `Q ${noseX + 4} ${bonnetY} ${noseX + 22} ${bonnetY - 2}`,
      `L ${wsBase} ${bonnetY - 4}`,
      `Q ${wsBase + 8} ${bonnetY - 6} ${wsTop} ${roofY}`,
      `L ${blTop} ${roofY}`,
      `Q ${blTop + 8} ${roofY + 2} ${blBase} ${beltY - 2}`,
      `L ${blBase + 8} ${bedFloor}`,
      `L ${tailX - 10} ${bedFloor}`,
      `L ${tailX - 10} ${beltY - 6}`,
      `L ${tailX} ${beltY - 6}`,
      `Q ${tailX + 2} ${beltY + 8} ${tailX - 2} ${sillY}`,
      'Z',
    ].join(' ')
  }

  if (p.style === 'convertible') {
    return [
      `M ${noseX} ${sillY}`,
      `Q ${noseX - 2} ${bonnetY + 6} ${noseX + 10} ${bonnetY + 2}`,
      `Q ${noseX + 30} ${bonnetY - 6} ${wsBase} ${beltY + 2}`,
      `Q ${wsBase + 10} ${beltY - 2} ${wsTop} ${roofY}`,
      `L ${wsTop + 6} ${roofY}`,
      `L ${wsTop + 8} ${beltY}`,
      `L ${blBase + 40} ${beltY - 1}`,
      `Q ${tailX - 14} ${beltY} ${tailX} ${beltY + 8}`,
      `Q ${tailX + 2} ${beltY + 18} ${tailX - 4} ${sillY}`,
      'Z',
    ].join(' ')
  }

  const tailCurve =
    p.style === 'fastback'
      ? `Q ${blBase + 14} ${beltY + 8} ${tailX} ${beltY + 14}`
      : `L ${blBase + 6} ${beltY - 2} L ${tailX - 4} ${beltY + 2}`

  return [
    `M ${noseX} ${sillY}`,
    // Nose and bonnet
    `Q ${noseX - 3} ${bonnetY + 8} ${noseX + 9} ${bonnetY + 2}`,
    `Q ${noseX + 26} ${bonnetY - 5} ${wsBase} ${beltY + 1}`,
    // Windscreen
    `Q ${wsBase + 10} ${beltY - 6} ${wsTop} ${roofY + 2}`,
    // Roofline — a shallow crown, not a flat lid
    `Q ${(wsTop + blTop) / 2} ${roofY - 2} ${blTop} ${roofY + 2}`,
    // Rear glass down to the tail
    `Q ${blTop + 10} ${roofY + 8} ${blBase} ${beltY - 4}`,
    tailCurve,
    // Tail down to the sill
    `Q ${tailX + 3} ${beltY + 14} ${tailX - 5} ${sillY}`,
    'Z',
  ].join(' ')
}

/** Glass, inset from the roofline so a pillar reads between the panes. */
function glassPath(p: Profile, part: 'front' | 'rear'): string {
  const { roofY, beltY, wsBase, wsTop, blTop, blBase } = p
  const inset = 4
  const mid = (wsTop + blTop) / 2

  if (p.style === 'convertible') {
    return part === 'front'
      ? `M ${wsBase + 6} ${beltY - 2} Q ${wsBase + 14} ${beltY - 6} ${wsTop + 2} ${roofY + inset} L ${wsTop + 5} ${roofY + inset} L ${wsTop + 5} ${beltY - 2} Z`
      : ''
  }

  return part === 'front'
    ? [
        `M ${wsBase + 8} ${beltY - 3}`,
        `Q ${wsBase + 16} ${beltY - 9} ${wsTop + 4} ${roofY + inset + 2}`,
        `L ${mid - 4} ${roofY + inset}`,
        `L ${mid - 4} ${beltY - 3}`,
        'Z',
      ].join(' ')
    : [
        `M ${mid + 4} ${roofY + inset}`,
        `L ${blTop - 2} ${roofY + inset + 1}`,
        `Q ${blTop + 8} ${roofY + 12} ${blBase - 6} ${beltY - 6}`,
        `L ${mid + 4} ${beltY - 3}`,
        'Z',
      ].join(' ')
}

/** Tyre, rim, spokes and hub. The spokes are what sell it at small sizes. */
function wheel(cx: number, r: number, id: string): string {
  const rim = r * 0.62
  const spokes = Array.from({ length: 5 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2
    const x1 = cx + Math.cos(a) * (r * 0.2)
    const y1 = GROUND + Math.sin(a) * (r * 0.2)
    const x2 = cx + Math.cos(a) * (rim * 0.86)
    const y2 = GROUND + Math.sin(a) * (rim * 0.86)
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#8d949c" stroke-width="${(r * 0.11).toFixed(1)}" stroke-linecap="round"/>`
  }).join('')

  return [
    `<circle cx="${cx}" cy="${GROUND}" r="${r}" fill="#15171b"/>`,
    `<circle cx="${cx}" cy="${GROUND}" r="${r * 0.86}" fill="url(#tyre-${id})"/>`,
    `<circle cx="${cx}" cy="${GROUND}" r="${rim}" fill="#c3c9d0"/>`,
    `<circle cx="${cx}" cy="${GROUND}" r="${rim * 0.9}" fill="#9aa2ab"/>`,
    spokes,
    `<circle cx="${cx}" cy="${GROUND}" r="${r * 0.17}" fill="#5e666f"/>`,
  ].join('')
}

/** A darker crescent above each wheel, so the arch reads as a cutout. */
function arch(cx: number, r: number, dark: string): string {
  const outer = r + 5
  return `<path d="M ${cx - outer} ${GROUND} A ${outer} ${outer} 0 0 1 ${cx + outer} ${GROUND} L ${cx + r} ${GROUND} A ${r} ${r} 0 0 0 ${cx - r} ${GROUND} Z" fill="${dark}" opacity="0.55"/>`
}

export function carArt(brand: string, category: string): string {
  const p = PROFILES[category as Category] ?? PROFILES.sedan
  const paint = brandPaint(brand)
  // Gradient ids must be unique when several of these sit inline on one page.
  const id = (hashString(`${brand}:${category}`) % 100000).toString(36)

  const beltHighlight = `M ${p.noseX + 12} ${p.beltY + 6} Q ${W / 2} ${p.beltY + 1} ${p.tailX - 12} ${p.beltY + 5}`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${brand} ${category}">`,
    '<defs>',
    // Vertical body gradient: light off the top surfaces, dark into the sills.
    `<linearGradient id="body-${id}" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${paint.light}"/>`,
    `<stop offset="0.52" stop-color="${paint.mid}"/>`,
    `<stop offset="1" stop-color="${paint.dark}"/>`,
    '</linearGradient>',
    `<linearGradient id="glass-${id}" x1="0" y1="0" x2="0.4" y2="1">`,
    '<stop offset="0" stop-color="#e8f1f8" stop-opacity="0.92"/>',
    '<stop offset="1" stop-color="#93a7b8" stop-opacity="0.72"/>',
    '</linearGradient>',
    `<radialGradient id="tyre-${id}" cx="0.5" cy="0.5" r="0.5">`,
    '<stop offset="0.6" stop-color="#24272c"/>',
    '<stop offset="1" stop-color="#131519"/>',
    '</radialGradient>',
    // A soft contact shadow rather than a hard ellipse.
    `<radialGradient id="shadow-${id}" cx="0.5" cy="0.5" r="0.5">`,
    '<stop offset="0" stop-color="#000" stop-opacity="0.45"/>',
    '<stop offset="1" stop-color="#000" stop-opacity="0"/>',
    '</radialGradient>',
    '</defs>',

    `<ellipse cx="${W / 2}" cy="${GROUND + 17}" rx="${(p.tailX - p.noseX) / 2 + 6}" ry="9" fill="url(#shadow-${id})"/>`,

    `<path d="${bodyPath(p)}" fill="url(#body-${id})"/>`,

    arch(p.frontWheelX, p.wheelR, paint.dark),
    arch(p.rearWheelX, p.wheelR, paint.dark),

    `<path d="${glassPath(p, 'front')}" fill="url(#glass-${id})"/>`,
    p.style === 'convertible' ? '' : `<path d="${glassPath(p, 'rear')}" fill="url(#glass-${id})"/>`,

    // Beltline highlight — the single mark that most makes it read as painted metal.
    `<path d="${beltHighlight}" stroke="${paint.light}" stroke-width="1.6" fill="none" opacity="0.5" stroke-linecap="round"/>`,

    // Door shut line
    `<path d="M ${(p.wsTop + p.blTop) / 2} ${p.beltY - 2} L ${(p.wsTop + p.blTop) / 2 - 2} ${p.sillY - 4}" stroke="${paint.dark}" stroke-width="1.1" opacity="0.5"/>`,

    // Door handle
    `<rect x="${(p.wsTop + p.blTop) / 2 + 8}" y="${p.beltY + 6}" width="11" height="2.6" rx="1.3" fill="${paint.light}" opacity="0.75"/>`,

    // Wing mirror
    `<path d="M ${p.wsBase + 4} ${p.beltY - 1} l -8 -2 l 0 5 z" fill="${paint.dark}"/>`,

    // Lights
    `<rect x="${p.noseX - 1}" y="${p.bonnetY + 6}" width="10" height="5" rx="2.4" fill="#fdf6d8" opacity="0.95"/>`,
    `<rect x="${p.tailX - 11}" y="${p.beltY + 8}" width="9" height="5" rx="2.2" fill="#e2564e" opacity="0.95"/>`,

    wheel(p.frontWheelX, p.wheelR, id),
    wheel(p.rearWheelX, p.wheelR, id),
    '</svg>',
  ]
    .filter(Boolean)
    .join('')
}

/** Same art as a data URI, for `<img src>` and A2UI `Image` components. */
export function carArtDataUri(brand: string, category: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(carArt(brand, category))}`
}
