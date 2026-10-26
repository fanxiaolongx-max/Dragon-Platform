const crypto = require('crypto');
const { getDatabase, run, get, all } = require('../app-db');
const initialized = new WeakMap();
async function ensureSchema() {
    const db = getDatabase();
    if (!initialized.has(db)) {
        const pending = (async () => {
            await run(`CREATE TABLE IF NOT EXISTS dragon_tac_jobs (
                id TEXT PRIMARY KEY, channel TEXT NOT NULL, conv_kind TEXT NOT NULL, conv_id TEXT NOT NULL,
                actor TEXT NOT NULL, session_id TEXT, url TEXT NOT NULL, instruction TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'awaiting_approval', reports_json TEXT NOT NULL DEFAULT '[]',
                result TEXT, error TEXT, delivery_error TEXT, approved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
            await run('CREATE INDEX IF NOT EXISTS idx_dragon_tac_thread ON dragon_tac_jobs(channel, conv_kind, conv_id, created_at)');
        })();
        initialized.set(db, pending);
        pending.catch(() => initialized.delete(db));
    }
    return initialized.get(db);
}
function item(row) {
    if (!row) return null;
    let reports = []; try { reports = JSON.parse(row.reports_json); } catch { /* legacy/corrupt rows */ }
    return { id: row.id, channel: row.channel, kind: row.conv_kind, conversationId: row.conv_id, actor: row.actor,
        sessionId: row.session_id || '', url: row.url, instruction: row.instruction, status: row.status, reports,
        result: row.result || '', error: row.error || '', deliveryError: row.delivery_error || '',
        approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
async function getJob(id) { await ensureSchema(); return item(await get('SELECT * FROM dragon_tac_jobs WHERE id = ?', [id])); }
async function list({ channel, kind, id, actor } = {}) {
    await ensureSchema();
    return (await all(`SELECT * FROM dragon_tac_jobs WHERE channel = ? AND conv_kind = ? AND conv_id = ? ${actor ? 'AND actor = ?' : ''} ORDER BY created_at DESC LIMIT 30`, [channel, kind, id, ...(actor ? [actor] : [])])).map(item);
}
async function create(ctx, { url, instruction, reports = [] }) {
    await ensureSchema();
    const at = new Date().toISOString();
    const active = await get("SELECT COUNT(*) AS n FROM dragon_tac_jobs WHERE actor = ? AND channel = ? AND status IN ('awaiting_approval','queued','running')", [ctx.actor, ctx.channel]);
    if (active.n >= 3) throw Object.assign(new Error('已有 3 项待处理的 DragonTAC 请求，请先完成或取消'), { code: 'TAC_LIMIT' });
    const id = `tac_${crypto.randomBytes(8).toString('hex')}`;
    await run('INSERT INTO dragon_tac_jobs (id,channel,conv_kind,conv_id,actor,session_id,url,instruction,reports_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, ctx.channel, ctx.conversation.kind, ctx.conversation.id, ctx.actor, ctx.sessionId || '', url, instruction, JSON.stringify(reports), at, at]);
    return getJob(id);
}
async function transition(id, from, to, patch = {}) {
    await ensureSchema();
    const fields = { status: to, updated_at: new Date().toISOString() };
    for (const [key, column] of Object.entries({ reports: 'reports_json', result: 'result', error: 'error', deliveryError: 'delivery_error', approvedAt: 'approved_at' })) {
        if (patch[key] !== undefined) fields[column] = key === 'reports' ? JSON.stringify(patch[key]) : patch[key];
    }
    const states = Array.isArray(from) ? from : [from];
    const result = await run(`UPDATE dragon_tac_jobs SET ${Object.keys(fields).map(key => `${key} = ?`).join(',')} WHERE id = ? AND status IN (${states.map(() => '?').join(',')})`, [...Object.values(fields), id, ...states]);
    return result.changes ? getJob(id) : null;
}
async function interrupted(before = new Date(Date.now() - process.uptime() * 1000).toISOString()) { await ensureSchema(); return (await all("SELECT * FROM dragon_tac_jobs WHERE status IN ('queued','running') AND updated_at < ?", [before])).map(item); }
module.exports = { ensureSchema, getJob, list, create, transition, interrupted };
