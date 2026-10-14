const DEFAULT_BASE_URLS = {
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    minimax: 'https://api.minimax.io/v1',
    'openai-compatible': 'https://api.openai.com/v1'
};
const aiUsageRepo = require('./ai-usage-repository');

function normalizeProvider(provider) {
    const value = String(provider || '').trim().toLowerCase();
    if (['gemini', 'openai', 'anthropic', 'minimax', 'openai-compatible'].includes(value)) return value;
    return 'gemini';
}

function trimSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function getBaseUrl(settings = {}) {
    const provider = normalizeProvider(settings.provider);
    return trimSlash(settings.apiBaseUrl || DEFAULT_BASE_URLS[provider]);
}

// 统一消息模型：
//   { role:'user',  content }
//   { role:'model', content, toolCalls?: [{ id, name, args, thoughtSignature? }] }
//   （thoughtSignature 是 Gemini 3 的思考签名，原样回传；其他供应商忽略）
//   { role:'tool',  toolResults: [{ id, name, content, isError? }] }
// 旧调用方只传 { role, content }，输出与过去完全一致。
function normalizeMessages(messages = []) {
    return (Array.isArray(messages) ? messages : [])
        .map(msg => {
            if (!msg) return null;
            if (msg.role === 'tool') {
                const toolResults = (Array.isArray(msg.toolResults) ? msg.toolResults : [])
                    .map(item => ({
                        id: String(item && item.id || ''),
                        name: String(item && item.name || ''),
                        content: String(item && item.content || ''),
                        isError: Boolean(item && item.isError)
                    }));
                return toolResults.length ? { role: 'tool', content: '', toolResults } : null;
            }
            const role = msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user';
            const content = String(msg.content || '');
            const toolCalls = role === 'model' && Array.isArray(msg.toolCalls) && msg.toolCalls.length
                ? msg.toolCalls.map(call => {
                    const out = {
                        id: String(call && call.id || ''),
                        name: String(call && call.name || ''),
                        args: call && call.args && typeof call.args === 'object' ? call.args : {}
                    };
                    if (call && typeof call.thoughtSignature === 'string' && call.thoughtSignature) out.thoughtSignature = call.thoughtSignature;
                    return out;
                })
                : null;
            if (!content && !toolCalls) return null;
            return toolCalls ? { role, content, toolCalls } : { role, content };
        })
        .filter(Boolean);
}

// ── 工具调用：统一定义 { name, description, parameters } 映射到各供应商 ──
function normalizeTools(tools) {
    return (Array.isArray(tools) ? tools : [])
        .filter(tool => tool && tool.name)
        .map(tool => ({
            name: String(tool.name),
            description: String(tool.description || ''),
            parameters: tool.parameters && typeof tool.parameters === 'object' ? tool.parameters : { type: 'object', properties: {} }
        }));
}

function parseToolArgs(raw) {
    if (raw && typeof raw === 'object') return raw;
    const text = String(raw || '').trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
        return { __raw: text };
    }
}

function toOpenAiMessages(messages, systemInstruction) {
    const out = [];
    if (systemInstruction) out.push({ role: 'system', content: systemInstruction });
    normalizeMessages(messages).forEach(msg => {
        if (msg.role === 'tool') {
            msg.toolResults.forEach(result => out.push({ role: 'tool', tool_call_id: result.id, content: result.content }));
            return;
        }
        if (msg.role === 'model' && msg.toolCalls) {
            out.push({
                role: 'assistant',
                content: msg.content || null,
                tool_calls: msg.toolCalls.map(call => ({
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.args || {}) }
                }))
            });
            return;
        }
        out.push({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content });
    });
    return out;
}

function toOpenAiTools(tools) {
    return normalizeTools(tools).map(tool => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
    }));
}

function collectOpenAiToolCalls(toolCalls) {
    return (Array.isArray(toolCalls) ? toolCalls : [])
        .filter(call => call && call.function && call.function.name)
        .map((call, index) => ({
            id: String(call.id || `call_${index}`),
            name: String(call.function.name),
            args: parseToolArgs(call.function.arguments)
        }));
}

// 流式 tool_calls 片段按 index 累积，收口时再解析 arguments。
function createOpenAiToolCallAccumulator() {
    const slots = new Map();
    return {
        push(deltaToolCalls) {
            (Array.isArray(deltaToolCalls) ? deltaToolCalls : []).forEach((item, position) => {
                if (!item) return;
                const index = Number.isInteger(item.index) ? item.index : position;
                const slot = slots.get(index) || { id: '', name: '', args: '' };
                if (item.id) slot.id = String(item.id);
                if (item.function && item.function.name) slot.name += String(item.function.name);
                if (item.function && item.function.arguments) slot.args += String(item.function.arguments);
                slots.set(index, slot);
            });
        },
        finish() {
            return [...slots.entries()]
                .sort((a, b) => a[0] - b[0])
                .filter(([, slot]) => slot.name)
                .map(([index, slot]) => ({ id: slot.id || `call_${index}`, name: slot.name, args: parseToolArgs(slot.args) }));
        }
    };
}

function toAnthropicMessages(messages) {
    return normalizeMessages(messages).map(msg => {
        if (msg.role === 'tool') {
            return {
                role: 'user',
                content: msg.toolResults.map(result => ({
                    type: 'tool_result',
                    tool_use_id: result.id,
                    content: result.content,
                    ...(result.isError ? { is_error: true } : {})
                }))
            };
        }
        if (msg.role === 'model' && msg.toolCalls) {
            const blocks = [];
            if (msg.content) blocks.push({ type: 'text', text: msg.content });
            msg.toolCalls.forEach(call => blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args || {} }));
            return { role: 'assistant', content: blocks };
        }
        return { role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content };
    });
}

function toAnthropicTools(tools) {
    return normalizeTools(tools).map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
}

function extractAnthropicToolCalls(data) {
    const parts = Array.isArray(data && data.content) ? data.content : [];
    return parts
        .filter(part => part && part.type === 'tool_use' && part.name)
        .map((part, index) => ({ id: String(part.id || `toolu_${index}`), name: String(part.name), args: parseToolArgs(part.input) }));
}

// Gemini 的 schema 不接受部分 JSON Schema 关键字。
function sanitizeGeminiSchema(schema) {
    if (Array.isArray(schema)) return schema.map(sanitizeGeminiSchema);
    if (!schema || typeof schema !== 'object') return schema;
    const out = {};
    Object.entries(schema).forEach(([key, value]) => {
        if (['additionalProperties', '$schema', 'default', 'examples', 'title'].includes(key)) return;
        out[key] = key === 'properties' && value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, sanitizeGeminiSchema(sub)]))
            : sanitizeGeminiSchema(value);
    });
    return out;
}

// Gemini 3 起，历史里的 functionCall 必须带回模型给的 thoughtSignature，否则 400。
// 旧转录或从其他供应商切换来的历史没有签名：按官方说明，用占位签名跳过校验（每个模型回合只需第一个调用带）。
const GEMINI_PLACEHOLDER_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

function requiresGeminiThoughtSignature(model = '') {
    return /gemini-(?:[3-9]|\d{2,})(?:\.|-|$)/i.test(String(model || ''));
}

function toGeminiContents(messages, { model = '' } = {}) {
    const needsSignature = requiresGeminiThoughtSignature(model);
    const contents = normalizeMessages(messages).map(msg => {
        if (msg.role === 'tool') {
            return {
                role: 'user',
                parts: msg.toolResults.map(result => ({
                    functionResponse: { name: result.name, response: { result: result.content, isError: result.isError } }
                }))
            };
        }
        if (msg.role === 'model' && msg.toolCalls) {
            const parts = [];
            if (msg.content) parts.push({ text: msg.content });
            const hasSignature = msg.toolCalls.some(call => call.thoughtSignature);
            msg.toolCalls.forEach((call, index) => {
                const part = { functionCall: { name: call.name, args: call.args || {} } };
                if (call.thoughtSignature) part.thoughtSignature = call.thoughtSignature;
                else if (needsSignature && !hasSignature && index === 0) part.thoughtSignature = GEMINI_PLACEHOLDER_THOUGHT_SIGNATURE;
                parts.push(part);
            });
            return { role: 'model', parts };
        }
        return { role: msg.role === 'model' ? 'model' : 'user', parts: [{ text: msg.content }] };
    });
    // 兜底：Gemini 要求带 functionCall 的模型回合紧跟用户消息或工具结果；相邻的模型回合合并为一个（文字在前、调用在后）。
    return contents.reduce((merged, content) => {
        const previous = merged[merged.length - 1];
        if (previous && previous.role === 'model' && content.role === 'model') previous.parts.push(...content.parts);
        else merged.push(content);
        return merged;
    }, []);
}

function toGeminiTools(tools) {
    const declarations = normalizeTools(tools).map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: sanitizeGeminiSchema(tool.parameters)
    }));
    return declarations.length ? [{ functionDeclarations: declarations }] : [];
}

// Gemini 没有工具调用 id，按 name:index 合成，回传时只看顺序与名称。
function extractGeminiToolCalls(data, offset = 0) {
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return (Array.isArray(parts) ? parts : [])
        .filter(part => part && part.functionCall && part.functionCall.name)
        .map((part, index) => {
            const call = {
                id: `${part.functionCall.name}:${offset + index}`,
                name: String(part.functionCall.name),
                args: parseToolArgs(part.functionCall.args)
            };
            const signature = part.thoughtSignature || part.thought_signature;
            if (typeof signature === 'string' && signature) call.thoughtSignature = signature;
            return call;
        });
}

// 400 类工具调用错误分三种，只有明确表示「不支持工具」的才提示切换模型：
//   - 缺思考签名 / 工具调用历史顺序不合规：模型支持工具，是请求历史的问题；
//   - 网关不认识 tools 参数、模型不支持函数调用：提示换模型。
const TOOL_HISTORY_ERROR = /function call turn|function response turn|tool_use[\s\S]*tool_result|tool_result[\s\S]*tool_use|tool_call_id|must be followed by|immediately after/i;
const TOOLS_UNSUPPORTED_ERROR = /unknown parameter|unrecognized (?:request )?(?:argument|parameter|field|name)|not support|unsupported|function calling is not|tools? (?:is|are) not (?:enabled|available|allowed)|extra inputs are not permitted/i;

function markToolsUnsupported(error, toolsSent) {
    if (!toolsSent) return error;
    const status = Number(error && (error.status || error.statusCode));
    const message = String(error && error.message || '');
    if (![400, 404, 422].includes(status)) return error;
    if (/thought[_ ]?signature/i.test(message)) {
        error.code = 'AI_TOOL_SIGNATURE_MISSING';
        error.message = `Gemini 拒绝了工具调用历史：缺少思考签名（thought_signature）。模型支持工具调用，请点「新对话」后重试；若仍出现请反馈。原始错误：${message}`;
        return error;
    }
    if (TOOL_HISTORY_ERROR.test(message)) {
        error.code = 'AI_TOOL_HISTORY_INVALID';
        error.message = `模型拒绝了本次工具调用历史的顺序（模型本身支持工具调用）。请点「新对话」后重试；若仍出现请反馈。原始错误：${message}`;
        return error;
    }
    if (TOOLS_UNSUPPORTED_ERROR.test(message)) {
        error.code = 'AI_TOOLS_UNSUPPORTED';
        error.message = `当前模型或网关不支持工具调用（function calling），请在模型选择中切换支持工具调用的模型。原始错误：${message}`;
    }
    return error;
}

function extractGeminiText(data) {
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return Array.isArray(parts) ? parts.map(part => part.text || '').join('').trim() : '';
}

function extractGeminiDeltaText(data) {
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    return Array.isArray(parts) ? parts.map(part => part.text || '').join('') : '';
}

function extractAnthropicText(data) {
    const parts = Array.isArray(data && data.content) ? data.content : [];
    return parts.map(part => part && part.type === 'text' ? part.text || '' : '').join('').trim();
}

function stripReasoningText(value) {
    let text = String(value || '');
    if (!text) return '';

    text = text.replace(/^\s*(AI|Assistant|助手)?\s*(?=<think\b)/i, '');
    text = text.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '');
    text = text.replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '');

    const openThink = text.search(/<think(?:ing)?\b[^>]*>/i);
    if (openThink >= 0) {
        const afterOpen = text.slice(openThink).replace(/^<think(?:ing)?\b[^>]*>/i, '');
        const markers = [
            /\n\s*(?:最终答案|答案|总结|结论|回复|输出)\s*[:：]\s*/i,
            /\n\s*(?:Final Answer|Answer|Response|Summary)\s*[:：]\s*/i,
            /\n\s*<\/think(?:ing)?>\s*/i
        ];
        let best = -1;
        let bestLength = 0;
        markers.forEach(marker => {
            const match = afterOpen.match(marker);
            if (match && (best === -1 || match.index < best)) {
                best = match.index;
                bestLength = match[0].length;
            }
        });
        text = best >= 0 ? afterOpen.slice(best + bestLength) : '';
    }

    text = text
        .replace(/^\s*(?:最终答案|答案|总结|结论|回复|输出|Final Answer|Answer|Response|Summary)\s*[:：]\s*/i, '')
        .trim();
    return text;
}

function isJsonMode(options = {}) {
    return options.responseMimeType === 'application/json' || options.json === true;
}

function isGeminiThinkingCapable(model = '') {
    const m = String(model || '').toLowerCase();
    if (/gemini-1\./i.test(m)) return false;
    return /gemini-(?:2\.|[3-9]\.|\d{2,}\.|.*thinking)/i.test(m);
}

async function parseErrorResponse(res, { toolsSent = false } = {}) {
    let body = '';
    try {
        body = await res.text();
    } catch (_err) {}
    const error = new Error(buildProviderErrorMessage(res, body));
    error.status = res.status;
    error.statusCode = res.status;
    throw markToolsUnsupported(error, toolsSent);
}

function buildProviderErrorMessage(res, body = '') {
    const contentType = res && res.headers && res.headers.get ? String(res.headers.get('content-type') || '') : '';
    const text = String(body || '').trim();
    const preview = text.replace(/\s+/g, ' ').slice(0, 220);
    if (/<!doctype|<html/i.test(text) || contentType.includes('text/html')) {
        return `AI 接口返回了 HTML 页面，不是 JSON。通常是供应商协议或 API URL 配错：当前请求到 ${res.url || '未知地址'}，请检查是否应选择 OpenAI Compatible，并填写正确的 /v1 基地址。返回片段：${preview}`;
    }
    return `AI provider request failed (${res.status}): ${preview}`;
}

async function readProviderJson(res) {
    const text = await res.text();
    const contentType = String(res.headers.get('content-type') || '');
    if (/<!doctype|<html/i.test(text) || contentType.includes('text/html')) {
        const error = new Error(buildProviderErrorMessage(res, text));
        error.status = res.status;
        error.statusCode = res.status;
        throw error;
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        const error = new Error(`AI 接口返回内容不是合法 JSON。请检查供应商协议/API URL/模型名称。返回片段：${text.replace(/\s+/g, ' ').slice(0, 220)}`);
        error.status = res.status;
        error.statusCode = res.status;
        throw error;
    }
}

async function readSseResponse(res, onData) {
    if (!res.body || typeof res.body.getReader !== 'function') {
        const error = new Error('AI provider did not return a readable stream');
        error.code = 'AI_STREAM_UNSUPPORTED';
        throw error;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const consumeBlock = block => {
        const data = block.split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n');
        if (data) onData(data);
    };
    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || '';
            blocks.forEach(consumeBlock);
            if (done) break;
        }
        if (buffer.trim()) consumeBlock(buffer);
    } finally {
        reader.releaseLock();
    }
}

function openAiDeltaText(delta) {
    const content = delta && delta.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(item => typeof item === 'string' ? item : (item && (item.text || item.content) || '')).join('');
}

function assertStreamProducedText(text, toolCalls = []) {
    if (String(text || '') || (Array.isArray(toolCalls) && toolCalls.length)) return;
    const error = new Error('AI provider accepted the request but did not return streamed text');
    error.code = 'AI_STREAM_UNSUPPORTED';
    throw error;
}

class AiProviderClient {
    constructor(settings = {}) {
        this.settings = settings;
        this.provider = normalizeProvider(settings.provider);
        this.baseUrl = getBaseUrl(settings);
        this.apiKey = settings.apiKey || '';
        const defaultModels = {
            gemini: 'gemini-2.5-flash',
            openai: 'gpt-4o-mini',
            anthropic: 'claude-3-5-sonnet-latest',
            minimax: 'MiniMax-M2.7-highspeed',
            'openai-compatible': 'gpt-4o-mini'
        };
        this.model = settings.model || defaultModels[this.provider];
        this.anthropicAuthType = settings.anthropicAuthType === 'ANTHROPIC_API_KEY' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN';
        this.usesMiniMaxProtocol = this.provider === 'minimax'
            || (this.provider === 'openai-compatible' && (/minimax/i.test(this.baseUrl) || /^MiniMax-/i.test(this.model)));
    }

    getAnthropicHeaders(isStream = false) {
        const headers = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
        };
        if (isStream) headers['Accept'] = 'text/event-stream';
        if (this.anthropicAuthType === 'ANTHROPIC_API_KEY') {
            headers['x-api-key'] = this.apiKey;
        } else {
            // ANTHROPIC_AUTH_TOKEN (默认 Bearer Token / OAuth / Claude Code / Proxy)
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    async generateText({ prompt, systemInstruction = '', messages = null, maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, onRetry, onDelta, signal, tools = null, toolChoice } = {}) {
        const finalMessages = messages ? normalizeMessages(messages) : [{ role: 'user', content: String(prompt || '') }];
        const finalTools = normalizeTools(tools);
        const toolOptions = finalTools.length ? { tools: finalTools, toolChoice } : {};
        const regularRequest = async () => {
            if (this.usesMiniMaxProtocol) {
                return this.generateMiniMax({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, onRetry, signal, ...toolOptions });
            }
            if (this.provider === 'openai' || this.provider === 'openai-compatible') {
                return this.generateOpenAi({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, signal, ...toolOptions });
            }
            if (this.provider === 'anthropic') {
                return this.generateAnthropic({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, signal, ...toolOptions });
            }
            return this.generateGemini({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, signal, ...toolOptions });
        };
        let result;
        const wantsStream = typeof onDelta === 'function' && !isJsonMode({ responseMimeType, json });
        if (wantsStream) {
            let emitted = false;
            const emit = delta => {
                const text = String(delta || '');
                if (!text) return;
                emitted = true;
                onDelta(text);
            };
            try {
                if (this.usesMiniMaxProtocol) {
                    result = await this.generateMiniMaxStream({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, onDelta: emit, signal, ...toolOptions });
                } else if (this.provider === 'openai' || this.provider === 'openai-compatible') {
                    result = await this.generateOpenAiStream({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, onDelta: emit, signal, ...toolOptions });
                } else if (this.provider === 'anthropic') {
                    result = await this.generateAnthropicStream({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, onDelta: emit, signal, ...toolOptions });
                } else {
                    result = await this.generateGeminiStream({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, thinkingBudget, onDelta: emit, signal, ...toolOptions });
                }
            } catch (error) {
                const status = Number(error && (error.status || error.statusCode));
                const canFallback = !emitted && !signal?.aborted && !['AI_TOOLS_UNSUPPORTED', 'AI_TOOL_SIGNATURE_MISSING', 'AI_TOOL_HISTORY_INVALID'].includes(error?.code)
                    && ([400, 404, 405, 415, 422, 501].includes(status) || error?.code === 'AI_STREAM_UNSUPPORTED');
                if (!canFallback) throw error;
                console.warn(`[AI] ${this.provider} stream unavailable; falling back to buffered response: ${error.message}`);
                result = await regularRequest();
                emit(result.text);
            }
        } else {
            result = await regularRequest();
        }
        try {
            const usage = result?.usage || {};
            const promptTokens = Number(usage.promptTokens || 0);
            const outputTokens = Number(usage.outputTokens || 0);
            const totalTokens = Number(usage.totalTokens || 0) || promptTokens + outputTokens;
            const costUsd = (
                promptTokens * Number(this.settings.inputCostPerMillionUsd || 0) +
                outputTokens * Number(this.settings.outputCostPerMillionUsd || 0)
            ) / 1000000;
            await aiUsageRepo.recordUsage({
                promptTokens,
                outputTokens,
                totalTokens,
                costUsd,
                costCny: costUsd * Number(this.settings.usdToCny || 0),
                provider: this.provider,
                model: this.model,
                profileId: this.settings.profileId,
                profileName: this.settings.profileName
            });
        } catch (usageErr) {
            console.warn('[AI] failed to record provider usage:', usageErr.message || usageErr);
        }
        if (!Array.isArray(result.toolCalls)) result.toolCalls = [];
        // 工具循环需要在后续步骤固定到实际成功的供应商客户端（AutoSwitch 可能切换过）。
        result.providerClient = this;
        return result;
    }

    async generateChat({ messages, systemInstruction = '', maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, onDelta, signal, tools, toolChoice } = {}) {
        return this.generateText({ messages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, onDelta, signal, tools, toolChoice });
    }

    async generateGemini({ messages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, signal, tools }) {
        const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
        const body = {
            contents: toGeminiContents(messages, { model: this.model }),
            generationConfig: {
                maxOutputTokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
                temperature: Number(temperature ?? this.settings.temperature ?? 0.7)
            }
        };
        if (Number.isFinite(Number(thinkingBudget)) && isGeminiThinkingCapable(this.model)) {
            body.generationConfig.thinkingConfig = { thinkingBudget: Math.max(0, Math.round(Number(thinkingBudget))) };
        }
        if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
        if (isJsonMode({ responseMimeType, json })) body.generationConfig.responseMimeType = 'application/json';
        const geminiTools = toGeminiTools(tools);
        if (geminiTools.length) body.tools = geminiTools;

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res, { toolsSent: geminiTools.length > 0 });
        const data = await readProviderJson(res);
        const usage = data.usageMetadata || {};
        const candidate = data.candidates && data.candidates[0];
        return {
            text: stripReasoningText(extractGeminiText(data)),
            toolCalls: extractGeminiToolCalls(data),
            usage: {
                promptTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0
            },
            finishReason: String(candidate && candidate.finishReason || ''),
            raw: data
        };
    }

    async generateOpenAi({ messages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, signal, tools, toolChoice }) {
        const body = {
            model: this.model,
            messages: toOpenAiMessages(messages, systemInstruction),
            max_tokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7)
        };
        if (isJsonMode({ responseMimeType, json })) body.response_format = { type: 'json_object' };
        const openAiTools = toOpenAiTools(tools);
        if (openAiTools.length) {
            body.tools = openAiTools;
            body.tool_choice = toolChoice === 'none' ? 'none' : 'auto';
        }

        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res, { toolsSent: openAiTools.length > 0 });
        const data = await readProviderJson(res);
        const usage = data.usage || {};
        const choice = data.choices && data.choices[0];
        return {
            text: stripReasoningText(choice && choice.message && choice.message.content),
            toolCalls: collectOpenAiToolCalls(choice && choice.message && choice.message.tool_calls),
            usage: {
                promptTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0
            },
            finishReason: String(choice && choice.finish_reason || ''),
            raw: data
        };
    }

    async generateOpenAiStream({ messages, systemInstruction, maxOutputTokens, temperature, onDelta, signal, tools, toolChoice }) {
        const body = {
            model: this.model,
            messages: toOpenAiMessages(messages, systemInstruction),
            max_tokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
            stream: true
        };
        if (this.provider === 'openai') body.stream_options = { include_usage: true };
        const openAiTools = toOpenAiTools(tools);
        if (openAiTools.length) {
            body.tools = openAiTools;
            body.tool_choice = toolChoice === 'none' ? 'none' : 'auto';
        }
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res, { toolsSent: openAiTools.length > 0 });
        let text = '';
        let finishReason = '';
        let usage = {};
        const toolCallAccumulator = createOpenAiToolCallAccumulator();
        await readSseResponse(res, payload => {
            if (payload === '[DONE]') return;
            let data;
            try { data = JSON.parse(payload); } catch (_error) { return; }
            if (data.usage) usage = data.usage;
            const choice = data.choices && data.choices[0];
            if (choice && choice.finish_reason) finishReason = String(choice.finish_reason);
            if (choice && choice.delta && choice.delta.tool_calls) toolCallAccumulator.push(choice.delta.tool_calls);
            const delta = openAiDeltaText(choice && choice.delta);
            if (delta) {
                text += delta;
                onDelta(delta);
            }
        });
        const toolCalls = toolCallAccumulator.finish();
        assertStreamProducedText(text, toolCalls);
        return {
            text: stripReasoningText(text),
            toolCalls,
            usage: {
                promptTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0
            },
            finishReason,
            raw: null
        };
    }

    async generateGeminiStream({ messages, systemInstruction, maxOutputTokens, temperature, thinkingBudget, onDelta, signal, tools }) {
        const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;
        const body = {
            contents: toGeminiContents(messages, { model: this.model }),
            generationConfig: {
                maxOutputTokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
                temperature: Number(temperature ?? this.settings.temperature ?? 0.7)
            }
        };
        if (Number.isFinite(Number(thinkingBudget)) && isGeminiThinkingCapable(this.model)) {
            body.generationConfig.thinkingConfig = { thinkingBudget: Math.max(0, Math.round(Number(thinkingBudget))) };
        }
        if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
        const geminiTools = toGeminiTools(tools);
        if (geminiTools.length) body.tools = geminiTools;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res, { toolsSent: geminiTools.length > 0 });
        let text = '';
        let finishReason = '';
        let usage = {};
        const toolCalls = [];
        await readSseResponse(res, payload => {
            let data;
            try { data = JSON.parse(payload); } catch (_error) { return; }
            if (data.usageMetadata) usage = data.usageMetadata;
            const candidate = data.candidates && data.candidates[0];
            if (candidate && candidate.finishReason) finishReason = String(candidate.finishReason);
            // functionCall 部件整块到达，按出现顺序合成 id。
            toolCalls.push(...extractGeminiToolCalls(data, toolCalls.length));
            const delta = extractGeminiDeltaText(data);
            if (delta) {
                text += delta;
                onDelta(delta);
            }
        });
        assertStreamProducedText(text, toolCalls);
        return {
            text: stripReasoningText(text),
            toolCalls,
            usage: {
                promptTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0
            },
            finishReason,
            raw: null
        };
    }

    async generateMiniMaxStream({ messages, systemInstruction, maxOutputTokens, temperature, onDelta, signal, tools, toolChoice }) {
        const configuredLimit = Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048));
        const body = {
            model: this.model,
            messages: toOpenAiMessages(messages, systemInstruction),
            max_completion_tokens: Math.min(Math.max(configuredLimit, 8192), 32768),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
            reasoning_split: true,
            stream: true
        };
        const openAiTools = toOpenAiTools(tools);
        if (openAiTools.length) {
            body.tools = openAiTools;
            body.tool_choice = toolChoice === 'none' ? 'none' : 'auto';
        }
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res, { toolsSent: openAiTools.length > 0 });
        let text = '';
        let finishReason = '';
        let usage = {};
        const toolCallAccumulator = createOpenAiToolCallAccumulator();
        await readSseResponse(res, payload => {
            if (payload === '[DONE]') return;
            let data;
            try { data = JSON.parse(payload); } catch (_error) { return; }
            if (data.usage) usage = data.usage;
            const choice = data.choices && data.choices[0];
            if (choice && choice.finish_reason) finishReason = String(choice.finish_reason);
            if (choice && choice.delta && choice.delta.tool_calls) toolCallAccumulator.push(choice.delta.tool_calls);
            const delta = openAiDeltaText(choice && choice.delta);
            if (delta) {
                text += delta;
                onDelta(delta);
            }
        });
        const toolCalls = toolCallAccumulator.finish();
        assertStreamProducedText(text, toolCalls);
        return {
            text: stripReasoningText(text),
            toolCalls,
            usage: {
                promptTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0,
                reasoningTokens: Number(usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens || 0)
            },
            finishReason,
            raw: null
        };
    }

    async generateMiniMax({ messages, systemInstruction, maxOutputTokens, temperature, onRetry, signal, tools, toolChoice }) {
        const bodyMessages = toOpenAiMessages(messages, systemInstruction);
        const openAiTools = toOpenAiTools(tools);

        // M2.x 的思考内容会占 completion token。首轮给足空间；若仍被截断，
        // 自动把额度扩到 2 倍，并通过 reasoning_split 只向上层返回最终答案。
        const configuredLimit = Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048));
        const firstLimit = Math.min(Math.max(configuredLimit, 8192), 16384);
        const limits = [firstLimit, Math.min(Math.max(firstLimit * 2, 16384), 32768)];
        const aggregateUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0 };
        let lastData = null;
        let lastFinishReason = '';

        for (let attempt = 0; attempt < limits.length; attempt += 1) {
            const body = {
                model: this.model,
                messages: bodyMessages,
                max_completion_tokens: limits[attempt],
                temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
                reasoning_split: true
            };
            if (openAiTools.length) {
                body.tools = openAiTools;
                body.tool_choice = toolChoice === 'none' ? 'none' : 'auto';
            }
            const res = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body),
                signal
            });
            if (!res.ok) await parseErrorResponse(res, { toolsSent: openAiTools.length > 0 });
            const data = await readProviderJson(res);
            const choice = data.choices && data.choices[0];
            const message = choice && choice.message;
            const toolCalls = collectOpenAiToolCalls(message && message.tool_calls);
            const usage = data.usage || {};
            const reasoningTokens = Number(usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens || 0);
            aggregateUsage.promptTokens += Number(usage.prompt_tokens || 0);
            aggregateUsage.outputTokens += Number(usage.completion_tokens || 0);
            aggregateUsage.totalTokens += Number(usage.total_tokens || 0);
            aggregateUsage.reasoningTokens += reasoningTokens;
            lastData = data;
            lastFinishReason = String(choice && choice.finish_reason || '');
            const text = stripReasoningText(message && message.content);
            const truncated = lastFinishReason === 'length' || (!text && !toolCalls.length);

            if (!truncated) {
                return {
                    text,
                    toolCalls,
                    usage: aggregateUsage,
                    finishReason: lastFinishReason,
                    reasoningTokens: aggregateUsage.reasoningTokens,
                    raw: data
                };
            }
            if (attempt < limits.length - 1 && typeof onRetry === 'function') {
                try {
                    onRetry({
                        reason: lastFinishReason === 'length' ? 'output_truncated' : 'empty_output',
                        previousLimit: limits[attempt],
                        nextLimit: limits[attempt + 1],
                        message: lastFinishReason === 'length'
                            ? `MiniMax 输出被截断，输出额度从 ${limits[attempt]} 调整为 ${limits[attempt + 1]} tokens 后重试`
                            : `MiniMax 未返回最终答案，输出额度调整为 ${limits[attempt + 1]} tokens 后重试`
                    });
                } catch (reportError) {
                    console.warn('[AI] MiniMax retry reporter failed:', reportError.message || reportError);
                }
            }
        }

        const error = new Error(`MiniMax 输出在 ${limits[1]} tokens 后仍被截断，已交由上层拆分任务重试`);
        error.code = 'AI_OUTPUT_TRUNCATED';
        error.finishReason = lastFinishReason;
        error.usage = aggregateUsage;
        error.raw = lastData;
        throw error;
    }

    async generateAnthropic({ messages, systemInstruction, maxOutputTokens, temperature, signal, tools, toolChoice }) {
        const body = {
            model: this.model,
            max_tokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
            messages: toAnthropicMessages(messages)
        };
        if (systemInstruction) body.system = systemInstruction;
        const anthropicTools = toAnthropicTools(tools);
        if (anthropicTools.length) {
            body.tools = anthropicTools;
            if (toolChoice === 'none') body.tool_choice = { type: 'none' };
        }

        const res = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: this.getAnthropicHeaders(false),
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res, { toolsSent: anthropicTools.length > 0 });
        const data = await readProviderJson(res);
        const usage = data.usage || {};
        return {
            text: stripReasoningText(extractAnthropicText(data)),
            toolCalls: extractAnthropicToolCalls(data),
            usage: {
                promptTokens: usage.input_tokens || 0,
                outputTokens: usage.output_tokens || 0,
                totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
            },
            finishReason: String(data.stop_reason || ''),
            raw: data
        };
    }

    async generateAnthropicStream({ messages, systemInstruction, maxOutputTokens, temperature, onDelta, signal, tools, toolChoice }) {
        const body = {
            model: this.model,
            max_tokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
            stream: true,
            messages: toAnthropicMessages(messages)
        };
        if (systemInstruction) body.system = systemInstruction;
        const anthropicTools = toAnthropicTools(tools);
        if (anthropicTools.length) {
            body.tools = anthropicTools;
            if (toolChoice === 'none') body.tool_choice = { type: 'none' };
        }
        const res = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: this.getAnthropicHeaders(true),
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res, { toolsSent: anthropicTools.length > 0 });
        let text = '';
        let finishReason = '';
        let inputTokens = 0;
        let outputTokens = 0;
        // tool_use 块：content_block_start 给 id/name，input_json_delta 拼 JSON，content_block_stop 收口。
        const openBlocks = new Map();
        const toolCalls = [];
        await readSseResponse(res, payload => {
            let data;
            try { data = JSON.parse(payload); } catch (_error) { return; }
            if (data.type === 'message_start') inputTokens = Number(data.message?.usage?.input_tokens || 0);
            if (data.type === 'message_delta') {
                outputTokens = Number(data.usage?.output_tokens || outputTokens);
                if (data.delta?.stop_reason) finishReason = String(data.delta.stop_reason);
            }
            if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
                openBlocks.set(data.index, { id: String(data.content_block.id || `toolu_${toolCalls.length}`), name: String(data.content_block.name || ''), json: '' });
            }
            if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta' && openBlocks.has(data.index)) {
                openBlocks.get(data.index).json += String(data.delta.partial_json || '');
            }
            if (data.type === 'content_block_stop' && openBlocks.has(data.index)) {
                const block = openBlocks.get(data.index);
                openBlocks.delete(data.index);
                if (block.name) toolCalls.push({ id: block.id, name: block.name, args: parseToolArgs(block.json) });
            }
            const delta = data.type === 'content_block_delta' && data.delta?.type === 'text_delta'
                ? String(data.delta.text || '')
                : '';
            if (delta) {
                text += delta;
                onDelta(delta);
            }
        });
        openBlocks.forEach(block => { if (block.name) toolCalls.push({ id: block.id, name: block.name, args: parseToolArgs(block.json) }); });
        assertStreamProducedText(text, toolCalls);
        return {
            text: stripReasoningText(text),
            toolCalls,
            usage: {
                promptTokens: inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens
            },
            finishReason,
            raw: null
        };
    }
}

function isAutoSwitchableError(error, emitted) {
    if (emitted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return false;
    const status = Number(error && (error.status || error.statusCode));
    if ([400, 401, 403, 404, 408, 409, 422, 429].includes(status) || status >= 500) return true;
    return /timeout|timed out|fetch failed|network|socket|connection|ECONN|ENOTFOUND|EAI_AGAIN/i.test(String(error?.message || ''));
}

class AutoSwitchAiClient {
    constructor(settings = {}) {
        this.settings = settings;
        this.provider = normalizeProvider(settings.provider);
        this.model = settings.model;
        this.candidates = [settings, ...(Array.isArray(settings.fallbackProfiles) ? settings.fallbackProfiles : [])]
            .filter(item => item && item.hasApiKey && item.keyLooksValid)
            .map(item => new AiProviderClient(item));
    }

    async generateText(options = {}) {
        let lastError;
        for (let index = 0; index < this.candidates.length; index += 1) {
            const client = this.candidates[index];
            let emitted = false;
            const attemptOptions = typeof options.onDelta === 'function'
                ? { ...options, onDelta: delta => { emitted = true; options.onDelta(delta); } }
                : options;
            try {
                const result = await client.generateText(attemptOptions);
                if (index > 0) {
                    result.autoSwitch = {
                        used: true,
                        from: `${this.candidates[0].provider}/${this.candidates[0].model}`,
                        to: `${client.provider}/${client.model}`,
                        attempts: index + 1
                    };
                }
                return result;
            } catch (error) {
                lastError = error;
                if (index >= this.candidates.length - 1 || !isAutoSwitchableError(error, emitted)) throw error;
                console.warn(`[AI] ${client.provider}/${client.model} unavailable; auto-switching to the next configured model: ${error.message}`);
            }
        }
        throw lastError || new Error('没有可用的 AI 模型配置');
    }

    generateChat(options = {}) {
        return this.generateText(options);
    }
}

function createClient(settings = {}) {
    if (settings.autoSwitchEnabled === true && Array.isArray(settings.fallbackProfiles) && settings.fallbackProfiles.length) {
        return new AutoSwitchAiClient(settings);
    }
    return new AiProviderClient(settings);
}

module.exports = {
    DEFAULT_BASE_URLS,
    normalizeProvider,
    normalizeMessages,
    stripReasoningText,
    isAutoSwitchableError,
    createClient
};
