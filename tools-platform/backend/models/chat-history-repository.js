const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const tenantPool = require('./tenant-sqlite-pool');
const { isPinyinQuery, pinyinMatches } = require('./chat-pinyin-search');

const DB_FILENAME = 'chat-history.db';
const PARSER_VERSION = 2;
const GROUP_PERSONA_STYLES = new Set(['operations', 'team', 'pets', 'dessert', 'energy', 'nature']);
const LEGACY_TEST_SOURCE_SIGNATURES = [
    ['聊天记录/单聊/技术研发部/李工-后端开发.txt', '%Release Tag v1.0.193%'],
    ['聊天记录/单聊/产品设计部/王经理-产品总监.txt', '%合规自查与上线排期表%'],
    ['聊天记录/群组/移动端隐私政策合规专项群.txt', '%privacy.example.com/compliance/app-policy-v2.1.pdf%'],
    ['聊天记录/群组/微服务核心架构攻坚群.txt', '%Grafana 大盘%'],
    ['聊天记录/讨论组/线上生产事故排查紧急讨论组.txt', '%504 Gateway Timeout%'],
    ['聊天记录/历史归档/2026年Q2技术方案研讨纪要.txt', '%tenant-sqlite-pool%']
];
const HEADER_WITH_ID_RE = /^(.+?)[([（]([^()（）[\]]+)[)\]）]\s+(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})$/;
const HEADER_WITHOUT_ID_RE = /^(.+?)\s+(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})$/;
const DEFAULT_PARSER_EXCLUSION_RULES = [
    { id: 1, name: '网管脚本 +++ 标记', match_type: 'regex', pattern: '^[\\s\\u200B-\\u200D\\uFEFF]*\\+{3}' },
    { id: 2, name: '网管脚本 MEID 注释', match_type: 'contains', pattern: '/*MEID:' },
    { id: 3, name: '网管脚本 MENAME 字段', match_type: 'contains', pattern: 'MENAME:' },
    { id: 4, name: '工单关闭日期赋值行', match_type: 'regex', pattern: '^\\s*ticket\\s+close\\s+due\\s+date\\s*=' }
];
const readyByPath = new Map();
const ftsByPath = new Map();
const importQueues = new Map();
const initializationByPath = new Map();
const maintenanceByPath = new Map();
const operationByPath = new Map();
const ftsMaintenanceTimers = new Map();

function statusRecord(phase, progress, message, extra = {}) {
    return { phase, progress, message, updatedAt: new Date().toISOString(), ...extra };
}

function setInitialization(filePath, phase, progress, message, extra) {
    const previous = initializationByPath.get(filePath);
    const startedAt = previous && !['ready', 'error'].includes(previous.phase) ? previous.startedAt : new Date().toISOString();
    initializationByPath.set(filePath, statusRecord(phase, progress, message, { startedAt, ...extra }));
}

function setMaintenance(filePath, phase, progress, message, extra) {
    const previous = maintenanceByPath.get(filePath);
    const willBeActive = extra?.active === true;
    const startedAt = willBeActive && previous?.active === true ? previous.startedAt : new Date().toISOString();
    maintenanceByPath.set(filePath, statusRecord(phase, progress, message, { startedAt, ...extra }));
}

function setOperation(filePath, type, phase, progress, message, extra) {
    const previous = operationByPath.get(filePath);
    const startedAt = previous?.type === type && previous?.active !== false ? previous.startedAt : new Date().toISOString();
    operationByPath.set(filePath, statusRecord(phase, progress, message, { type, startedAt, ...extra }));
}

function finishOperation(filePath, type, message = '处理完成') {
    const current = operationByPath.get(filePath);
    if (!current || current.type !== type) return;
    const durationMs = Math.max(0, Date.now() - new Date(current.startedAt || Date.now()).getTime());
    operationByPath.set(filePath, statusRecord('complete', 100, message, { type, active: false, durationMs }));
    console.log(`[chat-history] ${type} completed in ${durationMs}ms`);
}

function failOperation(filePath, type, error) {
    const current = operationByPath.get(filePath);
    const durationMs = Math.max(0, Date.now() - new Date(current?.startedAt || Date.now()).getTime());
    operationByPath.set(filePath, statusRecord('error', null, error.message || String(error), {
        type,
        active: false,
        durationMs,
        error: error.message || String(error)
    }));
    console.error(`[chat-history] ${type} failed after ${durationMs}ms: ${error.message || error}`);
}

function dbPath() {
    return tenantPool.databasePath(DB_FILENAME);
}

function db() {
    return tenantPool.getConnection(DB_FILENAME);
}

function run(sql, params = []) {
    const connection = db();
    return new Promise((resolve, reject) => connection.run(sql, params, function onRun(error) {
        error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
    }));
}

function get(sql, params = []) {
    const connection = db();
    return new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function all(sql, params = []) {
    const connection = db();
    return new Promise((resolve, reject) => connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

function runOn(connection, sql, params = []) {
    return new Promise((resolve, reject) => connection.run(sql, params, function onRun(error) {
        error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
    }));
}

function getOn(connection, sql, params = []) {
    return new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}

function closeConnection(connection) {
    return new Promise(resolve => connection.close(() => resolve()));
}

function getServiceStatus() {
    const filePath = dbPath();
    const initialization = initializationByPath.get(filePath) || statusRecord('idle', 0, '等待首次读取');
    const maintenance = maintenanceByPath.get(filePath) || statusRecord('idle', 0, '全文索引尚未检查');
    const operation = operationByPath.get(filePath) || null;
    let database = { exists: false, size: 0, walSize: 0 };
    try {
        database = {
            exists: fs.existsSync(filePath),
            size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
            walSize: fs.existsSync(`${filePath}-wal`) ? fs.statSync(`${filePath}-wal`).size : 0
        };
    } catch (_error) {}
    return {
        ready: initialization.phase === 'ready',
        ftsAvailable: ftsByPath.get(filePath) === true,
        initialization,
        maintenance,
        operation,
        database
    };
}

async function maintainFtsIndex(filePath) {
    ftsMaintenanceTimers.delete(filePath);
    if (!fs.existsSync(filePath)) return;
    const connection = new sqlite3.Database(filePath);
    connection.configure('busyTimeout', 5000);
    const startedAt = Date.now();
    console.log(`[chat-history] Background database/index diagnosis started for ${path.basename(filePath)}`);
    try {
        setMaintenance(filePath, 'query-index', 3, '正在后台优化聊天关系查询索引', { active: true });
        await runOn(connection, 'CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_sender ON chat_messages(conversation_id, sender_id, sender_name)');
        setMaintenance(filePath, 'checking', 5, '正在核对全文索引数量', { active: true });
        const counts = await getOn(connection, `SELECT
            (SELECT COUNT(*) FROM chat_messages) AS message_count,
            (SELECT COUNT(*) FROM chat_messages_fts) AS fts_count,
            (SELECT COALESCE(MAX(id),0) FROM chat_messages) AS max_message_id`);
        const messageCount = Number(counts && counts.message_count || 0);
        const ftsCount = Number(counts && counts.fts_count || 0);
        if (messageCount === ftsCount) {
            ftsByPath.set(filePath, true);
            setMaintenance(filePath, 'ready', 100, `全文索引正常（${messageCount} 条）`, { active: false, messageCount, ftsCount });
            console.log(`[chat-history] Background index check completed in ${Date.now() - startedAt}ms; ${messageCount} rows are consistent`);
            return;
        }

        ftsByPath.set(filePath, false);
        setMaintenance(filePath, 'rebuilding', 10, `发现索引不完整，正在自动重建（0/${messageCount}）`, {
            active: true, messageCount, ftsCount
        });
        await runOn(connection, 'DROP TABLE IF EXISTS chat_messages_fts');
        await runOn(connection, `CREATE VIRTUAL TABLE chat_messages_fts USING fts5(
            message_id UNINDEXED,
            conversation_id UNINDEXED,
            sender_name,
            sender_id,
            content,
            tokenize='trigram'
        )`);
        const maxId = Number(counts && counts.max_message_id || 0);
        const batchSize = 5000;
        let cursor = 0;
        while (cursor < maxId) {
            const upper = Math.min(maxId, cursor + batchSize);
            await runOn(connection, `INSERT INTO chat_messages_fts(message_id,conversation_id,sender_name,sender_id,content)
                SELECT id,conversation_id,sender_name,sender_id,content FROM chat_messages
                WHERE id>? AND id<=? ORDER BY id`, [cursor, upper]);
            cursor = upper;
            const progress = maxId ? 10 + Math.round((cursor / maxId) * 85) : 95;
            setMaintenance(filePath, 'rebuilding', progress, `正在分批重建全文索引（索引 ID ${cursor}/${maxId}）`, {
                active: true, messageCount, previousFtsCount: ftsCount
            });
            await new Promise(resolve => setImmediate(resolve));
        }
        const finalCounts = await getOn(connection, `SELECT
            (SELECT COUNT(*) FROM chat_messages) AS message_count,
            (SELECT COUNT(*) FROM chat_messages_fts) AS fts_count`);
        const complete = Number(finalCounts.message_count) === Number(finalCounts.fts_count);
        ftsByPath.set(filePath, complete);
        setMaintenance(filePath, complete ? 'ready' : 'pending', complete ? 100 : 95,
            complete ? `全文索引已自动修复（${finalCounts.message_count} 条）` : '重建期间数据发生变化，稍后将再次核对',
            { active: false, messageCount: Number(finalCounts.message_count), ftsCount: Number(finalCounts.fts_count) });
        console.log(`[chat-history] Background index rebuild finished in ${Date.now() - startedAt}ms; complete=${complete}`);
        if (!complete) scheduleFtsMaintenance(filePath, 30000);
    } catch (error) {
        ftsByPath.set(filePath, false);
        setMaintenance(filePath, 'error', null, `全文索引自动诊断失败：${error.message}`, {
            active: false, error: error.message
        });
        console.warn(`[chat-history] FTS maintenance failed for ${path.basename(filePath)}: ${error.message}`);
    } finally {
        await closeConnection(connection);
    }
}

function scheduleFtsMaintenance(filePath, delayMs = 30000) {
    if (ftsMaintenanceTimers.has(filePath)) return;
    setMaintenance(filePath, 'scheduled', 0, '全文索引将在后台自动核对', { active: false });
    const timer = setTimeout(() => void maintainFtsIndex(filePath), delayMs);
    if (typeof timer.unref === 'function') timer.unref();
    ftsMaintenanceTimers.set(filePath, timer);
}

function cleanInline(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeRelativePath(value) {
    const normalized = String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
    if (!normalized || !/\.txt$/i.test(normalized)) throw new Error('仅支持导入 TXT 聊天文件');
    return normalized.slice(0, 1000);
}

function classifyConversation(relativePath) {
    const parts = String(relativePath || '').replace(/\\/g, '/').split('/');
    const directories = parts.slice(0, -1).map(item => cleanInline(item).toLowerCase());
    if (directories.some(item => ['联系人', '单聊', 'contact', 'contacts', 'single', 'direct'].includes(item))) return 'single';
    if (directories.some(item => ['固定群', '群组', '群聊', 'group', 'groups'].includes(item))) return 'group';
    if (directories.some(item => ['讨论组', 'discussion', 'discussions'].includes(item))) return 'discussion';
    return 'other';
}

async function reclassifyStoredConversations() {
    const rows = await all(`SELECT c.id,c.conversation_type,s.relative_path
        FROM chat_conversations c JOIN chat_sources s ON s.id=c.source_id`);
    const updates = rows
        .map(row => ({ id: row.id, type: classifyConversation(row.relative_path), previousType: row.conversation_type }))
        .filter(row => row.type !== row.previousType);
    if (!updates.length) return 0;

    await run('BEGIN IMMEDIATE');
    try {
        for (const item of updates) {
            await run('UPDATE chat_conversations SET conversation_type=? WHERE id=?', [item.type, item.id]);
        }
        await run('COMMIT');
        return updates.length;
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        throw error;
    }
}

function displayNameFromPath(relativePath) {
    return cleanInline(path.posix.basename(relativePath).replace(/\.txt$/i, '')) || '未命名会话';
}

function digest(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function placeholders(count) {
    return Array.from({ length: count }, () => '?').join(',');
}

async function ensureColumn(tableName, columnName, definition) {
    const columns = await all(`PRAGMA table_info(${tableName})`);
    if (!columns.some(column => column.name === columnName)) {
        await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

async function ensureReady() {
    const filePath = dbPath();
    if (!readyByPath.has(filePath)) {
        readyByPath.set(filePath, (async () => {
            const startedAt = Date.now();
            console.log(`[chat-history] Database initialization started for ${path.basename(filePath)}`);
            const connection = db();
            connection.configure('busyTimeout', 5000);
            setInitialization(filePath, 'connecting', 5, '正在打开聊天数据库');
            await run('PRAGMA busy_timeout = 10000');
            setInitialization(filePath, 'journal', 12, '正在恢复 SQLite 日志并启用 WAL');
            await run('PRAGMA journal_mode = WAL');
            await run('PRAGMA foreign_keys = ON');
            setInitialization(filePath, 'schema', 22, '正在检查聊天数据表');
            await run(`CREATE TABLE IF NOT EXISTS chat_sources (
                id TEXT PRIMARY KEY,
                relative_path TEXT NOT NULL UNIQUE,
                source_hash TEXT NOT NULL DEFAULT '',
                file_size INTEGER NOT NULL DEFAULT 0,
                modified_at INTEGER NOT NULL DEFAULT 0,
                imported_at TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0
            )`);
            await ensureColumn('chat_sources', 'parser_signature', "TEXT NOT NULL DEFAULT ''");
            await ensureColumn('chat_sources', 'data_kind', "TEXT NOT NULL DEFAULT 'imported'");
            await run(`CREATE TABLE IF NOT EXISTS chat_conversations (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                conversation_type TEXT NOT NULL DEFAULT 'other',
                last_message TEXT,
                last_message_time TEXT,
                first_message_time TEXT,
                message_count INTEGER NOT NULL DEFAULT 0,
                participant_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(source_id) REFERENCES chat_sources(id) ON DELETE CASCADE
            )`);
            await run(`CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL,
                stable_key TEXT NOT NULL UNIQUE,
                sender_name TEXT NOT NULL DEFAULT '',
                sender_id TEXT NOT NULL DEFAULT '',
                message_time TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
                UNIQUE(conversation_id, ordinal)
            )`);
            await run(`CREATE TABLE IF NOT EXISTS chat_user_settings (
                user_id TEXT PRIMARY KEY,
                my_sender_id TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            )`);
            await run(`CREATE TABLE IF NOT EXISTS chat_user_states (
                user_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
                last_read_time TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(user_id, conversation_id),
                FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
            )`);
            await run(`CREATE TABLE IF NOT EXISTS chat_group_preferences (
                conversation_id TEXT PRIMARY KEY,
                persona_style TEXT NOT NULL DEFAULT 'operations',
                updated_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
            )`);
            await run(`CREATE TABLE IF NOT EXISTS chat_analytics_state (
                id INTEGER PRIMARY KEY CHECK(id=1),
                data_version INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            )`);
            await run(`CREATE TABLE IF NOT EXISTS chat_analytics_cache (
                cache_key TEXT PRIMARY KEY,
                data_version INTEGER NOT NULL,
                payload_json TEXT NOT NULL,
                generated_at TEXT NOT NULL
            )`);
            await run(`INSERT OR IGNORE INTO chat_analytics_state(id,data_version,updated_at)
                VALUES(1,1,?)`, [new Date().toISOString()]);
            await run('CREATE INDEX IF NOT EXISTS idx_chat_analytics_cache_version ON chat_analytics_cache(data_version)');
            await run(`CREATE TABLE IF NOT EXISTS chat_favorites (
                user_id TEXT NOT NULL,
                message_stable_key TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(user_id, message_stable_key)
            )`);
            await run(`CREATE TABLE IF NOT EXISTS chat_person_directory (
                sender_id TEXT PRIMARY KEY,
                sender_name TEXT NOT NULL,
                alias_names TEXT NOT NULL DEFAULT '',
                message_count INTEGER NOT NULL DEFAULT 0,
                conversation_count INTEGER NOT NULL DEFAULT 0,
                first_seen_at TEXT,
                last_seen_at TEXT,
                updated_at TEXT NOT NULL
            )`);
            await run(`CREATE TABLE IF NOT EXISTS chat_parser_exclusion_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                match_type TEXT NOT NULL CHECK(match_type IN ('contains','prefix','exact','regex')),
                pattern TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
                is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            )`);
            const seedTime = new Date().toISOString();
            for (const rule of DEFAULT_PARSER_EXCLUSION_RULES) {
                await run(`INSERT OR IGNORE INTO chat_parser_exclusion_rules(
                    id,name,match_type,pattern,enabled,is_default,created_at,updated_at
                ) VALUES(?,?,?,?,1,1,?,?)`, [rule.id, rule.name, rule.match_type, rule.pattern, seedTime, seedTime]);
            }
            await run('CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_time ON chat_messages(conversation_id, message_time, id)');
            await run('CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id, sender_name)');
            setInitialization(filePath, 'indexes', 65, '正在检查基础查询索引');
            await run('CREATE INDEX IF NOT EXISTS idx_chat_messages_time ON chat_messages(message_time, id)');
            await run('CREATE INDEX IF NOT EXISTS idx_chat_conversations_type_time ON chat_conversations(conversation_type, last_message_time)');
            await run('CREATE INDEX IF NOT EXISTS idx_chat_person_directory_name ON chat_person_directory(sender_name)');
            await reclassifyStoredConversations();
            try {
                setInitialization(filePath, 'fts-schema', 85, '正在检查全文索引结构');
                const row = await get("SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_messages_fts'");
                if (row && !String(row.sql || '').toLowerCase().includes('trigram')) await run('DROP TABLE chat_messages_fts');
                await run(`CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
                    message_id UNINDEXED,
                    conversation_id UNINDEXED,
                    sender_name,
                    sender_id,
                    content,
                    tokenize='trigram'
                )`);
            } catch (error) {
                console.warn(`[chat-history] FTS5 trigram unavailable, using LIKE search: ${error.message}`);
                setMaintenance(filePath, 'error', null, `FTS5 全文索引不可用：${error.message}`, {
                    active: false,
                    error: error.message
                });
            }
            // Until the background count check completes, LIKE search is slower but
            // guaranteed complete even when a previous process stopped mid-import.
            ftsByPath.set(filePath, false);
            setInitialization(filePath, 'ready', 100, '聊天记录服务已就绪', { active: false });
            console.log(`[chat-history] Database initialization completed in ${Date.now() - startedAt}ms`);
            if (maintenanceByPath.get(filePath)?.phase !== 'error') scheduleFtsMaintenance(filePath);
        })().catch(error => {
            readyByPath.delete(filePath);
            setInitialization(filePath, 'error', null, `聊天数据库初始化失败：${error.message}`, {
                active: false,
                error: error.message
            });
            throw error;
        }));
    }
    return readyByPath.get(filePath);
}

async function analyticsDataVersion() {
    const row = await get('SELECT data_version FROM chat_analytics_state WHERE id=1');
    return Number(row && row.data_version || 1);
}

async function cachedAnalyticsResult(cacheKey, producer) {
    const version = await analyticsDataVersion();
    const row = await get(`SELECT payload_json,generated_at FROM chat_analytics_cache
        WHERE cache_key=? AND data_version=?`, [cacheKey, version]);
    if (row) {
        try {
            return {
                ...JSON.parse(row.payload_json),
                analyticsCache: { hit: true, dataVersion: version, generatedAt: row.generated_at }
            };
        } catch (_error) {
            await run('DELETE FROM chat_analytics_cache WHERE cache_key=?', [cacheKey]);
        }
    }

    const payload = await producer();
    const generatedAt = new Date().toISOString();
    await run(`INSERT INTO chat_analytics_cache(cache_key,data_version,payload_json,generated_at)
        VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET
        data_version=excluded.data_version,payload_json=excluded.payload_json,generated_at=excluded.generated_at`, [
        cacheKey,
        version,
        JSON.stringify(payload),
        generatedAt
    ]);
    return { ...payload, analyticsCache: { hit: false, dataVersion: version, generatedAt } };
}

async function invalidateAnalyticsCache() {
    await ensureReady();
    const now = new Date().toISOString();
    await run(`UPDATE chat_analytics_state SET data_version=data_version+1,updated_at=? WHERE id=1`, [now]);
    await run('DELETE FROM chat_analytics_cache');
    return { dataVersion: await analyticsDataVersion(), invalidatedAt: now };
}

function isFtsAvailable() {
    return ftsByPath.get(dbPath()) === true;
}

function withImportQueue(task) {
    const key = dbPath();
    const previous = importQueues.get(key) || Promise.resolve();
    const operation = previous.then(task, task);
    const tracked = operation.catch(() => {});
    importQueues.set(key, tracked);
    return operation.finally(() => {
        if (importQueues.get(key) === tracked) importQueues.delete(key);
    });
}

function ruleMatchesLine(line, rule) {
    const text = String(line || '');
    const pattern = String(rule && rule.pattern || '');
    if (!pattern) return false;
    const normalizedText = text.toLocaleLowerCase();
    const normalizedPattern = pattern.toLocaleLowerCase();
    if (rule.match_type === 'contains') return normalizedText.includes(normalizedPattern);
    if (rule.match_type === 'prefix') return normalizedText.trimStart().startsWith(normalizedPattern);
    if (rule.match_type === 'exact') return normalizedText.trim() === normalizedPattern.trim();
    if (rule.match_type === 'regex') {
        try {
            return new RegExp(pattern, 'iu').test(text.slice(0, 4000));
        } catch (_error) {
            return false;
        }
    }
    return false;
}

function isExcludedHeaderLine(line, rules = DEFAULT_PARSER_EXCLUSION_RULES) {
    return (Array.isArray(rules) ? rules : []).some(rule => rule.enabled !== 0 && ruleMatchesLine(line, rule));
}

function parseHeader(line, exclusionRules = DEFAULT_PARSER_EXCLUSION_RULES) {
    const text = String(line || '').trim();
    if (!text) return null;
    if (isExcludedHeaderLine(text, exclusionRules)) return null;
    const withIdMatch = HEADER_WITH_ID_RE.exec(text);
    if (withIdMatch) {
        return {
            senderName: cleanInline(withIdMatch[1]),
            senderId: cleanInline(withIdMatch[2]),
            messageTime: withIdMatch[3]
        };
    }
    const withoutIdMatch = HEADER_WITHOUT_ID_RE.exec(text);
    if (withoutIdMatch) {
        const senderName = cleanInline(withoutIdMatch[1]);
        if (!senderName) return null;
        return {
            senderName,
            senderId: '',
            messageTime: withoutIdMatch[2]
        };
    }
    return null;
}

function normalizeParserRule(payload = {}) {
    const name = cleanInline(payload.name).slice(0, 120);
    const matchType = String(payload.matchType || payload.match_type || '').trim();
    const pattern = String(payload.pattern || '').trim().slice(0, 500);
    if (!name) throw new Error('规则名称不能为空');
    if (!['contains', 'prefix', 'exact', 'regex'].includes(matchType)) throw new Error('匹配方式无效');
    if (!pattern) throw new Error('匹配内容不能为空');
    if (matchType === 'regex') {
        try {
            new RegExp(pattern, 'iu');
        } catch (_error) {
            throw new Error('正则表达式无效');
        }
    }
    return { name, matchType, pattern, enabled: payload.enabled !== false && payload.enabled !== 0 };
}

async function listParserExclusionRules(options = {}) {
    await ensureReady();
    const includeDisabled = options.includeDisabled !== false;
    const enabledClause = includeDisabled ? '' : 'AND enabled=1';
    return all(`SELECT id,name,match_type,pattern,enabled,is_default,created_at,updated_at
        FROM chat_parser_exclusion_rules WHERE deleted_at IS NULL ${enabledClause}
        ORDER BY is_default DESC,id ASC`);
}

async function createParserExclusionRule(payload = {}) {
    await ensureReady();
    const rule = normalizeParserRule(payload);
    const now = new Date().toISOString();
    const result = await run(`INSERT INTO chat_parser_exclusion_rules(
        name,match_type,pattern,enabled,is_default,created_at,updated_at
    ) VALUES(?,?,?,?,0,?,?)`, [rule.name, rule.matchType, rule.pattern, rule.enabled ? 1 : 0, now, now]);
    return get(`SELECT id,name,match_type,pattern,enabled,is_default,created_at,updated_at
        FROM chat_parser_exclusion_rules WHERE id=?`, [result.lastID]);
}

async function updateParserExclusionRule(ruleId, payload = {}) {
    await ensureReady();
    const existing = await get('SELECT * FROM chat_parser_exclusion_rules WHERE id=? AND deleted_at IS NULL', [ruleId]);
    if (!existing) return null;
    const rule = normalizeParserRule({
        name: payload.name !== undefined ? payload.name : existing.name,
        matchType: payload.matchType !== undefined ? payload.matchType : existing.match_type,
        pattern: payload.pattern !== undefined ? payload.pattern : existing.pattern,
        enabled: payload.enabled !== undefined ? payload.enabled : Boolean(existing.enabled)
    });
    const now = new Date().toISOString();
    await run(`UPDATE chat_parser_exclusion_rules SET name=?,match_type=?,pattern=?,enabled=?,updated_at=?
        WHERE id=?`, [rule.name, rule.matchType, rule.pattern, rule.enabled ? 1 : 0, now, ruleId]);
    return get(`SELECT id,name,match_type,pattern,enabled,is_default,created_at,updated_at
        FROM chat_parser_exclusion_rules WHERE id=?`, [ruleId]);
}

async function deleteParserExclusionRule(ruleId) {
    await ensureReady();
    const now = new Date().toISOString();
    const result = await run(`UPDATE chat_parser_exclusion_rules SET enabled=0,deleted_at=?,updated_at=?
        WHERE id=? AND deleted_at IS NULL`, [now, now, ruleId]);
    return result.changes ? { id: Number(ruleId), deletedAt: now } : null;
}

function parserSignature(rules) {
    const activeRules = (rules || [])
        .filter(rule => rule.enabled !== 0)
        .map(rule => [rule.match_type, rule.pattern]);
    return digest(JSON.stringify({ version: PARSER_VERSION, rules: activeRules }));
}

async function insertMessageBatch(rows) {
    if (!rows.length) return;
    const values = rows.map(() => '(?,?,?,?,?,?,?)').join(',');
    const params = rows.flatMap(row => [
        row.conversationId,
        row.ordinal,
        row.stableKey,
        row.senderName,
        row.senderId,
        row.messageTime,
        row.content
    ]);
    await run(`INSERT INTO chat_messages(
        conversation_id,ordinal,stable_key,sender_name,sender_id,message_time,content
    ) VALUES ${values}`, params);
}

async function importTxtFile(input) {
    await ensureReady();
    const exclusionRules = await listParserExclusionRules({ includeDisabled: false });
    const currentParserSignature = parserSignature(exclusionRules);
    const relativePath = normalizeRelativePath(input.relativePath || input.originalName);
    const dataKind = input.dataKind === 'test' || /^(?:测试数据|test_data)\//i.test(relativePath) ? 'test' : 'imported';
    const stat = fs.statSync(input.filePath);
    const sourceHash = await new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(input.filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
    const existing = await get('SELECT id,source_hash,parser_signature,data_kind FROM chat_sources WHERE relative_path=?', [relativePath]);
    if (existing && existing.source_hash === sourceHash && existing.parser_signature === currentParserSignature) {
        if (existing.data_kind !== dataKind) {
            await run('UPDATE chat_sources SET data_kind=? WHERE id=?', [dataKind, existing.id]);
        }
        const conversation = await get('SELECT id,message_count FROM chat_conversations WHERE source_id=?', [existing.id]);
        return { relativePath, skipped: true, conversationId: conversation && conversation.id, messageCount: Number(conversation && conversation.message_count || 0) };
    }

    return withImportQueue(async () => {
        const now = new Date().toISOString();
        const sourceId = existing ? existing.id : `src_${digest(relativePath).slice(0, 24)}`;
        const conversationId = `chat_${digest(relativePath).slice(0, 24)}`;
        const conversationType = classifyConversation(relativePath);
        const displayName = displayNameFromPath(relativePath);
        const duplicateOccurrences = new Map();
        let ordinal = 0;
        let current = null;
        let batch = [];

        await run('BEGIN IMMEDIATE');
        try {
            await run(`INSERT INTO chat_sources(id,relative_path,source_hash,file_size,modified_at,imported_at,message_count,parser_signature,data_kind)
                VALUES(?,?,?,?,?,?,0,?,?)
                ON CONFLICT(relative_path) DO UPDATE SET
                    source_hash=excluded.source_hash,
                    file_size=excluded.file_size,
                    modified_at=excluded.modified_at,
                    imported_at=excluded.imported_at,
                    parser_signature=excluded.parser_signature,
                    data_kind=excluded.data_kind`, [
                sourceId,
                relativePath,
                sourceHash,
                stat.size,
                Number(input.modifiedAt || stat.mtimeMs || 0),
                now,
                currentParserSignature,
                dataKind
            ]);
            await run(`INSERT INTO chat_conversations(
                id,source_id,display_name,conversation_type,updated_at
            ) VALUES(?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                display_name=excluded.display_name,
                conversation_type=excluded.conversation_type,
                updated_at=excluded.updated_at`, [conversationId, sourceId, displayName, conversationType, now]);

            if (isFtsAvailable()) await run('DELETE FROM chat_messages_fts WHERE conversation_id=?', [conversationId]);
            await run('DELETE FROM chat_messages WHERE conversation_id=?', [conversationId]);

            const flushCurrent = async () => {
                if (!current) return;
                ordinal += 1;
                const content = current.lines.join('\n').replace(/[\r\n]+$/, '');
                const baseKey = digest([relativePath, current.senderName, current.senderId, current.messageTime, content].join('\0'));
                const occurrence = (duplicateOccurrences.get(baseKey) || 0) + 1;
                duplicateOccurrences.set(baseKey, occurrence);
                batch.push({
                    conversationId,
                    ordinal,
                    stableKey: `${baseKey}:${occurrence}`,
                    senderName: current.senderName,
                    senderId: current.senderId,
                    messageTime: current.messageTime,
                    content
                });
                if (batch.length >= 100) {
                    await insertMessageBatch(batch);
                    batch = [];
                }
            };

            const source = fs.createReadStream(input.filePath, { encoding: 'utf8' });
            let firstLine = true;
            const lines = readline.createInterface({ input: source, crlfDelay: Infinity });
            for await (let line of lines) {
                if (firstLine) {
                    line = line.replace(/^\uFEFF/, '');
                    firstLine = false;
                }
                const header = parseHeader(line, exclusionRules);
                if (header) {
                    await flushCurrent();
                    current = { ...header, lines: [] };
                } else if (current) {
                    current.lines.push(line);
                }
            }
            await flushCurrent();
            await insertMessageBatch(batch);

            if (isFtsAvailable()) {
                await run(`INSERT INTO chat_messages_fts(message_id,conversation_id,sender_name,sender_id,content)
                    SELECT id,conversation_id,sender_name,sender_id,content
                    FROM chat_messages WHERE conversation_id=?`, [conversationId]);
            }
            const summary = await get(`SELECT
                COUNT(*) AS message_count,
                COUNT(DISTINCT CASE WHEN sender_id<>'' THEN sender_id ELSE sender_name END) AS participant_count,
                MIN(message_time) AS first_message_time,
                MAX(message_time) AS last_message_time
                FROM chat_messages WHERE conversation_id=?`, [conversationId]);
            const last = await get(`SELECT content FROM chat_messages
                WHERE conversation_id=? ORDER BY message_time DESC,id DESC LIMIT 1`, [conversationId]);
            await run(`UPDATE chat_conversations SET
                last_message=?,last_message_time=?,first_message_time=?,message_count=?,participant_count=?,updated_at=?
                WHERE id=?`, [
                last && last.content || null,
                summary && summary.last_message_time || null,
                summary && summary.first_message_time || null,
                Number(summary && summary.message_count || 0),
                Number(summary && summary.participant_count || 0),
                now,
                conversationId
            ]);
            await run('UPDATE chat_sources SET message_count=? WHERE id=?', [Number(summary && summary.message_count || 0), sourceId]);
            await run(`DELETE FROM chat_favorites
                WHERE message_stable_key NOT IN (SELECT stable_key FROM chat_messages)`);
            await run('COMMIT');
            await syncPersonDirectory();
            await invalidateAnalyticsCache();
            if (!isFtsAvailable()) scheduleFtsMaintenance(dbPath(), 30000);
            return { relativePath, skipped: false, conversationId, messageCount: ordinal, conversationType };
        } catch (error) {
            await run('ROLLBACK').catch(() => {});
            throw error;
        }
    });
}

async function syncPersonDirectory() {
    await ensureReady();
    const rows = await all(`SELECT
        m.sender_id,
        (SELECT p.sender_name FROM chat_messages p WHERE p.sender_id=m.sender_id AND p.sender_name<>'' GROUP BY p.sender_name ORDER BY COUNT(*) DESC LIMIT 1) AS primary_name,
        GROUP_CONCAT(DISTINCT NULLIF(m.sender_name, '')) AS all_names,
        COUNT(*) AS message_count,
        COUNT(DISTINCT m.conversation_id) AS conversation_count,
        MIN(m.message_time) AS first_seen_at,
        MAX(m.message_time) AS last_seen_at
        FROM chat_messages m
        WHERE m.sender_id<>'' AND m.sender_id IS NOT NULL
        GROUP BY m.sender_id`);

    const now = new Date().toISOString();
    for (const row of rows) {
        const primary = row.primary_name || row.sender_id;
        const aliases = (row.all_names || '')
            .split(',')
            .map(s => s.trim())
            .filter(s => s && s !== primary)
            .join(' / ');

        await run(`INSERT INTO chat_person_directory(
            sender_id, sender_name, alias_names, message_count, conversation_count, first_seen_at, last_seen_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(sender_id) DO UPDATE SET
            sender_name=CASE WHEN chat_person_directory.sender_name<>'' THEN chat_person_directory.sender_name ELSE excluded.sender_name END,
            alias_names=excluded.alias_names,
            message_count=excluded.message_count,
            conversation_count=excluded.conversation_count,
            first_seen_at=excluded.first_seen_at,
            last_seen_at=excluded.last_seen_at,
            updated_at=excluded.updated_at`, [
            row.sender_id,
            primary,
            aliases,
            Number(row.message_count || 0),
            Number(row.conversation_count || 0),
            row.first_seen_at,
            row.last_seen_at,
            now
        ]);
    }
    await run(`DELETE FROM chat_person_directory WHERE sender_id NOT IN (SELECT DISTINCT sender_id FROM chat_messages WHERE sender_id<>'')`);
}

async function listPersonDirectory(options = {}) {
    await ensureReady();
    const q = String(options.q || '').trim();
    const limit = parsePositiveInt(options.limit, 100, 10000);
    const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
    const where = q ? 'WHERE sender_id LIKE ? OR sender_name LIKE ? OR alias_names LIKE ?' : '';
    const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    const items = await all(`SELECT sender_id, sender_name, alias_names, message_count,
        conversation_count, first_seen_at, last_seen_at, updated_at
        FROM chat_person_directory
        ${where}
        ORDER BY message_count DESC, last_seen_at DESC
        LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = await get(`SELECT COUNT(*) AS total FROM chat_person_directory ${where}`, params);
    return { items, total: Number(total && total.total || 0), limit, offset };
}

async function updatePersonDirectory(senderId, payload = {}) {
    await ensureReady();
    const senderName = cleanInline(payload.senderName || '').slice(0, 120);
    const aliasNames = cleanInline(payload.aliasNames || '').slice(0, 200);
    if (!senderName) throw new Error('姓名不能为空');
    const now = new Date().toISOString();
    await run(`UPDATE chat_person_directory SET sender_name=?, alias_names=?, updated_at=? WHERE sender_id=?`, [
        senderName, aliasNames, now, senderId
    ]);
    if (payload.syncMessages !== false) {
        await run(`UPDATE chat_messages SET sender_name=? WHERE sender_id=?`, [senderName, senderId]);
        if (isFtsAvailable()) {
            await run(`UPDATE chat_messages_fts SET sender_name=? WHERE sender_id=?`, [senderName, senderId]);
        }
    }
    await invalidateAnalyticsCache();
    return { senderId, senderName, aliasNames, updatedAt: now };
}

async function getUnidentifiedMessages(options = {}) {
    await ensureReady();
    const limit = parsePositiveInt(options.limit, 100, 300);
    const items = await all(`SELECT m.id, m.conversation_id, c.display_name, c.conversation_type,
        m.sender_name, m.sender_id, m.message_time, m.content, s.relative_path,
        CASE
            WHEN m.sender_name='' AND (m.sender_id='' OR m.sender_id IS NULL) THEN '完全无发送人信息'
            WHEN m.sender_id='' OR m.sender_id IS NULL THEN '缺失工号（仅有昵称）'
            ELSE '异常格式'
        END AS issue_type
        FROM chat_messages m
        JOIN chat_conversations c ON c.id=m.conversation_id
        JOIN chat_sources s ON s.id=c.source_id
        WHERE m.sender_id='' OR m.sender_id IS NULL
        ORDER BY m.message_time DESC, m.id DESC
        LIMIT ?`, [limit]);
    const total = await get(`SELECT COUNT(*) AS total FROM chat_messages WHERE sender_id='' OR sender_id IS NULL`);
    return { items, total: Number(total && total.total || 0) };
}

async function getUserSettings(userId) {
    await ensureReady();
    const row = await get('SELECT my_sender_id,updated_at FROM chat_user_settings WHERE user_id=?', [userId]);
    return row || { my_sender_id: '', updated_at: null };
}

async function saveUserSettings(userId, payload = {}) {
    await ensureReady();
    const senderId = cleanInline(payload.mySenderId).slice(0, 120);
    const now = new Date().toISOString();
    await run(`INSERT INTO chat_user_settings(user_id,my_sender_id,updated_at) VALUES(?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET my_sender_id=excluded.my_sender_id,updated_at=excluded.updated_at`, [userId, senderId, now]);
    return { mySenderId: senderId, updatedAt: now };
}

function parsePositiveInt(value, fallback, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

// 拼音（全拼/首字母）匹配无法用 LIKE 表达，先在内存里筛出命中的会话 ID 再交给 SQL 过滤。
async function findPinyinConversationIds(q) {
    const rows = await all(`SELECT c.id,c.display_name,s.relative_path
        FROM chat_conversations c JOIN chat_sources s ON s.id=c.source_id`);
    return rows.filter(row => pinyinMatches(row.display_name, q) || pinyinMatches(row.relative_path, q)).map(row => row.id);
}

async function listConversations(userId, filters = {}) {
    await ensureReady();
    const limit = parsePositiveInt(filters.limit, 40, 100);
    const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
    const settings = await getUserSettings(userId);
    const conditions = [];
    const params = [userId, settings.my_sender_id || ''];
    if (filters.q) {
        const q = String(filters.q).trim();
        const pinyinIds = isPinyinQuery(q) ? await findPinyinConversationIds(q) : [];
        if (pinyinIds.length) {
            conditions.push('(c.display_name LIKE ? OR s.relative_path LIKE ? OR c.id IN (SELECT value FROM json_each(?)))');
            params.push(`%${q}%`, `%${q}%`, JSON.stringify(pinyinIds));
        } else {
            conditions.push('(c.display_name LIKE ? OR s.relative_path LIKE ?)');
            params.push(`%${q}%`, `%${q}%`);
        }
    }
    if (['single', 'group', 'discussion', 'other'].includes(filters.type)) {
        conditions.push('c.conversation_type=?');
        params.push(filters.type);
    }
    if (filters.pinned === '1') conditions.push('COALESCE(us.pinned,0)=1');
    if (filters.unread === '1') conditions.push(`EXISTS(SELECT 1 FROM chat_messages unread
        WHERE unread.conversation_id=c.id AND unread.sender_id<>?
        AND (us.last_read_time IS NULL OR unread.message_time>us.last_read_time))`), params.push(settings.my_sender_id || '');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await all(`SELECT c.id,c.display_name,c.conversation_type,c.last_message,c.last_message_time,
        c.first_message_time,c.message_count,c.participant_count,s.relative_path,s.imported_at,
        COALESCE(us.pinned,0) AS pinned,us.last_read_time,
        (SELECT COUNT(*) FROM chat_messages unread WHERE unread.conversation_id=c.id
            AND unread.sender_id<>? AND (us.last_read_time IS NULL OR unread.message_time>us.last_read_time)) AS unread_count
        FROM chat_conversations c
        JOIN chat_sources s ON s.id=c.source_id
        LEFT JOIN chat_user_states us ON us.conversation_id=c.id AND us.user_id=?
        ${where}
        ORDER BY COALESCE(us.pinned,0) DESC,c.last_message_time DESC,c.id
        LIMIT ? OFFSET ?`, [settings.my_sender_id || '', userId, ...params.slice(2), limit, offset]);
    const count = await get(`SELECT COUNT(*) AS count FROM chat_conversations c
        JOIN chat_sources s ON s.id=c.source_id
        LEFT JOIN chat_user_states us ON us.conversation_id=c.id AND us.user_id=?
        ${where}`, [userId, ...params.slice(2)]);
    return { items: rows, total: Number(count && count.count || 0), limit, offset, mySenderId: settings.my_sender_id || '' };
}

async function getConversation(conversationId, userId) {
    await ensureReady();
    const row = await get(`SELECT c.*,s.relative_path,s.imported_at,COALESCE(us.pinned,0) AS pinned,us.last_read_time
        FROM chat_conversations c JOIN chat_sources s ON s.id=c.source_id
        LEFT JOIN chat_user_states us ON us.conversation_id=c.id AND us.user_id=?
        WHERE c.id=?`, [userId, conversationId]);
    if (!row) return null;
    row.participants = await all(`SELECT sender_name,sender_id,COUNT(*) AS message_count,
        MIN(message_time) AS first_message_time,MAX(message_time) AS last_message_time
        FROM chat_messages WHERE conversation_id=?
        GROUP BY sender_id,sender_name ORDER BY message_count DESC,sender_name`, [conversationId]);
    return row;
}

async function listMessages(conversationId, userId, options = {}) {
    await ensureReady();
    const limit = parsePositiveInt(options.limit, 80, 200);
    const around = Number.parseInt(options.around, 10);
    if (Number.isFinite(around) && around > 0) {
        const before = await all(`SELECT m.id,m.stable_key,m.sender_name,m.sender_id,m.message_time,m.content,
            CASE WHEN f.message_stable_key IS NULL THEN 0 ELSE 1 END AS favorite
            FROM chat_messages m LEFT JOIN chat_favorites f
                ON f.message_stable_key=m.stable_key AND f.user_id=?
            WHERE m.conversation_id=? AND m.id<=? ORDER BY m.id DESC LIMIT 20`, [userId, conversationId, around]);
        const after = await all(`SELECT m.id,m.stable_key,m.sender_name,m.sender_id,m.message_time,m.content,
            CASE WHEN f.message_stable_key IS NULL THEN 0 ELSE 1 END AS favorite
            FROM chat_messages m LEFT JOIN chat_favorites f
                ON f.message_stable_key=m.stable_key AND f.user_id=?
            WHERE m.conversation_id=? AND m.id>? ORDER BY m.id LIMIT 20`, [userId, conversationId, around]);
        return { items: [...before.reverse(), ...after], nextBefore: null, hasMore: false, focusId: around };
    }
    const conditions = ['m.conversation_id=?'];
    const params = [userId, conversationId];
    if (options.before) {
        conditions.push('m.id<?');
        params.push(Number(options.before));
    }
    const rows = await all(`SELECT m.id,m.stable_key,m.sender_name,m.sender_id,m.message_time,m.content,
        CASE WHEN f.message_stable_key IS NULL THEN 0 ELSE 1 END AS favorite
        FROM chat_messages m LEFT JOIN chat_favorites f
            ON f.message_stable_key=m.stable_key AND f.user_id=?
        WHERE ${conditions.join(' AND ')} ORDER BY m.id DESC LIMIT ?`, [...params, limit + 1]);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).reverse();
    return { items, nextBefore: hasMore && items.length ? items[0].id : null, hasMore };
}

async function markRead(userId, conversationId) {
    await ensureReady();
    const conversation = await get('SELECT last_message_time FROM chat_conversations WHERE id=?', [conversationId]);
    if (!conversation) return null;
    const readTime = conversation.last_message_time || new Date().toISOString();
    const now = new Date().toISOString();
    await run(`INSERT INTO chat_user_states(user_id,conversation_id,pinned,last_read_time,updated_at)
        VALUES(?,?,0,?,?) ON CONFLICT(user_id,conversation_id) DO UPDATE SET
        last_read_time=excluded.last_read_time,updated_at=excluded.updated_at`, [userId, conversationId, readTime, now]);
    return { lastReadTime: readTime };
}

async function setPinned(userId, conversationId, pinned) {
    await ensureReady();
    if (!await get('SELECT 1 FROM chat_conversations WHERE id=?', [conversationId])) return null;
    const now = new Date().toISOString();
    await run(`INSERT INTO chat_user_states(user_id,conversation_id,pinned,last_read_time,updated_at)
        VALUES(?,?,?,NULL,?) ON CONFLICT(user_id,conversation_id) DO UPDATE SET
        pinned=excluded.pinned,updated_at=excluded.updated_at`, [userId, conversationId, pinned ? 1 : 0, now]);
    return { pinned: Boolean(pinned) };
}

async function setFavorite(userId, stableKey, favorite) {
    await ensureReady();
    if (!await get('SELECT 1 FROM chat_messages WHERE stable_key=?', [stableKey])) return null;
    if (favorite) {
        await run('INSERT OR IGNORE INTO chat_favorites(user_id,message_stable_key,created_at) VALUES(?,?,?)', [userId, stableKey, new Date().toISOString()]);
    } else {
        await run('DELETE FROM chat_favorites WHERE user_id=? AND message_stable_key=?', [userId, stableKey]);
    }
    return { favorite: Boolean(favorite) };
}

function safeFtsQuery(keyword) {
    return `"${String(keyword).trim().replace(/"/g, '""')}"`;
}

async function searchMessages(userId, filters = {}) {
    await ensureReady();
    const limit = parsePositiveInt(filters.limit, 50, 200);
    const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
    const settings = await getUserSettings(userId);
    const keyword = String(filters.keyword || '').trim();
    const joins = [
        'JOIN chat_conversations c ON c.id=m.conversation_id',
        'LEFT JOIN chat_favorites f ON f.message_stable_key=m.stable_key AND f.user_id=?'
    ];
    const conditions = [];
    const params = [userId];
    if (keyword) {
        if (isFtsAvailable() && keyword.length >= 3) {
            joins.push('JOIN chat_messages_fts ON chat_messages_fts.message_id=m.id');
            conditions.push('chat_messages_fts MATCH ?');
            params.push(safeFtsQuery(keyword));
        } else {
            conditions.push('m.content LIKE ?');
            params.push(`%${keyword}%`);
        }
    }
    if (filters.sender) {
        conditions.push('(m.sender_name LIKE ? OR m.sender_id LIKE ?)');
        params.push(`%${filters.sender}%`, `%${filters.sender}%`);
    }
    if (filters.senderId) {
        conditions.push('m.sender_id=?');
        params.push(String(filters.senderId));
    } else if (filters.senderName) {
        conditions.push('m.sender_name=?');
        params.push(String(filters.senderName));
    }
    if (filters.conversationId) {
        conditions.push('m.conversation_id=?');
        params.push(filters.conversationId);
    }
    if (['single', 'group', 'discussion', 'other'].includes(filters.type)) {
        conditions.push('c.conversation_type=?');
        params.push(filters.type);
    }
    if (filters.from) {
        conditions.push('m.message_time>=?');
        params.push(`${filters.from} 00:00:00`);
    }
    if (filters.to) {
        conditions.push('m.message_time<=?');
        params.push(`${filters.to} 23:59:59`);
    }
    if (filters.direction === 'mine') {
        conditions.push('m.sender_id=?');
        params.push(settings.my_sender_id || '__not_configured__');
    } else if (filters.direction === 'others') {
        conditions.push('m.sender_id<>?');
        params.push(settings.my_sender_id || '');
    }
    if (filters.favorites === '1') conditions.push('f.message_stable_key IS NOT NULL');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const base = `FROM chat_messages m ${joins.join(' ')} ${where}`;
    const count = await get(`SELECT COUNT(*) AS count ${base}`, params);
    const items = await all(`SELECT m.id,m.stable_key,m.conversation_id,c.display_name,c.conversation_type,
        m.sender_name,m.sender_id,m.message_time,m.content,
        CASE WHEN f.message_stable_key IS NULL THEN 0 ELSE 1 END AS favorite,
        (SELECT p.content FROM chat_messages p WHERE p.conversation_id=m.conversation_id AND p.id<m.id ORDER BY p.id DESC LIMIT 1) AS previous_content,
        (SELECT n.content FROM chat_messages n WHERE n.conversation_id=m.conversation_id AND n.id>m.id ORDER BY n.id LIMIT 1) AS next_content
        ${base} ORDER BY m.message_time DESC,m.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { items, total: Number(count && count.count || 0), limit, offset, ftsAvailable: isFtsAvailable() };
}

async function getOverviewStats(userId) {
    await ensureReady();
    const filePath = dbPath();
    const settings = await getUserSettings(userId);
    const myId = settings.my_sender_id || '__not_configured__';
    const cacheKey = `overview:${digest(`${userId}\0${myId}`).slice(0, 32)}`;
    setOperation(filePath, 'overview', 'cache', 5, '正在检查会话概览缓存', { active: true });
    try {
        const result = await cachedAnalyticsResult(cacheKey, async () => {
    setOperation(filePath, 'overview', 'summary', 15, '正在统计消息总量、识别率和活跃天数', { active: true });
    const summary = await get(`SELECT
        COUNT(*) AS message_count,
        SUM(CASE WHEN sender_id<>'' AND sender_id IS NOT NULL THEN 1 ELSE 0 END) AS identified_messages,
        SUM(CASE WHEN sender_id='' OR sender_id IS NULL THEN 1 ELSE 0 END) AS unidentified_messages,
        COUNT(DISTINCT CASE WHEN sender_id<>'' THEN sender_id ELSE sender_name END) AS participant_count,
        COUNT(DISTINCT CASE WHEN sender_id='' OR sender_id IS NULL THEN sender_name END) AS unidentified_senders_count,
        COUNT(DISTINCT substr(message_time,1,10)) AS active_days,
        SUM(CASE WHEN sender_id=? THEN 1 ELSE 0 END) AS my_messages
        FROM chat_messages`, [myId]);
    setOperation(filePath, 'overview', 'metadata', 48, '正在统计会话、人员映射和收藏', { active: true });
    const metadata = await get(`SELECT
        (SELECT COUNT(*) FROM chat_conversations) AS conversation_count,
        (SELECT COUNT(*) FROM chat_person_directory) AS directory_person_count,
        (SELECT COUNT(*) FROM chat_favorites WHERE user_id=?) AS favorite_count`, [userId]);
    Object.assign(summary, metadata || {});

    const totalMsg = Number(summary && summary.message_count || 0);
    const identifiedMsg = Number(summary && summary.identified_messages || 0);
    const recognitionRate = totalMsg > 0 ? ((identifiedMsg / totalMsg) * 100).toFixed(1) : '100.0';
    summary.recognition_rate = `${recognitionRate}%`;

    setOperation(filePath, 'overview', 'types', 62, '正在汇总会话类型', { active: true });
    const types = await all(`SELECT conversation_type AS type,COUNT(*) AS conversation_count,
        SUM(message_count) AS message_count FROM chat_conversations GROUP BY conversation_type ORDER BY message_count DESC`);
    setOperation(filePath, 'overview', 'months', 74, '正在生成月度消息趋势', { active: true });
    const months = await all(`SELECT substr(message_time,1,7) AS month,COUNT(*) AS message_count
        FROM chat_messages GROUP BY substr(message_time,1,7) ORDER BY month DESC LIMIT 18`);
    setOperation(filePath, 'overview', 'hours', 88, '正在生成 24 小时活跃分布', { active: true });
    const hours = await all(`SELECT substr(message_time,12,2) AS hour,COUNT(*) AS message_count
        FROM chat_messages GROUP BY substr(message_time,12,2) ORDER BY hour`);
        return { summary, types, months: months.reverse(), hours, mySenderId: settings.my_sender_id || '' };
        });
        finishOperation(filePath, 'overview', result.analyticsCache && result.analyticsCache.hit ? '已读取会话概览缓存' : '会话概览统计完成');
        return result;
    } catch (error) {
        failOperation(filePath, 'overview', error);
        throw error;
    }
}

async function getPeopleStats(userId, options = {}) {
    await ensureReady();
    const settings = await getUserSettings(userId);
    const limit = parsePositiveInt(options.limit, 100, 500);
    const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
    const q = String(options.q || '').trim();
    const where = q ? 'WHERE m.sender_name LIKE ? OR m.sender_id LIKE ?' : '';
    const params = q ? [`%${q}%`, `%${q}%`] : [];
    const cacheKey = `people:${digest(JSON.stringify({ userId, mySenderId: settings.my_sender_id || '', q, limit, offset })).slice(0, 40)}`;
    return cachedAnalyticsResult(cacheKey, async () => {
    const totalRow = await get(`SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM chat_messages m ${where} GROUP BY m.sender_id,m.sender_name
    )`, params);
    const items = await all(`WITH ordered AS (
        SELECT sender_name,sender_id,message_time,
            LAG(sender_id) OVER (PARTITION BY conversation_id ORDER BY message_time,id) AS previous_sender_id,
            LAG(message_time) OVER (PARTITION BY conversation_id ORDER BY message_time,id) AS previous_time
        FROM chat_messages
    ), response AS (
        SELECT sender_name,sender_id,
            AVG((julianday(message_time)-julianday(previous_time))*1440.0) AS avg_response_minutes
        FROM ordered WHERE previous_time IS NOT NULL AND sender_id<>previous_sender_id
            AND (julianday(message_time)-julianday(previous_time))*1440.0 BETWEEN 0 AND 720
        GROUP BY sender_name,sender_id
    )
    SELECT m.sender_name,m.sender_id,COUNT(*) AS message_count,
        COUNT(DISTINCT m.conversation_id) AS conversation_count,
        COUNT(DISTINCT substr(m.message_time,1,10)) AS active_days,
        MIN(m.message_time) AS first_message_time,MAX(m.message_time) AS last_message_time,
        ROUND(AVG(length(m.content)),1) AS average_length,
        ROUND(MAX(r.avg_response_minutes),1) AS average_response_minutes,
        CASE WHEN m.sender_id=? THEN 1 ELSE 0 END AS is_me
    FROM chat_messages m LEFT JOIN response r ON r.sender_id=m.sender_id AND r.sender_name=m.sender_name
    ${where} GROUP BY m.sender_id,m.sender_name ORDER BY message_count DESC,last_message_time DESC LIMIT ? OFFSET ?`, [
        settings.my_sender_id || '__not_configured__', ...params, limit, offset
    ]);
        return {
            items,
            total: Number(totalRow && totalRow.total || 0),
            limit,
            offset,
            approximateResponseTime: true,
            mySenderId: settings.my_sender_id || ''
        };
    });
}

async function buildRelationshipGraph(userId, options = {}) {
    const filePath = dbPath();
    const settings = await getUserSettings(userId);
    const mySenderId = cleanInline(settings.my_sender_id || '');
    const conversationLimit = parsePositiveInt(options.limit, 120, 300);
    const rootLabelRow = mySenderId ? await get(`SELECT sender_name
        FROM chat_messages WHERE sender_id=? AND sender_name<>''
        GROUP BY sender_name ORDER BY COUNT(*) DESC, MAX(message_time) DESC LIMIT 1`, [mySenderId]) : null;
    const rootLabel = rootLabelRow && rootLabelRow.sender_name || mySenderId || userId || '我';
    const root = {
        id: 'chat-root',
        type: 'chatRoot',
        label: rootLabel,
        labelEn: rootLabel,
        senderId: mySenderId,
        group: 'chat-self',
        size: 15,
        activity: 1
    };
    if (!mySenderId) {
        return {
            mode: 'chat',
            configured: false,
            mySenderId: '',
            nodes: [root],
            edges: [],
            stats: { conversations: 0, people: 0, messages: 0, single: 0, group: 0, discussion: 0 },
            generatedAt: new Date().toISOString()
        };
    }

    setOperation(filePath, 'relationship-graph', 'conversations', 25, '正在筛选与我相关的会话', { active: true });
    const conversations = await all(`SELECT c.id,c.display_name,c.conversation_type,c.message_count,
            c.participant_count,c.first_message_time,c.last_message_time
        FROM chat_conversations c
        JOIN (SELECT DISTINCT conversation_id FROM chat_messages WHERE sender_id=?) mine
          ON mine.conversation_id=c.id
        WHERE c.conversation_type IN ('single','group','discussion')
        ORDER BY c.message_count DESC,c.last_message_time DESC
        LIMIT ?`, [mySenderId, conversationLimit]);
    if (!conversations.length) {
        return {
            mode: 'chat', configured: true, mySenderId, nodes: [root], edges: [],
            stats: { conversations: 0, people: 0, messages: 0, single: 0, group: 0, discussion: 0 },
            generatedAt: new Date().toISOString()
        };
    }

    const conversationIds = conversations.map(item => item.id);
    setOperation(filePath, 'relationship-graph', 'participants', 55, '正在统计会话参与人和发言频度', { active: true });
    const participants = await all(`SELECT m.conversation_id,MAX(m.sender_id) AS sender_id,
            COALESCE(MAX(NULLIF(d.sender_name,'')),MAX(m.sender_name)) AS sender_name,
            COUNT(*) AS message_count,MIN(m.message_time) AS first_message_time,MAX(m.message_time) AS last_message_time
        FROM chat_messages m
        LEFT JOIN chat_person_directory d ON d.sender_id=m.sender_id AND m.sender_id<>''
        WHERE m.conversation_id IN (${placeholders(conversationIds.length)})
          AND NOT (m.sender_id=? AND m.sender_id<>'')
          AND (m.sender_id<>'' OR m.sender_name<>'')
        GROUP BY m.conversation_id,CASE WHEN m.sender_id<>'' THEN 'id:'||m.sender_id ELSE 'name:'||m.sender_name END
        ORDER BY message_count DESC`, [...conversationIds, mySenderId]);
    setOperation(filePath, 'relationship-graph', 'building', 84, '正在生成关系节点与连线', { active: true });
    const maxConversationMessages = Math.max(1, ...conversations.map(item => Number(item.message_count) || 0));
    const maxParticipantMessages = Math.max(1, ...participants.map(item => Number(item.message_count) || 0));
    const people = new Map();
    const nodes = [root];
    const edges = [];

    conversations.forEach(conversation => {
        const messageCount = Number(conversation.message_count) || 0;
        const activity = Math.log1p(messageCount) / Math.log1p(maxConversationMessages);
        const nodeId = `chat-conversation:${conversation.id}`;
        nodes.push({
            id: nodeId,
            type: 'chatConversation',
            conversationId: conversation.id,
            conversationType: conversation.conversation_type,
            label: conversation.display_name,
            labelEn: conversation.display_name,
            group: `chat-${conversation.conversation_type}`,
            messageCount,
            participantCount: Number(conversation.participant_count) || 0,
            firstMessageTime: conversation.first_message_time,
            lastMessageTime: conversation.last_message_time,
            activity,
            size: 7 + activity * 7
        });
        edges.push({ source: root.id, target: nodeId, type: 'contains', weight: messageCount, activity });
    });

    participants.forEach(participant => {
        const identity = cleanInline(participant.sender_id) || `name:${cleanInline(participant.sender_name)}`;
        if (!identity) return;
        const personId = `chat-person:${digest(identity).slice(0, 20)}`;
        const messageCount = Number(participant.message_count) || 0;
        if (!people.has(personId)) {
            people.set(personId, {
                id: personId,
                type: 'chatPerson',
                label: cleanInline(participant.sender_name) || cleanInline(participant.sender_id) || '未知成员',
                labelEn: cleanInline(participant.sender_name) || cleanInline(participant.sender_id) || 'Unknown member',
                senderId: cleanInline(participant.sender_id),
                group: 'chat-person',
                messageCount: 0,
                conversationCount: 0,
                firstMessageTime: participant.first_message_time,
                lastMessageTime: participant.last_message_time,
                size: 5,
                activity: 0
            });
        }
        const person = people.get(personId);
        person.messageCount += messageCount;
        person.conversationCount += 1;
        if (String(participant.first_message_time || '') < String(person.firstMessageTime || '')) person.firstMessageTime = participant.first_message_time;
        if (String(participant.last_message_time || '') > String(person.lastMessageTime || '')) person.lastMessageTime = participant.last_message_time;
        const activity = Math.log1p(messageCount) / Math.log1p(maxParticipantMessages);
        edges.push({
            source: `chat-conversation:${participant.conversation_id}`,
            target: personId,
            type: 'contains',
            weight: messageCount,
            activity
        });
    });
    const maxPersonMessages = Math.max(1, ...[...people.values()].map(item => item.messageCount));
    people.forEach(person => {
        person.activity = Math.log1p(person.messageCount) / Math.log1p(maxPersonMessages);
        person.size = 4.5 + person.activity * 6.5;
        nodes.push(person);
    });
    const typeCounts = { single: 0, group: 0, discussion: 0 };
    conversations.forEach(item => { typeCounts[item.conversation_type] = (typeCounts[item.conversation_type] || 0) + 1; });
    return {
        mode: 'chat',
        configured: true,
        mySenderId,
        nodes,
        edges,
        stats: {
            conversations: conversations.length,
            people: people.size,
            messages: conversations.reduce((sum, item) => sum + (Number(item.message_count) || 0), 0),
            ...typeCounts
        },
        generatedAt: new Date().toISOString()
    };
}

async function getRelationshipGraph(userId, options = {}) {
    await ensureReady();
    const filePath = dbPath();
    setOperation(filePath, 'relationship-graph', 'settings', 8, '正在读取我的工号设置', { active: true });
    try {
        const result = await buildRelationshipGraph(userId, options);
        finishOperation(filePath, 'relationship-graph', '聊天关系图数据已生成');
        return result;
    } catch (error) {
        failOperation(filePath, 'relationship-graph', error);
        throw error;
    }
}

async function getGroupStats(options = {}) {
    await ensureReady();
    const limit = parsePositiveInt(options.limit, 100, 500);
    const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
    const q = String(options.q || '').trim();
    const type = String(options.type || '').trim();

    const conditions = ["c.conversation_type IN ('group', 'discussion')"];
    const params = [];

    if (q) {
        conditions.push('(c.display_name LIKE ? OR c.id LIKE ? OR c.id IN (SELECT conversation_id FROM chat_messages WHERE sender_name LIKE ? OR sender_id LIKE ?))');
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (['group', 'discussion'].includes(type)) {
        conditions.push('c.conversation_type = ?');
        params.push(type);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const cacheKey = `groups:${digest(JSON.stringify({ q, type, limit, offset })).slice(0, 40)}`;

    return cachedAnalyticsResult(cacheKey, async () => {
    const totalRow = await get(`SELECT COUNT(*) AS total FROM chat_conversations c ${where}`, params);
    const items = await all(`WITH selected_conversations AS (
        SELECT c.id,c.display_name,c.conversation_type
        FROM chat_conversations c
        ${where}
    ), top_speakers AS (
        SELECT m.conversation_id, m.sender_name, m.sender_id, COUNT(*) AS speaker_msg_count,
            ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY COUNT(*) DESC, MAX(m.message_time) DESC) AS rn
        FROM chat_messages m
        JOIN selected_conversations selected ON selected.id=m.conversation_id
        GROUP BY m.conversation_id, m.sender_id, m.sender_name
    )
    SELECT
        selected.id AS conversation_id,
        selected.display_name,
        selected.conversation_type,
        COUNT(m.id) AS message_count,
        COUNT(DISTINCT m.sender_id) AS sender_count,
        COUNT(DISTINCT substr(m.message_time, 1, 10)) AS active_days,
        ROUND(AVG(length(m.content)), 1) AS average_length,
        MIN(m.message_time) AS first_message_time,
        MAX(m.message_time) AS last_message_time,
        ts.sender_name AS top_speaker_name,
        ts.sender_id AS top_speaker_id,
        ts.speaker_msg_count AS top_speaker_count
    FROM selected_conversations selected
    JOIN chat_messages m ON m.conversation_id = selected.id
    LEFT JOIN top_speakers ts ON ts.conversation_id = selected.id AND ts.rn = 1
    GROUP BY selected.id, selected.display_name, selected.conversation_type
    ORDER BY message_count DESC, last_message_time DESC
    LIMIT ? OFFSET ?`, [...params, limit, offset]);

        return { items, total: Number(totalRow && totalRow.total || 0), limit, offset };
    });
}

async function getGroupDetailedAnalysis(conversationId, options = {}) {
    await ensureReady();
    const id = String(conversationId || '').trim();
    if (!id) throw new Error('会话 ID 不能为空');

    const conversation = await get(`SELECT c.id, c.display_name, c.conversation_type, s.relative_path, s.file_size, s.imported_at
        FROM chat_conversations c
        LEFT JOIN chat_sources s ON s.id = c.source_id
        WHERE c.id = ?`, [id]);

    if (!conversation) {
        throw new Error('未找到该群组或讨论组记录');
    }
    if (!['group', 'discussion'].includes(conversation.conversation_type)) {
        throw new Error('该会话不是群组或讨论组');
    }

    const groupPreference = await get(
        'SELECT persona_style,updated_at FROM chat_group_preferences WHERE conversation_id=?',
        [id]
    );

    const summary = await get(`SELECT
        COUNT(*) AS total_messages,
        COUNT(DISTINCT sender_id) AS sender_count,
        COUNT(DISTINCT substr(message_time, 1, 10)) AS active_days,
        ROUND(AVG(length(content)), 1) AS average_length,
        MIN(message_time) AS first_message_time,
        MAX(message_time) AS last_message_time
    FROM chat_messages
    WHERE conversation_id = ?`, [id]);

    const totalMessages = Number(summary.total_messages || 0);
    const senderCount = Number(summary.sender_count || 0);
    const activeDays = Number(summary.active_days || 0);
    const avgLength = Number(summary.average_length || 0);

    // 1. Response time per member & overall
    const responseRows = await all(`WITH ordered AS (
        SELECT sender_id, sender_name, message_time, id,
            LAG(sender_id) OVER (ORDER BY message_time, id) AS prev_sender_id,
            LAG(message_time) OVER (ORDER BY message_time, id) AS prev_time
        FROM chat_messages
        WHERE conversation_id = ?
    ), responses AS (
        SELECT sender_id, sender_name,
            (julianday(message_time) - julianday(prev_time)) * 1440.0 AS diff_minutes
        FROM ordered
        WHERE prev_time IS NOT NULL AND sender_id <> prev_sender_id
            AND (julianday(message_time) - julianday(prev_time)) * 1440.0 BETWEEN 0 AND 720
    )
    SELECT sender_id, sender_name,
        ROUND(AVG(diff_minutes), 1) AS avg_response_minutes,
        COUNT(*) AS response_count
    FROM responses
    GROUP BY sender_id, sender_name`, [id]);

    const responseMap = new Map();
    let totalWeightedResponse = 0;
    let totalResponses = 0;
    responseRows.forEach(row => {
        responseMap.set(`${row.sender_id}:::${row.sender_name}`, Number(row.avg_response_minutes || 0));
        totalWeightedResponse += Number(row.avg_response_minutes || 0) * Number(row.response_count || 0);
        totalResponses += Number(row.response_count || 0);
    });
    const overallAvgResponse = totalResponses > 0 ? Math.round((totalWeightedResponse / totalResponses) * 10) / 10 : null;

    // 2. 24 hours distribution
    const hourRows = await all(`SELECT
        CAST(strftime('%H', message_time) AS INTEGER) AS hour,
        COUNT(*) AS count
    FROM chat_messages
    WHERE conversation_id = ?
    GROUP BY hour
    ORDER BY hour`, [id]);

    const hourlyDistribution = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
    hourRows.forEach(row => {
        if (row.hour >= 0 && row.hour < 24) {
            hourlyDistribution[row.hour].count = Number(row.count || 0);
        }
    });

    // 3. Member list
    const memberRows = await all(`SELECT
        sender_name,
        sender_id,
        COUNT(*) AS message_count,
        COUNT(DISTINCT substr(message_time, 1, 10)) AS active_days,
        ROUND(AVG(length(content)), 1) AS average_length,
        MIN(message_time) AS first_message_time,
        MAX(message_time) AS last_message_time
    FROM chat_messages
    WHERE conversation_id = ?
    GROUP BY sender_id, sender_name
    ORDER BY message_count DESC, last_message_time DESC`, [id]);

    // Compute day span
    const firstTime = summary.first_message_time ? new Date(summary.first_message_time) : null;
    const lastTime = summary.last_message_time ? new Date(summary.last_message_time) : null;
    let daySpan = 1;
    if (firstTime && lastTime && !isNaN(firstTime.getTime()) && !isNaN(lastTime.getTime())) {
        daySpan = Math.max(1, Math.round((lastTime.getTime() - firstTime.getTime()) / (86400 * 1000)) + 1);
    }

    const avgDailyMessages = activeDays > 0 ? Math.round((totalMessages / activeDays) * 10) / 10 : 0;
    const avgMemberMessages = senderCount > 0 ? Math.round((totalMessages / senderCount) * 10) / 10 : 0;
    const activityDensity = daySpan > 0 ? Math.min(100, Math.round((activeDays / daySpan) * 100)) : 100;

    // Top 2 concentration
    let top2Count = 0;
    memberRows.slice(0, 2).forEach(m => { top2Count += Number(m.message_count || 0); });
    const top2Concentration = totalMessages > 0 ? Math.round((top2Count / totalMessages) * 1000) / 10 : 0;

    // Build members with persona & metrics
    const members = memberRows.map((m, idx) => {
        const msgCount = Number(m.message_count || 0);
        const mActiveDays = Number(m.active_days || 1);
        const pct = totalMessages > 0 ? Math.round((msgCount / totalMessages) * 1000) / 10 : 0;
        const key = `${m.sender_id}:::${m.sender_name}`;
        const avgResp = responseMap.has(key) ? responseMap.get(key) : null;
        const dailyFreq = mActiveDays > 0 ? Math.round((msgCount / mActiveDays) * 10) / 10 : msgCount;

        let personaRole = '🌱 边缘发言';
        let roleLevel = 'low';
        if (idx === 0 && pct >= 25) {
            personaRole = '👑 核心领袖';
            roleLevel = 'core';
        } else if (pct >= 15 || idx < 2) {
            personaRole = '🔥 积极中坚';
            roleLevel = 'active';
        } else if (msgCount >= 5 || pct >= 5) {
            personaRole = '💬 常规参与';
            roleLevel = 'regular';
        }

        return {
            sender_id: m.sender_id,
            sender_name: m.sender_name,
            message_count: msgCount,
            message_percent: pct,
            active_days: mActiveDays,
            daily_frequency: dailyFreq,
            average_length: Number(m.average_length || 0),
            average_response_minutes: avgResp,
            first_message_time: m.first_message_time,
            last_message_time: m.last_message_time,
            persona_role: personaRole,
            role_level: roleLevel
        };
    });

    // Operational Diagnosis
    let structureType = '全员均衡型（去中心化共创）';
    if (top2Concentration >= 60) {
        structureType = '核心驱动型（少数骨干牵引）';
    } else if (top2Concentration >= 40) {
        structureType = '中坚主导型（多核心互动）';
    }

    let cadenceType = '异步消息型（回复时延>30分）';
    if (overallAvgResponse !== null) {
        if (overallAvgResponse <= 5) cadenceType = '极速敏捷协同（响应均值≤5分）';
        else if (overallAvgResponse <= 30) cadenceType = '高效跟进讨论（响应均值5~30分）';
    }

    let styleType = '常规交流型（平均字符25~50字）';
    if (avgLength >= 50) styleType = '深度长文研讨型（平均字符≥50字）';
    else if (avgLength < 25) styleType = '短讯碎片快确认（平均字符<25字）';

    const topSpeakerName = members.length ? members[0].sender_name : '无';
    const topSpeakerPct = members.length ? members[0].message_percent : 0;

    const operationalSummary = `该社群存续跨度约 ${daySpan} 天，累计发生 ${activeDays} 个活跃交流日（活跃密度 ${activityDensity}%）。社群呈现【${structureType}】，头部发言者 ${topSpeakerName} 贡献了全群 ${topSpeakerPct}% 的消息。群内人均发信量为 ${avgMemberMessages} 条，平均单条发信长度 ${avgLength} 字符（属于【${styleType}】）。沟通互动响应均值约 ${overallAvgResponse !== null ? `${overallAvgResponse} 分钟` : '暂无数据'}（体现【${cadenceType}】），整体协同态势健康。`;

    return {
        conversation: {
            id: conversation.id,
            display_name: conversation.display_name,
            conversation_type: conversation.conversation_type,
            relative_path: conversation.relative_path,
            file_size: conversation.file_size,
            imported_at: conversation.imported_at,
            persona_style: GROUP_PERSONA_STYLES.has(groupPreference && groupPreference.persona_style)
                ? groupPreference.persona_style
                : 'operations',
            persona_style_updated_at: groupPreference ? groupPreference.updated_at : null
        },
        overview: {
            total_messages: totalMessages,
            sender_count: senderCount,
            active_days: activeDays,
            average_length: avgLength,
            day_span: daySpan,
            activity_density: activityDensity,
            avg_daily_messages: avgDailyMessages,
            avg_member_messages: avgMemberMessages,
            overall_avg_response: overallAvgResponse,
            top2_concentration: top2Concentration,
            first_message_time: summary.first_message_time,
            last_message_time: summary.last_message_time
        },
        diagnosis: {
            structure: structureType,
            cadence: cadenceType,
            style: styleType,
            summary: operationalSummary
        },
        hourly_distribution: hourlyDistribution,
        members
    };
}

async function saveGroupPersonaStyle(conversationId, personaStyle) {
    await ensureReady();
    const id = String(conversationId || '').trim();
    const style = String(personaStyle || '').trim();
    if (!GROUP_PERSONA_STYLES.has(style)) throw new Error('不支持的运营角色画像风格');

    const conversation = await get(
        `SELECT id FROM chat_conversations
        WHERE id=? AND conversation_type IN ('group','discussion')`,
        [id]
    );
    if (!conversation) return null;

    const now = new Date().toISOString();
    await run(`INSERT INTO chat_group_preferences(conversation_id,persona_style,updated_at)
        VALUES(?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET
        persona_style=excluded.persona_style,updated_at=excluded.updated_at`, [id, style, now]);
    return { conversationId: id, personaStyle: style, updatedAt: now };
}

async function listSources(options = {}) {
    await ensureReady();
    const q = String(options.q || '').trim();
    const type = String(options.type || '').trim();
    const limit = parsePositiveInt(options.limit, 20, 500);
    const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params = [];

    if (q) {
        conditions.push('(s.relative_path LIKE ? OR c.display_name LIKE ?)');
        params.push(`%${q}%`, `%${q}%`);
    }
    if (['single', 'group', 'discussion', 'other'].includes(type)) {
        conditions.push('c.conversation_type=?');
        params.push(type);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const items = await all(`SELECT s.id,s.relative_path,s.source_hash,s.file_size,s.modified_at,s.imported_at,s.message_count,
        c.id AS conversation_id,c.display_name,c.conversation_type
        FROM chat_sources s LEFT JOIN chat_conversations c ON c.source_id=s.id
        ${where}
        ORDER BY s.imported_at DESC, s.id DESC
        LIMIT ? OFFSET ?`, [...params, limit, offset]);

    const countRow = await get(`SELECT COUNT(*) AS total FROM chat_sources s
        LEFT JOIN chat_conversations c ON c.source_id=s.id
        ${where}`, params);
    const total = Number(countRow && countRow.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
        items,
        total,
        page,
        limit,
        totalPages
    };
}

async function deleteSource(sourceId) {
    await ensureReady();
    const source = await get('SELECT * FROM chat_sources WHERE id=?', [sourceId]);
    if (!source) return null;
    const conversation = await get('SELECT id FROM chat_conversations WHERE source_id=?', [sourceId]);
    await run('BEGIN IMMEDIATE');
    try {
        if (conversation && isFtsAvailable()) await run('DELETE FROM chat_messages_fts WHERE conversation_id=?', [conversation.id]);
        await run('DELETE FROM chat_sources WHERE id=?', [sourceId]);
        await run('DELETE FROM chat_favorites WHERE message_stable_key NOT IN (SELECT stable_key FROM chat_messages)');
        await run('COMMIT');
        await syncPersonDirectory();
        await invalidateAnalyticsCache();
        return source;
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function deleteTestDataSources() {
    await ensureReady();
    const legacyConditions = LEGACY_TEST_SOURCE_SIGNATURES.map(() => `(s.relative_path=? AND EXISTS (
        SELECT 1 FROM chat_messages marker
        WHERE marker.conversation_id=c.id AND marker.content LIKE ?
    ))`);
    const legacyParams = LEGACY_TEST_SOURCE_SIGNATURES.flat();
    const testSources = await all(`SELECT s.id, s.relative_path, c.id AS conversation_id
        FROM chat_sources s LEFT JOIN chat_conversations c ON c.source_id=s.id
        WHERE s.data_kind='test'
            OR s.relative_path LIKE '测试数据/%'
            OR s.relative_path LIKE 'test_data/%'
            OR ${legacyConditions.join('\n            OR ')}`, legacyParams);
    if (!testSources.length) return { deletedCount: 0, sources: [] };

    await run('BEGIN IMMEDIATE');
    try {
        for (const item of testSources) {
            if (item.conversation_id && isFtsAvailable()) {
                await run('DELETE FROM chat_messages_fts WHERE conversation_id=?', [item.conversation_id]);
            }
            await run('DELETE FROM chat_sources WHERE id=?', [item.id]);
        }
        await run('DELETE FROM chat_favorites WHERE message_stable_key NOT IN (SELECT stable_key FROM chat_messages)');
        await run('COMMIT');
        await syncPersonDirectory();
        await invalidateAnalyticsCache();
        return { deletedCount: testSources.length, sources: testSources.map(s => s.relative_path) };
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function deleteAllSources() {
    await ensureReady();
    await run('BEGIN IMMEDIATE');
    try {
        if (isFtsAvailable()) await run('DELETE FROM chat_messages_fts');
        await run('DELETE FROM chat_sources');
        await run('DELETE FROM chat_favorites');
        await run('DELETE FROM chat_person_directory');
        await run('COMMIT');
        await invalidateAnalyticsCache();
        return { success: true };
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function syncConversationTypes() {
    await ensureReady();
    const updated = await reclassifyStoredConversations();
    if (updated > 0) await invalidateAnalyticsCache();
    return updated;
}

module.exports = {
    DB_FILENAME,
    classifyConversation,
    createParserExclusionRule,
    deleteParserExclusionRule,
    deleteAllSources,
    deleteSource,
    deleteTestDataSources,
    ensureReady,
    getConversation,
    getGroupDetailedAnalysis,
    getGroupStats,
    getOverviewStats,
    getPeopleStats,
    getRelationshipGraph,
    getServiceStatus,
    getUnidentifiedMessages,
    getUserSettings,
    importTxtFile,
    invalidateAnalyticsCache,
    isFtsAvailable,
    isExcludedHeaderLine,
    listConversations,
    listMessages,
    listParserExclusionRules,
    listPersonDirectory,
    listSources,
    markRead,
    normalizeRelativePath,
    parseHeader,
    saveUserSettings,
    saveGroupPersonaStyle,
    searchMessages,
    setFavorite,
    setPinned,
    syncConversationTypes,
    syncPersonDirectory,
    updateParserExclusionRule,
    updatePersonDirectory
};
