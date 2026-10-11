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

function normalizeMessages(messages = []) {
    return (Array.isArray(messages) ? messages : [])
        .map(msg => ({
            role: msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user',
            content: String(msg.content || '')
        }))
        .filter(msg => msg.content);
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

async function parseErrorResponse(res) {
    let body = '';
    try {
        body = await res.text();
    } catch (_err) {}
    const error = new Error(buildProviderErrorMessage(res, body));
    error.status = res.status;
    error.statusCode = res.status;
    throw error;
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

function assertStreamProducedText(text) {
    if (String(text || '')) return;
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

    async generateText({ prompt, systemInstruction = '', messages = null, maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, onRetry, onDelta, signal } = {}) {
        const finalMessages = messages ? normalizeMessages(messages) : [{ role: 'user', content: String(prompt || '') }];
        const regularRequest = async () => {
            if (this.usesMiniMaxProtocol) {
                return this.generateMiniMax({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, onRetry, signal });
            }
            if (this.provider === 'openai' || this.provider === 'openai-compatible') {
                return this.generateOpenAi({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, signal });
            }
            if (this.provider === 'anthropic') {
                return this.generateAnthropic({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, signal });
            }
            return this.generateGemini({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, signal });
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
                    result = await this.generateMiniMaxStream({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, onDelta: emit, signal });
                } else if (this.provider === 'openai' || this.provider === 'openai-compatible') {
                    result = await this.generateOpenAiStream({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, onDelta: emit, signal });
                } else if (this.provider === 'anthropic') {
                    result = await this.generateAnthropicStream({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, onDelta: emit, signal });
                } else {
                    result = await this.generateGeminiStream({ messages: finalMessages, systemInstruction, maxOutputTokens, temperature, thinkingBudget, onDelta: emit, signal });
                }
            } catch (error) {
                const status = Number(error && (error.status || error.statusCode));
                const canFallback = !emitted && !signal?.aborted && ([400, 404, 405, 415, 422, 501].includes(status) || error?.code === 'AI_STREAM_UNSUPPORTED');
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
        return result;
    }

    async generateChat({ messages, systemInstruction = '', maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, onDelta, signal } = {}) {
        return this.generateText({ messages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, onDelta, signal });
    }

    async generateGemini({ messages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, thinkingBudget, signal }) {
        const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
        const body = {
            contents: normalizeMessages(messages).map(msg => ({
                role: msg.role === 'model' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            })),
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

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res);
        const data = await readProviderJson(res);
        const usage = data.usageMetadata || {};
        const candidate = data.candidates && data.candidates[0];
        return {
            text: stripReasoningText(extractGeminiText(data)),
            usage: {
                promptTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0
            },
            finishReason: String(candidate && candidate.finishReason || ''),
            raw: data
        };
    }

    async generateOpenAi({ messages, systemInstruction, maxOutputTokens, temperature, responseMimeType, json, signal }) {
        const bodyMessages = [];
        if (systemInstruction) bodyMessages.push({ role: 'system', content: systemInstruction });
        normalizeMessages(messages).forEach(msg => {
            bodyMessages.push({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content });
        });
        const body = {
            model: this.model,
            messages: bodyMessages,
            max_tokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7)
        };
        if (isJsonMode({ responseMimeType, json })) body.response_format = { type: 'json_object' };

        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res);
        const data = await readProviderJson(res);
        const usage = data.usage || {};
        const choice = data.choices && data.choices[0];
        return {
            text: stripReasoningText(choice && choice.message && choice.message.content),
            usage: {
                promptTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0
            },
            finishReason: String(choice && choice.finish_reason || ''),
            raw: data
        };
    }

    async generateOpenAiStream({ messages, systemInstruction, maxOutputTokens, temperature, onDelta, signal }) {
        const bodyMessages = [];
        if (systemInstruction) bodyMessages.push({ role: 'system', content: systemInstruction });
        normalizeMessages(messages).forEach(msg => {
            bodyMessages.push({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content });
        });
        const body = {
            model: this.model,
            messages: bodyMessages,
            max_tokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
            stream: true
        };
        if (this.provider === 'openai') body.stream_options = { include_usage: true };
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
        if (!res.ok) await parseErrorResponse(res);
        let text = '';
        let finishReason = '';
        let usage = {};
        await readSseResponse(res, payload => {
            if (payload === '[DONE]') return;
            let data;
            try { data = JSON.parse(payload); } catch (_error) { return; }
            if (data.usage) usage = data.usage;
            const choice = data.choices && data.choices[0];
            if (choice && choice.finish_reason) finishReason = String(choice.finish_reason);
            const delta = openAiDeltaText(choice && choice.delta);
            if (delta) {
                text += delta;
                onDelta(delta);
            }
        });
        assertStreamProducedText(text);
        return {
            text: stripReasoningText(text),
            usage: {
                promptTokens: usage.prompt_tokens || 0,
                outputTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0
            },
            finishReason,
            raw: null
        };
    }

    async generateGeminiStream({ messages, systemInstruction, maxOutputTokens, temperature, thinkingBudget, onDelta, signal }) {
        const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;
        const body = {
            contents: normalizeMessages(messages).map(msg => ({
                role: msg.role === 'model' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            })),
            generationConfig: {
                maxOutputTokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
                temperature: Number(temperature ?? this.settings.temperature ?? 0.7)
            }
        };
        if (Number.isFinite(Number(thinkingBudget)) && isGeminiThinkingCapable(this.model)) {
            body.generationConfig.thinkingConfig = { thinkingBudget: Math.max(0, Math.round(Number(thinkingBudget))) };
        }
        if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res);
        let text = '';
        let finishReason = '';
        let usage = {};
        await readSseResponse(res, payload => {
            let data;
            try { data = JSON.parse(payload); } catch (_error) { return; }
            if (data.usageMetadata) usage = data.usageMetadata;
            const candidate = data.candidates && data.candidates[0];
            if (candidate && candidate.finishReason) finishReason = String(candidate.finishReason);
            const delta = extractGeminiDeltaText(data);
            if (delta) {
                text += delta;
                onDelta(delta);
            }
        });
        assertStreamProducedText(text);
        return {
            text: stripReasoningText(text),
            usage: {
                promptTokens: usage.promptTokenCount || 0,
                outputTokens: usage.candidatesTokenCount || 0,
                totalTokens: usage.totalTokenCount || 0
            },
            finishReason,
            raw: null
        };
    }

    async generateMiniMaxStream({ messages, systemInstruction, maxOutputTokens, temperature, onDelta, signal }) {
        const bodyMessages = [];
        if (systemInstruction) bodyMessages.push({ role: 'system', content: systemInstruction });
        normalizeMessages(messages).forEach(msg => {
            bodyMessages.push({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content });
        });
        const configuredLimit = Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048));
        const body = {
            model: this.model,
            messages: bodyMessages,
            max_completion_tokens: Math.min(Math.max(configuredLimit, 8192), 32768),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
            reasoning_split: true,
            stream: true
        };
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
        if (!res.ok) await parseErrorResponse(res);
        let text = '';
        let finishReason = '';
        let usage = {};
        await readSseResponse(res, payload => {
            if (payload === '[DONE]') return;
            let data;
            try { data = JSON.parse(payload); } catch (_error) { return; }
            if (data.usage) usage = data.usage;
            const choice = data.choices && data.choices[0];
            if (choice && choice.finish_reason) finishReason = String(choice.finish_reason);
            const delta = openAiDeltaText(choice && choice.delta);
            if (delta) {
                text += delta;
                onDelta(delta);
            }
        });
        assertStreamProducedText(text);
        return {
            text: stripReasoningText(text),
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

    async generateMiniMax({ messages, systemInstruction, maxOutputTokens, temperature, onRetry, signal }) {
        const bodyMessages = [];
        if (systemInstruction) bodyMessages.push({ role: 'system', content: systemInstruction });
        normalizeMessages(messages).forEach(msg => {
            bodyMessages.push({ role: msg.role === 'model' ? 'assistant' : 'user', content: msg.content });
        });

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
            const res = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(body),
                signal
            });
            if (!res.ok) await parseErrorResponse(res);
            const data = await readProviderJson(res);
            const choice = data.choices && data.choices[0];
            const message = choice && choice.message;
            const usage = data.usage || {};
            const reasoningTokens = Number(usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens || 0);
            aggregateUsage.promptTokens += Number(usage.prompt_tokens || 0);
            aggregateUsage.outputTokens += Number(usage.completion_tokens || 0);
            aggregateUsage.totalTokens += Number(usage.total_tokens || 0);
            aggregateUsage.reasoningTokens += reasoningTokens;
            lastData = data;
            lastFinishReason = String(choice && choice.finish_reason || '');
            const text = stripReasoningText(message && message.content);
            const truncated = lastFinishReason === 'length' || !text;

            if (!truncated) {
                return {
                    text,
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

    async generateAnthropic({ messages, systemInstruction, maxOutputTokens, temperature, signal }) {
        const body = {
            model: this.model,
            max_tokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
            messages: normalizeMessages(messages).map(msg => ({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: msg.content
            }))
        };
        if (systemInstruction) body.system = systemInstruction;

        const res = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: this.getAnthropicHeaders(false),
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res);
        const data = await readProviderJson(res);
        const usage = data.usage || {};
        return {
            text: stripReasoningText(extractAnthropicText(data)),
            usage: {
                promptTokens: usage.input_tokens || 0,
                outputTokens: usage.output_tokens || 0,
                totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
            },
            finishReason: String(data.stop_reason || ''),
            raw: data
        };
    }

    async generateAnthropicStream({ messages, systemInstruction, maxOutputTokens, temperature, onDelta, signal }) {
        const body = {
            model: this.model,
            max_tokens: Math.round(Number(maxOutputTokens || this.settings.maxOutputTokens || 2048)),
            temperature: Number(temperature ?? this.settings.temperature ?? 0.7),
            stream: true,
            messages: normalizeMessages(messages).map(msg => ({
                role: msg.role === 'model' ? 'assistant' : 'user',
                content: msg.content
            }))
        };
        if (systemInstruction) body.system = systemInstruction;
        const res = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: this.getAnthropicHeaders(true),
            body: JSON.stringify(body),
            signal
        });
        if (!res.ok) await parseErrorResponse(res);
        let text = '';
        let finishReason = '';
        let inputTokens = 0;
        let outputTokens = 0;
        await readSseResponse(res, payload => {
            let data;
            try { data = JSON.parse(payload); } catch (_error) { return; }
            if (data.type === 'message_start') inputTokens = Number(data.message?.usage?.input_tokens || 0);
            if (data.type === 'message_delta') {
                outputTokens = Number(data.usage?.output_tokens || outputTokens);
                if (data.delta?.stop_reason) finishReason = String(data.delta.stop_reason);
            }
            const delta = data.type === 'content_block_delta' && data.delta?.type === 'text_delta'
                ? String(data.delta.text || '')
                : '';
            if (delta) {
                text += delta;
                onDelta(delta);
            }
        });
        assertStreamProducedText(text);
        return {
            text: stripReasoningText(text),
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
    stripReasoningText,
    isAutoSwitchableError,
    createClient
};
