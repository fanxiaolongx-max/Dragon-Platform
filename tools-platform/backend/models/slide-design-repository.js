const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { run, get, all } = require('./app-db');
const { ensureDataDir, getDataDir } = require('./store');
const { getTenantId } = require('./tenant-context');

function getLibraryDir() { return path.join(getDataDir(), 'slide-library'); }
const readyByTenant = new Map();

function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

function cleanName(value, fallback = '未命名项目') {
    return String(value || fallback).trim().replace(/[\x00-\x1f]/g, '').slice(0, 120) || fallback;
}

function cleanTag(value) {
    const cleaned = String(value || '综合材料').trim().replace(/[\\/:*?"<>|\s]+/g, '');
    const shortened = Array.from(cleaned).slice(0, 20).join('');
    return shortened || '综合材料';
}

function cleanTags(value, fallback = '综合材料') {
    const input = Array.isArray(value) && value.length
        ? value
        : String(value || '').trim() ? String(value).split(/[,，、|]/) : [fallback];
    const tags = [...new Set(input.map(cleanTag).filter(Boolean))].slice(0, 6);
    return tags.length ? tags : [cleanTag(fallback)];
}

async function ensureColumn(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    if (!columns.some(item => item.name === column)) {
        await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

async function ensureReady() {
    const tenantId = getTenantId();
    if (!readyByTenant.has(tenantId)) {
        const readyPromise = (async () => {
            ensureDataDir();
            fs.mkdirSync(getLibraryDir(), { recursive: true });
            await run(`CREATE TABLE IF NOT EXISTS slide_design_projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                deck_html TEXT NOT NULL DEFAULT '',
                active_slide INTEGER NOT NULL DEFAULT 0,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_slide_design_projects_updated ON slide_design_projects(updated_at DESC)');
            await run(`CREATE TABLE IF NOT EXISTS slide_library_assets (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                source_filename TEXT NOT NULL,
                page_number INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                extracted_text TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                tag TEXT NOT NULL DEFAULT '',
                imported_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES slide_design_projects(id) ON DELETE SET NULL
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_slide_library_assets_imported ON slide_library_assets(imported_at DESC)');
            await run('CREATE INDEX IF NOT EXISTS idx_slide_library_assets_tag ON slide_library_assets(tag)');
            await ensureColumn('slide_library_assets', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
            await ensureColumn('slide_library_assets', 'uploader', "TEXT NOT NULL DEFAULT ''");
            await ensureColumn('slide_library_assets', 'usage_scenario', "TEXT NOT NULL DEFAULT ''");
            await ensureColumn('slide_library_assets', 'page_type', "TEXT NOT NULL DEFAULT '内容页'");
            await ensureColumn('slide_library_assets', 'intent', "TEXT NOT NULL DEFAULT ''");
            await ensureColumn('slide_library_assets', 'thumbnail_path', "TEXT NOT NULL DEFAULT ''");
            await run('CREATE INDEX IF NOT EXISTS idx_slide_library_assets_uploader ON slide_library_assets(uploader)');
            await run('CREATE INDEX IF NOT EXISTS idx_slide_library_assets_scenario ON slide_library_assets(usage_scenario)');
            await run('CREATE INDEX IF NOT EXISTS idx_slide_library_assets_page_type ON slide_library_assets(page_type)');
        })().catch(error => {
            readyByTenant.delete(tenantId);
            throw error;
        });
        readyByTenant.set(tenantId, readyPromise);
    }
    return readyByTenant.get(tenantId);
}

function rowToProject(row) {
    return row && {
        id: row.id,
        name: row.name,
        deckHtml: row.deck_html || '',
        activeSlide: Number(row.active_slide || 0),
        source: row.source || 'manual',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function rowToAsset(row) {
    if (!row) return null;
    let tags = [];
    try { tags = JSON.parse(row.tags_json || '[]'); } catch (_) { tags = []; }
    tags = cleanTags(tags, row.tag);
    return {
        id: row.id,
        projectId: row.project_id || null,
        sourceFilename: row.source_filename,
        pageNumber: Number(row.page_number || 0),
        fileName: row.file_name,
        extractedText: row.extracted_text || '',
        summary: row.summary || '',
        tag: row.tag || '',
        tags,
        uploader: row.uploader || '',
        usageScenario: row.usage_scenario || '',
        pageType: row.page_type || '内容页',
        intent: row.intent || '',
        importedAt: row.imported_at,
        downloadUrl: `/api/slide-design/assets/${encodeURIComponent(row.id)}/download`,
        thumbnailUrl: row.thumbnail_path
            ? `/api/slide-design/assets/${encodeURIComponent(row.id)}/thumbnail?v=${encodeURIComponent(path.basename(row.thumbnail_path))}`
            : ''
    };
}

async function listProjects({ includeDeckBytes = false } = {}) {
    await ensureReady();
    const rows = await all(`SELECT id, name, '' AS deck_html, active_slide, source, created_at, updated_at
                        ${includeDeckBytes ? ', length(CAST(deck_html AS BLOB)) AS deck_bytes' : ''}
                        FROM slide_design_projects ORDER BY updated_at DESC, created_at DESC`);
    return rows.map(row => includeDeckBytes ? { ...rowToProject(row), deckBytes: row.deck_bytes } : rowToProject(row));
}

async function getProject(id) {
    await ensureReady();
    return rowToProject(await get('SELECT * FROM slide_design_projects WHERE id = ?', [id]));
}

async function createProject({ name, deckHtml = '', activeSlide = 0, source = 'manual' } = {}) {
    await ensureReady();
    const id = makeId('prj');
    const now = new Date().toISOString();
    await run(
        `INSERT INTO slide_design_projects(id, name, deck_html, active_slide, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, cleanName(name), String(deckHtml || ''), Math.max(0, Number(activeSlide || 0)), String(source || 'manual').slice(0, 30), now, now]
    );
    return getProject(id);
}

async function saveProject(id, { name, deckHtml, activeSlide } = {}) {
    await ensureReady();
    const existing = await getProject(id);
    if (!existing) return null;
    await run(
        `UPDATE slide_design_projects
         SET name = ?, deck_html = ?, active_slide = ?, updated_at = ?
         WHERE id = ?`,
        [
            name === undefined ? existing.name : cleanName(name),
            deckHtml === undefined ? existing.deckHtml : String(deckHtml || ''),
            activeSlide === undefined ? existing.activeSlide : Math.max(0, Number(activeSlide || 0)),
            new Date().toISOString(),
            id
        ]
    );
    return getProject(id);
}

async function deleteProject(id) {
    await ensureReady();
    const project = await getProject(id);
    if (!project) return null;
    await run('DELETE FROM slide_design_projects WHERE id = ?', [id]);
    return project;
}

async function createAsset({ id: providedId, projectId, sourceFilename, pageNumber, fileName, relativePath, extractedText, summary, tag, tags, uploader, usageScenario, pageType, intent, thumbnailPath, importedAt }) {
    await ensureReady();
    const id = providedId || makeId('sld');
    await run(
        `INSERT INTO slide_library_assets(
            id, project_id, source_filename, page_number, file_name, relative_path,
            extracted_text, summary, tag, tags_json, uploader, usage_scenario, page_type, intent, thumbnail_path, imported_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, projectId || null, cleanName(sourceFilename, 'import.pptx'), Number(pageNumber), fileName, relativePath,
            String(extractedText || ''), String(summary || ''), cleanTag(tag), JSON.stringify(cleanTags(tags, tag)),
            cleanName(uploader, '未知用户'), cleanName(usageScenario, '通用展示'), cleanName(pageType, '内容页'), String(intent || '').trim().slice(0, 160),
            String(thumbnailPath || ''), importedAt || new Date().toISOString()]
    );
    return getAsset(id);
}

async function updateAssetAnalysis(id, { summary, tag, tags, usageScenario, pageType, intent } = {}) {
    await ensureReady();
    const existing = await getAsset(id);
    if (!existing) return null;
    const nextTag = tag === undefined ? existing.tag : cleanTag(tag);
    await run(
        `UPDATE slide_library_assets
         SET summary = ?, tag = ?, tags_json = ?, usage_scenario = ?, page_type = ?, intent = ?
         WHERE id = ?`,
        [
            summary === undefined ? existing.summary : String(summary || '').trim().slice(0, 300),
            nextTag,
            JSON.stringify(tags === undefined ? existing.tags : cleanTags(tags, nextTag)),
            usageScenario === undefined ? existing.usageScenario : cleanName(usageScenario, '通用展示'),
            pageType === undefined ? existing.pageType : cleanName(pageType, '内容页'),
            intent === undefined ? existing.intent : String(intent || '').trim().slice(0, 160),
            id
        ]
    );
    return getAsset(id);
}

async function updateAssetThumbnail(id, thumbnailPath) {
    await ensureReady();
    const result = await run(
        'UPDATE slide_library_assets SET thumbnail_path = ? WHERE id = ?',
        [String(thumbnailPath || ''), id]
    );
    return result.changes ? getAsset(id) : null;
}

async function getAsset(id) {
    await ensureReady();
    return rowToAsset(await get('SELECT * FROM slide_library_assets WHERE id = ?', [id]));
}

async function getAssetFile(id) {
    await ensureReady();
    const row = await get('SELECT * FROM slide_library_assets WHERE id = ?', [id]);
    if (!row) return null;
    const absolutePath = path.resolve(getLibraryDir(), row.relative_path);
    const root = `${path.resolve(getLibraryDir())}${path.sep}`;
    if (!absolutePath.startsWith(root)) throw new Error('素材文件路径非法');
    return { asset: rowToAsset(row), absolutePath };
}

async function getAssetThumbnail(id) {
    await ensureReady();
    const row = await get('SELECT * FROM slide_library_assets WHERE id = ?', [id]);
    if (!row || !row.thumbnail_path) return null;
    const absolutePath = path.resolve(getLibraryDir(), row.thumbnail_path);
    const root = `${path.resolve(getLibraryDir())}${path.sep}`;
    if (!absolutePath.startsWith(root)) throw new Error('缩略图路径非法');
    return { asset: rowToAsset(row), absolutePath };
}

function resolveLibraryFile(relativePath, label) {
    if (!relativePath) return null;
    const absolutePath = path.resolve(getLibraryDir(), relativePath);
    const root = `${path.resolve(getLibraryDir())}${path.sep}`;
    if (!absolutePath.startsWith(root)) throw new Error(`${label}路径非法`);
    return absolutePath;
}

async function deleteAsset(id) {
    await ensureReady();
    const row = await get('SELECT * FROM slide_library_assets WHERE id = ?', [id]);
    if (!row) return null;
    const asset = rowToAsset(row);
    const assetPath = resolveLibraryFile(row.relative_path, '素材文件');
    const thumbnailPath = resolveLibraryFile(row.thumbnail_path, '缩略图');
    await run('DELETE FROM slide_library_assets WHERE id = ?', [id]);
    [assetPath, thumbnailPath].filter(Boolean).forEach(filePath => fs.rmSync(filePath, { force: true }));
    return asset;
}

function normalizeImportBatches(batches) {
    if (!Array.isArray(batches)) return [];
    const seen = new Set();
    return batches.map(item => ({
        sourceFilename: String(item && item.sourceFilename || '').trim().slice(0, 240),
        importedAt: String(item && item.importedAt || '').trim().slice(0, 40),
        uploader: String(item && item.uploader || '').trim().slice(0, 120)
    })).filter(item => {
        if (!item.sourceFilename || !item.importedAt) return false;
        const key = `${item.sourceFilename}\u0000${item.importedAt}\u0000${item.uploader}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 100);
}

async function listAssetImportBatches() {
    await ensureReady();
    const rows = await all(`
        SELECT source_filename, imported_at, uploader, COUNT(*) AS asset_count,
               MIN(page_number) AS first_page, MAX(page_number) AS last_page
        FROM slide_library_assets
        GROUP BY source_filename, imported_at, uploader
        ORDER BY imported_at DESC, source_filename
    `);
    return rows.map(row => ({
        sourceFilename: row.source_filename,
        importedAt: row.imported_at,
        uploader: row.uploader || '',
        assetCount: Number(row.asset_count || 0),
        firstPage: Number(row.first_page || 0),
        lastPage: Number(row.last_page || 0)
    }));
}

async function deleteAssetsByImportBatches(batches) {
    await ensureReady();
    const normalized = normalizeImportBatches(batches);
    if (!normalized.length) return { deletedCount: 0, batches: [] };
    const clauses = normalized.map(() => '(source_filename = ? AND imported_at = ? AND uploader = ?)');
    const params = normalized.flatMap(item => [item.sourceFilename, item.importedAt, item.uploader]);
    const rows = await all(
        `SELECT * FROM slide_library_assets WHERE ${clauses.join(' OR ')}`,
        params
    );
    if (!rows.length) return { deletedCount: 0, batches: normalized };
    const filesToDelete = rows.flatMap(row => [
        resolveLibraryFile(row.relative_path, '素材文件'),
        resolveLibraryFile(row.thumbnail_path, '缩略图')
    ]).filter(Boolean);
    await run(
        `DELETE FROM slide_library_assets WHERE ${clauses.join(' OR ')}`,
        params
    );
    filesToDelete.forEach(filePath => fs.rmSync(filePath, { force: true }));
    return {
        deletedCount: rows.length,
        deletedIds: rows.map(row => row.id),
        batches: normalized
    };
}

async function listAssetsForReclassification({ allAssets = false, batches = [] } = {}) {
    await ensureReady();
    if (allAssets) {
        return (await all(`SELECT * FROM slide_library_assets
            ORDER BY source_filename, imported_at, page_number, id`)).map(rowToAsset);
    }
    const normalized = normalizeImportBatches(batches);
    if (!normalized.length) return [];
    const clauses = normalized.map(() => '(source_filename = ? AND imported_at = ? AND uploader = ?)');
    const params = normalized.flatMap(item => [item.sourceFilename, item.importedAt, item.uploader]);
    return (await all(
        `SELECT * FROM slide_library_assets WHERE ${clauses.join(' OR ')}
         ORDER BY source_filename, imported_at, page_number, id`,
        params
    )).map(rowToAsset);
}

function migratedClassificationTags(asset, change) {
    const previousTag = cleanTag(asset.tag);
    const previousPageType = cleanName(asset.pageType, '内容页');
    const nextTag = cleanTag(change.tag);
    const nextPageType = cleanName(change.pageType, '内容页');
    const tags = (Array.isArray(asset.tags) ? asset.tags : []).map(item => {
        const cleaned = cleanTag(item);
        if (cleaned === previousTag) return nextTag;
        if (cleaned === cleanTag(previousPageType)) return nextPageType;
        return cleaned;
    });
    if ((asset.tags || []).some(item => cleanTag(item) === cleanTag(previousPageType)) && !tags.includes(nextPageType)) {
        tags.unshift(nextPageType);
    }
    return cleanTags(tags, nextTag);
}

async function applyAssetClassificationChanges(changes = []) {
    await ensureReady();
    const normalized = Array.isArray(changes) ? changes : [];
    if (!normalized.length) return { appliedCount: 0, appliedIds: [], skippedIds: [] };
    const appliedIds = [];
    const skippedIds = [];
    await run('BEGIN IMMEDIATE');
    try {
        for (const change of normalized) {
            const asset = rowToAsset(await get('SELECT * FROM slide_library_assets WHERE id = ?', [String(change.id || '')]));
            if (!asset
                || asset.tag !== change.before.tag
                || asset.pageType !== change.before.pageType
                || asset.usageScenario !== change.before.usageScenario) {
                skippedIds.push(String(change.id || ''));
                continue;
            }
            const nextTag = cleanTag(change.after.tag);
            const nextPageType = cleanName(change.after.pageType, '内容页');
            const nextUsageScenario = cleanName(change.after.usageScenario, '方案讲解');
            const result = await run(
                `UPDATE slide_library_assets
                 SET tag = ?, tags_json = ?, page_type = ?, usage_scenario = ?
                 WHERE id = ? AND tag = ? AND page_type = ? AND usage_scenario = ?`,
                [
                    nextTag,
                    JSON.stringify(migratedClassificationTags(asset, {
                        tag: nextTag,
                        pageType: nextPageType
                    })),
                    nextPageType,
                    nextUsageScenario,
                    asset.id,
                    change.before.tag,
                    change.before.pageType,
                    change.before.usageScenario
                ]
            );
            if (result.changes) appliedIds.push(asset.id);
            else skippedIds.push(asset.id);
        }
        await run('COMMIT');
    } catch (error) {
        try { await run('ROLLBACK'); } catch (_) { /* preserve original error */ }
        throw error;
    }
    return { appliedCount: appliedIds.length, appliedIds, skippedIds };
}

function buildAssetFilter({ query = '', tag = '', date = '', period = '', uploader = '', usageScenario = '', pageType = '', sourceFilename = '' } = {}, exclude = []) {
    const clauses = [];
    const params = [];
    const excluded = new Set(Array.isArray(exclude) ? exclude : [exclude]);
    if (query) {
        clauses.push('(source_filename LIKE ? OR extracted_text LIKE ? OR summary LIKE ? OR tag LIKE ? OR tags_json LIKE ? OR page_type LIKE ? OR intent LIKE ?)');
        const pattern = `%${String(query).slice(0, 100)}%`;
        params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }
    if (tag && !excluded.has('tag')) {
        clauses.push('tag = ?');
        params.push(String(tag).slice(0, 20));
    }
    if (date && !excluded.has('date') && !excluded.has('period')) {
        clauses.push('substr(imported_at, 1, 10) = ?');
        params.push(String(date).slice(0, 10));
    }
    if (period && !excluded.has('period') && /^(\d{4})-Q([1-4])$/.test(String(period))) {
        const [, yearText, quarterText] = String(period).match(/^(\d{4})-Q([1-4])$/);
        const year = Number(yearText);
        const startMonth = ((Number(quarterText) - 1) * 3) + 1;
        const nextMonth = startMonth + 3;
        const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
        const end = nextMonth > 12
            ? `${year + 1}-01-01`
            : `${year}-${String(nextMonth).padStart(2, '0')}-01`;
        clauses.push('imported_at >= ? AND imported_at < ?');
        params.push(start, end);
    }
    if (uploader && !excluded.has('uploader')) {
        clauses.push('uploader = ?');
        params.push(String(uploader).slice(0, 120));
    }
    if (usageScenario && !excluded.has('usageScenario')) {
        clauses.push('usage_scenario = ?');
        params.push(String(usageScenario).slice(0, 120));
    }
    if (pageType && !excluded.has('pageType')) {
        clauses.push('page_type = ?');
        params.push(String(pageType).slice(0, 120));
    }
    if (sourceFilename && !excluded.has('sourceFilename')) {
        clauses.push('source_filename = ?');
        params.push(String(sourceFilename).slice(0, 240));
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

async function listAssets({ limit = 200, offset = 0, ...filters } = {}) {
    await ensureReady();
    const { where, params } = buildAssetFilter(filters);
    params.push(Math.min(500, Math.max(1, Number(limit || 200))));
    params.push(Math.max(0, Number(offset || 0)));
    return (await all(`SELECT * FROM slide_library_assets ${where} ORDER BY imported_at DESC, page_number ASC LIMIT ? OFFSET ?`, params)).map(rowToAsset);
}

async function countAssets(filters = {}) {
    await ensureReady();
    const { where, params } = buildAssetFilter(filters);
    const row = await get(`SELECT COUNT(*) AS count FROM slide_library_assets ${where}`, params);
    return Number(row?.count || 0);
}


async function facetRows(column, filters, exclude, { orderBy = 'count DESC, value' } = {}) {
    const { where, params } = buildAssetFilter(filters, exclude);
    const scopedWhere = where ? `${where} AND ${column} <> ''` : `WHERE ${column} <> ''`;
    return all(`SELECT ${column} AS value, COUNT(*) AS count, MAX(imported_at) AS latest
                FROM slide_library_assets ${scopedWhere}
                GROUP BY ${column} ORDER BY ${orderBy}`, params);
}

async function getAssetFilters(filters = {}) {
    await ensureReady();
    const [uploaders, scenarios, pageTypes, tags, importedMonths, sourceFiles] = await Promise.all([
        facetRows('uploader', filters, 'uploader', { orderBy: 'value' }),
        facetRows('usage_scenario', filters, 'usageScenario', { orderBy: 'count DESC, value' }),
        facetRows('page_type', filters, 'pageType'),
        facetRows('tag', filters, 'tag'),
        facetRows("substr(imported_at, 1, 7)", filters, ['period', 'date'], { orderBy: 'value DESC' }),
        facetRows('source_filename', filters, 'sourceFilename', { orderBy: 'latest DESC, value' })
    ]);
    const periodCounts = new Map();
    importedMonths.forEach(item => {
        const match = String(item.value || '').match(/^(\d{4})-(\d{2})$/);
        if (!match) return;
        const value = `${match[1]}-Q${Math.floor((Number(match[2]) - 1) / 3) + 1}`;
        periodCounts.set(value, (periodCounts.get(value) || 0) + Number(item.count || 0));
    });
    const periods = [...periodCounts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return {
        uploaders: uploaders.map(item => ({ value: item.value, count: Number(item.count || 0) })),
        scenarios: scenarios.map(item => ({ value: item.value, count: Number(item.count || 0) })),
        pageTypes: pageTypes.map(item => ({ value: item.value, count: Number(item.count || 0) })),
        periods: periods.map(([value, count]) => ({ value, label: value.replace('-', ' '), count })),
        sourceFiles: sourceFiles.map(item => ({ value: item.value, count: Number(item.count || 0) })),
        tags: tags.map(item => ({ value: item.value, count: Number(item.count || 0) })),
        filteredTotal: await countAssets(filters)
    };
}

async function getClassificationVocabulary({ topicLimit = 30 } = {}) {
    await ensureReady();
    const safeTopicLimit = Math.min(100, Math.max(1, Number.parseInt(topicLimit, 10) || 30));
    const [totalRow, topics, pageTypes, usageScenarios] = await Promise.all([
        get('SELECT COUNT(*) AS count FROM slide_library_assets'),
        all(`SELECT assets.tag AS name,
                    COUNT(*) AS count,
                    MAX(assets.imported_at) AS latest,
                    (
                        SELECT sample.summary
                        FROM slide_library_assets sample
                        WHERE sample.tag = assets.tag AND sample.summary <> ''
                        ORDER BY sample.imported_at DESC
                        LIMIT 1
                    ) AS sample_summary
             FROM slide_library_assets assets
             WHERE assets.tag <> ''
             GROUP BY assets.tag
             ORDER BY count DESC, latest DESC, name
             LIMIT ?`, [safeTopicLimit]),
        all(`SELECT page_type AS name, COUNT(*) AS count
             FROM slide_library_assets
             WHERE page_type <> ''
             GROUP BY page_type
             ORDER BY count DESC, name`),
        all(`SELECT usage_scenario AS name, COUNT(*) AS count
             FROM slide_library_assets
             WHERE usage_scenario <> ''
             GROUP BY usage_scenario
             ORDER BY count DESC, name`)
    ]);
    return {
        totalAssets: Number(totalRow?.count || 0),
        topics: topics.map(item => ({
            name: cleanTag(item.name),
            count: Number(item.count || 0),
            sampleSummary: String(item.sample_summary || '').trim().slice(0, 120)
        })),
        pageTypes: pageTypes.map(item => ({
            name: cleanName(item.name, '内容页'),
            count: Number(item.count || 0)
        })),
        usageScenarios: usageScenarios.map(item => ({
            name: cleanName(item.name, '方案讲解'),
            count: Number(item.count || 0)
        }))
    };
}

module.exports = {
    getLibraryDir,
    get LIBRARY_DIR() { return getLibraryDir(); },
    makeId,
    cleanTag,
    cleanTags,
    ensureReady,
    listProjects,
    getProject,
    createProject,
    saveProject,
    deleteProject,
    createAsset,
    updateAssetAnalysis,
    updateAssetThumbnail,
    getAsset,
    getAssetFile,
    getAssetThumbnail,
    deleteAsset,
    listAssetImportBatches,
    deleteAssetsByImportBatches,
    listAssetsForReclassification,
    applyAssetClassificationChanges,
    listAssets,
    countAssets,
    getAssetFilters,
    getClassificationVocabulary
};
