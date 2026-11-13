// 平台自检（服务状态面板「平台自检」页）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-diag-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const diagnostics = require('../backend/models/platform-diagnostics');
const appDb = require('../backend/models/app-db');
const tenantPool = require('../backend/models/tenant-sqlite-pool');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('self-check reports every item independently', async () => {
    const result = await diagnostics.runDiagnostics();
    assert.deepEqual(result.checks.map(item => item.id), ['database', 'database-write', 'models', 'disk', 'process']);
    const byId = Object.fromEntries(result.checks.map(item => [item.id, item]));
    assert.equal(byId.database.ok, true, byId.database.summary);
    assert.equal(byId['database-write'].ok, true, byId['database-write'].summary);
    assert.match(byId.process.summary, /Node v/);
    assert.equal(typeof byId.models.ok, 'boolean', 'a missing model key is reported, not thrown');
});

test('outbound probe resolves, connects, reports status and rejects bad input', async () => {
    const server = http.createServer((_req, res) => { res.statusCode = 204; res.end(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const out = await diagnostics.probeUrl(`http://127.0.0.1:${server.address().port}/ping`);
        assert.equal(out.ok, true);
        assert.equal(out.status, 204);
        assert.deepEqual(out.addresses, ['127.0.0.1']);
        await assert.rejects(() => diagnostics.probeUrl('ftp://x'), /HTTP/);
        await assert.rejects(() => diagnostics.probeUrl('https://u:p@example.com'), /账号密码/);
        const dead = await diagnostics.probeUrl('http://no-such-host.invalid/');
        assert.equal(dead.ok, false);
        assert.match(dead.message, /域名解析失败/);
    } finally {
        server.close();
    }
});

test('the panel has an admin-only self-check tab wired to the endpoints', () => {
    const navbar = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../backend/routes/platform-metrics.js'), 'utf8');
    assert.match(navbar, /id="serviceStatusDiagTab"/);
    assert.match(navbar, /diagTab\.hidden = !canInspectServiceFailures\(\)/);
    assert.match(navbar, /\/api\/platform-metrics\/diagnostics\/probe/);
    assert.match(route, /router\.get\('\/diagnostics', requireAdmin/);
    assert.match(route, /router\.post\('\/diagnostics\/probe', requireAdmin/);
});
