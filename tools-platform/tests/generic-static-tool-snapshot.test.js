const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const JSZip = require('jszip');
const { execFileSync } = require('child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-static-snapshots-'));
process.env.TOOLS_DATA_DIR = temp;

const db = require('../backend/models/app-db');
const customToolsRepo = require('../backend/models/custom-tools-repository');
const publishService = require('../backend/models/snapshot-publish-service');
const snapshotRouter = require('../backend/routes/department-reward-penalty');

test.before(async () => {
    // 1. Create a pure single-HTML custom tool
    await customToolsRepo.createTool({
        slug: 'static-demo-tool',
        name: '纯静态测试工具',
        description: '无需后端接口的离线测试工具',
        icon: '⚡',
        htmlContent: '<!doctype html><html><head><title>Static Demo</title></head><body><h1>Hello Static World</h1></body></html>'
    });

    // 2. Create a ZIP-based multi-file custom tool
    const zip = new JSZip();
    zip.file('index.html', '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Zip App</h1><script src="app.js"></script></body></html>');
    zip.file('style.css', 'body { background: #123456; color: #fff; }');
    zip.file('app.js', 'console.log("ready");');
    zip.file('assets/icon.txt', 'demo-icon-data');
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await customToolsRepo.createTool({
        slug: 'zip-demo-tool',
        name: 'ZIP 静态包工具',
        description: '包含 CSS 与 JS 的静态测试工具',
        icon: '📦',
        archiveBase64: zipBuffer.toString('base64')
    });
});

test.after(async () => {
    await db.closeDatabase();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('providers dynamically recognizes any static custom tool and unknown tools are rejected', async () => {
    assert.equal(publishService.providers.has('static-demo-tool'), true);
    assert.equal(publishService.providers.has('zip-demo-tool'), true);
    assert.equal(publishService.providers.has('non-existent-tool-xyz'), false);

    const staticProvider = publishService.providers.get('static-demo-tool');
    assert.ok(staticProvider);
    assert.equal(staticProvider.slug, 'static-demo-tool');
    assert.equal(staticProvider.name, '纯静态测试工具');
    assert.equal(staticProvider.isGenericStatic, true);

    const zipProvider = publishService.providers.get('zip-demo-tool');
    assert.ok(zipProvider);
    assert.equal(zipProvider.slug, 'zip-demo-tool');
    assert.equal(zipProvider.name, 'ZIP 静态包工具');
    assert.equal(zipProvider.isGenericStatic, true);

    assert.equal(publishService.providers.get('non-existent-tool-xyz'), undefined);
});

test('static tool buildSnapshot generates standalone HTML and supports gatekeeper encryption', async () => {
    const provider = publishService.providers.get('static-demo-tool');

    // Without password
    const plainHtml = await provider.buildSnapshot('default');
    assert.match(plainHtml, /Hello Static World/);
    assert.doesNotMatch(plainHtml, /tpGatekeeperModal/);

    // With gatekeeper encryption
    const encryptedHtml = await provider.buildSnapshot('default', {
        encryption: {
            enabled: true,
            passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            passwordSalt: 'demo-salt'
        }
    });
    assert.match(encryptedHtml, /tpGatekeeperModal/);
    assert.match(encryptedHtml, /Hello Static World/);
});

test('static tool buildPagesSnapshot returns index HTML and collects auxiliary static files', async () => {
    const provider = publishService.providers.get('zip-demo-tool');
    const output = await provider.buildPagesSnapshot('default');

    assert.match(output.html, /Zip App/);
    assert.ok(output.files instanceof Map);
    assert.ok(output.files.has('style.css'));
    assert.ok(output.files.has('app.js'));
    assert.ok(output.files.has('assets/icon.txt'));
    assert.equal(output.files.get('style.css').toString('utf8'), 'body { background: #123456; color: #fff; }');
    assert.equal(output.files.has('index.html'), false, 'index.html must be output.html rather than in files');
    assert.equal(output.files.has('.tool-manifest.json'), false, 'Internal manifests must not be exposed');
});

test('getSettings includes custom tools and allows configuring passwords and enabled state', async () => {
    const settings = await publishService.getSettings();
    const staticItem = settings.tools.find(t => t.toolSlug === 'static-demo-tool');
    const zipItem = settings.tools.find(t => t.toolSlug === 'zip-demo-tool');

    assert.ok(staticItem, 'static-demo-tool must be listed in settings.tools');
    assert.ok(zipItem, 'zip-demo-tool must be listed in settings.tools');
    assert.equal(staticItem.name, '纯静态测试工具');
    assert.equal(staticItem.enabled, false);

    // Save custom settings for static-demo-tool
    await publishService.saveToolSettings('static-demo-tool', {
        enabled: true,
        encryptionEnabled: true,
        password: 'secure-password-123'
    });

    const updatedSettings = await publishService.getSettings();
    const updatedStatic = updatedSettings.tools.find(t => t.toolSlug === 'static-demo-tool');
    assert.equal(updatedStatic.enabled, true);
    assert.equal(updatedStatic.encryptionEnabled, true);
    assert.equal(updatedStatic.hasPassword, true);
});

test('download API endpoints support custom tools in both single HTML and pages ZIP formats', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.user = { role: req.headers['x-role'] || 'user', tenantId: 'default', username: 'admin' };
        next();
    });
    app.use('/api/department-reward-penalty', snapshotRouter);

    const base = '/api/department-reward-penalty/snapshot/download/';

    // Forbidden for non-admin
    await request(app).get(base + 'static-demo-tool').expect(403);

    // Single HTML download for static tool
    const htmlRes = await request(app)
        .get(base + 'static-demo-tool?format=single')
        .set('x-role', 'admin')
        .expect(200);
    assert.match(htmlRes.headers['content-disposition'], /static-demo-tool-readonly\.html/);
    assert.match(htmlRes.text, /Hello Static World/);

    // Pages ZIP download for zip tool
    const zipRes = await request(app)
        .get(base + 'zip-demo-tool?format=pages')
        .set('x-role', 'admin')
        .buffer(true)
        .parse((res, cb) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

    assert.match(zipRes.headers['content-disposition'], /zip-demo-tool-readonly-pages\.zip/);
    const downloadedZip = await JSZip.loadAsync(zipRes.body);
    assert.ok(downloadedZip.file('index.html'));
    assert.ok(downloadedZip.file('style.css'));
    assert.ok(downloadedZip.file('app.js'));
    assert.ok(downloadedZip.file('assets/icon.txt'));
    assert.equal(await downloadedZip.file('assets/icon.txt').async('string'), 'demo-icon-data');
});

test('publishing a custom static tool pushes HTML and assets to git repository and updates menu', async () => {
    const bare = path.join(temp, 'static-remote.git');
    const mirror = path.join(temp, 'static-mirror');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', bare]);
    execFileSync('git', ['clone', bare, mirror]);
    fs.writeFileSync(path.join(mirror, 'init.txt'), 'init');
    execFileSync('git', ['-C', mirror, 'add', 'init.txt']);
    execFileSync('git', ['-C', mirror, '-c', 'user.name=Tester', '-c', 'user.email=tester@test.local', 'commit', '-m', 'Initial commit']);
    execFileSync('git', ['-C', mirror, 'push', '-u', 'origin', 'HEAD:main']);

    await publishService.saveSettings({
        repoDir: mirror,
        branch: 'main',
        file: '{toolSlug}/index.html',
        publishMode: 'pages'
    });

    const started = await publishService.startJob('default', { toolSlug: 'zip-demo-tool' });
    let job;
    for (let i = 0; i < 100; i++) {
        job = await publishService.getJob(started.id);
        if (job.status !== 'running') break;
        await new Promise(r => setTimeout(r, 40));
    }

    assert.equal(job.status, 'success', JSON.stringify(job.entries));
    assert.equal(job.toolSlug, 'zip-demo-tool');

    const tree = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main']).toString();
    assert.match(tree, /zip-demo-tool\/index\.html/);
    const portal = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:tp-static/site.json']).toString());
    for (const name of ['style.css', 'app.js', 'assets/icon.txt']) assert.ok(portal.files['zip-demo-tool/' + name]);
    assert.doesNotMatch(tree, /zip-demo-tool\/app\.js/, 'tool assets are encrypted behind shared login');
    assert.match(tree, /zip-demo-tool\/data\/\.tools-platform-snapshot\.json/);

    const menu = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:.tools-platform-menu.json']).toString());
    const zipMenuItem = menu.items.find(item => item.slug === 'zip-demo-tool');
    assert.ok(zipMenuItem, 'Menu items must contain zip-demo-tool');
    assert.equal(zipMenuItem.name, 'ZIP 静态包工具');
    assert.equal(zipMenuItem.href, './zip-demo-tool/index.html');
    assert.match(zipMenuItem.fingerprint, /^[a-f0-9]{64}$/);

    const readme = execFileSync('git', ['--git-dir', bare, 'show', 'main:README.md']).toString();
    assert.match(readme, /ZIP 静态包工具/);
    assert.match(readme, /zip-demo-tool\/index\.html/);
});

test('full publish removes unchecked remote tool bundles while targeted publish leaves them intact', async () => {
    const bare = path.join(temp, 'unpublish-remote.git');
    const mirror = path.join(temp, 'unpublish-mirror');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', bare]);
    execFileSync('git', ['clone', bare, mirror]);
    fs.writeFileSync(path.join(mirror, 'keep.txt'), 'manually managed');
    execFileSync('git', ['-C', mirror, 'add', 'keep.txt']);
    execFileSync('git', ['-C', mirror, '-c', 'user.name=Tester', '-c', 'user.email=tester@test.local', 'commit', '-m', 'Initial commit']);
    execFileSync('git', ['-C', mirror, 'push', '-u', 'origin', 'HEAD:main']);

    const tools = (await publishService.getSettings()).tools.map(item => ({
        toolSlug: item.toolSlug,
        enabled: ['static-demo-tool', 'zip-demo-tool'].includes(item.toolSlug),
        encryptionEnabled: false
    }));
    await publishService.saveSettings({ repoDir: mirror, branch: 'main', file: '{toolSlug}/index.html', publishMode: 'pages', tools });
    async function publish(options = {}) {
        const started = await publishService.startJob('default', options);
        for (let i = 0; i < 100; i++) {
            const job = await publishService.getJob(started.id);
            if (job.status !== 'running') {
                assert.equal(job.status, 'success', JSON.stringify(job.entries));
                return job;
            }
            await new Promise(resolve => setTimeout(resolve, 40));
        }
        assert.fail('publish job timed out');
    }
    const tree = () => execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main']).toString();
    const menu = () => JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:.tools-platform-menu.json']).toString());

    await publish();
    assert.ok(JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:tp-static/site.json']).toString()).files['zip-demo-tool/assets/icon.txt']);
    assert.equal(menu().items.length, 2);

    await publishService.saveToolSettings('zip-demo-tool', { enabled: false, encryptionEnabled: false });
    await publish({ toolSlug: 'static-demo-tool' });
    assert.match(tree(), /zip-demo-tool\/index\.html/, 'single-tool publish must not remove unchecked tools');

    await publish();
    assert.doesNotMatch(tree(), /zip-demo-tool\//);
    assert.match(tree(), /static-demo-tool\/index\.html/);
    assert.match(tree(), /keep\.txt/);
    assert.deepEqual(menu().items.map(item => item.slug), ['static-demo-tool']);
    const guide = execFileSync('git', ['--git-dir', bare, 'show', 'main:README.md']).toString();
    assert.doesNotMatch(guide, /zip-demo-tool/);

    await publishService.saveToolSettings('static-demo-tool', { enabled: false, encryptionEnabled: false });
    await publish();
    assert.doesNotMatch(tree(), /static-demo-tool\//);
    assert.match(tree(), /keep\.txt/);
    assert.deepEqual(menu().items, []);

    await publishService.saveToolSettings('static-demo-tool', { enabled: true, encryptionEnabled: false });
    await publishService.saveSettings({ repoDir: mirror, branch: 'main', file: '{toolSlug}/index.html', publishMode: 'single' });
    await publish();
    execFileSync('git', ['-C', mirror, 'pull', '--ff-only', 'origin', 'main']);
    fs.writeFileSync(path.join(mirror, 'static-demo-tool', 'manual.html'), '<p>Manual page</p>');
    execFileSync('git', ['-C', mirror, 'add', 'static-demo-tool/manual.html']);
    execFileSync('git', ['-C', mirror, '-c', 'user.name=Tester', '-c', 'user.email=tester@test.local', 'commit', '-m', 'Add manually managed page']);
    execFileSync('git', ['-C', mirror, 'push', 'origin', 'HEAD:main']);
    await publishService.saveToolSettings('static-demo-tool', { enabled: false, encryptionEnabled: false });
    await publish();
    assert.doesNotMatch(tree(), /static-demo-tool\/index\.html/);
    assert.match(tree(), /static-demo-tool\/manual\.html/, 'single-file cleanup must preserve unrelated files');
    assert.deepEqual(menu().items, []);
});

test('upgrading a legacy password-protected tool removes its separate gate during a targeted publish', async () => {
    const bare = path.join(temp, 'legacy-portal.git'), mirror = path.join(temp, 'legacy-portal-mirror');
    const git = args => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '--bare', '--initial-branch=main', bare]);
    git(['clone', bare, mirror]);
    fs.mkdirSync(path.join(mirror, 'static-demo-tool'));
    const old = await publishService.providers.get('static-demo-tool').buildSnapshot('default', { encryption: { enabled: true, passwordHash: 'a'.repeat(64), passwordSalt: 'old-salt' } });
    fs.writeFileSync(path.join(mirror, 'static-demo-tool/index.html'), old);
    require('../backend/models/snapshot-publish-menu').updatePublishMenu(mirror, { slug: 'static-demo-tool', name: 'Legacy tool', href: './static-demo-tool/index.html', encrypted: true });
    git(['-C', mirror, 'add', '.']);
    git(['-C', mirror, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Legacy protected site']);
    git(['-C', mirror, 'push', '-u', 'origin', 'HEAD:main']);
    await publishService.saveSettings({ repoDir: mirror, branch: 'main', file: '{toolSlug}/index.html', publishMode: 'pages' });
    const started = await publishService.startJob('default', { toolSlug: 'zip-demo-tool' });
    let job;
    for (let i = 0; i < 200; i++) { job = await publishService.getJob(started.id); if (job.status !== 'running') break; await new Promise(r => setTimeout(r, 30)); }
    assert.equal(job.status, 'success', JSON.stringify(job.entries));
    const site = JSON.parse(git(['--git-dir', bare, 'show', 'main:tp-static/site.json']).toString());
    const file = site.files['static-demo-tool/index.html'];
    const security = require('../backend/models/snapshot-portal-security');
    const html = security.open(git(['--git-dir', bare, 'show', 'main:' + file.url]), await security.getKey(site.keyId), file.iv).toString();
    assert.match(html, /Hello Static World/);
    assert.doesNotMatch(html, /tpGatekeeperModal/);
    assert.ok(site.files['zip-demo-tool/index.html']);
});
