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

module.exports = router;
