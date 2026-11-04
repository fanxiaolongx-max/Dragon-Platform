const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-quota-'));
process.env.TOOLS_DATA_DIR = path.join(root, 'data');
const db = require('../backend/models/app-db'), host = require('../backend/models/desktop-agents/repository'), quota = require('../backend/models/desktop-agents/quota');
const live = provider => ({ provider, active: true, status: 'live', membership: { tier: 'pro', label: 'Pro' }, updatedAt: 1, checkedAt: 1, token: 'must-not-leak', groups: [{ id: provider, label: provider, windows: [{ id: '5h', remainingPercent: 80, resetsAt: null, durationMinutes: 300, secret: 'x' }] }] });
const all = { codex: live('codex'), claudecode: live('claudecode'), antigravity: live('antigravity') };
test.after(async () => { await db.closeDatabase(); await require('../backend/models/platform-db').closeDatabase(); await require('../backend/models/tenant-sqlite-pool').closeAll(); fs.rmSync(root, { recursive: true, force: true }); });

test('quota is only readable after connecting the desktop agents', async () => {
    await assert.rejects(quota.read('alice', { detect: async () => all }), e => e.status === 409);
});

test('returns only enabled providers, without credentials or extra fields', async () => {
    await host.save('alice', { enabled: true, providers: { claudecode: false } });
    const data = await quota.read('alice', { detect: async () => all });
    assert.deepEqual(data.providers, ['codex', 'antigravity']);
    assert.deepEqual(Object.keys(data.quotas), ['codex', 'antigravity']);
    assert.equal(data.quotas.codex.groups[0].windows[0].remainingPercent, 80);
    assert.doesNotMatch(JSON.stringify(data), /must-not-leak|secret/);
    await assert.rejects(quota.read('bob', { detect: async () => all }), e => e.status === 403, 'another account cannot read this desktop');
});

test('manual refresh reaches the providers at most once per 15 seconds', async () => {
    const forced = [];
    const detect = async force => { forced.push(force); return all; };
    await quota.read('alice', { force: true, detect });
    await quota.read('alice', { force: true, detect });
    assert.deepEqual(forced, [true, false]);
});

test('no enabled quota provider means no detection at all', async () => {
    await host.save('alice', { providers: { codex: false, claudecode: false, antigravity: false } });
    let called = false;
    const data = await quota.read('alice', { detect: async () => { called = true; return all; } });
    assert.deepEqual(data.providers, []);
    assert.equal(called, false);
});

test('trends merge the desktop app and server samples of this account only', async () => {
    const history = require('../backend/models/pet-quota-history-repository');
    await host.save('alice', { providers: { codex: true, claudecode: false } });
    const now = Date.now(), sample = (at, remaining) => ({ codex: { ...live('codex'), updatedAt: at, groups: [{ id: 'codex', label: 'Codex', windows: [{ id: '5h', remainingPercent: remaining, resetsAt: null }] }] } });
    await history.record('alice', 'desktop-install', sample(now - 600000, 90), now);
    await history.record('alice', 'web-server', sample(now - 60000, 70), now);
    await history.record('bob', 'web-server', sample(now - 30000, 10), now);
    const data = await quota.trends('alice', 'codex', 1);
    assert.deepEqual(data.series[0].points.map(p => p.remaining), [90, 70]);
    await assert.rejects(quota.trends('alice', 'claudecode', 1), e => e.status === 400, 'disabled providers have no trends');
    await assert.rejects(quota.trends('alice', 'codex', 91), e => e.status === 400);
    await assert.rejects(quota.trends('bob', 'codex', 1), e => e.status === 403, 'another account cannot read this desktop');
});
