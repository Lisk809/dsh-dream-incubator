/**
 * Dream cycle orchestration ("处理层"): emotion scan → style decision →
 * noise draw → dream generation, over one auxiliary LLM route, producing a
 * {@link DreamRecord} for the store. Mirrors the auxiliary-call policy of
 * dsh-session-title-llm: deadline-wrapped `ctx.llm.stream`, BlockAssembler
 * finish mapping, and an exact system/user framing.
 *
 * @module dsh-dream-incubator/engine/dreamer
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { DreamIncubatorConfig, DreamRecord, DreamScan, ModelRoute } from '../types.ts';
/** Cap one dream cycle's end-to-end run. */
export declare const DREAM_TIMEOUT_CODE = "DREAM_TIMEOUT";
/** Raised when a dream cycle cannot resolve a model route. */
export declare class DreamRouteError extends Error {
    readonly code = "DREAM_ROUTE_UNAVAILABLE";
}
/** Raised when the material window carries no usable content. */
export declare class DreamMaterialEmptyError extends Error {
    readonly code = "DREAM_MATERIAL_EMPTY";
}
/** Raised when the scan stage returns an unparseable or invalid record. */
export declare class DreamScanError extends Error {
    readonly code = "DREAM_SCAN_INVALID";
}
/**
 * Resolve the auxiliary route: the configured explicit pair wins; otherwise
 * the latest logged `request/header` of the session.
 * @param config - validated incubator configuration.
 * @param events - the session log (ascending).
 * @returns the provider/model pair.
 * @throws {@link DreamRouteError} when neither source yields a route.
 */
export declare function resolveRoute(config: DreamIncubatorConfig, events: readonly SessionEvent[]): ModelRoute;
/** Split the generator output into title (first line) and dream prose. */
export declare function splitDreamOutput(output: string): {
    title: string;
    text: string;
};
/** Parse and validate the scan JSON; an invalid record fails loud. */
export declare function parseScan(rawText: string): DreamScan;
/**
 * Run one full dream cycle over a session: scan its material window, decide
 * style and mood, draw noise, generate the dream, and assemble the record.
 * @param ctx - context exposing the LLM service.
 * @param config - validated incubator configuration.
 * @param session - the live session whose log feeds the dream.
 * @param sinceSeq - cite only material after this seq (the previous dream).
 * @param rng - randomness source (noise draw), testable.
 * @param externalSignal - optional caller-owned cancellation (command abort,
 *   plugin disposal); aborts the internal controller.
 * @returns the finished dream record (not yet persisted).
 */
export declare function generateDream(ctx: Context, config: DreamIncubatorConfig, session: Session, sinceSeq: number | undefined, rng?: () => number, externalSignal?: AbortSignal): Promise<DreamRecord>;
