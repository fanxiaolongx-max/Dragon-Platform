const express = require('express');
const router = express.Router();
const repo = require('../models/python-script-repository');
const bundledScripts = require('../models/bundled-scripts');
const { isSuperAdmin, requireSuperAdmin } = require('../middleware/auth');
const { allowedEntries, hasEntryAccess, personalEntries, personalEntry, setPersonalEntry } = require('../models/tool-distribution');
const { DEFAULT_TENANT_ID, getTenantId, runWithTenant } = require('../models/tenant-context');
const fromPlatform = task => runWithTenant(DEFAULT_TENANT_ID, task);
async function isLocalScript(req, id, prefs) {
    if (getTenantId() === DEFAULT_TENANT_ID || prefs.fork || id === repo.DEFAULT_SCRIPT_ID || bundledScripts.bundledIds('python').has(id)) return false;
    if (prefs.local) return true;
    return Boolean(await repo.getScript(id) && !await fromPlatform(() => repo.getScript(id)));
}

async function scriptSource(req, id) {
    if (isSuperAdmin(req.user)) return DEFAULT_TENANT_ID;
    const key = `cap:python:${id}`;
    const prefs = await personalEntry(req.user, key);
    if (prefs.hidden) return null;
    const shared = await hasEntryAccess(key);
    if (!shared) return await isLocalScript(req, id, prefs) ? getTenantId() : null;
    return prefs.fork ? getTenantId() : DEFAULT_TENANT_ID;
}

async function visibleVersion(req, id) {
    const local = getTenantId() === DEFAULT_TENANT_ID ? null : await repo.getVersion(id);
    if (local && await scriptSource(req, local.script_id) === getTenantId()) return local;
    const version = await fromPlatform(() => repo.getVersion(id));
    return version && await scriptSource(req, version.script_id) === DEFAULT_TENANT_ID ? version : null;
}



router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
});

// 1. 获取脚本列表
router.get('/scripts', async (req, res) => {
    try {
        const admin = isSuperAdmin(req.user);
        const allowed = admin ? null : await allowedEntries();
        const personal = await personalEntries(req.user);
        const platformIds = new Set();
        const scripts = await fromPlatform(async () => {
            await bundledScripts.ensureSeeded();
            const bundledIds = bundledScripts.bundledIds('python');
            const items = await repo.listScripts();
            items.forEach(item => platformIds.add(item.id));
            return items
                .filter(item => admin || (allowed.has(`cap:python:${item.id}`) && !personal.get(`cap:python:${item.id}`)?.hidden))
                .map(item => ({ ...item, builtIn: item.id === repo.DEFAULT_SCRIPT_ID || bundledIds.has(item.id) }));
        });
        if (!admin && getTenantId() !== DEFAULT_TENANT_ID) {
            const local = await repo.listScripts();
            const localById = new Map(local.map(item => [item.id, item]));
            scripts.forEach((item, index) => {
                const prefs = personal.get(`cap:python:${item.id}`) || {};
                const selected = (prefs.fork && localById.get(item.id)) || item;
                scripts[index] = { ...item, ...selected, name: prefs.name || selected.name };
            });
            for (const item of local) {
                const prefs = personal.get(`cap:python:${item.id}`);
                if (!platformIds.has(item.id) && !prefs?.hidden && !prefs?.fork && !bundledScripts.bundledIds('python').has(item.id)) scripts.push({ ...item, name: prefs.name || item.name });
            }
        }
        res.json({ success: true, scripts, canManage: req.user?.role === 'admin' });
    } catch (err) {
        res.status(500).json({ error: err.message || '获取脚本列表失败' });
    }
});

// 2. 获取单个脚本详情
router.get('/scripts/:id', async (req, res) => {
    try {
        const source = await scriptSource(req, req.params.id);
        const script = source ? await runWithTenant(source, () => repo.getScript(req.params.id)) : null;
        if (!script) return res.status(404).json({ error: '未找到指定脚本' });
        const prefs = await personalEntry(req.user, `cap:python:${req.params.id}`);
        res.json({ success: true, script: { ...script, name: prefs.name || script.name } });
    } catch (err) {
        res.status(500).json({ error: err.message || '获取脚本详情失败' });
    }
});

// 3. 保存/更新脚本（自动生成版本）
router.post('/scripts', require('../middleware/auth').requireAdmin, async (req, res) => {
    try {
        const admin = isSuperAdmin(req.user);
        if (!admin && getTenantId() === DEFAULT_TENANT_ID) return res.status(403).json({ error: '不能修改系统空间的脚本' });
        const id = String(req.body?.id || '').trim();
        const key = `cap:python:${id}`;
        const shared = Boolean(id && await hasEntryAccess(key));
        const prefs = await personalEntry(req.user, key);
        if (!admin && id && (prefs.hidden || (!shared && !await isLocalScript(req, id, prefs)))) return res.status(404).json({ error: '脚本不存在或未开放' });
        const result = await repo.saveScript({ ...req.body, author: req.user?.username || '' });
        if (!admin) await setPersonalEntry(req.user, `cap:python:${result.id}`, shared ? { fork: true } : { local: true });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(400).json({ error: err.message || '保存脚本失败' });
    }
});

// 4. 获取某个脚本的所有版本历史
router.get('/scripts/:id/versions', async (req, res) => {
    try {
        const source = await scriptSource(req, req.params.id);
        if (!source) return res.status(404).json({ error: '未找到指定脚本' });
        const versions = await runWithTenant(source, () => repo.listVersions(req.params.id));
        res.json({ success: true, versions });
    } catch (err) {
        res.status(500).json({ error: err.message || '获取版本历史失败' });
    }
});

// 5. 获取指定版本详情
router.get('/versions/:versionId', async (req, res) => {
    try {
        const version = await visibleVersion(req, req.params.versionId);
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
            const oldVer = await visibleVersion(req, oldVersionId);
            if (oldVer) oldCode = oldVer.code;
        }

        if (newVersionId) {
            const newVer = await visibleVersion(req, newVersionId);
            if (newVer) newCode = newVer.code;
        }

        const diffResult = repo.computeDiff(oldCode || '', newCode || '');
        res.json({ success: true, diff: diffResult });
    } catch (err) {
        res.status(500).json({ error: err.message || '计算代码差异失败' });
    }
});

// 7. 同步到本地远端仓库文件 (python-packager/core_script.py)
router.post('/sync-repo', requireSuperAdmin, async (req, res) => {
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
router.get('/export-shell', requireSuperAdmin, async (_req, res) => {
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
router.get('/repo-status', requireSuperAdmin, (_req, res) => {
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
