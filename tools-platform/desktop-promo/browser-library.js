// 浏览器资料属于本机 Electron 用户配置，与网站 Session 使用相同的本机边界。
// 不接触平台/租户业务库；所有新持久数据只写入传入的 SQLite 文件。
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

function savedUrl(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        url.username = ''; url.password = '';
        for (const key of [...url.searchParams.keys()]) {
            if (/token|password|secret|authorization|api.?key|signature|^code$|^state$/i.test(key)) url.searchParams.delete(key);
        }
        if (/token|password|secret|authorization|api.?key|signature/i.test(url.hash)) url.hash = '';
        return url.toString();
    } catch (_) { return null; }
}

function createBrowserLibrary(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    let db;
    const opened = new Promise((resolve, reject) => {
        db = new sqlite3.Database(filename, error => error ? reject(error) : resolve());
    });
    db.configure('busyTimeout', 5000);
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
    const ready = (async () => {
        await opened;
        await run('CREATE TABLE IF NOT EXISTS browser_bookmarks (url TEXT PRIMARY KEY, title TEXT NOT NULL, saved_at INTEGER NOT NULL)');
        await run('CREATE TABLE IF NOT EXISTS browser_history (url TEXT PRIMARY KEY, title TEXT NOT NULL, visited_at INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 1)');
        await run('CREATE TABLE IF NOT EXISTS browser_downloads (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, state TEXT NOT NULL, received REAL NOT NULL, total REAL NOT NULL, started_at INTEGER NOT NULL)');
        // 下载进程无法跨重启续接，旧的进行中记录明确标记为中断。
        await run("UPDATE browser_downloads SET state = 'interrupted' WHERE state IN ('progressing', 'paused')");
    })();
    ready.catch(() => {});
    return {
        ready,
        async visit(url, title) {
            url = savedUrl(url); if (!url) return;
            await ready;
            await run('INSERT INTO browser_history (url, title, visited_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET title = excluded.title, visited_at = excluded.visited_at, visits = visits + 1', [url, String(title || url).slice(0, 1000), Date.now()]);
            await run('DELETE FROM browser_history WHERE url NOT IN (SELECT url FROM browser_history ORDER BY visited_at DESC LIMIT 2000)');
        },
        async bookmark(url, title, remove = false) {
            url = savedUrl(url); if (!url) return;
            await ready;
            if (remove) await run('DELETE FROM browser_bookmarks WHERE url = ?', [url]);
            else await run('INSERT INTO browser_bookmarks (url, title, saved_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET title = excluded.title', [url, String(title || url).slice(0, 1000), Date.now()]);
        },
        async bookmarks() { await ready; return all('SELECT url, title FROM browser_bookmarks ORDER BY saved_at DESC'); },
        async history() { await ready; return all('SELECT url, title, visited_at AS visitedAt FROM browser_history ORDER BY visited_at DESC LIMIT 200'); },
        async clearHistory() { await ready; await run('DELETE FROM browser_history'); },
        async saveDownload(item) {
            await ready;
            await run('INSERT INTO browser_downloads (id, name, path, state, received, total, started_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, received = excluded.received, total = excluded.total', [item.id, item.name, item.path, item.state, item.received, item.total, item.startedAt]);
            await run('DELETE FROM browser_downloads WHERE id NOT IN (SELECT id FROM browser_downloads ORDER BY started_at DESC LIMIT 200)');
        },
        async downloads() { await ready; return all('SELECT id, name, path, state, received, total, started_at AS startedAt FROM browser_downloads ORDER BY started_at DESC'); },
        async close() { await ready.catch(() => {}); await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
    };
}

module.exports = { createBrowserLibrary, savedUrl };
