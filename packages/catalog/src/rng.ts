/** FNV-1a. Turns any string into a stable 32-bit seed. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/**
 * Small deterministic PRNG. Every listing is generated from a seed derived from
 * its own identity, so the catalogue is byte-identical on every run and every
 * reviewer sees the same data.
 */
export class Rng {
  private a: number

  constructor(seed: number | string) {
    this.a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0
  }

  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  float(min: number, max: number, decimals = 1): number {
    const v = this.next() * (max - min) + min
    const f = 10 ** decimals
    return Math.round(v * f) / f
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array')
    return items[Math.floor(this.next() * items.length)]!
  }

  /** True with the given probability. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Rounds to the nearest step — keeps prices looking priced, not random. */
  step(min: number, max: number, step: number): number {
    const raw = this.next() * (max - min) + min
    return Math.round(raw / step) * step
  }
}
