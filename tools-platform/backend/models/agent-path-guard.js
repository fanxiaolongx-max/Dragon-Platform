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
 * 把相对/绝对输入解析为根目录内的绝对路径。
 * - 允许指向尚不存在的文件（用于新建），但其最深已存在的祖先必须在根内（防 symlink 逃逸）。
 */
function resolveInsideRoot(root, input) {
    const rel = String(input ?? '.');
    if (rel.includes('\0')) throw pathError('AGENT_PATH_INVALID', '路径包含非法字符');
    const abs = path.resolve(root, rel);
    if (!samePath(abs, root) && !isInside(root, abs)) throw pathError('AGENT_PATH_OUTSIDE', `路径超出工作目录：${rel}`);
    let probe = abs;
    while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
    }
    const real = fs.realpathSync(probe);
    if (!samePath(real, root) && !isInside(root, real)) throw pathError('AGENT_PATH_OUTSIDE', `路径通过链接指向工作目录之外：${rel}`);
    return abs;
}

function toDisplayPath(root, abs) {
    const rel = path.relative(root, abs);
    return rel ? rel.split(path.sep).join('/') : '.';
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
    assertNotSecretFile
};
