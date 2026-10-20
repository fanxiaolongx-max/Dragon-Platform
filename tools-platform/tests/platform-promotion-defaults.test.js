const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-promotion-defaults-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const defaultsFile = path.join(sandbox, 'platform-promotions-defaults.json');
fs.copyFileSync(path.join(__dirname, '../backend/platform-promotions-defaults.json'), defaultsFile);
process.env.TOOLS_PROMOTION_DEFAULTS_FILE = defaultsFile;

const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const { tenantMiddleware } = require('../backend/models/tenant-context');
const authSessions = require('../backend/models/auth-sessions-repository');
const repo = require('../backend/models/platform-promotions-repository');
const router = require('../backend/routes/platform-promotions');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');

test('the versioned defaults file ships NetCare with a short tagline', () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/platform-promotions-defaults.json'), 'utf8'));
    const netcare = shipped.links.find(link => link.id === 'netcare');
    assert.ok(netcare);
    assert.ok(netcare.description.length <= 16, 'banner text stays short');
});

test('hand edits to the defaults file apply without restart; invalid entries are skipped', () => {
    const original = fs.readFileSync(defaultsFile, 'utf8');
    try {
        fs.writeFileSync(defaultsFile, JSON.stringify({ links: [
            { id: 'netcare', name: 'NetCare', url: 'https://netcare.huawei.com/p/netcare/index.html#/home', description: '改过的介绍', color: 'blue' },
            { id: 'broken', name: 'Bad', url: 'javascript:alert(1)' },
            { name: 'No id', url: 'https://x.example/' }
        ] }));
        const config = repo.normalizeConfig({});
        assert.deepEqual(config.links.map(link => link.id), ['netcare']);
        assert.equal(config.links[0].description, '改过的介绍');
        assert.equal(config.links[0].color, 'blue');
    } finally {
        fs.writeFileSync(defaultsFile, original);
    }
});

test('admins write defaults to the source file; a promoted custom link becomes built-in', async t => {
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
    const end = serverSource.indexOf('\n});', begin) + 4;
    vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
    app.use('/api/platform-promotions', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await pool.closeAll();
        await appDb.closeDatabase();
        await platformDb.closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    await authSessions.saveSession('defaults-viewer', 'viewer2', 'viewer', Date.now() + 60000, 'default');
    await authSessions.saveSession('defaults-admin', 'admin2', 'admin', Date.now() + 60000, 'default');
    const url = `http://127.0.0.1:${server.address().port}/api/platform-promotions`;
    const as = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

    const initial = await (await fetch(url, { headers: as('defaults-admin') })).json();
    assert.equal(initial.defaultsWritable, true);
    // 先作为自定义链接保存，再设为默认
    await fetch(url, { method: 'PUT', headers: as('defaults-admin'), body: JSON.stringify({ ...initial, links: [...initial.links, { id: 'wiki', name: 'Wiki', url: 'https://wiki.example/' }] }) });
    const defaults = initial.links.filter(link => link.builtin).map(({ id, name, url: link, color }) => ({ id, name, url: link, color }));
    const body = JSON.stringify({ links: [...defaults, { id: 'wiki', name: 'Wiki', url: 'https://wiki.example/', color: 'green' }] });
    assert.equal((await fetch(`${url}/defaults`, { method: 'PUT', headers: as('defaults-viewer'), body })).status, 403);
    const saved = await (await fetch(`${url}/defaults`, { method: 'PUT', headers: as('defaults-admin'), body })).json();
    const wiki = saved.links.find(link => link.id === 'wiki');
    assert.equal(wiki.builtin, true);
    assert.equal(wiki.color, 'green');
    assert.equal(saved.links.filter(link => link.id === 'wiki').length, 1, 'no duplicate after promotion');
    const file = JSON.parse(fs.readFileSync(defaultsFile, 'utf8'));
    assert.deepEqual(file.links.map(link => link.id), ['netcare', 'wiki']);
    assert.equal('enabled' in file.links[0], false, 'tenant state stays out of the source file');
    assert.equal((await fetch(`${url}/defaults`, { method: 'PUT', headers: as('defaults-admin'), body: JSON.stringify({ links: [{ name: 'x', url: 'https://x.example/' }] }) })).status, 400);
});
