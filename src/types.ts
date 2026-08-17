/**
 * dsh-dream-incubator domain vocabulary: dream records, style matrix
 * identities, PAD emotion vectors, and validated plugin configuration.
 *
 * @module dsh-dream-incubator/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one dream record in the incubator store. */
export type DreamId = Branded<'DreamId'>

/** Brand a string as a {@link DreamId}. */
export function DreamId(id: string): DreamId {
  return id as DreamId
}

/** The six built-in dream styles of the style matrix (plan §3.2-②). */
export const DREAM_STYLES = [
  'cyberpunk',
  'fantasy',
  'noir',
  'surreal',
  'fable',
  'horror',
] as const

/**
 * A style-library identity; also the CSS palette key of the WebUI. Custom
 * styles registered through {@link UserStyleDef} extend beyond the built-in
 * set, so this is an open string rather than the built-in literal union.
 */
export type DreamStyle = string

/** Activation-Synthesis noise strength (plan §3.2-③). */
export type NoiseIntensity = 'low' | 'medium' | 'high'

/**
 * One PAD (pleasure / arousal / dominance) emotion vector, each axis in
 * [-1, 1], returned by the emotion-scan stage ("读心").
 */
export interface PADEmotion {
  readonly valence: number
  readonly arousal: number
  readonly dominance: number
}

/** The mood taxonomy shared by the style matrix (plan §3.2-②). */
export type DreamStyleTrigger = 'fatigue' | 'joy' | 'anxiety' | 'boredom' | 'confusion' | 'conflict'

/** The style matrix row the scan stage chooses between (plan §3.2-②). */
export interface DreamStyleDef {
  readonly id: DreamStyle
  /** Chinese display name shown on the dream card. */
  readonly nameZh: string
  /** English display name. */
  readonly nameEn: string
  /** The mood that most strongly triggers this style. */
  readonly trigger: DreamStyleTrigger
  /** Imagery keywords injected into the generation prompt. */
  readonly imagery: readonly string[]
  /** Card palette: CSS class key used by the WebUI (same id by default). */
  readonly palette: string
}

/**
 * A user-registered style appended to the built-in matrix via the `styles`
 * configuration key. Palette is optional and defaults to the style id
 * (the built-in convention "same id by default").
 */
export interface UserStyleDef {
  readonly id: string
  /** Chinese display name shown on the dream card. */
  readonly nameZh: string
  /** English display name. */
  readonly nameEn: string
  /** The mood that most strongly triggers this style. */
  readonly trigger: DreamStyleTrigger
  /** Imagery keywords injected into the generation prompt. */
  readonly imagery: readonly string[]
  /** Card palette: CSS class key used by the WebUI (style id by default). */
  readonly palette?: string
}

/** A single dream record persisted by the incubator store. */
export interface DreamRecord {
  readonly id: DreamId
  /** The session whose material produced the dream. */
  readonly sessionId: string
  /** Unix epoch milliseconds at creation. */
  readonly createdAt: number
  readonly style: DreamStyle
  /** Short poetic title chosen by the generator. */
  readonly title: string
  /** The first-person dream prose. */
  readonly text: string
  /** PAD emotion vector of the scanned material. */
  readonly mood: PADEmotion
  /** Human-readable mood phrase, e.g. "疲惫中带点浪漫". */
  readonly moodLabel: string
  /** Topics the scan stage distilled from the material. */
  readonly themes: readonly string[]
  /** The absurd elements the Activation-Synthesis stage injected. */
  readonly noiseSeeds: readonly string[]
  /** Seq numbers of the source events cited by this dream. */
  readonly materialSeqs: readonly number[]
  /** Whether the user collected this dream ("收藏此梦"). */
  readonly collected: boolean
  /** Whether the user asked to forget this dream ("嘘，忘掉它"). */
  readonly forgotten: boolean
}

/** One material line distilled from the session log for the scan prompt. */
export interface MaterialLine {
  readonly seq: number
  readonly kind: 'user' | 'assistant' | 'tool' | 'error'
  readonly text: string
}

/** Structural statistics derived from the material window. */
export interface MaterialStats {
  readonly eventCount: number
  readonly userMessageCount: number
  readonly assistantMessageCount: number
  readonly toolCallCount: number
  readonly errorCount: number
}

/** The scan stage's structured answer ("读心" + "导演" decisions). */
export interface DreamScan {
  readonly mood: PADEmotion
  readonly moodLabel: string
  readonly themes: readonly string[]
  readonly style: DreamStyle
}

/** Resolved auxiliary model route (provider/model pair). */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/** One generation request handed to the dream generator. */
export interface DreamRequest {
  readonly sessionId: string
  readonly materialSeqs: readonly number[]
  readonly materialLines: readonly MaterialLine[]
  readonly stats: MaterialStats
  /** The day-based style-library rotation offset, in styles. */
  readonly rotationOffset: number
  readonly noiseSeeds: readonly string[]
  readonly privacyMode: boolean
  readonly maxOutputTokens: number
  readonly timeoutMs: number
  readonly noiseIntensity: NoiseIntensity
}

/** Validated, immutable incubator configuration. */
export interface DreamIncubatorConfig {
  readonly cooldownMs: number
  readonly minMaterialEvents: number
  readonly maxDailyDreams: number
  readonly styleRotationDays: number
  readonly noiseIntensity: NoiseIntensity
  readonly maxOutputTokens: number
  readonly timeoutMs: number
  readonly privacyMode: boolean
  /** Explicit provider override; absent when no route is configured. */
  readonly provider?: string
  /** Explicit model override; must accompany {@link provider}. */
  readonly model?: string
  /** Custom styles appended after the built-in six in the rotation. */
  readonly styles?: readonly UserStyleDef[]
  readonly storePath: string
  readonly serveUi: boolean
}
