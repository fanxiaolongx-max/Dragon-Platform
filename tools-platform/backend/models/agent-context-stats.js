// Dragon Claw 工作区：右侧「上下文」面板的 token 估算（中英混排按 3.5 字符/Token）。
// 供应商返回 promptTokens 时以其为准，各分项按估算比例缩放。

function estimateTokens(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value || '');
    return Math.ceil(String(text || '').length / 3.5);
}

function windowFor(model) {
    const name = String(model || '').toLowerCase();
    if (/claude/.test(name)) return 200000;
    if (/gemini/.test(name)) return 1000000;
    if (/minimax-m2|minimax-m3/.test(name)) return 200000;
    if (/gpt-4o|gpt-4\.1|gpt-5|^o\d/.test(name)) return 128000;
    if (/gpt-4(?!o)/.test(name)) return 8192;
    return 128000;
}

function estimateMessages(messages) {
    return (Array.isArray(messages) ? messages : []).reduce((sum, msg) => {
        if (!msg) return sum;
        let total = estimateTokens(msg.content || '') + 4;
        if (Array.isArray(msg.toolCalls)) total += estimateTokens(msg.toolCalls);
        if (Array.isArray(msg.toolResults)) total += msg.toolResults.reduce((acc, item) => acc + estimateTokens(item.content || ''), 0);
        return sum + total;
    }, 0);
}

// 留出输出与估算误差余量。优先按整轮移出旧上下文，始终保留调用/响应配对。
// 此处只裁剪请求副本，完整历史独立保存在 SQLite。
function fitMessages({ model, systemPrompt = '', messages = [], tools = [], maxOutputTokens = 2048 } = {}) {
    const window = windowFor(model);
    const budget = Math.max(1024, Math.floor(window * 0.75) - Math.max(2048, Number(maxOutputTokens) || 2048));
    const turns = [];
    for (const message of messages) {
        if (message.role === 'user' || !turns.length) turns.push([]);
        turns[turns.length - 1].push(message);
    }
    const cost = () => {
        const payload = JSON.stringify([systemPrompt, tools, turns]);
        // 中日韩文字 token 密度更高，不能一律按 3.5 字符估算。
        const dense = (payload.match(/[\u2e80-\u9fff\uac00-\ud7af]/g) || []).length;
        return Math.ceil((payload.length - dense) / 3 + dense * 1.5);
    };
    let droppedTurns = 0;
    while (turns.length > 1 && cost() > budget) { turns.shift(); droppedTurns += 1; }
    if (cost() > budget) {
        // 工具结果可缩短；签名对应的模型调用参数保持原样。
        for (let index = 0; index < (turns[0] || []).length; index++) {
            const entry = turns[0][index];
            if (entry.role !== 'tool') continue;
            turns[0][index] = { ...entry, toolResults: entry.toolResults.map(item => ({ ...item,
                content: item.content.length > 1000 ? `${item.content.slice(0, 1000)}\n…（上下文已缩短；完整结果保存在会话档案中）` : item.content })) };
            if (cost() <= budget) break;
        }
    }
    if (cost() > budget) throw Object.assign(new Error('当前消息或工具参数超出模型上下文预算，请缩小范围或开始新对话。已执行步骤保留在历史中。'), { code: 'AGENT_CONTEXT_LIMIT', statusCode: 413 });
    return { messages: turns.flat(), droppedTurns, budget };
}

/**
 * @param {object} input
 * @param {string} input.model
 * @param {string} input.systemPrompt   不含目录概览的系统提示
 * @param {string} input.directoryContext 目录概览文本
 * @param {Array}  input.messages       送给模型的消息（含工具转录）
 * @param {Array}  input.tools          工具定义
 * @param {number} [input.providerPromptTokens] 供应商报告的最后一步 prompt tokens
 */
function build({ model, systemPrompt = '', directoryContext = '', messages = [], tools = [], providerPromptTokens = 0 } = {}) {
    const windowTokens = windowFor(model);
    const estimate = {
        system: estimateTokens(systemPrompt),
        directory: estimateTokens(directoryContext),
        messages: estimateMessages(messages),
        tools: estimateTokens(tools)
    };
    const estimatedTotal = Object.values(estimate).reduce((a, b) => a + b, 0);
    const provider = Number(providerPromptTokens) || 0;
    let parts = { ...estimate };
    let source = 'estimate';
    if (provider > 0 && estimatedTotal > 0) {
        const ratio = provider / estimatedTotal;
        parts = Object.fromEntries(Object.entries(estimate).map(([key, value]) => [key, Math.round(value * ratio)]));
        source = 'provider';
    }
    const usedTokens = Math.min(windowTokens, Object.values(parts).reduce((a, b) => a + b, 0));
    parts.free = Math.max(0, windowTokens - usedTokens);
    return { windowTokens, usedTokens, source, parts };
}

module.exports = { estimateTokens, windowFor, estimateMessages, fitMessages, build };
