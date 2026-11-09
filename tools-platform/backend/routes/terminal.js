// Dragon Claw 终端面板 API（仅管理员）：新建 / 列出 / 输入 / 调整大小 / 中断 / 关闭终端标签，以及 NDJSON 实时输出流。
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { getTenantId, getDataDir } = require('../models/tenant-context');
const { ownerKey } = require('../models/agent-run-manager');
const terminals = require('../models/terminal-sessions');
const boundary = require('../models/team-boundary');

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
    if (boundary.isConfined(req.user)) {
        // 团队账号：终端只能开在团队空间内（默认团队工作目录），整个 Shell 运行在团队沙箱里
        const dir = boundary.resolveUserPath(req.user, getTenantId(), cwd);
        boundary.assertAllowed(req.user, getTenantId(), dir, '终端目录');
        try {
            res.json({ session: terminals.create(owner(req), { shell, cwd: dir, cols, rows, title, sandboxTenantId: getTenantId() }) });
        } catch (error) {
            throw Object.assign(error, { status: error.status || error.statusCode || 503 });
        }
        return;
    }
    // 未选工作目录时，默认进入当前租户的数据存储目录
    res.json({ session: terminals.create(owner(req), { shell, cwd: String(cwd || '').trim() || getDataDir(), cols, rows, title }) });
}));
router.post('/sessions/:id/input', handle(async (req, res) => {
    terminals.write(owner(req), req.params.id, req.body?.data);
    res.json({ ok: true });
}));
router.post('/sessions/:id/resize', handle(async (req, res) => res.json({ session: terminals.resize(owner(req), req.params.id, req.body?.cols, req.body?.rows) })));
router.post('/sessions/:id/interrupt', handle(async (req, res) => { terminals.signal(owner(req), req.params.id); res.json({ ok: true }); }));
router.patch('/sessions/:id', handle(async (req, res) => res.json({ session: terminals.rename(owner(req), req.params.id, req.body?.title) })));
router.delete('/sessions/:id', handle(async (req, res) => res.json({ ok: terminals.kill(owner(req), req.params.id) })));

// 浏览器授权回调转交：CLI 登录（thcli/gh/gcloud…）在服务器本机 localhost:端口 等浏览器回调，
// 但用户的浏览器通常不在服务器上，跳回 localhost 会打不开。用户把地址栏里的完整地址交给这里，由服务器本机去请求。
// 只接受 http 回环地址；地址里带 token，走 POST 正文、不写日志。
router.post('/loopback', handle(async (req, res) => {
    let url;
    try { url = new URL(String(req.body?.url || '').trim()); } catch { url = null; }
    if (!url || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.port) {
        throw Object.assign(new Error('只能转交本机回调地址（http://localhost:端口/…）'), { status: 400 });
    }
    let response;
    try {
        response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    } catch (error) {
        const refused = /ECONNREFUSED/.test(String(error?.cause?.code || error?.cause?.message || error?.message));
        throw Object.assign(new Error(refused
            ? `服务器本机 ${url.port} 端口没有程序在等待回调：登录进程可能已退出或超时，请重新发起登录并使用新的授权链接`
            : `转交失败：${error?.cause?.message || error.message}`), { status: 502 });
    }
    const text = (await response.text().catch(() => '')).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    res.json({ ok: response.status < 400, status: response.status, message: text.slice(0, 300) });
}));

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
