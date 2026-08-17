/**
 * Synthetic session-event fixtures for unit tests: minimal but shape-true
 * envelopes matching the published dsh-session types.
 */

import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session/types'

/** Build one session event with the exact envelope shape. */
export function event<T extends SessionEventType>(
  type: T,
  data: SessionEvent<T>['data'],
  seq: number,
  time = 1_700_000_000_000 + seq * 1000,
): SessionEvent<T> {
  return { type, seq, time, data } as SessionEvent<T>
}

/** A plain user text message. */
export function userMessageEvent(seq: number, text: string, time?: number): SessionEvent<'user/message'> {
  return event('user/message', { content: [{ type: 'text', text }] }, seq, time)
}

/** A plain assistant text message. */
export function assistantMessageEvent(seq: number, text: string, time?: number): SessionEvent<'assistant/message'> {
  return event('assistant/message', {
    turn: 1,
    step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }, seq, time)
}

/** A tool invocation. */
export function toolCallEvent(seq: number, name: string, args = '{}', time?: number): SessionEvent<'tool/call'> {
  return event('tool/call', { turn: 1, step: 1, callId: `call-${seq}`, name, arguments: args }, seq, time)
}

/** A tool result, optional internal failure identity. */
export function toolResultEvent(
  seq: number,
  text: string,
  error?: { name: string; code: string },
  time?: number,
): SessionEvent<'tool/result'> {
  return event('tool/result', {
    turn: 1,
    step: 1,
    message: { role: 'tool', content: [{ type: 'text', text }] },
    error,
  }, seq, time)
}

/** A completed turn (success by default). */
export function turnEndEvent(seq: number, time?: number): SessionEvent<'turn/end'> {
  return event('turn/end', { turn: 1, reason: { kind: 'completed' } }, seq, time)
}

/** A logged request header carrying the model route. */
export function requestHeaderEvent(seq: number, provider: string, model: string, time?: number): SessionEvent<'request/header'> {
  return event('request/header', {
    header: { config: { provider, model } },
    reason: 'initial',
  }, seq, time)
}
