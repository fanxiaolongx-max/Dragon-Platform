const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const DEFAULT_TENANT_ID = 'default';
function getBaseDataDir() {
    return path.resolve(process.env.TOOLS_DATA_DIR || path.join(__dirname, '../data'));
}
function getBaseReportDataDir() {
    return path.resolve(process.env.TOOLS_REPORT_DATA_DIR
        || (process.env.TOOLS_DATA_DIR ? getBaseDataDir() : path.join(__dirname, '../../data')));
}
const storage = new AsyncLocalStorage();

function normalizeTenantId(value) {
    const id = String(value || DEFAULT_TENANT_ID).trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(id) ? id : DEFAULT_TENANT_ID;
}

function getTenantId() {
    return normalizeTenantId(storage.getStore()?.tenantId);
}

function runWithTenant(tenantId, callback) {
    return storage.run({ tenantId: normalizeTenantId(tenantId) }, callback);
}

function getDataDir(tenantId = getTenantId()) {
    const id = normalizeTenantId(tenantId);
    const base = getBaseDataDir();
    return id === DEFAULT_TENANT_ID ? base : path.join(base, 'tenants', id);
}

function getReportDataDir(tenantId = getTenantId()) {
    const id = normalizeTenantId(tenantId);
    return id === DEFAULT_TENANT_ID ? getBaseReportDataDir() : getDataDir(id);
}

// 团队的「用户空间」：workspace 是 AI 对话与终端可用的根目录；home 是命令运行时的 HOME（CLI 登录、全局包、技能安装）；
// tmp 是命令的临时目录。三者都在团队数据目录内，但与团队的数据库文件分开，命令改不到数据库。
function getWorkspaceDir(tenantId = getTenantId()) {
    return path.join(getDataDir(tenantId), 'workspace');
}
function getHomeDir(tenantId = getTenantId()) {
    return path.join(getDataDir(tenantId), 'home');
}
function getTmpDir(tenantId = getTenantId()) {
    return path.join(getDataDir(tenantId), 'tmp', 'sandbox');
}

function ensureUserSpaceDirs(tenantId = getTenantId()) {
    const dirs = { workspace: getWorkspaceDir(tenantId), home: getHomeDir(tenantId), tmp: getTmpDir(tenantId) };
    Object.values(dirs).forEach(dir => fs.mkdirSync(dir, { recursive: true }));
    return dirs;
}

function ensureTenantDirs(tenantId = getTenantId()) {
    const dataDir = getDataDir(tenantId);
    const reportDir = getReportDataDir(tenantId);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(reportDir, { recursive: true });
    return { dataDir, reportDir };
}

function tenantMiddleware(req, _res, next) {
    runWithTenant(req.user?.tenantId || DEFAULT_TENANT_ID, next);
}

module.exports = {
    get BASE_DATA_DIR() { return getBaseDataDir(); },
    get BASE_REPORT_DATA_DIR() { return getBaseReportDataDir(); },
    DEFAULT_TENANT_ID,
    get TENANTS_ROOT() { return path.join(getBaseDataDir(), 'tenants'); },
    ensureTenantDirs,
    ensureUserSpaceDirs,
    getDataDir,
    getHomeDir,
    getTmpDir,
    getWorkspaceDir,
    getReportDataDir,
    getTenantId,
    normalizeTenantId,
    runWithTenant,
    tenantMiddleware
};
