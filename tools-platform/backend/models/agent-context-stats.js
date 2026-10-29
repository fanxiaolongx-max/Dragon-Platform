// Dragon Claw 工作区：右侧「上下文」面板的 token 统计（中英混排按 3.5 字符/Token 估算分项）。
// 供应商返回 promptTokens（含缓存命中）时总数以其为准，各分项按估算比例缩放，并给出缓存命中率。

function estimateTokens(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value || '');
    return Math.ceil(String(text || '').length / 3.5);
}

// 常见模型的默认上下文窗口；模型配置里填了「上下文窗口」时以配置为准（ai-settings contextWindowTokens）
const DEFAULT_WINDOWS = [
    [/\[1m\]|[-_]1m\b/, 1000000],
    [/claude/, 200000],
    [/gemini-1\.5-pro/, 2000000],
    [/gemini/, 1000000],
    [/minimax-m1/, 1000000],
    [/minimax-m2|minimax-m3/, 200000],
    [/gpt-4\.1/, 1000000],
    [/gpt-5/, 400000],
    [/gpt-4o|^o\d/, 128000],
    [/gpt-4(?!o)/, 8192],
    [/deepseek|qwen|glm|kimi|moonshot/, 128000]
];

function windowFor(model, configured = 0) {
    const fixed = Math.round(Number(configured) || 0);
    if (fixed > 0) return fixed;
    const name = String(model || '').toLowerCase();
    const hit = DEFAULT_WINDOWS.find(([pattern]) => pattern.test(name));
    return hit ? hit[1] : 128000;
}

// 整轮裁剪的兜底线：窗口的 90% 减去输出预留；之上的部分就是「压缩预留」
function budgetFor(windowTokens, maxOutputTokens = 2048) {
    return Math.max(1024, Math.floor(windowTokens * 0.9) - Math.max(2048, Number(maxOutputTokens) || 2048));
}

// 自动压缩（生成摘要）的触发线：窗口的 80%，并始终比兜底线低 5% 窗口，留出生成摘要的余量
const COMPACT_RATIO = Math.min(0.85, Math.max(0.5, Number(process.env.TOOLS_AGENT_COMPACT_RATIO) || 0.8));
function compactThreshold(windowTokens, maxOutputTokens = 2048) {
    return Math.max(512, Math.min(Math.floor(windowTokens * COMPACT_RATIO), budgetFor(windowTokens, maxOutputTokens) - Math.floor(windowTokens * 0.05)));
}

// 一次请求的估算 token：中日韩文字密度更高，不能一律按 3.5 字符估算
function estimateRequest(systemPrompt, tools, messages) {
    const payload = JSON.stringify([systemPrompt, tools, messages]);
    const dense = (payload.match(/[\u2e80-\u9fff\uac00-\ud7af]/g) || []).length;
    return Math.ceil((payload.length - dense) / 3 + dense * 1.5);
}

function estimateMessages(messages) {
    const { messages: text, toolResults } = estimateConversation(messages);
    return text + toolResults;
}

// 对话文字（含模型的工具调用参数）与工具返回结果分开统计
function estimateConversation(messages) {
    return (Array.isArray(messages) ? messages : []).reduce((sum, msg) => {
        if (!msg) return sum;
        sum.messages += estimateTokens(msg.content || '') + 4;
        if (Array.isArray(msg.toolCalls)) sum.messages += estimateTokens(msg.toolCalls);
        if (Array.isArray(msg.toolResults)) sum.toolResults += msg.toolResults.reduce((acc, item) => acc + estimateTokens(item.content || ''), 0);
        return sum;
    }, { messages: 0, toolResults: 0 });
}

// 留出输出与估算误差余量。优先按整轮移出旧上下文，始终保留调用/响应配对。
// 此处只裁剪请求副本，完整历史独立保存在 SQLite。
function fitMessages({ model, contextWindow = 0, systemPrompt = '', messages = [], tools = [], maxOutputTokens = 2048 } = {}) {
    const window = windowFor(model, contextWindow);
    const budget = budgetFor(window, maxOutputTokens);
    const turns = [];
    for (const message of messages) {
        if (message.role === 'user' || !turns.length) turns.push([]);
        turns[turns.length - 1].push(message);
    }
    const cost = () => estimateRequest(systemPrompt, tools, turns);
    let droppedTurns = 0;
    while (turns.length > 1 && cost() > budget) { turns.shift(); droppedTurns += 1; }
    // 工具结果可缩短；签名对应的模型调用参数保持原样。按时间从早到晚缩短，先缩到 1000 字、仍超出再缩到 300 字；
    // 最近一步刚拿到的结果最后才动——模型正要据此判断，截掉会让它把没看到的内容当成不存在。
    const toolSlots = [];
    turns.forEach((turn, turnIndex) => turn.forEach((entry, entryIndex) => { if (entry.role === 'tool') toolSlots.push([turnIndex, entryIndex]); }));
    const latest = toolSlots.pop();
    for (const slots of [toolSlots, latest ? [latest] : []]) {
        for (const limit of [1000, 300]) {
            for (const [turnIndex, entryIndex] of slots) {
                if (cost() <= budget) break;
                const entry = turns[turnIndex][entryIndex];
                turns[turnIndex][entryIndex] = { ...entry, toolResults: entry.toolResults.map(item => ({ ...item,
                    content: item.content.length > limit + 80 ? `${item.content.slice(0, limit)}\n…（上下文已缩短；完整结果保存在会话档案中）` : item.content })) };
            }
        }
    }
    if (cost() > budget) throw Object.assign(new Error('当前消息或工具参数超出模型上下文预算，请缩小范围或开始新对话。已执行步骤保留在历史中。'), { code: 'AGENT_CONTEXT_LIMIT', statusCode: 413 });
    return { messages: turns.flat(), droppedTurns, budget };
}

/**
 * @param {object} input
 * @param {string} input.model
 * @param {number} [input.contextWindow]  模型配置里的上下文窗口（0 = 按模型名）
 * @param {string} input.systemPrompt     不含目录概览的系统提示（含 Skill 段落）
 * @param {string} [input.skillPrompt]    系统提示中 Skill 目录与已加载 Skill 正文，单独计入 skills
 * @param {string} input.directoryContext 目录概览文本
 * @param {Array}  input.messages         送给模型的消息（含工具转录）
 * @param {Array}  input.tools            工具定义
 * @param {Array}  [input.deferredTools]  按需加载、本轮没有发给模型的工具定义（不计入占用，只显示数量）
 * @param {number} [input.maxOutputTokens]
 * @param {object} [input.usage]          供应商报告的最后一步用量 { promptTokens, cachedTokens, cacheWriteTokens }
 * @param {number} [input.providerPromptTokens] 旧参数，等同 usage.promptTokens
 */
function build({ model, contextWindow = 0, systemPrompt = '', skillPrompt = '', directoryContext = '', messages = [], tools = [], deferredTools = [], maxOutputTokens = 2048, usage = null, providerPromptTokens = 0 } = {}) {
    const windowTokens = windowFor(model, contextWindow);
    const conversation = estimateConversation(messages);
    const skills = skillPrompt ? estimateTokens(skillPrompt) : 0;
    const estimate = {
        system: Math.max(0, estimateTokens(systemPrompt) - skills),
        skills,
        directory: estimateTokens(directoryContext),
        tools: estimateTokens(tools),
        messages: conversation.messages,
        toolResults: conversation.toolResults
    };
    const estimatedTotal = Object.values(estimate).reduce((a, b) => a + b, 0);
    const provider = Number(usage?.promptTokens || providerPromptTokens) || 0;
    let parts = { ...estimate };
    let source = 'estimate';
    if (provider > 0 && estimatedTotal > 0) {
        // 总数以供应商为准；分项按估算比例折算，四舍五入的零头补到对话消息上，保证合计一致
        const ratio = provider / estimatedTotal;
        parts = Object.fromEntries(Object.entries(estimate).map(([key, value]) => [key, Math.round(value * ratio)]));
        parts.messages += provider - Object.values(parts).reduce((a, b) => a + b, 0);
        source = 'provider';
    }
    const usedTokens = Math.min(windowTokens, Object.values(parts).reduce((a, b) => a + b, 0));
    // 压缩预留：超过裁剪线后旧内容会被移出，这一段不会被正常占用
    parts.reserve = Math.max(0, Math.min(windowTokens - usedTokens, windowTokens - budgetFor(windowTokens, maxOutputTokens)));
    parts.free = Math.max(0, windowTokens - usedTokens - parts.reserve);
    const cachedTokens = source === 'provider' ? Math.min(provider, Number(usage?.cachedTokens || 0)) : 0;
    return {
        windowTokens,
        windowSource: Number(contextWindow) > 0 ? 'configured' : 'model',
        usedTokens,
        source,
        parts,
        cache: source === 'provider' ? { cachedTokens, cacheWriteTokens: Number(usage?.cacheWriteTokens || 0), hitRate: provider ? cachedTokens / provider : 0 } : null,
        tools: { loaded: tools.length, deferred: deferredTools.length, deferredTokens: estimateTokens(deferredTools) }
    };
}

module.exports = { estimateTokens, estimateRequest, windowFor, budgetFor, compactThreshold, estimateMessages, estimateConversation, fitMessages, build };
