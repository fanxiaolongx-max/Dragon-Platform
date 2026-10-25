const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-history-pages-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const repo = require('../backend/models/channels/ops-repository');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const platformDb = require('../backend/models/platform-db');
const sessions = require('../backend/models/auth-sessions-repository');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const { checkAuth } = require('../backend/middleware/auth');
const app = express();
app.use('/api', checkAuth, tenantMiddleware);
app.use('/api/channels', require('../backend/routes/channels'));
const get = (url, token = 'admin-test') => request(app).get(`/api/channels/ops${url}`).set('Authorization', `Bearer ${token}`);

test.before(async () => {
    for (const [token, role, tenant] of [['admin-test', 'admin', 'default'], ['viewer-test', 'readonly', 'default'], ['other-test', 'admin', 'other']]) {
        await sessions.saveSession(token, token, role, Date.now() + 60000, tenant);
    }
    for (let index = 0; index < 45; index++) {
        await repo.createRun({ planId: 'plan-one', planName: '运营计划', status: index % 4 === 0 ? 'draft' : 'sent', content: `record ${index}` });
    }
    // 同毫秒批量生成时也必须有稳定的第二排序键。
    await appDb.run("UPDATE ops_runs SET created_at = '2026-10-25T10:00:00.000Z'");
});

test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    await platformDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('history pages cover all retained records with stable ordering and accurate counts', async () => {
    const ids = [];
    for (const [page, count] of [[1, 20], [2, 20], [3, 5]]) {
        const response = await get(`/runs?page=${page}&pageSize=20`).expect(200);
        assert.match(response.headers['cache-control'], /no-store/);
        const result = response.body;
        assert.equal(result.page, page);
        assert.equal(result.pageSize, 20);
        assert.equal(result.total, 45);
        assert.equal(result.totalPages, 3);
        assert.equal(result.items.length, count);
        ids.push(...result.items.map(item => item.id));
    }
    assert.equal(new Set(ids).size, 45);
    const expected = await appDb.all('SELECT id FROM ops_runs ORDER BY created_at DESC, id DESC');
    assert.deepEqual(ids, expected.map(row => row.id));
    const overview = (await get('/overview?runPage=3&runPageSize=20').expect(200)).body;
    assert.deepEqual(overview.runs.map(item => item.id), ids.slice(40));
    assert.deepEqual(overview.runsPagination, { total: 45, page: 3, pageSize: 20, totalPages: 3 });
    assert.equal(overview.draftCounts['plan-one'], 12, 'plan draft badges count all pages');
    assert.equal((await get('/overview').expect(200)).body.runs.length, 40, 'existing overview clients retain the default limit');
});

test('invalid and out-of-range paging values are bounded; empty tenants have one empty page', async () => {
    for (const page of ['-3', 'NaN', 'Infinity']) {
        assert.equal((await get(`/runs?page=${page}`).expect(200)).body.page, 1);
    }
    assert.equal((await get('/runs?page=999').expect(200)).body.page, 3);
    assert.equal((await get('/runs?pageSize=100000').expect(200)).body.pageSize, 100);
    for (const size of ['-1', '0', 'NaN', 'Infinity']) {
        assert.equal((await get(`/runs?pageSize=${size}`).expect(200)).body.pageSize, 20);
    }
    const empty = (await get('/runs?page=999', 'other-test').expect(200)).body;
    assert.deepEqual(empty, { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
});

test('history APIs require an admin and never expose another tenant records', async () => {
    await request(app).get('/api/channels/ops/runs').expect(401);
    await get('/runs', 'viewer-test').expect(403);
    await get('/overview', 'viewer-test').expect(403);
    await runWithTenant('other', () => repo.createRun({ planId: 'other-plan', status: 'draft', content: 'other tenant only' }));
    const other = (await get('/runs', 'other-test').expect(200)).body;
    assert.equal(other.total, 1);
    assert.equal(other.items[0].content, 'other tenant only');
    const otherOverview = (await get('/overview', 'other-test').expect(200)).body;
    assert.deepEqual(otherOverview.draftCounts, { 'other-plan': 1 });
    assert.equal((await get('/runs').expect(200)).body.total, 45);
});
