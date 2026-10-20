// 桌面浏览器（推广卡片 / 浮窗脚本窗口）里的浏览器插件：原样加载，插件自带的 License 校验照常生效。
// - 项目自带的插件目录：启动时复制到用户数据目录再加载；平台更新后内容变化会自动重新加载。
// - 用户导入：打包好的插件 .zip 解压后加载；插件文件夹直接加载（重新打包到同一文件夹，下次启动即是新版）。
// - 本机 Chrome / Edge 已安装的插件：勾选后从浏览器自己的插件目录加载最新版本（例如公司的登录插件）。
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUNDLED = [
    { key: 'bundled:chrome-capture-pro', dir: path.join(ROOT, 'backend/builtin-tools/f12-to-extension/chrome-capture-pro') },
    { key: 'bundled:overseas-salary-calculator', dir: path.join(ROOT, 'backend/builtin-tools/f12-to-extension/overseas-salary-calculator') }
];
const SKIP_DIRS = new Set(['node_modules', '.git', '_metadata']);
const SKIP_FILES = /\.(md|zip)$/i;

function walk(dir, base = dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, base, out); }
        else if (entry.isFile() && !SKIP_FILES.test(entry.name)) out.push(path.relative(base, full));
    }
    return out.sort();
}

// 打包后的源目录在 app.asar 里，Chromium 读不了 asar：逐个文件复制出来（fs 在 Electron 里能读 asar）
function copyDir(source, target) {
    fs.rmSync(target, { recursive: true, force: true });
    for (const rel of walk(source)) {
        const to = path.join(target, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, fs.readFileSync(path.join(source, rel)));
    }
}

function hashDir(dir) {
    const hash = crypto.createHash('sha1');
    for (const rel of walk(dir)) { hash.update(rel); hash.update(fs.readFileSync(path.join(dir, rel))); }
    return hash.digest('hex').slice(0, 16);
}

function compareVersions(a, b) {
    const pa = String(a).split(/[._-]/).map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(/[._-]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
}

function readManifest(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, '')); } catch (_) { return null; }
}

// 解析 __MSG_xxx__ 形式的插件名
function displayName(dir, manifest, lang = 'zh_CN') {
    const raw = String(manifest && manifest.name || '');
    const match = /^__MSG_(.+)__$/.exec(raw);
    if (!match) return raw || path.basename(dir);
    for (const locale of [lang, manifest.default_locale, 'en']) {
        if (!locale) continue;
        try {
            const messages = JSON.parse(fs.readFileSync(path.join(dir, '_locales', locale, 'messages.json'), 'utf8').replace(/^﻿/, ''));
            const key = Object.keys(messages).find(name => name.toLowerCase() === match[1].toLowerCase());
            if (key && messages[key].message) return messages[key].message;
        } catch (_) { /* 尝试下一个语言 */ }
    }
    return match[1];
}

// 本机 Chrome / Edge 的插件安装目录（每个插件 <id>/<version>/）
function browserProfileRoots() {
    const home = os.homedir();
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roots = process.platform === 'win32'
        ? [['Chrome', path.join(local, 'Google', 'Chrome', 'User Data')], ['Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')]]
        : process.platform === 'darwin'
            ? [['Chrome', path.join(home, 'Library/Application Support/Google/Chrome')], ['Edge', path.join(home, 'Library/Application Support/Microsoft Edge')]]
            : [['Chrome', path.join(home, '.config/google-chrome')], ['Edge', path.join(home, '.config/microsoft-edge')]];
    return roots.filter(([, dir]) => fs.existsSync(dir));
}

function scanInstalledBrowserExtensions() {
    const found = new Map();
    for (const [browser, userData] of browserProfileRoots()) {
        let profiles = [];
        try { profiles = fs.readdirSync(userData).filter(name => name === 'Default' || /^Profile \d+$/.test(name)); } catch (_) { continue; }
        for (const profile of profiles) {
            const extRoot = path.join(userData, profile, 'Extensions');
            let ids = [];
            try { ids = fs.readdirSync(extRoot).filter(id => /^[a-p]{32}$/.test(id)); } catch (_) { continue; }
            for (const id of ids) {
                const key = `${browser.toLowerCase()}:${id}`;
                let versions = [];
                try { versions = fs.readdirSync(path.join(extRoot, id)).filter(v => fs.existsSync(path.join(extRoot, id, v, 'manifest.json'))); } catch (_) { continue; }
                if (!versions.length) continue;
                const version = versions.sort(compareVersions).pop();
                const dir = path.join(extRoot, id, version);
                const manifest = readManifest(dir);
                if (!manifest) continue;
                const existing = found.get(key);
                if (existing && compareVersions(existing.version, manifest.version) >= 0) continue;
                found.set(key, { key, browser, id, dir, version: manifest.version, name: displayName(dir, manifest), profile });
            }
        }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function createExtensionManager({ session, statePath }) {
    const installRoot = path.join(app.getPath('userData'), 'browser-extensions');
    let state = readState();
    const loaded = new Map();   // key → { id, name, version, popup, source, error }
    let ready = Promise.resolve();

    function readState() {
        try {
            const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            return { imported: Array.isArray(value.imported) ? value.imported : [], disabled: Array.isArray(value.disabled) ? value.disabled : [], hashes: value.hashes && typeof value.hashes === 'object' ? value.hashes : {} };
        } catch (_) {
            return { imported: [], disabled: [], hashes: {} };
        }
    }
    function writeState() {
        try {
            fs.mkdirSync(path.dirname(statePath), { recursive: true });
            fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        } catch (error) { console.warn('[DesktopBrowser] 保存插件设置失败：', error.message || error); }
    }

    async function unload(key) {
        const item = loaded.get(key);
        loaded.delete(key);
        if (item && item.id) { try { session.removeExtension(item.id); } catch (_) { /* 已卸载 */ } }
    }

    async function loadDir(key, dir, source) {
        await unload(key);
        const manifest = readManifest(dir);
        if (!manifest) { loaded.set(key, { key, source, name: path.basename(dir), error: '缺少 manifest.json' }); return; }
        const name = displayName(dir, manifest);
        try {
            const ext = await session.loadExtension(dir, { allowFileAccess: false });
            const popup = manifest.action && manifest.action.default_popup || manifest.browser_action && manifest.browser_action.default_popup || '';
            loaded.set(key, { key, source, id: ext.id, name, version: manifest.version, popup: popup ? popup.replace(/^\.?\//, '') : '', options: manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || '' });
        } catch (error) {
            loaded.set(key, { key, source, name, version: manifest.version, error: error.message || String(error) });
            console.warn(`[DesktopBrowser] 加载插件失败 ${name}:`, error.message || error);
        }
    }

    // 项目自带插件：内容有变化（平台升级）才重新复制
    async function loadBundled() {
        for (const item of BUNDLED) {
            if (state.disabled.includes(item.key) || !fs.existsSync(path.join(item.dir, 'manifest.json'))) { await unload(item.key); continue; }
            const target = path.join(installRoot, 'bundled', item.key.split(':')[1]);
            try {
                const hash = hashDir(item.dir);
                if (state.hashes[item.key] !== hash || !fs.existsSync(path.join(target, 'manifest.json'))) {
                    copyDir(item.dir, target);
                    state.hashes[item.key] = hash;
                    writeState();
                }
                await loadDir(item.key, target, 'bundled');
            } catch (error) {
                loaded.set(item.key, { key: item.key, source: 'bundled', name: item.key, error: error.message || String(error) });
            }
        }
    }

    async function loadImported() {
        const installed = new Map(scanInstalledBrowserExtensions().map(item => [item.key, item]));
        for (const item of state.imported) {
            if (item.source === 'browser') {
                const current = installed.get(item.key);
                if (current) await loadDir(item.key, current.dir, 'browser');
                else loaded.set(item.key, { key: item.key, source: 'browser', name: item.name, error: '本机浏览器里已找不到这个插件' });
            } else if (item.dir && fs.existsSync(item.dir)) {
                await loadDir(item.key, item.dir, item.source);
            } else {
                loaded.set(item.key, { key: item.key, source: item.source, name: item.name, error: '插件文件夹不存在' });
            }
        }
    }

    function reloadAll() {
        ready = ready.catch(() => {}).then(async () => { await loadBundled(); await loadImported(); });
        return ready;
    }

    async function importZip(file) {
        const JSZip = require('jszip');
        const zip = await JSZip.loadAsync(fs.readFileSync(file));
        const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
        // 兼容压缩包里多包了一层目录
        const manifestPath = names.filter(name => /(^|\/)manifest\.json$/.test(name)).sort((a, b) => a.length - b.length)[0];
        if (!manifestPath) throw new Error('压缩包里没有 manifest.json，不是浏览器插件');
        const prefix = manifestPath.slice(0, -'manifest.json'.length);
        const key = `zip:${crypto.createHash('sha1').update(path.basename(file)).digest('hex').slice(0, 10)}`;
        const target = path.join(installRoot, 'imported', key.split(':')[1]);
        fs.rmSync(target, { recursive: true, force: true });
        for (const name of names) {
            if (!name.startsWith(prefix)) continue;
            const rel = name.slice(prefix.length);
            if (!rel || rel.split('/').includes('..')) continue;
            const to = path.join(target, rel);
            if (!path.resolve(to).startsWith(path.resolve(target) + path.sep)) continue;
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.writeFileSync(to, await zip.files[name].async('nodebuffer'));
        }
        return addImported({ key, source: 'zip', dir: target, name: displayName(target, readManifest(target)), file });
    }

    function importFolder(dir) {
        if (!readManifest(dir)) throw new Error('这个文件夹里没有 manifest.json，不是浏览器插件');
        const key = `folder:${crypto.createHash('sha1').update(dir).digest('hex').slice(0, 10)}`;
        return addImported({ key, source: 'folder', dir, name: displayName(dir, readManifest(dir)) });
    }

    async function addImported(entry) {
        state.imported = state.imported.filter(item => item.key !== entry.key).concat(entry);
        writeState();
        await (ready = ready.catch(() => {}).then(() => loadDir(entry.key, entry.dir, entry.source)));
        return loaded.get(entry.key);
    }

    async function toggleBrowserExtension(item, enabled) {
        if (enabled) {
            state.imported = state.imported.filter(entry => entry.key !== item.key).concat({ key: item.key, source: 'browser', name: item.name });
            writeState();
            await (ready = ready.catch(() => {}).then(() => loadDir(item.key, item.dir, 'browser')));
        } else {
            await removeImported(item.key);
        }
    }

    async function removeImported(key) {
        const entry = state.imported.find(item => item.key === key);
        state.imported = state.imported.filter(item => item.key !== key);
        writeState();
        await unload(key);
        if (entry && entry.source === 'zip' && entry.dir && entry.dir.startsWith(installRoot)) fs.rmSync(entry.dir, { recursive: true, force: true });
    }

    async function setBundledEnabled(key, enabled) {
        state.disabled = enabled ? state.disabled.filter(item => item !== key) : [...new Set([...state.disabled, key])];
        writeState();
        if (enabled) await reloadAll(); else await unload(key);
    }

    return {
        init: reloadAll,
        whenReady: () => ready.catch(() => {}),
        reloadAll,
        list: () => [...loaded.values()],
        bundled: () => BUNDLED.map(item => ({ key: item.key, enabled: !state.disabled.includes(item.key), info: loaded.get(item.key) || null })),
        imported: () => state.imported.map(item => ({ ...item, info: loaded.get(item.key) || null })),
        scanInstalledBrowserExtensions,
        importZip,
        importFolder,
        toggleBrowserExtension,
        removeImported,
        setBundledEnabled
    };
}

module.exports = { createExtensionManager, scanInstalledBrowserExtensions, displayName, compareVersions };
