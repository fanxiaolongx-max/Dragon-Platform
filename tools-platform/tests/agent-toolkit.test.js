const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-toolkit-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const JSZip = require('../backend/node_modules/jszip');
const ExcelJS = require('../backend/node_modules/exceljs');
const toolkit = require('../backend/models/agent-toolkit');
const toolsService = require('../backend/models/agent-tools-service');
const agentLoop = require('../backend/models/agent-loop');
const registry = require('../backend/models/agent-tool-registry');
const memoryRepo = require('../backend/models/agent-memory-repository');
const { AgentChangeLog } = require('../backend/models/agent-change-log');
const appDb = require('../backend/models/app-db');
const tenantPool = require('../backend/models/tenant-sqlite-pool');

const root = path.join(sandbox, 'repo');
fs.mkdirSync(root, { recursive: true });
const ctx = () => ({ root, readOnly: false, username: 'alice', sensitiveValues: ['s3cr3t-value'], changeLog: new AgentChangeLog(root) });

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('calculate evaluates arithmetic, percentages and dates exactly, and never runs code', () => {
    const result = toolkit.calculate({ expressions: [
        '0.1 + 0.2', '(1250 - 980) / 980 * 100', 'round(percent(37, 120), 2)', 'change_percent(80, 100)', 'avg([1, 2, 3, 4])', '2 ** 10 × 3',
        'days_between("2026-10-01", "2026-10-31")', 'add_months("2026-01-31", 1)', 'workdays_between("2026-10-01", "2026-10-31")',
        'workdays_between("2026-10-01", "2026-10-31", "fri,sat")', 'add_workdays("2026-10-29", 3)', 'weekday("2026-10-29")'
    ] });
    const lines = result.content.split('\n');
    assert.deepEqual(lines.map(line => line.split(' = ')[1]), ['0.3', '27.5510204082', '30.83', '25', '2.5', '3072', '30', '"2026-02-28"', '22', '21', '"2026-11-03"', '"周四"']);
    for (const bad of ['process.exit(1)', 'require("fs")', 'this.constructor', '(() => 1)()', 'x = 1', 'add_days("2026-02-30", 1)']) {
        const out = toolkit.calculate({ expression: bad });
        assert.equal(out.isError, true, bad);
        assert.match(out.content, /错误/);
    }
});

test('read_document reads Excel, CSV, Word and PowerPoint text; query_data answers read-only SQL over them', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('明细');
    sheet.addRow(['地区', '单号', '金额', '日期']);
    sheet.addRow(['华东', 'A1', 120.5, new Date(Date.UTC(2026, 9, 1))]);
    sheet.addRow(['华南', 'A2', { formula: 'C2*2', result: 241 }, new Date(Date.UTC(2026, 9, 2))]);
    sheet.addRow(['华东', 'A3', 79.5, new Date(Date.UTC(2026, 9, 3))]);
    workbook.addWorksheet('空表');
    await workbook.xlsx.writeFile(path.join(root, 'orders.xlsx'));
    fs.writeFileSync(path.join(root, 'targets.csv'), '﻿地区,目标\n华东,"150"\n华南,"200"\n"华北, 一区",10\n');

    const excel = await toolsService.execute(ctx(), 'read_document', { path: 'orders.xlsx' });
    assert.match(excel.content, /工作表「明细」第 1-4 行，共 4 行/);
    assert.match(excel.content, /3│华南\tA2\t241\t2026-10-02/);
    assert.match(excel.content, /工作表：明细（4 行）、空表/);
    const csv = await toolsService.execute(ctx(), 'read_document', { path: 'targets.csv', startRow: 4 });
    assert.match(csv.content, /4│华北, 一区\t10/);

    const docx = new JSZip();
    docx.file('word/document.xml', '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>周报</w:t></w:r></w:p><w:p><w:r><w:t>本周完成 &amp; 风险</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>项</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>状态</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>');
    fs.writeFileSync(path.join(root, 'report.docx'), await docx.generateAsync({ type: 'nodebuffer' }));
    const word = await toolsService.execute(ctx(), 'read_document', { path: 'report.docx' });
    assert.match(word.content, /# 周报\n本周完成 & 风险\n\| 项 \| 状态 \|/);
    const pptx = new JSZip();
    pptx.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>第二页标题</a:t></a:r></a:p></p:sld>');
    pptx.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>封面</a:t></a:r></a:p></p:sld>');
    pptx.file('ppt/notesSlides/notesSlide1.xml', '<p:notes><a:p><a:r><a:t>开场白</a:t></a:r></a:p></p:notes>');
    fs.writeFileSync(path.join(root, 'deck.pptx'), await pptx.generateAsync({ type: 'nodebuffer' }));
    const deck = await toolsService.execute(ctx(), 'read_document', { path: 'deck.pptx' });
    assert.match(deck.content, /## 第 1 页\n封面\n备注：开场白\n\n## 第 2 页\n第二页标题/);
    fs.writeFileSync(path.join(root, 'scan.pdf'), '%PDF-1.4');
    assert.match((await toolsService.execute(ctx(), 'read_document', { path: 'scan.pdf' })).content, /暂不支持 \.pdf/);

    const grouped = await toolsService.execute(ctx(), 'query_data', { path: 'orders.xlsx', sheet: '明细', sql: 'SELECT "地区", COUNT(*) AS n, SUM("金额") AS total FROM data GROUP BY 1 ORDER BY 1' });
    assert.match(grouped.content, /地区\tn\ttotal\n华东\t2\t200\n华南\t1\t241/);
    const joined = await toolsService.execute(ctx(), 'query_data', { sources: [{ path: 'orders.xlsx', sheet: '明细', table: 'o' }, { path: 'targets.csv', table: 't' }],
        sql: 'SELECT t."地区", t."目标", COALESCE(SUM(o."金额"), 0) AS done FROM t LEFT JOIN o ON o."地区" = t."地区" GROUP BY 1, 2 ORDER BY 2' });
    assert.match(joined.content, /华北, 一区\t10\t0\n华东\t150\t200\n华南\t200\t241/);
    const schema = await toolsService.execute(ctx(), 'query_data', { path: 'targets.csv' });
    assert.match(schema.content, /"地区" 文本, "目标" 数字/);
    for (const sql of ["ATTACH DATABASE '/tmp/x.db' AS x", 'SELECT 1; DELETE FROM data', "SELECT * FROM data WHERE 1 = 1 UNION SELECT load_extension('x')", 'DELETE FROM data']) {
        const refused = await toolsService.execute(ctx(), 'query_data', { path: 'targets.csv', sql });
        assert.equal(refused.isError, true, sql);
    }
    assert.equal(toolkit.assertReadOnlySql("SELECT 'delete; attach' AS note"), "SELECT 'delete; attach' AS note", 'keywords inside strings are allowed');
});

test('multi_edit applies every edit or none; diff, zip and unzip stay inside the folder and are undoable', async () => {
    fs.writeFileSync(path.join(root, 'app.js'), 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n');
    const failed = await toolsService.execute(ctx(), 'multi_edit', { path: 'app.js', edits: [{ oldString: 'const a = 1', newString: 'const a = 10' }, { oldString: 'missing', newString: 'x' }] });
    assert.equal(failed.isError, true);
    assert.match(failed.content, /第 2 处/);
    assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'const a = 1;\nconst b = 2;\nconsole.log(a + b);\n', 'nothing is written when one edit fails');
    const preview = await toolsService.preview(ctx(), 'multi_edit', { path: 'app.js', edits: [{ oldString: 'const a = 1', newString: 'const a = 10' }, { oldString: 'a + b', newString: 'a * b' }] });
    assert.equal(preview.added, 2);
    const changeCtx = ctx();
    const edited = await toolsService.execute(changeCtx, 'multi_edit', { path: 'app.js', edits: [{ oldString: 'const a = 1', newString: 'const a = 10' }, { oldString: 'a + b', newString: 'a * b' }] });
    assert.equal(edited.change.path, 'app.js');
    assert.equal(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), 'const a = 10;\nconst b = 2;\nconsole.log(a * b);\n');

    const diff = await toolsService.execute(ctx(), 'diff_files', { path: 'app.js', otherText: 'const a = 10;\nconst b = 3;\nconsole.log(a * b);\n' });
    assert.match(diff.content, /-const b = 2;\n\+const b = 3;/);

    fs.mkdirSync(path.join(root, 'pkg', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pkg', 'node_modules', 'dep.js'), 'x');
    fs.writeFileSync(path.join(root, 'pkg', 'index.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(root, 'pkg', '.env'), 'TOKEN=abc');
    const zipCtx = ctx();
    const zipped = await toolsService.execute(zipCtx, 'zip_files', { paths: ['pkg'], output: 'out/pkg.zip' });
    assert.match(zipped.content, /已打包 1 个文件/);
    assert.match(zipped.content, /跳过/);
    assert.equal(zipped.change.path, 'out/pkg.zip');
    const names = Object.keys((await JSZip.loadAsync(fs.readFileSync(path.join(root, 'out/pkg.zip')))).files);
    assert.deepEqual(names.filter(name => !name.endsWith('/')), ['pkg/index.js']);
    assert.equal((await toolsService.execute(ctx(), 'zip_files', { paths: ['pkg'], output: 'out/pkg.zip' })).isError, true, 'existing output needs overwrite');

    const unzipped = await toolsService.execute(ctx(), 'unzip_file', { path: 'out/pkg.zip', to: 'restored' });
    assert.equal(fs.readFileSync(path.join(root, 'restored', 'pkg', 'index.js'), 'utf8'), 'module.exports = 1;\n');
    assert.equal(unzipped.changes.length, 1);
    assert.equal((await toolsService.execute(ctx(), 'unzip_file', { path: 'out/pkg.zip', to: 'restored' })).isError, true, 'existing files need overwrite');

    const evil = new JSZip();
    evil.file('../escape.txt', 'boom');
    fs.writeFileSync(path.join(root, 'evil.zip'), await evil.generateAsync({ type: 'nodebuffer' }));
    const slip = await toolsService.execute(ctx(), 'unzip_file', { path: 'evil.zip', to: 'safe' });
    assert.equal(slip.isError, true);
    assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
    assert.equal(fs.existsSync(path.join(sandbox, 'escape.txt')), false);
});

test('memory keeps each account its own notes, refuses credentials and appears in the prompt', async () => {
    const alice = ctx();
    const added = await toolsService.execute(alice, 'memory', { action: 'add', content: '周报统一用表格，金额保留两位小数' });
    assert.match(added.content, /已记住 \[\d+\]/);
    const id = Number(added.content.match(/\[(\d+)\]/)[1]);
    assert.match((await toolsService.execute(alice, 'memory', { action: 'add', content: '周报统一用表格，金额保留两位小数' })).content, /已有相同的记忆/);
    assert.equal((await toolsService.execute(alice, 'memory', { action: 'add', content: '服务器密码: hunter2' })).isError, true);
    assert.match((await toolsService.execute(alice, 'memory', { action: 'add', content: '接口密钥是 s3cr3t-value' })).content, /已记住/);
    assert.doesNotMatch(JSON.stringify(await memoryRepo.list('alice')), /s3cr3t-value/, 'configured secrets are redacted before saving');
    assert.equal((await toolsService.execute({ ...ctx(), username: 'bob' }, 'memory', { action: 'delete', id })).isError, true, 'another account cannot touch it');
    assert.equal(toolsService.kindOf('memory', { action: 'list' }), 'read');
    assert.equal(toolsService.kindOf('memory', { action: 'add' }), 'write');
    const preview = await toolsService.preview(alice, 'memory', { action: 'update', id, content: '周报用表格' });
    assert.deepEqual(preview.fields.map(field => field.label), ['操作', '原内容', '内容']);
    await toolsService.execute(alice, 'memory', { action: 'update', id, content: '周报用表格' });
    assert.match(await memoryRepo.promptFor('alice'), /\*\*长期记忆\*\*[\s\S]*\[\d+\] 周报用表格/);
    assert.equal(await memoryRepo.promptFor('bob'), '');
    await toolsService.execute(alice, 'memory', { action: 'delete', id });
    assert.doesNotMatch(await memoryRepo.promptFor('alice'), /周报用表格/);
});

test('the engine shows the task list without tool rows, ends the turn on ask_user, and the toolkit is a deferred group', async () => {
    const events = [];
    const replies = [
        () => ({ toolCalls: [{ id: 'p1', name: 'update_plan', args: { items: [{ content: '读表', status: 'in_progress' }, { content: '汇总', status: 'pending' }] } }, { id: 'c1', name: 'calculate', args: { expression: '1/3' } }] }),
        () => ({ text: '有两种口径。', toolCalls: [{ id: 'q1', name: 'ask_user', args: { question: '按哪个口径统计？', options: ['按地区', '按月份'] } }] }),
        () => assert.fail('the turn ends after ask_user')
    ];
    const result = await agentLoop.runToolLoop({
        client: { generateText: async () => replies.shift()() }, systemPrompt: 'sys', messages: [{ role: 'user', content: '统计一下' }],
        tools: [], executeCall: async () => assert.fail('built-ins never reach the preset'), write: event => events.push(event)
    });
    assert.equal(result.text, '有两种口径。\n\n按哪个口径统计？\n\n1. 按地区\n2. 按月份');
    assert.deepEqual(events.filter(event => event.type === 'tool_start').map(event => event.tool), ['calculate'], 'only calculate shows a tool row');
    assert.deepEqual(events.find(event => event.type === 'plan').items.map(item => item.status), ['in_progress', 'pending']);
    assert.deepEqual(events.find(event => event.type === 'question').options, ['按地区', '按月份']);
    assert.match(result.messages.at(-1).toolResults[0].content, /本轮到此结束/);
    assert.equal(result.plan.length, 2);

    const admin = await registry.create({ session: { readOnly: false, username: 'alice' } });
    assert.ok(!admin.definitions().some(tool => tool.name === 'read_document'), 'the toolkit is not sent up front');
    assert.match(admin.catalogPrompt(), /分组 toolkit[\s\S]*read_document[\s\S]*memory/);
    const readOnly = await registry.create({ session: { readOnly: true, username: 'guest' } });
    const loaded = await readOnly.runMeta({ name: 'tool_search', args: { select: ['toolkit'] } });
    assert.match(loaded.content, /### read_document[\s\S]*### query_data[\s\S]*### diff_files/);
    assert.doesNotMatch(loaded.content, /### (multi_edit|zip_files|unzip_file|memory)/, 'read-only accounts only get the read tools');
});

test('without a folder, the files preset reads the owner\'s attachments by full path and nothing else', async () => {
    const artifacts = require('../backend/models/agent-artifacts');
    const filesAgent = require('../backend/models/ai-files-agent');
    const saved = await artifacts.saveUpload('default::alice', { originalname: 'sales.csv', buffer: Buffer.from('region,amount\nEast,10\nEast,5\nSouth,7\n') });
    const other = await artifacts.saveUpload('default::bob', { originalname: 'secret.csv', buffer: Buffer.from('a\n1\n') });
    const requests = [];
    const replies = [
        () => ({ toolCalls: [
            { id: 'q', name: 'query_data', args: { path: saved.path, sql: 'SELECT region, SUM(amount) AS total FROM data GROUP BY 1 ORDER BY 1' } },
            { id: 'b', name: 'read_file', args: { path: other.path } },
            { id: 'r', name: 'read_document', args: { path: 'sales.csv' } },
            { id: 'w', name: 'write_file', args: { path: saved.path, content: 'x' } }
        ] }),
        () => ({ text: 'East 15，South 7。' })
    ];
    const result = await filesAgent.runTurn({
        client: { generateText: async options => { requests.push(options); return replies.shift()(); } }, systemInstruction: 'sys',
        messages: [{ role: 'user', content: `汇总一下\n\n📎 附件：\n- [sales.csv](<${saved.path}>)` }],
        ctx: { owner: 'default::alice', uploads: [saved.path], sensitiveValues: [] }
    });
    assert.equal(result.text, 'East 15，South 7。');
    assert.match(requests[0].systemInstruction, /对话附件[\s\S]*sales\.csv（1 KB）/);
    assert.deepEqual(requests[0].tools.map(tool => tool.name).filter(name => !['update_plan', 'ask_user', 'calculate'].includes(name)).sort(), ['diff_files', 'query_data', 'read_document', 'read_file']);
    const [query, foreign, relative, write] = requests[1].messages.at(-1).toolResults;
    assert.match(query.content, /East\t15\nSouth\t7/);
    assert.equal(foreign.isError, true, 'another account\'s upload is refused');
    assert.equal(relative.isError, true, 'without a folder only full attachment paths work');
    assert.equal(write.isError, true);
    assert.equal(fs.readFileSync(saved.path, 'utf8'), 'region,amount\nEast,10\nEast,5\nSouth,7\n');
    assert.equal(filesAgent.toolset({ owner: 'default::alice', uploads: [] }), null);
});
