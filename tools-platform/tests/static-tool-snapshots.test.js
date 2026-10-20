const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');
const JSZip = require('jszip');
const { execFileSync } = require('child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'static-tool-snapshots-'));
process.env.TOOLS_DATA_DIR = temp;

const db = require('../backend/models/app-db');
const meetingRepo = require('../backend/models/meeting-snapshots-repository');
const incentiveRepo = require('../backend/models/operation-incentive-snapshots-repository');
const publishService = require('../backend/models/snapshot-publish-service');
const meetingSnapshot = require('../backend/models/meeting-attendance-snapshot');
const incentiveSnapshot = require('../backend/models/operation-incentive-snapshot');
const snapshotRouter = require('../backend/routes/department-reward-penalty');

test.before(async () => {
    await meetingRepo.saveSnapshot({
        id: 'meeting-static-1',
        title: '2026-09 月度会议',
        meetingDate: '2026-09-10',
        summary: {
            attendees: [
                { staffId: 'u123456', name: '张三', attendance: 'Absent', bu: 'Cloud' },
                { staffId: 'u654321', name: '李四', attendance: 'Attend on Time', bu: 'Core' }
            ]
        },
        payload: { sheets: [] }
    });
    await incentiveRepo.saveSnapshot({
        id: 'incentive-static-1',
        title: '2026-09 操作激励',
        period: '2026-09',
        sourceFile: 'incentive.xlsx',
        summary: { totalAmount: 500, totalPeople: 1 },
        payload: { rawRows: [{ __person: 'u123456', __name: '张三', __bu: 'Cloud' }] }
    });
});

test.after(async () => {
    await db.closeDatabase();
    fs.rmSync(temp, { recursive: true, force: true });
});

function scripts(html) {
    return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
}

test('snapshot publishing registers meeting attendance and operation incentive tools', async () => {
    const settings = await publishService.getSettings();
    assert.ok(settings.tools.some(tool => tool.toolSlug === 'tool-msf5b7nn' && tool.name));
    assert.ok(settings.tools.some(tool => tool.toolSlug === 'tool-ms4xb66s' && tool.name));
    assert.ok(publishService.providers.has('tool-msf5b7nn'));
    assert.ok(publishService.providers.has('tool-ms4xb66s'));
});

test('meeting attendance single HTML contains full history and returns explicit readonly errors for writes', async () => {
    const html = await meetingSnapshot.buildSnapshot('default');
    assert.match(html, /meeting-static-1/);
    assert.match(html, /READ_ONLY_SNAPSHOT/);
    assert.match(html, /batch-attendance-check/);
    scripts(html).forEach(source => new vm.Script(source));

    const runtime = scripts(html)[0];
    class FakeResponse {
        constructor(body, init = {}) { this.body = body; this.status = init.status || 200; this.ok = this.status >= 200 && this.status < 300; }
        async json() { return JSON.parse(this.body); }
    }
    const context = {
        URL,
        Response: FakeResponse,
        console,
        window: { fetch: async () => { throw new Error('network must stay blocked'); } }
    };
    vm.runInNewContext(runtime, context);
    const listResponse = await context.window.fetch('/api/meeting-snapshots');
    assert.equal((await listResponse.json()).items[0].id, 'meeting-static-1');
    const writeResponse = await context.window.fetch('/api/meeting-snapshots/meeting-static-1', { method: 'DELETE' });
    assert.equal(writeResponse.status, 403);
    assert.equal((await writeResponse.json()).code, 'READ_ONLY_SNAPSHOT');
});

test('meeting attendance Pages output separates complete data from HTML', async () => {
    const output = await meetingSnapshot.buildPagesSnapshot('default');
    assert.ok(output.files.has('data/meeting.json'));
    assert.doesNotMatch(output.html, /"id":"meeting-static-1"/);
    const data = JSON.parse(output.files.get('data/meeting.json'));
    assert.equal(data.snapshots[0].payload.sheets.length, 0);
    assert.equal(data.attendance['u123456|张三'].hasAnomaly, true);
    scripts(output.html).forEach(source => new vm.Script(source));
});

test('operation incentive snapshots include own history and related meeting attendance in both formats', async () => {
    const html = await incentiveSnapshot.buildSnapshot('default');
    assert.match(html, /incentive-static-1/);
    assert.match(html, /meeting-static-1/);
    assert.match(html, /batch-attendance-check/);
    assert.match(html, /READ_ONLY_SNAPSHOT/);
    scripts(html).forEach(source => new vm.Script(source));

    const output = await incentiveSnapshot.buildPagesSnapshot('default');
    assert.ok(output.files.has('data/incentive.json'));
    assert.ok(output.files.has('data/meeting.json'));
    const incentive = JSON.parse(output.files.get('data/incentive.json'));
    const meeting = JSON.parse(output.files.get('data/meeting.json'));
    assert.equal(incentive.snapshots[0].id, 'incentive-static-1');
    assert.equal(meeting.attendance['u123456|张三'].anomalyCount, 1);
    scripts(output.html).forEach(source => new vm.Script(source));
});

test('shared download API packages each supported tool in single or split format and requires admin', async () => {
    const app = express();
    app.use((req, _res, next) => {
        req.user = { role: req.headers['x-role'] || 'user', tenantId: 'default', username: 'tester' };
        next();
    });
    app.use('/api/department-reward-penalty', snapshotRouter);
    const base = '/api/department-reward-penalty/snapshot/download/';
    await request(app).get(base + 'tool-msf5b7nn').expect(403);
    await request(app).get(base + 'unknown-tool').set('x-role', 'admin').expect(404);
    const html = await request(app).get(base + 'tool-msf5b7nn?format=single').set('x-role', 'admin').expect(200);
    assert.match(html.headers['content-disposition'], /tool-msf5b7nn-readonly\.html/);
    assert.match(html.text, /meeting-static-1/);

    const pages = await request(app)
        .get(base + 'tool-ms4xb66s?format=pages')
        .set('x-role', 'admin')
        .buffer(true)
        .parse((response, callback) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
    const zip = await JSZip.loadAsync(pages.body);
    assert.ok(zip.file('index.html'));
    assert.ok(zip.file('data/meeting.json'));
    assert.ok(zip.file('data/incentive.json'));
    const incentive = JSON.parse(await zip.file('data/incentive.json').async('string'));
    assert.equal(incentive.snapshots[0].id, 'incentive-static-1');
});

test('tool-scoped publish writes only the selected Pages bundle and retains its job scope for logs', async () => {
    const bare = path.join(temp, 'tool-remote.git');
    const mirror = path.join(temp, 'tool-mirror');
    execFileSync('git', ['init', '--bare', '--initial-branch=main', bare]);
    execFileSync('git', ['clone', bare, mirror]);
    fs.writeFileSync(path.join(mirror, 'keep.txt'), 'keep');
    execFileSync('git', ['-C', mirror, 'add', 'keep.txt']);
    execFileSync('git', ['-C', mirror, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
    execFileSync('git', ['-C', mirror, 'push', '-u', 'origin', 'HEAD:main']);
    await publishService.saveSettings({ repoDir: mirror, branch: 'main', file: '{toolSlug}/index.html', publishMode: 'pages' });
    const started = await publishService.startJob('default', { toolSlug: 'tool-msf5b7nn' });
    let job;
    for (let attempt = 0; attempt < 100; attempt++) {
        job = await publishService.getJob(started.id);
        if (job.status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(job.status, 'success', JSON.stringify(job.entries));
    assert.equal(job.toolSlug, 'tool-msf5b7nn');
    const files = execFileSync('git', ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main']).toString();
    const portal = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:tp-static/site.json']).toString());
    assert.ok(portal.files['tool-msf5b7nn/data/meeting.json']);
    assert.doesNotMatch(files, /tool-ms4xb66s\//);
    const menu = JSON.parse(execFileSync('git', ['--git-dir', bare, 'show', 'main:.tools-platform-menu.json']).toString());
    assert.match(menu.items[0].fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(menu.items[0].updatedAt)));
    const index = execFileSync('git', ['--git-dir', bare, 'show', 'main:index.html']).toString();
    assert.match(index, /data-static-boot/);
    assert.match(files, /login\.html/);
});

test('tool-scoped publish rejects a shared fixed output path before changing the repository', async () => {
    const mirror = path.join(temp, 'tool-mirror');
    const bare = path.join(temp, 'tool-remote.git');
    const before = execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main']).toString().trim();
    await publishService.saveSettings({ repoDir: mirror, branch: 'main', file: 'pages/snapshot.html', publishMode: 'single' });
    const started = await publishService.startJob('default', { toolSlug: 'tool-ms4xb66s' });
    let job;
    for (let attempt = 0; attempt < 100; attempt++) {
        job = await publishService.getJob(started.id);
        if (job.status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'failed');
    assert.match(job.entries.at(-1).message, /\{toolSlug\}/);
    assert.equal(execFileSync('git', ['--git-dir', bare, 'rev-parse', 'main']).toString().trim(), before);
});
