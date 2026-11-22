const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-loop-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
// 引擎在后台记录工具调用次数（写临时库），稍等再删目录
test.after(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

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

test('incomplete plan items are finalized to completed on clean completion, but not after a tool failure', async () => {
    const okEvents = [];
    const okReplies = [
        () => ({ toolCalls: [{ id: 'p1', name: 'update_plan', args: { items: [{ content: '第一步', status: 'in_progress' }, { content: '第二步', status: 'pending' }] } }] }),
        () => ({ toolCalls: [{ id: 'c1', name: 'calculate', args: { expression: '1+1' } }] }),
        () => ({ text: '已完成全部计算。' })
    ];
    const okResult = await agentLoop.runToolLoop({
        client: { model: 'mock', generateText: async () => okReplies.shift()() },
        systemPrompt: 'sys', messages: [{ role: 'user', content: '算一下' }],
        write: event => okEvents.push(event),
        executeCall: async () => null
    });
    assert.deepEqual(okResult.plan, [
        { content: '第一步', status: 'completed' },
        { content: '第二步', status: 'completed' }
    ]);
    const planEvents = okEvents.filter(event => event.type === 'plan');
    assert.equal(planEvents.length, 2);
    assert.deepEqual(planEvents[1].items, okResult.plan);

    const failEvents = [];
    const failReplies = [
        () => ({ toolCalls: [{ id: 'p1', name: 'update_plan', args: { items: [{ content: '第一步', status: 'in_progress' }, { content: '发布工具', status: 'pending' }] } }] }),
        () => ({ toolCalls: [{ id: 'f1', name: 'fail_tool', args: {} }] }),
        () => ({ text: '发布未执行。' })
    ];
    const failResult = await agentLoop.runToolLoop({
        client: { model: 'mock', generateText: async () => failReplies.shift()() },
        systemPrompt: 'sys', messages: [{ role: 'user', content: '发布' }],
        tools: [{ name: 'fail_tool', description: 'f', parameters: { type: 'object', properties: {} } }],
        write: event => failEvents.push(event),
        executeCall: async () => ({ content: '用户拒绝了该操作', summary: '用户拒绝了该操作', isError: true })
    });
    assert.deepEqual(failResult.plan, [
        { content: '第一步', status: 'in_progress' },
        { content: '发布工具', status: 'pending' }
    ]);
    assert.equal(failEvents.filter(event => event.type === 'plan').length, 1);
});

test('incomplete plan items are NOT marked completed if model text mentions unfinished work or asks a question', async () => {
    const unfinishedEvents = [];
    const unfinishedReplies = [
        () => ({ toolCalls: [{ id: 'p1', name: 'update_plan', args: { items: [{ content: '步骤1', status: 'completed' }, { content: '步骤2', status: 'pending' }] } }] }),
        () => ({ toolCalls: [{ id: 'c1', name: 'calculate', args: { expression: '2+2' } }] }),
        () => ({ text: '步骤2由于依赖服务未启动，未能完成。' })
    ];
    const unfinishedResult = await agentLoop.runToolLoop({
        client: { model: 'mock', generateText: async () => unfinishedReplies.shift()() },
        systemPrompt: 'sys', messages: [{ role: 'user', content: '继续' }],
        write: event => unfinishedEvents.push(event),
        executeCall: async () => ({ content: '4', summary: '4' })
    });
    assert.deepEqual(unfinishedResult.plan, [
        { content: '步骤1', status: 'completed' },
        { content: '步骤2', status: 'pending' }
    ]);
    // 只有初始 update_plan 产生的 1 个 plan 事件，不会被自动篡改成 completed
    assert.equal(unfinishedEvents.filter(event => event.type === 'plan').length, 1);
});

test('update_plan blocks setting completed if immediately preceding tool call failed, and fixes contradiction if text reports failure', async () => {
    const events = [];
    const replies = [
        () => ({ toolCalls: [{ id: 'p1', name: 'update_plan', args: { items: [{ content: '算 125*8', status: 'in_progress' }, { content: '删临时表', status: 'pending' }] } }] }),
        () => ({ toolCalls: [{ id: 'c1', name: 'calculate', args: { expression: '125*8' } }] }),
        () => ({ toolCalls: [{ id: 'p2', name: 'update_plan', args: { items: [{ content: '算 125*8', status: 'completed' }, { content: '删临时表', status: 'in_progress' }] } }] }),
        () => ({ toolCalls: [{ id: 'd1', name: 'delete_mock', args: {} }] }),
        () => ({ toolCalls: [{ id: 'p3', name: 'update_plan', args: { items: [{ content: '算 125*8', status: 'completed' }, { content: '删临时表', status: 'completed' }] } }] }),
        () => ({ text: '删除临时表失败，操作无法执行。请问您需要我尝试其他操作吗？' })
    ];
    const result = await agentLoop.runToolLoop({
        client: { model: 'mock', generateText: async () => replies.shift()() },
        systemPrompt: 'sys', messages: [{ role: 'user', content: '执行' }],
        tools: [{ name: 'delete_mock', description: 'd', parameters: { type: 'object', properties: {} } }],
        write: event => events.push(event),
        executeCall: async call => {
            if (call.name === 'delete_mock') return { content: '表不存在', summary: '该表不可供 AI 读取', ok: false, isError: true };
            return null;
        }
    });
    // 第二步绝不能被虚标为 completed，必须保持 pending
    assert.deepEqual(result.plan, [
        { content: '算 125*8', status: 'completed' },
        { content: '删临时表', status: 'pending' }
    ]);
    const lastPlan = events.filter(e => e.type === 'plan').at(-1);
    assert.equal(lastPlan.items[1].status, 'pending');
});

test('tool arguments cut off by the output limit are not run; the model is told to write a file and use a path, with a larger output budget', async () => {
    const budgets = [];
    let call = 0;
    const executed = [];
    const result = await agentLoop.runToolLoop({
        client: { generateText: async options => {
            budgets.push(options.maxOutputTokens);
            call += 1;
            if (call === 1) return { text: '', finishReason: 'length', toolCalls: [{ id: 't1', name: 'save_skill', args: '{"markdown":"---\\nid: demo\\n很长的正文' }] };
            const last = options.messages.at(-1);
            assert.match(last.toolResults[0].content, /AGENT_TOOL_ARGS_TRUNCATED/);
            assert.match(last.toolResults[0].content, /"path"/);
            return { text: '改用文件提交', finishReason: 'stop' };
        } },
        systemPrompt: 'sys', messages: [{ role: 'user', content: 'save' }], maxOutputTokens: 2048,
        executeCall: async c => { executed.push(c.name); return { content: 'ok' }; }
    });
    assert.equal(result.text, '改用文件提交');
    assert.deepEqual(executed, []);
    assert.equal(budgets[0], 2048);
    assert.ok(budgets[1] >= 8192);
});
