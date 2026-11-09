// Dragon Claw 终端面板 API（仅管理员）：新建 / 列出 / 输入 / 调整大小 / 中断 / 关闭终端标签，以及 NDJSON 实时输出流。
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { getTenantId } = require('../models/tenant-context');
const { ownerKey } = require('../models/agent-run-manager');
const terminals = require('../models/terminal-sessions');

const router = express.Router();
router.use(express.json({ limit: '128kb' }));
router.use(requireAdmin);

const owner = req => ownerKey(req.user, getTenantId());
const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (error) {
        if (!res.headersSent) res.status(error.status || 500).json({ error: error.message || '终端操作失败' });
    }
};

router.get('/info', handle(async (_req, res) => res.json(terminals.info())));
router.get('/sessions', handle(async (req, res) => res.json({ items: terminals.list(owner(req)), ...terminals.info() })));
router.post('/sessions', handle(async (req, res) => {
    const { shell, cwd, cols, rows, title } = req.body || {};
    res.json({ session: terminals.create(owner(req), { shell, cwd, cols, rows, title }) });
}));
router.post('/sessions/:id/input', handle(async (req, res) => {
    terminals.write(owner(req), req.params.id, req.body?.data);
    res.json({ ok: true });
}));
router.post('/sessions/:id/resize', handle(async (req, res) => res.json({ session: terminals.resize(owner(req), req.params.id, req.body?.cols, req.body?.rows) })));
router.post('/sessions/:id/interrupt', handle(async (req, res) => { terminals.signal(owner(req), req.params.id); res.json({ ok: true }); }));
router.patch('/sessions/:id', handle(async (req, res) => res.json({ session: terminals.rename(owner(req), req.params.id, req.body?.title) })));
router.delete('/sessions/:id', handle(async (req, res) => res.json({ ok: terminals.kill(owner(req), req.params.id) })));

router.get('/sessions/:id/stream', handle(async (req, res) => {
    const key = owner(req);
    // 先校验存在，失败时还能返回 JSON 错误
    terminals.view(key, req.params.id);
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    // 输出合并后再写：命令刷屏时每 30ms 最多一包
    let pending = '';
    let timer = null;
    const flush = () => {
        timer = null;
        if (!pending || res.writableEnded) return;
        res.write(`${JSON.stringify({ type: 'data', data: pending })}\n`);
        pending = '';
    };
    const detach = terminals.attach(key, req.params.id, event => {
        if (res.writableEnded) return;
        if (event.type === 'data') {
            pending += event.data;
            if (!timer) timer = setTimeout(flush, 30);
            return;
        }
        flush();
        res.write(`${JSON.stringify(event)}\n`);
    });
    const heartbeat = setInterval(() => { if (!res.writableEnded) res.write('{"type":"ping"}\n'); }, 20000);
    req.on('close', () => {
        clearInterval(heartbeat);
        clearTimeout(timer);
        detach();
    });
}));

module.exports = router;
