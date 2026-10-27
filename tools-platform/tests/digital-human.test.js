const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-human-test-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');

const configRepo = require('../backend/models/digital-human/config-repository');
const client = require('../backend/models/digital-human/base-client');
const catalog = require('../backend/models/digital-human/table-catalog');
const agent = require('../backend/models/digital-human/netcare-agent');

// 截图里的写报告服务 .env（APP SCHEMA 故意写成 OCR 常见的空格形式）
const ENV_TEXT = `# =====
# 运营数字人 - 写报告服务配置文件
APP_NAME=写报告服务
DEBUG=true
PORT=5600
WORKERS=1
RELOAD=true
CORS_ORIGINS=["http://localhost:5600","http://127.0.0.1:5600"]
BASE_QUERY_URL=https://netcareclaw-beta.icta138.huawei.com/digital-human/api/dh/query
APP_DATASOURCE_ID=2
APP SCHEMA=eca61f00-e292-48ae-8767-c57826706e6a
APP_UUID = eca61f00-e292-48ae-8767-c57826706e6a
APP_LEVEL=BUSINESS
BUSINESS_DATASOURCE_NAME=netcareClaw-operate-digital-readonly
HTTP_TIMEOUT=15
HTTP_VERIFY_SSL=false
`;

// ── 假基座：按 SQL 返回不同形态的结果，记录请求体与身份头 ──
const requests = [];
const BIG_TOTAL = 2500;
function reply(res, body, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}
const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (req.url.startsWith('/digital-human/api/dh/query/datasources')) return reply(res, { code: 0, data: [{ name: 'netcareClaw-operate-digital-readonly' }, { id: 2 }] });
        if (req.url === '/digital-human/api/dh/execute') return reply(res, { code: 0, message: 'success', data: { affectedRows: 2 } });
        const sql = body?.sql || '';
        if (sql === 'SELECT 1 AS ok') return reply(res, { code: 0, data: [{ ok: 1 }] });
        if (/COUNT\(\*\) AS table_count/.test(sql)) return reply(res, { code: 0, data: [{ table_count: 4 }] });
        if (/FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'netcare' ORDER BY/.test(sql)) {
            return reply(res, { code: 0, data: { rows: [
                { NAME: 'common_data_rep', COMMENT: '', EST_ROWS: 546, TABLE_TYPE: 'BASE TABLE' },
                { name: 'brand_new_risk_dws', comment: '', est_rows: 10, table_type: 'BASE TABLE' },
                { name: 'op_ioc_alarm_d_dws_0', comment: '', est_rows: 7589 },
                { name: 'op_ioc_alarm_d_dws_1', comment: '', est_rows: 7610 }
            ] } });
        }
        if (/GROUP BY TABLE_NAME/.test(sql)) return reply(res, { code: 0, data: [{ name: 'common_data_rep', column_count: 5 }, { name: 'brand_new_risk_dws', column_count: 2 }] });
        if (/information_schema.COLUMNS WHERE TABLE_SCHEMA = 'netcare' AND TABLE_NAME = 'common_data_rep'/.test(sql)) {
            const names = ['rep_id', 'region_code', 'dept_code', 'CHANGE_TIME', 'rep_name_en'];
            return reply(res, { code: 0, data: names.map((name, index) => ({ name, data_type: index === 3 ? 'bigint' : 'varchar', column_type: '', comment: '', nullable: 'YES', column_key: index ? '' : 'PRI', position: index + 1 })) });
        }
        if (/information_schema.COLUMNS WHERE TABLE_SCHEMA = 'netcare' AND TABLE_NAME = 'big'/.test(sql)) return reply(res, { code: 0, data: [{ name: 'id' }, { name: 'bg' }] });
        if (/^SELECT \* FROM `netcare`.`common_data_rep` LIMIT/.test(sql)) {
            return reply(res, { code: 0, data: [
                { rep_id: 720552, region_code: '050133', dept_code: 'SNULL', CHANGE_TIME: 1783906478198, rep_name_en: 'Gulf' },
                { rep_id: 720553, region_code: '027425', dept_code: '077572', CHANGE_TIME: 1783906478199, rep_name_en: 'China' }
            ] });
        }
        // 大表分页：用 columns + 二维数组的返回形态
        const page = /FROM `?netcare`?\.`?big`?.* LIMIT (\d+) OFFSET (\d+)$/.exec(sql);
        if (page) {
            const [size, offset] = [Number(page[1]), Number(page[2])];
            const rows = [];
            for (let id = offset; id < Math.min(BIG_TOTAL, offset + size); id += 1) rows.push([id, id % 2 ? 'EBG' : 'CNBG']);
            return reply(res, { code: 0, data: { columns: ['id', 'bg'], rows } });
        }
        if (/GROUP BY `bg`/.test(sql)) return reply(res, { code: 0, data: [{ bg: 'EBG', row_count: 1250 }, { bg: 'CNBG', row_count: 1250 }] });
        if (/boom/.test(sql)) return reply(res, { code: 500, message: "Table 'netcare.boom' doesn't exist" });
        return reply(res, { code: 0, data: [] });
    });
});

let baseUrl = '';
test.before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/digital-human/api/dh/query`;
});
test.after(() => {
    server.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

async function useMockBase() {
    const parsed = configRepo.parseEnvText(ENV_TEXT);
    return configRepo.saveConfig({ ...parsed.patch, baseQueryUrl: baseUrl, enabled: true });
}

test('.env text from the report service imports base, datasource and identity, ignoring FastAPI keys', () => {
    const parsed = configRepo.parseEnvText(ENV_TEXT);
    assert.deepEqual(parsed.warnings, []);
    assert.deepEqual(parsed.unknown, []);
    assert.deepEqual(parsed.ignored.sort(), ['CORS_ORIGINS', 'DEBUG', 'PORT', 'RELOAD', 'WORKERS']);
    assert.equal(parsed.patch.baseQueryUrl, 'https://netcareclaw-beta.icta138.huawei.com/digital-human/api/dh/query');
    assert.equal(parsed.patch.appSchema, 'eca61f00-e292-48ae-8767-c57826706e6a');
    assert.equal(parsed.patch.appUuid, 'eca61f00-e292-48ae-8767-c57826706e6a');
    const config = configRepo.normalizeConfig(parsed.patch);
    assert.equal(config.timeoutSec, 15);
    assert.equal(config.verifySsl, false);
    assert.equal(configRepo.apiBase(config), 'https://netcareclaw-beta.icta138.huawei.com/digital-human/api/dh');
    assert.match(configRepo.parseEnvText('BASE_QUERY_URL=ftp://x').warnings[0], /http/);
    assert.match(configRepo.parseEnvText('hello world').warnings[0], /没有识别/);
});

test('default config points at the beta base and stays disabled until imported', async () => {
    const config = await configRepo.getConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.baseQueryUrl, configRepo.DEFAULT_QUERY_URL);
    assert.equal(config.appUuid, '');
    await assert.rejects(client.queryPage('SELECT 1 AS ok'), { code: 'DH_DISABLED' });
});

test('read-only and app-write SQL guards', () => {
    assert.doesNotThrow(() => client.assertReadOnly('SELECT update_time, create_time FROM t WHERE is_delete = 0'));
    assert.doesNotThrow(() => client.assertReadOnly("SELECT 'drop table x; delete' AS note"));
    assert.doesNotThrow(() => client.assertReadOnly('WITH a AS (SELECT 1) SELECT * FROM a;'));
    assert.throws(() => client.assertReadOnly('SELECT 1; DROP TABLE t'), { code: 'DH_SQL_MULTI' });
    assert.throws(() => client.assertReadOnly('UPDATE t SET a = 1'), { code: 'DH_SQL_NOT_READ' });
    assert.throws(() => client.assertReadOnly('SELECT * FROM t INTO OUTFILE "/tmp/x"'), { code: 'DH_SQL_NOT_READ' });
    assert.equal(client.assertAppWrite('DELETE FROM t_report_block WHERE id = 3').kind, 'delete');
    assert.throws(() => client.assertAppWrite('UPDATE t_report_block SET order_no = 1'), { code: 'DH_SQL_NO_WHERE' });
    assert.throws(() => client.assertAppWrite('DROP TABLE t_report_block'), { code: 'DH_SQL_NOT_WRITE' });
    assert.equal(client.hasTopLevelLimit('SELECT * FROM (SELECT * FROM t LIMIT 5) x'), false);
    assert.equal(client.hasTopLevelLimit('SELECT * FROM t LIMIT 5'), true);
});

test('queries go straight to the base with the right body and identity headers, and page past 1000 rows', async () => {
    await useMockBase();
    requests.length = 0;
    const app = await client.queryPage('SELECT 1 AS ok', { scope: 'app' });
    assert.deepEqual(app.rows, [{ ok: 1 }]);
    assert.deepEqual(requests[0].body, { datasourceId: 2, schema: 'eca61f00-e292-48ae-8767-c57826706e6a', sql: 'SELECT 1 AS ok', limit: 1000 });
    assert.equal(requests[0].headers['x-app-id'], 'eca61f00-e292-48ae-8767-c57826706e6a');
    assert.equal(requests[0].headers['x-app-level'], 'BUSINESS');

    requests.length = 0;
    const all = await client.queryAll('SELECT * FROM netcare.big ORDER BY id');
    assert.equal(all.rows.length, BIG_TOTAL);
    assert.equal(all.pages, 3);
    assert.equal(all.truncated, false);
    assert.deepEqual(all.rows[1001], { id: 1001, bg: 'EBG' });
    assert.equal(requests[0].body.datasourceName, 'netcareClaw-operate-digital-readonly');
    assert.match(requests[2].body.sql, /LIMIT 1000 OFFSET 2000$/);

    const capped = await client.queryAll('SELECT * FROM netcare.big ORDER BY id', { maxRows: 1500 });
    assert.equal(capped.rows.length, 1500);
    assert.equal(capped.truncated, true);

    await assert.rejects(client.queryPage('SELECT * FROM boom'), error => error.code === 'DH_BASE_ERROR' && /doesn't exist/.test(error.message) && /boom/.test(error.raw));
});

test('app schema writes use /execute and return affected rows', async () => {
    await useMockBase();
    requests.length = 0;
    const result = await client.executeApp("UPDATE t_report_template SET status = 'published' WHERE id = 1");
    assert.equal(result.affectedRows, 2);
    assert.equal(requests[0].url, '/digital-human/api/dh/execute');
    assert.equal(requests[0].body.schema, 'eca61f00-e292-48ae-8767-c57826706e6a');
    assert.equal(requests[0].headers['x-app-id'], 'eca61f00-e292-48ae-8767-c57826706e6a');
});

test('connection test reports each step, including base errors and unreachable hosts', async () => {
    const config = await useMockBase();
    const ok = await client.testConnection(config);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.steps.map(step => step.id), ['datasources', 'business', 'business-tables', 'app']);
    assert.match(ok.steps[2].summary, /4 张表/);
    const down = await client.testConnection({ ...config, baseQueryUrl: 'http://127.0.0.1:1/digital-human/api/dh/query', timeoutSec: 3 });
    assert.equal(down.ok, false);
    assert.ok(down.steps.every(step => step.code === 'DH_NETWORK'));
});

test('catalog merges live tables with the audit seed and admin notes', async () => {
    await useMockBase();
    catalog.invalidate();
    const result = await catalog.listTables({ scope: 'business', refresh: true });
    assert.equal(result.live, true);
    const byName = Object.fromEntries(result.tables.map(item => [item.name, item]));
    assert.equal(byName.brand_new_risk_dws.isNew, true);
    assert.equal(byName.brand_new_risk_dws.category, '风险');
    assert.equal(byName.brand_new_risk_dws.grain, 'DWS汇总');
    assert.equal(byName.common_data_rep.status, 'live');
    assert.equal(byName.common_data_rep.module, '公共数据');
    assert.equal(byName.op_ioc_alarm_d_dws_0.family, 'op_ioc_alarm_d_dws');
    // 种子里有、库里没有的表标为 missing
    assert.equal(byName.op_ioc_rectify_check_d_dwd.status, 'missing');
    assert.equal(result.stats.isNew, 1);
    // 同事标注核实有误的表用核实后的名字
    assert.equal(byName.nc_mec_jtf_tasks_b_5600_dwd.nameCn, 'TASK 表（ICARE+ 运营商）');

    await catalog.saveNote('business', 'common_data_rep', { nameCn: '代表处维表', timeField: 'CHANGE_TIME', verified: true, description: '代表处编码与名称' }, 'admin');
    const again = await catalog.listTables({ scope: 'business' });
    const rep = again.tables.find(item => item.name === 'common_data_rep');
    assert.equal(rep.nameCn, '代表处维表');
    assert.equal(rep.nameCnSource, 'note');
    assert.equal(rep.verified, true);
    assert.equal(again.stats.verified, 1);
    await assert.rejects(catalog.saveNote('business', 'bad name;', {}), { code: 'DH_BAD_IDENT' });
});

test('catalog falls back to the seed when the base is unreachable', async () => {
    const config = await useMockBase();
    await configRepo.saveConfig({ ...config, baseQueryUrl: 'http://127.0.0.1:1/digital-human/api/dh/query', timeoutSec: 3 });
    const result = await catalog.listTables({ scope: 'business', refresh: true });
    assert.equal(result.live, false);
    assert.equal(result.tables.length >= catalog.SEED_COUNT, true);
    assert.ok(result.tables.every(item => item.status === 'offline'));
    assert.match(result.error, /无法连接基座/);
});

test('describe profiles fields and the structured query validates columns', async () => {
    await useMockBase();
    const detail = await catalog.describeTable('business', 'common_data_rep');
    const field = name => detail.columns.find(column => column.name === name);
    assert.equal(field('region_code').role, 'region');
    assert.equal(field('CHANGE_TIME').role, 'time');
    assert.deepEqual(field('CHANGE_TIME').kinds, ['epoch-ms']);
    assert.deepEqual(field('dept_code').sentinels, ['SNULL']);
    assert.equal(detail.suggestions.regionField, 'region_code');
    assert.ok(detail.hints.some(text => /毫秒时间戳/.test(text)));
    assert.ok(detail.hints.some(text => /占位值/.test(text)));

    const config = await configRepo.getConfig();
    const sql = catalog.buildSelect(config, 'business', {
        table: 'big', filters: [{ column: 'BG', op: 'in', value: ['EBG', "x'y"] }, { column: 'id', op: 'between', value: [1, 9] }],
        groupBy: ['bg'], metrics: [{ agg: 'count', as: 'row_count' }], orderBy: 'row_count', limit: 10
    }, ['id', 'bg']);
    assert.equal(sql, "SELECT `bg`, COUNT(*) AS `row_count` FROM `netcare`.`big` WHERE `bg` IN ('EBG', 'x''y') AND `id` BETWEEN 1 AND 9 GROUP BY `bg` ORDER BY `row_count` DESC LIMIT 10");
    // 分组时按非分组字段排序会被 MySQL 拒绝：改按第一个聚合排序
    assert.match(catalog.buildSelect(config, 'business', { table: 'big', groupBy: ['bg'], metrics: [{ agg: 'count', as: 'n' }], orderBy: 'id' }, ['id', 'bg']), /GROUP BY `bg` ORDER BY `n` DESC/);
    assert.match(catalog.buildSelect(config, 'business', { table: 'big', groupBy: ['bg'], metrics: [{ agg: 'count', as: 'n' }], orderBy: 'BG', order: 'asc' }, ['id', 'bg']), /ORDER BY `bg` ASC/);
    assert.throws(() => catalog.buildSelect(config, 'business', { table: 'big', filters: [{ column: 'id; drop', op: '=', value: 1 }] }, ['id']), { code: 'DH_UNKNOWN_COLUMN' });
    assert.throws(() => catalog.buildSelect(config, 'business', { table: 'big', filters: [{ column: 'id', op: 'or 1=1 --', value: 1 }] }, ['id']), { code: 'DH_BAD_OP' });

    const grouped = await catalog.queryTable('business', { table: 'big', groupBy: ['bg'], metrics: [{ agg: 'count', as: 'row_count' }] });
    assert.deepEqual(grouped.rows.map(row => row.bg), ['EBG', 'CNBG']);
    const paged = await catalog.queryTable('business', { table: 'big', orderBy: 'id', order: 'asc', limit: 1200 });
    assert.equal(paged.rows.length, 1200);
});

test('@netcare-data tools answer from the base and report errors instead of throwing', async () => {
    await useMockBase();
    catalog.invalidate();
    const tables = await agent.execute('netcare_tables', { keyword: 'risk' });
    assert.match(tables.content, /brand_new_risk_dws/);
    const described = await agent.execute('netcare_describe', { table: 'common_data_rep' });
    assert.match(described.content, /region_code \| varchar/);
    const queried = await agent.execute('netcare_query', { table: 'big', groupBy: ['bg'], metrics: [{ agg: 'count', as: 'row_count' }] });
    assert.match(queried.content, /SQL: SELECT `bg`, COUNT\(\*\)/);
    const refused = await agent.execute('netcare_sql', { sql: 'DELETE FROM netcare.big WHERE id = 1' });
    assert.equal(refused.isError, true);
    assert.match(refused.content, /只允许查询语句/);
    assert.deepEqual(agent.definitions().map(item => item.name), agent.TOOL_NAMES);
});

test('@netcare-data runs a tool loop and streams tool rows', async () => {
    await useMockBase();
    const events = [];
    const calls = [];
    const fakeClient = {
        async generateText(request) {
            calls.push(request);
            if (calls.length === 1) return { text: '', toolCalls: [{ id: 'c1', name: 'netcare_query', args: { table: 'big', groupBy: ['bg'], metrics: [{ agg: 'count', as: 'row_count' }] } }], usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15 } };
            return { text: 'EBG 与 CNBG 各 1250 行', usage: { promptTokens: 20, outputTokens: 8, totalTokens: 28 } };
        }
    };
    const result = await agent.runTurn({ client: fakeClient, systemInstruction: 'sys', messages: [{ role: 'user', content: '各 BG 多少行' }], onEvent: event => events.push(event) });
    assert.equal(result.text, 'EBG 与 CNBG 各 1250 行');
    assert.deepEqual(events.map(event => event.type), ['tool_start', 'tool_result']);
    assert.equal(events[1].ok, true);
    assert.match(calls[1].messages.at(-1).toolResults[0].content, /row_count/);
    assert.equal(result.usage.totalTokens, 43);
});

test('netcare-data skill is a non-workspace builtin skill and the API is mounted admin-only', () => {
    const skills = require('../backend/models/agent-skills');
    const skill = skills.list().find(item => item.id === agent.SKILL_ID);
    assert.equal(skill.workspace, false);
    assert.deepEqual(skills.select('@netcare-data 查一下风险表').map(item => item.id), ['netcare-data']);
    const server = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    assert.match(server, /app\.use\('\/api\/digital-human', requireAdmin, require\('\.\/routes\/digital-human'\)\)/);
});
