const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-ai-tool-calling-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const { createClient, normalizeMessages, isAutoSwitchableError } = require('../backend/models/ai-provider-client');
const tenantPool = require('../backend/models/tenant-sqlite-pool');

test.after(async () => {
    await tenantPool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const TOOLS = [{ name: 'list_directory', description: 'List files', parameters: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } }];

function sseResponse(events, { contentType = 'text/event-stream' } = {}) {
    const body = events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');
    return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function withFetch(handler, fn) {
    const original = global.fetch;
    const calls = [];
    global.fetch = async (url, init) => {
        const body = init && init.body ? JSON.parse(init.body) : null;
        calls.push({ url: String(url), body });
        return handler({ url: String(url), body, calls });
    };
    return Promise.resolve().then(() => fn(calls)).finally(() => { global.fetch = original; });
}

const baseSettings = { apiKey: 'test-token-1234567890', hasApiKey: true, keyLooksValid: true, maxOutputTokens: 512, temperature: 0.2 };

test('legacy text-only messages normalize exactly as before and tool messages are preserved', () => {
    const legacy = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'model', content: '' }];
    assert.deepEqual(normalizeMessages(legacy), [{ role: 'user', content: 'hi' }, { role: 'model', content: 'yo' }]);

    const rich = normalizeMessages([
        { role: 'model', content: '', toolCalls: [{ id: 'c1', name: 'list_directory', args: { path: '.' } }] },
        { role: 'tool', toolResults: [{ id: 'c1', name: 'list_directory', content: 'a.txt' }] },
        { role: 'tool', toolResults: [] }
    ]);
    assert.equal(rich.length, 2);
    assert.deepEqual(rich[0].toolCalls, [{ id: 'c1', name: 'list_directory', args: { path: '.' } }]);
    assert.equal(rich[1].role, 'tool');
    assert.equal(rich[1].toolResults[0].isError, false);
});

test('openai-compatible stream accumulates fragmented tool_calls and sends tools + tool messages', async () => {
    const client = createClient({ ...baseSettings, provider: 'openai-compatible', model: 'mock', apiBaseUrl: 'http://mock/v1' });
    await withFetch(() => sseResponse([
        { choices: [{ delta: { role: 'assistant', content: '' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_dir', arguments: '' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'ectory', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"."}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } },
        '[DONE]'
    ]), async calls => {
        const deltas = [];
        const result = await client.generateText({
            systemInstruction: 'sys',
            messages: [
                { role: 'user', content: 'list' },
                { role: 'model', content: '', toolCalls: [{ id: 'c0', name: 'list_directory', args: { path: 'src' } }] },
                { role: 'tool', toolResults: [{ id: 'c0', name: 'list_directory', content: 'index.js' }] }
            ],
            tools: TOOLS,
            onDelta: delta => deltas.push(delta)
        });
        assert.deepEqual(result.toolCalls, [{ id: 'call_1', name: 'list_directory', args: { path: '.' } }]);
        assert.equal(result.text, '');
        assert.equal(result.finishReason, 'tool_calls');
        assert.equal(result.usage.promptTokens, 40);
        assert.equal(result.providerClient, client);
        assert.deepEqual(deltas, [], 'no text deltas for a tool-only turn');

        const body = calls[0].body;
        assert.equal(body.tools[0].type, 'function');
        assert.equal(body.tools[0].function.name, 'list_directory');
        assert.equal(body.tool_choice, 'auto');
        assert.deepEqual(body.messages[2].tool_calls[0], { id: 'c0', type: 'function', function: { name: 'list_directory', arguments: '{"path":"src"}' } });
        assert.equal(body.messages[2].content, null);
        assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'c0', content: 'index.js' });
    });
});

test('openai non-stream response exposes tool_calls and keeps text', async () => {
    const client = createClient({ ...baseSettings, provider: 'openai', model: 'gpt-4o-mini' });
    await withFetch(() => jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Let me look.', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.md"}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
    }), async () => {
        const result = await client.generateText({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS });
        assert.equal(result.text, 'Let me look.');
        assert.deepEqual(result.toolCalls, [{ id: 'call_9', name: 'read_file', args: { path: 'a.md' } }]);
    });
});

test('anthropic stream parses tool_use blocks from input_json_delta and maps tool_result messages', async () => {
    const client = createClient({ ...baseSettings, provider: 'anthropic', model: 'claude-test' });
    await withFetch(() => sseResponse([
        { type: 'message_start', message: { usage: { input_tokens: 20 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'search', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"TODO"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }
    ]), async calls => {
        const result = await client.generateText({
            messages: [
                { role: 'user', content: 'q' },
                { role: 'model', content: 'Looking', toolCalls: [{ id: 'toolu_0', name: 'search', args: { query: 'x' } }] },
                { role: 'tool', toolResults: [{ id: 'toolu_0', name: 'search', content: 'none', isError: true }] }
            ],
            tools: TOOLS,
            onDelta: () => {}
        });
        assert.equal(result.text, 'Checking.');
        assert.deepEqual(result.toolCalls, [{ id: 'toolu_1', name: 'search', args: { query: 'TODO' } }]);
        assert.equal(result.finishReason, 'tool_use');
        const body = calls[0].body;
        assert.deepEqual(body.tools, [{ name: 'list_directory', description: 'List files', input_schema: TOOLS[0].parameters }]);
        assert.deepEqual(body.messages[1].content, [{ type: 'text', text: 'Looking' }, { type: 'tool_use', id: 'toolu_0', name: 'search', input: { query: 'x' } }]);
        assert.deepEqual(body.messages[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: 'none', is_error: true }] });
    });
});

test('gemini stream collects functionCall parts, synthesizes ids and sanitizes schemas', async () => {
    const client = createClient({ ...baseSettings, provider: 'gemini', model: 'gemini-2.5-flash' });
    await withFetch(() => sseResponse([
        { candidates: [{ content: { parts: [{ functionCall: { name: 'list_directory', args: { path: '.' } } }] } }] },
        { candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'a' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 } }
    ]), async calls => {
        const result = await client.generateText({
            messages: [
                { role: 'user', content: 'go' },
                { role: 'model', content: '', toolCalls: [{ id: 'list_directory:0', name: 'list_directory', args: {} }] },
                { role: 'tool', toolResults: [{ id: 'list_directory:0', name: 'list_directory', content: 'ok' }] }
            ],
            tools: TOOLS,
            onDelta: () => {}
        });
        assert.deepEqual(result.toolCalls.map(call => call.id), ['list_directory:0', 'read_file:1']);
        const body = calls[0].body;
        assert.equal(body.tools[0].functionDeclarations[0].name, 'list_directory');
        assert.equal(body.tools[0].functionDeclarations[0].parameters.additionalProperties, undefined);
        assert.deepEqual(body.contents[1].parts, [{ functionCall: { name: 'list_directory', args: {} } }]);
        assert.deepEqual(body.contents[2].parts[0].functionResponse.name, 'list_directory');
    });
});

test('a gateway rejecting the tools parameter yields AI_TOOLS_UNSUPPORTED without a buffered retry', async () => {
    const client = createClient({ ...baseSettings, provider: 'openai-compatible', model: 'mock', apiBaseUrl: 'http://mock/v1' });
    await withFetch(() => jsonResponse({ error: { message: 'Unknown parameter: tools' } }, 400), async calls => {
        await assert.rejects(
            client.generateText({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS, onDelta: () => {} }),
            error => error.code === 'AI_TOOLS_UNSUPPORTED' && /工具调用/.test(error.message)
        );
        assert.equal(calls.length, 1, 'no second buffered request');
        assert.equal(isAutoSwitchableError({ status: 400, code: 'AI_TOOLS_UNSUPPORTED' }, false), true, 'another profile may still support tools before any transcript exists');
    });
});

test('requests without tools keep the historical body shape', async () => {
    const client = createClient({ ...baseSettings, provider: 'openai', model: 'gpt-4o-mini' });
    await withFetch(() => jsonResponse({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: {} }), async calls => {
        const result = await client.generateText({ systemInstruction: 's', messages: [{ role: 'user', content: 'x' }] });
        assert.equal(result.text, 'hello');
        assert.deepEqual(result.toolCalls, []);
        assert.equal(calls[0].body.tools, undefined);
        assert.deepEqual(calls[0].body.messages, [{ role: 'system', content: 's' }, { role: 'user', content: 'x' }]);
    });
});

test('gemini 3 keeps thoughtSignature from functionCall parts and replays it on the next request', async () => {
    const client = createClient({ ...baseSettings, provider: 'gemini', model: 'gemini-3.8-flash' });
    const firstTurn = await withFetch(() => sseResponse([
        { candidates: [{ content: { parts: [
            { functionCall: { name: 'read_file', args: { path: 'README.md' } }, thoughtSignature: 'sig-abc' },
            { functionCall: { name: 'list_directory', args: { path: '.' } } }
        ] }, finishReason: 'STOP' }] }
    ]), () => client.generateText({ messages: [{ role: 'user', content: 'edit README' }], tools: TOOLS, onDelta: () => {} }));
    assert.equal(firstTurn.toolCalls[0].thoughtSignature, 'sig-abc');
    assert.equal(firstTurn.toolCalls[1].thoughtSignature, undefined, 'parallel calls after the first carry no signature');

    const history = normalizeMessages([
        { role: 'user', content: 'edit README' },
        { role: 'model', content: '', toolCalls: firstTurn.toolCalls },
        { role: 'tool', toolResults: firstTurn.toolCalls.map(call => ({ id: call.id, name: call.name, content: 'ok' })) }
    ]);
    assert.equal(history[1].toolCalls[0].thoughtSignature, 'sig-abc', 'normalizeMessages keeps the signature');

    await withFetch(() => sseResponse([{ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] }]), async calls => {
        await client.generateText({ messages: history, tools: TOOLS, onDelta: () => {} });
        assert.deepEqual(calls[0].body.contents[1].parts, [
            { functionCall: { name: 'read_file', args: { path: 'README.md' } }, thoughtSignature: 'sig-abc' },
            { functionCall: { name: 'list_directory', args: { path: '.' } } }
        ]);
    });
});

test('gemini 3 history without signatures gets the documented placeholder on the first call only', async () => {
    const client = createClient({ ...baseSettings, provider: 'gemini', model: 'gemini-3-pro-preview' });
    await withFetch(() => sseResponse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }]), async calls => {
        await client.generateText({
            messages: [
                { role: 'user', content: 'go' },
                { role: 'model', content: '', toolCalls: [{ id: 'a:0', name: 'list_directory', args: {} }, { id: 'b:1', name: 'read_file', args: {} }] },
                { role: 'tool', toolResults: [{ id: 'a:0', name: 'list_directory', content: 'ok' }, { id: 'b:1', name: 'read_file', content: 'ok' }] }
            ],
            tools: TOOLS,
            onDelta: () => {}
        });
        const parts = calls[0].body.contents[1].parts;
        assert.equal(parts[0].thoughtSignature, 'skip_thought_signature_validator');
        assert.equal(parts[1].thoughtSignature, undefined);
    });
});

test('a missing thought_signature 400 is not reported as tools unsupported and is not retried', async () => {
    const client = createClient({ ...baseSettings, provider: 'gemini', model: 'gemini-3.8-flash' });
    const message = 'Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly.';
    await withFetch(() => jsonResponse({ error: { code: 400, message, status: 'INVALID_ARGUMENT' } }, 400), async calls => {
        await assert.rejects(
            client.generateText({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS, onDelta: () => {} }),
            error => error.code === 'AI_TOOL_SIGNATURE_MISSING'
                && /thought_signature/.test(error.message)
                && !/不支持工具调用/.test(error.message)
        );
        assert.equal(calls.length, 1, 'no buffered retry with the same broken history');
    });
});

test('gemini merges adjacent model turns so a function call never follows another model turn', async () => {
    const client = createClient({ ...baseSettings, provider: 'gemini', model: 'gemini-3.8-flash' });
    await withFetch(() => sseResponse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }]), async calls => {
        await client.generateText({
            messages: [
                { role: 'user', content: 'edit README' },
                { role: 'model', content: 'Earlier answer' },
                { role: 'model', content: '', toolCalls: [{ id: 'read_file:0', name: 'read_file', args: {}, thoughtSignature: 'sig' }] },
                { role: 'tool', toolResults: [{ id: 'read_file:0', name: 'read_file', content: 'ok' }] },
                { role: 'user', content: 'next' }
            ],
            tools: TOOLS,
            onDelta: () => {}
        });
        const contents = calls[0].body.contents;
        assert.deepEqual(contents.map(item => item.role), ['user', 'model', 'user', 'user']);
        assert.deepEqual(contents[1].parts, [{ text: 'Earlier answer' }, { functionCall: { name: 'read_file', args: {} }, thoughtSignature: 'sig' }]);
    });
});

test('tool errors are classified precisely instead of always blaming tool support', async () => {
    const client = createClient({ ...baseSettings, provider: 'gemini', model: 'gemini-3.8-flash' });
    const cases = [
        ['Please ensure that function call turn comes immediately after a user turn or after a function response turn.', 'AI_TOOL_HISTORY_INVALID', /工具调用历史的顺序/],
        ['Function calling is not enabled for models/gemini-x', 'AI_TOOLS_UNSUPPORTED', /不支持工具调用/],
        ["Invalid value at 'tools[0].function_declarations[0].parameters'", undefined, null]
    ];
    for (const [message, code, pattern] of cases) {
        await withFetch(() => jsonResponse({ error: { code: 400, message, status: 'INVALID_ARGUMENT' } }, 400), async calls => {
            await assert.rejects(
                client.generateText({ messages: [{ role: 'user', content: 'x' }], tools: TOOLS, onDelta: () => {} }),
                error => {
                    assert.equal(error.code, code, message);
                    if (pattern) assert.match(error.message, pattern);
                    else assert.doesNotMatch(error.message, /不支持工具调用/);
                    return true;
                }
            );
            if (code) assert.equal(calls.length, 1, `${code} is not retried with the same history`);
        });
    }
});
