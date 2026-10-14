const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-chat-history-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const repo = require('../backend/models/ai-chat-repository');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const inTenant = fn => runWithTenant('default', fn);

test('replies keep their tool events and sessions record owner and workspace', async () => {
    await inTenant(async () => {
        const id = await repo.getOrCreateSession({ pagePath: '/', pageTitle: 'Dragon Claw', owner: 'alice' });
        await repo.addMessage({ sessionId: id, pagePath: '/', pageTitle: 'Dragon Claw', owner: 'alice', role: 'user', content: '改一下 README' });
        const events = [
            { type: 'tool_start', callId: 'c1', tool: 'run_command', args: { command: 'npm test' } },
            { type: 'tool_result', callId: 'c1', tool: 'run_command', ok: true, summary: '退出码 0', output: '$ npm test\nok' }
        ];
        await repo.addMessage({ sessionId: id, pagePath: '/', pageTitle: 'Dragon Claw', owner: 'alice', role: 'model', content: '已完成', events });
        await repo.setSessionAgent(id, { agentSessionId: 'agent-0001', root: '/work/demo' });
        const messages = await repo.listMessages(id);
        assert.deepEqual(messages.map(item => item.role), ['user', 'model']);
        assert.deepEqual(messages[0].events, []);
        assert.deepEqual(messages[1].events, events);

        // 另一个用户的会话，与旧数据（无归属）
        const bob = await repo.getOrCreateSession({ pagePath: '/', pageTitle: 'Dragon Claw', owner: 'bob' });
        await repo.addMessage({ sessionId: bob, pagePath: '/', pageTitle: 'x', owner: 'bob', role: 'user', content: 'bob 的问题' });
        const legacy = await repo.getOrCreateSession({ pagePath: '/', pageTitle: 'old' });
        await repo.addMessage({ sessionId: legacy, pagePath: '/', pageTitle: 'old', role: 'user', content: '旧会话' });

        const mine = await repo.listOwnedSessions({ owner: 'alice', pagePath: '/' });
        assert.deepEqual(mine.map(item => item.id), [id], 'only the owner sees the session; ownerless legacy sessions are not listed');
        assert.equal(mine[0].messageCount, 2);
        assert.equal(mine[0].firstQuestion, '改一下 README');
        assert.deepEqual(mine[0].agent, { agentSessionId: 'agent-0001', root: '/work/demo' });
        assert.deepEqual((await repo.listOwnedSessions({ owner: 'alice', pagePath: '/', query: 'README' })).map(item => item.id), [id]);
        assert.deepEqual(await repo.listOwnedSessions({ owner: 'alice', pagePath: '/', query: '不存在的内容' }), []);
        assert.deepEqual(await repo.listOwnedSessions({ owner: '', pagePath: '/' }), [], 'no owner, no list');

        // 无归属的历史不能由拿到 ID 的用户认领；已有归属的也不能被他人改写。
        await assert.rejects(repo.addMessage({ sessionId: legacy, pagePath: '/', pageTitle: 'old', owner: 'alice', role: 'model', content: '接上了' }), { code: 'AI_SESSION_FORBIDDEN' });
        await assert.rejects(repo.addMessage({ sessionId: bob, pagePath: '/', pageTitle: 'x', owner: 'alice', role: 'user', content: '误用' }), { code: 'AI_SESSION_FORBIDDEN' });
        assert.ok(!(await repo.listOwnedSessions({ owner: 'alice', pagePath: '/' })).some(item => item.id === bob));
    });
});

test('chat route records tool events and saves stopped or failed turns', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', 'ai.js'), 'utf8');
    assert.match(route, /const RECORDED_EVENT_TYPES = new Set\(\['tool_start', 'tool_result', 'approval', 'approval_result'\]\)/);
    assert.match(route, /events: recordedEvents\n\s+\}\);\n\s+if \(agentSession\) await aiChatRepo\.setSessionAgent/);
    assert.match(route, /await saveInterruptedTurn\('（已停止生成）'\);/);
    assert.match(route, /await saveInterruptedTurn\(`⚠️ 本轮出错：/);
    assert.match(route, /if \(req\.query\.mine === '1'\) \{\n\s+const items = await aiChatRepo\.listOwnedSessions\(\{\n\s+owner: req\.user\?\.username/);
});

test('long replies and event logs are stored without dropping invalid sliced JSON', async () => {
    const content = 'long-reply '.repeat(4000);
    const events = Array.from({ length: 450 }, (_, index) => ({ type: 'tool_result', callId: `call-${index}`, output: `result-${index}-${'a'.repeat(1000)}` }));
    const id = await repo.addMessage({ pagePath: '/', owner: 'alice', role: 'model', content, events });
    const messages = await repo.listMessages(id, { owner: 'alice' });
    assert.equal(messages[0].content, content);
    assert.deepEqual(messages[0].events, events);
});
