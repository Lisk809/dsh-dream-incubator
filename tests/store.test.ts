/**
 * Dream ledger tests: open/create semantics, persistence round-trips,
 * collect/forget mutations, daily caps, seq tracking, and corrupt docs.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DreamStore, MAX_STORED_RECORDS, STORE_VERSION } from '../src/store.ts'
import { DreamId } from '../src/types.ts'
import type { DreamRecord } from '../src/types.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dream-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function record(overrides: Partial<DreamRecord> = {}): DreamRecord {
  const base = {
    id: DreamId('dream-1'),
    sessionId: 'session-a',
    createdAt: 1_700_000_000_000,
    style: 'noir' as const,
    title: '走廊尽头的窗',
    text: '我推开那扇门。',
    mood: { valence: 0.2, arousal: -0.4, dominance: 0.1 },
    moodLabel: '安静的夜晚',
    themes: ['修复', '日志'],
    noiseSeeds: ['会说话的月亮'],
    materialSeqs: [3, 4, 5],
    collected: false,
    forgotten: false,
  }
  return { ...base, ...overrides }
}

describe('DreamStore', () => {
  it('creates an empty ledger and persists it on first open', () => {
    const path = join(dir, 'dreams.json')
    const store = DreamStore.open(path)
    expect(store.all()).toEqual([])
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { version: number; records: unknown[] }
    expect(doc.version).toBe(STORE_VERSION)
    expect(doc.records).toEqual([])
  })

  it('survives a round-trip through the file', () => {
    const path = join(dir, 'dreams.json')
    DreamStore.open(path).append(record())
    const reopened = DreamStore.open(path)
    expect(reopened.all()).toHaveLength(1)
    expect(reopened.all()[0]?.title).toBe('走廊尽头的窗')
  })

  it('orders newest first and tracks the latest per session', () => {
    const path = join(dir, 'dreams.json')
    const store = DreamStore.open(path)
    store.append(record({ id: DreamId('dream-1'), createdAt: 1000 }))
    store.append(record({ id: DreamId('dream-2'), createdAt: 3000 }))
    store.append(record({ id: DreamId('dream-3'), createdAt: 2000, sessionId: 'session-b' }))
    expect(store.all().map(dream => dream.id)).toEqual([DreamId('dream-2'), DreamId('dream-3'), DreamId('dream-1')])
    expect(store.latest('session-a')?.id).toBe(DreamId('dream-2'))
    expect(store.latest('session-b')?.id).toBe(DreamId('dream-3'))
    expect(store.latest('nobody')).toBeUndefined()
  })

  it('tracks the highest cited material seq per session', () => {
    const store = DreamStore.open(join(dir, 'dreams.json'))
    store.append(record({ sessionId: 'a', materialSeqs: [1, 2] }))
    store.append(record({ sessionId: 'a', materialSeqs: [5, 9, 12] }))
    store.append(record({ sessionId: 'b', materialSeqs: [99] }))
    expect(store.lastMaterialSeq('a')).toBe(12)
    expect(store.lastMaterialSeq('b')).toBe(99)
    expect(store.lastMaterialSeq('c')).toBeUndefined()
  })

  it('counts dreams per session within one UTC day', () => {
    const dayStart = 1_700_000_000_000
    const store = DreamStore.open(join(dir, 'dreams.json'))
    store.append(record({ sessionId: 'a', createdAt: dayStart + 1000 }))
    store.append(record({ sessionId: 'a', createdAt: dayStart + 2000 }))
    store.append(record({ sessionId: 'b', createdAt: dayStart + 3000 }))
    store.append(record({ sessionId: 'a', createdAt: dayStart + 86_400_000 + 1000 }))
    expect(store.dailyCount('a', dayStart)).toBe(2)
    expect(store.dailyCount('b', dayStart)).toBe(1)
    expect(store.dailyCount('a', dayStart + 86_400_000)).toBe(1)
  })

  it('collects and forgets records, keeping the flags exclusive', () => {
    const store = DreamStore.open(join(dir, 'dreams.json'))
    store.append(record())
    const id = DreamId('dream-1')
    expect(store.collect(id)?.collected).toBe(true)
    expect(store.collect(id)?.forgotten).toBe(false)
    expect(store.forget(id)?.forgotten).toBe(true)
    expect(store.forget(id)?.collected).toBe(false)
    expect(store.collect(DreamId('dream-ghost'))).toBeUndefined()
    expect(store.forget(DreamId('dream-ghost'))).toBeUndefined()
  })

  it('prunes the ledger beyond the record cap, oldest first', () => {
    const store = DreamStore.open(join(dir, 'dreams.json'))
    for (let i = 0; i < MAX_STORED_RECORDS + 5; i += 1) {
      store.append(record({ id: DreamId(`dream-${i}`), createdAt: i }))
    }
    expect(store.all()).toHaveLength(MAX_STORED_RECORDS)
    expect(store.all()[MAX_STORED_RECORDS - 1]?.id).toBe(DreamId('dream-5'))
  })

  it('fails loud on corrupt or version-mismatched documents', () => {
    const path = join(dir, 'dreams.json')
    writeFileSync(path, '{"version": 99, "records": []}', 'utf8')
    expect(() => DreamStore.open(path)).toThrow(/version/)
    writeFileSync(path, 'not json at all', 'utf8')
    expect(() => DreamStore.open(path)).toThrow()
  })

  it('strips malformed records from a partially broken document', () => {
    const path = join(dir, 'dreams.json')
    writeFileSync(path, JSON.stringify({ version: STORE_VERSION, records: [
      { id: 'ok', sessionId: 's', createdAt: 1, style: 'noir', title: 't', text: 'x', collected: false, forgotten: false },
      { id: 'bad', sessionId: 's' },
    ] }), 'utf8')
    const store = DreamStore.open(path)
    expect(store.all()).toHaveLength(1)
  })
})
