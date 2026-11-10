const path = require('node:path');
const fs = require('node:fs');
const { readKV, writeKV, deleteKV } = require('./kv-store');
const { all, run } = require('./app-db');
const tools = require('./custom-tools-repository');
const hostedApps = require('./hosted-apps/service');
const { isSuperAdmin } = require('../middleware/auth');
const { DEFAULT_TENANT_ID, getTenantId, runWithTenant } = require('./tenant-context');

const CATEGORY = 'tool_distribution';
const platform = callback => runWithTenant(DEFAULT_TENANT_ID, callback);

function isHosted(tool) {
    const root = tools.getToolRootDir(tool.slug);
    return root && hostedApps.isLauncherFile(path.join(root, 'index.html'));
}

async function allowedEntries() {
    return platform(async () => {
        await readKV(CATEGORY, '', false); // Ensure the tenant KV table exists.
        const rows = await all('SELECT key FROM sys_kv_store WHERE category = ? AND value = ?', [CATEGORY, 'true']);
        return new Set(rows.map(row => row.key));
    });
}

async function setEntryAccess(key, enabled) {
    return platform(() => enabled ? writeKV(CATEGORY, key, true) : deleteKV(CATEGORY, key));
}

function hasEntryAccess(key) {
    return platform(async () => await readKV(CATEGORY, key, false) === true);
}

const PERSONAL = 'personal_distribution';

async function personalEntries(user) {
    if (!user || isSuperAdmin(user)) return new Map();
    await readKV(PERSONAL, '', {});
    const rows = await all('SELECT key, value FROM sys_kv_store WHERE category = ?', [`${PERSONAL}:${user.username}`]);
    return new Map(rows.map(row => [row.key, JSON.parse(row.value)]));
}

function personalEntry(user, key) {
    return user && !isSuperAdmin(user) ? readKV(`${PERSONAL}:${user.username}`, key, {}) : Promise.resolve({});
}

async function setPersonalEntry(user, key, patch) {
    await readKV(PERSONAL, '', {});
    await run(`INSERT INTO sys_kv_store (category, key, value) VALUES (?, ?, ?)
        ON CONFLICT(category, key) DO UPDATE SET value = json_patch(value, excluded.value)`,
    [`${PERSONAL}:${user.username}`, key, JSON.stringify(patch)]);
}

async function platformTool(slug, user) {
    return platform(async () => {
        const tool = await tools.getTool(slug);
        return tool && (isSuperAdmin(user) || await hasEntryAccess(slug)) ? tool : null;
    });
}

async function sharedCatalog(user) {
    return platform(async () => {
        const entries = await tools.listTools();
        const allowed = await allowedEntries();
        const admin = isSuperAdmin(user);
        // 托管 Python 应用也可以开放给全员：全员共用超级管理员空间里的同一个进程，只能使用和只读查看
        return entries.filter(tool => admin || allowed.has(tool.slug))
            .map(tool => ({ ...tool, hostedApp: Boolean(isHosted(tool)), sharedAccess: allowed.has(tool.slug), shared: !admin }));
    });
}

async function listAvailable(user) {
    const tenant = getTenantId();
    const local = tenant === DEFAULT_TENANT_ID && !isSuperAdmin(user) ? [] : await tools.listTools();
    if (isSuperAdmin(user) && tenant === DEFAULT_TENANT_ID) {
        const allowed = await allowedEntries();
        return local.map(tool => ({ ...tool, hostedApp: Boolean(isHosted(tool)), sharedAccess: allowed.has(tool.slug) }));
    }
    const preferences = await personalEntries(user);
    const own = local.filter(tool => !tool.builtIn && !preferences.get(`tool:${tool.slug}`)?.origin)
        .map(tool => ({ ...tool, hostedApp: Boolean(isHosted(tool)) }));
    const localSlugs = new Set(own.map(tool => tool.slug));
    const copies = new Map(local.map(tool => [tool.slug, tool]));
    const shared = await sharedCatalog(null);
    return [...own, ...shared.flatMap(tool => {
        const prefs = preferences.get(`tool:${tool.slug}`) || {};
        // 开放的托管应用直接出现在全员首页，不需要先到市场里安装
        if (prefs.hidden || localSlugs.has(tool.slug) || (!tool.builtIn && !tool.hostedApp && !prefs.installed)) return [];
        const localCopy = prefs.fork && copies.get(tool.slug);
        return [{ ...tool, ...(localCopy || {}), name: prefs.name || tool.name, nameEn: prefs.name || tool.nameEn, shared: true }];
    })];
}

async function resolveTool(slug, user) {
    const tenant = getTenantId();
    const prefs = await personalEntry(user, `tool:${slug}`);
    const local = user && tenant !== DEFAULT_TENANT_ID ? await tools.getTool(slug) : null;
    if (local && !local.builtIn && !prefs.origin) return { tool: local, sourceTenant: tenant };
    if (prefs.hidden) return null;
    return platform(async () => {
        const tool = await tools.getTool(slug);
        if (!tool) return null;
        if (isSuperAdmin(user)) return { tool, sourceTenant: DEFAULT_TENANT_ID };
        const shared = await hasEntryAccess(slug);
        // 托管应用只给已登录且被开放的账号，不支持免登录访问
        if (isHosted(tool) && (!user || !shared)) return null;
        if (!user && (!shared || !tool.publicAccess)) return null;
        if (user && !shared) {
            const prefix = slug === 'f12-to-extension' ? 'cap:f12:' : slug === 'python-updater' ? 'cap:python:' : '';
            if (!prefix || ![...await allowedEntries()].some(key => key.startsWith(prefix))) return null;
        }
        if (shared && prefs.fork && local) {
            return { tool: { ...local, name: prefs.name || tool.name, nameEn: prefs.name || tool.nameEn }, sourceTenant: tenant, shared: true };
        }
        return { tool: { ...tool, name: prefs.name || tool.name, nameEn: prefs.name || tool.nameEn }, sourceTenant: DEFAULT_TENANT_ID, shared: true };
    });
}

async function preparePersonalToolUpdate(slug, user) {
    if (!user || isSuperAdmin(user) || getTenantId() === DEFAULT_TENANT_ID) return false;
    const resolved = await resolveTool(slug, user);
    if (!resolved?.shared) {
        const prefs = await personalEntry(user, `tool:${slug}`);
        if (prefs.origin) throw Object.assign(new Error('工具已隐藏或未开放'), { status: 403 });
        return false;
    }
    if (!await hasEntryAccess(slug)) throw Object.assign(new Error('该工具未单独开放'), { status: 403 });
    if (await platform(() => isHosted(resolved.tool))) throw Object.assign(new Error('托管应用由超级管理员维护，不能修改'), { status: 403 });
    await setPersonalEntry(user, `tool:${slug}`, { origin: true });
    if (!await tools.getTool(slug)) {
        const source = await platform(() => tools.getToolAssetPath(slug, 'index.html'));
        if (!source) throw Object.assign(new Error('找不到系统工具文件'), { status: 404 });
        const destination = path.join(tools.getCustomToolsDir(), slug);
        fs.mkdirSync(destination, { recursive: true });
        fs.copyFileSync(source, path.join(destination, 'index.html'));
        await tools.recoverToolFromDisk(slug, resolved.tool);
    }
    return true;
}

async function setSharedAccess(slug, enabled) {
    return platform(async () => {
        const tool = await tools.getTool(slug);
        if (!tool) return null;
        await setEntryAccess(slug, enabled);
        return { ...tool, sharedAccess: enabled };
    });
}

/** 团队账号能否使用这个开放的托管应用（在调用者自己的租户上下文里判断：个人隐藏、同名自有工具都算不可用）。 */
async function sharedHostedApp(slug, user) {
    if (!user || getTenantId() === DEFAULT_TENANT_ID) return false;
    const resolved = await resolveTool(slug, user);
    return Boolean(resolved?.shared && resolved.sourceTenant === DEFAULT_TENANT_ID && await platform(() => isHosted(resolved.tool)));
}

async function actorForOwner(owner) {
    const key = String(owner || '');
    if (!key.includes('::')) return undefined;
    const username = key.slice(key.indexOf('::') + 2);
    const user = await require('./auth-users-repository').getUser(username);
    return user ? { username, role: user.role, isSuper: user.isSuper } : { username, role: 'readonly', isSuper: false };
}

module.exports = { sharedHostedApp, listAvailable, sharedCatalog, resolveTool, setSharedAccess, allowedEntries, hasEntryAccess, setEntryAccess, actorForOwner, personalEntries, personalEntry, setPersonalEntry, platformTool, preparePersonalToolUpdate };
