// WeLink Bridge Runtime SDK（@wecode/bridge-runtime-sdk）探测与加载。
// SDK 由 welink-cli 安装，不随平台打包：按「配置路径 → 项目依赖 → npm 全局目录」查找，
// 找不到时返回明确提示，引导用户先用 welink-cli 获取安装。SDK 是 ESM 包，通过动态 import 加载。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const PACKAGE_NAME = '@wecode/bridge-runtime-sdk';
const INSTALL_HINT = `未检测到 WeLink SDK（${PACKAGE_NAME}）。请先通过 welink-cli 获取并安装 SDK，然后在「全局设置 › 频道对接」点击「重新检测」；如 SDK 安装在非标准位置，可在配置中填写 SDK 路径。`;
const INSTALL_HINT_EN = `WeLink SDK (${PACKAGE_NAME}) was not found. Install it with welink-cli, then click "Re-detect" in Global Settings › Channels. If it lives in a custom location, set the SDK path in the configuration.`;

let override = null;
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
    if (!moduleCache.has(info.entry)) {
        moduleCache.set(info.entry, import(pathToFileURL(info.entry).href).catch(error => {
            moduleCache.delete(info.entry);
            throw sdkError('WELINK_SDK_LOAD_FAILED', `WeLink SDK 加载失败：${error.message}`);
        }));
    }
    const mod = await moduleCache.get(info.entry);
    const sdk = mod && typeof mod.createBridgeRuntime === 'function' ? mod : mod?.default;
    if (!sdk || typeof sdk.createBridgeRuntime !== 'function') {
        throw sdkError('WELINK_SDK_INCOMPATIBLE', 'WeLink SDK 缺少 createBridgeRuntime，请通过 welink-cli 升级到兼容版本');
    }
    return sdk;
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

module.exports = { PACKAGE_NAME, INSTALL_HINT, detect, load, reset, setOverride };
