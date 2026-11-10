// 保险箱接口与桌面浏览器适配：只认登录账号，列表不带密码，查看明文要重新验证平台密码。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-vault-route-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const express = require('../backend/node_modules/express');
const { hashUserPassword } = require('../backend/middleware/auth');
const authUsersRepo = require('../backend/models/auth-users-repository');
const { vault } = require('../backend/models/password-vault');
const { createVaultCredentials, attachBrowserLogin } = require('../desktop-promo/browser-credentials');

const accounts = { alice: 'alice-platform-pw', root: 'root-platform-pw' };
authUsersRepo.getUser = async username => accounts[username] ? { username, passwordHash: hashUserPassword(accounts[username]) } : null;

let server, base;
test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { if (req.headers['x-user']) req.user = { username: req.headers['x-user'], role: req.headers['x-role'] || 'user', isSuper: req.headers['x-super'] === '1', tenantId: req.headers['x-tenant'] || 'default' }; next(); });
    app.use('/api/vault', require('../backend/routes/vault'));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/vault`;
});
test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await vault().close();
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function call(user, method, route = '', body, extra = {}) {
    const res = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json(), cache: res.headers.get('cache-control') };
}

test('each account works on its own vault; a super admin gets no way into someone else\'s', async () => {
    assert.equal((await call('', 'GET')).status, 401);
    const created = await call('alice', 'POST', '', { url: 'https://example.com/login', username: 'alice', password: 'site-secret-1' });
    assert.equal(created.status, 200);
    assert.equal(JSON.stringify(created.data).includes('site-secret-1'), false);
    const id = created.data.entry.id;

    const mine = await call('alice', 'GET');
    assert.deepEqual([mine.data.entries.length, mine.cache], [1, 'no-store']);
    assert.equal(JSON.stringify(mine.data).includes('site-secret-1'), false);

    const admin = { 'x-role': 'admin', 'x-super': '1', 'x-tenant': 'default' };
    assert.deepEqual((await call('root', 'GET', '', null, admin)).data.entries, []);
    for (const [method, route, body] of [['PUT', `/${id}`, { password: 'x' }], ['DELETE', `/${id}`], ['POST', `/${id}/reveal`, { accountPassword: accounts.root }]]) {
        assert.equal((await call('root', method, route, body, admin)).status, 404, `${method} ${route}`);
    }
    // 进入别的团队空间也还是自己的保险箱
    assert.equal((await call('alice', 'GET', '', null, { 'x-tenant': 'team-x' })).data.entries.length, 1);
});

test('viewing a password needs the platform password again and is rate limited', async () => {
    const id = (await call('alice', 'GET')).data.entries[0].id;
    const wrong = await call('alice', 'POST', `/${id}/reveal`, { accountPassword: 'nope' });
    assert.deepEqual([wrong.status, wrong.data.code], [403, 'VAULT_REAUTH_FAILED']);
    assert.equal((await call('alice', 'POST', `/${id}/reveal`, {})).status, 403);
    const ok = await call('alice', 'POST', `/${id}/reveal`, { accountPassword: accounts.alice });
    assert.deepEqual([ok.status, ok.data.password], [200, 'site-secret-1']);
    for (let attempt = 0; attempt < 5; attempt += 1) await call('alice', 'POST', `/${id}/reveal`, { accountPassword: 'nope' });
    const locked = await call('alice', 'POST', `/${id}/reveal`, { accountPassword: accounts.alice });
    assert.deepEqual([locked.status, locked.data.code], [429, 'VAULT_REVEAL_LIMIT']);
});

test('editing keeps the password when it is left blank; invalid input is rejected', async () => {
    const id = (await call('alice', 'GET')).data.entries[0].id;
    const edited = await call('alice', 'PUT', `/${id}`, { username: 'alice2', password: '', label: '主账号', autoSubmit: false });
    assert.deepEqual([edited.data.entry.username, edited.data.entry.label, edited.data.entry.autoSubmit], ['alice2', '主账号', false]);
    assert.equal(await vault().reveal('alice', id), 'site-secret-1');
    assert.equal((await call('alice', 'POST', '', { url: 'not a url', username: 'a', password: 'b' })).status, 400);
    assert.equal((await call('alice', 'POST', '/sites/never-save', { origin: 'https://bank.example/login' })).status, 200);
    assert.deepEqual((await call('alice', 'GET')).data.neverSave, ['https://bank.example']);
    assert.equal((await call('alice', 'DELETE', `/${id}`)).status, 200);
    assert.deepEqual((await call('alice', 'GET')).data.entries, []);
});

test('desktop browser store: tied to the signed-in account, any site, legacy passwords migrate once', async () => {
    let owner = 'alice';
    const removed = [];
    const legacy = { read: async url => url.includes('netcare') ? { username: 'old-user', password: 'old-secret' } : null, remove: async url => { removed.push(url); }, close: async () => {} };
    const store = createVaultCredentials({ vault: vault(), getOwner: async () => owner, legacy });

    assert.equal(await store.save('http://10.1.2.3:8080/login', { username: 'ops', password: 'intranet-pw' }), true);
    assert.deepEqual(await store.read('http://10.1.2.3:8080/'), { username: 'ops', password: 'intranet-pw', autoSubmit: true });
    assert.deepEqual(await store.read('https://netcare.huawei.com/login'), { username: 'old-user', password: 'old-secret', autoSubmit: true });
    assert.deepEqual(removed, ['https://netcare.huawei.com/login']);
    assert.equal((await vault().find('alice', 'https://netcare.huawei.com')).length, 1);

    owner = 'root';
    assert.equal(await store.read('http://10.1.2.3:8080/'), null, 'another account signed in to the desktop app gets nothing');
    owner = null;
    assert.equal(await store.enabled('http://10.1.2.3:8080/'), false);
    assert.equal(await store.save('http://10.1.2.3:8080/', { username: 'x', password: 'y' }), false);
    assert.equal(await store.read('http://10.1.2.3:8080/'), null);

    owner = 'alice';
    assert.equal(await store.toggle('http://10.1.2.3:8080/'), false);
    assert.equal(await store.save('http://10.1.2.3:8080/', { username: 'ops', password: 'new' }), false);
    assert.equal(await store.toggle('http://10.1.2.3:8080/'), true);
    await store.remove('http://10.1.2.3:8080/');
    assert.equal(await store.read('http://10.1.2.3:8080/'), null);

    // 发给网页预加载脚本的只有用户名和密码；条目关闭了自动登录时不自动提交
    const { EventEmitter } = require('node:events');
    const wc = new EventEmitter(), frame = {}, sent = [];
    wc.mainFrame = frame; wc.getURL = () => 'https://netcare.huawei.com/login'; wc.isDestroyed = () => false; wc.send = (_channel, payload) => sent.push(payload);
    const entry = (await vault().find('alice', 'https://netcare.huawei.com'))[0];
    await vault().update('alice', entry.id, { autoSubmit: false });
    attachBrowserLogin(wc, { getStore: () => store, originOf: require('../backend/models/password-vault').originOf });
    wc.emit('ipc-message', { senderFrame: frame }, 'dragon-browser:login', { action: 'probe', document: 'doc-1' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(sent[0].credentials, { username: 'old-user', password: 'old-secret' });
    assert.equal(sent[0].autoSubmit, false);
});
