/**
 * Activation-Synthesis noise stage ("开拍"素材): a library of absurd
 * elements injected into the dream prompt, forcing the generator to weave
 * random signal into the narrative — the waking brain's way of "脑补"
 * a story out of noise (plan §3.2-③).
 *
 * @module dsh-dream-incubator/engine/noise
 */
import type { NoiseIntensity } from '../types.ts';
/** One absurd element, tagged by boldness bucket. */
export interface NoiseElement {
    readonly id: string;
    /** Chinese name used verbatim in the generation prompt. */
    readonly text: string;
    readonly bucket: 'mild' | 'bold' | 'absurd';
}
/** The noise library; every element must stay JSON-free of punctuation traps. */
export declare const NOISE_LIBRARY: readonly NoiseElement[];
/**
 * The draw sizes per intensity: how many absurd elements the generator must
 * weave in (plan §3.2-③ 随机噪声种子).
 */
export declare const NOISE_DRAW_SIZES: Record<NoiseIntensity, readonly [number, number]>;
/**
 * Draw distinct noise elements for one dream. The draw pools whole library
 * and samples without replacement; a high draw takes from the bolder buckets
 * first, so intensity actually escalates the absurdity.
 * @param intensity - the configured noise strength.
 * @param rng - random source for testability; defaults to Math.random.
 * @returns the drawn element texts.
 */
export declare function drawNoise(intensity: NoiseIntensity, rng?: () => number): readonly string[];
