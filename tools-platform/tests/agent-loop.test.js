const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-loop-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const agentLoop = require('../backend/models/agent-loop');
const opsAgent = require('../backend/models/channels/ops-agent');

const BIG = Array.from({ length: 2000 }, (_, index) => `row ${index + 1} value ${index % 7 === 0 ? 'ERROR' : 'ok'}`).join('\n');

test('without file tools, a large result is saved to the owner file and a read_file limited to those files is offered', async () => {
    const requests = [];
    const events = [];
    const replies = [
        () => ({ toolCalls: [{ id: 'q1', name: 'big_query', args: {} }] }),
        options => {
            const content = options.messages.at(-1).toolResults[0].content;
            const file = content.match(/已保存到 (\S+?)；/)[1];
            return { toolCalls: [{ id: 'r1', name: 'read_file', args: { path: file, startLine: 1000, limit: 3 } }, { id: 'r2', name: 'read_file', args: { path: '/etc/hosts' } }] };
        },
        () => ({ text: '第 1000 行是 row 1000。' })
    ];
    const result = await agentLoop.runToolLoop({
        client: { model: 'mock', generateText: async options => { requests.push(options); return replies.shift()(options); } },
        systemPrompt: 'sys', messages: [{ role: 'user', content: '查一下' }],
        tools: [{ name: 'big_query', description: 'q', parameters: { type: 'object', properties: {} } }],
        write: event => events.push(event), artifactOwner: 'default::alice', artifactSession: 'chat-1',
        executeCall: async call => ({ content: call.name === 'big_query' ? BIG : 'x', summary: 'ok' })
    });
    assert.equal(result.text, '第 1000 行是 row 1000。');
    assert.deepEqual(requests[0].tools.map(tool => tool.name), ['update_plan', 'ask_user', 'calculate', 'big_query'], 'the reader is only offered once a result file exists');
    assert.deepEqual(requests[1].tools.map(tool => tool.name), ['update_plan', 'ask_user', 'calculate', 'big_query', 'read_file']);
    const [paged, refused] = requests[2].messages.at(-1).toolResults;
    assert.match(paged.content, /1000│row 1000 value/);
    assert.equal(refused.isError, true);
    assert.match(refused.content, /只能读取/);
    const spilled = events.find(event => event.type === 'tool_result' && event.callId === 'q1');
    assert.ok(spilled.artifact.path.startsWith(path.join(sandbox, 'data', 'agent-artifacts')));
    assert.equal(fs.readFileSync(spilled.artifact.path, 'utf8'), BIG);
});

test('models without tool calling fall back to a plain reply, and a preset can answer without calling the model', async () => {
    const unsupported = () => { throw Object.assign(new Error('unsupported'), { code: 'AI_TOOLS_UNSUPPORTED' }); };
    const plain = await agentLoop.runToolLoop({
        client: { generateText: unsupported, generateChat: async options => ({ text: options.systemInstruction.includes('不支持') ? '请切换模型' : '?' }) },
        systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }], executeCall: async () => null,
        toolsUnsupported: () => ({ note: '当前模型不支持工具调用' })
    });
    assert.equal(plain.text, '请切换模型');
    assert.equal(plain.toolsUnsupported, true);
    const fixed = await agentLoop.runToolLoop({
        client: { generateText: unsupported, generateChat: async () => assert.fail('no model call') },
        systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }], executeCall: async () => null, toolsUnsupported: () => ({ text: '固定说明' })
    });
    assert.equal(fixed.text, '固定说明');
    await assert.rejects(agentLoop.runToolLoop({ client: { generateText: unsupported }, systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }], executeCall: async () => null }), /unsupported/);
});

test('presets on the shared engine stream thinking and tool rows, and summarize without tools at the step cap', async () => {
    const events = [];
    const requests = [];
    const client = { model: 'mock', generateText: async options => {
        requests.push(options);
        if (options.toolChoice === 'none') return { text: '已查看运营概况，还差确认计划。' };
        options.onReasoning?.('先看看概况');
        return { toolCalls: [{ id: `o${requests.length}`, name: 'ops_unknown_tool', args: {} }] };
    } };
    const result = await opsAgent.runTurn({ client, systemInstruction: 'sys', messages: [{ role: 'user', content: '看看运营' }], ctx: { actor: 'admin' },
        onEvent: event => events.push(event), onDelta: () => {} });
    assert.equal(requests.length, agentLoop.MAX_STEPS + 1);
    assert.match(result.text, /^已查看运营概况，还差确认计划。\n\n（已达到单轮最大工具调用步数 60/);
    assert.ok(events.some(event => event.type === 'thinking' && event.delta === '先看看概况'));
    assert.equal(events.filter(event => event.type === 'tool_start').length, agentLoop.MAX_STEPS);
    assert.equal(events.find(event => event.type === 'tool_result').ok, false);
});

test('a large single-line JSON result is saved as multi-line JSON and the note states how many items each array has', async () => {
    const artifacts = require('../backend/models/agent-artifacts');
    const content = JSON.stringify({ database: 'platform:report.db', tables: Array.from({ length: 451 }, (_, index) => `table_${index}_with_a_long_name`) });
    const spilled = await artifacts.spill({ owner: 'default::alice', sessionId: 'chat-2', callId: 's1', toolName: 'database_schema', content });
    assert.match(spilled.content, /JSON 结构：tables：451 项。/);
    assert.match(spilled.content, /不能根据开头和结尾推测/);
    assert.equal(spilled.artifact.lines, 456); // { + database + "tables": [ + 451 项 + ] + }
});
