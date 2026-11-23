'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-page-config-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const appDb = require('../backend/models/app-db');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const { writeKV } = require('../backend/models/kv-store');
const { runWithTenant } = require('../backend/models/tenant-context');
const pageDist = require('../backend/models/page-distribution');
const extraTools = require('../backend/models/agent-extra-tools');
const pageConfigTools = require('../backend/models/agent-page-config-tools');

function runReportSql(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = tenantPool.getConnection('report.db', 'report');
        db.run(sql, params, err => (err ? reject(err) : resolve()));
    });
}

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('read_page_config enforces allowlist, masks secrets, respects page access, and supports path/pagination', async () => {
    await runWithTenant('default', async () => {
        await writeKV('sys', 'nav_settings', {
            layout: 'home-v2',
            apiKey: 'sk-super-secret-value',
            items: [{ id: 'a', name: 'One' }, { id: 'b', name: 'Two' }, { id: 'c', name: 'Three' }]
        });
        await writeKV('sys', 'ai_settings', { apiKey: 'should-never-be-exposed' });
        await runReportSql('CREATE TABLE IF NOT EXISTS PlatformConfig (key_name TEXT PRIMARY KEY, value_json TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
        await runReportSql('INSERT OR REPLACE INTO PlatformConfig (key_name, value_json) VALUES (?, ?)', [
            'welink_policy_v2',
            JSON.stringify({ roster: [{ name: 'Alice', empId: 'a001' }], webhookToken: 'tok-999' })
        ]);
    });

    const superAdmin = { username: 'admin', role: 'admin', isSuper: true };
    const normalUser = { username: 'bob', role: 'user', isSuper: false };

    // Super admin sees allowlisted configs and never sees ai_settings
    const listRes = await pageConfigTools.execute({}, { user: superAdmin, tenantId: 'default' });
    assert.ok(!listRes.isError);
    const listBody = JSON.parse(listRes.content);
    const keys = listBody.configs.map(c => c.key);
    assert.ok(keys.includes('nav_settings'));
    assert.ok(keys.includes('welink_policy_v2'));
    assert.equal(keys.includes('ai_settings'), false);

    // Non-allowlisted key is refused
    const deniedKey = await pageConfigTools.execute({ key: 'ai_settings' }, { user: superAdmin, tenantId: 'default' });
    assert.equal(deniedKey.isError, true);

    // Secrets are masked, path & array pagination work
    const navRes = await pageConfigTools.execute({ key: 'nav_settings' }, { user: superAdmin, tenantId: 'default' });
    const navBody = JSON.parse(navRes.content);
    assert.notEqual(navBody.value.apiKey, 'sk-super-secret-value');
    assert.match(String(navBody.value.apiKey), /^\[(?:已隐藏|REDACTED)\]$/);
    assert.equal(navBody.value.layout, 'home-v2');

    const pagedRes = await pageConfigTools.execute({ key: 'nav_settings', path: 'items', offset: 1, limit: 1 }, { user: superAdmin, tenantId: 'default' });
    const pagedBody = JSON.parse(pagedRes.content);
    assert.equal(pagedBody.total, 3);
    assert.equal(pagedBody.nextOffset, 2);
    assert.deepEqual(pagedBody.value, [{ id: 'b', name: 'Two' }]);

    // Page-gated config follows page access for normal users
    await pageDist.setPageAccess('expedite', false);
    const blocked = await pageConfigTools.execute({ key: 'welink_policy_v2' }, { user: normalUser, tenantId: 'default' });
    assert.equal(blocked.isError, true);

    await pageDist.setPageAccess('expedite', true);
    const allowed = await pageConfigTools.execute({ key: 'welink_policy_v2' }, { user: normalUser, tenantId: 'default' });
    assert.ok(!allowed.isError);
    const allowedBody = JSON.parse(allowed.content);
    assert.notEqual(allowedBody.value.webhookToken, 'tok-999');
    assert.match(String(allowedBody.value.webhookToken), /^\[(?:已隐藏|REDACTED)\]$/);
    assert.equal(allowedBody.value.roster[0].name, 'Alice');

    // Super-admin-only config is refused for normal users
    const superOnly = await pageConfigTools.execute({ key: 'tool_distribution' }, { user: normalUser, tenantId: 'default' });
    assert.equal(superOnly.isError, true);

    // Exposed via platform_tools toolset in extraTools
    const sets = await extraTools.toolsets({ owner: 'default::admin', user: superAdmin, readOnly: true });
    const platformSet = sets.find(s => s.id === 'platform_tools');
    assert.ok(platformSet.definitions.some(d => d.name === 'read_page_config'));
    const viaSet = await platformSet.execute({ name: 'read_page_config', args: { key: 'nav_settings', path: 'layout' } });
    assert.equal(JSON.parse(viaSet.content).value, 'home-v2');
});
