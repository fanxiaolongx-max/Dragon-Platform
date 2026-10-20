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
process.env.TOOLS_BUILTIN_TOOLS_DIR = path.join(root, 'source');
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

test('manual comparison exposes market differences without automatic prompts; only explicit force applies the bundle', async () => {
    const { applyBuiltinToolDecisions } = require('../backend/models/builtin-tools-sync');
    const { fingerprintFiles } = require('../backend/models/tool-content-fingerprint');
    const sourceDir = path.join(root, 'source');
    fs.mkdirSync(path.join(sourceDir, 'sample'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'sample/index.html'), '<p>version 1</p>');
    fs.writeFileSync(path.join(sourceDir, 'sample/.tool-manifest.json'), JSON.stringify({ version: 1,
        tool: { slug: 'sample', name: 'Fixture', icon: '🧩', tags: [] } }));
    const targetDir = path.join(getDataDir('manual'), 'custom-tools');
    const source = previewBuiltinTools({ sourceDir, targetDir }).pending[0];
    applyBuiltinToolDecisions({ sourceDir, targetDir, applySlugs: ['sample'], expectedFingerprints: { sample: source.fingerprint } });
    const installedDir = path.join(targetDir, 'sample');
    const manifestPath = path.join(installedDir, '.tool-manifest.json');
    fs.writeFileSync(path.join(installedDir, 'index.html'), '<p>market version</p>');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.system.fingerprint = fingerprintFiles(installedDir, ['index.html', '.tool-manifest.json']);
    manifest.market = { id: 'official/sample', directoryFingerprint: manifest.system.fingerprint };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.writeFileSync(path.join(installedDir, 'user-note.txt'), 'keep me');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => runWithTenant('manual', () => { req.user = { role: req.headers['x-test-role'] || 'admin' }; next(); }));
    app.use('/api/custom-tools', router);
    const url = '/api/custom-tools/builtin-sync';
    await request(app).get(url + '/preview?manual=1').set('x-test-role', 'viewer').expect(403);
    const automatic = await request(app).get(url + '/preview').expect(200);
    assert.deepEqual(automatic.body.pending, []);
    const manual = await request(app).get(url + '/preview?manual=1').expect(200);
    assert.equal(manual.body.manual, true);
    assert.equal(manual.body.pending[0].currentSource, 'market');
    assert.equal(manual.body.pending[0].recommended, false);
    const body = { applySlugs: ['sample'], skipSlugs: [], expectedFingerprints: { sample: manual.body.pending[0].fingerprint } };
    const events = response => response.text.trim().split('\n').map(JSON.parse);
    const rejected = await request(app).post(url + '/apply-stream').send(body).expect(200);
    assert.equal(events(rejected).at(-1).status, 409);
    await request(app).post(url + '/apply-stream').set('x-test-role', 'viewer').send({ ...body, forceBundled: true }).expect(403);
    const stale = await request(app).post(url + '/apply-stream').send({ ...body, forceBundled: true, expectedFingerprints: { sample: 'stale' } }).expect(200);
    assert.equal(events(stale).at(-1).status, 409);
    assert.equal(fs.readFileSync(path.join(installedDir, 'index.html'), 'utf8'), '<p>market version</p>');
    const forced = await request(app).post(url + '/apply-stream').send({ ...body, forceBundled: true }).expect(200);
    const result = events(forced).at(-1).data;
    assert.deepEqual(result.updated, ['sample']);
    assert.deepEqual(result.skipped, []);
    assert.equal(fs.readFileSync(path.join(installedDir, 'index.html'), 'utf8'), '<p>version 1</p>');
    assert.equal(fs.readFileSync(path.join(installedDir, 'user-note.txt'), 'utf8'), 'keep me');
    assert.equal(fs.readFileSync(path.join(result.backups[0].path, 'index.html'), 'utf8'), '<p>market version</p>');
    assert.deepEqual((await request(app).get(url + '/preview').expect(200)).body.pending, []);
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

test('preview-stream endpoint checks admin role and streams progress and preview result', async () => {
    const sourceDir = path.join(root, 'source');
    fs.mkdirSync(path.join(sourceDir, 'sample'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'sample/index.html'), '<p>version 1</p>');
    fs.writeFileSync(path.join(sourceDir, 'sample/.tool-manifest.json'), JSON.stringify({ version: 1,
        tool: { slug: 'sample', name: 'Fixture', icon: '🧩', tags: [] } }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => runWithTenant('alpha', () => {
        req.user = { role: req.headers['x-test-role'] || 'admin' }; next();
    }));
    app.use('/api/custom-tools', router);
    const endpoint = '/api/custom-tools/builtin-sync/preview-stream?manual=1';
    await request(app).get(endpoint).set('x-test-role', 'viewer').expect(403);
    const response = await request(app).get(endpoint).expect(200);
    assert.match(response.headers['content-type'], /application\/x-ndjson/);
    assert.equal(response.headers['x-accel-buffering'], 'no');
    const events = response.text.trim().split('\n').map(JSON.parse);
    assert.ok(events.length >= 2, 'streams progress and final result');
    assert.ok(events.some(e => e.type === 'progress'));
    const resultEvent = events.find(e => e.type === 'result');
    assert.ok(resultEvent);
    assert.equal(resultEvent.data.manual, true);
    assert.ok(Array.isArray(resultEvent.data.tools));
});
