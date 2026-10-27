const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBrowserLibrary, savedUrl } = require('../desktop-promo/browser-library');

test('browser library persists bookmarks, bounded history and download metadata in its own SQLite profile', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-library-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filename = path.join(root, 'profile', 'browser.db');
    let store = createBrowserLibrary(filename);
    await store.visit('https://example.test/project', 'Project');
    await store.visit('https://example.test/project', 'Project updated');
    await store.visit('file:///private', 'Not a website');
    await store.bookmark('https://example.test/project', 'Favourite');
    await store.saveDownload({ id: 'finished', name: 'report.csv', path: '/downloads/report.csv', state: 'completed', received: 100, total: 100, startedAt: 1 });
    await store.saveDownload({ id: 'unfinished', name: 'partial.csv', path: '/downloads/partial.csv', state: 'paused', received: 10, total: 100, startedAt: 2 });
    await store.close();
    store = createBrowserLibrary(filename);
    assert.deepEqual(await store.bookmarks(), [{ url: 'https://example.test/project', title: 'Favourite' }]);
    const history = await store.history();
    assert.equal(history.length, 1); assert.equal(history[0].title, 'Project updated');
    assert.deepEqual((await store.downloads()).map(item => item.state), ['interrupted', 'completed']);
    const another = createBrowserLibrary(path.join(root, 'other-profile.db'));
    assert.deepEqual(await another.bookmarks(), []); assert.deepEqual(await another.history(), []);
    await another.close();
    await store.bookmark('https://example.test/project', '', true);
    await store.clearHistory();
    assert.deepEqual(await store.bookmarks(), []); assert.deepEqual(await store.history(), []);
    assert.equal((await store.downloads()).length, 2, 'clearing history leaves downloads and files intact');
    await store.close();
});

test('browser records exclude credentials, authentication query values and non-web URLs', () => {
    assert.equal(savedUrl('https://user:password@example.test/view?project=42&access_token=secret&code=sso#token=value'), 'https://example.test/view?project=42');
    assert.equal(savedUrl('chrome-extension://id/options'), null);
    assert.equal(savedUrl('javascript:alert(1)'), null);
    assert.equal(savedUrl('https://example.test/#/project/42'), 'https://example.test/#/project/42');
});
