const express = require('express');
const topicSnapshotsRepo = require('../models/topic-snapshots-repository');
const createChunkUploadRouter = require('./custom-tool-chunk-upload');

const router = express.Router();

async function importSnapshot(payload) {
    const result = await topicSnapshotsRepo.saveSnapshot(payload?.snapshot, { name: payload?.name });
    return {
        message: result.created ? '专题快照已保存到服务器' : '相同专题快照已存在，已更新导入时间',
        ...result
    };
}

router.use('/import-upload', (req, res, next) => {
    res.setHeader('X-Data-Source', 'sqlite');
    next();
}, createChunkUploadRouter(importSnapshot, { scope: 'topics', formatResult: result => result }));

function sendError(res, error, fallback) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[topic-snapshots]', error);
    res.status(status).json({ error: status >= 500 ? fallback : error.message, code: error?.code });
}

router.get('/', async (req, res) => {
    try {
        const result = await topicSnapshotsRepo.listSnapshots(req.query);
        res.setHeader('X-Data-Source', 'sqlite');
        res.json(result);
    } catch (error) {
        sendError(res, error, '读取专题快照失败');
    }
});

router.get('/series', async (req, res) => {
    try {
        const items = await topicSnapshotsRepo.getSeries(req.query);
        res.setHeader('X-Data-Source', 'sqlite');
        res.json({ items });
    } catch (error) {
        sendError(res, error, '读取专题趋势失败');
    }
});

router.get('/latest', async (req, res) => {
    try {
        const item = await topicSnapshotsRepo.getLatestSnapshot(req.query.platform);
        res.setHeader('X-Data-Source', 'sqlite');
        if (!item) return res.status(404).json({ error: '暂无专题快照', code: 'TOPIC_SNAPSHOT_NOT_FOUND' });
        res.json({ item });
    } catch (error) {
        sendError(res, error, '读取最新专题快照失败');
    }
});

router.get('/eos-monthly-report', async (req, res) => {
    try {
        const result = await topicSnapshotsRepo.getEosMonthlyReport(req.query.month);
        res.setHeader('X-Data-Source', 'sqlite');
        res.json(result);
    } catch (error) {
        sendError(res, error, '读取 EOS 进展月报失败');
    }
});

router.get('/monthly-report', async (req, res) => {
    try {
        const result = await topicSnapshotsRepo.getMonthlyReport(req.query.topic, req.query.month);
        res.setHeader('X-Data-Source', 'sqlite');
        res.json(result);
    } catch (error) {
        sendError(res, error, '读取专题月报失败');
    }
});

router.get('/mapping-config', async (req, res) => {
    try {
        const config = await topicSnapshotsRepo.getMappingConfig();
        res.setHeader('X-Data-Source', 'sqlite');
        res.json({ config });
    } catch (error) {
        sendError(res, error, '读取客户映射配置失败');
    }
});

router.put('/mapping-config', async (req, res) => {
    try {
        const config = await topicSnapshotsRepo.saveMappingConfig(req.body);
        res.setHeader('X-Data-Source', 'sqlite');
        res.json({ success: true, config });
    } catch (error) {
        sendError(res, error, '保存客户映射配置失败');
    }
});

router.get('/:id', async (req, res) => {
    try {
        const item = await topicSnapshotsRepo.getSnapshot(req.params.id);
        res.setHeader('X-Data-Source', 'sqlite');
        if (!item) return res.status(404).json({ error: '专题快照不存在', code: 'TOPIC_SNAPSHOT_NOT_FOUND' });
        res.json({ item });
    } catch (error) {
        sendError(res, error, '读取专题快照失败');
    }
});

router.post('/', async (req, res) => {
    req.suppressBodyLog = true;
    try {
        const result = await importSnapshot(req.body || {});
        res.setHeader('X-Data-Source', 'sqlite');
        res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
        sendError(res, error, '保存专题快照失败');
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const deleted = await topicSnapshotsRepo.deleteSnapshot(req.params.id);
        if (!deleted) return res.status(404).json({ error: '专题快照不存在', code: 'TOPIC_SNAPSHOT_NOT_FOUND' });
        res.json({ message: '专题快照已删除' });
    } catch (error) {
        sendError(res, error, '删除专题快照失败');
    }
});

module.exports = router;
