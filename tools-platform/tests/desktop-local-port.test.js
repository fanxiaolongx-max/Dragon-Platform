const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { chooseLocalPort, probePort, readPreferredPort, writePreferredPort, DEFAULT_PORT } = require('../desktop-local-port');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-local-port-'));
test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function fakeProbe(busy = []) {
    const tried = [];
    const probe = async port => {
        tried.push(port);
        if (port === 0) return 54321;
        return busy.includes(port) ? null : port;
    };
    return { probe, tried };
}

test('the previous port is reused first so the browser origin stays the same', async () => {
    const statePath = path.join(sandbox, 'reuse', 'local-port.json');
    assert.equal(writePreferredPort(statePath, 62015), true);
    assert.equal(readPreferredPort(statePath), 62015);
    const { probe, tried } = fakeProbe();
    assert.deepEqual(await chooseLocalPort({ statePath, probe }), { port: 62015, source: 'previous' });
    assert.deepEqual(tried, [62015]);
});

test('a busy previous port falls back to the default, then to a system port', async () => {
    const statePath = path.join(sandbox, 'busy', 'local-port.json');
    writePreferredPort(statePath, 62015);
    let pick = fakeProbe([62015]);
    assert.deepEqual(await chooseLocalPort({ statePath, probe: pick.probe }), { port: DEFAULT_PORT, source: 'default' });
    assert.deepEqual(pick.tried, [62015, DEFAULT_PORT]);
    pick = fakeProbe([62015, DEFAULT_PORT]);
    assert.deepEqual(await chooseLocalPort({ statePath, probe: pick.probe }), { port: 54321, source: 'random' });
    assert.deepEqual(pick.tried, [62015, DEFAULT_PORT, 0]);
});

test('a missing or corrupt record starts from the default port', async () => {
    const missing = path.join(sandbox, 'none', 'local-port.json');
    assert.equal(readPreferredPort(missing), null);
    const corrupt = path.join(sandbox, 'corrupt.json');
    fs.writeFileSync(corrupt, '{not json');
    assert.equal(readPreferredPort(corrupt), null);
    fs.writeFileSync(corrupt, JSON.stringify({ port: 80 }));
    assert.equal(readPreferredPort(corrupt), null, 'privileged ports are ignored');
    const { probe, tried } = fakeProbe();
    assert.deepEqual(await chooseLocalPort({ statePath: missing, probe }), { port: DEFAULT_PORT, source: 'default' });
    assert.deepEqual(tried, [DEFAULT_PORT]);
    assert.equal(writePreferredPort(missing, 'abc'), false);
});

test('probePort reports a port held by another listener as busy', async () => {
    const holder = net.createServer();
    await new Promise(resolve => holder.listen(0, resolve));
    const held = holder.address().port;
    try {
        assert.equal(await probePort(held), null);
        const free = await probePort(0);
        assert.ok(Number.isInteger(free) && free > 0);
    } finally {
        await new Promise(resolve => holder.close(resolve));
    }
});

test('the desktop shell uses the remembered port and packages the helper', () => {
    const main = fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8');
    assert.match(main, /require\('\.\/desktop-local-port'\)/);
    assert.match(main, /chooseLocalPort\(\{ statePath: localPortStatePath \}\)/);
    assert.match(main, /writePreferredPort\(localPortStatePath, PORT\)/);
    assert.doesNotMatch(main, /getFreePort\(3030\)/);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.ok(pkg.build.files.includes('desktop-local-port.js'));
});
