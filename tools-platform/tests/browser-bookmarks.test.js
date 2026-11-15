const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-bookmarks-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
const repo = require('../backend/models/browser-bookmarks-repository');
const { runWithTenant } = require('../backend/models/tenant-context');
test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});
test('bookmarks persist, reject non-web URLs, strip credentials and isolate users and tenants', async () => {
    await repo.update('alice', { url: 'https://user:secret@example.test/view?token=private&project=1', title: 'Project' });
    assert.deepEqual(await repo.list('alice'), [{ url: 'https://example.test/view?project=1', title: 'Project' }]);
    assert.deepEqual(await repo.list('bob'), []);
    await runWithTenant('other-team', async () => {
        assert.deepEqual(await repo.list('alice'), []);
        await repo.update('alice', { url: 'https://other.test/', title: 'Other' });
    });
    assert.equal((await repo.list('alice'))[0].title, 'Project');
    await assert.rejects(repo.update('alice', { url: 'javascript:alert(1)' }), /HTTP/);
    await repo.update('alice', { url: 'https://example.test/view?project=1', title: 'Renamed' });
    assert.equal((await repo.list('alice')).length, 1);
    assert.equal((await repo.list('alice'))[0].title, 'Renamed');
    await repo.update('alice', { url: 'https://example.test/view?project=1', remove: true });
    assert.deepEqual(await repo.list('alice'), []);
});
