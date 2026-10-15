const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-update-route-'));
process.env.TOOLS_DATA_DIR = path.join(root, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(root, 'reports');
const service = require('../backend/models/builtin-tools-update-service');
const apply = service.applyBuiltinToolsInWorker;
// Use tiny bundled fixtures while exercising the real worker, route and SQLite registry.
service.applyBuiltinToolsInWorker = (options, callbacks) => apply({ ...options, sourceDir: path.join(root, 'source') }, callbacks);
const { runWithTenant, getDataDir } = require('../backend/models/tenant-context');
const repo = require('../backend/models/custom-tools-repository');
const { previewBuiltinTools } = require('../backend/models/builtin-tools-sync');
const router = require('../backend/routes/custom-tools');
const { closeDatabase } = require('../backend/models/app-db');
test.after(async () => {
    service.applyBuiltinToolsInWorker = apply;
    await closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(root, { recursive: true, force: true });
});

test('stream endpoint keeps admin checks, tenant paths and result/error contracts', async () => {
    const sourceDir = path.join(root, 'source');
    fs.mkdirSync(path.join(sourceDir, 'sample'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'sample/index.html'), '<p>version 1</p>');
    fs.writeFileSync(path.join(sourceDir, 'sample/.tool-manifest.json'), JSON.stringify({ version: 1,
        tool: { slug: 'sample', name: 'Fixture', icon: '🧩', tags: [] } }));
    const fingerprint = previewBuiltinTools({ sourceDir, targetDir: path.join(root, 'scratch') }).pending[0].fingerprint;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => runWithTenant(req.headers['x-test-tenant'] || 'alpha', () => {
        req.user = { role: req.headers['x-test-role'] || 'admin' }; next();
    }));
    app.use('/api/custom-tools', router);
    const endpoint = '/api/custom-tools/builtin-sync/apply-stream';
    const body = { applySlugs: ['sample'], expectedFingerprints: { sample: fingerprint } };
    await request(app).post(endpoint).set('x-test-role', 'viewer').send(body).expect(403);
    const response = await request(app).post(endpoint).send(body).expect(200);
    assert.match(response.headers['content-type'], /application\/x-ndjson/);
    assert.equal(response.headers['x-accel-buffering'], 'no');
    const events = response.text.trim().split('\n').map(JSON.parse);
    assert.equal(events[0].stage, 'validating');
    assert.equal(events.at(-2).stage, 'indexing');
    assert.equal(events.at(-1).type, 'result');
    assert.deepEqual(events.at(-1).data.installed, ['sample']);
    assert.equal(events.at(-1).data.success, true);
    assert.equal(events.at(-1).data.preview, undefined);
    await runWithTenant('alpha', async () => { assert.equal((await repo.listTools())[0].slug, 'sample'); });
    assert.equal(fs.existsSync(path.join(getDataDir('default'), 'custom-tools/sample')), false);
    assert.equal(fs.existsSync(path.join(getDataDir('beta'), 'custom-tools/sample')), false);

    const failed = await request(app).post(endpoint).set('x-test-tenant', 'beta')
        .send({ ...body, expectedFingerprints: { sample: 'stale' } }).expect(200);
    const error = failed.text.trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(error.type, 'error');
    assert.equal(error.status, 409);
    assert.equal(fs.existsSync(path.join(getDataDir('beta'), 'custom-tools/sample')), false);
    const legacy = await request(app).post('/api/custom-tools/builtin-sync/apply').set('x-test-tenant', 'beta').send(body).expect(200);
    assert.deepEqual(legacy.body.installed, ['sample']);
    assert.equal(legacy.body.preview.pending.length, 0);
});
