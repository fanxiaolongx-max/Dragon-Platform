const express = require('express');
const router = express.Router();
const metricsRepo = require('../models/platform-metrics-repository');
const serviceStatusRepo = require('../models/service-status-repository');
const desktopLicenseLocal = require('./desktop-license-local');
const channelWatchdog = require('../models/channels/channel-watchdog');
const { requireAdmin } = require('../middleware/auth');

router.get('/service-status', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const history = await serviceStatusRepo.getHistory(req.query.days);
        history.license = serviceStatusRepo.summarizeLicenseStatus(desktopLicenseLocal.getStatus());
        try {
            history.channels = await channelWatchdog.getWatchdogSummary();
        } catch (channelErr) {
            console.warn('[platform-metrics] 频道心跳状态读取失败：', channelErr.message);
            history.channels = { enabled: false, error: channelErr.message, channels: [] };
        }
        res.json(history);
    } catch (err) {
        console.error('[platform-metrics] service status failed:', err);
        res.status(500).json({ error: '读取服务状态统计失败' });
    }
});

router.post('/service-status/channels/inspect', requireAdmin, async (_req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const summary = await channelWatchdog.inspectNow();
        res.json(summary);
    } catch (err) {
        console.error('[platform-metrics] channel inspect failed:', err);
        res.status(500).json({ error: '抽查频道状态失败：' + (err.message || '未知错误') });
    }
});

router.get('/service-status/failures', requireAdmin, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await serviceStatusRepo.getFailures({
            serviceKey: req.query.serviceKey,
            date: req.query.date,
            statusClass: req.query.statusClass,
            limit: req.query.limit
        }));
    } catch (err) {
        console.error('[platform-metrics] service status failures failed:', err);
        res.status(500).json({ error: '读取失败请求明细失败' });
    }
});

router.get('/service-status/logs', requireAdmin, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await serviceStatusRepo.getRuntimeLogs({
            q: req.query.q,
            level: req.query.level,
            levels: req.query.levels,
            date: req.query.date,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            page: req.query.page,
            pageSize: req.query.pageSize
        }));
    } catch (err) {
        console.error('[platform-metrics] runtime logs failed:', err);
        res.status(500).json({ error: '读取程序运行日志失败' });
    }
});

router.get('/summary', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await metricsRepo.getSummary());
    } catch (err) {
        console.error('[platform-metrics] summary failed:', err);
        res.status(500).json({ error: '读取平台效能统计失败' });
    }
});

router.post('/open', async (req, res) => {
    try {
        res.json(await metricsRepo.trackOpen(req.body && req.body.toolKey));
    } catch (err) {
        res.status(400).json({ error: err.message || '记录使用量失败' });
    }
});

module.exports = router;
