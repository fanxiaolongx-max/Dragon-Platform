// Skill 管理 API（models/agent-skills-store.js）：列表与下载对登录用户开放；创建、导入、改名、删除仅管理员。
const express = require('express');
const router = express.Router();
const store = require('../models/agent-skills-store');
const { requireAdmin } = require('../middleware/auth');

function sendError(res, error, fallback) {
    res.status(error.statusCode || 500).json({ code: error.code, error: error.statusCode ? error.message : `${fallback}: ${error.message}` });
}

function decodeArchive(body) {
    const base64 = String(body?.archiveBase64 || '');
    if (!base64) throw Object.assign(new Error('缺少 SKILL 压缩包'), { statusCode: 400 });
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > store.LIMITS.archiveBytes) throw Object.assign(new Error('SKILL 压缩包不能超过 5 MB'), { statusCode: 400 });
    return buffer;
}

function overridesFrom(body) {
    const pick = key => (typeof body?.[key] === 'string' && body[key].trim() ? body[key].trim() : undefined);
    return { name: pick('name'), nameEn: pick('nameEn'), description: pick('description'), descriptionEn: pick('descriptionEn'), icon: pick('icon') };
}

router.get('/', async (req, res) => {
    try {
        const includeHidden = req.query.includeHidden === '1' && req.user?.role === 'admin';
        res.setHeader('Cache-Control', 'no-store');
        res.json({ items: await store.listAll({ includeHidden }) });
    } catch (error) {
        sendError(res, error, '读取技能列表失败');
    }
});

// 对话里 @create-skill 生成的草稿（SKILL.md 文本）或单个 SKILL.md 文件
router.post('/', requireAdmin, async (req, res) => {
    try {
        const markdown = String(req.body?.skillMd || '');
        if (!markdown.trim()) return res.status(400).json({ error: '缺少 SKILL.md 内容' });
        const skill = await store.createFromMarkdown(markdown, {
            source: req.body?.source === 'import' ? 'import' : 'chat',
            createdBy: req.user?.username || '',
            overwrite: req.body?.overwrite === true,
            fileName: req.body?.archiveName,
            overrides: overridesFrom(req.body)
        });
        res.json({ skill });
    } catch (error) {
        sendError(res, error, '保存技能失败');
    }
});

router.post('/preview', requireAdmin, async (req, res) => {
    try {
        if (typeof req.body?.skillMd === 'string') return res.json({ skill: await store.previewMarkdown(req.body.skillMd, { fileName: req.body?.archiveName }) });
        res.json({ skill: await store.previewArchive(decodeArchive(req.body), { archiveName: req.body?.archiveName }) });
    } catch (error) {
        sendError(res, error, '读取 SKILL 压缩包失败');
    }
});

router.post('/import', requireAdmin, async (req, res) => {
    try {
        const skill = await store.importArchive(decodeArchive(req.body), {
            archiveName: req.body?.archiveName,
            createdBy: req.user?.username || '',
            overwrite: req.body?.overwrite === true,
            overrides: overridesFrom(req.body)
        });
        res.json({ skill });
    } catch (error) {
        sendError(res, error, '导入技能失败');
    }
});

router.post('/restore-builtins', requireAdmin, async (_req, res) => {
    try {
        res.json({ restored: await store.restoreBuiltins() });
    } catch (error) {
        sendError(res, error, '恢复内置技能失败');
    }
});

router.patch('/:id/name', requireAdmin, async (req, res) => {
    try {
        await store.rename(req.params.id, req.body?.name);
        res.json({ success: true });
    } catch (error) {
        sendError(res, error, '重命名技能失败');
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, ...(await store.remove(req.params.id)) });
    } catch (error) {
        sendError(res, error, '删除技能失败');
    }
});

router.get('/:id/export', async (req, res) => {
    try {
        const { buffer, filename } = await store.exportZip(req.params.id);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('X-Skill-Export-Filename', encodeURIComponent(filename));
        res.send(buffer);
    } catch (error) {
        sendError(res, error, '下载技能失败');
    }
});

module.exports = router;
