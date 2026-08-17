/**
 * Dream WebUI ("应用层"): HTTP routes served through the harness webserver.
 * The incubator owns a namespaced route family under /dreams — the immersive
 * page, its static assets, a JSON ledger API, and an SSE stream that pushes
 * each new dream to open pages — so the composition's SPA fallback seat and
 * other plugins are never contested.
 *
 * @module dsh-dream-incubator/webui
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DreamId as brandDreamId } from "../types.js";
import { mergedStyleMatrix } from "../engine/styles.js";
/**
 * The webui root: lib/webui/ (populated from static/ by the build). The
 * layout differs per runtime — `./webui/` beside the bundled index.js,
 * `../../webui/` beside the tsc emit, the legacy `../webui/` in the src
 * checkout — so probe for whichever actually contains the page, and fall
 * back to the legacy relative path.
 */
const WEBUI_CANDIDATES = ['./webui/', '../webui/', '../../webui/'];
let WEBUI_DIR = fileURLToPath(new URL(WEBUI_CANDIDATES[1], import.meta.url));
for (const candidate of WEBUI_CANDIDATES) {
    const dir = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(join(dir, 'index.html'))) {
        WEBUI_DIR = dir;
        break;
    }
}
/** Body size cap for mutation requests. */
const MAX_BODY_BYTES = 1_048_576;
/** MIME map for static assets. */
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
};
/** Send a JSON response with the given status code. */
function writeJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(payload);
}
/** Read and parse a capped JSON request body. */
function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                req.destroy();
                reject(new Error('dream-incubator: request body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                const parsed = text.length > 0 ? JSON.parse(text) : {};
                resolve(typeof parsed === 'object' && parsed !== null ? parsed : {});
            }
            catch {
                reject(new Error('dream-incubator: invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}
/** Serve one static file with a content type; 404 when unknown or unsafe. */
function serveAsset(res, relativePath) {
    const safe = normalize(joinWithin(WEBUI_DIR, relativePath));
    if (!safe.startsWith(WEBUI_DIR) || safe === WEBUI_DIR) {
        res.writeHead(404).end('not found');
        return;
    }
    const type = MIME[extname(safe).toLowerCase()];
    if (type === undefined) {
        res.writeHead(404).end('not found');
        return;
    }
    void readFile(safe).then(data => {
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        res.end(data);
    }, () => {
        res.writeHead(404).end('not found');
    });
}
/** Join without allowing traversal above the webui root. */
function joinWithin(root, relativePath) {
    const cleaned = relativePath.replace(/^\/+/u, '').split('?')[0] ?? '';
    if (cleaned.length === 0)
        return root;
    return `${root.replace(/\/+$/u, '')}/${cleaned}`;
}
/**
 * Register the /dreams route family on the harness webserver.
 * @param ctx - context carrying the `httpServer` service.
 * @param store - the shared dream ledger.
 * @param config - the resolved engine configuration (read-only, deep-frozen);
 *   the settings route exposes an explicit pick-list of it.
 * @returns the push channel and route disposer.
 * @throws when `httpServer` is unavailable (serveUi demanded a host that
 *   cannot serve it — fail loud at load).
 */
export function registerDreamWebUi(ctx, store, config) {
    const httpServer = ctx.httpServer;
    if (httpServer === undefined) {
        throw new Error('dream-incubator: serveUi is enabled but the httpServer service is unavailable');
    }
    const disposers = [];
    const clients = new Set();
    const heartbeat = setInterval(() => {
        for (const client of clients) {
            if (!client.writableEnded)
                client.write(': ping\n\n');
            else
                clients.delete(client);
        }
    }, 25_000);
    heartbeat.unref?.();
    const push = (record) => {
        const frame = `data: ${JSON.stringify(record)}\n\n`;
        for (const client of clients) {
            if (!client.writableEnded)
                client.write(frame);
            else
                clients.delete(client);
        }
    };
    // The immersive page.
    disposers.push(httpServer.register({
        kind: 'exact',
        path: '/dreams',
        handler: (_req, res) => serveAsset(res, 'index.html'),
    }));
    // Static assets (styles, scripts, fonts).
    disposers.push(httpServer.register({
        kind: 'prefix',
        path: '/dreams/assets',
        handler: (req, res) => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const rel = url.pathname.replace(/^\/dreams\/assets/u, '');
            serveAsset(res, rel);
        },
    }));
    // Ledger API: GET lists; POST { id, action } mutates collect/forget.
    disposers.push(httpServer.register({
        kind: 'exact',
        path: '/dreams/api/dreams',
        handler: async (req, res) => {
            if (req.method === 'GET') {
                writeJson(res, 200, { records: store.all() });
                return;
            }
            if (req.method === 'POST') {
                try {
                    const body = await readBody(req);
                    const id = body['id'];
                    if (typeof id !== 'string') {
                        writeJson(res, 400, { error: 'missing id' });
                        return;
                    }
                    const dreamId = brandDreamId(id);
                    const record = body['action'] === 'collect'
                        ? store.collect(dreamId)
                        : body['action'] === 'forget'
                            ? store.forget(dreamId)
                            : undefined;
                    if (record === undefined) {
                        writeJson(res, 404, { error: 'dream not found' });
                        return;
                    }
                    writeJson(res, 200, { record });
                }
                catch {
                    writeJson(res, 400, { error: 'invalid request' });
                }
                return;
            }
            writeJson(res, 405, { error: 'method not allowed' });
        },
    }));
    // 只读引擎设置：星盘控制台的数据源。显式挑拣白名单——storePath
    // 之类的本地路径绝不离开进程。
    disposers.push(httpServer.register({
        kind: 'exact',
        path: '/dreams/api/settings',
        handler: (req, res) => {
            if (req.method !== 'GET') {
                writeJson(res, 405, { error: 'method not allowed' });
                return;
            }
            writeJson(res, 200, {
                settings: {
                    cooldownMs: config.cooldownMs,
                    minMaterialEvents: config.minMaterialEvents,
                    maxDailyDreams: config.maxDailyDreams,
                    styleRotationDays: config.styleRotationDays,
                    noiseIntensity: config.noiseIntensity,
                    maxOutputTokens: config.maxOutputTokens,
                    timeoutMs: config.timeoutMs,
                    privacyMode: config.privacyMode,
                    serveUi: config.serveUi,
                    route: config.provider !== undefined ? `${config.provider}/${config.model}` : null,
                    // The effective style library (built-ins + custom styles), so the
                    // WebUI can render custom style names without a hardcoded map.
                    styles: mergedStyleMatrix(config.styles).map(({ id, nameZh, palette }) => ({ id, nameZh, palette })),
                },
            });
        },
    }));
    // SSE push channel.
    disposers.push(httpServer.register({
        kind: 'exact',
        path: '/dreams/api/stream',
        handler: (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no',
            });
            res.write(': connected\n\n');
            clients.add(res);
            req.on('close', () => clients.delete(res));
        },
    }));
    return {
        push,
        dispose: () => {
            clearInterval(heartbeat);
            for (const disposer of disposers)
                disposer();
            for (const client of clients)
                client.end();
            clients.clear();
        },
    };
}
