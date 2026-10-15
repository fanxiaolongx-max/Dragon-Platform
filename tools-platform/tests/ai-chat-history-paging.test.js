// 恢复对话渐进加载：按 before 游标分页，顺序与全量列表一致；每条回复保存输入 / 输出 Token 与模型名。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-claw-history-paging-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const chat = require('../backend/models/ai-chat-repository');
const pool = require('../backend/models/tenant-sqlite-pool');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('history pages walk back through a session without gaps or duplicates', () => runWithTenant('default', async () => {
    let sessionId = '';
    // 同一秒内连续写入：只按 created_at 排序会乱序或漏行，游标必须带 rowid
    for (let index = 0; index < 23; index += 1) {
        sessionId = await chat.addMessage({ sessionId, pagePath: '/', pageTitle: 'home', owner: 'alice', role: index % 2 ? 'model' : 'user', content: `m${index}`,
            ...(index % 2 ? { inputTokens: 12345, outputTokens: 678, modelName: 'Test Model' } : {}) });
    }
    const all = (await chat.listMessages(sessionId, { owner: 'alice' })).map(item => item.content);
    assert.equal(all.length, 23);

    const first = await chat.listMessagesPage(sessionId, { owner: 'alice', limit: 10 });
    assert.deepEqual(first.items.map(item => item.content), all.slice(-10));
    assert.equal(first.hasMore, true);
    assert.equal(first.total, 23);
    const reply = first.items.find(item => item.role === 'model');
    assert.deepEqual([reply.input_tokens, reply.output_tokens, reply.model_name], [12345, 678, 'Test Model']);
    assert.equal('seq' in reply, false, 'internal cursor column is not exposed');

    const second = await chat.listMessagesPage(sessionId, { owner: 'alice', limit: 10, before: first.items[0].id });
    assert.deepEqual(second.items.map(item => item.content), all.slice(-20, -10));
    const third = await chat.listMessagesPage(sessionId, { owner: 'alice', limit: 10, before: second.items[0].id });
    assert.deepEqual(third.items.map(item => item.content), all.slice(0, 3));
    assert.equal(third.hasMore, false);

    await assert.rejects(chat.listMessagesPage(sessionId, { owner: 'bob', limit: 10 }));
    await assert.rejects(chat.listMessagesPage(sessionId, { owner: 'alice', limit: 10, before: 'msg_not_in_this_session' }), { code: 'AI_CHAT_CURSOR_INVALID' });
}));

test('agent turns keep their token split and model name after the final upsert', () => runWithTenant('default', async () => {
    const sessionId = await chat.addMessage({ pagePath: '/', pageTitle: 'home', owner: 'carol', role: 'user', content: 'hello' });
    const turn = { sessionId, owner: 'carol', runId: 'run-1', agentSessionId: 'agent-session-1', root: sandbox, transcript: [{ role: 'user', content: 'list files' }] };
    await chat.upsertAgentTurn({ ...turn, content: 'working…' });
    await chat.upsertAgentTurn({ ...turn, content: 'done', tokens: 900, final: true, inputTokens: 800, outputTokens: 100, modelName: 'Agent Model' });
    const reply = (await chat.listMessages(sessionId, { owner: 'carol' })).find(item => item.id === 'agent_run-1_model');
    assert.deepEqual([reply.content, reply.input_tokens, reply.output_tokens, reply.model_name], ['done', 800, 100, 'Agent Model']);
    const question = (await chat.listMessages(sessionId, { owner: 'carol' })).find(item => item.id === 'agent_run-1_user');
    assert.deepEqual([question.input_tokens, question.model_name], [0, '']);
}));
