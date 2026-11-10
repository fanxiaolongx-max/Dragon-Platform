// 保险箱接口：登录账号只能读写自己的条目（超级管理员也一样，没有代管入口）。
// 列表从不返回密码；查看明文要再输入一次平台登录密码。
const express = require('express');
const router = express.Router();
const { verifyUserPassword } = require('../middleware/auth');
const authUsersRepo = require('../models/auth-users-repository');
const { vault, ownerOf } = require('../models/password-vault');

const REVEAL_LIMIT = 5, REVEAL_WINDOW_MS = 10 * 60 * 1000;
const revealFailures = new Map(); // 账号 → 最近的失败时间

router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    req.vaultOwner = ownerOf(req.user);
    if (!req.vaultOwner) return res.status(401).json({ code: 'AUTH_REQUIRED', error: '请先登录' });
    next();
});

const handle = action => async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) {
        if (!error.statusCode) console.error('[vault]', error.code || error.name || 'error'); // 不打印 message：可能带站点或用户名
        res.status(error.statusCode || 500).json({ code: error.code || 'VAULT_FAILED', error: error.statusCode ? error.message : '保险箱操作失败' });
    }
};

router.get('/', handle(req => vault().list(req.vaultOwner)));

router.post('/', handle(async req => {
    const { url, username, password, label } = req.body || {};
    return vault().save(req.vaultOwner, { url, username, password, label: label === undefined ? '' : label });
}));

router.put('/:id', handle(async req => {
    const { username, password, label, autoFill, autoSubmit } = req.body || {};
    // 空密码表示不改密码
    return { entry: await vault().update(req.vaultOwner, req.params.id, { username, password: password === '' ? undefined : password, label, autoFill, autoSubmit }) };
}));

router.delete('/:id', handle(async req => { await vault().remove(req.vaultOwner, req.params.id); return { success: true }; }));

router.post('/:id/reveal', handle(async req => {
    const owner = req.vaultOwner, now = Date.now();
    const failures = (revealFailures.get(owner) || []).filter(at => now - at < REVEAL_WINDOW_MS);
    if (failures.length >= REVEAL_LIMIT) throw Object.assign(new Error('尝试次数过多，请 10 分钟后再试'), { code: 'VAULT_REVEAL_LIMIT', statusCode: 429 });
    const account = await authUsersRepo.getUser(req.user.username);
    if (!account || !verifyUserPassword(String(req.body?.accountPassword || ''), account.passwordHash)) {
        revealFailures.set(owner, [...failures, now]);
        throw Object.assign(new Error('平台登录密码不正确'), { code: 'VAULT_REAUTH_FAILED', statusCode: 403 });
    }
    revealFailures.delete(owner);
    return { password: await vault().reveal(owner, req.params.id) };
}));

router.post('/sites/never-save', handle(async req => {
    await vault().setNeverSave(req.vaultOwner, req.body?.origin, req.body?.never !== false);
    return { success: true };
}));

module.exports = router;
