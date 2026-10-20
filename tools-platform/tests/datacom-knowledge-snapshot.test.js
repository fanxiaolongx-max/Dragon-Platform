'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const acorn = require('acorn');
const express = require('express');
const request = require('supertest');
const JSZip = require('jszip');
const { execFileSync } = require('node:child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-snapshot-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const repo = require('../backend/models/datacom-knowledge-repository');
const snapshot = require('../backend/models/datacom-knowledge-snapshot');
const publish = require('../backend/models/snapshot-publish-service');
const { runWithTenant } = require('../backend/models/tenant-context');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
let createSnapshotApi;
const currentBody = '# 最新知识\n只在正文出现的 needle-body\n</script><script>window.unwanted=true</script>\n100%_literal';
function snapshotConfig(html) {
    const script = /<script>window\.__DATACOM_SNAPSHOT__=([\s\S]*?);<\/script>/.exec(html)[0];
    const context = { window: {} };
    vm.runInNewContext(script.slice(8, -9), context);
    return context.window.__DATACOM_SNAPSHOT__;
}

test.before(async () => {
    ({ createSnapshotApi } = await import(pathToFileURL(path.join(__dirname, '../backend/builtin-tools/datacom-protocol-expert/assets/snapshot-api.js')).href));
    await repo.createArticles([{ id: 'snapshot-current', title: '默认租户文章', categoryId: 'ospf-basics', bodyMd: 'private-old-revision' }], 'test');
    const article = await repo.getArticle('snapshot-current');
    await repo.updateArticle(article.id, { ...article, bodyMd: currentBody }, article.revision, 'test');
    await repo.createArticles([{ id: 'snapshot-deleted', title: 'Deleted', categoryId: 'ospf-basics', bodyMd: 'private-deleted-body' }], 'test');
    await repo.deleteArticle('snapshot-deleted', 'test');
    await runWithTenant('beta', async () => {
        await repo.saveDomain({ id: 'custom-domain', name: '租户领域' }, { create: true });
        await repo.saveCategory({ id: 'custom-category', name: '租户分类', domainId: 'custom-domain' }, { create: true });
        await repo.createArticles([{ id: 'beta-article', title: 'Beta 专属文章', categoryId: 'custom-category', bodyMd: 'beta-only-knowledge', visuals: ['ospf-fsm'] }], 'test');
    });
});

test.after(async () => {
    await pool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('dedicated provider exports current SQLite articles and all interactive assets without deleted rows or history', async () => {
    const provider = publish.providers.get('datacom-protocol-expert');
    assert.ok(provider);
    assert.equal(provider.isGenericStatic, undefined);
    const output = await provider.buildPagesSnapshot('default');
    assert.match(output.html, /__DATACOM_SNAPSHOT__/);
    assert.match(output.html, /\.\/data\/knowledge\.json/);
    for (const name of ['app.js', 'snapshot-api.js', 'app.css', 'engine3d.js', 'labs.js', 'vendor/three.module.min.js', 'vendor/OrbitControls.js', 'vendor/marked.min.js', 'vendor/mermaid.min.js']) {
        assert.ok(output.files.has('assets/' + name), name);
    }
    const raw = output.files.get('data/knowledge.json');
    const data = JSON.parse(raw);
    assert.equal(data.articles.find(item => item.id === 'snapshot-current').bodyMd, currentBody);
    assert.ok(data.learningPath.length);
    assert.doesNotMatch(raw, /private-old-revision|private-deleted-body|beta-only-knowledge/);
    assert.equal(output.files.has('knowledge-seed.json'), false);
    assert.equal([...output.files.keys()].some(name => /\.db(?:$|-)|\.tool-manifest/.test(name)), false);
    assert.equal((await repo.loadCatalog()).articles.some(item => 'bodyMd' in item), false, 'live catalog still omits bodies');
    assert.equal((await snapshot.buildPagesSnapshot('default')).html, output.html, 'unchanged exports must keep stable fingerprints');
});

test('explicit tenant wins over ambient context and exports custom domains and categories', async () => {
    const output = await runWithTenant('default', () => snapshot.buildPagesSnapshot('beta'));
    const data = JSON.parse(output.files.get('data/knowledge.json'));
    assert.ok(data.domains.some(item => item.id === 'custom-domain'));
    assert.ok(data.categories.some(item => item.id === 'custom-category'));
    assert.ok(data.articles.some(item => item.bodyMd === 'beta-only-knowledge'));
    assert.equal(data.articles.some(item => item.id === 'snapshot-current'), false);
    const defaultOutput = await runWithTenant('beta', () => snapshot.buildPagesSnapshot('default'));
    assert.doesNotMatch(defaultOutput.files.get('data/knowledge.json'), /beta-only-knowledge/);
});

test('video snapshots freeze registered public release URLs and local posters without copying MP4 files', async () => {
    const registry = require('../backend/datacom-note-videos.json');
    const pages = await snapshot.buildPagesSnapshot('default');
    const config = snapshotConfig(pages.html);
    const video = config.videos['ospf-fsm'];
    assert.equal(video.sources.mini, registry.assets['datacom/ospf-fsm.mp4'].url);
    assert.equal(video.sources.hd, registry.assets['datacom/ospf-fsm-hd.mp4'].url);
    assert.equal(video.sources.poster, './assets/note-videos/ospf-fsm-poster.jpg');
    assert.ok(pages.files.has('assets/note-videos/ospf-fsm-poster.jpg'));
    assert.equal([...pages.files.keys()].some(name => /\.(?:mp4|mp3)$/i.test(name)), false);
    const single = snapshotConfig(await snapshot.buildSnapshot('default'));
    assert.match(single.videos['ospf-fsm'].sources.poster, /^data:image\/jpeg;base64,/);
    assert.equal(single.videos['ospf-fsm'].sources.hd, video.sources.hd);
    assert.equal(config.videos['snapshot-current'], undefined, 'private notes receive no public media mapping');
    await runWithTenant('no-video', () => repo.deleteArticle('ospf-fsm', 'test'));
    const deleted = await snapshot.buildPagesSnapshot('no-video');
    assert.equal(snapshotConfig(deleted.html).videos['ospf-fsm'], undefined);
    assert.equal(deleted.files.has('assets/note-videos/ospf-fsm-poster.jpg'), false);
});

test('video manifest selects injected snapshot data and preserves platform same-origin fetching', async () => {
    const { loadVideoManifest } = await import(pathToFileURL(path.join(__dirname, '../backend/builtin-tools/datacom-protocol-expert/assets/note-video.js')).href);
    const originalFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.__DATACOM_SNAPSHOT__ = { videos: { 'ospf-fsm': { title: 'Snapshot video' } } };
    globalThis.fetch = async url => {
        fetched++;
        assert.match(url, /^\/assets\/promotions\/datacom\/manifest\.json\?t=/);
        return { ok: true, json: async () => ({ 'ospf-fsm': { title: 'Platform video' } }) };
    };
    try {
        assert.equal((await loadVideoManifest({ offline: true }))['ospf-fsm'].title, 'Snapshot video');
        assert.equal(fetched, 0);
        assert.equal((await loadVideoManifest())['ospf-fsm'].title, 'Platform video');
        assert.equal(fetched, 1);
    } finally {
        globalThis.fetch = originalFetch;
        delete globalThis.__DATACOM_SNAPSHOT__;
    }
});

test('snapshot API loads data once, searches full text literally and denies all writes and revision reads', async () => {
    const output = await snapshot.buildPagesSnapshot('default');
    const data = JSON.parse(output.files.get('data/knowledge.json'));
    let loads = 0;
    const api = createSnapshotApi({ url: './data/knowledge.json' }, async url => {
        assert.equal(url, './data/knowledge.json');
        loads++;
        return { ok: true, json: async () => data };
    });
    const [catalog, article] = await Promise.all([api(), api('/articles/snapshot-current')]);
    assert.equal(catalog.canWrite, false);
    assert.equal(catalog.articles.some(item => 'bodyMd' in item), false);
    assert.equal(article.article.bodyMd, currentBody);
    for (const query of ['NEEDLE-body', '100%_literal']) {
        const results = (await api('/search?q=' + encodeURIComponent(query))).results;
        assert.equal(results[0].id, 'snapshot-current');
        assert.equal(results[0].score, 1);
    }
    assert.deepEqual((await api('/search?q=')).results, []);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        await assert.rejects(api('/articles/snapshot-current', { method }), { status: 403, code: 'READ_ONLY_SNAPSHOT' });
    }
    await assert.rejects(api('/articles/snapshot-current/revisions'), { status: 404 });
    await assert.rejects(api('/articles/snapshot-deleted'), { status: 404 });
    assert.equal(loads, 1);
    let attempts = 0;
    const retry = createSnapshotApi({ url: './data/knowledge.json' }, async () => ++attempts === 1
        ? { ok: false, status: 404 } : { ok: true, json: async () => data });
    await assert.rejects(retry(), /404/);
    assert.equal((await retry()).canWrite, false);
});

test('single HTML embeds safe current data and a complete module graph with no external asset dependencies', async () => {
    const html = await snapshot.buildSnapshot('default');
    const bootstrap = /<script>window\.__DATACOM_SNAPSHOT__=([\s\S]*?);<\/script>/.exec(html)[0];
    const context = { window: {} };
    vm.runInNewContext(bootstrap.slice(8, -9), context);
    assert.equal(context.window.__DATACOM_SNAPSHOT__.data.articles.find(item => item.id === 'snapshot-current').bodyMd, currentBody);
    assert.doesNotMatch(bootstrap, /<script>window.unwanted/);
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
    assert.ok(map['datacom/assets/app.js']);
    assert.ok(map['datacom/assets/snapshot-api.js']);
    assert.ok(map['datacom/assets/teaching-stage.js']);
    assert.ok(map['datacom/assets/knowledge-map.js']);
    assert.equal(map['datacom/assets/vendor/three.module.min.js'], undefined, 'teaching snapshot needs no WebGL renderer');
    for (const url of Object.values(map)) {
        const source = Buffer.from(url.split(',')[1], 'base64').toString();
        const nodes = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
        for (const node of nodes) if (node.source) assert.ok(map[node.source.value], node.source.value);
    }
    assert.doesNotMatch(html, /(?:src|href)="\.\/assets\//);
    assert.match(await snapshot.buildSnapshot('default', { encryption: { enabled: true, passwordHash: 'a'.repeat(64), passwordSalt: 'test' } }), /tpGatekeeperModal/);
});

test('existing download endpoint serves tenant-specific knowledge in both HTML and Pages ZIP', async () => {
    const app = express();
    app.use((req, res, next) => { req.user = { role: req.headers['x-role'] || 'admin', username: 'test', tenantId: 'beta' }; next(); });
    app.use('/api/department-reward-penalty', require('../backend/routes/department-reward-penalty'));
    const base = '/api/department-reward-penalty/snapshot/download/datacom-protocol-expert';
    await request(app).get(base).set('x-role', 'user').expect(403);
    const html = await request(app).get(base + '?format=single').expect(200);
    assert.match(html.text, /beta-only-knowledge/);
    assert.doesNotMatch(html.text, /needle-body/);
    const zip = await request(app).get(base + '?format=pages').buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const archive = await JSZip.loadAsync(zip.body);
    assert.ok(archive.file('assets/snapshot-api.js'));
    assert.match(await archive.file('data/knowledge.json').async('string'), /beta-only-knowledge/);
});

test('publishing sends the knowledge data to git and detects subsequent database edits', async () => {
    const remote = path.join(temp, 'remote.git');
    const mirror = path.join(temp, 'mirror');
    const git = args => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    git(['init', '--bare', '--initial-branch=main', remote]);
    git(['clone', remote, mirror]);
    fs.writeFileSync(path.join(mirror, 'init.txt'), 'init');
    git(['-C', mirror, 'add', 'init.txt']);
    git(['-C', mirror, '-c', 'user.name=Tester', '-c', 'user.email=tester@test.local', 'commit', '-m', 'Initial commit']);
    git(['-C', mirror, 'push', '-u', 'origin', 'HEAD:main']);
    await publish.saveSettings({ repoDir: mirror, branch: 'main', file: '{toolSlug}/index.html', publishMode: 'pages' });
    async function push() {
        const started = await publish.startJob('default', { toolSlug: 'datacom-protocol-expert' });
        for (let i = 0; i < 200; i++) {
            const job = await publish.getJob(started.id);
            if (job.status !== 'running') {
                assert.equal(job.status, 'success', JSON.stringify(job.entries));
                return job;
            }
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        assert.fail('publish timed out');
    }
    const first = await push();
    const site = () => JSON.parse(git(['--git-dir', remote, 'show', 'main:tp-static/site.json']));
    for (const name of ['index.html', 'data/knowledge.json', 'assets/snapshot-api.js', 'assets/vendor/three.module.min.js']) {
        assert.ok(site().files['datacom-protocol-expert/' + name], name);
    }
    const readData = async () => {
        const meta = site(), file = meta.files['datacom-protocol-expert/data/knowledge.json'];
        const security = require('../backend/models/snapshot-portal-security');
        const bytes = execFileSync('git', ['--git-dir', remote, 'show', 'main:' + file.url]);
        return JSON.parse(security.open(bytes, await security.getKey(meta.keyId), file.iv));
    };
    assert.equal((await readData()).articles.find(item => item.id === 'snapshot-current').bodyMd, currentBody);
    const second = await push();
    const changedPaths = git(['--git-dir', remote, 'diff', '--name-only', first.commit, second.commit]);
    assert.equal(second.commit, first.commit, 'unchanged data skips commit/push: ' + changedPaths);
    const article = await repo.getArticle('snapshot-current');
    await repo.updateArticle(article.id, { ...article, bodyMd: 'Updated knowledge after first publish' }, article.revision, 'test');
    assert.notEqual((await push()).commit, first.commit);
    assert.equal((await readData()).articles.find(item => item.id === article.id).bodyMd, 'Updated knowledge after first publish');
});
