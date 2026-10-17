const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    createFrontendHtmlMiddleware,
    createImmutableAssetMiddleware,
    fileHash,
    versionAssetUrls
} = require('../backend/models/asset-versioning');

const root = path.join(__dirname, '..');

function makeSandbox(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-asset-versioning-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'js/shared'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'js/shared/navbar.js'), 'console.log(1);');
    fs.writeFileSync(path.join(dir, 'css/shared.css'), 'body{}');
    fs.writeFileSync(path.join(dir, 'pages/local.js'), 'void 0;');
    return dir;
}

function fakeRes() {
    const headers = {};
    return {
        headers,
        body: null,
        getHeader: name => headers[name.toLowerCase()],
        setHeader(name, value) { headers[name.toLowerCase()] = value; },
        type(value) { headers['content-type'] = value; return this; },
        status() { return this; },
        send(body) { this.body = body; return this; }
    };
}

test('versionAssetUrls appends content hashes and replaces stale manual versions', t => {
    const dir = makeSandbox(t);
    const navHash = fileHash(path.join(dir, 'js/shared/navbar.js'));
    const html = [
        '<link rel="stylesheet" href="/css/shared.css">',
        '<script src="/js/shared/navbar.js?v=20261013-02"></script>',
        "<script src='local.js'></script>",
        '<script src="https://cdnjs.cloudflare.com/x.js"></script>',
        '<script src="/js/missing.js"></script>',
        '<script src="/../outside.js"></script>'
    ].join('\n');
    const out = versionAssetUrls(html, { publicDir: dir, baseDir: path.join(dir, 'pages') });

    assert.match(out, new RegExp(`/js/shared/navbar\\.js\\?v=${navHash}"`));
    assert.match(out, /href="\/css\/shared\.css\?v=[0-9a-f]{10}"/);
    assert.match(out, /src='local\.js\?v=[0-9a-f]{10}'/);
    assert.match(out, /src="https:\/\/cdnjs\.cloudflare\.com\/x\.js"/);
    assert.match(out, /src="\/js\/missing\.js"/);
    assert.match(out, /src="\/\.\.\/outside\.js"/);
});

test('content hash changes when the file changes', t => {
    const dir = makeSandbox(t);
    const file = path.join(dir, 'js/shared/navbar.js');
    const before = fileHash(file);
    fs.writeFileSync(file, 'console.log("changed, longer");');
    assert.notEqual(fileHash(file), before);
});

test('frontend html middleware serves versioned pages and skips non-html paths', t => {
    const dir = makeSandbox(t);
    fs.writeFileSync(path.join(dir, 'pages/a.html'), '<script src="/js/shared/navbar.js"></script>');
    const middleware = createFrontendHtmlMiddleware(dir);

    const res = fakeRes();
    middleware({ method: 'GET', path: '/pages/a.html' }, res, () => assert.fail('should serve'));
    assert.match(res.body, /navbar\.js\?v=[0-9a-f]{10}/);
    assert.equal(res.headers['cache-control'], 'no-cache');

    let passed = 0;
    middleware({ method: 'GET', path: '/js/shared/navbar.js' }, fakeRes(), () => passed++);
    middleware({ method: 'GET', path: '/pages/missing.html' }, fakeRes(), () => passed++);
    middleware({ method: 'POST', path: '/pages/a.html' }, fakeRes(), () => passed++);
    assert.equal(passed, 3);
});

test('only requests carrying the current hash get long-lived caching', t => {
    const dir = makeSandbox(t);
    const middleware = createImmutableAssetMiddleware(dir);
    const hash = fileHash(path.join(dir, 'js/shared/navbar.js'));

    const fresh = fakeRes();
    middleware({ method: 'GET', path: '/js/shared/navbar.js', query: { v: hash } }, fresh, () => {});
    assert.match(fresh.headers['cache-control'], /immutable/);

    const stale = fakeRes();
    middleware({ method: 'GET', path: '/js/shared/navbar.js', query: { v: '20261013-02' } }, stale, () => {});
    assert.equal(stale.headers['cache-control'], undefined);
});

test('frontend html no longer carries hand-maintained ?v= on local js/css', () => {
    const offenders = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.html')) {
                const matches = fs.readFileSync(full, 'utf8')
                    .match(/(?:src|href)=["'](?![a-z]+:|\/\/)[^"'?#\s]+\.(?:m?js|css)\?v=[^"']*["']/gi) || [];
                matches.forEach(match => offenders.push(`${path.relative(root, full)}: ${match}`));
            }
        }
    };
    walk(path.join(root, 'frontend'));
    assert.deepEqual(offenders, [], 'Versions are added by backend/models/asset-versioning.js; drop the manual ?v=');
});

const f12ToolDir = path.join(root, 'backend/builtin-tools/f12-to-extension');

test('F12 packer scripts are versioned by content when the tool page is served', () => {
    // server.js serves custom-tool pages through versionAssetUrls with the tool directory as baseDir.
    const html = fs.readFileSync(path.join(f12ToolDir, 'index.html'), 'utf8');
    const local = [...html.matchAll(/<script src="(\.\/[^"]+)"/g)].map(match => match[1]);
    assert.ok(local.includes('./netcare-settings.js') && local.includes('./packer-core.js'));
    assert.deepEqual(local.filter(src => src.includes('?')), [], 'Drop the manual ?v=; content hashes are added when served');
    const served = versionAssetUrls(html, { publicDir: path.join(root, 'frontend'), baseDir: f12ToolDir });
    for (const src of local) {
        const hash = fileHash(path.join(f12ToolDir, src));
        assert.ok(hash, `${src} is missing`);
        assert.ok(served.includes(`src="${src}?v=${hash}"`), `${src} is not versioned by content`);
    }
});

test('F12 built-in catalog points at existing scripts without hand-maintained versions', () => {
    const catalog = require(path.join(f12ToolDir, 'builtin-catalog.js'));
    for (const [id, preset] of Object.entries(catalog)) {
        if (!preset.file) continue;
        // The packer fetches these with a cache-busting query, so they need no version of their own.
        assert.match(preset.file, /^\.\/[\w.-]+\.js$/, id);
        assert.ok(fs.existsSync(path.join(f12ToolDir, preset.file)), `${id}: ${preset.file} is missing`);
    }
    assert.match(fs.readFileSync(path.join(f12ToolDir, 'index.html'), 'utf8'), /fetch\(preset\.file \+ '\?t=' \+ Date\.now\(\)\)/);
});
