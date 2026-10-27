// 数字人基座对接配置：与频道对接一致，存放在当前租户的 sys_kv_store（租户隔离）。
// 基座地址、数据源与应用身份（x-app-id / x-app-level）都在这里配置，代码不内置任何连接信息；
// 管理员可直接粘贴参考工程的 .env 文本导入（parseEnvText）。
const { readKV, writeKV } = require('../kv-store');

const CATEGORY = 'digital-human';
const KEY = 'config';
const DEFAULT_QUERY_URL = 'https://netcareclaw-beta.icta138.huawei.com/digital-human/api/dh/query';

const DEFAULT_CONFIG = {
    enabled: false,
    appName: '',
    baseQueryUrl: DEFAULT_QUERY_URL,
    businessDatasourceName: 'netcareClaw-operate-digital-readonly',
    businessSchema: 'netcare',
    appDatasourceId: '2',
    appSchema: '',
    appUuid: '',
    appLevel: 'BUSINESS',
    timeoutSec: 15,
    verifySsl: false,
    maxRows: 50000,
    lastTest: null,
    updatedAt: null
};

// .env 键 → 配置字段；PORT / WORKERS / RELOAD / CORS_ORIGINS / DEBUG 只属于参考工程自身的 FastAPI，导入时忽略
const ENV_KEYS = {
    APP_NAME: 'appName',
    BASE_QUERY_URL: 'baseQueryUrl',
    BUSINESS_DATASOURCE_NAME: 'businessDatasourceName',
    BUSINESS_SCHEMA: 'businessSchema',
    APP_DATASOURCE_ID: 'appDatasourceId',
    APP_SCHEMA: 'appSchema',
    APP_UUID: 'appUuid',
    APP_LEVEL: 'appLevel',
    HTTP_TIMEOUT: 'timeoutSec',
    HTTP_VERIFY_SSL: 'verifySsl'
};
const IGNORED_ENV_KEYS = new Set(['PORT', 'WORKERS', 'RELOAD', 'CORS_ORIGINS', 'DEBUG', 'APP_VERSION', 'MAX_PAGE_SIZE', 'DEFAULT_PAGE_SIZE']);
const EDITABLE = ['enabled', 'appName', 'baseQueryUrl', 'businessDatasourceName', 'businessSchema', 'appDatasourceId', 'appSchema', 'appUuid', 'appLevel', 'timeoutSec', 'verifySsl', 'maxRows'];
const IDENT_RE = /^[A-Za-z0-9_\-.$]{1,128}$/;

function clean(value, max = 200) {
    return String(value ?? '').trim().slice(0, max);
}

function toBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const text = clean(value).toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'off'].includes(text)) return false;
    return fallback;
}

function clampInt(value, min, max, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeUrl(value) {
    const text = clean(value, 500).replace(/\/+$/, '');
    if (!text) return '';
    try {
        const url = new URL(text);
        return /^https?:$/.test(url.protocol) ? text : '';
    } catch {
        return '';
    }
}

function normalizeIdent(value, fallback = '') {
    const text = clean(value, 128);
    return IDENT_RE.test(text) ? text : fallback;
}

function normalizeConfig(input = {}) {
    const base = { ...DEFAULT_CONFIG, ...input };
    return {
        enabled: base.enabled === true,
        appName: clean(base.appName, 100),
        baseQueryUrl: normalizeUrl(base.baseQueryUrl) || DEFAULT_QUERY_URL,
        businessDatasourceName: normalizeIdent(base.businessDatasourceName, DEFAULT_CONFIG.businessDatasourceName),
        businessSchema: normalizeIdent(base.businessSchema, DEFAULT_CONFIG.businessSchema),
        appDatasourceId: normalizeIdent(String(base.appDatasourceId ?? ''), ''),
        appSchema: normalizeIdent(base.appSchema, ''),
        appUuid: normalizeIdent(base.appUuid, ''),
        appLevel: normalizeIdent(base.appLevel, DEFAULT_CONFIG.appLevel),
        timeoutSec: clampInt(base.timeoutSec, 3, 120, DEFAULT_CONFIG.timeoutSec),
        verifySsl: toBool(base.verifySsl, false),
        maxRows: clampInt(base.maxRows, 1000, 200000, DEFAULT_CONFIG.maxRows),
        lastTest: base.lastTest && typeof base.lastTest === 'object' ? base.lastTest : null,
        updatedAt: base.updatedAt || null
    };
}

// 基座接口基地址：BASE_QUERY_URL 去掉末尾 /query（…/api/dh），query / execute / datasources 都挂在它下面
function apiBase(config) {
    return String(config.baseQueryUrl || DEFAULT_QUERY_URL).replace(/\/+$/, '').replace(/\/query$/i, '');
}

// 应用 schema 可用：数据源 ID 与 schema 都配置了
function appReady(config) {
    return Boolean(config.appDatasourceId && config.appSchema);
}

async function getConfig() {
    return normalizeConfig(await readKV(CATEGORY, KEY, DEFAULT_CONFIG) || DEFAULT_CONFIG);
}

async function saveConfig(patch = {}) {
    const current = await getConfig();
    const next = { ...current };
    for (const key of EDITABLE) if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
    const normalized = normalizeConfig({ ...next, updatedAt: new Date().toISOString() });
    if (patch.baseQueryUrl !== undefined && clean(patch.baseQueryUrl) && !normalizeUrl(patch.baseQueryUrl)) {
        throw Object.assign(new Error('基座查询地址必须是 http(s) 地址'), { statusCode: 400, code: 'DH_BAD_URL' });
    }
    await writeKV(CATEGORY, KEY, normalized);
    return normalized;
}

async function saveTestResult(lastTest) {
    const current = await getConfig();
    const normalized = normalizeConfig({ ...current, lastTest });
    await writeKV(CATEGORY, KEY, normalized);
    return normalized;
}

/**
 * 解析 .env 文本（参考工程的配置文件，可从截图识别后粘贴）。
 * 兼容：# 注释、export 前缀、引号、行尾 # 注释、全角等号/冒号、键名里的空格（如 OCR 把下划线识别成空格）。
 * @returns {{ patch: object, applied: Array<{key, field, value}>, ignored: string[], unknown: string[], warnings: string[] }}
 */
function parseEnvText(text) {
    const patch = {};
    const applied = [];
    const ignored = [];
    const unknown = [];
    const warnings = [];
    const lines = String(text || '').slice(0, 20000).replace(/\r/g, '').split('\n');
    for (const rawLine of lines) {
        const line = rawLine.replace(/[＝]/g, '=').replace(/^\s*export\s+/i, '').trim();
        if (!line || line.startsWith('#')) continue;
        const match = /^([A-Za-z][A-Za-z0-9_ \-]*?)\s*[=:：]\s*(.*)$/.exec(line);
        if (!match) continue;
        const key = match[1].trim().toUpperCase().replace(/[\s\-]+/g, '_');
        let value = match[2].trim();
        if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
        else value = value.replace(/\s+#.*$/, '').trim();
        if (IGNORED_ENV_KEYS.has(key)) { ignored.push(key); continue; }
        const field = ENV_KEYS[key];
        if (!field) { unknown.push(key); continue; }
        patch[field] = value;
        applied.push({ key, field, value });
    }
    if (patch.baseQueryUrl !== undefined && !normalizeUrl(patch.baseQueryUrl)) {
        warnings.push(`BASE_QUERY_URL 不是有效的 http(s) 地址：${patch.baseQueryUrl}`);
        delete patch.baseQueryUrl;
    }
    for (const field of ['appSchema', 'appUuid', 'appDatasourceId', 'businessDatasourceName', 'appLevel']) {
        if (patch[field] !== undefined && !normalizeIdent(patch[field])) {
            warnings.push(`${field} 含有不支持的字符，已忽略：${patch[field]}`);
            delete patch[field];
        }
    }
    if (patch.appSchema && patch.appUuid && patch.appSchema !== patch.appUuid) warnings.push('APP_SCHEMA 与 APP_UUID 不一致（通常二者相同），请核对是否识别有误');
    if (!applied.length) warnings.push('没有识别到可用的配置项，请粘贴 KEY=VALUE 格式的配置文本');
    return { patch, applied, ignored, unknown, warnings };
}

module.exports = { DEFAULT_CONFIG, DEFAULT_QUERY_URL, normalizeConfig, getConfig, saveConfig, saveTestResult, parseEnvText, apiBase, appReady };
