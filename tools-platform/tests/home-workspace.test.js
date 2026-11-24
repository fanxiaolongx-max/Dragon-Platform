const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getPageUpdateTimes, collectPageFiles, clearCache, isSharedChurnOnly, PAGE_FILES } = require('../backend/models/page-update-times');

const root = path.join(__dirname, '..');
const frontendDir = path.join(root, 'frontend');

test('shared asset churn (version bumps, shared script tags, favicons) is not a page update', () => {
    assert.equal(isSharedChurnOnly([
        '-    <script src="/js/shared/platform-core.js?v=20261005-01"></script>',
        '+    <script src="/js/shared/platform-core.js?v=20261006-04"></script>'
    ]), true);
    assert.equal(isSharedChurnOnly([
        '+    <script src="/js/shared/platform-logo-upload.js?v=20261006-02"></script>',
        '+    <link rel="icon" type="image/png" sizes="32x32" href="/assets/icon.png?v=20261006">'
    ]), true);
    assert.equal(isSharedChurnOnly([
        '-    <script src="/js/sla/main.js?v=1"></script>',
        '+    <script src="/js/sla/main.js?v=2"></script>'
    ]), true);
    assert.equal(isSharedChurnOnly([
        '-        <h1>旧标题</h1>',
        '+        <h1>新标题</h1>'
    ]), false);
    assert.equal(isSharedChurnOnly([
        '+    <script src="/js/sla/new-feature.js"></script>'
    ]), false);
});

test('every mapped builtin page exists and gets an update time', async () => {
    for (const relPath of Object.values(PAGE_FILES)) {
        assert.ok(fs.existsSync(path.join(frontendDir, relPath)), `${relPath} exists`);
    }
    const times = await getPageUpdateTimes(frontendDir);
    assert.deepEqual(Object.keys(times).sort(), Object.keys(PAGE_FILES).sort());
    Object.values(times).forEach(value => assert.ok(Number.isFinite(Date.parse(value))));
});

test('home page wires the workspace sidebar, grid and update-time API', () => {
    const html = fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf8');
    const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
    assert.match(html, /<aside class="home-sidebar" id="homeSidebar"/);
    assert.doesNotMatch(html, /id="homeToolSearch"/);
    assert.doesNotMatch(html, /id="homeCategoryNav"/);
    assert.match(html, /href="\/css\/home-workspace\.css"/);
    assert.match(html, /src="\/js\/home\/workspace\.js"/);
    // 侧栏内仍保留管理员导入入口与友情链接管理
    const sidebar = html.slice(html.indexOf('<aside class="home-sidebar"'), html.indexOf('</aside>'));
    assert.doesNotMatch(sidebar, /class="home-rail"|id="customToolsPanel"/);
    const shell = fs.readFileSync(path.join(frontendDir, 'js/home/home-shell.js'), 'utf8');
    assert.match(shell, /HomeTools\?\.openImport/);
    assert.match(shell, /HomeTools\?\.openMarket/);
    assert.match(sidebar, /id="friendLinksManageBtn"/);
    // 更新时间 API 位于鉴权之后
    assert.ok(server.indexOf("app.get('/api/home/page-updates'") > server.indexOf("app.use('/api', checkAuth)"));
});

test('cross-page reused assets stay scoped to their owning page and startup-screen.css is treated as shared', () => {
    const owned = collectPageFiles(frontendDir);
    const rel = files => files.map(f => path.relative(frontendDir, f).replace(/\\/g, '/'));
    const aiBiFiles = rel(owned['/ai-bi'] || []);
    const monthlyFiles = rel(owned['/monthly'] || []);
    assert.ok(aiBiFiles.includes('pages/ai-bi.html'));
    assert.ok(aiBiFiles.includes('css/ai-bi.css'));
    assert.ok(!aiBiFiles.some(f => f.startsWith('js/ai-report/') || f === 'css/ai-report.css'),
        `ai-bi should not inherit ai-report assets: ${aiBiFiles.join(', ')}`);
    assert.ok(monthlyFiles.some(f => f === 'js/ai-report/query.js'));
    for (const [href, files] of Object.entries(owned)) {
        assert.ok(!rel(files).includes('css/startup-screen.css'), `${href} should not count shared startup-screen.css`);
    }
});

test('packaged non-git environments prefer bundled assets/page-updates.json over file mtime', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-page-updates-'));
    try {
        fs.mkdirSync(path.join(tempDir, 'pages'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, 'pages/ai-bi.html'), '<html></html>');
        fs.writeFileSync(path.join(tempDir, 'pages/uivf12.html'), '<html></html>');
        const fixedIso = '2026-10-01T08:00:00.000Z';
        fs.writeFileSync(path.join(tempDir, 'assets/page-updates.json'), JSON.stringify({
            '/ai-bi': fixedIso
        }));
        clearCache();
        const times = await getPageUpdateTimes(tempDir);
        assert.equal(times['/ai-bi'], fixedIso);
        assert.ok(Date.parse(times['/uivf12']) > Date.parse(fixedIso));
    } finally {
        clearCache();
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
