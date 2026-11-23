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
    assert.deepEqual(bound, { status: 200, data: { success: true, tenantId: 'east', bound: true, cleanedTeamId: 'west' } });
    assert.equal(await tenantsRepo.getTenantById('west').catch(() => null), undefined, '原团队仅 west 一人时绑定走后清理无人使用的团队');
    assert.equal((await call('GET', '/whoami', west.token)).status, 401, '绑定后原会话下线');
    const westAgain = await login('west', 'west-pass-1');
    assert.equal(westAgain.tenantId, 'east');
    const who = (await call('GET', '/whoami', westAgain.token)).data;
    assert.deepEqual([who.tenantId, who.user.isSuper], ['east', false], '进入 east 团队，仍不是超级管理员');

    const users = (await call('GET', '/auth/users', admin)).data;
    const westRow = users.find(u => u.username === 'west');
    assert.deepEqual([westRow.bound, westRow.ownTenantId, westRow.ownTenantActive, westRow.tenantId, westRow.teamName], [true, 'west', false, 'east', 'east 团队']);
    assert.deepEqual(users.find(u => u.username === 'east').teamMembers.sort(), ['east', 'west']);
    assert.ok((await call('GET', '/auth/audit', admin)).data.items.some(item => item.action === 'user_team_bind' && item.target === 'west'));

    // north 也绑进 east（north 原团队被清理）；east 账号被删除时，east 团队还有 west/north 在用，不归档
    assert.equal((await call('PUT', '/auth/users/north/team', admin, { tenantId: 'east' })).status, 200);
    assert.equal(await tenantsRepo.getTenantById('north').catch(() => null), undefined);
    assert.equal((await call('DELETE', '/auth/users/east', admin)).status, 200);
    assert.equal((await tenantsRepo.getTenantById('east')).status, 'active');

    // 解绑：因为 west 原团队曾被清理，解绑回自己团队时会新建空白团队；east 里还有 north，因此 east 仍保留
    const unbound = await call('PUT', '/auth/users/west/team', admin, { tenantId: '' });
    assert.deepEqual(unbound.data, { success: true, tenantId: 'west', bound: false });
    assert.equal((await login('west', 'west-pass-1')).tenantId, 'west');
    assert.equal((await tenantsRepo.getTenantById('west')).status, 'active');
    assert.equal((await tenantsRepo.getTenantById('east')).status, 'active');

    // 换绑最后一位成员 north：换绑到 west 后，east 无人使用也被彻底清理
    const rebindLast = await call('PUT', '/auth/users/north/team', admin, { tenantId: 'west' });
    assert.deepEqual(rebindLast.data, { success: true, tenantId: 'west', bound: true, cleanedTeamId: 'east' });
    assert.equal(await tenantsRepo.getTenantById('east').catch(() => null), undefined, '最后一个使用者换绑离开后清理无人使用的团队');

    // 删除仍绑定在 west 的 north：west 仍有 west 在用，保留；north 已无自属残留空间
    assert.equal((await call('DELETE', '/auth/users/north', admin)).status, 200);
    assert.equal((await tenantsRepo.getTenantById('west')).status, 'active');
});

test('account management truncates long teammate list and confirms data loss before sole-member rebind', async () => {
    const vm = require('node:vm');
    const settingsSrc = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/platform-settings.js'), 'utf8');
    const usersFixture = [
        { username: 'admin', isSuper: true, role: 'admin', tenantId: 'default', ownTenantId: 'default', ownTenantActive: true, bound: false, teamName: '超级管理员空间', teamMembers: ['admin'] },
        { username: 'solo', isSuper: false, role: 'admin', tenantId: 'solo', ownTenantId: 'solo', ownTenantActive: true, bound: false, teamName: 'Solo Team', teamMembers: ['solo'] },
        { username: 'lead', isSuper: false, role: 'admin', tenantId: 'lead', ownTenantId: 'lead', ownTenantActive: true, bound: false, teamName: 'Big Team', teamMembers: ['lead', 'm1', 'm2', 'm3', 'm4', 'm5'] },
        { username: 'm1', isSuper: false, role: 'admin', tenantId: 'lead', ownTenantId: 'm1', ownTenantActive: false, bound: true, teamName: 'Big Team', teamMembers: ['lead', 'm1', 'm2', 'm3', 'm4', 'm5'] },
        { username: 'm2', isSuper: false, role: 'admin', tenantId: 'lead', ownTenantId: 'm2', ownTenantActive: false, bound: true, teamName: 'Big Team', teamMembers: ['lead', 'm1', 'm2', 'm3', 'm4', 'm5'] }
    ];
    const confirms = [];
    const notices = [];
    const apiPuts = [];
    let formValue = { tenantId: 'lead' };
    const content = { innerHTML: '', querySelector() { return null; } };
    const win = { dispatchEvent() {}, addEventListener() {} };
    const ctx = {
        window: win,
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        localStorage: { getItem: k => (k === 'tools_role' ? 'admin' : k === 'tools_tenant_id' ? 'default' : k === 'tools_user' ? 'admin' : null), setItem() {}, removeItem() {} },
        API: {
            get: async url => (url === '/api/auth/users' ? usersFixture : { items: [] }),
            put: async (url, body) => { apiPuts.push({ url, body }); return { success: true }; }
        },
        navState: { lang: 'zh-CN', accountUsers: usersFixture },
        navEscape: s => String(s ?? ''),
        navT: k => k,
        navLocaleText: (zh, en) => zh || en,
        isNavSuperAdmin: () => true,
        renderNavSettingsContent: () => {},
        reloadAuditLogTable: () => {},
        showPlatformFormDialog: async () => formValue,
        showPlatformConfirm: async opts => { confirms.push(opts); return opts._accept !== false; },
        showPlatformNotice: async opts => { notices.push(opts); },
        console
    };
    vm.createContext(ctx);
    vm.runInContext(settingsSrc, ctx);
    for (const k of Object.keys(win)) if (!(k in ctx)) ctx[k] = win[k];

    await ctx.renderAccountSettings(content);
    assert.match(content.innerHTML, /同队：m1、m2/);
    assert.match(content.innerHTML, /等 5 名同队成员/);
    assert.doesNotMatch(content.innerHTML, /同队：[^<]*m5/, 'does not dump all 5 teammate names inline');

    await win.showTeamMembersNotice('lead');
    assert.equal(notices.length, 1);
    assert.match(notices[0].message, /m5/);

    // Solo user rebinding triggers danger confirmation mentioning data loss
    await win.bindUserTeam('solo');
    assert.equal(confirms.length, 1);
    assert.equal(confirms[0].tone, 'danger');
    assert.match(confirms[0].message, /团队数据会永久丢失/);
    assert.equal(apiPuts.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(apiPuts[0])), { url: '/api/auth/users/solo/team', body: { tenantId: 'lead' } });

    // Non-solo team member rebinding skips solo-team data-loss confirmation
    formValue = { tenantId: '' };
    await win.bindUserTeam('m1');
    assert.equal(confirms.length, 1, 'no extra danger confirm when other teammates remain in team');
    assert.equal(apiPuts.length, 2);
});
