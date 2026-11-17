// 平台原生内置页面（如数据抓取、数据导入、报表看板等）的多租户分发开关：
// - 与技能(skill:)、插件与脚本(cap:)、自定义工具(<slug>)共用 sys_kv_store(category='tool_distribution')，键为 page:<id>；
// - 首次初始化按历史基线把业务页默认设为已开放（page_defaults_v1 只执行一次），基础设施页（storage / db-explorer / netcare-explorer）保持锁定仅超管可用；
// - 超级管理员可随时收回或重新开放任意业务页面的全员使用权。
const { isSuperAdmin } = require('../middleware/auth');
const { DEFAULT_TENANT_ID, runWithTenant } = require('./tenant-context');
const { getDatabase, run } = require('./app-db');
const { readKV, writeKV } = require('./kv-store');
const distribution = require('./tool-distribution');

const META_CATEGORY = 'tool_distribution_meta';
const SEED_KEY = 'page_defaults_v1';

const PAGES = Object.freeze([
    { id: 'uivf12', href: '/uivf12', paths: ['/uivf12', '/pages/uivf12.html'], defaultShared: true, locked: false },
    { id: 'sla', href: '/sla', paths: ['/sla', '/pages/sla.html'], defaultShared: true, locked: false },
    { id: 'report', href: '/report', paths: ['/report', '/pages/report.html'], defaultShared: true, locked: false },
    { id: 'expedite', href: '/expedite', paths: ['/expedite', '/pages/expedite.html'], defaultShared: true, locked: false },
    { id: 'monthly', href: '/monthly', paths: ['/monthly', '/monthly/legacy', '/ai-report', '/pages/monthly.html', '/pages/ai-report.html', '/pages/monthly-designer.html'], defaultShared: true, locked: false },
    { id: 'ai-bi', href: '/ai-bi', paths: ['/ai-bi', '/pages/ai-bi.html'], defaultShared: true, locked: false },
    { id: 'duty-roster', href: '/duty-roster', paths: ['/duty-roster', '/duty-roster.html', '/pages/duty-roster.html'], defaultShared: true, locked: false },
    { id: 'bigscreen', href: '/bigscreen', paths: ['/bigscreen', '/pages/bigscreen.html'], defaultShared: true, locked: false },
    { id: 'topic-analysis', href: '/topic-analysis', paths: ['/topic-analysis', '/topical-analysis', '/pages/topic-analysis.html'], defaultShared: true, locked: false },
    { id: 'frt', href: '/frt', paths: ['/frt', '/pages/frt.html'], defaultShared: true, locked: false },
    { id: 'requirements', href: '/requirements', paths: ['/requirements', '/pages/requirements.html'], defaultShared: true, locked: false },
    { id: 'praudit', href: '/praudit', paths: ['/praudit', '/pages/praudit.html'], defaultShared: true, locked: false },
    { id: 'storage', href: '/storage', paths: ['/storage', '/pages/storage.html'], defaultShared: false, locked: true },
    { id: 'db-explorer', href: '/db-explorer', paths: ['/db-explorer', '/pages/db-explorer.html'], defaultShared: false, locked: true },
    { id: 'netcare-explorer', href: '/netcare-explorer', paths: ['/netcare-explorer', '/pages/netcare-explorer.html'], defaultShared: false, locked: true }
]);

const PAGE_BY_ID = new Map(PAGES.map(page => [page.id, page]));
const PAGE_BY_PATH = new Map();
for (const page of PAGES) {
    for (const p of page.paths) PAGE_BY_PATH.set(p.toLowerCase(), page);
}

function normalizePath(rawPath) {
    const clean = String(rawPath || '').split(/[?#]/, 1)[0].trim().replace(/\/+$/, '') || '/';
    return clean.toLowerCase();
}

function pageIdForPath(rawPath) {
    return PAGE_BY_PATH.get(normalizePath(rawPath))?.id || null;
}

function normalizePageId(input) {
    let clean = String(input || '').trim().toLowerCase();
    if (clean.startsWith('page:')) clean = clean.slice(5);
    if (PAGE_BY_ID.has(clean)) return clean;
    return pageIdForPath(clean);
}

const seededConnections = new WeakSet();
const pendingByConnection = new WeakMap();

/** 首次读取时把原全员开放的 12 个业务页面写入 tool_distribution，保证升级前后开放状态一致。 */
async function ensureDefaults() {
    return runWithTenant(DEFAULT_TENANT_ID, async () => {
        await readKV(META_CATEGORY, SEED_KEY, false);
        const connection = getDatabase();
        if (seededConnections.has(connection)) return;
        let pending = pendingByConnection.get(connection);
        if (!pending) {
            pending = (async () => {
                const already = await readKV(META_CATEGORY, SEED_KEY, false);
                if (already !== true) {
                    await readKV('tool_distribution', '', false);
                    for (const page of PAGES) {
                        if (!page.defaultShared || page.locked) continue;
                        await run(
                            `INSERT OR IGNORE INTO sys_kv_store (category, key, value)
                             VALUES ('tool_distribution', ?, 'true')`,
                            [`page:${page.id}`]
                        );
                    }
                    await writeKV(META_CATEGORY, SEED_KEY, true);
                }
                seededConnections.add(connection);
            })().finally(() => {
                if (pendingByConnection.get(connection) === pending) pendingByConnection.delete(connection);
            });
            pendingByConnection.set(connection, pending);
        }
        return pending;
    });
}

async function allowedPageSet(user) {
    await ensureDefaults();
    if (!user || isSuperAdmin(user)) {
        return new Set(PAGES.map(page => page.id));
    }
    const allowed = await distribution.allowedEntries();
    return new Set(
        PAGES.filter(page => !page.locked && allowed.has(`page:${page.id}`)).map(page => page.id)
    );
}

async function hasFloatCapAccess() {
    const allowed = await distribution.allowedEntries();
    return [...allowed].some(key => key.startsWith('cap:float:'));
}

async function canAccessPage(idOrPath, user, { siteScripts = false } = {}) {
    const pageId = normalizePageId(idOrPath);
    if (!pageId) return true;
    const page = PAGE_BY_ID.get(pageId);
    if (!page) return true;
    if (!user || isSuperAdmin(user)) return true;
    if (page.locked) return false;
    await ensureDefaults();
    if (await distribution.hasEntryAccess(`page:${page.id}`)) return true;
    // 数据抓取浮窗插件若单独开放给全员，保留 /uivf12?siteScripts=1 入口以便打开该浮窗分组。
    if (page.id === 'uivf12' && siteScripts && await hasFloatCapAccess()) return true;
    return false;
}

async function canAccessAnyPage(ids, user) {
    if (!user || isSuperAdmin(user)) return true;
    const allowed = await allowedPageSet(user);
    return ids.some(id => allowed.has(id));
}

async function canAccessUivScripts(user) {
    if (!user || isSuperAdmin(user)) return true;
    if (await canAccessPage('uivf12', user)) return true;
    return hasFloatCapAccess();
}

async function listPages(user) {
    await ensureDefaults();
    const allowed = await distribution.allowedEntries();
    const superUser = !user || isSuperAdmin(user);
    return PAGES.map(page => ({
        id: page.id,
        href: page.href,
        sharedAccess: !page.locked && allowed.has(`page:${page.id}`),
        locked: page.locked,
        visible: superUser || (!page.locked && allowed.has(`page:${page.id}`))
    }));
}

async function setPageAccess(idOrPath, enabled) {
    await ensureDefaults();
    const pageId = normalizePageId(idOrPath);
    const page = pageId ? PAGE_BY_ID.get(pageId) : null;
    if (!page) throw Object.assign(new Error('平台工具不存在'), { status: 404 });
    if (page.locked) throw Object.assign(new Error('该系统工具仅超级管理员可用，不能开放给全员'), { status: 403 });
    await distribution.setEntryAccess(`page:${page.id}`, Boolean(enabled));
    return { id: page.id, href: page.href, sharedAccess: Boolean(enabled), locked: false };
}

const API_PAGE_RULES = [
    { pattern: /^\/(?:storage)(?:\/|$)/, pages: ['storage'] },
    { pattern: /^\/(?:db-explorer)(?:\/|$)/, pages: ['db-explorer'] },
    { pattern: /^\/(?:digital-human)(?:\/|$)/, pages: ['netcare-explorer'] },
    { pattern: /^\/frt(?:\/|$)/, pages: ['frt'] },
    { pattern: /^\/praudit(?:\/|$)/, pages: ['praudit'] },
    { pattern: /^\/ai-bi(?:\/|$)/, pages: ['ai-bi'] },
    { pattern: /^\/duty-roster(?:\/|$)/, pages: ['duty-roster'] },
    { pattern: /^\/uiv-ai-adapter(?:\/|$)/, pages: ['uivf12'] },
    { pattern: /^\/uiv\/(?:extension-download|backup|run-uivision-macro|uivision-runner)(?:\/|$)/, pages: ['uivf12'] },
    { pattern: /^\/uiv(?:\/|$)/, check: user => canAccessUivScripts(user) },
    // 上传历史 + 原始文件资料库 + 月报的资料目录、Logo、预设、草稿、文档都挂在 /upload 下：数据导入或月报任一开放即可
    { pattern: /^\/upload(?:\/|$)/, pages: ['sla', 'monthly'] },
    { pattern: /^\/sla\/(?:snapshot|snapshots\/cleanup-redundant|rule-templates|copied-fields|template-mapping)(?:\/|$)/, pages: ['sla'] },
    { pattern: /^\/sla\/(?:export-yuxiang|preview-yuxiang|rename-metric)(?:\/|$)/, pages: ['sla', 'report'] },
    { pattern: /^\/sla(?:\/|$)/, pages: ['sla', 'report', 'expedite', 'monthly', 'bigscreen', 'uivf12'] },
    { pattern: /^\/db\/(?:latest_failing|failing)(?:\/|$)/, pages: ['expedite'] },
    { pattern: /^\/db\/(?:expiring_warning_trends|metric_count_trends|metric_item_trend|manual-adjust-attachments|config\/report_snapshot_filter)(?:\/|$)/, pages: ['report'] },
    { pattern: /^\/db\/(?:bigscreen_owners|config\/bigscreen_)/, pages: ['bigscreen'] },
    { pattern: /^\/db\/(?:monthly_report_data|config\/monthly_report_titles)(?:\/|$)/, pages: ['monthly', 'report', 'bigscreen'] },
    { pattern: /^\/db\/save(?:\/|$)/, pages: ['sla', 'report'] },
    { pattern: /^\/db(?:\/|$)/, pages: ['report', 'expedite', 'monthly', 'bigscreen', 'sla'] },
    { pattern: /^\/(?:monthly-snapshots|meeting-snapshots|operation-incentive-snapshots|incentive-snapshots|report-msg)(?:\/|$)/, pages: ['monthly'] },
    { pattern: /^\/ai-report\/bi\/plan(?:\/|$)/, pages: ['ai-bi', 'monthly'] },
    { pattern: /^\/ai-report\/(?:cell|run-data)(?:\/|$)/, pages: ['monthly', 'ai-bi'] },
    { pattern: /^\/ai-report(?:\/|$)/, pages: ['monthly'] },
    { pattern: /^\/topic-snapshots\/(?:monthly-report|eos-monthly-report|mapping-config|import-upload)(?:\/|$)/, pages: ['topic-analysis'] },
    { pattern: /^\/topic-snapshots(?:\/|$)/, pages: ['topic-analysis', 'uivf12'] },
    {
        pattern: /^\/requirements(?:\/|$)/,
        check: (user, apiPath, method) => {
            if (/^\/requirements\/(?:skill-publications|catalog-updates|transport-key|uploads)(?:\/|$)/.test(apiPath)) return true;
            if (/^\/requirements\/[^/]+\/(?:approve-skill|approve-update|update-file)$/.test(apiPath)) return true;
            if (method === 'GET' && /^\/requirements\/[^/]+$/.test(apiPath)) return true;
            return canAccessPage('requirements', user);
        }
    }
];

async function canAccessApi(apiPath, method, user) {
    if (!user || isSuperAdmin(user)) return true;
    const cleanPath = String(apiPath || '').split(/[?#]/, 1)[0];
    for (const rule of API_PAGE_RULES) {
        if (!rule.pattern.test(cleanPath)) continue;
        if (typeof rule.check === 'function') return rule.check(user, cleanPath, String(method || 'GET').toUpperCase());
        return canAccessAnyPage(rule.pages, user);
    }
    return true;
}

module.exports = {
    PAGES,
    ensureDefaults,
    normalizePageId,
    pageIdForPath,
    allowedPageSet,
    hasFloatCapAccess,
    canAccessPage,
    canAccessAnyPage,
    canAccessUivScripts,
    canAccessApi,
    listPages,
    setPageAccess
};
