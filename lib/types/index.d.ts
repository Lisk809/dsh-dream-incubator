/**
 * dsh-dream-incubator main entry ("应用层"装配): config validation with no
 * library defaults, the dream ledger lifecycle, cadence-gated dream cycles
 * triggered on the `session/event` firehose, the /dream /dreams
 * /dreamsettings commands, and (optionally) the /dreams WebUI.
 *
 * The dream cadence follows the incubation-effect policy (plan §3.2-①):
 * dreams happen quietly after turns, gated by an hourly cooldown, a minimum
 * material window, and a daily cap. Failures log and retry on the next turn;
 * the model route falls back to the session's own logged `request/header`.
 *
 * @module dsh-dream-incubator
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { DreamIncubatorConfig } from './types.ts';
/** Cordis plugin name. */
export declare const name = "dream-incubator";
/** Services the plugin needs before it can run a dream cycle. */
export declare const inject: string[];
/** Shared Loader field schemas with no library defaults. */
export declare const DreamIncubatorConfigFields: {
    cooldownMs: z<number, number>;
    minMaterialEvents: z<number, number>;
    maxDailyDreams: z<number, number>;
    styleRotationDays: z<number, number>;
    noiseIntensity: z<"low" | "medium" | "high", "low" | "medium" | "high">;
    maxOutputTokens: z<number, number>;
    timeoutMs: z<number, number>;
    privacyMode: z<boolean, boolean>;
    provider: z<string, string>;
    model: z<string, string>;
    styles: z<({
        id?: string | null | undefined;
        nameZh?: string | null | undefined;
        nameEn?: string | null | undefined;
        trigger?: "fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict" | null | undefined;
        imagery?: string[] | null | undefined;
        palette?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        id: z<string, string>;
        nameZh: z<string, string>;
        nameEn: z<string, string>;
        trigger: z<"fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict", "fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict">;
        imagery: z<string[], string[]>;
        palette: z<string, string>;
    }>[]>;
    storePath: z<string, string>;
    serveUi: z<boolean, boolean>;
};
/** Shared Loader schema with no library defaults. */
export declare const DreamIncubatorConfigSchema: z<Schemastery.ObjectS<{
    cooldownMs: z<number, number>;
    minMaterialEvents: z<number, number>;
    maxDailyDreams: z<number, number>;
    styleRotationDays: z<number, number>;
    noiseIntensity: z<"low" | "medium" | "high", "low" | "medium" | "high">;
    maxOutputTokens: z<number, number>;
    timeoutMs: z<number, number>;
    privacyMode: z<boolean, boolean>;
    provider: z<string, string>;
    model: z<string, string>;
    styles: z<({
        id?: string | null | undefined;
        nameZh?: string | null | undefined;
        nameEn?: string | null | undefined;
        trigger?: "fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict" | null | undefined;
        imagery?: string[] | null | undefined;
        palette?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        id: z<string, string>;
        nameZh: z<string, string>;
        nameEn: z<string, string>;
        trigger: z<"fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict", "fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict">;
        imagery: z<string[], string[]>;
        palette: z<string, string>;
    }>[]>;
    storePath: z<string, string>;
    serveUi: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    cooldownMs: z<number, number>;
    minMaterialEvents: z<number, number>;
    maxDailyDreams: z<number, number>;
    styleRotationDays: z<number, number>;
    noiseIntensity: z<"low" | "medium" | "high", "low" | "medium" | "high">;
    maxOutputTokens: z<number, number>;
    timeoutMs: z<number, number>;
    privacyMode: z<boolean, boolean>;
    provider: z<string, string>;
    model: z<string, string>;
    styles: z<({
        id?: string | null | undefined;
        nameZh?: string | null | undefined;
        nameEn?: string | null | undefined;
        trigger?: "fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict" | null | undefined;
        imagery?: string[] | null | undefined;
        palette?: string | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        id: z<string, string>;
        nameZh: z<string, string>;
        nameEn: z<string, string>;
        trigger: z<"fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict", "fatigue" | "joy" | "anxiety" | "boredom" | "confusion" | "conflict">;
        imagery: z<string[], string[]>;
        palette: z<string, string>;
    }>[]>;
    storePath: z<string, string>;
    serveUi: z<boolean, boolean>;
}>>;
/**
 * Validate and detach required incubator configuration.
 * @param config - untrusted plugin configuration.
 * @returns immutable policy; a missing optional route stays absent.
 */
export declare function resolveDreamIncubatorConfig(config: DreamIncubatorConfig): DreamIncubatorConfig;
/**
 * Apply the dream-incubator plugin.
 * @param ctx - context exposing the LLM and session services.
 * @param config - untrusted required deployment policy.
 */
export declare function apply(ctx: Context, config: DreamIncubatorConfig): void;
