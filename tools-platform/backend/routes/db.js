const express = require('express');
const router = express.require ? express.Router() : require('express').Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const multer = require('multer');

const { ensureReportDataDir, getReportDataDir } = require('../models/report-store');
const { createDatabaseProxy, getConnection } = require('../models/tenant-sqlite-pool');
const { AsyncLocalStorage } = require('node:async_hooks');
const configChangeMonitor = require('../models/config-change-monitor');
const { selectLatestSnapshotPerMonth } = require('../models/report-trend-utils');
const reportDataTransfer = require('../models/report-data-transfer-repository');

const reportBackupUpload = multer({
    storage: multer.diskStorage({
        destination: os.tmpdir(),
        filename: (_req, _file, callback) => callback(null, `tools-report-restore-${crypto.randomUUID()}.zip`)
    }),
    limits: { files: 1, fileSize: 1024 * 1024 * 1024 }
});

const MANUAL_ADJUST_ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024;
const manualAdjustAttachmentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: MANUAL_ADJUST_ATTACHMENT_MAX_BYTES }
});
const MANUAL_ADJUST_ATTACHMENT_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
    '.pdf', '.txt', '.csv', '.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt', '.zip'
]);

ensureReportDataDir();
const db = createDatabaseProxy('report.db', 'report');

// Initialize DB schema
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS ReportSnapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT,
        month INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        stored_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        standard_total_score REAL,
        raw_data_json TEXT,
        image_path TEXT,
        excel_path TEXT
    )`);
    
    // Add column if it didn't exist in older versions
    db.run("ALTER TABLE ReportSnapshots ADD COLUMN image_path TEXT", () => {});
    db.run("ALTER TABLE ReportSnapshots ADD COLUMN excel_path TEXT", () => {});
    db.run("ALTER TABLE ReportSnapshots ADD COLUMN stored_at DATETIME", () => {});
    
    db.run(`CREATE TABLE IF NOT EXISTS ReportCategoryScores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT,
        month INTEGER,
        cat_name TEXT,
        base_score REAL,
        manual_score REAL,
        final_score REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ReportMetricData (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT,
        month INTEGER,
        cat_name TEXT,
        metric_label TEXT,
        weight REAL,
        target_val TEXT,
        raw_val TEXT,
        num_val REAL,
        is_failing INTEGER,
        gap TEXT,
        earned_score REAL,
        proportional_scoring INTEGER,
        completion_ratio REAL
    )`);

    db.run("ALTER TABLE ReportCategoryScores ADD COLUMN month INTEGER", () => {});
    db.run("ALTER TABLE ReportMetricData ADD COLUMN month INTEGER", () => {});
    db.run("ALTER TABLE ReportMetricData ADD COLUMN earned_score REAL", () => {});
    db.run("ALTER TABLE ReportMetricData ADD COLUMN proportional_scoring INTEGER", () => {});
    db.run("ALTER TABLE ReportMetricData ADD COLUMN completion_ratio REAL", () => {});
    db.run("ALTER TABLE BigscreenOwners ADD COLUMN emp_id TEXT DEFAULT ''", () => {});

    db.run(`CREATE TABLE IF NOT EXISTS PlatformConfig (
        key_name TEXT PRIMARY KEY,
        value_json TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS BigscreenOwners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cat_name TEXT NOT NULL,
        metric_label TEXT DEFAULT '',
        owner_name TEXT NOT NULL,
        emp_id TEXT DEFAULT '',
        avatar TEXT DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(cat_name, metric_label)
    )`);
});

function getImagesDir() {
    const imagesDir = path.join(getReportDataDir(), 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    return imagesDir;
}

function markSqliteSource(res, routeLabel) {
    res.setHeader('X-Data-Source', 'sqlite');
    if (routeLabel) {
        console.log(`[DATA SOURCE] ${routeLabel} -> SQLITE`);
    }
}

function decodeCompressedTextField(field, label) {
    if (!field || typeof field !== 'object') {
        throw new Error(`${label} 压缩字段格式无效`);
    }

    const encoding = String(field.encoding || '').toLowerCase();
    const raw = Buffer.from(String(field.data || ''), 'base64');
    if (raw.length === 0 && field.data) {
        throw new Error(`${label} 压缩数据为空`);
    }

    let out;
    if (encoding === 'gzip+base64') {
        out = zlib.gunzipSync(raw);
    } else if (encoding === 'deflate+base64') {
        out = zlib.inflateSync(raw);
    } else {
        throw new Error(`${label} 压缩编码不支持: ${field.encoding || 'unknown'}`);
    }

    return out.toString('utf8');
}

function expandCompressedReportPayload(body) {
    const transportCompression = body && body.transport && body.transport.compression;
    if (!transportCompression) return body;

    const payloadText = decodeCompressedTextField(body.compressedReportPayload, '报表入库数据');
    const payload = JSON.parse(payloadText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('报表入库数据解压后格式无效');
    }
    return payload;
}

// Serve static images
router.use('/images', (req, res, next) => {
    const relative = String(req.path || '').replace(/^\/+/, '');
    if (!relative || relative.includes('..')) return next();
    res.sendFile(path.join(getImagesDir(), relative), error => error ? next() : undefined);
});

router.post('/manual-adjust-attachments', (req, res, next) => {
    manualAdjustAttachmentUpload.single('file')(req, res, error => {
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: '附件不能超过 12 MB' });
        }
        return res.status(400).json({ error: error.message || '附件上传失败' });
    });
}, (req, res) => {
    const file = req.file;
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        return res.status(400).json({ error: '请选择需要上传的附件' });
    }

    const originalName = path.basename(String(file.originalname || 'attachment')).slice(0, 180);
    const extension = path.extname(originalName).toLowerCase();
    if (!MANUAL_ADJUST_ATTACHMENT_EXTENSIONS.has(extension)) {
        return res.status(400).json({ error: `不支持的附件格式：${extension || '无扩展名'}` });
    }

    const storedName = `manual-adjust-${crypto.randomUUID()}${extension}`;
    try {
        fs.writeFileSync(path.join(getImagesDir(), storedName), file.buffer, { flag: 'wx' });
        res.json({
            name: originalName,
            url: `/api/db/images/${encodeURIComponent(storedName)}`,
            type: String(file.mimetype || 'application/octet-stream'),
            size: file.size,
            uploadedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[POST /api/db/manual-adjust-attachments] failed:', error);
        res.status(500).json({ error: '附件保存失败' });
    }
});

router.post('/save', (req, res) => {
    let body;
    try {
        body = expandCompressedReportPayload(req.body);
    } catch (decodeErr) {
        console.error('[POST /api/db/save] compressed payload decode failed:', decodeErr);
        return res.status(400).json({ error: decodeErr.message || '压缩报表入库数据解码失败' });
    }

    if (req.body && req.body.transport && req.body.transport.compression) {
        console.log(
            `[REPORT COMPRESS] POST /api/db/save -> transport=${req.body.transport.compression}, ` +
            `original=${req.body.transport.originalBytes || '-'}, compressed=${req.body.transport.compressedBytes || '-'}`
        );
    }

    const { snapshot_id, month, standard_total_score, cat_scores, metric_data, raw_data, image_data } = body;
    
    if (!snapshot_id) {
        return res.status(400).json({ error: 'Missing snapshot_id' });
    }

    let image_path = null;
    if (image_data && image_data.startsWith('data:image/')) {
        const base64Data = image_data.replace(/^data:image\/\w+;base64,/, "");
        const filePath = path.join(getImagesDir(), `${snapshot_id}_${month}.png`);
        fs.writeFileSync(filePath, base64Data, 'base64');
        image_path = `/api/db/images/${snapshot_id}_${month}.png`;
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Delete existing data for this snapshot to allow re-saving
        db.run('DELETE FROM ReportSnapshots WHERE snapshot_id = ? AND month = ?', [snapshot_id, month]);
        db.run('DELETE FROM ReportCategoryScores WHERE snapshot_id = ? AND (month = ? OR month IS NULL)', [snapshot_id, month]);
        db.run('DELETE FROM ReportMetricData WHERE snapshot_id = ? AND (month = ? OR month IS NULL)', [snapshot_id, month]);

        // Save excel to disk if provided
        let excel_path = null;
        if (body.excel_data) {
            const matches = body.excel_data.match(/^data:(.+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                const filename = `${snapshot_id}_${month}.xlsx`;
                const fullPath = path.join(getImagesDir(), filename);
                fs.writeFileSync(fullPath, buffer);
                excel_path = `/api/db/images/${filename}`;
            }
        }

        let createdAtStr;
        if (body.created_at) {
            createdAtStr = new Date(body.created_at).toISOString().replace('T', ' ').substring(0, 19);
        } else {
            createdAtStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
        }

        db.run(`INSERT INTO ReportSnapshots (snapshot_id, month, created_at, stored_at, standard_total_score, raw_data_json, image_path, excel_path)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)`, 
                [snapshot_id, month, createdAtStr, standard_total_score, JSON.stringify(raw_data), image_path, excel_path], function(err) {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
        });

        const stmtCat = db.prepare(`INSERT INTO ReportCategoryScores (snapshot_id, month, cat_name, base_score, manual_score, final_score)
                                    VALUES (?, ?, ?, ?, ?, ?)`);
        for (const cat of (cat_scores || [])) {
            stmtCat.run([snapshot_id, month, cat.cat_name, cat.base_score, cat.manual_score, cat.final_score]);
        }
        stmtCat.finalize();

        const stmtMetric = db.prepare(`INSERT INTO ReportMetricData (snapshot_id, month, cat_name, metric_label, weight, target_val, raw_val, num_val, is_failing, gap, earned_score, proportional_scoring, completion_ratio)
                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const m of (metric_data || [])) {
            stmtMetric.run([
                snapshot_id,
                month,
                m.cat_name,
                m.metric_label,
                m.weight,
                m.target_val,
                m.raw_val,
                m.num_val,
                m.is_failing ? 1 : 0,
                m.gap,
                m.earned_score === undefined ? null : m.earned_score,
                m.proportional_scoring ? 1 : 0,
                m.completion_ratio === undefined ? null : m.completion_ratio
            ]);
        }
        stmtMetric.finalize();

        db.run('COMMIT', (err) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: '数据已成功入库' });
        });
    });
});

router.get('/snapshots', (req, res) => {
    db.all('SELECT snapshot_id, month, created_at, standard_total_score FROM ReportSnapshots ORDER BY id DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        markSqliteSource(res, 'GET /api/db/snapshots');
        res.json(rows);
    });
});

// Export only the Report Dashboard source history and saved report records.
// This is intentionally separate from the full-tenant backup workflow so the
// package can be merged into another site without changing its configuration.
router.get('/report-data-backup/export', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: '权限不足，需要超级管理员账号' });
    }
    try {
        const { buffer, manifest } = await reportDataTransfer.createBackupPackage();
        const date = new Date().toISOString().replace(/[:.]/g, '-');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="tools-report-data-${date}.zip"`);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Backup-Counts', Buffer.from(JSON.stringify(manifest.counts)).toString('base64'));
        res.send(buffer);
    } catch (error) {
        console.error('[GET /api/db/report-data-backup/export] failed:', error);
        res.status(500).json({ error: '导出报表历史数据失败' });
    }
});

router.post('/report-data-backup/import', reportBackupUpload.single('backup'), async (req, res) => {
    const uploadPath = req.file && req.file.path;
    try {
        if (!req.file) return res.status(400).json({ error: '请选择报表数据备份包' });
        const mode = req.body && req.body.mode === 'replace' ? 'replace' : 'merge';
        if (mode === 'replace' && req.body.confirmationText !== '确认清空恢复') {
            return res.status(400).json({ error: '清空恢复前必须输入“确认清空恢复”' });
        }
        const result = await reportDataTransfer.restoreBackupPackage(uploadPath, { mode });
        console.log(`[REPORT DATA RESTORE] mode=${mode}, sourceTenant=${result.sourceTenantId || '-'}, counts=${JSON.stringify(result.counts)}`);
        res.json(result);
    } catch (error) {
        console.error('[POST /api/db/report-data-backup/import] failed:', error);
        res.status(400).json({ error: error.message || '导入报表历史数据失败' });
    } finally {
        if (uploadPath) fs.rmSync(uploadPath, { force: true });
    }
});

function getFailingForSnapshot(snapshot, res) {
    db.all(
        'SELECT * FROM ReportMetricData WHERE snapshot_id = ? AND (month = ? OR month IS NULL) AND is_failing = 1',
        [snapshot.snapshot_id, snapshot.month],
        (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const grouped = {};
        rows.forEach(row => {
            if (!grouped[row.cat_name]) grouped[row.cat_name] = [];
            grouped[row.cat_name].push(row);
        });
        
        markSqliteSource(res, `GET /api/db/failing/${snapshot.snapshot_id}`);
        res.json({
            snapshot_id: snapshot.snapshot_id,
            month: snapshot.month,
            created_at: snapshot.created_at,
            failing_metrics: grouped,
            image_path: snapshot.image_path,
            excel_path: snapshot.excel_path,
            raw_data_json: snapshot.raw_data_json
        });
    });
}

router.get('/latest_failing', (req, res) => {
    db.get('SELECT * FROM ReportSnapshots ORDER BY id DESC LIMIT 1', (err, snapshot) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!snapshot) return res.json({ message: 'No snapshots found' });
        getFailingForSnapshot(snapshot, res);
    });
});

router.get('/failing/:snapshot_id', (req, res) => {
    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    const sql = month
        ? 'SELECT * FROM ReportSnapshots WHERE snapshot_id = ? AND month = ? ORDER BY id DESC LIMIT 1'
        : 'SELECT * FROM ReportSnapshots WHERE snapshot_id = ? ORDER BY id DESC LIMIT 1';
    const params = month ? [req.params.snapshot_id, month] : [req.params.snapshot_id];
    db.get(sql, params, (err, snapshot) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
        getFailingForSnapshot(snapshot, res);
    });
});

// Configuration Endpoints
router.get('/config/:key', (req, res) => {
    db.get('SELECT value_json FROM PlatformConfig WHERE key_name = ?', [req.params.key], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        markSqliteSource(res, `GET /api/db/config/${req.params.key}`);
        if (!row) return res.json({});
        try {
            res.json(JSON.parse(row.value_json));
        } catch (e) {
            res.json({});
        }
    });
});

router.post('/config/:key', (req, res) => {
    const publicEditableKeys = new Set(['bigscreen_contact_info', 'bigscreen_title', 'monthly_report_titles']);
    if (!publicEditableKeys.has(req.params.key) && (!req.user || req.user.role !== 'admin')) {
        return res.status(403).json({ error: '没有权限，仅管理员可修改配置' });
    }

    let configValue = req.body;
    if (req.params.key === 'monthly_report_titles') {
        if (!configValue || typeof configValue !== 'object' || Array.isArray(configValue)) {
            return res.status(400).json({ error: '月报标题格式无效' });
        }
        const zh = typeof configValue.zh === 'string' ? configValue.zh.trim() : '';
        const en = typeof configValue.en === 'string' ? configValue.en.trim() : '';
        if (!zh || !en) {
            return res.status(400).json({ error: '中英文月报标题均不能为空' });
        }
        if (zh.length > 120 || en.length > 120) {
            return res.status(400).json({ error: '月报标题不能超过 120 个字符' });
        }
        configValue = { zh, en };
    }

    if (req.params.key === 'report_snapshot_filter') {
        const filter = require('../../frontend/js/report/snapshot-filter');
        if (!configValue || typeof configValue !== 'object' || Array.isArray(configValue) || !filter.valid(configValue.minSourceTables)) {
            return res.status(400).json({ error: '最少表源数必须为 0–10000 的整数', code: 'INVALID_SNAPSHOT_FILTER' });
        }
        configValue = { minSourceTables: configValue.minSourceTables };
    }

    const valueJson = JSON.stringify(configValue);
    // Keep the request tenant through native SQLite callbacks.
    const configDb = getConnection('report.db', 'report');
    configDb.get('SELECT value_json FROM PlatformConfig WHERE key_name = ?', [req.params.key], AsyncLocalStorage.bind((beforeErr, beforeRow) => {
        if (beforeErr) return res.status(500).json({ error: beforeErr.message });
        let beforeValue = {};
        try {
            beforeValue = beforeRow ? JSON.parse(beforeRow.value_json || '{}') : {};
        } catch (_err) {
            beforeValue = {};
        }
        configDb.run('INSERT INTO PlatformConfig (key_name, value_json) VALUES (?, ?) ON CONFLICT(key_name) DO UPDATE SET value_json = ?, updated_at = CURRENT_TIMESTAMP',
            [req.params.key, valueJson, valueJson],
            AsyncLocalStorage.bind(function(err) {
            if (err) return res.status(500).json({ error: err.message });
            configChangeMonitor.recordConfigChangeAlert({
                req,
                action: '报表/大屏平台配置变化',
                before: beforeValue,
                after: configValue,
                objectType: 'report_platform_config',
                objectId: req.params.key
            });
            res.json({ success: true });
            })
        );
    }));
});

router.get('/monthly_report_data', (req, res) => {
    const { startDate, endDate } = req.query;
    const whereParts = [];
    const params = [];
    
    if (startDate && endDate) {
        whereParts.push('DATE(created_at) >= ? AND DATE(created_at) <= ?');
        params.push(startDate, endDate);
    }
    const dateFilter = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const sqlDaily = `
        SELECT s.snapshot_id, s.month, DATE(s.created_at) as date, s.created_at, s.standard_total_score, s.raw_data_json 
        FROM ReportSnapshots s
        INNER JOIN (
            SELECT DATE(created_at) as d, MAX(id) as max_id
            FROM ReportSnapshots
            ${dateFilter}
            GROUP BY DATE(created_at)
        ) latest ON s.id = latest.max_id
        ORDER BY date ASC
    `;

    db.all(sqlDaily, params, (err, dailySnapshots) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (dailySnapshots.length === 0) {
            markSqliteSource(res, 'GET /api/db/monthly_report_data');
            return res.json({ trends: [], latest_snapshot: null });
        }

        const snapshotIds = [...new Set(dailySnapshots.map(s => s.snapshot_id))];
        const placeholders = snapshotIds.map(() => '?').join(',');
        const snapshotKeySet = new Set(dailySnapshots.map(s => `${s.snapshot_id}@@${s.month || ''}`));
        const snapshotMonthById = {};
        dailySnapshots.forEach(s => { snapshotMonthById[s.snapshot_id] = s.month || ''; });
        
        db.all(`SELECT snapshot_id, month, cat_name, final_score FROM ReportCategoryScores WHERE snapshot_id IN (${placeholders})`, snapshotIds, (err, catScores) => {
            if (err) return res.status(500).json({ error: err.message });
            catScores = catScores.filter(row => snapshotKeySet.has(`${row.snapshot_id}@@${row.month || ''}`) || row.month === null);

            db.all(`SELECT snapshot_id, month, COUNT(*) as total_metrics, SUM(CASE WHEN is_failing = 1 THEN 1 ELSE 0 END) as failing_metrics FROM ReportMetricData WHERE snapshot_id IN (${placeholders}) GROUP BY snapshot_id, month`, snapshotIds, (err, metricStatsRows) => {
                if (err) return res.status(500).json({ error: err.message });
                metricStatsRows = metricStatsRows.filter(row => snapshotKeySet.has(`${row.snapshot_id}@@${row.month || ''}`) || row.month === null);

                const metricStatsMap = {};
                metricStatsRows.forEach(row => {
                    const key = `${row.snapshot_id}@@${row.month || snapshotMonthById[row.snapshot_id] || ''}`;
                    metricStatsMap[key] = {
                        total: row.total_metrics,
                        failing: row.failing_metrics || 0
                    };
                });

                const catScoreMap = {};
                catScores.forEach(cs => {
                    const key = `${cs.snapshot_id}@@${cs.month || snapshotMonthById[cs.snapshot_id] || ''}`;
                    if (!catScoreMap[key]) catScoreMap[key] = {};
                    catScoreMap[key][cs.cat_name] = cs.final_score;
                });

                const trends = dailySnapshots.map(s => {
                    const key = `${s.snapshot_id}@@${s.month || ''}`;
                    const stats = metricStatsMap[key] || { total: 0, failing: 0 };
                    let complianceRate = 0;
                    if (stats.total > 0) {
                        complianceRate = ((stats.total - stats.failing) / stats.total) * 100;
                    }
                    return {
                        date: s.date,
                        snapshot_id: s.snapshot_id,
                        month: s.month,
                        total_score: s.standard_total_score,
                        cat_scores: catScoreMap[key] || {},
                        compliance_rate: complianceRate,
                        metrics_total: stats.total,
                        metrics_failing: stats.failing,
                        raw_data_json: s.raw_data_json
                    };
                });

                const latestDailySnapshot = dailySnapshots[dailySnapshots.length - 1];
                const latestSnapshotId = latestDailySnapshot.snapshot_id;
                const latestMonth = latestDailySnapshot.month;
                
                const prevDailySnapshot = dailySnapshots.length > 1 ? dailySnapshots[dailySnapshots.length - 2] : null;

                db.all(`SELECT * FROM ReportCategoryScores WHERE snapshot_id = ? AND (month = ? OR month IS NULL)`, [latestSnapshotId, latestMonth], (err, latestCatScores) => {
                    if (err) return res.status(500).json({ error: err.message });

                    db.all(`SELECT * FROM ReportMetricData WHERE snapshot_id = ? AND (month = ? OR month IS NULL)`, [latestSnapshotId, latestMonth], (err, latestMetrics) => {
                        if (err) return res.status(500).json({ error: err.message });
                        
                        const finishResponse = (prevMetrics) => {
                            db.get(`SELECT raw_data_json FROM ReportSnapshots WHERE snapshot_id = ? AND month = ? ORDER BY id DESC LIMIT 1`, [latestSnapshotId, latestMonth], (err, snapRow) => {
                                if (err) return res.status(500).json({ error: err.message });
                                markSqliteSource(res, 'GET /api/db/monthly_report_data');
                                res.json({
                                    trends: trends,
                                    latest_snapshot: {
                                        snapshot_id: latestSnapshotId,
                                        month: latestMonth,
                                        total_score: latestDailySnapshot.standard_total_score,
                                        cat_scores: latestCatScores,
                                        metrics: latestMetrics,
                                        previous_metrics: prevMetrics,
                                        raw_data_json: snapRow ? snapRow.raw_data_json : null
                                    }
                                });
                            });
                        };

                        if (prevDailySnapshot) {
                            db.all(`SELECT * FROM ReportMetricData WHERE snapshot_id = ? AND (month = ? OR month IS NULL)`, [prevDailySnapshot.snapshot_id, prevDailySnapshot.month], (err, prevMetrics) => {
                                if (err) return res.status(500).json({ error: err.message });
                                finishResponse(prevMetrics);
                            });
                        } else {
                            finishResponse([]);
                        }
                    });
                });
            });
        });
    });
});

router.get('/metric_count_trends', (req, res) => {
    const daysRaw = parseInt(req.query.days, 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 90;
    const sinceModifier = `-${days} days`;

    const trendSql = `
        SELECT
            s.id AS snapshot_row_id,
            s.snapshot_id,
            s.month,
            s.created_at,
            COUNT(m.id) AS sub_metric_count,
            COUNT(DISTINCT m.metric_label) AS overall_metric_count
        FROM ReportSnapshots s
        LEFT JOIN ReportMetricData m
            ON m.snapshot_id = s.snapshot_id
           AND (m.month = s.month OR m.month IS NULL)
        WHERE DATE(s.created_at) >= DATE('now', ?)
        GROUP BY s.id
        ORDER BY datetime(s.created_at) ASC, s.id ASC
    `;

    const recentSql = `
        SELECT
            s.id AS snapshot_row_id,
            s.snapshot_id,
            s.month,
            s.created_at,
            COUNT(m.id) AS sub_metric_count,
            COUNT(DISTINCT m.metric_label) AS overall_metric_count
        FROM ReportSnapshots s
        LEFT JOIN ReportMetricData m
            ON m.snapshot_id = s.snapshot_id
           AND (m.month = s.month OR m.month IS NULL)
        GROUP BY s.id
        ORDER BY datetime(s.created_at) DESC, s.id DESC
        LIMIT 3
    `;

    const categorySql = `
        SELECT
            s.id AS snapshot_row_id,
            m.cat_name,
            COUNT(m.id) AS sub_metric_count,
            COUNT(DISTINCT m.metric_label) AS metric_count
        FROM ReportSnapshots s
        JOIN ReportMetricData m
            ON m.snapshot_id = s.snapshot_id
           AND (m.month = s.month OR m.month IS NULL)
        WHERE DATE(s.created_at) >= DATE('now', ?)
        GROUP BY s.id, m.cat_name
        ORDER BY s.id ASC, m.cat_name ASC
    `;

    db.all(trendSql, [sinceModifier], (err, trendRows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(recentSql, [], (err, recentRows) => {
            if (err) return res.status(500).json({ error: err.message });
            db.all(categorySql, [sinceModifier], (err, categoryRows) => {
                if (err) return res.status(500).json({ error: err.message });

                const categoryMap = {};
                categoryRows.forEach(row => {
                    const key = String(row.snapshot_row_id);
                    if (!categoryMap[key]) categoryMap[key] = {};
                    categoryMap[key][row.cat_name || '未分组'] = {
                        sub_metric_count: row.sub_metric_count || 0,
                        metric_count: row.metric_count || 0
                    };
                });

                const normalize = row => ({
                    snapshot_row_id: row.snapshot_row_id,
                    snapshot_id: row.snapshot_id,
                    month: row.month,
                    created_at: row.created_at,
                    overall_metric_count: row.overall_metric_count || 0,
                    sub_metric_count: row.sub_metric_count || 0,
                    category_counts: categoryMap[String(row.snapshot_row_id)] || {}
                });

                markSqliteSource(res, 'GET /api/db/metric_count_trends');
                res.json({
                    days,
                    trends: trendRows.map(normalize),
                    recent: recentRows.map(normalize)
                });
            });
        });
    });
});

function parseSnapshotRaw(row) {
    try {
        return JSON.parse(row.raw_data_json || '{}') || {};
    } catch (_err) {
        return {};
    }
}

function cleanAlertLabel(value, fallback = '未分类预警') {
    const text = String(value || fallback)
        .replace(/[^\S\r\n]+/g, ' ')
        .replace(/^[\s🔧🧯📞⚠️⭐]+/u, '')
        .trim();
    return text || fallback;
}

function getTicketType(ticket) {
    const collection = cleanAlertLabel(ticket && ticket.collection, '');
    const title = cleanAlertLabel(ticket && ticket.title, '');
    if (collection && title) return `${collection} / ${title}`;
    return title || collection || '临期单据';
}

function getTicketNetwork(ticket) {
    const data = ticket && ticket.data && typeof ticket.data === 'object' ? ticket.data : {};
    return cleanAlertLabel(
        ticket.network || ticket.cat_name || ticket.category || ticket.customer_group ||
        data.customer_group || data.cat_name || data.network || data.network_name ||
        data.repoffice_cn_name || data.repoffice_en_name ||
        data.region_cn_name || data.region_en_name ||
        data.country_cn_name || data.country_en_name ||
        data.office || data.region,
        '未识别网络'
    );
}

function getSpecialAlertType(alert) {
    const metric = alert && (alert.metric_label || alert.metricLabel);
    const type = alert && alert.type;
    if (metric) return `特殊指标 / ${cleanAlertLabel(metric)}`;
    return `特殊指标 / ${cleanAlertLabel(type, '指标提醒')}`;
}

function incCount(map, key, amount = 1) {
    const finalKey = cleanAlertLabel(key);
    map[finalKey] = (map[finalKey] || 0) + amount;
}

function summarizeWarningSnapshot(row) {
    const raw = parseSnapshotRaw(row);
    const tickets = Array.isArray(raw.expiringTickets) ? raw.expiringTickets : [];
    const alerts = Array.isArray(raw.specialMetricAlerts) ? raw.specialMetricAlerts : [];
    const type_counts = {};
    const network_counts = {};

    tickets.forEach(ticket => {
        incCount(type_counts, getTicketType(ticket));
        incCount(network_counts, getTicketNetwork(ticket));
    });
    alerts.forEach(alert => {
        incCount(type_counts, getSpecialAlertType(alert));
        incCount(network_counts, '整体');
    });

    return {
        snapshot_row_id: row.id,
        snapshot_id: row.snapshot_id,
        month: row.month,
        created_at: row.created_at,
        total_warning_count: tickets.length + alerts.length,
        expiring_ticket_count: tickets.length,
        special_metric_alert_count: alerts.length,
        type_counts,
        network_counts
    };
}

router.get('/expiring_warning_trends', (req, res) => {
    const daysRaw = parseInt(req.query.days, 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 90;
    const sinceModifier = `-${days} days`;
    const selectSql = `
        SELECT id, snapshot_id, month, created_at, raw_data_json
        FROM ReportSnapshots
        WHERE DATE(created_at) >= DATE('now', ?)
        ORDER BY datetime(created_at) ASC, id ASC
    `;
    const recentSql = `
        SELECT id, snapshot_id, month, created_at, raw_data_json
        FROM ReportSnapshots
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 3
    `;

    db.all(selectSql, [sinceModifier], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(recentSql, [], (err, recentRows) => {
            if (err) return res.status(500).json({ error: err.message });
            markSqliteSource(res, 'GET /api/db/expiring_warning_trends');
            res.json({
                days,
                trends: rows.map(summarizeWarningSnapshot),
                recent: recentRows.map(summarizeWarningSnapshot)
            });
        });
    });
});

function getMetricTrendSnapshotRows(months, callback) {
    const monthOffset = `-${Math.max(0, months - 1)} months`;
    const sql = `
        SELECT id, snapshot_id, month, created_at, raw_data_json,
               strftime('%Y-%m', created_at) AS trend_month
        FROM ReportSnapshots
        WHERE DATE(created_at) >= DATE('now', 'start of month', ?)
        ORDER BY datetime(created_at) ASC, id ASC
    `;
    db.all(sql, [monthOffset], (err, rows) => {
        if (err) return callback(err);
        callback(null, selectLatestSnapshotPerMonth(rows));
    });
}

function calcManualAdjustScore(item, count) {
    const unit = Number(item && item.unit) || 0;
    const cap = item && item.cap !== null && item.cap !== undefined && item.cap !== '' ? Number(item.cap) : null;
    const rawScore = Math.max(0, Number(count) || 0) * unit;
    const capped = Number.isFinite(cap) && cap > 0 ? Math.min(rawScore, cap) : rawScore;
    return item && item.type === '加分' ? capped : -capped;
}

function parseMetricTargetValue(value) {
    const text = String(value || '').trim();
    if (!text || text === '--') return null;
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const condition = /≤|<=|小于|不高于|低于/.test(text) ? 'lte' : 'gte';
    return {
        raw: text,
        value: Number(match[0]),
        condition
    };
}

router.get('/metric_item_trend', (req, res) => {
    const label = String(req.query.label || '').trim();
    const kind = String(req.query.kind || 'metric');
    const monthsRaw = parseInt(req.query.months, 10);
    const months = Number.isFinite(monthsRaw) && monthsRaw > 0 ? Math.min(monthsRaw, 24) : 6;
    if (!label) return res.status(400).json({ error: 'Missing label' });

    getMetricTrendSnapshotRows(months, (err, snapshots) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!snapshots.length) {
            markSqliteSource(res, 'GET /api/db/metric_item_trend');
            return res.json({ label, kind, months, sampling: 'monthly_latest', trends: [] });
        }

        if (kind === 'manual') {
            const trends = snapshots.map(row => {
                const raw = parseSnapshotRaw(row);
                const items = Array.isArray(raw.manualAdjustItems) ? raw.manualAdjustItems : [];
                const adjustData = raw.manualAdjustData && typeof raw.manualAdjustData === 'object' ? raw.manualAdjustData : {};
                const matched = items
                    .map((item, index) => ({ item, index }))
                    .filter(entry => entry.item && !entry.item.deleted && entry.item.name === label);
                const series = {};
                let totalValue = 0;
                let totalScore = 0;
                Object.keys(adjustData).forEach(cat => {
                    let count = 0;
                    let score = 0;
                    matched.forEach(({ item, index }) => {
                        const val = Number(adjustData[cat] && adjustData[cat][index]) || 0;
                        count += val;
                        score += calcManualAdjustScore(item, val);
                    });
                    if (count !== 0 || score !== 0) {
                        series[cat] = { value: count, score, raw: String(count) };
                        totalValue += count;
                        totalScore += score;
                    }
                });
                return {
                    snapshot_id: row.snapshot_id,
                    month: row.month,
                    trend_month: row.trend_month,
                    created_at: row.created_at,
                    total_value: totalValue,
                    total_score: totalScore,
                    series
                };
            });
            markSqliteSource(res, 'GET /api/db/metric_item_trend');
            return res.json({ label, kind, months, sampling: 'monthly_latest', trends });
        }

        const snapshotIds = snapshots.map(row => row.snapshot_id);
        const placeholders = snapshotIds.map(() => '?').join(',');
        const sql = `
            SELECT snapshot_id, month, cat_name, raw_val, num_val, target_val, is_failing, gap
            FROM ReportMetricData
            WHERE metric_label = ? AND snapshot_id IN (${placeholders})
        `;
        db.all(sql, [label, ...snapshotIds], (err, metricRows) => {
            if (err) return res.status(500).json({ error: err.message });
            const byKey = {};
            metricRows.forEach(row => {
                const key = `${row.snapshot_id}@@${row.month || ''}`;
                if (!byKey[key]) byKey[key] = [];
                byKey[key].push(row);
            });
            const trends = snapshots.map(row => {
                const key = `${row.snapshot_id}@@${row.month || ''}`;
                const rows = byKey[key] || byKey[`${row.snapshot_id}@@`] || [];
                const series = {};
                rows.forEach(item => {
                    const cat = item.cat_name || '整体';
                    series[cat] = {
                        value: Number.isFinite(Number(item.num_val)) ? Number(item.num_val) : null,
                        raw: item.raw_val,
                        target_raw: item.target_val || '',
                        target_value: parseMetricTargetValue(item.target_val)?.value ?? null,
                        is_failing: !!item.is_failing,
                        gap: item.gap || ''
                    };
                });
                const overall = series['整体'];
                const numericValues = Object.values(series)
                    .map(item => Number(item.value))
                    .filter(Number.isFinite);
                const totalValue = overall && Number.isFinite(Number(overall.value))
                    ? Number(overall.value)
                    : (numericValues.length ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length : null);
                return {
                    snapshot_id: row.snapshot_id,
                    month: row.month,
                    trend_month: row.trend_month,
                    created_at: row.created_at,
                    total_value: totalValue,
                    total_score: null,
                    series
                };
            });
            const monthTargets = {};
            metricRows.forEach(row => {
                const month = Number(row.month);
                if (!Number.isFinite(month)) return;
                const parsed = parseMetricTargetValue(row.target_val);
                if (!parsed || !Number.isFinite(parsed.value)) return;
                if (!monthTargets[month]) {
                    monthTargets[month] = {
                        month,
                        value: parsed.value,
                        raw: parsed.raw,
                        condition: parsed.condition
                    };
                }
            });
            const availableMonths = Object.keys(monthTargets).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
            const latestTrendMonth = trends.slice().reverse().map(row => Number(row.month)).find(Number.isFinite);
            const currentMonth = Number.isFinite(latestTrendMonth) && monthTargets[latestTrendMonth]
                ? latestTrendMonth
                : availableMonths[availableMonths.length - 1];
            const previousMonth = Number.isFinite(currentMonth)
                ? (monthTargets[currentMonth - 1] ? currentMonth - 1 : availableMonths.filter(month => month < currentMonth).pop())
                : null;
            markSqliteSource(res, 'GET /api/db/metric_item_trend');
            res.json({
                label,
                kind: 'metric',
                months,
                sampling: 'monthly_latest',
                trends,
                targets: {
                    current: Number.isFinite(currentMonth) ? monthTargets[currentMonth] || null : null,
                    previous: Number.isFinite(previousMonth) ? monthTargets[previousMonth] || null : null
                }
            });
        });
    });
});

router.get('/bigscreen_owners', (req, res) => {
    db.all(
        `SELECT id, cat_name, metric_label, owner_name, emp_id, avatar, updated_at
         FROM BigscreenOwners
         ORDER BY cat_name ASC, metric_label ASC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            markSqliteSource(res, 'GET /api/db/bigscreen_owners');
            res.json(rows || []);
        }
    );
});

router.post('/bigscreen_owners', (req, res) => {
    const rows = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const normalized = rows
        .map(item => ({
            cat_name: String(item.cat_name || '').trim(),
            metric_label: String(item.metric_label || '').trim(),
            owner_name: String(item.owner_name || '').trim(),
            emp_id: String(item.emp_id || '').trim(),
            avatar: String(item.avatar || '').trim()
        }))
        .filter(item => item.cat_name && item.owner_name);

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run('DELETE FROM BigscreenOwners', err => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }

            const stmt = db.prepare(
                `INSERT INTO BigscreenOwners (cat_name, metric_label, owner_name, emp_id, avatar, updated_at)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(cat_name, metric_label) DO UPDATE SET
                    owner_name = excluded.owner_name,
                    emp_id = excluded.emp_id,
                    avatar = excluded.avatar,
                    updated_at = CURRENT_TIMESTAMP`
            );

            for (const item of normalized) {
                stmt.run([item.cat_name, item.metric_label, item.owner_name, item.emp_id, item.avatar]);
            }
            stmt.finalize(err => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
                db.run('COMMIT', err => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }
                    markSqliteSource(res, 'POST /api/db/bigscreen_owners');
                    res.json({ success: true, count: normalized.length });
                });
            });
        });
    });
});

router.closeDatabase = async function closeDatabase() {};

module.exports = router;
