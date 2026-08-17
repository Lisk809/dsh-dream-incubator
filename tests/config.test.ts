/**
 * Config validation tests: every rule of resolveDreamIncubatorConfig, run
 * against the exact values shipped in cordis.patch.yml.
 */

import { describe, expect, it } from 'vitest'
import { DreamIncubatorConfigSchema, resolveDreamIncubatorConfig } from '../src/index.ts'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { DreamIncubatorConfig } from '../src/types.ts'

/** The configuration shipped by cordis.patch.yml. */
const patchConfig: DreamIncubatorConfig = {
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
}

/** A valid custom style definition for the styles validation tests. */
const customStyle = {
  id: 'cosmic',
  nameZh: '星际漂流',
  nameEn: 'Cosmic Drift',
  trigger: 'boredom',
  imagery: ['深空尘埃', '失重的茶', '土星环上的雪'],
} as const

describe('resolveDreamIncubatorConfig', () => {
  it('accepts the cordis.patch.yml configuration', () => {
    const resolved = resolveDreamIncubatorConfig(patchConfig)
    expect(resolved.cooldownMs).toBe(3_600_000)
    expect(resolved.noiseIntensity).toBe('medium')
    expect(resolved.provider).toBeUndefined()
  })

  it('deep-freezes the resolved policy', () => {
    const resolved = resolveDreamIncubatorConfig(patchConfig)
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('rejects missing configuration', () => {
    expect(() => resolveDreamIncubatorConfig(undefined as never)).toThrow(/configuration is required/)
    expect(() => resolveDreamIncubatorConfig(null as never)).toThrow(/configuration is required/)
  })

  it('rejects unknown config keys', () => {
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, dreamEvery: 7 } as never)).toThrow(/unknown config key "dreamEvery"/)
  })

  it('rejects invalid numeric limits', () => {
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, cooldownMs: -1 })).toThrow(/non-negative integer/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, cooldownMs: 1.5 })).toThrow(/non-negative integer/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, minMaterialEvents: -2 })).toThrow(/non-negative integer/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, maxDailyDreams: 0 })).toThrow(/positive integer/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, styleRotationDays: 0 })).toThrow(/positive integer/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, maxOutputTokens: 0 })).toThrow(/positive integer/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, timeoutMs: 0 })).toThrow(/positive integer/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, timeoutMs: MAX_TIMER_DELAY_MS + 1 })).toThrow(/must not exceed/)
  })

  it('rejects invalid noise intensity and types', () => {
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, noiseIntensity: 'extreme' as never })).toThrow(/noiseIntensity/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, privacyMode: 'yes' as never })).toThrow(/privacyMode/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, serveUi: 1 as never })).toThrow(/serveUi/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, storePath: '' })).toThrow(/storePath/)
  })

  it('requires provider and model together, as non-empty strings', () => {
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, provider: 'deepseek' })).toThrow(/together/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, model: 'chat' })).toThrow(/together/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, provider: '', model: 'chat' })).toThrow(/non-empty/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, provider: 'deepseek', model: 'chat' })).not.toThrow()
  })
})

describe('DreamIncubatorConfigSchema', () => {
  it('accepts the patch configuration through the Loader schema', () => {
    expect(() => DreamIncubatorConfigSchema(patchConfig as never)).not.toThrow()
  })

  it('rejects an invalid patch configuration', () => {
    expect(() => DreamIncubatorConfigSchema({ ...patchConfig, noiseIntensity: 'loud' } as never)).toThrow()
    expect(() => DreamIncubatorConfigSchema({ ...patchConfig, maxDailyDreams: 0 } as never)).toThrow()
  })

  it('accepts custom styles and rejects malformed ones through the Loader schema', () => {
    expect(() => DreamIncubatorConfigSchema({ ...patchConfig, styles: [customStyle] } as never)).not.toThrow()
    expect(() => DreamIncubatorConfigSchema({ ...patchConfig, styles: [{ ...customStyle, trigger: 'sleepy' }] } as never)).toThrow()
    expect(() => DreamIncubatorConfigSchema({ ...patchConfig, styles: [{ ...customStyle, id: 7 }] } as never)).toThrow()
    expect(() => DreamIncubatorConfigSchema({ ...patchConfig, styles: [{ ...customStyle, imagery: [] }] } as never)).toThrow()
  })
})

describe('custom styles validation', () => {
  it('accepts custom styles and preserves them in the resolved policy', () => {
    const resolved = resolveDreamIncubatorConfig({ ...patchConfig, styles: [customStyle] })
    expect(resolved.styles).toEqual([customStyle])
    expect(Object.isFrozen(resolved.styles)).toBe(true)
  })

  it('keeps an explicit palette on the normalized entry', () => {
    const resolved = resolveDreamIncubatorConfig({
      ...patchConfig,
      styles: [{ ...customStyle, palette: 'nebula' }],
    })
    expect(resolved.styles?.[0]?.palette).toBe('nebula')
  })

  it('rejects ids colliding with built-in styles', () => {
    expect(() => resolveDreamIncubatorConfig({
      ...patchConfig,
      styles: [{ ...customStyle, id: 'noir' }],
    })).toThrow(/duplicate dream style "noir"/)
  })

  it('rejects duplicate ids among custom styles', () => {
    expect(() => resolveDreamIncubatorConfig({
      ...patchConfig,
      styles: [{ ...customStyle }, { ...customStyle }],
    })).toThrow(/duplicate dream style "cosmic"/)
  })

  it('rejects malformed entries', () => {
    expect(() => resolveDreamIncubatorConfig({
      ...patchConfig,
      styles: [{ ...customStyle, trigger: 'sleepy' as never }],
    })).toThrow(/trigger/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, styles: [{ ...customStyle, imagery: [] }] })).toThrow(/imagery/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, styles: [{ ...customStyle, imagery: ['', 'ok'] }] })).toThrow(/imagery/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, styles: [{ ...customStyle, nameZh: '' }] })).toThrow(/nameZh/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, styles: [{ ...customStyle, palette: '' }] })).toThrow(/palette/)
    expect(() => resolveDreamIncubatorConfig({ ...patchConfig, styles: 'nope' as never })).toThrow(/array/)
  })
})
