/**
 * Dream ledger ("应用层"数据底座): JSON-file persistence for dream records.
 * Since out-of-repo plugins cannot append to the session log (the persistence
 * path rejects unknown event types), the incubator keeps its own store at the
 * configured `storePath` — one JSON document, rewritten atomically via
 * temp-file + rename on every mutation.
 *
 * @module dsh-dream-incubator/store
 */
import type { DreamId, DreamRecord } from './types.ts';
/** Schema version of the store document; bump on breaking changes. */
export declare const STORE_VERSION = 1;
/** How many records the ledger keeps; the oldest are pruned beyond this. */
export declare const MAX_STORED_RECORDS = 300;
interface StoreDocument {
    readonly version: number;
    records: DreamRecord[];
}
/**
 * Parse and shape a store document read from disk. Unknown or malformed
 * documents fail loud rather than silently resetting the ledger.
 */
export declare function coerceDocument(raw: unknown): StoreDocument | undefined;
/**
 * The dream ledger. Synchronous and crash-atomic; dreams are rare (an hourly
 * cooldown at most), so blocking writes are fine.
 */
export declare class DreamStore {
    private readonly path;
    private readonly document;
    private constructor();
    /** Load (or create) the ledger at `path`. */
    static open(path: string): DreamStore;
    /** All records, newest first. */
    all(): readonly DreamRecord[];
    /** One record by id. */
    byId(id: DreamId): DreamRecord | undefined;
    /** The latest record of one session, if any. */
    latest(sessionId: string): DreamRecord | undefined;
    /** The highest cited material seq of one session's dreams (or undefined). */
    lastMaterialSeq(sessionId: string): number | undefined;
    /** How many dreams one session already had in a given UTC day. */
    dailyCount(sessionId: string, dayStart: number): number;
    /** Append a dream and prune the ledger to {@link MAX_STORED_RECORDS}. */
    append(record: DreamRecord): void;
    /** Mark one record as collected ("收录"); no-op when unknown. */
    collect(id: DreamId): DreamRecord | undefined;
    /** Mark one record as forgotten ("遗忘"); no-op when unknown. */
    forget(id: DreamId): DreamRecord | undefined;
    /** Atomically rewrite the document (temp file + rename). */
    private persist;
}
export {};
