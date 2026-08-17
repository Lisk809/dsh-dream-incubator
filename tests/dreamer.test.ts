/**
 * Dream-cycle unit tests over the pure seams: route resolution, scan
 * parsing, and title/prose splitting. (The full cycle needs a live LLM
 * service and is covered by the invariant companion plus manual runs.)
 */

import { describe, expect, it } from 'vitest'
import {
  DreamRouteError,
  DreamScanError,
  parseScan,
  resolveRoute,
  splitDreamOutput,
} from '../src/engine/dreamer.ts'
import { mergedStyleMatrix } from '../src/engine/styles.ts'
import { STYLE_MATRIX } from '../src/engine/styles.ts'
import type { DreamIncubatorConfig } from '../src/types.ts'
import { requestHeaderEvent, turnEndEvent, userMessageEvent } from './fixtures.ts'

function config(overrides: Partial<DreamIncubatorConfig> = {}): DreamIncubatorConfig {
  return {
    cooldownMs: 3_600_000,
    minMaterialEvents: 4,
    maxDailyDreams: 8,
    styleRotationDays: 4,
    noiseIntensity: 'medium',
    maxOutputTokens: 500,
    timeoutMs: 120_000,
    privacyMode: false,
    storePath: '/tmp/dreams.json',
    serveUi: true,
    ...overrides,
  }
}

describe('resolveRoute', () => {
  it('prefers the explicit config pair', () => {
    const events = [requestHeaderEvent(1, 'fallback', 'fallback-model')]
    const route = resolveRoute(config({ provider: 'explicit', model: 'explicit-model' }), events)
    expect(route).toEqual({ provider: 'explicit', model: 'explicit-model' })
  })

  it('falls back to the latest logged request header', () => {
    const events = [
      requestHeaderEvent(1, 'deepseek', 'deepseek-chat'),
      turnEndEvent(2),
      requestHeaderEvent(3, 'deepseek', 'deepseek-reasoner'),
    ]
    expect(resolveRoute(config(), events)).toEqual({ provider: 'deepseek', model: 'deepseek-reasoner' })
  })

  it('throws when no route is available', () => {
    expect(() => resolveRoute(config(), [userMessageEvent(1, 'hi'), turnEndEvent(2)])).toThrow(DreamRouteError)
  })

  it('ignores malformed header configs', () => {
    const events = [{
      type: 'request/header',
      seq: 1,
      time: 1,
      data: { header: { config: {} }, reason: 'initial' },
    } as never]
    expect(() => resolveRoute(config(), events as never)).toThrow(DreamRouteError)
  })
})

describe('parseScan', () => {
  it('parses a well-formed scan, tolerating a code fence', () => {
    const scan = parseScan('```json\n{"mood":{"valence":0.4,"arousal":-0.3,"dominance":0.2},"moodLabel":"缓过来了","themes":["重构"],"style":"fantasy"}\n```', STYLE_MATRIX)
    expect(scan.style).toBe('fantasy')
    expect(scan.moodLabel).toBe('缓过来了')
    expect(scan.mood).toEqual({ valence: 0.4, arousal: -0.3, dominance: 0.2 })
  })

  it('rejects unparseable text', () => {
    expect(() => parseScan('I had a dream about...', STYLE_MATRIX)).toThrow(DreamScanError)
  })

  it('rejects records outside the style matrix', () => {
    expect(() => parseScan('{"mood":{"valence":0,"arousal":0,"dominance":0},"moodLabel":"x","themes":[],"style":"neon"}', STYLE_MATRIX)).toThrow(DreamScanError)
  })

  it('rejects records missing PAD axes', () => {
    expect(() => parseScan('{"mood":{"valence":0},"moodLabel":"x","themes":[],"style":"noir"}', STYLE_MATRIX)).toThrow(DreamScanError)
  })

  it('accepts a custom style id when the merged matrix includes it', () => {
    const matrix = mergedStyleMatrix([{
      id: 'cosmic',
      nameZh: '星际漂流',
      nameEn: 'Cosmic Drift',
      trigger: 'boredom',
      imagery: ['深空尘埃'],
    }])
    const scan = parseScan('{"mood":{"valence":0,"arousal":0,"dominance":0},"moodLabel":"x","themes":[],"style":"cosmic"}', matrix)
    expect(scan.style).toBe('cosmic')
  })

  it('rejects a custom style id against the built-in matrix alone', () => {
    expect(() => parseScan('{"mood":{"valence":0,"arousal":0,"dominance":0},"moodLabel":"x","themes":[],"style":"cosmic"}', STYLE_MATRIX)).toThrow(DreamScanError)
  })
})

describe('splitDreamOutput', () => {
  it('splits title and prose on the first newline', () => {
    const { title, text } = splitDreamOutput('雾中的电梯\n我走进电梯，里面是一片森林。')
    expect(title).toBe('雾中的电梯')
    expect(text).toBe('我走进电梯，里面是一片森林。')
  })

  it('strips surrounding quotation marks from the title', () => {
    const { title } = splitDreamOutput('「会说话的月亮」\n正文...')
    expect(title).toBe('会说话的月亮')
  })

  it('caps the title at 24 characters', () => {
    const long = '长'.repeat(40)
    const { title } = splitDreamOutput(`${long}\n正文`)
    expect(title).toHaveLength(24)
  })

  it('falls back to a nameless title for a bare line', () => {
    const { title, text } = splitDreamOutput('只有一行')
    expect(title).toBe('只有一行')
    expect(text).toBe('只有一行')
  })
})
