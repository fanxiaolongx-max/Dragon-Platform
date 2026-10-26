const db = require('../app-db');
const ready = new WeakMap();
const binding = require('./binding');
const defaults = () => ({ enabled: false, owner: '', autoSync: true, syncSeconds: 20, recentLimit: 60, providers: { codex: true, claudecode: true, antigravity: true }, allowSend: true, claudeAutomation: false });
async function ensure() {
    const connection = db.getDatabase();
    if (!ready.has(connection)) {
        const p = (async () => {
            await db.run(`CREATE TABLE IF NOT EXISTS desktop_agent_settings (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, value TEXT NOT NULL)`);
            await db.run(`CREATE TABLE IF NOT EXISTS desktop_agent_deliveries (owner TEXT NOT NULL, request_id TEXT NOT NULL, provider TEXT NOT NULL, session_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, PRIMARY KEY(owner,request_id))`);
        })();
        ready.set(connection, p);
        p.catch(() => ready.delete(connection));
    }
    return ready.get(connection);
}
async function settings() { await ensure(); const row = await db.get('SELECT * FROM desktop_agent_settings WHERE id=1'); return row ? { ...defaults(), ...JSON.parse(row.value), owner: row.owner } : defaults(); }
function error(message, status = 403) { return Object.assign(new Error(message), { status }); }
async function save(owner, patch) {
    const previous = await settings();
    if (previous.owner && previous.owner !== owner)
        throw error('这台桌面的连接已绑定其他平台账号');
    if (!await binding.available(owner))
        throw error('本机桌面对话已绑定其他租户或账号');
    const next = { ...previous, owner, providers: { ...previous.providers } };
    for (const key of ['enabled', 'autoSync', 'allowSend', 'claudeAutomation'])
        if (patch[key] !== undefined) {
            if (typeof patch[key] !== 'boolean')
                throw error('设置值无效', 400);
            next[key] = patch[key];
        }
    for (const [key, min, max] of [['syncSeconds', 10, 300], ['recentLimit', 10, 200]])
        if (patch[key] !== undefined) {
            if (!Number.isInteger(patch[key]) || patch[key] < min || patch[key] > max)
                throw error('刷新间隔或对话数量超出范围', 400);
            next[key] = patch[key];
        }
    if (patch.providers) {
        for (const key of Object.keys(next.providers))
            if (typeof patch.providers[key] === 'boolean')
                next.providers[key] = patch.providers[key];
    }
    if (next.enabled && !await binding.claim(owner))
        throw error('本机桌面对话已绑定其他租户或账号');
    if (!next.enabled)
        next.owner = '';
    await db.run("INSERT INTO desktop_agent_settings(id,owner,value) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,value=excluded.value WHERE owner=? OR owner=''", [next.owner, JSON.stringify(next), owner]);
    if (!next.enabled)
        await binding.release(owner);
    const actual = await settings();
    if (next.enabled ? actual.owner !== owner : actual.enabled)
        throw error('桌面已被其他账号绑定');
    return actual;
}
async function access(owner) { const cfg = await settings(); if (!cfg.enabled)
    throw error('请先在全局设置连接本机桌面 Agent', 409); if (cfg.owner !== owner || !await binding.matches(owner))
    throw error('只能查看和继续本人绑定的桌面对话'); return cfg; }
async function claim(owner, id, provider, session) { await ensure(); const saved = await db.run('INSERT OR IGNORE INTO desktop_agent_deliveries(owner,request_id,provider,session_id,status,created_at) VALUES(?,?,?,?,?,?)', [owner, id, provider, session, 'sending', new Date().toISOString()]); return { claimed: saved.changes > 0, item: await delivery(owner, id) }; }
async function delivery(owner, id) { return db.get('SELECT request_id AS requestId,provider,session_id AS sessionId,status,error,created_at AS createdAt FROM desktop_agent_deliveries WHERE owner=? AND request_id=?', [owner, id]); }
async function settle(owner, id, status, message = '') { await db.run('UPDATE desktop_agent_deliveries SET status=?,error=? WHERE owner=? AND request_id=?', [status, message, owner, id]); return delivery(owner, id); }
module.exports = { defaults, settings, save, access, claim, settle, error };
