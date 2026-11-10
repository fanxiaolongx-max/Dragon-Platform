// 思考内容不能混进正文：只有思考、没有正文的回复（尤其是被输出上限截断时）怎么处理。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-provider-reasoning-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const { createClient, stripReasoningText } = require('../backend/models/ai-provider-client');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const baseSettings = { apiKey: 'test-token-1234567890', hasApiKey: true, keyLooksValid: true, maxOutputTokens: 2048, temperature: 0.2 };
const sse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const json = payload => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

/** 依次返回给定的响应，并记下每次请求体 */
async function withResponses(responses, fn) {
    const original = global.fetch, bodies = [];
    global.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return responses[Math.min(bodies.length, responses.length) - 1](); };
    try { return { result: await fn(), bodies }; } finally { global.fetch = original; }
}
const collect = () => { const out = { text: '', thought: '' }; return { out, onDelta: d => { out.text += d; }, onReasoning: d => { out.thought += d; } }; };
const thinkingOnly = finish => () => sse([
    { choices: [{ index: 0, delta: { reasoning_content: 'Let me compare them row by row. ' } }] },
    { choices: [{ index: 0, delta: { reasoning_content: '1. Plan=0→0' } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: finish }] }
]);
const answered = () => sse([
    { choices: [{ index: 0, delta: { reasoning_content: '想好了。' } }] },
    { choices: [{ index: 0, delta: { content: '计划没有变。' } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
]);

test('thinking that used up the output limit is never returned as the answer; the request is retried once with a larger limit', async () => {
    const client = createClient({ ...baseSettings, provider: 'openai-compatible', apiBaseUrl: 'http://glm.example/v1', model: 'glm-truncated' });
    const a = collect();
    const { result, bodies } = await withResponses([thinkingOnly('length'), answered], () => client.generateText({ prompt: 'hi', onDelta: a.onDelta, onReasoning: a.onReasoning }));
    assert.equal(result.text, '计划没有变。');
    assert.equal(a.out.text, '计划没有变。', 'no thinking in the streamed answer');
    assert.match(a.out.thought, /row by row/);
    assert.deepEqual(bodies.map(body => [body.stream, body.max_tokens]), [[true, 2048], [true, 8192]], 'retried as a stream with a raised limit, not as a buffered request');

    // 这个模型之后的请求直接用放宽后的上限，不再每轮白等
    const next = await withResponses([answered], () => client.generateText({ prompt: 'hi', onDelta: () => {}, onReasoning: () => {} }));
    assert.equal(next.bodies[0].max_tokens, 8192);

    // 放宽后仍然只有思考：返回空正文和截断标记，由智能体循环处理，不把思考当正文
    const b = collect();
    const still = await withResponses([thinkingOnly('length')], () => client.generateText({ prompt: 'hi', onDelta: b.onDelta, onReasoning: b.onReasoning }));
    assert.equal(still.bodies.length, 1);
    assert.deepEqual([still.result.text, still.result.finishReason, still.result.reasoningOnly, b.out.text], ['', 'length', true, '']);
});

test('buffered responses follow the same rule', async () => {
    const client = createClient({ ...baseSettings, provider: 'openai-compatible', apiBaseUrl: 'http://glm.example/v1', model: 'glm-buffered' });
    const truncated = () => json({ choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'Now I have both datasets.' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 2048 } });
    const done = () => json({ choices: [{ message: { role: 'assistant', content: '结论', reasoning_content: '想好了' }, finish_reason: 'stop' }] });
    const { result, bodies } = await withResponses([truncated, done], () => client.generateText({ prompt: 'hi' }));
    assert.equal(result.text, '结论');
    assert.deepEqual(bodies.map(body => body.max_tokens), [2048, 8192]);
});

test('a finished reply that only has reasoning: used as the answer for gateways that never separate the two, left empty for models that do', async () => {
    // 网关的推理解析把整段回答都放进了 reasoning 字段（模型其实没在思考）
    const merged = createClient({ ...baseSettings, provider: 'openai-compatible', apiBaseUrl: 'http://vllm.example/v1', model: 'qwen-no-think' });
    const a = collect();
    const first = await withResponses([thinkingOnly('stop')], () => merged.generateText({ prompt: 'hi', onDelta: a.onDelta, onReasoning: a.onReasoning }));
    assert.equal(first.bodies.length, 1, 'no second buffered request');
    assert.equal(first.result.text, 'Let me compare them row by row. 1. Plan=0→0');
    assert.equal(a.out.text, first.result.text);

    // 正常分开返回过思考与正文的模型：只有思考就是没作答，返回空让上层提示它继续
    const split = createClient({ ...baseSettings, provider: 'openai-compatible', apiBaseUrl: 'http://glm.example/v1', model: 'glm-split' });
    await withResponses([answered], () => split.generateText({ prompt: 'hi', onDelta: () => {}, onReasoning: () => {} }));
    const b = collect();
    const empty = await withResponses([thinkingOnly('stop')], () => split.generateText({ prompt: 'hi', onDelta: b.onDelta, onReasoning: b.onReasoning }));
    assert.deepEqual([empty.result.text, empty.result.reasoningOnly, b.out.text, empty.bodies.length], ['', true, '', 1]);
});

test('other reasoning field names and tool calls alongside reasoning', async () => {
    const client = createClient({ ...baseSettings, provider: 'openai-compatible', apiBaseUrl: 'http://ollama.example/v1', model: 'fields' });
    const a = collect();
    const { result } = await withResponses([() => sse([
        { choices: [{ index: 0, delta: { reasoning: 'a' } }] },
        { choices: [{ index: 0, delta: { thinking: 'b' } }] },
        { choices: [{ index: 0, delta: { thought: 'c' } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'query_data', arguments: '{}' } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
    ])], () => client.generateText({ prompt: 'hi', onDelta: a.onDelta, onReasoning: a.onReasoning, tools: [{ name: 'query_data', description: 'q', parameters: { type: 'object', properties: {} } }] }));
    assert.deepEqual(a.out, { text: '', thought: 'abc' });
    assert.equal(result.text, '');
    assert.equal(result.toolCalls[0].name, 'query_data');
});

test('anthropic thinking blocks stream as reasoning; a thinking-only truncated reply is retried instead of re-sent as a buffered request', async () => {
    const client = createClient({ ...baseSettings, provider: 'anthropic', model: 'deepseek-anthropic' });
    const thinking = stop => () => sse([
        { type: 'message_start', message: { usage: { input_tokens: 20 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先核对两份表。' } },
        { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 2048 } }
    ]);
    const done = () => sse([
        { type: 'message_start', message: { usage: { input_tokens: 20 } } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '好了。' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '没有变化。' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } }
    ]);
    const a = collect();
    const { result, bodies } = await withResponses([thinking('max_tokens'), done], () => client.generateText({ prompt: 'hi', onDelta: a.onDelta, onReasoning: a.onReasoning }));
    assert.deepEqual(a.out, { text: '没有变化。', thought: '先核对两份表。好了。' });
    assert.equal(result.text, '没有变化。');
    assert.deepEqual(bodies.map(body => [body.stream, body.max_tokens]), [[true, 2048], [true, 8192]]);
});

test('stripReasoningText drops reasoning that only has a closing tag (the chat template already opened it)', () => {
    assert.equal(stripReasoningText('Let me check the rows first.\n</think>\n\n计划没有变。'), '计划没有变。');
    assert.equal(stripReasoningText('<think>a</think>答案'), '答案');
    assert.equal(stripReasoningText('没有标签的正文'), '没有标签的正文');
});
