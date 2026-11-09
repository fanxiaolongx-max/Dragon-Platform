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

test('MCP servers are validated, secrets are masked and kept, and team accounts see only the shared service metadata', async () => {
    await assert.rejects(inDefault(() => mcp.saveServers([{ name: 'bad', command: 'npx', args: ['-y', 'some-mcp@latest'] }])), /npx …@latest/);
    await assert.rejects(inDefault(() => mcp.saveServers([{ name: 'web', transport: 'http', url: 'ftp://x' }])), /http \/ https/);
    const saved = await inDefault(() => mcp.saveServers([{ name: 'Echo Server', command: process.execPath, args: [fixture], env: { ECHO_TOKEN: 'tok-123456' } }]));
    assert.equal(saved[0].id, 'echo_server');
    assert.equal(saved[0].env.ECHO_TOKEN, mcp.MASK, 'secret values are never returned');
    const again = await inDefault(() => mcp.saveServers([{ ...saved[0], env: { ECHO_TOKEN: mcp.MASK } }]));
    assert.equal(again[0].env.ECHO_TOKEN, mcp.MASK);
    assert.deepEqual(await inDefault(() => mcp.secrets()), ['tok-123456'], 'the masked value kept the stored secret');
    const [shared] = await runWithTenant('acme', () => mcp.listServers({ manage: false }));
    assert.equal(shared.name, 'Echo Server');
    for (const key of ['env', 'headers', 'cwd', 'command', 'args', 'url', 'error']) assert.equal(shared[key], undefined);
});

test('MCP tools join chats as an approval-gated group, pass only their own env, and report tool errors', async () => {
    const tested = await inDefault(() => mcp.testServer('echo_server'));
    assert.equal(tested.status, 'ready');
    assert.deepEqual(tested.tools.map(tool => tool.name), ['echo', 'add', 'fail']);
    const sets = await inDefault(() => extraTools.toolsets({ owner: 'default::alice', readOnly: false }));
    const set = sets.find(item => item.id === 'mcp_echo_server');
    assert.deepEqual(set.definitions.map(def => def.name), ['mcp__echo_server__echo', 'mcp__echo_server__add', 'mcp__echo_server__fail']);
    assert.equal(set.kindOf('mcp__echo_server__echo'), 'external');
    const guest = { username: 'guest', role: 'viewer' };
    const shared = await runWithTenant('acme', () => extraTools.toolsets({ owner: 'acme::guest', user: guest, readOnly: true }));
    assert.deepEqual(shared.map(set => set.id), ['platform_tools', 'mcp_echo_server']);

    const events = [];
    const write = event => {
        events.push(event);
        if (event.type === 'approval') setImmediate(() => manager.resolveApproval(event.id, event.tool.endsWith('fail') ? 'deny' : 'allow', guest, 'acme'));
    };
    // 团队默认用不了共享 MCP，这里先由超级管理员开启
    const toolAccess = require('../backend/models/agent-tool-access');
    await toolAccess.setAccess('group', 'mcp', true);
    const result = await runWithTenant('acme', async () => {
        const extras = await extraTools.forChat({ owner: 'acme::guest', user: guest, chatSessionId: 'mcp-chat', readOnly: true, write, signal: new AbortController().signal });
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
    await toolAccess.setAccess('group', 'mcp', false);
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

test('channel chats (WeChat users are not admins) get trusted MCP servers and skill loading, but nothing that needs approval', async () => {
    await inDefault(() => mcp.saveServers([
        { name: 'Echo Server', command: process.execPath, args: [fixture], trusted: true },
        { name: 'Untrusted', command: process.execPath, args: [fixture] }
    ]));
    await inDefault(() => require('../backend/models/tool-distribution').setEntryAccess('skill:web-scraper', true));
    const ids = sets => sets.map(set => set.id);
    assert.deepEqual(ids(await inDefault(() => extraTools.toolsets({ owner: 'default::weixin:bob', readOnly: true, channel: true }))), ['platform_tools', 'mcp_echo_server'],
        'no untrusted MCP, browser or save_skill in channels');
    assert.deepEqual(ids(await inDefault(() => extraTools.toolsets({ owner: 'default::weixin:bob', readOnly: true }))), ['platform_tools', 'mcp_echo_server', 'mcp_untrusted'], 'web chats can approve untrusted MCP calls');

    const events = [];
    const deltas = [];
    const out = await inDefault(async () => {
        const extras = await extraTools.forChat({ owner: 'default::weixin:bob', chatSessionId: 'wx-chat', readOnly: true, channel: true, write: event => events.push(event), signal: new AbortController().signal });
        const script = [
            { text: '我先查一下', toolCalls: [{ id: 'l', name: 'load_skill', args: { id: 'web-scraper' } }] },
            { toolCalls: [{ id: 'e', name: 'mcp__echo_server__echo', args: { text: 'cisco news' } }] },
            { text: '思科新闻如下' }
        ];
        const requests = [];
        const result = await extraTools.runChannelTurn({ extras, client: { generateText: async options => { requests.push({ ...options, messages: [...options.messages] }); return script.shift(); } },
            systemInstruction: 'sys', messages: [{ role: 'user', content: '好整' }], owner: 'default::weixin:bob', chatSessionId: 'wx-chat',
            onDelta: delta => deltas.push(delta), onEvent: event => events.push(event), bufferText: true });
        extras.end();
        return { result, requests };
    });
    assert.ok(out.requests[0].tools.some(def => def.name === 'load_skill'), 'the skill catalog can be loaded on demand');
    assert.match(out.requests[1].messages.at(-1).toolResults[0].content, /web-scraper/);
    assert.match(out.requests[2].messages.at(-1).toolResults[0].content, /echo: cisco news/);
    assert.equal(events.some(event => event.type === 'approval'), false);
    assert.equal(out.result.text, '思科新闻如下');
    assert.deepEqual(deltas, ['思科新闻如下'], 'WeChat gets the final reply once, not the in-between text');
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

test('tool settings share safe MCP metadata and enforce team access by tool and group', async () => {
    const express = require('../backend/node_modules/express');
    const request = require('supertest');
    const { tenantMiddleware } = require('../backend/models/tenant-context');
    const superAdmin = { username: 'root', role: 'admin', isSuper: true, tenantId: 'default' };
    const team = { username: 'alice', role: 'admin', isSuper: false, tenantId: 'acme' };
    const app = express();
    app.use(express.json(), (req, _res, next) => {
        req.user = req.get('x-test-account') === 'root' ? superAdmin : team;
        next();
    }, tenantMiddleware);
    app.use('/settings', require('../backend/routes/agent-mcp'));
    const call = (method, url, account = 'alice') => request(app)[method](`/settings${url}`).set('x-test-account', account);
    const tool = 'mcp__echo_server__add';
    const set = (scope, id, enabled) => call('patch', '/catalog/access', 'root').send({ scope, id, enabled }).expect(200);

    await inDefault(() => mcp.saveServers([{ name: 'Echo Server', command: process.execPath, args: [fixture], env: { ECHO_TOKEN: 'private-fixture-value' }, trusted: true }]));
    await call('put', '/servers').send({ servers: [] }).expect(403);
    await call('post', '/servers/echo_server/test').expect(403);
    await call('patch', '/catalog/access').send({ scope: 'group', id: 'mcp', enabled: false }).expect(403);
    const { body: shared } = await call('get', '/servers').expect(200);
    assert.equal(shared.manage, false);
    assert.equal(shared.servers[0].name, 'Echo Server');
    assert.equal(shared.servers[0].command, undefined);

    const { body: initial } = await call('get', '/danger-rules').expect(200);
    assert.deepEqual(initial.rules, []);
    await call('post', '/danger-rules', 'root').send({ category: 'upload' }).expect(200);
    assert.deepEqual((await call('get', '/danger-rules').expect(200)).body.rules, []);
    await call('get', '/tool-guides/item?id=page%3A%2Fnetcare-explorer').expect(404);

    const catalog = async account => (await call('get', '/catalog', account).expect(200)).body.groups;
    const names = groups => groups.flatMap(group => group.tools.map(item => item.name));
    // MCP 服务运行在团队沙箱之外：团队默认不开放，超级管理员明确开启后才可用
    assert.ok(!(await catalog()).some(group => group.id === 'mcp'));
    assert.equal((await catalog('root')).find(group => group.id === 'mcp').enabled, false);
    await set('group', 'mcp', true);
    assert.equal((await catalog('root')).find(group => group.id === 'mcp').enabled, true);
    assert.ok(names(await catalog()).includes(tool));
    await set('tool', tool, false);
    assert.ok(!names(await catalog()).includes(tool));
    assert.ok(names(await catalog()).includes('mcp__echo_server__echo'));
    const adminMcp = (await catalog('root')).find(group => group.id === 'mcp');
    assert.equal(adminMcp.tools.find(item => item.name === tool).enabled, false);
    await set('group', 'mcp', false);
    assert.ok(!(await catalog()).some(group => group.id === 'mcp'));

    await runWithTenant('acme', async () => {
        const extras = await extraTools.forChat({ owner: 'acme::alice', user: team, chatSessionId: 'disabled-tool', readOnly: false, write() {} });
        try {
            assert.doesNotMatch(extras.prompt, /mcp__echo_server__/);
            let step = 0;
            const result = await agentLoop.runToolLoop({
                client: { generateText: async () => step++ ? { text: 'done' } : { toolCalls: [{ id: 'forced', name: tool, args: { a: 1, b: 2 } }] } },
                systemPrompt: 'test', messages: [{ role: 'user', content: 'add' }], extras,
                executeCall: async () => assert.fail('disabled tool must not execute')
            });
            assert.match(result.toolLog[0].summary, /工具未开放/);
        } finally { extras.end(); }
    });
    await set('group', 'mcp', true);
    assert.ok(!names(await catalog()).includes(tool), 'reopening a group retains the individual restriction');
    await set('tool', tool, true);
    assert.ok(names(await catalog()).includes(tool));
});
