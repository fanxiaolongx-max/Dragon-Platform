'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-knowledge-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const pool = require('../backend/models/tenant-sqlite-pool');
const platformDb = require('../backend/models/platform-db');
const appDb = require('../backend/models/app-db');
const sessions = require('../backend/models/auth-sessions-repository');
const { checkAuth } = require('../backend/middleware/auth');
const { tenantMiddleware, runWithTenant, getDataDir } = require('../backend/models/tenant-context');
const repo = require('../backend/models/datacom-knowledge-repository');
const seed = require('../backend/builtin-tools/datacom-protocol-expert/knowledge-seed.json');
const router = require('../backend/routes/datacom-knowledge');

const endpoint = '/api/datacom-knowledge';
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use('/api', checkAuth, tenantMiddleware);
app.use(endpoint, router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));

function api(method, url = endpoint, token = 'dk-admin') {
    return request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

test.before(async () => {
    const expiry = Date.now() + 600000;
    await sessions.saveSession('dk-admin', 'admin', 'admin', expiry);
    await sessions.saveSession('dk-viewer', 'viewer', 'user', expiry);
    await sessions.saveSession('dk-beta', 'admin', 'admin', expiry, 'beta');
});

test.after(async () => {
    await pool.closeAll();
    await appDb.closeDatabase();
    await platformDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('seed knowledge is consistent: categories, visuals and relations resolve', () => {
    const categoryIds = new Set(seed.categories.map(item => item.id));
    const domainIds = new Set(seed.domains.map(item => item.id));
    const articleIds = new Set(seed.articles.map(item => item.id));
    assert.equal(articleIds.size, seed.articles.length);
    for (const category of seed.categories) assert.ok(domainIds.has(category.domainId), category.id);
    for (const article of seed.articles) {
        assert.ok(categoryIds.has(article.categoryId), article.id);
        assert.ok(article.bodyMd.length > 200, `${article.id} body`);
        assert.ok(article.keyPoints.length >= 3, `${article.id} key points`);
        assert.ok(article.visuals.length >= 1, `${article.id} visuals`);
        for (const id of article.related) assert.ok(articleIds.has(id), `${article.id} -> ${id}`);
        assert.equal((article.bodyMd.match(/^\s*```/gm) || []).length % 2, 0, `${article.id} fences`);
    }
});

test('catalog requires login, seeds an independent database and hides writes from viewers', async () => {
    await request(app).get(endpoint).expect(401);
    const viewer = await api('get', endpoint, 'dk-viewer').expect(200);
    assert.equal(viewer.body.canWrite, false);
    assert.equal(viewer.body.databaseFile, 'datacom-knowledge.db');
    assert.equal(viewer.body.articles.length, seed.articles.length);
    assert.equal(viewer.body.articles[0].bodyMd, undefined, 'catalog omits bodies');
    assert.ok(viewer.body.learningPath.length > 0);
    assert.match(viewer.headers['cache-control'], /no-store/);
    const dbFile = path.join(getDataDir(), 'datacom-knowledge.db');
    assert.equal(fs.readFileSync(dbFile).subarray(0, 16).toString(), 'SQLite format 3\0');
    assert.equal(await platformDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='dk_articles'"), undefined);

    const article = await api('get', `${endpoint}/articles/ospf-fsm`, 'dk-viewer').expect(200);
    assert.match(article.body.article.bodyMd, /ExStart/);
    await api('put', `${endpoint}/articles/ospf-fsm`, 'dk-viewer').send({ article: article.body.article, revision: 1 }).expect(403);
    await api('post', `${endpoint}/import/parse`, 'dk-viewer').send({ files: [{ name: 'a.md', content: '# A\nx' }] }).expect(403);
});

test('edits keep revisions, reject stale revisions and survive seed refresh', async () => {
    const { body } = await api('get', `${endpoint}/articles/ospf-router-id`).expect(200);
    const original = body.article;
    const edited = { ...original, summary: '人工修订的摘要', keyPoints: [...original.keyPoints, '补充要点'] };
    const saved = await api('put', `${endpoint}/articles/ospf-router-id`).send({ article: edited, revision: original.revision }).expect(200);
    assert.equal(saved.body.revision, original.revision + 1);
    const stale = await api('put', `${endpoint}/articles/ospf-router-id`).send({ article: edited, revision: original.revision }).expect(409);
    assert.equal(stale.body.code, 'DATACOM_REVISION_CONFLICT');

    const revisions = await api('get', `${endpoint}/articles/ospf-router-id/revisions`).expect(200);
    assert.equal(revisions.body.revisions.length, 1);
    const previous = await api('get', `${endpoint}/articles/ospf-router-id/revisions/${revisions.body.revisions[0].id}`).expect(200);
    assert.equal(previous.body.article.summary, original.summary);

    // 重新打开连接并强制重新执行种子升级，人工修改不能被覆盖
    const db = pool.getConnection(repo.DB_FILENAME);
    await new Promise((resolve, reject) => db.run("UPDATE dk_meta SET value = '0' WHERE key = 'seed_version'", error => error ? reject(error) : resolve()));
    await pool.closeAll();
    const after = await api('get', `${endpoint}/articles/ospf-router-id`).expect(200);
    assert.equal(after.body.article.summary, '人工修订的摘要');
    assert.equal(after.body.article.edited, true);
});

test('deleted seed articles stay deleted and invalid input is rejected', async () => {
    await api('delete', `${endpoint}/articles/ospf-lsr-triplet`).expect(200);
    await api('get', `${endpoint}/articles/ospf-lsr-triplet`).expect(404);
    const db = pool.getConnection(repo.DB_FILENAME);
    await new Promise((resolve, reject) => db.run("UPDATE dk_meta SET value = '0' WHERE key = 'seed_version'", error => error ? reject(error) : resolve()));
    await pool.closeAll();
    const catalog = await api('get').expect(200);
    assert.equal(catalog.body.articles.some(item => item.id === 'ospf-lsr-triplet'), false);

    const bad = await api('post', `${endpoint}/articles`).send({ article: { title: 'x', categoryId: 'missing-cat', bodyMd: 'x' } }).expect(400);
    assert.equal(bad.body.code, 'DATACOM_CATEGORY_MISSING');
    await api('post', `${endpoint}/articles`).send({ article: { title: '', categoryId: 'ospf-basics' } }).expect(400);
    await api('post', `${endpoint}/articles`).send({ article: { title: 'x', categoryId: 'ospf-basics', visuals: ['<script>'] } }).expect(400);
    await api('delete', `${endpoint}/categories/ospf-basics`).expect(409);
});

test('markdown import parses merged documents and creates articles in a new category', async () => {
    const merged = [
        '# 合并文档', '',
        '<!-- 文件 1/2：BGP\\BGP\\BGP 选路.md -->', '',
        '---', 'title: BGP 选路十三条', 'tags:', '  - #bgp', '---', '',
        '# BGP 选路原则', '', 'BGP 按顺序比较属性。', '', '```text', '# 不是标题', '```', '',
        '<!-- 文件 2/2：BGP\\BGP\\RR.md -->', '',
        '# 路由反射器', '', '反射规则。', '', '# 第二部分', '', '集群列表防环。'
    ].join('\n');
    const parsed = await api('post', `${endpoint}/import/parse`).send({ files: [{ name: 'merged.md', content: merged }] }).expect(200);
    assert.deepEqual(parsed.body.drafts.map(item => item.title), ['BGP 选路原则', '路由反射器', '第二部分']);
    assert.match(parsed.body.drafts[0].bodyMd, /# 不是标题/);
    assert.deepEqual(parsed.body.drafts[0].tags, ['bgp']);

    await api('post', `${endpoint}/domains`).send({ domain: { id: 'bgp', name: 'BGP', icon: '🌐' } }).expect(200);
    await api('post', `${endpoint}/categories`).send({ category: { id: 'bgp-path', domainId: 'bgp', name: '选路' } }).expect(200);
    const created = await api('post', `${endpoint}/articles`).send({
        articles: parsed.body.drafts.map(draft => ({ ...draft, categoryId: 'bgp-path' }))
    }).expect(200);
    assert.equal(created.body.ids.length, 3);
    const results = await api('get', `${endpoint}/search?q=${encodeURIComponent('集群列表')}`).expect(200);
    assert.equal(results.body.results[0].id, created.body.ids[2]);
});

test('knowledge databases are isolated per tenant', async () => {
    await api('post', `${endpoint}/domains`, 'dk-admin').send({ domain: { id: 'isis', name: 'IS-IS' } }).expect(200);
    const beta = await api('get', endpoint, 'dk-beta').expect(200);
    assert.equal(beta.body.tenantId, 'beta');
    assert.equal(beta.body.domains.some(item => item.id === 'isis'), false);
    assert.equal(beta.body.articles.length, seed.articles.length);
    await runWithTenant('beta', async () => {
        assert.ok(fs.existsSync(path.join(getDataDir(), 'datacom-knowledge.db')));
    });
    const conflict = await api('post', `${endpoint}/domains`, 'dk-beta').send({ tenantId: 'default', domain: { id: 'x1', name: 'X' } }).expect(409);
    assert.equal(conflict.body.code, 'DATACOM_TENANT_CHANGED');
});
