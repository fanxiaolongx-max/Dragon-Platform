const crypto = require('crypto');
const { run, get, all } = require('./app-db');

const OPTIONAL_PERMISSIONS = new Set([
    'alarms', 'clipboardRead', 'clipboardWrite', 'cookies', 'downloads',
    'notifications', 'tabs', 'webNavigation'
]);
const RUN_AT_VALUES = new Set(['document_start', 'document_end', 'document_idle']);
const WORLD_VALUES = new Set(['MAIN', 'ISOLATED']);
const MAX_CODE_BYTES = 2 * 1024 * 1024;

async function ensureReady() {
    await run(`CREATE TABLE IF NOT EXISTS f12_script_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        matches TEXT NOT NULL,
        world TEXT NOT NULL DEFAULT 'MAIN',
        include_popup INTEGER NOT NULL DEFAULT 1 CHECK(include_popup IN (0, 1)),
        manual_launch INTEGER NOT NULL DEFAULT 0 CHECK(manual_launch IN (0, 1)),
        run_at TEXT NOT NULL DEFAULT 'document_idle',
        all_frames INTEGER NOT NULL DEFAULT 0 CHECK(all_frames IN (0, 1)),
        optional_permissions_json TEXT NOT NULL DEFAULT '[]',
        code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`);
    await run('CREATE INDEX IF NOT EXISTS idx_f12_script_presets_updated ON f12_script_presets(updated_at DESC)');
}

function normalizeOptionalPermissions(value) {
    const items = Array.isArray(value) ? value : [];
    return [...new Set(items.map(item => String(item || '').trim()))]
        .filter(item => OPTIONAL_PERMISSIONS.has(item));
}

function normalizeInput(input = {}) {
    const name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 75);
    const description = String(input.description || '').trim().replace(/\s+/g, ' ').slice(0, 132);
    const matches = String(input.matches || '').trim().slice(0, 8000);
    const code = String(input.code || '');
    if (!name) throw new Error('脚本名称不能为空');
    if (!matches) throw new Error('至少需要一个匹配网址');
    if (!code.trim()) throw new Error('脚本内容不能为空');
    if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) throw new Error('脚本内容不能超过 2 MB');
    return {
        name,
        description,
        matches,
        world: WORLD_VALUES.has(input.world) ? input.world : 'MAIN',
        includePopup: input.includePopup !== false,
        manualLaunch: input.manualLaunch === true,
        runAt: RUN_AT_VALUES.has(input.runAt) ? input.runAt : 'document_idle',
        allFrames: input.allFrames === true,
        optionalPermissions: normalizeOptionalPermissions(input.optionalPermissions),
        code
    };
}

function rowToPreset(row) {
    let optionalPermissions = [];
    try {
        const parsed = JSON.parse(row.optional_permissions_json || '[]');
        if (Array.isArray(parsed)) optionalPermissions = parsed;
    } catch (_) {}
    return {
        id: row.id,
        name: row.name,
        description: row.description || '',
        matches: row.matches,
        world: row.world,
        includePopup: Number(row.include_popup) === 1,
        manualLaunch: Number(row.manual_launch) === 1,
        runAt: row.run_at,
        allFrames: Number(row.all_frames) === 1,
        optionalPermissions,
        code: row.code,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function listPresets() {
    await ensureReady();
    const rows = await all(`SELECT id, name, description, matches, world, include_popup, manual_launch,
                                   run_at, all_frames, optional_permissions_json, code, created_at, updated_at
                            FROM f12_script_presets
                            ORDER BY updated_at DESC, name COLLATE NOCASE ASC`);
    return rows.map(rowToPreset);
}

async function getPreset(id) {
    await ensureReady();
    const row = await get(`SELECT id, name, description, matches, world, include_popup, manual_launch,
                                  run_at, all_frames, optional_permissions_json, code, created_at, updated_at
                           FROM f12_script_presets WHERE id = ?`, [String(id || '')]);
    return row ? rowToPreset(row) : null;
}

async function savePreset(input, id = '', { allowCreate = false } = {}) {
    await ensureReady();
    const preset = normalizeInput(input);
    const now = new Date().toISOString();
    const safeId = String(id || '').trim();
    if (safeId) {
        const existing = await getPreset(safeId);
        if (!existing && !allowCreate) return null;
        if (existing) {
        await run(`UPDATE f12_script_presets
                   SET name = ?, description = ?, matches = ?, world = ?, include_popup = ?,
                       manual_launch = ?, run_at = ?, all_frames = ?, optional_permissions_json = ?,
                       code = ?, updated_at = ?
                   WHERE id = ?`, [
            preset.name, preset.description, preset.matches, preset.world, preset.includePopup ? 1 : 0,
            preset.manualLaunch ? 1 : 0, preset.runAt, preset.allFrames ? 1 : 0,
            JSON.stringify(preset.optionalPermissions), preset.code, now, safeId
        ]);
        return getPreset(safeId);
        }
    }
    const newId = safeId || crypto.randomUUID();
    await run(`INSERT INTO f12_script_presets (
                   id, name, description, matches, world, include_popup, manual_launch,
                   run_at, all_frames, optional_permissions_json, code, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        newId, preset.name, preset.description, preset.matches, preset.world, preset.includePopup ? 1 : 0,
        preset.manualLaunch ? 1 : 0, preset.runAt, preset.allFrames ? 1 : 0,
        JSON.stringify(preset.optionalPermissions), preset.code, now, now
    ]);
    return getPreset(newId);
}

module.exports = {
    MAX_CODE_BYTES,
    ensureReady,
    getPreset,
    listPresets,
    normalizeInput,
    savePreset
};
