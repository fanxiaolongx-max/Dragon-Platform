const express = require('express');
const router = express.Router();
const repo = require('../models/python-script-repository');
const { requireAdmin } = require('../middleware/auth');

// 1. 获取脚本列表
router.get('/scripts', async (_req, res) => {
    try {
        const scripts = await repo.listScripts();
        res.json({ success: true, scripts });
    } catch (err) {
        res.status(500).json({ error: err.message || '获取脚本列表失败' });
    }
});

// 2. 获取单个脚本详情
router.get('/scripts/:id', async (req, res) => {
    try {
        const script = await repo.getScript(req.params.id);
        if (!script) return res.status(404).json({ error: '未找到指定脚本' });
        res.json({ success: true, script });
    } catch (err) {
        res.status(500).json({ error: err.message || '获取脚本详情失败' });
    }
});

// 3. 保存/更新脚本（自动生成版本）
router.post('/scripts', async (req, res) => {
    try {
        const result = await repo.saveScript(req.body || {});
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ error: err.message || '保存脚本失败' });
    }
});

// 4. 获取某个脚本的所有版本历史
router.get('/scripts/:id/versions', async (req, res) => {
    try {
        const versions = await repo.listVersions(req.params.id);
        res.json({ success: true, versions });
    } catch (err) {
        res.status(500).json({ error: err.message || '获取版本历史失败' });
    }
});

// 5. 获取指定版本详情
router.get('/versions/:versionId', async (req, res) => {
    try {
        const version = await repo.getVersion(req.params.versionId);
        if (!version) return res.status(404).json({ error: '未找到版本记录' });
        res.json({ success: true, version });
    } catch (err) {
        res.status(500).json({ error: err.message || '获取版本记录失败' });
    }
});

// 6. 代码差异比对
router.post('/diff', async (req, res) => {
    try {
        let { oldCode, newCode, oldVersionId, newVersionId } = req.body || {};

        if (oldVersionId) {
            const oldVer = await repo.getVersion(oldVersionId);
            if (oldVer) oldCode = oldVer.code;
        }

        if (newVersionId) {
            const newVer = await repo.getVersion(newVersionId);
            if (newVer) newCode = newVer.code;
        }

        const diffResult = repo.computeDiff(oldCode || '', newCode || '');
        res.json({ success: true, diff: diffResult });
    } catch (err) {
        res.status(500).json({ error: err.message || '计算代码差异失败' });
    }
});

// 7. 同步到本地远端仓库文件 (python-packager/core_script.py)
router.post('/sync-repo', async (req, res) => {
    try {
        const { scriptId, code, metadata } = req.body || {};
        if (typeof code !== 'string' || !code.trim()) {
            return res.status(400).json({ error: '代码不能为空' });
        }
        const syncResult = await repo.syncToPackagerRepo(scriptId, code, metadata || {});
        res.json(syncResult);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '同步核心脚本到仓库失败' });
    }
});

// 8. 导出通用外壳离线源码包 (ZIP)
router.get('/export-shell', async (_req, res) => {
    try {
        const zipBuffer = await repo.exportUniversalShellZip();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="Python-Universal-Shell.zip"');
        res.send(zipBuffer);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message || '打包通用外壳失败' });
    }
});

// 9. 获取远端仓库与 GitHub Action 状态配置
router.get('/repo-status', (_req, res) => {
    res.json({
        success: true,
        repo: 'fanxiaolongx-max/privacy-policy',
        branch: 'main',
        core_script_path: 'python-packager/core_script.py',
        version_path: 'python-packager/version.json',
        raw_url: 'https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/core_script.py',
        version_url: 'https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/version.json',
        mirror_urls: [
            { id: 'ghproxy', name: 'ghproxy.net', url: 'https://ghproxy.net/https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/core_script.py' },
            { id: 'mirror_ghproxy', name: 'mirror.ghproxy.com', url: 'https://mirror.ghproxy.com/https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/main/python-packager/core_script.py' }
        ],
        action_url: 'https://github.com/fanxiaolongx-max/privacy-policy/actions/workflows/package-python-exe.yml'
    });
});

module.exports = router;
