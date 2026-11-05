// Dragon Claw 工作区：把模型给出的路径约束在用户选定的根目录内。
// 任何权限模式都不允许越界；符号链接通过 realpath 校验最深已存在的祖先目录。
const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'vendor', 'coverage', '.cache', '__pycache__', '.venv', 'venv', 'target']);
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.db', '.sqlite', '.sqlite3', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.mov', '.avi', '.xlsx', '.xls', '.docx', '.pptx', '.jar', '.class', '.o', '.a', '.bin']);
// 默认不让模型读到的敏感文件（AGENTS.md：密钥、Token 不进 AI）。
const SECRET_FILE_RE = /(^|[\\/])(\.env(\.[^\\/]*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa[^\\/]*|id_ed25519[^\\/]*|.*\.keystore|secrets?\.(json|ya?ml|toml))$/i;

/** Windows 文件系统大小写不敏感：比较路径时统一忽略大小写（path.win32.relative 本身也如此）。 */
function samePath(a, b) {
    if (process.platform !== 'win32') return a === b;
    return String(a).toLowerCase() === String(b).toLowerCase();
}

function isInside(dir, filePath) {
    const rel = path.relative(dir, filePath);
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function pathError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function normalizeRoot(root) {
    const value = String(root || '').trim();
    if (!value) throw pathError('AGENT_ROOT_REQUIRED', '尚未选择工作目录');
    const resolved = path.resolve(value);
    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch (_error) {
        throw pathError('AGENT_ROOT_NOT_FOUND', `目录不存在：${resolved}`);
    }
    if (!stat.isDirectory()) throw pathError('AGENT_ROOT_NOT_DIR', `不是目录：${resolved}`);
    return fs.realpathSync(resolved);
}

/**
 * 把相对/绝对输入解析为绝对路径。
 * - 默认（allowOutside=false）：约束在根目录内，允许指向尚不存在的文件（用于新建），最深已存在的祖先必须在根内（防 symlink 逃逸）。
 * - 完全访问（allowOutside=true）：允许指向工作目录之外的路径，但敏感凭据与操作系统核心目录依然受到保护。
 */
function resolveInsideRoot(root, input, { allowOutside = false } = {}) {
    const rel = input ?? '.';
    if (typeof rel !== 'string' || /[\x00-\x1f\x7f]/.test(rel)) throw pathError('AGENT_PATH_INVALID', '路径包含非法字符或不是字符串。请检查 JSON 转义，Windows/macOS 均推荐使用 / 分隔符');
    if (/^[a-z]:($|[^\\/])/i.test(rel)) throw pathError('AGENT_PATH_INVALID', '不支持盘符相对路径，请使用工作目录内的相对路径或完整绝对路径');
    if (process.platform !== 'win32' && (/^[a-z]:[\\/]/i.test(rel) || /^\\\\/.test(rel))) {
        throw pathError('AGENT_PATH_INVALID', '当前系统不支持 Windows 盘符或 UNC 绝对路径，请使用相对工作目录的路径');
    }
    const abs = (allowOutside && path.isAbsolute(rel)) ? path.resolve(rel) : path.resolve(root, rel);
    if (!allowOutside) {
        if (!samePath(abs, root) && !isInside(root, abs)) throw pathError('AGENT_PATH_OUTSIDE', `路径超出工作目录：${rel}`);
        let probe = abs;
        while (!fs.existsSync(probe)) {
            const parent = path.dirname(probe);
            if (parent === probe) break;
            probe = parent;
        }
        const real = fs.realpathSync(probe);
        if (!samePath(real, root) && !isInside(root, real)) throw pathError('AGENT_PATH_OUTSIDE', `路径通过链接指向工作目录之外：${rel}`);
    }
    return abs;
}

function toDisplayPath(root, abs) {
    if (!root) return abs;
    const rel = path.relative(root, abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel ? rel.split(path.sep).join('/') : '.';
    }
    return abs;
}

function isSystemCriticalPath(filePath) {
    const abs = path.resolve(filePath);
    if (process.platform === 'win32') {
        const rootParsed = path.win32.parse(abs);
        if (samePath(abs, rootParsed.root)) return true;
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        for (const sys of [systemRoot, progFiles, progFilesX86]) {
            if (sys && (samePath(abs, sys) || isInside(sys, abs))) return true;
        }
    } else {
        if (abs === '/') return true;
        for (const sys of ['/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/private/etc', '/var/db']) {
            if (samePath(abs, sys) || isInside(sys, abs)) return true;
        }
    }
    return false;
}

function assertNotSystemCritical(filePath, action = '修改') {
    if (isSystemCriticalPath(filePath)) {
        throw pathError('AGENT_PROTECTED_PATH', `受操作系统安全保护，禁止${action}系统核心目录或磁盘根目录：${filePath}`);
    }
}

function isIgnoredDirName(name) {
    return IGNORED_DIRS.has(name);
}

function looksBinaryByName(filePath) {
    return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isBinaryBuffer(buffer) {
    const slice = buffer.subarray(0, Math.min(buffer.length, 8192));
    for (let index = 0; index < slice.length; index += 1) {
        if (slice[index] === 0) return true;
    }
    return false;
}

function isSecretFile(filePath) {
    return SECRET_FILE_RE.test(String(filePath || ''));
}

function assertNotSecretFile(filePath) {
    let real = filePath;
    try { real = fs.realpathSync(filePath); } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
    if (isSecretFile(filePath) || isSecretFile(real)) throw pathError('AGENT_SECRET_FILE', 'AI 工具不可读取或修改凭据/环境变量文件');
}

module.exports = {
    IGNORED_DIRS,
    isInside,
    samePath,
    normalizeRoot,
    resolveInsideRoot,
    toDisplayPath,
    isIgnoredDirName,
    looksBinaryByName,
    isBinaryBuffer,
    isSecretFile,
    assertNotSecretFile,
    isSystemCriticalPath,
    assertNotSystemCritical
};
