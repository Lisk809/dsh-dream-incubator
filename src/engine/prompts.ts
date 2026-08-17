/**
 * Prompt builders for the two dream stages: the emotion scan ("读心" +
 * "导演") and the dream generation ("开拍"). The scan prompt embeds the
 * style matrix in rotated order with structural hints; the generation prompt
 * injects the drawn noise seeds and demands first-person sensory prose.
 *
 * @module dsh-dream-incubator/engine/prompts
 */

import type {
  DreamRequest,
  DreamStyleDef,
  MaterialLine,
  MaterialStats,
} from '../types.ts'

/** The scan stage's strict JSON contract, spelled for the model. */
export const SCAN_JSON_CONTRACT = `Return ONLY a JSON object with exactly these fields:
{
  "mood": { "valence": -1..1, "arousal": -1..1, "dominance": -1..1 },
  "moodLabel": "a short human phrase like 疲惫中带点浪漫",
  "themes": ["topic 1", "topic 2", "up to 4"],
  "style": "the chosen style id"
}`

/** The generation stage's prose contract. */
export const DREAM_PROSE_CONTRACT = [
  'Write a 200-300 character first-person stream-of-consciousness dream in Chinese.',
  'Rules:',
  '- Physical laws may fail. Time may jump. People and places may shift without explanation.',
  '- Amplify the senses: touch, smell, sight, hearing. Feel every surface.',
  '- Weave in EVERY noise seed literally, and keep the emotional continuity intact.',
  '- Do not explain, frame, or summarize the dream. Do not mention that this is a dream.',
  '- Return only the dream prose, no title, no quotes, no commentary.',
].join('\n')

/** Describe one style matrix row in the compact table form the model reads. */
function styleLine(def: DreamStyleDef, index: number): string {
  return `${index + 1}. ${def.id} — ${def.nameZh}: 触发于${def.trigger}，意象 ${def.imagery.join('、')}`
}

/** Describe the material window as digest lines for the scan prompt. */
function digestLines(
  lines: readonly MaterialLine[],
  stats: MaterialStats,
  privacyMode: boolean,
): string {
  const header = [
    `共 ${stats.eventCount} 条记录：`,
    `用户消息 ${stats.userMessageCount} 条，回复 ${stats.assistantMessageCount} 条，工具调用 ${stats.toolCallCount} 次，错误 ${stats.errorCount} 次。`,
  ]
  const body = lines.map(line => {
    switch (line.kind) {
      case 'user':
        return privacyMode ? `[${line.seq}] 用户消息（内容已隐藏）` : `[${line.seq}] 用户: ${line.text}`
      case 'assistant':
        return `[${line.seq}] 助手: ${line.text}`
      case 'tool':
        return `[${line.seq}] 工具: ${line.text}`
      case 'error':
        return `[${line.seq}] 错误: ${line.text}`
      /* v8 ignore next -- MaterialLine.kind is closed and every member is handled above */
      default:
        return `[${line.seq}] 记录`
    }
  })
  return [...header, ...body].join('\n')
}

/** Build the emotion-scan user prompt ("读心" + "导演" in one pass). */
export function scanPrompt(
  request: DreamRequest,
  styles: readonly DreamStyleDef[],
  hints: readonly string[],
): string {
  return [
    'You are a dream analyst inside an AI coding agent. Read the day\'s material below and decide what the agent\'s subconscious should dream about tonight.',
    '',
    'Material (ascending seq, latest last):',
    digestLines(request.materialLines, request.stats, request.privacyMode),
    '',
    'Structural hints: ' + hints.join('；') + '。',
    '',
    'Style library (pick the best fit; on ties prefer the earlier entry):',
    ...styles.map((def, index) => styleLine(def, index)),
    '',
    SCAN_JSON_CONTRACT,
  ].join('\n')
}

/** Build the dream-generation user prompt ("开拍"). */
export function dreamPrompt(request: DreamRequest, style: DreamStyleDef, scanMoodLabel: string, themes: readonly string[]): string {
  return [
    'You are the dreaming part of an AI coding agent. Tonight the subconscious has material, a mood, a style, and a few absurd noise seeds. Write the dream.',
    '',
    `Mood of the day: ${scanMoodLabel}（PAD ${request.privacyMode ? '私密模式，仅保留情绪值' : '已分析'}）.`,
    `Theme fragments: ${themes.length > 0 ? themes.join('、') : '无'}。`,
    `Style: ${style.id}（${style.nameZh}）. Imagery to draw from: ${style.imagery.join('、')}.`,
    `Noise seeds to weave in verbatim: ${request.noiseSeeds.join('、')}.`,
    '',
    DREAM_PROSE_CONTRACT,
  ].join('\n')
}
