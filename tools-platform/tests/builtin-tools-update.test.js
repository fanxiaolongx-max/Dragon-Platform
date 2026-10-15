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
