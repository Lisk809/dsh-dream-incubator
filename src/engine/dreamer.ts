/**
 * Dream cycle orchestration ("处理层"): emotion scan → style decision →
 * noise draw → dream generation, over one auxiliary LLM route, producing a
 * {@link DreamRecord} for the store. Mirrors the auxiliary-call policy of
 * dsh-session-title-llm: deadline-wrapped `ctx.llm.stream`, BlockAssembler
 * finish mapping, and an exact system/user framing.
 *
 * @module dsh-dream-incubator/engine/dreamer
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  BlockAssembler,
  createUserMessage,
  deepFreeze,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { dreamPrompt, scanPrompt } from './prompts.ts'
import { materialFromEvents, materialStats, selectWindow } from './material.ts'
import { drawNoise } from './noise.ts'
import {
  coerceScan,
  heuristicMoodHints,
  rotationOffset,
  rotatedStyles,
  styleDef,
} from './styles.ts'
import { DreamId } from '../types.ts'
import type {
  DreamIncubatorConfig,
  DreamRecord,
  DreamRequest,
  DreamScan,
  ModelRoute,
} from '../types.ts'

/** Cap one dream cycle's end-to-end run. */
export const DREAM_TIMEOUT_CODE = 'DREAM_TIMEOUT'

/** Raised when a dream cycle cannot resolve a model route. */
export class DreamRouteError extends Error {
  readonly code = 'DREAM_ROUTE_UNAVAILABLE'
}

/** Raised when the material window carries no usable content. */
export class DreamMaterialEmptyError extends Error {
  readonly code = 'DREAM_MATERIAL_EMPTY'
}

/** Raised when the scan stage returns an unparseable or invalid record. */
export class DreamScanError extends Error {
  readonly code = 'DREAM_SCAN_INVALID'
}

/** UTC calendar days since the epoch — the rotation clock. */
function epochDays(now: number): number {
  return Math.floor(now / 86_400_000)
}

/**
 * Resolve the auxiliary route: the configured explicit pair wins; otherwise
 * the latest logged `request/header` of the session.
 * @param config - validated incubator configuration.
 * @param events - the session log (ascending).
 * @returns the provider/model pair.
 * @throws {@link DreamRouteError} when neither source yields a route.
 */
export function resolveRoute(
  config: DreamIncubatorConfig,
  events: readonly SessionEvent[],
): ModelRoute {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== undefined && event.type === 'request/header') {
      const header = event.data.header.config
      if (typeof header.provider === 'string' && typeof header.model === 'string') {
        return { provider: header.provider, model: header.model }
      }
    }
  }
  throw new DreamRouteError(
    'dream-incubator: no logged request route is available; configure provider and model together',
  )
}

/** Map terminal finish reasons onto auxiliary-call failures. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('dream-incubator: dream output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('dream-incubator: dream model unexpectedly requested a tool')
    /* v8 ignore next -- FinishReason is closed and every variant is handled above */
    default:
      return new Error(`dream-incubator: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/** Collect the text of one auxiliary response. */
async function streamText(
  ctx: Context,
  options: GenerateOptions,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  const text = assembler.blocks()
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  if (text.length === 0) throw new Error('dream-incubator: auxiliary model produced no text')
  return text
}

/** Frame one auxiliary request exactly as it will reach the provider. */
function frameCall(
  route: ModelRoute,
  sessionId: SessionId,
  system: string,
  user: string,
  maxTokens: number,
  signal: AbortSignal,
): GenerateOptions {
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: user }],
    source: { kind: 'plugin', plugin: 'dsh-dream-incubator' },
  })]
  return deepFreeze({
    provider: route.provider,
    model: route.model,
    messages,
    system,
    maxTokens,
    sessionId,
    signal,
  })
}

/** Run the emotion-scan stage; returns the raw model text. */
async function runScan(
  ctx: Context,
  config: DreamIncubatorConfig,
  route: ModelRoute,
  sessionId: SessionId,
  request: DreamRequest,
  signal: AbortSignal,
): Promise<string> {
  const styles = rotatedStyles(request.rotationOffset)
  const hints = heuristicMoodHints(request.stats)
  const options = frameCall(
    route,
    sessionId,
    'You are a dream analyst. Follow the contract exactly.',
    scanPrompt(request, styles, hints),
    config.maxOutputTokens,
    signal,
  )
  return streamText(ctx, options, signal)
}

/** Run the generation stage. */
async function runDream(
  ctx: Context,
  config: DreamIncubatorConfig,
  route: ModelRoute,
  sessionId: SessionId,
  request: DreamRequest,
  scan: DreamScan,
  signal: AbortSignal,
): Promise<string> {
  const style = styleDef(scan.style)
  const options = frameCall(
    route,
    sessionId,
    'You are the dreaming part of an AI agent. Follow the contract exactly.',
    dreamPrompt(request, style, scan.moodLabel, scan.themes),
    config.maxOutputTokens,
    signal,
  )
  return streamText(ctx, options, signal)
}

/** Split the generator output into title (first line) and dream prose. */
export function splitDreamOutput(output: string): { title: string; text: string } {
  const [first, ...rest] = output.split('\n')
  const title = (first ?? '')
    .trim()
    .replace(/^["'「『]/u, '')
    .replace(/["'」』]$/u, '')
    .slice(0, 24)
  const text = rest.join('\n').trim()
  return { title: title.length > 0 ? title : '无题之梦', text: text.length > 0 ? text : output }
}

/** Parse and validate the scan JSON; an invalid record fails loud. */
export function parseScan(rawText: string): DreamScan {
  let parsed: unknown
  try {
    const json = rawText
      .replace(/^```(?:json)?\s*/u, '')
      .replace(/\s*```$/u, '')
      .trim()
    parsed = JSON.parse(json) as unknown
  } catch {
    throw new DreamScanError('dream-incubator: scan stage returned unparseable JSON')
  }
  const scan = coerceScan(parsed)
  if (scan === undefined) {
    throw new DreamScanError('dream-incubator: scan stage returned an invalid record (style not in the matrix or malformed mood)')
  }
  return scan
}

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
export async function generateDream(
  ctx: Context,
  config: DreamIncubatorConfig,
  session: Session,
  sinceSeq: number | undefined,
  rng: () => number = Math.random,
  externalSignal?: AbortSignal,
): Promise<DreamRecord> {
  const events = session.events
  const window = selectWindow(events, sinceSeq)
  const lines = materialFromEvents(window)
  const stats = materialStats(lines)
  if (lines.length === 0) {
    throw new DreamMaterialEmptyError('dream-incubator: no material to dream about')
  }
  const route = resolveRoute(config, events)
  const now = Date.now()
  const request: DreamRequest = {
    sessionId: session.id,
    materialSeqs: lines.map(line => line.seq),
    materialLines: lines,
    stats,
    rotationOffset: rotationOffset(config.styleRotationDays, epochDays(now)),
    noiseSeeds: drawNoise(config.noiseIntensity, rng),
    privacyMode: config.privacyMode,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    noiseIntensity: config.noiseIntensity,
  }
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort()
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', forwardAbort, { once: true })
  }
  try {
    using callDeadline = deadline(controller.signal, config.timeoutMs, DREAM_TIMEOUT_CODE)
    const scanText = await runScan(ctx, config, route, session.id, request, callDeadline.signal)
    const scan = parseScan(scanText)
    const dreamText = await runDream(ctx, config, route, session.id, request, scan, callDeadline.signal)
    const { title, text } = splitDreamOutput(dreamText)
    return {
      id: DreamId(`dream-${randomUUID()}`),
      sessionId: session.id,
      createdAt: now,
      style: scan.style,
      title,
      text,
      mood: scan.mood,
      moodLabel: scan.moodLabel,
      themes: scan.themes,
      noiseSeeds: request.noiseSeeds,
      materialSeqs: request.materialSeqs,
      collected: false,
      forgotten: false,
    }
  } finally {
    if (externalSignal !== undefined) externalSignal.removeEventListener('abort', forwardAbort)
    controller.abort()
  }
}
