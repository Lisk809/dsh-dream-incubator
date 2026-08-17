/**
 * WebUI route suite: boot registerDreamWebUi on a bare cordis context with a
 * stubbed httpServer service that captures route registrations, then drive
 * the handlers with mock request/response pairs. Covers the page, static
 * assets (MIME guard + path confinement), the ledger API, the settings
 * endpoint, and the SSE push channel.
 *
 * The real `readFile` is mocked so no asset needs to exist on disk; path
 * confinement is asserted on the recorded readFile calls instead.
 */

import { Context } from '@deepseek-ai/cordis'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerDreamWebUi } from '../src/webui/server.ts'
import { resolveDreamIncubatorConfig } from '../src/index.ts'
import { DreamStore } from '../src/store.ts'
import { DreamId } from '../src/types.ts'
import type { DreamIncubatorConfig, DreamRecord } from '../src/types.ts'

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: readFileMock }
})

/** The resolved webui root inside this repo (server.ts computes the same). */
const WEBUI_ROOT = `${join(process.cwd(), 'src', 'webui')}${sep}`

/** One route captured by the stub httpServer. */
interface CapturedRoute {
  kind: string
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => unknown
}

/** A minimal ServerResponse double: records status, headers, and chunks. */
class MockResponse {
  statusCode = 0
  headers: Record<string, string | number | undefined> = {}
  chunks: Buffer[] = []
  ended = false
  writableEnded = false

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.statusCode = status
    Object.assign(this.headers, headers)
    return this
  }

  write(chunk: string | Buffer): boolean {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return true
  }

  end(payload?: string | Buffer): void {
    if (payload !== undefined) {
      this.chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(payload))
    }
    this.ended = true
    this.writableEnded = true
  }

  /** The full response text once ended. */
  text(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

/** A minimal IncomingMessage double: an event emitter with method/url. */
function mockReq(method: string, url: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & { method: string; url: string }
  req.method = method
  req.url = url
  ;(req as IncomingMessage & { destroy: () => void }).destroy = () => {}
  return req as IncomingMessage
}

/** A structurally complete dream record fixture. */
function record(id: string, createdAt: number, overrides: Partial<DreamRecord> = {}): DreamRecord {
  return {
    id: DreamId(id),
    sessionId: 'sess-webui',
    createdAt,
    style: 'noir',
    title: `梦 ${id}`,
    text: '走廊尽头的窗',
    mood: { valence: 0.2, arousal: -0.1, dominance: 0.4 },
    moodLabel: '安静的专注',
    themes: ['构建'],
    noiseSeeds: ['重力反转'],
    materialSeqs: [1, 2, 3],
    collected: false,
    forgotten: false,
    ...overrides,
  }
}

function baseConfig(storePath: string): DreamIncubatorConfig {
  return resolveDreamIncubatorConfig({
    cooldownMs: 3_600_000,
    minMaterialEvents: 4,
    maxDailyDreams: 8,
    styleRotationDays: 4,
    noiseIntensity: 'medium',
    maxOutputTokens: 500,
    timeoutMs: 120_000,
    privacyMode: false,
    storePath,
    serveUi: true,
  })
}

interface Harness {
  registered: CapturedRoute[]
  disposers: Array<ReturnType<typeof vi.fn>>
  store: DreamStore
  config: DreamIncubatorConfig
  webui: ReturnType<typeof registerDreamWebUi>
}

/** Boot the webui with a capturing httpServer stub and a temp-dir store. */
function setup(storePath: string, config?: DreamIncubatorConfig): Harness {
  const ctx = new Context()
  const registered: CapturedRoute[] = []
  const disposers: Array<ReturnType<typeof vi.fn>> = []
  ctx.reflect.provide('httpServer', {
    register: (route: CapturedRoute) => {
      registered.push(route)
      const disposer = vi.fn()
      disposers.push(disposer)
      return disposer
    },
  } as never)
  const resolved = config ?? baseConfig(storePath)
  const store = DreamStore.open(storePath)
  const webui = registerDreamWebUi(ctx, store, resolved)
  return { registered, disposers, store, config: resolved, webui }
}

/** Find one captured route by kind and path. */
function route(harness: Harness, kind: string, path: string) {
  const found = harness.registered.find((candidate) => candidate.kind === kind && candidate.path === path)
  expect(found, `route ${kind} ${path}`).toBeDefined()
  return found!
}

/** Drive one handler with a mock request; returns the response double.
 *  Flushes one macrotask so async readFile continuations settle. */
async function call(handler: CapturedRoute['handler'], method: string, url: string): Promise<{ req: IncomingMessage; res: MockResponse }> {
  const req = mockReq(method, url)
  const res = new MockResponse()
  void handler(req, res as unknown as ServerResponse)
  await new Promise((resolve) => setImmediate(resolve))
  return { req, res }
}

/** Drive one handler with a JSON body through the real readBody path. */
async function callWithBody(
  handler: CapturedRoute['handler'],
  method: string,
  url: string,
  chunks: Array<string | Buffer>,
): Promise<MockResponse> {
  const req = mockReq(method, url)
  const res = new MockResponse()
  const done = handler(req, res as unknown as ServerResponse)
  for (const chunk of chunks) req.emit('data', Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  req.emit('end')
  await done
  return res
}

describe('webui routes', () => {
  let dir: string
  let storePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dream-webui-'))
    storePath = join(dir, 'dreams.json')
    readFileMock.mockReset()
    readFileMock.mockResolvedValue(Buffer.from('<!doctype html>'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers the full /dreams route family', () => {
    const harness = setup(storePath)
    expect(harness.registered).toHaveLength(5)
    expect(harness.registered.map((candidate) => `${candidate.kind} ${candidate.path}`)).toEqual([
      'exact /dreams',
      'prefix /dreams/assets',
      'exact /dreams/api/dreams',
      'exact /dreams/api/settings',
      'exact /dreams/api/stream',
    ])
  })

  it('serves the page with an html content type from the webui root', async () => {
    const harness = setup(storePath)
    const { res } = await call(route(harness, 'exact', '/dreams').handler, 'GET', '/dreams')
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(res.text()).toBe('<!doctype html>')
    const readPath = readFileMock.mock.calls[0]?.[0] as string
    expect(readPath.startsWith(WEBUI_ROOT)).toBe(true)
    expect(readPath.endsWith(`${sep}index.html`)).toBe(true)
  })

  it('serves known static assets with the right content type', async () => {
    const harness = setup(storePath)
    const { res } = await call(route(harness, 'prefix', '/dreams/assets').handler, 'GET', '/dreams/assets/dreams.css')
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('text/css; charset=utf-8')
  })

  it('rejects unknown asset extensions without touching the disk', async () => {
    const harness = setup(storePath)
    const { res } = await call(route(harness, 'prefix', '/dreams/assets').handler, 'GET', '/dreams/assets/evil.bin')
    expect(res.statusCode).toBe(404)
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('confines every asset read to the webui root', async () => {
    const harness = setup(storePath)
    const handler = route(harness, 'prefix', '/dreams/assets').handler
    const attempts = [
      '/dreams/assets/../../etc/passwd',
      '/dreams/assets/..%2f..%2fetc%2fpasswd',
      '/dreams/assets/%2e%2e/%2e%2e/secret',
    ]
    for (const url of attempts) {
      await call(handler, 'GET', url)
    }
    for (const [readPath] of readFileMock.mock.calls) {
      expect(String(readPath).startsWith(WEBUI_ROOT)).toBe(true)
    }
  })

  it('lists the ledger as JSON, newest first', async () => {
    const harness = setup(storePath)
    harness.store.append(record('r1', 1000))
    harness.store.append(record('r2', 2000))
    const { res } = await call(route(harness, 'exact', '/dreams/api/dreams').handler, 'GET', '/dreams/api/dreams')
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8')
    const body = JSON.parse(res.text()) as { records: DreamRecord[] }
    expect(body.records.map((candidate) => candidate.id)).toEqual([DreamId('r2'), DreamId('r1')])
  })

  it('collects a dream and persists the flag', async () => {
    const harness = setup(storePath)
    harness.store.append(record('r1', 1000))
    const res = await callWithBody(
      route(harness, 'exact', '/dreams/api/dreams').handler,
      'POST',
      '/dreams/api/dreams',
      [JSON.stringify({ id: 'r1', action: 'collect' })],
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.text()) as { record: DreamRecord }
    expect(body.record.collected).toBe(true)
    expect(body.record.forgotten).toBe(false)
    expect(DreamStore.open(storePath).byId(DreamId('r1'))?.collected).toBe(true)
  })

  it('forgets a dream and clears the collect flag', async () => {
    const harness = setup(storePath)
    harness.store.append(record('r1', 1000, { collected: true }))
    const res = await callWithBody(
      route(harness, 'exact', '/dreams/api/dreams').handler,
      'POST',
      '/dreams/api/dreams',
      [JSON.stringify({ id: 'r1', action: 'forget' })],
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.text()) as { record: DreamRecord }
    expect(body.record.forgotten).toBe(true)
    expect(body.record.collected).toBe(false)
  })

  it('rejects a mutation without an id', async () => {
    const harness = setup(storePath)
    const res = await callWithBody(
      route(harness, 'exact', '/dreams/api/dreams').handler,
      'POST',
      '/dreams/api/dreams',
      [JSON.stringify({ action: 'collect' })],
    )
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.text())).toEqual({ error: 'missing id' })
  })

  it('rejects a mutation for an unknown dream', async () => {
    const harness = setup(storePath)
    const res = await callWithBody(
      route(harness, 'exact', '/dreams/api/dreams').handler,
      'POST',
      '/dreams/api/dreams',
      [JSON.stringify({ id: 'ghost', action: 'collect' })],
    )
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.text())).toEqual({ error: 'dream not found' })
  })

  it('rejects malformed JSON bodies', async () => {
    const harness = setup(storePath)
    const res = await callWithBody(
      route(harness, 'exact', '/dreams/api/dreams').handler,
      'POST',
      '/dreams/api/dreams',
      ['not json at all'],
    )
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.text())).toEqual({ error: 'invalid request' })
  })

  it('rejects oversized bodies through the read cap', async () => {
    const harness = setup(storePath)
    const res = await callWithBody(
      route(harness, 'exact', '/dreams/api/dreams').handler,
      'POST',
      '/dreams/api/dreams',
      [Buffer.alloc(2 * 1024 * 1024, 0x61)],
    )
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.text())).toEqual({ error: 'invalid request' })
  })

  it('rejects unsupported methods on the ledger API', async () => {
    const harness = setup(storePath)
    const { res } = await call(route(harness, 'exact', '/dreams/api/dreams').handler, 'PUT', '/dreams/api/dreams')
    expect(res.statusCode).toBe(405)
  })

  it('exposes the settings pick-list without the store path', async () => {
    const harness = setup(storePath)
    const { res } = await call(route(harness, 'exact', '/dreams/api/settings').handler, 'GET', '/dreams/api/settings')
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.text()) as { settings: Record<string, unknown> }
    expect(body.settings).toEqual({
      cooldownMs: 3_600_000,
      minMaterialEvents: 4,
      maxDailyDreams: 8,
      styleRotationDays: 4,
      noiseIntensity: 'medium',
      maxOutputTokens: 500,
      timeoutMs: 120_000,
      privacyMode: false,
      serveUi: true,
      route: null,
      styles: [
        { id: 'cyberpunk', nameZh: '赛博朋克 / 废土', palette: 'cyberpunk' },
        { id: 'fantasy', nameZh: '奇幻冒险', palette: 'fantasy' },
        { id: 'noir', nameZh: '黑色悬疑', palette: 'noir' },
        { id: 'surreal', nameZh: '超现实主义', palette: 'surreal' },
        { id: 'fable', nameZh: '童话寓言', palette: 'fable' },
        { id: 'horror', nameZh: '恐怖怪诞', palette: 'horror' },
      ],
    })
    expect('storePath' in body.settings).toBe(false)
  })

  it('exposes custom styles in the settings pick-list', async () => {
    const customConfig = resolveDreamIncubatorConfig({
      ...baseConfig(storePath),
      styles: [{
        id: 'cosmic',
        nameZh: '星际漂流',
        nameEn: 'Cosmic Drift',
        trigger: 'boredom',
        imagery: ['深空尘埃', '失重的茶'],
      }],
    })
    const harness = setup(storePath, customConfig)
    const { res } = await call(route(harness, 'exact', '/dreams/api/settings').handler, 'GET', '/dreams/api/settings')
    const body = JSON.parse(res.text()) as { settings: { styles: Array<{ id: string; nameZh: string; palette: string }> } }
    expect(body.settings.styles).toHaveLength(7)
    expect(body.settings.styles[6]).toEqual({ id: 'cosmic', nameZh: '星际漂流', palette: 'cosmic' })
  })

  it('reports the model route when one is configured', async () => {
    const config = resolveDreamIncubatorConfig({
      ...baseConfig(storePath),
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    const harness = setup(storePath, config)
    const { res } = await call(route(harness, 'exact', '/dreams/api/settings').handler, 'GET', '/dreams/api/settings')
    const body = JSON.parse(res.text()) as { settings: { route: string | null } }
    expect(body.settings.route).toBe('deepseek/deepseek-chat')
  })

  it('rejects mutations on the settings endpoint', async () => {
    const harness = setup(storePath)
    const { res } = await call(route(harness, 'exact', '/dreams/api/settings').handler, 'POST', '/dreams/api/settings')
    expect(res.statusCode).toBe(405)
  })

  it('streams SSE frames to clients and drops them on close', async () => {
    const harness = setup(storePath)
    const { req, res } = await call(route(harness, 'exact', '/dreams/api/stream').handler, 'GET', '/dreams/api/stream')
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('text/event-stream; charset=utf-8')
    expect(res.chunks.join('')).toContain(': connected\n\n')

    const dream = record('r1', 1000)
    harness.webui.push(dream)
    expect(res.chunks.join('')).toContain(`data: ${JSON.stringify(dream)}\n\n`)

    const frames = res.chunks.length
    req.emit('close')
    harness.webui.push(record('r2', 2000))
    expect(res.chunks.length).toBe(frames)
  })

  it('heartbeats connected clients', () => {
    vi.useFakeTimers()
    try {
      const harness = setup(storePath)
      // SSE 处理器全同步；不走 call()（其 setImmediate 冲刷会被假时钟卡住）
      const req = mockReq('GET', '/dreams/api/stream')
      const res = new MockResponse()
      route(harness, 'exact', '/dreams/api/stream').handler(req, res as unknown as ServerResponse)
      const frames = res.chunks.length
      vi.advanceTimersByTime(25_000)
      expect(res.chunks.length).toBeGreaterThan(frames)
      expect(res.chunks.join('')).toContain(': ping\n\n')
      harness.webui.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('disposes every route, ends clients, and silences push', async () => {
    const harness = setup(storePath)
    const { res } = await call(route(harness, 'exact', '/dreams/api/stream').handler, 'GET', '/dreams/api/stream')
    harness.webui.dispose()
    for (const disposer of harness.disposers) {
      expect(disposer).toHaveBeenCalledTimes(1)
    }
    expect(res.ended).toBe(true)
    const frames = res.chunks.length
    harness.webui.push(record('r9', 9000))
    expect(res.chunks.length).toBe(frames)
  })

  it('fails loud when the httpServer service is missing', () => {
    const ctx = new Context()
    const store = DreamStore.open(storePath)
    expect(() => registerDreamWebUi(ctx, store, baseConfig(storePath))).toThrow(/httpServer/)
  })
})
