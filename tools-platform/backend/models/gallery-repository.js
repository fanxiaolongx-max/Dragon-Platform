const crypto = require('node:crypto');
const { run, get, all, getDbPath } = require('./app-db');

const ready = new Map();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max) => String(value ?? '').trim().slice(0, max);
function tags(value) {
    return [...new Set((Array.isArray(value) ? value : String(value || '').split(/[,，]/)).map(v => text(v, 30)).filter(Boolean))].slice(0, 12);
}
async function init() {
    const key = getDbPath();
    if (!ready.has(key)) ready.set(key, (async () => {
        await run(`CREATE TABLE IF NOT EXISTS gallery_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE)`);
        await run(`CREATE TABLE IF NOT EXISTS gallery_items (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'work',
            category_id TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '',
            favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS gallery_versions (
            id TEXT PRIMARY KEY, item_id TEXT NOT NULL, version_no INTEGER NOT NULL, label TEXT NOT NULL, filename TEXT NOT NULL,
            mime TEXT NOT NULL, original BLOB NOT NULL, thumbnail BLOB NOT NULL, preview BLOB NOT NULL,
            ai_balanced BLOB NOT NULL, ai_precise BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
            sha256 TEXT NOT NULL, ai_status TEXT NOT NULL DEFAULT 'pending', ai_mode TEXT NOT NULL DEFAULT '',
            ai_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(item_id, version_no))`);
        await run('CREATE INDEX IF NOT EXISTS idx_gallery_versions_item ON gallery_versions(item_id, version_no DESC)');
        await run('CREATE INDEX IF NOT EXISTS idx_gallery_items_updated ON gallery_items(archived, updated_at DESC)');
        for (const [id, name] of [['posters', '工作海报'], ['menus', '餐厅菜单'], ['inspiration', '灵感收藏']]) {
            await run('INSERT OR IGNORE INTO gallery_categories(id,name) VALUES(?,?)', [id, name]);
        }
    })().catch(error => { ready.delete(key); throw error; }));
    return ready.get(key);
}
const versionColumns = `id,item_id,version_no,label,filename,mime,width,height,sha256,ai_status,ai_mode,ai_json,created_at,
    length(original) AS original_bytes,length(preview) AS preview_bytes`;
function version(row) {
    if (!row) return null;
    const { ai_json, ...rest } = row;
    let analysis = {};
    try { analysis = JSON.parse(ai_json); } catch (_) {}
    return { ...rest, analysis, thumbnailUrl: `/api/gallery/versions/${row.id}/thumbnail`, previewUrl: `/api/gallery/versions/${row.id}/preview`, originalUrl: `/api/gallery/versions/${row.id}/original` };
}
function item(row) {
    if (!row) return null;
    const { tags_json, ...rest } = row;
    return { ...rest, tags: JSON.parse(tags_json), favorite: !!row.favorite, archived: !!row.archived };
}
async function categories() { await init(); return all('SELECT * FROM gallery_categories ORDER BY name'); }
async function addCategory(name) {
    await init(); name = text(name, 40);
    if (!name) throw fail('请输入分类名称');
    await run('INSERT OR IGNORE INTO gallery_categories(id,name) VALUES(?,?)', [crypto.randomUUID(), name]);
    return get('SELECT * FROM gallery_categories WHERE name=? COLLATE NOCASE', [name]);
}
async function validateCategory(id) {
    if (id && !await get('SELECT id FROM gallery_categories WHERE id=?', [id])) throw fail('分类不存在');
    return id || '';
}
async function list(options = {}) {
    await init();
    const where = ['i.archived=?'], params = [options.archived === '1' ? 1 : 0];
    if (['work', 'life'].includes(options.scope)) { where.push('i.scope=?'); params.push(options.scope); }
    if (options.category) { where.push('i.category_id=?'); params.push(options.category === 'uncategorized' ? '' : text(options.category, 64)); }
    if (options.favorite === '1') where.push('i.favorite=1');
    if (options.pending === '1') where.push("EXISTS(SELECT 1 FROM gallery_versions v WHERE v.item_id=i.id AND v.ai_status!='ready')");
    if (options.q) {
        const q = '%' + text(options.q, 120).replace(/[\\%_]/g, '\\$&') + '%';
        where.push(`(i.title LIKE ? ESCAPE '\\' OR i.tags_json LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\'
            OR EXISTS(SELECT 1 FROM gallery_categories c WHERE c.id=i.category_id AND c.name LIKE ? ESCAPE '\\')
            OR EXISTS(SELECT 1 FROM gallery_versions v WHERE v.item_id=i.id AND (v.ai_json LIKE ? ESCAPE '\\' OR v.filename LIKE ? ESCAPE '\\' OR v.label LIKE ? ESCAPE '\\')))`);
        params.push(q, q, q, q, q, q, q);
    }
    const clause = where.join(' AND ');
    const { total } = await get(`SELECT COUNT(*) AS total FROM gallery_items i WHERE ${clause}`, params);
    const pageSize = 36, pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.max(1, Math.min(pages, Math.trunc(Number(options.page)) || 1));
    const order = options.sort === 'oldest' ? 'i.created_at ASC' : 'i.updated_at DESC';
    const rows = await all(`SELECT i.*,
        (SELECT COUNT(*) FROM gallery_versions v WHERE v.item_id=i.id) AS version_count,
        (SELECT id FROM gallery_versions v WHERE v.item_id=i.id ORDER BY version_no DESC LIMIT 1) AS cover_id
        FROM gallery_items i WHERE ${clause} ORDER BY ${order},i.id LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.map(item), total, page, pages };
}
async function read(id) {
    await init();
    const row = item(await get('SELECT * FROM gallery_items WHERE id=?', [id]));
    if (!row) throw fail('图片不存在', 404);
    return { ...row, versions: (await all(`SELECT ${versionColumns} FROM gallery_versions WHERE item_id=? ORDER BY version_no DESC`, [id])).map(version) };
}
async function saveUpload({ itemId, title, scope, category, label, filename, mime, original, processed }) {
    await init();
    const categoryId = await validateCategory(text(category, 64));
    const id = itemId || crypto.randomUUID(), now = new Date().toISOString();
    if (itemId) {
        const existing = await read(id);
        if (existing.archived) throw fail('请先恢复已归档的图片', 409);
    }
    const hash = crypto.createHash('sha256').update(original).digest('hex');
    if (itemId) {
        const duplicate = await get('SELECT id FROM gallery_versions WHERE item_id=? AND sha256=?', [id, hash]);
        if (duplicate) return { item: await read(id), versionId: duplicate.id, duplicate: true };
    }
    const versionId = crypto.randomUUID();
    // A group is inserted only after image processing succeeds. On insert failure, remove only the empty new group.
    if (!itemId) await run(`INSERT INTO gallery_items(id,title,scope,category_id,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
        [id, text(title || filename, 120) || '未命名图片', scope === 'life' ? 'life' : 'work', categoryId, now, now]);
    try {
        await run(`INSERT INTO gallery_versions(id,item_id,version_no,label,filename,mime,original,thumbnail,preview,ai_balanced,ai_precise,width,height,sha256,created_at)
            SELECT ?,?,COALESCE(MAX(version_no),0)+1,?,?,?,?,?,?,?,?,?,?,?,? FROM gallery_versions WHERE item_id=?`,
        [versionId, id, text(label, 80), text(filename, 200), mime, original, processed.thumbnail, processed.preview,
            processed.balanced, processed.precise, processed.width, processed.height, hash, now, id]);
    } catch (error) {
        if (!itemId) await run('DELETE FROM gallery_items WHERE id=? AND NOT EXISTS(SELECT 1 FROM gallery_versions WHERE item_id=?)', [id, id]);
        throw error;
    }
    await run('UPDATE gallery_items SET updated_at=? WHERE id=?', [now, id]);
    return { item: await read(id), versionId, duplicate: false };
}
async function update(id, data) {
    const current = await read(id);
    if (Number(data.revision) !== current.revision) throw fail('内容已更新，请重新打开后再保存', 409);
    const title = text(data.title ?? current.title, 120);
    if (!title) throw fail('请输入标题');
    const category = await validateCategory(text(data.category_id ?? current.category_id, 64));
    const changed = await run(`UPDATE gallery_items SET title=?,scope=?,category_id=?,tags_json=?,note=?,favorite=?,archived=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`,
        [title, (data.scope ?? current.scope) === 'life' ? 'life' : 'work', category, JSON.stringify(tags(data.tags ?? current.tags)), text(data.note ?? current.note, 2000),
            (data.favorite ?? current.favorite) ? 1 : 0, (data.archived ?? current.archived) ? 1 : 0, new Date().toISOString(), id, current.revision]);
    if (!changed.changes) throw fail('内容已更新，请重新打开后再保存', 409);
    return read(id);
}
async function readVersion(id) {
    await init();
    const row = await get(`SELECT ${versionColumns} FROM gallery_versions WHERE id=?`, [id]);
    if (!row) throw fail('图片版本不存在', 404);
    return version(row);
}
async function asset(id, kind) {
    const columns = { original: 'original', thumbnail: 'thumbnail', preview: 'preview', balanced: 'ai_balanced', precise: 'ai_precise' };
    if (!columns[kind]) throw fail('图片类型不存在', 404);
    await init();
    const row = await get(`SELECT ${columns[kind]} AS bytes,mime,filename FROM gallery_versions WHERE id=?`, [id]);
    if (!row) throw fail('图片不存在', 404);
    return { ...row, mime: kind === 'original' ? row.mime : 'image/jpeg' };
}
async function saveAnalysis(id, mode, analysis) {
    await run("UPDATE gallery_versions SET ai_status='ready',ai_mode=?,ai_json=? WHERE id=?", [mode, JSON.stringify(analysis), id]);
    return readVersion(id);
}
async function failedAnalysis(id) { await run("UPDATE gallery_versions SET ai_status=CASE WHEN ai_status='ready' THEN 'ready' ELSE 'failed' END WHERE id=?", [id]); }
module.exports = { init, categories, addCategory, list, read, update, saveUpload, readVersion, asset, saveAnalysis, failedAnalysis, tags, fail };
