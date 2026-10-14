const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('knowledge graph exposes cancellable NDJSON progress and tenant-scoped caching', () => {
    const routeSource = read('backend/routes/ai.js');
    const serviceSource = read('backend/models/ai-knowledge-service.js');

    assert.match(routeSource, /router\.get\('\/knowledge\/graph-stream'/);
    assert.match(routeSource, /application\/x-ndjson/);
    assert.match(routeSource, /new AbortController\(\)/);
    assert.match(routeSource, /onProgress: progress/);
    assert.match(serviceSource, /const graphCaches = new Map\(\)/);
    assert.match(serviceSource, /GRAPH_CACHE_TTL_MS/);
    assert.match(serviceSource, /throwIfAborted\(signal\)/);
    assert.match(serviceSource, /reportProgress\(onProgress/);
});

test('graph UI cancels stale loads, keeps enabled motion running, and avoids all-pairs collision scans', () => {
    const graphSource = read('frontend/js/shared/ai-knowledge-graph-spatial-themes-v5.js');

    assert.match(graphSource, /\/api\/ai\/knowledge\/graph-stream/);
    assert.match(graphSource, /state\.loadController\?\.abort\(\)/);
    assert.match(graphSource, /ai-kg-loading-bar/);
    assert.match(graphSource, /\/api\/chat-history\/status/);
    assert.match(graphSource, /loadChatGraphWithProgress/);
    assert.match(graphSource, /function forEachNearbyNodePair/);
    assert.doesNotMatch(graphSource, /for \(let j = i \+ 1; j < nodes\.length; j \+= 1\)/);
    assert.doesNotMatch(graphSource, /state\.alpha < 0\.045.*state\.running = false/);
});

test('custom tool shell reports stages, times out, and offers retry', () => {
    const shellSource = read('frontend/pages/custom-tool.html');

    assert.match(shellSource, /custom-tool-progress/);
    assert.match(shellSource, /toolLoadRetry/);
    assert.match(shellSource, /setToolLoadState/);
    assert.match(shellSource, /15000/);
    assert.match(shellSource, /30000/);
});

test('shared navbar checks built-in tools after page load unless the market was opened', () => {
    const navbarSource = read('frontend/js/shared/navbar.js');
    const customToolsRouteSource = read('backend/routes/custom-tools.js');
    assert.doesNotMatch(navbarSource, /BUILTIN_TOOLS_SYNC_SESSION_KEY/);
    assert.match(navbarSource, /isBuiltinToolsSyncSnoozedToday\(\)/);
    assert.match(navbarSource, /requestIdleCallback/);
    assert.match(navbarSource, /setTimeout\(checkBuiltinToolsSync, 8000\)/);
    assert.match(navbarSource, /toolMarketOpened\(\)/);
    assert.match(read('frontend/index.html'), /button\.dataset\.opened = '1'/);
    assert.match(customToolsRouteSource, /new Worker\(/);
    assert.match(customToolsRouteSource, /previewBuiltinToolsOffMainThread/);

    const htmlFiles = [
        path.join(root, 'frontend/index.html'),
        ...fs.readdirSync(path.join(root, 'frontend/pages'))
            .filter(name => name.endsWith('.html'))
            .map(name => path.join(root, 'frontend/pages', name))
    ];
    // Versions are appended by the server from file content (backend/models/asset-versioning.js);
    // pages must reference navbar.js without a hand-maintained ?v=.
    const navbarReferences = htmlFiles
        .map(filePath => fs.readFileSync(filePath, 'utf8').match(/navbar\.js(\?[^"']*)?["']/))
        .filter(Boolean);
    assert.ok(navbarReferences.length > 1);
    assert.deepEqual(navbarReferences.filter(match => match[1]).map(match => match[0]), []);
});

test('built-in tool preview worker returns a serializable preview off the main thread', async t => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-preview-worker-'));
    t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
    const sourceDir = path.join(sandbox, 'source');
    const targetDir = path.join(sandbox, 'target');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(
        path.join(root, 'backend/builtin-tools/chat-history-center'),
        path.join(sourceDir, 'chat-history-center'),
        { recursive: true }
    );

    const result = await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(root, 'backend/workers/builtin-tools-preview-worker.js'), {
            workerData: { sourceDir, targetDir, stateFile: path.join(sandbox, 'state.json') }
        });
        worker.once('message', resolve);
        worker.once('error', reject);
    });
    assert.equal(result.ok, true);
    assert.equal(result.preview.pending.length, 1);
    assert.equal(result.preview.pending[0].slug, 'chat-history-center');
});
