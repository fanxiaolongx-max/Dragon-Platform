// 平台工具使用说明：用当前配置的模型读每个工具的页面和代码，生成一份面向用户的说明（摘要、适用场景、用户可能的说法、
// 操作步骤、工作原理、注意事项），存进租户库 ai_tool_guides。
// - 供 Dragon Claw 的 find_platform_tools / read_tool_guide 按需查询，并作为虚拟文档进入项目知识库检索；
// - 工具源码变了（按内容哈希）才标记为待更新，生成只处理缺失和过期的，管理员在「智能体工具」设置页手动触发，控制模型消耗；
// - 工具目录：首页的平台页面卡片（frontend/index.html）+ 当前租户的自定义工具（含内置工具）。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { run, get, all, getDatabase } = require('./app-db');
const { getTenantId } = require('./tenant-context');

const FRONTEND = path.join(__dirname, '../../frontend');
const SOURCE_CHARS = 24000;      // 每个工具交给模型的源码上限（约 1.2 万 token）
const FILE_CHARS = 12000;
const GUIDE_OUTPUT_TOKENS = 1800;
const PAGE_ALIASES = { monthly: 'ai-report' };
const SKIP_FILE = /(?:^|\/)(?:vendor|node_modules|dist|build|backups?|data)(?:\/|$)|\.min\.js$|(?:^|\/)(?:THIRD_PARTY[^/]*|LICENSE[^/]*|CHANGELOG[^/]*|AGENTS\.md|CLAUDE\.md)$/i;

const readyByDb = new WeakMap();
async function ensureReady() {
    const key = getDatabase();
    if (!readyByDb.has(key)) {
        const pending = run(`CREATE TABLE IF NOT EXISTS ai_tool_guides (
            tool_id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            guide TEXT NOT NULL DEFAULT '',
            source_hash TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        readyByDb.set(key, pending);
        pending.catch(() => readyByDb.delete(key));
    }
    return readyByDb.get(key);
}

const decode = text => String(text || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** 首页的平台页面卡片 */
function pageTools() {
    let html = '';
    try { html = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8'); } catch (_error) { return []; }
    const tools = [];
    const re = /<a href="(\/[^"]*)" class="tool-card[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = re.exec(html))) {
        const body = match[2];
        const pick = cls => decode((new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)<\\/div>`).exec(body) || [])[1]);
        const tags = [...body.matchAll(/class="feature-tag[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map(item => decode(item[1])).filter(Boolean);
        const name = match[1].replace(/^\//, '').split(/[/?#]/)[0];
        tools.push({ id: `page:${match[1]}`, kind: 'page', title: pick('card-title'), description: pick('card-desc'), href: match[1], tags, page: PAGE_ALIASES[name] || name });
    }
    return tools;
}

async function customTools() {
    const repo = require('./custom-tools-repository');
    const dir = repo.getCustomToolsDir();
    return (await repo.listTools()).map(tool => ({ id: `custom:${tool.slug}`, kind: 'custom', title: tool.name, description: tool.description || '', href: tool.href || `/custom-tools/${tool.slug}/`,
        tags: (tool.tags || []).map(tag => String(tag?.label || tag?.name || tag)).filter(Boolean), dir: path.join(dir, tool.slug) }));
}

/** 当前租户的工具目录 */
async function catalog() {
    return [...pageTools(), ...await customTools()];
}

function walk(dir, files = [], depth = 0, base = dir) {
    if (depth > 3) return files;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { return files; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name);
        // 按工具目录内的相对路径判断（自定义工具本身就在 data/custom-tools 下）
        if (entry.name.startsWith('.') || SKIP_FILE.test(path.relative(base, full).replace(/\\/g, '/'))) continue;
        if (entry.isDirectory()) walk(full, files, depth + 1, base);
        else if (/\.(html?|js|md|txt|json)$/i.test(entry.name) && !/^package(-lock)?\.json$/i.test(entry.name)) files.push(full);
    }
    return files;
}

/** 工具的源码文件：说明文档优先，其次页面，再是脚本 */
function sourceFiles(tool) {
    let files = [];
    if (tool.kind === 'page') {
        files = [path.join(FRONTEND, 'pages', `${tool.page}.html`), path.join(FRONTEND, 'js', `${tool.page}.js`), ...walk(path.join(FRONTEND, 'js', tool.page))];
    } else if (tool.dir) {
        files = walk(tool.dir);
    }
    const rank = file => (/readme[^/\\]*$/i.test(file) ? 0 : /\.html?$/i.test(file) ? 1 : /\.md$/i.test(file) ? 2 : /manifest|tool\.json/i.test(file) ? 3 : 4);
    return files.filter(file => fs.existsSync(file)).sort((a, b) => rank(a) - rank(b));
}

function readSources(tool) {
    const parts = [];
    let used = 0;
    const base = tool.kind === 'page' ? FRONTEND : tool.dir;
    for (const file of sourceFiles(tool)) {
        if (used >= SOURCE_CHARS) break;
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch (_error) { continue; }
        if (/\.html?$/i.test(file)) text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>');
        text = text.slice(0, Math.min(FILE_CHARS, SOURCE_CHARS - used));
        used += text.length;
        parts.push(`### ${path.relative(base, file)}\n${text}`);
    }
    return parts.join('\n\n');
}

const hashOf = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);

/** 工具清单与说明状态：missing / stale / ready */
async function status() {
    await ensureReady();
    const tools = await catalog();
    const rows = new Map((await all('SELECT tool_id, summary, source_hash, model, generated_at FROM ai_tool_guides')).map(row => [row.tool_id, row]));
    const items = tools.map(tool => {
        const row = rows.get(tool.id);
        const state = !row ? 'missing' : row.source_hash !== hashOf(readSources(tool)) ? 'stale' : 'ready';
        return { id: tool.id, title: tool.title, href: tool.href, kind: tool.kind, state, summary: row?.summary || '', model: row?.model || '', generatedAt: row?.generated_at || '' };
    });
    const count = state => items.filter(item => item.state === state).length;
    return { items, total: items.length, ready: count('ready'), stale: count('stale'), missing: count('missing'), job: publicJob(jobs.get(getTenantId())) };
}

const PROMPT = `你是 Tools Platform 工具中台的产品文档作者。下面是平台上一个工具的名称、简介和源码（页面与脚本）。
请写一份给普通用户看的使用说明，严格按下面的格式输出 Markdown，不要输出其他内容：

摘要：<一句话，不超过 40 字，说清它能帮用户解决什么问题>

## 能做什么
<3–6 条要点>

## 什么时候用
<列出 4–8 种用户可能的说法或需求，比如「每个月要把站点指标整理成报表」，帮助按需求找到这个工具>

## 怎么用
<编号步骤，用页面上实际出现的按钮、标签、字段名称；有多种用法时分小节>

## 工作原理
<数据从哪来、经过哪些处理、结果保存在哪里或发到哪里；只写源码里看得出来的>

## 注意事项
<权限、数据范围、常见问题；没有就写「无」>

要求：只根据源码和简介写，看不出来的不要编；不要贴大段代码；不要出现密钥、账号或内网地址。`;

function parseGuide(text) {
    const clean = String(text || '').replace(/^```(?:markdown)?\s*|\s*```$/g, '').trim();
    const summary = (/^\s*摘要[:：]\s*(.+)$/m.exec(clean) || [])[1] || '';
    const guide = clean.replace(/^\s*摘要[:：].*$/m, '').trim();
    return { summary: summary.trim().slice(0, 80), guide: guide.slice(0, 12000) };
}

async function generateOne(tool, { client, signal }) {
    const sources = readSources(tool);
    const prompt = `${PROMPT}\n\n工具名称：${tool.title}\n入口：${tool.href}\n简介：${tool.description || '（无）'}\n标签：${tool.tags.join('、') || '（无）'}\n\n源码：\n${sources || '（没有找到源码）'}`;
    const result = await client.generateText({ prompt, maxOutputTokens: GUIDE_OUTPUT_TOKENS, temperature: 0.2, signal });
    const { redactText } = require('./ai-sensitive-data');
    const parsed = parseGuide(redactText(String(result.text || '')));
    if (!parsed.guide) throw new Error('模型没有返回说明');
    await run(`INSERT INTO ai_tool_guides (tool_id, title, summary, guide, source_hash, model, generated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(tool_id) DO UPDATE SET title = excluded.title, summary = excluded.summary, guide = excluded.guide, source_hash = excluded.source_hash, model = excluded.model, generated_at = CURRENT_TIMESTAMP`,
    [tool.id, tool.title, parsed.summary, parsed.guide, hashOf(sources), String(client.model || '')]);
    return parsed;
}

// ── 生成任务（每个租户一个，后台执行，设置页轮询进度） ─────
const jobs = new Map();
const publicJob = job => {
    if (!job) return null;
    const { promise: _promise, ...visible } = job;
    return visible;
};

/**
 * 生成缺失和过期的说明（force 时全部重新生成，ids 时只生成这些）。立即返回任务状态，后台逐个执行。
 * @param {{ force?: boolean, ids?: string[], client?: object }} options client 仅供测试注入
 */
async function startGeneration({ force = false, ids = null, client = null, reindex = true } = {}) {
    await ensureReady();
    const tenantId = getTenantId();
    const running = jobs.get(tenantId);
    if (running?.running) return publicJob(running);
    const current = await status();
    const wanted = new Set(ids || []);
    const queue = current.items.filter(item => (ids ? wanted.has(item.id) : force || item.state !== 'ready'));
    const job = { running: true, total: queue.length, done: 0, failed: [], current: '', startedAt: new Date().toISOString(), finishedAt: '' };
    jobs.set(tenantId, job);
    if (!queue.length) { job.running = false; job.finishedAt = job.startedAt; return publicJob(job); }
    let modelClient = client;
    if (!modelClient) {
        const settings = await require('./ai-settings-repository').getRuntimeSettings();
        modelClient = require('./ai-provider-client').createClient(settings);
    }
    const tools = new Map((await catalog()).map(tool => [tool.id, tool]));
    const runInTenant = fn => require('./tenant-context').runWithTenant(tenantId, fn);
    job.promise = runInTenant(async () => {
        for (const item of queue) {
            const tool = tools.get(item.id);
            if (!tool) continue;
            job.current = tool.title;
            try {
                await generateOne(tool, { client: modelClient, signal: AbortSignal.timeout(180000) });
            } catch (error) {
                job.failed.push({ id: tool.id, title: tool.title, error: String(error.message || error).slice(0, 200) });
            }
            job.done += 1;
        }
        // 新说明进入项目知识库检索
        if (reindex) await require('./ai-knowledge-service').refreshIndex({ force: true }).catch(error => console.warn('[tool-guides] 知识库刷新失败：', error.message || error));
    }).finally(() => {
        job.running = false;
        job.current = '';
        job.finishedAt = new Date().toISOString();
        delete job.promise;
    });
    return publicJob(job);
}

async function readGuide(id) {
    await ensureReady();
    return get('SELECT tool_id AS id, title, summary, guide, model, generated_at AS generatedAt FROM ai_tool_guides WHERE tool_id = ?', [String(id)]);
}

/** 知识库的虚拟文档：每份说明一篇 */
async function documentsForIndex() {
    await ensureReady();
    const tools = new Map((await catalog()).map(tool => [tool.id, tool]));
    return (await all('SELECT tool_id, title, summary, guide FROM ai_tool_guides')).filter(row => tools.has(row.tool_id)).map(row => {
        const tool = tools.get(row.tool_id);
        return { path: `tool-guides/${row.tool_id.replace(/[^\w.-]+/g, '_')}.md`, content: `# ${row.title} 使用说明\n\n入口：${tool.href}\n\n摘要：${row.summary}\n\n${row.guide}\n` };
    });
}

// ── Dragon Claw 按需查询 ─────────────────────────────────
function terms(text) {
    const value = String(text || '').toLowerCase();
    const words = value.match(/[a-z0-9][a-z0-9_.-]+/g) || [];
    const han = (value.match(/[一-鿿]+/g) || []).flatMap(run => (run.length < 2 ? [run] : Array.from({ length: run.length - 1 }, (_v, i) => run.slice(i, i + 2))));
    return [...new Set([...words, ...han])];
}

/** 按需求或名称找工具：标题、简介、标签、说明摘要与「什么时候用」都参与打分 */
async function findTools(query, { limit = 6 } = {}) {
    await ensureReady();
    const tools = await catalog();
    const guides = new Map((await all('SELECT tool_id, summary, guide FROM ai_tool_guides')).map(row => [row.tool_id, row]));
    const wanted = terms(query);
    if (!wanted.length) return [];
    return tools.map(tool => {
        const guide = guides.get(tool.id);
        const when = guide ? (/##\s*什么时候用([\s\S]*?)(?=\n##|$)/.exec(guide.guide) || [])[1] || '' : '';
        const fields = [[tool.title, 4], [tool.tags.join(' '), 2], [tool.description, 2], [guide?.summary || '', 2], [when, 1.5], [guide?.guide || '', 0.3]];
        const score = wanted.reduce((sum, term) => sum + fields.reduce((acc, [text, weight]) => acc + (String(text).toLowerCase().includes(term) ? weight : 0), 0), 0);
        return { tool, guide, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(10, Math.max(1, limit)))
        .map(({ tool, guide }) => ({ id: tool.id, title: tool.title, href: tool.href, summary: guide?.summary || tool.description.slice(0, 120), hasGuide: Boolean(guide) }));
}

/** 读一个工具的详细说明：按 id、名称或入口路径找；还没生成说明时给出简介和源码位置 */
async function toolGuide(ref) {
    await ensureReady();
    const value = String(ref || '').trim();
    const tools = await catalog();
    const tool = tools.find(item => item.id === value || item.href === value || item.title === value)
        || tools.find(item => item.title && (value.includes(item.title) || item.title.includes(value)));
    if (!tool) return null;
    const guide = await readGuide(tool.id);
    return { id: tool.id, title: tool.title, href: tool.href, description: tool.description, tags: tool.tags, summary: guide?.summary || '', guide: guide?.guide || '', generatedAt: guide?.generatedAt || '' };
}

/** 简介过短（不到 20 字）的工具：附上说明摘要，帮模型按需求匹配 */
async function shortDescriptionNotes() {
    await ensureReady();
    const tools = (await catalog()).filter(tool => decode(tool.description).length < 20);
    if (!tools.length) return '';
    const rows = new Map((await all('SELECT tool_id, summary FROM ai_tool_guides')).map(row => [row.tool_id, row.summary]));
    const lines = tools.filter(tool => rows.get(tool.id)).map(tool => `- ${tool.title}｜${tool.href}｜${rows.get(tool.id)}`);
    return lines.length ? `简介较短的工具补充说明（名称｜路径｜能解决的问题）：\n${lines.join('\n')}` : '';
}

module.exports = { ensureReady, catalog, status, startGeneration, readGuide, documentsForIndex, findTools, toolGuide, shortDescriptionNotes,
    _internal: { pageTools, sourceFiles, readSources, parseGuide, terms, jobs } };
