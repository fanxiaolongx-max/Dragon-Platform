const { all, run } = require('./app-db');
const { getDataDir } = require('./tenant-context');
const rules = require('../../frontend/js/monthly-designer/source-category-rules');
const ready = new Map();

async function ensureReady() {
    const key = getDataDir();
    if (!ready.has(key)) {
        ready.set(key, run(`CREATE TABLE IF NOT EXISTS source_category_rules (
            type_key TEXT PRIMARY KEY,
            category TEXT NOT NULL CHECK(category IN ('tickets','metrics','raw','topic','meeting')),
            updated_at TEXT NOT NULL
        )`).catch(error => { ready.delete(key); throw error; }));
    }
    await ready.get(key);
}

async function annotate(catalog) {
    await ensureReady();
    // One metadata query per directory; never read original blobs or worksheet rows.
    const registry = new Map((await all('SELECT type_key,category,updated_at FROM source_category_rules'))
        .map(row => [row.type_key, row]));
    return { ...catalog, files: catalog.files.map(file => {
        const identity = rules.identity(file), saved = registry.get(identity.key), builtin = rules.builtin(file);
        return { ...file, library_category: saved?.category || builtin,
            library_category_rule: { ...identity, mode: saved ? 'manual' : builtin ? 'builtin' : 'automatic',
                updatedAt: saved?.updated_at || null } };
    }) };
}

async function save(fileId, category) {
    if (category !== null && !rules.categories.includes(category)) {
        throw Object.assign(new Error('Invalid source category'), { status: 400 });
    }
    // Resolve the source in the authenticated tenant; clients cannot supply another rule key.
    const file = await require('./import-source-repository').getFile(fileId);
    if (!file) throw Object.assign(new Error('Source file not found'), { status: 404 });
    await ensureReady();
    const identity = rules.identity(file);
    if (!identity.series || identity.key.length > 2000) {
        throw Object.assign(new Error('Invalid source identity'), { status: 400 });
    }
    if (category === null) {
        await run('DELETE FROM source_category_rules WHERE type_key=?', [identity.key]);
    } else {
        await run(`INSERT INTO source_category_rules (type_key,category,updated_at) VALUES (?,?,?)
            ON CONFLICT(type_key) DO UPDATE SET category=excluded.category,updated_at=excluded.updated_at`,
            [identity.key, category, new Date().toISOString()]);
    }
    return { success: true, ...identity, category };
}
module.exports = { ensureReady, annotate, save };
