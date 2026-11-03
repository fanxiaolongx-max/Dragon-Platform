const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'uiv-desktop-route-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
const bridge = require('../backend/models/platform-promotions-desktop');
const router = require('../backend/routes/uiv');
const previousRuntime = process.env.TOOLS_DESKTOP_RUNTIME;
test.after(() => {
    bridge.configureDesktopPromotions(null);
    if (previousRuntime === undefined) delete process.env.TOOLS_DESKTOP_RUNTIME; else process.env.TOOLS_DESKTOP_RUNTIME = previousRuntime;
    fs.rmSync(sandbox, { recursive: true, force: true });
});
function server(peer = '127.0.0.1', loggedIn = true) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        Object.defineProperty(req.socket, 'remoteAddress', { value: peer, configurable: true });
        if (loggedIn) req.user = { username: 'fixture', role: 'user' };
        next();
    });
    app.use('/api/uiv', router);
    return app;
}
const body = { desktopNative: true, macro: { Commands: [{ Command: 'echo', Target: 'fixture' }] } };
test('desktop macro launch requires real loopback peer, desktop runtime, login and same origin', async () => {
    let launches = 0;
    bridge.configureDesktopPromotions({ runUivMacro: async () => { launches++; return { success: true, mode: 'desktop-native' }; } });
    process.env.TOOLS_DESKTOP_RUNTIME = '1';
    await request(server('192.0.2.1')).post('/api/uiv/run-uivision-macro').set('X-Forwarded-For', '127.0.0.1').send(body).expect(403);
    await request(server('127.0.0.1', false)).post('/api/uiv/run-uivision-macro').send(body).expect(403);
    await request(server()).post('/api/uiv/run-uivision-macro').set('Origin', 'https://attacker.example').send(body).expect(403);
    process.env.TOOLS_DESKTOP_RUNTIME = '0';
    await request(server()).post('/api/uiv/run-uivision-macro').send(body).expect(403);
    assert.equal(launches, 0);
    process.env.TOOLS_DESKTOP_RUNTIME = '1';
    const result = await request(server()).post('/api/uiv/run-uivision-macro').send(body).expect(200);
    assert.equal(result.body.mode, 'desktop-native');
    assert.equal(launches, 1);
    assert.equal(fs.existsSync(path.join(process.env.TOOLS_DATA_DIR, 'tmp/uivision-runs')), false, 'native launch does not persist macro payloads');
});

test('browser runner preserves comparisons and safely embeds script closing tags in macro data', async () => {
    const macro = { Commands: [{ Command: 'executeScript', Target: 'return 1 < 2 ? "</script>" : "";' }] };
    const result = await request(server()).post('/api/uiv/run-uivision-macro').send({ macro }).expect(200);
    const html = fs.readFileSync(result.body.htmlPath, 'utf8');
    const embedded = html.match(/<script id="macro-json" type="application\/json">([\s\S]*?)<\/script>/)[1];
    assert.deepEqual(JSON.parse(embedded), macro);
    assert.equal(embedded.includes('</script>'), false);
    assert.ok(html.includes('/js/uivf12/runner.js'));
});
