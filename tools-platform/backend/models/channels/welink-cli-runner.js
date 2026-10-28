// welink-cli（@welink/welink-cli）适配层：定位安装、执行命令、扫码登录。
// CLI 以「本机 WeLink PC 上登录的本人」身份工作，凭据存在当前系统用户目录，所以配置按本机保存、只给默认租户用。
// 一律用 node 直接运行包的 bin 入口（参数数组、不经过 shell），绕开 Windows 的 .cmd 包装与 PowerShell 执行策略。
// 同一时刻只跑一个 CLI 进程：它要经本机 WebSocket 连 WeLink PC，云空间接口还有每秒 1 次的限流。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { BASE_DATA_DIR, DEFAULT_TENANT_ID, getTenantId } = require('../tenant-context');

const PACKAGE_NAME = '@welink/welink-cli';
const CONFIG_FILE = path.join(BASE_DATA_DIR, 'welink-cli.json');
const COMMAND_TIMEOUT_MS = 60000;
const LOGIN_TIMEOUT_MS = 5 * 60000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const INSTALL_HINT = `未检测到 welink-cli。请先安装：npm install -g ${PACKAGE_NAME} --registry=https://cmc.centralrepo.rnd.huawei.com/artifactory/api/npm/product_npm/ --strict-ssl=false，然后点击「重新检测」；也可以在「CLI 路径」里填写安装目录。`;
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const DEFAULT_CONFIG = { enabled: false, allowWrite: false, cliPath: '', env: '', email: '', verbose: false, downloadDir: '', updatedAt: null };
// 调用日志：最近若干条留在内存供设置页查看，同时追加写入本机日志文件（超过上限轮转一份）
const LOG_FILE = path.join(BASE_DATA_DIR, 'logs', 'welink-cli.log');
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const LOG_KEEP = 200;
const LOG_STDOUT_CHARS = 4000;
const LOG_STDERR_CHARS = 2000;

let cachedInstall = null;
let cachedUserInfo = null;
let cachedUserInfoAt = 0;
const USER_INFO_CACHE_TTL_MS = 15 * 60 * 1000;
let queue = Promise.resolve();
let logSeq = 0;
let recentLogs = [];
let running = null;
// 测试注入：替换定位结果与 node 可执行文件
let overrides = {};

function clearCache() {
    cachedInstall = null;
    cachedUserInfo = null;
    cachedUserInfoAt = 0;
}

function cliError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

// ── 配置（本机级） ─────────────────────────────────────────
function readConfig() {
    try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(overrides.configFile || CONFIG_FILE, 'utf8')) };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

function saveConfig(patch = {}) {
    const current = readConfig();
    const next = {
        enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
        cliPath: patch.cliPath === undefined ? current.cliPath : String(patch.cliPath || '').trim().slice(0, 500),
        env: patch.env === undefined ? current.env : (patch.env === 'pro' ? 'pro' : ''),
        email: patch.email === undefined ? current.email : String(patch.email || '').trim().slice(0, 200),
        verbose: patch.verbose === undefined ? Boolean(current.verbose) : Boolean(patch.verbose),
        allowWrite: patch.allowWrite === undefined ? Boolean(current.allowWrite) : Boolean(patch.allowWrite),
        downloadDir: patch.downloadDir === undefined ? String(current.downloadDir || '') : String(patch.downloadDir || '').trim().slice(0, 500),
        updatedAt: new Date().toISOString()
    };
    const file = overrides.configFile || CONFIG_FILE;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
    if (next.cliPath !== current.cliPath) clearCache();
    return next;
}

/** 下载（云空间文件、外链、邮件附件）统一落到这个目录；未配置时用 ~/Downloads/WeLink。 */
function downloadDir() {
    const configured = readConfig().downloadDir;
    const dir = configured && path.isAbsolute(configured) ? configured : path.join(os.homedir(), 'Downloads', 'WeLink');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** 本人身份的能力只开放给默认租户（桌面版 / 机器主人）。 */
function tenantAllowed(tenantId = getTenantId()) {
    return tenantId === DEFAULT_TENANT_ID;
}

function assertTenant() {
    if (!tenantAllowed()) throw cliError('WELINK_CLI_TENANT', 'welink-cli 使用本机登录的个人身份，只能在默认租户中使用', 403);
}

// ── 定位安装 ───────────────────────────────────────────────
function execText(command, args) {
    return new Promise(resolve => {
        execFile(command, args, { timeout: 8000, windowsHide: true, shell: process.platform === 'win32' && command === 'npm' }, (error, stdout) => {
            resolve(error ? '' : String(stdout || '').trim());
        });
    });
}

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function entryFromPackage(dir) {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg || pkg.name !== PACKAGE_NAME) return null;
    const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && (pkg.bin['welink-cli'] || Object.values(pkg.bin)[0]));
    if (!bin) return null;
    const entry = path.resolve(dir, bin);
    return fs.existsSync(entry) ? { entry, packageDir: dir, version: pkg.version || '' } : null;
}

/** npm 在 Windows 生成的 welink-cli.cmd 里写着 "%dp0%\node_modules\...\bin\xxx.js"，从中取出真实入口。 */
function entryFromCmdShim(file) {
    try {
        const text = fs.readFileSync(file, 'utf8');
        const match = text.match(/"%~?dp0%?\\([^"]*node_modules\\[^"]+)"/i);
        if (!match) return null;
        const entry = path.resolve(path.dirname(file), match[1].split('\\').join(path.sep));
        return fs.existsSync(entry) ? packageInfoForEntry(entry) : null;
    } catch {
        return null;
    }
}

function packageInfoForEntry(entry) {
    let cursor = path.dirname(entry);
    for (let i = 0; i < 6; i += 1) {
        const pkg = readJson(path.join(cursor, 'package.json'));
        if (pkg && pkg.name === PACKAGE_NAME) return { entry, packageDir: cursor, version: pkg.version || '' };
        cursor = path.dirname(cursor);
    }
    return { entry, packageDir: path.dirname(entry), version: '' };
}

/** 用户填写的路径：包目录 / node_modules 目录 / 入口 js / .cmd 包装。 */
function entryFromCustomPath(customPath) {
    const target = path.resolve(String(customPath || '').trim());
    if (!customPath || !fs.existsSync(target)) return null;
    if (fs.statSync(target).isDirectory()) {
        return entryFromPackage(target)
            || entryFromPackage(path.join(target, PACKAGE_NAME))
            || entryFromPackage(path.join(target, 'node_modules', PACKAGE_NAME))
            || entryFromPackage(path.join(target, 'lib', 'node_modules', PACKAGE_NAME));
    }
    if (/\.(cmd|bat|ps1)$/i.test(target)) return entryFromCmdShim(target.replace(/\.ps1$/i, '.cmd'));
    return packageInfoForEntry(fs.realpathSync(target));
}

async function globalRoots() {
    const roots = new Set();
    const npmRoot = await execText('npm', ['root', '-g']);
    if (npmRoot) roots.add(npmRoot);
    if (process.env.APPDATA) roots.add(path.join(process.env.APPDATA, 'npm', 'node_modules'));
    if (process.env.NVM_SYMLINK) roots.add(path.join(process.env.NVM_SYMLINK, 'node_modules'));
    if (process.env.npm_config_prefix) {
        roots.add(path.join(process.env.npm_config_prefix, 'node_modules'));
        roots.add(path.join(process.env.npm_config_prefix, 'lib', 'node_modules'));
    }
    roots.add(path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'));
    roots.add('/usr/local/lib/node_modules');
    roots.add('/opt/homebrew/lib/node_modules');
    return [...roots];
}

async function entryFromPath() {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    const lines = (await execText(lookup, ['welink-cli'])).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
        const found = /\.cmd$/i.test(line) ? entryFromCmdShim(line)
            : (fs.existsSync(`${line}.cmd`) ? entryFromCmdShim(`${line}.cmd`) : (process.platform === 'win32' || !fs.existsSync(line) ? null : packageInfoForEntry(fs.realpathSync(line))));
        if (found) return found;
    }
    return null;
}

/** 找 node：服务端直接用当前 node；桌面版（Electron）优先系统 node，找不到时让 Electron 以 node 模式运行。 */
async function resolveNode() {
    if (overrides.node) return overrides.node;
    if (!process.versions.electron) return { command: process.execPath, env: {} };
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    const systemNode = (await execText(lookup, ['node'])).split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (systemNode) return { command: systemNode, env: {} };
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

async function detect({ refresh = false } = {}) {
    if (overrides.install) return overrides.install;
    if (cachedInstall && !refresh) return cachedInstall;
    const config = readConfig();
    let found = null;
    let source = '';
    if (config.cliPath) {
        found = entryFromCustomPath(config.cliPath);
        source = 'custom';
    }
    if (!found) {
        for (const root of await globalRoots()) {
            found = entryFromPackage(path.join(root, PACKAGE_NAME));
            if (found) { source = 'npm-global'; break; }
        }
    }
    if (!found) {
        found = await entryFromPath();
        source = 'path';
    }
    cachedInstall = found
        ? { available: true, source, entry: found.entry, packageDir: found.packageDir, version: found.version }
        : { available: false, hint: config.cliPath ? `「${config.cliPath}」不是有效的 welink-cli 安装目录。${INSTALL_HINT}` : INSTALL_HINT };
    return cachedInstall;
}

// ── 执行 ───────────────────────────────────────────────────
function cleanText(text) {
    return String(text || '').replace(ANSI_RE, '').replace(/\r(?!\n)/g, '\n');
}

/**
 * 输出可能是纯 JSON，也可能前面带「Connecting to WeLink PC...」之类的进度行；
 * 依次尝试整体解析、从第一个以 { 或 [ 开头的行解析，都不行就返回文本。
 */
function parseOutput(stdout) {
    const text = cleanText(stdout).trim();
    if (!text) return { json: null, text: '' };
    try { return { json: JSON.parse(text), text }; } catch { /* 继续尝试 */ }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        if (!/^\s*[[{]/.test(lines[i])) continue;
        try { return { json: JSON.parse(lines.slice(i).join('\n')), text, prefix: lines.slice(0, i).join('\n').trim() }; } catch { /* 下一行 */ }
    }
    return { json: null, text };
}

// ── 调用日志 ─────────────────────────────────────────────
function logFile() {
    return overrides.logFile || LOG_FILE;
}

function appendLog(entry) {
    recentLogs.push(entry);
    if (recentLogs.length > LOG_KEEP) recentLogs = recentLogs.slice(-LOG_KEEP);
    try {
        const file = logFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        try {
            if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
        } catch { /* 尚无日志文件 */ }
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch (error) {
        console.warn('[welink-cli] 写调用日志失败:', error.message);
    }
}

/** 最近的调用记录（新的在前）与正在执行的命令。 */
function logs({ limit = 50 } = {}) {
    const size = Math.max(1, Math.min(LOG_KEEP, Number(limit) || 50));
    return {
        items: recentLogs.slice(-size).reverse(),
        running: running ? { ...running, elapsedMs: Date.now() - running.startedAt } : null,
        file: logFile()
    };
}

function clearLogs() {
    recentLogs = [];
    try { fs.rmSync(logFile(), { force: true }); } catch { /* 忽略 */ }
}

function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
}

function killChild(child) {
    if (!child || child.exitCode !== null) return;
    try { child.kill(); } catch { /* 已退出 */ }
}

async function spawnCli(args, options = {}) {
    const startedAt = Date.now();
    const command = ['welink-cli', ...args].map(arg => (/[\s"]/.test(arg) ? JSON.stringify(arg) : arg)).join(' ');
    const id = ++logSeq;
    running = { id, command, startedAt, queuedMs: options.enqueuedAt ? startedAt - options.enqueuedAt : 0 };
    const entry = { id, at: new Date(startedAt).toISOString(), command, queuedMs: running.queuedMs };
    try {
        const result = await spawnCliRaw(args, options);
        appendLog({ ...entry, durationMs: Date.now() - startedAt, code: result.code, stdout: result.stdout.slice(0, LOG_STDOUT_CHARS), stdoutChars: result.stdout.length, stderr: result.stderr.slice(0, LOG_STDERR_CHARS) });
        return result;
    } catch (error) {
        appendLog({ ...entry, durationMs: Date.now() - startedAt, code: null, error: `${error.code || 'ERROR'}: ${error.message}` });
        throw error;
    } finally {
        if (running?.id === id) running = null;
    }
}

async function spawnCliRaw(args, { timeoutMs = COMMAND_TIMEOUT_MS, signal, onLine } = {}) {
    const install = await detect();
    if (!install.available) throw cliError('WELINK_CLI_NOT_FOUND', install.hint, 404);
    const node = await resolveNode();
    return new Promise((resolve, reject) => {
        const child = spawn(node.command, [install.entry, ...args], {
            cwd: os.homedir(),
            env: { ...process.env, ...node.env, NO_COLOR: '1', FORCE_COLOR: '0' },
            windowsHide: true,
            shell: false
        });
        let stdout = '';
        let stderr = '';
        let pending = '';
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', onAbort);
            if (error) reject(error); else resolve(value);
        };
        const onAbort = () => { killChild(child); finish(cliError('WELINK_CLI_ABORTED', '已取消')); };
        const timer = setTimeout(() => {
            killChild(child);
            finish(cliError('WELINK_CLI_TIMEOUT', `welink-cli 超过 ${Math.round(timeoutMs / 1000)} 秒未返回，请确认 WeLink PC 已启动并登录`, 504));
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
        if (signal?.aborted) return onAbort();
        signal?.addEventListener?.('abort', onAbort, { once: true });
        const emitLines = (chunk, final) => {
            if (!onLine) return;
            pending += cleanText(chunk);
            const lines = pending.split('\n');
            pending = final ? '' : lines.pop();
            lines.forEach(line => onLine(line));
        };
        child.stdout.on('data', chunk => {
            if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8');
            emitLines(chunk.toString('utf8'), false);
        });
        child.stderr.on('data', chunk => {
            if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8');
            emitLines(chunk.toString('utf8'), false);
        });
        child.on('error', error => finish(cliError('WELINK_CLI_SPAWN_FAILED', `无法启动 welink-cli：${error.message}`, 500)));
        child.on('close', code => {
            emitLines('', true);
            finish(null, { code, stdout: cleanText(stdout), stderr: cleanText(stderr) });
        });
    });
}

function failureMessage(result) {
    const lines = `${result.stderr}\n${result.stdout}`.split('\n').map(line => line.trim()).filter(Boolean);
    return lines.slice(-6).join('\n') || `退出码 ${result.code}`;
}

/** 执行一条命令（排队），返回 { ok, code, json, text, stderr }。 */
function run(args, options = {}) {
    const isUserInfo = args.length === 2 && args[0] === 'onebox' && args[1] === 'user-info';
    if (isUserInfo && !options.refresh && cachedUserInfo && Date.now() - cachedUserInfoAt < USER_INFO_CACHE_TTL_MS) {
        return Promise.resolve(cachedUserInfo);
    }
    const enqueuedAt = Date.now();
    return enqueue(async () => {
        if (isUserInfo && !options.refresh && cachedUserInfo && Date.now() - cachedUserInfoAt < USER_INFO_CACHE_TTL_MS) {
            return cachedUserInfo;
        }
        const result = await spawnCli(args, { ...options, enqueuedAt });
        const parsed = parseOutput(result.stdout);
        // 有的 CLI 出错仍以 0 退出、只在 JSON 里写 success:false
        const jsonFailed = parsed.json && typeof parsed.json === 'object' && !Array.isArray(parsed.json) && parsed.json.success === false;
        const res = {
            ok: result.code === 0 && !jsonFailed,
            code: result.code,
            json: parsed.json,
            text: parsed.text,
            stderr: result.stderr.trim(),
            raw: result.stdout,
            error: result.code === 0 && !jsonFailed ? '' : (jsonFailed ? String(parsed.json.message || parsed.json.error || failureMessage(result)) : failureMessage(result))
        };
        if (isUserInfo && res.ok && res.json) {
            cachedUserInfo = res;
            cachedUserInfoAt = Date.now();
        }
        return res;
    });
}

async function version() {
    const result = await run(['--version'], { timeoutMs: 15000 });
    const match = `${result.text}\n${result.stderr}`.match(/\d+\.\d+\.\d+[\w.-]*/);
    return match ? match[0] : '';
}

/** 「  Key:   value」形式的行（auth status 的文本输出）读成 { key: value }，键统一小写。 */
function readFields(text) {
    const fields = {};
    for (const line of String(text || '').split('\n')) {
        const match = line.match(/^\s*([A-Za-z][\w ]*?)\s*:\s+(\S.*?)\s*$/);
        if (match) fields[match[1].toLowerCase()] = match[2];
    }
    return fields;
}

/**
 * 解析 auth status。1.0.16 的真实输出：
 *   Configuration:
 *     Environment:  pro
 *   Credentials:
 *     User Token:   valid (expires in 62m34s)
 *     UID:          dwx1545337
 * 「User Token」为 valid 即已登录；不是 valid 但有可用的 Refresh Token 时 CLI 会在调用时自动刷新，也算已登录。
 * 其他格式退回关键字判断，判断不了时 loggedIn 为 null。
 */
function interpretAuthStatus(result) {
    const text = `${result.text}\n${result.stderr}`.trim();
    const json = result.json && typeof result.json === 'object' ? result.json : null;
    const fields = readFields(text);
    const isValid = value => /^valid\b/i.test(String(value || ''));
    const userToken = fields['user token'];
    const refreshToken = fields['refresh token'];
    const expires = String(userToken || '').match(/expires\s+in\s+([^)]+)/i);
    let loggedIn = null;
    if (json) {
        for (const key of ['loggedIn', 'isLoggedIn', 'login', 'authenticated', 'isLogin']) {
            if (typeof json[key] === 'boolean') loggedIn = json[key];
        }
    }
    if (loggedIn === null && userToken !== undefined) loggedIn = isValid(userToken) || isValid(refreshToken);
    if (loggedIn === null) {
        if (/not\s+logged\s*in|not\s+authenticated|no\s+(saved\s+)?credentials|未登录|未授权|please\s+(run\s+)?.*login/i.test(text)) loggedIn = false;
        else if (/logged\s*in|authenticated|已登录|已授权|token\s+valid/i.test(text)) loggedIn = true;
        else if (!result.ok) loggedIn = false;
    }
    return {
        loggedIn,
        uid: fields.uid || '',
        environment: fields.environment || '',
        token: userToken || '',
        expiresIn: expires ? expires[1].trim() : '',
        refreshing: loggedIn === true && userToken !== undefined && !isValid(userToken),
        text: text.slice(0, 4000)
    };
}

async function authStatus() {
    return interpretAuthStatus(await run(['auth', 'status'], { timeoutMs: 30000 }));
}

async function logout() {
    const result = await run(['auth', 'logout'], { timeoutMs: 30000 });
    if (!result.ok) throw cliError('WELINK_CLI_LOGOUT_FAILED', `注销失败：${result.error}`, 502);
    return { ok: true, text: result.text };
}

async function autodiscover(email) {
    const value = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(value)) throw cliError('WELINK_CLI_EMAIL', '请填写有效的邮箱地址');
    const result = await run(['mail', 'autodiscover', '--email', value], { timeoutMs: 60000 });
    if (!result.ok) throw cliError('WELINK_CLI_AUTODISCOVER_FAILED', `邮箱服务器发现失败：${result.error}`, 502);
    saveConfig({ email: value });
    return { ok: true, result: result.json || result.text };
}

/**
 * 解析 auth login 的一行输出，返回要推给前端的事件（null 表示只作为日志）。
 * 参考输出：Connecting to WeLink PC... / Obtaining QR code... / 字符二维码 /
 * "If QR code is not displayed correctly, open this URL to scan:" + URL / Waiting for scan... (elapsed N seconds) /
 * Scan successful! / Login successful. Credentials cached.
 */
function classifyLoginLine(line) {
    const text = String(line || '').trim();
    const url = text.match(/https?:\/\/\S+/);
    if (url && /qrcode|qr/i.test(url[0])) return { type: 'qrcode', url: url[0] };
    if (/waiting\s+for\s+scan/i.test(text)) {
        const elapsed = text.match(/elapsed\s+(\d+)/i);
        return { type: 'waiting', elapsed: elapsed ? Number(elapsed[1]) : null };
    }
    if (/scan\s+successful/i.test(text)) return { type: 'scanned' };
    if (/login\s+successful/i.test(text)) return { type: 'success' };
    if (/expired|过期/i.test(text)) return { type: 'expired', message: text };
    return null;
}

/**
 * 扫码登录：逐行回调进度。已有可刷新的凭据时 CLI 会直接刷新 token、不出二维码。
 * onEvent({ type: 'log'|'qrcode'|'qrtext'|'waiting'|'scanned'|'success'|'expired', ... })
 */
function login({ env, onEvent = () => {}, signal } = {}) {
    const config = readConfig();
    const args = ['auth', 'login'];
    const chosen = env === undefined ? config.env : env;
    if (chosen === 'pro') args.push('--env', 'pro');
    const enqueuedAt = Date.now();
    return enqueue(async () => {
        let succeeded = false;
        let qrLines = null;
        const result = await spawnCli(args, {
            timeoutMs: LOGIN_TIMEOUT_MS,
            enqueuedAt,
            signal,
            onLine: raw => {
                const line = raw.replace(/\s+$/, '');
                // 字符二维码：在 +----+ 边框之间原样收集，供链接图片打不开时兜底
                if (/^\s*\+-{8,}\+?\s*$/.test(line)) {
                    if (qrLines === null) { qrLines = []; return; }
                    onEvent({ type: 'qrtext', text: qrLines.join('\n') });
                    qrLines = null;
                    return;
                }
                if (qrLines !== null) { qrLines.push(line); return; }
                if (!line.trim()) return;
                const event = classifyLoginLine(line);
                if (event?.type === 'success') succeeded = true;
                onEvent(event || { type: 'log', text: line.trim().slice(0, 300) });
            }
        });
        if (result.code !== 0 || !succeeded) {
            throw cliError('WELINK_CLI_LOGIN_FAILED', `登录未完成：${failureMessage(result)}`, 502);
        }
        return { ok: true };
    });
}

function reset() {
    clearCache();
}

function setOverridesForTest(next = {}) {
    overrides = next;
    clearCache();
    queue = Promise.resolve();
    recentLogs = [];
    running = null;
}

module.exports = {
    PACKAGE_NAME, COMMAND_TIMEOUT_MS,
    readConfig, saveConfig, downloadDir, tenantAllowed, assertTenant,
    detect, reset, run, version, authStatus, logout, autodiscover, login, logs, clearLogs,
    parseOutput, interpretAuthStatus, classifyLoginLine, entryFromCmdShim, entryFromCustomPath,
    setOverridesForTest
};
