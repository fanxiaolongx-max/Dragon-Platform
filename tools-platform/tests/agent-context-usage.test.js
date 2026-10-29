const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-context-usage-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const { createClient } = require('../backend/models/ai-provider-client');
const contextStats = require('../backend/models/agent-context-stats');
const settingsRepo = require('../backend/models/ai-settings-repository');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const baseSettings = { apiKey: 'test-token-1234567890', hasApiKey: true, keyLooksValid: true, maxOutputTokens: 512, temperature: 0.2 };

async function withFetch(response, fn) {
    const original = global.fetch;
    global.fetch = async () => response();
    try { return await fn(); } finally { global.fetch = original; }
}
const sse = events => () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const json = payload => () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

test('anthropic usage adds cache reads and writes back into the prompt, but billing keeps input_tokens', async () => {
    const client = createClient({ ...baseSettings, provider: 'anthropic', model: 'claude-test' });
    const streamed = await withFetch(sse([
        { type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }
    ]), () => client.generateText({ prompt: 'hi', onDelta: () => {} }));
    assert.deepEqual(
        [streamed.usage.promptTokens, streamed.usage.cachedTokens, streamed.usage.cacheWriteTokens, streamed.usage.outputTokens, streamed.usage.billablePromptTokens],
        [1070, 1000, 50, 9, 20]);

    const buffered = await withFetch(json({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 5, cache_read_input_tokens: 95, output_tokens: 3 } }),
        () => client.generateText({ prompt: 'hi' }));
    assert.deepEqual([buffered.usage.promptTokens, buffered.usage.cachedTokens, buffered.usage.totalTokens], [100, 95, 103]);
});

test('openai-compatible and gemini usage report cached prompt tokens', async () => {
    const openai = createClient({ ...baseSettings, provider: 'openai', model: 'gpt-5' });
    const result = await withFetch(json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 800, completion_tokens: 10, total_tokens: 810, prompt_tokens_details: { cached_tokens: 640 } } }),
        () => openai.generateText({ prompt: 'hi' }));
    assert.deepEqual([result.usage.promptTokens, result.usage.cachedTokens], [800, 640]);

    const deepseek = createClient({ ...baseSettings, provider: 'openai-compatible', apiBaseUrl: 'https://api.deepseek.example/v1', model: 'deepseek-chat' });
    const hit = await withFetch(json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 300, completion_tokens: 1, total_tokens: 301, prompt_cache_hit_tokens: 256 } }),
        () => deepseek.generateText({ prompt: 'hi' }));
    assert.equal(hit.usage.cachedTokens, 256);

    const gemini = createClient({ ...baseSettings, provider: 'gemini', model: 'gemini-2.5-flash' });
    const geminiResult = await withFetch(json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 4, totalTokenCount: 504, cachedContentTokenCount: 400 } }),
        () => gemini.generateText({ prompt: 'hi' }));
    assert.deepEqual([geminiResult.usage.promptTokens, geminiResult.usage.cachedTokens], [500, 400]);
});

test('context window comes from the model settings first, then the model name', async () => {
    assert.equal(contextStats.windowFor('claude-opus-5-5', 1000000), 1000000);
    assert.equal(contextStats.windowFor('claude-sonnet-4-5[1m]'), 1000000);
    assert.equal(contextStats.windowFor('claude-sonnet-4-5'), 200000);
    assert.equal(contextStats.windowFor('gpt-5-mini'), 400000);
    assert.equal(contextStats.windowFor('gpt-4.1-mini'), 1000000);
    assert.equal(contextStats.windowFor('gpt-4o-mini'), 128000);
    assert.equal(contextStats.windowFor('gpt-4'), 8192);
    assert.equal(contextStats.windowFor('unknown-model'), 128000);

    assert.equal((await settingsRepo.buildRuntimeSettings({ contextWindowTokens: 300000 })).contextWindowTokens, 300000);
    assert.equal((await settingsRepo.buildRuntimeSettings({ contextWindowTokens: 50 })).contextWindowTokens, 4096);
    assert.equal((await settingsRepo.buildRuntimeSettings({ contextWindowTokens: 'auto' })).contextWindowTokens, 0);
    const publicSettings = await settingsRepo.getPublicSettings();
    assert.equal(publicSettings.settings?.contextWindowTokens ?? publicSettings.contextWindowTokens, 0);
});

test('context breakdown separates skills and tool results, keeps a compaction reserve and reports cache hits', () => {
    const messages = [
        { role: 'user', content: 'u'.repeat(350) },
        { role: 'model', content: '', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a' } }] },
        { role: 'tool', toolResults: [{ id: 'c1', name: 'read_file', content: 'r'.repeat(3500) }] }
    ];
    const estimate = contextStats.build({ model: 'claude-x', systemPrompt: `${'s'.repeat(350)}${'k'.repeat(700)}`, skillPrompt: 'k'.repeat(700), messages, tools: [] });
    assert.equal(estimate.parts.skills, 200);
    assert.equal(estimate.parts.system, 100);
    assert.equal(estimate.parts.toolResults, 1000);
    assert.equal(estimate.windowSource, 'model');
    assert.equal(estimate.cache, null);

    const real = contextStats.build({ model: 'claude-x', contextWindow: 100000, systemPrompt: 's'.repeat(350), messages, tools: [], maxOutputTokens: 4096,
        usage: { promptTokens: 3000, cachedTokens: 2400, cacheWriteTokens: 100 } });
    const used = ['system', 'skills', 'directory', 'tools', 'messages', 'toolResults'].reduce((sum, key) => sum + real.parts[key], 0);
    assert.equal(used, 3000, 'parts add up to the provider total');
    assert.equal(real.usedTokens, 3000);
    assert.equal(real.windowSource, 'configured');
    assert.equal(real.parts.reserve, 100000 - contextStats.budgetFor(100000, 4096));
    assert.equal(real.parts.reserve + real.parts.free + real.usedTokens, 100000);
    assert.deepEqual(real.cache, { cachedTokens: 2400, cacheWriteTokens: 100, hitRate: 0.8 });

    // 已超过裁剪线时预留只剩窗口余量
    const full = contextStats.build({ model: 'claude-x', contextWindow: 10000, systemPrompt: 'x', usage: { promptTokens: 9500 } });
    assert.deepEqual([full.parts.reserve, full.parts.free], [500, 0]);
});

test('fitMessages honours the configured window', () => {
    const history = [{ role: 'user', content: 'old '.repeat(100000) }, { role: 'model', content: 'a' }, { role: 'user', content: 'now' }];
    assert.equal(contextStats.fitMessages({ model: 'gpt-4o', messages: history }).droppedTurns, 1);
    assert.equal(contextStats.fitMessages({ model: 'gpt-4o', contextWindow: 1000000, messages: history }).droppedTurns, 0);
});

test('reasoning streams to onReasoning, not into the answer: reasoning_content, inline <think> split across chunks, Gemini thoughts', async () => {
    const openai = createClient({ ...baseSettings, provider: 'openai-compatible', apiBaseUrl: 'https://api.deepseek.example/v1', model: 'deepseek-reasoner' });
    const collect = () => { const out = { text: '', thought: '' }; return { out, onDelta: d => { out.text += d; }, onReasoning: d => { out.thought += d; } }; };

    const a = collect();
    const result = await withFetch(sse([
        { choices: [{ index: 0, delta: { reasoning_content: '先查一下表结构，' } }] },
        { choices: [{ index: 0, delta: { reasoning_content: '再核对。' } }] },
        { choices: [{ index: 0, delta: { content: '结论' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
    ]), () => openai.generateText({ prompt: 'hi', onDelta: a.onDelta, onReasoning: a.onReasoning }));
    assert.deepEqual(a.out, { text: '结论', thought: '先查一下表结构，再核对。' });
    assert.equal(result.text, '结论');

    const b = collect();
    const inline = await withFetch(sse([
        { choices: [{ index: 0, delta: { content: '<thi' } }] },
        { choices: [{ index: 0, delta: { content: 'nk>想一想' } }] },
        { choices: [{ index: 0, delta: { content: '再想</th' } }] },
        { choices: [{ index: 0, delta: { content: 'ink>答案 a<b' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
    ]), () => openai.generateText({ prompt: 'hi', onDelta: b.onDelta, onReasoning: b.onReasoning }));
    assert.deepEqual(b.out, { text: '答案 a<b', thought: '想一想再想' });
    assert.equal(inline.text, '答案 a<b');

    // 不需要思考内容的调用方保持原样
    const plain = { text: '' };
    await withFetch(sse([{ choices: [{ index: 0, delta: { reasoning_content: 'x', content: '<think>y</think>z' } }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]),
        () => openai.generateText({ prompt: 'hi', onDelta: d => { plain.text += d; } }));
    assert.equal(plain.text, '<think>y</think>z');

    const gemini = createClient({ ...baseSettings, provider: 'gemini', model: 'gemini-2.5-flash' });
    const c = collect();
    let body;
    const original = global.fetch;
    global.fetch = async (_url, init) => { body = JSON.parse(init.body); return sse([
        { candidates: [{ content: { parts: [{ text: '分析一下', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: '好的' }] }, finishReason: 'STOP' }] }
    ])(); };
    try { await gemini.generateText({ prompt: 'hi', onDelta: c.onDelta, onReasoning: c.onReasoning }); } finally { global.fetch = original; }
    assert.equal(body.generationConfig.thinkingConfig.includeThoughts, true);
    assert.deepEqual(c.out, { text: '好的', thought: '分析一下' });
});

test('fitMessages shortens the oldest tool results first and keeps the latest step intact', () => {
    const big = 'line\n'.repeat(4000);
    const messages = [{ role: 'user', content: 'read' }];
    for (let index = 0; index < 6; index++) {
        messages.push({ role: 'model', content: '', toolCalls: [{ id: `c${index}`, name: 'read_file', args: {} }] },
            { role: 'tool', toolResults: [{ id: `c${index}`, name: 'read_file', content: `${big}ERROR-${index}` }] });
    }
    const fitted = contextStats.fitMessages({ model: 'x', contextWindow: 30000, messages });
    const results = fitted.messages.filter(item => item.role === 'tool').map(item => item.toolResults[0].content);
    assert.ok(results.at(-1).endsWith('ERROR-5'), 'the step the model just asked for is not cut');
    assert.ok(results[0].includes('上下文已缩短'), 'older results are shortened instead');
});
