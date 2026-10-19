const express = require('express');
const repo = require('../models/datacom-knowledge-repository');
const { requireAdmin } = require('../middleware/auth');
const { getTenantId } = require('../models/tenant-context');

// 数通协议专家知识库 API：登录用户可读，写操作仅管理员（全局中间件同样拦截非 GET）。
const router = express.Router();

router.use((req, res, next) => {
    req.suppressBodyLog = true;
    res.set('Cache-Control', 'no-store');
    next();
});

function route(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(error => {
        if (!error.status) return next(error);
        res.status(error.status).json({ error: error.message, code: error.code || 'DATACOM_ERROR' });
    });
}

function assertCurrentTenant(expectedTenant) {
    if (expectedTenant !== undefined && expectedTenant !== getTenantId()) {
        throw Object.assign(new Error('平台已切换租户，请刷新知识库页面后重试'), { status: 409, code: 'DATACOM_TENANT_CHANGED' });
    }
}

const actorOf = req => req.user?.username || 'admin';

router.get('/', route(async (req, res) => {
    res.json({
        ...(await repo.loadCatalog()),
        tenantId: getTenantId(),
        canWrite: req.user?.role === 'admin',
        username: req.user?.username || '',
        databaseFile: repo.DB_FILENAME,
        seedVersion: repo.SEED_VERSION
    });
}));

router.get('/search', route(async (req, res) => {
    res.json({ results: await repo.search(req.query.q) });
}));

router.get('/articles/:id', route(async (req, res) => {
    res.json({ article: await repo.getArticle(req.params.id) });
}));

router.get('/articles/:id/revisions', requireAdmin, route(async (req, res) => {
    res.json({ revisions: await repo.listRevisions(req.params.id) });
}));

router.get('/articles/:id/revisions/:revisionId', requireAdmin, route(async (req, res) => {
    res.json({ article: await repo.getRevision(req.params.id, req.params.revisionId) });
}));

router.post('/articles', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    const inputs = Array.isArray(req.body?.articles) ? req.body.articles : [req.body?.article];
    const ids = await repo.createArticles(inputs, actorOf(req));
    res.json({ success: true, ids });
}));

router.put('/articles/:id', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    const result = await repo.updateArticle(req.params.id, req.body?.article, req.body?.revision, actorOf(req));
    res.json({ success: true, ...result });
}));

router.delete('/articles/:id', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.query.tenantId);
    res.json({ success: true, ...(await repo.deleteArticle(req.params.id, actorOf(req))) });
}));

router.post('/import/parse', requireAdmin, route(async (req, res) => {
    res.json({ drafts: repo.parseImport(req.body?.files) });
}));

router.post('/domains', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    res.json({ success: true, ...(await repo.saveDomain(req.body?.domain, { create: true })) });
}));

router.put('/domains/:id', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    res.json({ success: true, ...(await repo.saveDomain({ ...req.body?.domain, id: req.params.id }, { create: false })) });
}));

router.post('/categories', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    res.json({ success: true, ...(await repo.saveCategory(req.body?.category, { create: true })) });
}));

router.put('/categories/:id', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    res.json({ success: true, ...(await repo.saveCategory({ ...req.body?.category, id: req.params.id }, { create: false })) });
}));

router.delete('/categories/:id', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.query.tenantId);
    res.json({ success: true, ...(await repo.deleteCategory(req.params.id)) });
}));

router.post('/outline', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    res.json({ success: true, ...(await repo.saveOutline(req.body?.node, actorOf(req))) });
}));

router.put('/outline/:id', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    res.json({ success: true, ...(await repo.saveOutline(req.body?.node, actorOf(req), req.params.id)) });
}));

router.delete('/outline/:id', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.query.tenantId);
    res.json({ success: true, ...(await repo.deleteOutline(req.params.id)) });
}));

// ---------------- AI 问答与笔记：登录用户都可使用（server.js 放行），改写原文仍需管理员 ----------------
const knowledgeAi = require('../models/datacom-knowledge-ai');

router.get('/ai/status', route(async (req, res) => {
    res.json({ ...(await knowledgeAi.aiStatus()), canRewrite: req.user?.role === 'admin' });
}));

router.get('/annotations', route(async (req, res) => {
    res.json({ annotations: await knowledgeAi.listAnnotations({ articleId: req.query.articleId, visualId: req.query.visualId, scope: req.query.scope }) });
}));

router.put('/annotations/:id', route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    res.json({ success: true, annotation: await knowledgeAi.updateAnnotation(req.params.id, req.body, req.user) });
}));

router.delete('/annotations/:id', route(async (req, res) => {
    assertCurrentTenant(req.query.tenantId);
    res.json({ success: true, ...(await knowledgeAi.deleteAnnotation(req.params.id, req.user)) });
}));

// 流式返回 NDJSON：{type:'delta'} 逐段文字，最后 {type:'done'} 带保存好的问答/笔记或改写建议
router.post('/ai/ask', async (req, res) => {
    try {
        assertCurrentTenant(req.body?.tenantId);
    } catch (error) {
        return res.status(error.status).json({ error: error.message, code: error.code });
    }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    res.status(200).set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const send = payload => { if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(payload)}\n`); };
    try {
        send({ type: 'start' });
        const result = await knowledgeAi.ask(req.body, { user: req.user, signal: controller.signal, onDelta: delta => send({ type: 'delta', text: delta }) });
        send({ type: 'done', ...result });
    } catch (error) {
        if (!controller.signal.aborted) send({ type: 'error', error: error.status ? error.message : `AI 调用失败：${error.message}`, code: error.code || 'DATACOM_AI_ERROR' });
    } finally {
        res.end();
    }
});

router.post('/ai/apply', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    res.json({ success: true, ...(await knowledgeAi.applyRewrite(req.body, { user: req.user })) });
}));

module.exports = router;
