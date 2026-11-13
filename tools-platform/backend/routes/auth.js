const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { checkAuth, requireSuperAdmin, hashUserPassword, isLegacyPasswordHash, verifyUserPassword } = require('../middleware/auth');
const authUsersRepo = require('../models/auth-users-repository');
const authSessionsRepo = require('../models/auth-sessions-repository');
const authSecurityMonitor = require('../models/auth-security-monitor');
const authSecuritySettingsRepo = require('../models/auth-security-settings-repository');
const tenantsRepo = require('../models/tenants-repository');
const auditLog = require('../models/platform-audit-repository');
const { ensureUserSpaceDirs, runWithTenant, DEFAULT_TENANT_ID } = require('../models/tenant-context');

// 登录安全（失败计数、锁定、告警、安全策略）是全平台一份，固定存放在超级管理员空间：
// 不随调用者所在团队变化——超级管理员进入某个团队排障时看到的仍是同一份。
router.use((req, res, next) => runWithTenant(DEFAULT_TENANT_ID, next));

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/i;
const MIN_PASSWORD_LENGTH = 8;

function passwordProblem(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `密码至少 ${MIN_PASSWORD_LENGTH} 位`;
    if (password.length > 200) return '密码过长';
    return '';
}

const DEFAULT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function getSessionMaxAgeMs() {
    try {
        const settings = await authSecuritySettingsRepo.getSettings();
        return Math.max(1, Number(settings.sessionMaxAgeHours) || 168) * 60 * 60 * 1000;
    } catch (err) {
        console.error('[auth] failed to load security settings:', err.message);
        return DEFAULT_SESSION_MAX_AGE_MS;
    }
}

function isSecureRequest(req) {
    const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    return Boolean(req.secure || forwardedProto === 'https');
}

function getAuthCookieOptions(req, extra = {}) {
    return {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecureRequest(req),
        ...extra
    };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};

    try {
        const block = await authSecurityMonitor.getLoginBlock(req, username);
        if (block) {
            res.setHeader('Retry-After', String(block.retry_after_seconds || 60));
            return res.status(429).json({
                error: '登录失败次数过多，请稍后再试',
                locked_until: block.locked_until,
                retry_after_seconds: block.retry_after_seconds,
                lock_type: block.lock_type
            });
        }

        const user = typeof username === 'string' ? await authUsersRepo.getUser(username) : null;

        if (!user || !verifyUserPassword(password, user.passwordHash)) {
            authSecurityMonitor.recordLoginAttempt(req, {
                username,
                success: false,
                reason: user ? 'bad_password' : 'unknown_user'
            });
            auditLog.record(req, {
                actor: typeof username === 'string' ? username.slice(0, 80) : 'unknown',
                action: 'login_failed',
                detail: user ? '密码错误' : '账号不存在'
            });
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        // 旧 sha256 哈希登录成功后透明升级成 scrypt
        if (isLegacyPasswordHash(user.passwordHash)) {
            await authUsersRepo.setPassword(username, password).catch(error => console.warn('[auth] 密码哈希升级失败：', error.message));
        }

        const token = crypto.randomBytes(32).toString('hex');
        const sessionMaxAgeMs = await getSessionMaxAgeMs();
        const expiresAt = Date.now() + sessionMaxAgeMs;
        // 一个账号 = 一个团队：会话直接落在账号自己的团队
        const tenantId = user.tenantId || tenantsRepo.DEFAULT_TENANT_ID;
        await authSessionsRepo.saveSession(token, username, user.role, expiresAt, tenantId);
        authSecurityMonitor.recordLoginAttempt(req, {
            username,
            success: true,
            reason: 'success'
        });
        authSecurityMonitor.clearSuccessfulLoginState(req, username);
        auditLog.record(req, { actor: username, action: 'login', tenantId });

        res.cookie('tools_token', token, getAuthCookieOptions(req, { maxAge: sessionMaxAgeMs }));
        res.json({ success: true, token, role: user.role, username, tenantId, isSuper: user.isSuper });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: '登录失败' });
    }
});

// POST /api/auth/logout
router.post('/logout', checkAuth, async (req, res) => {
    try {
        await authSessionsRepo.deleteSession(req.authToken);
        auditLog.record(req, { actor: req.user?.username, action: 'logout', tenantId: req.user?.tenantId });
        res.clearCookie('tools_token', getAuthCookieOptions(req));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '注销失败' });
    }
});

// GET /api/auth/me
router.get('/me', checkAuth, async (req, res) => {
    const me = { ...req.user };
    if (me.isSuper && me.tenantId !== me.homeTenantId) {
        const tenant = await tenantsRepo.getTenantById(me.tenantId).catch(() => null);
        me.viewingTeam = { id: me.tenantId, name: tenant?.name || me.tenantId };
    }
    res.json(me);
});

// PUT /api/auth/me/password：本人修改密码（需要当前密码），其他设备上的会话随之失效
router.put('/me/password', checkAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        const problem = passwordProblem(newPassword);
        if (problem) return res.status(400).json({ error: problem });
        const user = await authUsersRepo.getUser(req.user.username);
        if (!user || !verifyUserPassword(currentPassword, user.passwordHash)) return res.status(400).json({ error: '当前密码不正确' });
        await authUsersRepo.setPassword(req.user.username, newPassword);
        await authSessionsRepo.deleteSessionsForUser(req.user.username, { exceptToken: req.authToken });
        auditLog.record(req, { action: 'password_change', target: req.user.username });
        res.json({ success: true });
    } catch (err) {
        console.error('[auth] change own password failed:', err);
        res.status(500).json({ error: '修改密码失败' });
    }
});

// --- Security Settings & Lock Management (Super Admin Only) ---

router.get('/security/settings', checkAuth, requireSuperAdmin, async (req, res) => {
    try {
        res.json(await authSecuritySettingsRepo.getSettings());
    } catch (err) {
        console.error('[auth] get security settings failed:', err);
        res.status(500).json({ error: '获取安全配置失败' });
    }
});

router.put('/security/settings', checkAuth, requireSuperAdmin, async (req, res) => {
    try {
        res.json(await authSecuritySettingsRepo.saveSettings(req.body || {}));
    } catch (err) {
        console.error('[auth] save security settings failed:', err);
        res.status(err.statusCode || 500).json({ error: err.message || '保存安全配置失败' });
    }
});

router.get('/security/locks', checkAuth, requireSuperAdmin, async (req, res) => {
    try {
        res.json(await authSecurityMonitor.listActiveLocks());
    } catch (err) {
        console.error('[auth] list security locks failed:', err);
        res.status(500).json({ error: '获取锁定状态失败' });
    }
});

router.delete('/security/locks/:lockKey', checkAuth, requireSuperAdmin, async (req, res) => {
    try {
        const lock = await authSecurityMonitor.unlockLock(req.params.lockKey, req);
        if (!lock) return res.status(404).json({ error: '锁定记录不存在' });
        res.json({ success: true, lock });
    } catch (err) {
        console.error('[auth] unlock security lock failed:', err);
        res.status(500).json({ error: '解除锁定失败' });
    }
});

// GET /api/auth/audit：审计日志（超级管理员）
router.get('/audit', checkAuth, requireSuperAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const result = await auditLog.list({
            page,
            limit,
            before: req.query.before,
            actor: req.query.actor,
            action: req.query.action,
            platform: req.query.platform
        });
        res.json(result);
    } catch (err) {
        console.error('[auth] 读取审计日志失败：', err);
        res.status(500).json({ error: '读取审计日志失败' });
    }
});

// --- Account Management (Super Admin Only)：一个账号 = 一个团队 ---

// GET /api/auth/users
router.get('/users', checkAuth, requireSuperAdmin, async (req, res) => {
    try {
        const users = (await authUsersRepo.listUsers()).items || {};
        const tenants = new Map((await tenantsRepo.listManagedTenants()).map(item => [item.id, item]));
        res.json(Object.values(users).map(user => ({
            username: user.username,
            role: user.role,
            isSuper: user.isSuper,
            tenantId: user.tenantId,
            teamName: user.tenantId === tenantsRepo.DEFAULT_TENANT_ID ? '超级管理员空间' : (tenants.get(user.tenantId)?.name || user.displayName || user.username),
            displayName: user.displayName,
            createdAt: user.createdAt
        })));
    } catch (err) {
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

// POST /api/auth/users：新建账号，同时建好它独立的团队空间
router.post('/users', checkAuth, requireSuperAdmin, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = req.body?.password;
    const displayName = String(req.body?.displayName || '').trim().slice(0, 60);
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: '账号只能用字母、数字、- 和 _，2-63 位，并以字母或数字开头' });
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
    const tenantId = username.toLowerCase();
    if (tenantId === tenantsRepo.DEFAULT_TENANT_ID) return res.status(400).json({ error: 'default 是保留名称' });

    try {
        if (await authUsersRepo.getUser(username)) return res.status(400).json({ error: '用户名已存在' });
        if (await tenantsRepo.getTenantById(tenantId).catch(() => null)) return res.status(409).json({ error: '同名团队空间已存在（可能是已删除账号保留的数据），请换一个账号名或先在账号列表里彻底清除' });
        await tenantsRepo.createTenant({ id: tenantId, name: displayName || username, description: `账号 ${username} 的团队空间` });
        try {
            ensureUserSpaceDirs(tenantId);
            await authUsersRepo.createUser({ username, role: 'admin', passwordHash: hashUserPassword(password), tenantId, displayName });
        } catch (error) {
            await tenantsRepo.archiveTenant(tenantId).then(() => tenantsRepo.deleteTenantPermanently(tenantId)).catch(() => {});
            throw error;
        }
        auditLog.record(req, { action: 'user_create', target: username, tenantId });
        res.json({ success: true, username, tenantId });
    } catch (err) {
        console.error('[auth] create user failed:', err);
        res.status(err.statusCode || 500).json({ error: err.message || '创建用户失败' });
    }
});

// DELETE /api/auth/users/:username?purge=1：删除账号；团队数据默认归档保留，purge=1 时一并彻底删除
router.delete('/users/:username', checkAuth, requireSuperAdmin, async (req, res) => {
    const username = req.params.username;
    const purge = ['1', 'true'].includes(String(req.query.purge || '').toLowerCase());
    try {
        const user = await authUsersRepo.getUser(username);
        if (!user) return res.status(404).json({ error: '用户不存在' });
        if (user.isSuper) return res.status(403).json({ error: '超级管理员不能删除' });
        await authUsersRepo.deleteUser(username);
        await authSessionsRepo.deleteSessionsForUser(username);
        const tenantId = user.tenantId;
        const sharedWithOthers = Object.values((await authUsersRepo.listUsers()).items).some(other => other.tenantId === tenantId);
        if (tenantId && tenantId !== tenantsRepo.DEFAULT_TENANT_ID && !sharedWithOthers) {
            await tenantsRepo.archiveTenant(tenantId).catch(error => { if (error.statusCode !== 404) throw error; });
            if (purge) await tenantsRepo.deleteTenantPermanently(tenantId);
        }
        auditLog.record(req, { action: purge ? 'user_delete_purge' : 'user_delete', target: username, tenantId });
        res.json({ success: true, purged: purge });
    } catch (err) {
        console.error('[auth] delete user failed:', err);
        res.status(err.statusCode || 500).json({ error: err.message || '删除用户失败' });
    }
});

// PUT /api/auth/users/:username/password：超级管理员重置密码，该账号所有会话下线
router.put('/users/:username/password', checkAuth, requireSuperAdmin, async (req, res) => {
    const { password } = req.body || {};
    const username = req.params.username;
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
    try {
        if (!await authUsersRepo.setPassword(username, password)) return res.status(404).json({ error: '用户不存在' });
        await authSessionsRepo.deleteSessionsForUser(username, { exceptToken: username === req.user.username ? req.authToken : '' });
        auditLog.record(req, { action: 'password_reset', target: username });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '修改密码失败' });
    }
});

module.exports = router;
