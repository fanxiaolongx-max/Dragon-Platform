// 首页多对话并行：回复在后台跑，页面断开不中止；切回来能接上；显式停止才中止；同时进行的对话有上限；别人接不上。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-ai-bg-runs-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
process.env.AI_MAX_PARALLEL_CHATS = '2';
const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const tenant = require('../backend/models/tenant-context');
const sessions = require('../backend/models/auth-sessions-repository');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const chat = require('../backend/models/ai-chat-repository');
const router = require('../backend/routes/ai');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await wait(20); } throw new Error(`Timed out: ${label}`); }

test('background home chats survive the page leaving, can be re-attached, stopped and are capped per account', async t => {
    const originals = [settings.getRuntimeSettings, settings.getRedactionSecrets, provider.createClient];
    settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, maxOutputTokens: 2048 });
    settings.getRedactionSecrets = async () => [];
    // 每个回复先吐「第一段」，等放行后再吐「第二段」；中止时抛 AbortError
    const gates = [];
    const aborted = [];
    provider.createClient = () => ({ model: 'mock', generateChat: async ({ onDelta, signal }) => {
        onDelta?.('第一段');
        onDelta?.('，');
        await new Promise((resolve, reject) => {
            gates.push(resolve);
            signal?.addEventListener('abort', () => { aborted.push(true); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
        });
        onDelta?.('第二段');
        return { text: '第一段，第二段' };
    } });
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenant.tenantMiddleware);
    app.use('/api/ai', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/ai`;
    t.after(async () => {
        [settings.getRuntimeSettings, settings.getRedactionSecrets, provider.createClient] = originals;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await pool.closeAll();
        await appDb.closeDatabase();
        await platformDb.closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    await sessions.saveSession('viewer-a', 'alice', 'viewer', Date.now() + 60000, 'default');
    await sessions.saveSession('viewer-b', 'bob', 'viewer', Date.now() + 60000, 'default');
    const headers = token => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
    const send = (token, content, extra = {}) => {
        const controller = new AbortController();
        const response = fetch(`${base}/chat`, { method: 'POST', headers: headers(token), signal: controller.signal, body: JSON.stringify({
            agent: 'dragon-claw-home', pagePath: '/', stream: true, background: true, messages: [{ role: 'user', content }], ...extra
        }) });
        return { controller, response };
    };
    // 读流直到满足条件，返回已读到的事件（不关闭连接）
    async function readUntil(response, predicate) {
        const reader = response.body.getReader(), decoder = new TextDecoder(), events = [];
        let buffer = '';
        while (!predicate(events)) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n'); buffer = lines.pop();
            for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
        }
        return { events, reader };
    }
    const text = events => events.filter(event => event.type === 'delta').map(event => event.delta).join('');

    // 1. 页面断开后回复继续，切回来补放并接着推送，最后整轮入库
    const first = send('viewer-a', '第一个问题', { clientRunId: 'run-first-0001' });
    const firstResponse = await first.response;
    const head = await readUntil(firstResponse, events => events.some(event => event.type === 'start') && text(events).includes('第一段'));
    assert.deepEqual(head.events[0], { type: 'run', runId: 'run-first-0001' });
    const sessionId = head.events.find(event => event.type === 'start').sessionId;
    first.controller.abort();
    await wait(80);
    assert.equal(aborted.length, 0, 'closing the page connection does not stop the reply');
    const messages = await (await fetch(`${base}/sessions/${sessionId}/messages?limit=20`, { headers: headers('viewer-a') })).json();
    assert.equal(messages.live, true);
    const list = await (await fetch(`${base}/sessions?mine=1&pagePath=%2F`, { headers: headers('viewer-a') })).json();
    assert.equal(list.items.find(item => item.id === sessionId)?.busy, true, 'the sidebar shows the chat as still replying');
    assert.equal((await fetch(`${base}/sessions/${sessionId}/live`, { headers: headers('viewer-b') })).status, 204, 'another account cannot attach');
    const live = await fetch(`${base}/sessions/${sessionId}/live`, { headers: headers('viewer-a') });
    assert.equal(live.status, 200);
    const replay = await readUntil(live, events => text(events).includes('第一段，'));
    assert.equal(replay.events[0].type, 'live');
    assert.equal(replay.events[0].question, '第一个问题');
    assert.equal(replay.events.filter(event => event.type === 'delta').length, 1, 'buffered deltas are replayed as one event');
    gates.shift()();
    const rest = [];
    for (;;) { const { value, done } = await replay.reader.read(); if (done) break; rest.push(...new TextDecoder().decode(value).split('\n').filter(Boolean).map(line => JSON.parse(line))); }
    assert.equal(text(rest), '第二段');
    assert.ok(rest.some(event => event.type === 'done'));
    await until(async () => (await tenant.runWithTenant('default', () => chat.listMessages(sessionId, { owner: 'alice' }))).length === 2, 'turn saved');
    const saved = await tenant.runWithTenant('default', () => chat.listMessages(sessionId, { owner: 'alice' }));
    assert.equal(saved[1].content, '第一段，第二段');
    assert.equal((await (await fetch(`${base}/sessions/${sessionId}/messages?limit=20`, { headers: headers('viewer-a') })).json()).live, false);

    // 2. 同一账号最多 2 个并行（测试里设的上限），第 3 个直接 429；另一个账号不受影响
    const a = send('viewer-a', '并行一', { clientRunId: 'run-par-00001' });
    const b = send('viewer-a', '并行二', { clientRunId: 'run-par-00002' });
    const aEvents = await readUntil(await a.response, events => text(events).includes('第一段'));
    await readUntil(await b.response, events => text(events).includes('第一段'));
    const third = await send('viewer-a', '并行三').response;
    assert.equal(third.status, 429);
    assert.equal((await third.json()).code, 'AI_TOO_MANY_RUNS');
    const other = send('viewer-b', '别人的问题', { clientRunId: 'run-other-001' });
    await readUntil(await other.response, events => text(events).includes('第一段'));

    // 3. 停止只能停自己的；停掉后模型请求被中止、流结束，本轮按「已停止」入库
    assert.equal((await (await fetch(`${base}/runs/run-par-00001/stop`, { method: 'POST', headers: headers('viewer-b') })).json()).stopped, false);
    assert.equal(aborted.length, 0);
    assert.equal((await (await fetch(`${base}/runs/run-par-00001/stop`, { method: 'POST', headers: headers('viewer-a') })).json()).stopped, true);
    await until(() => aborted.length === 1, 'provider aborted');
    for (;;) { const { done } = await aEvents.reader.read(); if (done) break; }
    // 放行剩下的两个回复，等它们结束
    await until(() => gates.length === 3, 'remaining replies waiting (stopped gate is stale)');
    gates.splice(0).forEach(open => open());
    await until(async () => (await (await fetch(`${base}/sessions?mine=1&pagePath=%2F`, { headers: headers('viewer-a') })).json()).items.every(item => !item.busy), 'all replies finished');
    const afterStop = await send('viewer-a', '名额空出来了').response;
    assert.equal(afterStop.status, 200, 'a stopped or finished reply frees its slot');
    await readUntil(afterStop, events => text(events).includes('第一段'));
    await until(() => gates.length === 1, 'last reply waiting');
    gates.shift()();
    await until(async () => (await (await fetch(`${base}/sessions?mine=1&pagePath=%2F`, { headers: headers('viewer-a') })).json()).items.every(item => !item.busy), 'last reply finished');
});
