// WeLink Bridge Runtime SDK（@wecode/bridge-runtime-sdk）探测与加载。
// 查找顺序：配置的 SDK 路径 → 页面导入的 SDK（本机数据目录，所有租户共用）→ 平台内置（backend/vendor）
// → 项目依赖 → npm 全局目录（welink-cli 安装）。
// 都找不到时返回明确提示，引导用户用 welink-cli 获取安装。SDK 是 ESM 包，通过动态 import 加载；
// 桌面版内置 SDK 通过 asarUnpack 解包到 app.asar.unpacked，从真实文件系统加载。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { BASE_DATA_DIR } = require('../tenant-context');

const PACKAGE_NAME = '@wecode/bridge-runtime-sdk';
const INSTALL_HINT = `未检测到 WeLink SDK（${PACKAGE_NAME}）。可点击「导入 SDK」选择 welink-cli / Bot 工程中的 @wecode 文件夹（或其中的 dist/index.js）直接导入；也可通过 welink-cli 安装后点击「重新检测」，或在配置中填写 SDK 路径。`;
const INSTALL_HINT_EN = `WeLink SDK (${PACKAGE_NAME}) was not found. Click "Import SDK" and choose the @wecode folder (or its dist/index.js) from welink-cli or a bot project, or install it with welink-cli and click "Re-detect", or set the SDK path.`;

const BUILTIN_DIR = path.join(__dirname, '..', '..', 'vendor', '@wecode', 'bridge-runtime-sdk');
const IMPORT_ROOT = path.join(BASE_DATA_DIR, 'channel-sdk');
const IMPORTED_DIR = path.join(IMPORT_ROOT, '@wecode', 'bridge-runtime-sdk');
const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

let override = null;
let builtinDirOverride = null;
let cachedGlobalRoots = null;
const moduleCache = new Map();

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

function execText(command, args) {
    return new Promise(resolve => {
        execFile(command, args, { timeout: 8000, windowsHide: true, shell: process.platform === 'win32' }, (error, stdout) => {
            resolve(error ? '' : String(stdout || '').trim());
        });
    });
}

async function globalRoots() {
    if (cachedGlobalRoots) return cachedGlobalRoots;
    const roots = new Set();
    const npmRoot = await execText('npm', ['root', '-g']);
    if (npmRoot) roots.add(npmRoot);
    if (process.env.APPDATA) roots.add(path.join(process.env.APPDATA, 'npm', 'node_modules'));
    if (process.env.NVM_SYMLINK) roots.add(path.join(process.env.NVM_SYMLINK, 'node_modules'));
    if (process.env.npm_config_prefix) {
        roots.add(path.join(process.env.npm_config_prefix, 'node_modules'));
        roots.add(path.join(process.env.npm_config_prefix, 'lib', 'node_modules'));
    }
    roots.add(path.join(os.homedir(), '.welink-cli', 'node_modules'));
    roots.add(path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'));
    roots.add('/usr/local/lib/node_modules');
    roots.add('/opt/homebrew/lib/node_modules');
    cachedGlobalRoots = [...roots];
    return cachedGlobalRoots;
}

/** 桌面版打包后 asar 内的路径换成解包目录（ESM 与动态 import 从真实文件加载更可靠）。 */
function preferUnpacked(dir) {
    const marker = `app.asar${path.sep}`;
    if (!dir.includes(marker)) return dir;
    const unpacked = dir.replace(marker, `app.asar.unpacked${path.sep}`);
    return fs.existsSync(unpacked) ? unpacked : dir;
}

/** 把用户填写的路径（包目录 / node_modules 目录 / 入口文件）规范成包目录。 */
function packageDirFromCustomPath(customPath) {
    const target = path.resolve(String(customPath || '').trim());
    if (!target || !fs.existsSync(target)) return null;
    const stat = fs.statSync(target);
    const dir = stat.isDirectory() ? target : path.dirname(target);
    const candidates = [dir, path.join(dir, PACKAGE_NAME), path.join(dir, 'node_modules', PACKAGE_NAME)];
    let cursor = dir;
    for (let i = 0; i < 4; i += 1) {
        candidates.push(cursor);
        cursor = path.dirname(cursor);
    }
    return candidates.find(item => readJson(path.join(item, 'package.json'))?.name === PACKAGE_NAME) || null;
}

function pickExportTarget(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    if (Array.isArray(entry)) return entry.map(pickExportTarget).find(Boolean) || null;
    if (typeof entry === 'object') {
        for (const key of ['node', 'import', 'default', 'require']) {
            const value = pickExportTarget(entry[key]);
            if (value) return value;
        }
    }
    return null;
}

function resolveEntry(packageDir, pkg) {
    const exportsField = pkg.exports && typeof pkg.exports === 'object' && !Array.isArray(pkg.exports) && Object.keys(pkg.exports).some(key => key.startsWith('.'))
        ? pkg.exports['.']
        : pkg.exports;
    const relative = pickExportTarget(exportsField) || pkg.module || pkg.main || 'index.js';
    const file = path.resolve(packageDir, relative);
    return fs.existsSync(file) ? file : null;
}

function describePackage(packageDir, source) {
    const pkg = readJson(path.join(packageDir, 'package.json'));
    if (!pkg || pkg.name !== PACKAGE_NAME) return null;
    const entry = resolveEntry(packageDir, pkg);
    if (!entry) return null;
    return { available: true, packageName: PACKAGE_NAME, version: String(pkg.version || ''), packageDir, entry, source };
}

/**
 * 探测 SDK 安装位置；不加载模块。
 * @returns {Promise<{available:boolean, version?, packageDir?, entry?, source?, hint?, hintEn?}>}
 */
async function detect({ sdkPath = '' } = {}) {
    if (override) return { available: true, packageName: PACKAGE_NAME, version: override.version || 'test', packageDir: '(override)', entry: '(override)', source: 'override' };
    if (sdkPath) {
        const dir = packageDirFromCustomPath(sdkPath);
        const found = dir && describePackage(dir, 'custom');
        if (found) return found;
    }
    const imported = describePackage(IMPORTED_DIR, 'imported');
    if (imported) return { ...imported, importedAt: readJson(path.join(IMPORTED_DIR, 'import-meta.json'))?.importedAt || null };
    const builtin = describePackage(preferUnpacked(builtinDirOverride || BUILTIN_DIR), 'builtin');
    if (builtin) return builtin;
    const localRoots = [path.join(__dirname, '../..'), path.join(__dirname, '../../..')];
    for (const root of localRoots) {
        const found = describePackage(path.join(root, 'node_modules', PACKAGE_NAME), 'local');
        if (found) return found;
    }
    for (const root of await globalRoots()) {
        const found = describePackage(path.join(root, PACKAGE_NAME), 'global');
        if (found) return found;
    }
    return {
        available: false,
        packageName: PACKAGE_NAME,
        customPathInvalid: Boolean(sdkPath),
        hint: INSTALL_HINT,
        hintEn: INSTALL_HINT_EN
    };
}

function sdkError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

/** 加载 SDK 模块（按入口文件缓存）。 */
async function load(options = {}) {
    if (override) return override;
    const info = await detect(options);
    if (!info.available) throw sdkError('WELINK_SDK_MISSING', info.hint);
    return importEntry(info.entry);
}

/** 按入口文件 + 修改时间缓存；重新导入同路径文件时 URL 带上新的版本号，绕过 ESM 模块缓存。 */
async function importEntry(entry) {
    // Electron 28 / Node 18 没有全局 WebSocket；SDK 在模块求值和连接时都会使用它。
    // 必须在动态 import 之前补齐，并保留较新 Node 或宿主提供的原生实现。
    if (typeof globalThis.WebSocket !== 'function') globalThis.WebSocket = require('ws');
    let version = 0;
    try { version = Math.round(fs.statSync(entry).mtimeMs); } catch { version = 0; }
    const key = `${entry}?v=${version}`;
    if (!moduleCache.has(key)) {
        moduleCache.set(key, import(`${pathToFileURL(entry).href}?v=${version}`).catch(error => {
            moduleCache.delete(key);
            throw sdkError('WELINK_SDK_LOAD_FAILED', `WeLink SDK 加载失败：${error.message}`);
        }));
    }
    const mod = await moduleCache.get(key);
    const sdk = mod && typeof mod.createBridgeRuntime === 'function' ? mod : mod?.default;
    if (!sdk || typeof sdk.createBridgeRuntime !== 'function') {
        throw sdkError('WELINK_SDK_INCOMPATIBLE', 'WeLink SDK 缺少 createBridgeRuntime，请确认导入的是 @wecode/bridge-runtime-sdk 的 dist/index.js');
    }
    return sdk;
}

function parsePackageJson(text) {
    if (!text) return null;
    try {
        const pkg = JSON.parse(String(text));
        return pkg && typeof pkg === 'object' ? pkg : null;
    } catch {
        return null;
    }
}

/**
 * 从页面导入 SDK：先写入临时目录并实际加载校验（必须导出 createBridgeRuntime），通过后再替换正式目录。
 * @param {object} input
 * @param {string} input.entry dist/index.js 文本
 * @param {string} [input.types] dist/index.d.ts 文本
 * @param {string} [input.packageJson] 包的 package.json 文本（用于读取版本号）
 * @param {string} [input.fileName] 原文件名，仅用于记录
 */
async function importSdk({ entry, types, packageJson, fileName } = {}) {
    const code = String(entry || '');
    if (!code.trim()) throw sdkError('WELINK_SDK_IMPORT_EMPTY', '没有找到 SDK 主文件（dist/index.js）');
    if (Buffer.byteLength(code) + Buffer.byteLength(String(types || '')) > MAX_IMPORT_BYTES) throw sdkError('WELINK_SDK_IMPORT_TOO_LARGE', 'SDK 文件超过 15 MB 上限');
    if (/<truncated \d+ bytes>/.test(code)) throw sdkError('WELINK_SDK_IMPORT_TRUNCATED', 'SDK 文件内容不完整（中间被截断），请直接选择原始 index.js 文件');
    const pkg = parsePackageJson(packageJson);
    if (pkg && pkg.name && pkg.name !== PACKAGE_NAME) throw sdkError('WELINK_SDK_IMPORT_MISMATCH', `package.json 的包名是 ${pkg.name}，不是 ${PACKAGE_NAME}`);
    let version = String(pkg?.version || '').slice(0, 40);
    fs.mkdirSync(IMPORT_ROOT, { recursive: true });
    const staging = fs.mkdtempSync(path.join(IMPORT_ROOT, '.staging-'));
    try {
        fs.mkdirSync(path.join(staging, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({
            name: PACKAGE_NAME, version: version || '0.0.0-unknown', type: 'module', main: './dist/index.js', ...(types ? { types: './dist/index.d.ts' } : {})
        }, null, 2));
        fs.writeFileSync(path.join(staging, 'dist', 'index.js'), code);
        if (types) fs.writeFileSync(path.join(staging, 'dist', 'index.d.ts'), String(types));
        const importedAt = new Date().toISOString();
        fs.writeFileSync(path.join(staging, 'import-meta.json'), JSON.stringify({ importedAt, fileName: String(fileName || '').slice(0, 200), bytes: Buffer.byteLength(code) }, null, 2));
        const sdk = await importEntry(path.join(staging, 'dist', 'index.js'));
        const capabilities = {
            createBridgeRuntime: typeof sdk.createBridgeRuntime === 'function',
            qrcodeAuth: typeof sdk.qrcodeAuth?.run === 'function',
            packageVersion: typeof sdk.resolvePackageVersion === 'function' ? (() => { try { return sdk.resolvePackageVersion() || null; } catch { return null; } })() : null
        };
        // 只导入了 index.js（没有 package.json）时，用 SDK 自报的版本号
        if (!version && capabilities.packageVersion) {
            version = String(capabilities.packageVersion).slice(0, 40);
            const pkgFile = path.join(staging, 'package.json');
            fs.writeFileSync(pkgFile, JSON.stringify({ ...readJson(pkgFile), version }, null, 2));
        }
        fs.mkdirSync(path.dirname(IMPORTED_DIR), { recursive: true });
        const previous = `${IMPORTED_DIR}.old-${Date.now()}`;
        if (fs.existsSync(IMPORTED_DIR)) fs.renameSync(IMPORTED_DIR, previous);
        fs.renameSync(staging, IMPORTED_DIR);
        fs.rmSync(previous, { recursive: true, force: true });
        moduleCache.clear();
        return { ...(await detect()), capabilities };
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        if (String(error.code || '').startsWith('WELINK_SDK_IMPORT')) throw error;
        throw sdkError('WELINK_SDK_IMPORT_INVALID', `SDK 校验失败：${error.message.replace(/^WeLink SDK 加载失败：/, '')}`);
    }
}

/** 删除页面导入的 SDK，回退到内置 / welink-cli 安装的版本。 */
function removeImportedSdk() {
    const existed = fs.existsSync(IMPORTED_DIR);
    fs.rmSync(IMPORTED_DIR, { recursive: true, force: true });
    moduleCache.clear();
    return existed;
}

/** 清除探测与模块缓存（「重新检测」时调用）。 */
function reset() {
    cachedGlobalRoots = null;
    moduleCache.clear();
}

/** 测试专用：注入伪 SDK；传 null 恢复。 */
function setOverride(sdk) {
    override = sdk || null;
}

/** 测试专用：替换内置 SDK 目录；传 null 恢复。 */
function setBuiltinDir(dir) {
    builtinDirOverride = dir || null;
}

module.exports = { PACKAGE_NAME, INSTALL_HINT, BUILTIN_DIR, IMPORTED_DIR, detect, load, importSdk, removeImportedSdk, reset, setOverride, setBuiltinDir };
