const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'uiv-agent-workflow-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const db = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const tenant = require('../backend/models/tenant-context');
const service = require('../backend/models/agent-script-service');
const tools = require('../backend/models/agent-tools-service');
const scripts = require('../backend/models/uiv-scripts-repository');
const categories = require('../backend/models/uiv-categories-repository');
const profiles = require('../frontend/js/shared/uiv-site-profiles');
const ctx = { readOnly: false, sensitiveValues: [] };
const cn = profiles.find(site => site.id === 'cn').origin;
const ae = profiles.find(site => site.id === 'ae').origin;
const sourceCode = `return (async function () {
    const targetRegion = "北部非洲地区部";
    const targetOffice = "埃及代表处";
    const finalOutputName = "Source_Latest.csv";
    const endpoint = "${cn}/api/list?page=1";
    const detailEndpoint = "${cn}/api/detail";
    const unrelated = "https://netcare.huawei.com.evil.example/keep";
    /* ${'保留完整抓取逻辑'.repeat(1500)} */
    const rows = await fetch(endpoint);
    return { rows, detailEndpoint, targetRegion, targetOffice, finalOutputName, unrelated };
})();`;
const original = { id: 'source-cn', name: 'Source', category: 'NetCare中国', url: `${cn}/api/list?page=1`,
    code: sourceCode, consoleCode: sourceCode, payload: '{"region":"北部非洲地区部","office":"埃及代表处","page":1}',
    configOptions: { isPagination: true, autoFetchCPC: true }, futureSettings: { preserve: ['unknown-field'] } };

async function insert(script, row = script) {
    await db.run('INSERT INTO uiv_scripts (id,name,category,url,payload_json) VALUES (?,?,?,?,?)', [row.id, row.name, row.category, row.url, JSON.stringify(script)]);
}

test.before(async () => {
    for (const id of ['default', 'other']) await tenant.runWithTenant(id, async () => {
        await db.run('CREATE TABLE uiv_scripts (id TEXT PRIMARY KEY, name TEXT, category TEXT, url TEXT, payload_json TEXT, updated_at TEXT)');
        await categories.listCategories();
        await insert(original);
    });
});
test.after(async () => {
    await pool.closeAll();
    await db.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('site clone uses the same profiles as frontend generation, preserves complete code and data filters, and returns auditable state', async () => {
    const before = await service.read(ctx, { id: original.id });
    const preview = await tools.preview(ctx, 'save_uiv_script', { action: 'clone', sourceId: original.id,
        expectedRevision: before.revision, targetSite: 'ae', changes: '{"name":"MiddleEast-DragonClaw"}' });
    assert.equal(JSON.parse(preview.diff).category, 'NetCare中东');
    assert.equal((await db.get('SELECT count(*) AS count FROM uiv_scripts')).count, 1, 'preview never saves');
    const saved = await service.save(ctx, { action: 'clone', sourceId: original.id, expectedRevision: before.revision,
        targetSite: 'ae', changes: '{"name":"MiddleEast-DragonClaw"}' });
    assert.equal(saved.committed && saved.verified, true);
    assert.equal(saved.summary.category, 'NetCare中东');
    assert.deepEqual(saved.summary.regionalDefaults.code, { targetRegion: '北部非洲地区部', targetOffice: '埃及代表处' });
    const stored = JSON.parse((await db.get('SELECT payload_json FROM uiv_scripts WHERE id=?', [saved.id])).payload_json);
    assert.equal(stored.url, `${ae}/api/list?page=1`);
    for (const field of ['code', 'consoleCode']) {
        assert.ok(stored[field].length > original[field].length * 0.9);
        assert.ok(stored[field].includes(`const endpoint = "${ae}/api/list?page=1"`));
        assert.ok(stored[field].includes(`const detailEndpoint = "${ae}/api/detail"`));
        assert.ok(stored[field].includes('const rows = await fetch(endpoint)'));
        assert.ok(stored[field].includes('const targetRegion = "北部非洲地区部"'));
        assert.ok(stored[field].includes('const targetOffice = "埃及代表处"'));
        assert.ok(stored[field].includes('https://netcare.huawei.com.evil.example/keep'));
        assert.deepEqual(saved.summary.fields[field].siteOrigins, [ae]);
    }
    assert.equal(stored.payload, original.payload);
    assert.deepEqual(stored.configOptions, original.configOptions);
    assert.deepEqual(stored.futureSettings, original.futureSettings);
    assert.equal((await db.get('SELECT payload_json FROM uiv_scripts WHERE id=?', [original.id])).payload_json, JSON.stringify(original));
    await tenant.runWithTenant('other', async () => {
        assert.equal((await service.list(ctx)).scripts.length, 1);
        assert.equal((await categories.listCategories()).items.includes('NetCare中东'), true, 'category initialization works on the second tenant connection');
        await assert.rejects(service.read(ctx, { id: saved.id }), /不存在/);
    });
    await assert.rejects(service.save(ctx, { action: 'clone', sourceId: original.id, expectedRevision: before.revision,
        changes: '{"name":"FakeCopy","code":"console.log(1)"}' }), /保留完整/);
    await assert.rejects(service.save(ctx, { action: 'clone', sourceId: original.id, expectedRevision: before.revision,
        targetSite: 'me', changes: '{"name":"GuessHost"}' }), /只支持/);
    await assert.rejects(service.save(ctx, { action: 'update', id: original.id, expectedRevision: before.revision,
        changes: '{"code":"return 1;"}' }), /大幅缩短/);
});

test('moving a legacy broken script updates both data representations without validating or rewriting unrelated code', async () => {
    const broken = { name: 'BrokenCopy', code: 'return (not-valid-js' };
    const row = { id: 'legacy-broken', name: broken.name, category: 'NetCare中国', url: `${ae}/api/list` };
    await insert(broken, row);
    const before = await service.read(ctx, { id: row.id });
    assert.ok(before.integrity.some(issue => issue.includes('category')));
    const moved = await service.move(ctx, { id: row.id, expectedRevision: before.revision, category: 'netcare中东' });
    assert.equal(moved.committed && moved.verified, true);
    assert.equal(moved.ready, false, 'moving cannot turn an incomplete capture script into a ready script');
    const after = await db.get('SELECT category,payload_json FROM uiv_scripts WHERE id=?', [row.id]);
    const payload = JSON.parse(after.payload_json);
    assert.equal(after.category, 'NetCare中东');
    assert.equal(payload.category, after.category);
    assert.equal(payload.id, row.id);
    assert.equal(payload.code, broken.code);
    assert.equal((await db.get('SELECT count(*) AS count FROM uiv_scripts WHERE id IS NULL')).count, 0);
    assert.equal((await scripts.listScripts()).items.find(script => script.id === row.id).category, 'NetCare中东', 'the sidebar repository sees the moved script');
    await assert.rejects(service.move(ctx, { id: row.id, expectedRevision: before.revision, category: 'NetCare德国' }), /版本/);
    const current = await service.read(ctx, { id: row.id });
    await assert.rejects(service.move(ctx, { id: row.id, expectedRevision: current.revision, category: '猜测的新分类' }), /分类不存在/);
    assert.equal((await db.get('SELECT payload_json FROM uiv_scripts WHERE id=?', [row.id])).payload_json, after.payload_json);
    assert.equal((await tools.execute({ readOnly: true }, 'move_uiv_script', { id: row.id, expectedRevision: current.revision, category: 'NetCare德国' })).isError, true);
    const catalog = await service.categories(ctx);
    assert.equal(catalog.categories.find(category => category.name === 'NetCare中东').scriptCount, 2);
});

test('generic database tools cannot recreate partial script records or change only the category column', async () => {
    const args = { database: 'platform:data/tools.db', table: 'uiv_scripts', filters: [{ column: 'id', op: 'eq', value: original.id }], values: '{"category":"NetCare中东"}' };
    await assert.rejects(tools.preview(ctx, 'update_database_rows', args), { code: 'AGENT_SCRIPT_TOOL_REQUIRED' });
    const denied = await tools.execute(ctx, 'update_database_rows', args);
    assert.equal(denied.isError, true);
    assert.match(denied.content, /move_uiv_script/);
    assert.equal((await db.get('SELECT category FROM uiv_scripts WHERE id=?', [original.id])).category, 'NetCare中国');
});

test('the real move API canonicalizes the category and reports the committed sidebar state', async t => {
    const express = require('../backend/node_modules/express');
    const monitor = require('../backend/models/config-change-monitor');
    const record = monitor.recordConfigChangeAlert;
    monitor.recordConfigChangeAlert = () => {};
    t.after(() => { monitor.recordConfigChangeAlert = record; });
    const router = require('../backend/routes/uiv');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'test-admin', role: 'admin' }; next(); });
    app.use('/api/uiv', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}/api/uiv/scripts/${original.id}/category`;
    const response = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"category":"netcare德国"}' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success && result.committed && result.verified, true);
    assert.equal(result.category, 'NetCare德国');
    const saved = await db.get('SELECT category,payload_json FROM uiv_scripts WHERE id=?', [original.id]);
    assert.equal(JSON.parse(saved.payload_json).category, saved.category);
    assert.equal(JSON.parse(saved.payload_json).code, sourceCode);
    const invalid = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"category":"missing"}' });
    assert.equal(invalid.status, 400);
});

test('explicit rebuild restores a broken copy from the full source using both revisions without creating a second destination', async () => {
    const row = { id: 'rebuild-broken', name: 'ExistingMiddleEastCopy', url: `${ae}/api/list`, category: 'NetCare中东' };
    await insert({ name: row.name, code: 'console.log("incomplete")' }, row);
    const source = await service.read(ctx, { id: original.id });
    const target = await service.read(ctx, { id: row.id });
    const count = (await db.get('SELECT count(*) AS count FROM uiv_scripts')).count;
    const args = { action: 'rebuild', id: row.id, sourceId: original.id, expectedRevision: target.revision,
        expectedSourceRevision: source.revision, targetSite: 'ae' };
    await assert.rejects(service.save(ctx, { ...args, expectedSourceRevision: 'stale' }), /原脚本版本/);
    const rebuilt = await service.save(ctx, args);
    assert.equal(rebuilt.id, row.id);
    assert.equal(rebuilt.committed && rebuilt.verified, true);
    assert.equal(rebuilt.sourceId, original.id);
    const payload = JSON.parse((await db.get('SELECT payload_json FROM uiv_scripts WHERE id=?', [row.id])).payload_json);
    assert.equal(payload.name, row.name);
    assert.ok(payload.consoleCode.includes('const rows = await fetch(endpoint)'));
    assert.ok(payload.code.length > sourceCode.length * 0.9);
    assert.equal(payload.payload, original.payload);
    assert.equal(payload.category, 'NetCare中东');
    assert.equal(payload.url, `${ae}/api/list?page=1`);
    assert.equal((await db.get('SELECT count(*) AS count FROM uiv_scripts')).count, count);
    assert.deepEqual((await service.read(ctx, { id: row.id })).integrity, []);
});

test('the actual browser save flow uses shared site definitions for all three scripts', async () => {
    const vm = require('node:vm');
    const values = { fileName: 'Source', requestUrl: `${cn}/api/list`, codeOutput: sourceCode, consoleOutput: sourceCode };
    const elements = new Map();
    const document = { readyState: 'loading', addEventListener() {}, getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: values[id] || '', checked: id === 'autoNetCareTriplicate', addEventListener() {} });
        return elements.get(id);
    } };
    let submitted;
    const context = { document, URL, Blob, console: { info() {}, error() {} }, setTimeout() {}, showToast() {}, UIVT: key => key,
        UIVWorkbench: { getParsedPayload: () => ({ region: '北部非洲地区部' }), getCurrentTitle: () => 'Source', getCurrentTitleInputName: () => 'Source' },
        UIVSidebar: { loadSavedScripts: async () => {} },
        API: { get: async () => ({ scripts: [] }), post: async (_url, body) => { submitted = body.items; return { success: true }; }, logHistory() {} }
    };
    context.window = context;
    vm.createContext(context);
    for (const file of ['frontend/js/shared/uiv-site-profiles.js', 'frontend/js/uivf12/save.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
    }
    await context.UIVSave.saveCurrentScript();
    assert.equal(submitted.length, 3);
    for (let index = 0; index < profiles.length; index++) {
        assert.equal(submitted[index].category, profiles[index].category);
        assert.equal(submitted[index].url, `${profiles[index].origin}/api/list`);
        assert.ok(submitted[index].code.includes('北部非洲地区部'));
    }
});

test('script saves preserve runtime CSRF logic and embedded credentials while model outputs stay redacted', async () => {
    const credential = 'fixture-static-credential-value';
    const runtime = `return (async function () {
        const cStr = localStorage.getItem('globalConfig'); let csrfToken = "";
        if(cStr){ const m=cStr.match(/([A-Fa-f0-9]{64})/); if(m)csrfToken=m[0];
            else { const o=JSON.parse(cStr); csrfToken=o.csrfToken||(o.configData&&o.configData.csrfToken)||""; } }
        const headers = { "x-gde-csrf-token": csrfToken, "Authorization": "Bearer ${credential}" };
        return fetch("${cn}/api/list", { headers });
    })();`;
    const source = { ...original, id: 'csrf-source', name: 'CSRF Token抓取脚本', code: runtime, consoleCode: runtime };
    await insert(source);
    const context = { ...ctx, sensitiveValues: [credential], currentUserMessage: '复制这个脚本到中东，保留原有鉴权' };
    const read = await service.read(context, { id: source.id });
    const outcome = await tools.execute(context, 'save_uiv_script', { action: 'clone', sourceId: source.id,
        expectedRevision: read.revision, targetSite: 'ae', changes: '{"name":"Token中东副本"}' });
    assert.equal(Boolean(outcome.isError), false, outcome.content);
    assert.equal(outcome.content.includes(credential), false);
    const saved = JSON.parse(outcome.content);
    const payload = JSON.parse((await db.get('SELECT payload_json FROM uiv_scripts WHERE id=?', [saved.id])).payload_json);
    assert.ok(payload.code.includes('csrfToken=m[0]'));
    assert.ok(payload.code.includes('o.configData.csrfToken'));
    assert.ok(payload.code.includes(credential), 'script storage preserves the source credential');
    assert.ok(payload.code.includes(`${ae}/api/list`));
    const redacted = await tools.execute(context, 'read_uiv_script', { id: saved.id, field: 'code' });
    assert.equal(redacted.content.includes(credential), false, 'no plaintext credential goes to model output');
    const generic = require('../backend/models/agent-database-service');
    await assert.rejects(generic.writeTable(context, { database: 'platform:tools.db', table: 'uiv_scripts', operation: 'update',
        scriptContent: true, values: { payload_json: JSON.stringify(source) }, filters: [{ column: 'id', op: 'eq', value: saved.id }] }), /凭据/,
    'model arguments cannot enable the internal script content policy');
});

test('rebuild errors provide recovery parameters and a repair request cannot delete an existing same-name copy', async () => {
    const target = { id: 'safe-repair-target', name: 'RepairMe', category: 'NetCare中东', url: `${ae}/api/list` };
    await insert({ name: target.name, code: 'console.log("broken")' }, target);
    const context = { ...ctx, currentUserMessage: '之前做的这个脚本坏了，帮我重新做吧' };
    const before = await service.read(context, { id: target.id });
    const source = await service.read(context, { id: original.id });
    const missing = await tools.execute(context, 'save_uiv_script', { action: 'rebuild', id: target.id, expectedRevision: before.revision });
    const missingError = JSON.parse(missing.content).error;
    assert.equal(missingError.code, 'AGENT_SCRIPT_REBUILD_SOURCE_REQUIRED');
    assert.ok(missingError.details.required.includes('expectedSourceRevision'));
    const conflict = await tools.execute(context, 'save_uiv_script', { action: 'clone', sourceId: original.id,
        expectedRevision: source.revision, targetSite: 'ae', changes: JSON.stringify({ name: target.name }) });
    const details = JSON.parse(conflict.content).error.details;
    assert.equal(details.existingId, target.id);
    assert.equal(details.suggestedCall.sourceId, original.id);
    await assert.rejects(tools.preview(context, 'delete_uiv_script', { id: target.id, expectedRevision: before.revision }), { code: 'AGENT_SCRIPT_DELETE_NOT_REQUESTED' });
    const deletion = await tools.execute(context, 'delete_uiv_script', { id: target.id, expectedRevision: before.revision,
        currentUserMessage: '删除脚本', userApproved: true });
    assert.equal(JSON.parse(deletion.content).error.code, 'AGENT_SCRIPT_DELETE_NOT_REQUESTED', 'model arguments cannot manufacture deletion intent');
    assert.ok(await db.get('SELECT id FROM uiv_scripts WHERE id=?', [target.id]));
    const rebuilt = await tools.execute(context, 'save_uiv_script', details.suggestedCall);
    assert.equal(Boolean(rebuilt.isError), false, rebuilt.content);
    assert.equal(JSON.parse(rebuilt.content).id, target.id);
    for (const question of ['请删除这个脚本', '把旧脚本删掉', 'please delete this script', '请删除这个副本，不要删除原始脚本']) assert.doesNotThrow(() => service.assertDeletionRequested({ currentUserMessage: question }));
    assert.doesNotThrow(() => service.assertDeletionRequested({ currentUserMessage: '确认', userMessages: ['请删除这个脚本', '确认'] }));
    assert.throws(() => service.assertDeletionRequested({ currentUserMessage: '重建脚本，不要删除', userMessages: ['删除这个脚本'] }));
    assert.equal(service.shouldContinue({ question: context.currentUserMessage, text: '给你脚本框架，请手动保存。', toolLog: [] }), true);
});

test('full-access workspace recovers from the reported error sequence without deleting the target or stripping its authentication', async () => {
    const manager = require('../backend/models/agent-run-manager');
    const skills = require('../backend/models/agent-skills');
    const target = { id: 'workspace-repair-target', name: 'WorkspaceRepair', category: 'NetCare中东', url: `${ae}/api/list` };
    await insert({ name: target.name, code: 'console.log("broken")' }, target);
    const root = path.join(sandbox, 'Downloads');
    fs.mkdirSync(root);
    const session = manager.ensureSession({ agentSessionId: 'script-repair-error-sequence', user: { username: 'admin', role: 'admin' },
        tenantId: 'default', root, permissionMode: 'full' });
    let step = 0, targetRevision, sourceRevision, recovery;
    const call = (name, args) => ({ toolCalls: [{ id: `step-${step}`, name, args }] });
    const events = [];
    const result = await manager.runAgentTurn({ session, systemInstruction: skills.load('@script-data').prompt,
        historyMessages: [{ role: 'user', content: '这个脚本坏了，请帮我重新做，保留原来的鉴权和筛选' }],
        sensitiveValues: ['fixture-static-credential-value'], write: event => events.push(event), client: { model: 'mock', generateText: async options => {
            const previous = options.messages.at(-1)?.toolResults?.[0];
            switch (step++) {
                case 0: return call('read_uiv_script', { id: target.id });
                case 1:
                    targetRevision = JSON.parse(previous.content).revision;
                    return call('save_uiv_script', { action: 'rebuild', id: target.id, expectedRevision: targetRevision });
                case 2:
                    assert.equal(JSON.parse(previous.content).error.code, 'AGENT_SCRIPT_REBUILD_SOURCE_REQUIRED');
                    return call('list_uiv_scripts', { query: 'CSRF Token' });
                case 3: return call('read_uiv_script', { id: 'csrf-source' });
                case 4:
                    sourceRevision = JSON.parse(previous.content).revision;
                    return call('save_uiv_script', { action: 'clone', sourceId: 'csrf-source', expectedRevision: sourceRevision,
                        targetSite: 'ae', changes: JSON.stringify({ name: target.name }) });
                case 5:
                    recovery = JSON.parse(previous.content).error.details.suggestedCall;
                    assert.equal(recovery.expectedSourceRevision, sourceRevision);
                    return call('delete_uiv_script', { id: target.id, expectedRevision: targetRevision });
                case 6:
                    assert.equal(JSON.parse(previous.content).error.code, 'AGENT_SCRIPT_DELETE_NOT_REQUESTED');
                    assert.ok(await db.get('SELECT id FROM uiv_scripts WHERE id=?', [target.id]));
                    return call('save_uiv_script', recovery);
                default:
                    assert.equal(JSON.parse(previous.content).verified, true);
                    return { text: '已从完整原脚本原位重建，保留鉴权并完成回读。' };
            }
        } } });
    assert.match(result.text, /原位重建/);
    assert.equal(events.some(event => event.type === 'approval'), false);
    assert.equal(JSON.stringify(events).includes('fixture-static-credential-value'), false);
    const payload = JSON.parse((await db.get('SELECT payload_json FROM uiv_scripts WHERE id=?', [target.id])).payload_json);
    assert.equal(payload.id, target.id);
    assert.ok(payload.consoleCode.includes('o.configData.csrfToken'));
    assert.ok(payload.code.includes('fixture-static-credential-value'));
});
