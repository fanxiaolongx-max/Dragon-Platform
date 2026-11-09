const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-distribution-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_BUILTIN_TOOLS_DIR = path.join(temp, 'builtins');
const tenant = require('../backend/models/tenant-context');
const repo = require('../backend/models/custom-tools-repository');
const distribution = require('../backend/models/tool-distribution');
const skillStore = require('../backend/models/agent-skills-store');
const capabilities = require('../backend/models/home-capabilities');
const f12 = require('../backend/models/f12-distribution');
const admin = { username: 'admin', role: 'admin', isSuper: true, tenantId: 'default' };
const member = { username: 'alice', role: 'admin', isSuper: false, tenantId: 'alice' };

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    req.user = req.get('x-admin') === '1' ? admin : { ...member, username: req.get('x-tenant') || member.username };
    tenant.runWithTenant(req.get('x-tenant') || req.user.tenantId, next);
});
app.use('/api/custom-tools', require('../backend/routes/custom-tools'));
app.use('/api/distribution', require('../backend/routes/distribution'));
app.use('/api/agent-skills', require('../backend/routes/agent-skills'));
app.use('/api/python-updater', require('../backend/routes/python-updater'));
app.use('/api/uiv', require('../backend/routes/uiv'));
app.use('/api/requirements', require('../backend/routes/requirements'));
const asAdmin = req => req.set('x-admin', '1');

test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('HTML tools are opt-in, update from the platform, and keep tenant data separate', async () => {
    const html = message => `<html><body>${message}</body></html>`;
    const uploaded = await repo.createTool({ slug: 'upload-fixture', name: 'Uploaded', htmlContent: html('uploaded') });
    const bundled = await repo.createTool({ slug: 'bundle-fixture', name: 'Bundled', htmlContent: html('platform') });
    const bundledDir = path.join(process.env.TOOLS_BUILTIN_TOOLS_DIR, bundled.slug);
    fs.mkdirSync(bundledDir, { recursive: true });
    fs.writeFileSync(path.join(bundledDir, '.tool-manifest.json'), JSON.stringify({ version: 1, tool: { slug: bundled.slug } }));
    await tenant.runWithTenant('alice', () => repo.createTool({ slug: bundled.slug, name: 'Legacy copy', htmlContent: html('old tenant copy') }));

    const access = slug => `/api/custom-tools/${slug}/distribution`;
    assert.equal((await request(app).get('/api/custom-tools')).body.length, 0);
    await request(app).get(`/api/custom-tools/${bundled.slug}`).expect(404);
    await request(app).patch(access(uploaded.slug)).send({ sharedAccess: true }).expect(403);
    await request(app).get('/api/custom-tools/market/settings').expect(403);
    assert.equal((await asAdmin(request(app).get('/api/custom-tools/market/settings'))).body.githubEnabled, false);
    for (const tool of [uploaded, bundled]) await asAdmin(request(app).patch(access(tool.slug))).send({ sharedAccess: true }).expect(200);
    assert.deepEqual((await request(app).get('/api/custom-tools')).body.map(tool => tool.name), ['Bundled']);
    assert.deepEqual((await request(app).get('/api/custom-tools/market/platform')).body.tools.map(tool => tool.name).sort(), ['Bundled', 'Uploaded']);
    await request(app).get(`/api/custom-tools/${uploaded.slug}`).expect(200);
    const resolve = slug => tenant.runWithTenant('alice', () => distribution.resolveTool(slug, member));
    assert.equal((await resolve(bundled.slug)).sourceTenant, 'default');
    await repo.createTool({ updateSlug: bundled.slug, htmlContent: html('platform update') });
    assert.match(fs.readFileSync(await tenant.runWithTenant((await resolve(bundled.slug)).sourceTenant, () => repo.getToolFilePath(bundled.slug)), 'utf8'), /platform update/);

    const statePath = `/api/custom-tools/${uploaded.slug}/state`;
    await request(app).put(statePath).send({ data: { monday: [{ title: 'team-only' }] } }).expect(200);
    assert.notEqual((await request(app).get(statePath)).body.updatedAt, null);
    assert.equal((await request(app).get(statePath).set('x-tenant', 'bob')).body.updatedAt, null);
    assert.equal((await asAdmin(request(app).get(statePath))).body.updatedAt, null);
    await asAdmin(request(app).patch(access(uploaded.slug))).send({ sharedAccess: false }).expect(200);
    await request(app).get(statePath).expect(403);
    assert.equal(await resolve(uploaded.slug), null);
});

test('skills disappear from detail, download, and AI loading when sharing is revoked', async () => {
    const key = '/api/agent-skills/debug';
    const change = sharedAccess => asAdmin(request(app).patch('/api/distribution')).send({ kind: 'skill', id: 'debug', sharedAccess }).expect(200);
    const load = () => tenant.runWithTenant('alice', () => skillStore.loadAll('@debug', { user: member, hasWorkspace: true }));
    await request(app).get(key).expect(404);
    assert.equal((await load()).selected.length, 0);
    await change(true);
    assert.ok((await request(app).get('/api/agent-skills')).body.items.some(item => item.id === 'debug'));
    await request(app).get(key).expect(200);
    await request(app).get(key + '/export').expect(200);
    assert.ok((await load()).selected.some(item => item.id === 'debug'));
    await request(app).get(key + '/backups').expect(404);
    await change(false);
    await request(app).get(key + '/export').expect(404);
    assert.equal((await load()).selected.length, 0);
});

test('individual F12 assets, Python scripts and floating script groups follow the same access policy', async () => {
    const change = (id, sharedAccess) => asAdmin(request(app).patch('/api/distribution')).send({ kind: 'cap', id, sharedAccess }).expect(200);
    await asAdmin(request(app).patch('/api/distribution'))
        .send({ kind: 'cap', id: 'python:missing-script', sharedAccess: true }).expect(404);
    const all = () => tenant.runWithTenant('alice', async () => (await capabilities.listCapabilities({ user: member })).groups.flatMap(group => group.items));
    assert.deepEqual(await all(), []);
    const f12Id = 'f12:builtin:sv-cfc-monitor';
    await change(f12Id, true);
    assert.ok((await all()).some(item => item.id === f12Id));
    assert.deepEqual(Object.keys((await f12.assetResponse('builtin-catalog.js')).catalog), ['sv-cfc-monitor']);
    assert.equal((await f12.assetResponse('exam-question-bank-assistant.js')).blocked, true);
    assert.equal((await f12.assetResponse('default-f12.js')).blocked, undefined);
    const personalFile = Buffer.from('// personal script');
    await request(app).patch('/api/distribution/capability-file').send({ id: f12Id, data: personalFile.toString('base64') }).expect(200);
    const personalAsset = () => tenant.runWithTenant('alice', () => f12.assetResponse('default-f12.js', member));
    assert.deepEqual((await personalAsset()).bytes, personalFile);
    assert.equal((await tenant.runWithTenant('bob', () => f12.assetResponse('default-f12.js', { ...member, username: 'bob' }))).bytes, undefined);
    await request(app).patch('/api/distribution/personal').send({ kind: 'cap', id: f12Id, action: 'hide' }).expect(200);
    assert.equal((await personalAsset()).blocked, true);
    await request(app).patch('/api/distribution/personal').send({ kind: 'cap', id: f12Id, action: 'restore' }).expect(200);
    assert.equal((await personalAsset()).bytes, undefined);
    await change(f12Id, false);
    assert.equal((await f12.assetResponse('default-f12.js')).blocked, true);

    const py = 'pr-audit-sampler';
    const pythonPath = `/api/python-updater/scripts/${py}`;
    await request(app).get(pythonPath).expect(404);
    await change(`python:${py}`, true);
    await request(app).get(pythonPath).expect(200);
    const versions = (await request(app).get(pythonPath + '/versions')).body.versions;
    const versionPath = `/api/python-updater/versions/${versions[0].id}`;
    await request(app).get(versionPath).expect(200);
    await request(app).post('/api/python-updater/scripts').send({ id: py, name: 'My Python', code: 'print("personal")', version: '8.0.0' }).expect(200);
    assert.equal((await request(app).get(pythonPath)).body.script.code, 'print("personal")');
    assert.notEqual((await asAdmin(request(app).get(pythonPath))).body.script.code, 'print("personal")');
    await change(`python:${py}`, false);
    await request(app).get(versionPath).expect(404);

    await require('../backend/models/uiv-scripts-repository').replaceAllScripts([{ id: 'share-float', name: 'Fixture script', code: '/* fixture */', url: 'https://example.test/path' }]);
    await tenant.runWithTenant('alice', () => require('../backend/models/uiv-scripts-repository').replaceAllScripts([]));
    await change('float:https://example.test', true);
    const shared = (await request(app).get('/api/uiv/scripts')).body.scripts.find(item => item.id === 'share-float');
    assert.ok(shared);
    await request(app).post('/api/uiv/scripts').send({ items: [{ ...shared, code: '/* personal revision */' }] }).expect(200);
    assert.equal((await request(app).get('/api/uiv/scripts')).body.scripts.find(item => item.id === 'share-float').code, '/* personal revision */');
    assert.equal((await asAdmin(request(app).get('/api/uiv/scripts'))).body.scripts.find(item => item.id === 'share-float').code, '/* fixture */');
    await change('float:https://example.test', false);
    assert.equal((await request(app).get('/api/uiv/scripts')).body.scripts.length, 0);

    // Quick Start can create an independent copy with the same bundled ID.
    await tenant.runWithTenant('alice', () => require('../backend/models/uiv-scripts-repository').replaceAllScripts([
        { ...shared, shared: undefined, name: 'Local Quick Start copy', code: '/* local */' }
    ]));
    const local = (await request(app).get('/api/uiv/scripts').expect(200)).body.scripts;
    assert.deepEqual(local.map(item => item.name), ['Local Quick Start copy']);
    assert.ok((await all()).some(item => item.id === 'float:https://example.test' && item.badge === '1'));
    await request(app).post('/api/uiv/scripts').send({ items: [{ ...local[0], code: '/* local edit */' }] }).expect(200);
    assert.equal((await request(app).get('/api/uiv/scripts')).body.scripts[0].code, '/* local edit */');
    assert.equal((await asAdmin(request(app).get('/api/uiv/scripts'))).body.scripts[0].code, '/* fixture */');
    assert.deepEqual((await request(app).get('/api/uiv/scripts').set('x-tenant', 'bob')).body.scripts, []);
});


test('personal tool rename, update, deletion and market restore never change the platform file', async () => {
    const tool = await repo.createTool({ slug: 'personal-copy', name: 'Platform title', htmlContent: '<html><body>upstream</body></html>' });
    const url = `/api/custom-tools/${tool.slug}`;
    await asAdmin(request(app).patch(url + '/distribution')).send({ sharedAccess: true }).expect(200);
    const restore = () => request(app).patch('/api/distribution/personal').send({ kind: 'tool', id: tool.slug, action: 'restore' }).expect(200);
    await restore();
    await request(app).patch(url + '/name').send({ name: 'My title' }).expect(200);
    assert.equal((await request(app).get(url)).body.name, 'My title');
    await request(app).post('/api/custom-tools').send({ updateSlug: tool.slug, htmlContent: '<html><body>personal revision</body></html>' }).expect(200);
    const source = () => tenant.runWithTenant('alice', () => distribution.resolveTool(tool.slug, member));
    assert.equal((await source()).sourceTenant, 'alice');
    assert.equal((await request(app).get(url)).body.name, 'My title');
    assert.equal((await asAdmin(request(app).get(url))).body.name, 'Platform title');
    assert.match(fs.readFileSync(await repo.getToolFilePath(tool.slug), 'utf8'), /upstream/);
    await request(app).delete(url).expect(200);
    assert.equal(await source(), null);
    assert.equal((await request(app).get('/api/custom-tools/market/platform')).body.tools.find(item => item.slug === tool.slug).hidden, true);
    await restore();
    assert.equal((await source()).sourceTenant, 'default');
    assert.equal((await request(app).get(url)).body.name, 'My title');
});

test('skill improvements remain personal until an administrator approves a publication and can roll it back', async () => {
    const id = 'debug';
    const skillUrl = '/api/agent-skills/' + id;
    await asAdmin(request(app).patch('/api/distribution')).send({ kind: 'skill', id, sharedAccess: true }).expect(200);
    const original = (await asAdmin(request(app).get(skillUrl))).body.skill.markdown;
    const candidate = original + '\n\nPersonal improvement fixture.\n';
    await request(app).post('/api/agent-skills').send({ skillMd: candidate, overwrite: true }).expect(200);
    assert.match((await request(app).get(skillUrl)).body.skill.markdown, /Personal improvement fixture/);
    assert.doesNotMatch((await request(app).get(skillUrl).set('x-tenant', 'bob')).body.skill.markdown, /Personal improvement fixture/);
    await request(app).delete(skillUrl).expect(200);
    await request(app).get(skillUrl).expect(404);
    await request(app).get(skillUrl).set('x-tenant', 'bob').expect(200);
    await request(app).patch('/api/distribution/personal').send({ kind: 'skill', id, action: 'restore' }).expect(200);
    assert.match((await request(app).get(skillUrl)).body.skill.markdown, /Personal improvement fixture/);

    const { body } = await request(app).post('/api/requirements/skill-publications').send({ skillId: id, reason: 'More useful checks' }).expect(200);
    const requestUrl = `/api/requirements/${body.id}`;
    assert.equal((await request(app).get(requestUrl).set('x-tenant', 'bob')).body.skillPublication.markdown, undefined);
    await request(app).post(requestUrl + '/approve-skill').expect(403);
    await asAdmin(request(app).post(requestUrl + '/approve-skill')).expect(200);
    await asAdmin(request(app).post(requestUrl + '/approve-skill')).expect(200);
    assert.match((await asAdmin(request(app).get(skillUrl))).body.skill.markdown, /Personal improvement fixture/);
    assert.match((await request(app).get(skillUrl).set('x-tenant', 'bob')).body.skill.markdown, /Personal improvement fixture/);
    const { backups } = (await asAdmin(request(app).get(skillUrl + '/backups'))).body;
    assert.equal(backups.length, 1);
    await asAdmin(request(app).post(skillUrl + '/rollback/' + backups[0].id)).expect(200);
    assert.doesNotMatch((await request(app).get(skillUrl)).body.skill.markdown, /Personal improvement fixture/);
    assert.doesNotMatch((await request(app).get(skillUrl).set('x-tenant', 'bob')).body.skill.markdown, /Personal improvement fixture/);
});
