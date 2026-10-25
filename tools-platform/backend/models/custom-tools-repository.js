const { readKV, writeKV } = require('./kv-store');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { ensureDataDir, getDataDir } = require('./store');
const { run, get, all } = require('./app-db');
const historyRepo = require('./upload-history-repository');
const customToolI18nDefaults = require('./custom-tool-i18n-defaults');

function getCustomToolsDir() { return path.join(getDataDir(), 'custom-tools'); }
// 测试可用 TOOLS_BUILTIN_TOOLS_DIR 指向临时目录，避免「转为内置」改动仓库源码
const BUILTIN_TOOLS_DIR = process.env.TOOLS_BUILTIN_TOOLS_DIR ? path.resolve(process.env.TOOLS_BUILTIN_TOOLS_DIR) : path.join(__dirname, '../builtin-tools');
const TOOL_MANIFEST_FILE = '.tool-manifest.json';
let registryMutationQueue = Promise.resolve();
const registryReadyPromises = new Map();

function withRegistryMutation(task) {
    const operation = registryMutationQueue.then(task, task);
    registryMutationQueue = operation.catch(() => {});
    return operation;
}

function ensureCustomToolsDir() {
    ensureDataDir();
    fs.mkdirSync(getCustomToolsDir(), { recursive: true });
}

function normalizeSlug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

function createSlug(name, existingSlugs = new Set()) {
    const base = normalizeSlug(name) || `tool-${Date.now().toString(36)}`;
    let slug = base;
    let index = 2;
    while (existingSlugs.has(slug)) {
        slug = `${base}-${index++}`;
    }
    return slug;
}

function latestTimestampValue(...values) {
    const valid = values
        .map(value => ({ value, timestamp: Date.parse(value) }))
        .filter(item => Number.isFinite(item.timestamp));
    if (!valid.length) return values.find(Boolean) || null;
    return valid.reduce((latest, item) => item.timestamp > latest.timestamp ? item : latest).value;
}

function listToolDirs() {
    ensureCustomToolsDir();
    return fs.readdirSync(getCustomToolsDir(), { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => item.name);
}

function rowToTool(row) {
    let tags = [];
    try {
        const parsed = JSON.parse(row.tags_json || '[]');
        if (Array.isArray(parsed)) tags = parsed;
    } catch (_) {}
    const i18nFallback = customToolI18nDefaults[row.slug] || {};
    const runtimeManifest = readToolManifest(row.slug);
    const builtIn = fs.existsSync(path.join(BUILTIN_TOOLS_DIR, row.slug, TOOL_MANIFEST_FILE))
        || runtimeManifest?.builtIn === true
        || runtimeManifest?.system?.managedBy === 'tools-platform';
    const updatedAt = latestTimestampValue(row.updated_at, runtimeManifest?.tool?.updatedAt);
    return {
        slug: row.slug,
        name: row.name,
        nameEn: row.name_en || i18nFallback.nameEn || '',
        icon: row.icon,
        description: row.description || '',
        descriptionEn: row.description_en || i18nFallback.descriptionEn || '',
        tags,
        href: row.href,
        filePath: row.file_path,
        publicAccess: Number(row.public_access || 0) === 1,
        builtIn,
        createdAt: row.created_at,
        updatedAt
    };
}

function toolRowParams(tool, sortOrder = 0) {
    return [
        tool.slug,
        tool.name,
        tool.nameEn || '',
        tool.icon || '🧩',
        tool.description || '',
        tool.descriptionEn || '',
        JSON.stringify(Array.isArray(tool.tags) ? tool.tags : []),
        tool.href || `/tools/${tool.slug}`,
        tool.filePath || `/custom-tools/${tool.slug}/index.html`,
        tool.publicAccess === true ? 1 : 0,
        tool.createdAt,
        tool.updatedAt || tool.createdAt,
        sortOrder
    ];
}

async function insertOrReplaceToolRow(tool, sortOrder = 0) {
    await run(
        `INSERT INTO custom_tools (
            slug, name, name_en, icon, description, description_en, tags_json, href, file_path,
            public_access, created_at, updated_at, sort_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
            name = excluded.name,
            name_en = excluded.name_en,
            icon = excluded.icon,
            description = excluded.description,
            description_en = excluded.description_en,
            tags_json = excluded.tags_json,
            href = excluded.href,
            file_path = excluded.file_path,
            public_access = excluded.public_access,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            sort_order = excluded.sort_order`,
        toolRowParams(tool, sortOrder)
    );
}

async function listToolRows() {
    return all(`SELECT slug, name, name_en, icon, description, description_en, tags_json, href, file_path,
                       public_access, created_at, updated_at, sort_order
                FROM custom_tools
                ORDER BY sort_order ASC, created_at ASC, slug ASC`);
}

async function syncLegacyRegistryMirror() {
    const tools = (await listToolRows()).map(rowToTool);
    await writeKV('sys', 'custom_tools', tools);
}

async function ensureRegistryReady() {
    const registryKey = getDataDir();
    let registryReadyPromise = registryReadyPromises.get(registryKey);
    if (!registryReadyPromise) {
        registryReadyPromise = (async () => {
            await run(`CREATE TABLE IF NOT EXISTS custom_tools (
                slug TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                name_en TEXT NOT NULL DEFAULT '',
                icon TEXT NOT NULL DEFAULT '🧩',
                description TEXT NOT NULL DEFAULT '',
                description_en TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                href TEXT NOT NULL,
                file_path TEXT NOT NULL,
                public_access INTEGER NOT NULL DEFAULT 0 CHECK(public_access IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )`);
            const columns = await all('PRAGMA table_info(custom_tools)');
            const columnNames = new Set(columns.map(column => column.name));
            if (!columnNames.has('name_en')) await run("ALTER TABLE custom_tools ADD COLUMN name_en TEXT NOT NULL DEFAULT ''");
            if (!columnNames.has('description_en')) await run("ALTER TABLE custom_tools ADD COLUMN description_en TEXT NOT NULL DEFAULT ''");
            if (!columnNames.has('import_request_id')) await run('ALTER TABLE custom_tools ADD COLUMN import_request_id TEXT');
            if (!columnNames.has('import_request_hash')) await run('ALTER TABLE custom_tools ADD COLUMN import_request_hash TEXT');
            await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_tools_import_request ON custom_tools(import_request_id)');
            await run('CREATE INDEX IF NOT EXISTS idx_custom_tools_sort_order ON custom_tools(sort_order, created_at, slug)');
            const countRow = await get('SELECT COUNT(*) AS count FROM custom_tools');
            if (Number(countRow && countRow.count || 0) === 0) {
                const legacy = await readKV('sys', 'custom_tools', []);
                if (Array.isArray(legacy)) {
                    for (let index = 0; index < legacy.length; index += 1) {
                        const item = legacy[index];
                        if (!item || !item.slug) continue;
                        await insertOrReplaceToolRow(item, index);
                    }
                }
            }
            await syncLegacyRegistryMirror();
        })().catch(err => {
            registryReadyPromises.delete(registryKey);
            throw err;
        });
        registryReadyPromises.set(registryKey, registryReadyPromise);
    }
    return registryReadyPromise;
}

async function listTools() {
    await ensureRegistryReady();
    return (await listToolRows()).map(rowToTool);
}

async function saveRegistry(items) {
    await ensureRegistryReady();
    const normalizedItems = Array.isArray(items) ? items : [];
    for (let index = 0; index < normalizedItems.length; index += 1) {
        await insertOrReplaceToolRow(normalizedItems[index], index);
    }
    const slugs = normalizedItems.map(item => item.slug).filter(Boolean);
    if (slugs.length) {
        const placeholders = slugs.map(() => '?').join(',');
        await run(`DELETE FROM custom_tools WHERE slug NOT IN (${placeholders})`, slugs);
    } else {
        await run('DELETE FROM custom_tools');
    }
    await syncLegacyRegistryMirror();
}

async function replaceAllTools(items) {
    return withRegistryMutation(() => saveRegistry(items));
}

function normalizeToolRecord(raw, slug) {
    const indexPath = path.join(getCustomToolsDir(), slug, 'index.html');
    const stat = fs.statSync(indexPath);
    const createdAt = raw.createdAt || stat.birthtime.toISOString();
    return {
        slug,
        name: String(raw.name || slug).trim().slice(0, 80) || slug,
        nameEn: String(raw.nameEn || '').trim().slice(0, 120),
        icon: String(raw.icon || '🧩').trim().slice(0, 8) || '🧩',
        description: String(raw.description || '').trim(),
        descriptionEn: String(raw.descriptionEn || '').trim(),
        tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean).slice(0, 8) : [],
        href: `/tools/${slug}`,
        filePath: `/custom-tools/${slug}/index.html`,
        publicAccess: raw.publicAccess === true,
        createdAt,
        updatedAt: raw.updatedAt || createdAt
    };
}

function manifestPath(slug) {
    return path.join(getCustomToolsDir(), slug, TOOL_MANIFEST_FILE);
}

function writeToolManifest(tool, options = {}) {
    const target = manifestPath(tool.slug);
    const temp = `${target}.${process.pid}.tmp`;
    const previousManifest = options.previousManifest || readToolManifest(tool.slug);
    const normalized = normalizeToolRecord(tool, tool.slug);
    if (previousManifest && previousManifest.tool && previousManifest.tool.updatedAt && options.preserveReleaseTimestamp !== false) {
        normalized.updatedAt = previousManifest.tool.updatedAt;
    }
    const manifest = {
        version: 1,
        tool: normalized,
        history: options.history !== undefined ? options.history : (previousManifest?.history || null)
    };
    if (options.builtIn !== undefined ? options.builtIn : previousManifest?.builtIn) {
        manifest.builtIn = true;
    }
    const system = options.system !== undefined ? options.system : previousManifest?.system;
    if (system) {
        manifest.system = system;
    }
    const market = options.market !== undefined ? options.market : previousManifest?.market;
    if (market) {
        manifest.market = market;
    }
    fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, target);
    return manifest;
}

function readToolManifest(slug) {
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath(slug), 'utf8'));
        if (parsed.version !== 1 || !parsed.tool || parsed.tool.slug !== slug) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

async function getTool(slug) {
    await ensureRegistryReady();
    const row = await get(
        `SELECT slug, name, name_en, icon, description, description_en, tags_json, href, file_path,
                public_access, created_at, updated_at, sort_order
         FROM custom_tools WHERE slug = ?`,
        [slug]
    );
    return row ? rowToTool(row) : null;
}

async function updateToolAccess(slug, publicAccess) {
    return withRegistryMutation(async () => {
        await ensureRegistryReady();
        const existingTool = await getTool(slug);
        const nextAccess = Boolean(publicAccess);
        if (existingTool && existingTool.publicAccess === nextAccess) return existingTool;
        const previousManifest = readToolManifest(slug);
        const result = await run(
            'UPDATE custom_tools SET public_access = ? WHERE slug = ?',
            [nextAccess ? 1 : 0, slug]
        );
        if (!result.changes) return null;
        await syncLegacyRegistryMirror();
        const tool = await getTool(slug);
        writeToolManifest(tool, { previousManifest });
        return tool;
    });
}

async function updateToolName(slug, value) {
    const name = String(value || '').trim();
    if (!name) {
        const err = new Error('工具名称不能为空');
        err.status = 400;
        throw err;
    }
    if (name.length > 80) {
        const err = new Error('工具名称不能超过 80 个字符');
        err.status = 400;
        throw err;
    }
    return withRegistryMutation(async () => {
        await ensureRegistryReady();
        const previousManifest = readToolManifest(slug);
        const result = await run(
            'UPDATE custom_tools SET name = ?, updated_at = ? WHERE slug = ?',
            [name, new Date().toISOString(), slug]
        );
        if (!result.changes) return null;
        await syncLegacyRegistryMirror();
        const tool = await getTool(slug);
        writeToolManifest(tool, { previousManifest });
        return tool;
    });
}

async function markToolsUpdated(slugValues, updatedAt = new Date().toISOString()) {
    const slugs = [...new Set((Array.isArray(slugValues) ? slugValues : [])
        .map(normalizeSlug)
        .filter(Boolean))];
    if (!slugs.length) return [];
    return withRegistryMutation(async () => {
        await ensureRegistryReady();
        const placeholders = slugs.map(() => '?').join(',');
        await run(
            `UPDATE custom_tools SET updated_at = ? WHERE slug IN (${placeholders})`,
            [updatedAt, ...slugs]
        );
        await syncLegacyRegistryMirror();
        return (await listTools()).filter(tool => slugs.includes(tool.slug));
    });
}

function normalizeToolState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    if (value.version === 1 && (Array.isArray(value.tasks) || Array.isArray(value.satisfactionData) || value.report)) {
        const cleanText = (input, max = 500) => String(input ?? '').trim().slice(0, max);
        const cleanAudit = input => (Array.isArray(input) ? input : []).slice(0, 100).map(log => ({
            id: cleanText(log && log.id, 100),
            action: cleanText(log && log.action, 100),
            detail: cleanText(log && log.detail, 1000),
            actor: cleanText(log && log.actor, 200),
            at: /^\d{4}-\d{2}-\d{2}T/.test(log && log.at) ? cleanText(log.at, 40) : ''
        })).filter(log => log.id && log.action && log.at);
        const tasks = (Array.isArray(value.tasks) ? value.tasks : []).slice(0, 5000).map(item => ({
            id: cleanText(item && item.id, 100),
            module: cleanText(item && item.module, 100),
            title: cleanText(item && item.title, 500),
            owner: cleanText(item && item.owner, 200),
            status: ['正常', '预警', '延期'].includes(item && item.status) ? item.status : '正常',
            risk: ['低', '中', '高'].includes(item && item.risk) ? item.risk : '低',
            progress: Math.max(0, Math.min(100, Number(item && item.progress) || 0)),
            deadline: /^\d{4}-\d{2}-\d{2}$/.test(item && item.deadline) ? item.deadline : '',
            milestone: cleanText(item && item.milestone, 3000),
            audit: cleanAudit(item && item.audit)
        })).filter(item => item.id && item.title);
        const satisfactionData = (Array.isArray(value.satisfactionData) ? value.satisfactionData : []).slice(0, 10000).map(item => ({
            type: item && item.type === '心愿菜' ? '心愿菜' : '问题建议',
            no: Math.max(1, Math.floor(Number(item && item.no) || 1)),
            text: cleanText(item && item.text, 3000),
            id: cleanText(item && item.id, 100),
            progress: cleanText(item && item.progress, 5000),
            owner: cleanText(item && item.owner, 200),
            done: cleanText(item && item.done, 200),
            audit: cleanAudit(item && item.audit)
        })).filter(item => item.id && item.text);
        const sourceReport = value.report && typeof value.report === 'object' && !Array.isArray(value.report) ? value.report : {};
        return {
            version: 1,
            tasks,
            satisfactionData,
            sidebarCollapsed: Boolean(value.sidebarCollapsed),
            report: {
                month: cleanText(sourceReport.month, 50),
                name: cleanText(sourceReport.name, 200),
                wish: cleanText(sourceReport.wish, 30),
                queue: cleanText(sourceReport.queue, 30),
                dishes: cleanText(sourceReport.dishes, 2000),
                activity: cleanText(sourceReport.activity, 2000),
                actions: cleanText(sourceReport.actions, 10000),
                metrics: (Array.isArray(sourceReport.metrics) ? sourceReport.metrics : []).slice(0, 100).map(metric => ({
                    name: cleanText(metric && metric.name, 200),
                    value: cleanText(metric && metric.value, 50),
                    unit: cleanText(metric && metric.unit, 50)
                })).filter(metric => metric.name)
            }
        };
    }
    const result = {};
    if (value.vocabularyCategories && typeof value.vocabularyCategories === 'object' && !Array.isArray(value.vocabularyCategories)) {
        result.vocabularyCategories = {};
        Object.entries(value.vocabularyCategories).slice(0, 5000).forEach(([word, category]) => {
            const normalizedWord = String(word || '').trim().slice(0, 200);
            if (normalizedWord && ['new', 'mastered', 'review'].includes(category)) {
                result.vocabularyCategories[normalizedWord] = category;
            }
        });
    }
    Object.entries(value).slice(0, 5000).forEach(([date, events]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(events)) return;
        result[date] = events.slice(0, 500).map(event => ({
            id: String(event && event.id || Date.now()),
            start: String(event && event.start || '09:00').slice(0, 5),
            end: String(event && event.end || '10:00').slice(0, 5),
            title: String(event && event.title || '').slice(0, 500),
            type: event && event.type === 'urgent' ? 'urgent' : 'work',
            reporter: String(event && event.reporter || '').slice(0, 300),
            attendees: String(event && event.attendees || '').slice(0, 1000),
            noteTaker: String(event && event.noteTaker || '').slice(0, 300),
            description: String(event && event.description || '').slice(0, 5000)
        })).filter(event => event.title);
    });
    return result;
}

async function getToolState(slug) {
    if (!await getTool(slug)) return null;
    return await readKV('custom_tool_state', slug, { data: {}, snapshots: [], updatedAt: null });
}

async function saveToolState(slug, data, options = {}) {
    if (!await getTool(slug)) return null;
    const previous = await getToolState(slug) || { data: {}, snapshots: [] };
    const nextData = normalizeToolState(data);
    const snapshots = Array.isArray(previous.snapshots) ? previous.snapshots.slice() : [];
    if (options.createSnapshot !== false && previous.updatedAt) {
        snapshots.unshift({
            id: `snap-${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            reason: String(options.reason || '自动保存').slice(0, 100),
            data: normalizeToolState(previous.data)
        });
    }
    const next = { data: nextData, snapshots: snapshots.slice(0, 20), updatedAt: new Date().toISOString() };
    await writeKV('custom_tool_state', slug, next);
    return next;
}

async function restoreToolState(slug, snapshotId) {
    const current = await getToolState(slug);
    if (!current) return null;
    const snapshot = (current.snapshots || []).find(item => item.id === snapshotId);
    if (!snapshot) return false;
    return await saveToolState(slug, snapshot.data, { reason: '恢复前自动快照' });
}

const TOOL_HISTORY_LIMIT = 30;
const TOOL_HISTORY_HTML_LIMIT = 512 * 1024;
const toolHistoryMutationQueues = new Map();

function withToolHistoryMutation(slug, task) {
    const previous = toolHistoryMutationQueues.get(slug) || Promise.resolve();
    const operation = previous.then(task, task);
    const tracked = operation.catch(() => {});
    toolHistoryMutationQueues.set(slug, tracked);
    return operation.finally(() => {
        if (toolHistoryMutationQueues.get(slug) === tracked) toolHistoryMutationQueues.delete(slug);
    });
}

function normalizeToolHistoryRecord(value, existing = null) {
    const html = String(value && value.html || '');
    if (!html.trim()) {
        const err = new Error('保存内容不能为空');
        err.status = 400;
        throw err;
    }
    if (Buffer.byteLength(html, 'utf8') > TOOL_HISTORY_HTML_LIMIT) {
        const err = new Error('保存内容超过 512KB 限制');
        err.status = 413;
        throw err;
    }
    const now = new Date().toISOString();
    return {
        id: existing && existing.id || `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(value && value.name || '未命名记录').trim().slice(0, 80) || '未命名记录',
        html,
        template: value && value.template === 'warning' ? 'warning' : 'classic',
        createdAt: existing && existing.createdAt || now,
        updatedAt: now
    };
}

async function listToolHistory(slug) {
    if (!await getTool(slug)) return null;
    const records = await readKV('custom_tool_history', slug, []);
    return Array.isArray(records) ? records : [];
}

async function addToolHistory(slug, value) {
    if (!await getTool(slug)) return null;
    return withToolHistoryMutation(slug, async () => {
        const records = await listToolHistory(slug) || [];
        const record = normalizeToolHistoryRecord(value);
        await writeKV('custom_tool_history', slug, [record, ...records].slice(0, TOOL_HISTORY_LIMIT));
        return record;
    });
}

async function deleteToolHistory(slug, historyId) {
    if (!await getTool(slug)) return null;
    return withToolHistoryMutation(slug, async () => {
        const records = await listToolHistory(slug) || [];
        const next = records.filter(item => item && item.id !== historyId);
        if (next.length === records.length) return false;
        await writeKV('custom_tool_history', slug, next);
        return true;
    });
}

function saveToolFiles(slug, files) {
    ensureCustomToolsDir();
    const toolDir = path.join(getCustomToolsDir(), slug);
    const tempDir = path.join(getCustomToolsDir(), `.${slug}.${Date.now().toString(36)}.tmp`);
    fs.mkdirSync(tempDir, { recursive: true });
    try {
        for (const [relativePath, content] of files) {
            const targetPath = path.join(tempDir, relativePath);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, content);
        }
        fs.renameSync(tempDir, toolDir);
        return path.join(toolDir, 'index.html');
    } catch (err) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw err;
    }
}

function normalizeArchivePath(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return null;
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '..' || part === '.')) return null;
    return parts.join('/');
}

function isMacArchiveMetadata(value) {
    const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'));
}

async function readZipFiles(archiveBase64) {
    let archive;
    try {
        archive = Buffer.from(String(archiveBase64 || ''), 'base64');
        if (!archive.length || archive.length > 35 * 1024 * 1024) throw new Error('ZIP 文件不能超过 35 MB');
        const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
        // Finder adds AppleDouble files (for example __MACOSX/._page.html)
        // that are not real web assets. Ignoring them also prevents a saved
        // webpage archive from being misdetected as a multi-entry HTML app.
        const entries = Object.values(zip.files).filter(entry => !entry.dir && !isMacArchiveMetadata(entry.name));
        if (!entries.length) throw new Error('ZIP 压缩包为空');
        if (entries.length > 500) throw new Error('ZIP 内文件数量不能超过 500 个');

        const loaded = [];
        let totalSize = 0;
        for (const entry of entries) {
            if (entry.unsafeOriginalName && normalizeArchivePath(entry.unsafeOriginalName) !== entry.name) {
                throw new Error(`ZIP 包含不安全的文件路径：${entry.unsafeOriginalName}`);
            }
            if (typeof entry.unixPermissions === 'number' && (entry.unixPermissions & 0o170000) === 0o120000) {
                throw new Error(`ZIP 不允许包含符号链接：${entry.name}`);
            }
            const safePath = normalizeArchivePath(entry.name);
            if (!safePath) throw new Error(`ZIP 包含不安全的文件路径：${entry.name}`);
            const content = await entry.async('nodebuffer');
            totalSize += content.length;
            if (totalSize > 100 * 1024 * 1024) throw new Error('ZIP 解压后总大小不能超过 100 MB');
            loaded.push([safePath, content]);
        }

        const htmlCandidates = loaded
            .map(([filePath]) => filePath)
            .filter(filePath => /\.html?$/i.test(path.posix.basename(filePath)))
            .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
        if (!htmlCandidates.length) throw new Error('ZIP 中未找到 HTML 文件');
        const indexCandidates = htmlCandidates.filter(filePath => path.posix.basename(filePath).toLowerCase() === 'index.html');
        if (!indexCandidates.length && htmlCandidates.length > 1) {
            const preview = htmlCandidates.slice(0, 8).join('、');
            throw new Error(`ZIP 中存在多个 HTML 文件，无法确定入口：${preview}`);
        }
        const entryPath = indexCandidates[0] || htmlCandidates[0];
        const entryDir = path.posix.dirname(entryPath);
        const prefix = entryDir === '.' ? '' : `${entryDir}/`;
        const files = loaded
            .filter(([filePath]) => !prefix || filePath.startsWith(prefix))
            .map(([filePath, content]) => {
                const relativePath = prefix ? filePath.slice(prefix.length) : filePath;
                return [filePath === entryPath ? 'index.html' : relativePath, content];
            });
        return files;
    } catch (err) {
        if (/ZIP|压缩包|HTML 文件|无法确定入口|不安全/.test(err.message || '')) throw err;
        throw new Error(`ZIP 解析失败：${err.message || '文件已损坏'}`);
    }
}

function removeToolDir(slug) {
    fs.rmSync(path.join(getCustomToolsDir(), slug), { recursive: true, force: true });
}

async function verifyCreatedTool(tool, expectedHtmlContent) {
    const latestTools = await listTools();
    const registered = latestTools.find(item => item.slug === tool.slug);
    if (!registered) throw new Error('自定义工具注册表写入后校验失败');

    const filePath = path.join(getCustomToolsDir(), tool.slug, 'index.html');
    if (!fs.existsSync(filePath)) throw new Error('自定义工具 HTML 文件写入后校验失败');

    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) throw new Error('自定义工具 HTML 文件为空');

    if (Buffer.byteLength(expectedHtmlContent, 'utf8') !== stat.size) {
        const savedContent = fs.readFileSync(filePath, 'utf-8');
        if (savedContent !== expectedHtmlContent) {
            throw new Error('自定义工具 HTML 文件内容校验失败');
        }
    }

    return registered;
}

async function createTool(payload) {
    const importRequestId = String(payload.importRequestId || '');
    if (importRequestId && !/^[a-f0-9]{32}$/.test(importRequestId)) {
        throw Object.assign(new Error('导入请求标识无效'), { status: 400 });
    }
    const importRequestHash = importRequestId
        ? crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') : null;
    const name = String(payload.name || '').trim();
    const nameEn = String(payload.nameEn || '').trim();
    const htmlContent = String(payload.htmlContent || '');
    if (!name) {
        const err = new Error('工具名称不能为空');
        err.status = 400;
        throw err;
    }
    if (name.length > 80 || nameEn.length > 120) {
        const err = new Error('中英文工具名称长度超出限制');
        err.status = 400;
        throw err;
    }
    const isZip = Boolean(payload.archiveBase64);
    if (!isZip && (!htmlContent || !/<html[\s>]/i.test(htmlContent))) {
        const err = new Error('请上传完整的 HTML 文件内容');
        err.status = 400;
        throw err;
    }

    let files;
    try {
        files = isZip
            ? await readZipFiles(payload.archiveBase64)
            : [['index.html', Buffer.from(htmlContent, 'utf8')]];
    } catch (err) {
        err.status = err.status || 400;
        throw err;
    }

    return withRegistryMutation(async () => {
        const tools = await listTools();
        if (importRequestId) {
            const existing = await get('SELECT * FROM custom_tools WHERE import_request_id = ?', [importRequestId]);
            if (existing) {
                if (existing.import_request_hash !== importRequestHash) {
                    throw Object.assign(new Error('导入请求标识已用于其他内容'), { status: 409 });
                }
                return rowToTool(existing);
            }
        }
        const existingSlugs = new Set([
            ...tools.map(item => item.slug),
            ...listToolDirs()
        ]);
        const slug = createSlug(payload.slug || name, existingSlugs);
        const now = new Date().toISOString();
        const history = {
            id: `custom-import-${slug}`,
            tool: 'custom',
            action: '导入自定义工具',
            detail: `${name} (${slug})`,
            time: now
        };
        const tool = {
            slug,
            name,
            nameEn: nameEn.slice(0, 120),
            icon: String(payload.icon || '🧩').trim().slice(0, 8) || '🧩',
            description: String(payload.description || '').trim(),
            descriptionEn: String(payload.descriptionEn || '').trim().slice(0, 1000),
            tags: Array.isArray(payload.tags) ? payload.tags.map(String).filter(Boolean).slice(0, 8) : [],
            href: `/tools/${slug}`,
            filePath: `/custom-tools/${slug}/index.html`,
            publicAccess: false,
            createdAt: now,
            updatedAt: now
        };

        try {
            saveToolFiles(slug, files);
            writeToolManifest(tool, { history });
            await insertOrReplaceToolRow(tool, tools.length);
            if (importRequestId) await run('UPDATE custom_tools SET import_request_id = ?, import_request_hash = ? WHERE slug = ?', [importRequestId, importRequestHash, slug]);
            await syncLegacyRegistryMirror();
            const expectedIndex = files.find(([filePath]) => filePath.toLowerCase() === 'index.html');
            await verifyCreatedTool(tool, expectedIndex ? expectedIndex[1].toString('utf8') : '');
            await historyRepo.addHistory(history);
            return tool;
        } catch (err) {
            removeToolDir(slug);
            try {
                await run('DELETE FROM custom_tools WHERE slug = ?', [slug]);
                await syncLegacyRegistryMirror();
            } catch (rollbackErr) {
                console.error('[custom-tools] registry rollback failed:', rollbackErr.message);
            }
            throw err;
        }
    });
}

async function deleteTool(slug) {
    return withRegistryMutation(async () => {
        await ensureRegistryReady();
        const result = await run('DELETE FROM custom_tools WHERE slug = ?', [slug]);
        if (!result.changes) return false;
        await syncLegacyRegistryMirror();
        removeToolDir(slug);
        return true;
    });
}

async function recoverToolFromDisk(slugValue, metadata = {}) {
    const slug = normalizeSlug(slugValue);
    if (!slug || slug !== slugValue) throw new Error('自定义工具标识不合法');
    return withRegistryMutation(async () => {
        const indexPath = path.join(getCustomToolsDir(), slug, 'index.html');
        if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
            throw new Error(`自定义工具入口文件不存在：${slug}`);
        }
        const tools = await listTools();
        const existing = tools.find(item => item.slug === slug);
        if (existing) return { tool: existing, recovered: false };

        const tool = normalizeToolRecord(metadata, slug);
        const history = {
            id: `custom-recover-${slug}`,
            tool: 'custom',
            action: '恢复自定义工具',
            detail: `${tool.name} (${slug}) - 根据磁盘清单恢复注册`,
            time: metadata.createdAt || tool.createdAt
        };
        try {
            await insertOrReplaceToolRow(tool, tools.length);
            await syncLegacyRegistryMirror();
            writeToolManifest(tool, { history });
            await historyRepo.addHistory(history);
            return { tool, recovered: true };
        } catch (err) {
            await run('DELETE FROM custom_tools WHERE slug = ?', [slug]);
            await syncLegacyRegistryMirror();
            throw err;
        }
    });
}

async function ensureToolHistory(slugValue, historyInput) {
    const slug = normalizeSlug(slugValue);
    if (!slug || slug !== slugValue) throw new Error('自定义工具标识不合法');
    return withRegistryMutation(async () => {
        const tools = await listTools();
        const tool = tools.find(item => item.slug === slug);
        if (!tool) throw new Error(`自定义工具未注册：${slug}`);
        const history = {
            id: String(historyInput.id || `custom-import-${slug}`),
            tool: 'custom',
            action: String(historyInput.action || '导入自定义工具'),
            detail: String(historyInput.detail || `${tool.name} (${slug})`),
            time: historyInput.time || tool.createdAt
        };
        writeToolManifest(tool, { history });
        if (!await historyRepo.hasHistory(history.id)) await historyRepo.addHistory(history);
        return history;
    });
}

async function reconcileToolsFromDisk() {
    return withRegistryMutation(async () => {
        const tools = await listTools();
        const registered = new Set(tools.map(item => item.slug));
        const recovered = [];
        const unregistered = [];
        let updatedCount = 0;

        for (const tool of tools) {
            const indexPath = path.join(getCustomToolsDir(), tool.slug, 'index.html');
            if (!fs.existsSync(indexPath)) continue;
            const manifest = readToolManifest(tool.slug);
            if (!manifest) {
                writeToolManifest(tool);
                continue;
            }
            if (manifest.tool) {
                const normalized = normalizeToolRecord(manifest.tool, tool.slug);
                if (
                    normalized.name !== tool.name ||
                    normalized.nameEn !== tool.nameEn ||
                    normalized.description !== tool.description ||
                    normalized.descriptionEn !== tool.descriptionEn ||
                    normalized.icon !== tool.icon ||
                    JSON.stringify(normalized.tags) !== JSON.stringify(tool.tags)
                ) {
                    await insertOrReplaceToolRow({ ...tool, ...normalized }, tools.indexOf(tool));
                    updatedCount++;
                }
            }
        }

        for (const slug of listToolDirs()) {
            if (registered.has(slug)) continue;
            const manifest = readToolManifest(slug);
            const indexPath = path.join(getCustomToolsDir(), slug, 'index.html');
            if (!manifest || !fs.existsSync(indexPath)) {
                unregistered.push(slug);
                continue;
            }
            const tool = normalizeToolRecord(manifest.tool, slug);
            tools.push(tool);
            registered.add(slug);
            recovered.push(slug);
            if (manifest.history && !await historyRepo.hasHistory(manifest.history.id)) {
                await historyRepo.addHistory(manifest.history);
            }
        }

        if (recovered.length || updatedCount > 0) {
            if (recovered.length) {
                for (const slug of recovered) {
                    const tool = tools.find(item => item.slug === slug);
                    await insertOrReplaceToolRow(tool, tools.indexOf(tool));
                }
            }
            await syncLegacyRegistryMirror();
        }
        return { recovered, unregistered };
    });
}

async function getToolFilePath(slug) {
    const safeSlug = normalizeSlug(slug);
    if (!safeSlug || safeSlug !== slug) return null;
    const rootDir = getToolRootDir(safeSlug);
    return rootDir ? path.join(rootDir, 'index.html') : null;
}

function getToolRootDir(slug) {
    const safeSlug = normalizeSlug(slug);
    if (!safeSlug || safeSlug !== slug) return null;
    const runtimeRoot = path.join(getCustomToolsDir(), safeSlug);
    const runtimeIndex = path.join(runtimeRoot, 'index.html');
    if (fs.existsSync(runtimeIndex) && fs.statSync(runtimeIndex).isFile()) return runtimeRoot;

    const bundledRoot = path.join(BUILTIN_TOOLS_DIR, safeSlug);
    const bundledIndex = path.join(bundledRoot, 'index.html');
    const bundledManifest = path.join(bundledRoot, TOOL_MANIFEST_FILE);
    try {
        const manifest = JSON.parse(fs.readFileSync(bundledManifest, 'utf8'));
        if (
            manifest
            && manifest.version === 1
            && manifest.tool
            && manifest.tool.slug === safeSlug
            && fs.existsSync(bundledIndex)
            && fs.statSync(bundledIndex).isFile()
        ) {
            return bundledRoot;
        }
    } catch (_) {}
    return null;
}

function getToolAssetPath(slug, relativePath) {
    const rootDir = getToolRootDir(slug);
    if (!rootDir) return null;
    const normalized = String(relativePath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..')) return null;
    const candidate = path.resolve(rootDir, ...parts);
    const resolvedRoot = path.resolve(rootDir);
    if (!candidate.startsWith(`${resolvedRoot}${path.sep}`)) return null;
    try {
        return fs.statSync(candidate).isFile() ? candidate : null;
    } catch (_) {
        return null;
    }
}

module.exports = {
    ensureRegistryReady,
    listTools,
    getTool,
    createTool,
    updateToolAccess,
    updateToolName,
    markToolsUpdated,
    normalizeToolState,
    getToolState,
    saveToolState,
    restoreToolState,
    listToolHistory,
    addToolHistory,
    deleteToolHistory,
    deleteTool,
    recoverToolFromDisk,
    ensureToolHistory,
    reconcileToolsFromDisk,
    replaceAllTools,
    getToolFilePath,
    getToolRootDir,
    getToolAssetPath,
    readZipFiles,
    BUILTIN_TOOLS_DIR,
    getCustomToolsDir,
    get CUSTOM_TOOLS_DIR() { return getCustomToolsDir(); },
    TOOL_MANIFEST_FILE
};
