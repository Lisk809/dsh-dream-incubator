/**
 * Style matrix ("导演"): the emotion-to-style mapping table, day-based
 * rotation, and structural heuristic hints derived from material stats.
 *
 * @module dsh-dream-incubator/engine/styles
 */
import { deepFreeze } from '@deepseek-ai/dsh-llm';
/** The six-library style matrix (plan §3.2-②). */
export const STYLE_MATRIX = [
    {
        id: 'cyberpunk',
        nameZh: '赛博朋克 / 废土',
        nameEn: 'Cyberpunk / Wasteland',
        trigger: 'fatigue',
        imagery: ['霓虹雨夜', '机械义肢', '数据洪流', '发锈的服务器塔', '电子鱼群'],
        palette: 'cyberpunk',
    },
    {
        id: 'fantasy',
        nameZh: '奇幻冒险',
        nameEn: 'Fantasy Quest',
        trigger: 'joy',
        imagery: ['魔法圣杯', '神秘森林', '会说话的动物', '漂浮的灯塔', '蜂蜜色的星星'],
        palette: 'fantasy',
    },
    {
        id: 'noir',
        nameZh: '黑色悬疑',
        nameEn: 'Noir Mystery',
        trigger: 'anxiety',
        imagery: ['昏暗密室', '镜子里的陌生人', '倒放的时钟', '雨巷里的猫', '半页未写完的信'],
        palette: 'noir',
    },
    {
        id: 'surreal',
        nameZh: '超现实主义',
        nameEn: 'Surrealism',
        trigger: 'boredom',
        imagery: ['融化的键盘', '重力反转', '会唱歌的代码', '抽屉里的星空', '楼梯尽头的水面'],
        palette: 'surreal',
    },
    {
        id: 'fable',
        nameZh: '童话寓言',
        nameEn: 'Fable',
        trigger: 'confusion',
        imagery: ['说谎的兔子', '镜中世界', '谜语人', '会算数的蘑菇', '一本不肯合上的书'],
        palette: 'fable',
    },
    {
        id: 'horror',
        nameZh: '恐怖怪诞',
        nameEn: 'Weird Horror',
        trigger: 'conflict',
        imagery: ['失控的AI', '无尽循环', '被追逐', '墙缝里的灯', '重复的脚步声'],
        palette: 'horror',
    },
];
/**
 * The effective style library for one dream cycle: the built-in six followed
 * by any user-registered styles (append-only — custom styles cannot shadow
 * built-ins). Normalizes each user entry by filling the optional palette with
 * the style id, mirroring the built-in "same id by default" convention.
 * @param userStyles - validated custom styles from {@link DreamIncubatorConfig}.
 */
export function mergedStyleMatrix(userStyles) {
    if (userStyles === undefined || userStyles.length === 0)
        return STYLE_MATRIX;
    const merged = STYLE_MATRIX.slice();
    for (const custom of userStyles) {
        merged.push({
            ...custom,
            imagery: [...custom.imagery],
            palette: custom.palette ?? custom.id,
        });
    }
    return deepFreeze(merged);
}
/** Look up one style definition by id within the given matrix. */
export function styleDef(id, matrix) {
    const def = matrix.find(candidate => candidate.id === id);
    if (def === undefined) {
        throw new Error(`dream-incubator: unknown dream style "${id}"`);
    }
    return def;
}
/** Validate that a parsed scan style is a member of the given matrix. */
export function isDreamStyle(value, matrix) {
    return typeof value === 'string' && matrix.some(def => def.id === value);
}
/**
 * Day-based style-library rotation offset: the scan prompt lists the matrix
 * starting at this index and instructs the model to prefer earlier entries on
 * ties, so favourite styles drift every `rotationDays` without repetition
 * (plan §3.2-② "随机轮换机制").
 * @param rotationDays - the configured rotation period.
 * @param epochDays - whole days since the Unix epoch (local calendar days).
 * @param matrix - the effective style library (built-ins + custom styles).
 * @returns an offset in [0, matrix.length).
 */
export function rotationOffset(rotationDays, epochDays, matrix) {
    const period = Math.max(1, Math.floor(rotationDays));
    return Math.floor(epochDays / period) % matrix.length;
}
/**
 * Rotated style list for the scan prompt.
 * @param offset - the rotation offset from {@link rotationOffset}.
 * @param matrix - the effective style library (built-ins + custom styles).
 * @returns the matrix ordered starting at `offset`.
 */
export function rotatedStyles(offset, matrix) {
    const safe = ((offset % matrix.length) + matrix.length) % matrix.length;
    return [...matrix.slice(safe), ...matrix.slice(0, safe)];
}
/**
 * Structural heuristic hints from material stats, describing the day in the
 * language of the style matrix triggers. Purely mechanical: the scan stage
 * receives these as hints and remains free to override.
 */
export function heuristicMoodHints(stats) {
    const hints = [];
    if (stats.eventCount === 0) {
        hints.push('平静（几乎无事发生）');
        return hints;
    }
    if (stats.errorCount >= 3 || (stats.errorCount > 0 && stats.toolCallCount / stats.eventCount > 0.3)) {
        hints.push('疲惫（调试与报错占了很大比重）');
    }
    if (stats.userMessageCount > 0
        && stats.toolCallCount / stats.eventCount > 0.25) {
        hints.push('高效但有压力（工具调用频繁）');
    }
    if (stats.errorCount === 0 && stats.toolCallCount === 0 && stats.userMessageCount <= 1) {
        hints.push('平静或无聊（交互很少）');
    }
    if (hints.length === 0) {
        hints.push('节奏平稳（常规工作流）');
    }
    return hints;
}
/** Fallback style when the scan returns an unusable value. */
export function fallbackStyle(stats) {
    if (stats.errorCount >= 3)
        return 'cyberpunk';
    if (stats.errorCount > 0)
        return 'noir';
    if (stats.eventCount === 0)
        return 'surreal';
    return 'fantasy';
}
/**
 * Coerce a parsed scan result into a usable {@link DreamScan}, applying the
 * fallback style and clamping PAD axes. Invalid records stay invalid — the
 * caller decides whether to fail loud or degrade.
 * @param matrix - the effective style library the scan style is checked against.
 */
export function coerceScan(raw, matrix) {
    if (raw === null || typeof raw !== 'object')
        return undefined;
    const record = raw;
    const mood = record['mood'];
    const moodRecord = typeof mood === 'object' && mood !== null
        ? mood
        : undefined;
    const axis = (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value))
            return undefined;
        return Math.max(-1, Math.min(1, value));
    };
    const valence = moodRecord === undefined ? undefined : axis(moodRecord['valence']);
    const arousal = moodRecord === undefined ? undefined : axis(moodRecord['arousal']);
    const dominance = moodRecord === undefined ? undefined : axis(moodRecord['dominance']);
    if (valence === undefined || arousal === undefined || dominance === undefined) {
        return undefined;
    }
    const moodLabel = typeof record['moodLabel'] === 'string'
        ? record['moodLabel'].trim()
        : '';
    const themesRaw = record['themes'];
    const themes = Array.isArray(themesRaw)
        ? themesRaw.filter((theme) => typeof theme === 'string' && theme.length > 0).slice(0, 8)
        : [];
    const style = isDreamStyle(record['style'], matrix) ? record['style'] : undefined;
    if (style === undefined || moodLabel.length === 0)
        return undefined;
    return {
        mood: { valence, arousal, dominance },
        moodLabel,
        themes,
        style,
    };
}
