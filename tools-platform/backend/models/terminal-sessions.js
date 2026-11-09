// Dragon Claw 终端面板：管理员在右侧栏打开的交互式终端（多标签）。
// - 优先使用 node-pty（真终端：颜色、光标、交互程序、窗口大小）；加载不到时退化为管道 Shell（逐行执行，界面本地回显）。
// - 每个标签一个 Shell 进程，按账号（租户 + 用户）隔离；输出保留最近一段，刷新页面后重新连接可回放。
// - Windows 默认 PowerShell，可选 CMD；macOS / Linux 默认 $SHELL，可选 zsh / bash / sh。
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const MAX_SESSIONS_PER_OWNER = 8;
const MAX_BUFFER_CHARS = 256 * 1024;
const EXITED_TTL_MS = 10 * 60 * 1000;
const DETACHED_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_INPUT_CHARS = 64 * 1024;

let ptyModule;
function loadPty() {
    if (ptyModule !== undefined) return ptyModule;
    try {
        ptyModule = require('node-pty');
        // 预编译包里的 spawn-helper 解压后可能丢失执行位（安装时跳过了脚本），否则 posix_spawnp 失败
        if (process.platform !== 'win32') {
            const base = path.dirname(require.resolve('node-pty/package.json')).replace('app.asar', 'app.asar.unpacked');
            for (const dir of [`prebuilds/${process.platform}-${process.arch}`, 'build/Release']) {
                const helper = path.join(base, dir, 'spawn-helper');
                try { if (fs.existsSync(helper) && !(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755); } catch (_error) { /* 只读安装目录：让 spawn 自己报错 */ }
            }
        }
    } catch (_error) {
        ptyModule = null;
    }
    return ptyModule;
}

function exists(file) {
    try { return fs.statSync(file).isFile(); } catch (_error) { return false; }
}

// 可选的 Shell 列表：id 稳定，前端按 id 新建标签
function availableShells(platform = process.platform, env = process.env) {
    if (platform === 'win32') {
        const root = env.SystemRoot || env.windir || 'C:\\Windows';
        const list = [];
        const pwshCandidates = [path.join(env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')];
        const pwsh = pwshCandidates.find(exists);
        if (pwsh) list.push({ id: 'pwsh', label: 'PowerShell 7', file: pwsh, args: ['-NoLogo'] });
        const powershell = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        list.push({ id: 'powershell', label: 'Windows PowerShell', file: exists(powershell) ? powershell : 'powershell.exe', args: ['-NoLogo'] });
        const cmd = [env.ComSpec, path.join(root, 'System32', 'cmd.exe')].find(file => file && /cmd\.exe$/i.test(file) && exists(file)) || 'cmd.exe';
        list.push({ id: 'cmd', label: 'Command Prompt', file: cmd, args: [] });
        list[0] = { ...list[0], default: true };
        return list;
    }
    const list = [];
    const seen = new Set();
    const add = (file, label) => {
        if (!file || seen.has(file) || !path.isAbsolute(file) || !exists(file)) return;
        seen.add(file);
        list.push({ id: path.basename(file), label: label || path.basename(file), file, args: ['-l'] });
    };
    add(env.SHELL);
    ['/bin/zsh', '/bin/bash', '/usr/bin/bash', '/bin/sh'].forEach(file => add(file));
    if (!list.length) list.push({ id: 'sh', label: 'sh', file: '/bin/sh', args: [] });
    list[0] = { ...list[0], default: true };
    return list;
}

function defaultShell(platform = process.platform) {
    const list = availableShells(platform);
    return list.find(item => item.default) || list[0];
}

function terminalEnv() {
    const env = require('./agent-tools-service').scrubbedEnv(); // 去掉平台密钥类环境变量，与 Agent 命令一致
    delete env.DRAGON_CLAW_AGENT;
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    env.TERM_PROGRAM = 'DragonClaw';
    if (process.platform !== 'win32' && !env.LANG) env.LANG = 'en_US.UTF-8';
    return env;
}

function resolveCwd(requested) {
    const value = String(requested || '').trim();
    if (value && path.isAbsolute(value)) {
        try { if (fs.statSync(value).isDirectory()) return value; } catch (_error) { /* 回落到主目录 */ }
    }
    return os.homedir();
}

// 团队账号的终端与交互命令：整条 Shell 包进团队沙箱（models/tenant-sandbox.js），工作目录必须在团队空间内
function launchSpec(file, args, dir, env, sandboxTenantId) {
    if (!sandboxTenantId) return { file, args, cwd: dir, env };
    return require('./tenant-sandbox').wrap({ tenantId: sandboxTenantId, cwd: dir, file, args, env });
}

const sessions = new Map();

function publicView(session) {
    return {
        id: session.id,
        title: session.title,
        shell: session.shell.id,
        shellLabel: session.shell.label,
        cwd: session.cwd,
        pty: session.pty,
        exited: session.exited,
        exitCode: session.exitCode,
        command: session.command || '',
        createdAt: session.createdAt,
        cols: session.cols,
        rows: session.rows
    };
}

function emit(session, event) {
    for (const listener of session.listeners) {
        try { listener(event); } catch (_error) { /* 某个连接写入失败不影响其他连接 */ }
    }
}

function append(session, data) {
    if (!data) return;
    session.buffer += data;
    if (session.buffer.length > MAX_BUFFER_CHARS) session.buffer = session.buffer.slice(session.buffer.length - MAX_BUFFER_CHARS);
    session.lastOutputAt = Date.now();
    emit(session, { type: 'data', data });
}

function markExit(session, exitCode, signal) {
    if (session.exited) return;
    session.exited = true;
    session.exitCode = exitCode ?? null;
    session.exitedAt = Date.now();
    emit(session, { type: 'exit', exitCode: session.exitCode, signal: signal || null });
    session.resolveExit?.({ exitCode: session.exitCode, signal: signal || null });
}

function listFor(owner) {
    return [...sessions.values()].filter(item => item.owner === owner).sort((a, b) => a.createdAt - b.createdAt);
}

function sweep(now = Date.now()) {
    for (const session of sessions.values()) {
        if (session.listeners.size) continue;
        if (session.exited && now - (session.exitedAt || now) > EXITED_TTL_MS) sessions.delete(session.id);
        else if (!session.exited && now - session.lastSeenAt > DETACHED_TTL_MS) kill(session.owner, session.id);
    }
}
const sweeper = setInterval(sweep, 60 * 1000);
sweeper.unref?.();

function create(owner, { shell: shellId, cwd, cols = 100, rows = 30, title, sandboxTenantId = '' } = {}) {
    if (!owner) throw Object.assign(new Error('缺少账号'), { status: 401 });
    sweep();
    const live = listFor(owner).filter(item => !item.exited);
    if (live.length >= MAX_SESSIONS_PER_OWNER) throw Object.assign(new Error(`最多同时打开 ${MAX_SESSIONS_PER_OWNER} 个终端，请先关闭不用的标签`), { status: 429 });
    const shells = availableShells();
    const shell = shells.find(item => item.id === shellId) || defaultShell();
    const dir = resolveCwd(cwd);
    const size = { cols: clampSize(cols, 100, 20, 500), rows: clampSize(rows, 30, 5, 200) };
    const pty = loadPty();
    const session = {
        id: crypto.randomUUID(),
        owner,
        title: String(title || shell.label).slice(0, 60),
        shell,
        cwd: dir,
        pty: false,
        exited: false,
        exitCode: null,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        lastOutputAt: 0,
        buffer: '',
        listeners: new Set(),
        inputs: [],
        ...size
    };
    session.exitPromise = new Promise(resolve => { session.resolveExit = resolve; });
    const env = terminalEnv();
    const launch = launchSpec(shell.file, shell.args, dir, env, sandboxTenantId); // 沙箱不可用时直接抛错，不开终端
    if (pty) {
        try {
            const term = pty.spawn(launch.file, launch.args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: launch.cwd, env: launch.env, useConpty: true });
            session.pty = true;
            session.term = term;
            term.onData(data => append(session, data));
            term.onExit(({ exitCode, signal }) => markExit(session, exitCode, signal));
        } catch (error) {
            console.warn('[terminal] node-pty spawn failed, falling back to pipes:', error.message || error);
            session.term = null;
        }
    }
    if (!session.term) startPipeShell(session, shell, dir, env, sandboxTenantId);
    sessions.set(session.id, session);
    return publicView(session);
}

// 没有 node-pty 时的退路：管道 Shell。没有回显和提示符，由前端本地回显、按行发送。
function startPipeShell(session, shell, dir, env, sandboxTenantId = '') {
    const isWin = process.platform === 'win32';
    let args = shell.args.filter(arg => arg !== '-l');
    if (isWin && /powershell|pwsh/i.test(shell.file)) args = ['-NoLogo', '-NoProfile', '-Command', '-'];
    else if (isWin) args = ['/Q'];
    else args = ['-i'];
    const launch = launchSpec(shell.file, args, dir, { ...env, PS1: '$ ' }, sandboxTenantId);
    const child = spawn(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !isWin });
    session.child = child;
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    const normalize = text => text.replace(/\r?\n/g, '\r\n');
    child.stdout.on('data', chunk => append(session, normalize(outDecoder.write(chunk))));
    child.stderr.on('data', chunk => append(session, normalize(errDecoder.write(chunk))));
    child.on('error', error => { append(session, `\r\n[无法启动 ${shell.label}：${error.message}]\r\n`); markExit(session, null); });
    child.on('close', (code, signal) => markExit(session, code, signal));
    append(session, `\x1b[2m${shell.label} · ${dir}（简易模式：逐行执行，不支持全屏交互程序）\x1b[0m\r\n`);
}

function clampSize(value, fallback, min, max) {
    const num = Math.round(Number(value));
    return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback;
}

function get(owner, id) {
    const session = sessions.get(String(id || ''));
    if (!session || session.owner !== owner) throw Object.assign(new Error('终端不存在或已关闭'), { status: 404 });
    return session;
}

function write(owner, id, data) {
    const session = get(owner, id);
    if (session.exited) throw Object.assign(new Error('终端已退出'), { status: 409 });
    const text = String(data || '').slice(0, MAX_INPUT_CHARS);
    if (!text) return;
    session.lastSeenAt = Date.now();
    if (session.recordInputs) session.inputs.push(text);
    if (session.term) session.term.write(text);
    else session.child?.stdin.write(process.platform === 'win32' ? text.replace(/\r(?!\n)/g, '\r\n') : text.replace(/\r(?!\n)/g, '\n'));
}

function resize(owner, id, cols, rows) {
    const session = get(owner, id);
    session.cols = clampSize(cols, session.cols, 20, 500);
    session.rows = clampSize(rows, session.rows, 5, 200);
    if (session.term && !session.exited) {
        try { session.term.resize(session.cols, session.rows); } catch (_error) { /* 进程刚退出 */ }
    }
    return publicView(session);
}

function signal(owner, id, name = 'SIGINT') {
    const session = get(owner, id);
    if (session.exited) return;
    if (session.term) session.term.write('\x03');
    else if (session.child?.pid) {
        try { process.platform === 'win32' ? session.child.stdin.write('\x03') : process.kill(-session.child.pid, name); } catch (_error) { /* 已退出 */ }
    }
}

function kill(owner, id, { keep = false } = {}) {
    const session = sessions.get(String(id || ''));
    if (!session || session.owner !== owner) return false;
    if (!session.exited) {
        try {
            if (session.term) session.term.kill();
            else if (session.child) require('./agent-tools-service').killTree(session.child);
        } catch (_error) { /* 已退出 */ }
    }
    markExit(session, session.exitCode, 'SIGHUP');
    if (!keep) sessions.delete(session.id); // keep：命令被中止/超时，标签留着让用户看到最后的输出
    return true;
}

function rename(owner, id, title) {
    const session = get(owner, id);
    const value = String(title || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
    if (value) session.title = value;
    return publicView(session);
}

// 订阅输出：先回放缓冲区，再推送实时数据。返回取消订阅函数。
function attach(owner, id, listener) {
    const session = get(owner, id);
    session.lastSeenAt = Date.now();
    listener({ type: 'snapshot', session: publicView(session), data: session.buffer });
    if (session.exited) listener({ type: 'exit', exitCode: session.exitCode });
    session.listeners.add(listener);
    return () => {
        session.listeners.delete(listener);
        session.lastSeenAt = Date.now();
    };
}

function list(owner) {
    sweep();
    return listFor(owner).map(publicView);
}

function info() {
    return { pty: Boolean(loadPty()), platform: process.platform, shells: availableShells().map(({ id, label, default: isDefault }) => ({ id, label, default: Boolean(isDefault) })) };
}

function shutdown() {
    for (const session of sessions.values()) kill(session.owner, session.id);
}
process.once('exit', shutdown);

const view = (owner, id) => publicView(get(owner, id));

// 智能体的交互式命令：在一个真终端里只跑这一条命令（不是常驻 Shell），用户在终端面板里输入。
// 输入会被记下来，命令结束后交给模型的输出里会隐藏用户输入（例如粘贴的登录凭据）。
function createCommand(owner, { command, cwd, env, cols = 100, rows = 30, title, banner = '', sandboxTenantId = '' } = {}) {
    if (!owner) throw Object.assign(new Error('缺少账号'), { status: 401 });
    const text = String(command || '').trim();
    if (!text) throw Object.assign(new Error('缺少命令'), { status: 400 });
    const isWin = process.platform === 'win32';
    const shellInfo = require('./agent-tools-service').resolveShell();
    const shell = { id: 'agent', label: isWin ? 'cmd' : path.basename(shellInfo.shell), file: shellInfo.shell, args: [...shellInfo.args, text] };
    const dir = resolveCwd(cwd);
    const size = { cols: clampSize(cols, 100, 20, 500), rows: clampSize(rows, 30, 5, 200) };
    const session = {
        id: crypto.randomUUID(), owner, command: text.slice(0, 4000),
        title: String(title || text).replace(/\s+/g, ' ').slice(0, 60),
        shell, cwd: dir, pty: false, exited: false, exitCode: null,
        createdAt: Date.now(), lastSeenAt: Date.now(), lastOutputAt: 0,
        buffer: '', listeners: new Set(), inputs: [], recordInputs: true, ...size
    };
    session.exitPromise = new Promise(resolve => { session.resolveExit = resolve; });
    // 顶部说明只给用户看：不计入交给模型的输出
    if (banner) session.buffer = `\x1b[33m${String(banner).replace(/\r?\n/g, '\r\n')}\x1b[0m\r\n\r\n`;
    session.bannerLength = session.buffer.length;
    const launch = launchSpec(shell.file, shell.args, dir, { ...(env || terminalEnv()), TERM: 'xterm-256color', COLORTERM: 'truecolor' }, sandboxTenantId);
    const pty = loadPty();
    if (pty) {
        try {
            const term = pty.spawn(launch.file, launch.args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: launch.cwd, env: launch.env, useConpty: true });
            session.pty = true;
            session.term = term;
            term.onData(data => append(session, data));
            term.onExit(({ exitCode, signal }) => markExit(session, exitCode, signal));
        } catch (error) {
            console.warn('[terminal] node-pty spawn failed, falling back to pipes:', error.message || error);
        }
    }
    if (!session.term) {
        // 没有 PTY：管道运行，程序看到的不是终端（部分交互程序会改走非交互路径）
        const child = spawn(launch.file, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !isWin });
        session.child = child;
        const outDecoder = new StringDecoder('utf8');
        const errDecoder = new StringDecoder('utf8');
        const normalize = value => value.replace(/\r?\n/g, '\r\n');
        child.stdout.on('data', chunk => append(session, normalize(outDecoder.write(chunk))));
        child.stderr.on('data', chunk => append(session, normalize(errDecoder.write(chunk))));
        child.on('error', error => { append(session, `\r\n[无法启动命令：${error.message}]\r\n`); markExit(session, null); });
        child.on('close', (code, signal) => markExit(session, code, signal));
    }
    sessions.set(session.id, session);
    return { view: publicView(session), wait: () => session.exitPromise, kill: () => kill(owner, session.id, { keep: true }), snapshot: () => ({ output: session.buffer.slice(session.bannerLength || 0), inputs: [...session.inputs] }) };
}

// 终端原始输出 → 给模型看的纯文本：去掉控制序列、处理回车覆盖、隐藏用户输入
function plainOutput(raw, inputs = []) {
    let text = String(raw || '')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC（标题等）
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '') // CSI
        .replace(/\x1b[@-Z\\-_]/g, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    text = text.split(/\r?\n/).map(line => {
        const parts = line.split('\r');
        return parts.filter(part => part.length).pop() || '';
    }).join('\n');
    const secrets = inputs.join('').split(/[\r\n]+/).map(item => item.trim()).filter(item => item.length >= 4)
        .sort((a, b) => b.length - a.length);
    for (const secret of secrets) text = text.split(secret).join('[用户输入已隐藏]');
    return text.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { create, createCommand, plainOutput, view, write, resize, signal, kill, rename, attach, list, info, availableShells, _internal: { sessions, sweep, resolveCwd } };
