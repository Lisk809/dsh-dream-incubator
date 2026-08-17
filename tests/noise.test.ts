/**
 * Activation-Synthesis noise draw tests: count bounds per intensity, distinct
 * draws, determinism under a seeded rng, and high-intensity boldness bias.
 */

import { describe, expect, it } from 'vitest'
import { drawNoise, NOISE_DRAW_SIZES, NOISE_LIBRARY } from '../src/engine/noise.ts'

/** A deterministic pseudo-random source for reproducible draws. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('drawNoise', () => {
  it('draws within the configured count bounds', () => {
    for (let i = 0; i < 40; i += 1) {
      const low = drawNoise('low', seeded(i))
      const medium = drawNoise('medium', seeded(i))
      const high = drawNoise('high', seeded(i))
      expect(low.length).toBeGreaterThanOrEqual(NOISE_DRAW_SIZES.low[0])
      expect(low.length).toBeLessThanOrEqual(NOISE_DRAW_SIZES.low[1])
      expect(medium.length).toBeGreaterThanOrEqual(NOISE_DRAW_SIZES.medium[0])
      expect(medium.length).toBeLessThanOrEqual(NOISE_DRAW_SIZES.medium[1])
      expect(high.length).toBeGreaterThanOrEqual(NOISE_DRAW_SIZES.high[0])
      expect(high.length).toBeLessThanOrEqual(NOISE_DRAW_SIZES.high[1])
    }
  })

  it('never draws the same element twice in one dream', () => {
    for (let i = 0; i < 30; i += 1) {
      const drawn = drawNoise('high', seeded(i * 7))
      expect(new Set(drawn).size).toBe(drawn.length)
    }
  })

  it('is deterministic for a fixed rng seed', () => {
    const a = drawNoise('medium', seeded(42))
    const b = drawNoise('medium', seeded(42))
    expect(a).toEqual(b)
  })

  it('high intensity prefers the bolder buckets', () => {
    let boldShare = 0
    let samples = 0
    for (let i = 0; i < 200; i += 1) {
      for (const element of drawNoise('high', seeded(i))) {
        const def = NOISE_LIBRARY.find(candidate => candidate.text === element)
        if (def !== undefined && def.bucket !== 'mild') boldShare += 1
        samples += 1
      }
    }
    expect(samples).toBeGreaterThan(0)
    expect(boldShare / samples).toBeGreaterThan(0.5)
  })

  it('returns the library texts verbatim for the prompt', () => {
    for (const element of drawNoise('low', seeded(1))) {
      expect(NOISE_LIBRARY.some(def => def.text === element)).toBe(true)
    }
  })
})
