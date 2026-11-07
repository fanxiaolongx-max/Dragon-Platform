'use strict';
// Provider metadata is a different scope from token-by-token decode timing.
const number = value => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
};
function durationMs(value) {
    if (typeof value === 'string' && /^\d+(?:\.\d{1,9})?s$/.test(value)) return Number(value.slice(0,-1))*1000;
    if (value && typeof value === 'object') {
        const seconds = number(value.seconds ?? 0), nanos = number(value.nanos ?? 0);
        if (seconds !== null && nanos !== null && nanos < 1e9) return seconds*1000+nanos/1e6;
    }
    return null;
}
function enrichAntigravity(content, metadata) {
    const byStep = new Map();
    for (const entry of metadata || []) for (const index of entry.steps || []) {
        if (!Number.isSafeInteger(index) || index < 0) continue;
        byStep.set(String(index), byStep.has(String(index)) ? null : entry);
    }
    const enrich = round => {
        const entry = byStep.get(String(round.requestId || '').split(':').at(-1));
        if (!entry) return round;
        const output = number(entry.output), input = number(entry.input), cache = number(entry.cache);
        // Match both counters: never associate a reused/stale step with another request.
        if (output !== round.outputTokens || input === null || cache === null || input+cache !== round.inputTokens) return round;
        const ttftMs = durationMs(entry.ttft), streamMs = durationMs(entry.stream);
        const thinking = number(entry.thinking);
        return {...round, ttftMs, timingSource:'native-metadata', timingEstimated:false,
            reasoningOutputTokens:thinking !== null && thinking <= output ? thinking : null,
            nativeStreamMs:streamMs, nativeStreamTokens:output,
            nativeStreamTps:streamMs > 0 && output > 0 ? output*1000/streamMs : null,
            nativeStreamScope:'reported-output-including-reasoning'};
    };
    return {...content,items:content.items.map(item=>item.rounds?.length?{...item,rounds:item.rounds.map(enrich)}:item),modelUsage:(content.modelUsage||[]).map(enrich)};
}
module.exports={durationMs,enrichAntigravity};

// WorkBuddy SDK logs expose when its desktop client receives the first text.
// This is user-turn first-text latency, not a model API's TTFT or decode speed.
function workbuddyFirstText(log, id) {
    const result = new Map();
    for (const line of String(log).split('\n')) {
        const timestamp = line.match(/^\[?(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1];
        if (!timestamp) continue;
        let entry;
        try { entry = JSON.parse(line.slice(line.indexOf('{'))); } catch { continue; }
        if (entry.conversationId !== id || entry.input !== 'agent_message_chunk' || typeof entry.requestId !== 'string' || entry.requestId.length > 500) continue;
        const at = Date.parse(timestamp);
        if (Number.isFinite(at)) result.set(entry.requestId, Math.min(result.get(entry.requestId) ?? Infinity, at));
    }
    return result;
}
async function enrichWorkbuddy(content, id, starts, root) {
    if (!/^[a-f0-9-]{36}$/i.test(id) || !starts.size) return content;
    const fs = require('node:fs/promises'), path = require('node:path');
    const first = new Map(), dates = new Set();
    for (const at of starts.values()) for (const offset of [-86400000,0,86400000]) dates.add(new Date(at+offset).toISOString().slice(0,10));
    const realRoot = await fs.realpath(root).catch(()=>null);
    if (!realRoot) return content;
    for (const date of [...dates].sort().reverse().slice(0,14)) {
        const file = path.join(root,'logs',date,'sdk','conversations',id+'.log');
        const real = await fs.realpath(file).catch(()=>null);
        if (!real || !real.startsWith(realRoot+path.sep)) continue;
        const stat = await fs.stat(real).catch(()=>null);
        // A truncated tail cannot establish the FIRST text arrival.
        if (!stat?.isFile() || stat.size > 16*1024*1024) continue;
        for (const [key,at] of workbuddyFirstText(await fs.readFile(real,'utf8').catch(()=>''),id)) first.set(key,Math.min(first.get(key)??Infinity,at));
    }
    const selected = new Map(), seen = new Set();
    for (const round of content.modelUsage || []) {
        if (!round.turnId || seen.has(round.turnId)) continue;
        seen.add(round.turnId);
        const start = starts.get(round.turnId), end = first.get(round.turnId);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end-start < 6*3600000) selected.set(round.requestId,end-start);
    }
    const enrich = round => selected.has(round.requestId) ? {...round,observedFirstTextMs:selected.get(round.requestId),firstTextSource:'workbuddy-native-sdk-log'} : round;
    return {...content,items:content.items.map(item=>item.rounds?.length?{...item,rounds:item.rounds.map(enrich)}:item),modelUsage:(content.modelUsage||[]).map(enrich)};
}
module.exports.workbuddyFirstText=workbuddyFirstText;
module.exports.enrichWorkbuddy=enrichWorkbuddy;
