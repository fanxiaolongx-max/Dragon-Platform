const crypto = require('crypto');
const tenantPool = require('./tenant-sqlite-pool');
const SEED = require('../builtin-tools/datacom-protocol-expert/knowledge-seed.json');

// 数通协议专家知识库：按租户独立存放在 datacom-knowledge.db，不与 tools.db 混用。
const DB_FILENAME = 'datacom-knowledge.db';
const MAX_BODY_CHARS = 2 * 1024 * 1024;
const MAX_BATCH = 200;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const VISUAL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const readiness = new WeakMap();
const writeQueues = new WeakMap();

function knowledgeError(message, status = 400, code = 'DATACOM_INVALID') {
    return Object.assign(new Error(message), { status, code });
}

function run(connection, sql, params = []) {
    return new Promise((resolve, reject) => connection.run(sql, params, function onRun(error) {
        error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
    }));
}

function get(connection, sql, params = []) {
    return new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function all(connection, sql, params = []) {
    return new Promise((resolve, reject) => connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

// 同一个连接被多个请求共享：写事务串行排队，避免 BEGIN 嵌套
function transaction(connection, work) {
    const previous = writeQueues.get(connection) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
        await run(connection, 'BEGIN IMMEDIATE');
        try {
            const result = await work();
            await run(connection, 'COMMIT');
            return result;
        } catch (error) {
            await run(connection, 'ROLLBACK').catch(() => {});
            throw error;
        }
    });
    writeQueues.set(connection, next.catch(() => {}));
    return next;
}

// 写入频率很低；每次写后把 WAL 合并进主库，使按文件复制的租户备份拿到完整数据。
async function checkpoint(connection) {
    await run(connection, 'PRAGMA wal_checkpoint(TRUNCATE)').catch(() => {});
}

const nowIso = () => new Date().toISOString();
const parseJson = (value, fallback) => {
    try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
};

async function createSchema(connection) {
    await run(connection, `CREATE TABLE IF NOT EXISTS dk_meta (key TEXT PRIMARY KEY, value TEXT)`);
    await run(connection, `CREATE TABLE IF NOT EXISTS dk_domains (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        sort INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'user', updated_at TEXT NOT NULL
    )`);
    await run(connection, `CREATE TABLE IF NOT EXISTS dk_categories (
        id TEXT PRIMARY KEY, domain_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        sort INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'user', updated_at TEXT NOT NULL
    )`);
    await run(connection, `CREATE TABLE IF NOT EXISTS dk_articles (
        id TEXT PRIMARY KEY, category_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
        difficulty INTEGER NOT NULL DEFAULT 3, tags_json TEXT NOT NULL DEFAULT '[]', key_points_json TEXT NOT NULL DEFAULT '[]',
        visuals_json TEXT NOT NULL DEFAULT '[]', related_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT '',
        body_md TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'user',
        edited INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT ''
    )`);
    await run(connection, 'CREATE INDEX IF NOT EXISTS idx_dk_articles_category ON dk_articles(category_id, sort)');
    const columns = new Set((await all(connection, 'PRAGMA table_info(dk_articles)')).map(row => row.name));
    if (!columns.has('short_title')) await run(connection, "ALTER TABLE dk_articles ADD COLUMN short_title TEXT NOT NULL DEFAULT ''");
    // NULL 表示历史数据尚未判定哪些字段由 AI 整理
    if (!columns.has('ai_fields_json')) await run(connection, 'ALTER TABLE dk_articles ADD COLUMN ai_fields_json TEXT');
    await run(connection, `CREATE TABLE IF NOT EXISTS dk_outline (
        id TEXT PRIMARY KEY, domain_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, status TEXT,
        note TEXT NOT NULL DEFAULT '', articles_json TEXT NOT NULL DEFAULT '[]', sort INTEGER NOT NULL DEFAULT 0,
        origin TEXT NOT NULL DEFAULT 'user', edited INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT ''
    )`);
    await run(connection, 'CREATE INDEX IF NOT EXISTS idx_dk_outline_domain ON dk_outline(domain_id, parent_id, sort)');
    await run(connection, `CREATE TABLE IF NOT EXISTS dk_article_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL, revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT ''
    )`);
    await run(connection, 'CREATE INDEX IF NOT EXISTS idx_dk_revisions_article ON dk_article_revisions(article_id, revision)');
}

// 种子升级：新增的分类/文章补齐；从未被人工编辑过的种子文章随新版本刷新；
// 已编辑或已删除的文章保持用户的结果不变。
async function applySeed(connection) {
    const row = await get(connection, "SELECT value FROM dk_meta WHERE key = 'seed_version'");
    const current = Number(row?.value || 0);
    if (current >= SEED.version) return;
    const stamp = nowIso();
    await transaction(connection, async () => {
        for (const domain of SEED.domains) {
            await run(connection, `INSERT INTO dk_domains (id, name, icon, description, sort, origin, updated_at) VALUES (?, ?, ?, ?, ?, 'seed', ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, description = excluded.description, sort = excluded.sort, updated_at = excluded.updated_at
                WHERE dk_domains.origin = 'seed'`, [domain.id, domain.name, domain.icon, domain.description, domain.sort, stamp]);
        }
        for (const category of SEED.categories) {
            await run(connection, `INSERT INTO dk_categories (id, domain_id, name, description, sort, origin, updated_at) VALUES (?, ?, ?, ?, ?, 'seed', ?)
                ON CONFLICT(id) DO UPDATE SET domain_id = excluded.domain_id, name = excluded.name, description = excluded.description, sort = excluded.sort, updated_at = excluded.updated_at
                WHERE dk_categories.origin = 'seed'`, [category.id, category.domainId, category.name, category.description, category.sort, stamp]);
        }
        for (const article of SEED.articles) {
            const normalized = normalizeArticle(article, { partial: false });
            const values = articleColumns(normalized);
            await run(connection, `INSERT INTO dk_articles (id, category_id, title, summary, difficulty, tags_json, key_points_json, visuals_json, related_json, source, body_md, sort, short_title, ai_fields_json, origin, edited, deleted, revision, created_at, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', 0, 0, 1, ?, ?, 'system')
                ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, title = excluded.title, summary = excluded.summary, difficulty = excluded.difficulty,
                    tags_json = excluded.tags_json, key_points_json = excluded.key_points_json, visuals_json = excluded.visuals_json, related_json = excluded.related_json,
                    source = excluded.source, body_md = excluded.body_md, sort = excluded.sort, short_title = excluded.short_title, ai_fields_json = excluded.ai_fields_json,
                    revision = dk_articles.revision + 1, updated_at = excluded.updated_at
                WHERE dk_articles.origin = 'seed' AND dk_articles.edited = 0 AND dk_articles.deleted = 0`,
            [article.id, ...values, JSON.stringify(article.aiFields || []), stamp, stamp]);
            // 已被人工编辑的种子文章：只补齐新字段，AI 标记仅保留仍与种子原值一致的字段
            const existing = await get(connection, 'SELECT summary, key_points_json, visuals_json FROM dk_articles WHERE id = ? AND edited = 1 AND ai_fields_json IS NULL', [article.id]);
            if (existing) {
                const same = { summary: existing.summary === normalized.summary, keyPoints: existing.key_points_json === JSON.stringify(normalized.keyPoints), visuals: existing.visuals_json === JSON.stringify(normalized.visuals) };
                await run(connection, 'UPDATE dk_articles SET ai_fields_json = ? WHERE id = ?', [JSON.stringify((article.aiFields || []).filter(field => same[field])), article.id]);
            }
            await run(connection, "UPDATE dk_articles SET short_title = ? WHERE id = ? AND short_title = ''", [normalized.shortTitle, article.id]);
        }
        for (const node of SEED.outline || []) {
            await run(connection, `INSERT INTO dk_outline (id, domain_id, parent_id, title, status, note, articles_json, sort, origin, edited, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed', 0, ?, 'system')
                ON CONFLICT(id) DO UPDATE SET domain_id = excluded.domain_id, parent_id = excluded.parent_id, title = excluded.title, status = excluded.status,
                    note = excluded.note, articles_json = excluded.articles_json, sort = excluded.sort, updated_at = excluded.updated_at
                WHERE dk_outline.origin = 'seed' AND dk_outline.edited = 0`,
            [node.id, node.domainId, node.parentId, node.title, node.status, node.note, JSON.stringify(node.articles), node.sort, stamp]);
        }
        await run(connection, "INSERT INTO dk_meta (key, value) VALUES ('learning_path', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(SEED.learningPath)]);
        await run(connection, "INSERT INTO dk_meta (key, value) VALUES ('seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(SEED.version)]);
    });
    await checkpoint(connection);
}

async function readyConnection() {
    const connection = tenantPool.getConnection(DB_FILENAME);
    if (!readiness.has(connection)) {
        const ready = (async () => {
            await createSchema(connection);
            await applySeed(connection);
        })().catch(error => {
            readiness.delete(connection);
            throw error;
        });
        readiness.set(connection, ready);
    }
    await readiness.get(connection);
    return connection;
}

function cleanText(value, max, field, { required = false } = {}) {
    const text = value === undefined || value === null ? '' : String(value);
    if (text.length > max) throw knowledgeError(`${field} 超过 ${max} 字符`);
    if (required && !text.trim()) throw knowledgeError(`${field} 不能为空`);
    return text;
}

function cleanList(value, field, { maxItems = 50, maxLength = 500, pattern = null } = {}) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > maxItems) throw knowledgeError(`${field} 必须是不超过 ${maxItems} 项的数组`);
    const seen = new Set();
    return value.map(item => cleanText(item, maxLength, field).trim()).filter(item => {
        if (!item || seen.has(item)) return false;
        if (pattern && !pattern.test(item)) throw knowledgeError(`${field} 包含无效值：${item}`);
        seen.add(item);
        return true;
    });
}

function normalizeId(value, field = 'ID') {
    const id = String(value || '').trim();
    if (!ID_RE.test(id)) throw knowledgeError(`${field} 只能包含小写字母、数字和短横线（2~64 位）`);
    return id;
}

function normalizeArticle(input, { partial }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw knowledgeError('文章数据格式错误');
    const difficulty = input.difficulty === undefined ? 3 : Number(input.difficulty);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw knowledgeError('难度必须是 1~5 的整数');
    const sort = input.sort === undefined ? 0 : Number(input.sort);
    if (!Number.isSafeInteger(sort)) throw knowledgeError('排序值无效');
    return {
        categoryId: partial && input.categoryId === undefined ? undefined : normalizeId(input.categoryId, '分类'),
        title: cleanText(input.title, 200, '标题', { required: true }).trim(),
        shortTitle: cleanText(input.shortTitle, 40, '目录短标题').trim(),
        summary: cleanText(input.summary, 2000, '摘要').trim(),
        difficulty,
        tags: cleanList(input.tags, '标签', { maxItems: 20, maxLength: 40 }),
        keyPoints: cleanList(input.keyPoints, '核心要点', { maxItems: 30, maxLength: 600 }),
        visuals: cleanList(input.visuals, '可视化', { maxItems: 20, maxLength: 40, pattern: VISUAL_RE }),
        related: cleanList(input.related, '关联文章', { maxItems: 30, maxLength: 64, pattern: ID_RE }),
        source: cleanText(input.source, 500, '来源').trim(),
        bodyMd: cleanText(input.bodyMd, MAX_BODY_CHARS, '正文'),
        sort
    };
}

function articleColumns(article) {
    return [article.categoryId, article.title, article.summary, article.difficulty, JSON.stringify(article.tags), JSON.stringify(article.keyPoints),
        JSON.stringify(article.visuals), JSON.stringify(article.related), article.source, article.bodyMd, article.sort, article.shortTitle];
}

function unpackArticle(row, { withBody = true } = {}) {
    if (!row) return null;
    const article = {
        id: row.id,
        categoryId: row.category_id,
        title: row.title,
        shortTitle: row.short_title || '',
        aiFields: parseJson(row.ai_fields_json, []),
        summary: row.summary,
        difficulty: row.difficulty,
        tags: parseJson(row.tags_json, []),
        keyPoints: parseJson(row.key_points_json, []),
        visuals: parseJson(row.visuals_json, []),
        related: parseJson(row.related_json, []),
        source: row.source,
        sort: row.sort,
        origin: row.origin,
        edited: Boolean(row.edited),
        revision: row.revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
        bodyLength: row.body_length !== undefined ? row.body_length : String(row.body_md || '').length
    };
    if (withBody) article.bodyMd = row.body_md;
    return article;
}

async function ensureCategory(connection, categoryId) {
    const category = await get(connection, 'SELECT id FROM dk_categories WHERE id = ?', [categoryId]);
    if (!category) throw knowledgeError('分类不存在，请先创建分类', 400, 'DATACOM_CATEGORY_MISSING');
}

async function loadCatalog({ withBody = false } = {}) {
    const connection = await readyConnection();
    const [domains, categories, rows, pathRow] = await Promise.all([
        all(connection, 'SELECT * FROM dk_domains ORDER BY sort, name'),
        all(connection, 'SELECT * FROM dk_categories ORDER BY sort, name'),
        all(connection, `SELECT id, category_id, title, short_title, ai_fields_json, summary, difficulty, tags_json, key_points_json, visuals_json, related_json, source, sort, origin, edited,
            revision, created_at, updated_at, updated_by, ${withBody ? 'body_md' : 'length(body_md) AS body_length'} FROM dk_articles WHERE deleted = 0 ORDER BY sort, title`),
        get(connection, "SELECT value FROM dk_meta WHERE key = 'learning_path'")
    ]);
    const outline = await all(connection, 'SELECT * FROM dk_outline ORDER BY domain_id, sort, title');
    return {
        domains: domains.map(item => ({ id: item.id, name: item.name, icon: item.icon, description: item.description, sort: item.sort, origin: item.origin })),
        categories: categories.map(item => ({ id: item.id, domainId: item.domain_id, name: item.name, description: item.description, sort: item.sort, origin: item.origin })),
        articles: rows.map(row => unpackArticle(row, { withBody })),
        learningPath: parseJson(pathRow?.value, []),
        outline: outline.map(unpackOutline)
    };
}

const OUTLINE_STATUS = new Set(['covered', 'partial', 'added']);
const unpackOutline = row => ({ id: row.id, domainId: row.domain_id, parentId: row.parent_id, title: row.title, status: row.status, note: row.note,
    articles: parseJson(row.articles_json, []), sort: row.sort, origin: row.origin, edited: Boolean(row.edited), updatedAt: row.updated_at, updatedBy: row.updated_by });

function normalizeOutline(input, { create }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw knowledgeError('大纲数据格式错误');
    const parentId = input.parentId ? normalizeId(input.parentId, '上级章节') : null;
    const status = parentId ? String(input.status || '') : null;
    if (parentId && !OUTLINE_STATUS.has(status)) throw knowledgeError('知识点状态必须是 covered / partial / added');
    const sort = input.sort === undefined ? 100 : Number(input.sort);
    if (!Number.isSafeInteger(sort)) throw knowledgeError('排序值无效');
    return {
        id: create ? (input.id ? normalizeId(input.id, '大纲 ID') : `outline-${crypto.randomBytes(4).toString('hex')}`) : null,
        domainId: normalizeId(input.domainId, '所属领域'),
        parentId,
        title: cleanText(input.title, 120, '大纲标题', { required: true }).trim(),
        status,
        note: cleanText(input.note, 2000, '说明').trim(),
        articles: cleanList(input.articles, '关联文章', { maxItems: 20, maxLength: 64, pattern: ID_RE }),
        sort
    };
}

async function saveOutline(input, actor, id = null) {
    const node = normalizeOutline(input, { create: !id });
    const nodeId = id ? normalizeId(id, '大纲 ID') : node.id;
    const connection = await readyConnection();
    await transaction(connection, async () => {
        if (!await get(connection, 'SELECT id FROM dk_domains WHERE id = ?', [node.domainId])) throw knowledgeError('所属领域不存在', 400, 'DATACOM_DOMAIN_MISSING');
        if (node.parentId) {
            const parent = await get(connection, 'SELECT parent_id, domain_id FROM dk_outline WHERE id = ?', [node.parentId]);
            if (!parent || parent.parent_id || parent.domain_id !== node.domainId) throw knowledgeError('上级章节无效（只支持“章节 → 知识点”两级）');
        }
        const stamp = nowIso();
        const existing = await get(connection, 'SELECT parent_id FROM dk_outline WHERE id = ?', [nodeId]);
        if (id) {
            if (!existing) throw knowledgeError('大纲节点不存在', 404, 'DATACOM_NOT_FOUND');
            if (Boolean(existing.parent_id) !== Boolean(node.parentId)) throw knowledgeError('不能在章节与知识点之间转换');
            await run(connection, `UPDATE dk_outline SET domain_id = ?, parent_id = ?, title = ?, status = ?, note = ?, articles_json = ?, sort = ?, edited = 1, updated_at = ?, updated_by = ? WHERE id = ?`,
                [node.domainId, node.parentId, node.title, node.status, node.note, JSON.stringify(node.articles), node.sort, stamp, actor, nodeId]);
        } else {
            if (existing) throw knowledgeError(`大纲 ID 已存在：${nodeId}`, 409, 'DATACOM_ID_EXISTS');
            await run(connection, `INSERT INTO dk_outline (id, domain_id, parent_id, title, status, note, articles_json, sort, origin, edited, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user', 1, ?, ?)`, [nodeId, node.domainId, node.parentId, node.title, node.status, node.note, JSON.stringify(node.articles), node.sort, stamp, actor]);
        }
    });
    await checkpoint(connection);
    return { id: nodeId };
}

async function deleteOutline(id) {
    const nodeId = normalizeId(id, '大纲 ID');
    const connection = await readyConnection();
    await transaction(connection, async () => {
        const children = await get(connection, 'SELECT COUNT(*) AS count FROM dk_outline WHERE parent_id = ?', [nodeId]);
        if (children.count) throw knowledgeError(`章节下还有 ${children.count} 个知识点，请先删除`, 409, 'DATACOM_OUTLINE_IN_USE');
        const result = await run(connection, 'DELETE FROM dk_outline WHERE id = ?', [nodeId]);
        if (!result.changes) throw knowledgeError('大纲节点不存在', 404, 'DATACOM_NOT_FOUND');
    });
    await checkpoint(connection);
    return { ok: true, id: nodeId };
}

async function getArticle(id) {
    const connection = await readyConnection();
    const row = await get(connection, 'SELECT * FROM dk_articles WHERE id = ? AND deleted = 0', [normalizeId(id, '文章 ID')]);
    if (!row) throw knowledgeError('文章不存在', 404, 'DATACOM_NOT_FOUND');
    return unpackArticle(row);
}

async function saveRevision(connection, row, actor) {
    await run(connection, 'INSERT INTO dk_article_revisions (article_id, revision, payload_json, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
        [row.id, row.revision, JSON.stringify(unpackArticle(row)), nowIso(), actor]);
    // 每篇文章只保留最近 50 个历史版本
    await run(connection, `DELETE FROM dk_article_revisions WHERE article_id = ? AND id NOT IN (
        SELECT id FROM dk_article_revisions WHERE article_id = ? ORDER BY id DESC LIMIT 50)`, [row.id, row.id]);
}

function uniqueIdFromTitle(title, taken) {
    const ascii = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const hash = crypto.createHash('sha1').update(String(title || '') + Math.random()).digest('hex').slice(0, 6);
    let id = ascii.length >= 3 ? `${ascii}-${hash}` : `article-${hash}`;
    while (taken.has(id)) id = `article-${crypto.randomBytes(3).toString('hex')}`;
    return id;
}

async function insertArticle(connection, input, actor, taken) {
    const article = normalizeArticle(input, { partial: false });
    await ensureCategory(connection, article.categoryId);
    const id = input.id ? normalizeId(input.id, '文章 ID') : uniqueIdFromTitle(article.title, taken);
    const existing = await get(connection, 'SELECT id, deleted FROM dk_articles WHERE id = ?', [id]);
    if (existing && !existing.deleted) throw knowledgeError(`文章 ID 已存在：${id}`, 409, 'DATACOM_ID_EXISTS');
    const stamp = nowIso();
    if (existing) await run(connection, 'DELETE FROM dk_articles WHERE id = ?', [id]);
    await run(connection, `INSERT INTO dk_articles (id, category_id, title, summary, difficulty, tags_json, key_points_json, visuals_json, related_json, source, body_md, sort, short_title, ai_fields_json, origin, edited, deleted, revision, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'user', 1, 0, 1, ?, ?, ?)`, [id, ...articleColumns(article), stamp, stamp, actor]);
    taken.add(id);
    return id;
}

async function createArticles(inputs, actor) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_BATCH) throw knowledgeError(`一次最多导入 ${MAX_BATCH} 篇文章`);
    const connection = await readyConnection();
    const taken = new Set((await all(connection, 'SELECT id FROM dk_articles')).map(row => row.id));
    const ids = await transaction(connection, async () => {
        const created = [];
        for (const input of inputs) created.push(await insertArticle(connection, input, actor, taken));
        return created;
    });
    await checkpoint(connection);
    return ids;
}

async function updateArticle(id, input, expectedRevision, actor) {
    const articleId = normalizeId(id, '文章 ID');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw knowledgeError('缺少有效的文章版本号，请刷新后重试', 400, 'DATACOM_INVALID_REVISION');
    const article = normalizeArticle(input, { partial: false });
    const connection = await readyConnection();
    await ensureCategory(connection, article.categoryId);
    const result = await transaction(connection, async () => {
        const row = await get(connection, 'SELECT * FROM dk_articles WHERE id = ? AND deleted = 0', [articleId]);
        if (!row) throw knowledgeError('文章不存在', 404, 'DATACOM_NOT_FOUND');
        if (row.revision !== expectedRevision) throw knowledgeError('文章已被其他人更新，请刷新后再编辑', 409, 'DATACOM_REVISION_CONFLICT');
        await saveRevision(connection, row, actor);
        const stamp = nowIso();
        // 人工改过的字段不再标记为“AI 整理”
        const changed = { summary: row.summary !== article.summary, keyPoints: row.key_points_json !== JSON.stringify(article.keyPoints), visuals: row.visuals_json !== JSON.stringify(article.visuals) };
        const aiFields = parseJson(row.ai_fields_json, []).filter(field => !changed[field]);
        await run(connection, `UPDATE dk_articles SET category_id = ?, title = ?, summary = ?, difficulty = ?, tags_json = ?, key_points_json = ?, visuals_json = ?,
            related_json = ?, source = ?, body_md = ?, sort = ?, short_title = ?, ai_fields_json = ?, edited = 1, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
        [...articleColumns(article), JSON.stringify(aiFields), stamp, actor, articleId, expectedRevision]);
        return { revision: expectedRevision + 1, updatedAt: stamp };
    });
    await checkpoint(connection);
    return result;
}

async function deleteArticle(id, actor) {
    const articleId = normalizeId(id, '文章 ID');
    const connection = await readyConnection();
    await transaction(connection, async () => {
        const row = await get(connection, 'SELECT * FROM dk_articles WHERE id = ? AND deleted = 0', [articleId]);
        if (!row) throw knowledgeError('文章不存在', 404, 'DATACOM_NOT_FOUND');
        await saveRevision(connection, row, actor);
        // 软删除：种子升级不会让用户删掉的文章复活，历史版本仍可追溯
        await run(connection, 'UPDATE dk_articles SET deleted = 1, edited = 1, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?', [nowIso(), actor, articleId]);
    });
    await checkpoint(connection);
    return { ok: true, id: articleId };
}

async function listRevisions(id) {
    const connection = await readyConnection();
    const rows = await all(connection, 'SELECT id, revision, created_at, created_by, payload_json FROM dk_article_revisions WHERE article_id = ? ORDER BY id DESC LIMIT 50', [normalizeId(id, '文章 ID')]);
    return rows.map(row => {
        const payload = parseJson(row.payload_json, {});
        return { id: row.id, revision: row.revision, createdAt: row.created_at, createdBy: row.created_by, title: payload.title, bodyLength: String(payload.bodyMd || '').length };
    });
}

async function getRevision(articleId, revisionId) {
    const connection = await readyConnection();
    const row = await get(connection, 'SELECT payload_json FROM dk_article_revisions WHERE article_id = ? AND id = ?', [normalizeId(articleId, '文章 ID'), Number(revisionId)]);
    if (!row) throw knowledgeError('历史版本不存在', 404, 'DATACOM_NOT_FOUND');
    return parseJson(row.payload_json, null);
}

async function saveDomain(input, { create }) {
    const id = normalizeId(input?.id, '领域 ID');
    const name = cleanText(input?.name, 80, '领域名称', { required: true }).trim();
    const icon = cleanText(input?.icon, 16, '图标').trim();
    const description = cleanText(input?.description, 500, '描述').trim();
    const sort = Number.isSafeInteger(Number(input?.sort)) ? Number(input.sort) : 100;
    const connection = await readyConnection();
    const existing = await get(connection, 'SELECT id FROM dk_domains WHERE id = ?', [id]);
    if (create && existing) throw knowledgeError(`领域 ID 已存在：${id}`, 409, 'DATACOM_ID_EXISTS');
    if (!create && !existing) throw knowledgeError('领域不存在', 404, 'DATACOM_NOT_FOUND');
    // 人工修改过的种子领域转为 user，避免下次种子升级覆盖
    await transaction(connection, () => run(connection, `INSERT INTO dk_domains (id, name, icon, description, sort, origin, updated_at) VALUES (?, ?, ?, ?, ?, 'user', ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, description = excluded.description, sort = excluded.sort, origin = 'user', updated_at = excluded.updated_at`,
    [id, name, icon, description, sort, nowIso()]));
    await checkpoint(connection);
    return { id };
}

async function saveCategory(input, { create }) {
    const id = normalizeId(input?.id, '分类 ID');
    const domainId = normalizeId(input?.domainId, '所属领域');
    const name = cleanText(input?.name, 80, '分类名称', { required: true }).trim();
    const description = cleanText(input?.description, 500, '描述').trim();
    const sort = Number.isSafeInteger(Number(input?.sort)) ? Number(input.sort) : 100;
    const connection = await readyConnection();
    if (!await get(connection, 'SELECT id FROM dk_domains WHERE id = ?', [domainId])) throw knowledgeError('所属领域不存在', 400, 'DATACOM_DOMAIN_MISSING');
    const existing = await get(connection, 'SELECT id FROM dk_categories WHERE id = ?', [id]);
    if (create && existing) throw knowledgeError(`分类 ID 已存在：${id}`, 409, 'DATACOM_ID_EXISTS');
    if (!create && !existing) throw knowledgeError('分类不存在', 404, 'DATACOM_NOT_FOUND');
    await transaction(connection, () => run(connection, `INSERT INTO dk_categories (id, domain_id, name, description, sort, origin, updated_at) VALUES (?, ?, ?, ?, ?, 'user', ?)
        ON CONFLICT(id) DO UPDATE SET domain_id = excluded.domain_id, name = excluded.name, description = excluded.description, sort = excluded.sort, origin = 'user', updated_at = excluded.updated_at`,
    [id, domainId, name, description, sort, nowIso()]));
    await checkpoint(connection);
    return { id };
}

async function deleteCategory(id) {
    const categoryId = normalizeId(id, '分类 ID');
    const connection = await readyConnection();
    await transaction(connection, async () => {
        const used = await get(connection, 'SELECT COUNT(*) AS count FROM dk_articles WHERE category_id = ? AND deleted = 0', [categoryId]);
        if (used.count) throw knowledgeError(`分类下还有 ${used.count} 篇文章，请先移动或删除`, 409, 'DATACOM_CATEGORY_IN_USE');
        await run(connection, 'DELETE FROM dk_categories WHERE id = ?', [categoryId]);
    });
    await checkpoint(connection);
    return { ok: true, id: categoryId };
}

function escapeLike(text) {
    return text.replace(/[\\%_]/g, match => `\\${match}`);
}

function snippet(body, keyword) {
    const text = String(body || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`|]/g, ' ').replace(/\s+/g, ' ');
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index < 0) return text.slice(0, 120);
    return `${index > 40 ? '…' : ''}${text.slice(Math.max(0, index - 40), index + keyword.length + 80)}…`;
}

async function search(query) {
    const keyword = String(query || '').trim().slice(0, 80);
    if (!keyword) return [];
    const connection = await readyConnection();
    const like = `%${escapeLike(keyword)}%`;
    const rows = await all(connection, `SELECT id, title, summary, category_id, body_md,
        (CASE WHEN title LIKE ? ESCAPE '\\' THEN 3 ELSE 0 END) + (CASE WHEN summary LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR key_points_json LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END)
        + (CASE WHEN body_md LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS score
        FROM dk_articles WHERE deleted = 0 AND (title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR key_points_json LIKE ? ESCAPE '\\' OR body_md LIKE ? ESCAPE '\\')
        ORDER BY score DESC, sort LIMIT 40`, [like, like, like, like, like, like, like, like, like, like]);
    return rows.map(row => ({ id: row.id, title: row.title, categoryId: row.category_id, summary: row.summary, score: row.score, snippet: snippet(row.body_md, keyword) }));
}

// ---- Markdown 导入解析：支持单篇、多篇以及「合并文档」(<!-- 文件 n/N：路径 -->) ----
function stripFrontMatter(text) {
    const trimmed = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/^\s+/, '');
    if (!trimmed.startsWith('---\n')) return { meta: {}, body: trimmed };
    const close = trimmed.indexOf('\n---', 4);
    if (close < 0) return { meta: {}, body: trimmed };
    const yaml = trimmed.slice(4, close);
    const meta = {};
    const title = yaml.match(/^title:\s*(.+)$/m);
    if (title) meta.title = title[1].replace(/^["']|["']$/g, '').trim();
    const tagBlock = yaml.match(/^tags:\s*\[(.+)\]\s*$/m);
    const tagLines = [...yaml.matchAll(/^\s+-\s+#?(.+)$/gm)].map(match => match[1].trim());
    meta.tags = (tagBlock ? tagBlock[1].split(',').map(item => item.trim()) : tagLines).map(tag => tag.replace(/^#/, '').split('/').pop()).filter(Boolean).slice(0, 8);
    return { meta, body: trimmed.slice(close + 4).replace(/^\s+/, '') };
}

function splitByH1(body) {
    const parts = [];
    let fence = false;
    let current = null;
    for (const line of body.split('\n')) {
        if (/^\s*```/.test(line)) fence = !fence;
        if (!fence && /^# (?!#)/.test(line)) {
            current = { title: line.slice(2).trim(), lines: [] };
            parts.push(current);
            continue;
        }
        if (!current) {
            current = { title: '', lines: [] };
            parts.push(current);
        }
        current.lines.push(line);
    }
    return parts;
}

function finishBody(lines) {
    let text = lines.join('\n').replace(/\n-{3,}\s*$/g, '').replace(/^\s+|\s+$/g, '');
    if ((text.match(/^\s*```/gm) || []).length % 2) text += '\n```';
    return `${text}\n`;
}

function firstParagraph(body) {
    const paragraph = body.split(/\n\s*\n/).map(item => item.trim())
        .find(item => item && !/^(```|[#>|*-]|<)/.test(item));
    return (paragraph || '').replace(/\*\*|`|\[\[|\]\]/g, '').slice(0, 160);
}

function parseDocument(name, content) {
    const { meta, body } = stripFrontMatter(content);
    const parts = splitByH1(body);
    const titled = parts.filter(part => part.title);
    const fallbackTitle = meta.title || String(name || '').replace(/\.(md|markdown|txt)$/i, '').split('/').pop() || '未命名文档';
    if (!titled.length) {
        return [{ title: fallbackTitle, tags: meta.tags || [], source: name, bodyMd: finishBody(parts.flatMap(part => part.lines)) }];
    }
    // 首个一级标题之前的引言并入第一篇
    const preface = parts[0] && !parts[0].title ? parts[0].lines : [];
    return titled.map((part, index) => {
        const lines = index === 0 ? [...preface, ...part.lines] : part.lines;
        return { title: part.title, tags: meta.tags || [], source: titled.length > 1 ? `${name}#${index + 1}` : name, bodyMd: finishBody(lines) };
    });
}

function parseImport(files) {
    if (!Array.isArray(files) || !files.length || files.length > 100) throw knowledgeError('请提供 1~100 个 Markdown 文件');
    const drafts = [];
    for (const file of files) {
        const name = cleanText(file?.name, 300, '文件名').trim() || 'pasted.md';
        const content = cleanText(file?.content, 8 * 1024 * 1024, '文件内容');
        const marker = /<!-- 文件 (\d+)\/\d+：(.+?) -->/g;
        const hits = [...content.matchAll(marker)];
        const docs = hits.length
            ? hits.map((hit, index) => ({
                name: hit[2].replace(/\\/g, '/'),
                content: content.slice(hit.index + hit[0].length, index + 1 < hits.length ? hits[index + 1].index : content.length)
            }))
            : [{ name, content }];
        for (const doc of docs) {
            for (const draft of parseDocument(doc.name, doc.content)) {
                if (!draft.bodyMd.trim()) continue;
                drafts.push({ ...draft, summary: firstParagraph(draft.bodyMd), difficulty: 3, keyPoints: [], visuals: [], related: [] });
            }
        }
    }
    if (drafts.length > MAX_BATCH) throw knowledgeError(`解析出 ${drafts.length} 篇，超过单次 ${MAX_BATCH} 篇的上限，请分批导入`);
    return drafts;
}

module.exports = {
    DB_FILENAME,
    SEED_VERSION: SEED.version,
    createArticles,
    deleteArticle,
    deleteCategory,
    deleteOutline,
    getArticle,
    getRevision,
    listRevisions,
    loadCatalog,
    parseImport,
    saveCategory,
    saveDomain,
    saveOutline,
    search,
    updateArticle,
    // 同库的其他模块（AI 问答与笔记）复用连接、串行事务与 WAL 合并
    database: { readyConnection, transaction, checkpoint, run, get, all, parseJson, knowledgeError, normalizeId }
};
