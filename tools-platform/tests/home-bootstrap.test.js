const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createHomeBootstrapHandler, normalizePath } = require('../backend/models/home-bootstrap');

// 最小应用：模拟“鉴权中间件 + 本机判断 + 若干首屏接口”，验证合并接口与单独请求行为一致
function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', (req, res, next) => {
        if (req.headers.authorization !== 'Bearer good') return res.status(401).json({ error: 'unauthorized' });
        req.user = { username: 'alice' };
        next();
    });
    app.post('/api/home/bootstrap', createHomeBootstrapHandler(app));
    app.get('/api/auth/me', (req, res) => { res.set('X-Data-Source', 'sqlite'); res.cookie('sid', 'x'); res.json({ user: req.user.username, tenant: req.headers['x-tenant-id'] || '' }); });
    app.get('/api/ai/sessions', (req, res) => res.json({ query: req.query }));
    // 本机判断依赖来源地址：子请求必须沿用原请求的连接
    app.get('/api/platform-promotions/desktop', (req, res) => res.json({ ip: req.socket.remoteAddress }));
    app.get('/api/tenants', (req, res) => { res.set('ETag', '"same"'); res.json({ fresh: true }); });
    app.get('/api/recent-nav', (req, res) => res.status(403).json({ error: 'forbidden' }));
    app.get('/api/favorite-nav', () => { throw new Error('boom'); });
    app.get('/api/upload/history', (req, res) => res.json({ leaked: true }));
    app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
    return app;
}

test('normalizePath only accepts whitelisted same-origin API paths', () => {
    assert.equal(normalizePath('/api/ai/sessions?mine=1&limit=40'), '/api/ai/sessions?mine=1&limit=40');
    assert.equal(normalizePath('/api/upload/history?limit=200'), null);
    assert.equal(normalizePath('/api/home/bootstrap'), null, 'no recursion');
    assert.equal(normalizePath('//evil.example/api/auth/me'), null);
    assert.equal(normalizePath('/api/../admin'), null);
    assert.equal(normalizePath(42), null);
});

test('bootstrap returns each sub-response as if requested on its own', async () => {
    const app = buildApp();
    const res = await request(app)
        .post('/api/home/bootstrap')
        .set('Authorization', 'Bearer good')
        .set('X-Tenant-Id', 't1')
        .set('If-None-Match', '"same"')
        .send({ paths: ['/api/auth/me', '/api/ai/sessions?mine=1&pagePath=%2F&limit=40&query=', '/api/platform-promotions/desktop', '/api/tenants', '/api/recent-nav', '/api/favorite-nav', '/api/upload/history?limit=200', '/api/auth/me'] });
    assert.equal(res.status, 200);
    const { results } = res.body;
    assert.deepEqual(Object.keys(results).sort(), ['/api/ai/sessions?mine=1&pagePath=%2F&limit=40&query=', '/api/auth/me', '/api/favorite-nav', '/api/platform-promotions/desktop', '/api/recent-nav', '/api/tenants'].sort(), 'non-whitelisted and duplicate paths are dropped');

    const me = results['/api/auth/me'];
    assert.equal(me.status, 200);
    assert.match(me.headers['content-type'], /application\/json/);
    assert.equal(me.headers['x-data-source'], 'sqlite', 'response headers callers read are passed through');
    assert.equal(me.headers['set-cookie'], undefined, 'cookies are never relayed');
    assert.deepEqual(JSON.parse(me.body), { user: 'alice', tenant: 't1' });

    assert.deepEqual(JSON.parse(results['/api/ai/sessions?mine=1&pagePath=%2F&limit=40&query='].body).query, { mine: '1', pagePath: '/', limit: '40', query: '' });
    assert.match(JSON.parse(results['/api/platform-promotions/desktop'].body).ip, /127\.0\.0\.1|::1/);
    assert.equal(results['/api/tenants'].status, 200, 'conditional headers are not forwarded, so no empty 304');
    assert.deepEqual(JSON.parse(results['/api/tenants'].body), { fresh: true });
    assert.equal(results['/api/recent-nav'].status, 403);
    assert.equal(results['/api/favorite-nav'].status, 500);
});

test('bootstrap itself requires auth, and sub-requests enforce their own auth', async () => {
    const app = buildApp();
    const denied = await request(app).post('/api/home/bootstrap').send({ paths: ['/api/auth/me'] });
    assert.equal(denied.status, 401);
    const empty = await request(app).post('/api/home/bootstrap').set('Authorization', 'Bearer good').send({});
    assert.deepEqual(empty.body, { results: {} });
});
