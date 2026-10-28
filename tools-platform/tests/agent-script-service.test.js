const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-script-service-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const db = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const platformDb = require('../backend/models/platform-db');
const tenant = require('../backend/models/tenant-context');
const service = require('../backend/models/agent-script-service');
const tools = require('../backend/models/agent-tools-service');
const manager = require('../backend/models/agent-run-manager');
const skills = require('../backend/models/agent-skills');
const store = require('../backend/models/agent-skills-store');
const ctx = { readOnly: false, sensitiveValues: [] };
const code = `return (async function () {
    const targetRegion = "北部非洲地区部";
    const generatorOffice = "埃及代表处";
    const finalOutputName = "PBI原脚本_Latest.csv";
    const pattern = /\\d+\\.csv$/;
    const quoted = "'单双引号与反斜杠\\\\'";
    let csrfToken = "";
    /* ${'保留长脚本内容'.repeat(4000)} */
    return { pattern, quoted, targetRegion, generatorOffice, finalOutputName };
})();`;
const original = { id: 'source', name: 'PBI原脚本', category: 'PBI', url: 'https://example.com/capture', payload: '{"region":"北部非洲地区部","page":1}',
    code, consoleCode: code, configOptions: { isPagination: false, unrelatedOption: true }, extraPreserved: { nested: ['keep'] } };

test.after(async () => {
    await pool.closeAll();
    await db.closeDatabase();
    await platformDb.closeDatabase();
    fs.rmSync(sandbox, { force: true, recursive: true });
});

test('long scripts clone and update without JSON escape loss, validate syntax, and preserve independent source and tenant data', async () => {
    for (const id of ['default', 'other']) await tenant.runWithTenant(id, async () => {
        await db.run('CREATE TABLE uiv_scripts (id TEXT PRIMARY KEY, name TEXT, category TEXT, url TEXT, payload_json TEXT, updated_at TEXT)');
        await require('../backend/models/uiv-categories-repository').addCategory('PBI');
        await db.run('INSERT INTO uiv_scripts VALUES (?, ?, ?, ?, ?, ?)', [original.id, original.name, original.category, original.url, JSON.stringify(original), 'before']);
    });
    const listed = await service.list(ctx, { query: 'PBI' });
    assert.equal(listed.scripts[0].id, 'source');
    let joined = '', offset = 0, revision;
    do {
        const chunk = await service.read(ctx, { id: 'source', field: 'code', offset });
        joined += chunk.content;
        offset = chunk.nextOffset;
        revision = chunk.revision;
    } while (offset !== null);
    assert.equal(joined, code);
    const wireRead = await tools.execute(ctx, 'read_uiv_script', { id: 'source', field: 'code' });
    assert.equal(JSON.parse(wireRead.content).content, code.slice(0, 6000), 'tool transport preserves empty runtime auth placeholders and code escapes');
    const cloneArgs = { action: 'clone', sourceId: 'source', expectedRevision: revision, changes: JSON.stringify({ name: 'PBI全地区', configOptions: { isPagination: true } }),
        replacements: ['code', 'consoleCode', 'payload'].map(field => ({ field, oldText: '北部非洲地区部', newText: '中东地区部', expectedOccurrences: 1 })) };
    const preview = await tools.preview(ctx, 'save_uiv_script', cloneArgs);
    assert.match(preview.path, /PBI原脚本/);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM uiv_scripts')).count, 1);
    const saved = await tools.execute(ctx, 'save_uiv_script', cloneArgs);
    assert.equal(Boolean(saved.isError), false, saved.content);
    const clone = JSON.parse(saved.content);
    assert.equal(clone.committed, true);
    assert.equal(clone.verified, true);
    const after = JSON.parse((await db.get('SELECT payload_json FROM uiv_scripts WHERE id = ?', [clone.id])).payload_json);
    assert.equal(after.code.includes('中东地区部'), true);
    assert.equal(after.code.includes('PBI全地区_Latest.csv'), true);
    assert.equal(after.code.includes('const pattern = /\\d+\\.csv$/'), true);
    assert.deepEqual(after.extraPreserved, original.extraPreserved);
    assert.deepEqual(after.configOptions, { isPagination: true, unrelatedOption: true });
    assert.equal((await db.get('SELECT payload_json FROM uiv_scripts WHERE id = ?', ['source'])).payload_json, JSON.stringify(original));
    await tenant.runWithTenant('other', async () => {
        assert.equal((await service.list(ctx)).scripts.length, 1);
        assert.equal((await service.read(ctx, { id: 'source', field: 'code' })).content, code.slice(0, 6000));
        await assert.rejects(service.read(ctx, { id: clone.id }), /不存在/);
    });
    const update = await service.save(ctx, { action: 'update', id: clone.id, expectedRevision: clone.revision,
        replacements: [{ field: 'consoleCode', oldText: 'const generatorOffice = "埃及代表处";', newText: 'const generatorOffice = "地区代表处";', expectedOccurrences: 1 }] });
    assert.equal(update.verified, true);
    await assert.rejects(service.save(ctx, { action: 'update', id: clone.id, expectedRevision: clone.revision, changes: '{"category":"stale"}' }), /版本/);
    for (const changes of [ { code: 'return (async => {' }, { payload: '{broken' }, { id: 'other-id' }, { code: '[REDACTED]' } ]) {
        await assert.rejects(service.save(ctx, { action: 'update', id: clone.id, expectedRevision: update.revision, changes: JSON.stringify(changes) }));
    }
    await assert.rejects(service.save(ctx, { action: 'update', id: clone.id, expectedRevision: update.revision,
        replacements: [{ field: 'code', oldText: 'never-in-code', newText: '', expectedOccurrences: 1 }] }), /匹配次数/);
    const deleted = JSON.parse((await tools.execute({ ...ctx, currentUserMessage: '删除这个测试脚本' }, 'delete_uiv_script', { id: clone.id, expectedRevision: update.revision })).content);
    assert.equal(deleted.committed && deleted.verified, true);
    assert.equal((await service.list(ctx)).scripts.length, 1);
});

test('new macro scripts validate executeScript targets, hide credentials, and keep write/delete role and approval gates', async () => {
    const { id, extraPreserved, ...newFields } = original;
    const create = { action: 'create', changes: JSON.stringify({ ...newFields, name: '全新脚本', code: JSON.stringify({ Commands: [{ Command: 'executeScript', Target: 'return 42;' }] }) }) };
    const saved = await service.save(ctx, create);
    assert.equal(saved.verified, true);
    await assert.rejects(service.save(ctx, create), /同名/);
    const bad = JSON.parse(create.changes); bad.name = '错误宏'; bad.code = JSON.stringify({ Commands: [{ Command: 'executeScript', Target: 'return {' }] });
    await assert.rejects(service.save(ctx, { action: 'create', changes: JSON.stringify(bad) }), /语法校验失败/);
    assert.equal((await tools.execute({ readOnly: true }, 'save_uiv_script', create)).isError, true);
    assert.equal((await tools.execute({ readOnly: true }, 'delete_uiv_script', { id: saved.id, expectedRevision: saved.revision })).isError, true);
    const viewer = tools.definitions({ readOnly: true }).map(tool => tool.name);
    assert.ok(viewer.includes('read_uiv_script'));
    assert.equal(viewer.includes('save_uiv_script') || viewer.includes('delete_uiv_script'), false);
    for (const mode of ['ask', 'auto', 'full']) {
        const session = { permissionMode: mode, readOnly: false, alwaysAllow: new Set() };
        assert.equal(manager.classifyDecision(session, 'save_uiv_script'), mode === 'ask' ? 'ask' : 'allow');
        assert.equal(manager.classifyDecision(session, 'delete_uiv_script'), mode === 'full' ? 'allow' : 'ask');
    }
    const sensitive = { ...original, id: 'sensitive', name: '敏感脚本', payload: '{"password":"never-send-this-password"}' };
    await db.run('INSERT INTO uiv_scripts VALUES (?, ?, ?, ?, ?, ?)', [sensitive.id, sensitive.name, sensitive.category, sensitive.url, JSON.stringify(sensitive), 'before']);
    assert.equal(JSON.stringify(await service.read(ctx, { id: sensitive.id, field: 'payload' })).includes('never-send-this-password'), false);
});

test('script tasks select the built-in Skill without @ and hidden tenant overrides remain respected', async () => {
    for (const text of ['复制PBI抓取脚本换成中东地区', '删除脚本仓库里的重复脚本', '修改 F12 的分页配置', '查看 targetRegion', 'clone a UIVision script']) {
        assert.deepEqual(skills.autoSelect(text), ['script-data'], text);
        const loaded = await store.loadAll(text, { extraIds: skills.autoSelect(text) });
        assert.ok(loaded.selected.some(item => item.id === 'script-data'));
    }
    for (const text of ['写一个 Python 脚本读取文件', '删除临时目录', '今天的天气', '帮我写一个 Skill']) assert.deepEqual(skills.autoSelect(text), []);
    assert.deepEqual(skills.autoSelect('@netcare-data 查询数据抓取情况'), []);
    assert.deepEqual(skills.autoSelect('查询数据抓取情况', { extraIds: ['netcare-data'] }), []);
    const previous = [{ role: 'user', content: '复制 PBI 抓取脚本为中东版本' }];
    assert.deepEqual(skills.autoSelect('好那你做吧，改名字加一个特殊标识', { contextMessages: previous }), ['script-data']);
    assert.deepEqual(skills.autoSelect('今天的天气怎么样', { contextMessages: previous }), []);
    await store.remove('script-data');
    assert.equal((await store.loadAll('修改抓取脚本', { extraIds: skills.autoSelect('修改抓取脚本') })).selected.length, 0);
    await store.resetToBuiltin('script-data');
});

test('continuation only nudges unfinished execution promises, while JSON redaction still removes real credentials', () => {
    assert.equal(service.shouldContinue({ question: '复制抓取脚本', text: '结构检查完了，可以直接写入。', toolLog: [] }), true);
    assert.equal(service.shouldContinue({ question: '先分析复制脚本方案', text: '可以直接写入。', toolLog: [] }), false);
    assert.equal(service.shouldContinue({ question: '复制抓取脚本', text: '可以写入。', toolLog: [{ tool: 'save_uiv_script', ok: true }] }), false);
    const sensitive = require('../backend/models/ai-sensitive-data');
    const secretText = JSON.stringify({ content: 'const token = "private-runtime-credential";', request: '{"password":"hidden-password"}' });
    const redacted = sensitive.redactText(secretText);
    assert.equal(redacted.includes('private-runtime-credential') || redacted.includes('hidden-password'), false);
    assert.doesNotThrow(() => JSON.parse(redacted));
    assert.equal(sensitive.redactText(redacted), redacted);
    const asKey = JSON.stringify({ 'known-runtime-key-value': 'x' });
    assert.equal(sensitive.redactText(asKey, { secrets: ['known-runtime-key-value'] }).includes('known-runtime-key-value'), false);
});
