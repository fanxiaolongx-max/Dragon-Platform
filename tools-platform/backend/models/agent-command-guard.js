// Dragon Claw 工作区：命令风险检查。
// run_command 以后端系统账号权限执行任意 shell，路径守卫管不到命令本身；跨平台的真正隔离需要系统沙箱。
// 这里做静态检查：命令引用工作目录之外的路径、主目录或密钥文件时标记为风险，
// 风险命令无论权限模式或「总是允许」都必须逐条经用户批准，审批卡上写明原因。
// 这是提醒与把关，不是沙箱：变量拼接、脚本内部访问等无法静态识别。
const os = require('os');
const path = require('path');
const guard = require('./agent-path-guard');

const MAX_REASONS = 5;

// 只作为程序路径或系统设备出现的位置，不视为越界访问
const POSIX_SAFE_PREFIXES = ['/bin/', '/usr/bin/', '/usr/sbin/', '/sbin/', '/usr/local/bin/', '/opt/homebrew/bin/', '/usr/libexec/', '/dev/null', '/dev/stdout', '/dev/stderr', '/dev/stdin', '/dev/tty'];
const HOME_VARIABLE_RE = /\$\{?HOME\}?|\$\{?USERPROFILE\}?|%USERPROFILE%|%HOMEPATH%|%APPDATA%|%LOCALAPPDATA%|\$env:(USERPROFILE|HOME|APPDATA)/i;

// 粗粒度分词：按空白与 shell 运算符切分，去掉引号；足够发现路径类参数
function tokenize(command) {
    const tokens = [];
    const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s;&|<>()`]+)/g;
    let match;
    while ((match = re.exec(String(command || '')))) {
        const value = match[1] ?? match[2] ?? match[3] ?? '';
        if (value) tokens.push(value);
    }
    return tokens;
}

// 选项里的路径（--out=/etc/x、-o/etc/x 不处理，只取 = 号后面）
function pathCandidate(token) {
    const eq = token.indexOf('=');
    if (token.startsWith('-') && eq > 0) return token.slice(eq + 1);
    if (token.startsWith('-')) return '';
    return token;
}

function isAbsoluteLike(value, platform) {
    if (platform === 'win32') return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
    return value.startsWith('/');
}

function safeSystemPath(value, platform) {
    if (platform === 'win32') return /^[a-zA-Z]:[\\/]windows[\\/]system32[\\/]/i.test(value) || /^nul$/i.test(value);
    if (POSIX_SAFE_PREFIXES.some(prefix => value === prefix.replace(/\/$/, '') || value.startsWith(prefix))) return true;
    const tmp = os.tmpdir();
    return value === '/tmp' || value.startsWith('/tmp/') || value.startsWith('/private/tmp/') || (tmp && (value === tmp || value.startsWith(`${tmp}${path.sep}`)));
}

/**
 * @param {string} command
 * @param {string} root 工作目录（真实路径）
 * @returns {{ risky: boolean, reasons: string[] }}
 */
function assessCommand(command, root, { platform = process.platform, home = os.homedir() } = {}) {
    const reasons = [];
    const add = text => { if (!reasons.includes(text) && reasons.length < MAX_REASONS) reasons.push(text); };
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const text = String(command || '');
    if (HOME_VARIABLE_RE.test(text)) add('引用了主目录等环境变量，可能访问工作目录之外');
    for (const token of tokenize(text)) {
        const candidate = pathCandidate(token);
        if (!candidate || /^[a-z][\w+.-]*:\/\//i.test(candidate)) continue; // URL
        let resolved = null;
        if (candidate === '~' || candidate.startsWith('~/') || candidate.startsWith('~\\')) {
            resolved = pathApi.join(home, candidate.slice(1));
        } else if (isAbsoluteLike(candidate, platform)) {
            if (safeSystemPath(candidate, platform)) continue;
            resolved = pathApi.resolve(candidate);
        } else if (/(^|[\\/])\.\.([\\/]|$)/.test(candidate)) {
            resolved = pathApi.resolve(root, candidate);
        }
        if (resolved && !(guard.samePath(resolved, root) || guard.isInside(root, resolved))) {
            add(`访问工作目录之外的路径：${candidate}`);
            continue;
        }
        if (guard.isSecretFile(candidate)) add(`涉及密钥或环境变量文件：${candidate}`);
    }
    return { risky: reasons.length > 0, reasons };
}

module.exports = { assessCommand, _internal: { tokenize } };
