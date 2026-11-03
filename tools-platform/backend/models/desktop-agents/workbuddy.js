// WorkBuddy（腾讯）桌面连接：会话列表读 ~/.workbuddy/workbuddy.db，消息读 ~/.workbuddy/projects/<目录>/<id>.jsonl；
// 打开记录用官方深链 workbuddy://chat/<id>（-g 后台切换，不抢焦点）；发送走 WorkBuddy 自带的 CodeBuddy CLI 无头模式（--resume 同一会话 id），
// 不用辅助功能模拟操作。桌面端自身的会话驱动（DaemonRPC）只在 Electron 主进程的 stdio 上，本机没有对外的发送接口。
// CLI 不共用桌面端登录：用独立配置目录（默认 ~/.workbuddy-connector），其中 projects 软链到桌面端的会话目录，
// 登录凭据来自该目录（或 ~/.codebuddy 的登录文件、CODEBUDDY_API_KEY 环境变量）。
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { home, readDb, safe, userText } = require('./catalog');
const fail = (code, message) => Object.assign(new Error(message), { code });
const STALE_MS = 20 * 60 * 1000;
const BUSY_STATUS = new Set(['running', 'in_progress', 'busy', 'streaming', 'waiting']);
const CREDENTIAL_FILES = ['.credentials.json', 'credentials.json'];
const configDir = () => process.env.WORKBUDDY_CONFIG_DIR?.trim() || path.join(home(), '.workbuddy');
const connectorDir = () => process.env.TOOLS_WORKBUDDY_CLI_HOME?.trim() || path.join(home(), '.workbuddy-connector');
const projectsDir = () => path.join(configDir(), 'projects');
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
// WorkBuddy 按 cwd 命名会话目录：分隔符和点替换成 -，保留中文
const projectSlug = cwd => String(cwd || '').replace(/^[\\/]+/, '').replace(/[\\/:.]+/g, '-');

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
function run(file, args, options = {}) {
    return new Promise((resolve, reject) => execFile(file, args, { timeout: 8000, ...options }, (error, stdout) => error ? reject(error) : resolve(String(stdout))));
}

// 桌面端会话（数据库）+ CLI 新建、尚未进数据库的会话（只有 jsonl）
async function list(limit) {
    const rows = await readDb(path.join(configDir(), 'workbuddy.db'),
        `SELECT id,cwd,title,custom_title,status,updated_at,last_activity_at,permission_mode FROM sessions
         WHERE transport='local' AND (deleted_at IS NULL OR deleted_at<=0) AND COALESCE(is_background_automation,0)=0
         ORDER BY COALESCE(last_activity_at,updated_at) DESC LIMIT ?`, [limit]);
    const result = rows.filter(r => validId(r.id)).map(r => ({
        id: r.id, provider: 'workbuddy', title: safe(r.custom_title || r.title || 'WorkBuddy'), cwd: r.cwd,
        updatedAt: new Date(Number(r.last_activity_at || r.updated_at) || 0).toISOString(),
        status: r.status, permissionMode: r.permission_mode || '', source: 'desktop-history'
    }));
    // 已删除或超出数量的桌面会话也不能被当成 CLI 会话列出来
    const known = new Set((await readDb(path.join(configDir(), 'workbuddy.db'), 'SELECT id FROM sessions')).map(r => r.id));
    for (const row of await cliOnly(known, limit)) result.push(row);
    return result.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, limit);
}
async function cliOnly(known, limit) {
    const files = [];
    let dirs = [];
    try { dirs = await fs.readdir(projectsDir(), { withFileTypes: true }); } catch { return []; }
    for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        let names = [];
        try { names = await fs.readdir(path.join(projectsDir(), dir.name)); } catch { continue; }
        for (const name of names) {
            const id = name.replace(/\.jsonl$/, '');
            if (name.endsWith('.jsonl') && validId(id) && !known.has(id)) {
                const file = path.join(projectsDir(), dir.name, name);
                try { files.push({ id, file, mtime: (await fs.lstat(file)).mtimeMs }); } catch { }
            }
        }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const rows = [];
    for (const item of files.slice(0, limit)) {
        const head = await readHead(item.file);
        if (!head.cwd) continue;
        rows.push({ id: item.id, provider: 'workbuddy', title: safe(head.title || 'WorkBuddy CLI'), cwd: head.cwd, file: item.file, updatedAt: new Date(item.mtime).toISOString(), status: '', permissionMode: '', source: 'desktop-cli' });
    }
    return rows;
}
async function readHead(file) {
    const handle = await fs.open(file, 'r');
    try {
        const buffer = Buffer.alloc(256 * 1024), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        let cwd = '', title = '';
        for (const line of buffer.subarray(0, bytesRead).toString().split('\n')) {
            let event;
            try { event = JSON.parse(line); } catch { continue; }
            cwd ||= event.cwd || '';
            if (event.type === 'ai-title' && event.aiTitle) title = event.aiTitle;
            if (!title && event.type === 'message' && event.role === 'user') title = queryText(event).slice(0, 80);
        }
        return { cwd, title };
    }
    finally { await handle.close(); }
}

async function transcriptFile(session) {
    if (session.file) return session.file;
    const direct = path.join(projectsDir(), projectSlug(session.cwd), session.id + '.jsonl');
    if (await exists(direct)) return direct;
    try {
        for (const dir of await fs.readdir(projectsDir())) {
            const candidate = path.join(projectsDir(), dir, session.id + '.jsonl');
            if (await exists(candidate)) return candidate;
        }
    } catch { }
    return null;
}
// 用户消息正文包在 <user_query> 里，前面是客户端注入的上下文提醒；CLI 写入的是纯文本
function queryText(event) {
    const raw = (event.content || []).filter(x => ['input_text', 'text'].includes(x.type)).map(x => x.text).join('\n');
    const queries = [...raw.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)].map(m => m[1].trim());
    return queries.length ? queries.join('\n\n') : userText(raw).trim();
}
async function transcript(session) {
    const file = await transcriptFile(session);
    if (!file) return { items: [], available: false, reason: 'WorkBuddy 尚未写出此会话的本地消息记录' };
    const real = await fs.realpath(file), root = await fs.realpath(projectsDir());
    if (!real.startsWith(root + path.sep)) throw Error('Transcript outside the WorkBuddy history root');
    const handle = await fs.open(real, 'r');
    let text;
    try {
        const stat = await handle.stat(), size = Math.min(stat.size, 8 * 1024 * 1024), buffer = Buffer.alloc(size);
        await handle.read(buffer, 0, size, stat.size - size);
        text = buffer.toString();
        if (stat.size > size) text = text.slice(text.indexOf('\n') + 1);
    }
    finally { await handle.close(); }
    const items = [];
    let busySince = null, lastStamp = null;
    for (const line of text.split('\n')) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        const stamp = Number.isFinite(Number(event.timestamp)) && event.timestamp ? new Date(Number(event.timestamp)).toISOString() : null;
        if (stamp) lastStamp = stamp;
        if (event.isSidechain || event.type !== 'message') {
            if (['function_call', 'reasoning'].includes(event.type)) busySince ||= stamp;
            continue;
        }
        if (event.role === 'user') {
            const content = queryText(event);
            if (!content) continue;
            busySince = stamp || new Date().toISOString();
            items.push({ id: event.id || String(items.length), role: 'user', content: safe(content, 40000), channel: null, createdAt: stamp });
        }
        else if (event.role === 'assistant') {
            const content = (event.content || []).filter(x => ['output_text', 'text'].includes(x.type)).map(x => x.text).join('\n').trim();
            if (!content) continue;
            items.push({ id: event.id || String(items.length), role: 'assistant', content: safe(content, 40000), channel: null, createdAt: stamp });
        }
    }
    // jsonl 没有明确的轮次结束标记：以数据库状态为准，CLI 进程在跑也算运行中；最后一条是用户消息/工具调用且近期有写入时也算
    const tail = items.at(-1), fresh = lastStamp && Date.now() - Date.parse(lastStamp) < STALE_MS;
    const busy = running.has(session.id) || BUSY_STATUS.has(String(session.status || '').toLowerCase()) || Boolean(fresh && tail?.role === 'user' && busySince && Date.now() - Date.parse(lastStamp) < 120000);
    return { items: items.slice(-200), available: true, busy, busySince: busy ? busySince || lastStamp : null };
}

// 官方深链：在桌面端切到这条会话；-g 不把 WorkBuddy 拉到前台
async function open(id) {
    if (!validId(id) || process.platform !== 'darwin') return;
    await run('/usr/bin/open', ['-g', 'workbuddy://chat/' + encodeURIComponent(id)]).catch(() => { });
}

let appCache = null;
async function appPath() {
    if (appCache && await exists(appCache)) return appCache;
    const candidates = [process.env.TOOLS_WORKBUDDY_APP, '/Applications/WorkBuddy.app', path.join(home(), 'Applications/WorkBuddy.app')].filter(Boolean);
    try { // 安装在其他位置（例如外置盘）时，从正在运行的进程反推
        const match = (await run('/bin/ps', ['-axo', 'comm='])).split('\n').map(l => l.match(/^(.*\/WorkBuddy\.app)\/Contents\/MacOS\//)?.[1]).find(Boolean);
        if (match) candidates.push(match);
    } catch { }
    for (const candidate of candidates) if (await exists(path.join(candidate, 'Contents/Resources/app.asar.unpacked/cli/bin/codebuddy'))) return (appCache = candidate);
    return null;
}
async function runningApp() {
    try { return /\/WorkBuddy\.app\/Contents\/MacOS\//.test(await run('/bin/ps', ['-axo', 'comm='])); } catch { return false; }
}
async function newestNode() {
    const base = path.join(configDir(), 'binaries/node/versions');
    try {
        const versions = (await fs.readdir(base)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        for (const v of versions) if (await exists(path.join(base, v, 'bin/node'))) return path.join(base, v, 'bin/node');
    } catch { }
    return process.execPath;
}
// 优先用户指定 / 自行安装的完整 CLI，否则用 WorkBuddy 自带的精简无头 CLI
async function cli() {
    if (process.env.TOOLS_WORKBUDDY_CLI && await exists(process.env.TOOLS_WORKBUDDY_CLI)) return { file: process.env.TOOLS_WORKBUDDY_CLI, args: [], env: {}, kind: 'custom' };
    for (const dir of (process.env.PATH || '').split(':').concat(['/opt/homebrew/bin', '/usr/local/bin', path.join(home(), '.local/bin')])) {
        const file = path.join(dir, 'codebuddy');
        if (dir && await exists(file)) return { file, args: [], env: {}, kind: 'installed' };
    }
    const app = await appPath();
    if (!app) return null;
    return { file: await newestNode(), args: [path.join(app, 'Contents/Resources/app.asar.unpacked/cli/bin/codebuddy')], env: { CODEBUDDY_FORCE_LITE_WB_BUNDLE: '1' }, kind: 'bundled' };
}
// 连接器配置目录：projects 软链到桌面端会话目录（--resume 才能找到桌面会话）；登录文件缺失时链接 ~/.codebuddy 里的登录
async function prepareHome() {
    const dir = connectorDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const link = path.join(dir, 'projects');
    try {
        const stat = await fs.lstat(link);
        // 在这个目录里交互登录时 CLI 会先建一个真实的 projects：改名保留（里面是登录时的会话），再换成软链
        if (!stat.isSymbolicLink()) {
            await fs.rename(link, `${link}.before-link-${Date.now()}`);
            await fs.symlink(projectsDir(), link);
        }
    }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await fs.symlink(projectsDir(), link);
    }
    for (const name of CREDENTIAL_FILES) {
        const target = path.join(dir, name), shared = path.join(home(), '.codebuddy', name);
        if (!await exists(target) && await exists(shared)) await fs.symlink(shared, target).catch(() => { });
    }
    return dir;
}
async function loggedIn() {
    if (process.env.CODEBUDDY_API_KEY || process.env.CODEBUDDY_AUTH_TOKEN) return true;
    // 新版 CLI 把登录写进配置目录的 local_storage（加密条目），没有单独的凭据文件
    try { if ((await fs.readdir(path.join(connectorDir(), 'local_storage'))).some(name => /^entry_[a-f0-9]+\.info$/.test(name))) return true; } catch { }
    for (const name of CREDENTIAL_FILES)
        for (const dir of [connectorDir(), path.join(home(), '.codebuddy')])
            if (await exists(path.join(dir, name))) return true;
    return false;
}
async function status(items) {
    const [command, app, login] = await Promise.all([cli(), runningApp(), loggedIn()]);
    if (!command) return { connected: items.length > 0, canSend: false, reason: '未找到 WorkBuddy 或 CodeBuddy CLI，可查看已保存记录' };
    const note = login ? '' : '；未检测到 CLI 登录，首次发送前请先登录';
    return { connected: true, canSend: true, reason: `${command.kind === 'bundled' ? 'WorkBuddy 自带 CLI' : 'CodeBuddy CLI'} 无头发送${app ? '；打开记录会同步切换桌面会话' : '；桌面端未运行'}${note}` };
}

// 正在运行的 CLI 回合：同一会话同时只允许一个
const running = new Map();
const PERMISSION = { bypassPermissions: 'bypassPermissions', fullAccess: 'bypassPermissions', acceptEdits: 'acceptEdits', plan: 'plan', default: 'acceptEdits' };
async function start(id, cwd, text, { resume, permissionMode = '' }) {
    if (running.has(id)) throw fail('DESKTOP_BUSY', 'WorkBuddy 这条会话正在回复，请稍后或改用排队');
    const command = await cli();
    if (!command) throw fail('DESKTOP_UNAVAILABLE', '未找到 WorkBuddy 自带 CLI，请确认 WorkBuddy 已安装');
    const dir = await prepareHome();
    if (!cwd || !await exists(cwd)) throw fail('DESKTOP_UNAVAILABLE', '会话的工作目录已不存在，无法继续');
    const args = [...command.args, '-p', '--output-format', 'stream-json', '--verbose', resume ? '--resume' : '--session-id', id, '--permission-mode', PERMISSION[permissionMode] || 'acceptEdits'];
    const logs = path.join(dir, 'logs');
    await fs.mkdir(logs, { recursive: true });
    const log = await fs.open(path.join(logs, `${id}.log`), 'a');
    const child = spawn(command.file, args, { cwd, env: { ...process.env, ...command.env, CODEBUDDY_CONFIG_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
    running.set(id, child);
    let output = '', settled = false;
    return new Promise((resolve, reject) => {
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            error ? reject(error) : resolve({ id });
        };
        // 登录、参数错误会在几秒内以 result 报错退出；收到第一条模型输出或 15 秒无异常即视为已开始
        const timer = setTimeout(() => finish(), 15000);
        const inspect = chunk => {
            output = (output + chunk).slice(-64 * 1024);
            log.write(chunk).catch(() => { });
            for (const line of output.split('\n')) {
                let event;
                try { event = JSON.parse(line); } catch { continue; }
                const said = event.type === 'assistant' ? (event.message?.content || []).map(x => x.text || '').join('') : '';
                if (/Authentication (?:required|failed)/i.test(said) || event.type === 'result' && /Authentication/i.test(JSON.stringify(event)))
                    return finish(fail('NOT_LOGGED_IN', `WorkBuddy CLI 未登录：请在终端运行 CODEBUDDY_CONFIG_DIR=${dir} codebuddy 并用 /login 登录，或为平台服务设置 CODEBUDDY_API_KEY`));
                if (event.type === 'result' && event.is_error) return finish(fail('DESKTOP_UNAVAILABLE', safe(event.result || event.subtype || 'WorkBuddy CLI 执行失败', 200)));
                if (event.type === 'assistant' || event.type === 'result') return finish();
            }
        };
        child.stdout.on('data', inspect);
        child.stderr.on('data', chunk => log.write(chunk).catch(() => { }));
        child.on('error', () => finish(fail('DESKTOP_UNAVAILABLE', 'WorkBuddy CLI 无法启动')));
        child.on('exit', code => {
            running.delete(id);
            log.close().catch(() => { });
            if (code) finish(fail('DESKTOP_UNAVAILABLE', `WorkBuddy CLI 异常退出（${code}），详见 ${path.join(logs, id + '.log')}`));
            else finish();
        });
        child.stdin.end(text);
    });
}
const send = (row, text) => start(row.id, row.cwd, text, { resume: true, permissionMode: row.permissionMode });
// 新对话：与桌面端一样放在 ~/WorkBuddy/<时间戳> 工作目录，会话 id 由这里生成，回执按 id 精确确认
async function createAndSend(text) {
    const id = crypto.randomUUID(), stamp = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 19);
    const cwd = path.join(home(), 'WorkBuddy', stamp);
    await fs.mkdir(cwd, { recursive: true });
    await start(id, cwd, text, { resume: false });
    return { id, status: 'accepted' };
}
module.exports = { list, transcript, open, status, send, createAndSend, projectSlug, queryText, running };
