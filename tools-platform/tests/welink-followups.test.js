const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'welink-followups-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const chat = require('../backend/models/ai-chat-repository');
const schedule = require('../backend/models/channels/followup-schedule');
const repo = require('../backend/models/channels/channel-followups-repository');
const agent = require('../backend/models/channels/followup-agent');
const scheduler = require('../backend/models/channels/followup-scheduler');
const configRepo = require('../backend/models/channels/welink-config-repository');
const targetsRepo = require('../backend/models/channels/channel-targets-repository');
const bridge = require('../backend/models/channels/dragon-claw-channel-bridge');

const inTenant = callback => runWithTenant('default', callback);
const cairo = (y, m, d, hh, mm = 0) => schedule.fromZone(y, m, d, hh * 60 + mm, 'Africa/Cairo');
const local = date => schedule.describeNow(date).replace(/（.*）$/, '');
const group = { channel: 'welink', conversation: { kind: 'group', id: 'g-poster' }, toolSessionId: 'wl_group', aiSessionId: '', actor: '00964704' };

test.after(async () => {
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('提醒时间：埃及工作日历、紧急任务可在周五周六跟进、按天间隔落在工作日上午', () => {
    const thursdayEvening = cairo(2026, 10, 22, 17, 30);
    assert.equal(local(schedule.nextReminder({ urgency: 'urgent' }, thursdayEvening)), '2026-10-22 周四 19:30', '紧急：2 小时后，仍在 21:00 前');
    assert.equal(local(schedule.nextReminder({ urgency: 'urgent', allowOffHours: false }, thursdayEvening)), '2026-10-25 周日 09:00', '关闭非工作日后顺延到周日上班');
    assert.equal(local(schedule.nextReminder({ urgency: 'high' }, thursdayEvening)), '2026-10-25 周日 10:00', '高：下一个工作日上午');
    assert.equal(local(schedule.nextReminder({ urgency: 'normal' }, thursdayEvening)), '2026-10-26 周一 10:00');
    assert.equal(local(schedule.nextReminder({ urgency: 'low' }, thursdayEvening)), '2026-10-29 周四 10:00');
    assert.equal(local(schedule.nextReminder({ scheduleMode: 'interval', intervalMinutes: 180 }, thursdayEvening)), '2026-10-25 周日 09:00', '小时间隔落在下班后，顺延到下一个工作日开始');
    assert.equal(local(schedule.nextReminder({ urgency: 'urgent' }, cairo(2026, 10, 23, 23))), '2026-10-24 周六 09:00', '紧急任务深夜不打扰，次日 9 点');
    const random = schedule.nextReminder({ scheduleMode: 'random', randomMinMinutes: 60, randomMaxMinutes: 120 }, cairo(2026, 10, 20, 10), undefined, () => 0.5);
    assert.equal(local(random), '2026-10-20 周二 11:30');
    // 冬令时（UTC+2）与夏令时（UTC+3）都按开罗本地时间计算
    assert.equal(cairo(2026, 1, 15, 10).toISOString(), '2026-01-15T08:00:00.000Z');
    assert.equal(cairo(2026, 7, 15, 10).toISOString(), '2026-07-15T07:00:00.000Z');
});

test('跟进任务：创建、进度、关闭，只能在所属会话内操作，并记录完整流水', async () => {
    await inTenant(async () => {
        const created = await agent.execute({ ...group, userText: '@助手 帮我记一下这个遗留任务' }, 'followup_create', {
            title: '修改“上报事故”海报',
            detail: '讨论要点：CSM/AMS 后是否加 Stakeholders；上报路径调整',
            assignees: [{ name: '刘一然', account: '00964704' }, { name: '@许凯丰', account: '00979866' }, { name: '刘一然', account: '00964704' }],
            urgency: 'high'
        });
        assert.equal(created.isError, undefined);
        assert.equal(created.event.action, 'created');
        const task = await repo.getTask(created.event.id);
        assert.deepEqual(task.assignees, [{ name: '刘一然', account: '00964704' }, { name: '许凯丰', account: '00979866' }], '去重并去掉 @');
        assert.equal(task.stage, 'start');
        assert.equal(task.sourceText, '@助手 帮我记一下这个遗留任务');
        assert.ok(new Date(task.nextRemindAt) > new Date());

        const duplicate = await agent.execute(group, 'followup_create', { title: '修改“上报事故”海报' });
        assert.equal(duplicate.event.action, 'exists', '同名进行中任务不重复创建');

        const other = { ...group, conversation: { kind: 'group', id: 'g-other' } };
        const denied = await agent.execute(other, 'followup_close', { id: task.id });
        assert.equal(denied.isError, true, '其他群不能操作本群任务');

        const progress = await agent.execute({ ...group, actor: '00979866' }, 'followup_update', { id: task.id, progress: '海报初稿已改，等确认路径' });
        assert.equal(progress.event.action, 'progress');
        assert.equal((await repo.getTask(task.id)).stage, 'active');

        const closed = await agent.execute({ ...group, actor: '00979866' }, 'followup_close', { id: task.id, note: '已按第二版路径更新' });
        assert.equal(closed.event.action, 'done');
        const done = await repo.getTask(task.id);
        assert.equal(done.status, 'done');
        assert.equal(done.stage, 'end');
        assert.equal(done.closedBy, '00979866', '被提醒人也可以关闭');
        assert.equal(done.nextRemindAt, null);
        const events = await repo.listEvents(task.id);
        assert.deepEqual(events.map(event => event.type), ['created', 'progress', 'done']);

        const prompt = await agent.buildPrompt(group, schedule.DEFAULT_CALENDAR);
        assert.match(prompt, /最近关闭的任务/);
        assert.match(prompt, /修改“上报事故”海报/);

        const reopened = await repo.setStatus(task.id, 'open', { actor: 'platform:admin' });
        assert.equal(reopened.status, 'open');
        assert.ok(reopened.nextRemindAt);
        assert.equal((await repo.listEvents(task.id)).at(-1).type, 'reopened');
    });
});

test('提醒调度：到期任务在原群 @ 提醒人，只发一次；失败 10 分钟后重试；达到上限自动暂停', async () => {
    await inTenant(async () => {
        await configRepo.saveConfig({ enabled: true });
        const task = await repo.createTask({ title: '确认值班表', assignees: [{ name: '刘一然' }], urgency: 'urgent', maxReminders: 2, nextRemindNote: '问一下是否已发群公告' },
            { channel: 'welink', conversation: { kind: 'group', id: 'g-duty' }, actor: 'creator' });
        const { run } = appDb;
        await run('UPDATE channel_followups SET next_remind_at = ? WHERE id = ?', [new Date(Date.now() - 60000).toISOString(), task.id]);
        const pushes = [];
        const push = async options => { pushes.push(options); return { sent: 1, results: [{ ok: true }] }; };

        const first = await scheduler.runTenant('default', { push });
        assert.equal(first.sent, 1);
        assert.equal(pushes.length, 1);
        assert.deepEqual(pushes[0].targets, [{ kind: 'group', id: 'g-duty' }]);
        assert.match(pushes[0].text, /@刘一然/);
        assert.match(pushes[0].text, /问一下是否已发群公告/);
        assert.match(pushes[0].text, /第 1 次提醒/);
        const afterFirst = await repo.getTask(task.id);
        assert.equal(afterFirst.remindCount, 1);
        assert.ok(new Date(afterFirst.nextRemindAt) > new Date(), '已推进到下一次');
        assert.equal((await scheduler.runTenant('default', { push })).sent, 0, '未到期不重复发送');

        await run('UPDATE channel_followups SET next_remind_at = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), task.id]);
        const failing = async () => ({ sent: 0, results: [{ ok: false, error: 'WeLink 助理未连接' }] });
        await scheduler.runTenant('default', { push: failing });
        const afterFail = await repo.getTask(task.id);
        assert.equal(afterFail.remindCount, 1, '失败不计数');
        const retryIn = new Date(afterFail.nextRemindAt) - Date.now();
        assert.ok(retryIn > 9 * 60000 && retryIn <= 10 * 60000, '10 分钟后重试');
        assert.equal((await repo.listEvents(task.id)).at(-1).type, 'remind_failed');

        await run('UPDATE channel_followups SET next_remind_at = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), task.id]);
        await scheduler.runTenant('default', { push });
        const limited = await repo.getTask(task.id);
        assert.equal(limited.remindCount, 2);
        assert.equal(limited.status, 'paused', '达到 2 次上限自动暂停');
        assert.equal((await repo.listEvents(task.id)).at(-1).type, 'limit');

        await configRepo.saveConfig({ followup: { enabled: false } });
        await repo.setStatus(task.id, 'open');
        await run('UPDATE channel_followups SET next_remind_at = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), task.id]);
        assert.equal((await scheduler.runTenant('default', { push })).checked, 0, '关闭跟进功能后不发送');
        await configRepo.saveConfig({ followup: { enabled: true } });
    });
});

test('对话时间线：同一群的多段对话合并，段落标注新的上下文，发言人随消息保存', async () => {
    await inTenant(async () => {
        const first = await chat.addMessage({ owner: 'welink-group:g-merge', pagePath: '/channels/welink', role: 'user', content: '第一段问题', events: [{ type: 'channel', sender: 'alice' }] });
        await chat.addMessage({ sessionId: first, owner: 'welink-group:g-merge', pagePath: '/channels/welink', role: 'model', content: '第一段回答', events: [{ type: 'followup', action: 'created', id: 'fu_x', title: '任务 X' }] });
        await repo.addSegment('welink', { kind: 'group', id: 'g-merge', toolSessionId: 'wl1', aiSessionId: first });
        await new Promise(resolve => setTimeout(resolve, 1100)); // SQLite CURRENT_TIMESTAMP 精度为秒
        const second = await chat.addMessage({ owner: 'welink-group:g-merge', pagePath: '/channels/welink', role: 'user', content: '/new 之后的问题', events: [{ type: 'channel', sender: 'bob' }] });
        assert.equal(await repo.addSegment('welink', { kind: 'group', id: 'g-merge', toolSessionId: 'wl1', aiSessionId: second }), true);
        assert.equal(await repo.addSegment('welink', { kind: 'group', id: 'g-merge', toolSessionId: 'wl1', aiSessionId: second }), false, '同一对话只记一段');
        await targetsRepo.touchTarget('welink', { kind: 'group', id: 'g-merge', displayName: '埃及 CS 工具群', toolSessionId: 'wl1' });

        const page = await repo.listThreadMessages('welink', 'group', 'g-merge', { limit: 2 });
        assert.deepEqual(page.segments.map(item => item.reason), ['first', 'new-context']);
        assert.equal(page.total, 3);
        assert.equal(page.hasMore, true);
        assert.deepEqual(page.items.map(item => item.content), ['第一段回答', '/new 之后的问题']);
        assert.equal(page.items[1].sender, 'bob');
        assert.deepEqual(page.items[0].followups, [{ action: 'created', id: 'fu_x', title: '任务 X' }]);
        const older = await repo.listThreadMessages('welink', 'group', 'g-merge', { limit: 2, before: page.items[0].id });
        assert.deepEqual(older.items.map(item => [item.content, item.sender]), [['第一段问题', 'alice']]);

        const threads = await repo.listThreads('welink');
        const thread = threads.find(item => item.id === 'g-merge');
        assert.equal(thread.name, '埃及 CS 工具群');
        assert.equal(thread.segmentCount, 2);
        assert.equal(thread.messageCount, 3);
        assert.equal((await repo.listThreads('welink', { q: '工具群' })).length, 1);
        await assert.rejects(repo.listThreadMessages('welink', 'group', 'g-merge', { before: 'msg_not_here' }), /游标/);
    });
});

test('真实对话链路：WeLink 群聊调用 followup_create 持久化任务，群里不同发言人共用同一群对话', async t => {
    const originalSettings = settings.getRuntimeSettings;
    const originalSecrets = settings.getRedactionSecrets;
    const originalClient = provider.createClient;
    const requests = [];
    let step = 0;
    settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, model: 'fake', maxOutputTokens: 1024, temperature: 0.2, inputCostPerMillionUsd: 0, outputCostPerMillionUsd: 0, usdToCny: 7 });
    settings.getRedactionSecrets = async () => [];
    provider.createClient = () => ({
        model: 'fake',
        async generateText(options) {
            requests.push(options);
            step += 1;
            if (step === 1) {
                assert.ok(options.tools.some(tool => tool.name === 'followup_create'), '频道对话带跟进工具');
                assert.match(options.systemInstruction, /跟进任务（本会话的持久记忆）/);
                return { text: '', toolCalls: [{ id: 'call_1', name: 'followup_create', args: { title: '修改“上报事故”海报', assignees: [{ name: '刘一然', account: '00964704' }], urgency: 'high', nextRemindNote: '确认最终路径' } }], usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15 } };
            }
            const reply = step === 2 ? '已记录 ✅ 任务：修改“上报事故”海报' : '收到';
            options.onDelta?.(reply);
            return { text: reply, toolCalls: [], usage: { promptTokens: 12, outputTokens: 6, totalTokens: 18 } };
        },
        async generateChat(options) { return this.generateText(options); }
    });
    t.after(() => {
        settings.getRuntimeSettings = originalSettings;
        settings.getRedactionSecrets = originalSecrets;
        provider.createClient = originalClient;
    });
    const conversation = { kind: 'group', id: 'g-live' };
    const events = [];
    await inTenant(() => bridge.runTurn({ channel: 'welink', account: '00964704', conversation, toolSessionId: 'wl_live', text: '@助手 帮我记一下这个遗留任务 后边帮我跟进', onEvent: event => events.push(event) }));
    const done = events.find(event => event.type === 'done');
    assert.ok(done, JSON.stringify(events.filter(event => event.type === 'error' || event.type === 'http-json')));
    assert.match(done.reply, /已记录/);
    assert.ok(events.some(event => event.type === 'followup' && event.action === 'created'));
    const tasks = await inTenant(() => repo.listTasks('welink', { kind: 'group', id: 'g-live' }));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].creator, '00964704');
    assert.equal(tasks[0].aiSessionId, done.sessionId, '任务关联到产生它的平台对话');
    assert.equal(tasks[0].nextRemindNote, '确认最终路径');

    // 第二个人在同一群里继续：同一个群对话，不会因为归属不同被拒绝
    const second = [];
    await inTenant(() => bridge.runTurn({ channel: 'welink', account: '00979866', conversation, toolSessionId: 'wl_live', aiSessionId: done.sessionId, text: '海报改好了吗', onEvent: event => second.push(event) }));
    const secondDone = second.find(event => event.type === 'done');
    assert.ok(secondDone, JSON.stringify(second));
    assert.equal(secondDone.sessionId, done.sessionId);
    assert.match(requests.at(-1).systemInstruction, /\[fu_[a-z0-9]+\] 修改“上报事故”海报｜跟进中/, '后续轮次能看到本群已有任务');

    // 升级前归属第一个发言人的群对话：换成按群归属后开启新段落
    const legacy = await inTenant(() => chat.addMessage({ owner: 'welink:00964704', pagePath: '/channels/welink', role: 'user', content: '旧对话' }));
    const third = [];
    await inTenant(() => bridge.runTurn({ channel: 'welink', account: '00979866', conversation: { kind: 'group', id: 'g-legacy' }, toolSessionId: 'wl_old', aiSessionId: legacy, text: '继续', onEvent: event => third.push(event) }));
    const thirdDone = third.find(event => event.type === 'done');
    assert.ok(thirdDone && thirdDone.sessionId !== legacy);

    const page = await inTenant(() => chat.listMessages(done.sessionId));
    assert.deepEqual(page.filter(item => item.role === 'user').map(item => item.events[0]?.sender), ['00964704', '00979866'], '用户消息记录发言人');
    assert.ok(page.find(item => item.role === 'model').events.some(event => event.type === 'followup'));
});

test('接口权限：所有登录用户可查看 WeLink 对话与任务，修改任务需要管理员', async t => {
    const express = require('../backend/node_modules/express');
    const vm = require('node:vm');
    const auth = require('../backend/middleware/auth');
    const { tenantMiddleware } = require('../backend/models/tenant-context');
    const authSessions = require('../backend/models/auth-sessions-repository');
    const platformDb = require('../backend/models/platform-db');
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
    const end = serverSource.indexOf('\n});', begin) + 4;
    vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
    app.use('/api/channels', require('../backend/routes/channels'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await platformDb.closeDatabase();
    });
    await authSessions.saveSession('synthetic-viewer', 'viewer1', 'viewer', Date.now() + 60000, 'default');
    await authSessions.saveSession('synthetic-admin', 'admin1', 'admin', Date.now() + 60000, 'default');
    const task = await inTenant(() => repo.createTask({ title: '接口权限任务' }, { channel: 'welink', conversation: { kind: 'group', id: 'g-api' }, actor: 'x' }));
    const base = `http://127.0.0.1:${server.address().port}/api/channels/welink`;
    const as = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

    const threads = await (await fetch(`${base}/threads`, { headers: as('synthetic-viewer') })).json();
    assert.ok(threads.items.some(item => item.id === 'g-api' && item.tasks.open === 1));
    const tasks = await (await fetch(`${base}/threads/group/g-api/followups`, { headers: as('synthetic-viewer') })).json();
    assert.equal(tasks.items[0].title, '接口权限任务');
    assert.equal(tasks.items[0].events[0].type, 'created');
    assert.equal(tasks.canManage, false);
    assert.equal((await fetch(`${base}/threads/room/g-api/messages`, { headers: as('synthetic-viewer') })).status, 400);

    const viewerPatch = await fetch(`${base}/followups/${task.id}`, { method: 'PATCH', headers: as('synthetic-viewer'), body: JSON.stringify({ action: 'done' }) });
    assert.equal(viewerPatch.status, 403);
    const adminPatch = await (await fetch(`${base}/followups/${task.id}`, { method: 'PATCH', headers: as('synthetic-admin'), body: JSON.stringify({ action: 'done', note: '平台关闭' }) })).json();
    assert.equal(adminPatch.item.status, 'done');
    assert.equal(adminPatch.item.closedBy, 'platform:admin1');
    assert.equal(adminPatch.item.events.at(-1).note, '平台关闭');
    const bad = await fetch(`${base}/followups/${task.id}`, { method: 'PATCH', headers: as('synthetic-admin'), body: JSON.stringify({ action: 'explode' }) });
    assert.equal(bad.status, 400);
});

test('夏令时与相对时长：支持 inMinutes 避免时区计算偏差，正确识别开罗夏令时（UTC+3）与冬令时（UTC+2）', async () => {
    assert.equal(schedule.getZoneOffset(new Date('2026-10-21T12:00:00Z'), 'Africa/Cairo'), 'UTC+03:00');
    assert.equal(schedule.getZoneOffset(new Date('2026-01-15T12:00:00Z'), 'Africa/Cairo'), 'UTC+02:00');
    assert.match(schedule.describeNow(new Date('2026-10-21T12:47:00Z'), schedule.DEFAULT_CALENDAR), /Africa\/Cairo，UTC\+03:00/);
    assert.equal(schedule.formatZoneIso(new Date('2026-10-21T12:47:00Z'), 'Africa/Cairo'), '2026-10-21T15:47:00+03:00');

    await inTenant(async () => {
        const start = Date.now();
        const created = await agent.execute({ ...group, userText: '2分钟后提醒喝水' }, 'followup_create', {
            title: '提醒喝水（相对分钟测试）',
            inMinutes: 2
        });
        assert.equal(created.isError, undefined);
        const task = await repo.getTask(created.event.id);
        const diffMs = new Date(task.nextRemindAt).getTime() - start;
        assert.ok(diffMs >= 115000 && diffMs <= 125000, `nextRemindAt 应在当前时间约 2 分钟后，实际差距 ${diffMs}ms`);
    });
});
