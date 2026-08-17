/**
 * Dream ledger ("应用层"数据底座): JSON-file persistence for dream records.
 * Since out-of-repo plugins cannot append to the session log (the persistence
 * path rejects unknown event types), the incubator keeps its own store at the
 * configured `storePath` — one JSON document, rewritten atomically via
 * temp-file + rename on every mutation.
 *
 * @module dsh-dream-incubator/store
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DreamId, DreamRecord } from './types.ts'

/** Schema version of the store document; bump on breaking changes. */
export const STORE_VERSION = 1

/** The mutable view the ledger writes through; records are frozen for readers. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** How many records the ledger keeps; the oldest are pruned beyond this. */
export const MAX_STORED_RECORDS = 300

interface StoreDocument {
  readonly version: number
  records: DreamRecord[]
}

/**
 * Parse and shape a store document read from disk. Unknown or malformed
 * documents fail loud rather than silently resetting the ledger.
 */
export function coerceDocument(raw: unknown): StoreDocument | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const doc = raw as Record<string, unknown>
  if (doc['version'] !== STORE_VERSION || !Array.isArray(doc['records'])) return undefined
  const records = doc['records'].filter((record): record is DreamRecord => {
    if (record === null || typeof record !== 'object') return false
    const candidate = record as Record<string, unknown>
    return typeof candidate['id'] === 'string'
      && typeof candidate['sessionId'] === 'string'
      && typeof candidate['createdAt'] === 'number'
      && typeof candidate['style'] === 'string'
      && typeof candidate['title'] === 'string'
      && typeof candidate['text'] === 'string'
      && typeof candidate['collected'] === 'boolean'
      && typeof candidate['forgotten'] === 'boolean'
  })
  return { version: STORE_VERSION, records }
}

/**
 * The dream ledger. Synchronous and crash-atomic; dreams are rare (an hourly
 * cooldown at most), so blocking writes are fine.
 */
export class DreamStore {
  private readonly document: StoreDocument

  private constructor(
    private readonly path: string,
    document: StoreDocument,
  ) {
    this.document = document
  }

  /** Load (or create) the ledger at `path`. */
  static open(path: string): DreamStore {
    try {
      const raw = readFileSync(path, 'utf8')
      const parsed = coerceDocument(JSON.parse(raw) as unknown)
      if (parsed === undefined) {
        throw new Error(`dream-incubator: store document at ${path} is invalid or its schema version is not supported`)
      }
      return new DreamStore(path, parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const fresh: StoreDocument = { version: STORE_VERSION, records: [] }
        const store = new DreamStore(path, fresh)
        store.persist()
        return store
      }
      throw error
    }
  }

  /** All records, newest first. */
  all(): readonly DreamRecord[] {
    return [...this.document.records].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** One record by id. */
  byId(id: DreamId): DreamRecord | undefined {
    return this.document.records.find(record => record.id === id)
  }

  /** The latest record of one session, if any. */
  latest(sessionId: string): DreamRecord | undefined {
    let latest: DreamRecord | undefined
    for (const record of this.document.records) {
      if (record.sessionId === sessionId
        && (latest === undefined || record.createdAt > latest.createdAt)) {
        latest = record
      }
    }
    return latest
  }

  /** The highest cited material seq of one session's dreams (or undefined). */
  lastMaterialSeq(sessionId: string): number | undefined {
    let max: number | undefined
    for (const record of this.document.records) {
      if (record.sessionId !== sessionId) continue
      for (const seq of record.materialSeqs) {
        if (max === undefined || seq > max) max = seq
      }
    }
    return max
  }

  /** How many dreams one session already had in a given UTC day. */
  dailyCount(sessionId: string, dayStart: number): number {
    const dayEnd = dayStart + 86_400_000
    let count = 0
    for (const record of this.document.records) {
      if (record.sessionId === sessionId
        && record.createdAt >= dayStart
        && record.createdAt < dayEnd) {
        count += 1
      }
    }
    return count
  }

  /** Append a dream and prune the ledger to {@link MAX_STORED_RECORDS}. */
  append(record: DreamRecord): void {
    this.document.records.push(record)
    const overflow = this.document.records.length - MAX_STORED_RECORDS
    if (overflow > 0) this.document.records.splice(0, overflow)
    this.persist()
  }

  /** Mark one record as collected ("收录"); no-op when unknown. */
  collect(id: DreamId): DreamRecord | undefined {
    const record = this.byId(id)
    if (record === undefined) return undefined
    const mutable = record as Mutable<DreamRecord>
    mutable.collected = true
    mutable.forgotten = false
    this.persist()
    return record
  }

  /** Mark one record as forgotten ("遗忘"); no-op when unknown. */
  forget(id: DreamId): DreamRecord | undefined {
    const record = this.byId(id)
    if (record === undefined) return undefined
    const mutable = record as Mutable<DreamRecord>
    mutable.forgotten = true
    mutable.collected = false
    this.persist()
    return record
  }

  /** Atomically rewrite the document (temp file + rename). */
  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.document, null, 2)}\n`, 'utf8')
    renameSync(temp, this.path)
  }
}
