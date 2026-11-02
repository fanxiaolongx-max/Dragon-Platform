const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-tool-guides-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const guides = require('../backend/models/platform-tool-guides');
const extraTools = require('../backend/models/agent-extra-tools');
const appDb = require('../backend/models/app-db');
const tenantPool = require('../backend/models/tenant-sqlite-pool');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const GUIDE = `摘要：把各站点的指标做成健康度排名，找出短板

## 能做什么
- 按月生成排名

## 什么时候用
- 每个月要把站点指标整理成报表发给领导
- 想知道哪个客户群拖了后腿

## 怎么用
1. 打开报表看板

## 工作原理
读取入库的快照

## 注意事项
无`;

test('the catalog covers home page tools and reads their source for the model', async () => {
    const tools = await guides.catalog();
    const report = tools.find(tool => tool.id === 'page:/report');
    assert.ok(report, 'home page cards are part of the catalog');
    assert.equal(report.title, '报表看板');
    const monthly = tools.find(tool => tool.id === 'page:/monthly');
    assert.equal(monthly.page, 'ai-report', '/monthly maps to the AI report page source');
    const sources = guides._internal.readSources(report);
    assert.ok(sources.length > 1000 && sources.length <= 24100);
    assert.match(sources, /### pages\/report\.html/);
});

test('guides are generated only where missing, parsed into summary and body, and searchable by need', async () => {
    const prompts = [];
    const client = { model: 'mock-guide', async generateText({ prompt }) { prompts.push(prompt); return { text: GUIDE }; } };
    let job = await guides.startGeneration({ ids: ['page:/report'], client, reindex: false });
    assert.equal(job.total, 1);
    await guides._internal.jobs.get('default').promise;
    assert.match(prompts[0], /工具名称：报表看板[\s\S]*源码：/);
    const guide = await guides.readGuide('page:/report');
    assert.equal(guide.summary, '把各站点的指标做成健康度排名，找出短板');
    assert.match(guide.guide, /^## 能做什么/);
    assert.equal(guide.model, 'mock-guide');

    const state = await guides.status();
    assert.equal(state.items.find(item => item.id === 'page:/report').state, 'ready');
    assert.equal(state.ready, 1);
    assert.equal(state.missing, state.total - 1);

    // 「什么时候用」里的说法帮助按需求找到工具
    const found = await guides.findTools('每个月要把站点指标整理成报表发给领导');
    assert.equal(found[0].id, 'page:/report');
    assert.equal(found[0].hasGuide, true);

    const docs = await guides.documentsForIndex();
    assert.deepEqual(docs.map(doc => doc.path), ['tool-guides/page_report.md']);
    assert.match(docs[0].content, /入口：\/report[\s\S]*什么时候用/);

    // 已生成且源码没变的不再生成（这次的模型全部失败，不留下说明，只看排队范围）
    const failing = { model: 'down', async generateText({ prompt }) { prompts.push(prompt); throw new Error('model down'); } };
    job = await guides.startGeneration({ client: failing, reindex: false });
    assert.equal(job.total, state.missing);
    await guides._internal.jobs.get('default').promise;
    assert.ok(!prompts.slice(1).some(prompt => prompt.includes('工具名称：报表看板')));
    const after = await guides.status();
    assert.equal(after.job.failed.length, state.missing, 'failures are reported per tool');
    assert.equal(after.ready, 1);
});

test('Dragon Claw gets a read-only platform tool guide group, also for read-only accounts', async () => {
    const sets = await extraTools.toolsets({ owner: 'default::viewer', readOnly: true });
    assert.deepEqual(sets.map(set => set.id), ['platform_tools']);
    const set = sets[0];
    assert.equal(set.kindOf('find_platform_tools'), 'read');
    const found = await set.execute({ name: 'find_platform_tools', args: { query: '站点指标报表' } });
    assert.match(found.content, /\[报表看板\]\(\/report\)/);
    const read = await set.execute({ name: 'read_tool_guide', args: { tool: '报表看板' } });
    assert.match(read.content, /# 报表看板[\s\S]*摘要：把各站点[\s\S]*## 怎么用/);
    const fallback = await set.execute({ name: 'read_tool_guide', args: { tool: '/uivf12' } });
    assert.match(fallback.content, /还没有生成使用说明/);
    const missing = await set.execute({ name: 'read_tool_guide', args: { tool: '不存在的工具xyz' } });
    assert.equal(missing.isError, true);
});

test('guide parsing tolerates fences and missing summaries', () => {
    assert.deepEqual(guides._internal.parseGuide('```markdown\n摘要：A\n\n## 能做什么\nB\n```'), { summary: 'A', guide: '## 能做什么\nB' });
    assert.equal(guides._internal.parseGuide('## 能做什么\nB').summary, '');
});
