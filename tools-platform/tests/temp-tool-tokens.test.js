// 单工具临时免密访问令牌：仅限指定工具与可选独立隔离 /api/terminal，绝不越权访问其他 API，吊销即销毁活跃终端。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-temp-tokens-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const express = require('../backend/node_modules/express');
const controlDb = require('../backend/models/control-db');
const tempTokens = require('../backend/models/temp-tool-tokens-repository');
const { checkAuth } = require('../backend/middleware/auth');
const authSessionsRepo = require('../backend/models/auth-sessions-repository');
const terminalRouter = require('../backend/routes/terminal');
const terminals = require('../backend/models/terminal-sessions');

let server, base;

test.before(async () => {
    await tempTokens.ensureReady();
    await authSessionsRepo.ensureReady();
    const app = express();
    app.use('/api', checkAuth);
    app.use('/api/terminal', terminalRouter);
    app.get('/api/vault', (_req, res) => res.json({ secret: 'nope' }));
    app.get('/api/ai/sessions', (_req, res) => res.json({ secret: 'nope' }));
    app.get('/api/custom-tools/taisha/temp-links', (_req, res) => res.json({ secret: 'nope' }));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    for (const s of [...terminals._internal.sessions.values()]) {
        terminals.kill(s.owner, s.id);
    }
    await new Promise(resolve => server.close(resolve));
    await controlDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('temp token stores only SHA-256 hash, enforces slug scope, and rejects expired/revoked tokens', async () => {
    const { record, rawToken } = await tempTokens.createToken({
        slug: 'taisha',
        label: 'colleague-test',
        ttlHours: 24,
        allowTerminal: true,
        createdBy: 'admin'
    });
    assert.equal(record.slug, 'taisha');
    assert.equal(record.allowTerminal, true);
    assert.equal(record.active, true);

    // Ensure plaintext token is NEVER stored in SQLite
    const rawRow = await controlDb.get('SELECT * FROM temp_tool_tokens WHERE id = ?', [record.id]);
    assert.notEqual(rawRow.token_hash, rawToken);
    assert.equal(JSON.stringify(rawRow).includes(rawToken), false);

    // Slug scoping
    assert.ok(await tempTokens.verifyToken(rawToken, { expectedSlug: 'taisha' }));
    assert.equal(await tempTokens.verifyToken(rawToken, { expectedSlug: 'other-tool' }), null);

    // List metadata never leaks hash or raw token
    const list = await tempTokens.listTokens('taisha');
    assert.equal(list.length, 1);
    assert.equal(JSON.stringify(list).includes(rawToken), false);
    assert.equal(JSON.stringify(list).includes(rawRow.token_hash), false);

    // Expiration check
    await controlDb.run('UPDATE temp_tool_tokens SET expires_at = ? WHERE id = ?', [Date.now() - 1000, record.id]);
    assert.equal(await tempTokens.verifyToken(rawToken, { expectedSlug: 'taisha' }), null);
});

test('temp cookie ONLY unlocks /api/terminal (excluding /loopback), isolates sessions from admin, and kills PTYs on revoke', async () => {
    const { record: fullRec, rawToken: fullToken } = await tempTokens.createToken({
        slug: 'taisha',
        label: 'full-access',
        ttlHours: 4,
        allowTerminal: true,
        createdBy: 'admin'
    });
    const { rawToken: pageOnlyToken } = await tempTokens.createToken({
        slug: 'taisha',
        label: 'page-only',
        ttlHours: 4,
        allowTerminal: false,
        createdBy: 'admin'
    });

    const fullCookie = `${tempTokens.COOKIE_NAME}=${fullToken}`;
    const pageOnlyCookie = `${tempTokens.COOKIE_NAME}=${pageOnlyToken}`;

    // 1. Page-only token CANNOT access /api/terminal
    const denyPageOnly = await fetch(`${base}/api/terminal/info`, { headers: { Cookie: pageOnlyCookie } });
    assert.equal(denyPageOnly.status, 401);

    // 2. Full temp token CAN access /api/terminal/info (even if an expired tools_token cookie is also sent!)
    const allowTerm = await fetch(`${base}/api/terminal/info`, {
        headers: { Cookie: `tools_token=expired_stale_token; ${fullCookie}` }
    });
    assert.equal(allowTerm.status, 200);

    // 3. Full temp token CANNOT access /api/terminal/loopback or ANY other platform API
    const denyLoopback = await fetch(`${base}/api/terminal/loopback`, {
        method: 'POST',
        headers: { Cookie: fullCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:9999/?code=1' })
    });
    assert.equal(denyLoopback.status, 401);

    for (const forbidden of ['/api/vault', '/api/ai/sessions', '/api/custom-tools/taisha/temp-links']) {
        const res = await fetch(`${base}${forbidden}`, { headers: { Cookie: fullCookie } });
        assert.equal(res.status, 401, `temp token must be rejected on ${forbidden}`);
    }

    // 4. Terminal session isolation: create one admin session and one temp-token session
    const adminSess = terminals.create('default::admin', { title: 'Admin-Private-PTY' });
    const createTempRes = await fetch(`${base}/api/terminal/sessions`, {
        method: 'POST',
        headers: { Cookie: fullCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Temp-Visitor-PTY' })
    });
    assert.equal(createTempRes.status, 200);
    const tempSess = (await createTempRes.json()).session;

    // Temp visitor sees ONLY its own session, never admin's session
    const listTempRes = await fetch(`${base}/api/terminal/sessions`, { headers: { Cookie: fullCookie } });
    const listTemp = (await listTempRes.json()).items;
    assert.deepEqual(listTemp.map(s => s.id), [tempSess.id]);

    // Temp visitor CANNOT kill admin's session
    const killAdminRes = await fetch(`${base}/api/terminal/sessions/${adminSess.id}`, {
        method: 'DELETE',
        headers: { Cookie: fullCookie }
    });
    assert.equal((await killAdminRes.json()).ok, false);
    assert.equal(terminals.view('default::admin', adminSess.id).exited, false);

    // 5. Revoking temp token IMMEDIATELY kills temp visitor's PTY & blocks future /api/terminal calls, leaving admin PTY intact
    const revoked = await tempTokens.revokeToken(fullRec.id, 'taisha');
    assert.equal(revoked.revoked, true);
    const killedCnt = terminals.killOwner(tempTokens.ownerKeyForToken(revoked));
    assert.equal(killedCnt, 1);
    assert.equal(terminals.view('default::admin', adminSess.id).exited, false);

    const afterRevoke = await fetch(`${base}/api/terminal/info`, { headers: { Cookie: fullCookie } });
    assert.equal(afterRevoke.status, 401);

    terminals.kill('default::admin', adminSess.id);
});
