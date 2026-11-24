const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('主线版 platform-audit-repository.getLoginStats 准确统计今日登录与活跃人数', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-audit-stats-'));
    const prevDataDir = process.env.TOOLS_DATA_DIR;
    process.env.TOOLS_DATA_DIR = tmpDir;
    // 清除控制库与审计仓库缓存，确保落到临时库
    for (const mod of ['../backend/models/control-db', '../backend/models/platform-audit-repository']) {
        delete require.cache[require.resolve(mod)];
    }
    try {
        const auditLog = require('../backend/models/platform-audit-repository');
        const req = { headers: { 'user-agent': 'Chrome/120.0' }, ip: '127.0.0.1' };
        await auditLog.record(req, { actor: 'alice', action: 'login' });
        await auditLog.record(req, { actor: 'alice', action: 'login' });
        await auditLog.record(req, { actor: 'bob', action: 'login' });
        await auditLog.record(req, { actor: 'carol', action: 'login_failed', detail: '密码错误' });

        const stats = await auditLog.getLoginStats();
        assert.equal(stats.todayLogins, 3);
        assert.equal(stats.totalLogins, 3);
        assert.equal(stats.todayActiveActors.size, 2);
        assert.equal(stats.todayActiveActors.has('alice'), true);
        assert.equal(stats.todayActiveActors.has('bob'), true);
        assert.equal(stats.todayActiveActors.has('carol'), false, '登录失败不应计入活跃账号');
        assert.equal(stats.weekActiveActors.size, 2);
    } finally {
        if (prevDataDir === undefined) delete process.env.TOOLS_DATA_DIR;
        else process.env.TOOLS_DATA_DIR = prevDataDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('主线版 platform-settings.js 账号列表分页、搜索、角色筛选与小字统计行', async () => {
    const settingsSrc = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/platform-settings.js'), 'utf8');
    const usersFixture = Array.from({ length: 28 }, (_, i) => ({
        username: `member_${String(i + 1).padStart(2, '0')}`,
        role: 'admin',
        isSuper: i < 2,
        tenantId: i < 2 ? 'default' : `member_${String(i + 1).padStart(2, '0')}`,
        ownTenantId: i < 2 ? 'default' : `member_${String(i + 1).padStart(2, '0')}`,
        ownTenantActive: true,
        bound: false,
        teamName: i < 2 ? '超级管理员空间' : `Team ${i + 1}`,
        teamMembers: [`member_${String(i + 1).padStart(2, '0')}`],
        displayName: `Member ${i + 1}`,
    }));
    const statsFixture = {
        totalUsers: 28,
        superAdmins: 2,
        activeSessions: 7,
        todayLogins: 19,
        todayActiveUsers: 9,
        weekActiveUsers: 22,
        totalLogins: 310,
    };

    const makeNode = () => {
        const listeners = {};
        return {
            innerHTML: '',
            value: '',
            addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
            emit(type, ev) { (listeners[type] || []).forEach(fn => fn(ev)); },
            querySelector: () => null,
        };
    };
    const nodes = {
        '#mainAccountRows': makeNode(),
        '#mainAccountPagination': makeNode(),
        '#mainAccountSearch': makeNode(),
        '#mainAccountRoleFilter': makeNode(),
    };
    const content = {
        innerHTML: '',
        querySelector: sel => nodes[sel] || null,
    };
    const win = { dispatchEvent() {}, addEventListener() {}, reloadAuditLogTable() {} };
    const ctx = {
        window: win,
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        localStorage: { getItem: k => (k === 'tools_role' ? 'admin' : k === 'tools_tenant_id' ? 'default' : k === 'tools_user' ? 'member_01' : null), setItem() {}, removeItem() {} },
        API: {
            get: async url => {
                if (url === '/api/auth/users') return usersFixture;
                if (url === '/api/auth/users/stats') return statsFixture;
                return { items: [] };
            }
        },
        navState: { lang: 'zh-CN' },
        navEscape: s => String(s ?? ''),
        navT: k => k,
        navLocaleText: (zh, en) => zh || en,
        isNavSuperAdmin: () => true,
        renderNavSettingsContent: () => {},
        reloadAuditLogTable: () => {},
        console,
    };
    vm.createContext(ctx);
    vm.runInContext(settingsSrc, ctx);
    for (const k of Object.keys(win)) if (!(k in ctx)) ctx[k] = win[k];

    await ctx.renderAccountSettings(content);

    // 1. 首次渲染即包含小字统计与第 1 页（20 条）
    assert.match(content.innerHTML, /注册总数 <strong>28<\/strong>/);
    assert.match(content.innerHTML, /今日活跃 <strong>9<\/strong>/);
    assert.match(content.innerHTML, /今日登录 <strong>19<\/strong> 次/);
    assert.match(content.innerHTML, /7日活跃 <strong>22<\/strong>/);
    assert.match(content.innerHTML, /共 28 条 · 第 1 \/ 2 页/);
    assert.match(content.innerHTML, /member_01/);
    assert.match(content.innerHTML, /member_20/);
    assert.doesNotMatch(content.innerHTML, /member_21/);

    // 2. 翻页至第 2 页 -> 显示剩余 8 条
    nodes['#mainAccountPagination'].emit('click', {
        target: { closest: sel => (sel === '[data-acc-page]' ? { disabled: false, dataset: { accPage: '2' } } : null) }
    });
    assert.equal((nodes['#mainAccountRows'].innerHTML.match(/<tr>/g) || []).length, 8);
    assert.match(nodes['#mainAccountRows'].innerHTML, /member_21/);
    assert.match(nodes['#mainAccountRows'].innerHTML, /member_28/);
    assert.match(nodes['#mainAccountPagination'].innerHTML, /共 28 条 · 第 2 \/ 2 页/);

    // 3. 角色筛选「超级管理员」-> 仅 2 条并重置第 1 页
    nodes['#mainAccountRoleFilter'].emit('change', { target: { value: 'super' } });
    assert.equal((nodes['#mainAccountRows'].innerHTML.match(/<tr>/g) || []).length, 2);
    assert.match(nodes['#mainAccountPagination'].innerHTML, /筛选 2 \/ 共 28 条 · 第 1 \/ 1 页/);

    // 4. 恢复全部角色 + 关键字搜索
    nodes['#mainAccountRoleFilter'].emit('change', { target: { value: 'all' } });
    nodes['#mainAccountSearch'].emit('input', { target: { value: 'Team 25' } });
    assert.equal((nodes['#mainAccountRows'].innerHTML.match(/<tr>/g) || []).length, 1);
    assert.match(nodes['#mainAccountRows'].innerHTML, /member_25/);
});
