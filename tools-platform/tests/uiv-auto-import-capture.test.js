// 运行批脚本后自动导入少了文件：站点在打开后自己刷新（或登录跳转）会丢掉下载拦截，
// 文件照常下载、导入页却收不到。这里覆盖三层：每个任务前重装拦截、桌面端用真实下载补传、服务端按文件名去重。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-uiv-auto-import-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const express = require('express');
const request = require('supertest');
const { forwardRunDownloads, parseCsvTable } = require('../desktop-promo/uiv-download-import');
const { createUivBatchRunner } = require('../desktop-promo/uiv-batch-runner');

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const ORIGIN = 'http://localhost:3030';
const SESSION = 'a'.repeat(32), TOKEN = 'b'.repeat(32);

/** 在 VM 里加载 copy.js，只取生成批脚本的函数 */
function loadBatchBuilder() {
    const handler = { get: (target, key) => (key in target ? target[key] : new Proxy(function () {}, handler)), apply: () => new Proxy(function () {}, handler) };
    const context = { console, crypto: require('node:crypto').webcrypto, URL, setTimeout, clearTimeout, UIVT: key => key };
    context.window = context;
    context.location = { origin: ORIGIN };
    context.document = new Proxy({}, handler);
    context.localStorage = { getItem: () => null, setItem: () => {} };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/uivf12/copy.js'), 'utf8'), context);
    return context.buildUivBatchMacro;
}

/** 一个最小的“站点页面”：能建链接、点下载、createObjectURL，并记录发往本机平台的上传 */
function sitePage(uploads, downloads) {
    class HTMLAnchorElement { click() { downloads.push(this.download); } }
    const context = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        JSON, Promise, Blob, Date, Math, Object, Array, String, Number, Error, Map, Set,
        setTimeout, clearTimeout, setInterval, clearInterval,
        HTMLAnchorElement,
        URL: { createObjectURL: () => 'blob:site/' + Math.random(), revokeObjectURL() {} },
        AbortController,
        location: { origin: 'https://site.example' },
        name: '',
        document: {
            cookie: '',
            createElement: () => new HTMLAnchorElement(),
            body: { appendChild() {}, removeChild() {} },
            addEventListener() {}
        },
        fetch: async (url, init) => {
            if (String(url).startsWith(ORIGIN)) {
                uploads.push(JSON.parse(init.body));
                return { ok: true, json: async () => ({ success: true, dataset: { name: JSON.parse(init.body).name } }) };
            }
            return { ok: true, json: async () => ({}) };
        }
    };
    context.window = context;
    vm.createContext(context);
    return { run: source => vm.runInContext(`(async function(){\n${source}\n}).call(window)`, context) };
}

test('a site that reloads after it was opened still sends every downloaded table to the import page', async () => {
    const build = loadBatchBuilder();
    const code = [
        'return (async function () {',
        '  let csvContent = "a,b\\n1,2\\n";',
        '  let finalOutputName = NAME;',
        "  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });",
        '  const link = document.createElement("a"); link.href = URL.createObjectURL(blob);',
        '  link.download = finalOutputName; document.body.appendChild(link); link.click(); document.body.removeChild(link);',
        '  return "ok";',
        '})();'
    ].join('\n');
    const scripts = ['first.csv', 'second.csv'].map(name => ({ name, url: 'https://site.example/api', code: code.replace('NAME', JSON.stringify(name)) }));
    const macro = build(scripts, 'group', { speed: 1, autoImportSessionId: SESSION, autoImportToken: TOKEN });
    const commands = macro.Commands;
    const at = description => commands.findIndex(command => command.Description === description);

    const uploads = [], downloads = [];
    // 打开站点时装上拦截……
    sitePage(uploads, downloads).run(commands[at('Install UIVF12 download recorder on the current site.')].Target);
    // ……随后站点自己刷新：拿一个全新的页面执行后面的任务
    const reloaded = sitePage(uploads, downloads);
    for (const script of scripts) {
        for (const description of [`Ensure UIVF12 download recorder before: ${script.name}`, `Run controllable UIVF12 script: ${script.name}`]) {
            const index = at(description);
            assert.ok(index > 0, description);
            await reloaded.run(commands[index].Target);
        }
    }
    assert.deepEqual(downloads, ['first.csv', 'second.csv']);
    assert.deepEqual(uploads.map(upload => [upload.name, upload.rows]), [['first.csv', [{ a: '1', b: '2' }]], ['second.csv', [{ a: '1', b: '2' }]]]);
    assert.ok(at('Re-install UIVF12 download recorder after login.') > at('Confirm login and dismiss the waiting card.'), 'login redirects are covered too');
});

function autoImportApp() {
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/uiv-auto-import', require('../backend/routes/uiv-auto-import'));
    return app;
}

test('the import session keeps one copy per file: the page upload wins over the desktop download copy', async () => {
    const app = autoImportApp();
    const id = 'c'.repeat(32), url = `/api/uiv-auto-import/${id}/datasets?token=${TOKEN}`;
    const post = body => request(app).post(url).send(body).expect(200).then(res => res.body);

    // 页面内已上传 → 桌面补传跳过
    await post({ name: 'x.csv', rows: [{ a: 'page' }] });
    assert.equal((await post({ name: 'x.csv', rows: [{ a: 'disk' }], fallback: true })).skipped, true);
    // 只有桌面补传 → 收下
    assert.equal((await post({ name: 'y.csv', rows: [{ a: 'disk' }], fallback: true })).skipped, false);
    // 补传先到、页面内上传后到 → 以页面内的为准，只留一份
    await post({ name: 'z.csv', rows: [{ a: 'disk' }], fallback: true });
    await post({ name: 'z.csv', rows: [{ a: 'page' }] });

    const session = (await request(app).get(`/api/uiv-auto-import/${id}?token=${TOKEN}`).expect(200)).body;
    assert.deepEqual(session.datasets.map(dataset => [dataset.name, dataset.rows[0].a]), [['x.csv', 'page'], ['y.csv', 'disk'], ['z.csv', 'page']]);
    const chunkFiles = fs.readdirSync(path.join(process.env.TOOLS_DATA_DIR, 'tmp/uiv-auto-import', id, 'datasets'));
    assert.equal(chunkFiles.length, 3, 'the replaced copy is deleted from disk');
});

function fakeDownload(file, name, state = 'completed') {
    const item = new EventEmitter();
    item.getFilename = () => name;
    item.getSavePath = () => file;
    return { item, finish: () => item.emit('done', {}, state) };
}

test('desktop batch run forwards CSV files its own tab downloaded, and nothing else', async () => {
    const dir = fs.mkdtempSync(path.join(sandbox, 'downloads-'));
    const csv = path.join(dir, 'report.csv');
    fs.writeFileSync(csv, '﻿名称,"值, 带逗号"\r\n甲,"1"\r\n\r\n乙,"say ""hi"""\r\n');
    const session = new EventEmitter();
    const runTab = { session, getURL: () => 'https://site.example/board' }, otherTab = { session, getURL: () => 'https://other.example/' };
    const posts = [];
    const stop = forwardRunDownloads({
        webContents: runTab, autoImport: { sessionId: SESSION, token: TOKEN }, baseUrl: ORIGIN,
        post: async (url, init) => { posts.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true }; }
    });
    const ours = fakeDownload(csv, 'report.csv'), elsewhere = fakeDownload(csv, 'other.csv'), cancelled = fakeDownload(csv, 'cancelled.csv', 'cancelled'), sheet = fakeDownload(csv, 'book.xlsx');
    session.emit('will-download', {}, ours.item, runTab);
    session.emit('will-download', {}, elsewhere.item, otherTab);
    session.emit('will-download', {}, cancelled.item, runTab);
    session.emit('will-download', {}, sheet.item, runTab);
    [ours, elsewhere, cancelled, sheet].forEach(download => download.finish());
    await stop.settled();
    assert.deepEqual(posts, [{
        url: `${ORIGIN}/api/uiv-auto-import/${SESSION}/datasets?token=${TOKEN}`,
        body: { name: 'report.csv', rows: [{ 名称: '甲', '值, 带逗号': '1' }, { 名称: '乙', '值, 带逗号': 'say "hi"' }], origin: 'https://site.example', fallback: true }
    }]);
    stop();
    assert.equal(session.listenerCount('will-download'), 0);
});

test('the desktop runner forwards only when the page passed an import session, and stops when its tab closes', async () => {
    const calls = [];
    const page = { webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false, executeJavaScript: async () => 1 }) };
    const runner = createUivBatchRunner({
        openPage: async () => page, onError: () => {}, getAppBaseUrl: () => ORIGIN,
        forwardDownloads: options => { calls.push([options.autoImport, options.baseUrl]); const stop = () => calls.push('stopped'); return stop; }
    });
    await runner.start({ Commands: [{ Command: 'echo', Target: '' }] }, { autoImport: { sessionId: SESSION, token: TOKEN } });
    assert.deepEqual(calls[0], [{ sessionId: SESSION, token: TOKEN }, ORIGIN]);
    page.webContents.emit('destroyed');
    assert.ok(calls.includes('stopped'));
    assert.deepEqual(parseCsvTable('a\n\n').values, [], 'header-only files are not sent');
});

test('the import page archives an auto-import session on the server instead of re-uploading every row, then removes the session', async () => {
    const appDb = require('../backend/models/app-db');
    const pool = require('../backend/models/tenant-sqlite-pool');
    const { runWithTenant } = require('../backend/models/tenant-context');
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/uiv-auto-import', require('../backend/routes/uiv-auto-import'));
    // 归档接口在登录后、租户上下文里；会话却固定在默认目录，命名租户也要能读到
    app.use('/api/upload', (req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; runWithTenant('team-a', next); }, require('../backend/routes/upload'));
    const id = 'f'.repeat(32), session = `/api/uiv-auto-import/${id}`;
    await request(app).post(`${session}/datasets?token=${TOKEN}`).send({ name: 'risk.csv', rows: [{ 名称: '甲', 值: 'a,"b"' }, { 名称: '乙', 备注: 'x' }] }).expect(200);
    await request(app).post(`${session}/datasets?token=${TOKEN}`).send({ name: 'plain', rows: [{ k: 1 }] }).expect(200);

    await request(app).post('/api/upload/source-batches/from-auto-import').send({ sessionId: id, token: 'b'.repeat(31) + 'c' }).expect(404);
    const result = (await request(app).post('/api/upload/source-batches/from-auto-import').send({ sessionId: id, token: TOKEN, targetMonth: 11 }).expect(200)).body;
    assert.equal(result.uploadOriginals, true);
    assert.deepEqual(result.files.map(file => [file.name, file.rows]), [['risk.csv', 2], ['plain.csv', 1]]);

    const files = await runWithTenant('team-a', () => appDb.all('SELECT f.name, f.kind, f.parse_status, CAST(f.original_blob AS TEXT) AS csv, s.headers_json, s.rows_json FROM import_source_files f JOIN import_source_sheets s ON s.file_id=f.id WHERE f.batch_id=? ORDER BY f.rowid', [result.batchId]));
    assert.deepEqual(files[0].csv, '"名称","值","备注"\r\n"甲","a,""b""",""\r\n"乙","","x"', 'same CSV the page used to upload');
    assert.deepEqual([files[0].kind, files[0].parse_status, JSON.parse(files[0].headers_json), JSON.parse(files[0].rows_json).length], ['structured', 'ready', ['名称', '值', '备注'], 2]);

    await request(app).delete(`${session}?token=${TOKEN}`).expect(200);
    await request(app).get(`${session}?token=${TOKEN}`).expect(404);
    assert.equal(require('../backend/routes/uiv-auto-import').readSession(id, TOKEN), null);
    await appDb.closeDatabase(); await pool.closeAll();
});
