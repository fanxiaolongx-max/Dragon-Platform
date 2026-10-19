const crypto = require('crypto');
const repo = require('./datacom-knowledge-repository');
const aiSettingsRepo = require('./ai-settings-repository');
const aiProviderClient = require('./ai-provider-client');
const { redactText } = require('./ai-sensitive-data');

// 数通协议专家的 AI 问答 / 笔记 / 改写。复用平台“AI 模型配置”，问答与笔记保存在 datacom-knowledge.db。
const { readyConnection, transaction, checkpoint, run, get, all, parseJson, knowledgeError, normalizeId } = repo.database;
const KINDS = new Set(['qa', 'note', 'rewrite']);
const TARGETS = new Set(['text', 'visual', 'block', 'article']);
const FIELDS = new Set(['body', 'summary', 'keyPoints']);
const META_MARK = '<<<META>>>';
const readiness = new WeakMap();

async function ready() {
    const connection = await readyConnection();
    if (!readiness.has(connection)) {
        readiness.set(connection, (async () => {
            await run(connection, `CREATE TABLE IF NOT EXISTS dk_annotations (
                id TEXT PRIMARY KEY, article_id TEXT, visual_id TEXT, target_type TEXT NOT NULL, anchor_json TEXT NOT NULL DEFAULT '{}',
                kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', brief TEXT NOT NULL DEFAULT '', quote TEXT NOT NULL DEFAULT '',
                turns_json TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0
            )`);
            await run(connection, 'CREATE INDEX IF NOT EXISTS idx_dk_annotations_article ON dk_annotations(article_id, deleted, updated_at)');
            await run(connection, 'CREATE INDEX IF NOT EXISTS idx_dk_annotations_visual ON dk_annotations(visual_id, deleted, updated_at)');
        })().catch(error => { readiness.delete(connection); throw error; }));
    }
    await readiness.get(connection);
    return connection;
}

const text = (value, max) => String(value ?? '').slice(0, max);
const nowIso = () => new Date().toISOString();

function unpack(row) {
    return {
        id: row.id, articleId: row.article_id, visualId: row.visual_id, targetType: row.target_type, anchor: parseJson(row.anchor_json, {}),
        kind: row.kind, title: row.title, brief: row.brief, quote: row.quote, turns: parseJson(row.turns_json, []),
        createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at
    };
}

// 锚点只保留已知字段并限制长度，防止把任意大对象写进库
function normalizeAnchor(input = {}) {
    const type = TARGETS.has(input.type) ? input.type : 'article';
    const anchor = { type };
    if (type === 'text') {
        anchor.field = FIELDS.has(input.field) ? input.field : 'body';
        anchor.exact = text(input.exact, 4000).trim();
        anchor.prefix = text(input.prefix, 80);
        anchor.suffix = text(input.suffix, 80);
        anchor.heading = text(input.heading, 120);
        if (!anchor.exact) throw knowledgeError('缺少选中的文字');
    } else if (type === 'visual') {
        anchor.visualId = normalizeId(input.visualId, '可视化 ID');
        anchor.partId = text(input.partId, 80);
        anchor.partName = text(input.partName, 120);
        anchor.stepTitle = text(input.stepTitle, 120);
        anchor.t = Number.isFinite(Number(input.t)) ? Math.min(1, Math.max(0, Number(input.t))) : 0;
        anchor.options = input.options && typeof input.options === 'object' && !Array.isArray(input.options)
            ? Object.fromEntries(Object.entries(input.options).slice(0, 10).map(([key, value]) => [text(key, 40), typeof value === 'number' ? value : text(value, 60)]))
            : {};
    } else if (type === 'block') {
        anchor.block = ['mermaid', 'code', 'table', 'image'].includes(input.block) ? input.block : 'code';
        anchor.index = Number.isSafeInteger(Number(input.index)) ? Number(input.index) : 0;
        anchor.snippet = text(input.snippet, 200);
        anchor.heading = text(input.heading, 120);
    }
    return anchor;
}

// ---------------- Markdown 源码定位：页面选中的是渲染后的文字，需映射回 Markdown 原文位置 ----------------
function strippedMap(markdown) {
    const chars = [];
    const map = [];
    let lastSpace = true;
    for (let i = 0; i < markdown.length; i += 1) {
        const ch = markdown[i];
        if (ch === '*' || ch === '`' || ch === '\\') continue;
        if ((ch === '[' && markdown[i + 1] === '[') || (ch === ']' && markdown[i + 1] === ']')) { i += 1; continue; }
        if (/\s/.test(ch)) {
            if (!lastSpace) { chars.push(' '); map.push(i); lastSpace = true; }
            continue;
        }
        lastSpace = false;
        chars.push(ch);
        map.push(i);
    }
    return { text: chars.join(''), map };
}

const squash = value => String(value || '').replace(/[*`\\]/g, '').replace(/\s+/g, ' ').trim();

function locateQuote(markdown, { exact, prefix = '', suffix = '' }) {
    const source = String(markdown || '');
    const needle = squash(exact);
    if (!needle) return null;
    const { text: haystack, map } = strippedMap(source);
    const hits = [];
    for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) hits.push(index);
    if (!hits.length) return null;
    const before = squash(prefix);
    const after = squash(suffix);
    const overlap = (a, b, fromEnd) => {
        let n = 0;
        while (n < a.length && n < b.length && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n += 1;
        return n;
    };
    const best = hits.map(index => ({
        index,
        score: overlap(haystack.slice(Math.max(0, index - before.length), index).trimEnd(), before, true)
            + overlap(haystack.slice(index + needle.length).trimStart(), after, false)
    })).sort((a, b) => b.score - a.score)[0];
    const start = map[best.index];
    const end = map[best.index + needle.length - 1] + 1;
    return { start, end, original: source.slice(start, end), matches: hits.length };
}

// 选中文字所在的整节（上一个标题到下一个同级或更高级标题），作为 AI 的上下文
function sectionAround(markdown, position, limit = 6000) {
    const lines = String(markdown || '').split('\n');
    const offsets = [];
    let offset = 0;
    lines.forEach(line => { offsets.push(offset); offset += line.length + 1; });
    let lineIndex = offsets.findIndex((value, index) => index === lines.length - 1 || offsets[index + 1] > position);
    if (lineIndex < 0) lineIndex = 0;
    let start = lineIndex;
    let level = 7;
    for (; start > 0; start -= 1) {
        const match = /^(#{1,4})\s/.exec(lines[start]);
        if (match) { level = match[1].length; break; }
    }
    let end = lineIndex + 1;
    for (; end < lines.length; end += 1) {
        const match = /^(#{1,4})\s/.exec(lines[end]);
        if (match && match[1].length <= level) break;
    }
    const section = lines.slice(start, end).join('\n');
    if (section.length <= limit) return section;
    const local = Math.max(0, position - offsets[start]);
    return section.slice(Math.max(0, local - limit / 2), local + limit / 2);
}

function fieldSource(article, field) {
    if (field === 'summary') return article.summary;
    if (field === 'keyPoints') return article.keyPoints.join('\n');
    return article.bodyMd;
}

// ---------------- 提示词 ----------------
const BASE_PROMPT = `你是“数通协议专家”知识库里的 AI 助教，精通 OSPF、IS-IS、BGP、MPLS/L3VPN、SR，以及华为 VRP、Juniper Junos、Cisco 的实现差异。
要求：
1. 使用简体中文，专业、准确、简洁；术语保留英文原文（如 LSA、DR、P-bit）。
2. 优先依据给定的“知识库上下文”；上下文没有依据的部分要明确标注“（通用知识，原笔记未提及）”；不确定的地方直说，不要编造 RFC 章节号或命令。
3. 使用 Markdown 排版，可以用列表、表格和代码块。
4. 在全部内容结束后，另起一行只输出 ${META_MARK}，再下一行输出一行 JSON：{"title":"不超过 16 个字的精炼标题","brief":"不超过 60 个字的一句话要点"}。`;

const MODE_PROMPT = {
    qa: '任务：回答用户针对选中内容的问题。先给结论，再解释原因，必要时举例或对比厂商差异。',
    note: '任务：把选中的内容整理成一条学习笔记，包括“核心结论”“关键细节”“易错点”，可以附一个记忆技巧；总长度控制在 300 字以内。如果用户给了关注点，围绕关注点整理。',
    rewrite: '任务：改写给定的 Markdown 原文片段，使表述更准确、清晰、易懂。保留原有的 Markdown 语法（加粗、行内代码、列表）与全部技术事实，不要扩写成长文。只输出改写后的片段本身，不要任何解释或前后缀；META 的 brief 用一句话说明改了什么。'
};

function buildPrompt({ mode, question, quote, anchor, article, section, visualContext, history }) {
    const parts = [];
    if (article) parts.push(`## 当前文章\n标题：${article.title}\n摘要：${article.summary || '（无）'}`);
    if (section) parts.push(`## 知识库上下文（选中内容所在章节）\n${section}`);
    if (visualContext) parts.push(`## 当前可视化组件\n${visualContext}`);
    if (anchor.type === 'block' && anchor.heading) parts.push(`所在章节：${anchor.heading}`);
    if (quote) parts.push(`## ${mode === 'rewrite' ? '需要改写的 Markdown 原文' : '用户选中的内容'}\n${quote}`);
    if (history.length) parts.push(`## 之前的问答\n${history.map((turn, index) => `Q${index + 1}：${turn.q || '（整理笔记）'}\nA${index + 1}：${String(turn.a).slice(0, 1500)}`).join('\n\n')}`);
    const ask = question || { qa: '请解释这段内容。', note: '请整理成学习笔记。', rewrite: '请改写得更清晰准确。' }[mode];
    parts.push(`## ${mode === 'qa' ? '用户的问题' : '用户的要求'}\n${ask}`);
    return redactText(parts.join('\n\n')).slice(0, 24000);
}

function splitMeta(raw, fallbackTitle) {
    const value = String(raw || '');
    const index = value.lastIndexOf(META_MARK);
    const body = (index >= 0 ? value.slice(0, index) : value).trim();
    let meta = {};
    if (index >= 0) {
        const json = value.slice(index + META_MARK.length).replace(/```(?:json)?/g, '').trim();
        try { meta = JSON.parse(json.slice(json.indexOf('{'), json.lastIndexOf('}') + 1)); } catch (_) { meta = {}; }
    }
    const plain = body.replace(/[#>*`|_-]/g, ' ').replace(/\s+/g, ' ').trim();
    return {
        body,
        title: text(meta.title, 40).trim() || text(fallbackTitle || plain, 16) || 'AI 问答',
        brief: text(meta.brief, 160).trim() || `${plain.slice(0, 60)}${plain.length > 60 ? '…' : ''}`
    };
}

async function aiStatus() {
    const settings = await aiSettingsRepo.getRuntimeSettings();
    return { available: Boolean(settings.hasApiKey && settings.keyLooksValid), provider: settings.provider || '', model: settings.model || '' };
}

// ---------------- 读写 ----------------
async function listAnnotations({ articleId, visualId, scope }) {
    const connection = await ready();
    let rows;
    if (scope === 'all') rows = await all(connection, 'SELECT * FROM dk_annotations WHERE deleted = 0 ORDER BY updated_at DESC LIMIT 500');
    else if (articleId) rows = await all(connection, 'SELECT * FROM dk_annotations WHERE deleted = 0 AND article_id = ? ORDER BY updated_at DESC', [normalizeId(articleId, '文章 ID')]);
    else if (visualId) rows = await all(connection, 'SELECT * FROM dk_annotations WHERE deleted = 0 AND visual_id = ? ORDER BY updated_at DESC', [normalizeId(visualId, '可视化 ID')]);
    else rows = [];
    return rows.map(unpack);
}

async function getAnnotation(id) {
    const connection = await ready();
    const row = await get(connection, 'SELECT * FROM dk_annotations WHERE id = ? AND deleted = 0', [text(id, 64)]);
    if (!row) throw knowledgeError('问答或笔记不存在', 404, 'DATACOM_NOT_FOUND');
    return unpack(row);
}

function assertOwner(annotation, user) {
    if (user?.role !== 'admin' && annotation.createdBy !== user?.username) throw knowledgeError('只能修改自己的问答或笔记', 403, 'DATACOM_FORBIDDEN');
}

async function saveAnnotation({ id = null, articleId, anchor, kind, quote, title, brief, turn, actor }) {
    const connection = await ready();
    const stamp = nowIso();
    const result = await transaction(connection, async () => {
        if (id) {
            const row = await get(connection, 'SELECT * FROM dk_annotations WHERE id = ? AND deleted = 0', [id]);
            if (!row) throw knowledgeError('问答或笔记不存在', 404, 'DATACOM_NOT_FOUND');
            const turns = [...parseJson(row.turns_json, []), turn].slice(-30);
            await run(connection, 'UPDATE dk_annotations SET title = ?, brief = ?, turns_json = ?, updated_at = ? WHERE id = ?', [title, brief, JSON.stringify(turns), stamp, id]);
            return id;
        }
        const newId = `anno-${crypto.randomBytes(6).toString('hex')}`;
        await run(connection, `INSERT INTO dk_annotations (id, article_id, visual_id, target_type, anchor_json, kind, title, brief, quote, turns_json, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [newId, articleId || null, anchor.visualId || null, anchor.type, JSON.stringify(anchor), kind, title, brief, text(quote, 4000), JSON.stringify([turn]), actor, stamp, stamp]);
        return newId;
    });
    await checkpoint(connection);
    return getAnnotation(result);
}

async function updateAnnotation(id, input, user) {
    const annotation = await getAnnotation(id);
    assertOwner(annotation, user);
    const title = text(input?.title, 40).trim() || annotation.title;
    const turns = annotation.turns.slice();
    if (typeof input?.content === 'string' && turns.length) turns[turns.length - 1] = { ...turns[turns.length - 1], a: text(input.content, 40000), editedBy: user?.username || '' };
    const connection = await ready();
    await transaction(connection, () => run(connection, 'UPDATE dk_annotations SET title = ?, turns_json = ?, updated_at = ? WHERE id = ?', [title, JSON.stringify(turns), nowIso(), annotation.id]));
    await checkpoint(connection);
    return getAnnotation(annotation.id);
}

async function deleteAnnotation(id, user) {
    const annotation = await getAnnotation(id);
    assertOwner(annotation, user);
    const connection = await ready();
    await transaction(connection, () => run(connection, 'UPDATE dk_annotations SET deleted = 1, updated_at = ? WHERE id = ?', [nowIso(), annotation.id]));
    await checkpoint(connection);
    return { ok: true, id: annotation.id };
}

// ---------------- 提问（流式） ----------------
async function ask(input, { user, onDelta, signal, generate = null }) {
    const mode = KINDS.has(input?.mode) ? input.mode : 'qa';
    if (mode === 'rewrite' && user?.role !== 'admin') throw knowledgeError('只有管理员可以让 AI 改写原文', 403, 'DATACOM_FORBIDDEN');
    const question = text(input?.question, 2000).trim();
    let anchor;
    let articleId = input?.articleId ? normalizeId(input.articleId, '文章 ID') : null;
    let history = [];
    let previous = null;
    if (input?.annotationId) {
        previous = await getAnnotation(input.annotationId);
        anchor = previous.anchor;
        articleId = previous.articleId;
        history = previous.turns;
    } else {
        anchor = normalizeAnchor(input?.anchor || {});
    }
    if (mode === 'rewrite' && (anchor.type !== 'text' || !articleId)) throw knowledgeError('改写只支持文章中的文字');
    const article = articleId ? await repo.getArticle(articleId) : null;
    let quote = previous ? previous.quote : text(anchor.exact || input?.quote || anchor.snippet, 4000);
    let section = '';
    let rewrite = null;
    if (article && anchor.type === 'text') {
        const source = fieldSource(article, anchor.field);
        const located = locateQuote(source, anchor);
        if (mode === 'rewrite') {
            if (!located) throw knowledgeError('没有在 Markdown 原文中找到这段文字（可能跨越了表格、公式或链接），请缩小选择范围后重试', 422, 'DATACOM_QUOTE_NOT_FOUND');
            rewrite = { field: anchor.field, start: located.start, end: located.end, original: located.original, revision: article.revision };
            quote = located.original;
        }
        section = anchor.field === 'body' ? sectionAround(source, located ? located.start : 0) : source;
    } else if (article) {
        section = sectionAround(article.bodyMd, Math.max(0, article.bodyMd.indexOf(anchor.heading || '')), 4000);
    }
    const visualContext = text(input?.visualContext, 6000);
    const prompt = buildPrompt({ mode, question, quote, anchor, article, section, visualContext, history });
    let output = '';
    if (generate) {
        output = await generate({ prompt, systemInstruction: `${BASE_PROMPT}\n${MODE_PROMPT[mode]}`, onDelta });
    } else {
        const settings = await aiSettingsRepo.getRuntimeSettings();
        if (!settings.hasApiKey || !settings.keyLooksValid) throw knowledgeError('平台尚未配置可用的 AI 模型，请管理员在“AI 设置”中配置后再使用', 503, 'DATACOM_AI_UNAVAILABLE');
        const client = aiProviderClient.createClient(settings);
        const result = await client.generateText({
            systemInstruction: `${BASE_PROMPT}\n${MODE_PROMPT[mode]}`,
            prompt,
            maxOutputTokens: Math.min(4096, Number(settings.maxOutputTokens) || 4096),
            temperature: mode === 'rewrite' ? 0.2 : 0.4,
            onDelta: delta => { output += delta; onDelta?.(delta); },
            signal
        });
        output = result.text || output;
    }
    const { body, title, brief } = splitMeta(output, question || quote);
    if (!body) throw knowledgeError('AI 没有返回内容，请稍后重试', 502, 'DATACOM_AI_EMPTY');
    if (mode === 'rewrite') return { mode, title, brief, rewrite: { ...rewrite, replacement: body.replace(/^```(?:markdown|md)?\s*|\s*```$/g, '') }, question };
    const turn = { q: question, a: body, at: nowIso(), by: user?.username || '' };
    const annotation = await saveAnnotation({ id: previous?.id, articleId, anchor, kind: previous?.kind || mode, quote, title, brief, turn, actor: user?.username || '' });
    return { mode, annotation };
}

// 管理员确认后把改写写回文章（带版本校验，历史版本可回退），并记一条“改写”记录用于高亮
async function applyRewrite(input, { user }) {
    if (user?.role !== 'admin') throw knowledgeError('只有管理员可以修改原文', 403, 'DATACOM_FORBIDDEN');
    const articleId = normalizeId(input?.articleId, '文章 ID');
    const rewrite = input?.rewrite || {};
    const field = FIELDS.has(rewrite.field) ? rewrite.field : 'body';
    const article = await repo.getArticle(articleId);
    if (article.revision !== Number(rewrite.revision)) throw knowledgeError('文章已被修改，请重新选择文字后再改写', 409, 'DATACOM_REVISION_CONFLICT');
    const source = fieldSource(article, field);
    const start = Number(rewrite.start);
    const end = Number(rewrite.end);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > source.length || source.slice(start, end) !== rewrite.original) {
        throw knowledgeError('原文位置已变化，请重新选择文字后再改写', 409, 'DATACOM_REVISION_CONFLICT');
    }
    const replacement = text(rewrite.replacement, 20000);
    const next = source.slice(0, start) + replacement + source.slice(end);
    const updated = { ...article };
    if (field === 'summary') updated.summary = next;
    else if (field === 'keyPoints') updated.keyPoints = next.split('\n').map(item => item.trim()).filter(Boolean);
    else updated.bodyMd = next;
    const result = await repo.updateArticle(articleId, updated, article.revision, user.username || 'admin');
    const anchor = { type: 'text', field, exact: squash(replacement).slice(0, 4000), prefix: squash(source.slice(Math.max(0, start - 60), start)).slice(-60), suffix: squash(source.slice(end, end + 60)).slice(0, 60) };
    const annotation = await saveAnnotation({
        articleId, anchor, kind: 'rewrite', quote: replacement,
        title: text(input?.title, 40) || 'AI 改写', brief: text(input?.brief, 160) || '已按 AI 建议改写原文',
        turn: { q: text(input?.question, 2000), a: replacement, before: rewrite.original, at: nowIso(), by: user.username || '' },
        actor: user.username || ''
    });
    return { revision: result.revision, annotation };
}

module.exports = { aiStatus, ask, applyRewrite, deleteAnnotation, listAnnotations, locateQuote, sectionAround, splitMeta, updateAnnotation };
