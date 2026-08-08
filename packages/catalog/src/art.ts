import type { Category } from '@car/shared'
import { hashString } from './rng.js'

/**
 * Car art is generated, not photographed: ten parametric side profiles, tinted
 * by a hue hashed from the brand name. Same brand always gets the same colour.
 * No network, no licensing, and it never renders as a broken image.
 */

type Style = 'standard' | 'fastback' | 'pickup' | 'convertible'

interface Profile {
  noseX: number
  tailX: number
  bodyTop: number
  roofTop: number
  cabinStart: number
  cabinEnd: number
  wsSlant: number
  rearSlant: number
  frontWheelX: number
  rearWheelX: number
  wheelR: number
  style: Style
}

const BODY_BOTTOM = 66
const WHEEL_Y = 70

const PROFILES: Record<Category, Profile> = {
  // Short, steep tail — that near-vertical hatch is what makes it read as a hatchback
  // rather than a small sedan.
  hatchback: {
    noseX: 24, tailX: 168, bodyTop: 50, roofTop: 28, cabinStart: 66, cabinEnd: 158,
    wsSlant: 16, rearSlant: 6, frontWheelX: 58, rearWheelX: 144, wheelR: 13, style: 'standard',
  },
  sedan: {
    noseX: 14, tailX: 186, bodyTop: 50, roofTop: 30, cabinStart: 70, cabinEnd: 136,
    wsSlant: 16, rearSlant: 16, frontWheelX: 52, rearWheelX: 150, wheelR: 13, style: 'standard',
  },
  suv: {
    noseX: 16, tailX: 184, bodyTop: 44, roofTop: 20, cabinStart: 62, cabinEnd: 158,
    wsSlant: 14, rearSlant: 8, frontWheelX: 52, rearWheelX: 150, wheelR: 16, style: 'standard',
  },
  crossover: {
    noseX: 20, tailX: 180, bodyTop: 47, roofTop: 25, cabinStart: 64, cabinEnd: 152,
    wsSlant: 15, rearSlant: 10, frontWheelX: 55, rearWheelX: 148, wheelR: 14, style: 'standard',
  },
  estate: {
    noseX: 14, tailX: 188, bodyTop: 49, roofTop: 28, cabinStart: 68, cabinEnd: 172,
    wsSlant: 16, rearSlant: 4, frontWheelX: 52, rearWheelX: 152, wheelR: 13, style: 'standard',
  },
  coupe: {
    noseX: 14, tailX: 184, bodyTop: 52, roofTop: 32, cabinStart: 72, cabinEnd: 140,
    wsSlant: 20, rearSlant: 26, frontWheelX: 54, rearWheelX: 150, wheelR: 14, style: 'fastback',
  },
  convertible: {
    noseX: 16, tailX: 180, bodyTop: 50, roofTop: 36, cabinStart: 72, cabinEnd: 150,
    wsSlant: 12, rearSlant: 0, frontWheelX: 54, rearWheelX: 148, wheelR: 13, style: 'convertible',
  },
  pickup: {
    noseX: 14, tailX: 190, bodyTop: 44, roofTop: 22, cabinStart: 52, cabinEnd: 112,
    wsSlant: 14, rearSlant: 8, frontWheelX: 46, rearWheelX: 156, wheelR: 16, style: 'pickup',
  },
  mpv: {
    noseX: 18, tailX: 186, bodyTop: 44, roofTop: 16, cabinStart: 48, cabinEnd: 172,
    wsSlant: 20, rearSlant: 4, frontWheelX: 52, rearWheelX: 154, wheelR: 14, style: 'standard',
  },
  sports: {
    noseX: 10, tailX: 188, bodyTop: 52, roofTop: 31, cabinStart: 74, cabinEnd: 140,
    wsSlant: 20, rearSlant: 30, frontWheelX: 52, rearWheelX: 152, wheelR: 15, style: 'fastback',
  },
}

function bodyPath(p: Profile): string {
  const { noseX, tailX, bodyTop, roofTop, cabinStart, cabinEnd, wsSlant, rearSlant } = p

  if (p.style === 'pickup') {
    const bedTop = bodyTop + 4
    return [
      `M ${noseX} ${BODY_BOTTOM}`,
      `L ${noseX} ${bodyTop + 8}`,
      `L ${cabinStart} ${bodyTop}`,
      `L ${cabinStart + wsSlant} ${roofTop}`,
      `L ${cabinEnd - rearSlant} ${roofTop}`,
      `L ${cabinEnd} ${bodyTop}`,
      `L ${cabinEnd + 6} ${bedTop}`,
      `L ${tailX - 8} ${bedTop}`,
      `L ${tailX - 8} ${bodyTop - 2}`,
      `L ${tailX} ${bodyTop - 2}`,
      `L ${tailX} ${BODY_BOTTOM}`,
      'Z',
    ].join(' ')
  }

  if (p.style === 'convertible') {
    return [
      `M ${noseX} ${BODY_BOTTOM}`,
      `L ${noseX} ${bodyTop + 6}`,
      `L ${cabinStart} ${bodyTop}`,
      `L ${cabinStart + wsSlant} ${roofTop}`,
      `L ${cabinStart + wsSlant + 4} ${roofTop}`,
      `L ${cabinStart + wsSlant + 6} ${bodyTop - 1}`,
      `L ${cabinEnd} ${bodyTop - 1}`,
      `L ${tailX} ${bodyTop + 4}`,
      `L ${tailX} ${BODY_BOTTOM}`,
      'Z',
    ].join(' ')
  }

  return [
    `M ${noseX} ${BODY_BOTTOM}`,
    `L ${noseX} ${bodyTop + 6}`,
    `L ${cabinStart} ${bodyTop}`,
    `L ${cabinStart + wsSlant} ${roofTop}`,
    `L ${cabinEnd - rearSlant} ${roofTop}`,
    `L ${cabinEnd} ${bodyTop}`,
    `L ${tailX} ${bodyTop + (p.style === 'fastback' ? 8 : 4)}`,
    `L ${tailX} ${BODY_BOTTOM}`,
    'Z',
  ].join(' ')
}

function glassPath(p: Profile): string {
  const { bodyTop, roofTop, cabinStart, cabinEnd, wsSlant, rearSlant } = p
  if (p.style === 'convertible') {
    return [
      `M ${cabinStart + 4} ${bodyTop - 2}`,
      `L ${cabinStart + wsSlant} ${roofTop + 2}`,
      `L ${cabinStart + wsSlant + 3} ${roofTop + 2}`,
      `L ${cabinStart + wsSlant + 3} ${bodyTop - 2}`,
      'Z',
    ].join(' ')
  }
  const glassTop = roofTop + 4
  const glassBottom = bodyTop - 3
  return [
    `M ${cabinStart + 5} ${glassBottom}`,
    `L ${cabinStart + wsSlant + 2} ${glassTop}`,
    `L ${cabinEnd - rearSlant - 2} ${glassTop}`,
    `L ${cabinEnd - 5} ${glassBottom}`,
    'Z',
  ].join(' ')
}

function wheel(cx: number, r: number): string {
  return [
    `<circle cx="${cx}" cy="${WHEEL_Y}" r="${r}" fill="#15171b"/>`,
    `<circle cx="${cx}" cy="${WHEEL_Y}" r="${r * 0.55}" fill="#2f343c"/>`,
    `<circle cx="${cx}" cy="${WHEEL_Y}" r="${r * 0.18}" fill="#4a515b"/>`,
  ].join('')
}

/** Stable hue in degrees for a brand name. */
export function brandHue(brand: string): number {
  return hashString(brand) % 360
}

/**
 * Returns a standalone SVG string for a listing's art.
 * Deterministic: same brand + category always produces the same image.
 */
export function carArt(brand: string, category: Category): string {
  const p = PROFILES[category]
  const h = brandHue(brand)
  const body = `hsl(${h} 48% 47%)`
  const bodyDark = `hsl(${h} 44% 33%)`
  const glass = `hsl(${h} 22% 82%)`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 92" width="200" height="92" role="img" aria-label="${brand} ${category}">`,
    `<ellipse cx="100" cy="86" rx="82" ry="5" fill="#000" opacity="0.22"/>`,
    `<path d="${bodyPath(p)}" fill="${body}"/>`,
    `<rect x="${p.noseX}" y="${BODY_BOTTOM - 6}" width="${p.tailX - p.noseX}" height="6" fill="${bodyDark}" opacity="0.4"/>`,
    `<path d="${glassPath(p)}" fill="${glass}" opacity="0.55"/>`,
    wheel(p.frontWheelX, p.wheelR),
    wheel(p.rearWheelX, p.wheelR),
    '</svg>',
  ].join('')
}

/** Same art as a data URI, for use in `<img src>` and A2UI `Image` components. */
export function carArtDataUri(brand: string, category: Category): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(carArt(brand, category))}`
}
