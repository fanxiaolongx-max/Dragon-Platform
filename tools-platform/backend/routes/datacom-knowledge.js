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

module.exports = router;
