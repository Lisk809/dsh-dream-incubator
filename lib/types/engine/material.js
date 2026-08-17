/**
 * Observation layer ("观测层"): derive dream material from the session log.
 * Pure functions over {@link SessionEvent} tails — stateless, restart-proof,
 * and testable. The plugin never accumulates material in memory; every dream
 * reads its window from the live session log at dream time.
 *
 * @module dsh-dream-incubator/engine/material
 */
/** How many trailing events one dream may cite. */
export const MATERIAL_WINDOW = 60;
/** Cap one material line's text so the scan prompt stays bounded. */
export const MATERIAL_LINE_CHARS = 220;
/** Recursively collect text from model content blocks (tool-result nests). */
export function extractText(blocks) {
    const parts = [];
    for (const block of blocks) {
        switch (block.type) {
            case 'text':
                parts.push(block.text);
                break;
            case 'tool-result':
                parts.push(extractText(block.content));
                break;
            /* v8 ignore next -- merge-extensible content vocabulary; unknown blocks carry no readable text */
            default:
                break;
        }
    }
    return parts.join('\n');
}
/** Truncate a material line to {@link MATERIAL_LINE_CHARS} with an ellipsis. */
export function truncate(text, max = MATERIAL_LINE_CHARS) {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= max)
        return flat;
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
export function materialFromEvents(events) {
    const lines = [];
    for (const event of events) {
        switch (event.type) {
            case 'user/message': {
                const text = userText(event).trim();
                if (text.length > 0) {
                    lines.push({ seq: event.seq, kind: 'user', text: truncate(text) });
                }
                break;
            }
            case 'assistant/message': {
                const text = assistantText(event).trim();
                if (text.length > 0) {
                    lines.push({ seq: event.seq, kind: 'assistant', text: truncate(text, 160) });
                }
                break;
            }
            case 'tool/call': {
                const args = truncate(event.data.arguments, 80);
                lines.push({ seq: event.seq, kind: 'tool', text: truncate(`调用 ${event.data.name}(${args})`, 140) });
                break;
            }
            case 'tool/result': {
                if (event.data.error !== undefined) {
                    lines.push({ seq: event.seq, kind: 'error', text: truncate(`工具失败 ${event.data.error.name}: ${event.data.error.code}`, 140) });
                    break;
                }
                const text = toolResultText(event).trim();
                if (text.length > 0) {
                    lines.push({ seq: event.seq, kind: 'tool', text: truncate(text, 120) });
                }
                break;
            }
            case 'turn/end': {
                if (event.data.reason.kind === 'error') {
                    lines.push({ seq: event.seq, kind: 'error', text: truncate(`回合出错: ${event.data.reason.error.message}`, 160) });
                }
                break;
            }
            /* v8 ignore next -- other event kinds carry no dream material */
            default:
                break;
        }
    }
    return lines;
}
/** Structural statistics over one material window. */
export function materialStats(lines) {
    let userMessageCount = 0;
    let assistantMessageCount = 0;
    let toolCallCount = 0;
    let errorCount = 0;
    for (const line of lines) {
        switch (line.kind) {
            case 'user':
                userMessageCount += 1;
                break;
            case 'assistant':
                assistantMessageCount += 1;
                break;
            case 'tool':
                toolCallCount += 1;
                break;
            case 'error':
                errorCount += 1;
                break;
            /* v8 ignore next -- MaterialLine.kind is closed and every member is handled above */
            default: break;
        }
    }
    return {
        eventCount: lines.length,
        userMessageCount,
        assistantMessageCount,
        toolCallCount,
        errorCount,
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
export function selectWindow(events, sinceSeq) {
    const tail = events.slice(-MATERIAL_WINDOW);
    if (sinceSeq === undefined)
        return tail;
    return tail.filter(event => event.seq > sinceSeq);
}
