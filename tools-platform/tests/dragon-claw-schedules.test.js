const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dc-schedules-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

// 替换 Dragon Claw 对话入口：记录请求，按需模拟忙碌/失败
const aiRoutePath = require.resolve('../backend/routes/ai');
const aiCalls = [];
let nextResponse = 'ok';
require.cache[aiRoutePath] = {
    id: aiRoutePath, filename: aiRoutePath, loaded: true,
    exports: {
        handleChatRequest: async (req, res) => {
            aiCalls.push({ user: req.user, body: req.body });
            if (nextResponse === 'busy') return res.status(409).json({ code: 'AI_CHAT_BUSY', error: '当前对话正在压缩上下文' });
            res.status(200);
            res.flushHeaders();
            res.write(`${JSON.stringify({ type: 'start', sessionId: req.body.sessionId || 'chat_new' })}\n`);
            if (nextResponse === 'error') res.write(`${JSON.stringify({ type: 'error', error: '模型不可用' })}\n`);
            else res.write(`${JSON.stringify({ type: 'done', sessionId: req.body.sessionId || 'chat_new', reply: '⏰ 该开会了' })}\n`);
            res.end();
        }
    }
};

const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const parser = require('../backend/models/dragon-claw-schedule-parser');
const schedules = require('../backend/models/dragon-claw-schedules');

const inTenant = fn => runWithTenant('default', fn);
const ZONE = 'Africa/Cairo';
// 2026-10-25 周日，开罗 22:40（UTC+3）
const NOW = new Date('2026-10-25T19:40:00Z');
const parse = text => parser.parse(text, { now: NOW, timezone: ZONE });

test.after(async () => {
    schedules.stop();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('解析一次性时间：相对、钟点、日期，指令为剩余文字', () => {
    const cases = [
        ['10m 提醒我开会', '2026-10-25T19:50:00.000Z', '提醒我开会'],
        ['10分钟后，提醒我开会', '2026-10-25T19:50:00.000Z', '提醒我开会'],
        ['半小时后 看下告警', '2026-10-25T20:10:00.000Z', '看下告警'],
        ['两小时后 总结', '2026-10-25T21:40:00.000Z', '总结'],
        ['in 30 minutes check alerts', '2026-10-25T20:10:00.000Z', 'check alerts'],
        ['15:30 发日报', '2026-10-26T12:30:00.000Z', '发日报'], // 今天已过，顺延到明天
        ['下午3点半 汇总', '2026-10-26T12:30:00.000Z', '汇总'],
        ['明天 9:00 汇总昨天告警', '2026-10-26T06:00:00.000Z', '汇总昨天告警'],
        ['明早9点 早报', '2026-10-26T06:00:00.000Z', '早报'],
        ['tomorrow 9am standup', '2026-10-26T06:00:00.000Z', 'standup'],
        ['2026-11-01 09:00 月报', '2026-11-01T07:00:00.000Z', '月报'],
        ['11月3日 10点 开会', '2026-11-03T08:00:00.000Z', '开会']
    ];
    for (const [text, at, instruction] of cases) {
        const result = parse(text);
        assert.equal(result.kind, 'once', text);
        assert.equal(result.runAt.toISOString(), at, text);
        assert.equal(result.instruction, instruction, text);
    }
});

test('解析周期规则：复用运营计划的 daily / weekly / interval', () => {
    assert.deepEqual(parse('每天 9:00 发日报').rule, { type: 'daily', times: ['09:00'], weekdays: [], workdaysOnly: false, intervalMinutes: null });
    assert.equal(parse('每个工作日 9:30 看告警').rule.workdaysOnly, true);
    assert.deepEqual(parse('每周一、三 10:00 周会').rule.weekdays, [1, 3]);
    assert.deepEqual(parse('每周一到五 8点 打卡').rule.weekdays, [1, 2, 3, 4, 5]);
    assert.equal(parse('每隔 2 小时 检查').rule.intervalMinutes, 120);
    assert.equal(parse('every 2h ping').rule.intervalMinutes, 120);
    assert.equal(parse('每晚 10点 总结').rule.times[0], '22:00');
    assert.equal(parse('every monday 9:00 weekly').instruction, 'weekly');
    const rule = parse('每个工作日 9:30 看告警').rule;
    // 周日是埃及工作日：开罗 22:40 之后的下一次是周一 09:30
    assert.equal(parser.nextRecurring(rule, NOW, ZONE).toISOString(), '2026-10-26T06:30:00.000Z');
    assert.equal(parser.describe({ kind: 'recurring', rule }), '每个工作日 09:30');
});

test('解析失败给出可读提示', () => {
    assert.throws(() => parse('3 个任务'), /没认出时间/);
    assert.throws(() => parse('每隔10分钟 x'), /最短间隔 30 分钟/);
    assert.throws(() => parse('20:00'), /写上要执行的指令/);
    assert.throws(() => parse('今晚8点 复盘'), /至少 1 分钟/);
    assert.throws(() => parse('2030-01-01 09:00 太远了'), /一年以内/);
});

test('创建、查看、取消只作用于自己的任务', async () => inTenant(async () => {
    const item = await schedules.create({ owner: 'alice', role: 'user', text: '30分钟后 提醒我开会', timezone: ZONE });
    assert.equal(item.kind, 'once');
    assert.equal(item.instruction, '提醒我开会');
    assert.equal(item.status, 'active');
    assert.equal(await schedules.countActive('alice'), 1);
    assert.equal((await schedules.list('bob')).length, 0);
    await assert.rejects(schedules.cancel(item.id, 'bob'), /不存在/);
    const cancelled = await schedules.cancel(item.id, 'alice');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.nextRunAt, null);
    assert.equal(await schedules.countActive('alice'), 0);
    await assert.rejects(schedules.create({ owner: 'alice', text: '提醒我', timezone: ZONE }), /没认出时间/);
}));

test('到点以创建者身份执行，写回原对话；一次性完成后结束', async () => inTenant(async () => {
    const chatId = await require('../backend/models/ai-chat-repository').getOrCreateSession({ owner: 'alice', pagePath: '/', pageTitle: 'Dragon Claw · 首页' });
    const item = await schedules.create({ owner: 'alice', role: 'admin', text: '10分钟后 提醒我开会', sessionId: chatId, timezone: ZONE, modelId: 'm1' });
    assert.equal(item.sessionId, chatId);
    const foreign = await schedules.create({ owner: 'bob', role: 'user', text: '10分钟后 偷看', sessionId: chatId, timezone: ZONE });
    assert.equal(foreign.sessionId, '', '别人的对话不绑定');
    await schedules.cancel(foreign.id, 'bob');

    aiCalls.length = 0;
    const result = await schedules.runTenant('default', { now: new Date(Date.now() + 11 * 60000) });
    assert.equal(result.ran, 1);
    assert.equal(aiCalls.length, 1);
    assert.deepEqual(aiCalls[0].user, { username: 'alice', role: 'admin' });
    assert.equal(aiCalls[0].body.sessionId, chatId);
    assert.equal(aiCalls[0].body.modelId, 'm1');
    assert.equal(aiCalls[0].body.messages[0].content, '提醒我开会');
    assert.match(aiCalls[0].body.context, /定时任务/);
    const done = await schedules.getForOwner(item.id, 'alice');
    assert.equal(done.status, 'done');
    assert.equal(done.lastStatus, 'ok');
    assert.equal(done.lastReply, '⏰ 该开会了');
    assert.equal(done.runCount, 1);
    assert.equal((await schedules.list('alice', { since: new Date(Date.now() - 60000).toISOString() })).length, 1);
    // 再跑一次不会重复执行
    aiCalls.length = 0;
    await schedules.runTenant('default', { now: new Date(Date.now() + 12 * 60000) });
    assert.equal(aiCalls.length, 0);
}));

test('周期任务推进下一次；对话忙时稍后重试，失败记录原因', async () => inTenant(async () => {
    const item = await schedules.create({ owner: 'carol', role: 'user', text: '每隔 2 小时 检查告警', timezone: ZONE });
    const firstDue = new Date(item.nextRunAt);
    nextResponse = 'busy';
    let result = await schedules.runTenant('default', { now: new Date(firstDue.getTime() + 1000) });
    assert.equal(result.ran, 0);
    let row = await schedules.getForOwner(item.id, 'carol');
    assert.equal(row.status, 'active');
    assert.equal(row.runCount, 0, '忙碌重试不计次数');
    assert.ok(new Date(row.nextRunAt).getTime() - Date.now() <= 2 * 60000 + 1000);

    nextResponse = 'ok';
    await appDb.run('UPDATE dragon_claw_schedules SET next_run_at = ? WHERE id = ?', [firstDue.toISOString(), item.id]);
    result = await schedules.runTenant('default', { now: new Date(firstDue.getTime() + 1000) });
    assert.equal(result.ran, 1);
    row = await schedules.getForOwner(item.id, 'carol');
    assert.equal(row.status, 'active');
    assert.equal(row.sessionId, 'chat_new', '首次执行新开的对话会被记住');
    assert.equal(new Date(row.nextRunAt).getTime(), firstDue.getTime() + 1000 + 120 * 60000);

    nextResponse = 'error';
    await appDb.run('UPDATE dragon_claw_schedules SET next_run_at = ? WHERE id = ?', [firstDue.toISOString(), item.id]);
    await schedules.runTenant('default', { now: new Date(firstDue.getTime() + 1000) });
    row = await schedules.getForOwner(item.id, 'carol');
    assert.equal(row.status, 'active', '周期任务单次失败后继续');
    assert.equal(row.lastStatus, 'failed');
    assert.equal(row.lastError, '模型不可用');
    nextResponse = 'ok';
}));

test('推送到 WeLink/微信：校验对象与权限，执行成功后推送并记录结果', async () => inTenant(async () => {
    const targetsRepo = require('../backend/models/channels/channel-targets-repository');
    await targetsRepo.touchTarget('welink', { kind: 'group', id: 'grp-1', displayName: '运维值班群', toolSessionId: 'ts-1' });
    await targetsRepo.touchTarget('welink', { kind: 'user', id: 'u-silent', displayName: '没聊过的人' });
    await targetsRepo.touchTarget('weixin', { kind: 'group', id: 'wx-grp', displayName: '微信群', toolSessionId: 'ts-2' });
    await targetsRepo.touchTarget('weixin', { kind: 'user', id: 'wx-u', displayName: '张三', toolSessionId: 'ts-3' });

    const base = { owner: 'dave', text: '10分钟后 汇总告警', timezone: ZONE };
    await assert.rejects(schedules.create({ ...base, role: 'admin', targets: [{ channel: 'welink', kind: 'user', id: 'u-silent' }] }), /还不能主动推送/);
    await assert.rejects(schedules.create({ ...base, role: 'admin', targets: [{ channel: 'weixin', kind: 'group', id: 'wx-grp' }] }), /不支持群推送/);
    await assert.rejects(schedules.create({ ...base, role: 'admin', targets: [{ channel: 'welink', kind: 'group', id: 'nope' }] }), /找不到/);
    await assert.rejects(schedules.create({ ...base, role: 'user', targets: [{ channel: 'welink', kind: 'group', id: 'grp-1' }] }), /仅管理员/);

    const item = await schedules.create({ ...base, role: 'admin', targets: [
        { channel: 'welink', kind: 'group', id: 'grp-1' }, { channel: 'weixin', kind: 'user', id: 'wx-u' }, { channel: 'welink', kind: 'group', id: 'grp-1' }] });
    assert.deepEqual(item.targets.map(target => `${target.channel}:${target.name}`), ['welink:运维值班群', 'weixin:张三']);

    const pushes = [];
    const push = async options => {
        pushes.push(options);
        const failed = options.channel === 'weixin';
        return { sent: failed ? 0 : 1, results: options.targets.map(target => ({ ...target, ok: !failed, error: failed ? '会话已过期' : '' })) };
    };
    nextResponse = 'ok';
    await schedules.runTenant('default', { now: new Date(Date.now() + 11 * 60000), push });
    assert.equal(pushes.length, 2, '按频道分批推送');
    assert.deepEqual(pushes[0].targets, [{ kind: 'group', id: 'grp-1' }]);
    assert.equal(pushes[0].trigger, 'scheduled');
    assert.match(pushes[0].text, /定时任务[\s\S]*汇总告警[\s\S]*该开会了/);
    const done = await schedules.getForOwner(item.id, 'dave');
    assert.equal(done.status, 'done');
    assert.equal(done.lastPush.sent, 1);
    assert.equal(done.lastPush.failed, 1);
    assert.equal(done.lastPush.results.find(entry => entry.channel === 'weixin').error, '会话已过期');

    // 执行失败时不推送
    const failing = await schedules.create({ ...base, role: 'admin', targets: [{ channel: 'welink', kind: 'group', id: 'grp-1' }] });
    pushes.length = 0;
    nextResponse = 'error';
    await schedules.runTenant('default', { now: new Date(Date.now() + 11 * 60000), push });
    assert.equal(pushes.length, 0);
    assert.equal((await schedules.getForOwner(failing.id, 'dave')).lastPush, null);
    nextResponse = 'ok';
}));
