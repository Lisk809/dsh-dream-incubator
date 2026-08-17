/**
 * Activation-Synthesis noise stage ("开拍"素材): a library of absurd
 * elements injected into the dream prompt, forcing the generator to weave
 * random signal into the narrative — the waking brain's way of "脑补"
 * a story out of noise (plan §3.2-③).
 *
 * @module dsh-dream-incubator/engine/noise
 */

import type { NoiseIntensity } from '../types.ts'

/** One absurd element, tagged by boldness bucket. */
export interface NoiseElement {
  readonly id: string
  /** Chinese name used verbatim in the generation prompt. */
  readonly text: string
  readonly bucket: 'mild' | 'bold' | 'absurd'
}

/** The noise library; every element must stay JSON-free of punctuation traps. */
export const NOISE_LIBRARY: readonly NoiseElement[] = [
  { id: 'octopus-suit', text: '穿西装的章鱼', bucket: 'bold' },
  { id: 'gravity-flip', text: '重力反转的房间', bucket: 'absurd' },
  { id: 'singing-code', text: '会唱歌的代码', bucket: 'mild' },
  { id: 'melting-keyboard', text: '融化的键盘', bucket: 'bold' },
  { id: 'backwards-clock', text: '倒放的时钟', bucket: 'mild' },
  { id: 'lying-rabbit', text: '说谎的兔子', bucket: 'bold' },
  { id: 'mirror-world', text: '镜中世界', bucket: 'mild' },
  { id: 'riddle-man', text: '只会出谜语的人', bucket: 'mild' },
  { id: 'stairway-water', text: '楼梯尽头的水面', bucket: 'absurd' },
  { id: 'flying-teacup', text: '飞行的茶杯', bucket: 'bold' },
  { id: 'elevator-forest', text: '电梯里的森林', bucket: 'absurd' },
  { id: 'whale-code', text: '吞下代码的鲸鱼', bucket: 'bold' },
  { id: 'vending-void', text: '无人的自动售货机', bucket: 'mild' },
  { id: 'fingerprint-note', text: '备忘录上的指纹', bucket: 'mild' },
  { id: 'star-drawer', text: '抽屉里的星空', bucket: 'bold' },
  { id: 'rainy-server-room', text: '下雨的服务器机房', bucket: 'bold' },
  { id: 'neon-crow', text: '用霓虹写字的乌鸦', bucket: 'absurd' },
  { id: 'unopenable-door', text: '一扇永远打不开的门', bucket: 'mild' },
  { id: 'talking-moon', text: '会说话的月亮', bucket: 'mild' },
  { id: 'clock-of-moss', text: '长满苔藓的怀表', bucket: 'absurd' },
]

/**
 * The draw sizes per intensity: how many absurd elements the generator must
 * weave in (plan §3.2-③ 随机噪声种子).
 */
export const NOISE_DRAW_SIZES: Record<NoiseIntensity, readonly [number, number]> = {
  low: [1, 1],
  medium: [1, 2],
  high: [2, 3],
}

/**
 * Draw distinct noise elements for one dream. The draw pools whole library
 * and samples without replacement; a high draw takes from the bolder buckets
 * first, so intensity actually escalates the absurdity.
 * @param intensity - the configured noise strength.
 * @param rng - random source for testability; defaults to Math.random.
 * @returns the drawn element texts.
 */
export function drawNoise(
  intensity: NoiseIntensity,
  rng: () => number = Math.random,
): readonly string[] {
  const [min, max] = NOISE_DRAW_SIZES[intensity]
  const count = min + Math.floor(rng() * (max - min + 1))
  const pool = intensity === 'high'
    ? [...NOISE_LIBRARY].sort((a, b) => bucketRank(b) - bucketRank(a))
    : [...NOISE_LIBRARY]
  const drawn: NoiseElement[] = []
  while (drawn.length < count && pool.length > 0) {
    const at = Math.floor(rng() * pool.length)
    const [element] = pool.splice(at, 1)
    if (element !== undefined) drawn.push(element)
  }
  return drawn.map(element => element.text)
}

/** Order buckets so higher intensity prefers bolder elements. */
function bucketRank(element: NoiseElement): number {
  switch (element.bucket) {
    case 'absurd': return 2
    case 'bold': return 1
    case 'mild': return 0
    /* v8 ignore next -- NoiseElement.bucket is closed and every member is handled above */
    default: return 0
  }
}
