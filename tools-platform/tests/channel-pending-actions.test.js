const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-channel-confirm-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const pendingActions = require('../backend/models/channels/channel-pending-actions');
const extraTools = require('../backend/models/agent-extra-tools');
const manager = require('../backend/models/agent-run-manager');
const store = require('../backend/models/agent-skills-store');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const usage = { promptTokens: 10, outputTokens: 1, totalTokens: 11 };
const skillMd = steps => `---
id: news-brief
name: 行业风向标
name_en: News Brief
description: 每个厂家一条新闻
description_en: One headline per vendor
workspace: false
---
## 步骤
${steps}`;
const wechat = { channel: 'weixin', conversation: { kind: 'user', id: 'owner@im.wechat' }, actor: 'owner@im.wechat' };

async function channelTurn(markdown, { canSaveSkills = true, chatSessionId = 'wx' } = {}) {
    const user = { username: 'weixin:owner', role: canSaveSkills ? 'admin' : 'readonly', isSuper: canSaveSkills };
    const extras = await extraTools.forChat({ owner: 'default::weixin:owner', user, chatSessionId, readOnly: true, channel: { ...wechat, canSaveSkills }, write: () => {}, signal: new AbortController().signal });
    const script = [{ toolCalls: [{ id: 's', name: 'save_skill', args: { markdown, reason: '每家一条' } }] }, { text: '请回复确认' }];
    const requests = [];
    const result = await extraTools.runChannelTurn({ extras, client: { generateText: async options => { requests.push({ ...options, messages: [...options.messages] }); return { usage, toolCalls: [], ...script.shift() }; } },
        systemInstruction: 'sys', messages: [{ role: 'user', content: '改造技能' }], owner: 'default::weixin:owner', chatSessionId, bufferText: true });
    extras.end();
    return { result, requests, tools: requests[0].tools.map(def => def.name) };
}

test('the confirm and cancel words are strict, so ordinary replies still go to the AI', () => {
    const { CONFIRM_RE, CANCEL_RE } = pendingActions._internal;
    for (const text of ['确认', '确认 1234', '确认1234。', 'yes', 'OK']) assert.ok(CONFIRM_RE.test(text), text);
    for (const text of ['取消', '取消 1234', 'no']) assert.ok(CANCEL_RE.test(text), text);
    for (const text of ['好整！', '好的', '可以', '确认一下思科新闻是不是真的']) assert.equal(CONFIRM_RE.test(text) || CANCEL_RE.test(text), false, text);
});

test('in a WeChat chat save_skill waits for a typed confirmation from the same person, then saves', async () => {
    const turn = await channelTurn(skillMd('1. 每个厂家搜一条\n2. 一句话表格'));
    assert.match(turn.requests[1].messages.at(-1).toolResults[0].content, /还没有执行[\s\S]*确认 \d{4}/);
    assert.equal(await store.getSkill('news-brief'), null, 'nothing is saved before the reply');
    const note = pendingActions.takeNote(wechat.channel, wechat.conversation, wechat.actor);
    const code = /确认 (\d{4})/.exec(note)[1];
    assert.match(note, /待确认：保存技能 @news-brief[\s\S]*```diff[\s\S]*\+2\. 一句话表格/);
    assert.equal(pendingActions.takeNote(wechat.channel, wechat.conversation, wechat.actor), '', 'the note is attached once');

    assert.equal(await pendingActions.handleReply({ ...wechat, actor: 'someone-else', text: `确认 ${code}` }), null, 'another person cannot confirm');
    assert.equal(await pendingActions.handleReply({ ...wechat, text: '好整！' }), null);
    assert.match(await pendingActions.handleReply({ ...wechat, text: '确认 0000' }), /没有确认码为 0000/);
    assert.match(await pendingActions.handleReply({ ...wechat, text: `确认 ${code}` }), /^✅ 已创建技能 @news-brief/);
    assert.match((await store.getSkill('news-brief')).markdown, /一句话表格/);
    assert.equal(await pendingActions.handleReply({ ...wechat, text: '确认' }), null, 'a used confirmation is gone');
});

test('cancel drops the change; skills that hold credentials never reach the confirmation step', async () => {
    await channelTurn(skillMd('1. 改掉的版本'));
    pendingActions.takeNote(wechat.channel, wechat.conversation, wechat.actor);
    assert.match(await pendingActions.handleReply({ ...wechat, text: '取消' }), /已取消/);
    assert.doesNotMatch((await store.getSkill('news-brief')).markdown, /改掉的版本/);

    const bad = await channelTurn(skillMd('1. 自动输入密码登录'));
    assert.match(bad.requests[1].messages.at(-1).toolResults[0].content, /没有提交/);
    assert.equal(pendingActions.takeNote(wechat.channel, wechat.conversation, wechat.actor), '');
});

test('other WeChat users get no skill saving at all', async () => {
    const turn = await channelTurn(skillMd('1. 别人'), { canSaveSkills: false, chatSessionId: 'wx-guest' });
    assert.match(turn.requests[1].messages.at(-1).toolResults[0].content, /当前对话不提供该工具/);
    assert.deepEqual((await extraTools.toolsets({ owner: 'default::weixin:guest', readOnly: true, channel: { ...wechat, canSaveSkills: false } })).map(set => set.id), ['platform_tools']);
});

test('a full-access WeLink conversation confirms and saves skills only in its own space', async () => {
    const { runWithTenant } = require('../backend/models/tenant-context');
    await runWithTenant('welink-personal', async () => {
        const welink = { channel: 'welink', conversation: { kind: 'user', id: 'w1' }, actor: 'w1' };
        const session = manager.ensureWeLinkSession({ user: { username: 'welink:w1', role: 'admin' }, tenantId: 'welink-personal', chatSessionId: `wl-${process.pid}` });
        session.channelContext = welink;
        const script = [{ toolCalls: [{ id: 'w', name: 'save_skill', args: { markdown: skillMd('1. WeLink 改的'), reason: '测试' } }] }, { text: 'ok' }];
        const turn = await manager.runAgentTurn({ session, client: { model: 'mock', async generateText() { return { text: '', toolCalls: [], usage, ...script.shift() }; } },
            systemInstruction: 'S', historyMessages: [{ role: 'user', content: '完善技能' }], write: () => {}, signal: new AbortController().signal });
        assert.equal(turn.denied, 0);
        const code = /确认 (\d{4})/.exec(pendingActions.takeNote(welink.channel, welink.conversation, welink.actor))[1];
        assert.match(await pendingActions.handleReply({ ...welink, text: `确认 ${code}` }), /^✅ 已创建技能 @news-brief/);
        assert.match((await store.getSkill('news-brief')).markdown, /WeLink 改的/);
    });
    assert.doesNotMatch((await store.getSkill('news-brief')).markdown, /WeLink 改的/);
});

test('confirmation is isolated by tenant, channel, conversation and exact actor, including missing actors', async () => {
    const { runWithTenant, getTenantId } = require('../backend/models/tenant-context');
    let executions = 0, executionTenant;
    await runWithTenant('confirmation-a', async () => {
        pendingActions.defer({ ...wechat, title: 'Tenant-scoped action', execute: async () => { executions++; executionTenant = getTenantId(); return { content: 'saved' }; } });
    });
    const note = await runWithTenant('confirmation-a', () => pendingActions.takeNote(wechat.channel, wechat.conversation, wechat.actor));
    const code = /确认 (\d{4})/.exec(note)[1];
    await runWithTenant('confirmation-b', async () => {
        assert.equal(pendingActions.takeNote(wechat.channel, wechat.conversation, wechat.actor), '');
        assert.equal(await pendingActions.handleReply({ ...wechat, text: `确认 ${code}` }), null);
    });
    await runWithTenant('confirmation-a', async () => {
        for (const override of [{ actor: '' }, { actor: 'other' }, { channel: 'welink' }, { conversation: { kind: 'group', id: wechat.conversation.id } }, { conversation: { kind: 'user', id: 'other-chat' } }]) {
            assert.equal(await pendingActions.handleReply({ ...wechat, ...override, text: `确认 ${code}` }), null);
        }
        assert.equal(executions, 0);
        assert.match(await pendingActions.handleReply({ ...wechat, text: `确认 ${code}` }), /saved/);
        assert.equal(executionTenant, 'confirmation-a');
        assert.equal(executions, 1);
        assert.equal(await pendingActions.handleReply({ ...wechat, text: `确认 ${code}` }), null);
    });
});
