// Dragon Claw 工作区：会话更改与撤销快照持久化（租户库 agent_change_snapshots），重启后仍可撤销。
// 每个文件一行：元数据 JSON + 改动前的原始内容（BLOB）。整个会话最多保存 MAX_SESSION_BYTES 的原始内容，
// 超出的文件只保留记录、标记为不可撤销。
const { run, all, getDbPath, getDatabase } = require('./app-db');
const sqlite3 = require('sqlite3');
const { containsSensitiveText } = require('./ai-sensitive-data');

const MAX_SESSION_BYTES = 64 * 1024 * 1024;

// 每个租户是独立的数据库文件：按数据库各建一次表
const readyByDb = new WeakMap();

function ensureReady() {
    const dbKey = getDatabase();
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
            // 按轮检查点：每个文件在某一轮第一次被改之前的状态，供「回退到这一轮之前」
            await run(`
                CREATE TABLE IF NOT EXISTS agent_turn_checkpoints (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_session_id TEXT NOT NULL,
                    owner TEXT NOT NULL DEFAULT '',
                    run_id TEXT NOT NULL,
                    path TEXT NOT NULL,
                    existed INTEGER NOT NULL DEFAULT 0,
                    content BLOB,
                    restorable INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (agent_session_id, run_id, path)
                )
            `);
            await run('CREATE INDEX IF NOT EXISTS idx_agent_turn_checkpoints_session ON agent_turn_checkpoints(agent_session_id, id)');
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
    // 专用连接保证 DELETE + INSERT 属于同一事务，不把其他请求的写入意外包进本次事务。
    const db = await new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(getDbPath(), sqlite3.OPEN_READWRITE, error => error ? reject(error) : resolve(connection));
        connection.configure('busyTimeout', 5000);
    });
    const write = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
    try {
        await write('BEGIN IMMEDIATE');
        const existing = await new Promise((resolve, reject) => db.get('SELECT owner FROM agent_change_snapshots WHERE agent_session_id = ? LIMIT 1', [id], (error, row) => error ? reject(error) : resolve(row)));
        if (existing && existing.owner !== String(owner || '')) throw Object.assign(new Error('无权覆盖该会话的快照'), { code: 'AGENT_SESSION_FORBIDDEN', statusCode: 403 });
        await write('DELETE FROM agent_change_snapshots WHERE agent_session_id = ?', [id]);
        let budget = MAX_SESSION_BYTES;
        for (const record of records || []) {
            let original = record.original || null;
            const meta = { ...record.meta };
            if (original && (original.length > budget || containsSensitiveText(original.toString('utf8')))) {
                original = null;
                meta.originalTooLarge = true;
            }
            if (original) budget -= original.length;
            await write(
                'INSERT INTO agent_change_snapshots (agent_session_id, path, owner, root, meta, original) VALUES (?, ?, ?, ?, ?, ?)',
                [id, String(record.path), String(owner || ''), String(root || ''), JSON.stringify(meta), original]
            );
        }
        await write('COMMIT');
    } catch (error) {
        await write('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
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

// ── 按轮检查点 ───────────────────────────────────────────
/** 追加本轮检查点（同一轮同一文件只记第一次）；内容含凭据或超出会话预算时只记路径、标记不可恢复 */
async function appendCheckpoints({ agentSessionId, owner, items = [] }) {
    if (!items.length) return;
    await ensureReady();
    const id = String(agentSessionId);
    const used = await all('SELECT COALESCE(SUM(LENGTH(content)), 0) AS bytes, MIN(owner) AS owner FROM agent_turn_checkpoints WHERE agent_session_id = ?', [id]);
    if (used[0]?.owner && used[0].owner !== String(owner || '')) throw Object.assign(new Error('无权写入该会话的检查点'), { code: 'AGENT_SESSION_FORBIDDEN', statusCode: 403 });
    let budget = MAX_SESSION_BYTES - Number(used[0]?.bytes || 0);
    for (const item of items) {
        let content = item.existed && item.content ? Buffer.from(item.content) : null;
        let restorable = !item.tooLarge && (!item.existed || Boolean(content));
        if (content && (content.length > budget || containsSensitiveText(content.toString('utf8')))) { content = null; restorable = false; }
        if (content) budget -= content.length;
        await run(`INSERT OR IGNORE INTO agent_turn_checkpoints (agent_session_id, owner, run_id, path, existed, content, restorable) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, String(owner || ''), String(item.runId), String(item.path), item.existed ? 1 : 0, content, restorable ? 1 : 0]);
    }
}

/** 会话里有检查点的轮次：[{ runId, files, paths }]，按时间先后 */
async function listCheckpointRuns(agentSessionId, owner) {
    await ensureReady();
    const rows = await all('SELECT run_id, path, owner, MIN(id) AS first FROM agent_turn_checkpoints WHERE agent_session_id = ? GROUP BY run_id, path ORDER BY first', [String(agentSessionId)]);
    const runs = new Map();
    for (const row of rows) {
        if (row.owner !== String(owner || '')) continue;
        if (!runs.has(row.run_id)) runs.set(row.run_id, { runId: row.run_id, paths: [] });
        runs.get(row.run_id).paths.push(row.path);
    }
    return [...runs.values()].map(item => ({ ...item, files: item.paths.length }));
}

/**
 * 回退到某一轮之前要恢复的文件：这一轮及之后各轮的检查点里，每个文件取最早的一份。
 * @returns {{ fromId, files: [{ path, existed, content, restorable }] } | null}
 */
async function checkpointsFrom(agentSessionId, owner, runId) {
    await ensureReady();
    const id = String(agentSessionId);
    const start = await all('SELECT MIN(id) AS id FROM agent_turn_checkpoints WHERE agent_session_id = ? AND run_id = ? AND owner = ?', [id, String(runId), String(owner || '')]);
    const fromId = start[0]?.id;
    if (!fromId) return null;
    const rows = await all('SELECT path, existed, content, restorable FROM agent_turn_checkpoints WHERE agent_session_id = ? AND id >= ? ORDER BY id', [id, fromId]);
    const files = new Map();
    for (const row of rows) if (!files.has(row.path)) files.set(row.path, { path: row.path, existed: Boolean(row.existed), content: row.content ? Buffer.from(row.content) : null, restorable: Boolean(row.restorable) });
    return { fromId, files: [...files.values()] };
}

/** 回退后删掉这一轮及之后的检查点 */
async function dropCheckpointsFrom(agentSessionId, fromId) {
    await ensureReady();
    await run('DELETE FROM agent_turn_checkpoints WHERE agent_session_id = ? AND id >= ?', [String(agentSessionId), Number(fromId)]);
}

/** 清理 days 天未更新的快照（与转录清理同周期调用） */
async function prune(days = 30) {
    await ensureReady();
    await run(`DELETE FROM agent_change_snapshots WHERE updated_at < datetime('now', ?)`, [`-${Math.max(1, Number(days) || 30)} days`]);
    await run(`DELETE FROM agent_turn_checkpoints WHERE created_at < datetime('now', ?)`, [`-${Math.max(1, Number(days) || 30)} days`]);
}

module.exports = { ensureReady, save, load, prune, appendCheckpoints, listCheckpointRuns, checkpointsFrom, dropCheckpointsFrom, MAX_SESSION_BYTES };
