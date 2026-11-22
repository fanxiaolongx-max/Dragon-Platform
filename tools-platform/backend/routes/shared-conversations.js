// 共享对话 API（/api/shared-conversations）：所有操作都只作用于当前登录账号自己的数据——
// 自己的对话、自己收到的邀请、自己的常用群组；本地对话的读写都在当前账号的团队库里进行。
const express = require('express');
const shared = require('../models/shared-conversations');
const sharedLive = require('../models/shared-live');
const { getTenantId } = require('../models/tenant-context');
const { isSuperAdmin } = require('../middleware/auth');

const router = express.Router();
const me = req => String(req.user?.username || '');
const handle = fn => async (req, res) => {
    if (!me(req)) return res.status(401).json({ code: 'AUTH_REQUIRED', error: '请先登录' });
    try {
        res.setHeader('Cache-Control', 'no-store');
        await fn(req, res);
    } catch (error) {
        if (!error.statusCode) console.error('[shared-conversations]', error);
        res.status(error.statusCode || 500).json({ code: error.code || 'SHARE_FAILED', error: error.statusCode ? error.message : '共享对话操作失败' });
    }
};
const ctx = req => ({ tenantId: getTenantId(), username: me(req) });

router.get('/accounts', handle(async (req, res) => res.json({ items: await shared.accounts(me(req), req.query.q) })));
router.get('/recent', handle(async (req, res) => res.json(await shared.recent(me(req)))));
router.get('/groups', handle(async (req, res) => res.json({ items: await shared.listGroups(me(req)) })));
router.post('/groups', handle(async (req, res) => res.json({ item: await shared.saveGroup(me(req), req.body || {}) })));
router.put('/groups/:id', handle(async (req, res) => res.json({ item: await shared.saveGroup(me(req), { ...(req.body || {}), id: req.params.id }) })));
router.delete('/groups/:id', handle(async (req, res) => { await shared.deleteGroup(me(req), req.params.id); res.json({ ok: true }); }));

router.get('/inbox', handle(async (req, res) => res.json({
    items: await shared.inbox(me(req)),
    skillRequests: await shared.inboxSkillRequests(me(req), { tenantId: getTenantId(), isSuper: isSuperAdmin(req.user) })
})));
router.post('/invites/:shareId/respond', handle(async (req, res) => res.json(await shared.respond({ ...ctx(req), shareId: req.params.shareId, action: String(req.body?.action || '') }))));
router.post('/link/:token', handle(async (req, res) => res.json(await shared.joinByLink({ username: me(req), token: req.params.token }))));

router.get('/mine', handle(async (req, res) => res.json({ items: await shared.listMine(ctx(req)) })));
router.get('/session/:sessionId', handle(async (req, res) => res.json({ share: await shared.shareForSession({ ...ctx(req), role: req.user?.role || '', sessionId: req.params.sessionId }) })));
// 申请在当前共享对话中使用历史里出现的未开放 / 私有 Skill，发送审批给 Skill 归属人
router.post('/session/:sessionId/skill-requests', handle(async (req, res) => res.json(await shared.requestSkillShare({
    ...ctx(req),
    role: req.user?.role || '',
    sessionId: req.params.sessionId,
    skillId: req.body?.skillId,
    note: req.body?.note
}))));
router.post('/skill-requests/:requestId/respond', handle(async (req, res) => res.json(await shared.respondSkillRequest({
    ...ctx(req),
    isSuper: isSuperAdmin(req.user),
    requestId: req.params.requestId,
    action: String(req.body?.action || '')
}))));
// 打开共享面板：为这个对话准备共享（生成链接、推送已有历史）；不邀请任何人时侧栏不会把它算作共享对话
router.post('/session/:sessionId/prepare', handle(async (req, res) => {
    const share = await shared.ensureShare({ ...ctx(req), sessionId: req.params.sessionId, title: req.body?.title });
    res.json({ share: await shared.shareForSession({ ...ctx(req), sessionId: req.params.sessionId }) || { id: share.id, link: shared.linkFor(share) } });
}));
router.post('/session/:sessionId/invite', handle(async (req, res) => res.json(await shared.invite({ ...ctx(req), sessionId: req.params.sessionId, title: req.body?.title, usernames: req.body?.usernames, groupIds: req.body?.groupIds }))));
router.post('/session/:sessionId/sync', handle(async (req, res) => {
    const result = await shared.syncLocal({ ...ctx(req), sessionId: req.params.sessionId });
    // 实时围观的兜底：/live 没连上时，页面据此锁定输入框并提示谁在提问
    if (result && !result.closed) result.activeTurn = sharedLive.activeTurn(result.shareId, me(req));
    res.json({ result });
}));
// 实时围观：同一共享里其他成员正在进行的一轮回答（NDJSON 长连接：catchup / idle 起头，之后实时推送）
router.get('/session/:sessionId/live', handle(async (req, res) => sharedLive.attach(req, res, ctx(req))));
router.post('/session/:sessionId/leave', handle(async (req, res) => res.json(await shared.leave({ ...ctx(req), sessionId: req.params.sessionId }))));
router.post('/session/:sessionId/remove', handle(async (req, res) => res.json({ share: await shared.removeMember({ ...ctx(req), sessionId: req.params.sessionId, target: String(req.body?.username || '') }) })));

module.exports = router;
