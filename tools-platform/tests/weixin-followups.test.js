const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-followups-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const db = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const wx = require('../backend/models/channels/weixin-config-repository');
const wl = require('../backend/models/channels/welink-config-repository');
const repo = require('../backend/models/channels/channel-followups-repository');
const agent = require('../backend/models/channels/followup-agent');
const scheduler = require('../backend/models/channels/followup-scheduler');
const bridge = require('../backend/models/channels/dragon-claw-channel-bridge');
const chat = require('../backend/models/ai-chat-repository');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const inTenant = callback => runWithTenant('default', callback);
const context = { channel: 'weixin', conversation: { kind: 'user', id: 'wx-alice' }, actor: 'wx-alice', toolSessionId: 'wx-session' };
let steps = [], sessionId = '', liveTask;
const original = { settings: settings.getRuntimeSettings, secrets: settings.getRedactionSecrets, client: provider.createClient };
settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, model: 'fake', maxOutputTokens: 1024, temperature: 0.2, inputCostPerMillionUsd: 0, outputCostPerMillionUsd: 0, usdToCny: 7 });
settings.getRedactionSecrets = async () => [];
provider.createClient = () => ({
    async generateText(options) { return steps.length ? steps.shift()(options) : { text: '收到', toolCalls: [] }; },
    async generateChat(options) { return this.generateText(options); }
});
async function turn(text, name, args) {
    steps = [options => {
        assert.ok(options.tools.some(tool => tool.name === name));
        assert.match(options.systemInstruction, /当前是微信单聊/);
        return { text: '', toolCalls: [{ id: 'test-call', name, args }] };
    }, () => ({ text: '已通过工具处理跟进任务', toolCalls: [] })];
    const events = [];
    await bridge.runTurn({ channel: 'weixin', account: context.actor, conversation: context.conversation, toolSessionId: context.toolSessionId, text, aiSessionId: sessionId, onEvent: event => events.push(event) });
    const done = events.find(event => event.type === 'done');
    assert.ok(done, JSON.stringify(events.filter(event => ['error', 'http-json'].includes(event.type))));
    sessionId = done.sessionId;
    return events;
}
test.after(async () => {
    settings.getRuntimeSettings = original.settings;
    settings.getRedactionSecrets = original.secrets;
    provider.createClient = original.client;
    await db.closeDatabase();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('WeChat follow-up settings default safely and partial saves preserve its own calendar and switch', async () => inTenant(async () => {
    assert.equal((await wx.getConfig()).followup.enabled, true);
    await wx.saveConfig({ enabled: true, followup: { enabled: false, calendar: { timezone: 'Asia/Shanghai', workStart: '08:00' } } });
    await wx.saveConfig({ modelId: 'configured-model' });
    let config = await wx.getConfig();
    assert.equal(config.followup.enabled, false);
    assert.equal(config.followup.calendar.timezone, 'Asia/Shanghai');
    await wx.saveConfig({ modelId: '', followup: { enabled: true, calendar: { workEnd: '19:00' } } });
    config = await wx.getConfig();
    assert.equal(config.followup.calendar.workStart, '08:00');
    assert.equal(config.followup.calendar.workEnd, '19:00');
    assert.equal(config.followup.calendar.timezone, 'Asia/Shanghai');
    await wx.saveConfig({ followup: { calendar: { timezone: 'Africa/Cairo' } } });
}));

test('real WeChat chat route offers follow-up tools, persists the task and events, and limits it to the current contact', async () => inTenant(async () => {
    const events = await turn('帮我记一下这个设备问题，后边持续跟进', 'followup_create', { title: '设备整改闭环', detail: '核对整改记录', inMinutes: 2, assignees: [{ name: '小王' }], channel: 'welink', conversation: { kind: 'group', id: 'other' } });
    const created = events.find(event => event.type === 'followup' && event.action === 'created');
    assert.ok(created);
    liveTask = await repo.getTask(created.id);
    assert.equal(liveTask.channel, 'weixin');
    assert.deepEqual(liveTask.conversation, { kind: 'user', id: 'wx-alice' });
    assert.equal(liveTask.aiSessionId, sessionId);
    assert.ok(Date.parse(liveTask.nextRemindAt) - Date.now() > 110000);
    const history = await chat.listMessages(sessionId);
    assert.ok(history.some(message => message.events.some(event => event.type === 'followup' && event.id === liveTask.id)));
    const denied = await agent.execute({ ...context, conversation: { kind: 'user', id: 'someone-else' } }, 'followup_close', { id: liveTask.id });
    assert.equal(denied.isError, true);
    await assert.rejects(repo.createTask({ title: '非法群任务' }, { ...context, conversation: { kind: 'group', id: 'g' } }), /仅支持当前单聊/);
}));

test('WeChat progress, pause, resume and completion use the persisted lifecycle', async () => inTenant(async () => {
    await turn('更新这个跟进任务，初稿已经完成，等待复核', 'followup_update', { id: liveTask.id, progress: '初稿完成，等待复核' });
    assert.equal((await repo.getTask(liveTask.id)).progress, '初稿完成，等待复核');
    await turn('暂停跟进这个任务', 'followup_update', { id: liveTask.id, pause: true });
    assert.equal((await repo.getTask(liveTask.id)).status, 'paused');
    assert.equal((await repo.getTask(liveTask.id)).nextRemindAt, null);
    await turn('恢复这个任务的跟进', 'followup_update', { id: liveTask.id, pause: false });
    assert.equal((await repo.getTask(liveTask.id)).status, 'open');
    assert.ok((await repo.getTask(liveTask.id)).nextRemindAt);
    await turn('这个跟进任务已经完成，关闭吧', 'followup_close', { id: liveTask.id, status: 'done', note: '复核通过' });
    const done = await repo.getTask(liveTask.id);
    assert.equal(done.status, 'done');
    assert.equal(done.nextRemindAt, null);
    assert.equal(done.closedBy, 'wx-alice');
    assert.deepEqual((await repo.listEvents(liveTask.id)).map(event => event.type), ['created', 'progress', 'paused', 'resumed', 'done']);
}));

test('WeChat scheduling is independent of disabled WeLink and cannot be starved by its backlog; failure retries and disable switches work', async () => inTenant(async () => {
    await wl.saveConfig({ enabled: false });
    for (let index = 0; index < 22; index++) {
        const task = await repo.createTask({ title: `WeLink backlog ${index}` }, { channel: 'welink', conversation: { kind: 'group', id: 'backlog' }, actor: 'a' });
        await db.run('UPDATE channel_followups SET next_remind_at = ? WHERE id = ?', [new Date(Date.now() - 600000).toISOString(), task.id]);
    }
    const task = await repo.createTask({ title: '微信到期跟进', assignees: [{ name: '小王' }] }, context, (await wx.getConfig()).followup.calendar);
    const due = () => db.run('UPDATE channel_followups SET next_remind_at = ? WHERE id = ?', [new Date(Date.now() - 60000).toISOString(), task.id]);
    await due();
    const calls = [];
    const push = async input => { calls.push(input); return { sent: 1 }; };
    assert.equal((await scheduler.runTenant('default', { push })).sent, 1);
    assert.equal(calls[0].channel, 'weixin');
    assert.deepEqual(calls[0].targets, [{ kind: 'user', id: 'wx-alice' }]);
    assert.match(calls[0].text, /请直接回复最新进度/);
    assert.ok(calls[0].text.includes(`**任务编号**：${task.id}`));
    assert.doesNotMatch(calls[0].text, /@小王|@我/);
    assert.equal((await scheduler.runTenant('default', { push })).sent, 0);
    await due();
    await scheduler.runTenant('default', { push: async () => ({ sent: 0, results: [{ error: 'not connected' }] }) });
    assert.equal((await repo.getTask(task.id)).remindCount, 1);
    assert.ok(Date.parse((await repo.getTask(task.id)).nextRemindAt) - Date.now() > 9 * 60000);
    await wx.saveConfig({ followup: { enabled: false } });
    await due();
    assert.equal((await scheduler.runTenant('default', { push })).checked, 0);
    await assert.rejects(scheduler.remindNow(task.id, push), /已关闭跟进提醒/);
    await wx.saveConfig({ followup: { enabled: true } });
    await repo.setStatus(task.id, 'cancelled');
    assert.equal((await scheduler.runTenant('default', { push })).sent, 0);
    assert.equal(await runWithTenant('another', () => repo.getTask(task.id)), null);
}));

test('WeChat never confirms a fake save, and unsupported models fail clearly without breaking ordinary chat', async () => {
    const base = { systemInstruction: '', messages: [], ctx: { ...context, userText: '帮我记一下并跟进设备问题' }, calendar: undefined };
    const deltas = [];
    const result = await agent.runTurn({ ...base, client: { generateText: async options => { options.onDelta?.('已记录'); return { text: '已记录任务，将自动跟进' }; } }, onDelta: delta => deltas.push(delta) });
    assert.match(result.text, /^尚未通过跟进工具/);
    assert.equal(deltas.join(''), result.text);
    const unsupported = await agent.runTurn({ ...base, client: { generateText: async () => { throw Object.assign(new Error('unsupported'), { code: 'AI_TOOLS_UNSUPPORTED' }); } } });
    assert.match(unsupported.text, /尚未保存或修改任务/);
    let count = 0;
    const ordinary = await agent.runTurn({ ...base, ctx: { ...context, userText: '你好' }, client: { generateText: async () => { if (++count === 1) throw Object.assign(new Error('unsupported'), { code: 'AI_TOOLS_UNSUPPORTED' }); return { text: '你好' }; } } });
    assert.equal(ordinary.text, '你好');
});

test('WeChat follow-up endpoints expose the correct thread and enforce admin writes and channel boundaries', async t => {
    const express = require('../backend/node_modules/express');
    const auth = require('../backend/middleware/auth');
    const sessions = require('../backend/models/auth-sessions-repository');
    const platform = require('../backend/models/platform-db');
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    app.use('/api/channels', require('../backend/routes/channels'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await platform.closeDatabase(); });
    await sessions.saveSession('wx-follow-viewer', 'reader', 'user', Date.now() + 60000, 'default');
    await sessions.saveSession('wx-follow-admin', 'admin', 'admin', Date.now() + 60000, 'default');
    const task = await inTenant(() => repo.createTask({ title: 'API 跟进' }, context));
    const base = `http://127.0.0.1:${server.address().port}/api/channels`;
    const request = (route, admin = false, patch) => fetch(base + route, { method: patch ? 'PATCH' : 'GET', headers: { Authorization: `Bearer ${admin ? 'wx-follow-admin' : 'wx-follow-viewer'}`, 'Content-Type': 'application/json' }, ...(patch ? { body: JSON.stringify(patch) } : {}) });
    const list = await (await request('/weixin/threads/user/wx-alice/followups')).json();
    assert.ok(list.items.some(item => item.id === task.id));
    assert.equal(list.canManage, false);
    assert.equal((await request(`/weixin/followups/${task.id}`, false, { action: 'done' })).status, 403);
    assert.equal((await request(`/welink/followups/${task.id}`, true, { action: 'done' })).status, 404);
    const updated = await (await request(`/weixin/followups/${task.id}`, true, { action: 'pause' })).json();
    assert.equal(updated.item.status, 'paused');
    assert.deepEqual((await (await request('/weixin/threads/user/someone-else/followups')).json()).items, []);
    assert.equal((await request('/weixin/threads/group/unsupported/followups')).status, 400);
    assert.equal((await request(`/weixin/followups/${task.id}`, true, { action: 'done' })).status, 200);
});
