const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatusReader } = require('../backend/models/home-connectors');
const admin = { role: 'admin' };
function fixture() {
    const state = { tenant: true, enabled: true, installed: true, loggedIn: true, authCalls: 0, clock: 0, updatedAt: 'one',
        digital: { enabled: true, baseQueryUrl: 'https://example.test', appUuid: 'example', businessDatasourceName: 'business', businessSchema: 'netcare', lastTest: { ok: true } } };
    const status = createStatusReader({ now: () => state.clock, cli: {
        tenantAllowed: () => state.tenant, readConfig: () => ({ enabled: state.enabled, updatedAt: state.updatedAt }),
        detect: async () => ({ available: state.installed }), authStatus: async () => { state.authCalls++; return { loggedIn: state.loggedIn, token: 'must-never-return', text: 'private CLI output' }; }
    }, digital: { getConfig: async () => state.digital } });
    return { state, status };
}
test('readiness is safe and does not inspect private configuration for non-admins', async () => {
    const { status, state } = fixture();
    assert.deepEqual(await status({ role: 'viewer' }), [{ id: 'welink-cli', ready: false, reason: 'forbidden' }, { id: 'netcare', ready: false, reason: 'forbidden' }]);
    assert.equal(state.authCalls, 0);
    const ready = await status(admin);
    assert.ok(ready.every(item => item.ready));
    assert.equal(JSON.stringify(ready).includes('must-never-return'), false);
    assert.equal(JSON.stringify(ready).includes('private'), false);
});
test('personal WeLink requires default tenant, enabled installation and a confirmed login', async () => {
    for (const [field, value, reason] of [['tenant', false, 'tenant'], ['enabled', false, 'disabled'], ['installed', false, 'not-installed'], ['loggedIn', false, 'login'], ['loggedIn', null, 'login']]) {
        const { status, state } = fixture(); state[field] = value;
        assert.deepEqual(await status(admin, 'welink-cli'), [{ id: 'welink-cli', ready: false, reason }]);
    }
});
test('CLI checks share in-flight work and invalidate after expiry or configuration change', async () => {
    const { status, state } = fixture();
    await Promise.all([status(admin, 'welink-cli'), status(admin, 'welink-cli')]);
    assert.equal(state.authCalls, 1);
    state.clock = 30001; await status(admin, 'welink-cli'); assert.equal(state.authCalls, 2);
    state.updatedAt = 'two'; await status(admin, 'welink-cli'); assert.equal(state.authCalls, 3);
});
test('NetCare requires complete enabled configuration and a successful connection test', async () => {
    for (const [change, reason] of [[{ enabled: false }, 'disabled'], [{ appUuid: '' }, 'unconfigured'], [{ lastTest: null }, 'untested'], [{ lastTest: { ok: false } }, 'untested']]) {
        const { status, state } = fixture(); Object.assign(state.digital, change);
        assert.deepEqual(await status(admin, 'netcare'), [{ id: 'netcare', ready: false, reason }]);
        assert.equal(state.authCalls, 0, 'NetCare status does not contact the CLI');
    }
});
test('connection-check failures remain disabled without exposing exception details', async () => {
    const status = createStatusReader({ cli: { tenantAllowed: () => true, readConfig: () => ({ enabled: true }), detect: async () => { throw Error('secret'); } }, digital: { getConfig: async () => { throw Error('secret'); } } });
    assert.deepEqual(await status(admin), [{ id: 'welink-cli', ready: false, reason: 'offline' }, { id: 'netcare', ready: false, reason: 'error' }]);
});
