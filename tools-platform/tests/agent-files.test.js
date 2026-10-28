const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-files-')));
const outputsRoot = path.join(sandbox, 'outputs');
process.env.TOOLS_AGENT_FILE_ROOTS = outputsRoot;

const express = require('../backend/node_modules/express');
const router = require('../backend/routes/agent-files');

fs.mkdirSync(path.join(sandbox, 'work', '.ssh'), { recursive: true });
fs.mkdirSync(outputsRoot, { recursive: true });
const report = path.join(sandbox, 'work', 'NetCare与报表指标对照.xlsx');
fs.writeFileSync(report, 'xlsx-bytes');
fs.writeFileSync(path.join(sandbox, 'work', 'chart.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
fs.writeFileSync(path.join(sandbox, 'work', 'page.html'), '<script>alert(1)</script>');
fs.writeFileSync(path.join(sandbox, 'work', 'notes.md'), '# hi');
fs.writeFileSync(path.join(sandbox, 'work', '.env'), 'SECRET=1');
fs.writeFileSync(path.join(sandbox, 'work', '.ssh', 'config.txt'), 'Host x');
fs.writeFileSync(path.join(sandbox, 'work', 'data.db'), 'sqlite');
fs.writeFileSync(path.join(outputsRoot, 'shared.csv'), 'a,b\n1,2\n');

let server;
let base;
test.before(async () => {
    const app = express();
    app.use((req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (role) req.user = { username: 'u', role };
        Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: req.headers['x-test-remote'] ? '192.0.2.1' : '127.0.0.1' });
        next();
    });
    app.use(router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
    server?.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const get = (route, filePath, headers = {}) => fetch(`${base}${route}?path=${encodeURIComponent(filePath)}`, { headers });
const adminRemote = { 'x-test-role': 'admin', 'x-test-remote': '1' };
const viewerRemote = { 'x-test-role': 'viewer', 'x-test-remote': '1' };
const viewerLocal = { 'x-test-role': 'viewer' };

test('admins download any local output file with a UTF-8 attachment name', async () => {
    const response = await fetch(`${base}/raw?download=1&path=${encodeURIComponent(report)}`, { headers: adminRemote });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /^attachment;.*filename\*=UTF-8''NetCare%E4%B8%8E/);
    assert.equal(await response.text(), 'xlsx-bytes');
    const info = await (await get('/stat', report, viewerLocal)).json();
    assert.deepEqual([info.name, info.size, info.kind], ['NetCare与报表指标对照.xlsx', 10, 'file']);
});

test('citation line suffixes and file:// URLs resolve to the file', async () => {
    assert.equal((await get('/stat', `${path.join(sandbox, 'work', 'notes.md')}:55`, adminRemote)).status, 200);
    assert.equal((await get('/stat', `file://${encodeURI(report)}`, adminRemote)).status, 200);
});

test('images preview inline; html is always an attachment and sandboxed', async () => {
    const image = await get('/raw', path.join(sandbox, 'work', 'chart.png'), adminRemote);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.match(image.headers.get('content-disposition'), /^inline/);
    const page = await get('/raw', path.join(sandbox, 'work', 'page.html'), adminRemote);
    assert.match(page.headers.get('content-disposition'), /^attachment/);
    assert.equal(page.headers.get('content-type'), 'application/octet-stream');
    assert.match(page.headers.get('content-security-policy'), /sandbox/);
});

test('secrets, hidden folders, databases, relative paths and missing files are refused', async () => {
    assert.equal((await get('/raw', path.join(sandbox, 'work', '.env'), adminRemote)).status, 415);
    assert.equal((await get('/raw', path.join(sandbox, 'work', '.ssh', 'config.txt'), adminRemote)).status, 403);
    assert.equal((await get('/raw', path.join(sandbox, 'work', 'data.db'), adminRemote)).status, 415);
    assert.equal((await get('/raw', 'work/notes.md', adminRemote)).status, 400);
    assert.equal((await get('/raw', path.join(sandbox, 'work', 'gone.xlsx'), adminRemote)).status, 404);
    assert.equal((await get('/raw', path.join(sandbox, 'work', '..', 'work', '.ssh', 'config.txt'), adminRemote)).status, 403);
});

test('remote non-admin viewers only reach the outputs roots', async () => {
    assert.equal((await get('/raw', report, viewerRemote)).status, 403);
    const shared = await get('/raw', path.join(outputsRoot, 'shared.csv'), viewerRemote);
    assert.equal(shared.status, 200);
    assert.equal(await shared.text(), 'a,b\n1,2\n');
});

function loadChatFiles() {
    const listeners = {};
    const context = {
        window: {},
        localStorage: { getItem: () => 'zh-CN' },
        sessionStorage: { getItem: () => null },
        document: {
            documentElement: { lang: 'zh-CN' },
            head: { appendChild() {} },
            addEventListener: (type, fn) => { listeners[type] = fn; },
            createElement: () => ({ set textContent(_v) {} })
        },
        MutationObserver: class { observe() {} },
        HTMLImageElement: class {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/chat-files.js'), 'utf8'), context);
    return context.window.ChatFiles;
}

test('chat markdown turns local files into download cards and images into zoomable previews', () => {
    const ChatFiles = loadChatFiles();
    const render = text => {
        const tokens = [];
        const out = ChatFiles.transformInline(text, html => { tokens.push(html); return `#${tokens.length - 1}#`; });
        return { out, tokens };
    };

    const citation = render(':codex-file-citation{path="/Volumes/512G/out/NetCare与报表指标对照.xlsx" artifact_kind="workbook" purpose="output"}');
    assert.equal(citation.out, '#0#');
    assert.match(citation.tokens[0], /class="ai-file-chip"/);
    assert.match(citation.tokens[0], /data-ext="xlsx"/);
    assert.match(citation.tokens[0], /\/api\/agent-files\/raw\?path=%2FVolumes%2F512G%2Fout%2FNetCare.*&amp;download=1" download="NetCare与报表指标对照.xlsx"/);

    const link = render('[对接说明](</Volumes/512G/a b/digital-human-netcare.md:55>)');
    assert.match(link.tokens[0], />对接说明</);
    assert.match(link.tokens[0], /path=%2FVolumes%2F512G%2Fa%20b%2Fdigital-human-netcare.md"/);

    const image = render('看图 ![趋势](/Users/me/Desktop/chart.png) 完');
    assert.match(image.tokens[0], /<img src="\/api\/agent-files\/raw\?path=%2FUsers%2Fme%2FDesktop%2Fchart.png"[^>]*data-ai-zoom="1"/);
    const remote = render('![logo](https://example.com/a.webp)');
    assert.match(remote.tokens[0], /<img src="https:\/\/example.com\/a.webp"/);

    const bare = render('已保存到：/Volumes/512G/06-工具开发/outputs/报告.pptx，请查收');
    assert.equal(bare.out, '已保存到：#0#，请查收');
    assert.match(bare.tokens[0], /data-ext="pptx"/);

    const site = render('[打开报表](/report.html) 和 `npm test`');
    assert.equal(site.out, '[打开报表](/report.html) 和 #0#');
    assert.equal(site.tokens[0], '<code>npm test</code>');

    const hostile = render('![x](javascript:alert(1)) [y](/Volumes/a/"><img onerror=1>.pdf)');
    assert.ok(!hostile.tokens.some(html => /javascript:|<img onerror/.test(html)));
});
