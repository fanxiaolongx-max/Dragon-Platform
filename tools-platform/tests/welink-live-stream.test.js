const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const http = require('node:http');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'welink-live-stream-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const auth = require('../backend/middleware/auth');
const authUsers = require('../backend/models/auth-users-repository');
const authRepo = require('../backend/models/auth-sessions-repository');
const welinkConfig = require('../backend/models/channels/welink-config-repository');
const aiRouter = require('../backend/routes/ai');

let scriptedTurn = null;
aiRouter.handleChatRequest = async (req, res) => {
    if (!scriptedTurn) throw new Error('scriptedTurn not set');
    await scriptedTurn(req, res);
};

const bridge = require('../backend/models/channels/dragon-claw-channel-bridge');

const app = express();
app.use(express.json());
app.use('/api', auth.checkAuth, tenantMiddleware);
const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
const end = serverSource.indexOf('\n});', begin) + 4;
vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
app.use('/api/channels', require('../backend/routes/channels'));

let server;
let baseUrl = '';
const openStreams = new Set();

function openSse(pathname, token) {
    return new Promise((resolve, reject) => {
        const events = [];
        let settled = false;
        const req = http.get(`${baseUrl}${pathname}`, {
            headers: token ? { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } : {}
        }, res => {
            const close = () => {
                openStreams.delete(close);
                res.destroy();
                req.destroy();
            };
            openStreams.add(close);
            if (res.statusCode !== 200) {
                res.resume();
                settled = true;
                resolve({ status: res.statusCode, events, close });
                return;
            }
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                buf += chunk;
                const frames = buf.split(/\r?\n\r?\n/);
                buf = frames.pop() || '';
                for (const frame of frames) {
                    const dataLines = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart());
                    if (!dataLines.length) continue;
                    events.push(JSON.parse(dataLines.join('\n')));
                }
            });
            settled = true;
            resolve({
                status: res.statusCode,
                events,
                waitFor(pred, timeoutMs = 4000) {
                    const start = Date.now();
                    return new Promise((resWait, rejWait) => {
                        const timer = setInterval(() => {
                            if (pred(events)) {
                                clearInterval(timer);
                                resWait(events);
                            } else if (Date.now() - start > timeoutMs) {
                                clearInterval(timer);
                                rejWait(new Error(`Timed out waiting for SSE event. Got: ${JSON.stringify(events)}`));
                            }
                        }, 15);
                    });
                },
                close
            });
        });
        req.on('error', err => {
            if (!settled) reject(err);
        });
    });
}

test.before(async () => {
    fs.mkdirSync(path.join(sandbox, 'data', 'tenants', 'tenant-b'), { recursive: true });
    await authUsers.createUser({ username: 'dragon', role: 'admin', passwordHash: 'x', tenantId: 'default', isSuper: true });
    await authUsers.createUser({ username: 'member', role: 'admin', passwordHash: 'x', tenantId: 'tenant-b', isSuper: false });
    await authRepo.saveSession('super-admin-token', 'dragon', 'admin', Date.now() + 60000, 'default');
    await authRepo.saveSession('team-user-token', 'member', 'admin', Date.now() + 60000, 'tenant-b');
    await runWithTenant('default', () => welinkConfig.saveConfig({
        enabled: true,
        access: { users: { mode: 'all' }, groups: { mode: 'all' } }
    }));
    server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    for (const close of [...openStreams]) close();
    server?.closeAllConnections?.();
    if (server) await new Promise(resolve => server.close(resolve));
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    await require('../backend/models/platform-db').closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('channel SSE stream enforces auth, super-admin boundary and tenant isolation', async () => {
    const unauth = await openSse('/api/channels/welink/threads/group/g-auth/stream', '');
    assert.equal(unauth.status, 401);
    unauth.close();

    const nonSuper = await openSse('/api/channels/welink/threads/group/g-auth/stream', 'team-user-token');
    assert.equal(nonSuper.status, 403);
    nonSuper.close();

    const empty = await openSse('/api/channels/welink/threads/group/g-empty/stream', 'super-admin-token');
    assert.equal(empty.status, 200);
    await empty.waitFor(list => list.some(e => e.type === 'snapshot'));
    assert.equal(empty.events[0].turn, null);
    empty.close();
});

test('bridge.runTurn streams thinking, sanitized tool status and deltas via SSE including mid-turn snapshot catch-up and tenant isolation', async () => {
    let releasePhase2;
    let releaseFinish;
    const phase2 = new Promise(resolve => { releasePhase2 = resolve; });
    const finishGate = new Promise(resolve => { releaseFinish = resolve; });

    scriptedTurn = async (_req, res) => {
        res.setHeader('Content-Type', 'application/x-ndjson');
        const emit = obj => res.write(`${JSON.stringify(obj)}\n`);
        emit({ type: 'start', sessionId: 'ai-sess-live-1' });
        emit({ type: 'thinking', delta: '第一步先分析群聊最近动态。' });
        emit({ type: 'tool_start', callId: 'call-1', tool: 'run_command', args: { cmd: 'SECRET_ARG_DO_NOT_LEAK' } });
        emit({ type: 'tool_result', callId: 'call-1', tool: 'run_command', ok: true, durationMs: 42, result: { secret: 'SECRET_RESULT_DO_NOT_LEAK' } });
        emit({ type: 'delta', delta: '已完成分析，' });
        await phase2;
        emit({ type: 'thinking', delta: '补充核对剩余待办。' });
        emit({ type: 'status', status: '正在整理最终总结…' });
        emit({ type: 'delta', delta: '共有 3 项跟进。' });
        await finishGate;
        emit({
            type: 'done',
            sessionId: 'ai-sess-live-1',
            reply: '已完成分析，共有 3 项跟进。',
            model: { name: 'fixture-model' },
            usage: { inputTokens: 120, outputTokens: 28 },
            rounds: [{ model: 'fixture-model', inputTokens: 120, outputTokens: 28, tps: 50, ms: 600 }]
        });
        res.end();
    };

    const observerEarly = await openSse('/api/channels/welink/threads/group/g-live/stream', 'super-admin-token');
    await observerEarly.waitFor(list => list.some(e => e.type === 'snapshot'));

    const turnPromise = runWithTenant('default', () => bridge.runTurn({
        channel: 'welink',
        conversation: { kind: 'group', id: 'g-live', name: 'Live Stream Group' },
        account: 'u-sender',
        text: '@助手 看下最近消息'
    }));

    // Early subscriber receives live turn_start, thinking, sanitized tools, and partial delta before phase2
    await observerEarly.waitFor(list => list.some(e => e.type === 'delta' && e.delta === '已完成分析，'));
    assert.equal(bridge.busyThreads('welink', 'default').has('group:g-live'), true);

    // Mid-turn subscriber joining late receives complete snapshot of progress so far
    const observerLate = await openSse('/api/channels/welink/threads/group/g-live/stream', 'super-admin-token');
    await observerLate.waitFor(list => list.some(e => e.type === 'snapshot'));
    const snap = observerLate.events[0].turn;
    assert.ok(snap, 'mid-turn join should receive non-null snapshot');
    assert.equal(snap.userText, '@助手 看下最近消息');
    assert.equal(snap.sender, 'u-sender');
    assert.equal(snap.content, '已完成分析，');
    assert.equal(snap.thinkingChunks.map(c => c.text || '').join(''), '第一步先分析群聊最近动态。');
    assert.equal(snap.tools.length, 1);
    assert.equal(snap.tools[0].tool, 'run_command');
    assert.equal(snap.tools[0].ok, true);

    // Tenant isolation: Tenant B subscriber NEVER sees Tenant A's active turn
    const otherTenantSnap = await bridge.getLiveTurnSnapshot('welink', 'group', 'g-live', 'tenant-b');
    assert.equal(otherTenantSnap, null);

    // Continue stream through second thinking, status, final delta, done
    releasePhase2();
    await observerLate.waitFor(list => list.some(e => e.type === 'status' && e.status === '正在整理最终总结…'));
    releaseFinish();
    await observerLate.waitFor(list => list.some(e => e.type === 'done'));
    await observerEarly.waitFor(list => list.some(e => e.type === 'done'));
    await turnPromise;

    assert.equal(bridge.busyThreads('welink', 'default').has('group:g-live'), false);

    const earlyText = JSON.stringify(observerEarly.events);
    const lateText = JSON.stringify(observerLate.events);
    for (const payload of [earlyText, lateText]) {
        assert.equal(payload.includes('SECRET_ARG_DO_NOT_LEAK'), false, 'never expose raw tool args');
        assert.equal(payload.includes('SECRET_RESULT_DO_NOT_LEAK'), false, 'never expose raw tool results');
    }

    const lateDone = observerLate.events.find(e => e.type === 'done');
    assert.equal(lateDone.reply, '已完成分析，共有 3 项跟进。');
    assert.equal(lateDone.modelName, 'fixture-model');

    observerEarly.close();
    observerLate.close();
});

test('assistant markdown normalizes keycap emojis and renders horizontal rules', () => {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/ai-assistant.js'), 'utf8');
    const escape = source.match(/function escapeHtml\(text\) \{[\s\S]*?\n {4}\}/)[0];
    const render = source.match(/function renderMarkdownLike\(text\) \{[\s\S]*?\n {8}return blocks\.join\(''\);\n {4}\}/)[0];
    const renderMarkdown = new Function(`${escape}\n${render}\nreturn renderMarkdownLike;`)();

    const html = renderMarkdown('汇总如下：\n\n---\n\n**1\u20E3 TE+AI 峰会演讲**\n\n`1\u20E3`\n\n**2️⃣ 下一步计划**');
    assert.match(html, /<hr>/);
    assert.match(html, /<strong><span class="ai-emoji ai-emoji-keycap">1\uFE0F\u20E3<\/span> TE\+AI 峰会演讲<\/strong>/);
    assert.match(html, /<strong><span class="ai-emoji ai-emoji-keycap">2\uFE0F\u20E3<\/span> 下一步计划<\/strong>/);
    assert.match(html, /<code>1\u20E3<\/code>/, 'code spans keep literal characters untouched');
});
