const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'favorite-nav-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const db = require('../backend/models/app-db');
const tenant = require('../backend/models/tenant-context');
const repo = require('../backend/models/favorite-nav-repository');

test.after(async () => {
    await db.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('favorites keep each account\'s own dragged order, deduplicate and stay inside the tenant', async () => {
    assert.deepEqual(await repo.listFavorites('alice'), []);
    assert.deepEqual(await repo.replaceFavorites('alice', ['uivf12', 'custom:demo', 'sla', 'uivf12']), ['uivf12', 'custom:demo', 'sla']);
    assert.deepEqual(await repo.replaceFavorites('alice', ['sla', 'uivf12']), ['sla', 'uivf12'], 'reordering replaces the list');
    await repo.replaceFavorites('bob', ['custom:demo']);
    assert.deepEqual(await repo.listFavorites('alice'), ['sla', 'uivf12']);
    assert.deepEqual(await repo.listFavorites('bob'), ['custom:demo']);
    const many = Array.from({ length: 80 }, (_, index) => `tool-${index}`);
    assert.equal((await repo.replaceFavorites('alice', many)).length, repo.MAX_FAVORITES);
    await tenant.runWithTenant('other', async () => {
        assert.deepEqual(await repo.listFavorites('bob'), []);
    });
});
