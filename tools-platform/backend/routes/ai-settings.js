const express = require('express');
const router = express.Router();
const repo = require('../models/ai-settings-repository');
const aiProviderClient = require('../models/ai-provider-client');
const aiUsageRepo = require('../models/ai-usage-repository');

router.get('/', async (req, res) => {
    res.json(await repo.getPublicSettings());
});

router.get('/usage', async (req, res) => {
    try {
        res.json(await aiUsageRepo.getUsageStats({ dimension: req.query.dimension }));
    } catch (err) {
        res.status(500).json({ error: err.message || '读取 AI 用量失败' });
    }
});

router.delete('/usage', async (req, res) => {
    try {
        const { key, provider, model, profileId, clearAll } = req.query || {};
        const result = await aiUsageRepo.clearUsageStats({
            key,
            provider,
            model,
            profileId,
            clearAll: clearAll === 'true' || clearAll === true || key === 'all'
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message || '清空用量统计失败' });
    }
});

router.post('/usage/clear', async (req, res) => {
    try {
        const { key, provider, model, profileId, clearAll } = req.body || {};
        const result = await aiUsageRepo.clearUsageStats({
            key,
            provider,
            model,
            profileId,
            clearAll: clearAll === 'true' || clearAll === true || key === 'all'
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message || '清空用量统计失败' });
    }
});

router.put('/', async (req, res) => {
    try {
        res.json(await repo.saveSettings(req.body || {}));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '保存 AI 助手设置失败' });
    }
});

// 对话模型选择的自定义名称映射（整表保存；空数组表示直接暴露真实模型名）
router.put('/model-aliases', async (req, res) => {
    try {
        res.json(await repo.saveModelAliases(req.body && req.body.aliases));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '保存模型映射失败' });
    }
});

router.post('/profiles', async (req, res) => {
    try {
        res.status(201).json(await repo.createProfile(req.body || {}));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '创建 AI 配置失败' });
    }
});

router.put('/profiles/:profileId', async (req, res) => {
    try {
        res.json(await repo.saveSettings({ ...(req.body || {}), profileId: req.params.profileId }));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '保存 AI 配置失败' });
    }
});

router.post('/profiles/:profileId/activate', async (req, res) => {
    try {
        res.json(await repo.activateProfile(req.params.profileId));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '激活 AI 配置失败' });
    }
});

router.delete('/profiles/:profileId', async (req, res) => {
    try {
        res.json(await repo.deleteProfile(req.params.profileId));
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '删除 AI 配置失败' });
    }
});

router.post('/test', async (req, res) => {
    try {
        const settings = await repo.buildRuntimeSettings(req.body || {});
        if (!settings.hasApiKey || !settings.keyLooksValid) {
            return res.status(400).json({
                success: false,
                error: 'API Token 未配置或格式疑似无效。'
            });
        }
        const client = aiProviderClient.createClient(settings);
        const result = await client.generateText({
            systemInstruction: '你是模型连通性测试助手。请只回复 OK 和模型名称，不要解释。',
            prompt: '请回复：OK',
            maxOutputTokens: 64,
            temperature: 0
        });
        res.json({
            success: true,
            provider: settings.provider,
            anthropicAuthType: settings.anthropicAuthType,
            apiBaseUrl: settings.apiBaseUrl,
            model: settings.model,
            reply: String(result.text || '').slice(0, 300),
            usage: result.usage || {}
        });
    } catch (err) {
        res.status(err.statusCode || err.status || 500).json({
            success: false,
            error: err.message || '模型测试失败'
        });
    }
});

router.post('/profiles/:profileId/test', async (req, res) => {
    try {
        const settings = await repo.buildRuntimeSettings({ ...(req.body || {}), profileId: req.params.profileId });
        if (!settings.hasApiKey || !settings.keyLooksValid) {
            return res.status(400).json({ success: false, error: 'API Token 未配置或格式疑似无效。' });
        }
        const client = aiProviderClient.createClient(settings);
        const result = await client.generateText({
            systemInstruction: '你是模型连通性测试助手。请只回复 OK 和模型名称，不要解释。',
            prompt: '请回复：OK',
            maxOutputTokens: 64,
            temperature: 0
        });
        res.json({
            success: true,
            provider: settings.provider,
            anthropicAuthType: settings.anthropicAuthType,
            apiBaseUrl: settings.apiBaseUrl,
            model: settings.model,
            reply: String(result.text || '').slice(0, 300),
            usage: result.usage || {}
        });
    } catch (err) {
        res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message || '模型测试失败' });
    }
});

module.exports = router;
