const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-size-policy-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const service = require('../backend/models/snapshot-publish-service');
const security = require('../backend/models/snapshot-portal-security');
const policy = require('../backend/models/snapshot-size-policy');
const remote = path.join(temp, 'remote.git'), seed = path.join(temp, 'seed');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const show = name => git('--git-dir=' + remote, 'show', 'main:' + name);
let heavyBytes = Buffer.alloc(51 * 1024 * 1024, 97), version = 0;
const html = '<!doctype html><html><head></head><body>Read only</body></html>';
async function finish(options) {
    const job = await service.startJob('default', options);
    for (let n = 0; n < 1200; n++) {
        const result = await service.getJob(job.id);
        if (result.status !== 'running') return result;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Publishing test timed out');
}
test.before(async () => {
    git('init', '--bare', remote); git('clone', remote, seed); git('-C', seed, 'checkout', '-b', 'main');
    fs.writeFileSync(path.join(seed, 'README.md'), 'Fixture'); git('-C', seed, 'add', '.');
    git('-C', seed, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial');
    git('-C', seed, 'push', 'origin', 'main');
    service.registerProvider('size-light', { name: 'Light', buildPagesSnapshot: async () => ({ html, files: new Map([['data/value.json', JSON.stringify({ version })]]) }) });
    service.registerProvider('size-heavy', { name: 'Heavy', buildPagesSnapshot: async () => ({ html, files: new Map([['data/large.txt', heavyBytes]]) }) });
    await service.saveSettings({ remoteUrl: remote, branch: 'main', file: '{toolSlug}/index.html', publishMode: 'pages' }).catch(async () => {
        await service.saveSettings({ repoDir: seed, branch: 'main', file: '{toolSlug}/index.html', publishMode: 'pages' });
    });
    await service.saveToolSettings('department-reward-penalty', { enabled: false });
    await service.saveToolSettings('size-light', { enabled: true });
    await service.saveToolSettings('size-heavy', { enabled: true });
});
test.after(async () => {
    heavyBytes = null;
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/platform-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('bulk Force skips large tools and a single ordinary publish cannot override the policy', async () => {
    const result = await finish({ force: true });
    assert.equal(result.status, 'success', JSON.stringify(result.entries));
    assert.ok(result.commandLogs.some(log => log.msg?.includes('[批量跳过] Heavy')));
    const menu = JSON.parse(show('.tools-platform-menu.json')).items;
    assert.ok(menu.some(item => item.slug === 'size-light'));
    assert.equal(menu.some(item => item.slug === 'size-heavy'), false);
    const old = git('--git-dir=' + remote, 'rev-parse', 'main');
    const blocked = await finish({ toolSlug: 'size-heavy' });
    assert.equal(blocked.status, 'failed');
    assert.match(blocked.entries.at(-1).message, /强制推送/);
    assert.equal(git('--git-dir=' + remote, 'rev-parse', 'main'), old);
});

test('per-tool Force keeps a 51 MiB file complete but encrypts it in small Git objects; bulk retains it', async () => {
    const result = await finish({ toolSlug: 'size-heavy', force: true });
    assert.equal(result.status, 'success', JSON.stringify(result.entries));
    const manifest = JSON.parse(show('tp-static/site.json'));
    const entry = manifest.files['size-heavy/data/large.txt'];
    assert.ok(entry.parts.length > 1);
    const key = await security.getKey(manifest.keyId);
    const restored = Buffer.concat(entry.parts.map(part => {
        const encrypted = execFileSync('git', ['--git-dir=' + remote, 'show', 'main:' + part.url], { maxBuffer: policy.PAYLOAD_CHUNK_BYTES + 1024 });
        assert.ok(encrypted.length <= policy.PAYLOAD_CHUNK_BYTES + 16);
        return security.open(encrypted, key, part.iv);
    }));
    assert.equal(restored.equals(heavyBytes), true);
    assert.equal(JSON.parse(show('.tools-platform-menu.json')).items.find(item => item.slug === 'size-heavy').batchExcluded, true);
    // A disabled bulk checkbox must not erase a page explicitly published with per-tool Force.
    await service.saveToolSettings('size-heavy', { enabled: false });
    version++;
    const next = await finish({});
    assert.equal(next.status, 'success', JSON.stringify(next.entries));
    assert.deepEqual(JSON.parse(show('tp-static/site.json')).files['size-heavy/data/large.txt'], entry);
    heavyBytes[0] = 98;
    assert.equal((await finish({ toolSlug: 'size-heavy', force: true })).status, 'success');
    const changed = JSON.parse(show('tp-static/site.json')).files['size-heavy/data/large.txt'];
    assert.notEqual(changed.parts[0].iv, entry.parts[0].iv);
    assert.deepEqual(changed.parts.slice(1), entry.parts.slice(1), 'unchanged chunks retain ciphertext instead of uploading 51 MiB again');
    heavyBytes = Buffer.from('small replacement');
    assert.equal((await finish({ toolSlug: 'size-heavy', force: true })).status, 'success');
    for (const part of changed.parts) assert.throws(() => show(part.url), 'obsolete chunks should be removed from the current tree');

});

test('estimates are scoped by tenant/mode and generic file counts use metadata rather than payload reads', async () => {
    const estimate = await service.estimateToolSnapshot('default', 'size-heavy', 'pages', true);
    assert.equal(estimate.isHeavy, false); assert.equal(estimate.maxFileBytes, Buffer.byteLength(html));
    service.registerProvider('size-tenant', { name: 'Tenant', buildPagesSnapshot: async tenant => ({ html, files: new Map([['data.txt', tenant === 'beta' ? 'b'.repeat(policy.HEAVY_BYTES) : 'small']]) }) });
    assert.equal((await service.estimateToolSnapshot('default', 'size-tenant', 'pages')).isHeavy, false);
    assert.equal((await service.estimateToolSnapshot('beta', 'size-tenant', 'pages')).isHeavy, true);
    const tools = require('../backend/models/custom-tools-repository');
    await tools.createTool({ slug: 'size-generic', name: 'Generic', htmlContent: html });
    const root = tools.getToolRootDir('size-generic');
    for (let n = 0; n < 100; n++) fs.writeFileSync(path.join(root, n + '.txt'), 'tiny');
    const many = await service.estimateToolSnapshot('default', 'size-generic', 'pages', true);
    assert.equal(many.fileCount, 101); assert.equal(many.isHeavy, true);
    assert.equal((await service.estimateToolSnapshot('default', 'size-generic', 'single', true)).isHeavy, false);
});

test('Git retries are reserved for transient errors, not policy, authentication or concurrent updates', () => {
    for (const stderr of ['remote: error: pre-receive hook declined', 'Authentication failed', 'non-fast-forward', 'remote rejected: branch is protected']) assert.equal(service.isTransientGitError({ stderr }), false);
    for (const stderr of ['Connection reset by peer', 'HTTP 503', 'Could not resolve host', 'early EOF']) assert.equal(service.isTransientGitError({ stderr }), true);
});
