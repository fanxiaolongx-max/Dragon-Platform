// 全局设置 › 智能体工具：MCP 服务配置（只给管理员、只在默认租户）与首页对话可用工具清单。
const express = require('express');
const mcp = require('../models/agent-mcp');

const router = express.Router();

const fail = (res, error) => res.status(error.statusCode || 500).json({ code: error.code || 'MCP_ERROR', error: error.message });

router.get('/servers', async (_req, res) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.json({ servers: await mcp.listServers() }); } catch (error) { fail(res, error); }
});

router.put('/servers', async (req, res) => {
    try { res.json({ servers: await mcp.saveServers(req.body?.servers) }); } catch (error) { fail(res, error); }
});

router.post('/servers/:id/test', async (req, res) => {
    try { res.json({ server: await mcp.testServer(req.params.id) }); } catch (error) { fail(res, error); }
});

// 工具清单：引擎自带、常驻、按需分组、技能工具、浏览器与 MCP，含说明占用的 token 与调用次数
router.get('/catalog', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await require('../models/agent-tool-catalog').build({ user: req.user }));
    } catch (error) { fail(res, error); }
});

// 危险操作：类别说明与「不再询问」规则（这个工作目录 / 永久，当前租户）；撤销后下一轮对话生效
router.get('/danger-rules', async (_req, res) => {
    try {
        const danger = require('../models/agent-danger-rules');
        res.setHeader('Cache-Control', 'no-store');
        res.json({ categories: danger.catalog(), rules: await danger.list() });
    } catch (error) { fail(res, error); }
});

// 设置页只能加「永久」规则；「这个工作目录」在对话的审批卡上选
router.post('/danger-rules', async (req, res) => {
    try { res.json({ rule: await require('../models/agent-danger-rules').add({ category: req.body?.category, scope: 'global', by: req.user?.username }) }); } catch (error) { fail(res, error); }
});

router.delete('/danger-rules/:id', async (req, res) => {
    try { res.json(await require('../models/agent-danger-rules').remove(req.params.id)); } catch (error) { fail(res, error); }
});

// 工具使用说明：状态、生成（后台执行，轮询 GET 看进度）、查看单份
router.get('/tool-guides', async (_req, res) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.json(await require('../models/platform-tool-guides').status()); } catch (error) { fail(res, error); }
});

router.post('/tool-guides/generate', async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 200) : null;
        res.json({ job: await require('../models/platform-tool-guides').startGeneration({ force: req.body?.force === true, ids }) });
    } catch (error) { fail(res, error); }
});

router.get('/tool-guides/item', async (req, res) => {
    try {
        const guide = await require('../models/platform-tool-guides').readGuide(String(req.query.id || ''));
        if (!guide) return res.status(404).json({ code: 'TOOL_GUIDE_NOT_FOUND', error: '这个工具还没有生成说明' });
        res.json(guide);
    } catch (error) { fail(res, error); }
});

module.exports = router;
