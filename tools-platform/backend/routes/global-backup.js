const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const repo = require('../models/global-backup-repository');
const remoteRepo = require('../models/remote-backup-sync-repository');
const { requireCurrentSuperAdmin } = require('../middleware/auth');

const { getDataDir } = require('../models/store');
const { DEFAULT_TENANT_ID, getTenantId, normalizeTenantId, runWithTenant } = require('../models/tenant-context');

const router = express.Router();
router.use(requireCurrentSuperAdmin);
const operationLogs = new Map();
const MAX_OPERATION_LOGS = 60;

const upload = multer({
    storage: multer.diskStorage({
        destination(_req, _file, callback) {
            const dir = path.join(getDataDir(), 'tmp/uploads');
            fs.mkdirSync(dir, { recursive: true });
            callback(null, dir);
        },
        filename(_req, _file, callback) { callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.zip`); }
    }),
    limits: { fileSize: 1024 * 1024 * 1024 }
});

function handleError(res, err, fallback) {
    const payload = { error: err.message || fallback };
    ['code', 'backupTenantId', 'backupTenantName', 'currentTenantId', 'currentTenantName', 'requestedTenantId'].forEach(key => {
        if (err[key] !== undefined) payload[key] = err[key];
    });
    res.status(err.statusCode || 500).json(payload);
}

function requestFlag(value) {
    return value === true || value === 1 || String(value || '').toLowerCase() === 'true';
}

function requireRestoreTarget(req) {
    const sessionTenantId = normalizeTenantId(req.user?.tenantId || DEFAULT_TENANT_ID);
    const requestedValue = String(req.body?.targetTenantId || '').trim();
    if (requestedValue) {
        const requestedTenantId = normalizeTenantId(requestedValue);
        if (requestedTenantId !== sessionTenantId || requestedTenantId !== requestedValue.toLowerCase()) {
            const error = new Error(`页面选择的目标租户“${requestedValue}”与当前登录 Session 租户“${sessionTenantId}”不一致。为避免恢复到错误租户，已停止操作，请刷新页面后重新选择租户。`);
            error.statusCode = 409;
            error.code = 'ACTIVE_TENANT_CHANGED';
            error.requestedTenantId = requestedValue;
            error.currentTenantId = sessionTenantId;
            throw error;
        }
    }
    return sessionTenantId;
}

function getOperationId(req) {
    const value = String(req.headers['x-backup-operation-id'] || '').trim();
    return /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : '';
}

function startOperation(req, type) {
    const id = getOperationId(req);
    if (!id) return null;
    const operation = {
        id,
        type,
        status: 'running',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entries: []
    };
    operationLogs.set(`${getTenantId()}:${id}`, operation);
    while (operationLogs.size > MAX_OPERATION_LOGS) {
        operationLogs.delete(operationLogs.keys().next().value);
    }
    return operation;
}

function appendOperation(operation, entry) {
    if (!operation) return;
    operation.entries.push({
        timestamp: entry.timestamp || new Date().toISOString(),
        stage: entry.stage || 'progress',
        level: entry.level || 'info',
        message: entry.message || '',
        detail: entry.detail || null
    });
    operation.updatedAt = new Date().toISOString();
    if (operation.entries.length > 300) operation.entries.splice(0, operation.entries.length - 300);
}

function finishOperation(operation, status, message) {
    if (!operation) return;
    operation.status = status;
    operation.updatedAt = new Date().toISOString();
    operation.completedAt = new Date().toISOString();
    if (message) appendOperation(operation, {
        stage: status,
        level: status === 'completed' ? 'success' : 'error',
        message
    });
}

router.get('/operations/:id', (req, res) => {
    const operation = operationLogs.get(`${getTenantId()}:${req.params.id}`);
    if (!operation) return res.status(404).json({ error: '备份任务日志不存在或已过期' });
    res.json(operation);
});

function scheduleProcessExitAfterRestore(res, source) {
    if (process.env.TOOLS_BACKUP_AUTO_EXIT_AFTER_RESTORE === 'false') return;
    res.on('finish', () => {
        console.log(`[GLOBAL BACKUP] Restore from ${source} completed. SQLite connections were closed for safe file replacement; exiting current process so it can be restarted cleanly.`);
        setTimeout(() => process.exit(0), 800);
    });
}

router.get('/list', (req, res) => {
    try {
        res.json({
            backups: repo.listBackups(),
            targets: repo.DATA_TARGETS,
            scope: 'single-tenant',
            tenantId: getTenantId(),
            includesAllTenants: false
        });
    } catch (err) {
        handleError(res, err, '获取备份列表失败');
    }
});

router.get('/schedule-settings', async (req, res) => {
    try {
        res.json(repo.getScheduleStatus(await repo.getScheduleSettings()));
    } catch (err) {
        handleError(res, err, '获取定时备份设置失败');
    }
});

router.put('/schedule-settings', async (req, res) => {
    try {
        res.json(await repo.saveScheduleSettings(req.body || {}));
    } catch (err) {
        handleError(res, err, '保存定时备份设置失败');
    }
});

router.post('/schedule-run', async (req, res) => {
    try {
        res.json(await repo.runScheduledBackup({ source: 'manual-trigger', reason: 'scheduled-auto-manual-trigger' }));
    } catch (err) {
        handleError(res, err, '执行定时备份失败');
    }
});

router.post('/create', async (req, res) => {
    const operation = startOperation(req, 'create');
    try {
        appendOperation(operation, { stage: 'start', message: '收到创建备份请求' });
        const result = await repo.createBackup({
            reason: req.body?.reason || 'manual',
            onProgress: entry => appendOperation(operation, entry)
        });
        finishOperation(operation, 'completed', '备份任务完成');
        res.json(result);
    } catch (err) {
        finishOperation(operation, 'failed', err.message || '创建备份失败');
        handleError(res, err, '创建备份失败');
    }
});

router.get('/download/:name', (req, res) => {
    try {
        const filePath = repo.getBackupPath(req.params.name);
        res.download(filePath, path.basename(filePath));
    } catch (err) {
        handleError(res, err, '下载备份失败');
    }
});

router.delete('/delete/:name', (req, res) => {
    try {
        const result = repo.deleteBackup(req.params.name);
        res.json(result);
    } catch (err) {
        handleError(res, err, '删除备份失败');
    }
});

router.post('/restore/server/:name', async (req, res) => {
    const operation = startOperation(req, 'restore-server');
    try {
        const targetTenantId = requireRestoreTarget(req);
        appendOperation(operation, { stage: 'start', message: `准备恢复服务器备份：${req.params.name}` });
        const result = await runWithTenant(targetTenantId, () => {
            const filePath = repo.getBackupPath(req.params.name);
            return repo.restoreFromZip(filePath, {
                forceCrossTenant: requestFlag(req.body?.forceCrossTenant),
                onProgress: entry => appendOperation(operation, entry)
            });
        });
        finishOperation(operation, 'completed', '恢复任务完成，服务即将重启');
        scheduleProcessExitAfterRestore(res, `server backup ${req.params.name}`);
        res.json(result);
    } catch (err) {
        finishOperation(operation, 'failed', err.message || '恢复失败');
        handleError(res, err, '从服务器备份恢复失败');
    }
});

router.post('/restore/upload', upload.single('backup'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传备份包' });
    const operation = startOperation(req, 'restore-upload');
    try {
        const targetTenantId = requireRestoreTarget(req);
        appendOperation(operation, {
            stage: 'upload-received',
            message: `备份包上传完成：${req.file.originalname || req.file.filename}`,
            detail: { size: req.file.size }
        });
        const result = await runWithTenant(targetTenantId, () => repo.restoreFromZip(req.file.path, {
            forceCrossTenant: requestFlag(req.body?.forceCrossTenant),
            onProgress: entry => appendOperation(operation, entry)
        }));
        finishOperation(operation, 'completed', '恢复任务完成，服务即将重启');
        scheduleProcessExitAfterRestore(res, `uploaded backup ${req.file.originalname || req.file.filename}`);
        res.json(result);
    } catch (err) {
        finishOperation(operation, 'failed', err.message || '恢复失败');
        handleError(res, err, '从上传备份包恢复失败');
    } finally {
        fs.rmSync(req.file.path, { force: true });
    }
});

router.get('/remote-settings', (req, res) => {
    try {
        res.json(remoteRepo.getPublicSettings());
    } catch (err) {
        handleError(res, err, '获取远端备份同步设置失败');
    }
});

router.put('/remote-settings', (req, res) => {
    try {
        res.json(remoteRepo.saveSettings(req.body || {}));
    } catch (err) {
        handleError(res, err, '保存远端备份同步设置失败');
    }
});

router.post('/remote-check', async (req, res) => {
    try {
        const result = await remoteRepo.pullRemoteBackup({
            restore: false,
            force: true,
            createRemoteBackupBeforePull: false
        });
        res.json(result);
    } catch (err) {
        handleError(res, err, '检查远端备份失败');
    }
});

router.post('/remote-pull', async (req, res) => {
    try {
        const result = await remoteRepo.pullRemoteBackup({
            restore: req.body?.restore !== false,
            force: Boolean(req.body?.force)
        });
        if (result.restored) scheduleProcessExitAfterRestore(res, `remote backup ${result.latest?.name || '-'}`);
        res.json(result);
    } catch (err) {
        handleError(res, err, '拉取远端备份失败');
    }
});

module.exports = router;
