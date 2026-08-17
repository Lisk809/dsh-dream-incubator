/**
 * Style matrix ("导演"): the emotion-to-style mapping table, day-based
 * rotation, and structural heuristic hints derived from material stats.
 *
 * @module dsh-dream-incubator/engine/styles
 */
import type { DreamStyle, DreamStyleDef, DreamScan, MaterialStats } from '../types.ts';
/** The six-library style matrix (plan §3.2-②). */
export declare const STYLE_MATRIX: readonly DreamStyleDef[];
/** Look up one style definition by id. */
export declare function styleDef(id: DreamStyle): DreamStyleDef;
/** Validate that a parsed scan style is a member of the matrix. */
export declare function isDreamStyle(value: unknown): value is DreamStyle;
/**
 * Day-based style-library rotation offset: the scan prompt lists the matrix
 * starting at this index and instructs the model to prefer earlier entries on
 * ties, so favourite styles drift every `rotationDays` without repetition
 * (plan §3.2-② "随机轮换机制").
 * @param rotationDays - the configured rotation period.
 * @param epochDays - whole days since the Unix epoch (local calendar days).
 * @returns an offset in [0, styles.length).
 */
export declare function rotationOffset(rotationDays: number, epochDays: number): number;
/**
 * Rotated style list for the scan prompt.
 * @param offset - the rotation offset from {@link rotationOffset}.
 * @returns the matrix ordered starting at `offset`.
 */
export declare function rotatedStyles(offset: number): readonly DreamStyleDef[];
/**
 * Structural heuristic hints from material stats, describing the day in the
 * language of the style matrix triggers. Purely mechanical: the scan stage
 * receives these as hints and remains free to override.
 */
export declare function heuristicMoodHints(stats: MaterialStats): readonly string[];
/** Fallback style when the scan returns an unusable value. */
export declare function fallbackStyle(stats: MaterialStats): DreamStyle;
/**
 * Coerce a parsed scan result into a usable {@link DreamScan}, applying the
 * fallback style and clamping PAD axes. Invalid records stay invalid — the
 * caller decides whether to fail loud or degrade.
 */
export declare function coerceScan(raw: unknown): DreamScan | undefined;
