// 平台审计日志（控制库 platform_audit_log，与各团队业务库里的 audit_log 无关）：登录、账号增删、密码变更、超级管理员进入/离开团队。只有超级管理员能查看。
const { run, all } = require('./control-db');

const MAX_ROWS = 20000;
let initPromise = null;
let writesSincePrune = 0;

async function ensureReady() {
    if (!initPromise) initPromise = (async () => {
        await run(`CREATE TABLE IF NOT EXISTS platform_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            actor TEXT NOT NULL DEFAULT '',
            action TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT '',
            target TEXT NOT NULL DEFAULT '',
            ip TEXT NOT NULL DEFAULT '',
            detail TEXT NOT NULL DEFAULT ''
        )`);
        await run('CREATE INDEX IF NOT EXISTS idx_platform_audit_log_at ON platform_audit_log(at)');
    })().catch(error => { initPromise = null; throw error; });
    return initPromise;
}

function clientIp(req) {
    return String(req?.socket?.remoteAddress || req?.ip || '').slice(0, 64);
}

/** 记一条审计；失败只打日志，不影响业务 */
async function record(req, { actor, action, tenantId = '', target = '', detail = '' }) {
    try {
        await ensureReady();
        await run('INSERT INTO platform_audit_log (actor, action, tenant_id, target, ip, detail) VALUES (?,?,?,?,?,?)', [
            String(actor || req?.user?.username || ''), String(action), String(tenantId || ''), String(target || ''),
            clientIp(req), typeof detail === 'string' ? detail.slice(0, 1000) : JSON.stringify(detail).slice(0, 1000)
        ]);
        if (++writesSincePrune >= 200) {
            writesSincePrune = 0;
            await run(`DELETE FROM platform_audit_log WHERE id <= (SELECT MAX(id) FROM platform_audit_log) - ?`, [MAX_ROWS]);
        }
    } catch (error) {
        console.warn('[audit] 写审计日志失败：', error.message);
    }
}

async function list({ limit = 200, before = null, actor = '', action = '' } = {}) {
    await ensureReady();
    const where = [];
    const params = [];
    if (before) { where.push('id < ?'); params.push(Number(before)); }
    if (actor) { where.push('actor = ?'); params.push(String(actor)); }
    if (action) { where.push('action = ?'); params.push(String(action)); }
    params.push(Math.min(1000, Math.max(1, Number(limit) || 200)));
    const rows = await all(`SELECT * FROM platform_audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`, params);
    return rows.map(row => ({ id: row.id, at: row.at, actor: row.actor, action: row.action, tenantId: row.tenant_id, target: row.target, ip: row.ip, detail: row.detail }));
}

module.exports = { ensureReady, list, record };
