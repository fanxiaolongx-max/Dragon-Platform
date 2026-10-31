// 管理员部署 SQL；与应用运行期数据 API 分离，模拟基座 DBA 执行脚本。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tenant = require('../tenant-context');
const runtime = require('./runtime');
const pending = new Set();
const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

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
module.exports = { inspect, apply };
