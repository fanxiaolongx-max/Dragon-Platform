const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-subagent-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const agentLoop = require('../backend/models/agent-loop');
const subagent = require('../backend/models/agent-subagent');
const manager = require('../backend/models/agent-run-manager');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

const root = path.join(sandbox, 'repo');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'README.md'), 'Hello subagent\n');
fs.writeFileSync(path.join(root, 'notes.md'), 'approval lives in agent-run-manager\n');
const user = { username: 'admin', role: 'admin' };

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const usage = { promptTokens: 100, outputTokens: 10, totalTokens: 110 };

test('adjacent read-only calls run in parallel, writes stay in order, and results keep the model order', async () => {
    let running = 0;
    let peak = 0;
    const timeline = [];
    const script = [
        { toolCalls: [{ id: 'r1', name: 'read_a', args: {} }, { id: 'r2', name: 'read_b', args: {} }, { id: 'r3', name: 'read_c', args: {} }, { id: 'w1', name: 'write_x', args: {} }, { id: 'r4', name: 'read_d', args: {} }] },
        { text: 'done' }
    ];
    const seen = [];
    const client = { model: 'mock', async generateText(options) { seen.push(options.messages.map(item => ({ ...item }))); const next = script.shift(); return { text: next.text || '', toolCalls: next.toolCalls || [], usage }; } };
    const delays = { read_a: 60, read_b: 10, read_c: 30, write_x: 5, read_d: 5 };
    const result = await agentLoop.runToolLoop({
        client, systemPrompt: 'S', messages: [{ role: 'user', content: 'go' }], tools: [], builtins: [],
        parallelSafe: call => call.name.startsWith('read_'),
        executeCall: async (call, { start }) => {
            start();
            running += 1;
            peak = Math.max(peak, running);
            timeline.push(`+${call.name}`);
            await new Promise(resolve => setTimeout(resolve, delays[call.name]));
            running -= 1;
            timeline.push(`-${call.name}`);
            return { content: `${call.name} ok`, summary: call.name };
        }
    });
    assert.equal(result.text, 'done');
    assert.equal(peak, 3, 'the three reads ran at the same time');
    assert.ok(timeline.indexOf('+write_x') > timeline.indexOf('-read_a'), 'the write waits for the read batch');
    assert.ok(timeline.indexOf('+read_d') > timeline.indexOf('-write_x'), 'reads after a write wait for it');
    assert.deepEqual(seen[1].at(-1).toolResults.map(item => item.id), ['r1', 'r2', 'r3', 'w1', 'r4'], 'results go back in the order the model asked');
});

test('the crew roster never repeats a name or colour within a turn', () => {
    const next = subagent.roster(() => 0.42);
    const crew = Array.from({ length: subagent.COLORS.length }, () => next());
    assert.equal(crew.length, 20, '20 dinosaurs configured');
    assert.equal(new Set(crew.map(item => item.name)).size, crew.length);
    assert.equal(new Set(crew.map(item => item.color)).size, crew.length);
    assert.ok(crew.every(item => item.emoji && /^#[0-9a-f]{6}$/.test(item.color)));
    // 验证名字格式：性格脾气或正在做的事情 + 恐龙物种名，如「吃草的霸王龙」或「抑郁的尖齿龙」
    const speciesList = subagent.DINOSAURS.map(d => d.species);
    assert.ok(crew.every(item => speciesList.some(species => item.name.endsWith(species))));
    assert.ok(crew.every(item => item.name.includes('的')));
});

test('task sends read-only subagents in parallel, shows them as cards and returns only their conclusions', async () => {
    const session = manager.ensureSession({ agentSessionId: `subagent-${process.pid}`, user, tenantId: 'default', root, permissionMode: 'full' });
    const mainScript = [
        { toolCalls: [
            { id: 't1', name: 'task', args: { description: '读 README', prompt: '读 README.md 并概括' } },
            { id: 't2', name: 'task', args: { description: '找审批入口', prompt: '在 notes.md 里找审批逻辑在哪' } }
        ] },
        { text: '两个子智能体都回来了。' }
    ];
    const subScripts = {
        'README.md': [{ toolCalls: [{ id: 's1', name: 'read_file', args: { path: 'README.md' } }] }, { text: 'README 写着 Hello subagent。' }],
        'notes.md': [{ toolCalls: [{ id: 's2', name: 'write_file', args: { path: 'hack.txt', content: 'x' } }, { id: 's3', name: 'read_file', args: { path: 'notes.md' } }] }, { text: '审批在 agent-run-manager。' }]
    };
    const mainCalls = [];
    let subRunning = 0;
    let subPeak = 0;
    const client = {
        model: 'mock',
        async generateText(options) {
            if (options.systemInstruction.includes('子智能体')) {
                const key = Object.keys(subScripts).find(name => options.messages[0].content.includes(name));
                subRunning += 1;
                subPeak = Math.max(subPeak, subRunning);
                await new Promise(resolve => setTimeout(resolve, 20));
                subRunning -= 1;
                const next = subScripts[key].shift();
                return { text: next.text || '', toolCalls: next.toolCalls || [], usage };
            }
            mainCalls.push(options);
            const next = mainScript.shift();
            return { text: next.text || '', toolCalls: next.toolCalls || [], usage };
        }
    };
    const events = [];
    const result = await manager.runAgentTurn({ session, client, systemInstruction: 'SYS', historyMessages: [{ role: 'user', content: 'research' }], write: event => events.push(event), signal: new AbortController().signal });

    assert.equal(result.text, '两个子智能体都回来了。');
    assert.ok(mainCalls[0].tools.some(tool => tool.name === 'task'), 'the main agent is offered task');
    assert.equal(subPeak, 2, 'both subagents worked at the same time');
    const cards = events.filter(event => event.type === 'subagent' && event.phase === 'start');
    assert.equal(cards.length, 2);
    assert.notEqual(cards[0].name, cards[1].name);
    assert.notEqual(cards[0].color, cards[1].color);
    assert.equal(events.some(event => event.type === 'tool_start' && event.tool === 'task'), false, 'task calls show as cards, not tool rows');
    assert.equal(events.some(event => event.type === 'tool_start' && event.tool === 'read_file'), false, 'subagent tools stay inside the card');
    const done = events.filter(event => event.type === 'subagent' && event.phase === 'done');
    assert.equal(done.length, 2);
    assert.ok(done.every(event => event.ok && event.toolCount >= 1));
    const toolResults = mainCalls[1].messages.at(-1).toolResults;
    assert.deepEqual(toolResults.map(item => item.id), ['t1', 't2']);
    assert.match(toolResults[0].content, /Hello subagent/);
    assert.match(toolResults[1].content, /agent-run-manager/);
    assert.equal(fs.existsSync(path.join(root, 'hack.txt')), false, 'subagents cannot write');
    const refused = events.find(event => event.type === 'subagent' && event.phase === 'tool' && event.tool === 'write_file' && event.state === 'failed');
    assert.match(refused.summary, /只读/);
    assert.ok(result.usage.totalTokens >= 110 * 6, 'subagent tokens count toward the turn');
});
