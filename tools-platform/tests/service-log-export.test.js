const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const express = require('express');
const request = require('supertest');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'service-log-export-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const db = require('../backend/models/app-db');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const exporter = require('../backend/models/service-log-export');
const statusRepo = require('../backend/models/service-status-repository');
const aiRepo = require('../backend/models/ai-chat-repository');
const agentRepo = require('../backend/models/agent-transcript-repository');
const desktop = require('../backend/models/desktop-agents/service');
const settings = require('../backend/models/ai-settings-repository');

test.after(async () => { await db.closeDatabase(); fs.rmSync(sandbox, { recursive: true, force: true }); });

const range = { startDate: '2026-11-10', endDate: '2026-11-10', startOffset: '-480', endOffset: '-480' };

test('validates real calendar dates, inclusive days, local offsets and DST boundaries', () => {
    assert.equal(exporter.parseRange(range).startAt, '2026-11-09T16:00:00.000Z');
    assert.equal(exporter.parseRange(range).endAt, '2026-11-10T16:00:00.000Z');
    const dst = exporter.parseRange({ startDate: '2026-11-01', endDate: '2026-11-01', startOffset: '240', endOffset: '300' });
    assert.equal(Date.parse(dst.endAt) - Date.parse(dst.startAt), 25 * 3600000);
    for (const query of [{ startDate: '2026-02-30' }, { startDate: '../data' }, { ...range, endDate: '2026-11-09' }, { ...range, startOffset: '900' }, { ...range, endOffset: '' }]) {
        assert.throws(() => exporter.parseRange(query), error => error.code === 'INVALID_LOG_EXPORT_RANGE');
    }
});

test('ZIP exports all rows, respects date/owner/tenant boundaries, and omits media and secrets', async t => {
    t.mock.method(settings, 'getRedactionSecrets', async () => ['a-configured-secret']);
    t.mock.method(desktop, 'discover', async () => ({ rows: [{ provider: 'codex', id: 'one' }, { provider: 'antigravity', id: 'two' }] }));
    t.mock.method(desktop, 'messages', async (_owner, provider, _id, options) => {
        assert.equal(options.passive, true);
        if (provider === 'antigravity') throw new Error('offline');
        return { items: [
            { createdAt: '2026-11-10T03:00:00Z', content: 'desktop code', attachments: [{ path: '/private/photo.png' }] },
            { createdAt: '2026-11-10T17:00:00Z', content: 'outside desktop' },
            { createdAt: null, content: 'undated desktop' }
        ] };
    });
    const seed = async tenant => runWithTenant(tenant, async () => {
        await statusRepo.ensureReady();
        await aiRepo.ensureReady();
        await agentRepo.ensureReady();
        for (let i = 0; i < 125; i++) await db.run(`INSERT INTO service_runtime_logs(logged_at,level,source,detail) VALUES(?,?,?,?)`, ['2026-11-09T16:00:00.000Z', 'DEBUG', 'source.js:1', `${tenant}-${i} a-configured-secret`]);
        await db.run(`INSERT INTO service_runtime_logs(logged_at,level,source,detail) VALUES(?,?,?,?)`, ['2026-11-10T15:59:59.999Z', 'ERROR', 'source.js:2', 'last millisecond']);
        await db.run(`INSERT INTO service_runtime_logs(logged_at,level,source,detail) VALUES(?,?,?,?)`, ['2026-11-10T16:00:00.000Z', 'INFO', 'source.js:3', 'outside runtime']);
        for (const [id, owner] of [['mine', 'admin'], ['other', 'someone']]) {
            await db.run('INSERT INTO ai_chat_sessions(id,owner) VALUES(?,?)', [id, owner]);
            await db.run(`INSERT INTO ai_chat_messages(id,session_id,role,content,events,created_at) VALUES(?,?,?,?,?,?)`, [id, id, 'assistant', `${tenant} ${owner} \n\x60\x60\x60js\nconst answer = 42;\n\x60\x60\x60\npassword=hidden\na-configured-secret\n![photo](data:image/png;base64,AAAA)`, JSON.stringify([{ type: 'tool', content: 'echo hello', imageData: 'private-image', attachments: [{ data: 'private-file' }] }]), '2026-11-10 03:00:00']);
        }
        await db.run(`INSERT INTO ai_chat_messages(id,session_id,role,content,created_at) VALUES('outside','mine','user','outside AI','2026-11-10 16:00:00')`);
        for (const owner of [`${tenant}::admin`, `${tenant}::someone`]) await db.run(`INSERT INTO agent_session_turns(run_id,agent_session_id,owner,root,transcript,created_at) VALUES(?,?,?,?,?,?)`, [owner, 'agent1', owner, '/', JSON.stringify([{ role: 'tool', content: owner, images: ['private-agent-image'] }]), '2026-11-10 03:00:00']);
    });
    await seed('alpha'); await seed('beta');
    const archive = await runWithTenant('alpha', () => exporter.buildArchive({ ...range, levels: 'ERROR', q: 'no-match', pageSize: 10, tenantId: 'beta' }, 'admin'));
    assert.equal(archive.filename, 'service-logs-2026-11-10_2026-11-10.zip');
    const zip = await JSZip.loadAsync(archive.buffer);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.equal(manifest.tenant, 'alpha'); assert.equal(manifest.runtimeLogs, 126);
    assert.equal(manifest.aiMessages, 1); assert.equal(manifest.agentTurns, 1); assert.equal(manifest.desktopMessages, 1);
    assert.match(manifest.warnings.join('\n'), /offline/); assert.match(manifest.warnings.join('\n'), /1 条没有有效/);
    const text = (await Promise.all(Object.values(zip.files).filter(f => !f.dir).map(f => f.async('string')))).join('\n');
    for (const secret of ['beta-', 'someone', 'outside runtime', 'outside AI', 'outside desktop', 'undated desktop', 'private-image', 'private-file', 'private-agent-image', '/private/photo.png', 'a-configured-secret', 'password=hidden', 'data:image']) assert.ok(!text.includes(secret), secret);
    assert.match(text, /const answer = 42/); assert.match(text, /echo hello/); assert.match(text, /last millisecond/);
    // 可选AI来源故障不影响运行日志包，明确报告缺失。
    t.mock.method(aiRepo, 'ensureReady', async () => { throw new Error('AI unavailable'); });
    const partial = await runWithTenant('alpha', () => exporter.buildArchive(range, 'admin'));
    const partialZip = await JSZip.loadAsync(partial.buffer);
    assert.ok(partialZip.file('runtime-logs.json'));
    assert.match(await partialZip.file('manifest.json').async('string'), /AI unavailable/);
});

test('export route requires admin and uses session tenant rather than query tenant', async t => {
    const router = require('../backend/routes/platform-metrics');
    let calls = 0;
    t.mock.method(exporter, 'buildArchive', async (_query, owner) => {
        calls++; assert.equal(owner, 'admin');
        assert.equal(require('../backend/models/tenant-context').getTenantId(), 'alpha');
        return { filename: 'logs.zip', buffer: Buffer.from('PK') };
    });
    const app = express();
    app.use((req, _res, next) => { req.user = { username: 'admin', role: req.headers['x-role'] || 'user', tenantId: 'alpha' }; next(); });
    app.use(tenantMiddleware); app.use('/metrics', router);
    await request(app).get('/metrics/service-status/logs/export').expect(403);
    assert.equal(calls, 0);
    const response = await request(app).get('/metrics/service-status/logs/export?tenantId=beta').set('x-role', 'admin').expect(200);
    assert.match(response.headers['content-type'], /application\/zip/);
    assert.match(response.headers['content-disposition'], /logs.zip/);
    t.mock.method(exporter, 'buildArchive', async () => { throw Object.assign(new Error('bad date'), { statusCode: 400, code: 'INVALID_LOG_EXPORT_RANGE' }); });
    const error = await request(app).get('/metrics/service-status/logs/export').set('x-role', 'admin').expect(400);
    assert.equal(error.body.code, 'INVALID_LOG_EXPORT_RANGE');
});
