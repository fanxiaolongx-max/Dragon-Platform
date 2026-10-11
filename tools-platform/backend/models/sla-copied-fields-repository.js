/**
 * sla-copied-fields-repository.js - SLA 详表常用复制字段持久化与统计仓储
 * 记录不同详单类型（整改/CPT专项/常规风险/SR/漏洞预警等）下用户复制字段的频次与时间
 */
const { run, get, all } = require('./app-db');

let initPromise = null;

async function ensureReady() {
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS sla_copied_field_stats (
                    table_type TEXT NOT NULL,
                    field_name TEXT NOT NULL,
                    copy_count INTEGER DEFAULT 1,
                    last_copied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (table_type, field_name)
                )
            `);
            await run(`
                CREATE INDEX IF NOT EXISTS idx_sla_copied_table_type
                ON sla_copied_field_stats(table_type, copy_count DESC, last_copied_at DESC)
            `);
        })().catch(err => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}

function normalizeTableType(tableType) {
    if (!tableType) return 'general';
    return String(tableType).trim().toLowerCase();
}

function normalizeFieldName(fieldName) {
    if (!fieldName) return '';
    return String(fieldName).trim();
}

const DEFAULT_FREQUENT_FIELDS = {
    rectification: ['task_id', 'task_owner', 'fullname', 'product_line_name', 'network_name'],
    special: ['task_id', 'network_name', 'owner_show'],
    risk: ['task_id', 'network', 'product_level_l1', 'product', 'current_handler', 'current_handler_name'],
    sr: ['sr_num', 't1_operator', 'product_line_map', 'product', 'sr_owner'],
    vulnerability: ['task_id', 'task_status', 'network_customer_name', 'task_owner_name']
};

/**
 * 记录字段复制事件（频次自增，更新最后复制时间）
 */
async function recordFieldCopy(tableTypeInput, fieldNameInput) {
    await ensureReady();
    const tableType = normalizeTableType(tableTypeInput);
    const fieldName = normalizeFieldName(fieldNameInput);
    if (!fieldName) {
        throw new Error('fieldName cannot be empty');
    }

    await run(`
        INSERT INTO sla_copied_field_stats (table_type, field_name, copy_count, last_copied_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(table_type, field_name) DO UPDATE SET
            copy_count = sla_copied_field_stats.copy_count + 1,
            last_copied_at = CURRENT_TIMESTAMP
    `, [tableType, fieldName]);

    const updated = await get(`
        SELECT table_type AS tableType, field_name AS fieldName, copy_count AS copyCount, last_copied_at AS lastCopiedAt
        FROM sla_copied_field_stats
        WHERE table_type = ? AND field_name = ?
    `, [tableType, fieldName]);

    return updated;
}

/**
 * 获取指定详单类型或全部类型的常用复制字段统计
 */
async function getCopiedFieldStats(tableTypeInput = null) {
    await ensureReady();
    if (tableTypeInput) {
        const tableType = normalizeTableType(tableTypeInput);
        const rows = await all(`
            SELECT table_type AS tableType, field_name AS fieldName, copy_count AS copyCount, last_copied_at AS lastCopiedAt
            FROM sla_copied_field_stats
            WHERE table_type = ?
            ORDER BY copy_count DESC, last_copied_at DESC
        `, [tableType]);

        const frequentFields = rows.map(r => r.fieldName);
        const fieldCounts = {};
        rows.forEach(r => { fieldCounts[r.fieldName] = r.copyCount; });

        return {
            tableType,
            items: rows,
            frequentFields,
            fieldCounts,
            defaultFrequentFields: DEFAULT_FREQUENT_FIELDS[tableType] || []
        };
    }

    const rows = await all(`
        SELECT table_type AS tableType, field_name AS fieldName, copy_count AS copyCount, last_copied_at AS lastCopiedAt
        FROM sla_copied_field_stats
        ORDER BY table_type ASC, copy_count DESC, last_copied_at DESC
    `);

    const stats = {};
    const frequentFields = {};
    const fieldCounts = {};
    rows.forEach(r => {
        if (!stats[r.tableType]) {
            stats[r.tableType] = [];
            frequentFields[r.tableType] = [];
            fieldCounts[r.tableType] = {};
        }
        stats[r.tableType].push(r);
        frequentFields[r.tableType].push(r.fieldName);
        fieldCounts[r.tableType][r.fieldName] = r.copyCount;
    });

    return {
        items: rows,
        stats,
        frequentFields,
        fieldCounts
    };
}

/**
 * 删除单个字段或某表全部字段的复制统计
 */
async function deleteCopiedField(tableTypeInput, fieldNameInput = null) {
    await ensureReady();
    const tableType = normalizeTableType(tableTypeInput);
    if (fieldNameInput) {
        const fieldName = normalizeFieldName(fieldNameInput);
        await run(`
            DELETE FROM sla_copied_field_stats
            WHERE table_type = ? AND field_name = ?
        `, [tableType, fieldName]);
    } else {
        await run(`
            DELETE FROM sla_copied_field_stats
            WHERE table_type = ?
        `, [tableType]);
    }
    return { success: true };
}

/**
 * 全量替换复制字段统计（用于配置导入）
 */
async function replaceCopiedFields(data) {
    await ensureReady();
    await run(`DELETE FROM sla_copied_field_stats`);
    if (!data) return;

    if (Array.isArray(data)) {
        for (const item of data) {
            if (item && item.tableType && item.fieldName) {
                await run(`
                    INSERT OR REPLACE INTO sla_copied_field_stats (table_type, field_name, copy_count, last_copied_at)
                    VALUES (?, ?, ?, ?)
                `, [
                    normalizeTableType(item.tableType),
                    normalizeFieldName(item.fieldName),
                    parseInt(item.copyCount, 10) || 1,
                    item.lastCopiedAt || new Date().toISOString()
                ]);
            }
        }
    } else if (typeof data === 'object') {
        for (const [tableType, fields] of Object.entries(data)) {
            if (Array.isArray(fields)) {
                for (const f of fields) {
                    const fieldName = typeof f === 'string' ? f : (f.fieldName || f.name);
                    const count = typeof f === 'object' && f.copyCount ? f.copyCount : 1;
                    const time = typeof f === 'object' && f.lastCopiedAt ? f.lastCopiedAt : new Date().toISOString();
                    if (fieldName) {
                        await run(`
                            INSERT OR REPLACE INTO sla_copied_field_stats (table_type, field_name, copy_count, last_copied_at)
                            VALUES (?, ?, ?, ?)
                        `, [
                            normalizeTableType(tableType),
                            normalizeFieldName(fieldName),
                            parseInt(count, 10) || 1,
                            time
                        ]);
                    }
                }
            }
        }
    }
}

/**
 * 导出全量统计数据（用于配置导出）
 */
async function getAllForExport() {
    await ensureReady();
    const rows = await all(`
        SELECT table_type AS tableType, field_name AS fieldName, copy_count AS copyCount, last_copied_at AS lastCopiedAt
        FROM sla_copied_field_stats
        ORDER BY table_type ASC, copy_count DESC
    `);
    return rows;
}

module.exports = {
    ensureReady,
    recordFieldCopy,
    getCopiedFieldStats,
    deleteCopiedField,
    replaceCopiedFields,
    getAllForExport,
    DEFAULT_FREQUENT_FIELDS
};
