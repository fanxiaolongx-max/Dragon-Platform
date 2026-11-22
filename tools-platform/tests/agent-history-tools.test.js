const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-history-tools-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const chat = require('../backend/models/ai-chat-repository');
const history = require('../backend/models/agent-history-tools');
const extraTools = require('../backend/models/agent-extra-tools');
const access = require('../backend/models/agent-tool-access');
const appDb = require('../backend/models/app-db');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const inDefault = fn => runWithTenant('default', fn);
const ids = {};
async function seed(owner, key, pairs) {
    const sessionId = await chat.getOrCreateSession({ pagePath: '/', pageTitle: 'Dragon Claw', owner });
    ids[key] = sessionId;
    for (const [role, content] of pairs) await chat.addMessage({ sessionId, pagePath: '/', role, content, owner });
}
const key = id => Object.keys(ids).find(name => ids[name] === id) || id;
const run = (set, name, args) => set.execute({ name, args }).then(result => ({ ...result, data: result.isError ? null : JSON.parse(result.content) }));

test('search and read own past conversations only', async () => {
    await inDefault(async () => {
        await seed('alice', 'S_alice_1', [['user', '一键催办的接收人怎么配置'], ['model', '在 PlatformConfig 的 welink_policy_v2 里配置 assignments']]);
        await seed('alice', 'S_alice_2', [['user', '帮我算一下 3 加 5'], ['model', '结果是 8']]);
        await seed('bob', 'S_bob_1', [['user', 'bob 的私密问题 一键催办'], ['model', 'bob 的回答 token=sk-abcdefghijklmnopqrstuvwxyz123456']]);
    });
    const set = history.toolset({ owner: 'default::alice', currentSessionId: ids.S_alice_2 });
    assert.equal(set.id, 'my_conversations');
    assert.equal(set.kindOf('search_my_conversations'), 'read');

    const listed = await run(set, 'search_my_conversations', {});
    assert.deepEqual(listed.data.sessions.map(item => key(item.sessionId)).sort(), ['S_alice_1', 'S_alice_2']);

    const found = await run(set, 'search_my_conversations', { query: '一键催办 接收人' });
    assert.deepEqual(found.data.sessions.map(item => key(item.sessionId)), ['S_alice_1'], 'only own sessions, every keyword must match');
    assert.match(found.data.sessions[0].matches[0].text, /一键催办/);

    const none = await run(set, 'search_my_conversations', { query: 'bob 的私密问题' });
    assert.equal(none.data.sessions.length, 0, 'another account\'s conversation never shows up');

    const read = await run(set, 'read_my_conversation', { sessionId: ids.S_alice_1 });
    assert.deepEqual(read.data.messages.map(item => item.role), ['user', 'assistant']);
    assert.equal(read.data.isCurrentConversation, false);
    assert.equal((await run(set, 'read_my_conversation', { sessionId: ids.S_alice_2 })).data.isCurrentConversation, true);

    const filtered = await run(set, 'read_my_conversation', { sessionId: ids.S_alice_1, query: 'assignments' });
    assert.deepEqual(filtered.data.messages.map(item => item.role), ['assistant']);

    const denied = await run(set, 'read_my_conversation', { sessionId: ids.S_bob_1 });
    assert.equal(denied.isError, true);
    assert.match(denied.content, /只能查看你自己的对话/);
    assert.doesNotMatch(denied.content, /私密/);
});

test('long history pages backwards with a cursor and secrets are redacted', async () => {
    await inDefault(async () => {
        const pairs = [];
        for (let index = 1; index <= 30; index += 1) pairs.push(['user', `第 ${index} 个问题`], ['model', `第 ${index} 个回答`]);
        pairs.push(['user', '我的密钥是 sk-abcdefghijklmnopqrstuvwxyz123456 记一下']);
        await seed('carol', 'S_carol', pairs);
    });
    const set = history.toolset({ owner: 'default::carol' });
    const first = await run(set, 'read_my_conversation', { sessionId: ids.S_carol, limit: 10 });
    assert.equal(first.data.messages.length, 10);
    assert.equal(first.data.hasMore, true);
    assert.doesNotMatch(first.content, /sk-abcdefghijklmnopqrstuvwxyz123456/, 'api keys are redacted');
    const second = await run(set, 'read_my_conversation', { sessionId: ids.S_carol, limit: 10, before: first.data.before });
    assert.equal(second.data.messages.length, 10);
    assert.ok(second.data.messages.every(item => !first.data.messages.some(other => other.messageId === item.messageId)), 'pages do not overlap');
});

test('web chats get the group, channel chats do not, and it has its own access group', async () => {
    const web = await extraTools.toolsets({ owner: 'default::alice', readOnly: true });
    assert.ok(web.some(set => set.id === 'my_conversations'));
    const channel = await extraTools.toolsets({ owner: 'default::alice', readOnly: true, channel: { channel: 'weixin' } });
    assert.ok(!channel.some(set => set.id === 'my_conversations'), 'group chats must not expose personal history');
    assert.equal(access.groupFor('search_my_conversations'), 'my_conversations');
    assert.equal(access.groupFor('read_my_conversation'), 'my_conversations');
});
