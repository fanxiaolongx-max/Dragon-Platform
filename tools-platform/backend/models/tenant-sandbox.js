// 团队账号的命令沙箱：AI 的 run_command、交互式命令与终端面板都经这里包裹。
// - macOS：系统自带 sandbox-exec（Seatbelt）。可读系统目录，读不到服务器用户目录、外置盘、平台数据与源码目录、系统临时目录；
//   只能写本团队的 workspace / home / tmp。网络不限。
// - Linux：bubblewrap（bwrap）。只读挂载系统目录，读写挂载本团队目录，/tmp 为私有 tmpfs；共享网络。
// - Windows：没有可用的轻量沙箱，团队账号的命令与终端直接禁用（失败即关闭）。
// 超级管理员不经过沙箱。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const tenant = require('./tenant-context');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
let cachedStatus = null;

function sandboxError(message) {
    const error = new Error(message);
    error.code = 'AGENT_SANDBOX_UNAVAILABLE';
    error.statusCode = 503;
    return error;
}

function real(dir) {
    try { return fs.realpathSync(dir); } catch (_error) { return path.resolve(dir); }
}

function findOnPath(name) {
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
        if (!dir) continue;
        const file = path.join(dir, name);
        try { fs.accessSync(file, fs.constants.X_OK); return file; } catch (_error) { /* 继续 */ }
    }
    return '';
}

/** Node 安装前缀：命令里常要用 node / npm，前缀在被屏蔽的目录（如 ~/.nvm）里时单独放行只读 */
function nodePrefix() {
    const prefix = real(path.dirname(path.dirname(process.execPath)));
    return ['/', '/usr', '/usr/local', '/opt/homebrew'].includes(prefix) ? '' : prefix;
}

/**
 * 用真实的沙箱规则跑一次空命令：只验证「sandbox-exec / bwrap 能启动」不够——
 * 平台本身已处在另一层沙箱里、或内核不允许时，带 deny 规则的真实配置会直接失败。
 */
function probe(kind, bwrap) {
    const dir = real(fs.mkdtempSync(path.join(os.tmpdir(), 'team-sandbox-probe-')));
    try {
        const dirs = { workspace: dir, home: dir, tmp: dir };
        const result = kind === 'seatbelt'
            ? spawnSync('/usr/bin/sandbox-exec', ['-p', seatbeltProfile(dirs), '/usr/bin/true'], { timeout: 5000, encoding: 'utf8' })
            : spawnSync(bwrap, [...bwrapArgs(dirs, dir), '--', 'true'], { timeout: 5000, encoding: 'utf8' });
        return result.status === 0 ? '' : String(result.stderr || result.error?.message || `退出码 ${result.status}`).trim().split('\n').pop().slice(0, 200) || '启动失败';
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const UNAVAILABLE_RECHECK_MS = 60 * 1000;

function status() {
    // 可用的结果一直缓存；不可用的结果只缓存一分钟，装好 bwrap / 放开内核限制后不用重启平台
    if (cachedStatus && (cachedStatus.available || Date.now() - cachedStatus.checkedAt < UNAVAILABLE_RECHECK_MS)) return cachedStatus;
    cachedStatus = { ...detect(), checkedAt: Date.now() };
    return cachedStatus;
}

function detect() {
    if (process.env.TOOLS_SANDBOX_DISABLED === '1') return { available: false, kind: 'none', reason: '已通过 TOOLS_SANDBOX_DISABLED 关闭沙箱' };
    if (process.platform === 'darwin') {
        if (!fs.existsSync('/usr/bin/sandbox-exec')) return { available: false, kind: 'seatbelt', reason: '本机没有 sandbox-exec' };
        const failure = probe('seatbelt');
        return failure ? { available: false, kind: 'seatbelt', reason: `本机 sandbox-exec 无法应用团队沙箱规则（${failure}）；平台自身运行在沙箱里时会这样` } : { available: true, kind: 'seatbelt' };
    }
    if (process.platform === 'linux') {
        const bwrap = findOnPath('bwrap');
        if (!bwrap) return { available: false, kind: 'bwrap', reason: '服务器未安装 bubblewrap（apt install bubblewrap）' };
        const failure = probe('bwrap', bwrap);
        return failure ? { available: false, kind: 'bwrap', reason: `bwrap 无法建立团队沙箱（${failure}）；Ubuntu 24.04 需放开 kernel.apparmor_restrict_unprivileged_userns 或为 bwrap 配 AppArmor 规则` } : { available: true, kind: 'bwrap', bwrap };
    }
    return { available: false, kind: 'none', reason: 'Windows 服务器不支持团队命令沙箱，团队账号无法执行命令' };
}

function teamDirs(tenantId) {
    const dirs = tenant.ensureUserSpaceDirs(tenantId);
    return { workspace: real(dirs.workspace), home: real(dirs.home), tmp: real(dirs.tmp) };
}

/** 沙箱内的环境变量：HOME / 临时目录 / 用户级包管理器都指向团队目录 */
function sandboxEnv(baseEnv, dirs) {
    const env = { ...baseEnv };
    for (const key of Object.keys(env)) {
        if (/^(TOOLS_|DRAGON_CLAW_INTERNAL|PM2_|npm_config_|NVM_)/.test(key) || /^(HISTFILE|ZDOTDIR|OLDPWD|PWD|BASH_ENV|ENV|INIT_CWD|LOGNAME_HOME)$/.test(key)) delete env[key];
    }
    const npmPrefix = path.join(dirs.home, '.npm-global');
    Object.assign(env, {
        HOME: dirs.home, USERPROFILE: dirs.home, TMPDIR: dirs.tmp, TMP: dirs.tmp, TEMP: dirs.tmp,
        XDG_CONFIG_HOME: path.join(dirs.home, '.config'), XDG_CACHE_HOME: path.join(dirs.home, '.cache'), XDG_DATA_HOME: path.join(dirs.home, '.local', 'share'),
        npm_config_prefix: npmPrefix, npm_config_cache: path.join(dirs.home, '.npm'), PIP_CACHE_DIR: path.join(dirs.home, '.cache', 'pip'),
        PYTHONUSERBASE: path.join(dirs.home, '.local'), DRAGON_CLAW_SANDBOX: '1'
    });
    env.PATH = [path.join(npmPrefix, 'bin'), path.join(dirs.home, '.local', 'bin'), env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'].join(path.delimiter);
    return env;
}

function sbplString(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** macOS Seatbelt 规则：后写的规则优先，但放行规则必须写出与拒绝规则相同的具体操作（file-read* 盖不住 file-read-data）*/
function seatbeltProfile(dirs) {
    const rule = dirs => [...new Set(dirs)].map(dir => `(subpath ${sbplString(dir)})`).join(' ');
    // 用户与数据所在的目录：连目录项属性都不给看（cd、ls 都进不去）
    const hidden = rule(['/Users', '/Volumes', real(os.homedir()), real(tenant.BASE_DATA_DIR), real(tenant.BASE_REPORT_DATA_DIR), real(PROJECT_ROOT)]);
    // 系统临时与日志目录：系统框架启动时要查看属性，只拦内容
    const contentOnly = rule(['/private/var/folders', '/private/tmp', '/private/var/root', '/private/var/log', real(os.tmpdir())]);
    const team = [dirs.workspace, dirs.home, dirs.tmp].map(dir => `(subpath ${sbplString(dir)})`).join(' ');
    const prefix = nodePrefix();
    // 进入团队目录 / Node 安装目录要逐级解析上层路径：只给这几级上层目录放行「看目录项属性」，其余受保护路径连 cd 都进不去
    const ancestors = new Set();
    for (const dir of [dirs.workspace, dirs.home, dirs.tmp, prefix].filter(Boolean)) {
        for (let current = path.dirname(dir); current !== path.dirname(current); current = path.dirname(current)) ancestors.add(current);
    }
    const ancestorRules = [...ancestors].map(dir => `(literal ${sbplString(dir)})`).join(' ');
    return [
        '(version 1)',
        '(allow default)',
        `(deny file-read-data file-read-xattr ${contentOnly})`,
        `(deny file-read-data file-read-xattr file-read-metadata ${hidden})`,
        ancestorRules ? `(allow file-read-metadata ${ancestorRules})` : '',
        prefix ? `(allow file-read-data file-read-xattr file-read-metadata (subpath ${sbplString(prefix)}))` : '',
        '(deny file-write*)',
        '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (regex #"^/dev/tty") (regex #"^/dev/fd/") (regex #"^/dev/ptmx$"))',
        `(allow file-read-data file-read-xattr file-read-metadata file-write* ${team})`
    ].filter(Boolean).join('\n');
}

function bwrapArgs(dirs, cwd) {
    const args = ['--die-with-parent', '--new-session', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--share-net'];
    // 只挂系统程序目录；/opt、/srv、/home 这类常放应用与数据的目录一律不挂（平台本身可能就装在 /opt 下）
    for (const dir of ['/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/etc']) args.push('--ro-bind-try', dir, dir);
    const prefix = nodePrefix();
    if (prefix) args.push('--ro-bind-try', prefix, prefix);
    args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run');
    // 平台数据、源码、服务账号家目录即使落在上面挂载的目录里，也用空目录盖掉；之后再挂团队自己的目录
    for (const dir of [...new Set([tenant.BASE_DATA_DIR, tenant.BASE_REPORT_DATA_DIR, PROJECT_ROOT, os.homedir()].map(real))]) {
        if (dir && dir !== '/' && !(prefix && (prefix === dir || prefix.startsWith(dir + path.sep)))) args.push('--tmpfs', dir);
    }
    // /etc 是只读挂载的宿主目录：屏蔽口令库、sudo 配置与各类私钥（平台以 root 运行时只读挂载也挡不住读取）
    for (const file of ['/etc/shadow', '/etc/shadow-', '/etc/gshadow', '/etc/gshadow-', '/etc/sudoers', '/etc/security/opasswd']) args.push('--ro-bind-try', '/dev/null', file);
    for (const dir of ['/etc/ssh', '/etc/ssl/private', '/etc/sudoers.d', '/etc/letsencrypt', '/etc/wireguard', '/etc/NetworkManager/system-connections']) {
        if (fs.existsSync(dir)) args.push('--tmpfs', dir);
    }
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--cap-drop', 'ALL'); // root 运行时去掉全部特权
    for (const dir of [dirs.workspace, dirs.home, dirs.tmp]) args.push('--bind', dir, dir);
    args.push('--chdir', cwd);
    return args;
}

/**
 * 把一条命令包进团队沙箱。
 * @returns {{ file: string, args: string[], env: object, cwd: string }}
 */
function wrap({ tenantId, cwd, file, args = [], env = process.env }) {
    const info = status();
    if (!info.available) throw sandboxError(`团队命令沙箱不可用：${info.reason}`);
    const dirs = teamDirs(tenantId);
    const workdir = real(cwd || dirs.workspace);
    const inside = [dirs.workspace, dirs.home, dirs.tmp].some(root => workdir === root || workdir.startsWith(root + path.sep));
    if (!inside) throw sandboxError('命令的工作目录不在团队空间内');
    const sandboxedEnv = sandboxEnv(env, dirs);
    if (info.kind === 'seatbelt') {
        return { file: '/usr/bin/sandbox-exec', args: ['-p', seatbeltProfile(dirs), file, ...args], env: sandboxedEnv, cwd: workdir };
    }
    return { file: info.bwrap, args: [...bwrapArgs(dirs, workdir), '--', file, ...args], env: sandboxedEnv, cwd: workdir };
}

/** 路径属于哪个团队空间（data/tenants/<id>/…）；不属于任何团队返回空串 */
function tenantForPath(target) {
    if (!target) return '';
    const root = real(tenant.TENANTS_ROOT);
    const value = real(target);
    const rel = path.relative(root, value);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
    const id = rel.split(path.sep)[0];
    return tenant.normalizeTenantId(id) === id ? id : '';
}

/**
 * 平台在服务端对团队目录执行的程序（git status / 切分支 / 建 PR 等）：仓库配置与 hooks 由团队控制，
 * 可能让 git 执行任意命令，所以 cwd 在团队空间时同样放进沙箱；其他目录照常执行。参数与 child_process.execFile 相同。
 */
function execFileAware(file, args, options = {}, callback) {
    const { execFile } = require('child_process');
    const tenantId = tenantForPath(options.cwd);
    if (!tenantId) return execFile(file, args, options, callback);
    let launch;
    try {
        launch = wrap({ tenantId, cwd: options.cwd, file, args, env: options.env || process.env });
    } catch (error) {
        setImmediate(() => callback(error, options.encoding === 'buffer' ? Buffer.alloc(0) : '', options.encoding === 'buffer' ? Buffer.alloc(0) : ''));
        return null;
    }
    return execFile(launch.file, launch.args, { ...options, cwd: launch.cwd, env: launch.env }, callback);
}

function resetForTest() { cachedStatus = null; }

module.exports = { execFileAware, resetForTest, sandboxEnv, seatbeltProfile, status, teamDirs, tenantForPath, wrap };
