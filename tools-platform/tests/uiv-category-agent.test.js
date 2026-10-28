const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'uiv-category-agent-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const db = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const tenant = require('../backend/models/tenant-context');
const service = require('../backend/models/agent-script-service');
const tools = require('../backend/models/agent-tools-service');
const categories = require('../backend/models/uiv-categories-repository');
const profiles = require('../frontend/js/shared/uiv-site-profiles');
const ctx = { readOnly: false, sensitiveValues: [] };
const cn = profiles.find(site => site.id === 'cn').origin;
const ae = profiles.find(site => site.id === 'ae').origin;
const macro = name => JSON.stringify({ Name: name, Commands: [{ Command: 'executeScript', Target: `const targetRegion = "北部非洲地区部"; return fetch("${cn}/api/eos");`, Value: '' }] });

async function insert(script) {
    await db.run('INSERT INTO uiv_scripts (id,name,category,url,payload_json) VALUES (?,?,?,?,?)', [script.id, script.name, script.category, script.url || '', JSON.stringify(script)]);
}
const pageCategory = async id => JSON.parse((await db.get('SELECT payload_json FROM uiv_scripts WHERE id = ?', [id])).payload_json).category;
const count = async name => (await service.categories(ctx)).categories.find(item => item.name === name)?.scriptCount;

test.before(async () => {
    for (const id of ['default', 'other']) await tenant.runWithTenant(id, async () => {
        await db.run('CREATE TABLE uiv_scripts (id TEXT PRIMARY KEY, name TEXT, category TEXT, url TEXT, payload_json TEXT, updated_at TEXT)');
        await categories.listCategories();
    });
});
test.after(async () => {
    await pool.closeAll();
    await db.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('category folders can be created, renamed with their scripts, and deleted without cascading script loss', async () => {
    const created = JSON.parse((await tools.execute(ctx, 'manage_uiv_category', { action: 'create', name: '临时目录' })).content);
    assert.equal(created.verified, true);
    await assert.rejects(service.manageCategory(ctx, { action: 'create', name: '临时目录' }), /已存在/);
    await assert.rejects(service.manageCategory(ctx, { action: 'create', name: 'a/b' }), /斜杠/);
    for (const id of ['s1', 's2']) await insert({ id, name: `脚本${id}`, category: '临时目录', url: `${cn}/api/${id}`, payload: '{}', code: 'return 1;', consoleCode: 'return 1;' });
    // 列与页面载荷不一致的旧记录也属于该目录，改名时一并修正
    await db.run('UPDATE uiv_scripts SET category = ? WHERE id = ?', ['旧列值', 's2']);
    assert.equal(await count('临时目录'), 2);
    assert.deepEqual((await service.list(ctx, { category: '临时目录' })).scripts.map(item => item.id), ['s1', 's2']);

    await assert.rejects(service.manageCategory(ctx, { action: 'rename', name: '临时目录', newName: '正式目录' }), /expectedScriptCount/);
    await assert.rejects(service.manageCategory(ctx, { action: 'rename', name: 'NetCare中东', newName: 'x', expectedScriptCount: 0 }), /内置分类/);
    const preview = await tools.preview(ctx, 'manage_uiv_category', { action: 'rename', name: '临时目录', newName: '正式目录', expectedScriptCount: 2 });
    assert.equal(JSON.parse(preview.diff).newName, '正式目录');
    assert.equal(await count('临时目录'), 2, 'preview never writes');
    const renamed = JSON.parse((await tools.execute(ctx, 'manage_uiv_category', { action: 'rename', name: '临时目录', newName: '正式目录', expectedScriptCount: 2 })).content);
    assert.equal(renamed.verified && renamed.movedScripts === 2, true, JSON.stringify(renamed));
    for (const id of ['s1', 's2']) {
        assert.equal(await pageCategory(id), '正式目录');
        assert.equal((await db.get('SELECT category FROM uiv_scripts WHERE id = ?', [id])).category, '正式目录');
        assert.equal((await service.read(ctx, { id })).integrity.length, 0);
    }
    assert.equal(JSON.parse((await db.get('SELECT payload_json FROM uiv_scripts WHERE id = ?', ['s1'])).payload_json).code, 'return 1;');

    assert.equal(tools.kindOf('manage_uiv_category', { action: 'delete' }), 'destructive');
    assert.equal(tools.kindOf('manage_uiv_category', { action: 'create' }), 'write');
    await assert.rejects(service.manageCategory(ctx, { action: 'delete', name: '正式目录', expectedScriptCount: 2 }), /moveScriptsTo/);
    const deleted = await service.manageCategory(ctx, { action: 'delete', name: '正式目录', expectedScriptCount: 2, moveScriptsTo: '默认分类' });
    assert.equal(deleted.verified && deleted.movedScripts === 2, true);
    assert.equal((await db.get('SELECT count(*) AS count FROM uiv_scripts')).count, 2, 'scripts survive folder deletion');
    assert.equal(await pageCategory('s1'), '默认分类');
    assert.equal((await service.categories(ctx)).categories.some(item => item.name === '正式目录'), false);

    await service.manageCategory(ctx, { action: 'create', name: '空目录' });
    assert.equal((await service.manageCategory(ctx, { action: 'delete', name: '空目录', expectedScriptCount: 0 })).verified, true);
    await assert.rejects(service.manageCategory({ readOnly: true }, { action: 'create', name: 'x' }), /管理员/);
    await tenant.runWithTenant('other', async () => {
        assert.equal((await service.categories(ctx)).categories.some(item => item.name === '空目录'), false);
        assert.equal((await service.list(ctx)).scripts.length, 0);
    });
    await db.run('DELETE FROM uiv_scripts');
});

test('batch move reports each script and rejects stale revisions without touching the rest', async () => {
    await service.manageCategory(ctx, { action: 'create', name: '批量目标' });
    for (const id of ['b1', 'b2', 'b3']) await insert({ id, name: `批量${id}`, category: '默认分类', url: `${cn}/api/${id}`, payload: '{}', code: 'return 1;', consoleCode: 'return 1;' });
    const items = [];
    for (const id of ['b1', 'b2', 'b3']) items.push({ id, expectedRevision: (await service.read(ctx, { id })).revision });
    items[2].expectedRevision = 'stale';
    await assert.rejects(tools.preview(ctx, 'move_uiv_script', { category: '批量目标', items }), /b3/);
    const outcome = await tools.execute(ctx, 'move_uiv_script', { category: '批量目标', items });
    const result = JSON.parse(outcome.content);
    assert.equal(outcome.isError, true);
    assert.equal(result.moved, 2);
    assert.match(result.results[2].error, /版本/);
    assert.equal(await pageCategory('b1'), '批量目标');
    assert.equal(await pageCategory('b3'), '默认分类');
    await assert.rejects(service.move(ctx, { category: '批量目标', items: [items[0], items[0]] }), /重复/);
    await db.run('DELETE FROM uiv_scripts');
});

test('legacy macro scripts without url/payload stay editable and can move to another site', async () => {
    const legacy = { id: 'eos', name: 'PBI_自动抓取-产品EOS风险', category: 'NetCare中国', code: macro('eos'), consoleCode: `const targetRegion = "北部非洲地区部"; return fetch("${cn}/api/eos");` };
    await insert(legacy);
    const read = await service.read(ctx, { id: 'eos' });
    assert.deepEqual(read.integrity, []);
    assert.match(read.notes[0], /url\/payload/);
    const saved = await service.save(ctx, { action: 'clone', sourceId: 'eos', expectedRevision: read.revision, targetSite: 'ae', changes: '{"name":"PBI_自动抓取-产品EOS风险-AE"}' });
    assert.equal(saved.verified, true);
    const clone = JSON.parse((await db.get('SELECT payload_json FROM uiv_scripts WHERE id = ?', [saved.id])).payload_json);
    assert.equal(clone.category, 'NetCare中东');
    assert.equal(clone.url, undefined, 'no fabricated request url');
    assert.ok(clone.consoleCode.includes(`${ae}/api/eos`) && !clone.consoleCode.includes(cn));
    assert.ok(JSON.parse(clone.code).Commands[0].Target.includes(ae));
    assert.ok(clone.consoleCode.includes('北部非洲地区部'), 'data filters untouched');
    const updated = await service.save(ctx, { action: 'update', id: 'eos', expectedRevision: read.revision,
        replacements: [{ field: 'consoleCode', oldText: '/api/eos', newText: '/api/eos-v2', expectedOccurrences: 1 }] });
    assert.equal(updated.verified, true);
    await assert.rejects(service.save(ctx, { action: 'create', changes: JSON.stringify({ name: '无请求', category: '默认分类', code: 'return 1;', consoleCode: 'return 1;' }) }), /url/);
});
