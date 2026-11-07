// 每轮模型调用的耗时与速度：包住 AI 客户端的 generateText / generateChat，记录每一次调用（一轮）
// 模型、输入 / 输出 token、总耗时、首字耗时与生成速度（仅在输出计数和流式计时范围一致时计算）。
// 对话回复下方的「最低 / 平均 / 最高 tok/s」和导出日志里的每轮明细都来自这里（routes/ai.js 发出 model_round 事件）。
'use strict';

// 供应商没返回用量时按文字估算（中文约 1.6 字 / token，其他约 4 字符 / token），并标记为估算
function estimateTokens(text) {
    const value = String(text || '');
    if (!value) return 0;
    const cjk = (value.match(/[㐀-鿿豈-﫿]/g) || []).length;
    return Math.max(1, Math.round(cjk / 1.6 + (value.length - cjk) / 4));
}

function summarizeRounds(rounds = []) {
    const measured = rounds.filter(round => Number(round.tps) > 0);
    const speeds = measured.map(round => Number(round.tps)).filter(value => Number.isFinite(value) && value > 0);
    const outputTokens = rounds.reduce((sum, round) => sum + (Number(round.outputTokens) || 0), 0);
    const measuredTokens = measured.reduce((sum, round) => sum + (round.decodeTokens ?? Number(round.outputTokens) ?? 0), 0);
    const generationMs = measured.reduce((sum, round) => sum + (Number(round.generationMs) || 0), 0);
    return {
        rounds: rounds.length,
        minTps: speeds.length ? Math.min(...speeds) : 0,
        maxTps: speeds.length ? Math.max(...speeds) : 0,
        // 平均速度按总输出 token ÷ 总生成时间，长回复的权重更大，比简单平均更接近实际体感
        avgTps: generationMs > 0 ? Math.round(measuredTokens / (generationMs / 1000) * 10) / 10 : 0,
        outputTokens,
        totalMs: rounds.reduce((sum, round) => sum + (Number(round.ms) || 0), 0)
    };
}

function trackRounds(client, onRound) {
    if (!client || (typeof client.generateText !== 'function' && typeof client.generateChat !== 'function')) return client;
    let index = 0;
    const wrap = method => async (options = {}) => {
        const startedAt = Date.now();
        let firstAt = 0;
        let streamed = '', chunks = 0;
        const mark = () => { if (!firstAt) firstAt = Date.now(); };
        const patched = { ...options };
        if (typeof options.onDelta === 'function') patched.onDelta = (delta, ...rest) => { if (delta) { mark(); chunks++; } streamed += String(delta || ''); return options.onDelta(delta, ...rest); };
        if (typeof options.onReasoning === 'function') patched.onReasoning = (delta, ...rest) => { return options.onReasoning(delta, ...rest); };
        const result = await method.call(client, patched);
        try {
            const endedAt = Date.now();
            const reported = Number(result?.usage?.outputTokens) || 0;
            const outputTokens = reported || estimateTokens(result?.text || streamed);
            const ms = endedAt - startedAt;
            const generationMs = firstAt ? endedAt - firstAt : null;
            const reasoning = result?.usage?.reasoningTokens;
            const canDecode = reported > 1 && reasoning === 0 && chunks > 1 && !result?.autoSwitch && generationMs > 0;
            const cached = result?.usage?.cachedTokens;
            index += 1;
            const round = {
                index,
                model: result?.autoSwitch?.to || [client.provider, client.model].filter(Boolean).join('/') || '',
                inputTokens: Number(result?.usage?.inputTokens || result?.usage?.promptTokens) || 0,
                outputTokens,
                estimated: !reported,
                cachedInputTokens: Number.isSafeInteger(cached) && cached >= 0 ? cached : null,
                reasoningOutputTokens: Number.isSafeInteger(reasoning) ? reasoning : null,
                timingSource: firstAt ? 'request-stream' : 'buffered',
                timingEstimated: false,
                decodeTokens: canDecode ? reported - 1 : null,
                ms,
                ttftMs: firstAt ? firstAt - startedAt : null,
                generationMs,
                tps: canDecode ? Math.round((reported - 1) / (generationMs / 1000) * 10) / 10 : null,
                at: new Date(startedAt).toISOString()
            };
            onRound?.(round);
        } catch { /* 统计出错不影响回复 */ }
        return result;
    };
    const generateText = typeof client.generateText === 'function' ? wrap(client.generateText) : undefined;
    const generateChat = typeof client.generateChat === 'function' ? wrap(client.generateChat) : generateText;
    return new Proxy(client, {
        get(target, prop, receiver) {
            if (prop === 'generateText' && generateText) return generateText;
            if (prop === 'generateChat') return generateChat;
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

module.exports = { trackRounds, summarizeRounds, estimateTokens };
