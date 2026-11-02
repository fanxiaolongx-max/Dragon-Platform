const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-registry-'));
process.env.TOOLS_DATA_DIR = temp;
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const registry = require('../backend/models/agent-tool-registry');
const config = require('../backend/models/digital-human/config-repository');

test.after(async () => {
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    await require('../backend/models/app-db').closeDatabase();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('unconfigured NetCare stays unavailable even with retained skills or the wrong loading entry', async () => {
    const session = { readOnly: false, loadedSkills: new Set(['netcare-data']) };
    const reg = await registry.create({ session, skillIds: ['netcare-data'], skillCatalog: true });
    assert.equal(reg.definitions().some(item => item.name === 'netcare_sql'), false);
    for (const call of [
        { name: 'tool_search', args: { select: ['netcare-data'] } },
        { name: 'tool_search', args: { query: 'netcare-data' } },
        { name: 'load_skill', args: { id: 'netcare-data' } }
    ]) {
        const result = await reg.runMeta(call);
        assert.ok(!result.isError);
        assert.match(result.content, /NetCare 数据连接尚未启用/);
        assert.doesNotMatch(result.summary, /没有加载新工具/);
    }
});

test('tool_search accepts skill IDs, preserves mixed tool requests and keeps loaded skills', async () => {
    await config.saveConfig({ enabled: true });
    try {
        const session = { readOnly: false };
        const reg = await registry.create({ session, skillCatalog: true });
        const result = await reg.runMeta({ name: 'tool_search', args: { select: ['@netcare-data', 'database'] } });
        assert.equal(result.isError, false);
        assert.match(result.content, /### @netcare-data/);
        assert.ok(reg.definitions().some(item => item.name === 'netcare_sql'));
        assert.ok(reg.definitions().some(item => item.name === 'insert_database_row'));
        const byQuery = await registry.create({ session: { readOnly: false }, skillCatalog: true });
        assert.equal((await byQuery.runMeta({ name: 'tool_search', args: { query: '@netcare-data' } })).isError, false);
        assert.ok(byQuery.definitions().some(item => item.name === 'netcare_sql'));
        const next = await registry.create({ session, skillCatalog: true });
        assert.ok(next.definitions().some(item => item.name === 'netcare_sql'));
        const viewer = await registry.create({ session: { readOnly: true }, skillCatalog: true });
        await viewer.runMeta({ name: 'tool_search', args: { select: ['netcare-data'] } });
        assert.equal(viewer.definitions().some(item => item.name === 'netcare_sql'), false);
        const chat = await registry.create({ session: { readOnly: false }, core: false });
        const hint = await chat.runMeta({ name: 'tool_search', args: { select: ['netcare-data'] } });
        assert.ok(!hint.isError);
        assert.match(hint.content, /输入框选择 @netcare-data/);

        const createBySelect = await reg.runMeta({ name: 'tool_search', args: { select: ['create-skill'] } });
        assert.equal(createBySelect.isError, false);
        assert.match(createBySelect.content, /### @create-skill/);
        assert.match(createBySelect.content, /平台技能保存规则/);

        const createByQuery = await reg.runMeta({ name: 'tool_search', args: { query: '创建技能 skill' } });
        assert.equal(createByQuery.isError, false);
        assert.match(createByQuery.content, /### @create-skill/);
    } finally {
        await config.saveConfig({ enabled: false });
    }
});
