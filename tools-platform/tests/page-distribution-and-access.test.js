const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-dist-access-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_BUILTIN_TOOLS_DIR = path.join(temp, 'builtins');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
fs.mkdirSync(process.env.TOOLS_DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.TOOLS_BUILTIN_TOOLS_DIR, { recursive: true });
fs.mkdirSync(process.env.TOOLS_REPORT_DATA_DIR, { recursive: true });

const tenant = require('../backend/models/tenant-context');
const pageDistribution = require('../backend/models/page-distribution');
const distribution = require('../backend/models/tool-distribution');
const customRepo = require('../backend/models/custom-tools-repository');
const skillStore = require('../backend/models/agent-skills-store');
const agentToolAccess = require('../backend/models/agent-tool-access');
const agentToolCatalog = require('../backend/models/agent-tool-catalog');
const agentToolRegistry = require('../backend/models/agent-tool-registry');
const platformGuides = require('../backend/models/platform-tool-guides');
const aiToolDataService = require('../backend/models/ai-tool-data-service');
const aiBusinessConfigService = require('../backend/models/ai-business-config-service');
const aiDatabaseAgent = require('../backend/models/ai-database-agent');
const capabilities = require('../backend/models/home-capabilities');
const sessions = require('../backend/models/auth-sessions-repository');
const usersRepo = require('../backend/models/auth-users-repository');
const aiSettingsRepo = require('../backend/models/ai-settings-repository');
const auth = require('../backend/middleware/auth');

const superAdmin = { username: 'admin', role: 'admin', isSuper: true, tenantId: 'default' };
const teamAdmin = { username: 'team1', role: 'admin', isSuper: false, tenantId: 'team1' };
const viewer = { username: 'viewer1', role: 'viewer', isSuper: false, tenantId: 'team1' };

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const actor = req.get('x-actor');
        req.user = actor === 'super' ? superAdmin : actor === 'viewer' ? viewer : teamAdmin;
        tenant.runWithTenant(req.user.tenantId, next);
    });
    app.use('/api', async (req, res, next) => {
        if (!await pageDistribution.canAccessApi(req.path, req.method, req.user)) {
            return res.status(403).json({ code: 'TOOL_NOT_SHARED', error: '此工具未开放使用' });
        }
        next();
    });
    app.use('/api/distribution', require('../backend/routes/distribution'));
    app.use('/api/custom-tools', require('../backend/routes/custom-tools'));
    app.use('/api/ai', require('../backend/routes/ai'));
    app.get('/api/frt/ping', (_req, res) => res.json({ ok: true }));
    app.get('/api/praudit/ping', (_req, res) => res.json({ ok: true }));
    app.get('/api/requirements/ping', (_req, res) => res.json({ ok: true }));
    app.get('/api/uiv/ping', (_req, res) => res.json({ ok: true }));
    app.get('/api/db/ping', (_req, res) => res.json({ ok: true }));
    app.get('/api/storage/ping', (_req, res) => res.json({ ok: true }));
    return app;
}

test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/platform-db').closeDatabase().catch(() => {});
    await require('../backend/models/control-db').closeDatabase().catch(() => {});
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('page distribution preserves current open/locked defaults and persists superadmin revocations across restarts', async () => {
    await pageDistribution.ensureDefaults();
    const app = makeApp();

    const superRes = await request(app).get('/api/distribution/pages').set('x-actor', 'super').expect(200);
    const pages = superRes.body.pages;
    const expectedOpen = ['uivf12', 'sla', 'report', 'expedite', 'monthly', 'ai-bi', 'duty-roster', 'bigscreen', 'topic-analysis', 'frt', 'requirements', 'praudit'];
    const expectedLocked = ['storage', 'db-explorer', 'netcare-explorer'];

    for (const id of expectedOpen) {
        const entry = pages.find(p => p.id === id);
        assert.equal(entry?.sharedAccess, true, `${id} should start open`);
        assert.equal(entry?.locked, false, `${id} should be toggleable`);
    }
    for (const id of expectedLocked) {
        const entry = pages.find(p => p.id === id);
        assert.equal(entry?.sharedAccess, false, `${id} should stay closed`);
        assert.equal(entry?.locked, true, `${id} should be locked`);
    }

    // Team admin cannot access locked pages or open them
    await request(app).patch('/api/distribution').set('x-actor', 'team').send({ kind: 'page', id: 'frt', sharedAccess: false }).expect(403);
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'storage', sharedAccess: true }).expect(403);
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'db-explorer', sharedAccess: true }).expect(403);
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'netcare-explorer', sharedAccess: true }).expect(403);
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'nonexistent', sharedAccess: true }).expect(404);
    await request(app).get('/api/storage/ping').set('x-actor', 'team').expect(403);
    await request(app).get('/api/storage/ping').set('x-actor', 'super').expect(200);

    // Revoke /frt and verify persistence across simulated restart (ensureDefaults again)
    await request(app).get('/api/frt/ping').set('x-actor', 'team').expect(200);
    const revokeRes = await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'frt', sharedAccess: false }).expect(200);
    assert.equal(revokeRes.body.sharedAccess, false);
    assert.equal(revokeRes.body.page.id, 'frt');
    assert.equal(revokeRes.body.page.sharedAccess, false);

    // Simulate server restart bootstrap
    await pageDistribution.ensureDefaults();
    assert.equal(await pageDistribution.canAccessPage('frt', teamAdmin), false, 'revoked page must stay closed after ensureDefaults');
    await request(app).get('/api/frt/ping').set('x-actor', 'team').expect(403);
    await request(app).get('/api/frt/ping').set('x-actor', 'super').expect(200);

    // Team user AI chat & platform guides reject/hide revoked /frt and locked /db-explorer
    await usersRepo.createUser({ username: 'team1', role: 'admin', passwordHash: 'x', tenantId: 'team1', isSuper: false });
    await sessions.saveSession('token-team1', 'team1', 'admin', Date.now() + 60000, 'team1');
    const origGetRuntime = aiSettingsRepo.getRuntimeSettings;
    const origGetSecrets = aiSettingsRepo.getRedactionSecrets;
    aiSettingsRepo.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, maxOutputTokens: 2048 });
    aiSettingsRepo.getRedactionSecrets = async () => [];
    try {
        const frtChatRes = await request(app).post('/api/ai/chat').set('Authorization', 'Bearer token-team1').send({
            pagePath: '/frt',
            messages: [{ role: 'user', content: 'hi' }]
        }).expect(403);
        assert.equal(frtChatRes.body.code, 'TOOL_NOT_SHARED');
        const dbChatRes = await request(app).post('/api/ai/chat').set('Authorization', 'Bearer token-team1').send({
            pagePath: '/db-explorer',
            messages: [{ role: 'user', content: 'hi' }]
        }).expect(403);
        assert.equal(dbChatRes.body.code, 'TOOL_NOT_SHARED');
    } finally {
        aiSettingsRepo.getRuntimeSettings = origGetRuntime;
        aiSettingsRepo.getRedactionSecrets = origGetSecrets;
    }

    const teamGuides = await platformGuides.catalog(teamAdmin);
    assert.equal(teamGuides.some(item => item.href === '/frt'), false, 'revoked /frt excluded from guides catalog');
    assert.equal(teamGuides.some(item => item.href === '/db-explorer'), false, '/db-explorer must never appear for non-super admin role=admin');
    assert.equal(await platformGuides.toolGuide('/frt', { user: teamAdmin }), null);
    const superGuides = await platformGuides.catalog(superAdmin);
    assert.equal(superGuides.some(item => item.href === '/frt'), true);
    assert.equal(superGuides.some(item => item.href === '/db-explorer'), true);

    // Re-open /frt restores access
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'frt', sharedAccess: true }).expect(200);
    await request(app).get('/api/frt/ping').set('x-actor', 'team').expect(200);
    assert.equal((await platformGuides.catalog(teamAdmin)).some(item => item.href === '/frt'), true);
});

test('custom tools routes, uivf12 script permissions, and float scripts enforce distribution', async () => {
    const app = makeApp();
    // Custom tool special routes must block team users when unshared
    await request(app).get('/api/custom-tools/tool-mumxi3px/products').set('x-actor', 'team').expect(403);
    await request(app).post('/api/custom-tools/f12-to-extension/licenses/lic-1/renew').set('x-actor', 'team').expect(403);
    await request(app).post('/api/custom-tools/f12-to-extension/scripts').set('x-actor', 'team').send({ name: 'test' }).expect(403);

    // Create & share tool-mumxi3px -> team admin can read its products
    await tenant.runWithTenant('default', () => customRepo.createTool({ slug: 'tool-mumxi3px', name: 'Quote', htmlContent: '<html><body>q</body></html>' }));
    await request(app).patch('/api/custom-tools/tool-mumxi3px/distribution').set('x-actor', 'super').send({ sharedAccess: true }).expect(200);
    await request(app).get('/api/custom-tools/tool-mumxi3px/products').set('x-actor', 'team').expect(200);
    await request(app).patch('/api/custom-tools/tool-mumxi3px/distribution').set('x-actor', 'super').send({ sharedAccess: false }).expect(200);
    await request(app).get('/api/custom-tools/tool-mumxi3px/products').set('x-actor', 'team').expect(403);

    // uivf12 revoked + no float caps -> UIV page, /uivf12?siteScripts=1, and agent UIV tools all blocked
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'uivf12', sharedAccess: false }).expect(200);
    assert.equal(await pageDistribution.canAccessPage('/uivf12', teamAdmin, { siteScripts: true }), false);
    assert.equal(await pageDistribution.canAccessUivScripts(teamAdmin), false);
    await request(app).get('/api/uiv/ping').set('x-actor', 'team').expect(403);

    const newSession = () => ({ loadedTools: new Set(), loadedSkills: new Set(), readOnly: false, owner: 'team1::team1' });
    const regRevoked = await tenant.runWithTenant('team1', () => agentToolRegistry.create({ session: newSession(), user: teamAdmin }));
    assert.equal(regRevoked.catalogPrompt().includes('list_uiv_scripts'), false, 'workspace UIV tools hidden from catalog when /uivf12 revoked');
    const uivSearchRevoked = await regRevoked.runMeta({ name: 'tool_search', args: { select: ['list_uiv_scripts'] } });
    assert.equal(uivSearchRevoked.isError, true, 'workspace UIV tool_search rejected when /uivf12 revoked');

    // Sharing a floating script capability grants siteScripts & UIV tools, while full /uivf12 stays closed
    await tenant.runWithTenant('default', () => require('../backend/models/uiv-scripts-repository').replaceAllScripts([
        { id: 'share-float', name: 'Float Ok', code: '/* float */', url: 'https://example.test/app' }
    ]));
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'cap', id: 'float:https://example.test', sharedAccess: true }).expect(200);
    assert.equal(await pageDistribution.canAccessPage('/uivf12', teamAdmin, { siteScripts: false }), false);
    assert.equal(await pageDistribution.canAccessPage('/uivf12', teamAdmin, { siteScripts: true }), true);
    assert.equal(await pageDistribution.canAccessUivScripts(teamAdmin), true);
    const regFloat = await tenant.runWithTenant('team1', () => agentToolRegistry.create({ session: newSession(), user: teamAdmin }));
    assert.equal(regFloat.catalogPrompt().includes('list_uiv_scripts'), true, 'workspace UIV tools visible when float cap shared');
    const uivSearchFloat = await regFloat.runMeta({ name: 'tool_search', args: { select: ['list_uiv_scripts'] } });
    assert.equal(Boolean(uivSearchFloat.isError), false, 'workspace UIV tool_search allowed when float cap shared');

    // Revoke float cap and restore uivf12
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'cap', id: 'float:https://example.test', sharedAccess: false }).expect(200);
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'uivf12', sharedAccess: true }).expect(200);
});

test('skill, tool-group, and grounding controls enforce revocation in both workspace and database agents', async () => {
    const app = makeApp();
    // 1. All skill toolsets appear in catalog for superadmin
    const fullCatalog = await agentToolCatalog.build({ user: superAdmin });
    assert.ok(fullCatalog.groups.some(s => s.id === 'family-finance-bookkeeper'));
    assert.ok(fullCatalog.groups.some(s => s.id === 'voice-creator'));
    assert.equal(agentToolAccess.groupFor('publish_html_tool'), 'publish_tools');
    assert.equal(agentToolAccess.groupFor('send_notification'), 'publish_tools');

    // 2. Revoking ppo-traffic skill blocks both ai-database-agent (without calling LLM -> check filtered definitions or tool block) & agentToolRegistry
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'skill', id: 'ppo-traffic', sharedAccess: true }).expect(200);
    const dbAccessBefore = await tenant.runWithTenant('team1', () => agentToolAccess.forActor(teamAdmin));
    assert.equal(dbAccessBefore('ppo_query_traffic_fines'), true);

    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'skill', id: 'ppo-traffic', sharedAccess: false }).expect(200);
    const visibleSkills = await tenant.runWithTenant('team1', () => skillStore.listForUser(teamAdmin));
    assert.equal(visibleSkills.some(s => s.id === 'ppo-traffic'), false);

    // 3. Disabling database group via agent_tool_access blocks database tools in ai-database-agent & agentToolRegistry
    await agentToolAccess.setAccess('group', 'database', false);
    const teamAccess = await tenant.runWithTenant('team1', () => agentToolAccess.forActor(teamAdmin));
    assert.equal(teamAccess('read_database_table'), false);
    assert.equal(teamAccess('insert_database_row'), false);
    const ws = await tenant.runWithTenant('team1', () => agentToolRegistry.create({
        session: { loadedTools: new Set(), loadedSkills: new Set(), readOnly: false, owner: 'team1::team1' },
        user: teamAdmin
    }));
    assert.equal(ws.catalogPrompt().includes('read_database_table'), false);
    const dbSearchDisabled = await ws.runMeta({ name: 'tool_search', args: { select: ['read_database_table'] } });
    assert.equal(dbSearchDisabled.isError, true);

    // Ensure aiDatabaseAgent omits database prompt and tools when database tools are disabled
    let seenSystemInstruction = '';
    let seenTools = [];
    const mockClient = {
        async generateText(options) {
            seenSystemInstruction = options.systemInstruction;
            seenTools = options.tools || [];
            return { text: 'ok', toolCalls: [] };
        }
    };
    await tenant.runWithTenant('team1', () => aiDatabaseAgent.runTurn({
        client: mockClient,
        systemInstruction: 'BASE',
        messages: [{ role: 'user', content: 'hi' }],
        ctx: { owner: 'team1::team1', user: teamAdmin, readOnly: false, toolAccess: teamAccess },
        signal: null
    }));
    assert.equal(seenSystemInstruction.includes('insert_database_row'), false, 'disabled database tools must not be injected in system prompt');
    assert.equal(seenTools.some(t => t.name === 'read_database_table'), false);
    await agentToolAccess.setAccess('group', 'database', true);

    // 4. Business config search filters uiv / metrics / unshared custom tools for team users
    await tenant.runWithTenant('default', () => customRepo.createTool({ slug: 'secret-tool-x', name: 'Secret Tool X', htmlContent: '<html><body>secret</body></html>' }));
    const toolDataResult = await tenant.runWithTenant('team1', () => aiToolDataService.analyzeQuestion('Secret Tool X 怎么样', { user: teamAdmin }));
    assert.equal((toolDataResult?.matchedTools || []).some(t => t.slug === 'secret-tool-x'), false);

    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'uivf12', sharedAccess: false }).expect(200);
    const cfg = await tenant.runWithTenant('team1', () => aiBusinessConfigService.search('uiv 脚本配置', { user: teamAdmin }));
    assert.equal((cfg.results || []).some(r => String(r.id || '').startsWith('uiv-')), false, 'UIV configs must be excluded when /uivf12 is not shared');
    await request(app).patch('/api/distribution').set('x-actor', 'super').send({ kind: 'page', id: 'uivf12', sharedAccess: true }).expect(200);
});

test('frontend home & nav access scripts pass syntax checks and preserve open/closed logic', async () => {
    const filesToCheck = [
        'frontend/js/shared/platform-core.js',
        'frontend/js/shared/platform-settings-controller.js',
        'frontend/js/home/workspace.js',
        'frontend/js/home/home-tools.js',
        'frontend/js/home/skill-hub.js',
        'frontend/js/home/home-shell.js',
        'frontend/js/home/tool-menu.js'
    ];
    for (const rel of filesToCheck) {
        const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        new vm.Script(src, { filename: rel });
    }
    const coreSrc = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/platform-core.js'), 'utf8');
    assert.match(coreSrc, /\/api\/distribution\/pages/);
    assert.match(coreSrc, /isPlatformPageShared/);
});

test('library and monthly-report APIs under /upload stay usable when only the monthly page is shared', async () => {
    await pageDistribution.setPageAccess('sla', false);
    await pageDistribution.setPageAccess('monthly', true);
    try {
        await tenant.runWithTenant('team1', async () => {
            assert.equal(await pageDistribution.canAccessApi('/upload/monthly-documents', 'GET', teamAdmin), true);
            assert.equal(await pageDistribution.canAccessApi('/upload/source-catalog', 'GET', teamAdmin), true);
        });
        await pageDistribution.setPageAccess('monthly', false);
        await tenant.runWithTenant('team1', async () => {
            assert.equal(await pageDistribution.canAccessApi('/upload/source-catalog', 'GET', teamAdmin), false, 'closed when neither page is shared');
        });
    } finally {
        await pageDistribution.setPageAccess('sla', true);
        await pageDistribution.setPageAccess('monthly', true);
    }
});
