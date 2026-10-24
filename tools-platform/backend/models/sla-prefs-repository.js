const { run, get, all } = require('./app-db');
const { getDataDir } = require('./tenant-context');


const readiness = new Map();

function normalizePrefs(items) {
    return items && typeof items === 'object' && !Array.isArray(items) ? items : {};
}

function getPrefKind(prefKey, payload) {
    if (prefKey.startsWith('sla_prefs_')) return 'schema';
    if (prefKey === 'i18nMap') return 'i18n';
    if (prefKey === 'manualAdjustItems') return 'manual_adjust_items';
    if (prefKey === 'expediteIgnoreKeywords') return 'expedite_ignore_keywords';
    if (prefKey === 'expediteTemplate') return 'expedite_template';
    if (Array.isArray(payload)) return 'array';
    if (payload && typeof payload === 'object') return 'object';
    return typeof payload;
}

async function replacePrefsInDbRaw(items) {
    const normalized = normalizePrefs(items);
    await run('DELETE FROM sla_prefs');
    await run("DELETE FROM sys_dictionaries WHERE category = 'i18n'");
    for (const [prefKey, payload] of Object.entries(normalized)) {
        if (prefKey === 'i18nMap') {
            for (const [k, v] of Object.entries(payload)) {
                await run(
                    `INSERT OR REPLACE INTO sys_dictionaries (dict_key, dict_value, category, updated_at) VALUES (?, ?, 'i18n', CURRENT_TIMESTAMP)`,
                    [k, String(v)]
                );
            }
        } else {
            await run(
                `INSERT OR REPLACE INTO sla_prefs (pref_key, pref_kind, payload_json, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                [
                    prefKey,
                    getPrefKind(prefKey, payload),
                    JSON.stringify(payload)
                ]
            );
        }
    }
}

async function ensureReady() {
    const tenantKey = getDataDir();
    if (!readiness.has(tenantKey)) {
        readiness.set(tenantKey, (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS sys_dictionaries (
                    dict_key TEXT PRIMARY KEY,
                    dict_value TEXT NOT NULL,
                    category TEXT DEFAULT 'i18n',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await run(`
                CREATE TABLE IF NOT EXISTS sla_prefs (
                    pref_key TEXT PRIMARY KEY,
                    pref_kind TEXT DEFAULT 'object',
                    payload_json TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // 数据迁移：将现存 sla_prefs 表中的 i18nMap 迁移到 sys_dictionaries
            const oldI18n = await get("SELECT payload_json FROM sla_prefs WHERE pref_key='i18nMap'");
            if (oldI18n) {
                try {
                    const i18nObj = JSON.parse(oldI18n.payload_json);
                    for (const [k, v] of Object.entries(i18nObj)) {
                        await run(
                            `INSERT OR IGNORE INTO sys_dictionaries (dict_key, dict_value, category, updated_at) VALUES (?, ?, 'i18n', CURRENT_TIMESTAMP)`,
                            [k, String(v)]
                        );
                    }
                    await run("DELETE FROM sla_prefs WHERE pref_key='i18nMap'");
                } catch (e) {
                    console.error('[sla-prefs] i18nMap migration failed:', e.message);
                }
            }

            const row = await get('SELECT COUNT(1) AS count FROM sla_prefs');
            if (row && row.count > 0) return;
        })().catch(err => {
            readiness.delete(tenantKey);
            throw err;
        }));
    }

    return readiness.get(tenantKey);
}

async function readPrefsObjectFromDb() {
    await ensureReady();
    const rows = await all(`
        SELECT pref_key, payload_json
        FROM sla_prefs
        ORDER BY pref_key ASC
    `);
    const out = {};
    rows.forEach(row => {
        out[row.pref_key] = JSON.parse(row.payload_json);
    });

    const dictRows = await all("SELECT dict_key, dict_value FROM sys_dictionaries WHERE category='i18n'");
    if (dictRows && dictRows.length > 0) {
        out.i18nMap = {};
        dictRows.forEach(row => {
            out.i18nMap[row.dict_key] = row.dict_value;
        });
    }

    return out;
}

async function getPrefsObject() {
    return { items: await readPrefsObjectFromDb(), source: 'sqlite' };
}

async function getPrefItem(prefKey, { mode = 'auto' } = {}) {
    const { items, source } = await getPrefsObject({ mode });
    if (items[prefKey]) {
        return {
            item: items[prefKey],
            source
        };
    }
    const fallback = Object.values(items).find(pref => {
        const meta = pref && pref._sourceMeta;
        if (!meta) return false;
        if (Array.isArray(meta.previousHashes) && meta.previousHashes.includes(prefKey)) return true;
        if (Array.isArray(meta.aliases) && meta.aliases.includes(prefKey)) return true;
        return false;
    });
    return {
        item: fallback || null,
        source
    };
}

async function replacePrefs(items) {
    const normalized = items || {};
    await ensureReady();
    await replacePrefsInDbRaw(normalized);
    return normalized;
}

async function upsertPrefItem(prefKey, payload) {
        try {
        await ensureReady();
        if (prefKey === 'i18nMap') {
            await run("DELETE FROM sys_dictionaries WHERE category='i18n'");
            for (const [k, v] of Object.entries(payload)) {
                await run(
                    `INSERT OR REPLACE INTO sys_dictionaries (dict_key, dict_value, category, updated_at) VALUES (?, ?, 'i18n', CURRENT_TIMESTAMP)`,
                    [k, String(v)]
                );
            }
            await run("DELETE FROM sla_prefs WHERE pref_key='i18nMap'");
        } else {
            await run(
                `INSERT INTO sla_prefs (pref_key, pref_kind, payload_json, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(pref_key) DO UPDATE SET
                    pref_kind = excluded.pref_kind,
                    payload_json = excluded.payload_json,
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    prefKey,
                    getPrefKind(prefKey, payload),
                    JSON.stringify(payload)
                ]
            );
        }
    } catch (err) {
        console.error('[sla-prefs] SQLite upsert sync failed:', err.message);
    }

    return payload;
}

module.exports = {
    ensureReady,
    getPrefsObject,
    getPrefItem,
    replacePrefs,
    upsertPrefItem
};
