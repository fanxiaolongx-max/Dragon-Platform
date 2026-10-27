const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const sqlite3 = require('sqlite3');
const { redactText } = require('../ai-sensitive-data');
const home = () => process.env.TOOLS_DESKTOP_AGENT_HOME || os.homedir();
const roots = () => ({
    codex: path.join(home(), '.codex'),
    claude: path.join(home(), 'Library/Application Support/Claude/claude-code-sessions'),
    projects: [path.join(home(), '.claude/projects'), path.join(home(), '.config/claude/projects')],
    antigravityDb: process.env.ANTIGRAVITY_APP_DATA_DIR
        ? path.join(process.env.ANTIGRAVITY_APP_DATA_DIR, 'conversation_summaries.db')
        : path.join(home(), '.gemini/antigravity/conversation_summaries.db')
});
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
// 桌面客户端会把附件清单、问答回执、频道唤醒、系统提醒等包进用户消息；这里还原成用户在客户端里实际看到的文字。
const HIDDEN_USER = /^(?:<(?:system-reminder|environment_context|user_instructions|external_codex_apps_open_page|recommended_plugins|in-app-browser-context|task-notification|local-command-caveat|local-command-stdout|local-command-stderr|turn_aborted|user_shell_command)\b|# AGENTS\.md instructions)/;
const unescapeXml = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function userText(raw) {
    const original = String(raw || '');
    let text = original.replace(/<(system-reminder|in-app-browser-context|environment_context)\b[\s\S]*?<\/\1>/g, '');
    if (!text.trim() || HIDDEN_USER.test(text.trim()))
        return '';
    const command = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
    if (command)
        return [command[1], text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]].map(x => (x || '').trim()).filter(Boolean).join(' ');
    const reply = text.match(/<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/);
    if (reply) {
        try {
            return JSON.parse(reply[1]).map(a => String(a.answer ?? '').trim()).filter(Boolean).join('\n');
        }
        catch { /* Unknown receipt shape: fall through to the raw text. */ }
    }
    if (/^\s*<(?:wake|project_claude_message|relay)\b/.test(text)) {
        const bodies = [...text.matchAll(/<message\b[^>]*>([\s\S]*?)<\/message>/g)].map(m => m[1]);
        return unescapeXml((bodies.length ? bodies : [...text.matchAll(/<note>([\s\S]*?)<\/note>/g)].map(m => m[1])).map(x => x.trim()).join('\n\n'));
    }
    const request = text.match(/(?:^|\n)## My request:\n/);
    if (request && /^\s*# (?:Files|Applications) mentioned by the user:/.test(text))
        text = text.slice(request.index + request[0].length);
    text = text.replace(/<image name=\[Image #(\d+)\][^>]*>\s*<\/image>/g, '[图片 #$1]').replace(/\[Image: source: [^\]\n]*\]/g, '[图片]').replace(/<\/?pasted_content\b[^>]*>/g, '');
    return text === original ? original : text.trim();
}
const SETTLED = ['end_turn', 'stop_sequence', 'max_tokens', 'refusal'];
const STALE_MS = 20 * 60 * 1000; // 客户端崩溃时日志停在半轮：太久没有新事件就不再当作运行中
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
    // 运行状态：Codex 看 task_started / task_complete，Claude 看最后一条消息是否已 end_turn
    // Claude 写出 end_turn 后桌面还要跑结束钩子，等 stop_hook_summary 才算结束（没有钩子的会话最多再等 60 秒）
    let busySince = null, lastStamp = null, settling = null;
    for (const line of text.split('\n')) {
        let event;
        try {
            event = JSON.parse(line);
        }
        catch {
            continue;
        }
        let message, stamp = event.timestamp;
        if (stamp)
            lastStamp = stamp;
        if (session.provider === 'codex' && event.type === 'event_msg') {
            if (event.payload?.type === 'task_started')
                busySince = stamp || new Date().toISOString();
            if (['task_complete', 'turn_aborted'].includes(event.payload?.type))
                busySince = null;
        }
        if (session.provider === 'codex' && event.type === 'response_item' && event.payload?.type === 'message')
            message = event.payload;
        if (session.provider === 'claudecode' && event.type === 'system' && event.subtype === 'stop_hook_summary' && !event.isSidechain) {
            busySince = null;
            settling = null;
        }
        if (session.provider === 'claudecode' && ['user', 'assistant'].includes(event.type) && !event.isSidechain) {
            message = event.message;
            settling = null;
            if (event.type === 'assistant') {
                busySince = busySince || stamp;
                if (SETTLED.includes(message?.stop_reason))
                    settling = stamp || new Date().toISOString();
            }
            else if (!event.isMeta) {
                const prompt = typeof message?.content === 'string' || (message?.content || []).some(x => x.type === 'text');
                const said = typeof message?.content === 'string' ? message.content : (message?.content || []).find(x => x.type === 'text')?.text || '';
                if (/^\[Request interrupted/.test(said)) {
                    busySince = null;
                    settling = null;
                }
                else if (prompt)
                    busySince = stamp || new Date().toISOString();
                else
                    busySince = busySince || stamp;
            }
            if (event.isMeta || event.isCompactSummary)
                continue;
        }
        if (!message || !['user', 'assistant'].includes(message.role))
            continue;
        if (message.role === 'assistant' && message.channel && !['final', 'commentary'].includes(message.channel))
            continue;
        const raw = typeof message.content === 'string' ? message.content : (message.content || []).filter(x => ['text', 'input_text', 'output_text'].includes(x.type)).map(x => x.text).join('\n');
        const content = message.role === 'user' ? userText(raw) : raw;
        if (!content || /^\[Request interrupted/.test(content))
            continue;
        items.push({ id: event.uuid || event.payload?.id || String(items.length), role: message.role, content: safe(content, 40000), channel: message.channel || null, createdAt: stamp || null });
    }
    const busy = Boolean(busySince) && Date.now() - Date.parse(lastStamp || busySince) < STALE_MS && !(settling && Date.now() - Date.parse(settling) > 60000);
    return { items: items.slice(-200), available: true, busy, busySince: busy ? busySince : null };
}
async function antigravityTimestamps(ids = []) {
    const file = roots().antigravityDb;
    try {
        let sql = 'SELECT conversation_id, last_modified_time, last_user_input_time FROM conversation_summaries';
        let params = [];
        if (Array.isArray(ids) && ids.length > 0) {
            sql += ' WHERE conversation_id IN (' + ids.map(() => '?').join(',') + ')';
            params = ids;
        }
        const rows = await readDb(file, sql, params);
        const map = new Map();
        for (const r of rows) {
            if (!r.conversation_id) continue;
            const raw = r.last_modified_time || r.last_user_input_time;
            if (!raw) continue;
            const parsed = Date.parse(raw);
            if (!Number.isNaN(parsed)) {
                map.set(r.conversation_id, new Date(parsed).toISOString());
            }
        }
        return map;
    } catch {
        return new Map();
    }
}
module.exports = { home, roots, entries, json, readDb, safe, userText, codex, claude, transcript, antigravityTimestamps };
