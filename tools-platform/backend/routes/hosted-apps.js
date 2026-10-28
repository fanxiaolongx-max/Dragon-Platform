// 托管 Python 应用 API：启动页（登录用户）与运维操作（管理员）。导入走自定义工具的上传通道。
const express = require('express');
const router = express.Router();
const runtime = require('../models/hosted-apps/runtime');
const service = require('../models/hosted-apps/service');
const { requireAdmin } = require('../middleware/auth');

const send = (res, error, fallback) => res.status(error.status || 500).json({ error: error.message || fallback, code: error.code });

router.get('/settings', requireAdmin, async (req, res) => {
    const python = await runtime.findPython({ refresh: req.query.refresh === '1' });
    res.json({ success: true, settings: runtime.getSettings(), python, apps: runtime.listApps() });
});

router.put('/settings', requireAdmin, async (req, res) => {
    try {
        const settings = runtime.saveSettings(req.body || {});
        res.json({ success: true, settings, python: await runtime.findPython({ refresh: true }) });
    } catch (error) { send(res, error, '保存设置失败'); }
});

router.post('/preview', requireAdmin, async (req, res) => {
    req.suppressBodyLog = true;
    try {
        res.json({ success: true, app: await service.preview(req.body || {}) });
    } catch (error) { send(res, error, '识别应用包失败'); }
});

router.get('/:slug/launch', async (req, res) => {
    try {
        const result = await service.launch(req.params.slug, req.user);
        if (!result) return res.status(404).json({ error: '应用不存在' });
        res.json({ success: true, app: result });
    } catch (error) { send(res, error, '打开应用失败'); }
});

router.get('/:slug/status', requireAdmin, (req, res) => {
    try {
        const status = runtime.status(req.params.slug);
        if (!status) return res.status(404).json({ error: '应用不存在' });
        res.json({ success: true, app: status });
    } catch (error) { send(res, error, '读取状态失败'); }
});

router.get('/:slug/logs', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        res.json({ success: true, lines: runtime.logs(req.params.slug, req.query.limit) });
    } catch (error) { send(res, error, '读取日志失败'); }
});

// 运维操作立即返回，安装/启动在后台进行，启动页轮询状态
const actions = {
    start: slug => { runtime.updateState(slug, { desired: 'running' }); runtime.start(slug).catch(() => {}); },
    restart: slug => { runtime.updateState(slug, { desired: 'running' }); runtime.restart(slug).catch(() => {}); },
    stop: slug => runtime.stop(slug),
    reinstall: async slug => {
        await runtime.stop(slug, { keepDesired: true });
        runtime.install(slug, { force: true }).then(() => runtime.start(slug)).catch(() => {});
    }
};

router.post('/:slug/:action(start|stop|restart|reinstall)', requireAdmin, async (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        await actions[req.params.action](req.params.slug);
        res.json({ success: true, app: runtime.status(req.params.slug) });
    } catch (error) { send(res, error, '操作失败'); }
});

module.exports = router;
