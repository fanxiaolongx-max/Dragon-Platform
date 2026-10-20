const express = require('express');
const repo = require('../models/platform-promotions-repository');
const clicks = require('../models/platform-promotion-clicks-repository');
const { getDesktopPromotions, rememberOwner } = require('../models/platform-promotions-desktop');
const { getTenantId } = require('../models/tenant-context');

const router = express.Router();

function syncDesktop(config) {
    const desktop = getDesktopPromotions();
    if (!desktop) return;
    try { desktop.sync(config); } catch (error) { console.warn('[platform-promotions] 同步桌面推广卡片失败：', error.message || error); }
}

router.get('/', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await repo.getConfig());
    } catch (error) {
        res.status(500).json({ error: error.message || '读取平台推广配置失败' });
    }
});

// 非 GET 默认需要管理员（server.js 统一拦截）
router.put('/', async (req, res) => {
    try {
        const config = await repo.saveConfig(req.body || {});
        syncDesktop(config);
        res.json(config);
    } catch (error) {
        res.status(400).json({ error: error.message || '保存平台推广配置失败' });
    }
});

// 默认（系统自带）推广链接写回项目源码 backend/platform-promotions-defaults.json，提交 Git 后成为所有环境的默认值
router.put('/defaults', async (req, res) => {
    try {
        repo.saveDefaultLinks(req.body && req.body.links);
        const config = await repo.getConfig();
        syncDesktop(config);
        res.json(config);
    } catch (error) {
        res.status(error.statusCode || 400).json({ error: error.message || '保存默认推广链接失败' });
    }
});

// 登录用户点击推广项（打开视频大窗 / 打开链接）时上报；server.js 对该路径放行非管理员
router.post('/clicks', async (req, res) => {
    try {
        const { id, kind } = req.body || {};
        if (!['video', 'link'].includes(kind)) return res.status(400).json({ error: '无效的推广类型' });
        const config = await repo.getConfig();
        const known = kind === 'video' ? config.videos.some(video => video.id === id) : config.links.some(link => link.id === id);
        if (!known) return res.status(404).json({ error: '推广项不存在' });
        // 浏览器上报只有两种：打开视频大窗、新标签页打开链接；桌面大窗与卡片堆点击由服务端自己记录
        const counted = await clicks.record({ promoId: id, kind, channel: kind === 'video' ? 'video' : 'tab', username: req.user && req.user.username });
        res.json({ success: true, counted });
    } catch (error) {
        res.status(400).json({ error: error.message || '记录推广点击失败' });
    }
});

// 统计结果只给管理员（全局设置 › 平台推广底部）
router.get('/stats', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ code: 'ADMIN_REQUIRED', error: 'Administrator required' });
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await clicks.summary({ days: req.query.days }));
    } catch (error) {
        res.status(500).json({ error: error.message || '读取推广点击统计失败' });
    }
});

// ── 桌面卡片堆：只允许本机登录用户访问（以真实对端地址判断，不信任转发头） ──
const desktop = express.Router();
desktop.use((req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Login required' });
    const controller = getDesktopPromotions();
    const peer = req.socket?.remoteAddress;
    if (!controller || process.env.TOOLS_DESKTOP_RUNTIME !== '1' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
        if (req.method === 'GET' && req.path === '/') return res.json({ available: false });
        return res.status(403).json({ code: 'DESKTOP_LOCAL_ONLY', error: 'Local desktop access required' });
    }
    if (req.headers.origin) {
        try {
            const origin = new URL(req.headers.origin);
            if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.host !== req.headers.host) {
                return res.status(403).json({ code: 'DESKTOP_LOCAL_ONLY', error: 'Same-origin access required' });
            }
        } catch (_) {
            return res.status(403).json({ code: 'DESKTOP_LOCAL_ONLY', error: 'Invalid origin' });
        }
    }
    req.desktopPromotions = controller;
    next();
});

desktop.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ available: true, ...req.desktopPromotions.status() });
});

// 首页登录后调用：按当前配置打开 / 更新右下角卡片堆
desktop.post('/sync', async (req, res) => {
    try {
        rememberOwner(getTenantId(), req.user.username);
        req.desktopPromotions.sync(await repo.getConfig());
        res.json({ available: true, ...req.desktopPromotions.status() });
    } catch (error) {
        res.status(500).json({ error: error.message || '同步桌面推广失败' });
    }
});

desktop.get('/frame/:id', async (req, res) => {
    try {
        const jpeg = await req.desktopPromotions.frame(String(req.params.id));
        if (!jpeg) return res.status(404).end();
        res.setHeader('Cache-Control', 'no-store');
        res.type('image/jpeg').send(jpeg);
    } catch (error) {
        res.status(500).json({ error: error.message || '读取推广画面失败' });
    }
});

desktop.post('/open/:id', async (req, res) => {
    try {
        const config = await repo.getConfig();
        const link = config.links.find(item => item.id === req.params.id && item.enabled);
        if (!link) return res.status(404).json({ error: '推广链接不存在或已隐藏' });
        const opened = req.desktopPromotions.open(link, config) !== false;
        if (opened) await clicks.record({ promoId: link.id, kind: 'link', channel: 'desktop', username: req.user.username }).catch(() => false);
        res.json({ success: opened });
    } catch (error) {
        res.status(500).json({ error: error.message || '打开推广窗口失败' });
    }
});

// 浮窗脚本：数据抓取页生成脚本后交给桌面浏览器，打开站点并在登录完成后自动运行（等同于在 F12 控制台粘贴运行）
desktop.get('/site-scripts', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items: req.desktopPromotions.listSiteScripts() });
});

desktop.post('/site-scripts', (req, res) => {
    req.suppressBodyLog = true;
    try {
        const { origin, name, url, code, run } = req.body || {};
        res.json({ success: true, item: req.desktopPromotions.putSiteScript({ origin, name, url, code }, { run: run !== false }) });
    } catch (error) {
        res.status(400).json({ error: error.message || '保存浮窗脚本失败' });
    }
});

desktop.post('/site-scripts/run', (req, res) => {
    if (!req.desktopPromotions.runSiteScript(String(req.body && req.body.origin || ''))) return res.status(404).json({ error: '没有这个站点的浮窗脚本' });
    res.json({ success: true });
});

router.use('/desktop', desktop);

module.exports = router;
