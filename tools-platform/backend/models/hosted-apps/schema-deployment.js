// 管理员部署 SQL；与应用运行期数据 API 分离，模拟基座 DBA 执行脚本。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sqlite3 = require('sqlite3');
const tenant = require('../tenant-context');
const runtime = require('./runtime');
const pending = new Set();
const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

/** 只读检查本地 sqlite 库是否已创建至少一张业务表；库不存在时不创建文件。 */
function hasUserTables(dbPath) {
    if (!fs.existsSync(dbPath)) return Promise.resolve(false);
    try {
        if (fs.statSync(dbPath).size === 0) return Promise.resolve(false);
    } catch (_error) {
        return Promise.resolve(false);
    }
    return new Promise(resolve => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, openError => {
            if (openError) return resolve(true); // 无法判断时保守放行，避免误拦已初始化应用
            db.get("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1", (queryError, row) => {
                db.close(() => resolve(queryError ? true : Boolean(row)));
            });
        });
    });
}

async function needsInit(slug) {
    const state = runtime.readState(runtime.assertSlug(slug));
    if (!state || state.databaseContract !== 'digital-human') return false;
    const tenantId = tenant.getTenantId();
    if (require('./data-environment').mode({ slug, tenantId }) === 'remote') return false;
    let plan;
    try { plan = inspect(slug, 'init'); } catch (_error) { return false; }
    if (plan.applied || state.schemaDeployments?.init?.hash || state.initSqlHash) return false;
    return !(await hasUserTables(runtime.paths(slug, tenantId).db));
}

function inspect(slug, kind) {
    if (!['init', 'upgrade'].includes(kind)) throw fail('部署类型只支持 init 或 upgrade', 'HOSTED_SCHEMA_KIND');
    const state = runtime.readState(runtime.assertSlug(slug));
    if (!state) throw fail('应用不存在', 'HOSTED_APP_NOT_FOUND', 404);
    if (state.databaseContract !== 'digital-human') throw fail('仅基座契约应用使用显式数据库部署', 'HOSTED_SCHEMA_CONTRACT');
    const root = runtime.paths(slug).code;
    for (const relative of [`db/${kind}.sqlite.sql`, `${kind}.sqlite.sql`]) {
        const file = path.join(root, relative);
        if (!fs.existsSync(file)) continue;
        let current = root;
        for (const part of relative.split('/')) {
            if (fs.lstatSync(current).isSymbolicLink()) throw fail('部署脚本路径不能包含符号链接', 'HOSTED_SCHEMA_PATH');
            current = path.join(current, part);
        }
        if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw fail('部署脚本必须是普通文件', 'HOSTED_SCHEMA_PATH');
        const sql = fs.readFileSync(file, 'utf8');
        const hash = crypto.createHash('sha256').update(sql).digest('hex');
        return { kind, file: relative, hash, sql, applied: state.schemaDeployments?.[kind]?.hash === hash || (kind === 'init' && state.initSqlHash === hash) };
    }
    throw fail(`未找到 ${kind}.sqlite.sql；基座模拟须提供明确的 SQLite 部署脚本`, 'HOSTED_SCHEMA_MISSING', 404);
}

async function apply(slug, kind, expectedHash) {
    if(require('./data-environment').mode({slug,tenantId:require('../tenant-context').getTenantId()})==='remote')throw Object.assign(new Error('当前为远端环境，请使用远端基座的导入/升级脚本部署，不能初始化本地库'),{status:409});
    const tenantId = tenant.getTenantId(), key = `${tenantId}/${runtime.assertSlug(slug)}`;
    if (pending.has(key)) throw fail('该应用正在部署数据库脚本', 'HOSTED_SCHEMA_BUSY', 409);
    pending.add(key);
    try {
        const plan = inspect(slug, kind);
        if (plan.hash !== expectedHash) throw fail('脚本内容已变化，请重新预览并确认', 'HOSTED_SCHEMA_CHANGED', 409);
        if (plan.applied) return { kind, file: plan.file, hash: plan.hash, skipped: true };
        await require('./data-api').applyDeploymentSql(tenantId, slug, plan.sql);
        const state = runtime.readState(slug);
        runtime.updateState(slug, { schemaDeployments: { ...state.schemaDeployments, [kind]: { hash: plan.hash, file: plan.file, appliedAt: new Date().toISOString() } } });
        return { kind, file: plan.file, hash: plan.hash, skipped: false };
    } finally { pending.delete(key); }
}
module.exports = { inspect, apply, needsInit };
