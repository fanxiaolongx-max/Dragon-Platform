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

module.exports = { estimateTokens, windowFor, estimateMessages, build };
