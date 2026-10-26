const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const sqlite3 = require('sqlite3');
const { redactText } = require('../ai-sensitive-data');
const home = () => process.env.TOOLS_DESKTOP_AGENT_HOME || os.homedir();
const roots = () => ({ codex: path.join(home(), '.codex'), claude: path.join(home(), 'Library/Application Support/Claude/claude-code-sessions'), projects: [path.join(home(), '.claude/projects'), path.join(home(), '.config/claude/projects')] });
async function entries(folder) { try {
    return (await fs.readdir(folder, { withFileTypes: true })).filter(e => !e.isSymbolicLink());
}
catch {
    return [];
} }
async function json(file, max = 1024 * 1024) { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max)
    throw Error('Invalid local metadata'); return JSON.parse(await fs.readFile(file, 'utf8')); }
function readDb(file, sql, params = []) { return new Promise((resolve, reject) => { const d = new sqlite3.Database(file, sqlite3.OPEN_READONLY, e => { if (e)
    return reject(e); d.all(sql, params, (err, rows) => d.close(() => err ? reject(err) : resolve(rows))); }); }); }
const safe = (text, max = 240) => redactText(String(text || '')).slice(0, max);
async function codex(limit) {
    const base = roots().codex;
    let rows = [];
    for (const file of ['state_5.sqlite', 'sqlite/state_5.sqlite']) {
        try {
            rows = await readDb(path.join(base, file), 'SELECT id,title,updated_at,created_at,rollout_path,cwd,source FROM threads WHERE archived=0 ORDER BY updated_at DESC LIMIT ?', [limit]);
            if (rows.length)
                break;
        }
        catch { /* Another installed schema may not provide these columns. */ }
    }
    let names = new Map();
    try {
        for (const line of (await fs.readFile(path.join(base, 'session_index.jsonl'), 'utf8')).split('\n')) {
            try {
                const item = JSON.parse(line);
                if (item.id && item.thread_name)
                    names.set(item.id, item.thread_name);
            }
            catch { }
        }
    }
    catch { }
    return rows.filter(r => r.source !== 'exec' && !/subagent/i.test(String(r.source))).map(r => ({ id: r.id, provider: 'codex', title: safe(names.get(r.id) || r.title || 'Codex'), updatedAt: new Date(Number(r.updated_at) * 1000).toISOString(), file: r.rollout_path, cwd: r.cwd, source: 'desktop-history' }));
}
async function claude(limit) {
    const result = [], base = roots().claude;
    for (const org of await entries(base)) {
        if (!org.isDirectory())
            continue;
        for (const account of await entries(path.join(base, org.name))) {
            if (!account.isDirectory())
                continue;
            for (const entry of await entries(path.join(base, org.name, account.name))) {
                if (!/^local_[a-f0-9-]+\.json$/i.test(entry.name))
                    continue;
                try {
                    const m = await json(path.join(base, org.name, account.name, entry.name));
                    if (m.isArchived || !m.cliSessionId)
                        continue;
                    result.push({ metadataFile: path.join(base, org.name, account.name, entry.name), id: m.sessionId, nativeId: m.cliSessionId, provider: 'claudecode', title: safe(m.title || 'Claude Code'), updatedAt: new Date(m.lastActivityAt || m.createdAt || 0).toISOString(), cwd: m.cwd, source: 'desktop-history' });
                }
                catch { /* Ignore incomplete app writes. */ }
            }
        }
    }
    return result.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, limit);
}
async function transcript(session) {
    let file = session.file;
    if (session.provider === 'claudecode') {
        for (const root of roots().projects) {
            for (const dir of await entries(root)) {
                if (!dir.isDirectory())
                    continue;
                const candidate = path.join(root, dir.name, session.nativeId + '.jsonl');
                try {
                    await fs.access(candidate);
                    file = candidate;
                    break;
                }
                catch { }
            }
            if (file)
                break;
        }
    }
    if (!file)
        return { items: [], available: false, reason: '桌面客户端尚未提供此会话的本地消息记录' };
    const allowed = session.provider === 'codex' ? [path.join(roots().codex, 'sessions')] : roots().projects;
    const real = await fs.realpath(file), canonical = await Promise.all(allowed.map(root => fs.realpath(root).catch(() => null)));
    if (!canonical.some(root => root && real.startsWith(root + path.sep)))
        throw Error('Transcript outside the desktop history root');
    const h = await fs.open(real, 'r');
    let text;
    try {
        const stat = await h.stat(), size = Math.min(stat.size, 8 * 1024 * 1024), buffer = Buffer.alloc(size);
        await h.read(buffer, 0, size, stat.size - size);
        text = buffer.toString();
        if (stat.size > size)
            text = text.slice(text.indexOf('\n') + 1);
    }
    finally {
        await h.close();
    }
    const items = [];
    for (const line of text.split('\n')) {
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            continue;
        }
        let message, stamp = event.timestamp;
        if (session.provider === 'codex' && event.type === 'response_item' && event.payload?.type === 'message')
            message = event.payload;
        if (session.provider === 'claudecode' && ['user', 'assistant'].includes(event.type) && !event.isSidechain)
            message = event.message;
        if (!message || !['user', 'assistant'].includes(message.role))
            continue;
        if (message.role === 'assistant' && message.channel && !['final', 'commentary'].includes(message.channel))
            continue;
        const content = typeof message.content === 'string' ? message.content : (message.content || []).filter(x => ['text', 'input_text', 'output_text'].includes(x.type)).map(x => x.text).join('\n');
        if (!content || /^<system-reminder>|^# AGENTS\.md instructions|^<environment_context>/.test(content))
            continue;
        items.push({ id: event.uuid || event.payload?.id || String(items.length), role: message.role, content: safe(content, 40000), createdAt: stamp || null });
    }
    return { items: items.slice(-200), available: true };
}
module.exports = { home, roots, entries, json, readDb, safe, codex, claude, transcript };
