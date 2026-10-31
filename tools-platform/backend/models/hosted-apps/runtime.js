// 托管 Python Web 应用的安装与进程管理。
// 每个应用：独立目录、独立虚拟环境、独立 SQLite 应用库；只监听 127.0.0.1 的随机端口，经平台反向代理访问。
// 子进程只拿到最小环境变量（不含平台密钥/会话），平台退出时 stdin 关闭，宿主脚本随之退出，避免孤儿进程占端口。
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const tenant = require('../tenant-context');
const { HOST_MODULE } = require('./package');

const MAX_LOG_LINES = 800;
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const START_TIMEOUT_MS = 90 * 1000;
const CRASH_WINDOW_MS = 10 * 60 * 1000;
const MAX_CRASHES = 5;
const MAX_APPS_PER_TENANT = 30;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

const runtimes = new Map(); // `${tenant}/${slug}` → 运行态
const tokenIndex = new Map(); // 应用数据接口令牌 → { tenantId, slug }
let pythonCache = null;

const fail = (message, code = 'HOSTED_APP_ERROR', status = 400) => Object.assign(new Error(message), { code, status });
const keyOf = (tenantId, slug) => `${tenantId}/${slug}`;

function assertSlug(slug) {
    if (!SLUG_RE.test(String(slug || ''))) throw fail('应用标识不合法', 'HOSTED_APP_SLUG', 400);
    return slug;
}

// ── 目录与状态 ─────────────────────────────────────────
const appsRoot = (tenantId = tenant.getTenantId()) => path.join(tenant.getDataDir(tenantId), 'hosted-apps');
const appDir = (slug, tenantId) => path.join(appsRoot(tenantId), assertSlug(slug));
const paths = (slug, tenantId) => {
    const base = appDir(slug, tenantId);
    return { base, code: path.join(base, 'app'), venv: path.join(base, 'venv'), data: path.join(base, 'data'), db: path.join(base, 'data', 'app.db'),
        home: path.join(base, 'home'), log: path.join(base, 'logs', 'runtime.log'), state: path.join(base, 'state.json'), package: path.join(base, 'package.zip') };
};
const venvPython = venv => process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');

function readState(slug, tenantId) {
    try { return JSON.parse(fs.readFileSync(paths(slug, tenantId).state, 'utf8')); } catch (_error) { return null; }
}

function writeState(slug, state, tenantId) {
    const file = paths(slug, tenantId).state;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
    return state;
}

function updateState(slug, patch, tenantId) {
    const state = readState(slug, tenantId);
    if (!state) return null;
    return writeState(slug, { ...state, ...patch }, tenantId);
}

function listSlugs(tenantId) {
    const root = appsRoot(tenantId);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && SLUG_RE.test(entry.name)
        && fs.existsSync(path.join(root, entry.name, 'state.json'))).map(entry => entry.name);
}

function indexToken(tenantId, slug, state) {
    if (state?.dataToken) tokenIndex.set(state.dataToken, { tenantId, slug });
}

/** 数据接口令牌 → 应用；平台重启后按需从磁盘重建索引。 */
function resolveDataToken(token) {
    if (!/^[A-Za-z0-9_-]{32,}$/.test(String(token || ''))) return null;
    const hit = tokenIndex.get(token);
    if (hit) return hit;
    const tenants = ['default'];
    try {
        const root = tenant.TENANTS_ROOT || path.join(tenant.BASE_DATA_DIR, 'tenants');
        if (fs.existsSync(root)) tenants.push(...fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name));
    } catch (_error) { /* 只扫默认租户 */ }
    for (const tenantId of tenants) {
        for (const slug of listSlugs(tenantId)) {
            const state = readState(slug, tenantId);
            indexToken(tenantId, slug, state);
            if (state?.dataToken === token) return { tenantId, slug };
        }
    }
    return null;
}

// ── 设置（机器级：Python 路径、pip 镜像）──────────────────
const settingsFile = () => path.join(tenant.BASE_DATA_DIR, 'hosted-apps-settings.json');

function getSettings() {
    try {
        const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
        return { pythonPath: String(saved.pythonPath || ''), pipIndexUrl: String(saved.pipIndexUrl || ''), pipTrustedHost: String(saved.pipTrustedHost || '') };
    } catch (_error) {
        return { pythonPath: '', pipIndexUrl: '', pipTrustedHost: '' };
    }
}

function saveSettings(patch = {}) {
    const next = { ...getSettings() };
    if (patch.pythonPath !== undefined) next.pythonPath = String(patch.pythonPath || '').trim().slice(0, 500);
    if (patch.pipIndexUrl !== undefined) {
        const value = String(patch.pipIndexUrl || '').trim();
        if (value && !/^https?:\/\/[^\s]+$/i.test(value)) throw fail('pip 镜像地址必须是 http(s) 地址');
        next.pipIndexUrl = value.slice(0, 500);
    }
    if (patch.pipTrustedHost !== undefined) next.pipTrustedHost = String(patch.pipTrustedHost || '').trim().replace(/[^\w.\-:]/g, '').slice(0, 200);
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
    pythonCache = null;
    return next;
}

// ── Python 检测（异步子进程，不阻塞平台事件循环）──────────────────
function probePython(command, args = []) {
    return new Promise(resolve => {
        let stdout = '';
        let child;
        try {
            child = spawn(command, [...args, '-c', 'import sys,venv;print("%d.%d.%d" % sys.version_info[:3])'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        } catch (_error) { resolve(null); return; }
        const timer = setTimeout(() => { killChild(child); resolve(null); }, 15000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.on('error', () => { clearTimeout(timer); resolve(null); });
        child.on('close', code => {
            clearTimeout(timer);
            const version = stdout.trim();
            if (code !== 0 || !/^\d+\.\d+\.\d+$/.test(version)) return resolve(null);
            const [major, minor] = version.split('.').map(Number);
            resolve({ command, args, version, ok: major === 3 && minor >= 9 });
        });
    });
}

let pythonProbe = null;
/** 找到可用的 Python 3.9+；设置里指定的路径优先。结果缓存到设置变更为止，并发调用合并为一次检测。 */
function findPython({ refresh = false } = {}) {
    if (pythonCache && !refresh) return Promise.resolve(pythonCache);
    if (pythonProbe && !refresh) return pythonProbe;
    pythonProbe = (async () => {
        const { pythonPath } = getSettings();
        const candidates = pythonPath ? [[pythonPath, []]]
            : process.platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
        let found = null;
        let tooOld = null;
        for (const [command, args] of candidates) {
            const probe = await probePython(command, args);
            if (probe?.ok) { found = probe; break; }
            if (probe && !tooOld) tooOld = probe;
        }
        pythonCache = found ? { ok: true, command: found.command, args: found.args, version: found.version }
            : { ok: false, message: tooOld ? `找到的 Python 版本 ${tooOld.version} 过低，需要 3.9 及以上` : pythonPath ? `设置的 Python 路径不可用：${pythonPath}` : '未检测到 Python 3.9 及以上，请安装 Python 或在设置中指定路径' };
        return pythonCache;
    })().finally(() => { pythonProbe = null; });
    return pythonProbe;
}

// ── 日志 ─────────────────────────────────────────────
function runtimeOf(slug, tenantId = tenant.getTenantId()) {
    const key = keyOf(tenantId, slug);
    if (!runtimes.has(key)) runtimes.set(key, { tenantId, slug, status: 'stopped', child: null, port: null, logs: [], crashes: [], startedAt: null, stopping: false, busy: null });
    return runtimes.get(key);
}

// 日志先进内存，再批量异步追加到文件；输出过快的应用按每秒行数限流，避免刷屏拖慢平台
const LOG_LINES_PER_SECOND = 200;

function flushLog(rt) {
    rt.flushTimer = null;
    if (!rt.pending?.length || rt.flushing) return;
    const text = rt.pending.join('\n') + '\n';
    rt.pending = [];
    rt.flushing = true;
    const file = paths(rt.slug, rt.tenantId).log;
    fs.promises.mkdir(path.dirname(file), { recursive: true })
        .then(() => fs.promises.stat(file).then(stat => stat.size > 5 * 1024 * 1024 ? fs.promises.rename(file, `${file}.1`) : null, () => null))
        .then(() => fs.promises.appendFile(file, text))
        .catch(() => { /* 日志文件不可写不影响运行 */ })
        .finally(() => {
            rt.flushing = false;
            if (rt.pending.length && !rt.flushTimer) rt.flushTimer = setTimeout(() => flushLog(rt), 500);
        });
}

function log(rt, line, stream = 'platform') {
    const text = String(line).replace(/\r/g, '');
    const second = Math.floor(Date.now() / 1000);
    if (rt.logSecond !== second) {
        if (rt.dropped) rt.logs.push(`[${new Date().toISOString()}] [平台] 输出过快，上一秒丢弃了 ${rt.dropped} 行日志`);
        rt.logSecond = second;
        rt.logCount = 0;
        rt.dropped = 0;
    }
    rt.pending = rt.pending || [];
    for (const part of text.split('\n')) {
        if (!part.trim()) continue;
        if (stream !== 'platform' && ++rt.logCount > LOG_LINES_PER_SECOND) { rt.dropped += 1; continue; }
        const entry = `[${new Date().toISOString()}] ${stream === 'platform' ? '[平台] ' : ''}${part.slice(0, 4000)}`;
        rt.logs.push(entry);
        rt.pending.push(entry);
    }
    if (rt.logs.length > MAX_LOG_LINES) rt.logs.splice(0, rt.logs.length - MAX_LOG_LINES);
    if (rt.pending.length > 5000) rt.pending.splice(0, rt.pending.length - 5000);
    if (!rt.flushTimer && rt.pending.length) rt.flushTimer = setTimeout(() => flushLog(rt), 500);
}

function attachOutput(rt, child) {
    const pump = stream => {
        let buffer = '';
        child[stream].setEncoding('utf8');
        child[stream].on('data', chunk => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop();
            lines.forEach(line => log(rt, line, stream));
            if (buffer.length > 8000) { log(rt, buffer, stream); buffer = ''; }
        });
        child[stream].on('end', () => { if (buffer) log(rt, buffer, stream); });
    };
    pump('stdout');
    pump('stderr');
}

// ── 子进程环境 ─────────────────────────────────────────
// 只传运行所需的系统变量；平台自身的密钥、令牌、数据库路径一律不继承。
const PASS_THROUGH = process.platform === 'win32'
    ? ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'SystemDrive']
    : ['TMPDIR', 'LANG', 'LC_ALL', 'TZ'];
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'PIP_CERT', 'REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE'];

function baseEnv(slug, extra = {}, { withProxy = false } = {}) {
    const p = paths(slug);
    const env = {};
    for (const name of [...PASS_THROUGH, ...(withProxy ? PROXY_VARS : [])]) if (process.env[name] !== undefined) env[name] = process.env[name];
    const venvBin = path.dirname(venvPython(p.venv));
    env.PATH = [venvBin, process.env.PATH || process.env.Path || ''].filter(Boolean).join(path.delimiter);
    env.HOME = p.home;
    if (process.platform === 'win32') env.USERPROFILE = env.USERPROFILE || p.home;
    env.PYTHONUTF8 = '1';
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUNBUFFERED = '1';
    env.PYTHONNOUSERSITE = '1';
    env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
    env.VIRTUAL_ENV = p.venv;
    return { ...env, ...extra };
}

function appEnv(slug, state, port, tenantNetcareName) {
    const platformPort = process.env.PORT || '3030';
    const base = `http://127.0.0.1:${platformPort}/hosted-api/${state.dataToken}/dh`;
    const netcareName = tenantNetcareName === undefined ? require('./data-api').datasourceNames().netcareName : tenantNetcareName;
    const defaultBiz = netcareName || (state.databaseContract === 'digital-human' ? 'netcare' : 'platform:report.db');
    const businessName = state.businessDatasource || defaultBiz;
    return baseEnv(slug, {
        PORT: String(port), HOST: '127.0.0.1', RELOAD: 'false', WORKERS: '1', DEBUG: 'false',
        APP_NAME: state.packageName || state.name || slug, ...(state.version ? { APP_VERSION: state.version } : {}),
        // 与数字人基座 REST 约定同名：BASE_QUERY_URL 去掉 /query 即基础地址
        BASE_QUERY_URL: `${base}/query`, APP_DATASOURCE_ID: 'app', APP_SCHEMA: state.uuid, APP_UUID: state.uuid, APP_LEVEL: 'BUSINESS',
        BUSINESS_DATASOURCE_NAME: businessName, HTTP_VERIFY_SSL: 'false',
        PLATFORM_APP_SLUG: slug, PLATFORM_APP_SECRET: state.secret, PLATFORM_DATA_API: base,
        PLATFORM_APP_ENTRY: state.entry, PLATFORM_APP_FACTORY: state.factory ? '1' : '0', PLATFORM_APP_INTERFACE: state.interface,
        ...(state.env || {}),
        PLATFORM_APP_DATABASE_CONTRACT: state.databaseContract || 'platform'
    });
}

// 宿主模块：加载应用对象，按代理传来的前缀设置 root_path / SCRIPT_NAME；平台进程退出（stdin 关闭）时自行退出。
const HOST_SOURCE = `# 由平台生成，请勿修改：加载应用并适配反向代理前缀
import importlib, os, sys, threading

def _watch_parent():
    try:
        while sys.stdin.read(1):
            pass
    except Exception:
        pass
    os._exit(0)

threading.Thread(target=_watch_parent, daemon=True).start()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_module, _, _attr = os.environ["PLATFORM_APP_ENTRY"].partition(":")
_inner = getattr(importlib.import_module(_module), _attr)
if os.environ.get("PLATFORM_APP_FACTORY") == "1":
    _inner = _inner()

if os.environ.get("PLATFORM_APP_INTERFACE") == "wsgi":
    from uvicorn.middleware.wsgi import WSGIMiddleware

    def _wsgi(environ, start_response):
        prefix = environ.get("HTTP_X_FORWARDED_PREFIX", "")
        if prefix:
            environ["SCRIPT_NAME"] = prefix
        return _inner(environ, start_response)

    app = WSGIMiddleware(_wsgi)
else:
    import uvicorn as _uvicorn

    # uvicorn 0.26 起 path 包含 root_path（新版 Starlette 的路由与 StaticFiles 依赖这一约定）；旧版只设 root_path
    _PATH_INCLUDES_ROOT = tuple(int(part) for part in _uvicorn.__version__.split(".")[:2] if part.isdigit()) >= (0, 26)

    async def app(scope, receive, send):
        if scope.get("type") in ("http", "websocket"):
            for key, value in scope.get("headers", []):
                if key == b"x-forwarded-prefix":
                    prefix = value.decode("latin-1")
                    scope = dict(scope, root_path=prefix)
                    if _PATH_INCLUDES_ROOT:
                        scope["path"] = prefix + scope["path"]
                        if scope.get("raw_path") is not None:
                            scope["raw_path"] = value + scope["raw_path"]
                    break
        await _inner(scope, receive, send)
`;

// ── 安装 ─────────────────────────────────────────────
function runStep(rt, command, args, options, label) {
    return new Promise((resolve, reject) => {
        log(rt, `${label}：${[path.basename(command), ...args].join(' ')}`);
        const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
        rt.installer = child;
        attachOutput(rt, child);
        const timer = setTimeout(() => { log(rt, `${label}超时，已终止`); killChild(child); }, options.timeout || INSTALL_TIMEOUT_MS);
        child.on('error', error => { clearTimeout(timer); rt.installer = null; reject(fail(`${label}失败：${error.message}`, 'HOSTED_APP_INSTALL')); });
        child.on('close', code => {
            clearTimeout(timer);
            rt.installer = null;
            if (code === 0) resolve();
            else reject(fail(`${label}失败（退出码 ${code}），详见运行日志`, 'HOSTED_APP_INSTALL'));
        });
    });
}

function killChild(child) {
    if (!child || child.exitCode !== null || child.signalCode) return;
    try {
        if (process.platform === 'win32') spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
    } catch (_error) {
        try { child.kill('SIGKILL'); } catch (_ignored) { /* 已退出 */ }
    }
}

/** 创建虚拟环境并安装依赖：包内有 wheels/ 时离线安装，否则在线安装（可配置镜像）。 */
async function install(slug, { force = false } = {}) {
    const tenantId = tenant.getTenantId();
    const rt = runtimeOf(slug, tenantId);
    const state = readState(slug, tenantId);
    if (!state) throw fail('应用不存在', 'HOSTED_APP_NOT_FOUND', 404);
    const p = paths(slug, tenantId);
    if (!force && state.installedHash === state.requirementsHash && fs.existsSync(venvPython(p.venv))) return state;
    const python = await findPython();
    if (!python.ok) {
        updateState(slug, { status: 'install_failed', lastError: python.message }, tenantId);
        rt.status = 'install_failed';
        throw fail(python.message, 'HOSTED_APP_PYTHON', 409);
    }
    rt.status = 'installing';
    updateState(slug, { status: 'installing', lastError: '' }, tenantId);
    try {
        [p.data, p.home].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
        if (force || !fs.existsSync(venvPython(p.venv))) {
            fs.rmSync(p.venv, { recursive: true, force: true });
            await runStep(rt, python.command, [...python.args, '-m', 'venv', p.venv], { cwd: p.base, env: baseEnv(slug) }, '创建虚拟环境');
        }
        const settings = getSettings();
        const wheels = path.join(p.code, 'wheels');
        const offline = fs.existsSync(wheels) && fs.readdirSync(wheels).some(name => /\.(?:whl|tar\.gz|zip)$/i.test(name));
        const base = ['-m', 'pip', 'install', '--no-input', '-r', path.join(p.code, 'requirements.txt')];
        const online = [...base, ...(settings.pipIndexUrl ? ['--index-url', settings.pipIndexUrl, ...(settings.pipTrustedHost ? ['--trusted-host', settings.pipTrustedHost] : [])] : [])];
        const pipOptions = { cwd: p.code, env: baseEnv(slug, {}, { withProxy: true }) };
        const onlineLabel = `在线安装依赖${settings.pipIndexUrl ? `（镜像 ${settings.pipIndexUrl}）` : ''}`;
        if (offline) {
            log(rt, '使用包内 wheels/ 离线安装依赖');
            try {
                await runStep(rt, venvPython(p.venv), [...base, '--no-index', '--find-links', wheels], pipOptions, '离线安装依赖');
            } catch (_error) {
                // wheels 常按打包机器的系统 / Python 版本下载（例如 macOS 专用），换平台装不上时改为在线安装
                log(rt, `包内 wheels 与本机系统或 Python 版本不匹配，改为${onlineLabel}`);
                await runStep(rt, venvPython(p.venv), [...online, '--find-links', wheels], pipOptions, '安装依赖');
            }
        } else {
            log(rt, onlineLabel);
            await runStep(rt, venvPython(p.venv), online, pipOptions, '安装依赖');
        }
        await runStep(rt, venvPython(p.venv), ['-c', 'import uvicorn; print("uvicorn", uvicorn.__version__)'], { cwd: p.code, env: baseEnv(slug), timeout: 60000 }, '检查 uvicorn')
            .catch(() => { throw fail('依赖中缺少 uvicorn：请在 requirements.txt 中加入 uvicorn', 'HOSTED_APP_INSTALL'); });
        fs.writeFileSync(path.join(p.code, `${HOST_MODULE}.py`), HOST_SOURCE);
        rt.status = 'stopped';
        log(rt, '依赖安装完成');
        return updateState(slug, { status: 'stopped', installedHash: state.requirementsHash, installedAt: new Date().toISOString(), python: python.version, lastError: '' }, tenantId);
    } catch (error) {
        rt.status = 'install_failed';
        log(rt, error.message);
        updateState(slug, { status: 'install_failed', lastError: error.message }, tenantId);
        throw error;
    }
}

// ── 启动 / 停止 ──────────────────────────────────────
function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function probeHealth(port, healthPath) {
    return new Promise(resolve => {
        const request = http.get({ host: '127.0.0.1', port, path: healthPath, timeout: 3000, headers: { 'x-platform-health': '1' } }, response => {
            response.resume();
            resolve(response.statusCode < 500);
        });
        request.on('timeout', () => { request.destroy(); resolve(false); });
        request.on('error', () => resolve(false));
    });
}

function transpileMysqlToSqlite(sql) {
    if (!sql) return '';
    let out = sql;
    out = out.replace(/`?(\w+)`?\s+INT(?:EGER)?(?:\(\d+\))?\s+NOT\s+NULL\s+AUTO_INCREMENT\b/gi, '`$1` INTEGER PRIMARY KEY AUTOINCREMENT');
    out = out.replace(/`?(\w+)`?\s+INT(?:EGER)?(?:\(\d+\))?\s+AUTO_INCREMENT\b/gi, '`$1` INTEGER PRIMARY KEY AUTOINCREMENT');
    out = out.replace(/,\s*PRIMARY\s+KEY\s*\([^)]+\)/gi, '');
    out = out.replace(/\s+COMMENT\s+'(?:[^'\\]|\\.)*'/gi, '');
    out = out.replace(/\s+COMMENT\s+"(?:[^"\\]|\\.)*"/gi, '');
    out = out.replace(/,\s*(?:KEY|INDEX)\s+`?\w+`?\s*\([^)]+\)/gi, '');
    out = out.replace(/(?:UNIQUE\s+(?:KEY|INDEX)\s+`?\w+`?)\s*(\([^)]+\))/gi, 'UNIQUE $1');
    out = out.replace(/\)\s*ENGINE\s*=\s*\w+[^;]*/gi, ')');
    out = out.replace(/\)\s*DEFAULT\s+CHARSET\s*=\s*\w+[^;]*/gi, ')');
    out = out.replace(/INSERT\s+INTO\b([\s\S]*?)ON\s+DUPLICATE\s+KEY\s+UPDATE\b[\s\S]*?;/gi, (match, p1) => {
        return `INSERT OR REPLACE INTO ${p1.trim()};`;
    });
    return out;
}

// 原基座由 DBA 手工建表；平台上应用包可带 db/init.sqlite.sql（或 MySQL init.sql 自动转译），首次启动（或脚本变化）时在应用库执行一次
async function applyStartupSql(rt, state) {
    // 基座契约下建表属于管理员部署动作，启动/业务请求不得自动补表。
    if (state.databaseContract === 'digital-human') return state;
    const codeDir = paths(rt.slug, rt.tenantId).code;
    const candidates = [
        path.join(codeDir, 'db', 'init.sqlite.sql'),
        path.join(codeDir, 'db', 'init.sql'),
        path.join(codeDir, 'init.sqlite.sql'),
        path.join(codeDir, 'init.sql')
    ];
    let chosen = null;
    for (const c of candidates) {
        if (fs.existsSync(c)) { chosen = c; break; }
    }
    if (!chosen) return state;

    const rawSql = fs.readFileSync(chosen, 'utf8');
    const isMysql = !chosen.endsWith('.sqlite.sql') && (/AUTO_INCREMENT/i.test(rawSql) || /ENGINE\s*=/i.test(rawSql) || /COMMENT\s*['"]/i.test(rawSql));
    const sql = isMysql ? transpileMysqlToSqlite(rawSql) : rawSql;
    const hash = crypto.createHash('sha256').update(sql).digest('hex');
    if (state.initSqlHash === hash) return state;

    const rel = path.relative(codeDir, chosen);
    log(rt, `执行应用库初始化脚本 ${rel}${isMysql ? '（已自动转译为 SQLite 方言）' : ''}`);
    try {
        await require('./data-api').applyInitSql(rt.tenantId, rt.slug, sql);
    } catch (error) {
        throw fail(`应用库初始化失败：${error.message}`, 'HOSTED_APP_INIT_SQL');
    }
    return tenant.runWithTenant(rt.tenantId, () => updateState(rt.slug, { initSqlHash: hash }, rt.tenantId));
}

async function launch(rt, initial) {
    const p = paths(rt.slug, rt.tenantId);
    // 每次启动都写入当前版本的宿主模块，平台升级后已安装的应用也能用上修复
    fs.writeFileSync(path.join(p.code, `${HOST_MODULE}.py`), HOST_SOURCE);
    const state = await applyStartupSql(rt, initial);
    const tenantNetcareName = await require('./data-api').refreshNetcareName();
    const port = await freePort();
    rt.status = 'starting';
    rt.stopping = false;
    rt.port = port;
    const args = ['-m', 'uvicorn', `${HOST_MODULE}:app`, '--host', '127.0.0.1', '--port', String(port), '--workers', '1',
        '--no-server-header', '--timeout-graceful-shutdown', '5', '--log-level', 'info'];
    log(rt, `启动应用：127.0.0.1:${port}（入口 ${state.entry}${state.factory ? '，工厂函数' : ''}，${state.interface.toUpperCase()}）`);
    const child = spawn(venvPython(p.venv), args, { cwd: p.code, env: tenant.runWithTenant(rt.tenantId, () => appEnv(rt.slug, state, port, tenantNetcareName)),
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
    rt.child = child;
    rt.startedAt = Date.now();
    attachOutput(rt, child);
    child.on('error', error => log(rt, `进程启动失败：${error.message}`));
    child.on('exit', (code, signal) => {
        if (rt.child !== child) return;
        rt.child = null;
        rt.port = null;
        if (rt.stopping) {
            rt.status = 'stopped';
            log(rt, '应用已停止');
            return;
        }
        rt.status = 'crashed';
        log(rt, `应用异常退出（${signal || `退出码 ${code}`}）`);
        const now = Date.now();
        rt.crashes = rt.crashes.filter(at => now - at < CRASH_WINDOW_MS).concat(now);
        tenant.runWithTenant(rt.tenantId, () => updateState(rt.slug, { status: 'crashed', lastError: `异常退出（${signal || code}）` }, rt.tenantId));
        if (rt.crashes.length >= MAX_CRASHES) {
            log(rt, `${CRASH_WINDOW_MS / 60000} 分钟内崩溃 ${rt.crashes.length} 次，停止自动重启；请查看日志后手动启动`);
            return;
        }
        const delay = Math.min(60000, 1000 * 2 ** (rt.crashes.length - 1));
        log(rt, `${Math.round(delay / 1000)} 秒后自动重启`);
        setTimeout(() => {
            if (rt.child || rt.status !== 'crashed') return;
            tenant.runWithTenant(rt.tenantId, () => start(rt.slug).catch(error => log(rt, `自动重启失败：${error.message}`)));
        }, delay).unref();
    });
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (rt.child !== child) throw fail('应用启动后立即退出，详见运行日志', 'HOSTED_APP_START', 502);
        if (await probeHealth(port, state.healthPath || '/')) {
            rt.status = 'running';
            log(rt, '应用已就绪');
            tenant.runWithTenant(rt.tenantId, () => updateState(rt.slug, { status: 'running', desired: 'running', lastError: '', lastStartedAt: new Date().toISOString() }, rt.tenantId));
            return status(rt.slug);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(rt, `启动超时（${START_TIMEOUT_MS / 1000} 秒内健康检查 ${state.healthPath || '/'} 未通过）`);
    await stop(rt.slug, { keepDesired: true });
    throw fail('应用启动超时，详见运行日志', 'HOSTED_APP_START', 504);
}

/** 启动（必要时先安装依赖）；同一应用的并发调用合并为一次。 */
function start(slug) {
    const tenantId = tenant.getTenantId();
    const rt = runtimeOf(assertSlug(slug), tenantId);
    if (rt.status === 'running' && rt.child) return Promise.resolve(status(slug));
    if (rt.busy) return rt.busy;
    rt.busy = (async () => {
        const state = readState(slug, tenantId);
        if (!state) throw fail('应用不存在', 'HOSTED_APP_NOT_FOUND', 404);
        const installed = await install(slug);
        return launch(rt, installed);
    })().finally(() => { rt.busy = null; });
    return rt.busy;
}

function stop(slug, { keepDesired = false } = {}) {
    const tenantId = tenant.getTenantId();
    const rt = runtimeOf(assertSlug(slug), tenantId);
    if (!keepDesired) updateState(slug, { desired: 'stopped', status: 'stopped' }, tenantId);
    rt.crashes = [];
    const child = rt.child;
    if (!child) {
        if (rt.status !== 'installing') rt.status = 'stopped';
        return Promise.resolve(status(slug));
    }
    rt.stopping = true;
    return new Promise(resolve => {
        const done = () => resolve(tenant.runWithTenant(tenantId, () => status(slug)));
        child.once('exit', done);
        try { child.stdin.end(); } catch (_error) { /* 已关闭 */ }
        try { child.kill('SIGTERM'); } catch (_error) { /* 已退出 */ }
        setTimeout(() => { if (child.exitCode === null && !child.signalCode) killChild(child); }, 6000).unref();
    });
}

async function restart(slug) {
    await stop(slug, { keepDesired: true });
    return start(slug);
}

function status(slug) {
    const tenantId = tenant.getTenantId();
    const state = readState(assertSlug(slug), tenantId);
    if (!state) return null;
    const rt = runtimeOf(slug, tenantId);
    const live = rt.child ? rt.status : ['installing', 'install_failed'].includes(rt.status) ? rt.status
        : state.status === 'running' || state.status === 'starting' ? 'stopped' : state.status;
    return { slug, name: state.name, packageName: state.packageName, version: state.version, entry: state.entry, interface: state.interface, factory: state.factory,
        healthPath: state.healthPath, databaseContract: state.databaseContract || 'platform', status: rt.busy && !rt.child && live !== 'installing' ? 'starting' : live, port: rt.port, pid: rt.child?.pid || null,
        startedAt: rt.child ? new Date(rt.startedAt).toISOString() : null, lastError: state.lastError || '', installedAt: state.installedAt || null,
        python: state.python || null, offlineWheels: state.offlineWheels || 0, createdAt: state.createdAt, updatedAt: state.updatedAt };
}

function logs(slug, limit = 300) {
    const rt = runtimeOf(assertSlug(slug));
    let lines = rt.logs;
    if (!lines.length) {
        try { lines = fs.readFileSync(paths(slug).log, 'utf8').split('\n').filter(Boolean); } catch (_error) { lines = []; }
    }
    return lines.slice(-Math.min(MAX_LOG_LINES, Math.max(1, Number(limit) || 300)));
}

/** 是否有安装 / 启动 / 运行中的后台任务（状态文件写着「安装中」但这里为 false，说明任务没在跑，需要重新开始）。 */
function isActive(slug, tenantId = tenant.getTenantId()) {
    const rt = runtimes.get(keyOf(tenantId, slug));
    return Boolean(rt && (rt.busy || rt.installer || rt.child));
}

/** 代理用：返回正在运行的端口；未运行返回 null。 */
function target(slug, tenantId = tenant.getTenantId()) {
    const rt = runtimes.get(keyOf(tenantId, slug));
    return rt && rt.child && rt.status === 'running' ? { port: rt.port, secret: readState(slug, tenantId)?.secret } : null;
}

// ── 创建 / 更新 / 删除 ───────────────────────────────
function writeCode(dir, files) {
    fs.mkdirSync(dir, { recursive: true });
    const root = fs.realpathSync(dir);
    for (const [relative, content] of files) {
        const file = path.join(root, ...relative.split('/'));
        if (!file.startsWith(root + path.sep)) throw fail(`应用包路径越界：${relative}`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
}

function createApp(slug, inspected, meta = {}) {
    const tenantId = tenant.getTenantId();
    if (listSlugs(tenantId).length >= MAX_APPS_PER_TENANT) throw fail(`每个租户最多托管 ${MAX_APPS_PER_TENANT} 个 Python 应用`, 'HOSTED_APP_LIMIT', 409);
    const p = paths(slug, tenantId);
    if (fs.existsSync(p.state)) throw fail('应用已存在', 'HOSTED_APP_EXISTS', 409);
    try {
        writeCode(p.code, inspected.files);
        const now = new Date().toISOString();
        const state = writeState(slug, {
            slug, name: meta.name || inspected.config.name || slug, packageName: inspected.config.name || '', version: inspected.config.version,
            entry: inspected.config.entry, factory: inspected.config.factory, interface: inspected.config.interface, healthPath: inspected.config.healthPath,
            databaseContract: inspected.config.databaseContract || 'platform',
            requirementsHash: inspected.requirementsHash, offlineWheels: inspected.offlineWheels, uuid: crypto.randomUUID(),
            secret: crypto.randomBytes(32).toString('base64url'), dataToken: crypto.randomBytes(32).toString('base64url'),
            status: 'installing', desired: 'running', createdAt: now, updatedAt: now, createdBy: meta.user || ''
        }, tenantId);
        indexToken(tenantId, slug, state);
        return state;
    } catch (error) {
        fs.rmSync(p.base, { recursive: true, force: true });
        throw error;
    }
}

/** 更新代码：保留应用库、虚拟环境与密钥；依赖清单变化时重新安装。 */
async function updateApp(slug, inspected) {
    const tenantId = tenant.getTenantId();
    const state = readState(assertSlug(slug), tenantId);
    if (!state) throw fail('要更新的应用不存在', 'HOSTED_APP_NOT_FOUND', 404);
    const rt = runtimeOf(slug, tenantId);
    if (rt.busy || rt.status === 'installing') throw fail('应用正在安装或启动，请稍后再更新', 'HOSTED_APP_BUSY', 409);
    const wasRunning = Boolean(rt.child);
    await stop(slug, { keepDesired: true });
    const p = paths(slug, tenantId);
    const gitDir = path.join(p.code, '.git');
    const hasGit = fs.existsSync(gitDir);
    const staging = `${p.code}.new`;
    fs.rmSync(staging, { recursive: true, force: true });
    writeCode(staging, inspected.files);
    if (hasGit) {
        try { fs.renameSync(gitDir, path.join(staging, '.git')); } catch (_e) {}
    }
    fs.rmSync(`${p.code}.old`, { recursive: true, force: true });
    if (fs.existsSync(p.code)) fs.renameSync(p.code, `${p.code}.old`);
    fs.renameSync(staging, p.code);
    fs.rmSync(`${p.code}.old`, { recursive: true, force: true });
    if (hasGit) {
        try {
            const { execFileSync } = require('child_process');
            execFileSync('git', ['-C', p.code, 'add', '-A'], { encoding: 'utf8', stdio: 'pipe' });
            const msg = `chore: update package${inspected.config.version ? ` to ${inspected.config.version}` : ''}`;
            execFileSync('git', ['-C', p.code, 'commit', '-m', msg], { encoding: 'utf8', stdio: 'pipe' });
        } catch (_e) {}
    }
    log(rt, `应用代码已更新${inspected.config.version ? `到 ${inspected.config.version}` : ''}`);
    writeState(slug, { ...state, packageName: inspected.config.name || state.packageName, version: inspected.config.version, entry: inspected.config.entry,
        factory: inspected.config.factory, interface: inspected.config.interface, healthPath: inspected.config.healthPath,
        databaseContract: inspected.config.databaseContract || state.databaseContract || 'platform',
        requirementsHash: inspected.requirementsHash, offlineWheels: inspected.offlineWheels, updatedAt: new Date().toISOString() }, tenantId);
    return { state: readState(slug, tenantId), wasRunning };
}

async function removeApp(slug) {
    const tenantId = tenant.getTenantId();
    const state = readState(assertSlug(slug), tenantId);
    if (!state) return false;
    const rt = runtimeOf(slug, tenantId);
    if (rt.installer) killChild(rt.installer);
    await stop(slug, { keepDesired: true });
    await require('./data-api').closeAppDatabase(tenantId, slug);
    if (state.dataToken) tokenIndex.delete(state.dataToken);
    runtimes.delete(keyOf(tenantId, slug));
    fs.rmSync(appDir(slug, tenantId), { recursive: true, force: true });
    return true;
}

/** 保存导入时的原始应用包，供工具卡片下载（更新时覆盖为最新上传的包）。 */
function savePackage(slug, archive, archiveName) {
    const file = paths(assertSlug(slug)).package;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, archive);
    fs.renameSync(`${file}.tmp`, file);
    updateState(slug, { packageFile: String(archiveName || `${slug}.zip`).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) });
}

/** 原始应用包；早期导入没有保存原包时，用当前应用代码重新打包（不含平台生成的宿主模块）。 */
async function packageArchive(slug) {
    const state = readState(assertSlug(slug));
    if (!state) return null;
    const p = paths(slug);
    const filename = state.packageFile || `${state.packageName || slug}.zip`;
    if (fs.existsSync(p.package)) return { filename, buffer: fs.readFileSync(p.package), original: true };
    const JSZip = require('jszip');
    const zip = new JSZip();
    const root = state.packageName || slug;
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isSymbolicLink() || entry.name === '__pycache__' || (!prefix && entry.name === `${HOST_MODULE}.py`)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
            else zip.file(`${root}/${prefix}${entry.name}`, fs.readFileSync(full));
        }
    };
    walk(p.code, '');
    return { filename, buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), original: false };
}

function exists(slug, tenantId = tenant.getTenantId()) {
    return SLUG_RE.test(String(slug || '')) && Boolean(readState(slug, tenantId));
}

function listApps() {
    return listSlugs().map(slug => status(slug)).filter(Boolean);
}

/** 平台启动后恢复上次处于运行状态的应用；失败只记录日志。 */
async function recover(tenantIds) {
    for (const tenantId of tenantIds) {
        await tenant.runWithTenant(tenantId, async () => {
            for (const slug of listSlugs(tenantId)) {
                const state = readState(slug, tenantId);
                indexToken(tenantId, slug, state);
                if (state?.desired === 'running' && ['running', 'starting', 'crashed', 'stopped'].includes(state.status) && state.installedHash) {
                    start(slug).catch(error => console.warn(`[hosted-apps] ${tenantId}/${slug} 恢复启动失败：${error.message}`));
                }
            }
        });
    }
}

function shutdownAll() {
    for (const rt of runtimes.values()) {
        rt.stopping = true;
        if (rt.installer) killChild(rt.installer);
        if (rt.child) {
            try { rt.child.stdin.end(); } catch (_error) { /* 已关闭 */ }
            killChild(rt.child);
        }
    }
}

process.once('exit', shutdownAll);

module.exports = {
    paths, readState, updateState, getSettings, saveSettings, findPython, appEnv, install, start, stop, restart, status, logs, target,
    applyStartupSql, createApp, updateApp, removeApp, exists, listApps, isActive, savePackage, packageArchive, recover, shutdownAll, resolveDataToken, assertSlug, HOST_SOURCE
};
