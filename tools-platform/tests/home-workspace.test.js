const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getPageUpdateTimes, isSharedChurnOnly, PAGE_FILES } = require('../backend/models/page-update-times');

const root = path.join(__dirname, '..');
const frontendDir = path.join(root, 'frontend');

test('shared asset churn (version bumps, shared script tags, favicons) is not a page update', () => {
    assert.equal(isSharedChurnOnly([
        '-    <script src="/js/shared/navbar.js?v=20261005-01"></script>',
        '+    <script src="/js/shared/navbar.js?v=20261006-04"></script>'
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
    assert.match(html, /id="homeToolSearch"/);
    assert.match(html, /id="homeCategoryNav"/);
    assert.match(html, /href="\/css\/home-workspace\.css"/);
    assert.match(html, /src="\/js\/home\/workspace\.js"/);
    // 侧栏内仍保留管理员导入入口与友情链接管理
    const sidebar = html.slice(html.indexOf('<aside class="home-sidebar"'), html.indexOf('</aside>'));
    assert.match(sidebar, /id="customToolsPanel"/);
    assert.match(sidebar, /id="friendLinksManageBtn"/);
    // 更新时间 API 位于鉴权之后
    assert.ok(server.indexOf("app.get('/api/home/page-updates'") > server.indexOf("app.use('/api', checkAuth)"));
});
