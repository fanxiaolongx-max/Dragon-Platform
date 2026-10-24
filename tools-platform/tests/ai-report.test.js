const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-report-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const model = require('../frontend/js/ai-report/report-model');
const repo = require('../backend/models/import-source-repository');
const reports = require('../backend/models/ai-report-repository');
const data = require('../backend/models/ai-report-data');
const route = require('../backend/routes/ai-report');

const recipe = (extra = {}) => ({
    summary: { zh: '按级别计数', en: 'By level' },
    sources: [{ id: 's1', kind: 'sheet', label: '整改详单', match: { sourceKey: '整改详单-{month}', sheetName: 'Sheet1' } }],
    compute: 'function compute(input){ return {total: input.s1 ? input.s1.rows.length : 0}; }',
    render: 'function render(result, kit){ return kit.text(String(result.total)); }',
    ...extra
});

test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
});

test('report model keeps template parts, bounds cells and rejects broken recipes', () => {
    const legacy = { document: { name: '月报', title: { zh: '标题', en: 'Title' }, meta: [{ label: { zh: '部门', en: 'Dept' }, value: { zh: 'A', en: 'A' }, span: 4 }], sections: [{ title: { zh: '整体', en: 'Overall' }, overview: true }, { title: { zh: '变更', en: 'Changes' }, blocks: [{ type: 'table' }] }], footer: { zh: '页脚', en: 'Footer' } } };
    const doc = model.fromLegacyTemplate(legacy, '2026-09');
    assert.equal(doc.reportMonth, '2026-09');
    assert.equal(doc.template.title.zh, '标题');
    assert.equal(doc.template.meta[0].label.en, 'Dept');
    assert.deepEqual(doc.chapters.map(chapter => chapter.title.zh), ['变更'], 'overview sections and old components are dropped');
    assert.equal(doc.chapters[0].cells.length, 1);

    const cell = model.cell({ span: 40, height: 5, prompt: 'x'.repeat(9000) });
    assert.equal(cell.span, 12);
    assert.equal(cell.height, 60);
    assert.equal(cell.prompt.length, 4000);

    assert.throws(() => model.normalizeRecipe(recipe({ compute: 'return 1' })), /compute/);
    assert.throws(() => model.normalizeRecipe(recipe({ sources: [{ kind: 'sql' }] })), /kind/);
    assert.throws(() => model.normalizeRecipe(recipe({ sources: [{ kind: 'sheet', match: {} }] })), /identity/);
    const normalized = model.normalizeRecipe(recipe({ sources: [{ kind: 'metrics', keys: ['a'], monthOffset: -40 }] }));
    assert.equal(normalized.sources[0].id, 's1');
    assert.equal(normalized.sources[0].monthOffset, -24);
    assert.equal(normalized.narrative, null);
});

test('recipe sources resolve to each month\'s table by stable identity', async () => {
    for (const [month, rows] of [[9, 3], [10, 5]]) {
        const batch = await repo.createBatch({ targetMonth: month });
        const file = await repo.saveFile(batch.id, { name: `整改详单-2026-${String(month).padStart(2, '0')}.csv`, buffer: Buffer.from('级别\n') });
        await repo.saveSheets(file.id, [{ name: 'Sheet1', headers: ['级别'], rows: Array.from({ length: rows }, () => ({ 级别: '高' })) }]);
    }
    const sources = await data.listSources('2026-10');
    assert.equal(sources.length, 1);
    assert.equal(sources[0].sourceKey, '整改详单-{month}');
    assert.equal(sources[0].sheets[0].rowCount, 5);
    const sample = await data.describeSheet(sources[0].sheets[0].sheetId);
    assert.deepEqual(sample.headers, ['级别']);

    const october = await data.recipeInput('2026-10', model.normalizeRecipe(recipe()).sources);
    assert.equal(october.input.s1.rows.length, 5);
    const september = await data.recipeInput('2026-10', model.normalizeRecipe(recipe({ sources: [{ id: 's1', kind: 'sheet', label: '上月', match: { sourceKey: '整改详单-{month}' }, monthOffset: -1 }] })).sources);
    assert.equal(september.input.s1.rows.length, 3, 'monthOffset -1 reads the previous month');
    const empty = await data.recipeInput('2026-07', model.normalizeRecipe(recipe()).sources);
    assert.equal(empty.input.s1, null);
    assert.equal(empty.missing[0].month, '2026-07');
});

test('reports save normalized, list, read and delete', async () => {
    await assert.rejects(reports.save({ chapters: [] }), /month/);
    const saved = await reports.save({ name: '测试', reportMonth: '2026-10', chapters: [{ title: '一', cells: [{ prompt: 'p', recipe: recipe() }] }] }, 'tester');
    assert.match(saved.id, /^report-/);
    assert.equal((await reports.list())[0].updatedBy, 'tester');
    const read = await reports.read(saved.id);
    assert.equal(read.chapters[0].cells[0].recipe.sources[0].kind, 'sheet');
    await reports.remove(saved.id);
    await assert.rejects(reports.read(saved.id), /not found/);
    await assert.rejects(reports.read('../x'), /Invalid/);
});

test('cell chat answers or asks, the summary writes the prompt, and compile repairs an invalid recipe', async () => {
    const replies = [];
    const seen = [];
    const client = { async generateChat({ systemInstruction, messages, tools }) { seen.push({ systemInstruction, messages: messages.length, tools: !!tools, last: messages.at(-1) }); return replies.shift(); } };

    replies.push({ text: '', toolCalls: [{ id: 'c1', name: 'list_sources', args: {} }] }, { text: '{"type":"answer","text":"整改详单有 1 列：级别。"}', toolCalls: [] });
    assert.deepEqual(await route.cellTurn(client, { month: '2026-10', prompt: '', chat: [], message: '整改详单有哪些列' }), { type: 'answer', text: '整改详单有 1 列：级别。', tools: ['list_sources'] });
    assert.equal(seen[1].last.role, 'tool');
    assert.match(seen[1].last.toolResults[0].content, /整改详单/);
    assert.match(seen[0].systemInstruction, /不要生成配方/);

    replies.push({ text: '{"type":"recipe","recipe":{}}', toolCalls: [] }, { text: '```json\n{"type":"ask","question":"按什么统计？","choices":["级别","责任人"]}\n```', toolCalls: [] });
    const ask = await route.cellTurn(client, { month: '2026-10', prompt: '', chat: [{ role: 'user', text: '整改单' }], message: '统计整改单' });
    assert.deepEqual(ask.choices, ['级别', '责任人']);
    assert.match(seen.at(-1).last.content, /answer、ask 或 ready/, 'recipes are refused in conversation');

    replies.push({ text: '{"type":"ready","text":"按级别统计，表格展示。"}', toolCalls: [] });
    assert.equal((await route.cellTurn(client, { month: '2026-10', prompt: '', chat: [], message: '级别' })).type, 'ready', 'a settled need is reported as ready');

    replies.push({ text: '{"prompt":"用整改详单按级别统计，表格展示。"}', toolCalls: [] });
    const prompt = await route.summarizePrompt(client, { month: '2026-10', prompt: '', chat: [{ role: 'user', text: '统计整改单' }, { role: 'ai', kind: 'ask', text: '按什么统计？', choices: ['级别'] }, { role: 'user', text: '级别' }] });
    assert.equal(prompt, '用整改详单按级别统计，表格展示。');
    assert.match(seen.at(-1).last.content, /用户：级别/);
    replies.push({ text: 'no json', toolCalls: [] });
    await assert.rejects(route.summarizePrompt(client, { month: '2026-10', chat: [{ role: 'user', text: 'x' }] }), /提示词/);

    replies.push({ text: JSON.stringify({ type: 'recipe', recipe: recipe({ render: 'nope' }) }), toolCalls: [] }, { text: JSON.stringify({ type: 'recipe', reply: '好了', recipe: recipe() }), toolCalls: [] });
    const compiled = await route.compileTurn(client, { month: '2026-10', prompt, recipe: { compute: 'old' }, error: 'x is not defined' });
    assert.equal(compiled.type, 'recipe');
    assert.equal(compiled.reply, '好了');
    assert.match(seen.at(-1).last.content, /配方无效/);
    assert.match(seen.at(-2).last.content, /运行出错：x is not defined/, 'the previous run error is sent to the compiler');
});

test('compile sends made-up sources back: unknown tables and metric keys are named in the retry', async () => {
    const seen = [];
    const replies = [
        { text: JSON.stringify({ type: 'recipe', recipe: recipe({ sources: [{ id: 's1', kind: 'sheet', label: '日志回传率', match: { sourceKey: 'log_upload_rate' } }, { id: 'm1', kind: 'metrics', label: '回传', keys: ['made/up'] }] }) }), toolCalls: [] },
        { text: JSON.stringify({ type: 'recipe', recipe: recipe() }), toolCalls: [] }
    ];
    const client = { async generateChat({ messages }) { seen.push(messages.at(-1).content); return replies.shift(); } };
    assert.equal((await route.compileTurn(client, { month: '2026-10', prompt: '日志回传率' })).type, 'recipe');
    assert.match(seen[1], /不存在：导入表 日志回传率（sourceKey: log_upload_rate）；指标 made\/up/);
    assert.match(seen[1], /list_metrics/, 'the retry points at metrics and datasets');
    assert.deepEqual(await data.unknownSources('2026-11', model.normalizeRecipe(recipe()).sources), [], 'a real table without this month\'s file is missing data, not unknown');
});

test('text edited in a cell is sent with the changed words and comes back as the updated prompt', async () => {
    const seen = [];
    const replies = [{ text: 'not json', toolCalls: [] }, { text: JSON.stringify({ mode: 'refine', note: '月份写成 X月', prompt: 'p\n总结里月份写成“X月”。' }), toolCalls: [] }];
    const client = { async generateChat({ systemInstruction, messages }) { seen.push({ systemInstruction, last: messages.at(-1).content, first: messages[0].content }); return replies.shift(); } };
    const reply = await route.textEditTurn(client, { month: '2026-09', prompt: 'p', place: 'narrative', kind: '文字', before: '2026-09各运营商回传率较高。', after: '9月各运营商回传率较高。' });
    assert.deepEqual(reply, { mode: 'refine', note: '月份写成 X月', prompt: 'p\n总结里月份写成“X月”。', change: '把“2026-09”改成了“9月”' });
    assert.match(seen[0].first, /修改位置：总结[\s\S]*改动：把“2026-09”改成了“9月”/);
    assert.match(seen[0].systemInstruction, /以【】开头的行[\s\S]*逐字保留/, 'platform-kept lines are protected');
    assert.match(seen[1].last, /只输出约定的 JSON/, 'an unusable reply is asked again');
    const header = await route.textEditTurn({ async generateChat({ messages }) { seen.push(messages[0].content); return { text: '{"mode":"replace","note":"n","prompt":"q"}' }; } }, { month: '2026-09', prompt: 'p', place: 'content', kind: '表头', before: '回传率', after: '回传(%)' });
    assert.equal(header.change, '把“回传率”改成了“回传(%)”', 'short texts are reported whole');
});

test('kpi changes say what they compare to instead of showing a bare number', () => {
    globalThis.self = globalThis;
    require('../frontend/js/ai-report/render-kit.js');
    const deltas = globalThis.AiReportKit.kpi([{ label: '事故增量', value: 0, delta: 0 }, { label: '高风险', value: 5, unit: '%', delta: 2 }, { label: 'x', value: 1, delta: -1.5, deltaLabel: '较去年同期' }, { label: 'y', value: 1, delta: '上升' }]).match(/kit-kpi-delta">[^<]*/g).map(item => item.split('>')[1]);
    assert.deepEqual(deltas, ['与上月持平', '较上月 +2%', '较去年同期 −1.5', '上升']);
    const tied = globalThis.AiReportKit.extremes([{ n: 'TE', v: 100 }, { n: 'ORG', v: '100%' }], { label: 'n', value: 'v' });
    assert.deepEqual(tied, { same: true, max: { value: 100, labels: ['TE', 'ORG'] }, min: { value: 100, labels: ['TE', 'ORG'] } }, 'all equal is reported as same, not as a ranking');
    assert.deepEqual(globalThis.AiReportKit.extremes([{ n: 'TE', v: 95 }, { n: 'ET', v: 96 }, { n: 'VDF', v: 96 }], { label: 'n', value: 'v' }).max.labels, ['ET', 'VDF'], 'ties at the top are all listed');
    const kit = globalThis.AiReportKit;
    assert.equal(kit.text('ORG **51** 次 a<b'), '<p class="kit-text">ORG <strong class="kit-em">51</strong> 次 a&lt;b</p>', '**…** marks key numbers');
    assert.equal(kit.inlineLink('本月整改达成率为98%。', '#air-cell-x', { terms: ['整改达成率'] }), '本月<a class="kit-link" href="#air-cell-x">整改达成率</a>为98%。', 'the link sits on the metric name');
    assert.equal(kit.inlineLink('2026-09 达成率 98%。', '#air-cell-x'), '2026-09 达成率 <a class="kit-link" href="#air-cell-x">98%</a>。', 'else on a number with its unit, never on a date');
    assert.equal(kit.inlineLink('x', 'javascript:alert(1)'), 'x', 'only report anchors become links');
});

test('metrics are found by name each month, and keys that changed between months are translated by name', async () => {
    await repo.registerSnapshot({ id: 'snap-aug', timestamp: '2026-09-02T00:00:00Z', target_period: '2026-08', topMetrics: [{ key: 'legacy:事故', label: '事故', value: '3' }] }, { allowMissingBatch: true });
    await repo.registerSnapshot({ id: 'snap-sep', timestamp: '2026-10-02T00:00:00Z', target_period: '2026-09', topMetrics: [{ key: 'other_x_m_1', label: '事故', value: '5' }, { key: 'other_y_m_2', label: '延期补授权', value: '95%' }] }, { allowMissingBatch: true });
    const sources = sources => model.normalizeRecipe(recipe({ sources })).sources;
    const byName = await data.recipeInput('2026-09', sources([{ id: 'cur', kind: 'metrics', names: ['事故', '延期补授权'] }, { id: 'prev', kind: 'metrics', names: ['事故'], monthOffset: -1 }]));
    assert.deepEqual([byName.input.cur.values, byName.input.prev.values, byName.missing], [{ 事故: 5, 延期补授权: 95 }, { 事故: 3 }, []]);
    const unlisted = await data.recipeInput('2026-09', sources([{ id: 'cur', kind: 'metrics', names: ['事故'] }]));
    assert.deepEqual([unlisted.input.cur.metrics.map(metric => metric.label), unlisted.input.cur.values['延期补授权']], [['事故'], 95], 'names left out of the list can still be read');
    const byOldKey = await data.recipeInput('2026-09', sources([{ id: 'prev', kind: 'metrics', keys: ['other_x_m_1'], monthOffset: -1 }]));
    assert.deepEqual(byOldKey.input.prev.values, { other_x_m_1: 3, 事故: 3 }, 'a September key still finds August\'s value through the name');
    const absent = await data.recipeInput('2026-09', sources([{ id: 'cur', kind: 'metrics', label: '风险', names: ['事故', '没有这个'] }]));
    assert.deepEqual(absent.missing.map(item => item.label), ['风险（没有这个）']);
    assert.deepEqual(await data.unknownSources('2026-09', sources([{ id: 'm', kind: 'metrics', names: ['事故'], keys: ['legacy:事故'] }])), [], 'names and keys from other months are known');
    assert.deepEqual(await data.unknownSources('2026-09', sources([{ id: 'm', kind: 'metrics', names: ['编造的指标'] }])), ['指标 编造的指标']);
    // The AI sees one short line per metric and can search by name, so metrics late in a long list are not cut off.
    const listed = await data.findMetrics('2026-09');
    assert.deepEqual(listed.metrics, ['事故 = 5', '延期补授权 = 95%']);
    // Targets come from the warning-target settings, per month and direction; a key that changed is matched by name.
    await require('../backend/models/sla-targets-repository').replaceTargets({ other_x_m_1: { label: '事故', type: 'lte', isPercent: false, 8: 2, 9: 1 }, other_y_m_2: { label: '延期补授权', type: 'gte', isPercent: true, 9: 100 } });
    assert.deepEqual((await data.findMetrics('2026-09')).metrics, ['事故 = 5（目标 ≤ 1）', '延期补授权 = 95%（目标 ≥ 100%）']);
    const targeted = await data.recipeInput('2026-09', sources([{ id: 'cur', kind: 'metrics', names: ['事故'] }, { id: 'prev', kind: 'metrics', names: ['事故'], monthOffset: -1 }]));
    assert.deepEqual([targeted.input.cur.targets, targeted.input.cur.rules, targeted.input.prev.targets['事故']], [{ 事故: 1, 延期补授权: 100 }, { 事故: 'lte', 延期补授权: 'gte' }, 2]);
    await require('../backend/models/sla-targets-repository').replaceTargets({});
    assert.deepEqual((await data.findMetrics('2026-09', '延期 补授权')).metrics, ['延期补授权 = 95%']);
    assert.equal((await data.findMetrics('2026-09', 'SR FRT')).found, 0);
});

test('the report prompt holds the style and the rules for every cell; chat edits change only the items they name', async () => {
    const fresh = model.normalize({ reportMonth: '2026-09' }).style;
    assert.equal(fresh.prompt, model.DEFAULT_STYLE);
    assert.deepEqual(fresh.chat.map(item => item.kind), ['prompt'], 'the prompt is shown in the style chat from the start');
    const old = model.normalize({ reportMonth: '2026-09', style: { prompt: '绿色商务风', themePrompt: '绿色商务风', chat: [{ role: 'ai', kind: 'prompt', text: '绿色商务风' }] } }).style;
    assert.match(old.prompt, /^【风格与配色】\n- 绿色商务风\n【数据与计算】/);
    assert.equal(old.themePrompt, old.prompt, 'an applied style stays applied after the rules are added');
    const changed = model.applyStyleChanges(model.DEFAULT_STYLE, [{ action: 'remove', item: '指标卡下方的变化写成“较上月 +2”' }, { action: 'add', section: '排版与图表', item: '图表都显示数值标签。' }, { action: 'replace', item: '没有这一条', to: 'x' }]);
    assert.equal(changed.skipped.length, 1);
    assert.ok(!changed.prompt.includes('指标卡下方'));
    assert.match(changed.prompt, /【排版与图表】[\s\S]*- 图表都显示数值标签。$/);
    const untouched = model.DEFAULT_STYLE.split('\n').filter(line => !line.includes('指标卡下方'));
    assert.ok(untouched.every(line => changed.prompt.split('\n').includes(line)), 'every other item keeps its exact words');
    const replies = [{ text: '{"changes":[{"action":"add","section":"语言","item":"中英文之间加空格。"}]}' }, { text: '{"prompt":"深绿商务风"}' }];
    const client = { async generateChat() { return replies.shift(); } };
    assert.match(await route.reviseStyle(client, { prompt: model.DEFAULT_STYLE, chat: [{ role: 'user', text: '中英文之间加空格' }] }), /【语言】\n- 中英文之间加空格。$/);
    assert.match(await route.reviseStyle(client, { prompt: model.DEFAULT_STYLE, chat: [{ role: 'user', text: '深绿' }] }), /^【风格与配色】\n- 深绿商务风\n【数据与计算】/, 'a plain style text replaces only the style items');
});

test('cells without a summary get a one-line gist from their results for overviews', async () => {
    const express = require('express'), request = require('supertest');
    const settings = require('../backend/models/ai-settings-repository'), provider = require('../backend/models/ai-provider-client');
    const originalSettings = settings.getRuntimeSettings, originalClient = provider.createClient;
    let seen = '';
    settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, provider: 'stub', model: 'stub' });
    provider.createClient = () => ({ async generateChat({ messages }) { seen = messages[0].content; return { text: JSON.stringify({ gists: { a: '整改达成率 98%，各维度均达标。', zz: 'not asked' } }) }; } });
    try {
        const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { username: 't', role: 'admin' }; next(); }); app.use('/r', route);
        const res = await request(app).post('/r/cell/gist').send({ month: '2026-09', items: [{ id: 'a', title: '整改', result: { overall: 98 } }] }).expect(200);
        assert.deepEqual(res.body, { gists: { a: '整改达成率 98%，各维度均达标。' } }, 'only the cells asked for come back');
        assert.match(seen, /"overall":98/);
    } finally { settings.getRuntimeSettings = originalSettings; provider.createClient = originalClient; }
});

test('report style chats without data tools and compiles to a validated theme', async () => {
    assert.equal(model.normalizeTheme({ accent: 'red', palette: ['#111111'] }).accent, '#1f5e95', 'invalid colours fall back');
    assert.deepEqual(model.normalizeTheme({ palette: ['#111111'] }).palette, [], 'fewer than three chart colours are ignored');
    const doc = model.normalize({ reportMonth: '2026-10', style: { prompt: '绿色', chat: [{ role: 'user', text: '绿色' }], theme: { accent: '#1E6B4F', palette: ['#111111', '#222222', '#333333'], font: 'comic', radius: 99 } } });
    assert.deepEqual([doc.style.theme.accent, doc.style.theme.font, doc.style.theme.radius], ['#1e6b4f', 'sans', 16]);
    assert.deepEqual([doc.style.theme.frame, doc.style.theme.dividers], ['double', 'line'], 'themes from before frames get the default frame and lines');
    assert.deepEqual(['frame', 'dividers'].map(key => model.normalizeTheme({ palette: ['#111111', '#222222', '#333333'], frame: 'none', dividers: 'dashed' })[key]), ['none', 'dashed']);

    const calls = [];
    const replies = [{ text: '{"type":"ready","text":"绿色商务风"}', toolCalls: [] }, { text: '{"reply":"好","theme":{"accent":"#1e6b4f","palette":["#1e6b4f","#3fa57a","#8cc9a7"]}}', toolCalls: [] }, { text: '{"theme":{"accent":"#1e6b4f"}}', toolCalls: [] }];
    const client = { async generateChat(options) { calls.push(options); return replies.shift(); } };
    assert.equal((await route.styleTurn(client, { prompt: '', chat: [], message: '绿色' })).type, 'ready');
    assert.equal(calls[0].tools, undefined, 'style chat does not read data');
    assert.equal((await route.compileTheme(client, { prompt: '绿色' })).theme.palette.length, 3);
    await assert.rejects(route.compileTheme(client, { prompt: '绿色' }), /主题配色/);

    const seen = [];
    const compileClient = { async generateChat({ messages }) { seen.push(messages[0].content); return { text: JSON.stringify({ type: 'recipe', recipe: recipe() }), toolCalls: [] }; } };
    await route.compileTurn(compileClient, { month: '2026-10', prompt: 'p', style: '深蓝商务风' });
    assert.match(seen[0], /月报整体风格[\s\S]*深蓝商务风/, 'cells compile with the report style as context');
});

test('dataset catalog turns tool JSON into tables, merges keyed groups, hides secrets and feeds recipes', async () => {
    const datasets = require('../backend/models/ai-report-datasets');
    const tables = datasets.findTables({
        tasks: [{ id: 1, title: 'A', owner: { name: '张三', token: 'x' }, apiKey: 'secret' }, { id: 2, title: 'B' }],
        schedule: { '2026-10-01': [{ title: '会' }], '2026-10-02': [{ title: '巡检' }], '2026-10-03': [{ title: '演练' }] },
        regions: { TE: { plan: 3, done: 1 }, ORG: { plan: 2, done: 2 } },
        tags: ['a', 'b']
    });
    const byPath = Object.fromEntries(tables.map(table => [table.path, table.rows()]));
    assert.deepEqual(Object.keys(byPath).sort(), ['regions', 'schedule.*', 'tasks']);
    assert.deepEqual(byPath.tasks[0], { id: 1, title: 'A', 'owner.name': '张三' }, 'nested objects flatten one level and secret-like keys are dropped');
    assert.deepEqual(byPath['schedule.*'].map(row => row.group), ['2026-10-01', '2026-10-02', '2026-10-03']);
    assert.deepEqual(byPath.regions[1], { key: 'ORG', plan: 2, done: 2 });
    assert.equal(datasets.monthOf({ name: '重急收编 2026年09月 快照' }, ['name']), '2026-09');

    const original = datasets.readDataset;
    datasets.readDataset = async (id, month) => id === 'tools|demo:state|tasks' && month === '2026-09' ? { source: '自定义工具', name: 'demo · tasks', period: 'current', headers: ['id'], rows: [{ id: 1 }] } : null;
    try {
        const sources = model.normalizeRecipe(recipe({ sources: [{ id: 'd1', kind: 'dataset', label: '任务', dataset: 'tools|demo:state|tasks', monthOffset: -1 }] })).sources;
        const { input, missing } = await data.recipeInput('2026-10', sources);
        assert.deepEqual(input.d1.rows, [{ id: 1 }]);
        assert.equal(input.d1.month, '2026-09');
        assert.deepEqual(missing, []);
        assert.throws(() => model.normalizeRecipe(recipe({ sources: [{ kind: 'dataset' }] })), /dataset id/);
    } finally {
        datasets.readDataset = original;
    }
});

test('replies with a stray brace, raw newlines or unescaped backslashes still parse, so compiles do not loop', async () => {
    const { parseReplyDetailed } = route;
    assert.deepEqual(parseReplyDetailed('{"a":{"b":1}}}}').value, { a: { b: 1 } });
    assert.equal(parseReplyDetailed('```json\n{"code":"x.replace(/\\d/g,1)"}\n```').value.code, 'x.replace(/\\d/g,1)');
    assert.equal(parseReplyDetailed('{"a":"line1\nline2"}').value.a, 'line1\nline2');
    assert.deepEqual(parseReplyDetailed('{"s":"} {","n":2} trailing').value, { s: '} {', n: 2 });
    assert.match(parseReplyDetailed('no json').error, /没有 JSON/);

    const calls = [];
    const client = { async generateChat({ messages }) { calls.push(messages.at(-1)); return { text: JSON.stringify({ type: 'recipe', recipe: recipe() }) + '}', toolCalls: [] }; } };
    assert.equal((await route.compileTurn(client, { month: '2026-10', prompt: 'p' })).type, 'recipe');
    assert.equal(calls.length, 1, 'an extra closing brace no longer triggers retries');

    const broken = [];
    const stubborn = { async generateChat({ messages }) { broken.push(messages.at(-1).content); return { text: '{"type":"recipe","recipe":', toolCalls: [] }; } };
    await route.compileTurn(stubborn, { month: '2026-10', prompt: 'p' });
    assert.match(broken[1], /JSON 无法解析/, 'the retry tells the model what is wrong');
});

test('archived originals left unparsed (import page closed early) are parsed on first use', async () => {
    const ExcelJS = require('exceljs');
    const batch = await repo.createBatch({ targetMonth: 8 });
    await repo.saveFile(batch.id, { name: '图形化拦截详单_2026年08月.csv', buffer: Buffer.from('﻿地区部,月份,命令\n北部非洲,08,"reboot, now"\n北部非洲,08,rm\n\n') });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('明细');
    sheet.addRow(['工单', '状态']);
    sheet.addRow(['T1', '关闭']);
    await repo.saveFile(batch.id, { name: '工单表_2026年08月.xlsx', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });

    const sources = await data.listSources('2026-08');
    const csv = sources.find(item => item.name.includes('图形化拦截详单'));
    const xlsx = sources.find(item => item.name.includes('工单表'));
    assert.equal(csv.parseStatus, 'ready');
    assert.deepEqual(csv.sheets[0].headers, ['地区部', '月份', '命令']);
    assert.equal(csv.sheets[0].rowCount, 2);
    assert.deepEqual(xlsx.sheets.map(item => item.name), ['明细']);

    const { input, missing } = await data.recipeInput('2026-08', model.normalizeRecipe(recipe({ sources: [{ id: 's1', kind: 'sheet', label: '详单', match: { sourceKey: csv.sourceKey } }] })).sources);
    assert.deepEqual(missing, []);
    assert.equal(input.s1.rows[0]['命令'], 'reboot, now');
});

test('AI report images accept plain vector SVG and refuse scripts, handlers, embeds and external links', () => {
    const { checkSvg } = require('../backend/models/ai-report-images');
    const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><use href="#g"/></svg>';
    assert.equal(checkSvg(ok), ok);
    for (const bad of [
        '<svg><script>alert(1)</script></svg>',
        '<svg><rect onload="alert(1)"/></svg>',
        '<svg><foreignObject><div/></foreignObject></svg>',
        '<svg><image href="https://evil.example/x.png"/></svg>',
        '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
        '<svg><use xlink:href="https://evil.example/s.svg#a"/></svg>',
        '<div>not svg</div>'
    ]) assert.throws(() => checkSvg(bad), /SVG/);
});
