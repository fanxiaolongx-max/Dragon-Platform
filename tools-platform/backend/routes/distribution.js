const router = require('express').Router();
const { requireSuperAdmin } = require('../middleware/auth');
const { setEntryAccess, personalEntry, personalEntries, setPersonalEntry, platformTool } = require('../models/tool-distribution');
const { runWithTenant, getTenantId, DEFAULT_TENANT_ID } = require('../models/tenant-context');

router.patch('/', requireSuperAdmin, async (req, res, next) => {
    const { kind, id, sharedAccess } = req.body || {};
    if (!['skill', 'cap'].includes(kind) || typeof id !== 'string' || id.length > 350 || typeof sharedAccess !== 'boolean') {
        return res.status(400).json({ error: '开放设置无效' });
    }
    try {
        const exists = await runWithTenant(DEFAULT_TENANT_ID, async () => {
            if (kind === 'skill') return (await require('../models/agent-skills-store').listAll()).some(item => item.id === id);
            const { groups } = await require('../models/home-capabilities').listCapabilities({ isAdmin: true });
            return groups.some(group => group.items.some(item => item.id === id));
        });
        if (!exists) return res.status(404).json({ error: '系统空间中不存在该条目' });
        await setEntryAccess(`${kind}:${id}`, sharedAccess);
        res.json({ sharedAccess });
    } catch (error) { next(error); }
});

router.get('/catalog', async (req, res, next) => {
    try {
        const { isSuperAdmin } = require('../middleware/auth');
        if (isSuperAdmin(req.user)) return res.json({ items: [] });
        const prefs = await personalEntries(req.user);
        const entries = await require('../models/tool-distribution').allowedEntries();
        const skills = await runWithTenant(DEFAULT_TENANT_ID, () => require('../models/agent-skills-store').listAll());
        const { groups } = await require('../models/home-capabilities').listCapabilities({ user: req.user, ignorePersonal: true });
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({ items: [
            ...skills.filter(item => entries.has(`skill:${item.id}`)).map(item => ({
                id: item.id, kind: 'skill', name: item.name, nameEn: item.nameEn, description: item.description,
                descriptionEn: item.descriptionEn, icon: item.icon, href: `/?skill=${encodeURIComponent(item.id)}`,
                hidden: Boolean(prefs.get(`skill:${item.id}`)?.hidden)
            })),
            ...groups.flatMap(group => group.items.map(item => ({ ...item, kind: 'cap', hidden: Boolean(prefs.get(`cap:${item.id}`)?.hidden) })))
        ] });
    } catch (error) { next(error); }
});

router.patch('/personal', async (req, res, next) => {
    const { isSuperAdmin } = require('../middleware/auth');
    if (!req.user || isSuperAdmin(req.user) || getTenantId() === DEFAULT_TENANT_ID) {
        return res.status(403).json({ error: '只能在自己的团队空间调整个人副本' });
    }
    const { kind, id, action, name } = req.body || {};
    if (!['tool', 'skill', 'cap'].includes(kind) || typeof id !== 'string' || id.length > 350 || !['restore', 'hide', 'rename'].includes(action)) {
        return res.status(400).json({ error: '个人设置无效' });
    }
    try {
        const key = `${kind}:${id}`;
        let exists = kind === 'tool' ? await platformTool(id, req.user) : kind === 'skill'
            ? await require('../models/agent-skills-store').publishedSkill(id)
            : await require('../models/tool-distribution').hasEntryAccess(key);
        if (!exists && kind === 'cap' && action !== 'restore') {
            const { groups } = await require('../models/home-capabilities').listCapabilities({ user: req.user });
            exists = groups.some(group => group.items.some(item => item.id === id));
        }
        if (!exists) return res.status(404).json({ error: '该条目尚未开放' });
        let patch;
        if (action === 'rename') {
            const value = String(name || '').trim().slice(0, 80);
            if (!value) return res.status(400).json({ error: '名称不能为空' });
            patch = { name: value };
        } else if (action === 'hide') {
            patch = { hidden: true };
        } else {
            const prefs = await personalEntry(req.user, key);
            if (kind === 'cap' && id.startsWith('float:') && prefs.hidden) {
                const { uivScriptOrigin } = require('../models/home-capabilities');
                const { deleteKV } = require('../models/kv-store');
                const source = await runWithTenant(DEFAULT_TENANT_ID, () => require('../models/uiv-scripts-repository').listScripts());
                await Promise.all(source.items.filter(item => `float:${uivScriptOrigin(item)}` === id)
                    .map(item => deleteKV(`personal_float_scripts:${req.user.username}`, item.id)));
            }
            patch = { hidden: false, ...(kind === 'tool' ? { installed: true, fork: false } : {}),
                ...(kind === 'cap' && prefs.hidden ? { fork: false } : {}) };
        }
        await setPersonalEntry(req.user, key, patch);
        res.json({ success: true });
    } catch (error) { next(error); }
});

router.patch('/capability-file', async (req, res, next) => {
    const { isSuperAdmin } = require('../middleware/auth');
    req.suppressBodyLog = true;
    if (isSuperAdmin(req.user) || !req.user || getTenantId() === DEFAULT_TENANT_ID) {
        return res.status(403).json({ error: '只能更新自己的插件副本' });
    }
    try {
        await require('../models/f12-distribution').savePersonalFile(req.user, req.body?.id, req.body?.data);
        res.json({ success: true });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

module.exports = router;
