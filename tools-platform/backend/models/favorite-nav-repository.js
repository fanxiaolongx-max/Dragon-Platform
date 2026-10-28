const { run, all } = require('./app-db');

// 收藏的工具：按租户库、账号保存，position 即用户拖动后的顺序。
const MAX_FAVORITES = 60;

async function ensureTable() {
    await run(`CREATE TABLE IF NOT EXISTS favorite_nav_tools (
        username TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (username, tool_id)
    )`);
}

async function listFavorites(username) {
    await ensureTable();
    const rows = await all('SELECT tool_id FROM favorite_nav_tools WHERE username = ? ORDER BY position LIMIT ?', [username, MAX_FAVORITES]);
    return rows.map(row => row.tool_id);
}

/** 整体替换收藏列表（去重、限长），事务内完成，返回保存后的顺序。 */
async function replaceFavorites(username, ids) {
    await ensureTable();
    const clean = [...new Set(ids.map(String))].slice(0, MAX_FAVORITES);
    await run('BEGIN IMMEDIATE');
    try {
        await run('DELETE FROM favorite_nav_tools WHERE username = ?', [username]);
        for (const [position, id] of clean.entries()) {
            await run('INSERT INTO favorite_nav_tools (username, tool_id, position) VALUES (?, ?, ?)', [username, id, position]);
        }
        await run('COMMIT');
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        throw error;
    }
    return listFavorites(username);
}

module.exports = { listFavorites, replaceFavorites, MAX_FAVORITES };
