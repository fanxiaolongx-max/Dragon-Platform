const express = require('express');
const acorn = require('acorn');
const aiSettingsRepo = require('../models/ai-settings-repository');
const aiProviderClient = require('../models/ai-provider-client');
const { detectNativeGenerationPlan } = require('../models/uiv-ai-template-matcher');

const router = express.Router();

const ALLOWED_METHODS = new Set(['GET', 'POST']);
const ALLOWED_BODY_TYPES = new Set(['none', 'json', 'form']);
const ALLOWED_PAGINATION_TYPES = new Set(['none', 'pageNumber', 'offset', 'cursor']);
const ALLOWED_AUTH_STRATEGIES = new Set(['none', 'cookie', 'cookieHeader', 'localStorage', 'sessionStorage', 'autoProbe']);
const ALLOWED_ROW_MODES = new Set(['object', 'value', 'array']);
const SENSITIVE_HEADER_RE = /authorization|cookie|token|secret|api[-_]?key|csrf|xsrf/i;
const SAFE_HEADER_VALUE_RE = /^(accept|content-type|x-requested-with|language)$/i;
const MAX_AI_SAMPLE_CHARS = 120000;
const MAX_FETCH_SOURCE_CHARS = 200000;
const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const AI_SAMPLE_CONFIGS = [
    { maxDepth: 8, maxArrayItems: 8, maxObjectKeys: 120, maxStringLength: 1200 },
    { maxDepth: 7, maxArrayItems: 5, maxObjectKeys: 80, maxStringLength: 800 },
    { maxDepth: 6, maxArrayItems: 3, maxObjectKeys: 50, maxStringLength: 500 },
    { maxDepth: 5, maxArrayItems: 2, maxObjectKeys: 35, maxStringLength: 300 }
];

function readStaticAstValue(node, depth = 0) {
    if (!node || depth > 20) throw new Error('fetch 内容嵌套过深');
    if (node.type === 'Literal') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis.map(item => item.value.cooked || '').join('');
    }
    if (node.type === 'ObjectExpression') {
        const output = {};
        node.properties.forEach(property => {
            if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method) {
                throw new Error('fetch 对象中包含不支持的动态属性');
            }
            const key = property.key.type === 'Identifier'
                ? property.key.name
                : readStaticAstValue(property.key, depth + 1);
            output[String(key)] = readStaticAstValue(property.value, depth + 1);
        });
        return output;
    }
    if (node.type === 'ArrayExpression') {
        return node.elements.map(item => readStaticAstValue(item, depth + 1));
    }
    if (node.type === 'UnaryExpression' && ['-', '+'].includes(node.operator)) {
        const value = readStaticAstValue(node.argument, depth + 1);
        if (typeof value !== 'number') throw new Error('fetch 中的一元运算只允许数字');
        return node.operator === '-' ? -value : value;
    }
    if (
        node.type === 'CallExpression' &&
        node.callee &&
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'JSON' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'stringify' &&
        node.arguments.length === 1
    ) {
        return JSON.stringify(readStaticAstValue(node.arguments[0], depth + 1));
    }
    if (
        node.type === 'NewExpression' &&
        node.callee &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'URLSearchParams' &&
        node.arguments.length <= 1
    ) {
        const input = node.arguments.length ? readStaticAstValue(node.arguments[0], depth + 1) : '';
        if (typeof input !== 'string' && (!input || Array.isArray(input) || typeof input !== 'object')) {
            throw new Error('URLSearchParams 仅支持静态字符串或对象');
        }
        return new URLSearchParams(input).toString();
    }
    throw new Error(`fetch 中包含不支持的动态表达式：${node.type}`);
}

function unwrapFetchExpression(node) {
    let current = node;
    while (current && ['AwaitExpression', 'ChainExpression'].includes(current.type)) {
        current = current.argument || current.expression;
    }
    return current;
}

function parseCopyAsFetch(source) {
    const text = String(source || '').trim();
    if (!text) throw new Error('请粘贴浏览器 Copy as fetch 的内容');
    if (text.length > MAX_FETCH_SOURCE_CHARS) throw new Error('Copy as fetch 内容过大');
    const program = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script' });
    const statement = program.body.find(item => item.type === 'ExpressionStatement');
    const expression = statement && unwrapFetchExpression(statement.expression);
    if (
        !expression ||
        expression.type !== 'CallExpression' ||
        expression.callee.type !== 'Identifier' ||
        expression.callee.name !== 'fetch'
    ) {
        throw new Error('未识别到标准 fetch(...) 调用');
    }
    if (!expression.arguments.length || expression.arguments.length > 2) {
        throw new Error('fetch 参数数量不受支持');
    }
    const url = String(readStaticAstValue(expression.arguments[0]) || '').trim();
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (error) {
        throw new Error('fetch 请求 URL 无效');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('仅支持 HTTP/HTTPS URL');

    const options = expression.arguments[1] ? readStaticAstValue(expression.arguments[1]) : {};
    if (!options || Array.isArray(options) || typeof options !== 'object') throw new Error('fetch options 必须是对象');
    const method = String(options.method || (options.body === undefined ? 'GET' : 'POST')).toUpperCase();
    if (!ALLOWED_METHODS.has(method)) throw new Error('当前仅支持 GET/POST');
    const headers = options.headers || {};
    if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error('fetch headers 必须是对象');

    const contentTypeEntry = Object.entries(headers).find(([key]) => String(key).toLowerCase() === 'content-type');
    const contentType = String(contentTypeEntry && contentTypeEntry[1] || '').toLowerCase();
    let requestBody = {};
    let bodyType = method === 'GET' ? 'none' : 'json';
    if (options.body !== undefined && options.body !== null && options.body !== '') {
        if (typeof options.body !== 'string') throw new Error('请求体必须是静态 JSON、URLSearchParams 或 URL 编码字符串');
        const rawBody = options.body.trim();
        const looksJson = /json|graphql/.test(contentType) || rawBody.startsWith('{') || rawBody.startsWith('[');
        if (looksJson) {
            try {
                requestBody = JSON.parse(options.body);
                bodyType = 'json';
            } catch (error) {
                throw new Error('fetch body 看起来是 JSON，但解析失败');
            }
        } else if (contentType.includes('application/x-www-form-urlencoded') || rawBody.includes('=')) {
            requestBody = {};
            for (const [key, value] of new URLSearchParams(options.body).entries()) {
                if (!Object.prototype.hasOwnProperty.call(requestBody, key)) requestBody[key] = value;
                else if (Array.isArray(requestBody[key])) requestBody[key].push(value);
                else requestBody[key] = [requestBody[key], value];
            }
            bodyType = 'form';
        } else {
            throw new Error('fetch body 不是合法 JSON 或 URL 编码表单；暂不支持 FormData/文件上传');
        }
    } else if (method !== 'GET') {
        bodyType = 'none';
    }
    return {
        url: parsedUrl.toString(),
        method,
        bodyType,
        headers: normalizeHeaders(headers),
        requestBody,
        credentials: ['omit', 'same-origin'].includes(options.credentials) ? options.credentials : 'include'
    };
}

function parseJsonValue(value, label, options = {}) {
    if (value === undefined || value === null || value === '') {
        if (options.optional) return options.fallback;
        throw new Error(`${label}不能为空`);
    }
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(String(value));
    } catch (error) {
        throw new Error(`${label}不是合法 JSON`);
    }
}

function stripJsonFence(value) {
    return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

function repairCommonAiJson(value) {
    const raw = stripJsonFence(value)
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'");
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return '';
    return raw.slice(start, end + 1)
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/("(?:[^"\\]|\\.)*"|[}\]]|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?)(\s+)("[^"\n]+"\s*:)/g, '$1,$2$3');
}

function parseAiJson(value) {
    const raw = stripJsonFence(value);
    const attempts = [raw];
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) attempts.push(raw.slice(start, end + 1));
    const repaired = repairCommonAiJson(raw);
    if (repaired) attempts.push(repaired);
    let lastError = null;
    for (const attempt of [...new Set(attempts)]) {
        try {
            return JSON.parse(attempt);
        } catch (error) {
            lastError = error;
        }
    }
    const preview = raw.slice(0, 600).replace(/\s+/g, ' ').trim();
    throw new Error(`AI 返回的适配器 JSON 格式异常：${lastError && lastError.message || '无法解析'}。输出预览：${preview}`);
}

function cleanGeneratedChineseName(value) {
    return String(value || '')
        .replace(/[“”"'`<>[\]{}()（）【】]/g, '')
        .replace(/[，。！？、,:：;；/\\|]+/g, '')
        .replace(/\s+/g, '')
        .slice(0, 16);
}

function cleanGeneratedEnglishName(value) {
    const raw = String(value || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim();
    return raw
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 5)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('')
        .slice(0, 32);
}

function buildScriptNamingPrompt(input) {
    return `你是自动化脚本命名助手。根据下面经过脱敏和裁剪的脚本摘要，为脚本生成准确、简短、可搜索的中英文名称。

要求：
1. 只返回严格 JSON：{"zhName":"...","enName":"..."}。
2. zhName 使用 4-10 个中文字符，准确描述业务对象或数据用途，不要出现“脚本”“自动抓取”“数据导出”等泛词。
3. enName 使用 2-5 个英文单词的 PascalCase，总长度不超过 28 个字符，不要使用 Script、AutoFetch、DataExport 等泛词。
4. 中英文语义必须一致；优先使用页面名、业务对象、接口资源和关键筛选字段。
5. 不要包含日期、地区、用户名、环境名、文件后缀或解释文字。

脚本摘要：
${JSON.stringify(input, null, 2)}`;
}

function normalizePath(value) {
    const path = String(value || '')
        .trim()
        .replace(/^\$\.?/, '')
        .replace(/\[(\d+)\]/g, '.$1');
    if (!path) return '';
    if (!/^[A-Za-z0-9_$.-]+$/.test(path)) throw new Error(`数据路径包含不支持的字符：${path}`);
    const segments = path.split('.');
    if (segments.some(segment => !segment)) throw new Error(`数据路径格式无效：${path}`);
    const unsafeSegment = segments.find(segment => BLOCKED_PATH_SEGMENTS.has(segment.toLowerCase()));
    if (unsafeSegment) throw new Error(`数据路径包含不安全字段：${unsafeSegment}`);
    return segments.join('.');
}

function normalizeHeaderName(value, options = {}) {
    const name = String(value || '').trim().slice(0, 100);
    if (!name) {
        if (options.allowEmpty) return '';
        throw new Error('请求头名称不能为空');
    }
    if (!HEADER_NAME_RE.test(name) || BLOCKED_PATH_SEGMENTS.has(name.toLowerCase())) {
        throw new Error(`请求头名称无效：${name}`);
    }
    return name;
}

function getAtPath(value, path) {
    if (!path) return value;
    return normalizePath(path).split('.').filter(Boolean).reduce((current, key) => {
        if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(Object(current), key)) return undefined;
        return current[key];
    }, value);
}

function joinPaths(prefix, path) {
    const left = normalizePath(prefix);
    const right = normalizePath(path);
    if (!left) return right;
    if (!right) return left;
    if (right === left || right.startsWith(`${left}.`)) return right;
    return `${left}.${right}`;
}

function normalizeHeaders(value) {
    const headers = parseJsonValue(value, '请求头', { optional: true, fallback: {} });
    if (!headers || Array.isArray(headers) || typeof headers !== 'object') {
        throw new Error('请求头必须是 JSON 对象');
    }
    return Object.fromEntries(
        Object.entries(headers)
            .slice(0, 60)
            .map(([key, headerValue]) => [normalizeHeaderName(key), String(headerValue).slice(0, 4000)])
    );
}

function redactHeaders(headers) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
        if (SENSITIVE_HEADER_RE.test(key)) return [key, '{{REDACTED_SENSITIVE_VALUE}}'];
        return [key, SAFE_HEADER_VALUE_RE.test(key) ? value : '{{VALUE_OMITTED}}'];
    }));
}

function summarizeSearchParams(parsedUrl) {
    const summary = Object.create(null);
    for (const [key, rawValue] of parsedUrl.searchParams.entries()) {
        if (Object.keys(summary).length >= 60 && !Object.prototype.hasOwnProperty.call(summary, key)) break;
        const textValue = String(rawValue);
        const value = SENSITIVE_HEADER_RE.test(key)
            ? '{{REDACTED_SENSITIVE_VALUE}}'
            : (/^-?\d+(?:\.\d+)?$/.test(textValue) || /^(?:true|false)$/i.test(textValue)
                ? textValue.slice(0, 100)
                : `{{STRING_LENGTH:${textValue.length}}}`);
        if (!Object.prototype.hasOwnProperty.call(summary, key)) {
            summary[key] = value;
        } else if (Array.isArray(summary[key])) {
            if (summary[key].length < 10) summary[key].push(value);
        } else {
            summary[key] = [summary[key], value];
        }
    }
    return summary;
}

function redactSensitiveObject(value, depth = 0) {
    if (depth > 12) return '{{DEPTH_LIMIT}}';
    if (Array.isArray(value)) return value.slice(0, 200).map(item => redactSensitiveObject(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).slice(0, 300).map(([key, child]) => {
        if (SENSITIVE_HEADER_RE.test(key)) return [key, '{{REDACTED_SENSITIVE_VALUE}}'];
        return [key, redactSensitiveObject(child, depth + 1)];
    }));
}

function jsonSize(value) {
    return JSON.stringify(value).length;
}

function sampleJsonValue(value, config, depth = 0) {
    if (depth > config.maxDepth) return { value: '{{DEPTH_LIMIT}}', truncated: true };
    if (typeof value === 'string') {
        if (value.length > config.maxStringLength) {
            return {
                value: `${value.slice(0, config.maxStringLength)}…{{STRING_TRUNCATED:${value.length}}}`,
                truncated: true
            };
        }
        return { value, truncated: false };
    }
    if (!value || typeof value !== 'object') return { value, truncated: false };
    if (Array.isArray(value)) {
        let truncated = value.length > config.maxArrayItems;
        const items = value.slice(0, config.maxArrayItems).map(item => {
            const sampled = sampleJsonValue(item, config, depth + 1);
            if (sampled.truncated) truncated = true;
            return sampled.value;
        });
        return { value: items, truncated };
    }
    const entries = Object.entries(value);
    let truncated = entries.length > config.maxObjectKeys;
    const sampledEntries = entries.slice(0, config.maxObjectKeys).map(([key, child]) => {
        const sampled = sampleJsonValue(child, config, depth + 1);
        if (sampled.truncated) truncated = true;
        return [key, sampled.value];
    });
    return { value: Object.fromEntries(sampledEntries), truncated };
}

function prepareAiSample(value, label) {
    const originalChars = jsonSize(value);
    for (const config of AI_SAMPLE_CONFIGS) {
        const sampled = sampleJsonValue(redactSensitiveObject(value), config);
        const sampledChars = jsonSize(sampled.value);
        if (sampledChars <= MAX_AI_SAMPLE_CHARS) {
            return {
                value: sampled.value,
                info: {
                    label,
                    originalChars,
                    sampledChars,
                    truncated: sampled.truncated || sampledChars < originalChars
                }
            };
        }
    }
    throw new Error(`${label}结构过大，自动抽样后仍超过 ${MAX_AI_SAMPLE_CHARS} 字符；请保留代表性字段后再试`);
}

function normalizeAdapter(raw, requestMethod, requestBodyType) {
    const request = raw && typeof raw.request === 'object' ? raw.request : {};
    const auth = raw && typeof raw.auth === 'object' ? raw.auth : {};
    const pagination = raw && typeof raw.pagination === 'object' ? raw.pagination : {};
    const response = raw && typeof raw.response === 'object' ? raw.response : {};

    const method = String(requestMethod || 'POST').toUpperCase();
    const bodyType = method === 'GET' ? 'none' : String(requestBodyType || request.bodyType || 'json');
    const authStrategy = String(auth.strategy || 'none');
    const paginationType = String(pagination.type || 'none');
    const rowMode = String(response.rowMode || 'object');

    if (!ALLOWED_METHODS.has(method)) throw new Error(`AI 返回了不支持的请求方法：${method}`);
    if (!ALLOWED_BODY_TYPES.has(bodyType)) throw new Error(`AI 返回了不支持的请求体类型：${bodyType}`);
    if (!ALLOWED_AUTH_STRATEGIES.has(authStrategy)) throw new Error(`AI 返回了不支持的认证策略：${authStrategy}`);
    if (!ALLOWED_PAGINATION_TYPES.has(paginationType)) throw new Error(`AI 返回了不支持的分页类型：${paginationType}`);
    if (!ALLOWED_ROW_MODES.has(rowMode)) throw new Error(`AI 返回了不支持的数据行类型：${rowMode}`);

    const adapter = {
        version: 3,
        request: {
            method,
            bodyType,
            credentials: ['omit', 'same-origin'].includes(request.credentials) ? request.credentials : 'include'
        },
        auth: {
            strategy: authStrategy,
            sourceKey: ['cookieHeader', 'localStorage', 'sessionStorage', 'autoProbe'].includes(authStrategy) ? String(auth.sourceKey || '').slice(0, 160) : '',
            valuePath: ['localStorage', 'sessionStorage', 'autoProbe'].includes(authStrategy) ? normalizePath(auth.valuePath || '') : '',
            header: ['cookieHeader', 'localStorage', 'sessionStorage', 'autoProbe'].includes(authStrategy)
                ? normalizeHeaderName(auth.header || '', { allowEmpty: true })
                : '',
            prefix: ['cookieHeader', 'localStorage', 'sessionStorage', 'autoProbe'].includes(authStrategy) ? String(auth.prefix || '').slice(0, 40) : ''
        },
        pagination: {
            type: paginationType,
            requestPath: normalizePath(pagination.requestPath),
            pageSizePath: normalizePath(pagination.pageSizePath),
            nextCursorPath: normalizePath(pagination.nextCursorPath),
            hasMorePath: normalizePath(pagination.hasMorePath),
            start: paginationType === 'cursor'
                ? String(pagination.start ?? '').slice(0, 1000)
                : (Number.isFinite(Number(pagination.start))
                    ? Number(pagination.start)
                    : (paginationType === 'offset' ? 0 : 1)),
            step: Math.max(1, Number.isFinite(Number(pagination.step)) ? Number(pagination.step) : 1)
        },
        response: {
            rowsPath: normalizePath(response.rowsPath),
            totalPath: normalizePath(response.totalPath),
            rowMode
        },
        notes: Array.isArray(raw.notes) ? raw.notes.map(item => String(item).slice(0, 300)).slice(0, 8) : []
    };

    if (adapter.pagination.type !== 'none' && !adapter.pagination.requestPath) {
        throw new Error('分页适配器缺少 requestPath');
    }
    if (adapter.pagination.type === 'offset' && !adapter.pagination.pageSizePath) {
        throw new Error('offset 分页适配器缺少 pageSizePath，无法安全计算下一页偏移量');
    }
    if (adapter.pagination.type === 'cursor' && !adapter.pagination.nextCursorPath) {
        throw new Error('cursor 分页适配器缺少 nextCursorPath');
    }
    return adapter;
}

function applyAuthHint(adapter, rawHint) {
    if (rawHint && typeof rawHint === 'object') {
        const strategy = String(rawHint.strategy || 'auto');
        if (strategy !== 'auto') {
            if (!ALLOWED_AUTH_STRATEGIES.has(strategy)) throw new Error('认证提示类型无效');
            const usesStorage = strategy === 'localStorage' || strategy === 'sessionStorage';
            const usesHeaderSource = usesStorage || strategy === 'cookieHeader';
            adapter.auth = {
                strategy,
                sourceKey: usesHeaderSource ? String(rawHint.sourceKey || '').slice(0, 160) : '',
                valuePath: usesStorage ? normalizePath(rawHint.valuePath || '') : '',
                header: usesHeaderSource ? normalizeHeaderName(rawHint.header || '', { allowEmpty: true }) : '',
                prefix: usesHeaderSource ? String(rawHint.prefix || '').slice(0, 40) : ''
            };
        }
    }
    return adapter;
}

function validateAdapterAuth(adapter) {
    const auth = adapter && adapter.auth || {};
    if (['none', 'cookie'].includes(auth.strategy)) return;
    if (auth.strategy === 'autoProbe') {
        if (!auth.header) throw new Error('自动认证来源探测缺少目标请求头名');
        return;
    }
    if (!auth.sourceKey || !auth.header) {
        throw new Error('选择存储认证或 Cookie 请求头认证时必须填写来源键和请求头名');
    }
}

function scoreProbeHeader(name) {
    const lower = String(name || '').toLowerCase();
    if (!lower || lower === 'cookie' || lower === 'set-cookie') return -1;
    if (/csrf|xsrf|anti[-_]?forgery/.test(lower)) return 100;
    if (lower === 'authorization' || lower === 'proxy-authorization') return 90;
    if (/api[-_]?key/.test(lower)) return 80;
    if (/token|secret/.test(lower)) return 70;
    return SENSITIVE_HEADER_RE.test(lower) ? 40 : -1;
}

function enableRuntimeAuthProbe(adapter, headers, rawHint) {
    const hintStrategy = rawHint && typeof rawHint === 'object' ? String(rawHint.strategy || 'auto') : 'auto';
    if (hintStrategy !== 'auto') return null;
    if (['cookieHeader', 'localStorage', 'sessionStorage'].includes(adapter.auth.strategy)
        && adapter.auth.sourceKey && adapter.auth.header) return null;

    const candidates = Object.entries(headers || {})
        .map(([name, value]) => ({ name, value: String(value || ''), score: scoreProbeHeader(name) }))
        .filter(item => item.score >= 0)
        .sort((left, right) => right.score - left.score);
    const target = candidates[0];
    if (!target) return null;

    const lowerHeader = target.name.toLowerCase();
    let prefix = '';
    if (lowerHeader === 'authorization' || lowerHeader === 'proxy-authorization') {
        const schemeMatch = target.value.match(/^([A-Za-z][A-Za-z0-9._-]{1,20}\s+)/);
        prefix = schemeMatch ? schemeMatch[1] : 'Bearer ';
    }
    adapter.auth = {
        strategy: 'autoProbe',
        sourceKey: '',
        valuePath: '',
        header: normalizeHeaderName(target.name),
        prefix
    };
    const note = `敏感请求头 ${target.name} 的来源未知，生成脚本将在目标页面本地依次尝试 Cookie、localStorage、sessionStorage 和页面 Token 字段`;
    adapter.notes = [note, ...(adapter.notes || [])].slice(0, 8);
    return { header: target.name, note };
}

function normalizeRows(rows, rowMode) {
    if (!Array.isArray(rows)) return null;
    if (rowMode === 'value') {
        if (rows.some(row => row !== null && typeof row === 'object')) return null;
        return rows.map(value => ({ value }));
    }
    if (rowMode === 'array') {
        if (rows.some(row => !Array.isArray(row))) return null;
        return rows.map(row => Object.fromEntries(row.map((value, index) => [`column_${index + 1}`, value])));
    }
    if (rows.some(row => !row || Array.isArray(row) || typeof row !== 'object')) return null;
    return rows;
}

function inferRowMode(rows) {
    if (!Array.isArray(rows) || !rows.length) return '';
    if (rows.every(row => Array.isArray(row))) return 'array';
    if (rows.every(row => row && !Array.isArray(row) && typeof row === 'object')) return 'object';
    if (rows.every(row => row === null || typeof row !== 'object')) return 'value';
    return '';
}

function discoverArrayCandidates(value) {
    const candidates = [];
    const seen = new Set();
    function visit(current, path, depth) {
        if (depth > 10 || candidates.length >= 30 || current === null || current === undefined) return;
        if (Array.isArray(current)) {
            const rowMode = inferRowMode(current);
            const pathText = path.join('.');
            if (rowMode && !seen.has(pathText)) {
                seen.add(pathText);
                const fields = rowMode === 'object'
                    ? [...new Set(current.slice(0, 10).flatMap(row => Object.keys(row || {})))].slice(0, 30)
                    : [];
                candidates.push({ path: pathText, rowMode, sampleLength: current.length, fields });
            }
            current.slice(0, 3).forEach((item, index) => visit(item, path.concat(index), depth + 1));
            return;
        }
        if (typeof current === 'object') {
            Object.entries(current).slice(0, 120).forEach(([key, child]) => visit(child, path.concat(key), depth + 1));
        }
    }
    visit(value, [], 0);
    return candidates;
}

function rankArrayCandidate(candidate) {
    const path = String(candidate.path || '').toLowerCase();
    let score = candidate.rowMode === 'object' ? 30 : 12;
    score += Math.min(25, Number(candidate.sampleLength || 0));
    score += Math.min(15, Array.isArray(candidate.fields) ? candidate.fields.length : 0);
    if (/(^|\.)(data|records|record|rows|list|items|results|result|content|nodes)(\.|$)/.test(path)) score += 35;
    if (/(^|\.)(children|options|tags|labels|columns)(\.|$)/.test(path)) score -= 15;
    if (/(^|\.)\d+(\.|$)/.test(path)) score -= 8;
    return score;
}

function buildDeterministicFallbackAdapter(input) {
    const candidates = discoverArrayCandidates(input.responseSample)
        .map(candidate => ({ ...candidate, score: rankArrayCandidate(candidate) }))
        .sort((left, right) => right.score - left.score || right.sampleLength - left.sampleLength);
    const winner = candidates[0];
    if (!winner) throw new Error('AI 连续返回异常格式，且响应样本中未扫描到可导出的数据数组');
    const credentials = ['omit', 'same-origin'].includes(input.credentials) ? input.credentials : 'include';
    return {
        request: {
            method: input.method,
            bodyType: input.bodyType,
            credentials
        },
        auth: {
            strategy: credentials === 'omit' ? 'none' : 'cookie',
            sourceKey: '',
            valuePath: '',
            header: '',
            prefix: ''
        },
        pagination: {
            type: 'none',
            requestPath: '',
            pageSizePath: '',
            nextCursorPath: '',
            hasMorePath: '',
            start: 1,
            step: 1
        },
        response: {
            rowsPath: winner.path,
            totalPath: '',
            rowMode: winner.rowMode
        },
        notes: [
            'AI 连续返回异常 JSON，已使用真实响应样本的确定性扫描结果安全兜底',
            `兜底数据路径：${winner.path || '(根数组)'}；默认不分页，请核对预览后再生成`
        ]
    };
}

function validateAdapterAgainstSample(adapter, responseSample) {
    const rawRows = getAtPath(responseSample, adapter.response.rowsPath);
    if (!Array.isArray(rawRows)) {
        throw new Error(`响应路径 ${adapter.response.rowsPath || '(根节点)'} 未提取到数组`);
    }
    if (rawRows.length === 0) {
        throw new Error('响应数据数组为空，请粘贴至少包含 1 条代表性对象数据的响应样本');
    }
    const rows = normalizeRows(rawRows, adapter.response.rowMode);
    if (!rows) {
        throw new Error(`响应数组与 rowMode=${adapter.response.rowMode} 不一致，请检查对象/原始值/二维数组类型`);
    }
    const fields = [];
    rows.slice(0, 20).forEach(row => {
        if (!row || Array.isArray(row) || typeof row !== 'object') return;
        Object.keys(row).forEach(key => {
            if (!fields.includes(key) && fields.length < 100) fields.push(key);
        });
    });
    if (fields.length === 0) {
        throw new Error('响应数组不包含可导出的 JSON 对象行，请提供表格对象数组样本');
    }
    const totalValue = adapter.response.totalPath
        ? getAtPath(responseSample, adapter.response.totalPath)
        : null;
    return {
        rowCount: rows.length,
        fields,
        totalValue: totalValue === undefined ? null : totalValue,
        rowMode: adapter.response.rowMode,
        previewRows: rows.slice(0, 5)
    };
}

function correctContextPrefixedPath(path, prefixes, exists) {
    const normalized = normalizePath(path);
    if (!normalized || exists(normalized)) return normalized;
    for (const prefix of prefixes) {
        if (!normalized.startsWith(`${prefix}.`)) continue;
        const stripped = normalized.slice(prefix.length + 1);
        if (stripped && exists(stripped)) return stripped;
    }
    return normalized;
}

function correctAdapterContextPaths(adapter, parsedUrl, requestBody, responseSample) {
    const corrections = [];
    const correct = (owner, key, prefixes, exists) => {
        const before = owner[key];
        const after = correctContextPrefixedPath(before, prefixes, exists);
        if (before && after !== before) {
            owner[key] = after;
            corrections.push(`${before} → ${after}`);
        }
    };
    const requestExists = adapter.request.method === 'GET'
        ? path => parsedUrl.searchParams.has(path)
        : path => getAtPath(requestBody, path) !== undefined;
    const responseExists = path => getAtPath(responseSample, path) !== undefined;
    const requestPrefixes = adapter.request.method === 'GET'
        ? ['queryParams', 'searchParams', 'url.query', 'url.searchParams']
        : ['requestBody', 'request.body', 'body', 'payload'];
    const responsePrefixes = ['responseSample', 'response.sample'];
    correct(adapter.pagination, 'requestPath', requestPrefixes, requestExists);
    correct(adapter.pagination, 'pageSizePath', requestPrefixes, requestExists);
    correct(adapter.pagination, 'nextCursorPath', responsePrefixes, responseExists);
    correct(adapter.pagination, 'hasMorePath', responsePrefixes, responseExists);
    correct(adapter.response, 'rowsPath', responsePrefixes, responseExists);
    correct(adapter.response, 'totalPath', responsePrefixes, responseExists);
    return corrections;
}

function disablePagination(adapter, reason) {
    adapter.pagination = {
        type: 'none',
        requestPath: '',
        pageSizePath: '',
        nextCursorPath: '',
        hasMorePath: '',
        start: 1,
        step: 1
    };
    adapter.notes = [`已安全回退为不分页：${reason}`, ...(adapter.notes || [])].slice(0, 8);
    return reason;
}

function validatePaginationAgainstRequest(adapter, parsedUrl, requestBody) {
    if (!adapter.pagination || adapter.pagination.type === 'none') return '';
    const { requestPath, pageSizePath } = adapter.pagination;
    let currentValue;
    let pageSizeValue;
    if (adapter.request.method === 'GET') {
        if (adapter.pagination.type !== 'cursor' && !parsedUrl.searchParams.has(requestPath)) {
            return disablePagination(adapter, `GET 分页参数 ${requestPath} 不存在于请求 URL`);
        }
        if (pageSizePath && !parsedUrl.searchParams.has(pageSizePath)) {
            return disablePagination(adapter, `GET 分页大小参数 ${pageSizePath} 不存在于请求 URL`);
        }
        currentValue = parsedUrl.searchParams.get(requestPath);
        pageSizeValue = pageSizePath ? parsedUrl.searchParams.get(pageSizePath) : undefined;
    } else {
        currentValue = getAtPath(requestBody, requestPath);
        pageSizeValue = pageSizePath ? getAtPath(requestBody, pageSizePath) : undefined;
        if (adapter.pagination.type !== 'cursor' && currentValue === undefined) {
            return disablePagination(adapter, `POST 分页路径 ${requestPath} 不存在于请求负载`);
        }
        if (pageSizePath && pageSizeValue === undefined) {
            return disablePagination(adapter, `POST 分页大小路径 ${pageSizePath} 不存在于请求负载`);
        }
    }
    if (adapter.pagination.type === 'cursor') {
        adapter.pagination.start = currentValue === undefined || currentValue === null ? '' : String(currentValue).slice(0, 1000);
        return '';
    }
    const numericCurrent = Number(currentValue);
    if (!Number.isFinite(numericCurrent)) {
        return disablePagination(adapter, `分页参数 ${requestPath} 不是有限数字`);
    }
    adapter.pagination.start = numericCurrent;
    if (pageSizePath) {
        const numericPageSize = Number(pageSizeValue);
        if (!Number.isFinite(numericPageSize) || numericPageSize <= 0) {
            return disablePagination(adapter, `分页大小参数 ${pageSizePath} 不是大于 0 的数字`);
        }
        adapter.pagination.pageSize = numericPageSize;
        if (adapter.pagination.type === 'offset') adapter.pagination.step = numericPageSize;
    } else if (adapter.pagination.type === 'pageNumber') {
        adapter.pagination.step = 1;
    }
    return '';
}

function applyResponseFocus(adapter, focusPath) {
    const normalizedFocusPath = normalizePath(focusPath);
    if (!normalizedFocusPath) return adapter;
    adapter.response.rowsPath = joinPaths(normalizedFocusPath, adapter.response.rowsPath);
    if (adapter.response.totalPath) {
        adapter.response.totalPath = joinPaths(normalizedFocusPath, adapter.response.totalPath);
    }
    adapter.notes = [
        `已按关键词聚焦响应片段：${normalizedFocusPath}`,
        ...(adapter.notes || [])
    ].slice(0, 8);
    return adapter;
}

function buildPrompt(input) {
    return `你是 Dragon Claw 的 JSON API 抓取适配器分析器。只分析结构，不生成 JavaScript。

仅允许：
- request.method: GET 或 POST
- request.bodyType: none、json 或 form，必须与输入保持一致
- auth.strategy: none、cookie、cookieHeader、localStorage、sessionStorage、autoProbe
- pagination.type: none、pageNumber、offset、cursor
- response.rowMode: object（对象行）、value（字符串/数字等原始值）、array（二维数组）
- 所有 path 使用点号路径，例如 data.records；数组下标使用 .0，例如 data.viewer.scope_0.0.records；根数组使用空字符串

请严格返回一个 JSON 对象，结构如下：
{
  "request": {"method":"POST","bodyType":"json","credentials":"include"},
  "auth": {"strategy":"none","sourceKey":"","valuePath":"","header":"","prefix":""},
  "pagination": {"type":"none","requestPath":"","pageSizePath":"","nextCursorPath":"","hasMorePath":"","start":1,"step":1},
  "response": {"rowsPath":"data.records","totalPath":"data.total","rowMode":"object"},
  "notes": ["简短说明"]
}

规则：
1. 不得输出 Markdown、代码围栏、函数或额外字段。
2. 不得猜测或还原已脱敏的 Token、Cookie、密钥。
3. rowsPath 必须指向响应样本中的数据数组，而不是包装对象。
4. 不能可靠判断分页时使用 none，并在 notes 说明。
5. 请求头中出现认证字段时，只有能可靠判断浏览器存储键时才选择 localStorage/sessionStorage；存储值是 JSON 时用 valuePath 指向 Token。Cookie 自动随 credentials 发送时用 cookie；需要将已知 Cookie 值复制到 CSRF 请求头时用 cookieHeader，并填写 Cookie 名 sourceKey 与 header。已确认存在 Authorization/Token/CSRF 请求头、但无法可靠判断 Cookie 或浏览器存储键时，使用 autoProbe，填写原请求头名 header，sourceKey/valuePath 留空；脚本会在目标页面本地探测常见来源。
6. 输入中的样本可能已自动抽样；数组只保留了少量代表行，但字段路径仍按样本结构判断。
7. 如果 auth.strategy 是 none 或 cookie，auth.sourceKey、auth.valuePath、auth.header、auth.prefix 必须返回空字符串。cookieHeader 不使用 valuePath。autoProbe 必须填写 header，可选 prefix，sourceKey/valuePath 可留空。request.method 和 bodyType 必须与输入请求保持一致。
8. 只返回一个完整、可被 JSON.parse 解析的 JSON 对象，不要输出解释文本。
9. 不要使用 [0] 这种括号路径；数组下标必须写成 .0。
10. 如果输入里提供 responseFocus，responseSample 已经是聚焦片段；response.rowsPath 返回相对该片段的路径即可。
11. GET 的 pageNumber/offset 分页路径必须是 queryParams 中已存在的参数名；POST 的 pageNumber/offset 分页路径必须在 requestBody 中真实存在。offset 分页必须返回 pageSizePath。
12. GraphQL 的 variables.after/endCursor 或普通 API 的 nextCursor 使用 cursor：requestPath 指向请求游标，nextCursorPath 指向响应的下一游标；可选 hasMorePath 指向 hasNextPage/hasMore。初始请求没有游标字段也允许。
13. rowsPath 指向原始值数组时 rowMode=value；指向二维数组时 rowMode=array；其余对象数组使用 object。不得把单个对象误判成数组。
14. arrayCandidates 是服务端从真实样本确定性扫描出的候选数组，可优先用于核对 rowsPath 和 rowMode，但仍需结合字段语义选择用户真正要抓取的数据。
15. 所有请求路径都相对于 requestBody 或 queryParams 根节点，禁止添加 requestBody.、body.、payload.、queryParams. 前缀；响应路径相对于 responseSample 根节点，禁止添加 responseSample. 前缀。

输入：
${JSON.stringify(input, null, 2)}`;
}

function buildRepairPrompt(input, invalidOutput) {
    return `你刚才返回的适配器 JSON 不完整或不合法。请重新分析输入，并只返回一个完整、严格、可被 JSON.parse 解析的 JSON 对象。

不要输出解释，不要输出 Markdown，不要沿用不完整片段。

只能返回这个结构：
{
  "request": {"method":"POST","bodyType":"json","credentials":"include"},
  "auth": {"strategy":"none","sourceKey":"","valuePath":"","header":"","prefix":""},
  "pagination": {"type":"none","requestPath":"","pageSizePath":"","nextCursorPath":"","hasMorePath":"","start":1,"step":1},
  "response": {"rowsPath":"","totalPath":"","rowMode":"object"},
  "notes": []
}

约束：
- method 只能是 GET 或 POST
- bodyType 只能是 none、json 或 form
- auth.strategy 只能是 none、cookie、cookieHeader、localStorage、sessionStorage、autoProbe
- pagination.type 只能是 none、pageNumber、offset、cursor
- response.rowMode 只能是 object、value、array
- 如果某个字段无法从原文可靠恢复，用安全默认值
- 只返回一个完整 JSON 对象
- rowsPath 必须指向响应样本中的数据数组
- 不要使用 [0] 这种括号路径；数组下标必须写成 .0
- 如果输入里提供 responseFocus，responseSample 已经是聚焦片段；response.rowsPath 返回相对该片段的路径即可
- GET 分页路径必须来自 queryParams，POST 分页路径必须来自 requestBody；offset 分页必须提供 pageSizePath
- cursor 分页必须提供 nextCursorPath，可选 hasMorePath；初始请求游标可以不存在
- 路径禁止带 requestBody.、body.、payload.、queryParams.、responseSample. 等上下文根前缀

上次非法输出预览：
${String(invalidOutput || '').slice(0, 2000)}

输入：
${JSON.stringify(input, null, 2)}`;
}

router.post('/parse-fetch', (req, res) => {
    try {
        const parsed = parseCopyAsFetch(req.body && req.body.source);
        res.json({
            parsed,
            sensitiveHeaderNames: Object.keys(parsed.headers).filter(key => SENSITIVE_HEADER_RE.test(key))
        });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Copy as fetch 解析失败' });
    }
});

router.post('/name-script', async (req, res) => {
    try {
        const source = req.body && typeof req.body === 'object' ? req.body : {};
        const namingInput = {
            currentTitle: String(source.currentTitle || '').slice(0, 160),
            inputName: String(source.inputName || '').slice(0, 160),
            source: String(source.source || '').slice(0, 40),
            platform: String(source.platform || '').slice(0, 40),
            endpoint: String(source.endpoint || '').slice(0, 500),
            payloadKeys: Array.isArray(source.payloadKeys)
                ? source.payloadKeys.map(value => String(value).slice(0, 80)).slice(0, 80)
                : [],
            semanticValues: Array.isArray(source.semanticValues)
                ? source.semanticValues.map(value => String(value).slice(0, 160)).slice(0, 30)
                : []
        };
        if (!namingInput.currentTitle && !namingInput.endpoint && namingInput.payloadKeys.length === 0) {
            return res.status(400).json({ error: '缺少可用于命名的脚本摘要' });
        }

        const settings = await aiSettingsRepo.getRuntimeSettings();
        if (!settings.hasApiKey || !settings.keyLooksValid) {
            return res.status(503).json({ error: 'AI API Token 未配置或格式无效，请先在全局设置中配置。' });
        }

        const client = aiProviderClient.createClient(settings);
        const result = await client.generateText({
            prompt: buildScriptNamingPrompt(namingInput),
            maxOutputTokens: 256,
            temperature: 0.2,
            responseMimeType: 'application/json',
            json: true
        });
        const parsed = parseAiJson(result.text);
        const zhName = cleanGeneratedChineseName(parsed.zhName);
        const enName = cleanGeneratedEnglishName(parsed.enName);
        if (!zhName || !enName) {
            return res.status(502).json({ error: 'AI 未返回有效的中英文脚本名称' });
        }
        res.json({ zhName, enName, usage: result.usage || null });
    } catch (error) {
        console.error('[UIVF12 AI Naming] failed:', error);
        res.status(error.statusCode || error.status || 500).json({
            error: error.message || 'AI 脚本命名失败'
        });
    }
});

router.post('/analyze', async (req, res) => {
    let stage = '初始化';
    const logs = [];
    const addLog = (message, type = 'info') => {
        logs.push({ message, type });
        console.info(`[UIVF12 AI Adapter] ${message}`);
    };
    try {
        stage = '校验 URL';
        addLog('开始校验 URL 和请求方法。', 'busy');
        const url = String(req.body && req.body.url || '').trim();
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (error) {
            return res.status(400).json({ error: '请求 URL 无效' });
        }
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({ error: '仅支持 HTTP/HTTPS URL' });
        }

        const method = String(req.body.method || 'POST').toUpperCase();
        if (!ALLOWED_METHODS.has(method)) {
            return res.status(400).json({ error: '当前仅支持 GET/POST' });
        }
        const bodyType = method === 'GET' ? 'none' : String(req.body.bodyType || 'json');
        if (!ALLOWED_BODY_TYPES.has(bodyType)) {
            return res.status(400).json({ error: '请求体类型仅支持 none/json/form' });
        }
        stage = '解析输入 JSON';
        addLog('开始解析请求头、请求负载和响应样本。', 'busy');
        const headers = normalizeHeaders(req.body.headers);
        const requestBody = parseJsonValue(req.body.requestBody, '请求负载', {
            optional: method === 'GET',
            fallback: {}
        });
        const responseSample = parseJsonValue(req.body.responseSample, '响应样本');
        const secondResponseSample = parseJsonValue(req.body.secondResponseSample, '第二页响应样本', {
            optional: true,
            fallback: null
        });
        const responseFocusKeyword = String(req.body.responseFocusKeyword || '').trim().slice(0, 120);
        const responseFocusPath = normalizePath(req.body.responseFocusPath || '');
        let responseSampleForAnalysis = responseSample;
        let secondResponseSampleForAnalysis = secondResponseSample;
        if (responseFocusPath) {
            responseSampleForAnalysis = getAtPath(responseSample, responseFocusPath);
            if (responseSampleForAnalysis === undefined) {
                throw new Error(`关键词聚焦路径不存在：${responseFocusPath}`);
            }
            if (secondResponseSample) {
                const focusedSecond = getAtPath(secondResponseSample, responseFocusPath);
                secondResponseSampleForAnalysis = focusedSecond === undefined ? null : focusedSecond;
            }
            addLog(`已按关键词${responseFocusKeyword ? `“${responseFocusKeyword}”` : ''}聚焦响应片段：${responseFocusPath}`, 'ok');
        } else if (responseFocusKeyword) {
            addLog(`已收到关键词“${responseFocusKeyword}”，但未选择聚焦路径，将使用完整响应样本。`, 'info');
        }
        stage = '样本抽样脱敏';
        addLog('输入 JSON 解析完成，开始自动抽样和敏感字段脱敏。', 'busy');
        const requestBodySample = prepareAiSample(requestBody, '请求负载');
        const responseSampleForAi = prepareAiSample(responseSampleForAnalysis, responseFocusPath ? '聚焦响应样本' : '响应样本');
        const secondResponseSampleForAi = secondResponseSampleForAnalysis
            ? prepareAiSample(secondResponseSampleForAnalysis, responseFocusPath ? '聚焦第二页响应样本' : '第二页响应样本')
            : { value: null, info: null };
        addLog(`样本准备完成：${responseSampleForAi.info.label} ${responseSampleForAi.info.originalChars} → ${responseSampleForAi.info.sampledChars} 字符。`, 'ok');

        stage = '读取 AI 设置';
        addLog('正在读取 AI 配置。', 'busy');
        const settings = await aiSettingsRepo.getRuntimeSettings();
        if (!settings.hasApiKey || !settings.keyLooksValid) {
            return res.status(503).json({ error: 'AI API Token 未配置或格式无效，请先在全局设置中配置。' });
        }

        stage = '调用 AI';
        addLog('AI 配置有效，开始调用模型分析响应结构。', 'busy');
        const client = aiProviderClient.createClient(settings);
        const promptInput = {
            url: `${parsedUrl.origin}${parsedUrl.pathname}`,
            queryParams: summarizeSearchParams(parsedUrl),
            method,
            bodyType,
            headers: redactHeaders(headers),
            requestBody: requestBodySample.value,
            responseSample: responseSampleForAi.value,
            secondResponseSample: secondResponseSampleForAi.value,
            arrayCandidates: discoverArrayCandidates(responseSampleForAnalysis),
            responseFocus: responseFocusPath ? {
                keyword: responseFocusKeyword,
                path: responseFocusPath,
                note: 'responseSample 是完整响应中的聚焦片段；返回 rowsPath 时使用相对该片段的路径'
            } : null,
            sampleInfo: [
                requestBodySample.info,
                responseSampleForAi.info,
                secondResponseSampleForAi.info
            ].filter(Boolean)
        };
        const result = await client.generateText({
            prompt: buildPrompt(promptInput),
            maxOutputTokens: Math.min(Math.max(settings.maxOutputTokens || 2048, 1600), 4096),
            temperature: 0.1,
            responseMimeType: 'application/json',
            json: true
        });
        stage = '解析 AI 返回';
        addLog('AI 已返回，开始解析适配器 JSON。', 'busy');
        let adapterJson;
        let repairResult = null;
        let deterministicFallback = false;
        try {
            adapterJson = parseAiJson(result.text);
        } catch (parseError) {
            addLog('AI 返回 JSON 不完整，正在自动重新分析并要求严格 JSON。', 'busy');
            repairResult = await client.generateText({
                prompt: buildRepairPrompt(promptInput, result.text),
                maxOutputTokens: 2048,
                temperature: 0,
                responseMimeType: 'application/json',
                json: true
            });
            try {
                adapterJson = parseAiJson(repairResult.text);
                addLog('第二次 AI 返回已解析为严格 JSON。', 'ok');
            } catch (repairParseError) {
                deterministicFallback = true;
                adapterJson = buildDeterministicFallbackAdapter({
                    method,
                    bodyType,
                    credentials: req.body.credentials,
                    responseSample: responseSampleForAnalysis
                });
                addLog('AI 两次返回均存在格式错误，已切换为真实样本确定性兜底，并默认关闭分页。', 'info');
            }
        }
        const adapter = applyAuthHint(
            normalizeAdapter(adapterJson, method, bodyType),
            req.body.authHint
        );
        const runtimeAuthProbe = enableRuntimeAuthProbe(adapter, headers, req.body.authHint);
        validateAdapterAuth(adapter);
        if (runtimeAuthProbe) {
            addLog(`认证来源未知：已为 ${runtimeAuthProbe.header} 启用运行时多来源探测。`, 'info');
        }
        adapter.request.credentials = ['omit', 'same-origin'].includes(req.body.credentials) ? req.body.credentials : 'include';
        applyResponseFocus(adapter, responseFocusPath);
        const pathCorrections = correctAdapterContextPaths(adapter, parsedUrl, requestBody, responseSample);
        if (pathCorrections.length) {
            addLog(`已自动修正 AI 上下文路径前缀：${pathCorrections.join('；')}`, 'info');
            adapter.notes = [`已自动修正路径：${pathCorrections.join('；')}`, ...(adapter.notes || [])].slice(0, 8);
        }
        stage = '验证分页路径';
        addLog('正在核对 AI 分页路径与原始请求是否一致。', 'busy');
        if (req.body.paginationPolicy === 'none') {
            if (adapter.pagination.type !== 'none') disablePagination(adapter, '用户选择强制不分页');
            addLog('已按用户设置关闭分页，只抓取当前请求结果。', 'info');
        } else {
            const paginationFallbackReason = validatePaginationAgainstRequest(adapter, parsedUrl, requestBody);
            if (paginationFallbackReason) {
                addLog(`AI 分页判断无法通过真实请求校验，已回退为不分页：${paginationFallbackReason}`, 'info');
            }
        }
        stage = '验证响应路径';
        addLog('适配器 JSON 解析完成，开始用原始响应样本验证数据路径。', 'busy');
        const selectedRows = getAtPath(responseSample, adapter.response.rowsPath);
        const inferredRowMode = inferRowMode(selectedRows);
        if (inferredRowMode && adapter.response.rowMode !== inferredRowMode) {
            addLog(`AI 数据行类型已按真实样本从 ${adapter.response.rowMode} 修正为 ${inferredRowMode}。`, 'info');
            adapter.response.rowMode = inferredRowMode;
            adapter.notes = [`数据行类型已由真实样本确定性校正为 ${inferredRowMode}`, ...(adapter.notes || [])].slice(0, 8);
        }
        const validation = validateAdapterAgainstSample(adapter, responseSample);
        if (secondResponseSample) {
            const secondRows = getAtPath(secondResponseSample, adapter.response.rowsPath);
            if (!Array.isArray(secondRows)) {
                throw new Error(`第二页响应中的路径 ${adapter.response.rowsPath || '(根节点)'} 未提取到数组`);
            }
            if (secondRows.length && !normalizeRows(secondRows, adapter.response.rowMode)) {
                throw new Error('第二页响应的数据行类型与第一页不一致');
            }
            validation.secondPageRowCount = secondRows.length;
        }
        addLog(`路径验证通过：提取到 ${validation.rowCount || 0} 行数据。`, 'ok');
        const generationPlan = detectNativeGenerationPlan({
            url: parsedUrl.toString(),
            method,
            headers,
            requestBody,
            responseSample,
            adapter
        });
        if (generationPlan.mode === 'native-hybrid') {
            addLog(`匹配 ${generationPlan.profile} 成熟生成引擎，将使用现有模板 + AI 适配参数。`, 'ok');
        } else {
            addLog('未命中成熟站点模板，将使用通用受控 JSON API 生成器。', 'info');
        }

        res.json({
            adapter,
            generationPlan,
            validation,
            sanitized: {
                headers: redactHeaders(headers),
                sensitiveHeaderNames: Object.keys(headers).filter(key => SENSITIVE_HEADER_RE.test(key))
            },
            sampleInfo: promptInput.sampleInfo,
            arrayCandidates: promptInput.arrayCandidates,
            responseFocus: responseFocusPath ? {
                keyword: responseFocusKeyword,
                path: responseFocusPath
            } : null,
            logs,
            usage: result.usage || null,
            repairUsage: repairResult && repairResult.usage || null,
            deterministicFallback
        });
    } catch (error) {
        console.error(`[UIVF12 AI Adapter] analyze failed at ${stage}:`, error);
        res.status(400).json({
            error: error.message || 'AI 适配分析失败',
            stage,
            logs: logs.concat([{ message: `失败阶段：${stage}`, type: 'error' }])
        });
    }
});

module.exports = router;
