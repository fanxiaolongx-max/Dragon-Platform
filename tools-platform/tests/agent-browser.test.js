const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-browser-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const browser = require('../backend/models/agent-browser');
const extraTools = require('../backend/models/agent-extra-tools');
const registry = require('../backend/models/agent-tool-registry');
const manager = require('../backend/models/agent-run-manager');
const agentLoop = require('../backend/models/agent-loop');
const hasChrome = Boolean(browser.findChrome());

let server;
let base;
test.before(async () => {
    server = http.createServer((req, res) => {
        if (req.url.startsWith('/api/items')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ items: [{ name: '华东', amount: 150 }, { name: '华南', amount: 80 }] })); }
        if (req.url.startsWith('/search')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(`<title>结果</title><h1>搜索结果</h1><p>你搜索了 ${decodeURIComponent((req.url.split('q=')[1] || '').replace(/\+/g, ' '))}</p>`); }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<title>测试页</title><h1>销售看板</h1><table><tr><th>地区</th><th>金额</th></tr><tr><td>华东</td><td>150</td></tr></table>
            <a href="/search?q=link">详情</a><form action="/search"><input name="q" placeholder="搜索"><button>搜</button></form><div id="out"></div>
            <script>fetch('/api/items').then(r => r.json()).then(d => { document.getElementById('out').textContent = '接口条数 ' + d.items.length; console.error('loaded ' + d.items.length); });</script>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    browser.shutdownAll();
    server?.close();
    await new Promise(resolve => setTimeout(resolve, 500)); // 等 Chrome 退出、写完配置目录
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('browser tools open a page, read it, capture fetch responses and console, type and submit, and take screenshots', { skip: !hasChrome && '本机没有 Chrome / Edge' }, async () => {
    const ctx = { owner: 'default::alice' };
    const run = (name, args = {}) => browser.execute(ctx, name, args);
    assert.match((await run('browser_navigate', { url: 'file:///etc/passwd' })).content, /只能打开 http/);
    assert.match((await run('browser_snapshot')).content, /先用 browser_navigate/);
    assert.match((await run('browser_navigate', { url: `${base}/` })).content, /已打开 \[\w+\] 测试页/);
    const snap = (await run('browser_snapshot')).content;
    assert.match(snap, /## 销售看板[\s\S]*\| 华东 \| 150 \|[\s\S]*\[e1\] link "详情" → .*\/search\?q=link[\s\S]*\[e2\] textbox "搜索"[\s\S]*接口条数 2/);
    const network = (await run('browser_network', { type: 'fetch' })).content;
    assert.match(network, /共 1 个请求/);
    const requestId = network.split('\n')[1].split('\t')[0];
    assert.match((await run('browser_network_body', { requestId })).content, /"name":"华东","amount":150/);
    assert.match((await run('browser_console', { level: 'error' })).content, /\[error\] loaded 2/);
    assert.match((await run('browser_type', { ref: 'e2', text: '华东 销售', submit: true })).content, /当前页面：结果/);
    assert.match((await run('browser_snapshot')).content, /你搜索了 华东 销售/);
    const shot = await run('browser_screenshot');
    assert.ok(fs.statSync(shot.artifactPath).size > 1000);
    assert.ok(shot.artifactPath.startsWith(path.join(sandbox, 'data', 'agent-artifacts')));
    assert.match((await run('browser_evaluate', { expression: 'document.title' })).content, /结果/);
    assert.match((await run('browser_tabs')).content, /^\* \[\w+\] 结果/);
    const bob = await browser.execute({ owner: 'default::bob' }, 'browser_snapshot', {});
    assert.match(bob.content, /先用 browser_navigate/, 'each account has its own browser and tabs');
});

test('browser tools are an admin-only deferred group; navigate is approved per site in chats without a folder', { skip: !hasChrome && '本机没有 Chrome / Edge' }, async () => {
    assert.deepEqual(await extraTools.toolsets({ owner: 'default::guest', readOnly: true }), [], 'read-only accounts get no browser');
    const sets = await extraTools.toolsets({ owner: 'default::alice', readOnly: false });
    const reg = await registry.create({ session: { readOnly: false }, extraToolsets: sets });
    assert.ok(!reg.definitions().some(tool => tool.name.startsWith('browser_')), 'not sent up front');
    assert.match(reg.catalogPrompt(), /浏览器（本机 .*无界面）[\s\S]*分组 browser[\s\S]*browser_navigate/);
    assert.equal(browser.alwaysKey('browser_navigate', { url: `${base}/x` }), `browser_navigate@${new URL(base).host}`);

    const events = [];
    const write = event => {
        events.push(event);
        if (event.type === 'approval') setImmediate(() => manager.resolveApproval(event.id, events.filter(item => item.type === 'approval').length === 1 ? 'always' : 'allow', { username: 'alice', role: 'admin' }, 'default'));
    };
    const extras = await extraTools.forChat({ owner: 'default::alice', chatSessionId: 'chat-browser', readOnly: false, write, signal: new AbortController().signal });
    const requests = [];
    const script = [
        { toolCalls: [{ id: 's', name: 'tool_search', args: { select: ['browser'] } }] },
        { toolCalls: [{ id: 'n1', name: 'browser_navigate', args: { url: `${base}/` } }] },
        { toolCalls: [{ id: 'n2', name: 'browser_navigate', args: { url: `${base}/search?q=again` } }, { id: 'r', name: 'browser_snapshot', args: {} }] },
        { toolCalls: [{ id: 'c', name: 'browser_click', args: { ref: 'e1' } }] },
        { text: '完成' }
    ];
    const result = await agentLoop.runToolLoop({
        client: { generateText: async options => { requests.push({ ...options, messages: [...options.messages] }); return script.shift(); } }, systemPrompt: 'sys',
        messages: [{ role: 'user', content: '打开页面' }], tools: [], extras, executeCall: async () => assert.fail('extras handle browser calls'), write
    });
    extras.end();
    assert.equal(result.text, '完成');
    assert.match(requests[0].systemInstruction, /按需工具[\s\S]*browser_navigate/);
    assert.ok(requests[1].tools.some(tool => tool.name === 'browser_navigate'), 'tool_search loads the group');
    const approvals = events.filter(event => event.type === 'approval');
    assert.deepEqual(approvals.map(event => event.tool), ['browser_navigate', 'browser_click'], 'the second visit to the same site is allowed; the click asks again');
    assert.deepEqual(approvals[0].preview.fields.map(field => field.label), ['网址', '浏览器']);
    assert.match(requests[3].messages.at(-1).toolResults[1].content, /你搜索了 again/);
    const noApproval = events.filter(event => event.type === 'tool_result' && event.tool === 'browser_snapshot');
    assert.equal(noApproval.length, 1, 'reading a page needs no approval');
});
