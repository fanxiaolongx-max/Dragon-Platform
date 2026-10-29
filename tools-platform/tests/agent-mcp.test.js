const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-mcp-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_TEST_PLATFORM_SECRET = 'platform-secret-value';

const mcp = require('../backend/models/agent-mcp');
const extraTools = require('../backend/models/agent-extra-tools');
const manager = require('../backend/models/agent-run-manager');
const agentLoop = require('../backend/models/agent-loop');
const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const tenantPool = require('../backend/models/tenant-sqlite-pool');

const fixture = path.join(__dirname, 'fixtures', 'mcp-echo-server.js');
const inDefault = fn => runWithTenant('default', fn);

test.after(async () => {
    mcp.shutdown();
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('MCP servers are validated, secrets are masked and kept, and only the default tenant may configure them', async () => {
    await assert.rejects(inDefault(() => mcp.saveServers([{ name: 'bad', command: 'npx', args: ['-y', 'some-mcp@latest'] }])), /npx …@latest/);
    await assert.rejects(inDefault(() => mcp.saveServers([{ name: 'web', transport: 'http', url: 'ftp://x' }])), /http \/ https/);
    const saved = await inDefault(() => mcp.saveServers([{ name: 'Echo Server', command: process.execPath, args: [fixture], env: { ECHO_TOKEN: 'tok-123456' } }]));
    assert.equal(saved[0].id, 'echo_server');
    assert.equal(saved[0].env.ECHO_TOKEN, mcp.MASK, 'secret values are never returned');
    const again = await inDefault(() => mcp.saveServers([{ ...saved[0], env: { ECHO_TOKEN: mcp.MASK } }]));
    assert.equal(again[0].env.ECHO_TOKEN, mcp.MASK);
    assert.deepEqual(await inDefault(() => mcp.secrets()), ['tok-123456'], 'the masked value kept the stored secret');
    await assert.rejects(runWithTenant('acme', () => mcp.listServers()), /默认租户/);
    assert.deepEqual(await runWithTenant('acme', () => mcp.toolsets({ readOnly: false })), []);
});

test('MCP tools join chats as an approval-gated group, pass only their own env, and report tool errors', async () => {
    const tested = await inDefault(() => mcp.testServer('echo_server'));
    assert.equal(tested.status, 'ready');
    assert.deepEqual(tested.tools.map(tool => tool.name), ['echo', 'add', 'fail']);
    const sets = await inDefault(() => extraTools.toolsets({ owner: 'default::alice', readOnly: false }));
    const set = sets.find(item => item.id === 'mcp_echo_server');
    assert.deepEqual(set.definitions.map(def => def.name), ['mcp__echo_server__echo', 'mcp__echo_server__add', 'mcp__echo_server__fail']);
    assert.equal(set.kindOf('mcp__echo_server__echo'), 'external');
    assert.deepEqual(await inDefault(() => extraTools.toolsets({ owner: 'default::guest', readOnly: true })), []);

    const events = [];
    const write = event => {
        events.push(event);
        if (event.type === 'approval') setImmediate(() => manager.resolveApproval(event.id, event.tool.endsWith('fail') ? 'deny' : 'allow', { username: 'alice', role: 'admin' }, 'default'));
    };
    const result = await inDefault(async () => {
        const extras = await extraTools.forChat({ owner: 'default::alice', chatSessionId: 'mcp-chat', readOnly: false, write, signal: new AbortController().signal });
        const script = [
            { toolCalls: [{ id: 's', name: 'tool_search', args: { select: ['mcp_echo_server'] } }] },
            { toolCalls: [{ id: 'e', name: 'mcp__echo_server__echo', args: { text: 'hi' } }, { id: 'f', name: 'mcp__echo_server__fail', args: {} }] },
            { text: '好了' }
        ];
        const requests = [];
        const out = await agentLoop.runToolLoop({ client: { generateText: async options => { requests.push({ ...options, messages: [...options.messages] }); return script.shift(); } },
            systemPrompt: 'sys', messages: [{ role: 'user', content: 'echo' }], tools: [], extras, executeCall: async () => assert.fail('MCP calls go through extras'), write });
        extras.end();
        return { out, requests };
    });
    assert.match(result.requests[0].systemInstruction, /MCP 服务「Echo Server」[\s\S]*mcp__echo_server__echo/);
    const approvals = events.filter(event => event.type === 'approval');
    assert.deepEqual(approvals.map(event => event.preview.title), ['MCP · Echo Server', 'MCP · Echo Server']);
    const [echo, fail] = result.requests[2].messages.at(-1).toolResults;
    assert.match(echo.content, /echo: hi \(token received; platform secret not passed\)/);
    assert.equal(fail.isError, true);
    assert.match(fail.content, /拒绝/);

    await inDefault(() => mcp.saveServers([{ ...tested, trusted: true, env: { ECHO_TOKEN: mcp.MASK } }]));
    const trusted = (await inDefault(() => extraTools.toolsets({ owner: 'default::alice', readOnly: false }))).find(item => item.id === 'mcp_echo_server');
    assert.equal(trusted.kindOf('mcp__echo_server__add'), 'read', 'a trusted server needs no approval');
    assert.equal((await trusted.execute({ name: 'mcp__echo_server__add', args: { a: 2, b: 3 } })).content, '5');
    const failed = await trusted.execute({ name: 'mcp__echo_server__fail', args: {} });
    assert.equal(failed.isError, true);
    assert.equal(failed.content, 'boom');
});

test('an unreachable server is skipped instead of blocking the chat', async () => {
    await inDefault(() => mcp.saveServers([{ name: 'Gone', command: path.join(sandbox, 'no-such-binary') }]));
    const started = Date.now();
    const sets = await inDefault(() => mcp.toolsets({ readOnly: false }));
    assert.deepEqual(sets, []);
    assert.ok(Date.now() - started < 7000);
    const [server] = await inDefault(() => mcp.listServers());
    assert.equal(server.status, 'error');
    assert.ok(server.error);
});
