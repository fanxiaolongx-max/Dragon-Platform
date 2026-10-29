const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-adc-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const bridge = require('../backend/models/hosted-apps/adc-bridge');
const tenant = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const alice = { u: 'alice', s: 'aiops-report' }, bob = { u: 'bob', s: 'aiops-report' };
const call = (route, method = 'GET', body = {}, claims = alice) => bridge.dispatch(route, method, body, claims, async ({ messages }) => ({ text: '回答：' + messages.at(-1).content }));
test.after(async () => { await require('../backend/models/hosted-apps/data-api').closeAppDatabase('default', 'aiops-report'); await appDb.closeDatabase(); await require('../backend/models/platform-db').closeDatabase(); fs.rmSync(sandbox, { recursive: true, force: true }); });
test('ADC bridge persists conversation, follows platform models and isolates owner, app and tenant', async () => {
    const { id } = await call('/sessions', 'POST');
    const choices = await call('/models');
    assert.ok(choices.models.length);
    assert.ok(!JSON.stringify(choices).includes('apiKey'));
    const answer = await call('/chat', 'POST', { sessionId: id, message: '1+1' });
    assert.equal(answer.text, '回答：1+1');
    assert.equal((await call('/sessions/' + id)).messages.length, 2);
    assert.equal((await call('/sessions')).sessions[0].title, '1+1');
    await assert.rejects(call('/sessions/' + id, 'GET', {}, bob), { status: 404 });
    await assert.rejects(call('/sessions/' + id, 'GET', {}, { ...alice, s: 'other-app' }), { status: 404 });
    await tenant.runWithTenant('adc-other', async () => {
        assert.deepEqual((await call('/sessions')).sessions, []);
        await assert.rejects(call('/sessions/' + id), { status: 404 });
    });
    await assert.rejects(call('/chat', 'POST', { sessionId: id, message: '' }), { status: 400 });
    await assert.rejects(call('/chat', 'POST', { sessionId: id, message: 'a'.repeat(20001) }), { status: 400 });
});
test('provider errors do not commit broken turns and concurrent sends are rejected', async () => {
    const { id } = await call('/sessions', 'POST');
    let release;
    const generation = bridge.dispatch('/chat', 'POST', { sessionId: id, message: 'hello' }, alice, () => new Promise(resolve => { release = resolve; }));
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(call('/chat', 'POST', { sessionId: id, message: 'overlap' }), { status: 409 });
    release({ text: 'world' }); await generation;
    await assert.rejects(bridge.dispatch('/chat', 'POST', { sessionId: id, message: 'fail' }, alice, async () => { throw Error('provider error'); }));
    assert.equal((await call('/sessions/' + id)).messages.length, 2);
});
test('stopped generation is not committed', async () => {
    const { id } = await call('/sessions', 'POST');
    const controller = new AbortController();
    await assert.rejects(bridge.dispatch('/chat', 'POST', { sessionId: id, message: 'stop', signal: controller.signal }, alice, async () => { controller.abort(); return { text: 'late result' }; }), { status: 499 });
    assert.equal((await call('/sessions/' + id)).messages.length, 0);
});
test('HTML adaptation is narrow and leaves business scripts and unrelated applications intact', () => {
    const html = '<html><script>\n/*\n * ADCChat v1.4 example\n */\nwindow.ADCChat = {};\n</script><iframe id="aiBarFrame"></iframe><script>const onSite = ADC_ORIGINS.includes(location.origin); frame.src = location.origin +\n\'/adc-agent/static/deepagent-sandbox/index.html?project_name=OperationsDigitalHuman\' +\n\'&module_name=OperationsDigitalHuman&deepAgent_name=agent_OperationsDigitalHuman\'; fetch("/api/reports");</script></html>';
    const adapted = bridge.adaptHtml(html, '/apps/test/~signed');
    assert.match(adapted, /__platform\/adc\/client.js/);
    assert.match(adapted, /const onSite = true;/);
    assert.match(adapted, /frame.src = window.ADCChat.chatUrl;/);
    assert.ok(adapted.includes('fetch("/api/reports")'));
    assert.equal(bridge.adaptHtml('<h1>ordinary app</h1>', '/apps/test'), '<h1>ordinary app</h1>');
});

test('ADC data tools query real app/business tables, reject writes/secrets and keep tenant scope', async () => {
    const runtime = require('../backend/models/hosted-apps/runtime');
    const data = require('../backend/models/hosted-apps/data-api');
    const tools = require('../backend/models/hosted-apps/adc-data-tools');
    const sqlite3 = require('sqlite3');
    const state = runtime.createApp('aiops-report', { files: [], config: { name: 'AiOps', entry: 'app:app' } });
    const app = { slug: 'aiops-report', uuid: state.uuid, tenantId: 'default' };
    await data.execute(app, { datasourceId: 'app', schema: state.uuid, sql: 'CREATE TABLE reports(id INTEGER, title TEXT, api_key TEXT)' });
    await data.execute(app, { datasourceId: 'app', schema: state.uuid, sql: "INSERT INTO reports VALUES (1,'月报','never-send-secret')" });
    fs.mkdirSync(process.env.TOOLS_REPORT_DATA_DIR, { recursive: true });
    const business = new sqlite3.Database(path.join(process.env.TOOLS_REPORT_DATA_DIR, 'report.db'));
    await new Promise((resolve, reject) => business.exec("CREATE TABLE incidents(id INTEGER, region TEXT); INSERT INTO incidents VALUES(1,'EMEA'),(2,'APAC');", error => error ? reject(error) : resolve()));
    await new Promise(resolve => business.close(resolve));
    const access = await tools.create('aiops-report');
    const exec = (name, args) => access.execute({ name, args });
    assert.ok((await exec('adc_sources', {})).sources.some(item => item.source === 'platform:report.db'));
    assert.ok((await exec('adc_schema', { source: 'app' })).rows.some(item => item.name === 'reports'));
    assert.ok(!(await exec('adc_schema', { source: 'app', table: 'reports' })).rows.some(item => item.name === 'api_key'));
    assert.deepEqual((await exec('adc_query', { source: 'app', sql: 'SELECT id,title FROM reports' })).rows, [{ id: 1, title: '月报' }]);
    assert.equal((await exec('adc_query', { source: 'netcare', sql: 'SELECT COUNT(*) AS total FROM incidents' })).rows[0].total, 2);
    for (const sql of ['DELETE FROM reports', 'SELECT * FROM reports', 'SELECT api_key FROM reports', "ATTACH DATABASE '/tmp/other.db' AS other"]) {
        await assert.rejects(exec('adc_query', { source: 'app', sql }));
    }
    await assert.rejects(exec('adc_query', { source: 'platform:tools.db', sql: 'SELECT * FROM hosted_adc_sessions' }));
    await assert.rejects(exec('adc_query', { source: 'other-app', sql: 'SELECT 1' }));
    await tenant.runWithTenant('isolated-data', async () => {
        assert.equal((await tools.create('aiops-report')).tools.length, 0);
    });
    let step = 0;
    const { id } = await call('/sessions', 'POST');
    const result = await bridge.dispatch('/chat', 'POST', { sessionId: id, message: '业务库有多少工单？' }, alice, async options => {
        assert.ok(options.tools.some(tool => tool.name === 'adc_query'));
        step++;
        if (step === 1) return { text: '', toolCalls: [{ id: 'schema', name: 'adc_schema', args: { source: 'netcare', table: 'incidents' } }] };
        if (step === 2) return { text: '', toolCalls: [{ id: 'count', name: 'adc_query', args: { source: 'netcare', sql: 'SELECT COUNT(*) AS total FROM incidents' } }] };
        const result = JSON.parse(options.messages.at(-1).toolResults[0].content);
        assert.equal(result.rows[0].total, 2);
        return { text: '当前业务库有2条工单。' };
    });
    assert.equal(step, 3);
    assert.match(result.text, /2条工单/);
    assert.match(result.text, /SELECT COUNT/);
    assert.equal((await call('/sessions/' + id)).messages.length, 2, 'only user/final answer saved, not raw query data');
});
test('database questions cannot present invented tables when the model skips tools', async () => {
    const tools = require('../backend/models/hosted-apps/adc-data-tools');
    let calls = 0;
    const result = await tools.answer({
        options: { messages: [{ role: 'user', content: '你能看到哪些数据库表？' }], systemInstruction: '' },
        access: { tools: [{ name: 'adc_schema' }], context: 'test' }, clean: value => value,
        generate: async () => { calls++; return { text: '我能读取 Invented_Table。' }; }
    });
    assert.equal(calls, 2);
    assert.doesNotMatch(result.text, /Invented_Table/);
    assert.match(result.text, /未取得业务数据/);
});

test('table inventory is read by server even when model never calls tools', async () => {
    const tools = require('../backend/models/hosted-apps/adc-data-tools');
    const access = await tools.create('aiops-report');
    const result = await tools.answer({ access, clean: value => value,
        options: { messages: [{ role: 'user', content: '你能看到什么数据表' }], systemInstruction: '' },
        generate: async () => { throw new Error('inventory must not depend on model calls'); }
    });
    assert.match(result.text, /reports/);
    assert.match(result.text, /incidents/);
    assert.doesNotMatch(result.text, /hosted_adc_sessions/);
    assert.match(result.text, /已实时查询/);
});
test('models without native function calls can query through validated JSON plans', async () => {
    const tools = require('../backend/models/hosted-apps/adc-data-tools');
    const access = await tools.create('aiops-report');
    let step = 0;
    const result = await tools.answer({ access, clean: value => value,
        options: { messages: [{ role: 'user', content: '统计工单数量' }], systemInstruction: '' },
        generate: async options => {
            step++;
            if (step === 1) return { text: '无法直接查库' };
            assert.equal(options.tools, undefined);
            if (step === 2) return { text: JSON.stringify({ tool: 'adc_schema', args: { source: 'netcare', table: 'incidents' } }) };
            if (step === 3) return { text: JSON.stringify({ tool: 'adc_query', args: { source: 'netcare', sql: 'SELECT COUNT(*) AS total FROM incidents' } }) };
            assert.match(options.messages.at(-1).content, /total/);
            return { text: JSON.stringify({ answer: '工单数量为 2。' }) };
        }
    });
    assert.match(result.text, /数量为 2/); assert.match(result.text, /SELECT COUNT/);
});
test('JSON plans retain SQL guards and expose safe query failures rather than model advice', async () => {
    const tools = require('../backend/models/hosted-apps/adc-data-tools');
    const access = await tools.create('aiops-report');
    let step = 0;
    const result = await tools.answer({ access, clean: value => value,
        options: { messages: [{ role: 'user', content: '查询工单' }], systemInstruction: '' },
        generate: async () => {
            step++;
            if (step === 1) return { text: 'no tool' };
            if (step === 2) return { text: JSON.stringify({ tool: 'adc_query', args: { source: 'netcare', sql: 'DELETE FROM incidents' } }) };
            return { text: JSON.stringify({ answer: '已删除' }) };
        }
    });
    assert.match(result.text, /实际数据库查询失败/);
    assert.doesNotMatch(result.text, /已删除/);
    const count = await access.execute({ name: 'adc_query', args: { source: 'netcare', sql: 'SELECT COUNT(*) AS total FROM incidents' } });
    assert.equal(count.rows[0].total, 2);
});
