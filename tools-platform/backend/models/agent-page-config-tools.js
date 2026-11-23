'use strict';

// 只读页面配置查询工具（与基座版 read_page_config 对齐）：
// - 只开放白名单里的配置键，并按账号角色和页面开放范围过滤；
// - 登录凭据、账号密码、AI 模型密钥、记忆、对话、技能等敏感键永不开放；
// - 返回值中键名像 password/token/secret/apiKey 的字段一律脱敏，再过 redactText。
const { all: appAll, get: appGet } = require('./app-db');
const { readKV } = require('./kv-store');
const { getConnection } = require('./tenant-sqlite-pool');
const { DEFAULT_TENANT_ID, runWithTenant } = require('./tenant-context');
const { isSuperAdmin } = require('../middleware/auth');
const { canAccessAnyPage } = require('./page-distribution');
const { redactText } = require('./ai-sensitive-data');

const PAGE_CONFIGS = [
    { key: 'welink_policy_v2', store: 'report_config', page: 'expedite', label: '一键催办：WeLink 分发策略与通讯录' },
    { key: 'expedite_notify_directory', store: 'report_or_kv', page: 'expedite', label: '一键催办：催办通讯录' },
    { prefix: 'report_config:', store: 'report_or_kv', page: 'report', label: '报表看板：看板配置（每个看板一份）' },
    { key: 'report_snapshot_filter', store: 'report_config', page: 'report', label: '报表看板：快照过滤配置' },
    { key: 'monthly_report_titles', store: 'report_config', page: 'monthly', label: '月报：中英文标题配置' },
    { key: 'monthly_default_template', store: 'monthly_template', page: 'monthly', label: '月报：默认模板' },
    { key: 'monthly_quick_metrics_map', store: 'report_or_kv', page: 'monthly', label: '月报：快捷指标映射' },
    { key: 'bigscreen_title', store: 'report_config', page: 'bigscreen', label: '大屏看板：标题配置' },
    { key: 'bigscreen_contact_info', store: 'report_config', page: 'bigscreen', label: '大屏看板：联系人信息' },
    { key: 'import_settings', store: 'report_or_kv', page: 'sla', label: '数据导入：导入设置' },
    { key: 'sla_copied_fields', store: 'report_or_kv', page: 'sla', label: '数据导入：复制字段与规则模板' },
    { key: 'sla_fast_mapping_templates', store: 'report_or_kv', page: 'sla', label: '数据导入：快速映射模板' },
    { key: 'source_categories_map', store: 'report_or_kv', page: 'sla', label: '数据导入：来源文件分类映射' },
    { key: 'source_presentations_map', store: 'report_or_kv', page: 'sla', label: '数据导入：来源展示映射' },
    { key: 'topic_customer_mapping', store: 'report_or_kv', page: 'topic-analysis', label: '专题分析：客户映射' },
    { key: 'uiv_batch_scope', store: 'report_or_kv', page: 'uivf12', label: '数据抓取：批量执行范围' },
    { key: 'nav_settings', store: 'kv_sys', label: '平台导航布局' },
    { key: 'friend_links_config', store: 'kv_sys', label: '首页友情链接' },
    { key: 'platform_promotions_config', store: 'kv_sys', label: '首页推广位' },
    { key: 'tool_distribution', store: 'kv_category_platform', superAdmin: true, label: '全员开放名单（页面 / 技能 / 工具），仅超级管理员' },
    { key: 'agent_tool_access', store: 'kv_category_platform', superAdmin: true, label: 'AI 工具停用设置，仅超级管理员' }
];

const SECRET_KEY = /(?:password|passwd|pwd|secret|token|cookie|authorization|credential|private.?key|api.?key|密码|口令|密钥)/i;
const CONFIG_CHARS = 20000;

const DEFINITION = {
    name: 'read_page_config',
    description: '读取平台各页面保存的配置（如一键催办分发策略/通讯录、报表看板配置、月报标题与默认模板、大屏标题、数据导入设置、平台导航与首页推广位等）。不传 key 列出当前账号可读的已配置项；传 key 读内容。内容较大时可传 path 取子字段（如 "assignments" 或 "roster.0"），数组支持 offset / limit 分页。只读，密码/密钥等敏感字段自动隐藏。',
    parameters: {
        type: 'object',
        properties: {
            key: { type: 'string', description: '配置键，取自不传 key 时的列表' },
            path: { type: 'string', description: '可选：只取某个子字段，点号分隔，如 roster 或 items.0.name' },
            offset: { type: 'integer', description: '结果是数组时从第几项开始，默认 0' },
            limit: { type: 'integer', description: '结果是数组时最多取几项，默认 100，上限 500' }
        }
    }
};

function specFor(key) {
    return PAGE_CONFIGS.find(item => (item.key ? item.key === key : key.startsWith(item.prefix) && key.length > item.prefix.length)) || null;
}

async function canRead(spec, user) {
    if (!spec) return false;
    if (isSuperAdmin(user)) return true;
    if (spec.superAdmin) return false;
    if (spec.admin) return user?.role === 'admin';
    if (spec.page) return canAccessAnyPage([spec.page], user);
    return true;
}

function maskSecrets(value, depth = 0) {
    if (depth > 20 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => maskSecrets(item, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) && v !== '' && v != null ? '[已隐藏]' : maskSecrets(v, depth + 1)
    ]));
}

function pick(value, fieldPath) {
    let cur = value;
    for (const part of String(fieldPath || '').split(/[.[\]]/).filter(Boolean)) {
        if (cur == null || typeof cur !== 'object') return { missing: part };
        cur = cur[/^\d+$/.test(part) && Array.isArray(cur) ? Number(part) : part];
    }
    return { value: cur };
}

function outline(value) {
    if (Array.isArray(value)) return `数组，${value.length} 项`;
    if (value && typeof value === 'object') return `对象，字段：${Object.keys(value).slice(0, 40).join('、')}`;
    return typeof value;
}

function parseJsonSafe(raw) {
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch { return raw; }
}

function reportAll(sql, params = []) {
    return new Promise(resolve => {
        try {
            const db = getConnection('report.db', 'report');
            db.all(sql, params, (err, rows) => resolve(err ? [] : (rows || [])));
        } catch {
            resolve([]);
        }
    });
}

function reportGet(sql, params = []) {
    return new Promise(resolve => {
        try {
            const db = getConnection('report.db', 'report');
            db.get(sql, params, (err, row) => resolve(err ? null : (row || null)));
        } catch {
            resolve(null);
        }
    });
}

async function listConfigs(user) {
    const found = new Map();

    // 1. report.db PlatformConfig
    const reportRows = await reportAll('SELECT key_name, updated_at FROM PlatformConfig ORDER BY key_name');
    for (const row of reportRows) {
        const key = String(row.key_name || '');
        const spec = specFor(key);
        if (!spec || !['report_config', 'report_or_kv'].includes(spec.store)) continue;
        if (!(await canRead(spec, user))) continue;
        found.set(key, { key, page: spec.page || '', label: spec.label, updatedAt: row.updated_at || '' });
    }

    // 2. tools.db sys_kv_store (category = 'sys')
    const kvRows = await appAll("SELECT key FROM sys_kv_store WHERE category = 'sys'").catch(() => []);
    for (const row of kvRows) {
        const key = String(row.key || '');
        const spec = specFor(key);
        if (!spec || !['kv_sys', 'report_or_kv'].includes(spec.store) || found.has(key)) continue;
        if (!(await canRead(spec, user))) continue;
        found.set(key, { key, page: spec.page || '', label: spec.label, updatedAt: '' });
    }

    // 3. tools.db monthly_default_template
    const monthlySpec = specFor('monthly_default_template');
    if (monthlySpec && await canRead(monthlySpec, user)) {
        const tplRow = await appGet('SELECT updated_at FROM monthly_default_template WHERE id = 1').catch(() => null);
        if (tplRow) {
            found.set('monthly_default_template', {
                key: 'monthly_default_template',
                page: monthlySpec.page || '',
                label: monthlySpec.label,
                updatedAt: tplRow.updated_at || ''
            });
        }
    }

    // 4. Platform-global super-admin categories
    for (const key of ['tool_distribution', 'agent_tool_access']) {
        const spec = specFor(key);
        if (!spec || !(await canRead(spec, user))) continue;
        const rows = await runWithTenant(DEFAULT_TENANT_ID, () =>
            appAll('SELECT key FROM sys_kv_store WHERE category = ?', [key]).catch(() => [])
        );
        if (rows.length) {
            found.set(key, {
                key,
                page: '',
                label: spec.label,
                updatedAt: ''
            });
        }
    }

    return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function readConfigValue(key, spec) {
    if (spec.store === 'report_config' || spec.store === 'report_or_kv') {
        const row = await reportGet('SELECT value_json FROM PlatformConfig WHERE key_name = ?', [key]);
        if (row && row.value_json !== undefined) return parseJsonSafe(row.value_json);
        if (spec.store === 'report_config') return undefined;
    }
    if (spec.store === 'kv_sys' || spec.store === 'report_or_kv') {
        const val = await readKV('sys', key, undefined);
        if (val !== undefined) return val;
    }
    if (spec.store === 'monthly_template') {
        const row = await appGet('SELECT payload_json FROM monthly_default_template WHERE id = 1').catch(() => null);
        return row ? parseJsonSafe(row.payload_json) : undefined;
    }
    if (spec.store === 'kv_category_platform') {
        const rows = await runWithTenant(DEFAULT_TENANT_ID, () =>
            appAll('SELECT key, value FROM sys_kv_store WHERE category = ? ORDER BY key', [key]).catch(() => [])
        );
        if (!rows.length) return undefined;
        return Object.fromEntries(rows.map(row => [row.key, parseJsonSafe(row.value)]));
    }
    return undefined;
}

const fail = (message, summary = message) => ({ content: message, summary: String(summary).slice(0, 80), isError: true });

async function execute(args = {}, { user, tenantId = '', secrets = [] } = {}) {
    const scoped = fn => (tenantId ? runWithTenant(tenantId, fn) : fn());
    return scoped(async () => {
        const key = String(args.key || '').trim();
        if (!key) {
            const items = await listConfigs(user);
            return {
                content: JSON.stringify({
                    configs: items,
                    note: items.length ? '传 key 读取具体内容' : '暂时没有你能读取的已保存页面配置'
                }),
                summary: `${items.length} 项配置`
            };
        }
        const spec = specFor(key);
        if (!spec) {
            return fail(`配置 ${key} 不开放读取。不传 key 可以查看开放读取的配置列表；业务表请用 query_database。`, '配置不开放');
        }
        if (!(await canRead(spec, user))) {
            return fail(spec.superAdmin ? `配置 ${key} 仅超级管理员可读。` : spec.admin ? `配置 ${key} 仅管理员可读。` : `配置 ${key} 所属页面没有对你开放。`, '没有权限');
        }
        const raw = await readConfigValue(key, spec);
        if (raw === undefined) {
            return {
                content: JSON.stringify({ key, label: spec.label, empty: true, note: '这个页面还没有保存过这项配置' }),
                summary: `${spec.label} · 尚未配置`
            };
        }
        const masked = maskSecrets(raw);
        const picked = pick(masked, args.path);
        if (picked.missing) {
            return fail(`路径 ${args.path} 不存在（在「${picked.missing}」处找不到）。整体结构：${outline(masked)}`, '路径不存在');
        }
        let value = picked.value;
        let page = null;
        if (Array.isArray(value)) {
            const offset = Math.max(0, Math.floor(Number(args.offset)) || 0);
            const limit = Math.max(1, Math.min(Number(args.limit) || 100, 500));
            page = { total: value.length, offset, nextOffset: offset + limit < value.length ? offset + limit : null };
            value = value.slice(offset, offset + limit);
        }
        let text = JSON.stringify(value);
        const truncated = text.length > CONFIG_CHARS;
        if (truncated) text = `${text.slice(0, CONFIG_CHARS)}…`;
        const payload = JSON.stringify({
            key,
            label: spec.label,
            path: args.path || '',
            structure: outline(picked.value),
            ...(page || {}),
            ...(truncated ? { note: `内容超过 ${CONFIG_CHARS} 字符已截断：请用 path 取子字段，数组用 offset / limit 分页` } : {}),
            value: truncated ? text : value
        });
        return {
            content: redactText(payload, { secrets }),
            summary: `${spec.label}${args.path ? ` / ${args.path}` : ''}${page ? ` · ${page.total} 项` : ''}${truncated ? '（已截断）' : ''}`
        };
    });
}

module.exports = { DEFINITION, PAGE_CONFIGS, execute, maskSecrets };
