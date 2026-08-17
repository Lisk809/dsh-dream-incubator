/**
 * Observation-layer tests: material derivation from synthetic session logs,
 * text extraction, truncation, window selection, and statistics.
 */

import { describe, expect, it } from 'vitest'
import {
  MATERIAL_LINE_CHARS,
  extractText,
  materialFromEvents,
  materialStats,
  selectWindow,
  truncate,
} from '../src/engine/material.ts'
import {
  assistantMessageEvent,
  requestHeaderEvent,
  toolCallEvent,
  toolResultEvent,
  turnEndEvent,
  userMessageEvent,
} from './fixtures.ts'

describe('extractText', () => {
  it('collects text blocks and nested tool-result content', () => {
    const text = extractText([
      { type: 'text', text: '第一段' },
      { type: 'tool-result', content: [{ type: 'text', text: '嵌套' }] },
      { type: 'text', text: '第二段' },
    ])
    expect(text).toBe('第一段\n嵌套\n第二段')
  })

  it('ignores non-text blocks', () => {
    expect(extractText([{ type: 'reasoning', text: '想想' }])).toBe('')
  })
})

describe('truncate', () => {
  it('keeps short text and folds whitespace', () => {
    expect(truncate('  a  b ')).toBe('a b')
  })

  it('truncates with an ellipsis at the cap', () => {
    const long = 'x'.repeat(MATERIAL_LINE_CHARS + 40)
    const result = truncate(long)
    expect(result.length).toBe(MATERIAL_LINE_CHARS + 1)
    expect(result.endsWith('…')).toBe(true)
  })
})

describe('materialFromEvents', () => {
  it('derives user, assistant, tool, and error lines in seq order', () => {
    const events = [
      userMessageEvent(1, '帮我写个插件'),
      assistantMessageEvent(2, '好的，我先看下仓库'),
      toolCallEvent(3, 'readFile', '{"path":"/a"}'),
      toolResultEvent(4, '文件内容...'),
      toolResultEvent(5, '炸了', { name: 'EACCES', code: 'EACCES' }),
      turnEndEvent(6),
    ]
    const lines = materialFromEvents(events)
    expect(lines).toEqual([
      { seq: 1, kind: 'user', text: '帮我写个插件' },
      { seq: 2, kind: 'assistant', text: '好的，我先看下仓库' },
      { seq: 3, kind: 'tool', text: '调用 readFile({"path":"/a"})' },
      { seq: 4, kind: 'tool', text: '文件内容...' },
      { seq: 5, kind: 'error', text: '工具失败 EACCES: EACCES' },
    ])
  })

  it('skips empty messages and non-material events', () => {
    const events = [
      userMessageEvent(1, '   '),
      requestHeaderEvent(2, 'deepseek', 'deepseek-chat'),
      assistantMessageEvent(3, ''),
    ]
    expect(materialFromEvents(events)).toEqual([])
  })

  it('turns failed turns into error lines and skips clean ones', () => {
    const events = [turnEndEvent(1), {
      type: 'turn/end',
      seq: 2,
      time: 1000,
      data: { turn: 2, reason: { kind: 'error', error: { name: 'Boom', message: '模型挂了', code: 'X' } } },
    } as never]
    const lines = materialFromEvents(events as never)
    expect(lines).toHaveLength(1)
    expect(lines[0]?.kind).toBe('error')
    expect(lines[0]?.text).toContain('模型挂了')
  })

  it('caps assistant lines at 160 chars and others at their limits', () => {
    const long = '啊'.repeat(500)
    const events = [userMessageEvent(1, long), assistantMessageEvent(2, long)]
    const lines = materialFromEvents(events)
    expect(lines[0]?.text.length).toBeLessThanOrEqual(MATERIAL_LINE_CHARS + 1)
    expect(lines[1]?.text.length).toBeLessThanOrEqual(161)
  })
})

describe('materialStats', () => {
  it('counts each material kind', () => {
    const stats = materialStats([
      { seq: 1, kind: 'user', text: 'a' },
      { seq: 2, kind: 'user', text: 'b' },
      { seq: 3, kind: 'assistant', text: 'c' },
      { seq: 4, kind: 'tool', text: 'd' },
      { seq: 5, kind: 'tool', text: 'e' },
      { seq: 6, kind: 'error', text: 'f' },
    ])
    expect(stats).toEqual({ eventCount: 6, userMessageCount: 2, assistantMessageCount: 1, toolCallCount: 2, errorCount: 1 })
  })
})

describe('selectWindow', () => {
  const events = Array.from({ length: 100 }, (_, i) => userMessageEvent(i + 1, `m${i + 1}`))

  it('returns the trailing window by default', () => {
    expect(selectWindow(events)).toHaveLength(60)
    expect(selectWindow(events)[0]?.seq).toBe(41)
  })

  it('cuts at the sinceSeq boundary when given', () => {
    const window = selectWindow(events, 55)
    expect(window.every(event => event.seq > 55)).toBe(true)
    expect(window[0]?.seq).toBe(56)
  })

  it('returns nothing when sinceSeq is beyond the tail', () => {
    expect(selectWindow(events, 100)).toHaveLength(0)
  })
})
