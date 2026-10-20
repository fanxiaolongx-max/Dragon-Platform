const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const JSZip = require('jszip');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-startup-'));
process.env.TOOLS_DATA_DIR = path.join(root, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(root, 'reports');
process.env.TOOLS_BUILTIN_TOOLS_DIR = path.join(root, 'source');
const sync = require('../backend/models/builtin-tools-sync');
const { initializeTenantBuiltinTools } = require('../backend/models/builtin-tools-startup');
const repo = require('../backend/models/custom-tools-repository');
const db = require('../backend/models/app-db');
const { runWithTenant, getDataDir } = require('../backend/models/tenant-context');
const logs = [];
const logger = { log: text => logs.push(text), warn: text => logs.push(text) };
function write(dir, file, value) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), value);
}
function bundle(version, date = '2026-10-20T00:00:00.000Z') {
    const dir = path.join(process.env.TOOLS_BUILTIN_TOOLS_DIR, 'sample');
    write(dir, 'index.html', `<p>${version}</p>`);
    write(dir, '.tool-manifest.json', JSON.stringify({ version: 1, tool: { slug: 'sample', name: 'Sample', updatedAt: date } }));
    return dir;
}
const initialize = tenant => initializeTenantBuiltinTools(tenant, { logger });
const target = tenant => path.join(getDataDir(tenant), 'custom-tools/sample');
const html = tenant => fs.readFileSync(path.join(target(tenant), 'index.html'), 'utf8');
test.after(async () => {
    await db.closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(root, { recursive: true, force: true });
});

test('startup updates the served tenant directory, preserves state, backs up old code and is idempotent', async () => {
    const source = bundle('v1');
    write(source, 'obsolete.js', 'old');
    assert.deepEqual((await initialize('alpha')).installed, ['sample']);
    await runWithTenant('alpha', async () => {
        await db.run('CREATE TABLE update_test_state (value TEXT)');
        await db.run('INSERT INTO update_test_state VALUES (?)', ['business data']);
    });
    write(target('alpha'), 'user-note.txt', 'keep this file');
    bundle('v2');
    fs.unlinkSync(path.join(source, 'obsolete.js'));
    write(source, 'new.js', 'new');
    const result = await initialize('alpha');
    assert.deepEqual(result.updated, ['sample']);
    assert.deepEqual(result.pending, []);
    assert.equal(html('alpha'), '<p>v2</p>');
    assert.equal(fs.readFileSync(path.join(target('alpha'), 'user-note.txt'), 'utf8'), 'keep this file');
    assert.equal(fs.existsSync(path.join(target('alpha'), 'obsolete.js')), false);
    assert.equal(fs.readFileSync(path.join(result.backups[0].path, 'index.html'), 'utf8'), '<p>v1</p>');
    assert.ok(result.backups[0].path.startsWith(path.join(getDataDir('alpha'), 'backups')));
    await runWithTenant('alpha', async () => {
        assert.equal(await repo.getToolFilePath('sample'), path.join(target('alpha'), 'index.html'));
        assert.equal((await db.get('SELECT value FROM update_test_state')).value, 'business data');
        assert.ok(await repo.getTool('sample'), 'the served tool remains registered in SQLite');
    });
    const again = await initialize('alpha');
    assert.deepEqual(again.updated, []);
    assert.deepEqual(again.backups, []);
    assert.deepEqual(again.pending, []);
    assert.ok(logs.some(line => line.includes('已更新 Sample') && line.includes(target('alpha'))));
    assert.ok(logs.some(line => line.includes('更新前备份 sample') && line.includes(result.backups[0].path)));
});

test('local edits, explicit skips and legacy fingerprints stay intact; another tenant still updates', async () => {
    bundle('base');
    for (const id of ['edited', 'skipped', 'legacy', 'untouched']) await initialize(id);
    write(target('edited'), 'index.html', 'my custom changes');
    const legacyManifestPath = path.join(target('legacy'), '.tool-manifest.json');
    const legacy = JSON.parse(fs.readFileSync(legacyManifestPath));
    legacy.system.fingerprint = 'old-format';
    fs.writeFileSync(legacyManifestPath, JSON.stringify(legacy));
    bundle('next');
    const options = { sourceDir: process.env.TOOLS_BUILTIN_TOOLS_DIR, targetDir: path.dirname(target('skipped')),
        stateFile: path.join(getDataDir('skipped'), 'builtin-tools-sync-decisions.json') };
    const preview = sync.previewBuiltinTools(options);
    sync.applyBuiltinToolDecisions({ ...options, skipSlugs: ['sample'], expectedFingerprints: { sample: preview.pending[0].fingerprint } });
    assert.deepEqual((await initialize('edited')).pending, ['sample']);
    assert.equal(html('edited'), 'my custom changes');
    assert.deepEqual((await initialize('legacy')).pending, ['sample']);
    assert.equal(html('legacy'), '<p>base</p>');
    assert.deepEqual((await initialize('skipped')).updated, []);
    assert.equal(html('skipped'), '<p>base</p>');
    assert.deepEqual((await initialize('untouched')).updated, ['sample']);
    assert.equal(html('alpha'), '<p>v2</p>', 'initializing another tenant cannot change alpha');
    assert.equal(fs.existsSync(path.join(getDataDir('default'), 'custom-tools')), false, 'no fallback to the default tenant');
    await assert.rejects(initialize('../alpha'), /租户 ID/);
    assert.ok(logs.some(line => line.includes('本地内容已修改')));
    assert.ok(logs.some(line => line.includes('管理员已选择跳过')));
});

test('market releases stay selected across app updates; explicit manual comparisons can replace them', async () => {
    const source = bundle('market v2');
    await initialize('market');
    const manifestPath = path.join(target('market'), '.tool-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifest.market = { id: 'official/sample', directoryFingerprint: manifest.system.fingerprint };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    bundle('bundled v1');
    const options = { sourceDir: process.env.TOOLS_BUILTIN_TOOLS_DIR, targetDir: path.dirname(target('market')) };
    assert.deepEqual((await initialize('market')).pending, []);
    assert.equal(html('market'), '<p>market v2</p>');
    assert.deepEqual(sync.previewBuiltinTools(options).pending, []);
    // Explicit market installation must still accept subsequent code fixes with the same date.
    bundle('market v3');
    const selected = sync.previewBuiltinTools({ ...options, preserveInstalledRelease: false }).pending[0];
    const installed = sync.applyBuiltinToolDecisions({ ...options, preserveInstalledRelease: false,
        applySlugs: ['sample'], expectedFingerprints: { sample: selected.fingerprint } });
    assert.deepEqual(installed.updated, ['sample']);
    assert.equal(html('market'), '<p>market v3</p>');
    const latest = JSON.parse(fs.readFileSync(manifestPath));
    latest.market = { id: 'official/sample', directoryFingerprint: latest.system.fingerprint };
    fs.writeFileSync(manifestPath, JSON.stringify(latest));
    bundle('bundled v4', '2026-10-21T00:00:00.000Z');
    assert.deepEqual((await initialize('market')).updated, []);
    assert.equal(html('market'), '<p>market v3</p>');
    const manual = sync.previewBuiltinTools({ ...options, preserveInstalledRelease: false }).pending[0];
    sync.applyBuiltinToolDecisions({ ...options, preserveInstalledRelease: false, applySlugs: ['sample'],
        expectedFingerprints: { sample: manual.fingerprint } });
    assert.equal(html('market'), '<p>bundled v4</p>');
    assert.equal(JSON.parse(fs.readFileSync(manifestPath)).market, undefined);
    assert.ok(logs.some(line => line.includes('不回退、不重复提示')));
    assert.ok(fs.existsSync(path.join(source, 'index.html')));
});

test('failed automatic replacements roll back the actual directory and report the failure', async t => {
    bundle('original');
    await initialize('rollback');
    bundle('replacement');
    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
        if (String(from).includes('.builtin-sample-') && String(from).endsWith('.tmp') && to === target('rollback')) {
            throw new Error('simulated replacement failure');
        }
        return rename(from, to);
    });
    const result = await initialize('rollback');
    assert.equal(result.invalid.length, 1);
    assert.deepEqual(result.updated, []);
    assert.equal(html('rollback'), '<p>original</p>');
    assert.ok(logs.some(line => line.includes('自动同步失败 sample') && line.includes('simulated replacement failure')));
    assert.deepEqual(fs.readdirSync(path.dirname(target('rollback'))), ['sample']);
});

test('real market downloads update the served folder twice with the same release date, and startup preserves them', async () => {
    bundle('bundled');
    await initialize('market-download');
    const market = require('../backend/models/custom-tools-market-service');
    const { fingerprintFiles } = require('../backend/models/tool-content-fingerprint');
    let published;
    const server = http.createServer((request, response) => {
        if (request.url === '/sample.zip') response.end(published.buffer);
        else response.end(JSON.stringify({ catalogVersion: 1, publisher: 'fixture', tools: [published.item] }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        await runWithTenant('market-download', async () => {
            const catalogUrl = `http://127.0.0.1:${server.address().port}/catalog.json`;
            await market.saveMarketSettings({ githubEnabled: false, sources: [{ name: 'Fixture', url: catalogUrl, enabled: true }] });
            for (const version of ['market first', 'market second']) {
                const packageDir = path.join(root, 'package');
                write(packageDir, 'index.html', `<p>${version}</p>`);
                write(packageDir, '.tool-manifest.json', fs.readFileSync(path.join(process.env.TOOLS_BUILTIN_TOOLS_DIR, 'sample/.tool-manifest.json')));
                const files = ['index.html', '.tool-manifest.json'];
                const zip = new JSZip();
                for (const file of files) zip.file(file, fs.readFileSync(path.join(packageDir, file)));
                const buffer = await zip.generateAsync({ type: 'nodebuffer' });
                published = { buffer, item: {
                    id: 'official/sample', slug: 'sample', releaseVersion: '2026.10.20', releasedAt: '2026-10-20T00:00:00.000Z',
                    tool: { name: 'Sample' }, package: { url: 'sample.zip', size: buffer.length,
                        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
                        directoryFingerprint: fingerprintFiles(packageDir, files),
                        files: files.map(file => ({ path: file, size: fs.statSync(path.join(packageDir, file)).size,
                            sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(packageDir, file))).digest('hex') })) }
                } };
                const preview = await market.previewMarket({ force: true });
                const item = preview.tools[0];
                assert.equal(item.status, 'update');
                const result = await market.applyMarketUpdates({ slugs: ['sample'], expectedFingerprints: { sample: item.fingerprint } });
                assert.deepEqual(result.updated, ['sample']);
                assert.equal(html('market-download'), `<p>${version}</p>`);
                assert.equal(result.preview.tools[0].status, 'unchanged');
                assert.deepEqual((await initialize('market-download')).pending, []);
                assert.equal(html('market-download'), `<p>${version}</p>`);
            }
            bundle('bundled newer', '2026-10-21T00:00:00.000Z');
            assert.deepEqual((await initialize('market-download')).updated, []);
            const next = (await market.previewMarket({ force: true })).tools[0];
            assert.equal(next.selectedSource, 'builtin');
            assert.deepEqual((await market.applyMarketUpdates({ slugs: ['sample'], expectedFingerprints: { sample: next.fingerprint } })).updated, ['sample']);
            assert.equal(html('market-download'), '<p>bundled newer</p>', 'the market can explicitly select the bundled release too');
        });
    } finally { await new Promise(resolve => server.close(resolve)); }
});
