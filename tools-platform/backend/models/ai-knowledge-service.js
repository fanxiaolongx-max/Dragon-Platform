const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { ensureDataDir, getDataDir } = require('./store');
const { getReportDataDir } = require('./report-store');
const { createDatabaseProxy } = require('./tenant-sqlite-pool');
const { getTenantId } = require('./tenant-context');
const customToolsRepo = require('./custom-tools-repository');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MAX_FILE_BYTES = 320 * 1024;
const MAX_FILES = 800;
const CHUNK_MAX_CHARS = 2200;
const CHUNK_OVERLAP_LINES = 8;
const MAX_ANALYSIS_CONTENT_CHARS = 200 * 1024;
const MAX_SEARCH_CANDIDATES = 2500;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const GRAPH_CACHE_TTL_MS = 30 * 60 * 1000;
const getKnowledgeDbPath = () => path.join(getDataDir(), 'ai-knowledge.db');

ensureDataDir();
const db = createDatabaseProxy('ai-knowledge.db');
db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
});

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) return reject(error);
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

// Connections are owned by tenant-sqlite-pool and are closed centrally during
// restore/shutdown. Closing the proxy here would leave a closed handle cached.
async function closeDatabase() {}

function getSourceRules() { return [
    { root: PROJECT_ROOT, single: 'README.md' },
    { root: path.join(PROJECT_ROOT, 'docs'), extensions: new Set(['.md']) },
    { root: path.join(PROJECT_ROOT, 'backend', 'routes'), extensions: new Set(['.js']) },
    { root: path.join(PROJECT_ROOT, 'backend', 'models'), extensions: new Set(['.js']) },
    { root: path.join(PROJECT_ROOT, 'backend', 'middleware'), extensions: new Set(['.js']) },
    { root: path.join(PROJECT_ROOT, 'backend'), single: 'server.js' },
    { root: path.join(PROJECT_ROOT, 'frontend', 'js'), extensions: new Set(['.js']) },
    { root: path.join(PROJECT_ROOT, 'frontend', 'pages'), extensions: new Set(['.html']) },
    { root: customToolsRepo.BUILTIN_TOOLS_DIR, extensions: new Set(['.html', '.htm', '.js', '.css', '.json', '.md', '.txt']) },
    { root: customToolsRepo.getCustomToolsDir(), extensions: new Set(['.html', '.htm', '.js', '.css', '.json', '.md', '.txt']), allowedRoot: customToolsRepo.getCustomToolsDir() },
    { root: PROJECT_ROOT, single: 'package.json' },
    { root: path.join(PROJECT_ROOT, 'backend'), single: 'package.json' }
]; }

const SKIP_PATH_PARTS = new Set([
    'node_modules', '.git', 'data', 'backups', 'logs', 'runtime', 'coverage', 'dist', 'build'
]);
const SKIP_FILE_RE = /(?:^|\/)(?:test_|tmp|fix_|patch_|update_|reconstructed_|parse_log)|\.min\.js$/i;

const initPromises = new Map();
const refreshPromises = new Map();
const lastRefreshCheckAt = new Map();
const graphCaches = new Map();

function reportProgress(onProgress, progress, stage, message, messageEn) {
    if (typeof onProgress !== 'function') return;
    onProgress({
        progress: Math.max(0, Math.min(100, Math.round(Number(progress) || 0))),
        stage,
        message,
        messageEn: messageEn || message
    });
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('图谱加载已取消');
    error.name = 'AbortError';
    throw error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function toProjectPath(filePath) {
    const customRoot = path.resolve(customToolsRepo.getCustomToolsDir());
    const relativeCustomPath = path.relative(customRoot, path.resolve(filePath));
    if (relativeCustomPath && !relativeCustomPath.startsWith('..') && !path.isAbsolute(relativeCustomPath)) {
        return `backend/data/custom-tools/${relativeCustomPath.split(path.sep).join('/')}`;
    }
    return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

function isSafeSourcePath(filePath, options = {}) {
    const { allowData = false, allowedRoot } = options;
    if (allowedRoot) {
        const relativeToAllowed = path.relative(path.resolve(allowedRoot), path.resolve(filePath));
        if (relativeToAllowed && !relativeToAllowed.startsWith('..') && !path.isAbsolute(relativeToAllowed)) {
            return !SKIP_FILE_RE.test(relativeToAllowed);
        }
    }
    const relative = toProjectPath(filePath);
    if (!relative || relative.startsWith('..')) return false;
    const parts = relative.split('/');
    if (parts.some(part => SKIP_PATH_PARTS.has(part) && part !== 'data')) return false;
    if (parts.includes('data') && !(allowData && relative.startsWith('backend/data/custom-tools/'))) return false;
    return !SKIP_FILE_RE.test(relative);
}

function walkFiles(root, extensions, output, options = {}) {
    if (!fs.existsSync(root) || output.length >= MAX_FILES) return;
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
        if (output.length >= MAX_FILES) break;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(root, entry.name);
        if (!isSafeSourcePath(fullPath, options)) continue;
        if (entry.isDirectory()) {
            walkFiles(fullPath, extensions, output, options);
        } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
            output.push(fullPath);
        }
    }
}

function listSourceFiles() {
    const files = [];
    for (const rule of getSourceRules()) {
        if (rule.single) {
            const candidate = path.join(rule.root, rule.single);
            if (fs.existsSync(candidate) && isSafeSourcePath(candidate, rule)) files.push(candidate);
        } else {
            walkFiles(rule.root, rule.extensions, files, rule);
        }
    }
    return [...new Set(files)].slice(0, MAX_FILES).sort();
}

function redactSensitiveText(value) {
    return String(value || '')
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[PRIVATE KEY REDACTED]')
        .replace(/((?:api[_-]?key|password|secret|token)\s*[:=]\s*["'])([^"'\n]{10,})(["'])/gi, '$1[REDACTED]$3');
}

function titleForLine(line, fallback) {
    const trimmed = String(line || '').trim();
    const markdown = trimmed.match(/^#{1,6}\s+(.+)/);
    if (markdown) return markdown[1].trim().slice(0, 180);
    const route = trimmed.match(/router\.(?:get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)/);
    if (route) return `API ${route[1]}`;
    const declaration = trimmed.match(/(?:async\s+)?function\s+([\w$]+)|(?:class|const|let)\s+([\w$]+)/);
    if (declaration) return (declaration[1] || declaration[2]).slice(0, 180);
    return fallback;
}

function chunkDocument(relativePath, content) {
    const lines = redactSensitiveText(content).split(/\r?\n/);
    const chunks = [];
    let start = 0;
    let currentTitle = path.basename(relativePath);

    while (start < lines.length) {
        let end = start;
        let chars = 0;
        let title = currentTitle;
        while (end < lines.length) {
            const next = lines[end];
            const detectedTitle = titleForLine(next, '');
            if (detectedTitle) {
                currentTitle = detectedTitle;
                if (end === start || title === path.basename(relativePath)) title = detectedTitle;
            }
            if (end > start && chars + next.length + 1 > CHUNK_MAX_CHARS) break;
            chars += next.length + 1;
            end += 1;
        }
        if (end === start) end += 1;
        const text = lines.slice(start, end).join('\n').trim();
        if (text) {
            chunks.push({
                chunkIndex: chunks.length,
                title,
                startLine: start + 1,
                endLine: end,
                content: text,
                searchText: `${relativePath}\n${title}\n${text}`.toLowerCase()
            });
        }
        if (end >= lines.length) break;
        start = Math.max(start + 1, end - CHUNK_OVERLAP_LINES);
    }
    return chunks;
}

async function ensureReady() {
    const tenantId = getTenantId();
    if (!initPromises.has(tenantId)) {
        const promise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
                    path TEXT PRIMARY KEY,
                    content_hash TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    mtime_ms INTEGER NOT NULL DEFAULT 0,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await run(`
                CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_path TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    start_line INTEGER NOT NULL DEFAULT 1,
                    end_line INTEGER NOT NULL DEFAULT 1,
                    content TEXT NOT NULL,
                    search_text TEXT NOT NULL,
                    FOREIGN KEY(document_path) REFERENCES ai_knowledge_documents(path) ON DELETE CASCADE,
                    UNIQUE(document_path, chunk_index)
                )
            `);
            await run('CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_document ON ai_knowledge_chunks(document_path, chunk_index)');
            await run('CREATE INDEX IF NOT EXISTS idx_ai_knowledge_documents_indexed ON ai_knowledge_documents(indexed_at)');
            await run(`
                CREATE TABLE IF NOT EXISTS ai_knowledge_meta (
                    key_name TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL DEFAULT '{}',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
        })().catch(error => {
            initPromises.delete(tenantId);
            throw error;
        });
        initPromises.set(tenantId, promise);
    }
    return initPromises.get(tenantId);
}

async function indexFile(filePath) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { skipped: true };
    return indexText(toProjectPath(filePath), fs.readFileSync(filePath, 'utf8'), { size: stat.size, mtimeMs: stat.mtimeMs });
}

/** 按内容建索引：文件，或数据库里的虚拟文档（如工具使用说明 tool-guides/*.md） */
async function indexText(relativePath, raw, { size = Buffer.byteLength(raw), mtimeMs = Date.now() } = {}) {
    const hash = sha256(raw);
    const existing = await get('SELECT content_hash FROM ai_knowledge_documents WHERE path = ?', [relativePath]);
    if (existing && existing.content_hash === hash) return { unchanged: true };

    const chunks = chunkDocument(relativePath, raw);
    await run(
        `INSERT INTO ai_knowledge_documents (path, content_hash, size_bytes, mtime_ms, chunk_count, indexed_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(path) DO UPDATE SET
            content_hash = excluded.content_hash,
            size_bytes = excluded.size_bytes,
            mtime_ms = excluded.mtime_ms,
            chunk_count = excluded.chunk_count,
            indexed_at = CURRENT_TIMESTAMP`,
        [relativePath, hash, size, Math.round(mtimeMs), chunks.length]
    );
    await run('DELETE FROM ai_knowledge_chunks WHERE document_path = ?', [relativePath]);
    for (const chunk of chunks) {
        await run(
            `INSERT INTO ai_knowledge_chunks
             (document_path, chunk_index, title, start_line, end_line, content, search_text)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [relativePath, chunk.chunkIndex, chunk.title, chunk.startLine, chunk.endLine, chunk.content, chunk.searchText]
        );
    }
    return { indexed: true, chunks: chunks.length };
}

async function refreshIndex({ force = false, onProgress, signal } = {}) {
    await ensureReady();
    throwIfAborted(signal);
    const tenantId = getTenantId();
    if (refreshPromises.has(tenantId)) {
        reportProgress(onProgress, 12, 'index-wait', '正在等待已开始的知识索引检查…', 'Waiting for the active knowledge index check…');
        return refreshPromises.get(tenantId);
    }
    const now = Date.now();
    if (!force && now - (lastRefreshCheckAt.get(tenantId) || 0) < REFRESH_INTERVAL_MS) {
        reportProgress(onProgress, 42, 'index-cached', '知识索引已是最新', 'Knowledge index is already current');
        return getStatus();
    }
    lastRefreshCheckAt.set(tenantId, now);

    const promise = (async () => {
        reportProgress(onProgress, 8, 'index-scan', '正在扫描可索引文件…', 'Scanning indexable files…');
        const files = listSourceFiles();
        const activePaths = new Set(files.map(toProjectPath));
        let indexedFiles = 0;
        let unchangedFiles = 0;
        let skippedFiles = 0;
        let chunkCount = 0;
        let removedFiles = 0;
        const errors = [];

        for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
            throwIfAborted(signal);
            const filePath = files[fileIndex];
            if (fileIndex === 0 || fileIndex % 20 === 0 || fileIndex === files.length - 1) {
                const progress = 10 + (fileIndex / Math.max(1, files.length)) * 32;
                reportProgress(onProgress, progress, 'index-files', `正在检查知识文件 ${fileIndex + 1}/${files.length}`, `Checking knowledge files ${fileIndex + 1}/${files.length}`);
            }
            try {
                const result = await indexFile(filePath);
                if (result.indexed) {
                    indexedFiles += 1;
                    chunkCount += result.chunks || 0;
                } else if (result.unchanged) {
                    unchangedFiles += 1;
                } else {
                    skippedFiles += 1;
                }
            } catch (error) {
                errors.push({ path: toProjectPath(filePath), error: String(error.message || error).slice(0, 200) });
            }
        }

        // 工具使用说明（存在租户库里，没有对应文件）：作为虚拟文档一起索引
        const guideDocs = await require('./platform-tool-guides').documentsForIndex().catch(error => {
            errors.push({ path: 'tool-guides', error: String(error.message || error).slice(0, 200) });
            return [];
        });
        for (const doc of guideDocs) {
            activePaths.add(doc.path);
            try {
                const result = await indexText(doc.path, doc.content);
                if (result.indexed) { indexedFiles += 1; chunkCount += result.chunks || 0; } else unchangedFiles += 1;
            } catch (error) {
                errors.push({ path: doc.path, error: String(error.message || error).slice(0, 200) });
            }
        }

        const stored = await all('SELECT path FROM ai_knowledge_documents');
        for (const row of stored) {
            if (!activePaths.has(row.path)) {
                await run('DELETE FROM ai_knowledge_chunks WHERE document_path = ?', [row.path]);
                await run('DELETE FROM ai_knowledge_documents WHERE path = ?', [row.path]);
                removedFiles += 1;
            }
        }
        const status = await getStatus();
        const summary = {
            completedAt: new Date().toISOString(),
            indexedFiles,
            unchangedFiles,
            skippedFiles,
            removedFiles,
            newChunks: chunkCount,
            errors
        };
        await run(
            `INSERT INTO ai_knowledge_meta (key_name, value_json, updated_at)
             VALUES ('last_refresh', ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key_name) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`,
            [JSON.stringify(summary)]
        );
        graphCaches.delete(tenantId);
        return { ...status, ...summary };
    })().catch(error => {
        if (error.name === 'AbortError') lastRefreshCheckAt.delete(tenantId);
        throw error;
    }).finally(() => {
        refreshPromises.delete(tenantId);
    });
    refreshPromises.set(tenantId, promise);
    return promise;
}

const STOP_TERMS = new Set(['这个', '那个', '怎么', '什么', '项目', '功能', '如何', '可以', '帮我', '看看', '一下', 'the', 'and', 'for', 'with', 'this', 'that']);
const DOMAIN_ALIASES = [
    [/月报/, ['monthly', 'monthly_report_data', 'report.db', 'reportsnapshots']],
    [/报表|看板/, ['report', 'reportmetricdata', 'reportcategoryscores']],
    [/数据源|存储|数据库/, ['report.db', 'tools.db', 'sqlite', 'raw_data_json']],
    [/客服|助手|聊天/, ['ai-assistant', 'routes/ai', 'ai-chat']],
    [/导入/, ['sla', 'upload', 'snapshot']],
    [/抓取|uivf12/i, ['uivf12', 'routes/uiv']],
    [/权限|登录|鉴权/, ['auth', 'checkauth', 'requireadmin']],
    [/备份|恢复/, ['backup', 'global-backup']],
    [/需求广场|需求管理/, ['requirements', 'requirements.db']],
    [/实现|代码|接口/, ['backend/routes', 'backend/models', 'frontend/js']],
    [/流式|stream/i, ['requeststreamingchat', 'ondelta', 'streamgeneratecontent', 'application/x-ndjson']]
];

function extractSearchTerms(query) {
    const text = String(query || '').toLowerCase();
    const terms = new Set();
    for (const token of text.match(/[a-z0-9_./-]{2,}/g) || []) {
        if (!STOP_TERMS.has(token)) terms.add(token.slice(0, 60));
    }
    for (const sequence of text.match(/[\u3400-\u9fff]{2,}/g) || []) {
        if (sequence.length <= 8 && !STOP_TERMS.has(sequence)) terms.add(sequence);
        for (let width = 2; width <= Math.min(4, sequence.length); width += 1) {
            for (let index = 0; index <= sequence.length - width; index += 1) {
                const token = sequence.slice(index, index + width);
                if (!STOP_TERMS.has(token)) terms.add(token);
            }
        }
    }
    for (const [pattern, aliases] of DOMAIN_ALIASES) {
        if (pattern.test(text)) aliases.forEach(alias => terms.add(alias));
    }
    return [...terms].sort((a, b) => b.length - a.length).slice(0, 14);
}

function countOccurrences(text, term) {
    if (!term) return 0;
    let count = 0;
    let cursor = 0;
    while ((cursor = text.indexOf(term, cursor)) >= 0 && count < 8) {
        count += 1;
        cursor += term.length;
    }
    return count;
}

function intentPathBoost(queryText, documentPath, content) {
    let score = 0;
    if (/客服|助手|聊天/.test(queryText)) {
        if (documentPath === 'frontend/js/shared/ai-assistant.js') score += 58;
        if (documentPath === 'backend/routes/ai.js') score += 58;
        if (/ai-chat|ai-provider|ai-settings/.test(documentPath)) score += 24;
    }
    if (/数据源|从哪|读取|存储|数据库/.test(queryText)) {
        if (documentPath.startsWith('backend/')) score += 24;
        if (documentPath === 'backend/routes/db.js') score += 28;
        if (/report\.db|tools\.db|from\s+reportsnapshots/i.test(content)) score += 18;
    }
    if (/月报/.test(queryText)) {
        if (/monthly|report/.test(documentPath)) score += 18;
        if (/monthly_report_data/i.test(content)) score += 52;
        else if (/reportsnapshots/i.test(content)) score += 16;
    }
    if (/接口|api|路由/.test(queryText) && documentPath.startsWith('backend/routes/')) score += 24;
    if (/页面|前端/.test(queryText) && documentPath.startsWith('frontend/')) score += 14;
    return score;
}

async function search(query, { limit = 7, pathHints = [] } = {}) {
    await refreshIndex();
    const terms = extractSearchTerms(query);
    if (!terms.length) return [];
    const normalizedPathHints = (Array.isArray(pathHints) ? pathHints : [])
        .map(item => String(item || '').trim().toLowerCase())
        .filter(Boolean);
    const whereParts = terms.map(() => '(search_text LIKE ? OR LOWER(document_path) LIKE ? OR LOWER(title) LIKE ?)');
    const whereParams = terms.flatMap(term => [`%${term}%`, `%${term}%`, `%${term}%`]);
    normalizedPathHints.forEach(hint => {
        whereParts.push('LOWER(document_path) = ?');
        whereParams.push(hint);
    });
    const rows = await all(
        `SELECT document_path, title, start_line, end_line, content, search_text
         FROM ai_knowledge_chunks
         WHERE ${whereParts.join(' OR ')}
         LIMIT ?`,
        [...whereParams, MAX_SEARCH_CANDIDATES]
    );
    const queryText = String(query || '').toLowerCase();
    const ranked = rows.map(row => {
        const pathText = row.document_path.toLowerCase();
        const titleText = row.title.toLowerCase();
        let score = 0;
        for (const term of terms) {
            score += countOccurrences(row.search_text, term) * Math.max(1, term.length / 2);
            if (pathText.includes(term)) score += 8;
            if (titleText.includes(term)) score += 10;
        }
        if (row.search_text.includes(queryText) && queryText.length >= 4) score += 20;
        if (row.document_path === 'README.md') score += 2;
        score += intentPathBoost(queryText, row.document_path, row.content);
        for (const hint of normalizedPathHints) {
            if (pathText === hint) score += 70;
            else if (pathText.endsWith(hint) || hint.endsWith(pathText)) score += 34;
        }
        return { ...row, score: Number(score.toFixed(2)) };
    }).sort((a, b) => b.score - a.score);

    const selected = [];
    const perDocument = new Map();
    const selectedContentHashes = new Set();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 7, 10));
    for (const row of ranked) {
        const used = perDocument.get(row.document_path) || 0;
        if (used >= 2) continue;
        const contentHash = sha256(row.content);
        if (selectedContentHashes.has(contentHash)) continue;
        selected.push(row);
        selectedContentHashes.add(contentHash);
        perDocument.set(row.document_path, used + 1);
        if (selected.length >= safeLimit) break;
    }
    return selected.map(({ search_text, ...row }) => row);
}

async function getStatus() {
    await ensureReady();
    const doc = await get('SELECT COUNT(*) AS count, COALESCE(SUM(chunk_count), 0) AS chunks, MAX(indexed_at) AS last_indexed_at FROM ai_knowledge_documents');
    const meta = await get("SELECT value_json, updated_at FROM ai_knowledge_meta WHERE key_name = 'last_refresh'");
    let lastRefresh = null;
    try {
        lastRefresh = meta ? JSON.parse(meta.value_json || '{}') : null;
    } catch (_error) {
        lastRefresh = null;
    }
    return {
        documentCount: Number(doc && doc.count || 0),
        chunkCount: Number(doc && doc.chunks || 0),
        lastIndexedAt: doc && doc.last_indexed_at || null,
        lastRefresh,
        projectRoot: PROJECT_ROOT
    };
}

function groupForDocument(documentPath) {
    if (documentPath === 'README.md' || documentPath === 'package.json') return { key: 'project', label: '项目总览', labelEn: 'Project Overview' };
    if (documentPath.startsWith('docs/')) return { key: 'docs', label: '项目文档', labelEn: 'Project Docs' };
    if (documentPath.startsWith('backend/routes/')) return { key: 'backend-routes', label: '后端接口', labelEn: 'Backend APIs' };
    if (documentPath.startsWith('backend/models/')) return { key: 'backend-models', label: '数据与服务', labelEn: 'Data & Services' };
    if (documentPath.startsWith('backend/middleware/')) return { key: 'backend-middleware', label: '鉴权与中间件', labelEn: 'Auth & Middleware' };
    if (documentPath.startsWith('frontend/pages/')) return { key: 'frontend-pages', label: '页面入口', labelEn: 'Page Entries' };
    if (documentPath.startsWith('frontend/js/report/')) return { key: 'frontend-report', label: '报表与月报', labelEn: 'Reports & Monthly' };
    if (documentPath.startsWith('frontend/js/sla/')) return { key: 'frontend-sla', label: 'SLA 数据导入', labelEn: 'SLA Data Import' };
    if (documentPath.startsWith('frontend/js/uivf12/')) return { key: 'frontend-uiv', label: '数据抓取', labelEn: 'Data Capture' };
    if (documentPath.startsWith('frontend/js/shared/')) return { key: 'frontend-shared', label: '前端公共能力', labelEn: 'Shared Frontend' };
    if (documentPath.startsWith('frontend/js/')) return { key: 'frontend-other', label: '其他前端模块', labelEn: 'Other Frontend' };
    if (documentPath.startsWith('backend/builtin-tools/')) return { key: 'builtin-tools', label: '自带 HTML 工具', labelEn: 'Built-in HTML Tools' };
    if (documentPath.startsWith('backend/data/custom-tools/')) return { key: 'custom-tools', label: '自定义 HTML 工具', labelEn: 'Custom HTML Tools' };
    return { key: 'other', label: '其他知识', labelEn: 'Other Knowledge' };
}

function isToolAssetKnowledgePath(documentPath) {
    return documentPath.startsWith('backend/builtin-tools/') || documentPath.startsWith('backend/data/custom-tools/');
}

function resolveDocumentReference(sourcePath, reference, documentSet) {
    const raw = String(reference || '').split('?')[0].split('#')[0];
    if (!raw || /^(?:https?:|[a-z@][\w@-]*$)/i.test(raw)) return null;
    let candidate = '';
    if (raw.startsWith('/js/')) candidate = `frontend${raw}`;
    else if (raw.startsWith('/pages/')) candidate = `frontend${raw}`;
    else if (raw.startsWith('.')) candidate = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), raw));
    else return null;
    const candidates = [candidate, `${candidate}.js`, `${candidate}.json`, `${candidate}/index.js`];
    return candidates.find(item => documentSet.has(item)) || null;
}

function extractDocumentReferences(sourcePath, content, documentSet) {
    const refs = new Set();
    const patterns = [
        /require\(\s*['"]([^'"]+)['"]\s*\)/g,
        /from\s+['"]([^'"]+)['"]/g,
        /<script[^>]+src=['"]([^'"]+)['"]/gi
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const resolved = resolveDocumentReference(sourcePath, match[1], documentSet);
            if (resolved && resolved !== sourcePath) refs.add(resolved);
            if (refs.size >= 30) break;
        }
    }
    return [...refs];
}

function readJsonFile(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_error) { return null; }
}

async function listAssetFiles(rootDir, relativeDir = '', output = [], signal) {
    throwIfAborted(signal);
    if (!fs.existsSync(path.join(rootDir, relativeDir)) || output.length >= 1200) return output;
    const entries = await fs.promises.readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
    for (const entry of entries) {
        throwIfAborted(signal);
        if (output.length >= 1200 || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
        const relativePath = path.posix.join(relativeDir.split(path.sep).join('/'), entry.name);
        const absolutePath = path.join(rootDir, relativePath);
        if (entry.isDirectory()) await listAssetFiles(rootDir, relativePath, output, signal);
        else if (entry.isFile()) {
            const stat = await fs.promises.stat(absolutePath);
            output.push({ path: relativePath, bytes: stat.size, mtimeMs: Math.round(stat.mtimeMs), absolutePath });
        }
    }
    return output;
}

function collapseToolAssetFiles(files) {
    const visibleFiles = [];
    const mp3Files = [];
    for (const file of files || []) {
        if (path.posix.extname(String(file.path || '')).toLowerCase() === '.mp3') mp3Files.push(file);
        else visibleFiles.push(file);
    }
    return {
        visibleFiles,
        collapsedGroups: mp3Files.length ? [{
            extension: '.mp3',
            files: mp3Files,
            fileCount: mp3Files.length,
            bytes: mp3Files.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0),
            mtimeMs: mp3Files.reduce((latest, file) => Math.max(latest, Number(file.mtimeMs) || 0), 0)
        }] : []
    };
}

function queryDatabaseSchema(filePath) {
    return new Promise(resolve => {
        const handle = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, error => {
            if (error) return resolve([]);
            handle.all(
                `SELECT name, sql FROM sqlite_master
                 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                 ORDER BY name`,
                [],
                (queryError, rows) => {
                    if (queryError || !rows?.length) return handle.close(() => resolve([]));
                    Promise.all(rows.map(row => new Promise(done => {
                        const tableName = String(row.name || '').replace(/"/g, '""');
                        handle.all(`PRAGMA foreign_key_list("${tableName}")`, [], (foreignKeyError, foreignKeys) => {
                            done({ ...row, foreignKeys: foreignKeyError ? [] : foreignKeys || [] });
                        });
                    }))).then(result => handle.close(() => resolve(result)));
                }
            );
        });
    });
}

function listLiveDatabaseFiles() {
    const files = [];
    if (fs.existsSync(getDataDir())) {
        fs.readdirSync(getDataDir(), { withFileTypes: true })
            .filter(item => item.isFile() && /\.(?:db|sqlite)$/i.test(item.name))
            .filter(item => !/(?:before|backup|corrupt|repaired)/i.test(item.name))
            .filter(item => !(path.resolve(getReportDataDir()) !== path.resolve(getDataDir()) && item.name.toLowerCase() === 'report.db'))
            .map(item => path.join(getDataDir(), item.name))
            .filter(filePath => fs.statSync(filePath).size > 0)
            .forEach(filePath => files.push(filePath));
    }
    const reportDbPath = path.join(getReportDataDir(), 'report.db');
    if (fs.existsSync(reportDbPath) && fs.statSync(reportDbPath).size > 0) files.push(reportDbPath);
    return [...new Set(files.map(filePath => path.resolve(filePath)))];
}

function extractRelativeAssetReferences(sourcePath, content, fileSet) {
    const references = new Set();
    const pattern = /(?:src|href)\s*=\s*['"]([^'"#?]+)|(?:import\s+[^'";]*?from\s+|import\s*\(|fetch\s*\()\s*['"]([^'"]+)['"]/gi;
    let match;
    while ((match = pattern.exec(content)) !== null && references.size < 60) {
        const raw = match[1] || match[2] || '';
        if (!raw || /^(?:https?:|data:|blob:|\/api\/|\/custom-tools\/)/i.test(raw)) continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), raw));
        if (fileSet.has(resolved) && resolved !== sourcePath) references.add(resolved);
    }
    return [...references];
}

async function buildAssetGraph(contentByDocument, documentSet, { onProgress, signal } = {}) {
    const nodes = [];
    const edges = [];
    const edgeSet = new Set();
    const addEdge = (source, target, type) => {
        const key = `${source}\0${target}\0${type}`;
        if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ source, target, type }); }
    };
    const assetRootId = 'group:tool-data-assets';
    nodes.push({ id: assetRootId, type: 'group', label: '工具与数据资产', labelEn: 'Tools & Data Assets', group: 'tool-data-assets', size: 19 });
    const categories = [
        { id: 'asset-category:builtin', key: 'builtin-tools', label: '自带 HTML 工具', labelEn: 'Built-in HTML Tools' },
        { id: 'asset-category:custom', key: 'custom-tools', label: '自定义 HTML 工具', labelEn: 'Custom HTML Tools' },
        { id: 'asset-category:databases', key: 'databases', label: '数据库与表', labelEn: 'Databases & Tables' }
    ];
    categories.forEach(category => {
        nodes.push({ ...category, type: 'assetCategory', group: 'tool-data-assets', size: 13 });
        addEdge(assetRootId, category.id, 'contains');
    });

    const builtInSlugs = new Set(
        fs.existsSync(customToolsRepo.BUILTIN_TOOLS_DIR)
            ? fs.readdirSync(customToolsRepo.BUILTIN_TOOLS_DIR, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name)
            : []
    );
    const registeredTools = await customToolsRepo.listTools();
    let assetFileCount = 0;
    let builtInToolCount = 0;
    let customToolCount = 0;
    for (let toolIndex = 0; toolIndex < registeredTools.length; toolIndex += 1) {
        throwIfAborted(signal);
        const tool = registeredTools[toolIndex];
        reportProgress(
            onProgress,
            55 + (toolIndex / Math.max(1, registeredTools.length)) * 25,
            'asset-tools',
            `正在分析工具资产 ${toolIndex + 1}/${registeredTools.length}：${tool.name || tool.slug}`,
            `Analyzing tool assets ${toolIndex + 1}/${registeredTools.length}: ${tool.nameEn || tool.name || tool.slug}`
        );
        const builtIn = builtInSlugs.has(tool.slug);
        if (builtIn) builtInToolCount += 1; else customToolCount += 1;
        const toolId = `tool:${builtIn ? 'builtin' : 'custom'}:${tool.slug}`;
        const categoryId = builtIn ? 'asset-category:builtin' : 'asset-category:custom';
        const toolDir = path.join(customToolsRepo.CUSTOM_TOOLS_DIR, tool.slug);
        const manifest = readJsonFile(path.join(toolDir, customToolsRepo.TOOL_MANIFEST_FILE));
        const files = (await listAssetFiles(toolDir, '', [], signal)).filter(item => item.path !== customToolsRepo.TOOL_MANIFEST_FILE);
        const assetPlan = collapseToolAssetFiles(files);
        nodes.push({
            id: toolId, type: 'tool', label: tool.name || tool.slug, labelEn: tool.nameEn || tool.name || tool.slug,
            slug: tool.slug, group: builtIn ? 'builtin-tools' : 'custom-tools', builtIn,
            description: tool.description || '', descriptionEn: tool.descriptionEn || tool.description || '', href: tool.href, publicAccess: tool.publicAccess,
            fileCount: files.length, updatedAt: tool.updatedAt, size: 8 + Math.min(8, Math.sqrt(files.length) * 1.8),
            managed: Boolean(manifest?.builtIn)
        });
        addEdge(categoryId, toolId, 'contains');
        const fileSet = new Set(files.map(file => file.path));
        const fileNodeIds = new Map();
        assetFileCount += files.length;
        for (let fileIndex = 0; fileIndex < assetPlan.visibleFiles.length; fileIndex += 1) {
            if (fileIndex % 12 === 0) await new Promise(resolve => setImmediate(resolve));
            throwIfAborted(signal);
            const file = assetPlan.visibleFiles[fileIndex];
            const fileId = `tool-file:${builtIn ? 'builtin' : 'custom'}:${tool.slug}:${file.path}`;
            fileNodeIds.set(file.path, fileId);
            nodes.push({
                id: fileId, type: 'assetFile', label: path.posix.basename(file.path), path: `backend/data/custom-tools/${tool.slug}/${file.path}`,
                relativePath: file.path, toolId, toolSlug: tool.slug, group: builtIn ? 'builtin-tools' : 'custom-tools',
                bytes: file.bytes, mtimeMs: file.mtimeMs, extension: path.posix.extname(file.path).toLowerCase(),
                indexedKnowledge: contentByDocument.has(`backend/data/custom-tools/${tool.slug}/${file.path}`), size: 4.4
            });
            addEdge(toolId, fileId, 'contains');
        }
        for (const group of assetPlan.collapsedGroups) {
            const extensionName = group.extension.replace('.', '').toUpperCase();
            const fileId = `tool-file:${builtIn ? 'builtin' : 'custom'}:${tool.slug}:__collapsed__/${extensionName.toLowerCase()}`;
            group.files.forEach(file => fileNodeIds.set(file.path, fileId));
            nodes.push({
                id: fileId,
                type: 'assetFile',
                label: `${extensionName} 音频资源（${group.fileCount} 个）`,
                labelEn: `${extensionName} Audio Assets (${group.fileCount})`,
                description: `已折叠 ${group.fileCount} 个 ${extensionName} 文件，避免大量音频节点和连线拖慢图谱。`,
                descriptionEn: `${group.fileCount} ${extensionName} files are collapsed to keep the graph responsive.`,
                path: `backend/data/custom-tools/${tool.slug}/**/*${group.extension}`,
                relativePath: `**/*${group.extension}`,
                toolId,
                toolSlug: tool.slug,
                group: builtIn ? 'builtin-tools' : 'custom-tools',
                bytes: group.bytes,
                mtimeMs: group.mtimeMs,
                extension: group.extension,
                fileCount: group.fileCount,
                aggregated: true,
                size: 5.2 + Math.min(5, Math.log2(group.fileCount + 1))
            });
            addEdge(toolId, fileId, 'contains');
        }
        for (let fileIndex = 0; fileIndex < assetPlan.visibleFiles.length; fileIndex += 1) {
            throwIfAborted(signal);
            const file = assetPlan.visibleFiles[fileIndex];
            const fileId = fileNodeIds.get(file.path);
            if (file.bytes <= MAX_FILE_BYTES && /\.(?:html?|js|css|json|md|txt)$/i.test(file.path)) {
                let content = '';
                try { content = await fs.promises.readFile(file.absolutePath, 'utf8'); } catch (_error) {}
                for (const target of extractRelativeAssetReferences(file.path, content, fileSet)) {
                    const targetId = fileNodeIds.get(target);
                    if (targetId) addEdge(fileId, targetId, 'depends');
                }
            }
        }
        ['backend/routes/custom-tools.js', 'backend/models/custom-tools-repository.js', 'backend/server.js'].forEach(codePath => {
            if (documentSet.has(codePath)) addEdge(toolId, `doc:${codePath}`, 'servedBy');
        });
    }

    const databaseFiles = listLiveDatabaseFiles();
    const tableNodesByName = new Map();
    const tableNodesByDatabaseAndName = new Map();
    const databaseIdsByName = new Map();
    const databaseNameByTableId = new Map();
    const pendingForeignKeys = [];
    let tableCount = 0;
    let databaseCount = 0;
    let tableRelationCount = 0;
    for (const databasePath of databaseFiles) {
        throwIfAborted(signal);
        reportProgress(onProgress, 82, 'asset-databases', `正在读取数据库结构：${path.basename(databasePath)}`, `Reading database schema: ${path.basename(databasePath)}`);
        const databaseName = path.basename(databasePath);
        const databaseProjectPath = toProjectPath(databasePath);
        const tables = await queryDatabaseSchema(databasePath);
        if (!tables.length) continue;
        const stat = fs.statSync(databasePath);
        databaseCount += 1;
        const databaseId = `database:${databaseProjectPath}`;
        nodes.push({ id: databaseId, type: 'database', label: databaseName, labelEn: databaseName, path: databaseProjectPath, group: 'databases', tableCount: tables.length, bytes: stat.size, size: 9 + Math.min(8, Math.sqrt(tables.length) * 1.7) });
        addEdge('asset-category:databases', databaseId, 'contains');
        const databaseNameKey = databaseName.toLowerCase();
        if (!databaseIdsByName.has(databaseNameKey)) databaseIdsByName.set(databaseNameKey, []);
        databaseIdsByName.get(databaseNameKey).push(databaseId);
        for (const table of tables) {
            tableCount += 1;
            const tableId = `table:${databaseProjectPath}:${table.name}`;
            const columns = [...String(table.sql || '').matchAll(/(?:^|,)\s*[`"\[]?([A-Za-z_][\w$]*)[`"\]]?\s+[A-Z]/g)].map(match => match[1]).slice(0, 30);
            nodes.push({ id: tableId, type: 'table', label: table.name, labelEn: table.name, database: databaseName, databasePath: databaseProjectPath, path: `${databaseProjectPath}#${table.name}`, group: 'databases', columns, schema: String(table.sql || '').slice(0, 1200), foreignKeys: table.foreignKeys || [], size: 5 });
            addEdge(databaseId, tableId, 'contains');
            const key = String(table.name).toLowerCase();
            if (!tableNodesByName.has(key)) tableNodesByName.set(key, []);
            tableNodesByName.get(key).push(tableId);
            tableNodesByDatabaseAndName.set(`${databaseId}\0${key}`, tableId);
            databaseNameByTableId.set(tableId, databaseNameKey);
            (table.foreignKeys || []).forEach(foreignKey => pendingForeignKeys.push({ databaseId, tableId, foreignKey }));
        }
    }
    pendingForeignKeys.forEach(({ databaseId, tableId, foreignKey }) => {
        const targetId = tableNodesByDatabaseAndName.get(`${databaseId}\0${String(foreignKey.table || '').toLowerCase()}`);
        if (!targetId) return;
        tableRelationCount += 1;
        addEdge(tableId, targetId, 'references');
    });
    for (const [documentPath, content] of contentByDocument) {
        const referencedTables = new Set();
        const referencedDatabases = new Set(
            [...String(content || '').matchAll(/\b([A-Za-z0-9_-]+\.(?:db|sqlite))\b/gi)].map(match => match[1].toLowerCase())
        );
        referencedDatabases.forEach(databaseName => {
            for (const databaseId of databaseIdsByName.get(databaseName) || []) addEdge(`doc:${documentPath}`, databaseId, 'usesDatabase');
        });
        const sqlPattern = /\b(?:from|join|into|update|table(?:\s+if\s+not\s+exists)?)\s+[`"\[]?([A-Za-z_][\w$]*)/gi;
        let match;
        while ((match = sqlPattern.exec(content)) !== null && referencedTables.size < 80) referencedTables.add(match[1].toLowerCase());
        for (const tableName of referencedTables) {
            const candidates = tableNodesByName.get(tableName) || [];
            const scopedCandidates = referencedDatabases.size
                ? candidates.filter(tableId => referencedDatabases.has(databaseNameByTableId.get(tableId)))
                : candidates;
            for (const tableId of scopedCandidates.length ? scopedCandidates : candidates) addEdge(`doc:${documentPath}`, tableId, 'queries');
        }
    }
    const signature = sha256(`${nodes.map(node => `${node.id}:${node.label || ''}:${node.labelEn || ''}:${node.descriptionEn || ''}:${node.updatedAt || ''}:${node.bytes || 0}:${node.mtimeMs || 0}:${node.tableCount || 0}:${node.schema || ''}`).join('|')}|${edges.map(edge => `${edge.source}:${edge.target}:${edge.type}`).join('|')}`);
    return {
        nodes, edges, signature,
        stats: { builtInTools: builtInToolCount, customTools: customToolCount, assetFiles: assetFileCount, databases: databaseCount, tables: tableCount, tableRelations: tableRelationCount }
    };
}

async function getGraph({ onProgress, signal, preferCache = true } = {}) {
    const tenantId = getTenantId();
    const cached = graphCaches.get(tenantId);
    if (preferCache && cached && Date.now() - cached.createdAt < GRAPH_CACHE_TTL_MS) {
        reportProgress(onProgress, 100, 'cache-hit', '已从缓存读取图谱', 'Graph loaded from cache');
        return cached.value;
    }
    reportProgress(onProgress, 3, 'start', '正在准备项目知识图谱…', 'Preparing the project knowledge graph…');
    try {
        await refreshIndex({ onProgress, signal });
    } catch (error) {
        if (error.name !== 'AbortError' || signal?.aborted) throw error;
        reportProgress(onProgress, 8, 'index-retry', '正在重新启动知识索引检查…', 'Restarting the knowledge index check…');
        await refreshIndex({ onProgress, signal });
    }
    throwIfAborted(signal);
    reportProgress(onProgress, 47, 'documents', '正在读取知识文档和关系…', 'Reading indexed documents and relationships…');
    const status = await getStatus();
    const documents = await all(
        `SELECT path, size_bytes, chunk_count, indexed_at
         FROM ai_knowledge_documents
         ORDER BY path ASC
         LIMIT 500`
    );
    const graphDocuments = documents.filter(document => !isToolAssetKnowledgePath(document.path));
    const documentSet = new Set(documents.map(item => item.path));
    const contentRows = await all(
        `SELECT document_path, content
         FROM ai_knowledge_chunks
         ORDER BY document_path, chunk_index`
    );
    const contentByDocument = new Map();
    for (const row of contentRows) {
        contentByDocument.set(row.document_path, `${contentByDocument.get(row.document_path) || ''}\n${row.content}`);
    }
    const assets = await buildAssetGraph(contentByDocument, documentSet, { onProgress, signal });
    throwIfAborted(signal);
    const cacheKey = `${getTenantId()}:${status.documentCount}:${status.chunkCount}:${status.lastIndexedAt || ''}:${assets.signature}`;
    if (cached && cached.key === cacheKey) {
        graphCaches.set(tenantId, { ...cached, createdAt: Date.now() });
        reportProgress(onProgress, 100, 'complete', '图谱已就绪', 'Graph is ready');
        return cached.value;
    }
    reportProgress(onProgress, 88, 'relationships', '正在生成节点与依赖关系…', 'Building graph nodes and dependency links…');

    const groupCounts = new Map();
    graphDocuments.forEach(document => {
        const group = groupForDocument(document.path);
        groupCounts.set(group.key, { ...group, count: (groupCounts.get(group.key)?.count || 0) + 1 });
    });

    const nodes = [{ id: 'root', type: 'root', label: 'Dragon Claw', labelEn: 'Dragon Claw', size: 28 }];
    const edges = [];
    for (const group of groupCounts.values()) {
        const groupId = `group:${group.key}`;
        nodes.push({ id: groupId, type: 'group', label: group.label, labelEn: group.labelEn, group: group.key, count: group.count, size: 12 + Math.sqrt(group.count) * 2.2 });
        edges.push({ source: 'root', target: groupId, type: 'contains' });
    }
    for (const document of graphDocuments) {
        const group = groupForDocument(document.path);
        const documentId = `doc:${document.path}`;
        nodes.push({
            id: documentId,
            type: 'document',
            label: path.posix.basename(document.path),
            path: document.path,
            group: group.key,
            chunks: Number(document.chunk_count) || 0,
            bytes: Number(document.size_bytes) || 0,
            indexedAt: document.indexed_at,
            size: 4.5 + Math.min(6, Math.log2((Number(document.chunk_count) || 0) + 1))
        });
        edges.push({ source: `group:${group.key}`, target: documentId, type: 'contains' });
    }

    nodes.push(...assets.nodes);
    edges.push({ source: 'root', target: 'group:tool-data-assets', type: 'contains' }, ...assets.edges);

    let dependencyEdges = 0;
    for (const document of graphDocuments) {
        const references = extractDocumentReferences(document.path, contentByDocument.get(document.path) || '', documentSet);
        for (const target of references) {
            edges.push({ source: `doc:${document.path}`, target: `doc:${target}`, type: 'depends' });
            dependencyEdges += 1;
            if (dependencyEdges >= 1200) break;
        }
        if (dependencyEdges >= 1200) break;
    }

    const value = {
        status,
        nodes,
        edges,
        stats: {
            groups: groupCounts.size + 1,
            documents: documents.length,
            chunks: status.chunkCount,
            dependencyEdges,
            ...assets.stats
        }
    };
    graphCaches.set(tenantId, { key: cacheKey, value, createdAt: Date.now() });
    reportProgress(onProgress, 100, 'complete', '图谱已就绪', 'Graph is ready');
    return value;
}

async function getDocumentDetails(documentPath) {
    await ensureReady();
    const safePath = String(documentPath || '').trim();
    if (!safePath || safePath.includes('..')) return null;
    const document = await get(
        `SELECT path, size_bytes, mtime_ms, chunk_count, indexed_at
         FROM ai_knowledge_documents WHERE path = ?`,
        [safePath]
    );
    if (!document) return null;
    const chunks = await all(
        `SELECT chunk_index, title, start_line, end_line, content
         FROM ai_knowledge_chunks
         WHERE document_path = ?
         ORDER BY chunk_index ASC
         LIMIT 12`,
        [safePath]
    );
    return {
        ...document,
        group: groupForDocument(safePath),
        chunks: chunks.map(chunk => ({ ...chunk, content: String(chunk.content || '').slice(0, 900) }))
    };
}

async function getDocumentAnalysisContent(documentPath, { startLine, endLine } = {}) {
    await ensureReady();
    const safePath = String(documentPath || '').trim();
    if (!safePath || safePath.includes('..') || path.isAbsolute(safePath)) return null;
    const document = await get(
        `SELECT path, size_bytes, mtime_ms, chunk_count, indexed_at
         FROM ai_knowledge_documents WHERE path = ?`,
        [safePath]
    );
    if (!document) return null;
    const resolvedPath = path.resolve(PROJECT_ROOT, safePath);
    if (!resolvedPath.startsWith(PROJECT_ROOT + path.sep) || !fs.existsSync(resolvedPath)) return null;
    const fullSource = fs.readFileSync(resolvedPath, 'utf8');
    const firstLine = Math.max(1, Number.parseInt(startLine, 10) || 1);
    const lastLine = Math.max(firstLine, Number.parseInt(endLine, 10) || firstLine);
    const hasLineRange = startLine !== undefined || endLine !== undefined;
    const selectedRawSource = hasLineRange
        ? fullSource.split(/\r?\n/).slice(firstLine - 1, lastLine).join('\n')
        : fullSource;
    const selectedSource = redactSensitiveText(selectedRawSource);
    const content = selectedSource.slice(0, MAX_ANALYSIS_CONTENT_CHARS);
    return {
        ...document,
        content,
        content_chars: selectedSource.length,
        included_chars: content.length,
        truncated: content.length < selectedSource.length,
        start_line: hasLineRange ? firstLine : null,
        end_line: hasLineRange ? lastLine : null,
        max_analysis_chars: MAX_ANALYSIS_CONTENT_CHARS
    };
}

function formatResultsForPrompt(results) {
    if (!results.length) return '未检索到相关项目文档或代码片段。';
    return results.map((item, index) => [
        `[项目知识 ${index + 1}] ${item.document_path}:${item.start_line}-${item.end_line}`,
        `主题: ${item.title}`,
        item.content
    ].join('\n')).join('\n\n---\n\n');
}

module.exports = {
    PROJECT_ROOT,
    get KNOWLEDGE_DB_PATH() { return getKnowledgeDbPath(); },
    ensureReady,
    refreshIndex,
    search,
    getStatus,
    getGraph,
    getDocumentDetails,
    getDocumentAnalysisContent,
    formatResultsForPrompt,
    extractSearchTerms,
    chunkDocument,
    collapseToolAssetFiles,
    closeDatabase
};
