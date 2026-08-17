/**
 * End-to-end integration: boot the plugin on a bare cordis context with a
 * stubbed LLM service, feed a synthetic session through the event firehose,
 * and watch one full dream cycle run: gate → scan → generate → persist.
 *
 * The plugin owns its own DreamStore instance, so assertions re-open the
 * ledger file rather than sharing an in-memory instance.
 */

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, resolveDreamIncubatorConfig } from '../src/index.ts'
import { DreamStore } from '../src/store.ts'
import type { DreamIncubatorConfig } from '../src/types.ts'
import { requestHeaderEvent, turnEndEvent, userMessageEvent } from './fixtures.ts'

/** Emit one auxiliary-model response as a stream of raw chunks. */
function stream(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** The scan stage answers with fenced JSON; the dream stage with prose. */
const SCAN_JSON = '```json\n' + JSON.stringify({
  mood: { valence: 0.3, arousal: -0.2, dominance: 0.5 },
  moodLabel: '安静的专注',
  themes: ['构建', '测试'],
  style: 'noir',
}) + '\n```'

const DREAM_TEXT = '走廊尽头的窗\n\n我推开那扇门，光从门缝里渗进来。'

function config(storePath: string): DreamIncubatorConfig {
  return resolveDreamIncubatorConfig({
    cooldownMs: 3_600_000,
    minMaterialEvents: 4,
    maxDailyDreams: 8,
    styleRotationDays: 4,
    noiseIntensity: 'medium',
    maxOutputTokens: 500,
    timeoutMs: 120_000,
    privacyMode: false,
    storePath,
    serveUi: false,
  })
}

/** A structurally faithful Session stub: the plugin reads id and events only. */
function session(extra: number): Session {
  return {
    id: SessionId('sess-int'),
    events: [
      userMessageEvent(1, '帮我写一个插件'),
      userMessageEvent(2, '再读一下文档'),
      userMessageEvent(3, '跑一下测试'),
      userMessageEvent(4, '看看哪里报错了'),
      userMessageEvent(5, '修完这个 bug'),
      userMessageEvent(6, '提交代码'),
      requestHeaderEvent(7, 'deepseek', 'deepseek-chat'),
      ...Array.from({ length: extra }, (_, i) => userMessageEvent(8 + i, `补材料 ${i + 1}`)),
    ],
  } as unknown as Session
}

/** A stub LLM that answers the scan with JSON and the dream with prose. */
function stubLlm(calls: { n: number }) {
  return {
    async *stream(): AsyncIterable<StreamChunk> {
      calls.n += 1
      yield* stream(calls.n === 1 ? SCAN_JSON : DREAM_TEXT)
    },
  }
}

describe('plugin integration', () => {
  let dir: string
  let storePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dream-int-'))
    storePath = join(dir, 'dreams.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs a full dream cycle from the event firehose and persists it', async () => {
    const calls = { n: 0 }
    const ctx = new Context()
    ctx.reflect.provide('llm', stubLlm(calls) as never)
    apply(ctx, config(storePath))

    ctx.emit('session/event', session(0), turnEndEvent(8))
    await vi.waitFor(() => expect(DreamStore.open(storePath).all()).toHaveLength(1), { timeout: 2000 })

    const dream = DreamStore.open(storePath).all()[0]!
    expect(calls.n).toBe(2)
    expect(dream.title).toBe('走廊尽头的窗')
    expect(dream.style).toBe('noir')
    expect(dream.moodLabel).toBe('安静的专注')
    expect(dream.mood).toEqual({ valence: 0.3, arousal: -0.2, dominance: 0.5 })
    expect(dream.themes).toEqual(['构建', '测试'])
    expect(dream.materialSeqs).toEqual([1, 2, 3, 4, 5, 6])
    expect(dream.collected).toBe(false)
    expect(dream.forgotten).toBe(false)

    // The record survives a reopen of the ledger.
    expect(DreamStore.open(storePath).byId(dream.id)?.title).toBe('走廊尽头的窗')
  })

  it('runs a full dream cycle with a user-defined style', async () => {
    const calls = { n: 0 }
    const customConfig = resolveDreamIncubatorConfig({
      cooldownMs: 3_600_000,
      minMaterialEvents: 4,
      maxDailyDreams: 8,
      styleRotationDays: 4,
      noiseIntensity: 'medium',
      maxOutputTokens: 500,
      timeoutMs: 120_000,
      privacyMode: false,
      storePath,
      serveUi: false,
      styles: [{
        id: 'cosmic',
        nameZh: '星际漂流',
        nameEn: 'Cosmic Drift',
        trigger: 'boredom',
        imagery: ['深空尘埃', '失重的茶'],
      }],
    })
    const cosmicScan = '```json\n' + JSON.stringify({
      mood: { valence: 0.3, arousal: -0.2, dominance: 0.5 },
      moodLabel: '安静的专注',
      themes: ['构建'],
      style: 'cosmic',
    }) + '\n```'
    const cosmicLlm = {
      async *stream(): AsyncIterable<StreamChunk> {
        calls.n += 1
        yield* stream(calls.n === 1 ? cosmicScan : DREAM_TEXT)
      },
    }
    const ctx = new Context()
    ctx.reflect.provide('llm', cosmicLlm as never)
    apply(ctx, customConfig)

    ctx.emit('session/event', session(0), turnEndEvent(8))
    await vi.waitFor(() => expect(DreamStore.open(storePath).all()).toHaveLength(1), { timeout: 2000 })

    const dream = DreamStore.open(storePath).all()[0]!
    expect(calls.n).toBe(2)
    expect(dream.style).toBe('cosmic')
  })

  it('declines a second cycle while the cooldown is warm', async () => {
    const calls = { n: 0 }
    const ctx = new Context()
    ctx.reflect.provide('llm', stubLlm(calls) as never)
    apply(ctx, config(storePath))

    const stub = session(0)
    ctx.emit('session/event', stub, turnEndEvent(8))
    await vi.waitFor(() => expect(DreamStore.open(storePath).all()).toHaveLength(1), { timeout: 2000 })

    // A second completed turn within the cooldown window changes nothing.
    ctx.emit('session/event', stub, turnEndEvent(9))
    await vi.waitFor(() => expect(calls.n).toBe(2), { timeout: 2000 })
    expect(DreamStore.open(storePath).all()).toHaveLength(1)
  })

  it('refuses to dream when the session has too little material', async () => {
    const calls = { n: 0 }
    const ctx = new Context()
    ctx.reflect.provide('llm', {
      async *stream(): AsyncIterable<StreamChunk> {
        calls.n += 1
        throw new Error('must not be called')
      },
    } as never)
    apply(ctx, { ...config(storePath), minMaterialEvents: 50 })

    ctx.emit('session/event', session(2), turnEndEvent(10)) // 8 events, still below 50
    await vi.waitFor(() => expect(calls.n).toBe(0), { timeout: 500 })
    expect(DreamStore.open(storePath).all()).toHaveLength(0)
  })
})
