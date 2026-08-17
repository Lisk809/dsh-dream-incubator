/**
 * Style matrix tests: rotation, rotated ordering, heuristic hints, style
 * membership, and scan coercion.
 */

import { describe, expect, it } from 'vitest'
import {
  coerceScan,
  fallbackStyle,
  heuristicMoodHints,
  isDreamStyle,
  rotationOffset,
  rotatedStyles,
  styleDef,
} from '../src/engine/styles.ts'
import { STYLE_MATRIX } from '../src/engine/styles.ts'
import type { MaterialStats } from '../src/types.ts'

const emptyStats: MaterialStats = {
  eventCount: 0,
  userMessageCount: 0,
  assistantMessageCount: 0,
  toolCallCount: 0,
  errorCount: 0,
}

describe('rotationOffset', () => {
  it('cycles over the six styles every rotationDays', () => {
    expect(rotationOffset(4, 0)).toBe(0)
    expect(rotationOffset(4, 4)).toBe(1)
    expect(rotationOffset(4, 8)).toBe(2)
    expect(rotationOffset(4, 20)).toBe(5)
    expect(rotationOffset(4, 24)).toBe(0)
  })

  it('never returns out of range for arbitrary periods', () => {
    for (let day = 0; day < 365; day += 1) {
      const offset = rotationOffset(3, day)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(STYLE_MATRIX.length)
    }
  })
})

describe('rotatedStyles', () => {
  it('starts the matrix at the offset and wraps around', () => {
    const styles = rotatedStyles(2)
    expect(styles[0]?.id).toBe('noir')
    expect(styles[1]?.id).toBe('surreal')
    expect(styles[5]?.id).toBe('fantasy')
    expect(styles.map(def => def.id).sort()).toEqual(STYLE_MATRIX.map(def => def.id).sort())
  })

  it('treats negative offsets as modulo', () => {
    expect(rotatedStyles(-1)[0]?.id).toBe('horror')
  })
})

describe('style matrix lookups', () => {
  it('isDreamStyle accepts only matrix members', () => {
    expect(isDreamStyle('cyberpunk')).toBe(true)
    expect(isDreamStyle('fantasy')).toBe(true)
    expect(isDreamStyle('neon-noir')).toBe(false)
    expect(isDreamStyle(42)).toBe(false)
    expect(isDreamStyle(undefined)).toBe(false)
  })

  it('styleDef resolves a member and rejects unknowns', () => {
    expect(styleDef('noir').nameZh).toBe('黑色悬疑')
    expect(() => styleDef('pastel' as never)).toThrow(/unknown dream style/)
  })
})

describe('heuristicMoodHints', () => {
  it('reads an empty day as calm', () => {
    expect(heuristicMoodHints(emptyStats)).toEqual(['平静（几乎无事发生）'])
  })

  it('flags error-heavy days as fatigue', () => {
    const stats: MaterialStats = { eventCount: 6, userMessageCount: 2, assistantMessageCount: 2, toolCallCount: 0, errorCount: 3 }
    expect(heuristicMoodHints(stats).join('')).toContain('疲惫')
  })

  it('flags tool-heavy days as pressure', () => {
    const stats: MaterialStats = { eventCount: 10, userMessageCount: 2, assistantMessageCount: 3, toolCallCount: 4, errorCount: 0 }
    const hints = heuristicMoodHints(stats)
    expect(hints.join('')).toContain('压力')
    expect(hints.join('')).not.toContain('疲惫')
  })

  it('flags sparse days as calm or bored', () => {
    const stats: MaterialStats = { eventCount: 2, userMessageCount: 1, assistantMessageCount: 1, toolCallCount: 0, errorCount: 0 }
    expect(heuristicMoodHints(stats).join('')).toContain('平静或无聊')
  })

  it('never returns empty hints', () => {
    expect(heuristicMoodHints({ eventCount: 7, userMessageCount: 2, assistantMessageCount: 3, toolCallCount: 1, errorCount: 0 }).length).toBeGreaterThan(0)
  })
})

describe('fallbackStyle', () => {
  it('maps error storms to cyberpunk and quiet days to fantasy', () => {
    expect(fallbackStyle({ ...emptyStats, eventCount: 5, errorCount: 4 })).toBe('cyberpunk')
    expect(fallbackStyle({ ...emptyStats, eventCount: 5, errorCount: 1 })).toBe('noir')
    expect(fallbackStyle({ ...emptyStats, eventCount: 2, userMessageCount: 1 })).toBe('fantasy')
    expect(fallbackStyle(emptyStats)).toBe('surreal')
  })
})

describe('coerceScan', () => {
  it('accepts a well-formed scan', () => {
    const scan = coerceScan({
      mood: { valence: 0.5, arousal: -0.2, dominance: 0.8 },
      moodLabel: '疲惫中带点浪漫',
      themes: ['debug', '部署'],
      style: 'noir',
    })
    expect(scan).toEqual({
      mood: { valence: 0.5, arousal: -0.2, dominance: 0.8 },
      moodLabel: '疲惫中带点浪漫',
      themes: ['debug', '部署'],
      style: 'noir',
    })
  })

  it('clamps PAD axes into [-1, 1]', () => {
    const scan = coerceScan({ mood: { valence: 9, arousal: -9, dominance: 0 }, moodLabel: '过载', themes: [], style: 'surreal' })
    expect(scan?.mood).toEqual({ valence: 1, arousal: -1, dominance: 0 })
  })

  it('filters non-string themes and caps the list', () => {
    const scan = coerceScan({ mood: { valence: 0, arousal: 0, dominance: 0 }, moodLabel: 'x', themes: ['a', 3, '', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], style: 'fable' })
    expect(scan?.themes).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  })

  it('rejects invalid records', () => {
    expect(coerceScan(null)).toBeUndefined()
    expect(coerceScan('nope')).toBeUndefined()
    expect(coerceScan({ mood: { valence: 1 }, moodLabel: 'x', themes: [], style: 'fable' })).toBeUndefined()
    expect(coerceScan({ mood: { valence: 0, arousal: 0, dominance: 0 }, moodLabel: 'x', themes: [], style: 'acid-jazz' })).toBeUndefined()
    expect(coerceScan({ mood: { valence: 0, arousal: 0, dominance: 0 }, moodLabel: '  ', themes: [], style: 'fable' })).toBeUndefined()
  })
})
