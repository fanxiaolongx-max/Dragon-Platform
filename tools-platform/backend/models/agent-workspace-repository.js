// Dragon Claw 工作区：每用户偏好（上次目录、最近目录、权限模式），存租户库 sys_kv_store。
const fsp = require('node:fs/promises');
const { readKV, writeKV } = require('./kv-store');
const { normalizePermissionMode } = require('./agent-run-manager');

const CATEGORY = 'dragon-claw-workspace';
const MAX_RECENT = 12;
const MAX_PATH = 1024;

function cleanPath(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_PATH);
}

function isScratchDirectory(dir) {
    const text = cleanPath(dir);
    if (!text) return false;
    return text.includes('dragon-claw-scratch') || /[\\/]scratch[\\/][a-f0-9]+$/i.test(text);
}

function normalizePrefs(raw = {}) {
    const seen = new Set();
    const recentDirectories = (Array.isArray(raw.recentDirectories) ? raw.recentDirectories : [])
        .map(cleanPath)
        .filter(item => item && !isScratchDirectory(item) && !seen.has(item) && seen.add(item))
        .slice(0, MAX_RECENT);
    const last = cleanPath(raw.lastDirectory);
    return {
        lastDirectory: isScratchDirectory(last) ? '' : last,
        recentDirectories,
        permissionMode: normalizePermissionMode(raw.permissionMode)
    };
}

async function getPrefs(username) {
    return normalizePrefs(await readKV(CATEGORY, String(username || ''), {}));
}

async function isExistingDirectory(dir, isAllowed) {
    if (!dir || isScratchDirectory(dir)) return false;
    if (typeof isAllowed === 'function' && !isAllowed(dir)) return false;
    return fsp.stat(dir).then(stat => stat.isDirectory(), () => false);
}

/** 读取偏好并自动清理磁盘上已不存在、临时沙箱或越界的最近目录 */
async function getExistingPrefs(username, { isAllowed = null } = {}) {
    const raw = await readKV(CATEGORY, String(username || ''), {});
    const current = normalizePrefs(raw);
    const candidates = [...new Set([current.lastDirectory, ...current.recentDirectories].filter(Boolean))];
    const checks = await Promise.all(candidates.map(async dir => [dir, await isExistingDirectory(dir, isAllowed)]));
    const validSet = new Set(checks.filter(([, ok]) => ok).map(([dir]) => dir));
    const next = {
        lastDirectory: validSet.has(current.lastDirectory) ? current.lastDirectory : '',
        recentDirectories: current.recentDirectories.filter(dir => validSet.has(dir)),
        permissionMode: current.permissionMode
    };
    const rawHadScratchOrInvalid = cleanPath(raw?.lastDirectory) !== next.lastDirectory
        || (Array.isArray(raw?.recentDirectories) ? raw.recentDirectories.length : 0) !== next.recentDirectories.length
        || current.lastDirectory !== next.lastDirectory
        || current.recentDirectories.length !== next.recentDirectories.length;
    if (rawHadScratchOrInvalid) {
        await writeKV(CATEGORY, String(username || ''), next);
    }
    return next;
}

async function savePrefs(username, patch = {}) {
    const current = await getPrefs(username);
    const next = normalizePrefs({ ...current, ...patch });
    await writeKV(CATEGORY, String(username || ''), next);
    return next;
}

async function rememberDirectory(username, directory) {
    const current = await getPrefs(username);
    const dir = cleanPath(directory);
    if (!dir || isScratchDirectory(dir)) return current;
    return savePrefs(username, {
        lastDirectory: dir,
        recentDirectories: [dir, ...current.recentDirectories.filter(item => item !== dir)]
    });
}

async function forgetDirectory(username, directory) {
    const current = await getPrefs(username);
    const dir = cleanPath(directory);
    return savePrefs(username, {
        lastDirectory: current.lastDirectory === dir ? '' : current.lastDirectory,
        recentDirectories: current.recentDirectories.filter(item => item !== dir)
    });
}

module.exports = { getPrefs, getExistingPrefs, savePrefs, rememberDirectory, forgetDirectory, normalizePrefs, isScratchDirectory };
