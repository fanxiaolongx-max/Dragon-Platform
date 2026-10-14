const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-tool-data-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const service = require('../backend/models/ai-tool-data-service');
const customToolsRepo = require('../backend/models/custom-tools-repository');
const snapshotsRepo = require('../backend/models/custom-tools-snapshots-repository');
const { closeDatabase } = require('../backend/models/app-db');

const NOW = new Date('2026-10-14T20:00:00');
let SLUG = '';

test.after(async () => {
    await closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

async function installDiningTool() {
    const tool = await customToolsRepo.createTool({
        slug: 'tool-dining-test',
        name: '营业流水刷卡与微信就餐统计',
        nameEn: 'Card & WeChat Dining Statistics',
        icon: '🍽️',
        description: '就餐统计',
        tags: ['营业流水', '就餐统计'],
        htmlContent: `<!doctype html><html><body><script>
            const STORAGE_KEY = 'diningLocalNotesV1';
            localStorage.setItem('diningThemeLang', 'zh');
            localStorage.setItem('dining-shared-secret-v1', 'x');
            fetch(\`/api/custom-tools/\${slug}/snapshots\`);
        </script></body></html>`
    });
    SLUG = tool.slug;
    await snapshotsRepo.addSnapshot(SLUG, {
        id: 'snap-sept',
        name: '就餐快照 2026/10/13 20:54',
        timestamp: '2026-10-13T17:54:32.808Z',
        summary: { cardCount: 3, wechatCount: 2, totalTransactions: 5, dateRange: '2026-09-01 至 2026-09-30', savedAt: '2026/10/13 20:54:31' },
        payload: {
            cardData: {
                headers: ['序号', '姓名', '交易时间', '交易金额', '餐别'],
                rawRows: [
                    ['1', '甲', '2026-09-01 08:00:00', '35', '早餐'],
                    ['2', '乙', '2026-09-01 12:00:00', '70', '中餐'],
                    ['3', '丙', '2026-09-02 12:10:00', '70', '中餐']
                ]
            },
            exportStatsData: [
                { 日期: '2026-09-01', 日合计: 1 },
                { 日期: '2026-09-02', 日合计: 1 },
                { 日期: '总计', 日合计: 2 }
            ]
        }
    });
}

test('time windows resolve relative and explicit months', () => {
    assert.deepEqual(service.parseWindow('上个月一共多少人次', NOW), { start: '2026-09-01', end: '2026-09-30', label: '上个月' });
    assert.equal(service.parseWindow('8月的呢', NOW).start, '2026-08-01');
    assert.equal(service.parseWindow('11月的数据', NOW).start, '2025-11-01');
    assert.equal(service.parseWindow('2026年2月', NOW).end, '2026-02-28');
    assert.equal(service.parseWindow('写一封邮件', NOW), null);
});

test('snapshot period prefers explicit ranges over save timestamps', () => {
    assert.deepEqual(service.periodFrom({ dateRange: '2026-09-01 至 2026-09-30', savedAt: '2026/10/13 20:54:31' }), { start: '2026-09-01', end: '2026-09-30' });
    assert.equal(service.periodFrom({ savedAt: '2026/10/13' }, '2026年8月就餐').start, '2026-08-01');
});

test('digest separates table total rows and skips summing identifier fields', () => {
    const text = service.digestValue({
        headers: ['序号', '工号', '金额'],
        rows: [['1', '1001', '10'], ['2', '1002', '20']],
        stats: [{ 日期: '2026-09-01', 合计: 3 }, { 日期: '2026-09-02', 合计: 4 }, { 日期: '总计', 合计: 7 }]
    }, '数据');
    assert.match(text, /stats：2 行（另有 1 行表内合计/);
    assert.match(text, /表内合计行：日期=总计; 合计=7/);
    assert.match(text, /合计：合计 7，/);
    assert.match(text, /序号：2 个不同编号/);
    assert.match(text, /金额：合计 30/);
});

test('dining question reads the matching snapshot and reports missing periods honestly', async () => {
    await installDiningTool();
    const september = await service.analyzeQuestion('你能看到营业流水和微信就餐上个月一共多少人次吃饭吗', { now: NOW });
    assert.equal(september.tools.length, 1);
    assert.equal(september.tools[0].slug, SLUG);
    assert.equal(september.tools[0].sources[0].selected[0].period.start, '2026-09-01');
    assert.match(september.prompt, /"totalTransactions":5/);
    assert.match(september.prompt, /cardData\.rawRows：3 行/);
    assert.match(september.prompt, /表内合计行/);

    const august = await service.analyzeQuestion('那8月的营业流水就餐人次呢', { now: NOW });
    assert.match(august.prompt, /没有覆盖 2026-08-01 至 2026-08-31 的快照/);

    const unrelated = await service.analyzeQuestion('帮我写一封催办邮件', { now: NOW });
    assert.equal(unrelated.performed, false);
});

test('browser-local data is digested, but secret-looking keys are never used', async () => {
    const result = await service.analyzeQuestion('营业流水就餐最近的记录情况', {
        now: NOW,
        clientToolData: [
            { slug: SLUG, key: 'diningLocalNotesV1', value: JSON.stringify([{ 日期: '2026-10-01', 人数: 3 }, { 日期: '2026-10-02', 人数: 4 }]) },
            { slug: SLUG, key: 'dining-shared-secret-v1', value: 'should-not-appear' }
        ]
    });
    const local = result.tools[0].sources.find(source => source.kind === 'browser-local');
    assert.equal(local.count, 1);
    assert.match(result.prompt, /人数：合计 7/);
    assert.doesNotMatch(result.prompt, /should-not-appear/);

    const keys = service.listLocalStorageKeys(await customToolsRepo.listTools());
    assert.deepEqual(keys[SLUG], ['diningLocalNotesV1']);
});

test('chat route feeds tool data into grounding and the prompt', () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/routes/ai.js'), 'utf8');
    assert.match(source, /aiToolDataService\.analyzeQuestion\(question, \{ contextQuestion, toolSlug, clientToolData \}\)/);
    assert.match(source, /平台工具业务数据（只读/);
    assert.match(source, /4\.9 用户询问某个平台工具里的数据/);
    assert.match(source, /router\.get\('\/tool-local-keys', checkAuth/);
});
