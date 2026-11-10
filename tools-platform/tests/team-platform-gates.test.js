// 团队账号在自己团队里是管理员，但碰不到能越出团队的平台级能力：
// 任意 SQL 的数据库浏览、写回项目源码的默认配置、平台推广、工具说明生成、平台共享 MCP 与服务器本机浏览器。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'team-gates-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
process.env.INITIAL_ADMIN_PASSWORD = 'admin-pass-1';
fs.mkdirSync(process.env.TOOLS_DATA_DIR, { recursive: true });

test('team admins cannot reach platform-level capabilities', async t => {
    const express = require('../backend/node_modules/express');
    const auth = require('../backend/middleware/auth');
    const tenant = require('../backend/models/tenant-context');

    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../backend/routes/auth'));
    app.use('/api', auth.checkAuth, tenant.tenantMiddleware);
    app.use('/api/db-explorer', require('../backend/routes/db-explorer'));
    app.use('/api/nav-settings', require('../backend/routes/nav-settings'));
    app.use('/api/platform-promotions', require('../backend/routes/platform-promotions'));
    app.use('/api/agent-mcp', require('../backend/routes/agent-mcp'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await require('../backend/models/tenant-sqlite-pool').closeAll();
        await require('../backend/models/app-db').closeDatabase();
        await require('../backend/models/control-db').closeDatabase();
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
    const admin = (await call('POST', '/auth/login', null, { username: 'admin', password: 'admin-pass-1' })).data.token;
    assert.ok(admin);
    assert.equal((await call('POST', '/auth/users', admin, { username: 'east', password: 'east-pass-1' })).status, 200);
    const east = (await call('POST', '/auth/login', null, { username: 'east', password: 'east-pass-1' })).data.token;

    // 数据探索在平台进程里执行任意 SQL，只给超级管理员
    const attach = { sql: `ATTACH DATABASE '${path.join(process.env.TOOLS_DATA_DIR, 'platform', 'control.db')}' AS ctrl; UPDATE ctrl.auth_users SET is_super = 1 WHERE username = 'east'` };
    assert.equal((await call('GET', '/db-explorer/databases', east)).status, 403);
    assert.equal((await call('POST', '/db-explorer/query', east, attach)).status, 403);
    assert.equal((await call('POST', '/db-explorer/query', admin, attach)).status, 400, 'cross-database statements stay blocked for everyone');
    assert.equal((await require('../backend/models/auth-users-repository').getUser('east')).isSuper, false);
    assert.equal((await call('GET', '/db-explorer/databases', admin)).status, 200);

    // 写回项目源码 / 平台级配置
    assert.equal((await call('POST', '/nav-settings/set-as-default', east, {})).status, 403);
    assert.equal((await call('PUT', '/platform-promotions/defaults', east, { links: [] })).status, 403);
    assert.equal((await call('PUT', '/platform-promotions', east, {})).status, 403);
    assert.equal((await call('GET', '/platform-promotions', east)).status, 200);
    assert.equal((await call('POST', '/agent-mcp/tool-guides/generate', east, { force: true })).status, 403);

    // 共享 MCP 与 WeLink 频道推送运行在团队沙箱/空间之外：团队默认用不了，超级管理员按组开启后才可用。
    // 浏览器对团队默认开放——团队的浏览器进程在沙箱里、只能经出口代理上网。
    const access = require('../backend/models/agent-tool-access');
    const catalog = require('../backend/models/agent-tool-catalog');
    const team = { username: 'east', role: 'admin', isSuper: false, tenantId: 'east' };
    const names = ['mcp__demo__echo', 'browser_navigate', 'welink_send_message'];
    const allowedFor = async (user, owner) => { const allowed = await access.forActor(user, owner); return names.filter(name => allowed(name)); };
    assert.deepEqual(await tenant.runWithTenant('east', () => allowedFor(team)), ['browser_navigate']);
    assert.deepEqual(await tenant.runWithTenant('east', () => allowedFor(null, 'east::east')), ['browser_navigate'], 'background runs resolve the owner');
    assert.deepEqual(await allowedFor({ username: 'admin', role: 'admin', isSuper: true, tenantId: 'default' }), names);
    assert.equal((await tenant.runWithTenant('east', () => access.forActor(team)))('read_file'), true, 'other tools stay available');

    // 工具清单中，团队账号在未开放时不展示 WeLink 频道消息工具
    const teamCatalog = await tenant.runWithTenant('east', () => catalog.build({ user: team }));
    assert.equal(teamCatalog.groups.find(group => group.id === 'welink-channel'), undefined);

    await access.setAccess('group', 'mcp', true);
    await access.setAccess('group', 'welink-channel', true);
    assert.deepEqual(await tenant.runWithTenant('east', () => allowedFor(team)), names);
    await access.setAccess('group', 'mcp', false);
    await access.setAccess('group', 'welink-channel', false);
    await access.setAccess('group', 'browser', false);
    assert.deepEqual(await tenant.runWithTenant('east', () => allowedFor(team)), [], 'the super admin can still switch the browser off');
    await access.setAccess('group', 'browser', true);
    // 超级管理员空间里的其他账号、频道对话不受默认关闭影响
    assert.deepEqual(await allowedFor({ username: 'ops', role: 'viewer', isSuper: false, tenantId: 'default' }), names);
});
