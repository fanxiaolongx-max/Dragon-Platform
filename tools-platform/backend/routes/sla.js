/**
 * Task SLA Killer 路由
 * 持久化存储：全局预警目标 + 每张表的用户偏好设置（列宽/显示/排序/指标规则）
 */
const express = require('express');
const router = express.Router();
const zlib = require('zlib');
const crypto = require('crypto');
const targetsRepo = require('../models/sla-targets-repository');
const prefsRepo = require('../models/sla-prefs-repository');
const copiedFieldsRepo = require('../models/sla-copied-fields-repository');
const categoriesRepo = require('../models/sla-categories-repository');
const categoryCascadeRepo = require('../models/sla-category-cascade-repository');
const groupsRepo = require('../models/sla-groups-repository');
const snapshotsRepo = require('../models/sla-snapshots-repository');
const ruleTemplatesRepo = require('../models/sla-rule-templates-repository');
const auditLogRepo = require('../models/audit-log-repository');
const configChangeMonitor = require('../models/config-change-monitor');

function getRequestSource(req) {
    return req.get('x-tools-source') || req.get('referer') || req.originalUrl || '';
}

function getRequestActor(req) {
    return req.user?.username || req.user?.name || req.session?.user?.username || req.ip || '';
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function hashObject(value) {
    return crypto.createHash('sha256').update(stableStringify(value || {})).digest('hex').slice(0, 16);
}

function describeChangedTargetField(field) {
    const monthMatch = String(field).match(/^([1-9]|1[0-2])$/);
    if (monthMatch) return `${monthMatch[1]}月目标`;
    const names = {
        label: '指标名称',
        type: '达标类型',
        weight: '权重',
        autoFill: '自动填充',
        isPercent: '百分比口径',
        exceedBy: '超额阈值',
        bonus: '加分值'
    };
    return names[field] || field;
}

function summarizeChangedTargetItem(key, beforeItem = {}, afterItem = {}) {
    const before = beforeItem && typeof beforeItem === 'object' ? beforeItem : {};
    const after = afterItem && typeof afterItem === 'object' ? afterItem : {};
    const fieldSet = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changedFields = [...fieldSet]
        .filter(field => stableStringify(before[field]) !== stableStringify(after[field]))
        .slice(0, 20);
    return {
        key,
        label: after.label || before.label || key,
        changedFields: changedFields.map(field => ({
            field,
            name: describeChangedTargetField(field),
            before: before[field],
            after: after[field]
        }))
    };
}

function summarizeChangedPrefItem(key, beforeValue, afterValue) {
    return {
        key,
        before: beforeValue,
        after: afterValue
    };
}

function summarizeConfig({ targets = {}, prefs = {} } = {}) {
    const schemaPrefs = Object.entries(prefs || {})
        .filter(([, pref]) => pref && Array.isArray(pref.customMetrics));
    const labels = [];
    let subMetricCount = 0;

    schemaPrefs.forEach(([, pref]) => {
        pref.customMetrics.forEach(metric => {
            if (metric && metric.label) labels.push(metric.label);
            subMetricCount += Array.isArray(metric?.subMetrics) ? metric.subMetrics.length : 0;
        });
    });

    const uniqueLabels = Array.from(new Set(labels)).sort();
    return {
        targetCount: Object.keys(targets || {}).length,
        prefCount: Object.keys(prefs || {}).length,
        schemaPrefCount: schemaPrefs.length,
        mainMetricCount: labels.length,
        subMetricCount,
        labels: uniqueLabels,
        hash: hashObject({ targets, prefs })
    };
}

function diffConfigSummary(before, after) {
    const beforeLabels = new Set(before.labels || []);
    const afterLabels = new Set(after.labels || []);
    const removedLabels = [...beforeLabels].filter(label => !afterLabels.has(label)).sort();
    const addedLabels = [...afterLabels].filter(label => !beforeLabels.has(label)).sort();
    return {
        before: {
            targetCount: before.targetCount,
            prefCount: before.prefCount,
            schemaPrefCount: before.schemaPrefCount,
            mainMetricCount: before.mainMetricCount,
            subMetricCount: before.subMetricCount,
            hash: before.hash
        },
        after: {
            targetCount: after.targetCount,
            prefCount: after.prefCount,
            schemaPrefCount: after.schemaPrefCount,
            mainMetricCount: after.mainMetricCount,
            subMetricCount: after.subMetricCount,
            hash: after.hash
        },
        removedLabels,
        addedLabels
    };
}

function isDestructiveConfigChange(diff) {
    const mainDrop = diff.before.mainMetricCount - diff.after.mainMetricCount;
    const subDrop = diff.before.subMetricCount - diff.after.subMetricCount;
    const schemaDrop = diff.before.schemaPrefCount - diff.after.schemaPrefCount;
    return mainDrop >= 5 || subDrop >= 10 || schemaDrop >= 5 || diff.removedLabels.length >= 5;
}

async function writeAudit(req, action, summary) {
    try {
        await auditLogRepo.addAuditLog({
            scope: 'sla',
            action,
            actor: getRequestActor(req),
            source: getRequestSource(req),
            summary: {
                ...(summary || {}),
                request: configChangeMonitor.buildRequestContext(req)
            }
        });
    } catch (err) {
        console.error('[audit_log] write failed:', err.message);
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

function expandCompressedSnapshot(body) {
    const transportCompression = body && body.transport && body.transport.compression;
    if (!transportCompression) return body;

    const snapshotText = decodeCompressedTextField(body.compressedSnapshot, 'SLA 快照');
    const snapshot = JSON.parse(snapshotText);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('SLA 快照解压后格式无效');
    }
    return snapshot;
}

// ──────────────────────────────────────────────────────────
// 全局字典配置 (例如：指标分类)
// ──────────────────────────────────────────────────────────

// GET /api/sla/categories
router.get('/categories', async (req, res) => {
    try {
        const { items, source } = await categoriesRepo.listCategories({
            mode: req.query.mode || 'auto'
        });
        res.setHeader('X-Data-Source', source);
        console.log(`[DATA SOURCE] GET /api/sla/categories -> ${source.toUpperCase()}`);
        res.json(items);
    } catch (err) {
        console.error('[GET /api/sla/categories] failed:', err);
        res.status(500).json({ error: '读取分类失败' });
    }
});

// PUT /api/sla/categories
router.put('/categories', async (req, res) => {
    const cats = req.body;
    if (!Array.isArray(cats)) return res.status(400).json({ error: '必须是数组' });
    try {
        const beforeCats = (await categoriesRepo.listCategories({ mode: 'auto' })).items;
        await categoriesRepo.replaceCategories(cats);
        configChangeMonitor.recordConfigChangeAlert({
            req,
            action: 'SLA 分类配置变化',
            before: beforeCats,
            after: cats,
            objectType: 'sla_categories',
            objectId: 'global'
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[PUT /api/sla/categories] failed:', err);
        res.status(500).json({ error: '保存分类失败' });
    }
});

// GET /api/sla/categories/:name/cascade-impact
// 删除全局分类前的级联影响预检，只统计不删除。
router.get('/categories/:name/cascade-impact', async (req, res) => {
    try {
        const impact = await categoryCascadeRepo.collectImpact(req.params.name);
        res.setHeader('X-Data-Source', 'sqlite');
        res.json(impact);
    } catch (err) {
        console.error('[GET /api/sla/categories/:name/cascade-impact] failed:', err);
        res.status(500).json({ error: err.message || '读取分类级联影响失败' });
    }
});

// DELETE /api/sla/categories/:name/cascade
// 级联删除分类及其规则、快照和报表入库关联数据。必须二次确认。
router.delete('/categories/:name/cascade', async (req, res) => {
    if (!req.body || req.body.confirm !== true) {
        return res.status(400).json({ error: '需要显式确认后才能级联删除' });
    }
    try {
        const result = await categoryCascadeRepo.deleteCascade(req.params.name);
        res.json(result);
    } catch (err) {
        console.error('[DELETE /api/sla/categories/:name/cascade] failed:', err);
        res.status(500).json({ error: err.message || '分类级联删除失败' });
    }
});

// ──────────────────────────────────────────────────────────
// 指标分组配置
// ──────────────────────────────────────────────────────────

// GET /api/sla/groups
router.get('/groups', async (req, res) => {
    try {
        const { items, source } = await groupsRepo.listGroups({
            mode: req.query.mode || 'auto'
        });
        res.setHeader('X-Data-Source', source);
        console.log(`[DATA SOURCE] GET /api/sla/groups -> ${source.toUpperCase()}`);
        res.json(items);
    } catch (err) {
        console.error('[GET /api/sla/groups] failed:', err);
        res.status(500).json({ error: '读取分组失败' });
    }
});

// PUT /api/sla/groups
router.put('/groups', async (req, res) => {
    const groups = req.body;
    if (!Array.isArray(groups)) return res.status(400).json({ error: '必须是数组' });
    try {
        const [{ items: beforeTargets }, { items: beforePrefs }, { items: beforeGroups }] = await Promise.all([
            targetsRepo.getTargets({ mode: 'auto' }),
            prefsRepo.getPrefsObject({ mode: 'auto' }),
            groupsRepo.listGroups({ mode: 'auto' })
        ]);
        await groupsRepo.replaceGroups(groups);
        configChangeMonitor.recordSlaConfigChange({
            req,
            action: '指标分组配置变化',
            beforeTargets,
            beforePrefs,
            beforeGroups,
            afterTargets: beforeTargets,
            afterPrefs: beforePrefs,
            afterGroups: groups,
            objectType: 'sla_metric_groups',
            objectId: 'global'
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[PUT /api/sla/groups] failed:', err);
        res.status(500).json({ error: '保存分组失败' });
    }
});

// ──────────────────────────────────────────────────────────
// 全局预警目标
// ──────────────────────────────────────────────────────────

// GET /api/sla/targets
router.get('/targets', async (req, res) => {
    try {
        const { items, source } = await targetsRepo.getTargets({
            mode: req.query.mode || 'auto'
        });
        res.setHeader('X-Data-Source', source);
        console.log(`[DATA SOURCE] GET /api/sla/targets -> ${source.toUpperCase()}`);
        res.json(items);
    } catch (err) {
        console.error('[GET /api/sla/targets] failed:', err);
        res.status(500).json({ error: '读取预警目标失败' });
    }
});

// PUT /api/sla/targets  → 保存全量预警目标
router.put('/targets', async (req, res) => {
    const targets = req.body;
    if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
        return res.status(400).json({ error: '无效数据格式' });
    }
    try {
        const [{ items: beforeTargets }, { items: beforePrefs }, { items: beforeGroups }] = await Promise.all([
            targetsRepo.getTargets({ mode: 'auto' }),
            prefsRepo.getPrefsObject({ mode: 'auto' }),
            groupsRepo.listGroups({ mode: 'auto' })
        ]);
        const beforeCount = Object.keys(beforeTargets || {}).length;
        const afterCount = Object.keys(targets).length;
        const beforeHash = hashObject(beforeTargets);
        const isLargeDrop = beforeCount >= 10
            && beforeCount - afterCount >= 5
            && afterCount < beforeCount / 2;
        if (isLargeDrop && req.get('x-sla-targets-replace-confirm') !== beforeHash) {
            return res.status(409).json({
                code: 'SLA_TARGETS_BULK_REPLACE_CONFIRM_REQUIRED',
                error: '本次操作将大量删除指标目标，请确认当前配置后重试',
                beforeCount,
                afterCount,
                beforeHash
            });
        }
        await targetsRepo.replaceTargets(targets);
        const changedKeys = Object.keys(targets || {})
            .filter(key => stableStringify(targets[key]) !== stableStringify(beforeTargets[key]))
            .slice(0, 50);
        const removedKeys = Object.keys(beforeTargets || {})
            .filter(key => !Object.prototype.hasOwnProperty.call(targets, key))
            .slice(0, 50);
        const changedItems = changedKeys
            .map(key => summarizeChangedTargetItem(key, beforeTargets[key], targets[key]))
            .slice(0, 20);
        const removedItems = removedKeys
            .map(key => ({
                key,
                label: beforeTargets[key]?.label || key
            }))
            .slice(0, 20);
        const summary = {
            before: { targetCount: Object.keys(beforeTargets || {}).length, hash: hashObject(beforeTargets) },
            after: { targetCount: Object.keys(targets || {}).length, hash: hashObject(targets) },
            changedKeys,
            removedKeys
        };
        await writeAudit(req, 'sla.targets.replace', summary);
        configChangeMonitor.recordSlaConfigChange({
            req,
            action: '指标目标/权重全量变化',
            beforeTargets,
            beforePrefs,
            beforeGroups,
            afterTargets: targets,
            afterPrefs: beforePrefs,
            afterGroups: beforeGroups,
            objectType: 'sla_targets',
            objectId: 'global',
            detail: {
                changedKeys: summary.changedKeys,
                removedKeys: summary.removedKeys,
                changedItems,
                removedItems
            }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[PUT /api/sla/targets] failed:', err);
        res.status(500).json({ error: '保存预警目标失败' });
    }
});

// PATCH /api/sla/targets/:targetKey → 局部更新单个预警目标
router.patch('/targets/:targetKey', async (req, res) => {
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return res.status(400).json({ error: '无效数据格式' });
    }
    try {
        const [{ items: targets }, { items: beforePrefs }, { items: beforeGroups }] = await Promise.all([
            targetsRepo.getTargets({ mode: 'auto' }),
            prefsRepo.getPrefsObject({ mode: 'auto' }),
            groupsRepo.listGroups({ mode: 'auto' })
        ]);
        const before = targets[req.params.targetKey] || null;
        const shouldReplace = patch.__replace === true;
        const cleanPatch = { ...patch };
        delete cleanPatch.__replace;
        const next = shouldReplace ? cleanPatch : {
            ...(before || {}),
            ...cleanPatch
        };
        const saved = await targetsRepo.upsertTarget(req.params.targetKey, next, { replace: shouldReplace });
        await writeAudit(req, 'sla.targets.patch', {
            targetKey: req.params.targetKey,
            mode: shouldReplace ? 'replace-one' : 'merge',
            before,
            after: saved
        });
        configChangeMonitor.recordSlaConfigChange({
            req,
            action: '单个指标目标/权重变化',
            beforeTargets: targets,
            beforePrefs,
            beforeGroups,
            afterTargets: { ...targets, [req.params.targetKey]: saved },
            afterPrefs: beforePrefs,
            afterGroups: beforeGroups,
            objectType: 'sla_target',
            objectId: req.params.targetKey,
            detail: { before, after: saved }
        });
        res.json({ success: true, item: saved });
    } catch (err) {
        console.error('[PATCH /api/sla/targets/:targetKey] failed:', err);
        res.status(500).json({ error: '更新预警目标失败' });
    }
});

// ──────────────────────────────────────────────────────────
// 历史导入快照
// ──────────────────────────────────────────────────────────

// GET /api/sla/snapshots
router.get('/snapshots/latest', async (_req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ snapshot: await snapshotsRepo.getLatestSnapshot() });
    } catch (err) {
        console.error('[GET /api/sla/snapshots/latest] failed:', err);
        res.status(500).json({ error: '读取最新导入快照失败', code: 'SLA_LATEST_SNAPSHOT_FAILED' });
    }
});

router.get('/snapshots', async (req, res) => {
    try {
        const { items, source } = await snapshotsRepo.listSnapshots({
            mode: req.query.mode || 'auto',
            view: req.query.view === 'summary' ? 'summary' : 'full' // summary：不含明细数据，供只需元数据的页面使用
        });
        res.setHeader('X-Data-Source', source);
        console.log(`[DATA SOURCE] GET /api/sla/snapshots -> ${source.toUpperCase()}`);
        res.json(items);
    } catch (err) {
        console.error('[GET /api/sla/snapshots] failed:', err);
        res.status(500).json({ error: '读取历史快照失败' });
    }
});

// POST /api/sla/snapshot
router.post('/snapshot', async (req, res) => {
    let snapshot;
    try {
        snapshot = expandCompressedSnapshot(req.body);
    } catch (decodeErr) {
        console.error('[POST /api/sla/snapshot] compressed payload decode failed:', decodeErr);
        return res.status(400).json({ error: decodeErr.message || '压缩快照解码失败' });
    }

    try {
        if (req.body && req.body.transport && req.body.transport.compression) {
            console.log(
                `[SLA COMPRESS] POST /api/sla/snapshot -> transport=${req.body.transport.compression}, ` +
                `original=${req.body.transport.originalBytes || '-'}, compressed=${req.body.transport.compressedBytes || '-'}`
            );
        }
        const item = await snapshotsRepo.addSnapshot(snapshot);
        res.json({ success: true, id: item.id, sourceBatchId: item.sourceBatchId || null });
    } catch (err) {
        console.error('[POST /api/sla/snapshot] failed:', err);
        res.status(500).json({ error: '保存历史快照失败' });
    }
});

// Read-only impact preview; originals are deleted only after explicit confirmation.
router.get('/snapshots/:id/delete-preview', async (req, res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await require('../models/sla-snapshot-delete').preview(req.params.id)); }
    catch (err) { res.status(err.status || 500).json({ error: err.message, code: err.code || 'SNAPSHOT_DELETE_ERROR' }); }
});
router.delete('/snapshots/:id', async (req, res) => {
    try { res.json(await snapshotsRepo.deleteSnapshot(req.params.id, req.body || {})); }
    catch (err) { res.status(err.status || 500).json({ error: err.message, code: err.code || 'SNAPSHOT_DELETE_ERROR' }); }
});

// PUT /api/sla/snapshots/:id
router.put('/snapshots/:id', async (req, res) => {
    let snapshotPatch;
    try {
        snapshotPatch = expandCompressedSnapshot(req.body);
    } catch (decodeErr) {
        console.error('[PUT /api/sla/snapshots/:id] compressed payload decode failed:', decodeErr);
        return res.status(400).json({ error: decodeErr.message || '压缩快照解码失败' });
    }

    try {
        if (req.body && req.body.transport && req.body.transport.compression) {
            console.log(
                `[SLA COMPRESS] PUT /api/sla/snapshots/${req.params.id} -> transport=${req.body.transport.compression}, ` +
                `original=${req.body.transport.originalBytes || '-'}, compressed=${req.body.transport.compressedBytes || '-'}`
            );
        }
        const updated = await snapshotsRepo.updateSnapshot(req.params.id, snapshotPatch);
        if (!updated) {
            return res.status(404).json({ error: 'Snapshot not found' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[PUT /api/sla/snapshots/:id] failed:', err);
        res.status(500).json({ error: '更新历史快照失败' });
    }
});

// POST /api/sla/snapshots/cleanup-redundant
// 清理 SLA 源快照。支持彻底清理（只保留最新一份）、按天保留，
// 并保留旧版“最近 N 天去重”请求的兼容性。
router.post('/snapshots/cleanup-redundant', async (req, res) => {
    try {
        const requestedMode = req.body?.mode;
        const dryRun = Boolean(req.body?.dryRun);
        if (requestedMode === 'latest-only' && !dryRun && req.body?.confirmationText !== '确认删除') {
            return res.status(400).json({ error: '彻底清理前必须输入“确认删除”' });
        }
        const result = await snapshotsRepo.cleanupRedundantDailySnapshots({
            days: req.body?.days,
            mode: requestedMode,
            dryRun
        });
        console.log(
            `[SLA SNAPSHOT CLEANUP] mode=${result.mode}, days=${result.days}, dryRun=${result.dryRun}, ` +
            `before=${result.beforeCount}, after=${result.afterCount}, removed=${result.removedCount}`
        );
        if (!result.dryRun) {
            await writeAudit(req, 'snapshot_cleanup', {
                mode: result.mode,
                days: result.days,
                beforeCount: result.beforeCount,
                afterCount: result.afterCount,
                removedCount: result.removedCount,
                latestSnapshotId: result.latestSnapshotId
            });
        }
        res.json(result);
    } catch (err) {
        console.error('[POST /api/sla/snapshots/cleanup-redundant] failed:', err);
        res.status(500).json({ error: '清理历史快照失败' });
    }
});

// ──────────────────────────────────────────────────────────
// 表格偏好设置（列宽、显示列、排序、自定义指标规则）
// 使用 schemaHash 作为 key，与原前端逻辑对应
// ──────────────────────────────────────────────────────────

// GET /api/sla/prefs/:schemaHash
router.get('/prefs/:schemaHash', async (req, res) => {
    try {
        const { item, source } = await prefsRepo.getPrefItem(req.params.schemaHash, {
            mode: req.query.mode || 'auto'
        });
        res.setHeader('X-Data-Source', source);
        console.log(`[DATA SOURCE] GET /api/sla/prefs/${req.params.schemaHash} -> ${source.toUpperCase()}`);
        res.json(item);
    } catch (err) {
        console.error('[GET /api/sla/prefs/:schemaHash] failed:', err);
        res.status(500).json({ error: '读取偏好设置失败' });
    }
});

// PUT /api/sla/prefs/:schemaHash
router.put('/prefs/:schemaHash', async (req, res) => {
    const prefs = (await prefsRepo.getPrefsObject({ mode: 'auto' })).items;
    const beforePrefs = JSON.parse(JSON.stringify(prefs || {}));
    const beforeTargets = (await targetsRepo.getTargets({ mode: 'auto' })).items;
    const beforeGroups = (await groupsRepo.listGroups({ mode: 'auto' })).items;
    prefs[req.params.schemaHash] = req.body;
    await prefsRepo.upsertPrefItem(req.params.schemaHash, req.body);

    try {
        // --- 自动清理孤儿预警配置 (Clean up orphaned targets) ---
        const validCustomMetricIds = new Set();
        Object.keys(prefs).forEach(hash => {
            if (prefs[hash] && prefs[hash].customMetrics) {
                let secId = '';
                if (hash.startsWith('sla_prefs_other_')) {
                    secId = hash.replace('sla_prefs_', ''); 
                } else if (hash.startsWith('sla_prefs_rectification')) {
                    secId = 'rectification';
                } else if (hash.startsWith('sla_prefs_risk')) {
                    secId = 'risk';
                } else if (hash.startsWith('sla_prefs_special')) {
                    secId = 'special';
                } else {
                    secId = hash.replace('sla_prefs_', '');
                }
                prefs[hash].customMetrics.forEach(cm => {
                    validCustomMetricIds.add(`${secId}_${cm.id}`);
                });
            }
        });

        let targets = (await targetsRepo.getTargets({ mode: 'auto' })).items;
        let targetsChanged = false;
        
        Object.keys(targets).forEach(k => {
            // 前端生成的自定义指标的 target key 特征是包含 "_m_"
            if (k.includes('_m_') && !validCustomMetricIds.has(k)) {
                delete targets[k];
                targetsChanged = true;
            }
        });

        if (targetsChanged) {
            await targetsRepo.replaceTargets(targets);
        }
    } catch (e) {
        console.error('Failed to clean up orphaned targets:', e);
    }

    const afterTargets = (await targetsRepo.getTargets({ mode: 'auto' })).items;
    configChangeMonitor.recordSlaConfigChange({
        req,
        action: req.params.schemaHash.startsWith('sla_prefs_other_') ? '额外监控规则配置变化' : '指标规则配置变化',
        beforeTargets,
        beforePrefs,
        beforeGroups,
        afterTargets,
        afterPrefs: prefs,
        afterGroups: beforeGroups,
        objectType: 'sla_prefs',
        objectId: req.params.schemaHash,
        detail: {
            changedPrefs: [
                summarizeChangedPrefItem(req.params.schemaHash, beforePrefs[req.params.schemaHash], req.body)
            ]
        }
    });
    res.json({ success: true });
});

// ──────────────────────────────────────────────────────────
// 详单常用复制字段记忆与统计（双击行竖排紧凑详情一键复制并记住）
// ──────────────────────────────────────────────────────────

// GET /api/sla/copied-fields
router.get('/copied-fields', async (req, res) => {
    try {
        const result = await copiedFieldsRepo.getCopiedFieldStats(req.query.tableType || null);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[GET /api/sla/copied-fields] failed:', err);
        res.status(500).json({ error: '获取常用复制字段统计失败' });
    }
});

// POST /api/sla/copied-fields
router.post('/copied-fields', async (req, res) => {
    try {
        const { tableType, fieldName } = req.body || {};
        if (!fieldName) {
            return res.status(400).json({ error: 'fieldName 为必填参数' });
        }
        const record = await copiedFieldsRepo.recordFieldCopy(tableType, fieldName);
        res.json({ success: true, record });
    } catch (err) {
        console.error('[POST /api/sla/copied-fields] failed:', err);
        res.status(500).json({ error: '记录复制字段失败' });
    }
});

// DELETE /api/sla/copied-fields
router.delete('/copied-fields', async (req, res) => {
    try {
        const tableType = req.query.tableType || req.body?.tableType;
        const fieldName = req.query.fieldName || req.body?.fieldName;
        if (!tableType) {
            return res.status(400).json({ error: 'tableType 为必填参数' });
        }
        await copiedFieldsRepo.deleteCopiedField(tableType, fieldName);
        res.json({ success: true });
    } catch (err) {
        console.error('[DELETE /api/sla/copied-fields] failed:', err);
        res.status(500).json({ error: '删除常用复制字段记录失败' });
    }
});

// ──────────────────────────────────────────────────────────
// 全量配置导出 / 导入
// ──────────────────────────────────────────────────────────

// GET /api/sla/config  → 导出全量配置（targets + prefs + copiedFields）
router.get('/config', async (req, res) => {
    try {
        const { items: targets, source: targetsSource } = await targetsRepo.getTargets({
            mode: req.query.mode || 'auto'
        });
        const { items: prefs, source: prefsSource } = await prefsRepo.getPrefsObject({
            mode: req.query.mode || 'auto'
        });
        const copiedFields = await copiedFieldsRepo.getAllForExport();
        res.setHeader('X-Data-Source', prefsSource);
        res.setHeader('X-Data-Source-Targets', targetsSource);
        res.setHeader('X-Data-Source-Prefs', prefsSource);
        console.log(`[DATA SOURCE] GET /api/sla/config -> PREFS ${prefsSource.toUpperCase()}, TARGETS ${targetsSource.toUpperCase()}`);
        res.json({ targets, prefs, copiedFields, exportDate: new Date().toISOString() });
    } catch (err) {
        console.error('[GET /api/sla/config] failed:', err);
        res.status(500).json({ error: '导出配置失败' });
    }
});

// POST /api/sla/config  → 导入配置
router.post('/config', async (req, res) => {
    const { targets, prefs } = req.body;
    console.log(`[POST /config] Received body keys:`, Object.keys(req.body));
    console.log(`[POST /config] targets defined?`, !!targets, `prefs defined?`, !!prefs);
    
    try {
        const beforeTargets = (await targetsRepo.getTargets({ mode: 'auto' })).items;
        const beforePrefs = (await prefsRepo.getPrefsObject({ mode: 'auto' })).items;
        const beforeGroups = (await groupsRepo.listGroups({ mode: 'auto' })).items;
        const beforeSummary = summarizeConfig({ targets: beforeTargets, prefs: beforePrefs });
        const afterSummary = summarizeConfig({
            targets: targets || beforeTargets,
            prefs: prefs || beforePrefs
        });
        const diff = diffConfigSummary(beforeSummary, afterSummary);
        const confirmed = req.body.confirmImpact === true || req.body.confirmDestructive === true;

        if (isDestructiveConfigChange(diff) && !confirmed) {
            await writeAudit(req, 'sla.config.replace.blocked', {
                reason: 'destructive_config_change_requires_confirmation',
                ...diff
            });
            configChangeMonitor.recordConfigChangeAlert({
                req,
                action: 'SLA 全量配置导入被拦截',
                before: beforeSummary,
                after: afterSummary,
                objectType: 'sla_config_blocked',
                objectId: 'import',
                severity: 'warn',
                message: '全量配置导入会明显减少指标规则，已被确认保护拦截。',
                detail: { impact: diff }
            });
            return res.status(409).json({
                error: '本次配置写入会明显减少已保存指标规则，需要确认后才能继续',
                requiresConfirmation: true,
                impact: diff
            });
        }

        if (targets) {
            await targetsRepo.replaceTargets(targets);
            console.log(`[POST /config] Wrote targets successfully`);
        }
        if (prefs) {
            await prefsRepo.replacePrefs(prefs);
            console.log(`[POST /config] Wrote prefs successfully, keys count:`, Object.keys(prefs).length);
        }
        if (req.body.copiedFields) {
            await copiedFieldsRepo.replaceCopiedFields(req.body.copiedFields);
            console.log(`[POST /config] Restored copiedFields successfully`);
        }
        await writeAudit(req, 'sla.config.replace', {
            confirmed,
            ...diff
        });
        const afterTargetsNow = (await targetsRepo.getTargets({ mode: 'auto' })).items;
        const afterPrefsNow = (await prefsRepo.getPrefsObject({ mode: 'auto' })).items;
        const afterGroupsNow = (await groupsRepo.listGroups({ mode: 'auto' })).items;
        const changedPrefKeys = Object.keys(afterPrefsNow || {})
            .filter(key => stableStringify(afterPrefsNow[key]) !== stableStringify(beforePrefs[key]))
            .slice(0, 50);
        const removedPrefKeys = Object.keys(beforePrefs || {})
            .filter(key => !Object.prototype.hasOwnProperty.call(afterPrefsNow, key))
            .slice(0, 50);
        const changedPrefs = changedPrefKeys
            .map(key => summarizeChangedPrefItem(key, beforePrefs[key], afterPrefsNow[key]))
            .slice(0, 20);
        const removedPrefs = removedPrefKeys
            .map(key => summarizeChangedPrefItem(key, beforePrefs[key], undefined))
            .slice(0, 20);
        configChangeMonitor.recordSlaConfigChange({
            req,
            action: 'SLA 全量配置导入变化',
            beforeTargets,
            beforePrefs,
            beforeGroups,
            afterTargets: afterTargetsNow,
            afterPrefs: afterPrefsNow,
            afterGroups: afterGroupsNow,
            objectType: 'sla_config',
            objectId: 'import',
            detail: {
                confirmed,
                changedPrefKeys,
                removedPrefKeys,
                changedPrefs,
                removedPrefs
            }
        });
        res.json({ success: true });
    } catch (e) {
        console.error(`[POST /config] Write failed:`, e);
        res.status(500).json({ error: '保存文件失败: ' + e.message });
    }
});

// PATCH /api/sla/config/prefs → 局部更新偏好配置，避免小配置覆盖整包 SLA config
router.patch('/config/prefs', async (req, res) => {
    const updates = req.body && req.body.updates;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ error: 'updates 必须是对象' });
    }

    try {
        const [{ items: beforeTargets }, { items: beforePrefs }, { items: beforeGroups }] = await Promise.all([
            targetsRepo.getTargets({ mode: 'auto' }),
            prefsRepo.getPrefsObject({ mode: 'auto' }),
            groupsRepo.listGroups({ mode: 'auto' })
        ]);
        const afterPrefs = { ...beforePrefs };
        const changed = {};
        const changedPrefs = [];
        for (const [prefKey, payload] of Object.entries(updates)) {
            await prefsRepo.upsertPrefItem(prefKey, payload);
            afterPrefs[prefKey] = payload;
            changed[prefKey] = {
                beforeHash: hashObject(beforePrefs[prefKey]),
                afterHash: hashObject(payload)
            };
            changedPrefs.push(summarizeChangedPrefItem(prefKey, beforePrefs[prefKey], payload));
        }
        await writeAudit(req, 'sla.config.prefs.patch', {
            keys: Object.keys(updates),
            changed
        });
        const keys = Object.keys(updates);
        const action = keys.includes('manualAdjustItems')
            ? '手动加减分项目配置变化'
            : keys.some(key => key.startsWith('sla_prefs_other_'))
                ? '额外监控规则配置变化'
                : '偏好/指标相关配置变化';
        configChangeMonitor.recordSlaConfigChange({
            req,
            action,
            beforeTargets,
            beforePrefs,
            beforeGroups,
            afterTargets: beforeTargets,
            afterPrefs,
            afterGroups: beforeGroups,
            objectType: 'sla_prefs_patch',
            objectId: keys.join(',').slice(0, 240),
            detail: { keys, changed, changedPrefs }
        });
        res.json({ success: true, keys: Object.keys(updates) });
    } catch (err) {
        console.error('[PATCH /api/sla/config/prefs] failed:', err);
        res.status(500).json({ error: '局部保存配置失败' });
    }
});

// GET /api/sla/audit-log?limit=100 → 查看服务端配置变动审计
router.get('/audit-log', async (req, res) => {
    try {
        const items = await auditLogRepo.listAuditLog({
            scope: 'sla',
            limit: req.query.limit || 100
        });
        res.json(items);
    } catch (err) {
        console.error('[GET /api/sla/audit-log] failed:', err);
        res.status(500).json({ error: '读取审计日志失败' });
    }
});

// GET /api/sla/rule-templates/fast-mapping → 指标规则复制速填模板
router.get('/rule-templates/fast-mapping', async (req, res) => {
    try {
        res.json(await ruleTemplatesRepo.getTemplate('fast_mapping'));
    } catch (err) {
        console.error('[GET /api/sla/rule-templates/fast-mapping] failed:', err);
        res.status(500).json({ error: '读取规则速填模板失败' });
    }
});

// PUT /api/sla/rule-templates/fast-mapping → 保存指标规则复制速填模板
router.put('/rule-templates/fast-mapping', async (req, res) => {
    try {
        const text = req.body && typeof req.body.text === 'string' ? req.body.text : '';
        const before = await ruleTemplatesRepo.getTemplate('fast_mapping');
        const saved = await ruleTemplatesRepo.saveTemplate('fast_mapping', text);
        configChangeMonitor.recordConfigChangeAlert({
            req,
            action: '指标规则速填模板变化',
            before,
            after: saved,
            objectType: 'sla_rule_template',
            objectId: 'fast_mapping'
        });
        res.json(saved);
    } catch (err) {
        console.error('[PUT /api/sla/rule-templates/fast-mapping] failed:', err);
        res.status(500).json({ error: '保存规则速填模板失败' });
    }
});

// ──────────────────────────────────────────────────────────
// 全局重命名指标
// ──────────────────────────────────────────────────────────

// POST /api/sla/rename-metric
router.post('/rename-metric', async (req, res) => {
    const { oldName, newName, newEn } = req.body;
    if (!oldName || !newName || oldName === newName) {
        return res.status(400).json({ error: '无效的名称' });
    }

    try {
        const beforeTargets = (await targetsRepo.getTargets({ mode: 'auto' })).items;
        const beforePrefs = (await prefsRepo.getPrefsObject({ mode: 'auto' })).items;
        const beforeGroups = (await groupsRepo.listGroups({ mode: 'auto' })).items;
        // 1. targets
        let targets = JSON.parse(JSON.stringify(beforeTargets || {}));
        let targetsChanged = false;
        Object.keys(targets).forEach(k => {
            if (targets[k].label === oldName) {
                targets[k].label = newName;
                targetsChanged = true;
            }
        });
        if (targetsChanged) await targetsRepo.replaceTargets(targets);

        // 2. prefs
        let prefs = JSON.parse(JSON.stringify(beforePrefs || {}));
        let prefsChanged = false;
        Object.keys(prefs).forEach(k => {
            if (k.startsWith('sla_prefs_') && prefs[k].customMetrics) {
                prefs[k].customMetrics.forEach(m => {
                    if (m.label === oldName) {
                        m.label = newName;
                        prefsChanged = true;
                    }
                });
            }
        });
        if (prefs.i18nMap && prefs.i18nMap[oldName] !== undefined) {
            prefs.i18nMap[newName] = newEn !== undefined ? newEn : prefs.i18nMap[oldName];
            delete prefs.i18nMap[oldName];
            prefsChanged = true;
        } else if (newEn !== undefined) {
            if (!prefs.i18nMap) prefs.i18nMap = {};
            prefs.i18nMap[newName] = newEn;
            prefsChanged = true;
        }
        if (prefs.manualAdjustItems) {
            prefs.manualAdjustItems.forEach(item => {
                if (item.name === oldName) {
                    item.name = newName;
                    prefsChanged = true;
                }
            });
        }
        if (prefsChanged) await prefsRepo.replacePrefs(prefs);

        // 3. groups
        let groups = JSON.parse(JSON.stringify(beforeGroups || []));
        let groupsChanged = false;
        groups.forEach(g => {
            if (g.metrics) {
                const idx = g.metrics.indexOf(oldName);
                if (idx !== -1) {
                    g.metrics[idx] = newName;
                    groupsChanged = true;
                }
            }
        });
        if (groupsChanged) {
            await groupsRepo.replaceGroups(groups);
        }
        configChangeMonitor.recordSlaConfigChange({
            req,
            action: '指标全局重命名配置变化',
            beforeTargets,
            beforePrefs,
            beforeGroups,
            afterTargets: targets,
            afterPrefs: prefs,
            afterGroups: groups,
            objectType: 'sla_metric_rename',
            objectId: `${oldName} -> ${newName}`,
            detail: { oldName, newName, targetsChanged, prefsChanged, groupsChanged }
        });

        // 4. snapshots
        let snapshots = (await snapshotsRepo.listSnapshots({ mode: 'auto' })).items;
        let snapsChanged = false;
        snapshots.forEach(s => {
            if (s.topMetrics) {
                s.topMetrics.forEach(m => {
                    if (m.label === oldName) {
                        m.label = newName;
                        snapsChanged = true;
                    }
                });
            }
        });
        if (snapsChanged) {
            await snapshotsRepo.replaceSnapshots(snapshots);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Rename metric failed:', e);
        res.status(500).json({ error: e.message });
    }
});
async function fillYuxiangWorkbook(body) {
    const { metrics, adjustments, totals, targetMonth } = body;
    const ExcelJS = require('exceljs');
    const path = require('path');
    const fs = require('fs');

    const templatePath = path.join(__dirname, '../templates/每月赛马-分网络.xlsx');
    if (!fs.existsSync(templatePath)) {
        throw new Error('Template file not found');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.worksheets[0];

    const monthNumber = Number(targetMonth);
    if (Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
        const monthLabels = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May.', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
        const monthLabel = monthLabels[monthNumber - 1];
        sheet.getCell('J1').value = `Target\n  (${monthLabel})`;
        sheet.getCell('K1').value = `Achivement\n (${monthLabel})`;
        sheet.getCell('O1').value = `Score\n (${monthLabel})`;
    }

    const mappingToRow = {};
    const maxRow = Math.max(sheet.rowCount, 100);
    for(let r = 3; r <= maxRow; r++) {
        const cell = sheet.getRow(r).getCell(3);
        if (cell.value) {
            // Force left alignment properly (clone style to avoid mutating workbook default)
            cell.style = Object.assign({}, cell.style);
            cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
            
            // Strip legacy tag if it exists in C column
            if (typeof cell.value === 'string' && cell.value.includes('[Map:')) {
                cell.value = cell.value.replace(/\s*\[Map:\s*.+?\]/g, '');
            }
        }
        
        // Read mapping from Column 26 (Z)
        const zVal = sheet.getRow(r).getCell(26).value;
        if (typeof zVal === 'string') {
            const match = zVal.match(/\[Map:\s*(.+?)\]/);
            if (match) {
                mappingToRow[match[1]] = r;
            }
        } else if (typeof cell.value === 'string') { 
                // fallback legacy read
                const matchC = cell.value.match(/\[Map:\s*(.+?)\]/);
                if (matchC) mappingToRow[matchC[1]] = r;
        }
    }
    const hasExplicitTemplateMapping = Object.keys(mappingToRow).length > 0;

    const setCell = (rowObj, col, val, isScore = false, isMissing = false, isProblematic = false) => {
        const cell = rowObj.getCell(col);
        
        if (val === '--' || val === '' || val === null || val === undefined) {
            val = '/';
        }
        if (isMissing && isScore && val === 0) {
            val = '/'; // If the cell is missing, score is /
        }

        if (typeof val === 'string' && val.endsWith('%')) {
            cell.value = val;
        } else {
            if (isScore && Number.isFinite(Number(val))) {
                const score = Number(val);
                val = Math.sign(score) * Math.round((Math.abs(score) + Number.EPSILON) * 100) / 100;
            }
            cell.value = val;
            cell.numFmt = isScore && typeof val === 'number' ? '0.00' : 'General';
        }
        // Clone style to avoid mutating workbook default
        cell.style = Object.assign({}, cell.style);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (isProblematic) {
            cell.font = Object.assign({}, cell.font, { color: { argb: 'FFFF0000' }, bold: true });
        }
    };
    const columnName = (col) => {
        let out = '';
        let n = col;
        while (n > 0) {
            const rem = (n - 1) % 26;
            out = String.fromCharCode(65 + rem) + out;
            n = Math.floor((n - rem) / 26);
        }
        return out;
    };
    const unmergeOverlappingCells = (rowIndex, startCol, endCol) => {
        const mergeEntries = Object.values(sheet._merges || {});
        mergeEntries.forEach(merge => {
            const model = merge && merge.model;
            if (!model) return;
            const rowOverlaps = model.top <= rowIndex && model.bottom >= rowIndex;
            const colOverlaps = model.left <= endCol && model.right >= startCol;
            if (!rowOverlaps || !colOverlaps) return;
            const range = `${columnName(model.left)}${model.top}:${columnName(model.right)}${model.bottom}`;
            try {
                sheet.unMergeCells(range);
            } catch (e) {}
        });
    };
    const getRowMapping = rowIndex => {
        const zVal = sheet.getRow(rowIndex).getCell(26).value;
        if (typeof zVal !== 'string') return '';
        const match = zVal.match(/\[Map:\s*(.+?)\]/);
        return match ? match[1] : '';
    };
    const formatSystemSummaryRow = rowIndex => {
        const row = sheet.getRow(rowIndex);
        const label = row.getCell(3).text || row.getCell(1).text || row.getCell(3).value || row.getCell(1).value || '';
        unmergeOverlappingCells(rowIndex, 1, 5);
        sheet.mergeCells(`A${rowIndex}:E${rowIndex}`);
        const cell = row.getCell(1);
        cell.value = label;
        cell.style = Object.assign({}, cell.style);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.font = Object.assign({}, cell.font, { bold: true });
    };
    const fillYearTargetCells = row => {
        const rowIndex = row.number;
        unmergeOverlappingCells(rowIndex, 6, 9);
        sheet.mergeCells(`F${rowIndex}:I${rowIndex}`);
        setCell(row, 6, '/');
    };
    const getAdjustUnitText = (adjustment) => {
        const unit = Number(adjustment.unit);
        if (!Number.isFinite(unit)) return '';
        const suffix = adjustment.type === '扣分' || adjustment.type === 'Deduct' ? 'case' : 'time';
        return `${unit} point/${suffix}`;
    };

    if (Array.isArray(metrics)) {
        metrics.forEach((m, idx) => {
            const r = mappingToRow[m.label] || (!hasExplicitTemplateMapping ? (3 + idx) : null);
            if (r) {
                const row = sheet.getRow(r);
                const isPercent = ['TE', 'ORG', 'ET', 'VDF'].some(cat => m[cat] && String(m[cat].achv).includes('%'));
                let tgt = m.target;
                if (isPercent && tgt !== null && tgt !== undefined && tgt !== '' && !String(tgt).includes('%')) {
                    tgt = String(tgt) + '%';
                }
                setCell(row, 10, tgt);

                ['TE', 'ORG', 'ET', 'VDF'].forEach((cat, cIdx) => {
                    const achvCol = 11 + cIdx;
                    const scoreCol = 15 + cIdx;
                    if (m[cat]) {
                        const isMissing = (m[cat].achv === '' || m[cat].achv === '--' || m[cat].achv === null);
                        const isProblematic = m[cat].isFailing;
                        setCell(row, achvCol, m[cat].achv, false, false, isProblematic);
                        setCell(row, scoreCol, m[cat].score, true, isMissing, isProblematic);
                    } else {
                        setCell(row, achvCol, '/');
                        setCell(row, scoreCol, '/');
                    }
                });
            }
        });
    }

    if (Array.isArray(adjustments)) {
        adjustments.forEach((a, idx) => {
            const aName = a.label; // using a.label from frontend
            let fallbackR;
            if (idx < 14) fallbackR = 38 + idx;
            else fallbackR = 52 + (idx - 14);
            
            const r = (aName && mappingToRow[aName]) || (!hasExplicitTemplateMapping ? fallbackR : null);
            if (r) {
                const row = sheet.getRow(r);
                const typeText = a.type === '加分' || a.type === 'Add' ? 'Add' : 'Deduct';
                const templateTextCell = row.getCell(3);
                const templateText = templateTextCell.text || templateTextCell.value || '';
                unmergeOverlappingCells(r, 1, 5);
                setCell(row, 1, typeText);
                setCell(row, 2, 'All');
                setCell(row, 3, templateText);
                row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
                setCell(row, 4, getAdjustUnitText(a));
                setCell(row, 5, 'Timely');
                fillYearTargetCells(row);
                setCell(row, 10, '/');

                ['TE', 'ORG', 'ET', 'VDF'].forEach((cat, cIdx) => {
                    const achvCol = 11 + cIdx;
                    const scoreCol = 15 + cIdx;
                    const catData = a[cat] || { score: 0, count: 0 };
                    const score = catData.score;
                    const count = catData.count;
                    
                    if (score === 0) {
                        setCell(row, achvCol, '/');
                        setCell(row, scoreCol, '/');
                    } else {
                        const isProblematic = score < 0;
                        setCell(row, achvCol, count, false, false, isProblematic);
                        setCell(row, scoreCol, score, true, false, isProblematic);
                    }
                });
            }
        });
    }

    const fillRow = (rIndex, targetCol, sourceObj, fields = ['TE', 'ORG', 'ET', 'VDF']) => {
        if (!rIndex || !sourceObj) return;
        const rowMapping = getRowMapping(rIndex);
        if (['SYS_SubTotal', 'SYS_AdjustTotal', 'SYS_WeightInMonth', 'SYS_FinalResult'].includes(rowMapping)) {
            formatSystemSummaryRow(rIndex);
        }
        const row = sheet.getRow(rIndex);
        fields.forEach((cat, idx) => {
            const cIndex = targetCol + idx;
            setCell(row, cIndex, sourceObj[cat], targetCol === 15);
        });
    };

    if (totals) {
        fillRow(mappingToRow['SYS_SubTotal'] || (!hasExplicitTemplateMapping ? 37 : null), 15, totals.subTotal);
        fillRow(mappingToRow['SYS_AdjustTotal'] || (!hasExplicitTemplateMapping ? 54 : null), 15, totals.adjustTotal);
        fillRow(mappingToRow['SYS_WeightInMonth'] || (!hasExplicitTemplateMapping ? 55 : null), 15, totals.weightInMonth);
        fillRow(mappingToRow['SYS_FinalResult'] || (!hasExplicitTemplateMapping ? 56 : null), 15, totals.finalResult);
    }

    // Fix column widths
    sheet.getColumn(3).width = 70;
    for (let c = 10; c <= 18; c++) {
        sheet.getColumn(c).width = 12;
    }

    return { workbook, sheet };
}

router.post('/preview-yuxiang', async (req, res) => {
    try {
        const { workbook, sheet } = await fillYuxiangWorkbook(req.body);

        const snapshot = {
            maxRow: Math.min(sheet.rowCount, 65), // typically around 60 rows
            maxCol: 18, // A to R
            merges: sheet.model.merges,
            rows: []
        };

        for (let r = 1; r <= snapshot.maxRow; r++) {
            const rowData = [];
            const row = sheet.getRow(r);
            for (let c = 1; c <= snapshot.maxCol; c++) {
                const cell = row.getCell(c);
                let val = cell.value;
                if (val && typeof val === 'object') {
                    if (val.richText) val = val.richText.map(rt => rt.text).join('');
                    else if (val.result !== undefined) val = val.result;
                    else val = String(val);
                }
                
                const isScoreCell = c >= 15 && c <= 18 && Number.isFinite(Number(val));
                rowData.push({
                    val: val === null || val === undefined ? '' : (isScoreCell ? Number(val).toFixed(2) : String(val)),
                    isMerged: cell.isMerged,
                    masterAddress: cell.isMerged ? cell.master.address : null,
                    address: cell.address,
                    bg: cell.fill && cell.fill.fgColor ? cell.fill.fgColor.argb : null,
                    color: cell.font && cell.font.color ? cell.font.color.argb : null,
                    bold: cell.font && cell.font.bold ? true : false,
                    align: cell.alignment ? cell.alignment.horizontal : 'left'
                });
            }
            snapshot.rows.push(rowData);
        }

        res.json(snapshot);
    } catch (e) {
        console.error('Preview Yuxiang failed:', e);
        res.status(500).send(e.message);
    }
});

router.post('/export-yuxiang', async (req, res) => {
    try {
        const { workbook, sheet } = await fillYuxiangWorkbook(req.body);

        // Apply overrides if any
        if (req.body.overrides) {
            Object.keys(req.body.overrides).forEach(key => {
                const [r, c] = key.split('_');
                const val = req.body.overrides[key];
                if (r && c) {
                    const cell = sheet.getRow(Number(r)).getCell(Number(c));
                    if (typeof val === 'string' && val.endsWith('%')) {
                        cell.value = val;
                    } else {
                        const num = Number(val);
                        cell.value = isNaN(num) || val === '' ? val : num;
                    }
                }
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="export.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error('Export Yuxiang failed:', e);
        res.status(500).send(e.message);
    }
});


router.get('/template-mapping', async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const path = require('path');
        const fs = require('fs');
        const templatePath = path.join(__dirname, '../templates/每月赛马-分网络.xlsx');
        if (!fs.existsSync(templatePath)) return res.json([]);
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        const sheet = workbook.worksheets[0];
        const data = [];
        const maxRow = Math.max(sheet.rowCount, 100);
        for(let r = 3; r <= maxRow; r++) {
            const val = sheet.getRow(r).getCell(3).value || '';
            let text = val;
            let mapping = '';
            // clean up legacy Map tag in C column
            if (typeof val === 'string') {
                const matchC = val.match(/\[Map:\s*(.+?)\]/);
                if (matchC) {
                    text = val.replace(/\s*\[Map:\s*.+?\]/, '');
                }
            }
            // read from Column 26 (Z)
            const zVal = sheet.getRow(r).getCell(26).value;
            if (typeof zVal === 'string') {
                const matchZ = zVal.match(/\[Map:\s*(.+?)\]/);
                if (matchZ) {
                    mapping = matchZ[1];
                }
            } else if (typeof val === 'string' && val.includes('[Map:')) {
                // fallback legacy read
                const matchC = val.match(/\[Map:\s*(.+?)\]/);
                if (matchC) mapping = matchC[1];
            }
            data.push({ r, text: String(text).trim(), mapping, originalVal: val });
        }
        
        let lastDataRowIndex = data.length - 1;
        while (lastDataRowIndex >= 0) {
            const row = data[lastDataRowIndex];
            if (row.text !== '' || row.mapping !== '') {
                break;
            }
            lastDataRowIndex--;
        }
        
        res.json(data.slice(0, lastDataRowIndex + 1));
    } catch(e) {
        res.status(500).send(e.message);
    }
});

router.post('/template-mapping', async (req, res) => {
    try {
        const updates = req.body;
        const ExcelJS = require('exceljs');
        const path = require('path');
        const fs = require('fs');
        const templatePath = path.join(__dirname, '../templates/每月赛马-分网络.xlsx');
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        const sheet = workbook.worksheets[0];

        const clone = value => {
            if (value === undefined || value === null) return value;
            return JSON.parse(JSON.stringify(value));
        };
        const maxCol = Math.max(sheet.columnCount || 26, 26);
        const snapshotRow = rowNumber => {
            const row = sheet.getRow(rowNumber);
            const cells = [];
            for (let c = 1; c <= maxCol; c++) {
                const cell = row.getCell(c);
                cells[c] = {
                    value: clone(cell.value),
                    style: clone(cell.style || {}),
                    numFmt: cell.numFmt,
                    alignment: clone(cell.alignment),
                    font: clone(cell.font),
                    fill: clone(cell.fill),
                    border: clone(cell.border),
                    protection: clone(cell.protection)
                };
            }
            return {
                height: row.height,
                hidden: row.hidden,
                outlineLevel: row.outlineLevel,
                cells
            };
        };
        const applyRowSnapshot = (rowNumber, snapshot) => {
            const row = sheet.getRow(rowNumber);
            row.height = snapshot.height;
            row.hidden = snapshot.hidden;
            row.outlineLevel = snapshot.outlineLevel;
            for (let c = 1; c <= maxCol; c++) {
                const target = row.getCell(c);
                const source = snapshot.cells[c] || {};
                if (target.isMerged && target.master && target.address !== target.master.address) continue;
                target.value = clone(source.value);
                target.style = clone(source.style || {});
                if (source.numFmt) target.numFmt = source.numFmt;
                if (source.alignment) target.alignment = clone(source.alignment);
                if (source.font) target.font = clone(source.font);
                if (source.fill) target.fill = clone(source.fill);
                if (source.border) target.border = clone(source.border);
                if (source.protection) target.protection = clone(source.protection);
            }
        };
        const rowSnapshots = {};
        const maxRow = Math.max(sheet.rowCount, 100);
        for (let r = 3; r <= maxRow; r++) {
            rowSnapshots[r] = snapshotRow(r);
        }

        updates.forEach((u, idx) => {
            const targetR = Number.isInteger(Number(u.r)) ? Number(u.r) : 3 + idx;
            const sourceR = Number.isInteger(Number(u.sourceR)) ? Number(u.sourceR) : null;
            const templateSourceR = Number.isInteger(Number(u.templateSourceR)) ? Number(u.templateSourceR) : null;
            const fallbackR = targetR > 3 ? targetR - 1 : 3;
            const snapshot = rowSnapshots[sourceR] || rowSnapshots[templateSourceR] || rowSnapshots[fallbackR] || snapshotRow(targetR);
            applyRowSnapshot(targetR, snapshot);

            const cell = sheet.getRow(targetR).getCell(3);
            // Clean up C column text just in case
            let finalVal = u.text;
            if (typeof finalVal === 'string') {
                finalVal = finalVal.replace(/\s*\[Map:\s*.+?\]/g, '');
            }
            cell.value = finalVal;
            cell.style = Object.assign({}, cell.style);
            cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
            
            // Write mapping to Column 26 (Z)
            const zCell = sheet.getRow(targetR).getCell(26);
            if (u.mapping) {
                zCell.value = `[Map:${u.mapping}]`;
            } else {
                zCell.value = '';
            }
        });
        
        await workbook.xlsx.writeFile(templatePath);
        res.json({ success: true });
    } catch(e) {
        res.status(500).send(e.message);
    }
});

module.exports = router;
