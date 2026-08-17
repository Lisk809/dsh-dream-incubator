/**
 * Dream WebUI ("应用层"): HTTP routes served through the harness webserver.
 * The incubator owns a namespaced route family under /dreams — the immersive
 * page, its static assets, a JSON ledger API, and an SSE stream that pushes
 * each new dream to open pages — so the composition's SPA fallback seat and
 * other plugins are never contested.
 *
 * @module dsh-dream-incubator/webui
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DreamIncubatorConfig, DreamRecord } from '../types.ts';
import type { DreamStore } from '../store.ts';
/** Everything the /dreams WebUI owns; assembled by one effect. */
export interface DreamWebUi {
    /** Push one new dream to every open SSE client. */
    push(record: DreamRecord): void;
    /** Remove all registered routes and close SSE clients. */
    dispose(): void;
}
/**
 * Register the /dreams route family on the harness webserver.
 * @param ctx - context carrying the `httpServer` service.
 * @param store - the shared dream ledger.
 * @param config - the resolved engine configuration (read-only, deep-frozen);
 *   the settings route exposes an explicit pick-list of it.
 * @returns the push channel and route disposer.
 * @throws when `httpServer` is unavailable (serveUi demanded a host that
 *   cannot serve it — fail loud at load).
 */
export declare function registerDreamWebUi(ctx: Context, store: DreamStore, config: DreamIncubatorConfig): DreamWebUi;
