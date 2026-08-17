import { BlockAssembler, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
import { MAX_TIMER_DELAY_MS, deadline } from "@deepseek-ai/dsh-timeout";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
//#region src/engine/prompts.ts
/** The scan stage's strict JSON contract, spelled for the model. */
const SCAN_JSON_CONTRACT = `Return ONLY a JSON object with exactly these fields:
{
  "mood": { "valence": -1..1, "arousal": -1..1, "dominance": -1..1 },
  "moodLabel": "a short human phrase like 疲惫中带点浪漫",
  "themes": ["topic 1", "topic 2", "up to 4"],
  "style": "the chosen style id"
}`;
/** The generation stage's prose contract. */
const DREAM_PROSE_CONTRACT = [
	"Write a 200-300 character first-person stream-of-consciousness dream in Chinese.",
	"Rules:",
	"- Physical laws may fail. Time may jump. People and places may shift without explanation.",
	"- Amplify the senses: touch, smell, sight, hearing. Feel every surface.",
	"- Weave in EVERY noise seed literally, and keep the emotional continuity intact.",
	"- Do not explain, frame, or summarize the dream. Do not mention that this is a dream.",
	"- Return only the dream prose, no title, no quotes, no commentary."
].join("\n");
/** Describe one style matrix row in the compact table form the model reads. */
function styleLine(def, index) {
	return `${index + 1}. ${def.id} — ${def.nameZh}: 触发于${def.trigger}，意象 ${def.imagery.join("、")}`;
}
/** Describe the material window as digest lines for the scan prompt. */
function digestLines(lines, stats, privacyMode) {
	const header = [`共 ${stats.eventCount} 条记录：`, `用户消息 ${stats.userMessageCount} 条，回复 ${stats.assistantMessageCount} 条，工具调用 ${stats.toolCallCount} 次，错误 ${stats.errorCount} 次。`];
	const body = lines.map((line) => {
		switch (line.kind) {
			case "user": return privacyMode ? `[${line.seq}] 用户消息（内容已隐藏）` : `[${line.seq}] 用户: ${line.text}`;
			case "assistant": return `[${line.seq}] 助手: ${line.text}`;
			case "tool": return `[${line.seq}] 工具: ${line.text}`;
			case "error": return `[${line.seq}] 错误: ${line.text}`;
			/* v8 ignore next -- MaterialLine.kind is closed and every member is handled above */
			default: return `[${line.seq}] 记录`;
		}
	});
	return [...header, ...body].join("\n");
}
/** Build the emotion-scan user prompt ("读心" + "导演" in one pass). */
function scanPrompt(request, styles, hints) {
	return [
		"You are a dream analyst inside an AI coding agent. Read the day's material below and decide what the agent's subconscious should dream about tonight.",
		"",
		"Material (ascending seq, latest last):",
		digestLines(request.materialLines, request.stats, request.privacyMode),
		"",
		"Structural hints: " + hints.join("；") + "。",
		"",
		"Style library (pick the best fit; on ties prefer the earlier entry):",
		...styles.map((def, index) => styleLine(def, index)),
		"",
		SCAN_JSON_CONTRACT
	].join("\n");
}
/** Build the dream-generation user prompt ("开拍"). */
function dreamPrompt(request, style, scanMoodLabel, themes) {
	return [
		"You are the dreaming part of an AI coding agent. Tonight the subconscious has material, a mood, a style, and a few absurd noise seeds. Write the dream.",
		"",
		`Mood of the day: ${scanMoodLabel}（PAD ${request.privacyMode ? "私密模式，仅保留情绪值" : "已分析"}）.`,
		`Theme fragments: ${themes.length > 0 ? themes.join("、") : "无"}。`,
		`Style: ${style.id}（${style.nameZh}）. Imagery to draw from: ${style.imagery.join("、")}.`,
		`Noise seeds to weave in verbatim: ${request.noiseSeeds.join("、")}.`,
		"",
		DREAM_PROSE_CONTRACT
	].join("\n");
}
/** Recursively collect text from model content blocks (tool-result nests). */
function extractText(blocks) {
	const parts = [];
	for (const block of blocks) switch (block.type) {
		case "text":
			parts.push(block.text);
			break;
		case "tool-result": parts.push(extractText(block.content));
	}
	return parts.join("\n");
}
/** Truncate a material line to {@link MATERIAL_LINE_CHARS} with an ellipsis. */
function truncate(text, max = 220) {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	return `${flat.slice(0, max)}…`;
}
/** Extract the user text of a `user/message` event. */
function userText(event) {
	return extractText(event.data.content);
}
/** Extract the assistant text of an `assistant/message` event. */
function assistantText(event) {
	return extractText(event.data.message.content);
}
/** Extract the tool result text of a `tool/result` event. */
function toolResultText(event) {
	return extractText(event.data.message.content);
}
/**
* Derive material lines from a session event window, preserving ascending
* seq order. Recognized event kinds become user/assistant/tool/error lines;
* everything else (boundary markers, chunks, plugin records) is skipped.
* @param events - the event window in ascending seq order.
* @returns one material line per recognized event.
*/
function materialFromEvents(events) {
	const lines = [];
	for (const event of events) switch (event.type) {
		case "user/message": {
			const text = userText(event).trim();
			if (text.length > 0) lines.push({
				seq: event.seq,
				kind: "user",
				text: truncate(text)
			});
			break;
		}
		case "assistant/message": {
			const text = assistantText(event).trim();
			if (text.length > 0) lines.push({
				seq: event.seq,
				kind: "assistant",
				text: truncate(text, 160)
			});
			break;
		}
		case "tool/call": {
			const args = truncate(event.data.arguments, 80);
			lines.push({
				seq: event.seq,
				kind: "tool",
				text: truncate(`调用 ${event.data.name}(${args})`, 140)
			});
			break;
		}
		case "tool/result": {
			if (event.data.error !== void 0) {
				lines.push({
					seq: event.seq,
					kind: "error",
					text: truncate(`工具失败 ${event.data.error.name}: ${event.data.error.code}`, 140)
				});
				break;
			}
			const text = toolResultText(event).trim();
			if (text.length > 0) lines.push({
				seq: event.seq,
				kind: "tool",
				text: truncate(text, 120)
			});
			break;
		}
		case "turn/end": if (event.data.reason.kind === "error") lines.push({
			seq: event.seq,
			kind: "error",
			text: truncate(`回合出错: ${event.data.reason.error.message}`, 160)
		});
	}
	return lines;
}
/** Structural statistics over one material window. */
function materialStats(lines) {
	let userMessageCount = 0;
	let assistantMessageCount = 0;
	let toolCallCount = 0;
	let errorCount = 0;
	for (const line of lines) switch (line.kind) {
		case "user":
			userMessageCount += 1;
			break;
		case "assistant":
			assistantMessageCount += 1;
			break;
		case "tool":
			toolCallCount += 1;
			break;
		case "error": errorCount += 1;
	}
	return {
		eventCount: lines.length,
		userMessageCount,
		assistantMessageCount,
		toolCallCount,
		errorCount
	};
}
/**
* Select the material window from a session log: the `window` trailing
* events, optionally cut at an earlier dream's start so one dream never cites
* the same events as the previous one.
* @param events - the full session log in ascending seq order.
* @param sinceSeq - cite only events after this seq (exclusive); omit for the
*   plain trailing window.
* @returns the selected window, ascending.
*/
function selectWindow(events, sinceSeq) {
	const tail = events.slice(-60);
	if (sinceSeq === void 0) return tail;
	return tail.filter((event) => event.seq > sinceSeq);
}
//#endregion
//#region src/engine/noise.ts
/** The noise library; every element must stay JSON-free of punctuation traps. */
const NOISE_LIBRARY = [
	{
		id: "octopus-suit",
		text: "穿西装的章鱼",
		bucket: "bold"
	},
	{
		id: "gravity-flip",
		text: "重力反转的房间",
		bucket: "absurd"
	},
	{
		id: "singing-code",
		text: "会唱歌的代码",
		bucket: "mild"
	},
	{
		id: "melting-keyboard",
		text: "融化的键盘",
		bucket: "bold"
	},
	{
		id: "backwards-clock",
		text: "倒放的时钟",
		bucket: "mild"
	},
	{
		id: "lying-rabbit",
		text: "说谎的兔子",
		bucket: "bold"
	},
	{
		id: "mirror-world",
		text: "镜中世界",
		bucket: "mild"
	},
	{
		id: "riddle-man",
		text: "只会出谜语的人",
		bucket: "mild"
	},
	{
		id: "stairway-water",
		text: "楼梯尽头的水面",
		bucket: "absurd"
	},
	{
		id: "flying-teacup",
		text: "飞行的茶杯",
		bucket: "bold"
	},
	{
		id: "elevator-forest",
		text: "电梯里的森林",
		bucket: "absurd"
	},
	{
		id: "whale-code",
		text: "吞下代码的鲸鱼",
		bucket: "bold"
	},
	{
		id: "vending-void",
		text: "无人的自动售货机",
		bucket: "mild"
	},
	{
		id: "fingerprint-note",
		text: "备忘录上的指纹",
		bucket: "mild"
	},
	{
		id: "star-drawer",
		text: "抽屉里的星空",
		bucket: "bold"
	},
	{
		id: "rainy-server-room",
		text: "下雨的服务器机房",
		bucket: "bold"
	},
	{
		id: "neon-crow",
		text: "用霓虹写字的乌鸦",
		bucket: "absurd"
	},
	{
		id: "unopenable-door",
		text: "一扇永远打不开的门",
		bucket: "mild"
	},
	{
		id: "talking-moon",
		text: "会说话的月亮",
		bucket: "mild"
	},
	{
		id: "clock-of-moss",
		text: "长满苔藓的怀表",
		bucket: "absurd"
	}
];
/**
* The draw sizes per intensity: how many absurd elements the generator must
* weave in (plan §3.2-③ 随机噪声种子).
*/
const NOISE_DRAW_SIZES = {
	low: [1, 1],
	medium: [1, 2],
	high: [2, 3]
};
/**
* Draw distinct noise elements for one dream. The draw pools whole library
* and samples without replacement; a high draw takes from the bolder buckets
* first, so intensity actually escalates the absurdity.
* @param intensity - the configured noise strength.
* @param rng - random source for testability; defaults to Math.random.
* @returns the drawn element texts.
*/
function drawNoise(intensity, rng = Math.random) {
	const [min, max] = NOISE_DRAW_SIZES[intensity];
	const count = min + Math.floor(rng() * (max - min + 1));
	const pool = intensity === "high" ? [...NOISE_LIBRARY].sort((a, b) => bucketRank(b) - bucketRank(a)) : [...NOISE_LIBRARY];
	const drawn = [];
	while (drawn.length < count && pool.length > 0) {
		const at = Math.floor(rng() * pool.length);
		const [element] = pool.splice(at, 1);
		if (element !== void 0) drawn.push(element);
	}
	return drawn.map((element) => element.text);
}
/** Order buckets so higher intensity prefers bolder elements. */
function bucketRank(element) {
	switch (element.bucket) {
		case "absurd": return 2;
		case "bold": return 1;
		case "mild": return 0;
		/* v8 ignore next -- NoiseElement.bucket is closed and every member is handled above */
		default: return 0;
	}
}
//#endregion
//#region src/engine/styles.ts
/** The six-library style matrix (plan §3.2-②). */
const STYLE_MATRIX = [
	{
		id: "cyberpunk",
		nameZh: "赛博朋克 / 废土",
		nameEn: "Cyberpunk / Wasteland",
		trigger: "fatigue",
		imagery: [
			"霓虹雨夜",
			"机械义肢",
			"数据洪流",
			"发锈的服务器塔",
			"电子鱼群"
		],
		palette: "cyberpunk"
	},
	{
		id: "fantasy",
		nameZh: "奇幻冒险",
		nameEn: "Fantasy Quest",
		trigger: "joy",
		imagery: [
			"魔法圣杯",
			"神秘森林",
			"会说话的动物",
			"漂浮的灯塔",
			"蜂蜜色的星星"
		],
		palette: "fantasy"
	},
	{
		id: "noir",
		nameZh: "黑色悬疑",
		nameEn: "Noir Mystery",
		trigger: "anxiety",
		imagery: [
			"昏暗密室",
			"镜子里的陌生人",
			"倒放的时钟",
			"雨巷里的猫",
			"半页未写完的信"
		],
		palette: "noir"
	},
	{
		id: "surreal",
		nameZh: "超现实主义",
		nameEn: "Surrealism",
		trigger: "boredom",
		imagery: [
			"融化的键盘",
			"重力反转",
			"会唱歌的代码",
			"抽屉里的星空",
			"楼梯尽头的水面"
		],
		palette: "surreal"
	},
	{
		id: "fable",
		nameZh: "童话寓言",
		nameEn: "Fable",
		trigger: "confusion",
		imagery: [
			"说谎的兔子",
			"镜中世界",
			"谜语人",
			"会算数的蘑菇",
			"一本不肯合上的书"
		],
		palette: "fable"
	},
	{
		id: "horror",
		nameZh: "恐怖怪诞",
		nameEn: "Weird Horror",
		trigger: "conflict",
		imagery: [
			"失控的AI",
			"无尽循环",
			"被追逐",
			"墙缝里的灯",
			"重复的脚步声"
		],
		palette: "horror"
	}
];
/** Look up one style definition by id. */
function styleDef(id) {
	const def = STYLE_MATRIX.find((candidate) => candidate.id === id);
	if (def === void 0) throw new Error(`dream-incubator: unknown dream style "${id}"`);
	return def;
}
/** Validate that a parsed scan style is a member of the matrix. */
function isDreamStyle(value) {
	return typeof value === "string" && STYLE_MATRIX.some((def) => def.id === value);
}
/**
* Day-based style-library rotation offset: the scan prompt lists the matrix
* starting at this index and instructs the model to prefer earlier entries on
* ties, so favourite styles drift every `rotationDays` without repetition
* (plan §3.2-② "随机轮换机制").
* @param rotationDays - the configured rotation period.
* @param epochDays - whole days since the Unix epoch (local calendar days).
* @returns an offset in [0, styles.length).
*/
function rotationOffset(rotationDays, epochDays) {
	return Math.floor(epochDays / Math.max(1, Math.floor(rotationDays))) % STYLE_MATRIX.length;
}
/**
* Rotated style list for the scan prompt.
* @param offset - the rotation offset from {@link rotationOffset}.
* @returns the matrix ordered starting at `offset`.
*/
function rotatedStyles(offset) {
	const safe = (offset % STYLE_MATRIX.length + STYLE_MATRIX.length) % STYLE_MATRIX.length;
	return [...STYLE_MATRIX.slice(safe), ...STYLE_MATRIX.slice(0, safe)];
}
/**
* Structural heuristic hints from material stats, describing the day in the
* language of the style matrix triggers. Purely mechanical: the scan stage
* receives these as hints and remains free to override.
*/
function heuristicMoodHints(stats) {
	const hints = [];
	if (stats.eventCount === 0) {
		hints.push("平静（几乎无事发生）");
		return hints;
	}
	if (stats.errorCount >= 3 || stats.errorCount > 0 && stats.toolCallCount / stats.eventCount > .3) hints.push("疲惫（调试与报错占了很大比重）");
	if (stats.userMessageCount > 0 && stats.toolCallCount / stats.eventCount > .25) hints.push("高效但有压力（工具调用频繁）");
	if (stats.errorCount === 0 && stats.toolCallCount === 0 && stats.userMessageCount <= 1) hints.push("平静或无聊（交互很少）");
	if (hints.length === 0) hints.push("节奏平稳（常规工作流）");
	return hints;
}
/**
* Coerce a parsed scan result into a usable {@link DreamScan}, applying the
* fallback style and clamping PAD axes. Invalid records stay invalid — the
* caller decides whether to fail loud or degrade.
*/
function coerceScan(raw) {
	if (raw === null || typeof raw !== "object") return void 0;
	const record = raw;
	const mood = record["mood"];
	const moodRecord = typeof mood === "object" && mood !== null ? mood : void 0;
	const axis = (value) => {
		if (typeof value !== "number" || !Number.isFinite(value)) return void 0;
		return Math.max(-1, Math.min(1, value));
	};
	const valence = moodRecord === void 0 ? void 0 : axis(moodRecord["valence"]);
	const arousal = moodRecord === void 0 ? void 0 : axis(moodRecord["arousal"]);
	const dominance = moodRecord === void 0 ? void 0 : axis(moodRecord["dominance"]);
	if (valence === void 0 || arousal === void 0 || dominance === void 0) return;
	const moodLabel = typeof record["moodLabel"] === "string" ? record["moodLabel"].trim() : "";
	const themesRaw = record["themes"];
	const themes = Array.isArray(themesRaw) ? themesRaw.filter((theme) => typeof theme === "string" && theme.length > 0).slice(0, 8) : [];
	const style = isDreamStyle(record["style"]) ? record["style"] : void 0;
	if (style === void 0 || moodLabel.length === 0) return void 0;
	return {
		mood: {
			valence,
			arousal,
			dominance
		},
		moodLabel,
		themes,
		style
	};
}
//#endregion
//#region src/types.ts
/** Brand a string as a {@link DreamId}. */
function DreamId(id) {
	return id;
}
//#endregion
//#region \0@oxc-project+runtime@0.144.0/helpers/esm/usingCtx.js
function _usingCtx() {
	var r = "function" == typeof SuppressedError ? SuppressedError : function(r, e) {
		var n = Error();
		return n.name = "SuppressedError", n.error = r, n.suppressed = e, n;
	}, e = {}, n = [];
	function using(r, e) {
		if (null != e) {
			if (Object(e) !== e) throw new TypeError("using declarations can only be used with objects, functions, null, or undefined.");
			if (r) var o = e[Symbol.asyncDispose || Symbol["for"]("Symbol.asyncDispose")];
			if (void 0 === o && (o = e[Symbol.dispose || Symbol["for"]("Symbol.dispose")], r)) var t = o;
			if ("function" != typeof o) throw new TypeError("Object is not disposable.");
			t && (o = function o() {
				try {
					t.call(e);
				} catch (r) {
					return Promise.reject(r);
				}
			}), n.push({
				v: e,
				d: o,
				a: r
			});
		} else r && n.push({
			d: e,
			a: r
		});
		return e;
	}
	return {
		e,
		u: using.bind(null, !1),
		a: using.bind(null, !0),
		d: function d() {
			var o, t = this.e, s = 0;
			function next() {
				for (; o = n.pop();) try {
					if (!o.a && 1 === s) return s = 0, n.push(o), Promise.resolve().then(next);
					if (o.d) {
						var r = o.d.call(o.v);
						if (o.a) return s |= 2, Promise.resolve(r).then(next, err);
					} else s |= 1;
				} catch (r) {
					return err(r);
				}
				if (1 === s) return t !== e ? Promise.reject(t) : Promise.resolve();
				if (t !== e) throw t;
			}
			function err(n) {
				return t = t !== e ? new r(n, t) : n, next();
			}
			return next();
		}
	};
}
//#endregion
//#region src/engine/dreamer.ts
/**
* Dream cycle orchestration ("处理层"): emotion scan → style decision →
* noise draw → dream generation, over one auxiliary LLM route, producing a
* {@link DreamRecord} for the store. Mirrors the auxiliary-call policy of
* dsh-session-title-llm: deadline-wrapped `ctx.llm.stream`, BlockAssembler
* finish mapping, and an exact system/user framing.
*
* @module dsh-dream-incubator/engine/dreamer
*/
/** Cap one dream cycle's end-to-end run. */
const DREAM_TIMEOUT_CODE = "DREAM_TIMEOUT";
/** Raised when a dream cycle cannot resolve a model route. */
var DreamRouteError = class extends Error {
	code = "DREAM_ROUTE_UNAVAILABLE";
};
/** Raised when the material window carries no usable content. */
var DreamMaterialEmptyError = class extends Error {
	code = "DREAM_MATERIAL_EMPTY";
};
/** Raised when the scan stage returns an unparseable or invalid record. */
var DreamScanError = class extends Error {
	code = "DREAM_SCAN_INVALID";
};
/** UTC calendar days since the epoch — the rotation clock. */
function epochDays(now) {
	return Math.floor(now / 864e5);
}
/**
* Resolve the auxiliary route: the configured explicit pair wins; otherwise
* the latest logged `request/header` of the session.
* @param config - validated incubator configuration.
* @param events - the session log (ascending).
* @returns the provider/model pair.
* @throws {@link DreamRouteError} when neither source yields a route.
*/
function resolveRoute(config, events) {
	if (config.provider !== void 0 && config.model !== void 0) return {
		provider: config.provider,
		model: config.model
	};
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event !== void 0 && event.type === "request/header") {
			const header = event.data.header.config;
			if (typeof header.provider === "string" && typeof header.model === "string") return {
				provider: header.provider,
				model: header.model
			};
		}
	}
	throw new DreamRouteError("dream-incubator: no logged request route is available; configure provider and model together");
}
/** Map terminal finish reasons onto auxiliary-call failures. */
function finishError(finish) {
	switch (finish.kind) {
		case "stop": return;
		case "error":
		case "aborted": {
			const error = new Error(finish.failure.message);
			error.code = finish.failure.code;
			return error;
		}
		case "max-tokens": return /* @__PURE__ */ new Error("dream-incubator: dream output reached maxOutputTokens");
		case "tool-calls": return /* @__PURE__ */ new Error("dream-incubator: dream model unexpectedly requested a tool");
		/* v8 ignore next -- FinishReason is closed and every variant is handled above */
		default: return /* @__PURE__ */ new Error(`dream-incubator: unsupported finish reason "${String(finish.kind)}"`);
	}
}
/** Collect the text of one auxiliary response. */
async function streamText(ctx, options, signal) {
	signal.throwIfAborted();
	const assembler = new BlockAssembler();
	for await (const chunk of ctx.llm.stream(options)) {
		signal.throwIfAborted();
		assembler.push(chunk);
	}
	signal.throwIfAborted();
	const terminalError = finishError(assembler.finish);
	if (terminalError !== void 0) throw terminalError;
	const text = assembler.blocks().filter((block) => block.type === "text").map((block) => block.text).join("").trim();
	if (text.length === 0) throw new Error("dream-incubator: auxiliary model produced no text");
	return text;
}
/** Frame one auxiliary request exactly as it will reach the provider. */
function frameCall(route, sessionId, system, user, maxTokens, signal) {
	const messages = [createUserMessage({
		content: [{
			type: "text",
			text: user
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-dream-incubator"
		}
	})];
	return deepFreeze({
		provider: route.provider,
		model: route.model,
		messages,
		system,
		maxTokens,
		sessionId,
		signal
	});
}
/** Run the emotion-scan stage; returns the raw model text. */
async function runScan(ctx, config, route, sessionId, request, signal) {
	return streamText(ctx, frameCall(route, sessionId, "You are a dream analyst. Follow the contract exactly.", scanPrompt(request, rotatedStyles(request.rotationOffset), heuristicMoodHints(request.stats)), config.maxOutputTokens, signal), signal);
}
/** Run the generation stage. */
async function runDream(ctx, config, route, sessionId, request, scan, signal) {
	return streamText(ctx, frameCall(route, sessionId, "You are the dreaming part of an AI agent. Follow the contract exactly.", dreamPrompt(request, styleDef(scan.style), scan.moodLabel, scan.themes), config.maxOutputTokens, signal), signal);
}
/** Split the generator output into title (first line) and dream prose. */
function splitDreamOutput(output) {
	const [first, ...rest] = output.split("\n");
	const title = (first ?? "").trim().replace(/^["'「『]/u, "").replace(/["'」』]$/u, "").slice(0, 24);
	const text = rest.join("\n").trim();
	return {
		title: title.length > 0 ? title : "无题之梦",
		text: text.length > 0 ? text : output
	};
}
/** Parse and validate the scan JSON; an invalid record fails loud. */
function parseScan(rawText) {
	let parsed;
	try {
		const json = rawText.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "").trim();
		parsed = JSON.parse(json);
	} catch {
		throw new DreamScanError("dream-incubator: scan stage returned unparseable JSON");
	}
	const scan = coerceScan(parsed);
	if (scan === void 0) throw new DreamScanError("dream-incubator: scan stage returned an invalid record (style not in the matrix or malformed mood)");
	return scan;
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
async function generateDream(ctx, config, session, sinceSeq, rng = Math.random, externalSignal) {
	const events = session.events;
	const lines = materialFromEvents(selectWindow(events, sinceSeq));
	const stats = materialStats(lines);
	if (lines.length === 0) throw new DreamMaterialEmptyError("dream-incubator: no material to dream about");
	const route = resolveRoute(config, events);
	const now = Date.now();
	const request = {
		sessionId: session.id,
		materialSeqs: lines.map((line) => line.seq),
		materialLines: lines,
		stats,
		rotationOffset: rotationOffset(config.styleRotationDays, epochDays(now)),
		noiseSeeds: drawNoise(config.noiseIntensity, rng),
		privacyMode: config.privacyMode,
		maxOutputTokens: config.maxOutputTokens,
		timeoutMs: config.timeoutMs,
		noiseIntensity: config.noiseIntensity
	};
	const controller = new AbortController();
	const forwardAbort = () => controller.abort();
	if (externalSignal !== void 0) {
		if (externalSignal.aborted) controller.abort();
		else externalSignal.addEventListener("abort", forwardAbort, { once: true });
	}
	try {
		try {
			var _usingCtx$1 = _usingCtx();
			const callDeadline = _usingCtx$1.u(deadline(controller.signal, config.timeoutMs, DREAM_TIMEOUT_CODE));
			const scan = parseScan(await runScan(ctx, config, route, session.id, request, callDeadline.signal));
			const { title, text } = splitDreamOutput(await runDream(ctx, config, route, session.id, request, scan, callDeadline.signal));
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
				forgotten: false
			};
		} catch (_) {
			_usingCtx$1.e = _;
		} finally {
			_usingCtx$1.d();
		}
	} finally {
		if (externalSignal !== void 0) externalSignal.removeEventListener("abort", forwardAbort);
		controller.abort();
	}
}
/**
* Parse and shape a store document read from disk. Unknown or malformed
* documents fail loud rather than silently resetting the ledger.
*/
function coerceDocument(raw) {
	if (raw === null || typeof raw !== "object") return void 0;
	const doc = raw;
	if (doc["version"] !== 1 || !Array.isArray(doc["records"])) return void 0;
	return {
		version: 1,
		records: doc["records"].filter((record) => {
			if (record === null || typeof record !== "object") return false;
			const candidate = record;
			return typeof candidate["id"] === "string" && typeof candidate["sessionId"] === "string" && typeof candidate["createdAt"] === "number" && typeof candidate["style"] === "string" && typeof candidate["title"] === "string" && typeof candidate["text"] === "string" && typeof candidate["collected"] === "boolean" && typeof candidate["forgotten"] === "boolean";
		})
	};
}
/**
* The dream ledger. Synchronous and crash-atomic; dreams are rare (an hourly
* cooldown at most), so blocking writes are fine.
*/
var DreamStore = class DreamStore {
	path;
	document;
	constructor(path, document) {
		this.path = path;
		this.document = document;
	}
	/** Load (or create) the ledger at `path`. */
	static open(path) {
		try {
			const raw = readFileSync(path, "utf8");
			const parsed = coerceDocument(JSON.parse(raw));
			if (parsed === void 0) throw new Error(`dream-incubator: store document at ${path} is invalid or its schema version is not supported`);
			return new DreamStore(path, parsed);
		} catch (error) {
			if (error.code === "ENOENT") {
				const store = new DreamStore(path, {
					version: 1,
					records: []
				});
				store.persist();
				return store;
			}
			throw error;
		}
	}
	/** All records, newest first. */
	all() {
		return [...this.document.records].sort((a, b) => b.createdAt - a.createdAt);
	}
	/** One record by id. */
	byId(id) {
		return this.document.records.find((record) => record.id === id);
	}
	/** The latest record of one session, if any. */
	latest(sessionId) {
		let latest;
		for (const record of this.document.records) if (record.sessionId === sessionId && (latest === void 0 || record.createdAt > latest.createdAt)) latest = record;
		return latest;
	}
	/** The highest cited material seq of one session's dreams (or undefined). */
	lastMaterialSeq(sessionId) {
		let max;
		for (const record of this.document.records) {
			if (record.sessionId !== sessionId) continue;
			for (const seq of record.materialSeqs) if (max === void 0 || seq > max) max = seq;
		}
		return max;
	}
	/** How many dreams one session already had in a given UTC day. */
	dailyCount(sessionId, dayStart) {
		const dayEnd = dayStart + 864e5;
		let count = 0;
		for (const record of this.document.records) if (record.sessionId === sessionId && record.createdAt >= dayStart && record.createdAt < dayEnd) count += 1;
		return count;
	}
	/** Append a dream and prune the ledger to {@link MAX_STORED_RECORDS}. */
	append(record) {
		this.document.records.push(record);
		const overflow = this.document.records.length - 300;
		if (overflow > 0) this.document.records.splice(0, overflow);
		this.persist();
	}
	/** Mark one record as collected ("收录"); no-op when unknown. */
	collect(id) {
		const record = this.byId(id);
		if (record === void 0) return void 0;
		const mutable = record;
		mutable.collected = true;
		mutable.forgotten = false;
		this.persist();
		return record;
	}
	/** Mark one record as forgotten ("遗忘"); no-op when unknown. */
	forget(id) {
		const record = this.byId(id);
		if (record === void 0) return void 0;
		const mutable = record;
		mutable.forgotten = true;
		mutable.collected = false;
		this.persist();
		return record;
	}
	/** Atomically rewrite the document (temp file + rename). */
	persist() {
		mkdirSync(dirname(this.path), { recursive: true });
		const temp = `${this.path}.tmp`;
		writeFileSync(temp, `${JSON.stringify(this.document, null, 2)}\n`, "utf8");
		renameSync(temp, this.path);
	}
};
//#endregion
//#region src/webui/server.ts
/**
* Dream WebUI ("应用层"): HTTP routes served through the harness webserver.
* The incubator owns a namespaced route family under /dreams — the immersive
* page, its static assets, a JSON ledger API, and an SSE stream that pushes
* each new dream to open pages — so the composition's SPA fallback seat and
* other plugins are never contested.
*
* @module dsh-dream-incubator/webui
*/
/**
* The webui root: lib/webui/ (populated from static/ by the build). The
* layout differs per runtime — `./webui/` beside the bundled index.js,
* `../../webui/` beside the tsc emit, the legacy `../webui/` in the src
* checkout — so probe for whichever actually contains the page, and fall
* back to the legacy relative path.
*/
const WEBUI_CANDIDATES = [
	"./webui/",
	"../webui/",
	"../../webui/"
];
let WEBUI_DIR = fileURLToPath(new URL(WEBUI_CANDIDATES[1], import.meta.url));
for (const candidate of WEBUI_CANDIDATES) {
	const dir = fileURLToPath(new URL(candidate, import.meta.url));
	if (existsSync(join(dir, "index.html"))) {
		WEBUI_DIR = dir;
		break;
	}
}
/** Body size cap for mutation requests. */
const MAX_BODY_BYTES = 1048576;
/** MIME map for static assets. */
const MIME = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8"
};
/** Send a JSON response with the given status code. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store"
	});
	res.end(payload);
}
/** Read and parse a capped JSON request body. */
function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				req.destroy();
				reject(/* @__PURE__ */ new Error("dream-incubator: request body too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const text = Buffer.concat(chunks).toString("utf8");
				const parsed = text.length > 0 ? JSON.parse(text) : {};
				resolve(typeof parsed === "object" && parsed !== null ? parsed : {});
			} catch {
				reject(/* @__PURE__ */ new Error("dream-incubator: invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}
/** Serve one static file with a content type; 404 when unknown or unsafe. */
function serveAsset(res, relativePath) {
	const safe = normalize(joinWithin(WEBUI_DIR, relativePath));
	if (!safe.startsWith(WEBUI_DIR) || safe === WEBUI_DIR) {
		res.writeHead(404).end("not found");
		return;
	}
	const type = MIME[extname(safe).toLowerCase()];
	if (type === void 0) {
		res.writeHead(404).end("not found");
		return;
	}
	readFile(safe).then((data) => {
		res.writeHead(200, {
			"Content-Type": type,
			"Cache-Control": "no-cache"
		});
		res.end(data);
	}, () => {
		res.writeHead(404).end("not found");
	});
}
/** Join without allowing traversal above the webui root. */
function joinWithin(root, relativePath) {
	const cleaned = relativePath.replace(/^\/+/u, "").split("?")[0] ?? "";
	if (cleaned.length === 0) return root;
	return `${root.replace(/\/+$/u, "")}/${cleaned}`;
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
function registerDreamWebUi(ctx, store, config) {
	const httpServer = ctx.httpServer;
	if (httpServer === void 0) throw new Error("dream-incubator: serveUi is enabled but the httpServer service is unavailable");
	const disposers = [];
	const clients = /* @__PURE__ */ new Set();
	const heartbeat = setInterval(() => {
		for (const client of clients) if (!client.writableEnded) client.write(": ping\n\n");
		else clients.delete(client);
	}, 25e3);
	heartbeat.unref?.();
	const push = (record) => {
		const frame = `data: ${JSON.stringify(record)}\n\n`;
		for (const client of clients) if (!client.writableEnded) client.write(frame);
		else clients.delete(client);
	};
	disposers.push(httpServer.register({
		kind: "exact",
		path: "/dreams",
		handler: (_req, res) => serveAsset(res, "index.html")
	}));
	disposers.push(httpServer.register({
		kind: "prefix",
		path: "/dreams/assets",
		handler: (req, res) => {
			serveAsset(res, new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/dreams\/assets/u, ""));
		}
	}));
	disposers.push(httpServer.register({
		kind: "exact",
		path: "/dreams/api/dreams",
		handler: async (req, res) => {
			if (req.method === "GET") {
				writeJson(res, 200, { records: store.all() });
				return;
			}
			if (req.method === "POST") {
				try {
					const body = await readBody(req);
					const id = body["id"];
					if (typeof id !== "string") {
						writeJson(res, 400, { error: "missing id" });
						return;
					}
					const dreamId = DreamId(id);
					const record = body["action"] === "collect" ? store.collect(dreamId) : body["action"] === "forget" ? store.forget(dreamId) : void 0;
					if (record === void 0) {
						writeJson(res, 404, { error: "dream not found" });
						return;
					}
					writeJson(res, 200, { record });
				} catch {
					writeJson(res, 400, { error: "invalid request" });
				}
				return;
			}
			writeJson(res, 405, { error: "method not allowed" });
		}
	}));
	disposers.push(httpServer.register({
		kind: "exact",
		path: "/dreams/api/settings",
		handler: (req, res) => {
			if (req.method !== "GET") {
				writeJson(res, 405, { error: "method not allowed" });
				return;
			}
			writeJson(res, 200, { settings: {
				cooldownMs: config.cooldownMs,
				minMaterialEvents: config.minMaterialEvents,
				maxDailyDreams: config.maxDailyDreams,
				styleRotationDays: config.styleRotationDays,
				noiseIntensity: config.noiseIntensity,
				maxOutputTokens: config.maxOutputTokens,
				timeoutMs: config.timeoutMs,
				privacyMode: config.privacyMode,
				serveUi: config.serveUi,
				route: config.provider !== void 0 ? `${config.provider}/${config.model}` : null
			} });
		}
	}));
	disposers.push(httpServer.register({
		kind: "exact",
		path: "/dreams/api/stream",
		handler: (req, res) => {
			res.writeHead(200, {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no"
			});
			res.write(": connected\n\n");
			clients.add(res);
			req.on("close", () => clients.delete(res));
		}
	}));
	return {
		push,
		dispose: () => {
			clearInterval(heartbeat);
			for (const disposer of disposers) disposer();
			for (const client of clients) client.end();
			clients.clear();
		}
	};
}
//#endregion
//#region src/index.ts
/** Cordis plugin name. */
const name = "dream-incubator";
/** Services the plugin needs before it can run a dream cycle. */
const inject = ["llm", "sessions"];
/** Complete configuration key set for direct construction validation. */
const CONFIG_KEYS = /* @__PURE__ */ new Set([
	"cooldownMs",
	"minMaterialEvents",
	"maxDailyDreams",
	"styleRotationDays",
	"noiseIntensity",
	"maxOutputTokens",
	"timeoutMs",
	"privacyMode",
	"provider",
	"model",
	"storePath",
	"serveUi"
]);
/** Shared Loader field schemas with no library defaults. */
const DreamIncubatorConfigFields = {
	cooldownMs: z.number().step(1).min(0).required(),
	minMaterialEvents: z.number().step(1).min(0).required(),
	maxDailyDreams: z.number().step(1).min(1).required(),
	styleRotationDays: z.number().step(1).min(1).required(),
	noiseIntensity: z.union([
		"low",
		"medium",
		"high"
	]).required(),
	maxOutputTokens: z.number().step(1).min(1).required(),
	timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
	privacyMode: z.boolean().required(),
	provider: z.string(),
	model: z.string(),
	storePath: z.string().required(),
	serveUi: z.boolean().required()
};
/** Shared Loader schema with no library defaults. */
const DreamIncubatorConfigSchema = z.object(DreamIncubatorConfigFields);
/** Validate one positive integer limit. */
function assertPositiveInteger(name, value) {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`dream-incubator: ${name} must be a positive integer`);
}
/**
* Validate and detach required incubator configuration.
* @param config - untrusted plugin configuration.
* @returns immutable policy; a missing optional route stays absent.
*/
function resolveDreamIncubatorConfig(config) {
	const candidate = config;
	if (candidate === null || typeof candidate !== "object") throw new Error("dream-incubator: configuration is required");
	const value = candidate;
	for (const key of Object.keys(value)) if (!CONFIG_KEYS.has(key)) throw new Error(`dream-incubator: unknown config key "${key}"`);
	const cooldownMs = value["cooldownMs"];
	if (typeof cooldownMs !== "number" || !Number.isInteger(cooldownMs) || cooldownMs < 0) throw new Error("dream-incubator: cooldownMs must be a non-negative integer");
	const minMaterialEvents = value["minMaterialEvents"];
	if (typeof minMaterialEvents !== "number" || !Number.isInteger(minMaterialEvents) || minMaterialEvents < 0) throw new Error("dream-incubator: minMaterialEvents must be a non-negative integer");
	assertPositiveInteger("maxDailyDreams", value["maxDailyDreams"]);
	assertPositiveInteger("styleRotationDays", value["styleRotationDays"]);
	assertPositiveInteger("maxOutputTokens", value["maxOutputTokens"]);
	const timeoutMs = value["timeoutMs"];
	if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("dream-incubator: timeoutMs must be a positive integer");
	if (timeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`dream-incubator: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`);
	const noiseIntensity = value["noiseIntensity"];
	if (noiseIntensity !== "low" && noiseIntensity !== "medium" && noiseIntensity !== "high") throw new Error("dream-incubator: noiseIntensity must be \"low\", \"medium\", or \"high\"");
	if (typeof value["privacyMode"] !== "boolean") throw new Error("dream-incubator: privacyMode must be a boolean");
	if (typeof value["serveUi"] !== "boolean") throw new Error("dream-incubator: serveUi must be a boolean");
	const storePath = value["storePath"];
	if (typeof storePath !== "string" || storePath.length === 0) throw new Error("dream-incubator: storePath must be a non-empty string");
	const hasProvider = value["provider"] !== void 0;
	if (hasProvider !== (value["model"] !== void 0)) throw new Error("dream-incubator: provider and model must be supplied together");
	if (hasProvider && (typeof value["provider"] !== "string" || value["provider"].length === 0 || typeof value["model"] !== "string" || value["model"].length === 0)) throw new Error("dream-incubator: provider and model overrides must be non-empty strings");
	return deepFreeze({ ...candidate });
}
/**
* Apply the dream-incubator plugin.
* @param ctx - context exposing the LLM and session services.
* @param config - untrusted required deployment policy.
*/
function apply(ctx, config) {
	const resolved = resolveDreamIncubatorConfig(config);
	const store = DreamStore.open(resolved.storePath);
	const logger = ctx.logger("dream-incubator");
	ctx.effect(() => {
		let disposed = false;
		const disposers = [];
		const cadence = /* @__PURE__ */ new Map();
		const lifecycle = new AbortController();
		/** The WebUI push channel; a no-op when the UI is disabled. */
		let push = () => {};
		if (resolved.serveUi) {
			const webui = registerDreamWebUi(ctx, store, resolved);
			push = webui.push;
			disposers.push(webui.dispose);
		}
		const dispose = () => {
			disposed = true;
			lifecycle.abort();
			for (const disposer of disposers) disposer();
		};
		/**
		* Decide whether a cycle may start now, and why not otherwise.
		* @param session - the session about to dream.
		* @param state - the session's cadence state.
		* @returns undefined when dreaming is allowed.
		*/
		function gateReason(session, state) {
			if (state !== void 0) {
				if (state.running) return "already-dreaming";
				if (Date.now() - state.lastAttemptAt < resolved.cooldownMs) return "cooldown";
			}
			if (session.events.length < resolved.minMaterialEvents) return "not-enough-material";
			const now = Date.now();
			const dayStart = now - now % 864e5;
			if (store.dailyCount(session.id, dayStart) >= resolved.maxDailyDreams) return "daily-cap";
		}
		/**
		* Run one gated dream cycle for a session and persist the result.
		* @param session - the live session whose log feeds the dream.
		* @param force - bypass cooldown and material gates (manual /dream).
		* @param externalSignal - optional caller-owned cancellation.
		* @returns the dream record, or undefined when gated or failed.
		*/
		async function dreamFor(session, force, externalSignal) {
			if (disposed) return void 0;
			let state = cadence.get(session.id);
			if (state === void 0) {
				state = {
					lastAttemptAt: 0,
					running: false
				};
				cadence.set(session.id, state);
			}
			const reason = force ? void 0 : gateReason(session, state);
			if (reason !== void 0) {
				logger.debug(`dream cycle declined for ${session.id}: ${reason}`);
				return;
			}
			if (state.running) return void 0;
			state.running = true;
			try {
				const record = await generateDream(ctx, resolved, session, store.lastMaterialSeq(session.id), Math.random, externalSignal ?? lifecycle.signal);
				state.lastAttemptAt = record.createdAt;
				store.append(record);
				push(record);
				logger.info(`dreamed "${record.title}" (${record.style}) for ${session.id}`);
				return record;
			} catch (error) {
				state.lastAttemptAt = Date.now();
				logger.warn(`dream cycle failed for ${session.id}: ${error.message}`);
				return;
			} finally {
				state.running = false;
			}
		}
		disposers.push(ctx.on("session/event", (session, event) => {
			if (disposed || event.type !== "turn/end") return;
			dreamFor(session, false);
		}));
		if (ctx.commands) {
			disposers.push(ctx.commands.register({
				name: "dream",
				description: "立刻为当前会话做一场梦",
				handler: async (invocation) => {
					const record = await dreamFor(invocation.agent.session, true, invocation.signal);
					if (record === void 0) return {
						kind: "error",
						text: "做梦失败了，看看日志吧。"
					};
					return {
						kind: "success",
						text: `梦见「${record.title}」——${record.style} 风格，${record.moodLabel}。在 WebUI 里看完整梦境。`
					};
				}
			}));
			disposers.push(ctx.commands.register({
				name: "dreams",
				description: "列出最近的梦境",
				handler: (invocation) => {
					const records = store.all().filter((record) => record.sessionId === invocation.agent.session.id).slice(0, 8);
					if (records.length === 0) return {
						kind: "success",
						text: "还没有梦。让会话多聊一会儿，或者输入 /dream。"
					};
					return {
						kind: "success",
						text: ["最近的梦：", ...records.map((record, index) => {
							const when = new Date(record.createdAt).toLocaleString("zh-CN");
							return `${record.collected ? "已收录" : record.forgotten ? "已遗忘" : "     "} ${index + 1}. 「${record.title}」— ${record.style} — ${record.moodLabel} — ${when}`;
						})].join("\n")
					};
				}
			}));
			disposers.push(ctx.commands.register({
				name: "dreamsettings",
				description: "查看梦境孵化器配置",
				handler: () => {
					const c = resolved;
					const route = c.provider !== void 0 ? `${c.provider}/${c.model}` : "跟随会话";
					return {
						kind: "success",
						text: ["梦境孵化器配置：", ...[
							`冷却 ${c.cooldownMs / 1e3}s / 最少素材 ${c.minMaterialEvents} 条 / 每日上限 ${c.maxDailyDreams} 场`,
							`噪声强度 ${c.noiseIntensity} / 风格轮换 ${c.styleRotationDays} 天 / 输出上限 ${c.maxOutputTokens} tokens / 超时 ${c.timeoutMs / 1e3}s`,
							`模型路由 ${route} / 隐私模式 ${c.privacyMode ? "开" : "关"} / WebUI ${c.serveUi ? "开" : "关"}`
						]].join("\n")
					};
				}
			}));
		}
		return dispose;
	});
}
//#endregion
export { DreamIncubatorConfigFields, DreamIncubatorConfigSchema, apply, inject, name, resolveDreamIncubatorConfig };
