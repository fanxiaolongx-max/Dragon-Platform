const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ops-groups-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
process.env.TOOLS_MEDIA_DIR = path.join(sandbox, 'videos');
fs.mkdirSync(path.join(process.env.TOOLS_MEDIA_DIR, '平台技巧'), { recursive: true });
fs.writeFileSync(path.join(process.env.TOOLS_MEDIA_DIR, '平台技巧', '一键报表.mp4'), 'x');
fs.writeFileSync(path.join(process.env.TOOLS_MEDIA_DIR, '平台技巧', '快速检索.mp4'), 'y');
fs.utimesSync(path.join(process.env.TOOLS_MEDIA_DIR, '平台技巧', '一键报表.mp4'), new Date('2026-10-01'), new Date('2026-10-01'));

// 替换 Dragon Claw 对话入口：记录上下文，返回固定正文
const aiRoutePath = require.resolve('../backend/routes/ai');
const aiCalls = [];
require.cache[aiRoutePath] = {
    id: aiRoutePath, filename: aiRoutePath, loaded: true,
    exports: {
        handleChatRequest: async (req, res) => {
            aiCalls.push(req.body);
            res.status(200);
            res.flushHeaders();
            res.write(`${JSON.stringify({ type: 'done', reply: '☀️ 早上好！今天介绍一个小技巧。' })}\n`);
            res.end();
        }
    }
};

const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const opsSchedule = require('../backend/models/channels/ops-schedule');
const opsRepo = require('../backend/models/channels/ops-repository');
const opsService = require('../backend/models/channels/ops-service');
const opsAgent = require('../backend/models/channels/ops-agent');
const channels = require('../backend/models/channels');
const targetsRepo = require('../backend/models/channels/channel-targets-repository');
const { WeLinkProvider } = require('../backend/models/channels/welink-provider');

const pushes = [];
channels.push = async ({ channel, text, targets }) => {
    pushes.push({ channel, text, targets });
    const failed = targets[0].id === 'bad-group';
    return { ok: !failed, sent: failed ? 0 : 1, failed: failed ? 1 : 0, results: [{ ...targets[0], name: targets[0].id, ok: !failed, error: failed ? '无会话' : '' }] };
};

const inTenant = fn => runWithTenant('default', fn);
const GROUP = { channel: 'welink', kind: 'group', id: 'grp-ops' };

test.after(async () => {
    opsService.stop();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('定时规则：工作日、每周、间隔，按开罗时间计算', () => {
    // 2026-10-22 是周四，开罗 20:00 之后的下一个工作日 09:30 是周日 10-25
    const from = new Date('2026-10-22T17:00:00Z');
    const daily = opsSchedule.nextRun({ type: 'daily', times: ['09:30'], workdaysOnly: true }, from);
    assert.equal(daily.toISOString(), '2026-10-25T06:30:00.000Z');
    const everyDay = opsSchedule.nextRun({ type: 'daily', times: ['09:30'], workdaysOnly: false }, from);
    assert.equal(everyDay.toISOString(), '2026-10-23T06:30:00.000Z');
    const weekly = opsSchedule.nextRun({ type: 'weekly', weekdays: [1], times: ['18:00', '08:00'] }, from);
    assert.equal(weekly.toISOString(), '2026-10-26T05:00:00.000Z');
    assert.equal(opsSchedule.describe({ type: 'weekly', weekdays: [1, 3], times: ['08:00'] }), '每周一、周三 08:00');
    assert.equal(opsSchedule.normalize({ type: 'interval', intervalMinutes: 5 }).intervalMinutes, 30);
});

test('运营群组与计划：校验必填、微信不能推群、保存后算出下次运行时间', async () => {
    await inTenant(async () => {
        const group = await opsRepo.saveGroup({ ...GROUP, name: '运营一群', profile: '一线运维，关注 HC 指标', interactionPrompt: '每天出一道小问答' });
        assert.equal(group.name, '运营一群');
        await assert.rejects(opsRepo.saveGroup({ channel: 'weixin', kind: 'group', id: 'g' }), /不支持群推送/);
        await assert.rejects(opsService.savePlan({ name: '空计划', targets: [] }), /推送对象/);
        await assert.rejects(opsService.savePlan({ name: 'AI', targets: [GROUP], contentMode: 'ai', prompt: '' }), /提示词/);
        const plan = await opsService.savePlan({ name: '每日视频', targets: [GROUP], contentMode: 'template', template: '{{date}} {{weekday}} 给{{group}}：{{video_title}} {{video_link}}', sources: ['videos'], options: { videoCategory: '平台技巧' }, schedule: { type: 'daily', times: ['09:30'] }, enabled: true }, 'admin');
        assert.ok(plan.nextRunAt);
        const paused = await opsService.savePlan({ name: '默认不启用', targets: [GROUP], contentMode: 'template', template: 'x' });
        assert.equal(paused.enabled, false);
        assert.equal(paused.nextRunAt, null);
        assert.equal(plan.sendMode, 'draft');
        assert.equal(plan.scheduleText, '每个工作日 09:30');
    });
});

test('模板生成 → 草稿 → 修改 → 推送；同一计划不重复推送同一个视频', async () => {
    await opsRepo.saveSettings && await inTenant(() => opsRepo.saveSettings({ publicBaseUrl: 'https://tools.example.com/' }));
    const plan = (await inTenant(() => opsRepo.listPlans())).find(item => item.name === '每日视频');
    const draft = await inTenant(() => opsService.runPlan(plan.id, { mode: 'draft', actor: 'admin' }));
    assert.equal(draft.status, 'draft');
    assert.match(draft.content, /给运营一群：快速检索 https:\/\/tools\.example\.com\/assets\/videos\//);
    assert.match(draft.content, /^\d{4}-\d{2}-\d{2} 周./);
    assert.equal(pushes.length, 0);
    const edited = await inTenant(() => opsService.updateDraft(draft.id, `${draft.content}\n欢迎留言！`));
    const sent = await inTenant(() => opsService.sendRun(edited.id, { actor: 'admin' }));
    assert.equal(sent.status, 'sent');
    assert.equal(pushes.length, 1);
    assert.deepEqual(pushes[0].targets, [{ kind: 'group', id: 'grp-ops' }]);
    assert.match(pushes[0].text, /欢迎留言/);
    await assert.rejects(inTenant(() => opsService.sendRun(sent.id)), /只有草稿/);
    // 第二次挑下一个没推过的视频
    const next = await inTenant(() => opsService.runPlan(plan.id, { mode: 'draft' }));
    assert.match(next.content, /一键报表/);
    await inTenant(() => opsService.discardRun(next.id));
});

test('AI 生成：带上运营规范、群画像与视频素材，正文缺链接时自动补上', async () => {
    const plan = await inTenant(() => opsService.savePlan({ name: '每日小技巧', targets: [GROUP], contentMode: 'ai', prompt: '介绍一个平台小技巧', sources: ['videos'], schedule: { type: 'daily', times: ['10:00'] } }));
    aiCalls.length = 0;
    const draft = await inTenant(() => opsService.runPlan(plan.id, { mode: 'draft' }));
    assert.equal(draft.status, 'draft');
    assert.match(draft.content, /^☀️ 早上好/);
    assert.match(draft.content, /🎬 .+：https:\/\/tools\.example\.com/);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].persist, false);
    assert.match(aiCalls[0].context, /运营规范/);
    assert.match(aiCalls[0].context, /「运营一群」：一线运维，关注 HC 指标/);
    assert.match(aiCalls[0].messages[0].content, /介绍一个平台小技巧/);
});

test('到点运行：自动发送模式直接推送，抢占后不会重复执行；部分失败记为 partial', async () => {
    const plan = await inTenant(() => opsService.savePlan({ name: '自动推送', targets: [GROUP, { channel: 'welink', kind: 'group', id: 'bad-group' }], contentMode: 'template', template: '今日提醒 {{date}}', sendMode: 'auto', enabled: true, schedule: { type: 'daily', times: ['09:00'], workdaysOnly: false } }));
    const later = new Date(new Date(plan.nextRunAt).getTime() + 1000);
    const before = pushes.length;
    const result = await opsService.runTenant('default', { now: later });
    assert.equal(result.ran, 1);
    assert.equal(pushes.length, before + 2);
    const again = await opsService.runTenant('default', { now: later });
    assert.equal(again.ran, 0);
    const runs = await inTenant(() => opsRepo.listRuns({ planId: plan.id }));
    assert.equal(runs[0].status, 'partial');
    assert.match(runs[0].error, /bad-group：无会话/);
    const reloaded = await inTenant(() => opsRepo.getPlan(plan.id));
    assert.ok(new Date(reloaded.nextRunAt) > later);
});

test('Dragon Claw 运营工具：本轮生成的草稿不能直接发送，下一轮确认后才发', async () => {
    const plan = (await inTenant(() => opsRepo.listPlans())).find(item => item.name === '每日小技巧');
    const ctx = { actor: 'admin', createdRunIds: new Set() };
    const preview = await inTenant(() => opsAgent.execute(ctx, 'ops_preview', { planId: plan.id }));
    const runId = JSON.parse(preview.content).draft.id;
    const blocked = await inTenant(() => opsAgent.execute(ctx, 'ops_send_draft', { runId }));
    assert.equal(blocked.isError, true);
    assert.match(blocked.content, /用户还没看过/);
    const before = pushes.length;
    const nextTurn = await inTenant(() => opsAgent.execute({ actor: 'admin', createdRunIds: new Set() }, 'ops_send_draft', { runId }));
    assert.equal(nextTurn.isError, undefined);
    assert.equal(pushes.length, before + 1);
    const removal = await inTenant(() => opsAgent.execute(ctx, 'ops_delete_plan', { id: plan.id, confirmed: false }));
    assert.equal(removal.isError, true);
    const overview = JSON.parse((await inTenant(() => opsAgent.execute(ctx, 'ops_overview', {}))).content);
    assert.ok(overview.groups.some(item => item.id === 'grp-ops'));
    assert.ok(overview.plans.some(item => item.name === '每日小技巧'));
    const saved = await inTenant(() => opsAgent.execute(ctx, 'ops_save_settings', { styleGuide: '- 每条消息都以 ☀️ 开头' }));
    assert.match(saved.content, /☀️ 开头/);
});

test('运营群互动：群成员 @助手 时带上群画像、互动要求与运营规范', async () => {
    const provider = new WeLinkProvider({ tenantId: 'default' });
    aiCalls.length = 0;
    await inTenant(() => targetsRepo.touchTarget('welink', { kind: 'group', id: 'grp-ops', toolSessionId: 'wl_ops' }));
    const run = await provider.runMessage({
        toolSessionId: 'wl_ops',
        text: '今天有什么新功能？',
        context: { sendUserAccount: 'alice' },
        extParameters: { platformExtParam: { businessSessionType: 'group', businessSessionId: 'grp-ops' } }
    });
    for await (const _fact of run.facts) { /* 消费完 */ }
    await run.result();
    assert.equal(aiCalls.length, 1);
    assert.match(aiCalls[0].context, /这是运营群「运营一群」/);
    assert.match(aiCalls[0].context, /互动要求：每天出一道小问答/);
    assert.match(aiCalls[0].context, /每条消息都以 ☀️ 开头/);
});

test('内置内容库：AI 月报亮点与模板齐全，模板一键建计划且默认不启用', async () => {
    const library = require('../backend/models/channels/ops-library');
    const topic = library.getTopic('ai-report');
    assert.ok(topic.highlights.length >= 15);
    topic.highlights.forEach(item => ['id', 'title', 'pain', 'value', 'howTo'].forEach(key => assert.ok(item[key], `${item.id} 缺少 ${key}`)));
    assert.equal(new Set(topic.highlights.map(item => item.id)).size, topic.highlights.length);
    assert.ok(library.listAngles().length >= 5);
    for (const preset of library.listPresets()) {
        const plan = await inTenant(() => opsService.createFromPreset(preset.id, { targets: [GROUP] }, 'admin'));
        assert.equal(plan.name, preset.name);
        assert.equal(plan.enabled, false);
        assert.deepEqual(plan.sources, preset.sources);
        if (preset.contentMode === 'template') assert.doesNotMatch((await inTenant(() => opsService.generate(plan))).content, /\{\{/, '模板变量全部替换');
    }
    await assert.rejects(inTenant(() => opsService.createFromPreset('nope', { targets: [GROUP] })), /内置模板不存在/);
});

test('亮点随机抽取：近期推过的不重复，运营角度每次换一种；AI 上下文带亮点与角度', async () => {
    const plan = (await inTenant(() => opsRepo.listPlans())).find(item => item.name === 'AI 月报 · 每日亮点');
    const seen = [];
    const angles = [];
    aiCalls.length = 0;
    for (let i = 0; i < 8; i += 1) {
        const run = await inTenant(() => opsService.runPlan(plan.id, { mode: 'draft' }));
        assert.equal(run.status, 'draft');
        assert.equal(run.meta.highlightIds.length, 1);
        seen.push(run.meta.highlightIds[0]);
        angles.push(run.meta.angle);
    }
    assert.equal(new Set(seen).size, seen.length, '8 次内亮点不重复');
    angles.slice(1).forEach((angle, index) => assert.notEqual(angle, angles[index], '相邻两次角度不同'));
    assert.match(aiCalls[0].context, /【功能亮点（AI 月报/);
    assert.match(aiCalls[0].context, /【运营角度：/);
    assert.match(aiCalls[0].context, /入口链接：https:\/\/tools\.example\.com\/monthly/);
    const card = (await inTenant(() => opsRepo.listPlans())).find(item => item.name.startsWith('AI 月报 · 亮点卡片'));
    const generated = await inTenant(() => opsService.generate(card));
    assert.doesNotMatch(generated.content, /\{\{/);
    assert.match(generated.content, /🔗 入口：https:\/\/tools\.example\.com\/monthly/);
});
