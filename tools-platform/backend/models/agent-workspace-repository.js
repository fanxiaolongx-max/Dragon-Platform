// Dragon Claw 工作区：每用户偏好（上次目录、最近目录、权限模式），存租户库 sys_kv_store。
const { readKV, writeKV } = require('./kv-store');
const { normalizePermissionMode } = require('./agent-run-manager');

const CATEGORY = 'dragon-claw-workspace';
const MAX_RECENT = 12;
const MAX_PATH = 1024;

function cleanPath(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_PATH);
}

function normalizePrefs(raw = {}) {
    const seen = new Set();
    const recentDirectories = (Array.isArray(raw.recentDirectories) ? raw.recentDirectories : [])
        .map(cleanPath)
        .filter(item => item && !seen.has(item) && seen.add(item))
        .slice(0, MAX_RECENT);
    return {
        lastDirectory: cleanPath(raw.lastDirectory),
        recentDirectories,
        permissionMode: normalizePermissionMode(raw.permissionMode)
    };
}

async function getPrefs(username) {
    return normalizePrefs(await readKV(CATEGORY, String(username || ''), {}));
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

module.exports = { getPrefs, savePrefs, rememberDirectory, forgetDirectory, normalizePrefs };
