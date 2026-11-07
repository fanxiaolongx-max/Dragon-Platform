const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const sqlite3 = require('sqlite3');
const { redactText } = require('../ai-sensitive-data');
const home = () => process.env.TOOLS_DESKTOP_AGENT_HOME || os.homedir();
const roots = () => ({
    codex: path.join(home(), '.codex'),
    claude: path.join(home(), 'Library/Application Support/Claude/claude-code-sessions'),
    projects: [path.join(home(), '.claude/projects'), path.join(home(), '.config/claude/projects')],
    antigravity: process.env.ANTIGRAVITY_APP_DATA_DIR
        ? process.env.ANTIGRAVITY_APP_DATA_DIR.trim()
        : path.join(home(), '.gemini/antigravity'),
    antigravityDb: process.env.ANTIGRAVITY_APP_DATA_DIR
        ? path.join(process.env.ANTIGRAVITY_APP_DATA_DIR.trim(), 'conversation_summaries.db')
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
// 只提取客户端明确标注的附件；不把普通消息里的任意路径当附件。
// 文件内容继续由 agent-files 的登录、租户和敏感文件门禁校验。
async function messageAttachments(message, raw, inlineImages = false) {
    const files = new Map();
    const add = value => {
        if (typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value)) return;
        let file = unescapeXml(value);
        if (file.startsWith('file://')) {
            try { file = require('node:url').fileURLToPath(file); } catch { return; }
        }
        if (!path.isAbsolute(file) && !file.startsWith('~/')) return;
        if (!files.has(file) && files.size < 30) files.set(file, { path: file, name: path.basename(file) });
    };
    for (const match of raw.matchAll(/<image\b[^>]*\bpath="([^"]+)"[^>]*>/g)) add(match[1]);
    for (const match of raw.matchAll(/\[Image: source: ([^\]\n]+)\]/g)) add(match[1]);
    // Codex 的文件清单位于用户请求之前；正文里相同格式的文本不解析。
    const header = raw.match(/^\s*# Files mentioned by the user:([\s\S]*?)\n## My request:\n/);
    if (header) for (const match of header[1].matchAll(/^## [^\n]+: ((?:\/|~\/)[^\n]+)$/gm)) add(match[1]);
    for (const block of Array.isArray(message.content) ? message.content : []) {
        if (['local_image', 'input_image', 'image', 'document', 'file'].includes(block.type)) {
            add(block.path || block.image_url || block.source?.path || (block.source?.type === 'file' ? block.source.file_path : null));
            if (inlineImages && block.type === 'image' && files.size < 30) {
                try { add(await require('./inline-images').materialize(block.source)); }
                catch { /* A cache failure must not hide the conversation text. */ }
            }
        }
    }
    return [...files.values()];
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
async function transcriptFile(session) {
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
    return file || null;
}
async function transcript(session) {
    const file = await transcriptFile(session);
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
    // 每轮模型调用的实报 token；日志边界耗时不是实际解码耗时，不能用于生成速度。
    // Claude 按 API 消息 id 归并（用量在 message.usage），Codex 用 token_count 事件；耗时取「上一个边界事件 → 本次调用最后写入」的时间差，是近似值。
    // 一次提问内的所有调用挂到这一问最后一条可见回复上（item.rounds）。
    let boundary = null, codexModel = '', codexTotal = null, codexRecords = false, turnRounds = [], lastAssistant = -1;
    const claudeCalls = new Map(), performanceTurns=[],turnStarts=new Map();
    let activeTurnId=null,codexCallHasTools=false;
    const finishTurn = () => {
        if (lastAssistant >= 0 && turnRounds.length) items[lastAssistant].rounds = turnRounds.map((round, i) => {
            const ms = Math.max(1, Date.parse(round.end) - Date.parse(round.start || round.end));
            return { index: i + 1, model: round.model, requestId:round.requestId||null, providerRequestId:round.providerRequestId||null, turnId:round.turnId||null, usageSource:round.usageSource||session.provider,
                inputTokens:round.inputTokens,outputTokens:round.outputTokens,cachedInputTokens:round.cachedInputTokens??null,reasoningOutputTokens:round.reasoningOutputTokens??null,outputHasTools:round.outputHasTools??null,
                estimated:false,timingEstimated:true,timingSource:'log-boundary',ms:Number.isFinite(ms)?ms:null,ttftMs:null,generationMs:null,tps:null,at:round.start||round.end };
        }).filter(round => round.outputTokens > 0 || round.inputTokens > 0);
        turnRounds = [];
        lastAssistant = -1;
    };
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
        if (stamp && !event.isSidechain) {
            if (session.provider === 'claudecode' && event.type === 'assistant' && event.message?.id && event.message?.usage) {
                const usage = event.message.usage;
                let call = claudeCalls.get(event.message.id);
                if (!call) {
                    call = { start: boundary || stamp, model: event.message.model || '',requestId:event.message.id,providerRequestId:event.requestId||null,usageSource:'claude-message-usage' };
                    claudeCalls.set(event.message.id, call);
                    turnRounds.push(call);
                }
                call.end = stamp;
                call.outputTokens = Number(usage.output_tokens) || 0;
                call.inputTokens = (Number(usage.input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0);
                call.cachedInputTokens=typeof usage.cache_read_input_tokens==='number'?usage.cache_read_input_tokens:null;
                boundary = stamp;
            }
            else if (session.provider === 'claudecode' && event.type === 'user' && !event.isMeta) {
                const content = event.message?.content;
                if (typeof content === 'string' || (content || []).some(x => x.type === 'text')) finishTurn();
                boundary = stamp;
            }
            else if (session.provider === 'codex') {
                const payload = event.payload || {};
                if(event.type==='response_item'&&['function_call','custom_tool_call'].includes(payload.type))codexCallHasTools=true;
                if (event.type === 'turn_context' && payload.model) codexModel = payload.model;
                if (event.type === 'event_msg' && payload.type === 'task_started') { finishTurn(); boundary = stamp;activeTurnId=payload.turn_id||null;if(activeTurnId)turnStarts.set(activeTurnId,stamp); }
                // 新版 Codex：每次模型调用结束写 token_usage_record（用量即本次调用）；旧版只有 token_count（在工具执行后才写，耗时偏长，且可能重复）
                else if (event.type === 'token_usage_record' && payload.usage) {
                    codexRecords = true;
                    turnRounds = turnRounds.filter(round => !round.fromCount);
                    turnRounds.push({ start: boundary || stamp, end: stamp, model: codexModel,requestId:payload.response_id||null,turnId:payload.turn_id||activeTurnId,usageSource:'codex-token-usage-record',outputHasTools:codexCallHasTools,cachedInputTokens:payload.usage.cached_input_tokens??null,reasoningOutputTokens:payload.usage.reasoning_output_tokens??null,outputTokens:Number(payload.usage.output_tokens)||0,inputTokens:Number(payload.usage.input_tokens)||0 });
                    codexCallHasTools=false;
                    boundary = stamp;
                }
                else if (!codexRecords && event.type === 'event_msg' && payload.type === 'token_count' && payload.info?.last_token_usage && payload.info.total_token_usage?.total_tokens !== codexTotal) {
                    codexTotal = payload.info.total_token_usage?.total_tokens;
                    const usage = payload.info.last_token_usage;
                    turnRounds.push({ start: boundary || stamp, end: stamp, model: codexModel, outputTokens: Number(usage.output_tokens) || 0, inputTokens: Number(usage.input_tokens) || 0,cachedInputTokens:usage.cached_input_tokens??null,reasoningOutputTokens:usage.reasoning_output_tokens??null,turnId:activeTurnId,usageSource:'codex-token-count',fromCount:true });
                    boundary = stamp;
                }
                else if (event.type === 'response_item' && (['function_call_output', 'custom_tool_call_output'].includes(payload.type) || (payload.type === 'message' && payload.role === 'user'))) boundary = stamp;
            }
        }
        if (session.provider === 'codex' && event.type === 'event_msg') {
            if (event.payload?.type === 'task_started')
                busySince = stamp || new Date().toISOString();
            if(event.payload?.type==='task_complete'){const p=event.payload,id=p.turn_id;if(id)performanceTurns.push({id,startedAt:turnStarts.get(id)||p.started_at||null,endedAt:p.completed_at||stamp,durationMs:typeof p.duration_ms==='number'?p.duration_ms:null,usageComplete:turnStarts.has(id),ttftMs:typeof p.time_to_first_token_ms==='number'?p.time_to_first_token_ms:null,source:'codex-task-complete'});}
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
        let content = message.role === 'user' ? userText(raw) : raw;
        const attachments = await messageAttachments(message, raw, session.provider === 'claudecode');
        if (attachments.length && content) content = content.replace(/\[图片(?: #\d+)?\]/g, '').trim();
        if ((!content && !attachments.length) || (!content && raw && !userText(raw)) || /^\[Request interrupted/.test(content))
            continue;
        items.push({ id: event.uuid || event.payload?.id || String(items.length), role: message.role, content: safe(content, 40000), ...(attachments.length ? { attachments } : {}), channel: message.channel || null, createdAt: stamp || null });
        if (message.role === 'assistant')
            lastAssistant = items.length - 1;
    }
    finishTurn();
    const busy = Boolean(busySince) && Date.now() - Date.parse(lastStamp || busySince) < STALE_MS && !(settling && Date.now() - Date.parse(settling) > 60000);
    // Keep explicit turn latency alongside that reply's usage for the footer; never use it as per-request decode time.
    for (const item of items) {
        const round = item.rounds?.[0];
        if (!round) continue;
        const turn = performanceTurns.find(t => t.id === round.turnId);
        if (typeof turn?.ttftMs === 'number') round.turnTtftMs = turn.ttftMs;
    }
    return { items: items.slice(-200),performanceTurns, available: true, busy, busySince: busy ? busySince : null };
}
// 会话列表的「运行中」标记：只看最近有活动的会话，按记录文件的修改时间与大小缓存，文件没变就不重读
const busyCache = new Map();
async function busyState(session) {
    const id = `${session.provider}:${session.id}`;
    try {
        const cached = busyCache.get(id);
        const file = cached?.file || await transcriptFile(session);
        if (!file)
            return false;
        const stat = await fs.stat(file), stamp = `${stat.mtimeMs}:${stat.size}`;
        // 超过 STALE_MS 没写入：transcript() 也会判为已停止，不必再读
        if (Date.now() - stat.mtimeMs >= STALE_MS) {
            busyCache.set(id, { file, stamp, busy: false, at: Date.now() });
            return false;
        }
        // 文件没变：空闲直接沿用；运行中每 30 秒复核一次（Claude 无结束钩子时 end_turn 后 60 秒才算结束）
        if (cached && cached.stamp === stamp && (!cached.busy || Date.now() - cached.at < 30000))
            return cached.busy;
        const { busy } = await transcript({ ...session, file });
        busyCache.set(id, { file, stamp, busy, at: Date.now() });
        if (busyCache.size > 200)
            busyCache.delete(busyCache.keys().next().value);
        return busy;
    }
    catch {
        busyCache.delete(id);
        return false;
    }
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
function parseWorkspaceCwd(raw) {
    if (!raw || typeof raw !== 'string') return '';
    try {
        const list = JSON.parse(raw);
        const first = Array.isArray(list) ? list[0] : '';
        if (typeof first === 'string' && first.startsWith('file://')) return require('node:url').fileURLToPath(first);
    } catch { }
    return '';
}
// Antigravity 本地会话索引库（~/.gemini/antigravity/conversation_summaries.db）：直接毫秒级读取会话列表，无需通过 CDP 遍历桌面 DOM
async function antigravity(limit) {
    const file = roots().antigravityDb;
    try {
        const rows = await readDb(file,
            `SELECT conversation_id, title, preview, last_modified_time, last_user_input_time, workspace_uris, status, not_fully_idle
             FROM conversation_summaries
             WHERE COALESCE(parent_conversation_id, '') = '' AND COALESCE(killed, 0) = 0
             ORDER BY COALESCE(last_modified_time, last_user_input_time) DESC
             LIMIT ?`, [limit]);
        const now = new Date().toISOString();
        return rows.filter(r => typeof r.conversation_id === 'string' && /^[a-f0-9-]{36}$/i.test(r.conversation_id) && (r.title || r.preview)).map((r, i) => {
            const rawTime = r.last_modified_time || r.last_user_input_time;
            const parsed = rawTime ? Date.parse(rawTime) : NaN;
            return {
                id: r.conversation_id,
                provider: 'antigravity',
                title: safe(r.title || r.preview || 'Antigravity'),
                updatedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
                observedAt: now,
                order: i,
                cwd: parseWorkspaceCwd(r.workspace_uris),
                source: 'desktop-history'
            };
        });
    } catch {
        return [];
    }
}
async function antigravityBusyIds() {
    const file = roots().antigravityDb;
    try {
        const rows = await readDb(file,
            `SELECT conversation_id, last_modified_time, last_user_input_time
             FROM conversation_summaries
             WHERE COALESCE(parent_conversation_id, '') = '' AND COALESCE(killed, 0) = 0
               AND (status = 'CASCADE_RUN_STATUS_RUNNING' OR COALESCE(not_fully_idle, 0) != 0)`);
        const ids = new Set();
        for (const r of rows) {
            if (!r.conversation_id || !/^[a-f0-9-]{36}$/i.test(r.conversation_id)) continue;
            const raw = r.last_modified_time || r.last_user_input_time;
            const ts = raw ? Date.parse(raw) : NaN;
            if (Number.isNaN(ts) || Date.now() - ts < STALE_MS) ids.add(r.conversation_id);
        }
        return ids;
    } catch {
        return null;
    }
}
async function antigravityTranscriptFile(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return null;
    const base = roots().antigravity;
    const logsDir = path.join(base, 'brain', id, '.system_generated/logs');
    for (const name of ['transcript_full.jsonl', 'transcript.jsonl']) {
        const candidate = path.join(logsDir, name);
        try {
            const stat = await fs.lstat(candidate);
            if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
        } catch { }
    }
    return null;
}
function antigravityUserText(raw) {
    const text = String(raw || '');
    const reqMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
    if (reqMatch) return reqMatch[1].trim();
    const cleaned = text.replace(/<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)\b[\s\S]*?<\/\1>/g, '').trim();
    return userText(cleaned);
}
// Antigravity 本地消息记录（brain/<id>/.system_generated/logs/transcript_full.jsonl）：
// 直接读取本地 JSONL，聚合每轮模型调用的 input/output tokens、耗时、tok/s 与模型名，不再依赖 CDP 切换桌面窗口和解析 DOM。
async function antigravityTranscript(sessionOrId) {
    const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.id;
    const file = await antigravityTranscriptFile(id);
    if (!file) return null;
    const baseRoot = await fs.realpath(roots().antigravity).catch(() => null);
    const real = await fs.realpath(file).catch(() => null);
    if (!baseRoot || !real || !real.startsWith(baseRoot + path.sep)) return null;
    const h = await fs.open(real, 'r');
    let text, mtimeMs = 0;
    try {
        const stat = await h.stat();
        mtimeMs = stat.mtimeMs;
        const size = Math.min(stat.size, 16 * 1024 * 1024), buffer = Buffer.alloc(size);
        await h.read(buffer, 0, size, stat.size - size);
        text = buffer.toString();
        if (stat.size > size) text = text.slice(text.indexOf('\n') + 1);
    } finally {
        await h.close();
    }
    const items = [];
    let currentModel = '', busySince = null, lastStamp = null, turnSettled = true;
    let turnRounds = [], lastAssistant = -1, pendingRound = null;
    const modelUsage = new Map();
    const finishTurn = () => {
        if (pendingRound && !pendingRound.end && mtimeMs) {
            const startMs = Date.parse(pendingRound.start);
            if (Number.isFinite(startMs) && mtimeMs > startMs && mtimeMs - startMs < 120000) {
                pendingRound.end = new Date(mtimeMs).toISOString();
            }
        }
        if (lastAssistant >= 0 && turnRounds.length) {
            items[lastAssistant].rounds = turnRounds.map((round, i) => {
                const rawMs = round.end && round.start ? Date.parse(round.end) - Date.parse(round.start) : 0;
                const ms = Number.isFinite(rawMs) && rawMs >= 500 ? rawMs : 0;
                return {
                    index: i + 1,
                    model: round.model,
                    inputTokens: round.inputTokens,
                    outputTokens: round.outputTokens,
                    requestId: round.requestId, usageSource: 'antigravity-planner',
                    cachedInputTokens: round.cachedInputTokens,
                    estimated: false,
                    ms,
                    ttftMs: null,
                    generationMs:null,timingEstimated:true,timingSource:'log-boundary',
                    tps:null,
                    at: round.start || round.end
                };
            }).filter(r => r.outputTokens > 0 || r.inputTokens > 0);
        }
        turnRounds = [];
        lastAssistant = -1;
        pendingRound = null;
    };
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        const stamp = ev.created_at || ev.timestamp || null;
        if (stamp) {
            lastStamp = stamp;
            if (pendingRound && !pendingRound.end) {
                pendingRound.end = stamp;
                pendingRound = null;
            }
        }
        if (ev.type === 'USER_INPUT' && ev.source !== 'SYSTEM') {
            finishTurn();
            const raw = String(ev.content || '');
            const mMatch = raw.match(/<USER_SETTINGS_CHANGE>[\s\S]*?Model Selection` from [^\n]+? to ([^\n]+?)\.(?:\s|$)/);
            if (mMatch) currentModel = mMatch[1].trim();
            const content = antigravityUserText(raw);
            const attachments = [];
            for (const m of Array.isArray(ev.media) ? ev.media : []) {
                if (typeof m?.uri === 'string' && path.isAbsolute(m.uri) && !/[\0\r\n]/.test(m.uri) && attachments.length < 30) {
                    attachments.push({ path: m.uri, name: path.basename(m.uri) });
                }
            }
            busySince = stamp || new Date().toISOString();
            turnSettled = false;
            if (!content && !attachments.length) continue;
            items.push({ id: String(ev.step_index ?? items.length), role: 'user', content: safe(content, 40000), ...(attachments.length ? { attachments } : {}), channel: null, createdAt: stamp });
        } else if (ev.type === 'PLANNER_RESPONSE') {
            busySince = busySince || stamp;
            const inputTokens = (Number(ev.input_tokens) || 0) + (Number(ev.cache_read_tokens) || 0);
            const outputTokens = Number(ev.output_tokens) || 0;
            if (inputTokens > 0 || outputTokens > 0) {
                const requestId = `${id}:${ev.step_index ?? stamp}`;
                const cachedInputTokens = Number.isSafeInteger(ev.cache_read_tokens) && ev.cache_read_tokens >= 0 ? ev.cache_read_tokens : null;
                pendingRound = { start: stamp, end: null, model: currentModel, inputTokens, outputTokens, requestId, cachedInputTokens };
                modelUsage.set(requestId, { requestId, usageSource: 'antigravity-planner', model: currentModel, inputTokens, outputTokens, cachedInputTokens, timingSource: 'usage-only', ttftMs: null, generationMs: null });
                turnRounds.push(pendingRound);
            }
            const hasTools = Array.isArray(ev.tool_calls) && ev.tool_calls.length > 0;
            turnSettled = !hasTools && ev.status === 'DONE';
            if (typeof ev.content === 'string' && ev.content.trim()) {
                const raw = ev.content.trim();
                const attachments = await messageAttachments({ role: 'assistant', content: raw }, raw, false);
                items.push({ id: String(ev.step_index ?? items.length), role: 'assistant', content: safe(raw, 40000), ...(attachments.length ? { attachments } : {}), channel: null, createdAt: stamp });
                lastAssistant = items.length - 1;
            }
        } else if (ev.type === 'GENERIC') {
            turnSettled = false;
        }
    }
    finishTurn();
    let dbBusy = null;
    try {
        const rows = await readDb(roots().antigravityDb, 'SELECT status, not_fully_idle FROM conversation_summaries WHERE conversation_id = ? LIMIT 1', [id]);
        if (rows.length) dbBusy = rows[0].status === 'CASCADE_RUN_STATUS_RUNNING' || Boolean(Number(rows[0].not_fully_idle));
    } catch { }
    const fresh = Boolean(lastStamp) && Date.now() - Date.parse(lastStamp) < STALE_MS;
    const busy = dbBusy !== null ? Boolean(dbBusy && fresh) : Boolean(busySince && !turnSettled && fresh);
    return { items: items.slice(-200), modelUsage: [...modelUsage.values()], available: true, busy, busySince: busy ? (busySince || lastStamp) : null };
}
module.exports = { home, roots, entries, json, readDb, safe, userText, codex, claude, transcript, busyState, antigravityTimestamps, antigravity, antigravityBusyIds, antigravityTranscript };
