// UIVF12 专用工具：长内容分段读取，局部变更在服务端应用，不经过 Shell/JSON 二次转义。
const crypto = require('crypto');
const acorn = require('acorn');
const db = require('./app-db');
const databases = require('./agent-database-service');
const scripts = require('./uiv-scripts-repository');
const categoriesRepo = require('./uiv-categories-repository');
const siteProfiles = require('../../frontend/js/shared/uiv-site-profiles');
const { redactValue } = require('./ai-sensitive-data');

const TARGET = { database: 'platform:tools.db', table: 'uiv_scripts' };
const FIELDS = new Set(['name', 'category', 'url', 'payload', 'code', 'consoleCode', 'originalFileName',
    'configOptions', 'responseSample', 'responseFocusKeyword', 'responseFocusPath', 'responseFocusConfig']);
const CODE_FIELDS = new Set(['code', 'consoleCode', 'payload']);
const revision = raw => crypto.createHash('sha256').update(raw).digest('hex');
const fail = (message, details, code = 'AGENT_SCRIPT_INVALID') => Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
const eq = (column, value) => ({ column, op: 'eq', value });

function integrity(row, script) {
    const issues = [];
    for (const field of ['id', 'name', 'url', 'category']) if ((script[field] || '') !== (row[field] || '')) issues.push(`${field} 与数据库列不一致或缺失`);
    for (const field of ['code', 'consoleCode']) if (typeof script[field] !== 'string' || !script[field].trim()) issues.push(`缺少 ${field}`);
    return issues;
}

// 早期导入的宏脚本只有 code/consoleCode，没有 url/payload，页面照常复制使用；只提示，不阻止修改。
function notes(script) {
    const missing = ['url', 'payload'].filter(field => typeof script[field] !== 'string' || !script[field].trim());
    return missing.length ? [`旧记录没有 ${missing.join('/')}：抓取逻辑全部在 code/consoleCode 中，修改与站点迁移直接作用于代码`] : [];
}

function summary(script) {
    return { id: script.id, name: script.name, category: script.category, url: script.url,
        regionalDefaults: { code: regionalDefaults(script.code), consoleCode: regionalDefaults(script.consoleCode) },
        fields: Object.fromEntries(['code', 'consoleCode', 'payload'].map(field => [field, { characters: typeof script[field] === 'string' ? script[field].length : 0,
            siteOrigins: siteProfiles.filter(site => sitePattern(site).test(String(script[field] || ''))).map(site => site.origin) }])) };
}

function regionalDefaults(code) {
    if (typeof code !== 'string') return {};
    const values = {};
    const literal = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value
        : node?.type === 'ConditionalExpression' ? literal(node.alternate)
            : node?.type === 'LogicalExpression' ? literal(node.right) : undefined;
    const visit = node => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'VariableDeclarator' && ['targetRegion', 'targetOffice', 'generatorOffice'].includes(node.id?.name)) {
            const value = literal(node.init);
            if (value !== undefined) values[node.id.name] = value;
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    };
    try {
        let macro;
        try { macro = JSON.parse(code); } catch { /* 普通 JavaScript */ }
        if (macro && Array.isArray(macro.Commands)) {
            for (const command of macro.Commands) if (/^executeScript(?:_Sandbox)?$/i.test(command.Command || '')) Object.assign(values, regionalDefaults(command.Target));
        } else visit(acorn.parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }));
    } catch { /* 旧代码语法异常仍可读取元数据或移动分类，不推测默认值 */ }
    return values;
}

function sitePattern(site, flags = '') {
    const host = new URL(site.origin).hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`https?://${host}(?=[/\\s"'\\\\?#]|$)`, flags);
}

async function categories(ctx) {
    await databases.schema(ctx, TARGET);
    const registered = (await categoriesRepo.listCategories()).items;
    const counts = await db.all(`SELECT CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.category') END AS category,
        count(*) AS count FROM uiv_scripts GROUP BY 1`);
    return { categories: registered.map(name => ({ name, scriptCount: counts.find(row => row.category === name)?.count || 0 })),
        unlisted: counts.filter(row => !registered.includes(row.category)), siteProfiles };
}

async function canonicalCategory(value) {
    const registered = (await categoriesRepo.listCategories()).items;
    const normalized = typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
    const exact = registered.find(name => name.toLocaleLowerCase() === normalized);
    if (!exact) throw fail(`分类不存在，请使用 list_uiv_categories 返回的真实名称：${registered.join('、')}`);
    return exact;
}

function retarget(script, id) {
    const target = siteProfiles.find(site => site.id === id);
    if (!target) throw fail('targetSite 只支持 cn、ae（中东）或 de，请读取 list_uiv_categories 的站点定义');
    let source = null;
    if (script.url) {
        try { source = new URL(script.url); } catch { throw fail('原脚本请求地址无效'); }
        if (!siteProfiles.some(site => new URL(site.origin).hostname === source.hostname)) throw fail('原脚本不是已登记的 NetCare 站点，不能推测替换域名');
    } else if (!siteProfiles.some(site => ['code', 'consoleCode'].some(field => sitePattern(site).test(String(script[field] || ''))))) {
        throw fail('原脚本没有请求地址，代码中也没有已登记的 NetCare 站点地址，不能推测替换域名');
    }
    const replace = value => {
        if (typeof value === 'string') {
            let next = value;
            for (const site of siteProfiles) {
                next = next.replace(sitePattern(site, 'g'), target.origin);
            }
            return next;
        }
        if (Array.isArray(value)) return value.map(replace);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
        return value;
    };
    const next = replace(script);
    if (source) next.url = `${target.origin}${source.pathname}${source.search}${source.hash}`;
    return next;
}

async function rawScript(ctx, id) {
    if (!id || typeof id !== 'string') throw fail('请提供 list_uiv_scripts 返回的脚本 ID');
    await databases.schema(ctx, TARGET); // 校验真实业务表，拒绝同名视图/虚拟表。
    const row = await db.get('SELECT id, name, category, url, payload_json FROM uiv_scripts WHERE id = ? AND length(CAST(payload_json AS BLOB)) <= ?', [id, 8 * 1024 * 1024]);
    if (!row) throw fail('脚本不存在或超过单脚本 8MB 上限，请重新查询脚本列表', {
        id, nextTool: 'list_uiv_scripts', guidance: '先确认目标是否还存在；目标不存在时不能 rebuild，读取完整原脚本后 clone，并报告返回的新 ID。'
    }, 'AGENT_SCRIPT_NOT_FOUND');
    let script;
    try { script = JSON.parse(row.payload_json); } catch { throw fail('原脚本 payload_json 不是有效 JSON，未修改'); }
    if (!script || typeof script !== 'object' || Array.isArray(script)) throw fail('脚本 payload_json 不是对象，未修改');
    return { row, script, issues: integrity(row, script), notes: notes(script), revision: revision(row.payload_json) };
}

async function list(ctx, args = {}) {
    await databases.schema(ctx, TARGET);
    const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit)) || 20));
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    const query = String(args.query || '');
    // 页面按 payload_json.category 分组显示；按分类筛选时与页面口径一致，列与载荷不一致的旧记录也能找到。
    const category = String(args.category || '').trim();
    const rows = await db.all(`SELECT id, name, category, url, length(payload_json) AS characters,
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.category') END AS pageCategory, updated_at AS updatedAt FROM uiv_scripts
        WHERE (instr(name, ?) > 0 OR instr(COALESCE(category, ''), ?) > 0)
          AND (? = '' OR category = ? OR (json_valid(payload_json) AND json_extract(payload_json, '$.category') = ?))
        ORDER BY rowid LIMIT ? OFFSET ?`, [query, query, category, category, category, limit + 1, offset]);
    const scripts = rows.slice(0, limit).map(({ pageCategory, ...row }) => pageCategory === row.category ? row : { ...row, pageCategory });
    return redactValue({ scripts, nextOffset: rows.length > limit ? offset + limit : null }, { secrets: ctx.sensitiveValues });
}

async function read(ctx, args) {
    const source = await rawScript(ctx, args.id);
    const field = args.field || 'metadata';
    if (field !== 'metadata' && !FIELDS.has(field)) throw fail('未知脚本字段');
    const value = field === 'metadata'
        ? Object.fromEntries(Object.entries(source.script).filter(([key]) => !['code', 'consoleCode', 'payload', 'responseSample'].includes(key)))
        : source.script[field] ?? '';
    const safe = redactValue(value, { secrets: ctx.sensitiveValues });
    const text = typeof safe === 'string' ? safe : JSON.stringify(safe);
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    const limit = Math.min(8000, Math.max(1, Math.floor(Number(args.limit)) || 6000));
    return { id: args.id, revision: source.revision, integrity: source.issues, ...(source.notes.length ? { notes: source.notes } : {}), summary: redactValue(summary({ ...source.script, id: source.row.id }), { secrets: ctx.sensitiveValues }), field, content: text.slice(offset, offset + limit),
        totalCharacters: text.length, offset, nextOffset: offset + limit < text.length ? offset + limit : null,
        note: 'content 为脱敏后的字段片段，按 nextOffset 继续读取；显示的凭据遮盖不表示禁止保存。clone/rebuild 在服务端保留完整源内容，不要把脱敏片段拼回代码。语法校验接受顶层 return，不执行抓取请求。' };
}

function parseChanges(value) {
    let changes = value || {};
    if (typeof changes === 'string') {
        try { changes = JSON.parse(changes); } catch { throw fail('changes 必须为有效 JSON 对象'); }
    }
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).some(key => !FIELDS.has(key))) throw fail('changes 包含不支持的字段');
    return changes;
}

function validateCode(code, label) {
    if (typeof code !== 'string' || !code.trim()) throw fail(`${label} 不能为空`);
    try {
        let macro;
        try { macro = JSON.parse(code); } catch { /* 普通 JavaScript */ }
        if (macro && Array.isArray(macro.Commands)) {
            for (const command of macro.Commands) {
                if (/^executeScript(?:_Sandbox)?$/i.test(command.Command || '')) acorn.parse(command.Target || '', { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
            }
        } else acorn.parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
    } catch (error) { throw fail(`${label} 语法校验失败：${error.message}；未写入`); }
}

async function plan(ctx, args) {
    if (ctx.readOnly !== false) throw fail('仅管理员可修改抓取脚本');
    if (!['create', 'clone', 'update', 'rebuild', 'delete'].includes(args.action)) throw fail('action 必须为 create、clone、update、rebuild 或 delete');
    const source = args.action === 'create' ? null : await rawScript(ctx, args.action === 'clone' ? args.sourceId : args.id);
    if (source && (!args.expectedRevision || args.expectedRevision !== source.revision)) throw fail('脚本版本已变化或缺少 expectedRevision，请重新读取并核对后再修改');
    if (args.action === 'delete') return { source, id: args.id };
    let baseSource = source;
    if (args.action === 'rebuild') {
        if (!args.sourceId || args.sourceId === args.id) throw fail('重建必须指定另一个完整原脚本 sourceId；先补齐原脚本，不要改为删除后克隆', {
            required: ['id', 'expectedRevision', 'sourceId', 'expectedSourceRevision'],
            nextTools: ['list_uiv_scripts', 'read_uiv_script'],
            guidance: 'id/expectedRevision 来自坏副本；sourceId/expectedSourceRevision 来自完整原脚本的 metadata。目标仍存在时保持其 ID，用 rebuild 原位修复。'
        }, 'AGENT_SCRIPT_REBUILD_SOURCE_REQUIRED');
        baseSource = await rawScript(ctx, args.sourceId);
        if (!args.expectedSourceRevision || args.expectedSourceRevision !== baseSource.revision) throw fail('原脚本版本已变化或缺少 expectedSourceRevision，请重新读取');
    }
    if (baseSource?.issues.length) throw fail(`原脚本不完整：${baseSource.issues.join('；')}。不要用残缺片段继续改写；请定位完整源脚本重新复制，或在用户授权后用 rebuild 重建坏副本。仅移动分类可用 move_uiv_script。`);
    const changes = parseChanges(args.changes);
    if (['clone', 'rebuild'].includes(args.action) && ['code', 'consoleCode'].some(field => Object.hasOwn(changes, field))) throw fail('复制/重建必须保留完整原脚本，不能用 changes 覆盖 code/consoleCode；请使用 targetSite 或 replacements');
    for (const [field, value] of Object.entries(changes)) {
        if (field === 'configOptions' || field === 'responseFocusConfig') {
            if ((value === null && field === 'configOptions') || (value !== null && (typeof value !== 'object' || Array.isArray(value)))) throw fail(`${field} 必须是配置对象`);
        } else if (typeof value !== 'string') throw fail(`${field} 必须是字符串`);
    }
    let next = { ...(baseSource?.script || {}), ...(args.action === 'rebuild' ? { name: source.row.name, category: source.row.category,
        createdAt: source.script.createdAt || baseSource.script.createdAt } : {}), ...changes };
    if (changes.configOptions) next.configOptions = { ...baseSource?.script.configOptions, ...changes.configOptions };
    if (args.action === 'clone' && (!changes.name || changes.name === source.script.name)) throw fail('复制脚本需要不同的新名称');
    if (!Array.isArray(args.replacements || []) || (args.replacements || []).length > 30) throw fail('replacements 必须是最多 30 项的数组');
    for (const item of args.replacements || []) {
        if (!item || !CODE_FIELDS.has(item.field) || typeof item.oldText !== 'string' || !item.oldText || typeof item.newText !== 'string'
            || !Number.isInteger(item.expectedOccurrences) || item.expectedOccurrences < 1) throw fail('替换需要 field、非空 oldText、newText 和 expectedOccurrences');
        if (/\[REDACTED\]/.test(item.oldText + item.newText)) throw fail('不能把读取时的脱敏占位写回脚本；复制/重建请使用源 ID，服务端会保留完整原文');
        const text = next[item.field];
        if (typeof text !== 'string') throw fail('替换字段不是字符串');
        const parts = text.split(item.oldText);
        if (parts.length - 1 !== item.expectedOccurrences) throw fail(`替换 ${item.field} 的实际匹配次数与预期不符，未修改`);
        next[item.field] = parts.join(item.newText);
    }
    if (typeof next.name !== 'string' || !next.name.trim()) throw fail('name 不能为空');
    next.name = next.name.trim();
    if (baseSource && next.name !== baseSource.script.name) {
        for (const field of ['code', 'consoleCode']) if (next[field]) next[field] = scripts.updateCodeArtifacts(next[field], baseSource.script.name, next.name,
            scripts.computeOutputFileName(baseSource.script.name), scripts.computeOutputFileName(next.name));
        next.originalFileName = next.name;
    }
    if (args.targetSite) {
        next = retarget(next, args.targetSite);
        if (!Object.hasOwn(changes, 'category')) next.category = siteProfiles.find(site => site.id === args.targetSite).category;
    }
    next.category = await canonicalCategory(next.category || '默认分类');
    if (args.action === 'update' && !args.allowCodeRewrite && ['code', 'consoleCode'].some(field => Object.hasOwn(changes, field)
        && source.script[field].length > 2000 && next[field].length < source.script[field].length / 2)) throw fail('完整代码被大幅缩短，可能用示例替代了原逻辑；请使用 replacements，用户明确要求整体重写时才传 allowCodeRewrite=true');
    // 新建脚本与页面生成一致必须带请求地址和请求体；旧宏脚本缺这两项时保持缺省，不强行补造。
    const legacy = baseSource && notes(baseSource.script).length;
    if (next.url || !legacy) {
        try {
            const url = new URL(next.url);
            if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
        } catch { throw fail('url 必须是无凭据的 HTTP(S) 请求地址'); }
    }
    if (next.payload || !legacy) {
        try { if (typeof next.payload !== 'string') throw new Error(); JSON.parse(next.payload); } catch { throw fail('payload 必须是有效的请求 JSON 字符串'); }
    }
    validateCode(next.code, 'code');
    validateCode(next.consoleCode, 'consoleCode');
    next.id = ['update', 'rebuild'].includes(args.action) ? source.row.id : `script_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const duplicate = await db.get('SELECT id, payload_json FROM uiv_scripts WHERE name = ? AND id != ?', [next.name, next.id]);
    if (duplicate) throw fail('已有同名脚本，不能先删除再克隆；修复此副本请用 rebuild，另建独立副本才换名称', {
        existingId: duplicate.id, existingRevision: revision(duplicate.payload_json), nextAction: 'rebuild',
        ...(baseSource ? { suggestedCall: { action: 'rebuild', id: duplicate.id, expectedRevision: revision(duplicate.payload_json),
            sourceId: baseSource.row.id, expectedSourceRevision: baseSource.revision, ...(args.targetSite ? { targetSite: args.targetSite } : {}) } } : {}),
        guidance: '读取并核对 existingId 后，在用户当前修复范围内按 suggestedCall 原位重建；本次尚未写入，不删除旧记录。'
    }, 'AGENT_SCRIPT_NAME_CONFLICT');
    next.updatedAt = new Date().toISOString();
    if (!['update', 'rebuild'].includes(args.action)) next.createdAt = next.updatedAt;
    if (/\[REDACTED\]/.test(JSON.stringify(changes))) throw fail('不能保存脱敏占位内容');
    return { source, baseSource, next, id: next.id };
}

// 批量移动逐项校验版本、逐项提交；单项失败不影响其余项，结果逐项报告。
async function move(ctx, args = {}, previewOnly = false) {
    if (!Array.isArray(args.items)) return moveOne(ctx, args, previewOnly);
    if (ctx.readOnly !== false) throw fail('仅管理员可移动抓取脚本');
    if (args.id) throw fail('单个移动用 id，批量移动用 items，二者不能同时提供');
    if (!args.items.length || args.items.length > 50) throw fail('items 需为 1–50 个 {id, expectedRevision}');
    if (new Set(args.items.map(item => item?.id)).size !== args.items.length) throw fail('items 中有重复脚本');
    const category = await canonicalCategory(args.category);
    if (previewOnly) {
        const rows = [];
        for (const item of args.items) {
            const source = await rawScript(ctx, item?.id);
            if (!item.expectedRevision || item.expectedRevision !== source.revision) throw fail(`脚本 ${item.id} 版本已变化或缺少 expectedRevision，请重新读取`);
            rows.push({ id: item.id, name: source.row.name, from: source.row.category });
        }
        return { path: `uiv_scripts / ${rows.length} 个脚本`, diff: JSON.stringify({ to: category, scripts: rows,
            note: '逐项同步列和 payload_json.category，不修改代码、站点或地区参数。' }, null, 2) };
    }
    const results = [];
    for (const item of args.items) {
        try { results.push(await moveOne(ctx, { ...item, category })); }
        catch (error) {
            if (error.name === 'AbortError') throw error;
            results.push({ id: item?.id, verified: false, error: error.message });
        }
    }
    const moved = results.filter(item => item.verified).length;
    return { action: 'move', category, moved, failed: results.length - moved, verified: moved === results.length, results };
}

async function moveOne(ctx, args, previewOnly = false) {
    if (ctx.readOnly !== false) throw fail('仅管理员可移动抓取脚本');
    const source = await rawScript(ctx, args.id);
    if (!args.expectedRevision || args.expectedRevision !== source.revision) throw fail('脚本版本已变化或缺少 expectedRevision，请重新读取');
    const category = await canonicalCategory(args.category);
    if (previewOnly) return { path: `uiv_scripts / ${source.row.name}`, diff: JSON.stringify({ from: source.row.category, to: category,
        note: '同时更新列和 payload_json.category，不修改代码、站点或地区参数；不因旧脚本语法错误阻止移动。' }, null, 2) };
    if (ctx.signal?.aborted) throw Object.assign(new Error('任务已中止'), { name: 'AbortError' });
    const result = await scripts.moveScriptCategory(args.id, category, { expectedRevision: args.expectedRevision });
    if (!result) throw fail('脚本不存在');
    const { moveVerification, ...script } = result;
    const current = await rawScript(ctx, args.id);
    return { id: args.id, action: 'move', name: script.name, category: script.category, ...moveVerification,
        integrity: current.issues, ready: current.issues.length === 0,
        validation: '分类列与页面读取的载荷已回读核对；不代表原脚本可运行' };
}

// 分类即页面左侧的脚本目录。内置分类与三区生成/站点定义绑定，只允许管理自定义分类；
// 改名同步脚本列与页面载荷，删除不级联删脚本（页面删除会连脚本一起删，AI 必须先移走或逐个删除）。
const CATEGORY_MATCH = `(category = ? OR (json_valid(payload_json) AND json_extract(payload_json, '$.category') = ?))`;

async function categoryPlan(ctx, args) {
    if (ctx.readOnly !== false) throw fail('仅管理员可管理脚本分类');
    if (!['create', 'rename', 'delete'].includes(args.action)) throw fail('action 必须为 create、rename 或 delete');
    const { categories: registered } = await categories(ctx);
    const find = value => {
        const normalized = typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
        return normalized ? registered.find(item => item.name.toLocaleLowerCase() === normalized) : undefined;
    };
    const validName = value => {
        const name = typeof value === 'string' ? value.trim() : '';
        if (!name || name.length > 60 || /[\u0000-\u001f\u007f/\\]/.test(name)) throw fail('分类名需为 1–60 个字符，不含控制字符或斜杠');
        return name;
    };
    if (args.action === 'create') {
        const name = validName(args.name);
        if (find(name)) throw fail(`分类「${find(name).name}」已存在`);
        return { action: 'create', name };
    }
    const current = find(args.name);
    if (!current) throw fail(`分类不存在，请使用 list_uiv_categories 返回的真实名称：${registered.map(item => item.name).join('、')}`);
    if (categoriesRepo.DEFAULT_CATEGORIES.includes(current.name)) throw fail(`「${current.name}」是内置分类，与三区生成和站点定义绑定，不能改名或删除`);
    if (!Number.isInteger(args.expectedScriptCount) || args.expectedScriptCount !== current.scriptCount) {
        throw fail(`分类当前有 ${current.scriptCount} 个脚本，expectedScriptCount 缺失或不一致；请重新 list_uiv_categories 核对后再操作`);
    }
    if (args.action === 'rename') {
        const newName = validName(args.newName);
        const clash = find(newName);
        if (clash && clash.name !== current.name) throw fail(`分类「${clash.name}」已存在；合并分类请用 move_uiv_script 批量移动后删除旧分类`);
        if (newName === current.name) throw fail('新名称与原名称相同');
        return { action: 'rename', name: current.name, newName, scriptCount: current.scriptCount };
    }
    let moveTo = null;
    if (current.scriptCount > 0) {
        if (!args.moveScriptsTo) throw fail(`分类下还有 ${current.scriptCount} 个脚本：传 moveScriptsTo 先整体移到其他分类，或按用户要求逐个 delete_uiv_script 后再删除分类`);
        moveTo = await canonicalCategory(args.moveScriptsTo);
        if (moveTo === current.name) throw fail('moveScriptsTo 不能是被删除的分类本身');
    }
    return { action: 'delete', name: current.name, scriptCount: current.scriptCount, moveScriptsTo: moveTo };
}

async function manageCategory(ctx, args = {}, previewOnly = false) {
    const planned = await categoryPlan(ctx, args);
    if (previewOnly) return { path: `uiv_categories / ${planned.name}`, diff: JSON.stringify({ ...planned,
        note: planned.action === 'create' ? '新增空分类' : '在同一事务内核对脚本数量后同步分类表、脚本 category 列和 payload_json.category；不修改代码、站点或地区参数，不删除脚本。' }, null, 2) };
    if (ctx.signal?.aborted) throw Object.assign(new Error('任务已中止'), { name: 'AbortError' });
    const target = planned.action === 'rename' ? planned.newName : planned.moveScriptsTo;
    const result = await databases.transaction(ctx, TARGET.database, async (all, run) => {
        if (planned.action === 'create') {
            await run('INSERT INTO uiv_categories (name, is_default) VALUES (?, 0)', [planned.name]);
            return { movedScripts: 0 };
        }
        const [{ count }] = await all(`SELECT count(*) AS count FROM uiv_scripts WHERE ${CATEGORY_MATCH}`, [planned.name, planned.name]);
        if (count !== planned.scriptCount) throw fail('分类下脚本数量已变化，本次未修改；请重新读取');
        let movedScripts = 0;
        if (target) {
            movedScripts = (await run(`UPDATE uiv_scripts SET category = ?, payload_json = CASE WHEN json_valid(payload_json)
                THEN json_set(payload_json, '$.category', ?, '$.updatedAt', ?) ELSE payload_json END, updated_at = CURRENT_TIMESTAMP
                WHERE ${CATEGORY_MATCH}`, [target, target, new Date().toISOString(), planned.name, planned.name])).changes;
        }
        const changed = planned.action === 'rename'
            ? await run('UPDATE uiv_categories SET name = ? WHERE name = ? AND is_default = 0', [planned.newName, planned.name])
            : await run('DELETE FROM uiv_categories WHERE name = ? AND is_default = 0', [planned.name]);
        if (changed.changes !== 1) throw fail('分类已被并发修改，本次未修改');
        return { movedScripts };
    });
    const after = await categories(ctx);
    const names = after.categories.map(item => item.name);
    const left = after.categories.find(item => item.name === planned.name) || after.unlisted.find(item => item.category === planned.name);
    const verified = planned.action === 'create' ? names.includes(planned.name)
        : !names.includes(planned.name) && !left && (planned.action === 'delete' || names.includes(planned.newName));
    return { action: planned.action, category: planned.newName || planned.name, ...(planned.action !== 'create' ? { previousName: planned.name } : {}),
        ...(target ? { scriptsMovedTo: target } : {}), movedScripts: result.movedScripts, committed: true, verified,
        categories: after.categories, validation: '分类表与页面分组口径已回读核对；不修改脚本代码' };
}

async function preview(ctx, args) {
    const result = await plan(ctx, args);
    return { path: `platform:tools.db / uiv_scripts / ${result.source?.row.name || result.next?.name || args.id}`,
        diff: JSON.stringify(redactValue({ action: args.action, name: result.next?.name, targetSite: args.targetSite, category: result.next?.category, changes: args.changes,
            replacements: args.replacements, note: '提交前校验版本、JSON 和 JavaScript 语法；不执行抓取请求。' }, { secrets: ctx.sensitiveValues }), null, 2) };
}

// 授权来自服务端传入的用户消息，模型不能把“修复/同名冲突”自行扩展成删除。
function assertDeletionRequested(ctx) {
    const clean = value => String(value || '').replace(/```[\s\S]*?```/g, '')
        .split(/\r?\n/).filter(line => !/^\s*>/.test(line) && !/[✓✗]/.test(line)).join('\n').trim();
    const confirmation = /^(?:好(?:的)?|确认|同意|执行(?:吧)?|继续|可以|go ahead|yes|confirm)[。.!！\s]*$/i;
    let question = clean(ctx.currentUserMessage);
    if (confirmation.test(question)) question = [...(Array.isArray(ctx.userMessages) ? ctx.userMessages : [])].reverse().map(clean)
        .find(text => text && !confirmation.test(text)) || '';
    const lines = question.split(/[\r\n，,。;；]+/).map(line => line.trim().replace(/^[*-]\s+/, ''));
    const deny = /不要删|不(?:用|得|能|要)删除|别删|不删|do not (?:delete|remove)|don't (?:delete|remove)/i;
    const requested = lines.filter(line => !deny.test(line)).some(line => /^(?:(?:请|帮我|麻烦|现在|直接|先|再|然后|确认|同意|允许|我要|我想|需要)\s*)*(?:删除|删掉|移除|清理)(?:\s*$|.{0,160}(?:脚本|副本|旧记录|它|script_))/i.test(line)
        || /^(?:(?:请|帮我|麻烦|现在|直接)\s*)*(?:把|将).{0,160}(?:脚本|副本|旧记录|它|script_).{0,160}(?:删除|删掉|移除|清理)/i.test(line)
        || /^(?:please\s+)?(?:delete|remove)\s+.{0,160}(?:script|copy|it|script_)/i.test(line)
        || /(?:允许|同意|可以先|可先).{0,12}(?:删除|删掉).{0,120}(?:脚本|副本)/.test(line));
    if (!requested) throw fail('当前用户没有要求删除脚本；修复、重建或同名冲突不能改成先删后建。请补齐 rebuild 的源 ID/版本，目标不存在时再 clone。', {
        nextAction: 'rebuild', destructiveFallbackAllowed: false,
        guidance: '保留现有脚本，读取完整原脚本 metadata 后按错误列出的参数重试；无需再次向用户索取已授权的重建许可。'
    }, 'AGENT_SCRIPT_DELETE_NOT_REQUESTED');
}

async function save(ctx, args) {
    if (ctx.signal?.aborted) throw Object.assign(new Error('任务已中止'), { name: 'AbortError' });
    const { source, baseSource, next, id } = await plan(ctx, args);
    const operation = args.action === 'delete' ? 'delete' : ['update', 'rebuild'].includes(args.action) ? 'update' : 'insert';
    const result = await databases.writeTable(ctx, { ...TARGET, operation, maxAffectedRows: 1,
        ...(next ? { values: { id, name: next.name, category: next.category || '', url: next.url || '',
            payload_json: JSON.stringify(next), updated_at: next.updatedAt } } : {}),
        filters: operation === 'insert' ? [] : [eq('id', id), eq('payload_json', source.row.payload_json)] }, { scriptContent: true });
    if (result.changes !== 1) throw fail('脚本已被并发修改，本次未写入，请重新读取');
    const stored = await db.get('SELECT payload_json FROM uiv_scripts WHERE id = ?', [id]);
    const verified = next ? stored?.payload_json === JSON.stringify(next) : !stored;
    let ruleSync;
    if (operation === 'update' && source.row.name !== next.name) ruleSync = await scripts.syncRulesOnScriptRename(source.row.name, next.name);
    return { id, action: args.action, name: next?.name || source.row.name, committed: true, verified,
        ...(next ? { summary: summary(next), sourceId: baseSource?.row.id } : {}),
        ...(stored ? { revision: revision(stored.payload_json) } : {}), ...(ruleSync ? { ruleSync } : {}),
        validation: next ? 'JSON 与 JavaScript 语法已校验；未执行真实站点抓取' : '删除后已回读核对' };
}

// 仅纠正“承诺执行但停在说明”的一轮；不把查询、方案或已完成的修改再执行一遍。
function shouldContinue({ question, text, toolLog }) {
    if (/修复|重建|重新做|重新制作|恢复/.test(question || '') && !/只(?:看|分析)|先.*方案/.test(question || '')
        && /脚本框架|自行保存|手动保存|分段提供|绕过.{0,10}拦截/.test(text || '')
        && !toolLog.some(item => item.ok && item.tool === 'save_uiv_script')) return true;
    if (/已(?:成功)?(?:还原|写入|保存|创建|更新|移动|修复)|已部署|现已就绪/.test(text || '')
        && !toolLog.some(item => item.ok && /^(?:read_uiv_script|save_uiv_script|move_uiv_script|delete_uiv_script|manage_uiv_category)$/.test(item.tool))) return true;
    return /复制|新增|新建|修改|更改|删除|保存|写入|入库|改名|重命名|\b(?:clone|create|update|delete|save|rename)\b/i.test(question || '')
        && !/不要|别改|只读|只看|只分析|仅分析|先.*(?:方案|分析)|\b(?:read.only|do not|plan only)\b/i.test(question || '')
        && !toolLog.some(item => item.ok && /^(?:save_uiv_script|move_uiv_script|delete_uiv_script|manage_uiv_category|insert_database_row|update_database_rows|delete_database_rows)$/.test(item.tool))
        && /可(?:以|直接)?.{0,12}(?:保存|写入|入库)|(?:我将|我会|准备|接下来|下一步).{0,30}(?:保存|写入|入库|复制|修改)|\b(?:I will|ready to save|can be saved)\b/i.test(text || '');
}

module.exports = { list, read, preview, save, move, manageCategory, categories, shouldContinue, assertDeletionRequested };
