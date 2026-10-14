// Dragon Claw 工作区：会话更改与撤销快照持久化（租户库 agent_change_snapshots），重启后仍可撤销。
// 每个文件一行：元数据 JSON + 改动前的原始内容（BLOB）。整个会话最多保存 MAX_SESSION_BYTES 的原始内容，
// 超出的文件只保留记录、标记为不可撤销。
const { run, all, getDbPath } = require('./app-db');

const MAX_SESSION_BYTES = 64 * 1024 * 1024;

// 每个租户是独立的数据库文件：按数据库各建一次表
const readyByDb = new Map();

function ensureReady() {
    const dbKey = getDbPath();
    let initPromise = readyByDb.get(dbKey);
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS agent_change_snapshots (
                    agent_session_id TEXT NOT NULL,
                    path TEXT NOT NULL,
                    owner TEXT NOT NULL DEFAULT '',
                    root TEXT NOT NULL DEFAULT '',
                    meta TEXT NOT NULL DEFAULT '{}',
                    original BLOB,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (agent_session_id, path)
                )
            `);
            await run('CREATE INDEX IF NOT EXISTS idx_agent_change_snapshots_updated ON agent_change_snapshots(updated_at)');
        })().catch(error => {
            readyByDb.delete(dbKey);
            throw error;
        });
        readyByDb.set(dbKey, initPromise);
    }
    return initPromise;
}

/** 用当前更改整体替换该会话的记录。records 来自 AgentChangeLog#toRecords()。 */
async function save({ agentSessionId, owner, root, records }) {
    await ensureReady();
    const id = String(agentSessionId);
    await run('DELETE FROM agent_change_snapshots WHERE agent_session_id = ?', [id]);
    let budget = MAX_SESSION_BYTES;
    for (const record of records || []) {
        let original = record.original || null;
        const meta = { ...record.meta };
        if (original && original.length > budget) {
            original = null;
            meta.originalTooLarge = true;
        }
        if (original) budget -= original.length;
        await run(
            'INSERT INTO agent_change_snapshots (agent_session_id, path, owner, root, meta, original) VALUES (?, ?, ?, ?, ?, ?)',
            [id, String(record.path), String(owner || ''), String(root || ''), JSON.stringify(meta), original]
        );
    }
}

/** @returns {Promise<{ owner, root, records } | null>} */
async function load(agentSessionId) {
    await ensureReady();
    const rows = await all('SELECT path, owner, root, meta, original FROM agent_change_snapshots WHERE agent_session_id = ?', [String(agentSessionId || '')]);
    if (!rows.length) return null;
    const records = rows.map(row => {
        let meta = null;
        try { meta = JSON.parse(row.meta || '{}'); } catch (_error) { meta = null; }
        return { path: row.path, meta, original: row.original ? Buffer.from(row.original) : null };
    }).filter(record => record.meta);
    return { owner: rows[0].owner, root: rows[0].root, records };
}

/** 清理 days 天未更新的快照（与转录清理同周期调用） */
async function prune(days = 30) {
    await ensureReady();
    await run(`DELETE FROM agent_change_snapshots WHERE updated_at < datetime('now', ?)`, [`-${Math.max(1, Number(days) || 30)} days`]);
}

module.exports = { ensureReady, save, load, prune, MAX_SESSION_BYTES };
