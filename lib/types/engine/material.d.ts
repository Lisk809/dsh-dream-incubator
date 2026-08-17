/**
 * Observation layer ("观测层"): derive dream material from the session log.
 * Pure functions over {@link SessionEvent} tails — stateless, restart-proof,
 * and testable. The plugin never accumulates material in memory; every dream
 * reads its window from the live session log at dream time.
 *
 * @module dsh-dream-incubator/engine/material
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { MaterialLine, MaterialStats } from '../types.ts';
/** How many trailing events one dream may cite. */
export declare const MATERIAL_WINDOW = 60;
/** Cap one material line's text so the scan prompt stays bounded. */
export declare const MATERIAL_LINE_CHARS = 220;
/** Recursively collect text from model content blocks (tool-result nests). */
export declare function extractText(blocks: readonly ContentBlock[]): string;
/** Truncate a material line to {@link MATERIAL_LINE_CHARS} with an ellipsis. */
export declare function truncate(text: string, max?: number): string;
/**
 * Derive material lines from a session event window, preserving ascending
 * seq order. Recognized event kinds become user/assistant/tool/error lines;
 * everything else (boundary markers, chunks, plugin records) is skipped.
 * @param events - the event window in ascending seq order.
 * @returns one material line per recognized event.
 */
export declare function materialFromEvents(events: readonly SessionEvent[]): MaterialLine[];
/** Structural statistics over one material window. */
export declare function materialStats(lines: readonly MaterialLine[]): MaterialStats;
/**
 * Select the material window from a session log: the `window` trailing
 * events, optionally cut at an earlier dream's start so one dream never cites
 * the same events as the previous one.
 * @param events - the full session log in ascending seq order.
 * @param sinceSeq - cite only events after this seq (exclusive); omit for the
 *   plain trailing window.
 * @returns the selected window, ascending.
 */
export declare function selectWindow(events: readonly SessionEvent[], sinceSeq?: number): SessionEvent[];
