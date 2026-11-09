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
