const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'welink-agent-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
process.env.TOOLS_AGENT_BROWSER = 'off';
const { runWithTenant, getDataDir } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const config = require('../backend/models/channels/welink-config-repository');
const bridge = require('../backend/models/channels/dragon-claw-channel-bridge');
const manager = require('../backend/models/agent-run-manager');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const browser = require('../backend/models/agent-browser');
const chat = require('../backend/models/ai-chat-repository');

test.after(async () => {
    await pool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

async function turn(tenant, options) {
    const events = [];
    await runWithTenant(tenant, () => bridge.runTurn({ channel: 'welink', account: 'alice', conversation: { kind: 'user', id: 'alice' }, text: '继续', ...options, onEvent: event => events.push(event) }));
    return events;
}

test('WeLink 完整链路执行文件、命令、Skill 和 Dragon 浏览器，保留上下文且 /new 重置工具会话', async t => {
    const originals = [settings.getRuntimeSettings, settings.getRedactionSecrets, provider.createClient, browser.available, browser.preview, browser.execute];
    t.after(() => { [settings.getRuntimeSettings, settings.getRedactionSecrets, provider.createClient, browser.available, browser.preview, browser.execute] = originals; });
    settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, model: 'fake', maxOutputTokens: 2048, temperature: 0.2 });
    settings.getRedactionSecrets = async () => [];
    browser.available = () => ({ kind: 'desktop', label: 'Dragon' });
    browser.preview = async () => ({});
    await runWithTenant('default', async () => {
        const { setEntryAccess } = require('../backend/models/tool-distribution');
        await setEntryAccess('skill:debug', true);
        await setEntryAccess('skill:write-doc', true);
    });
    const navigations = [];
    browser.execute = async (ctx, name, args) => {
        navigations.push({ ctx, name, args });
        return { content: 'Dragon browser opened example.com', summary: '已打开网页' };
    };
    const script = [
        { name: 'write_file', args: { path: 'result.txt', content: 'welink-owned' } },
        { name: 'run_command', args: { command: 'node -p "6 * 7"' } },
        { name: 'load_skill', args: { id: 'write-doc' } },
        { name: 'tool_search', args: { select: ['browser'] } },
        { name: 'browser_navigate', args: { url: 'https://example.com' } }
    ];
    const requests = [];
    provider.createClient = () => ({ model: 'fake', async generateText(options) {
        requests.push(options);
        const call = script.shift();
        if (call) return { text: '', toolCalls: [{ id: `c-${requests.length}`, ...call }] };
        options.onDelta?.('已完成');
        return { text: '已完成', toolCalls: [] };
    } });
    await runWithTenant('default', () => config.saveConfig({ access: { users: { mode: 'whitelist', whitelist: ['alice', 'bob'] }, groups: { mode: 'whitelist', whitelist: ['team'] } } }));
    const events = await turn('default', { text: '打开 https://example.com 并用 @debug 检查，写入 result.txt' });
    const done = events.find(event => event.type === 'done');
    assert.ok(done, JSON.stringify(events));
    assert.equal(events.some(event => event.type === 'approval'), false);
    for (const name of ['write_file', 'run_command', 'load_skill', 'browser_navigate']) {
        assert.ok(events.some(event => event.type === 'tool_result' && event.tool === name && event.ok), name);
    }
    assert.match(requests[0].systemInstruction, /### @debug/);
    assert.equal(navigations.length, 1, '普通网址直接走 Dragon 浏览器，不拦截为 TAC');
    assert.equal(navigations[0].ctx.owner, 'default::welink:alice');
    const saved = await runWithTenant('default', () => chat.getSession(done.sessionId));
    const first = manager.getSession(saved.agent_session_id, { username: 'welink:alice', role: 'admin' }, 'default');
    assert.equal(first.readOnly, false);
    assert.equal(first.permissionMode, 'full');
    assert.match(first.root, /channel-workspaces[/\\]welink-sdk[/\\]/);
    assert.equal(fs.readFileSync(path.join(first.root, 'result.txt'), 'utf8'), 'welink-owned');
    assert.ok(first.loadedSkills.has('write-doc'));
    assert.ok(JSON.stringify(first.transcript).includes('42'));
    await turn('default', { aiSessionId: done.sessionId });
    assert.match(requests.at(-1).systemInstruction, /### @debug/, '显式技能在后续轮次保留');
    assert.equal(requests.at(-1).messages.some(message => message.toolCalls?.some(call => call.name === 'browser_navigate')), true);
    const fresh = (await turn('default', {})).find(event => event.type === 'done');
    assert.notEqual(fresh.sessionId, done.sessionId);
    const freshSaved = await runWithTenant('default', () => chat.getSession(fresh.sessionId));
    assert.notEqual(freshSaved.agent_session_id, first.id);
    assert.equal(freshSaved.agent_root, first.root, '新对话保留同一归属的文件');
});

test('人员/群组名单在桥接再次校验，未知身份拒绝，微信与后台生成没有完整权限', async t => {
    const route = require('../backend/routes/ai');
    const original = route.handleChatRequest;
    const requests = [];
    route.handleChatRequest = async (req, res) => { requests.push(req); res.end(); };
    t.after(() => { route.handleChatRequest = original; });
    for (const options of [
        { account: 'mallory' }, { account: '' },
        { conversation: { kind: 'group', id: 'blocked-group' } }
    ]) {
        const events = await turn('default', options);
        assert.equal(events[0].type, 'error');
    }
    assert.equal(requests.length, 0);
    await turn('default', { channel: 'weixin' });
    await turn('default', { persist: false });
    for (const req of requests) {
        assert.equal(req.user.role, 'user');
        assert.equal(req.channelTurn.fullAccess, false);
    }
});

test('专用目录及工具会话按租户、单聊/群聊隔离，路径不接受远端输入', () => {
    const make = (tenantId, username, chatSessionId = 'chat-1') => manager.ensureWeLinkSession({ tenantId, user: { username, role: 'admin' }, chatSessionId });
    const a = make('default', 'welink:alice');
    const b = make('team-b', 'welink:alice');
    const c = make('default', 'welink-group:team');
    const d = make('default', 'welink:bob');
    assert.equal(new Set([a.root, b.root, c.root, d.root]).size, 4);
    assert.ok(b.root.startsWith(getDataDir('team-b') + path.sep));
    assert.equal(make('default', 'welink:alice').id, a.id);
    assert.notEqual(make('default', 'welink:alice', 'chat-2').id, a.id);
    assert.throws(() => manager.getSession(a.id, { username: 'welink:bob' }, 'default'), /无权/);
    assert.throws(() => manager.getSession(a.id, { username: 'welink:alice' }, 'team-b'), /无权/);
});

test('WeLink 群聊自动加载 @welink-office 总结本群记录，且严格区分普通群成员（仅限本群）与超级管理员名单（可查任意群/单聊）', async t => {
    const welinkCliAgent = require('../backend/models/channels/welink-cli-agent');
    const welinkCliRunner = require('../backend/models/channels/welink-cli-runner');
    const originals = [settings.getRuntimeSettings, settings.getRedactionSecrets, provider.createClient, welinkCliRunner.readConfig, welinkCliRunner.tenantAllowed, welinkCliRunner.run];
    t.after(() => {
        [settings.getRuntimeSettings, settings.getRedactionSecrets, provider.createClient, welinkCliRunner.readConfig, welinkCliRunner.tenantAllowed, welinkCliRunner.run] = originals;
    });
    settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, model: 'fake', maxOutputTokens: 2048, temperature: 0.2 });
    settings.getRedactionSecrets = async () => [];
    welinkCliRunner.readConfig = () => ({ enabled: true, allowWrite: false, verbose: false });
    welinkCliRunner.tenantAllowed = () => true;
    welinkCliRunner.run = async args => ({ ok: true, code: 0, json: { argv: args, messages: [{ sender: 'alice', content: '本周发布 v1.2' }] }, text: 'ok', stderr: '', raw: 'ok', error: '' });

    await runWithTenant('default', () => config.saveConfig({
        access: { users: { mode: 'all', whitelist: [], blacklist: [] }, groups: { mode: 'all', whitelist: [], blacklist: [] } },
        superAdmins: ['boss']
    }));

    // 1. 普通群成员 bob 在群 team 里说“总结下群里最近一周都说啥了”：
    // 自动激活 @welink-office，查本群 team 成功，尝试查其他群 other-grp、单聊 alice 或用 run_command 调 welink-cli 均被拦截
    const bobCalls = [
        { name: 'welink_query', args: { command: 'im query-history-message', options: { 'group-id': 'team', 'query-count': 100 } } },
        { name: 'welink_query', args: { command: 'im query-history-message', options: { 'group-id': 'other-grp', 'query-count': 50 } } },
        { name: 'welink_query', args: { command: 'im query-history-message', options: { 'user-account': 'alice', 'query-count': 50 } } },
        { name: 'run_command', args: { command: 'welink-cli im query-history-message --user-account alice' } }
    ];
    const bobRequests = [];
    provider.createClient = () => ({
        model: 'fake',
        async generateText(options) {
            bobRequests.push(options);
            const next = bobCalls.shift();
            if (next) return { text: '', toolCalls: [{ id: `bob-${bobRequests.length}`, ...next }] };
            options.onDelta?.('本群本周总结：发布 v1.2');
            return { text: '本群本周总结：发布 v1.2', toolCalls: [] };
        }
    });

    const bobEvents = await turn('default', {
        account: 'bob',
        conversation: { kind: 'group', id: 'team' },
        text: '总结下群里最近一周都说啥了'
    });
    assert.match(bobRequests[0].systemInstruction, /### @welink-office/, '群聊总结请求自动挂载 @welink-office');
    assert.ok(bobRequests[0].tools.some(tool => tool.name === 'welink_query'), '第一轮即提供 welink_query 工具');
    const bobToolResults = bobEvents.filter(e => e.type === 'tool_result');
    assert.equal(bobToolResults[0].ok, true, '普通群成员查本群聊天记录通过');
    assert.equal(bobToolResults[1].ok, false, '普通群成员跨群查询被拦截');
    assert.equal(bobToolResults[2].ok, false, '普通群成员查单聊被拦截');
    assert.equal(bobToolResults[3].ok, false, '普通群成员通过 run_command 绕过调 welink-cli 被拦截');

    // 2. 超级管理员名单成员 boss 在同一个群 team 里询问其他群和单聊：全部放行
    const bossCalls = [
        { name: 'welink_query', args: { command: 'im query-history-message', options: { 'group-id': 'other-grp', 'query-count': 50 } } },
        { name: 'welink_query', args: { command: 'im query-history-message', options: { 'user-account': 'alice', 'query-count': 50 } } }
    ];
    provider.createClient = () => ({
        model: 'fake',
        async generateText(options) {
            const next = bossCalls.shift();
            if (next) return { text: '', toolCalls: [{ id: `boss-${bossCalls.length}`, ...next }] };
            options.onDelta?.('跨群与单聊查询完成');
            return { text: '跨群与单聊查询完成', toolCalls: [] };
        }
    });
    const bossEvents = await turn('default', {
        account: 'boss',
        conversation: { kind: 'group', id: 'team' },
        text: '总结下群里最近一周都说啥了，顺便看下 other-grp 和 alice 的记录'
    });
    const bossToolResults = bossEvents.filter(e => e.type === 'tool_result');
    assert.equal(bossToolResults.length, 2);
    assert.equal(bossToolResults[0].ok, true, '超级管理员在群里跨群查询通过');
    assert.equal(bossToolResults[1].ok, true, '超级管理员在群里查单聊通过');
});
