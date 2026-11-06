const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyBuiltinToolsInWorker } = require('../backend/models/builtin-tools-update-service');
const { previewBuiltinTools, applyBuiltinToolDecisions } = require('../backend/models/builtin-tools-sync');

function write(root, file, content) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
}
function bundle(sourceDir, slug, content = 'new version') {
    write(sourceDir, `${slug}/index.html`, content);
    write(sourceDir, `${slug}/.tool-manifest.json`, JSON.stringify({ version: 1, tool: { slug, name: slug } }));
}
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-update-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const options = { sourceDir: path.join(root, 'source'), targetDir: path.join(root, 'tenant-a/custom-tools'),
        stateFile: path.join(root, 'tenant-a/decisions.json'), backupRoot: path.join(root, 'tenant-a/backups'), includePreview: false };
    bundle(options.sourceDir, 'sample');
    const preview = previewBuiltinTools(options);
    options.applySlugs = ['sample'];
    options.expectedFingerprints = { sample: preview.pending[0].fingerprint };
    return { root, options };
}

test('worker streams real phases, preserves files/backups and leaves the main event loop available', async t => {
    const { options } = fixture(t);
    applyBuiltinToolDecisions(options);
    bundle(options.sourceDir, 'sample', '<p>updated</p>');
    write(options.sourceDir, 'sample/assets/payload.bin', Buffer.alloc(8 * 1024 * 1024, 0));
    const preview = previewBuiltinTools(options);
    options.expectedFingerprints.sample = preview.pending[0].fingerprint;
    write(options.targetDir, 'sample/user-state.json', '{"saved":true}');
    // A broken, unselected bundle must not cause a full-library rescan on apply.
    write(options.sourceDir, 'unrelated/index.html', 'unrelated');
    let ticks = 0;
    const timer = setInterval(() => ticks++, 2);
    const progress = [];
    let result;
    try { result = await applyBuiltinToolsInWorker(options, { onProgress: event => progress.push(event) }); }
    finally { clearInterval(timer); }
    assert.ok(ticks > 0, 'main thread timers run while the worker hashes/copies');
    assert.deepEqual(result.updated, ['sample']);
    assert.equal(result.preview, undefined, 'streamed apply avoids the final full preview scan');
    assert.equal(fs.readFileSync(path.join(options.targetDir, 'sample/index.html'), 'utf8'), '<p>updated</p>');
    assert.equal(fs.readFileSync(path.join(options.targetDir, 'sample/user-state.json'), 'utf8'), '{"saved":true}');
    assert.equal(fs.readFileSync(path.join(result.backups[0].path, 'index.html'), 'utf8'), 'new version');
    assert.equal(fs.readFileSync(path.join(result.backups[0].path, 'user-state.json'), 'utf8'), '{"saved":true}');
    assert.equal(progress[0].stage, 'validating');
    assert.ok(progress.some(event => event.stage === 'backing_up'));
    assert.ok(progress.some(event => event.stage === 'copying' && event.filesCompleted === event.filesTotal));
    assert.equal(progress.at(-1).stage, 'saving');
    assert.equal(progress.at(-1).completed, 1);
});

test('same tenant is locked through registry reconciliation; another tenant updates independently', async t => {
    const { root, options } = fixture(t);
    let release;
    let started;
    const gate = new Promise(resolve => { release = resolve; });
    const finalizing = new Promise(resolve => { started = resolve; });
    const first = applyBuiltinToolsInWorker(options, { finalize: async result => { started(); await gate; return result; } });
    try {
        await finalizing;
        await assert.rejects(applyBuiltinToolsInWorker(options), error => error.status === 409);
        const other = { ...options, targetDir: path.join(root, 'tenant-b/custom-tools'),
            stateFile: path.join(root, 'tenant-b/decisions.json'), backupRoot: path.join(root, 'tenant-b/backups') };
        assert.deepEqual((await applyBuiltinToolsInWorker(other)).installed, ['sample']);
        assert.equal(fs.existsSync(path.join(root, 'custom-tools')), false);
        assert.equal(fs.existsSync(path.join(options.targetDir, 'sample/index.html')), true);
        assert.equal(fs.existsSync(path.join(other.targetDir, 'sample/index.html')), true);
    } finally { release(); await first; }
});

test('all fingerprints are checked before any write, and failed workers release their lock', async t => {
    const { options } = fixture(t);
    bundle(options.sourceDir, 'second');
    const invalid = { ...options, applySlugs: ['sample', 'second'], expectedFingerprints: { ...options.expectedFingerprints, second: 'stale' } };
    await assert.rejects(applyBuiltinToolsInWorker(invalid), error => error.status === 409);
    assert.equal(fs.existsSync(path.join(options.targetDir, 'sample')), false);
    await assert.rejects(applyBuiltinToolsInWorker({ ...options, expectedFingerprints: {} }), error => error.status === 400);
    const valid = await applyBuiltinToolsInWorker({ ...options, includePreview: true });
    assert.deepEqual(valid.installed, ['sample']);
    assert.equal(valid.preview.pending[0].slug, 'second', 'legacy callers retain the full preview');
});

test('recommendations compare full program sizes and release metadata without counting retained user files', t => {
    const { options } = fixture(t);
    const manifest = (directory, version, updatedAt) => {
        const file = path.join(directory, 'sample/.tool-manifest.json');
        const data = JSON.parse(fs.readFileSync(file));
        data.tool.version = version; data.tool.updatedAt = updatedAt;
        fs.writeFileSync(file, JSON.stringify(data));
    };
    manifest(options.sourceDir, '1.0.0', '2026-10-01T00:00:00Z');
    options.expectedFingerprints.sample = previewBuiltinTools(options).pending[0].fingerprint;
    applyBuiltinToolDecisions(options);
    write(options.targetDir, 'sample/user-data.json', 'x'.repeat(20000));
    write(options.sourceDir, 'sample/index.html', 'new code'.repeat(100));
    manifest(options.sourceDir, '2.0.0', '2026-11-01T00:00:00Z');
    let tool = previewBuiltinTools(options).pending[0];
    assert.equal(tool.recommended, true);
    assert.equal(tool.recommendation.reason, 'newer-larger');
    assert.equal(tool.bundledReleaseBytes, 800);
    assert.ok(tool.currentReleaseBytes < 100, 'extra user data is not misclassified as part of the program release');
    write(options.targetDir, 'sample/index.html', 'local change');
    tool = previewBuiltinTools(options).pending[0];
    assert.equal(tool.localChanges, true); assert.equal(tool.recommended, true, 'newer metadata plus increased size informs an explicit selection');
    manifest(options.targetDir, '3.0.0', '2026-12-01T00:00:00Z');
    tool = previewBuiltinTools(options).pending[0];
    assert.equal(tool.recommended, false, 'larger but explicitly older bundles do not recommend a downgrade');
    manifest(options.targetDir, undefined, undefined); manifest(options.sourceDir, undefined, undefined);
    tool = previewBuiltinTools(options).pending[0];
    assert.equal(tool.recommended, true); assert.equal(tool.recommendation.reason, 'larger-release');
    write(options.targetDir, 'sample/index.html', 'local change'.repeat(100));
    tool = previewBuiltinTools(options).pending[0];
    assert.equal(tool.recommended, false, 'unknown release metadata and smaller bundled code retain local changes for review');
});

test('pruneOldBackupBatches retains newest N batches and removes older ones', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-prune-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { pruneOldBackupBatches } = require('../backend/models/builtin-tools-sync');
    for (let i = 1; i <= 25; i++) {
        const name = `2026-11-06T10-${String(i).padStart(2, '0')}-00`;
        fs.mkdirSync(path.join(root, name), { recursive: true });
    }
    assert.equal(fs.readdirSync(root).length, 25);
    pruneOldBackupBatches(root, 20);
    const remaining = fs.readdirSync(root).sort();
    assert.equal(remaining.length, 20);
    assert.equal(remaining[0], '2026-11-06T10-06-00');
    assert.equal(remaining[19], '2026-11-06T10-25-00');
});
