/**
 * UIVF12 自动导入临时会话
 *
 * 不接收/保存原始 CSV 文件。目标站点脚本在浏览器端把下载前的 CSV Blob
 * 解析为结构化 rows 后，仅上传 { name, rows }，/sla 页面再用这些 rows
 * 复用现有智能分流渲染链路。
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureDataDir, getDataDir } = require('../models/store');
const { DEFAULT_TENANT_ID } = require('../models/tenant-context');

const router = express.Router();
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
let lastCleanupAt = 0;

// 抓取页的上传不带登录（挂在租户中间件之前），会话固定放在默认数据目录；
// 登录后的归档请求也要从这里读，所以不能按当前租户取目录。
function getRootDir() {
    ensureDataDir(DEFAULT_TENANT_ID);
    const root = path.join(getDataDir(DEFAULT_TENANT_ID), 'tmp/uiv-auto-import');
    fs.mkdirSync(root, { recursive: true });
    cleanupOldSessions(root);
    return root;
}

function cleanupOldSessions(root) {
    const now = Date.now();
    if (now - lastCleanupAt < 60 * 60 * 1000) return;
    lastCleanupAt = now;
    try {
        fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .forEach(entry => {
                const sessionDir = path.join(root, entry.name);
                const meta = readMeta(sessionDir);
                const ts = Date.parse(meta?.updatedAt || meta?.createdAt || '');
                if (ts && now - ts > SESSION_TTL_MS) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
            });
    } catch (e) {
        console.warn('[UIV AUTO IMPORT] cleanup failed:', e.message);
    }
}

function isSafeId(value) {
    return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

function safeName(name) {
    const cleaned = String(name || 'uivf12_capture.csv')
        .replace(/[\\/:*?"<>|\r\n]+/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 160);
    return cleaned || 'uivf12_capture.csv';
}

function getSessionDir(sessionId) {
    if (!isSafeId(sessionId)) return '';
    return path.join(getRootDir(), sessionId);
}

function getMetaPath(sessionDir) {
    return path.join(sessionDir, 'meta.json');
}

function readMeta(sessionDir) {
    try {
        return JSON.parse(fs.readFileSync(getMetaPath(sessionDir), 'utf8'));
    } catch (e) {
        return null;
    }
}

function writeMeta(sessionDir, meta) {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(getMetaPath(sessionDir), JSON.stringify(meta, null, 2), 'utf8');
}

function getDatasetsDir(sessionDir) {
    const dir = path.join(sessionDir, 'datasets');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function writeDatasetChunk(sessionDir, dataset, rows, chunkIndex) {
    const chunkName = `${dataset.id}-${String((dataset.chunks || []).length).padStart(5, '0')}.json`;
    const chunkPath = path.join(getDatasetsDir(sessionDir), chunkName);
    fs.writeFileSync(chunkPath, JSON.stringify(rows), 'utf8');
    dataset.chunks = Array.isArray(dataset.chunks) ? dataset.chunks : [];
    dataset.chunks.push({
        file: chunkName,
        rowCount: rows.length,
        chunkIndex: Number.isFinite(chunkIndex) ? chunkIndex : undefined
    });
}

function readDatasetRows(sessionDir, dataset) {
    if (Array.isArray(dataset && dataset.rows)) return dataset.rows;
    const chunks = Array.isArray(dataset && dataset.chunks) ? dataset.chunks : [];
    const rows = [];
    chunks.forEach(chunk => {
        const file = String(chunk && chunk.file || '');
        if (!/^[a-f0-9]{16}-\d{5}\.json$/.test(file)) return;
        const chunkPath = path.join(getDatasetsDir(sessionDir), file);
        try {
            const parsed = JSON.parse(fs.readFileSync(chunkPath, 'utf8'));
            if (Array.isArray(parsed)) rows.push(...parsed);
        } catch (e) {
            console.warn('[UIV AUTO IMPORT] failed to read dataset chunk:', file, e.message);
        }
    });
    return rows;
}

function timingSafeEqualText(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function assertSessionAccess(req, res) {
    const sessionId = req.params.sessionId;
    const token = String(req.query.token || req.body?.token || '');
    if (!isSafeId(sessionId) || !isSafeId(token)) {
        res.status(400).json({ error: '自动导入会话参数无效' });
        return null;
    }
    const sessionDir = getSessionDir(sessionId);
    const meta = readMeta(sessionDir);
    if (meta && !timingSafeEqualText(meta.token, token)) {
        res.status(403).json({ error: '自动导入会话 token 不匹配' });
        return null;
    }
    return { sessionId, token, sessionDir, meta };
}

function normalizeRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
        .filter(row => row && typeof row === 'object' && !Array.isArray(row))
        .map(row => ({ ...row }));
}

function upsertDataset(meta, body, rows, now, sessionDir) {
    const clientUploadId = String(body?.clientUploadId || '');
    const append = !!body?.append && clientUploadId;
    const chunkIndex = Number(body?.chunkIndex);
    meta.datasets = Array.isArray(meta.datasets) ? meta.datasets : [];

    let dataset = append
        ? meta.datasets.find(item => item && item.clientUploadId === clientUploadId)
        : null;
    // 桌面端会把真实下载完成的文件再补传一次（fallback）。同名文件页面内已经上传过就跳过；
    // 反过来补传先到、页面内上传后到时，以页面内的为准替换掉补传的那份。
    if (!dataset && !append) {
        const name = safeName(body?.name);
        const sameName = meta.datasets.filter(item => item && item.name === name);
        if (body?.fallback === true && sameName.length) return { dataset: sameName[0], skipped: true };
        sameName.filter(item => item.fallback).forEach(item => {
            (item.chunks || []).forEach(chunk => {
                const file = String(chunk && chunk.file || '');
                if (/^[a-f0-9]{16}-\d{5}\.json$/.test(file)) fs.rmSync(path.join(getDatasetsDir(sessionDir), file), { force: true });
            });
            meta.datasets.splice(meta.datasets.indexOf(item), 1);
        });
    }
    if (!dataset) {
        dataset = {
            id: crypto.randomBytes(8).toString('hex'),
            clientUploadId: clientUploadId || undefined,
            name: safeName(body?.name),
            chunks: [],
            rowCount: 0,
            uploadedAt: now,
            fallback: body?.fallback === true || undefined
        };
        meta.datasets.push(dataset);
    }

    if (Array.isArray(dataset.rows) && dataset.rows.length) {
        writeDatasetChunk(sessionDir, dataset, dataset.rows);
        delete dataset.rows;
    }
    dataset.chunks = Array.isArray(dataset.chunks) ? dataset.chunks : [];
    const duplicateChunk = append && Number.isFinite(chunkIndex) && dataset.chunks.some(chunk => Number(chunk && chunk.chunkIndex) === chunkIndex);
    if (!duplicateChunk) {
        writeDatasetChunk(sessionDir, dataset, rows, chunkIndex);
        dataset.rowCount = Number(dataset.rowCount || 0) + rows.length;
    }
    dataset.uploadedAt = dataset.uploadedAt || now;
    dataset.updatedAt = now;
    return { dataset };
}

router.post('/:sessionId/datasets', (req, res) => {
    try {
        const access = assertSessionAccess(req, res);
        if (!access) return;
        const rows = normalizeRows(req.body?.rows);
        if (!rows.length) return res.status(400).json({ error: '缺少结构化 rows 数据' });

        const now = new Date().toISOString();
        const sessionDir = access.sessionDir;
        const latestMeta = readMeta(sessionDir);
        const meta = latestMeta || access.meta || {
            id: access.sessionId,
            token: access.token,
            createdAt: now,
            datasets: []
        };
        meta.updatedAt = now;
        meta.origin = req.body?.origin || meta.origin || '';
        meta.groupName = req.body?.groupName || meta.groupName || '';
        const { dataset, skipped } = upsertDataset(meta, req.body, rows, now, sessionDir);
        writeMeta(sessionDir, meta);

        res.json({
            success: true,
            sessionId: access.sessionId,
            skipped: !!skipped,
            dataset: { id: dataset.id, name: dataset.name, rowCount: dataset.rowCount, uploadedAt: dataset.uploadedAt, updatedAt: dataset.updatedAt },
            count: meta.datasets.length
        });
    } catch (err) {
        console.error('[UIV AUTO IMPORT] dataset upload failed:', err);
        res.status(500).json({ error: err.message || '自动导入结构化数据暂存失败' });
    }
});

router.get('/:sessionId', (req, res) => {
    const access = assertSessionAccess(req, res);
    if (!access) return;
    if (!access.meta) return res.status(404).json({ error: '自动导入会话不存在或已过期' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        id: access.meta.id,
        createdAt: access.meta.createdAt,
        updatedAt: access.meta.updatedAt,
        origin: access.meta.origin || '',
        groupName: access.meta.groupName || '',
        datasets: (access.meta.datasets || []).map(dataset => ({
            id: dataset.id,
            name: dataset.name,
            rowCount: dataset.rowCount,
            uploadedAt: dataset.uploadedAt,
            rows: readDatasetRows(access.sessionDir, dataset)
        }))
    });
});

/** 供服务端直接归档：校验 token 后返回会话里的全部数据集（含行） */
function readSession(sessionId, token) {
    if (!isSafeId(sessionId) || !isSafeId(token)) return null;
    const sessionDir = getSessionDir(sessionId);
    const meta = readMeta(sessionDir);
    if (!meta || !timingSafeEqualText(meta.token, token)) return null;
    return { ...meta, datasets: (meta.datasets || []).map(dataset => ({ id: dataset.id, name: dataset.name, rows: readDatasetRows(sessionDir, dataset) })) };
}

/** 导入完成后删掉临时会话，不必等 48 小时过期 */
function removeSession(sessionId, token) {
    if (!readSession(sessionId, token)) return false;
    fs.rmSync(getSessionDir(sessionId), { recursive: true, force: true });
    return true;
}

router.delete('/:sessionId', (req, res) => {
    const access = assertSessionAccess(req, res);
    if (!access) return;
    res.json({ success: removeSession(access.sessionId, access.token) });
});

module.exports = router;
module.exports.readSession = readSession;
module.exports.removeSession = removeSession;
