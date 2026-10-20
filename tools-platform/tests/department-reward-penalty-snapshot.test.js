const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const { execFileSync } = require('child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-snapshot-'));
process.env.TOOLS_DATA_DIR = temp;
const db = require('../backend/models/app-db');
const tools = require('../backend/models/custom-tools-repository');
const repo = require('../backend/models/department-reward-penalty-repository');
const { buildSnapshot, buildPagesSnapshot } = require('../backend/models/department-reward-penalty-snapshot');
const { updatePublishMenu } = require('../backend/models/snapshot-publish-menu');
const express = require('express');
const request = require('supertest');
const router = require('../backend/routes/department-reward-penalty');
const { runWithTenant } = require('../backend/models/tenant-context');
const originalPath = tools.getToolFilePath;
function publishedManifest(bare, ref = 'github-import') {
    return JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', ref + ':tp-static/site.json']).toString());
}
async function publishedContent(bare, name, ref = 'github-import') {
    const meta = publishedManifest(bare, ref), item = meta.files[name];
    const security = require('../backend/models/snapshot-portal-security');
    return security.open(execFileSync('git', ['--git-dir', bare, 'show', ref + ':' + item.url]), await security.getKey(meta.keyId), item.iv).toString();
}
test.after(async () => { tools.getToolFilePath = originalPath; await db.closeDatabase(); fs.rmSync(temp, { recursive: true, force: true }); });

test('single HTML embeds tenant data safely and blocks network/write requests', async () => {
    tools.getToolFilePath = async () => path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html');
    await repo.put('personnel', 'snapshot-person', { id: 'snapshot-person', name: '</script><script>alert(1)</script>', role: 'MTD' }, 'tester');
    const filename = '12345678-1234-1234-1234-123456789abc.txt';
    const evidenceDir = path.join(temp, 'department-reward-penalty-evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, filename), 'offline evidence');
    await repo.put('records', 'snapshot-record', { id: 'snapshot-record', attachments: ['/api/department-reward-penalty/evidence/' + filename], revokeAttachment: '/api/department-reward-penalty/evidence/' + filename }, 'tester');
    const html = await buildSnapshot('default');
    assert.match(html, /OFFLINE_SNAPSHOT/);
    assert.match(html, /snapshot-person/);
    assert.match(html, /data:text\/plain;base64,b2ZmbGluZSBldmlkZW5jZQ==#12345678/);
    assert.doesNotMatch(html, /<\/script><script>alert\(1\)<\/script>/);
    assert.match(html, /connect-src data:/);
    assert.match(html, /无权限，仅供查看。请联系管理员。/);
    assert.match(html, /const OFFLINE_SNAPSHOT = .*"canEdit":true/);
    assert.match(html, /originalOfflineFetch/);
    assert.match(html, /TP_RELATED_SNAPSHOT/);
    assert.match(html, /\/api\/meeting-snapshots\/attendance-check/);
    assert.match(html, /\/api\/operation-incentive-snapshots\/extract-roster/);
    assert.equal(await buildSnapshot('default'), html, 'unchanged data must produce stable HTML for scheduled runs');
    for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('Pages snapshot keeps HTML stable and stores data and evidence separately', async () => {
    const output = await buildPagesSnapshot('default');
    assert.doesNotMatch(output.html, /OFFLINE_SNAPSHOT/);
    assert.match(output.html, /\['state','records','audit'\]/);
    assert.match(output.html, /connect-src 'self'/);
    const state = JSON.parse(output.files.get('data/state.json'));
    const records = JSON.parse(output.files.get('data/records.json'));
    const audit = JSON.parse(output.files.get('data/audit.json'));
    const related = JSON.parse(output.files.get('data/related.json'));
    assert.equal(state.canEdit, true);
    assert.equal(records.find(row => row.id === 'snapshot-record').attachments[0], './data/evidence/12345678-1234-1234-1234-123456789abc.txt');
    assert.ok(audit.length);
    assert.ok(related.meeting && related.incentive);
    assert.equal(output.files.get('data/evidence/12345678-1234-1234-1234-123456789abc.txt').toString(), 'offline evidence');
    for (const script of output.html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    const requestStart = output.html.indexOf('async function request(path,options){');
    const requestEnd = output.html.indexOf('async function refresh(){', requestStart);
    const requests = [];
    let prompts = 0;
    const staticRequest = vm.runInNewContext('let PAGES_SNAPSHOT=null;\n' + output.html.slice(requestStart, requestEnd) + '\nrequest', {
        pagesFetch: async (url, options) => { requests.push([url, options.cache]); return { ok: true, json: async () => JSON.parse(output.files.get(url.slice(2))) }; },
        uiAlert: async () => { prompts++; }, URLSearchParams
    });
    assert.equal((await staticRequest('/')).records.length, 1);
    assert.deepEqual(requests.map(([url]) => url), ['./data/state.json', './data/records.json', './data/audit.json']);
    assert.ok(requests.every(([, cache]) => cache === 'no-store'));
    assert.equal((await staticRequest('/audit?page=1&pageSize=1')).rows.length, 1);
    await assert.rejects(staticRequest('/records/x', { method: 'POST' }), /无权限/);
    assert.equal(prompts, 1);
});

test('root menu is created or inserted without overwriting existing content and stays extensible', () => {
    const root = path.join(temp, 'menu-fixtures');
    fs.mkdirSync(root);
    const first = { slug: 'department-reward-penalty', name: '负向事件管理', href: './department-reward-penalty/index.html' };
    updatePublishMenu(root, first);
    const generated = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const generatedGuide = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(generated, /<title>工具入口<\/title>/);
    assert.match(generated, /href="\.\/department-reward-penalty\/index\.html"/);
    assert.match(generated, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(generated, /01 个只读工具/);
    assert.match(generatedGuide, /# 静态工具仓库/);
    assert.match(generatedGuide, /\[打开页面\]\(\.\/department-reward-penalty\/index\.html\)/);
    updatePublishMenu(root, first);
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), generated);
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), generatedGuide);
    updatePublishMenu(root, { slug: 'another-tool', name: '<新工具>', description: '说明 | 第二行\n内容', href: './another-tool/index.html' });
    const combined = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const combinedGuide = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(combined, /&lt;新工具&gt;/);
    assert.doesNotMatch(combined, /<新工具>/);
    assert.match(combined, /02 个只读工具/);
    assert.match(combinedGuide, /说明 \\| 第二行 内容/);
    assert.match(combinedGuide, /\[打开页面\]\(\.\/another-tool\/index\.html\)/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.tools-platform-menu.json'), 'utf8')).items.length, 2);
    fs.writeFileSync(path.join(root, 'repository-guide.md'), '# 后来新增的人工说明\n');
    updatePublishMenu(root, { ...first, name: '[异常链接](https://example.com)' });
    assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /\\\[异常链接\\\]\\\(https:\/\/example\.com\\\)/);
    assert.equal(fs.readFileSync(path.join(root, 'repository-guide.md'), 'utf8'), '# 后来新增的人工说明\n');
    const existingRoot = path.join(temp, 'existing-menu-fixture');
    fs.mkdirSync(existingRoot);
    const original = '<!doctype html><html><head><title>原有首页</title></head><body><main id="original">保留内容</main></body></html>';
    fs.writeFileSync(path.join(existingRoot, 'index.html'), original);
    fs.writeFileSync(path.join(existingRoot, 'repository-guide.md'), '# 原有仓库说明\n\n这段是人工维护的内容。\n');
    updatePublishMenu(existingRoot, first);
    const updated = fs.readFileSync(path.join(existingRoot, 'index.html'), 'utf8');
    const updatedGuide = fs.readFileSync(path.join(existingRoot, 'repository-guide.md'), 'utf8');
    assert.match(updated, /<main id="original">保留内容<\/main>/);
    assert.match(updated, /<title>原有首页<\/title>/);
    assert.equal(updated.match(/tools-platform:menu:start/g).length, 1);
    assert.match(updatedGuide, /这段是人工维护的内容/);
    assert.match(updatedGuide, /## 已发布工具/);
    assert.equal(fs.existsSync(path.join(existingRoot, 'README.md')), false);
    updatePublishMenu(existingRoot, first);
    assert.equal(fs.readFileSync(path.join(existingRoot, 'index.html'), 'utf8'), updated);
    assert.equal(fs.readFileSync(path.join(existingRoot, 'repository-guide.md'), 'utf8'), updatedGuide);
    fs.writeFileSync(path.join(existingRoot, 'index.html'), updated.replace('tools-platform:menu:end', 'broken-marker'));
    assert.throws(() => updatePublishMenu(existingRoot, first), /标记不完整/);
    fs.writeFileSync(path.join(existingRoot, 'index.html'), updated);
    fs.writeFileSync(path.join(existingRoot, 'repository-guide.md'), updatedGuide.replace('tools-platform:guide:end', 'broken-marker'));
    assert.throws(() => updatePublishMenu(existingRoot, first), /工具目录标记不完整/);
});

test('root menu shows each published bundle fingerprint and preserves its content update time', () => {
    const root = path.join(temp, 'menu-version-fixture');
    fs.mkdirSync(root);
    const first = { slug: 'tool-a', name: '工具 A', href: './tool-a/index.html', fingerprint: 'a'.repeat(64) };
    updatePublishMenu(root, first);
    const manifestFile = path.join(root, '.tools-platform-menu.json');
    const indexFile = path.join(root, 'index.html');
    const initial = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).items[0];
    const initialHtml = fs.readFileSync(indexFile, 'utf8');
    assert.equal(initial.fingerprint, first.fingerprint);
    assert.ok(Number.isFinite(Date.parse(initial.updatedAt)));
    assert.match(initialHtml, /SHA-256 a{12}/);
    assert.match(initialHtml, /更新于 20\d\d-/);
    assert.match(initialHtml, new RegExp(`完整 SHA-256：${first.fingerprint}`));

    updatePublishMenu(root, first);
    assert.equal(fs.readFileSync(indexFile, 'utf8'), initialHtml);
    assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).items[0].updatedAt, initial.updatedAt);

    const second = { slug: 'tool-b', name: '工具 B', href: './tool-b/index.html' };
    updatePublishMenu(root, second);
    assert.match(fs.readFileSync(indexFile, 'utf8'), /版本信息待下次推送记录/);
    const items = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).items;
    items[0].updatedAt = '2020-01-01T00:00:00.000Z';
    fs.writeFileSync(manifestFile, JSON.stringify({ version: 1, items }));
    updatePublishMenu(root, { ...first, fingerprint: 'b'.repeat(64) });
    const changed = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).items;
    assert.equal(changed[0].fingerprint, 'b'.repeat(64));
    assert.notEqual(changed[0].updatedAt, '2020-01-01T00:00:00.000Z');
    assert.equal(changed[1].fingerprint, undefined);
    assert.throws(() => updatePublishMenu(root, { ...first, fingerprint: '<script>' }), /清单格式无效/);
});

test('snapshot export and publication require admin; unconfigured publish cannot mutate a remote', async () => {
    tools.getToolFilePath = async () => path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: req.headers['x-role'] || 'user', tenantId: 'default', username: 'tester' }; next(); });
    app.use('/api/department-reward-penalty', router);
    await request(app).get('/api/department-reward-penalty/snapshot/html').expect(403);
    await request(app).post('/api/department-reward-penalty/snapshot/publish').expect(403);
    await request(app).get('/api/department-reward-penalty/snapshot/settings').expect(403);
    await request(app).get('/api/department-reward-penalty/snapshot/prerequisites').expect(403);
    await request(app).put('/api/department-reward-penalty/snapshot/settings').send({}).expect(403);
    await request(app).get('/api/department-reward-penalty/snapshot/jobs').expect(403);
    await request(app).put('/api/department-reward-penalty/snapshot/settings').set('x-role', 'admin').send({ remoteUrl: 'https://user:secret@example.com/repo.git', branch: 'github-import', file: 'index.html' }).expect(400);
    const exported = await request(app).get('/api/department-reward-penalty/snapshot/html').set('x-role', 'admin').expect(200);
    assert.match(exported.text, /OFFLINE_SNAPSHOT/);
    await request(app).post('/api/department-reward-penalty/snapshot/publish').set('x-role', 'admin').expect(400);
});

test('push updates only the configured HTML on an isolated git branch', async () => {
    tools.getToolFilePath = async () => path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html');
    const bare = path.join(temp, 'remote.git');
    const mirror = path.join(temp, 'mirror');
    execFileSync('git', ['init', '--bare', bare]);
    execFileSync('git', ['clone', bare, mirror]);
    execFileSync('git', ['-C', mirror, 'checkout', '-b', 'github-import']);
    fs.writeFileSync(path.join(mirror, 'keep.txt'), 'unchanged');
    execFileSync('git', ['-C', mirror, 'add', 'keep.txt']);
    execFileSync('git', ['-C', mirror, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
    execFileSync('git', ['-C', mirror, 'push', '-u', 'origin', 'github-import']);
    const before = execFileSync('git', ['-C', mirror, 'status', '--porcelain']).toString();
    const saved = ['TOOLS_SNAPSHOT_REPO_DIR', 'TOOLS_SNAPSHOT_BRANCH', 'TOOLS_SNAPSHOT_PATH'].map(key => [key, process.env[key]]);
    process.env.TOOLS_SNAPSHOT_REPO_DIR = mirror;
    process.env.TOOLS_SNAPSHOT_BRANCH = 'github-import';
    process.env.TOOLS_SNAPSHOT_PATH = 'pages/reward-penalty.html';
    try {
    const app = express();
    app.use(express.json());
        app.use((req, _res, next) => { req.user = { role: 'admin', tenantId: 'default', username: 'tester' }; next(); });
        app.use('/api/department-reward-penalty', router);
        await request(app).put('/api/department-reward-penalty/snapshot/settings').send({ repoDir: mirror, branch: 'github-import', file: 'pages/reward-penalty.html' }).expect(200);
        const preflight = await request(app).get('/api/department-reward-penalty/snapshot/prerequisites').expect(200);
        assert.equal(preflight.body.gitFound, true);
        assert.equal(preflight.body.branchReady, true);
        const started = await request(app).post('/api/department-reward-penalty/snapshot/publish').expect(202);
        let job;
        for (let attempt = 0; attempt < 100; attempt++) {
            job = (await request(app).get('/api/department-reward-penalty/snapshot/jobs/' + started.body.id).expect(200)).body;
            if (job.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(job.status, 'success', JSON.stringify(job.entries));
        assert.equal(job.progress, 100);
        assert.ok(job.entries.some(entry => entry.stage === '推送远端'));
        assert.ok(Array.isArray(job.commandLogs) && job.commandLogs.length > 0);
        assert.ok(job.commandLogs.some(log => typeof log.cmd === 'string' && log.cmd.includes('clone')));
        assert.ok(job.commandLogs.some(log => typeof log.cmd === 'string' && log.cmd.includes('push')));
        assert.ok(job.commandLogs.some(log => log.type === 'info' && log.msg.includes('快照')));
        const history = await request(app).get('/api/department-reward-penalty/snapshot/jobs').expect(200);
        assert.equal(history.body[0].id, started.body.id);
        assert.ok(Array.isArray(history.body[0].commandLogs));
        const published = execFileSync('git', ['--git-dir', bare, 'show', 'github-import:pages/reward-penalty.html']).toString();
        assert.match(published, /data-static-boot/);
        assert.match(await publishedContent(bare, 'pages/reward-penalty.html'), /OFFLINE_SNAPSHOT/);
        const rootIndex = execFileSync('git', ['--git-dir', bare, 'show', 'github-import:index.html']).toString();
        assert.match(rootIndex, /data-static-boot/);
        assert.match(await publishedContent(bare, 'portal-data.json'), /\.\/pages\/reward-penalty\.html/);
        assert.equal(JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'github-import:.tools-platform-menu.json']).toString()).items[0].slug, 'department-reward-penalty');
        const rootGuide = execFileSync('git', ['--git-dir', bare, 'show', 'github-import:README.md']).toString();
        assert.match(rootGuide, /# 静态工具仓库/);
        assert.match(rootGuide, /负向事件管理/);
        assert.equal(execFileSync('git', ['--git-dir', bare, 'show', 'github-import:keep.txt']).toString(), 'unchanged');
        assert.equal(execFileSync('git', ['-C', mirror, 'status', '--porcelain']).toString(), before);
        const service = require('../backend/models/snapshot-publish-service');
        const scheduled = await service.saveSettings({ repoDir: mirror, branch: 'github-import', file: 'pages/reward-penalty.html', scheduleEnabled: true, intervalMinutes: 5 });
        assert.equal(scheduled.scheduleEnabled, true);
        assert.ok(Date.parse(scheduled.nextRunAt) > Date.now());
        service.stopTenantScheduler('default');
        const resumed = await service.scheduleTenant('default');
        assert.equal(resumed.enabled, true, 'saved schedule should resume after scheduler startup');
        const automatic = await service.runScheduledTenant('default');
        assert.equal(automatic.trigger, 'scheduled');
        let autoJob;
        for (let attempt = 0; attempt < 100; attempt++) {
            autoJob = await service.getJob(automatic.id);
            if (autoJob.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(autoJob.status, 'success', JSON.stringify(autoJob.entries));
        assert.equal(autoJob.commit, job.commit, 'unchanged snapshot must not add a commit');
        assert.ok((await service.getSettings()).lastAutoAt);
        const pagesSettings = await service.saveSettings({ repoDir: mirror, branch: 'github-import', file: 'pages/reward-penalty.html', publishMode: 'pages' });
        assert.equal(pagesSettings.publishMode, 'pages');
        const pagesJob = await service.startJob('default');
        let pagesResult;
        for (let attempt = 0; attempt < 100; attempt++) {
            pagesResult = await service.getJob(pagesJob.id);
            if (pagesResult.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(pagesResult.status, 'success', JSON.stringify(pagesResult.entries));
        const pagesHtml = await publishedContent(bare, 'pages/reward-penalty.html');
        assert.match(pagesHtml, /\['state','records','audit'\]/);
        assert.doesNotMatch(pagesHtml, /OFFLINE_SNAPSHOT/);
        const initialRecordJson = await publishedContent(bare, 'pages/data/records.json');
        assert.ok(JSON.parse(initialRecordJson).some(row => row.id === 'snapshot-record'));
        const pagesMenu = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'github-import:.tools-platform-menu.json']).toString());
        assert.equal(await publishedContent(bare, 'pages/data/evidence/12345678-1234-1234-1234-123456789abc.txt'), 'offline evidence');
        await repo.put('records', 'snapshot-record', { id: 'snapshot-record', remark: 'new remark', attachments: ['/api/department-reward-penalty/evidence/12345678-1234-1234-1234-123456789abc.txt'] }, 'tester');
        const changedJob = await service.startJob('default');
        let changedResult;
        for (let attempt = 0; attempt < 100; attempt++) {
            changedResult = await service.getJob(changedJob.id);
            if (changedResult.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(changedResult.status, 'success', JSON.stringify(changedResult.entries));
        const changedFiles = execFileSync('git', ['--git-dir', bare, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'github-import']).toString().trim().split('\n').sort();
        assert.ok(changedFiles.includes('.tools-platform-menu.json'));
        assert.ok(changedFiles.every(name => name === '.tools-platform-menu.json' || name.startsWith('tp-static/')), 'data edits only update encrypted payloads and metadata');
        const changedMenu = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'github-import:.tools-platform-menu.json']).toString());
        assert.notEqual(changedMenu.items[0].fingerprint, pagesMenu.items[0].fingerprint);
        await repo.put('records', 'snapshot-record', { id: 'snapshot-record', remark: 'evidence removed', attachments: [] }, 'tester');
        const removedJob = await service.startJob('default');
        let removedResult;
        for (let attempt = 0; attempt < 100; attempt++) {
            removedResult = await service.getJob(removedJob.id);
            if (removedResult.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(removedResult.status, 'success', JSON.stringify(removedResult.entries));
        const deletedFiles = execFileSync('git', ['--git-dir', bare, 'diff-tree', '--no-commit-id', '--name-status', '-r', 'github-import']).toString();
        assert.match(deletedFiles, /D\ttp-static\/payload\/[a-f0-9]+\.bin/);
        assert.equal(publishedManifest(bare).files['pages/data/evidence/12345678-1234-1234-1234-123456789abc.txt'], undefined);
        await service.saveSettings({ repoDir: mirror, branch: 'github-import', file: 'pages/reward-penalty.html', publishMode: 'single' });
        const singleAgain = await service.startJob('default');
        let singleResult;
        for (let attempt = 0; attempt < 100; attempt++) {
            singleResult = await service.getJob(singleAgain.id);
            if (singleResult.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(singleResult.status, 'success', JSON.stringify(singleResult.entries));
        const singleFiles = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'github-import', 'pages']).toString();
        assert.match(singleFiles, /pages\/reward-penalty\.html/);
        assert.doesNotMatch(singleFiles, /pages\/data\//);
        const templated = await service.saveSettings({ repoDir: mirror, branch: 'github-import', file: '{toolSlug}/index.html', publishMode: 'pages' });
        assert.equal(templated.file, '{toolSlug}/index.html');
        assert.equal(templated.resolvedFile, 'department-reward-penalty/index.html');
        const templatedJob = await service.startJob('default');
        assert.equal(templatedJob.path, 'department-reward-penalty/index.html');
        let templatedResult;
        for (let attempt = 0; attempt < 100; attempt++) {
            templatedResult = await service.getJob(templatedJob.id);
            if (templatedResult.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(templatedResult.status, 'success', JSON.stringify(templatedResult.entries));
        assert.ok(JSON.parse(await publishedContent(bare, 'department-reward-penalty/data/records.json')).length);
        service.stopTenantScheduler('default');
    } finally {
        for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});

test('publishing settings and history remain tenant isolated', async () => {
    const local = await require('../backend/models/snapshot-publish-service').getSettings();
    assert.equal(local.branch, 'github-import');
    await runWithTenant('another-snapshot-tenant', async () => {
        const isolated = await require('../backend/models/snapshot-publish-service').getSettings();
        assert.equal(isolated.source, 'environment');
        assert.equal(isolated.file, '{toolSlug}/index.html');
        assert.equal(isolated.resolvedFile, 'department-reward-penalty/index.html');
        assert.equal(isolated.branch, process.env.TOOLS_SNAPSHOT_BRANCH || process.env.TOOLS_SNAPSHOT_GITHUB_BRANCH || 'master');
        assert.equal(isolated.scheduleEnabled, false);
        assert.deepEqual(await require('../backend/models/snapshot-publish-service').listJobs(), []);
    });
});

test('remote HTTPS destination can be saved without embedding credentials', async () => {
    await runWithTenant('remote-snapshot-tenant', async () => {
        const service = require('../backend/models/snapshot-publish-service');
        const settings = await service.saveSettings({ remoteUrl: 'https://codehub.example.com/team/project.git', branch: 'github-import', file: 'published/events.html' });
        assert.equal(settings.remoteUrl, 'https://codehub.example.com/team/project.git');
        assert.equal(settings.repoDir, '');
        await assert.rejects(service.saveSettings({ remoteUrl: 'https://user:token@codehub.example.com/project.git', branch: 'github-import', file: 'tool/index.html' }), /Token/);
        await assert.rejects(service.saveSettings({ remoteUrl: 'https://codehub.example.com/project.git', branch: 'master', file: 'tool/index.html', scheduleEnabled: true, intervalMinutes: 1 }), /5–1440/);
        await assert.rejects(service.saveSettings({ remoteUrl: 'https://codehub.example.com/project.git', branch: 'master', file: 'index.html' }), /根目录 index.html/);
    });
});

test('publish path template accepts one stable slug placeholder only', () => {
    const { resolvePublishPath } = require('../backend/models/snapshot-publish-service');
    assert.equal(resolvePublishPath('{toolSlug}/index.html'), 'department-reward-penalty/index.html');
    assert.equal(resolvePublishPath('pages/{toolSlug}/index.html', 'other-tool'), 'pages/other-tool/index.html');
    assert.throws(() => resolvePublishPath('{toolSlug}/{toolSlug}/index.html'), /只能包含一个/);
    assert.throws(() => resolvePublishPath('{toolName}/index.html'), /仅支持/);
    assert.throws(() => resolvePublishPath('{toolSlug}/../index.html'), /路径无效/);
    assert.throws(() => resolvePublishPath('{toolSlug}/index.html', '../bad'), /slug 无效/);
});

test('existing publishing settings schema gains remote URL without losing rows', async () => {
    await runWithTenant('legacy-snapshot-tenant', async () => {
        await db.run('CREATE TABLE snapshot_publish_settings (key TEXT PRIMARY KEY, repo_dir TEXT NOT NULL, branch TEXT NOT NULL, file_path TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
        await db.run('INSERT INTO snapshot_publish_settings (key, repo_dir, branch, file_path) VALUES (?, ?, ?, ?)', ['department-reward-penalty', '/old/mirror', 'github-import', 'old.html']);
        const settings = await require('../backend/models/snapshot-publish-service').getSettings();
        assert.equal(settings.repoDir, '/old/mirror');
        assert.equal(settings.remoteUrl, '');
        assert.equal(settings.scheduleEnabled, false);
        assert.equal(settings.intervalMinutes, 60);
        assert.equal(settings.publishMode, 'single');
    });
});

test('encrypted publishing settings and gatekeeper injection protect snapshots', async () => {
    const service = require('../backend/models/snapshot-publish-service');
    await runWithTenant('encrypted-snapshot-tenant', async () => {
        await assert.rejects(service.saveSettings({
            remoteUrl: 'https://codehub.example.com/team/project.git',
            branch: 'master', file: '{toolSlug}/index.html',
            encryptionEnabled: true, password: '123'
        }), /至少需 4 位字符/);

        await assert.rejects(service.saveSettings({
            remoteUrl: 'https://codehub.example.com/team/project.git',
            branch: 'master', file: '{toolSlug}/index.html',
            encryptionEnabled: true, password: ''
        }), /必须设置访问密码/);

        const saved = await service.saveSettings({
            remoteUrl: 'https://codehub.example.com/team/project.git',
            branch: 'master', file: '{toolSlug}/index.html',
            encryptionEnabled: true, password: 'StrongPassword123!'
        });
        assert.equal(saved.encryptionEnabled, true);
        assert.equal(saved.hasPassword, true);
        assert.equal(saved.passwordHash, undefined);
        assert.equal(saved.passwordSalt, undefined);

        const secrets = await service.getSettings(true);
        assert.ok(secrets.passwordHash);
        assert.ok(secrets.passwordSalt);
        assert.equal(secrets.passwordHash, service.hashPassword('StrongPassword123!', secrets.passwordSalt));

        const updated = await service.saveSettings({
            remoteUrl: 'https://codehub.example.com/team/project.git',
            branch: 'master', file: '{toolSlug}/index.html',
            encryptionEnabled: true, password: ''
        });
        assert.equal(updated.encryptionEnabled, true);
        assert.equal(updated.hasPassword, true);
        const retainedSecrets = await service.getSettings(true);
        assert.equal(retainedSecrets.passwordHash, secrets.passwordHash);
        assert.equal(retainedSecrets.passwordSalt, secrets.passwordSalt);
    });

    tools.getToolFilePath = async () => path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html');
    const encOptions = {
        encryption: {
            enabled: true,
            hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            salt: 'abcdef0123456789'
        }
    };
    const encHtml = await buildSnapshot('default', encOptions);
    assert.match(encHtml, /id="tpGatekeeperModal"/);
    assert.match(encHtml, /tp-gatekeeper-dialog/);
    assert.match(encHtml, /tp-gatekeeper-btn/);
    assert.match(encHtml, /tpIsUnlocked/);
    assert.match(encHtml, /tpUnlockSnapshot/);
    assert.match(encHtml, /0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/);
    assert.match(encHtml, /abcdef0123456789/);
    for (const script of encHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
        new vm.Script(script[1]);
    }

    const encPages = await buildPagesSnapshot('default', encOptions);
    assert.match(encPages.html, /id="tpGatekeeperModal"/);
    assert.match(encPages.html, /tpIsUnlocked/);
    for (const script of encPages.html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
        new vm.Script(script[1]);
    }

    const menuRoot = path.join(temp, 'menu-enc-fixtures');
    fs.mkdirSync(menuRoot);
    updatePublishMenu(menuRoot, {
        slug: 'department-reward-penalty',
        name: '负向事件管理',
        href: './department-reward-penalty/index.html',
        encrypted: true
    });
    const menuHtml = fs.readFileSync(path.join(menuRoot, 'index.html'), 'utf8');
    const menuMd = fs.readFileSync(path.join(menuRoot, 'README.md'), 'utf8');
    assert.match(menuHtml, /class="tp-menu-badge"/);
    assert.match(menuHtml, /需密码/);
    assert.doesNotMatch(menuHtml, /tp-menu-icon/);
    assert.match(menuMd, /负向事件管理 🔒/);
});

test('getPrerequisites tracks attempt retries, latency, and detailed execution logs', async () => {
    const service = require('../backend/models/snapshot-publish-service');
    const result = await service.getPrerequisites();
    assert.equal(result.gitFound, true);
    assert.equal(result.maxAttempts, 10);
    assert.ok(result.attempts >= 1);
    assert.ok(typeof result.latencyMs === 'number');
    assert.ok(Array.isArray(result.logs));
    assert.ok(result.logs.some(l => l.stage === '环境检测' && l.type === 'success'));
    assert.ok(result.logs.some(l => l.stage === '远端探测' && l.type === 'success'));
});

test('consecutive Pages pushes handle CRLF line endings and existing data directory safely', async () => {
    const service = require('../backend/models/snapshot-publish-service');
    const bare = path.join(temp, 'remote-consecutive.git');
    const mirror = path.join(temp, 'mirror-consecutive');
    execFileSync('git', ['init', '--bare', bare]);
    execFileSync('git', ['clone', bare, mirror]);
    execFileSync('git', ['-C', mirror, 'checkout', '-b', 'master']);
    fs.writeFileSync(path.join(mirror, 'init.txt'), 'init');
    execFileSync('git', ['-C', mirror, 'add', 'init.txt']);
    execFileSync('git', ['-C', mirror, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Init']);
    execFileSync('git', ['-C', mirror, 'push', '-u', 'origin', 'master']);

    await service.saveSettings({
        repoDir: mirror,
        branch: 'master',
        file: '{toolSlug}/index.html',
        publishMode: 'pages'
    });

    // First push
    const job1 = await service.startJob('default');
    let res1;
    for (let i = 0; i < 100; i++) {
        res1 = await service.getJob(job1.id);
        if (res1.status !== 'running') break;
        await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(res1.status, 'success', JSON.stringify(res1.entries));

    // Simulate CodeHub/Windows CRLF translation on the marker file in remote repo
    const cloneDir = path.join(temp, 'test-crlf-edit');
    execFileSync('git', ['clone', bare, cloneDir]);
    const markerPath = path.join(cloneDir, 'department-reward-penalty', 'data', '.tools-platform-snapshot.json');
    if (fs.existsSync(markerPath)) {
        // Write CRLF content
        fs.writeFileSync(markerPath, '{"toolId":"department-reward-penalty","format":1}\r\n');
        execFileSync('git', ['-C', cloneDir, 'add', '-A']);
        execFileSync('git', ['-C', cloneDir, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'CRLF test']);
        execFileSync('git', ['-C', cloneDir, 'push', 'origin', 'master']);
    }

    // Second push must succeed without error
    const job2 = await service.startJob('default');
    let res2;
    for (let i = 0; i < 100; i++) {
        res2 = await service.getJob(job2.id);
        if (res2.status !== 'running') break;
        await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(res2.status, 'success', JSON.stringify(res2.entries));
});

test('disabling encryption removes password gatekeeper and force push redeploys without changes', async () => {
    const service = require('../backend/models/snapshot-publish-service');
    const bare = path.join(temp, 'remote-force.git');
    const mirror = path.join(temp, 'mirror-force');
    execFileSync('git', ['init', '--bare', bare]);
    execFileSync('git', ['clone', bare, mirror]);
    execFileSync('git', ['-C', mirror, 'checkout', '-b', 'master']);
    fs.writeFileSync(path.join(mirror, 'init.txt'), 'init');
    execFileSync('git', ['-C', mirror, 'add', 'init.txt']);
    execFileSync('git', ['-C', mirror, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Init']);
    execFileSync('git', ['-C', mirror, 'push', '-u', 'origin', 'master']);

    // 1. Save with encryption enabled
    await service.saveSettings({
        repoDir: mirror, branch: 'master', file: '{toolSlug}/index.html', publishMode: 'pages',
        encryptionEnabled: true, password: 'InitialPassword123'
    });
    const job1 = await service.startJob('default');
    let res1;
    for (let i = 0; i < 100; i++) {
        res1 = await service.getJob(job1.id);
        if (res1.status !== 'running') break;
        await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(res1.status, 'success');
    const encHtml = execFileSync('git', ['--git-dir', bare, 'show', 'master:department-reward-penalty/index.html']).toString();
    assert.match(encHtml, /data-static-boot/, 'published tools use shared site login even when legacy passwords were configured');
    assert.doesNotMatch(encHtml, /tpGatekeeperModal/);

    // 2. Disable encryption
    const unencSettings = await service.saveSettings({
        repoDir: mirror, branch: 'master', file: '{toolSlug}/index.html', publishMode: 'pages',
        encryptionEnabled: false,
        tools: [{ toolSlug: 'department-reward-penalty', enabled: true, encryptionEnabled: false, password: '' }]
    });
    assert.equal(unencSettings.encryptionEnabled, false);
    const job2 = await service.startJob('default');
    let res2;
    for (let i = 0; i < 100; i++) {
        res2 = await service.getJob(job2.id);
        if (res2.status !== 'running') break;
        await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(res2.status, 'success');
    const unencHtml = execFileSync('git', ['--git-dir', bare, 'show', 'master:department-reward-penalty/index.html']).toString();
    assert.doesNotMatch(unencHtml, /id="tpGatekeeperModal"/);

    // 3. Normal push with no changes skips commit/push
    const job3 = await service.startJob('default');
    let res3;
    for (let i = 0; i < 100; i++) {
        res3 = await service.getJob(job3.id);
        if (res3.status !== 'running') break;
        await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(res3.status, 'success');
    assert.equal(res3.commit, res2.commit);

    // 4. Force push with no changes creates empty commit and pushes
    const job4 = await service.startJob('default', { force: true });
    let res4;
    for (let i = 0; i < 100; i++) {
        res4 = await service.getJob(job4.id);
        if (res4.status !== 'running') break;
        await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(res4.status, 'success');
    assert.notEqual(res4.commit, res3.commit);
});
