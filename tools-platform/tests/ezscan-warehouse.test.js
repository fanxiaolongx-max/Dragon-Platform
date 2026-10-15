'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ezscan-warehouse-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const pool = require('../backend/models/tenant-sqlite-pool');
const platformDb = require('../backend/models/platform-db');
const appDb = require('../backend/models/app-db');
const sessions = require('../backend/models/auth-sessions-repository');
const { checkAuth } = require('../backend/middleware/auth');
const { tenantMiddleware, runWithTenant, getDataDir } = require('../backend/models/tenant-context');
const repo = require('../backend/models/ezscan-warehouse-repository');
const router = require('../backend/routes/custom-tools');

const endpoint = '/api/custom-tools/tool-mv9strpn/warehouse';
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use('/api', checkAuth, tenantMiddleware);
app.use('/api/custom-tools', router);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));

function state(label = 'Warehouse product') {
    const timestamp = '2026-10-15T10:00:00.000Z';
    return {
        schema: 3, revision: 0,
        products: [{ id: 'p1', code: 'P001', name: label, spec: '', unit: '件', category: '其他', price: 20, min: 1 }],
        warehouses: [{ id: 'w1', code: 'WH001', name: '仓库', enabled: '启用' }],
        partners: [{ id: 's1', code: 'S001', name: '供应商', type: '供应商' }],
        opening: [{ product: 'p1', warehouse: 'w1', qty: 10 }],
        docs: [{ id: 'd1', type: '采购入库单', no: 'CG001', date: '2026-10-15', warehouse: 'w1',
            partner: 's1', operator: '管理员', status: '已审核', remark: '', created: timestamp, updated: timestamp,
            lines: [{ id: 'l1', product: 'p1', qty: 2, price: 20, actual: 0, sn: ['SN001', 'SN002'] }] }],
        scans: [{ id: 'scan1', code: 'p1', warehouse: 'w1', qty: 2, status: '已同步', time: timestamp }],
        receivables: [],
        payables: [{ id: 'bill1', docId: 'd1', code: 'AP001', partner: 's1', date: '2026-10-15', due: '2026-10-20',
            amount: 40, paid: 10, payments: [{ id: 'payment1', amount: 10, time: timestamp }] }],
        workflows: [], roles: [], logs: [{ id: 'log1', time: timestamp, action: '测试', detail: label }],
        ui: { tabs: ['首页', '其他入库单'], active: '首页' }, settings: { compact: false }
    };
}

function api(method, url = endpoint, token = 'warehouse-admin') {
    return request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

test.before(async () => {
    const expiry = Date.now() + 600000;
    await sessions.saveSession('warehouse-admin', 'admin', 'admin', expiry);
    await sessions.saveSession('warehouse-viewer', 'viewer', 'user', expiry);
    await sessions.saveSession('warehouse-beta', 'admin', 'admin', expiry, 'beta');
});

test.after(async () => {
    await pool.closeAll();
    await appDb.closeDatabase();
    await platformDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('warehouse API requires login, advertises readonly access and protects writes', async () => {
    await request(app).get(endpoint).expect(401);
    await request(app).put(endpoint).send({ data: state(), revision: 0 }).expect(401);
    await request(app).get(endpoint + '/database').expect(401);
    const response = await api('get', endpoint, 'warehouse-viewer').expect(200);
    assert.equal(response.body.canWrite, false);
    assert.equal(response.body.data, null);
    assert.equal(response.body.revision, 0);
    assert.equal(response.body.databaseFile, 'ezscan-warehouse.db');
    assert.match(response.headers['cache-control'], /no-store/);
    await api('put', endpoint, 'warehouse-viewer').send({ data: state('Denied'), revision: 0 }).expect(403);
    assert.equal((await api('get').expect(200)).body.data, null);
});

test('business records persist in an independent SQLite file across connection reopen', async () => {
    const data = state();
    const saved = await api('put').send({ data, revision: 0 }).expect(200);
    assert.equal(saved.body.success, true);
    assert.equal(saved.body.revision, 1);
    assert.ok(Number.isFinite(Date.parse(saved.body.updatedAt)));
    await pool.closeAll();
    const restored = await api('get').expect(200);
    assert.deepEqual(restored.body.data, data);
    assert.equal(restored.body.revision, 1);
    assert.equal(restored.body.canWrite, true);
    const dbFile = path.join(getDataDir(), 'ezscan-warehouse.db');
    assert.equal(fs.readFileSync(dbFile).subarray(0, 16).toString(), 'SQLite format 3\0');
    const ownDb = pool.getConnection('ezscan-warehouse.db');
    const tableNames = await new Promise((resolve, reject) => ownDb.all("SELECT name FROM sqlite_master WHERE type='table'", (error, rows) => error ? reject(error) : resolve(rows.map(row => row.name))));
    assert.ok(tableNames.length > 0);
    for (const table of tableNames) {
        assert.equal(await platformDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]), undefined);
    }
});

test('simultaneous writers use an atomic revision check and cannot overwrite newer data', async () => {
    const results = await Promise.all([
        api('put').send({ data: state('Window A'), revision: 1 }),
        api('put').send({ data: state('Window B'), revision: 1 })
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.findIndex(result => result.status === 200);
    const conflict = results.find(result => result.status === 409);
    assert.equal(conflict.body.code, 'WAREHOUSE_REVISION_CONFLICT');
    const loaded = await api('get').expect(200);
    assert.equal(loaded.body.revision, 2);
    assert.equal(loaded.body.data.products[0].name, winner === 0 ? 'Window A' : 'Window B');
});

test('invalid backup structures, broken references and missing revisions leave saved data intact', async () => {
    const invalid = [
        { ...state(), schema: 2 },
        { ...state(), products: {} },
        { ...state(), opening: [{ product: 'missing', warehouse: 'w1', qty: 20 }] },
        { ...state(), products: [...state().products, state().products[0]] },
        { ...state(), payables: [{ ...state().payables[0], paid: 1000 }] },
        { ...state(), docs: [{ ...state().docs[0], lines: [{ ...state().docs[0].lines[0], qty: -5 }] }] }
    ];
    const before = (await api('get').expect(200)).body;
    for (const data of invalid) await api('put').send({ data, revision: before.revision }).expect(400);
    for (const revision of [undefined, '2', -1, 0.5]) await api('put').send({ data: state(), revision }).expect(400);
    assert.deepEqual((await api('get').expect(200)).body.data, before.data);
    assert.equal((await api('get').expect(200)).body.revision, before.revision);
});

test('draft fields may remain incomplete while autosaving', async () => {
    const draft = state('Draft with empty numeric inputs');
    draft.docs[0].status = '草稿';
    draft.docs[0].date = '';
    draft.payables = []; // A draft cannot retain an automatic bill from an approved document.
    Object.assign(draft.docs[0].lines[0], { qty: '', price: '', actual: '' });
    await api('put').send({ data: draft, revision: 2 }).expect(200);
    assert.deepEqual((await api('get').expect(200)).body.data, draft);
});

test('tenant context comes from session and keeps warehouse files and records isolated', async () => {
    const beta = await api('get', endpoint + '?tenantId=default', 'warehouse-beta').expect(200);
    assert.equal(beta.body.data, null);
    await api('put', endpoint, 'warehouse-beta').send({ data: state('Beta private'), revision: 0 }).expect(200);
    assert.equal((await api('get', endpoint + '?tenantId=beta').expect(200)).body.data.products[0].name, 'Draft with empty numeric inputs');
    assert.equal((await api('get', endpoint, 'warehouse-beta').expect(200)).body.data.products[0].name, 'Beta private');
    assert.ok(fs.existsSync(path.join(getDataDir('beta'), 'ezscan-warehouse.db')));
    assert.notEqual(getDataDir('beta'), getDataDir());
});

test('an old tab cannot save or download against a newly selected session tenant', async () => {
    const current = await api('get', endpoint, 'warehouse-beta').expect(200);
    assert.equal(current.body.tenantId, 'beta');
    const staleSave = await api('put', endpoint, 'warehouse-beta')
        .send({ data: state('Wrong tenant'), revision: current.body.revision, tenantId: 'default' }).expect(409);
    assert.equal(staleSave.body.code, 'WAREHOUSE_TENANT_CHANGED');
    await api('get', endpoint + '/database?tenantId=default', 'warehouse-beta').expect(409);
    await api('put', endpoint, 'warehouse-beta').send({ data: { ...state(), _serverStorage: { tenantId: 'default' } }, revision: current.body.revision }).expect(409);
    assert.equal((await api('get', endpoint, 'warehouse-beta').expect(200)).body.data.products[0].name, 'Beta private');
});

test('download is a standalone consistent SQLite snapshot including WAL data', async () => {
    const response = await api('get', endpoint + '/database', 'warehouse-beta')
        .buffer(true).parse((res, done) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
        }).expect(200);
    assert.match(response.headers['content-disposition'], /ezscan-warehouse.*\.db/);
    assert.equal(response.body.subarray(0, 16).toString(), 'SQLite format 3\0');
    // Open the downloaded snapshot as another isolated tenant, without any WAL sidecars.
    fs.mkdirSync(getDataDir('download-check'), { recursive: true });
    fs.writeFileSync(path.join(getDataDir('download-check'), 'ezscan-warehouse.db'), response.body);
    const downloaded = await runWithTenant('download-check', () => repo.loadState());
    assert.equal(downloaded.data.products[0].name, 'Beta private');
    assert.equal(downloaded.revision, 1);
});

test('sample-data API appends idempotently, isolates tenants and removes only samples', async () => {
    await sessions.saveSession('samples-admin', 'admin', 'admin', Date.now() + 600000, 'samples');
    const url = endpoint + '/sample-data';
    await api('post', url, 'warehouse-viewer').send({ action: 'add', revision: 0 }).expect(403);
    await api('put', endpoint, 'samples-admin').send({ data: state('Real warehouse record'), revision: 0 }).expect(200);
    const added = await api('post', url, 'samples-admin').send({ action: 'add', revision: 1, tenantId: 'samples' }).expect(200);
    assert.equal(added.body.revision, 2);
    assert.equal(added.body.data.products.length, 7);
    assert.equal(added.body.data.docs.length, 43);
    assert.equal(added.body.data.products[0].name, 'Real warehouse record');
    const again = await api('post', url, 'samples-admin').send({ action: 'add', revision: 2 }).expect(200);
    assert.equal(again.body.unchanged, true);
    assert.equal(again.body.revision, 2);
    await api('post', url, 'samples-admin').send({ action: 'add', revision: 1 }).expect(409);
    await api('post', url, 'samples-admin').send({ action: 'add', revision: 2, tenantId: 'default' }).expect(409);
    const removed = await api('post', url, 'samples-admin').send({ action: 'remove', revision: 2 }).expect(200);
    assert.equal(removed.body.revision, 3);
    assert.equal(removed.body.data.products.length, 1);
    assert.equal(removed.body.data.products[0].name, 'Real warehouse record');
    assert.equal((await api('get', endpoint, 'warehouse-beta').expect(200)).body.data.products.length, 1);
});

test('sample cleanup refuses references from formal data without deleting records', async () => {
    const token = 'samples-admin';
    const added = await api('post', endpoint + '/sample-data', token).send({ action: 'add', revision: 3 }).expect(200);
    const data = added.body.data;
    data.opening.push({ product: data.products[0].id, warehouse: data.warehouses[1].id, qty: 5 });
    await api('put', endpoint, token).send({ data, revision: 4 }).expect(200);
    const denied = await api('post', endpoint + '/sample-data', token).send({ action: 'remove', revision: 5 }).expect(400);
    assert.equal(denied.body.code, 'WAREHOUSE_SAMPLE_REFERENCED');
    assert.equal((await api('get', endpoint, token).expect(200)).body.data.products.length, 7);
});
