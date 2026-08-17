/**
 * Prompt builders for the two dream stages: the emotion scan ("读心" +
 * "导演") and the dream generation ("开拍"). The scan prompt embeds the
 * style matrix in rotated order with structural hints; the generation prompt
 * injects the drawn noise seeds and demands first-person sensory prose.
 *
 * @module dsh-dream-incubator/engine/prompts
 */
import type { DreamRequest, DreamStyleDef } from '../types.ts';
/** The scan stage's strict JSON contract, spelled for the model. */
export declare const SCAN_JSON_CONTRACT = "Return ONLY a JSON object with exactly these fields:\n{\n  \"mood\": { \"valence\": -1..1, \"arousal\": -1..1, \"dominance\": -1..1 },\n  \"moodLabel\": \"a short human phrase like \u75B2\u60EB\u4E2D\u5E26\u70B9\u6D6A\u6F2B\",\n  \"themes\": [\"topic 1\", \"topic 2\", \"up to 4\"],\n  \"style\": \"the chosen style id\"\n}";
/** The generation stage's prose contract. */
export declare const DREAM_PROSE_CONTRACT: string;
/** Build the emotion-scan user prompt ("读心" + "导演" in one pass). */
export declare function scanPrompt(request: DreamRequest, styles: readonly DreamStyleDef[], hints: readonly string[]): string;
/** Build the dream-generation user prompt ("开拍"). */
export declare function dreamPrompt(request: DreamRequest, style: DreamStyleDef, scanMoodLabel: string, themes: readonly string[]): string;
