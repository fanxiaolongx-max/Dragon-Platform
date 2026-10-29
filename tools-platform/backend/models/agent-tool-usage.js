// Dragon Claw 工具调用次数（租户库 agent_tool_usage），供「全局设置 › 智能体工具」的工具清单显示。
// 由工具循环引擎在每次工具调用后记录；写入失败只记日志，不影响对话。
const { run, all, getDatabase } = require('./app-db');

const readyByDb = new WeakMap();
function ensureReady() {
    const dbKey = getDatabase();
    let initPromise = readyByDb.get(dbKey);
    if (!initPromise) {
        initPromise = run(`CREATE TABLE IF NOT EXISTS agent_tool_usage (
            tool TEXT PRIMARY KEY,
            calls INTEGER NOT NULL DEFAULT 0,
            failures INTEGER NOT NULL DEFAULT 0,
            last_used_at DATETIME
        )`);
        readyByDb.set(dbKey, initPromise);
        initPromise.catch(() => readyByDb.delete(dbKey));
    }
    return initPromise;
}

function record(tool, ok) {
    const name = String(tool || '').slice(0, 100);
    if (!name) return Promise.resolve();
    return ensureReady()
        .then(() => run(`INSERT INTO agent_tool_usage (tool, calls, failures, last_used_at) VALUES (?, 1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(tool) DO UPDATE SET calls = calls + 1, failures = failures + excluded.failures, last_used_at = CURRENT_TIMESTAMP`, [name, ok ? 0 : 1]))
        .catch(error => console.warn('[agent] failed to record tool usage:', error.message || error));
}

async function stats() {
    await ensureReady();
    const rows = await all('SELECT tool, calls, failures, last_used_at AS lastUsedAt FROM agent_tool_usage');
    return new Map(rows.map(row => [row.tool, row]));
}

module.exports = { record, stats };
