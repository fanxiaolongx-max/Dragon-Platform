// 账号绑定团队：超级管理员把账号绑到另一个账号的团队（共用该团队的数据），解绑回到自己的团队；
// 不能绑进超级管理员空间、不能绑超级管理员；团队管理员无权操作；还有人绑定着的团队删账号时不归档。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'team-binding-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
process.env.INITIAL_ADMIN_PASSWORD = 'admin-pass-1';
fs.mkdirSync(process.env.TOOLS_DATA_DIR, { recursive: true });

test('super admin binds accounts into another team and unbinds them', async t => {
    const express = require('../backend/node_modules/express');
    const auth = require('../backend/middleware/auth');
    const tenant = require('../backend/models/tenant-context');
    const controlDb = require('../backend/models/control-db');
    const platformDb = require('../backend/models/platform-db');
    const appDb = require('../backend/models/app-db');
    const pool = require('../backend/models/tenant-sqlite-pool');
    const tenantsRepo = require('../backend/models/tenants-repository');

    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../backend/routes/auth'));
    app.use('/api', auth.checkAuth, tenant.tenantMiddleware);
    app.get('/api/whoami', (req, res) => res.json({ user: req.user, tenantId: tenant.getTenantId() }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await pool.closeAll();
        await appDb.closeDatabase();
        await platformDb.closeDatabase();
        await controlDb.closeDatabase();
        fs.rmSync(temp, { recursive: true, force: true });
    });
    const call = async (method, url, token, body) => {
        const response = await fetch(base + url, {
            method,
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
        return { status: response.status, data: await response.json().catch(() => ({})) };
    };
    const login = async (username, password) => (await call('POST', '/auth/login', null, { username, password })).data;

    const admin = (await login('admin', 'admin-pass-1')).token;
    assert.ok(admin);
    for (const name of ['east', 'west', 'north']) assert.equal((await call('POST', '/auth/users', admin, { username: name, password: `${name}-pass-1`, displayName: `${name} 团队` })).status, 200);

    const west = await login('west', 'west-pass-1');
    assert.equal((await call('GET', '/whoami', west.token)).data.tenantId, 'west');

    // 只有超级管理员能绑；不能绑进超级管理员空间、不能绑超级管理员、团队要存在
    assert.equal((await call('PUT', '/auth/users/west/team', west.token, { tenantId: 'east' })).status, 403);
    assert.equal((await call('PUT', '/auth/users/west/team', admin, { tenantId: 'default' })).status, 403);
    assert.equal((await call('PUT', '/auth/users/admin/team', admin, { tenantId: 'east' })).status, 403);
    assert.equal((await call('PUT', '/auth/users/west/team', admin, { tenantId: 'nope' })).status, 404);

    const bound = await call('PUT', '/auth/users/west/team', admin, { tenantId: 'east' });
    assert.deepEqual(bound, { status: 200, data: { success: true, tenantId: 'east', bound: true } });
    assert.equal((await call('GET', '/whoami', west.token)).status, 401, '绑定后原会话下线');
    const westAgain = await login('west', 'west-pass-1');
    assert.equal(westAgain.tenantId, 'east');
    const who = (await call('GET', '/whoami', westAgain.token)).data;
    assert.deepEqual([who.tenantId, who.user.isSuper], ['east', false], '进入 east 团队，仍不是超级管理员');

    const users = (await call('GET', '/auth/users', admin)).data;
    const westRow = users.find(u => u.username === 'west');
    assert.deepEqual([westRow.bound, westRow.ownTenantId, westRow.tenantId, westRow.teamName], [true, 'west', 'east', 'east 团队']);
    assert.deepEqual(users.find(u => u.username === 'east').teamMembers.sort(), ['east', 'west']);
    assert.ok((await call('GET', '/auth/audit', admin)).data.items.some(item => item.action === 'user_team_bind' && item.target === 'west'));

    // north 也绑进 east；east 账号被删除时，团队空间还有人在用，不归档
    assert.equal((await call('PUT', '/auth/users/north/team', admin, { tenantId: 'east' })).status, 200);
    assert.equal((await call('DELETE', '/auth/users/east', admin)).status, 200);
    assert.equal((await tenantsRepo.getTenantById('east')).status, 'active');

    // 解绑：回到自己的团队，原来的团队空间一直保留
    const unbound = await call('PUT', '/auth/users/west/team', admin, { tenantId: '' });
    assert.deepEqual(unbound.data, { success: true, tenantId: 'west', bound: false });
    assert.equal((await login('west', 'west-pass-1')).tenantId, 'west');
    assert.equal((await tenantsRepo.getTenantById('west')).status, 'active');
    // 被绑定的账号删除时，归档的是它自己的团队，而不是它所在的团队
    assert.equal((await call('DELETE', '/auth/users/north', admin)).status, 200);
    assert.equal((await tenantsRepo.getTenantById('north')).status, 'archived');
    assert.equal((await tenantsRepo.getTenantById('east')).status, 'archived', '最后一个使用者走了才归档');
});
