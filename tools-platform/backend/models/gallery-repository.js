const crypto = require('node:crypto');
const { run, get, all, getDbPath } = require('./app-db');
const transaction = require('./gallery-transaction');
const MANUAL_FIELDS = ['title','scope','category_id','album_id','tags','note','storage','version_label'];
function manualFields(value = MANUAL_FIELDS) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { throw fail('手动字段格式无效'); } }
    if (!Array.isArray(value)) throw fail('手动字段格式无效');
    return [...new Set(value.filter(field => MANUAL_FIELDS.includes(field)))];
}

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
        await run(`CREATE TABLE IF NOT EXISTS gallery_albums (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS gallery_items (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'work',
            category_id TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '',
            favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        const columns = await all('PRAGMA table_info(gallery_items)');
        if (!columns.some(column => column.name === 'album_id')) await run("ALTER TABLE gallery_items ADD COLUMN album_id TEXT NOT NULL DEFAULT ''");
        if (!columns.some(column => column.name === 'deleted_at')) await run("ALTER TABLE gallery_items ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''");
        if (!columns.some(column => column.name === 'manual_fields_json')) await run(`ALTER TABLE gallery_items ADD COLUMN manual_fields_json TEXT NOT NULL DEFAULT '${JSON.stringify(MANUAL_FIELDS)}'`);
        await run('CREATE INDEX IF NOT EXISTS idx_gallery_items_album ON gallery_items(album_id, archived, title, id)');
        await run(`CREATE TABLE IF NOT EXISTS gallery_versions (
            id TEXT PRIMARY KEY, item_id TEXT NOT NULL, version_no INTEGER NOT NULL, label TEXT NOT NULL, filename TEXT NOT NULL,
            mime TEXT NOT NULL, original BLOB NOT NULL, thumbnail BLOB NOT NULL, preview BLOB NOT NULL,
            ai_balanced BLOB NOT NULL, ai_precise BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
            sha256 TEXT NOT NULL, ai_status TEXT NOT NULL DEFAULT 'pending', ai_mode TEXT NOT NULL DEFAULT '',
            ai_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(item_id, version_no))`);
        const versionSchema = await all('PRAGMA table_info(gallery_versions)');
        if (!versionSchema.some(column => column.name === 'example_key')) await run("ALTER TABLE gallery_versions ADD COLUMN example_key TEXT NOT NULL DEFAULT ''");
        await run('CREATE INDEX IF NOT EXISTS idx_gallery_versions_item ON gallery_versions(item_id, version_no DESC)');
        await run('CREATE INDEX IF NOT EXISTS idx_gallery_items_updated ON gallery_items(archived, updated_at DESC)');
        for (const [id, name] of [['posters', '工作海报'], ['menus', '餐厅菜单'], ['inspiration', '灵感收藏']]) {
            await run('INSERT OR IGNORE INTO gallery_categories(id,name) VALUES(?,?)', [id, name]);
        }
        if (process.env.TOOLS_GALLERY_EXAMPLES !== '0') await transaction(db => require('./gallery-examples').seed(db));
    })().catch(error => { ready.delete(key); throw error; }));
    return ready.get(key);
}
const versionColumns = `example_key,id,item_id,version_no,label,filename,mime,width,height,sha256,ai_status,ai_mode,ai_json,created_at,
    length(original) AS original_bytes,length(preview) AS preview_bytes`;
function version(row) {
    if (!row) return null;
    const { ai_json, ...rest } = row;
    let analysis = {};
    try { analysis = JSON.parse(ai_json); } catch (_) {}
    if (row.example_key) { rest.source = 'builtin-example'; rest.original_bytes = require('./gallery-example-catalog').asset(row.example_key).size; }
    return { ...rest, analysis, thumbnailUrl: `/api/gallery/versions/${row.id}/thumbnail`, previewUrl: `/api/gallery/versions/${row.id}/preview`, originalUrl: `/api/gallery/versions/${row.id}/original` };
}
function item(row) {
    if (!row) return null;
    const { tags_json, manual_fields_json, ...rest } = row;
    return { ...rest, tags: JSON.parse(tags_json), manualFields: manualFields(manual_fields_json), favorite: !!row.favorite, archived: !!row.archived };
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
async function albums() {
    await init();
    return all(`SELECT a.*, (SELECT COUNT(*) FROM gallery_items i WHERE i.album_id=a.id AND i.archived=0 AND i.deleted_at='') AS item_count,
        (SELECT v.id FROM gallery_items i JOIN gallery_versions v ON v.item_id=i.id WHERE i.album_id=a.id AND i.archived=0 AND i.deleted_at='' ORDER BY i.title,i.id,v.version_no DESC LIMIT 1) AS cover_id
        FROM gallery_albums a ORDER BY a.name COLLATE NOCASE,a.id`);
}
async function addAlbum(name) {
    await init(); name = text(name, 80);
    if (!name) throw fail('请输入相册名称');
    await run('INSERT OR IGNORE INTO gallery_albums(id,name,created_at) VALUES(?,?,?)', [crypto.randomUUID(), name, new Date().toISOString()]);
    return get('SELECT * FROM gallery_albums WHERE name=? COLLATE NOCASE', [name]);
}
async function validateAlbum(id) {
    if (id && !await get('SELECT id FROM gallery_albums WHERE id=?', [id])) throw fail('相册不存在', 404);
    return id || '';
}
async function changeSelection(entries, work) {
    await init();
    if (!Array.isArray(entries) || !entries.length || entries.length > 100 || entries.some(entry => !entry || typeof entry.id !== 'string' || !Number.isInteger(entry.revision) || entry.revision < 0)
        || new Set(entries.map(entry => entry.id)).size !== entries.length) throw fail('请选择 1 至 100 张图片，包含当前版本信息');
    return transaction(async db => {
        const ids = entries.map(entry => entry.id), placeholders = ids.map(() => '?').join(',');
        const existing = await db.all(`SELECT id,revision,deleted_at,manual_fields_json FROM gallery_items WHERE id IN (${placeholders})`, ids);
        if (existing.length !== entries.length) throw fail('部分图片不存在，请刷新列表', 404);
        const revisions = new Map(existing.map(row => [row.id,row.revision]));
        if (entries.some(entry => revisions.get(entry.id) !== entry.revision)) throw fail('部分图片已更新，请刷新列表后重新选择', 409);
        return work(db, existing, placeholders, ids);
    });
}
async function assignAlbum(albumId, entries) {
    return changeSelection(entries,async (db, rows) => {
        if (rows.some(row => row.deleted_at)) throw fail('请先从回收站恢复图片',409);
        if (albumId && !await db.get('SELECT id FROM gallery_albums WHERE id=?',[albumId])) throw fail('相册不存在',404);
        for (const row of rows) {
            const manual = [...new Set([...manualFields(row.manual_fields_json),'album_id','storage'])];
            await db.execute('UPDATE gallery_items SET album_id=?,manual_fields_json=?,revision=revision+1,updated_at=? WHERE id=?',[albumId || '',JSON.stringify(manual),new Date().toISOString(),row.id]);
        }
        return {assigned:rows.length,albumId:albumId || ''};
    });
}
async function trash(entries, restore = false) {
    return changeSelection(entries,async (db,rows,placeholders,ids) => {
        if (rows.some(row => restore ? !row.deleted_at : !!row.deleted_at)) throw fail('图片状态已变化，请刷新列表',409);
        const now = new Date().toISOString();
        await db.execute(`UPDATE gallery_items SET deleted_at=?,revision=revision+1,updated_at=? WHERE id IN (${placeholders})`,[restore ? '' : now,now,...ids]);
        return {changed:rows.length,restored:restore};
    });
}
async function organizationCandidates(excludeId) {
    await init();
    return all(`SELECT i.id,i.title,i.tags_json,i.album_id,v.id AS version_id,v.filename,v.ai_json FROM gallery_items i
        JOIN gallery_versions v ON v.id=(SELECT id FROM gallery_versions WHERE item_id=i.id ORDER BY version_no DESC LIMIT 1)
        WHERE i.id!=? AND i.archived=0 AND i.deleted_at='' ORDER BY i.updated_at DESC LIMIT 40`,[excludeId]);
}
async function findDuplicate(hash) {
    await init();
    return get(`SELECT v.id,v.item_id FROM gallery_versions v JOIN gallery_items i ON i.id=v.item_id WHERE v.sha256=? AND i.deleted_at='' AND i.archived=0 LIMIT 1`,[hash]);
}
async function list(options = {}) {
    await init();
    const where = [options.trash === '1' ? "i.deleted_at!=''" : "i.deleted_at=''"], params = [];
    if (options.trash !== '1') { where.push('i.archived=?'); params.push(options.archived === '1' ? 1 : 0); }
    if (options.unfiled === '1') where.push("i.album_id=''");
    if (options.home === '1') where.push("(i.album_id='' OR i.scope='work')");
    if (['work', 'life'].includes(options.scope)) { where.push('i.scope=?'); params.push(options.scope); }
    if (options.category) { where.push('i.category_id=?'); params.push(options.category === 'uncategorized' ? '' : text(options.category, 64)); }
    if (options.album) { await validateAlbum(text(options.album,64)); where.push('i.album_id=?'); params.push(text(options.album,64)); }
    if (options.favorite === '1') where.push('i.favorite=1');
    if (options.pending === '1') where.push("EXISTS(SELECT 1 FROM gallery_versions v WHERE v.item_id=i.id AND v.ai_status!='ready')");
    if (options.q) {
        const q = '%' + text(options.q, 120).replace(/[\\%_]/g, '\\$&') + '%';
        where.push(`(i.title LIKE ? ESCAPE '\\' OR i.tags_json LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\'
            OR EXISTS(SELECT 1 FROM gallery_categories c WHERE c.id=i.category_id AND c.name LIKE ? ESCAPE '\\')
            OR EXISTS(SELECT 1 FROM gallery_versions v WHERE v.item_id=i.id AND (v.ai_json LIKE ? ESCAPE '\\' OR v.filename LIKE ? ESCAPE '\\' OR v.label LIKE ? ESCAPE '\\'))
            OR EXISTS(SELECT 1 FROM gallery_albums a WHERE a.id=i.album_id AND a.name LIKE ? ESCAPE '\\'))`);
        params.push(q, q, q, q, q, q, q, q);
    }
    const clause = where.join(' AND ');
    const { total } = await get(`SELECT COUNT(*) AS total FROM gallery_items i WHERE ${clause}`, params);
    const pageSize = 36, pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.max(1, Math.min(pages, Math.trunc(Number(options.page)) || 1));
    const order = options.sort === 'title' ? 'i.title COLLATE NOCASE ASC' : options.sort === 'oldest' ? 'i.created_at ASC' : 'i.updated_at DESC';
    const rows = await all(`SELECT i.*,
        EXISTS(SELECT 1 FROM gallery_versions v WHERE v.item_id=i.id AND v.example_key!='') AS is_example,
        (SELECT name FROM gallery_albums a WHERE a.id=i.album_id) AS album_name,
        (SELECT COUNT(*) FROM gallery_versions v WHERE v.item_id=i.id) AS version_count,
        (SELECT id FROM gallery_versions v WHERE v.item_id=i.id ORDER BY version_no DESC LIMIT 1) AS cover_id
        FROM gallery_items i WHERE ${clause} ORDER BY ${order},i.id LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    return { items: rows.map(item), total, page, pages };
}
async function read(id) {
    await init();
    const row = item(await get('SELECT * FROM gallery_items WHERE id=?', [id]));
    if (!row) throw fail('图片不存在', 404);
    if (row.album_id) {
        row.album_name = (await get('SELECT name FROM gallery_albums WHERE id=?', [row.album_id]))?.name || '';
        const params = [row.album_id,row.title,row.title,row.id];
        row.album_previous = await get(`SELECT id,title FROM gallery_items WHERE album_id=? AND archived=0 AND deleted_at='' AND (title COLLATE NOCASE < ? OR (title=? COLLATE NOCASE AND id<?)) ORDER BY title COLLATE NOCASE DESC,id DESC LIMIT 1`, params) || null;
        row.album_next = await get(`SELECT id,title FROM gallery_items WHERE album_id=? AND archived=0 AND deleted_at='' AND (title COLLATE NOCASE > ? OR (title=? COLLATE NOCASE AND id>?)) ORDER BY title COLLATE NOCASE,id LIMIT 1`, params) || null;
    }
    return { ...row, versions: (await all(`SELECT ${versionColumns} FROM gallery_versions WHERE item_id=? ORDER BY version_no DESC`, [id])).map(version) };
}
async function saveUpload({ itemId, title, scope, category, album, label, filename, mime, original, processed, manualFields: manual, tags: uploadTags, note }) {
    await init();
    const categoryId = await validateCategory(text(category, 64));
    const albumId = itemId ? '' : await validateAlbum(text(album,64));
    const id = itemId || crypto.randomUUID(), now = new Date().toISOString();
    if (itemId) {
        const existing = await read(id);
        if (existing.archived || existing.deleted_at) throw fail('请先恢复已归档或删除的图片', 409);
    }
    const hash = crypto.createHash('sha256').update(original).digest('hex');
    if (itemId) {
        const duplicate = await get('SELECT id FROM gallery_versions WHERE item_id=? AND sha256=?', [id, hash]);
        if (duplicate) return { item: await read(id), versionId: duplicate.id, duplicate: true };
    }
    const versionId = crypto.randomUUID();
    // A group is inserted only after image processing succeeds. On insert failure, remove only the empty new group.
    if (!itemId) await run(`INSERT INTO gallery_items(id,title,scope,category_id,album_id,tags_json,note,manual_fields_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [id, text(title || filename, 120) || '未命名图片', scope === 'life' ? 'life' : 'work', categoryId, albumId, JSON.stringify(tags(uploadTags)),text(note,2000),JSON.stringify(manualFields(manual)), now, now]);
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
    if (current.deleted_at) throw fail('请先从回收站恢复图片', 409);
    if (Number(data.revision) !== current.revision) throw fail('内容已更新，请重新打开后再保存', 409);
    const title = text(data.title ?? current.title, 120);
    if (!title) throw fail('请输入标题');
    const category = await validateCategory(text(data.category_id ?? current.category_id, 64));
    const album = await validateAlbum(text(data.album_id ?? current.album_id,64));
    const manual = new Set(current.manualFields);
    for (const field of ['title','scope','category_id','album_id','tags','note']) {
        if (Object.hasOwn(data,field) && JSON.stringify(field === 'tags' ? tags(data[field]) : data[field]) !== JSON.stringify(current[field])) manual.add(field);
    }
    const changed = await run(`UPDATE gallery_items SET title=?,scope=?,category_id=?,album_id=?,tags_json=?,note=?,favorite=?,archived=?,manual_fields_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`,
        [title, (data.scope ?? current.scope) === 'life' ? 'life' : 'work', category, album, JSON.stringify(tags(data.tags ?? current.tags)), text(data.note ?? current.note, 2000),
            (data.favorite ?? current.favorite) ? 1 : 0, (data.archived ?? current.archived) ? 1 : 0, JSON.stringify([...manual]), new Date().toISOString(), id, current.revision]);
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
    const row = await get(`SELECT ${columns[kind]} AS bytes,mime,filename,example_key FROM gallery_versions WHERE id=?`, [id]);
    if (!row) throw fail('图片不存在', 404);
    if (row.example_key) return {filename:row.filename,...await require('./gallery-examples').asset(row.example_key,kind)};
    return { ...row, mime: kind === 'original' ? row.mime : 'image/jpeg' };
}
async function saveAnalysis(id, mode, analysis) {
    await run("UPDATE gallery_versions SET ai_status='ready',ai_mode=?,ai_json=? WHERE id=?", [mode, JSON.stringify(analysis), id]);
    return readVersion(id);
}
async function failedAnalysis(id) { await run("UPDATE gallery_versions SET ai_status=CASE WHEN ai_status='ready' THEN 'ready' ELSE 'failed' END WHERE id=?", [id]); }
module.exports = { init, categories, addCategory, albums, addAlbum, assignAlbum, trash, organizationCandidates, findDuplicate, manualFields, list, read, update, saveUpload, readVersion, asset, saveAnalysis, failedAnalysis, tags, fail };
