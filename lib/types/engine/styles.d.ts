/**
 * Style matrix ("导演"): the emotion-to-style mapping table, day-based
 * rotation, and structural heuristic hints derived from material stats.
 *
 * @module dsh-dream-incubator/engine/styles
 */
import type { DreamStyle, DreamStyleDef, DreamScan, MaterialStats, UserStyleDef } from '../types.ts';
/** The six-library style matrix (plan §3.2-②). */
export declare const STYLE_MATRIX: readonly DreamStyleDef[];
/**
 * The effective style library for one dream cycle: the built-in six followed
 * by any user-registered styles (append-only — custom styles cannot shadow
 * built-ins). Normalizes each user entry by filling the optional palette with
 * the style id, mirroring the built-in "same id by default" convention.
 * @param userStyles - validated custom styles from {@link DreamIncubatorConfig}.
 */
export declare function mergedStyleMatrix(userStyles?: readonly UserStyleDef[]): readonly DreamStyleDef[];
/** Look up one style definition by id within the given matrix. */
export declare function styleDef(id: DreamStyle, matrix: readonly DreamStyleDef[]): DreamStyleDef;
/** Validate that a parsed scan style is a member of the given matrix. */
export declare function isDreamStyle(value: unknown, matrix: readonly DreamStyleDef[]): value is DreamStyle;
/**
 * Day-based style-library rotation offset: the scan prompt lists the matrix
 * starting at this index and instructs the model to prefer earlier entries on
 * ties, so favourite styles drift every `rotationDays` without repetition
 * (plan §3.2-② "随机轮换机制").
 * @param rotationDays - the configured rotation period.
 * @param epochDays - whole days since the Unix epoch (local calendar days).
 * @param matrix - the effective style library (built-ins + custom styles).
 * @returns an offset in [0, matrix.length).
 */
export declare function rotationOffset(rotationDays: number, epochDays: number, matrix: readonly DreamStyleDef[]): number;
/**
 * Rotated style list for the scan prompt.
 * @param offset - the rotation offset from {@link rotationOffset}.
 * @param matrix - the effective style library (built-ins + custom styles).
 * @returns the matrix ordered starting at `offset`.
 */
export declare function rotatedStyles(offset: number, matrix: readonly DreamStyleDef[]): readonly DreamStyleDef[];
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
 * @param matrix - the effective style library the scan style is checked against.
 */
export declare function coerceScan(raw: unknown, matrix: readonly DreamStyleDef[]): DreamScan | undefined;
