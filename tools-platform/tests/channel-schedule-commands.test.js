const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-schedule-command-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const aiPath = require.resolve('../backend/routes/ai');
const aiCalls = [];
require.cache[aiPath] = { id: aiPath, filename: aiPath, loaded: true, exports: { handleChatRequest: async (req, res) => {
    aiCalls.push(req);
    res.write(`${JSON.stringify({ type: 'done', reply: '分析结果', sessionId: req.body.sessionId })}\n`);
    res.end();
} } };
const { runWithTenant } = require('../backend/models/tenant-context');
const db = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const schedules = require('../backend/models/dragon-claw-schedules');
const commands = require('../backend/models/channels/channel-schedule-commands');
const bridge = require('../backend/models/channels/dragon-claw-channel-bridge');
const targets = require('../backend/models/channels/channel-targets-repository');
const wx = require('../backend/models/channels/weixin-config-repository');
const wl = require('../backend/models/channels/welink-config-repository');
const chat = require('../backend/models/ai-chat-repository');
const inTenant = callback => runWithTenant('default', callback);
const wechat = { channel: 'weixin', account: 'wx-user', conversation: { kind: 'user', id: 'wx-user' }, toolSessionId: 'wx-session' };
const welink = { channel: 'welink', account: 'actor-a', conversation: { kind: 'group', id: 'ops-group' }, toolSessionId: 'wl-session' };
async function turn(ctx, text) {
    const events = [];
    await bridge.runTurn({ ...ctx, text, onEvent: event => events.push(event) });
    return { events, done: events.find(event => event.type === 'done'), created: events.find(event => event.type === 'schedule' && event.action === 'created') };
}
test.after(async () => {
    await db.closeDatabase();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('natural reminder intent recognizes clear times, keeps follow-ups and explanatory requests separate', () => {
    for (const text of ['一分钟后提醒我睡觉', '提醒我一分钟后睡觉', '请帮我明天9点提醒我开会', '每天9点提醒我喝水', '/schedule 10分钟后 汇总告警', '30秒后提醒我', '明天提醒我']) assert.equal(commands.intent(text).action, 'create', text);
    for (const text of ['解释一分钟后提醒我的实现', '帮我跟进这个问题，两分钟后提醒相关人', '一分钟后天气会怎样', '你好', '昨天9点提醒我睡觉的消息在哪里']) assert.equal(commands.intent(text), null, text);
    assert.equal(commands.intent('定时任务有哪些').action, 'list');
    assert.equal(commands.intent('有哪些定时任务').action, 'list');
    assert.equal(commands.intent('取消定时任务 dcs_test').action, 'cancel');
    assert.deepEqual(commands.intent('取消刚才的提醒'), { action: 'cancel', id: '' });
    assert.equal(commands.intent('> 引用：一分钟后提醒我睡觉\n解释这条消息'), null);
    assert.equal(commands.intent('> 引用：旧消息\n一分钟后提醒我睡觉').action, 'create');
});

test('WeLink invocation mentions are separate from the schedule, while reminder recipients and normal chat stay intact', () => {
    for (const prefix of ['@埃及CS工具平台 ', '@埃及CS工具平台\u00a0', '@助手 @工具平台 ']) {
        const command = commands.intent(`${prefix}1分钟后提醒 @Zhangting @李娴 早上好`, { channel: 'welink' });
        assert.deepEqual(command, { action: 'create', text: '1分钟后提醒 @Zhangting @李娴 早上好' });
    }
    assert.deepEqual(commands.intent('@助手 一分钟后提醒 @Zhangting @李娴 早上好', { channel: 'welink' }), { action: 'create', text: '一分钟后提醒 @Zhangting @李娴 早上好' });
    assert.deepEqual(commands.intent('@助手 /schedule 明天9:00 提醒 @小王 开会', { channel: 'welink' }), { action: 'create', text: '明天9:00 提醒 @小王 开会' });
    assert.equal(commands.intent('@助手 定时任务', { channel: 'welink' }).action, 'list');
    assert.deepEqual(commands.intent('@助手 取消定时任务 dcs_test', { channel: 'welink' }), { action: 'cancel', id: 'dcs_test' });
    assert.equal(commands.intent('@助手 帮我跟进这个问题，两分钟后提醒 @小王', { channel: 'welink' }), null);
    assert.equal(commands.intent('@助手 解释一分钟后提醒我的实现', { channel: 'welink' }), null);
    assert.equal(commands.intent('@助手 你好 @小王', { channel: 'welink' }), null);
    assert.equal(commands.intent('> @助手 一分钟后提醒 @小王 开会\n解释这条消息', { channel: 'welink' }), null);
    assert.equal(commands.intent('@联系人 1分钟后提醒我休息', { channel: 'weixin' }).text, '@联系人 1分钟后提醒我休息', 'WeChat text is not normalized as a WeLink invocation');
});

test('legacy schedules migrate repeatably without changing existing rows', async () => inTenant(async () => {
    await db.run(`CREATE TABLE dragon_claw_schedules (
        id TEXT PRIMARY KEY, owner TEXT, role TEXT DEFAULT 'user', instruction TEXT, kind TEXT, rule_json TEXT,
        timezone TEXT, session_id TEXT, model_id TEXT, status TEXT DEFAULT 'active', next_run_at TEXT,
        last_run_at TEXT, last_status TEXT, last_error TEXT, last_reply TEXT, run_count INTEGER DEFAULT 0,
        created_at TEXT, updated_at TEXT)`);
    await db.run("INSERT INTO dragon_claw_schedules (id, owner, instruction, kind) VALUES ('legacy', 'web-user', '旧任务', 'once')");
    await schedules.ensureSchema();
    await schedules.ensureSchema();
    const legacy = await db.get("SELECT * FROM dragon_claw_schedules WHERE id = 'legacy'");
    assert.equal(legacy.instruction, '旧任务');
    for (const key of ['origin_channel', 'origin_kind', 'origin_id', 'origin_actor']) assert.equal(legacy[key], null);
}));

test('WeChat creates a real one-minute task and sends a literal reminder once to the original conversation without AI or platform push grants', async () => inTenant(async () => {
    await wx.saveConfig({ enabled: true, push: { allowUserPush: false, defaultTargets: [] } });
    await targets.touchTarget('weixin', { kind: 'user', id: 'wx-user', toolSessionId: 'wx-session' });
    const before = Date.now();
    const result = await turn(wechat, '一分钟后提醒我睡觉');
    assert.ok(result.created);
    assert.match(result.done.reply, /已创建定时任务/);
    assert.match(result.done.reply, new RegExp(result.created.id));
    assert.equal(aiCalls.length, 0, 'clear reminders are handled before any model request');
    const row = await db.get('SELECT * FROM dragon_claw_schedules WHERE id = ?', [result.created.id]);
    assert.ok(Date.parse(row.next_run_at) >= before + 59000 && Date.parse(row.next_run_at) < Date.now() + 61000);
    assert.equal(row.owner, 'weixin:wx-user');
    assert.equal(row.role, 'user');
    assert.equal(row.origin_actor, 'wx-user');
    assert.deepEqual(JSON.parse(row.targets_json).map(({ channel, kind, id }) => ({ channel, kind, id })), [{ channel: 'weixin', kind: 'user', id: 'wx-user' }]);
    const history = await chat.listMessages(result.done.sessionId);
    assert.equal(history.length, 2);
    assert.equal(history[1].events[0].id, row.id);
    const sent = [];
    const push = async input => { sent.push(input); return { sent: 1, results: [{ kind: 'user', id: 'wx-user', ok: true }] }; };
    await schedules.execute(row, new Date(row.next_run_at), { push });
    await schedules.execute(row, new Date(row.next_run_at), { push });
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /提醒：睡觉/);
    assert.doesNotMatch(sent[0].text, /已设置|已创建/);
    assert.equal(aiCalls.length, 0);
    assert.deepEqual(sent[0].targets, [{ kind: 'user', id: 'wx-user' }]);
    assert.equal((await schedules.getForOwner(row.id, row.owner)).status, 'done');
}));

test('WeLink recurring tasks, listing and cancellation stay in the original group', async () => inTenant(async () => {
    await wl.saveConfig({ enabled: true });
    await targets.touchTarget('welink', { kind: 'group', id: 'ops-group', toolSessionId: 'wl-session' });
    const result = await turn(welink, '每天9点提醒我检查告警');
    assert.ok(result.created);
    const row = await db.get('SELECT * FROM dragon_claw_schedules WHERE id = ?', [result.created.id]);
    assert.equal(row.kind, 'recurring');
    assert.equal(row.owner, 'welink-group:ops-group');
    assert.equal(row.origin_kind, 'group');
    const list = await turn(welink, '定时任务有哪些');
    assert.match(list.done.reply, new RegExp(row.id));
    assert.doesNotMatch(list.done.reply, /提醒我睡觉/);
    const missingId = await turn(welink, '取消刚才的提醒');
    assert.match(missingId.done.reply, /^未取消/);
    assert.equal((await schedules.getForOwner(row.id, row.owner)).status, 'active');
    const foreign = await turn(wechat, `取消定时任务 ${row.id}`);
    assert.match(foreign.done.reply, /未取消/);
    assert.equal((await schedules.getForOwner(row.id, row.owner)).status, 'active');
    const cancelled = await turn(welink, `取消定时任务 ${row.id}`);
    assert.match(cancelled.done.reply, /^已取消/);
    assert.equal((await schedules.getForOwner(row.id, row.owner)).status, 'cancelled');
}));

test('WeLink group @assistant one-minute requests persist and deliver the original mentioned reminder without AI', async () => inTenant(async () => {
    await wl.saveConfig({ enabled: true });
    await targets.touchTarget('welink', { kind: 'group', id: 'ops-group', toolSessionId: 'wl-session' });
    const before = Date.now();
    const aiBefore = aiCalls.length;
    const text = '@埃及CS工具平台 一分钟后提醒 @Zhangting @李娴 早上好';
    const result = await turn(welink, text);
    assert.ok(result.created, result.done?.reply);
    const row = await db.get('SELECT * FROM dragon_claw_schedules WHERE id = ?', [result.created.id]);
    assert.equal(row.instruction, '提醒 @Zhangting @李娴 早上好');
    assert.ok(Date.parse(row.next_run_at) >= before + 59000 && Date.parse(row.next_run_at) < Date.now() + 61000);
    assert.equal((await chat.listMessages(result.done.sessionId)).find(message => message.role === 'user').content, text, 'history retains the original request');
    const sent = [];
    await schedules.execute(row, new Date(row.next_run_at), { push: async input => { sent.push(input); return { sent: 1 }; } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channel, 'welink');
    assert.deepEqual(sent[0].targets, [{ kind: 'group', id: 'ops-group' }]);
    assert.match(sent[0].text, /提醒：@Zhangting @李娴 早上好/);
    assert.doesNotMatch(sent[0].text, /@埃及CS工具平台/);
    assert.equal(aiCalls.length, aiBefore);
}));

test('invalid times and disabled or blocked channels never acknowledge a saved task', async () => inTenant(async () => {
    for (const text of ['明天提醒我', '30秒后提醒我']) {
        const result = await turn(wechat, text);
        assert.equal(result.created, undefined);
        assert.match(result.done.reply, /^未创建/);
    }
    await wx.saveConfig({ enabled: false });
    assert.match((await turn(wechat, '一分钟后提醒我喝水')).done.reply, /^未创建/);
    await wx.saveConfig({ enabled: true, access: { users: { mode: 'blacklist', blacklist: ['wx-user'] } } });
    assert.match((await turn(wechat, '一分钟后提醒我喝水')).done.reply, /^未创建/);
    await wx.saveConfig({ access: { users: { mode: 'all' } } });
}));

test('delivery rechecks permissions, cannot be redirected, and channel tasks remain tenant-isolated', async () => inTenant(async () => {
    const result = await turn(wechat, '一分钟后提醒我喝水');
    const row = await db.get('SELECT * FROM dragon_claw_schedules WHERE id = ?', [result.created.id]);
    await wx.saveConfig({ access: { users: { mode: 'blacklist', blacklist: ['wx-user'] } } });
    let calls = 0;
    await schedules.execute(row, new Date(row.next_run_at), { push: async () => { calls++; return { sent: 1 }; } });
    assert.equal(calls, 0);
    const item = await schedules.getForOwner(row.id, row.owner);
    assert.equal(item.lastPush.failed, 1);
    await wx.saveConfig({ access: { users: { mode: 'all' } } });
    const another = await turn(wechat, '一分钟后提醒我开会');
    const altered = await db.get('SELECT * FROM dragon_claw_schedules WHERE id = ?', [another.created.id]);
    altered.targets_json = JSON.stringify([{ channel: 'weixin', kind: 'user', id: 'someone-else' }]);
    await schedules.execute(altered, new Date(altered.next_run_at), { push: async () => { calls++; return { sent: 1 }; } });
    assert.equal(calls, 0, 'channel origin never authorizes a different recipient');
    assert.equal(await runWithTenant('another-tenant', () => schedules.getForOwner(row.id, row.owner)), null);
}));

test('ordinary channel messages still use Dragon Claw and carry an explicit no-fake-confirmation rule', async () => inTenant(async () => {
    const count = aiCalls.length;
    await turn(wechat, '你好，解释一下提醒功能');
    assert.equal(aiCalls.length, count + 1);
    assert.match(aiCalls.at(-1).body.context, /不得声称已设置/);
}));

test('a chat-history failure does not misreport an already persisted reminder', async () => inTenant(async () => {
    const original = chat.addMessage;
    chat.addMessage = async () => { throw new Error('history unavailable'); };
    try {
        const result = await turn(wechat, '一分钟后提醒我休息');
        assert.ok(result.created);
        assert.match(result.done.reply, /^✅ 已创建/);
        assert.ok(await schedules.getForOwner(result.created.id, 'weixin:wx-user'));
    } finally { chat.addMessage = original; }
}));
