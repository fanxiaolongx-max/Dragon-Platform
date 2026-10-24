const express = require('express');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const router = express.Router();
const { listDatabases, resolveDatabase } = require('../models/db-explorer-databases');
const { describeTable } = require('../models/db-explorer-catalog');
const { requireAdmin } = require('../middleware/auth');

// 仅限超级管理员访问数据库浏览功能
router.use(requireAdmin);
router.use((req, _res, next) => {
    // SQL and arbitrary result aliases can contain credentials, including rows
    // from the global account database. Keep them out of request/runtime logs.
    req.suppressBodyLog = true;
    req.suppressResponseLog = true;
    next();
});

function requestDatabase(req) {
    const queryId = req.query.database;
    const bodyId = req.body?.database;
    if (queryId !== undefined && bodyId !== undefined && queryId !== bodyId) {
        throw Object.assign(new Error('数据库选择不一致'), { status: 400, code: 'INVALID_DATABASE' });
    }
    return resolveDatabase(queryId ?? bodyId ?? 'tools');
}

router.get('/databases', (_req, res) => {
    try {
        res.json({ databases: listDatabases(), defaultDatabase: 'tools' });
    } catch (err) {
        res.status(500).json({ error: '获取数据库列表失败' });
    }
});

function splitSqlStatements(sql) {
    const statements = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sql.length; i++) {
        const char = sql[i];
        const next = sql[i + 1];

        if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
            if (inLineComment) {
                if (char === '\n') inLineComment = false;
                current += char;
                continue;
            }
            if (inBlockComment) {
                if (char === '*' && next === '/') {
                    inBlockComment = false;
                    current += '*/';
                    i++;
                    continue;
                }
                current += char;
                continue;
            }
            if (char === '-' && next === '-') {
                inLineComment = true;
                current += '--';
                i++;
                continue;
            }
            if (char === '/' && next === '*') {
                inBlockComment = true;
                current += '/*';
                i++;
                continue;
            }
        }

        if (char === "'" && !inDoubleQuote && !inBacktick && !inLineComment && !inBlockComment) {
            inSingleQuote = !inSingleQuote;
        } else if (char === '"' && !inSingleQuote && !inBacktick && !inLineComment && !inBlockComment) {
            inDoubleQuote = !inDoubleQuote;
        } else if (char === '`' && !inSingleQuote && !inDoubleQuote && !inLineComment && !inBlockComment) {
            inBacktick = !inBacktick;
        }

        if (char === ';' && !inSingleQuote && !inDoubleQuote && !inBacktick && !inLineComment && !inBlockComment) {
            if (current.trim()) {
                statements.push(current.trim());
            }
            current = '';
        } else {
            current += char;
        }
    }

    if (current.trim()) {
        statements.push(current.trim());
    }

    return statements;
}

function getStatementVerb(statement) {
    const cleaned = statement.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, '').trim();
    const match = cleaned.match(/^([a-zA-Z]+)/);
    return match ? match[1].toUpperCase() : '';
}

function hasReturningClause(statement) {
    const cleaned = statement.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, '').trim();
    return /\bRETURNING\b/i.test(cleaned);
}

async function executeSingleStatement(statement, database) {
    const startTime = Date.now();
    const verb = getStatementVerb(statement);
    const isQuery = ['SELECT', 'PRAGMA', 'EXPLAIN', 'WITH', 'VALUES'].includes(verb) || hasReturningClause(statement);

    if (isQuery) {
        const rows = await database.all(statement);
        const durationMs = Date.now() - startTime;
        const safeRows = Array.isArray(rows) ? rows : [];
        const columns = safeRows.length > 0 ? Object.keys(safeRows[0]) : [];
        return {
            sql: statement,
            verb: verb || 'QUERY',
            type: 'query',
            columns,
            rows: safeRows,
            rowCount: safeRows.length,
            durationMs
        };
    } else {
        const result = await database.run(statement);
        const durationMs = Date.now() - startTime;
        return {
            sql: statement,
            verb: verb || 'EXECUTE',
            type: 'execute',
            changes: result && result.changes !== undefined ? result.changes : 0,
            lastID: result && result.lastID !== undefined ? result.lastID : 0,
            durationMs
        };
    }
}

async function handleSqlExecution(req, res) {
    try {
        const rawSql = typeof req.body.sql === 'string' ? req.body.sql.trim() : '';
        if (!rawSql) {
            return res.status(400).json({ error: 'SQL 语句不能为空' });
        }

        const statements = splitSqlStatements(rawSql);
        if (statements.length === 0) {
            return res.status(400).json({ error: '未检测到有效的 SQL 语句' });
        }

        if (statements.length > 50) {
            return res.status(400).json({ error: '单次批量执行不能超过 50 条语句' });
        }

        const database = requestDatabase(req);

        const results = [];
        const totalStart = Date.now();

        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            try {
                const verb = getStatementVerb(stmt);
                if (['ATTACH', 'DETACH'].includes(verb) || (verb === 'VACUUM' && /\bINTO\b/i.test(stmt))) {
                    throw new Error('请通过数据库选择器切换数据库，不支持跨库文件操作');
                }
                const result = await executeSingleStatement(stmt, database);
                if (result.type === 'query' && result.rows.length > 5000) {
                    result.rows = result.rows.slice(0, 5000);
                    result.truncated = true;
                    result.maxRowsNotice = '结果集超过 5000 行，已自动截取前 5000 行展示。若需查看更多请增加 LIMIT / OFFSET 分页。';
                }
                results.push(result);
            } catch (stmtErr) {
                return res.status(400).json({
                    error: stmtErr.message || 'SQL 执行失败',
                    failedSql: stmt,
                    statementIndex: i + 1,
                    totalStatements: statements.length,
                    executedResults: results
                });
            }
        }

        res.json({
            success: true,
            database: database.id,
            results,
            totalDurationMs: Date.now() - totalStart
        });
    } catch (err) {
        if (!err.status) console.error('[db-explorer] Error executing SQL:', err);
        res.status(err.status || 500).json({ error: err.message || '服务器执行 SQL 发生未知错误', ...(err.code ? { code: err.code } : {}) });
    }
}

// 自由 SQL 执行 API (支持 SELECT、INSERT、UPDATE、DELETE、DDL 等任意语句)
router.post('/query', handleSqlExecution);
router.post('/sql', handleSqlExecution);

const LOG_DIR = path.join(__dirname, '../logs');
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function parseDateKey(value, fallback) {
    const text = String(value || '').trim();
    if (!DATE_KEY_PATTERN.test(text)) return fallback;
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? fallback : text;
}

function enumerateDateKeys(fromKey, toKey) {
    const keys = [];
    let cursor = new Date(`${fromKey}T00:00:00`);
    const end = new Date(`${toKey}T00:00:00`);
    while (cursor <= end && keys.length <= 31) {
        keys.push(localDateKey(cursor));
        cursor = addDays(cursor, 1);
    }
    return keys;
}

function sanitizeRange(fromKey, toKey) {
    const today = localDateKey();
    const defaultFrom = localDateKey(addDays(new Date(), -2));
    let from = parseDateKey(fromKey, defaultFrom);
    let to = parseDateKey(toKey, today);
    if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
    }

    const dates = enumerateDateKeys(from, to);
    if (dates.length > 31) {
        dates.splice(0, dates.length - 31);
        from = dates[0];
    }
    return { from, to, dates };
}

function filterLegacyLogByDates(filePath, dateSet) {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    return lines.filter(line => {
        const dateKey = line.slice(0, 10);
        return dateSet.has(dateKey);
    }).join('\n');
}

// 获取所有表名
router.get('/catalog', async (req, res) => {
    try {
        const database = requestDatabase(req);
        if (database.kind === 'empty') return res.json({ database: database.id, tables: [] });
        const rows = await database.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name COLLATE NOCASE");
        res.json({ database: database.id, tables: rows.map(row => describeTable(row.name)) });
    } catch (err) {
        if (!err.status) console.error('[db-explorer] Error fetching catalog:', err);
        res.status(err.status || 500).json({ error: err.status ? err.message : '获取表目录失败', ...(err.code ? { code: err.code } : {}) });
    }
});

router.get('/tables', async (req, res) => {
    try {
        const database = requestDatabase(req);
        if (database.kind === 'empty') return res.json([]);
        const rows = await database.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC");
        res.json(rows.map(r => r.name));
    } catch (err) {
        if (!err.status) console.error('[db-explorer] Error fetching tables:', err);
        res.status(err.status || 500).json({ error: err.status ? err.message : '获取表列表失败', ...(err.code ? { code: err.code } : {}) });
    }
});

// 导出最近日志。默认最近 3 个自然日，可通过 from/to 手动指定，最多 31 天。
router.get('/logs/export', async (req, res) => {
    try {
        const { from, to, dates } = sanitizeRange(req.query.from, req.query.to);
        const dateSet = new Set(dates);
        const zip = new JSZip();
        const manifest = {
            generatedAt: new Date().toISOString(),
            from,
            to,
            dates,
            logDir: LOG_DIR,
            files: []
        };

        for (const dateKey of dates) {
            const dayDir = path.join(LOG_DIR, dateKey);
            if (!fs.existsSync(dayDir)) continue;
            for (const name of ['out.log', 'error.log']) {
                const filePath = path.join(dayDir, name);
                if (!fs.existsSync(filePath)) continue;
                const archivePath = `${dateKey}/${name}`;
                zip.file(archivePath, fs.readFileSync(filePath));
                manifest.files.push({
                    path: archivePath,
                    source: filePath,
                    bytes: fs.statSync(filePath).size
                });
            }
        }

        for (const name of ['out.log', 'error.log']) {
            const filePath = path.join(LOG_DIR, name);
            const filtered = filterLegacyLogByDates(filePath, dateSet);
            if (!filtered) continue;
            const archivePath = `legacy-filtered/${name}`;
            zip.file(archivePath, `${filtered}\n`);
            manifest.files.push({
                path: archivePath,
                source: filePath,
                filteredByDate: true,
                bytes: Buffer.byteLength(filtered)
            });
        }

        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        const filename = `tools-platform-logs_${from}_${to}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(content);
    } catch (err) {
        console.error('[db-explorer] Error exporting logs:', err);
        res.status(500).json({ error: '导出日志失败' });
    }
});

// 获取某张表的结构和数据
router.get('/tables/:name', async (req, res) => {
    try {
        const tableName = req.params.name;
        const database = requestDatabase(req);
        if (database.kind === 'empty') return res.status(404).json({ error: '表不存在' });
        // 防 SQL 注入：确保表真的存在
        const check = await database.get("SELECT name, sql FROM sqlite_master WHERE type='table' AND name = ?", [tableName]);
        if (!check) return res.status(404).json({ error: '表不存在' });

        const limit = parseInt(req.query.limit, 10) || 100;
        const offset = parseInt(req.query.offset, 10) || 0;

        const quotedName = `"${tableName.replace(/"/g, '""')}"`;
        const countRow = await database.get(`SELECT COUNT(1) as total FROM ${quotedName}`);
        const total = countRow.total;

        const view = req.query.view === 'schema' ? 'schema' : 'data';
        const rows = view === 'schema' ? [] : await database.all(`SELECT * FROM ${quotedName} LIMIT ? OFFSET ?`, [limit, offset]);
        const schema = await database.all(`PRAGMA table_info(${quotedName})`);
        const indexes = await database.all(`PRAGMA index_list(${quotedName})`);
        for (const index of indexes) {
            index.columns = await database.all(`PRAGMA index_info("${index.name.replace(/"/g, '""')}")`);
        }
        const foreignKeys = await database.all(`PRAGMA foreign_key_list(${quotedName})`);

        res.json({
            table: tableName,
            database: database.id,
            view,
            total,
            limit,
            offset,
            schema,
            rows,
            metadata: describeTable(tableName),
            indexes,
            foreignKeys,
            createSql: check.sql
        });
    } catch (err) {
        if (!err.status) console.error('[db-explorer] Error fetching table:', err);
        res.status(err.status || 500).json({ error: err.status ? err.message : '获取表数据失败', ...(err.code ? { code: err.code } : {}) });
    }
});

module.exports = router;
