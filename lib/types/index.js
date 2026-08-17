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
import { deepFreeze } from '@deepseek-ai/dsh-llm';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import z from '@deepseek-ai/schemastery';
import { generateDream } from "./engine/dreamer.js";
import { DreamStore } from "./store.js";
import { registerDreamWebUi } from "./webui/server.js";
import { DREAM_STYLES } from "./types.js";
/** Cordis plugin name. */
export const name = 'dream-incubator';
/** Services the plugin needs before it can run a dream cycle. */
export const inject = ['llm', 'sessions'];
/** Complete configuration key set for direct construction validation. */
const CONFIG_KEYS = new Set([
    'cooldownMs',
    'minMaterialEvents',
    'maxDailyDreams',
    'styleRotationDays',
    'noiseIntensity',
    'maxOutputTokens',
    'timeoutMs',
    'privacyMode',
    'provider',
    'model',
    'styles',
    'storePath',
    'serveUi',
]);
/** Shared Loader field schemas with no library defaults. */
export const DreamIncubatorConfigFields = {
    cooldownMs: z.number().step(1).min(0).required(),
    minMaterialEvents: z.number().step(1).min(0).required(),
    maxDailyDreams: z.number().step(1).min(1).required(),
    styleRotationDays: z.number().step(1).min(1).required(),
    noiseIntensity: z.union(['low', 'medium', 'high']).required(),
    maxOutputTokens: z.number().step(1).min(1).required(),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
    privacyMode: z.boolean().required(),
    provider: z.string(),
    model: z.string(),
    styles: z.array(z.object({
        id: z.string().required(),
        nameZh: z.string().required(),
        nameEn: z.string().required(),
        trigger: z.union([
            'fatigue', 'joy', 'anxiety', 'boredom', 'confusion', 'conflict',
        ]).required(),
        imagery: z.array(z.string()).min(1).required(),
        palette: z.string(),
    })),
    storePath: z.string().required(),
    serveUi: z.boolean().required(),
};
/** Shared Loader schema with no library defaults. */
export const DreamIncubatorConfigSchema = z.object(DreamIncubatorConfigFields);
/** Validate one positive integer limit. */
function assertPositiveInteger(name, value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new Error(`dream-incubator: ${name} must be a positive integer`);
    }
}
/** The mood taxonomy a style trigger must belong to. */
const DREAM_STYLE_TRIGGERS = [
    'fatigue', 'joy', 'anxiety', 'boredom', 'confusion', 'conflict',
];
/** True when the value is a non-empty string (used by style validation). */
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
/**
 * Validate the optional `styles` array and return a normalized copy. Custom
 * styles are appended after the built-in six; ids must be unique across both
 * sets so the rotation never produces ambiguous styles.
 */
function resolveUserStyles(stylesRaw) {
    if (stylesRaw === undefined)
        return undefined;
    if (!Array.isArray(stylesRaw)) {
        throw new Error('dream-incubator: styles must be an array of style definitions');
    }
    const seen = new Set(DREAM_STYLES);
    return stylesRaw.map((entry, index) => {
        const where = `styles[${index}]`;
        if (entry === null || typeof entry !== 'object') {
            throw new Error(`dream-incubator: ${where} must be an object`);
        }
        const def = entry;
        const id = def['id'];
        if (!isNonEmptyString(id)) {
            throw new Error(`dream-incubator: ${where}.id must be a non-empty string`);
        }
        if (seen.has(id)) {
            throw new Error(`dream-incubator: duplicate dream style "${id}"`);
        }
        seen.add(id);
        const nameZh = def['nameZh'];
        if (!isNonEmptyString(nameZh)) {
            throw new Error(`dream-incubator: ${where}.nameZh must be a non-empty string`);
        }
        const nameEn = def['nameEn'];
        if (!isNonEmptyString(nameEn)) {
            throw new Error(`dream-incubator: ${where}.nameEn must be a non-empty string`);
        }
        const trigger = def['trigger'];
        if (typeof trigger !== 'string'
            || !DREAM_STYLE_TRIGGERS.includes(trigger)) {
            throw new Error(`dream-incubator: ${where}.trigger must be one of "fatigue", "joy", "anxiety", "boredom", "confusion", "conflict"`);
        }
        const imagery = def['imagery'];
        if (!Array.isArray(imagery) || imagery.length === 0
            || !imagery.every(isNonEmptyString)) {
            throw new Error(`dream-incubator: ${where}.imagery must be a non-empty array of non-empty strings`);
        }
        const palette = def['palette'];
        if (palette !== undefined && !isNonEmptyString(palette)) {
            throw new Error(`dream-incubator: ${where}.palette must be a non-empty string when supplied`);
        }
        return {
            id,
            nameZh,
            nameEn,
            trigger: trigger,
            imagery: [...imagery],
            ...(palette !== undefined ? { palette } : {}),
        };
    });
}
/**
 * Validate and detach required incubator configuration.
 * @param config - untrusted plugin configuration.
 * @returns immutable policy; a missing optional route stays absent.
 */
export function resolveDreamIncubatorConfig(config) {
    const candidate = config;
    if (candidate === null || typeof candidate !== 'object') {
        throw new Error('dream-incubator: configuration is required');
    }
    const value = candidate;
    for (const key of Object.keys(value)) {
        if (!CONFIG_KEYS.has(key))
            throw new Error(`dream-incubator: unknown config key "${key}"`);
    }
    const cooldownMs = value['cooldownMs'];
    if (typeof cooldownMs !== 'number' || !Number.isInteger(cooldownMs) || cooldownMs < 0) {
        throw new Error('dream-incubator: cooldownMs must be a non-negative integer');
    }
    const minMaterialEvents = value['minMaterialEvents'];
    if (typeof minMaterialEvents !== 'number' || !Number.isInteger(minMaterialEvents) || minMaterialEvents < 0) {
        throw new Error('dream-incubator: minMaterialEvents must be a non-negative integer');
    }
    assertPositiveInteger('maxDailyDreams', value['maxDailyDreams']);
    assertPositiveInteger('styleRotationDays', value['styleRotationDays']);
    assertPositiveInteger('maxOutputTokens', value['maxOutputTokens']);
    const timeoutMs = value['timeoutMs'];
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error('dream-incubator: timeoutMs must be a positive integer');
    }
    if (timeoutMs > MAX_TIMER_DELAY_MS) {
        throw new Error(`dream-incubator: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`);
    }
    const noiseIntensity = value['noiseIntensity'];
    if (noiseIntensity !== 'low' && noiseIntensity !== 'medium' && noiseIntensity !== 'high') {
        throw new Error('dream-incubator: noiseIntensity must be "low", "medium", or "high"');
    }
    if (typeof value['privacyMode'] !== 'boolean') {
        throw new Error('dream-incubator: privacyMode must be a boolean');
    }
    if (typeof value['serveUi'] !== 'boolean') {
        throw new Error('dream-incubator: serveUi must be a boolean');
    }
    const storePath = value['storePath'];
    if (typeof storePath !== 'string' || storePath.length === 0) {
        throw new Error('dream-incubator: storePath must be a non-empty string');
    }
    const hasProvider = value['provider'] !== undefined;
    if (hasProvider !== (value['model'] !== undefined)) {
        throw new Error('dream-incubator: provider and model must be supplied together');
    }
    if (hasProvider && (typeof value['provider'] !== 'string' || value['provider'].length === 0
        || typeof value['model'] !== 'string' || value['model'].length === 0)) {
        throw new Error('dream-incubator: provider and model overrides must be non-empty strings');
    }
    const styles = resolveUserStyles(value['styles']);
    const resolved = {
        ...candidate,
        ...(styles !== undefined ? { styles } : {}),
    };
    return deepFreeze(resolved);
}
/**
 * Apply the dream-incubator plugin.
 * @param ctx - context exposing the LLM and session services.
 * @param config - untrusted required deployment policy.
 */
export function apply(ctx, config) {
    const resolved = resolveDreamIncubatorConfig(config);
    const store = DreamStore.open(resolved.storePath);
    const logger = ctx.logger('dream-incubator');
    ctx.effect(() => {
        let disposed = false;
        const disposers = [];
        const cadence = new Map();
        const lifecycle = new AbortController();
        /** The WebUI push channel; a no-op when the UI is disabled. */
        let push = () => { };
        if (resolved.serveUi) {
            const webui = registerDreamWebUi(ctx, store, resolved);
            push = webui.push;
            disposers.push(webui.dispose);
        }
        const dispose = () => {
            disposed = true;
            lifecycle.abort();
            for (const disposer of disposers)
                disposer();
        };
        /**
         * Decide whether a cycle may start now, and why not otherwise.
         * @param session - the session about to dream.
         * @param state - the session's cadence state.
         * @returns undefined when dreaming is allowed.
         */
        function gateReason(session, state) {
            if (state !== undefined) {
                if (state.running)
                    return 'already-dreaming';
                if (Date.now() - state.lastAttemptAt < resolved.cooldownMs)
                    return 'cooldown';
            }
            if (session.events.length < resolved.minMaterialEvents)
                return 'not-enough-material';
            const now = Date.now();
            const dayStart = now - (now % 86_400_000);
            if (store.dailyCount(session.id, dayStart) >= resolved.maxDailyDreams)
                return 'daily-cap';
            return undefined;
        }
        /**
         * Run one gated dream cycle for a session and persist the result.
         * @param session - the live session whose log feeds the dream.
         * @param force - bypass cooldown and material gates (manual /dream).
         * @param externalSignal - optional caller-owned cancellation.
         * @returns the dream record, or undefined when gated or failed.
         */
        async function dreamFor(session, force, externalSignal) {
            if (disposed)
                return undefined;
            let state = cadence.get(session.id);
            if (state === undefined) {
                state = { lastAttemptAt: 0, running: false };
                cadence.set(session.id, state);
            }
            const reason = force ? undefined : gateReason(session, state);
            if (reason !== undefined) {
                logger.debug(`dream cycle declined for ${session.id}: ${reason}`);
                return undefined;
            }
            if (state.running)
                return undefined;
            state.running = true;
            try {
                const record = await generateDream(ctx, resolved, session, store.lastMaterialSeq(session.id), Math.random, externalSignal ?? lifecycle.signal);
                state.lastAttemptAt = record.createdAt;
                store.append(record);
                push(record);
                logger.info(`dreamed "${record.title}" (${record.style}) for ${session.id}`);
                return record;
            }
            catch (error) {
                state.lastAttemptAt = Date.now();
                logger.warn(`dream cycle failed for ${session.id}: ${error.message}`);
                return undefined;
            }
            finally {
                state.running = false;
            }
        }
        // Cadence-triggered cycles: one dream per completed turn, quietly.
        disposers.push(ctx.on('session/event', (session, event) => {
            if (disposed || event.type !== 'turn/end')
                return;
            void dreamFor(session, false);
        }));
        // Manual cycles: explicit user intent bypasses the gates.
        if (ctx.commands) {
            disposers.push(ctx.commands.register({
                name: 'dream',
                description: '立刻为当前会话做一场梦',
                handler: async (invocation) => {
                    const record = await dreamFor(invocation.agent.session, true, invocation.signal);
                    if (record === undefined) {
                        return { kind: 'error', text: '做梦失败了，看看日志吧。' };
                    }
                    return {
                        kind: 'success',
                        text: `梦见「${record.title}」——${record.style} 风格，${record.moodLabel}。在 WebUI 里看完整梦境。`,
                    };
                },
            }));
            disposers.push(ctx.commands.register({
                name: 'dreams',
                description: '列出最近的梦境',
                handler: invocation => {
                    const records = store.all()
                        .filter(record => record.sessionId === invocation.agent.session.id)
                        .slice(0, 8);
                    if (records.length === 0) {
                        return { kind: 'success', text: '还没有梦。让会话多聊一会儿，或者输入 /dream。' };
                    }
                    const lines = records.map((record, index) => {
                        const when = new Date(record.createdAt).toLocaleString('zh-CN');
                        const mark = record.collected ? '已收录' : record.forgotten ? '已遗忘' : '     ';
                        return `${mark} ${index + 1}. 「${record.title}」— ${record.style} — ${record.moodLabel} — ${when}`;
                    });
                    return { kind: 'success', text: ['最近的梦：', ...lines].join('\n') };
                },
            }));
            disposers.push(ctx.commands.register({
                name: 'dreamsettings',
                description: '查看梦境孵化器配置',
                handler: () => {
                    const c = resolved;
                    const route = c.provider !== undefined ? `${c.provider}/${c.model}` : '跟随会话';
                    const lines = [
                        `冷却 ${c.cooldownMs / 1000}s / 最少素材 ${c.minMaterialEvents} 条 / 每日上限 ${c.maxDailyDreams} 场`,
                        `噪声强度 ${c.noiseIntensity} / 风格轮换 ${c.styleRotationDays} 天 / 输出上限 ${c.maxOutputTokens} tokens / 超时 ${c.timeoutMs / 1000}s`,
                        `模型路由 ${route} / 隐私模式 ${c.privacyMode ? '开' : '关'} / WebUI ${c.serveUi ? '开' : '关'}`,
                    ];
                    return { kind: 'success', text: ['梦境孵化器配置：', ...lines].join('\n') };
                },
            }));
        }
        return dispose;
    });
}
