// 频道对接 API（当前仅 WeLink）。挂载在 /api/channels，已经过登录与租户中间件。
// 配置、连接控制、诊断、名单维护仅管理员；推送对普通用户仅在开启「允许普通用户推送」时
// 开放，且只能推送到默认推送范围内的目标。
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { getTenantId } = require('../models/tenant-context');
const configRepo = require('../models/channels/welink-config-repository');
const targetsRepo = require('../models/channels/channel-targets-repository');
const sdkLoader = require('../models/channels/welink-sdk-loader');
const welink = require('../models/channels/welink-bridge-service');

const router = express.Router();
const CHANNEL = 'welink';
const KIND_RE = /^(user|group)$/;

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

router.get('/welink/status', handle(async (_req, res) => {
    res.json(await welink.getStatus(getTenantId()));
}));

router.get('/welink/config', requireAdmin, handle(async (_req, res) => {
    res.json(await configRepo.getPublicConfig());
}));

router.put('/welink/config', handle(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const allowed = ['enabled', 'environment', 'gatewayUrl', 'channel', 'toolVersion', 'ak', 'sk', 'clearSk', 'sdkPath',
        'replyEngine', 'modelId', 'slashCommandsEnabled', 'deniedReply', 'access', 'push'];
    const patch = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
    const saved = await configRepo.saveConfig(patch);
    const status = await welink.applyConfig(getTenantId());
    res.json({ config: configRepo.toPublic(saved), status });
}));

router.post('/welink/sdk/recheck', handle(async (_req, res) => {
    sdkLoader.reset();
    res.json(await welink.getStatus(getTenantId()));
}));

router.post('/welink/connect', handle(async (_req, res) => {
    res.json(await welink.connect(getTenantId()));
}));

router.post('/welink/disconnect', handle(async (_req, res) => {
    res.json(await welink.disconnect(getTenantId()));
}));

router.post('/welink/restart', handle(async (_req, res) => {
    res.json(await welink.restart(getTenantId()));
}));

router.post('/welink/test', handle(async (_req, res) => {
    res.json(await welink.testConnection(getTenantId()));
}));

router.get('/welink/diagnostics', requireAdmin, handle(async (_req, res) => {
    res.json(await welink.getDiagnostics(getTenantId()));
}));

// 扫码授权：NDJSON 流式返回二维码快照（不含凭据），确认后后端直接保存 AK/SK。
router.post('/welink/qrcode-auth', async (req, res) => {
    const tenantId = getTenantId();
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    const write = payload => {
        if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(payload)}\n`);
    };
    try {
        const result = await welink.runQrAuth(tenantId, { environment: req.body?.environment, channel: req.body?.channel }, snapshot => write({ type: 'snapshot', snapshot }));
        write({ type: 'done', ...result });
    } catch (error) {
        write({ type: 'error', code: error.code || 'WELINK_QR_FAILED', error: error.message });
    }
    res.end();
});

router.get('/welink/targets', handle(async (req, res) => {
    const pushableOnly = req.query.pushable === '1';
    let items = await targetsRepo.listTargets(CHANNEL, { kind: req.query.kind, q: req.query.q, limit: req.query.limit, pushableOnly });
    if (!isAdmin(req)) {
        // 普通用户只能看到默认推送范围内的目标（用于页面里选择推送对象）
        const config = await configRepo.getConfig();
        if (!config.push.allowUserPush) return res.status(403).json({ code: 'CHANNEL_FORBIDDEN', error: '仅管理员可查看频道联系人' });
        const scope = new Set(config.push.defaultTargets.map(item => `${item.kind}:${item.id}`));
        items = items.filter(item => scope.has(`${item.kind}:${item.id}`));
    }
    res.json({ items });
}));

router.put('/welink/targets/:kind/:id', handle(async (req, res) => {
    if (!KIND_RE.test(req.params.kind)) return res.status(400).json({ error: '无效的目标类型' });
    const ok = await targetsRepo.setTargetAlias(CHANNEL, req.params.kind, req.params.id, req.body?.alias);
    if (!ok) return res.status(404).json({ error: '目标不存在' });
    res.json({ ok: true });
}));

router.delete('/welink/targets/:kind/:id', handle(async (req, res) => {
    if (!KIND_RE.test(req.params.kind)) return res.status(400).json({ error: '无效的目标类型' });
    res.json({ ok: await targetsRepo.deleteTarget(CHANNEL, req.params.kind, req.params.id) });
}));

router.get('/welink/messages', requireAdmin, handle(async (req, res) => {
    res.json({ items: await targetsRepo.listMessages(CHANNEL, { limit: req.query.limit }) });
}));

router.post('/welink/push', handle(async (req, res) => {
    const body = req.body || {};
    const targets = Array.isArray(body.targets) ? configRepo.normalizeTargets(body.targets) : [];
    if (!isAdmin(req)) {
        const config = await configRepo.getConfig();
        if (!config.push.allowUserPush) return res.status(403).json({ code: 'CHANNEL_FORBIDDEN', error: '仅管理员可推送 WeLink 消息' });
        const scope = new Set(config.push.defaultTargets.map(item => `${item.kind}:${item.id}`));
        const outside = targets.filter(item => !scope.has(`${item.kind}:${item.id}`));
        if (outside.length) return res.status(403).json({ code: 'CHANNEL_TARGET_FORBIDDEN', error: '只能推送到管理员配置的默认推送范围' });
    }
    const source = String(body.source || req.get('referer') || '').slice(0, 120);
    res.json(await welink.push(getTenantId(), {
        text: body.text,
        targets,
        trigger: ['scheduled', 'webhook', 'system'].includes(body.trigger) ? body.trigger : 'system',
        source: `${req.user?.username || ''}${source ? ` @ ${source}` : ''}`
    }));
}));

module.exports = router;
