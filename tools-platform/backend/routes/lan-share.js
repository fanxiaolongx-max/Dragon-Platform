// 内网直连共享（/api/lan-share，需登录）：本机界面查询可用性、生成带内网 IP 的共享链接、用别人的内网链接加入。
// 节点之间的接口在 routes/lan-peer.js（不登录，按链接令牌 / 节点密钥校验）。
const express = require('express');
const lanShare = require('../models/lan-share');
const { getTenantId } = require('../models/tenant-context');

const router = express.Router();
const me = req => String(req.user?.username || '');
const handle = fn => async (req, res) => {
    if (!me(req)) return res.status(401).json({ code: 'AUTH_REQUIRED', error: '请先登录' });
    try {
        res.setHeader('Cache-Control', 'no-store');
        await fn(req, res);
    } catch (error) {
        if (!error.statusCode) console.error('[lan-share]', error);
        res.status(error.statusCode || 500).json({ code: error.code || 'LAN_SHARE_FAILED', error: error.statusCode ? error.message : '内网共享操作失败' });
    }
};
const ctx = req => ({ tenantId: getTenantId(), username: me(req) });

router.get('/status', handle(async (req, res) => res.json(await lanShare.availability({ refresh: req.query.refresh === '1' }))));
router.get('/session/:sessionId', handle(async (req, res) => res.json(await lanShare.sessionInfo({ ...ctx(req), sessionId: req.params.sessionId, refresh: req.query.refresh === '1' }))));
router.post('/session/:sessionId/link', handle(async (req, res) => res.json({ lan: await lanShare.ensureHostLink({ ...ctx(req), sessionId: req.params.sessionId, title: req.body?.title }) })));
router.post('/join', handle(async (req, res) => res.json(await lanShare.join({ ...ctx(req), link: req.body?.link }))));

module.exports = router;
