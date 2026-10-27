// 数字人基座对接 API，挂载在 /api/digital-human（server.js 中整体 requireAdmin：业务数据第一期只开放给管理员）。
// 配置（导入 .env 文本 / 手动修改 / 连通性测试）、NetCare 表目录与标注、结构化查询、只读 SQL，以及应用库写入。
const express = require('express');
const configRepo = require('../models/digital-human/config-repository');
const client = require('../models/digital-human/base-client');
const catalog = require('../models/digital-human/table-catalog');

const router = express.Router();
const SCOPES = ['business', 'app'];

const handle = fn => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        const status = Number(error.statusCode) || 500;
        res.status(status >= 400 && status < 600 ? status : 500).json({ code: error.code || 'DH_ERROR', error: error.message || '数字人接口调用失败', ...(error.raw ? { raw: error.raw } : {}) });
    }
};

function scopeOf(value) {
    const scope = String(value || 'business');
    if (!SCOPES.includes(scope)) throw client.dhError('DH_BAD_SCOPE', '未知的数据范围（business / app）', { statusCode: 400 });
    return scope;
}

const actorOf = req => req.user?.username || '';

router.get('/config', handle(async (req, res) => {
    res.json({ config: await configRepo.getConfig(), defaults: configRepo.DEFAULT_CONFIG });
}));

router.put('/config', handle(async (req, res) => {
    const config = await configRepo.saveConfig(req.body || {});
    catalog.invalidate();
    res.json({ config });
}));

// 只解析不保存：返回识别到的字段、忽略项和告警，以及合并后的预览配置
router.post('/config/parse', handle(async (req, res) => {
    const parsed = configRepo.parseEnvText(req.body?.text);
    const current = await configRepo.getConfig();
    res.json({ ...parsed, preview: configRepo.normalizeConfig({ ...current, ...parsed.patch }) });
}));

router.post('/config/import', handle(async (req, res) => {
    const parsed = configRepo.parseEnvText(req.body?.text);
    if (!parsed.applied.length) throw client.dhError('DH_IMPORT_EMPTY', parsed.warnings[0] || '没有识别到可用的配置项', { statusCode: 400 });
    const config = await configRepo.saveConfig({ ...parsed.patch, ...(req.body?.enable ? { enabled: true } : {}) });
    catalog.invalidate();
    res.json({ ...parsed, config });
}));

// 用请求体里的配置（未保存的草稿也可以）测试；结果写回 lastTest，便于设置页显示上次测试情况
router.post('/test', handle(async (req, res) => {
    const saved = await configRepo.getConfig();
    const draft = req.body && typeof req.body.config === 'object' ? configRepo.normalizeConfig({ ...saved, ...req.body.config }) : saved;
    const result = await client.testConnection(draft);
    await configRepo.saveTestResult({ at: result.at, ok: result.ok, steps: result.steps.map(({ raw, ...step }) => step) });
    res.json(result);
}));

router.get('/tables', handle(async (req, res) => {
    res.json(await catalog.listTables({ scope: scopeOf(req.query.scope), refresh: req.query.refresh === '1' }));
}));

router.get('/tables/:name', handle(async (req, res) => {
    res.json(await catalog.describeTable(scopeOf(req.query.scope), req.params.name, { sampleRows: req.query.sample }));
}));

router.put('/tables/:name/notes', handle(async (req, res) => {
    res.json({ note: await catalog.saveNote(scopeOf(req.query.scope || req.body?.scope), req.params.name, req.body || {}, actorOf(req)) });
}));

router.post('/tables/:name/count', handle(async (req, res) => {
    res.json(await catalog.countRows(scopeOf(req.body?.scope), req.params.name, req.body?.filters));
}));

router.post('/query', handle(async (req, res) => {
    const body = req.body || {};
    res.json(await catalog.queryTable(scopeOf(body.scope), body));
}));

// 只读 SQL 控制台：单条 SELECT / WITH / SHOW / DESC / EXPLAIN，自动分页
router.post('/sql', handle(async (req, res) => {
    const scope = scopeOf(req.body?.scope);
    const result = await client.queryAll(req.body?.sql, { scope, maxRows: req.body?.maxRows });
    res.json({ scope, ...result });
}));

// 应用库写入（INSERT / UPDATE / DELETE，必须带 WHERE）；业务库没有写接口
router.post('/execute', handle(async (req, res) => {
    const result = await client.executeApp(req.body?.sql);
    console.log(`[digital-human] ${actorOf(req)} executed ${result.kind} on app schema, affected=${result.affectedRows ?? '?'}`);
    res.json(result);
}));

module.exports = router;
