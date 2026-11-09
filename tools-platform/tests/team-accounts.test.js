// 一个账号 = 一个团队：控制库迁移、建账号即建团队、登录落到自己的团队、超级管理员边界、密码哈希升级、审计。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'team-accounts-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
fs.mkdirSync(process.env.TOOLS_DATA_DIR, { recursive: true });

const sqlite3 = require('../backend/node_modules/sqlite3');

// 升级前的布局：账号表在默认团队的 tools.db 里，密码是旧 sha256 哈希
const legacySha = password => crypto.createHash('sha256').update(password + 'tools_platform_salt').digest('hex');
async function seedLegacyToolsDb() {
    const db = new sqlite3.Database(path.join(process.env.TOOLS_DATA_DIR, 'tools.db'));
    const exec = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
    await exec(`CREATE TABLE auth_users (username TEXT PRIMARY KEY, role TEXT NOT NULL, password_hash TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO auth_users (username, role, password_hash) VALUES ('admin', 'admin', '${legacySha('admin-pass-1')}');
        CREATE TABLE business_rows (id INTEGER PRIMARY KEY, value TEXT);
        INSERT INTO business_rows (value) VALUES ('keep-me');`);
    await new Promise(resolve => db.close(resolve));
}

test('accounts own isolated teams; only the super admin manages them', async t => {
    await seedLegacyToolsDb();
    const express = require('../backend/node_modules/express');
    const auth = require('../backend/middleware/auth');
    const tenant = require('../backend/models/tenant-context');
    const controlDb = require('../backend/models/control-db');
    const platformDb = require('../backend/models/platform-db');
    const appDb = require('../backend/models/app-db');
    const pool = require('../backend/models/tenant-sqlite-pool');
    const usersRepo = require('../backend/models/auth-users-repository');

    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../backend/routes/auth'));
    app.use('/api', auth.checkAuth, tenant.tenantMiddleware);
    app.use('/api/tenants', require('../backend/routes/tenants'));
    app.use('/api/agent-workspace', require('../backend/routes/agent-workspace'));
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
    const login = async (username, password) => call('POST', '/auth/login', null, { username, password });

    // 旧密码能登录，并被透明升级为 scrypt；控制表已迁出 tools.db，业务数据原样保留
    const adminLogin = await login('admin', 'admin-pass-1');
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
    assert.equal(adminLogin.data.isSuper, true);
    assert.equal(adminLogin.data.tenantId, 'default');
    assert.match((await usersRepo.getUser('admin')).passwordHash, /^scrypt\$/);
    // 旧表保留在 tools.db 里以便回滚，但之后的账号变化只写控制库
    assert.ok(await platformDb.get(`SELECT name FROM sqlite_master WHERE name='auth_users'`), 'legacy table kept for rollback');
    assert.deepEqual(await platformDb.get('SELECT value FROM business_rows'), { value: 'keep-me' });
    assert.ok(fs.readdirSync(path.join(process.env.TOOLS_DATA_DIR, 'backups', 'control-plane-migration')).length >= 1);
    const admin = adminLogin.data.token;

    // 查询串令牌不再被接受
    assert.equal((await fetch(`${base}/whoami?token=${admin}`)).status, 401);

    // 建账号 = 建团队
    assert.equal((await call('POST', '/auth/users', admin, { username: 'east', password: 'short' })).status, 400);
    assert.equal((await call('POST', '/auth/users', admin, { username: 'default', password: 'long-enough-1' })).status, 400);
    const created = await call('POST', '/auth/users', admin, { username: 'East', password: 'east-pass-1', displayName: '华东团队' });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.tenantId, 'east');
    assert.ok(fs.existsSync(tenant.getWorkspaceDir('east')));
    assert.equal((await call('POST', '/auth/users', admin, { username: 'west', password: 'west-pass-1' })).status, 200);
    assert.equal((await platformDb.get(`SELECT COUNT(*) AS count FROM auth_users WHERE username='west'`)).count, 0, 'new accounts never land in the team database');

    const east = (await login('East', 'east-pass-1')).data;
    assert.equal(east.tenantId, 'east');
    assert.equal(east.isSuper, false);
    const eastWho = (await call('GET', '/whoami', east.token)).data;
    assert.equal(eastWho.tenantId, 'east');
    assert.equal(eastWho.user.role, 'admin');

    // 团队管理员碰不到平台级接口，也不能切换团队
    assert.equal((await call('GET', '/auth/users', east.token)).status, 403);
    assert.equal((await call('POST', '/auth/users', east.token, { username: 'x1', password: 'xxxxxxxx1' })).status, 403);
    assert.equal((await call('POST', '/tenants/switch', east.token, { tenantId: 'west' })).status, 403);
    assert.equal((await call('GET', '/auth/audit', east.token)).status, 403);
    assert.equal((await call('GET', '/auth/security/settings', east.token)).status, 403);
    // 即使会话里被写了别的团队，普通账号也回到自己的团队
    await require('../backend/models/auth-sessions-repository').setActiveTenant(east.token, 'west');
    assert.equal((await call('GET', '/whoami', east.token)).data.tenantId, 'east');

    const workspaceApi = '/agent-workspace';
    const eastDirectory = path.join(fs.realpathSync(tenant.getWorkspaceDir('east')), 'East');
    const westDirectory = path.join(fs.realpathSync(tenant.getWorkspaceDir('west')), 'west');
    assert.equal((await call('GET', workspaceApi + '/capability', east.token)).data.canPrepareAccountDirectory, true);
    assert.equal((await call('GET', workspaceApi + '/capability', admin)).data.canPrepareAccountDirectory, false);
    assert.equal((await call('POST', workspaceApi + '/account-directory', admin)).status, 403);
    assert.equal(fs.existsSync(eastDirectory), false);
    const prepared = await Promise.all([1, 2].map(() => call('POST', workspaceApi + '/account-directory', east.token, {
        path: westDirectory, username: 'west', tenantId: 'west'
    })));
    for (const result of prepared) assert.deepEqual(result, { status: 200, data: { directory: eastDirectory } });
    assert.equal(fs.statSync(eastDirectory).isDirectory(), true);
    assert.equal(fs.existsSync(westDirectory), false);
    assert.equal((await call('GET', workspaceApi + '/suggest?input=' + encodeURIComponent(eastDirectory), east.token)).data.isDir, true);
    assert.equal((await call('POST', workspaceApi + '/select', east.token, { path: eastDirectory })).data.root, eastDirectory);
    const west = (await login('west', 'west-pass-1')).data;
    fs.symlinkSync(eastDirectory, westDirectory, 'junction');
    const conflict = await call('POST', workspaceApi + '/account-directory', west.token);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.code, 'ACCOUNT_DIRECTORY_CONFLICT');
    assert.equal(fs.lstatSync(westDirectory).isSymbolicLink(), true);

    // 本人改密码：要当前密码，改完其他会话下线
    const eastSecond = (await login('East', 'east-pass-1')).data.token;
    assert.equal((await call('PUT', '/auth/me/password', east.token, { currentPassword: 'wrong', newPassword: 'east-pass-2' })).status, 400);
    assert.equal((await call('PUT', '/auth/me/password', east.token, { currentPassword: 'east-pass-1', newPassword: 'east-pass-2' })).status, 200);
    assert.equal((await call('GET', '/whoami', eastSecond)).status, 401);
    assert.equal((await call('GET', '/whoami', east.token)).status, 200);
    assert.equal((await login('East', 'east-pass-1')).status, 401);

    // 超级管理员进入团队排障再返回
    assert.equal((await call('POST', '/tenants/switch', admin, { tenantId: 'east' })).status, 200);
    assert.equal((await call('GET', '/whoami', admin)).data.tenantId, 'east');
    const me = (await call('GET', '/auth/me', admin)).data;
    assert.equal(me.viewingTeam.id, 'east');
    assert.equal((await call('POST', '/tenants/switch', admin, { tenantId: 'default' })).status, 200);

    // 删除账号：会话下线、团队归档；purge 彻底删除目录
    assert.equal((await call('DELETE', '/auth/users/admin', admin)).status, 403);
    assert.equal((await call('DELETE', '/auth/users/East', admin)).status, 200);
    assert.equal((await call('GET', '/whoami', east.token)).status, 401);
    assert.ok(fs.existsSync(tenant.getDataDir('east')), 'archived team data is kept');
    assert.equal((await call('POST', '/auth/users', admin, { username: 'east', password: 'east-pass-9' })).status, 409, 'archived team name is reserved');
    assert.equal((await call('DELETE', '/auth/users/west?purge=1', admin)).status, 200);
    assert.equal(fs.existsSync(tenant.getDataDir('west')), false);

    const actions = (await call('GET', '/auth/audit', admin)).data.items.map(item => item.action);
    for (const action of ['login', 'user_create', 'password_change', 'team_enter', 'team_leave', 'user_delete', 'user_delete_purge']) {
        assert.ok(actions.includes(action), `audit has ${action}`);
    }
});
