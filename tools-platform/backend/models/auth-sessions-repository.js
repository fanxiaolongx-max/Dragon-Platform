// 登录会话（控制库 auth_sessions）。active_tenant_id 是本次会话当前所在的团队：
// 普通账号永远是自己的团队；超级管理员进入其他团队排障时临时改成目标团队。
const { run, get, all } = require('./control-db');
const { DEFAULT_TENANT_ID } = require('./tenant-context');
const usersRepo = require('./auth-users-repository');

let initPromise = null;

async function ensureReady() {
    if (!initPromise) {
        initPromise = (async () => {
            await usersRepo.ensureReady();
            await run(`
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    role TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            const columns = new Set((await all('PRAGMA table_info(auth_sessions)')).map(column => column.name));
            if (!columns.has('active_tenant_id')) await run(`ALTER TABLE auth_sessions ADD COLUMN active_tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}'`);
            // 以前删除账号不清会话：启动时清掉已不存在账号的遗留会话
            await run('DELETE FROM auth_sessions WHERE username NOT IN (SELECT username FROM auth_users)');
        })().catch(err => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}

const SESSION_SELECT = `SELECT s.token, s.username, s.role, s.expires_at, s.active_tenant_id,
    u.role AS user_role, u.tenant_id AS home_tenant_id, u.is_super
    FROM auth_sessions s LEFT JOIN auth_users u ON u.username = s.username`;

function sessionFromRow(row) {
    if (!row) return null;
    // 没有对应账号的会话：生产中不会出现（会话只由登录创建，删账号时一并删除，启动时清理遗留），
    // 只来自直接写会话的测试——按单用户时代的语义处理：管理员即超级管理员。
    if (!row.user_role) {
        const tenantId = row.active_tenant_id || DEFAULT_TENANT_ID;
        return { user: { username: row.username, role: row.role, tenantId, homeTenantId: tenantId, isSuper: row.role === 'admin' }, expiresAt: row.expires_at };
    }
    const isSuper = Number(row.is_super) === 1;
    const homeTenantId = row.home_tenant_id || DEFAULT_TENANT_ID;
    // 只有超级管理员可以停留在别的团队；普通账号的会话即使被改过也回到自己的团队
    const tenantId = isSuper ? (row.active_tenant_id || homeTenantId) : homeTenantId;
    return {
        user: { username: row.username, role: row.user_role, tenantId, homeTenantId, isSuper },
        expiresAt: row.expires_at
    };
}

async function listSessions() {
    await ensureReady();
    const rows = await all(SESSION_SELECT);
    const items = {};
    for (const row of rows) {
        const session = sessionFromRow(row);
        if (session) items[row.token] = session;
    }
    return { items, source: 'sqlite' };
}

async function getSession(token) {
    await ensureReady();
    return sessionFromRow(await get(`${SESSION_SELECT} WHERE s.token = ?`, [token]));
}

async function saveSession(token, username, role, expiresAt, tenantId = DEFAULT_TENANT_ID) {
    await ensureReady();
    await run(
        `INSERT OR REPLACE INTO auth_sessions (token, username, role, expires_at, active_tenant_id) VALUES (?, ?, ?, ?, ?)`,
        [token, username, role, expiresAt, tenantId]
    );
}

async function setActiveTenant(token, tenantId) {
    await ensureReady();
    const result = await run('UPDATE auth_sessions SET active_tenant_id=? WHERE token=?', [tenantId, token]);
    return result.changes > 0;
}

async function deleteSession(token) {
    await ensureReady();
    await run('DELETE FROM auth_sessions WHERE token = ?', [token]);
}

async function deleteSessionsForUser(username, { exceptToken = '' } = {}) {
    await ensureReady();
    await run('DELETE FROM auth_sessions WHERE username = ? AND token <> ?', [username, exceptToken]);
}

module.exports = {
    deleteSession,
    deleteSessionsForUser,
    ensureReady,
    getSession,
    listSessions,
    saveSession,
    setActiveTenant
};
