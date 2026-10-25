// 频道对接 API（WeLink、微信）。挂载在 /api/channels，已经过登录与租户中间件。
// 配置、连接控制、诊断、名单维护仅管理员；推送对普通用户仅在开启「允许普通用户推送」时
// 开放，且只能推送到默认推送范围内的目标。状态、配置、联系人、日志、推送两个频道共用同一套接口。
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { getTenantId } = require('../models/tenant-context');
const configRepo = require('../models/channels/welink-config-repository');
const weixinConfigRepo = require('../models/channels/weixin-config-repository');
const targetsRepo = require('../models/channels/channel-targets-repository');
const sdkLoader = require('../models/channels/welink-sdk-loader');
const welink = require('../models/channels/welink-bridge-service');
const weixin = require('../models/channels/weixin-bridge-service');
const followupsRepo = require('../models/channels/channel-followups-repository');
const followupScheduler = require('../models/channels/followup-scheduler');

const router = express.Router();
const CHANNEL = 'welink';
const KIND_RE = /^(user|group)$/;
const CH = ':channel(welink|weixin)';
const BEHAVIOR_KEYS = ['enabled', 'replyEngine', 'modelId', 'slashCommandsEnabled', 'deniedReply', 'access', 'push'];
const CHANNELS = {
    welink: {
        service: welink,
        repo: configRepo,
        label: 'WeLink',
        configKeys: [...BEHAVIOR_KEYS, 'environment', 'gatewayUrl', 'channel', 'toolVersion', 'ak', 'sk', 'clearSk', 'sdkPath', 'followup']
    },
    weixin: {
        service: weixin,
        repo: weixinConfigRepo,
        label: '微信',
        configKeys: [...BEHAVIOR_KEYS, 'baseUrl', 'token', 'clearToken', 'botAgent']
    }
};

function isAdmin(req) {
    return req.user?.role === 'admin';
}

function sendError(res, error) {
    res.status(error.statusCode || 500).json({ code: error.code || 'CHANNEL_ERROR', error: error.message || '频道操作失败' });
}

const handle = fn => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        sendError(res, error);
    }
};

const ch = req => CHANNELS[req.params.channel];

/** 已对接（已启用且已配置凭据）的频道，首页对话侧栏据此显示频道分类；所有登录用户可读。 */
router.get('/available', handle(async (_req, res) => {
    const items = [];
    for (const [id, { service, label }] of Object.entries(CHANNELS)) {
        try {
            const status = await service.getStatus(getTenantId());
            if (status.enabled && status.configured) items.push({ id, label, connected: Boolean(status.connected) });
        } catch {
            // 某个频道读取失败不影响其他频道
        }
    }
    res.json({ items });
}));

router.get(`/${CH}/status`, handle(async (req, res) => {
    res.json(await ch(req).service.getStatus(getTenantId()));
}));

router.get(`/${CH}/config`, requireAdmin, handle(async (req, res) => {
    res.json(await ch(req).repo.getPublicConfig());
}));

router.put(`/${CH}/config`, handle(async (req, res) => {
    const { repo, service, configKeys } = ch(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patch = Object.fromEntries(Object.entries(body).filter(([key]) => configKeys.includes(key)));
    const saved = await repo.saveConfig(patch);
    const status = await service.applyConfig(getTenantId());
    res.json({ config: repo.toPublic(saved), status });
}));

router.post('/welink/sdk/recheck', handle(async (_req, res) => {
    sdkLoader.reset();
    res.json(await welink.getStatus(getTenantId()));
}));

// 导入 SDK：前端读取所选文件夹中的 dist/index.js（及 index.d.ts、package.json）文本后提交；
// 后端先加载校验再替换，存放在本机数据目录，所有租户共用。
router.post('/welink/sdk/import', handle(async (req, res) => {
    const body = req.body || {};
    const sdk = await sdkLoader.importSdk({ entry: body.entry, types: body.types, packageJson: body.packageJson, fileName: body.fileName });
    // 已启用但尚未连接（例如之前缺 SDK）时立即尝试连接；已连接的保持不动，由页面提示重启后生效
    res.json({ sdk, status: await welink.applyConfig(getTenantId()) });
}));

router.delete('/welink/sdk/import', handle(async (_req, res) => {
    const removed = sdkLoader.removeImportedSdk();
    res.json({ removed, status: await welink.getStatus(getTenantId()) });
}));

router.post(`/${CH}/connect`, handle(async (req, res) => {
    res.json(await ch(req).service.connect(getTenantId()));
}));

router.post(`/${CH}/disconnect`, handle(async (req, res) => {
    res.json(await ch(req).service.disconnect(getTenantId()));
}));

router.post(`/${CH}/restart`, handle(async (req, res) => {
    res.json(await ch(req).service.restart(getTenantId()));
}));

router.post(`/${CH}/test`, handle(async (req, res) => {
    res.json(await ch(req).service.testConnection(getTenantId()));
}));

router.get(`/${CH}/diagnostics`, requireAdmin, handle(async (req, res) => {
    res.json(await ch(req).service.getDiagnostics(getTenantId()));
}));

function ndjson(res) {
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    return payload => {
        if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(payload)}\n`);
    };
}

// 扫码授权：NDJSON 流式返回二维码快照（不含凭据），确认后后端直接保存 AK/SK。
router.post('/welink/qrcode-auth', async (req, res) => {
    const tenantId = getTenantId();
    const write = ndjson(res);
    try {
        const result = await welink.runQrAuth(tenantId, { environment: req.body?.environment, channel: req.body?.channel }, snapshot => write({ type: 'snapshot', snapshot }));
        write({ type: 'done', ...result });
    } catch (error) {
        write({ type: 'error', code: error.code || 'WELINK_QR_FAILED', error: error.message });
    }
    res.end();
});

// 微信扫码登录：快照格式与 WeLink 一致；手机显示数字时通过 /weixin/qrcode-auth/verify 提交。
router.post('/weixin/qrcode-auth', async (req, res) => {
    const tenantId = getTenantId();
    const write = ndjson(res);
    try {
        const result = await weixin.runQrAuth(tenantId, snapshot => write({ type: 'snapshot', snapshot }));
        write({ type: 'done', saved: result.saved, alreadyConnected: Boolean(result.alreadyConnected), status: result.status });
    } catch (error) {
        write({ type: 'error', code: error.code || 'WEIXIN_QR_FAILED', error: error.message });
    }
    res.end();
});

router.post('/weixin/qrcode-auth/verify', handle(async (req, res) => {
    res.json(weixin.submitQrVerifyCode(getTenantId(), req.body?.code));
}));

// 直接复用本机 OpenClaw 微信插件已登录的 bot（token、同步游标、联系人 context_token）
router.post('/weixin/openclaw/import', handle(async (_req, res) => {
    res.json(await weixin.importFromOpenClaw(getTenantId()));
}));

// 暂停 / 恢复 OpenClaw 的微信插件：同一个 bot 只能有一个客户端收消息
router.post('/weixin/openclaw/:action(pause|resume)', handle(async (req, res) => {
    res.json(await weixin.setOpenClawWeixin(req.params.action === 'resume', getTenantId()));
}));

router.get(`/${CH}/targets`, handle(async (req, res) => {
    const channel = req.params.channel;
    const pushableOnly = req.query.pushable === '1';
    let items = await targetsRepo.listTargets(channel, { kind: req.query.kind, q: req.query.q, limit: req.query.limit, pushableOnly });
    if (!isAdmin(req)) {
        // 普通用户只能看到默认推送范围内的目标（用于页面里选择推送对象）
        const config = await ch(req).repo.getConfig();
        if (!config.push.allowUserPush) return res.status(403).json({ code: 'CHANNEL_FORBIDDEN', error: '仅管理员可查看频道联系人' });
        const scope = new Set(config.push.defaultTargets.map(item => `${item.kind}:${item.id}`));
        items = items.filter(item => scope.has(`${item.kind}:${item.id}`));
    }
    res.json({ items });
}));

router.put(`/${CH}/targets/:kind/:id`, handle(async (req, res) => {
    if (!KIND_RE.test(req.params.kind)) return res.status(400).json({ error: '无效的目标类型' });
    const ok = await targetsRepo.setTargetAlias(req.params.channel, req.params.kind, req.params.id, req.body?.alias);
    if (!ok) return res.status(404).json({ error: '目标不存在' });
    res.json({ ok: true });
}));

router.delete(`/${CH}/targets/:kind/:id`, handle(async (req, res) => {
    if (!KIND_RE.test(req.params.kind)) return res.status(400).json({ error: '无效的目标类型' });
    res.json({ ok: await targetsRepo.deleteTarget(req.params.channel, req.params.kind, req.params.id) });
}));

// 消息日志：设置页滚动到日志时才加载，每页 limit 条（默认 30），before 为上一页最后一条 id
router.get(`/${CH}/messages`, requireAdmin, handle(async (req, res) => {
    res.json(await targetsRepo.listMessagesPage(req.params.channel, { limit: req.query.limit, before: req.query.before }));
}));

router.post(`/${CH}/push`, handle(async (req, res) => {
    const { repo, label } = ch(req);
    const body = req.body || {};
    const targets = Array.isArray(body.targets) ? repo.normalizeTargets(body.targets) : [];
    if (body.source === 'manual-bot') {
        if (targets.length !== 1 || body.targets.length !== 1) return res.status(400).json({ code: 'CHANNEL_MANUAL_TARGET_REQUIRED', error: '手动运营必须明确指定一个会话，不能使用默认推送范围' });
        if (typeof body.text !== 'string' || !body.text.trim()) return res.status(400).json({ code: 'CHANNEL_MANUAL_TEXT_REQUIRED', error: '消息内容不能为空' });
        if (req.params.channel === 'weixin' && targets[0].kind === 'group') return res.status(400).json({ code: 'CHANNEL_TARGET_UNSUPPORTED', error: '微信助理暂不支持群推送，请选择微信联系人' });
    }
    if (!isAdmin(req)) {
        const config = await repo.getConfig();
        if (!config.push.allowUserPush) return res.status(403).json({ code: 'CHANNEL_FORBIDDEN', error: `仅管理员可推送${label}消息` });
        const scope = new Set(config.push.defaultTargets.map(item => `${item.kind}:${item.id}`));
        const outside = targets.filter(item => !scope.has(`${item.kind}:${item.id}`));
        if (outside.length) return res.status(403).json({ code: 'CHANNEL_TARGET_FORBIDDEN', error: '只能推送到管理员配置的默认推送范围' });
    }
    const source = String(body.source || req.get('referer') || '').slice(0, 120);
    // 走频道公共推送入口：推送成功会记入该群/人的对话记录
    res.json(await require('../models/channels').push({
        channel: req.params.channel,
        text: body.text,
        targets,
        trigger: ['scheduled', 'webhook', 'system'].includes(body.trigger) ? body.trigger : 'system',
        source: source === 'manual-bot' ? `manual-bot:${req.user?.username || ''}` : `${req.user?.username || ''}${source ? ` @ ${source}` : ''}`
    }));
}));

// ── 自动化运营（运营群组、运营计划、草稿与推送记录）──────────
// 全部仅管理员：读取在此校验，写操作另由 server.js 的非 GET 门禁拦截。
const opsRepo = require('../models/channels/ops-repository');
const opsService = require('../models/channels/ops-service');
const opsMaterials = require('../models/channels/ops-materials');
const actorOf = req => req.user?.username || '';

router.get('/ops/pending', handle(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isAdmin(req)) return res.json({ canManage: false, items: [], total: 0, hasMore: false, offset: 0 });
    const page = await opsRepo.listPendingRuns({ limit: req.query.limit, offset: req.query.offset });
    const groups = await opsRepo.listGroups();
    const items = page.items.map(record => ({
        ...record,
        targets: record.targets.map(target => ({ ...target, name: groups.find(group => group.channel === target.channel && group.kind === target.kind && group.id === target.id)?.name || target.id }))
    }));
    res.json({ ...page, items, canManage: true });
}));

router.get('/ops/overview', requireAdmin, handle(async (_req, res) => {
    const [settings, groups, plans, runs] = await Promise.all([opsRepo.getSettings(), opsRepo.listGroups(), opsRepo.listPlans(), opsRepo.listRuns({ limit: 40 })]);
    res.json({ settings, groups, plans, runs });
}));

router.put('/ops/settings', handle(async (req, res) => {
    res.json(await opsRepo.saveSettings({ styleGuide: req.body?.styleGuide, publicBaseUrl: req.body?.publicBaseUrl }));
}));

router.put('/ops/groups', handle(async (req, res) => {
    res.json(await opsRepo.saveGroup(req.body || {}));
}));

router.delete('/ops/groups/:channel/:kind/:id', handle(async (req, res) => {
    res.json({ ok: await opsRepo.removeGroup(req.params.channel, req.params.kind, req.params.id) });
}));

// 内置内容库：功能亮点专题、运营角度、计划模板（提示词）
router.get('/ops/library', requireAdmin, handle(async (_req, res) => {
    const library = require('../models/channels/ops-library');
    res.json({ topics: library.listTopics(), angles: library.listAngles(), presets: library.listPresets() });
}));

router.post('/ops/plans/from-preset', handle(async (req, res) => {
    const { presetId, ...overrides } = req.body || {};
    res.json(await opsService.createFromPreset(presetId, overrides, actorOf(req)));
}));

router.post('/ops/plans', handle(async (req, res) => {
    const { id, ...input } = req.body || {};
    res.json(await opsService.savePlan(input, actorOf(req)));
}));

router.put('/ops/plans/:id', handle(async (req, res) => {
    res.json(await opsService.savePlan({ ...(req.body || {}), id: req.params.id }, actorOf(req)));
}));

router.delete('/ops/plans/:id', handle(async (req, res) => {
    res.json({ ok: await opsRepo.deletePlan(req.params.id) });
}));

// 立即运行：mode=draft 只生成草稿（默认），mode=send 生成后直接推送
router.post('/ops/plans/:id/run', handle(async (req, res) => {
    res.json(await opsService.runPlan(req.params.id, { trigger: 'manual', mode: req.body?.mode === 'send' ? 'send' : 'draft', actor: actorOf(req) }));
}));

router.post('/ops/plans/:id/test', handle(async (req, res) => {
    res.json(await opsService.runPlan(req.params.id, { trigger: 'test', testTargets: req.body?.targets, actor: actorOf(req) }));
}));

router.put('/ops/runs/:id', handle(async (req, res) => {
    res.json(await opsService.updateDraft(req.params.id, req.body?.content, req.body?.expectedContent));
}));

router.post('/ops/runs/:id/send', handle(async (req, res) => {
    res.json(await opsService.sendRun(req.params.id, { content: req.body?.content, expectedContent: req.body?.expectedContent, actor: actorOf(req) }));
}));

router.post('/ops/runs/:id/discard', handle(async (req, res) => {
    res.json(await opsService.discardRun(req.params.id));
}));

router.get('/ops/materials', requireAdmin, handle(async (req, res) => {
    if (req.query.kind === 'videos') return res.json({ items: opsMaterials.listVideos({ category: req.query.category, limit: 50 }) });
    if (req.query.kind === 'highlights') return res.json({ items: require('../models/channels/ops-library').getTopic(req.query.topic || 'ai-report')?.highlights || [] });
    res.json({ items: await opsMaterials.recentFeatures(Math.min(90, Math.max(1, Number(req.query.days) || 7))) });
}));

// ── 频道对话历史（WeLink、微信）与跟进任务（仅 WeLink） ──────────
// 查看对所有登录用户开放（租户内共享）；修改任务、立即提醒仍需管理员（server.js 非 GET 统一门禁）。

function threadParams(req, res) {
    if (!KIND_RE.test(req.params.kind) || !req.params.id || req.params.id.length > 200) {
        res.status(400).json({ code: 'CHANNEL_THREAD_INVALID', error: '无效的会话' });
        return null;
    }
    return { kind: req.params.kind, id: req.params.id };
}

async function tasksWithEvents(tasks) {
    const items = [];
    for (const task of tasks) items.push({ ...task, events: await followupsRepo.listEvents(task.id, { limit: 60 }) });
    return items;
}

router.get(`/${CH}/threads`, handle(async (req, res) => {
    res.json({ items: await followupsRepo.listThreads(req.params.channel, { q: req.query.q, limit: req.query.limit }) });
}));

router.get(`/${CH}/threads/:kind/:id/messages`, handle(async (req, res) => {
    const thread = threadParams(req, res);
    if (!thread) return;
    const target = await targetsRepo.getTarget(req.params.channel, thread.kind, thread.id);
    const page = await followupsRepo.listThreadMessages(req.params.channel, thread.kind, thread.id, { limit: req.query.limit, before: req.query.before });
    let canSend = isAdmin(req);
    if (!canSend) {
        const config = await ch(req).repo.getConfig();
        canSend = config.push.allowUserPush && config.push.defaultTargets.some(item => item.kind === thread.kind && item.id === thread.id);
    }
    if (req.params.channel === 'weixin' && thread.kind === 'group') canSend = false;
    res.json({ thread: { ...thread, name: target?.name || thread.id }, ...page, canSend: Boolean(canSend) });
}));

// 微信暂不支持跟进任务：返回空列表，首页照常显示对话
router.get('/weixin/threads/:kind/:id/followups', handle(async (_req, res) => {
    res.json({ items: [], calendar: null, enabled: false, canManage: false });
}));

router.get('/welink/threads/:kind/:id/followups', handle(async (req, res) => {
    const thread = threadParams(req, res);
    if (!thread) return;
    const config = await configRepo.getConfig();
    const tasks = await followupsRepo.listTasks(CHANNEL, { ...thread, limit: 100 });
    res.json({ items: await tasksWithEvents(tasks), calendar: config.followup.calendar, enabled: config.followup.enabled, canManage: isAdmin(req) });
}));

const FOLLOWUP_ACTIONS = { done: 'done', cancel: 'cancelled', pause: 'paused', resume: 'open', reopen: 'open' };

router.patch('/welink/followups/:id', handle(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const actor = `platform:${req.user?.username || ''}`;
    const { followup } = await configRepo.getConfig();
    let task;
    if (body.action) {
        if (!FOLLOWUP_ACTIONS[body.action]) return res.status(400).json({ code: 'FOLLOWUP_ACTION_INVALID', error: '无效的操作' });
        task = await followupsRepo.setStatus(req.params.id, FOLLOWUP_ACTIONS[body.action], { actor, note: String(body.note || '').slice(0, 2000), calendar: followup.calendar });
    } else {
        const allowed = ['title', 'detail', 'assignees', 'urgency', 'scheduleMode', 'intervalMinutes', 'randomMinMinutes', 'randomMaxMinutes', 'allowOffHours', 'nextRemindAt', 'nextRemindNote', 'dueAt', 'progress'];
        const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
        task = await followupsRepo.updateTask(req.params.id, patch, { actor, calendar: followup.calendar });
    }
    res.json({ item: (await tasksWithEvents([task]))[0] });
}));

router.post('/welink/followups/:id/remind', handle(async (req, res) => {
    const task = await followupScheduler.remindNow(req.params.id);
    res.json({ item: (await tasksWithEvents([task]))[0] });
}));

module.exports = router;
