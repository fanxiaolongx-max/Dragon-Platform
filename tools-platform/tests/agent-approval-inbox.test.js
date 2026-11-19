const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-inbox-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const inbox = require('../backend/models/agent-approval-inbox');
const channels = require('../backend/models/channels');
const appDb = require('../backend/models/app-db');
const { runWithTenant, DEFAULT_TENANT_ID } = require('../backend/models/tenant-context');

const realStatus = channels.getStatus;
const realPush = channels.push;
const pushes = [];

test.before(() => {
    channels.getStatus = async ({ channel }) => ({ enabled: true, connected: channel === 'welink', runtime: { failureReason: '未连接' } });
    channels.push = async ({ channel, text, targets }) => {
        pushes.push({ channel, text, targets });
        return { sent: targets.length, results: targets.map(item => ({ ...item, ok: true })) };
    };
});

test.after(async () => {
    await inbox.flushPending();
    channels.getStatus = realStatus;
    channels.push = realPush;
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const tenant = fn => runWithTenant(DEFAULT_TENANT_ID, fn);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('saving settings requires targets and a connected channel', () => tenant(async () => {
    await assert.rejects(inbox.saveSettings('admin', { enabled: true, channel: 'welink', targets: [] }), { code: 'INBOX_TARGETS_REQUIRED' });
    await assert.rejects(inbox.saveSettings('admin', { enabled: true, channel: 'weixin', targets: [{ kind: 'user', id: 'u1' }] }), { code: 'INBOX_CHANNEL_UNAVAILABLE' });
    const saved = await inbox.saveSettings('admin', { enabled: true, channel: 'welink', delaySec: 0, targets: [{ kind: 'group', id: 'g1', name: '运维群' }, { kind: 'group', id: 'g1' }] });
    assert.deepEqual(saved.targets, [{ kind: 'group', id: 'g1', name: '运维群' }]);
    assert.equal((await inbox.getSettings('admin')).enabled, true);
    // 微信不能推群：保存时过滤掉群组
    assert.deepEqual(inbox._internal.normalizeSettings({ channel: 'weixin', targets: [{ kind: 'group', id: 'g' }, { kind: 'user', id: 'u' }] }).targets.map(item => item.id), ['u']);
}));

test('pending approval is listed, pushed to the group, and approved by replying with its code', () => tenant(async () => {
    pushes.length = 0;
    const decisions = [];
    const settle = (decision, scope, via) => { decisions.push({ decision, via }); inbox.remove('a1', decision, via); };
    inbox.add({ id: 'a1', owner: `${DEFAULT_TENANT_ID}::admin`, chatSessionId: '', tool: 'run_command', args: { command: 'rm -rf build' }, settle, expiresInMs: 300000 });
    const listed = await inbox.list(`${DEFAULT_TENANT_ID}::admin`);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].label, '执行命令');
    assert.equal(listed[0].detail, 'rm -rf build');
    assert.deepEqual(await inbox.list(`${DEFAULT_TENANT_ID}::someone`), []);

    await wait(60);
    assert.equal(pushes.length, 1);
    const code = listed[0].code;
    assert.match(pushes[0].text, new RegExp(`批准 ${code}`));
    assert.equal(pushes[0].targets[0].id, 'g1');

    // 不是推送对象的会话、不相关的文字：不处理
    assert.equal(inbox.handleReply({ channel: 'welink', conversation: { kind: 'group', id: 'other' }, text: `批准 ${code}` }), null);
    assert.equal(inbox.handleReply({ channel: 'welink', conversation: { kind: 'group', id: 'g1' }, text: '今天天气不错' }), null);
    assert.equal(inbox.handleReply({ channel: 'weixin', conversation: { kind: 'group', id: 'g1' }, text: `批准 ${code}` }), null);

    const reply = inbox.handleReply({ channel: 'welink', conversation: { kind: 'group', id: 'g1' }, actor: 'zhangsan', text: `批准 ${code}` });
    assert.match(reply, /已批准/);
    assert.deepEqual(decisions, [{ decision: 'allow', via: 'welink:zhangsan' }]);
    assert.deepEqual(await inbox.list(`${DEFAULT_TENANT_ID}::admin`), []);

    // 重复回复：告知已处理，不再结算
    assert.match(inbox.handleReply({ channel: 'welink', conversation: { kind: 'group', id: 'g1' }, text: `批准 ${code}` }), /已批准/);
    assert.equal(decisions.length, 1);
}));

test('deny reply and web-resolved approvals', () => tenant(async () => {
    const decisions = [];
    inbox.add({ id: 'a2', owner: `${DEFAULT_TENANT_ID}::admin`, tool: 'write_file', args: { path: '/tmp/x' }, settle: (d, s, via) => { decisions.push(d); inbox.remove('a2', d, via); }, expiresInMs: 300000 });
    await wait(60);
    const { code } = inbox._internal.entries.get('a2');
    assert.match(inbox.handleReply({ channel: 'welink', conversation: { kind: 'group', id: 'g1' }, text: `拒绝 ${code}` }), /已拒绝/);
    assert.deepEqual(decisions, ['deny']);

    inbox.add({ id: 'a3', owner: `${DEFAULT_TENANT_ID}::admin`, tool: 'write_file', args: {}, settle: () => {}, expiresInMs: 300000 });
    await wait(60);
    const code3 = inbox._internal.entries.get('a3').code;
    inbox.remove('a3', 'allow', 'web');
    assert.match(inbox.handleReply({ channel: 'welink', conversation: { kind: 'group', id: 'g1' }, text: `批准 ${code3}` }), /在网页处理/);
}));

test('disabled settings never push', () => tenant(async () => {
    await inbox.saveSettings('admin', { enabled: false });
    pushes.length = 0;
    inbox.add({ id: 'a4', owner: `${DEFAULT_TENANT_ID}::admin`, tool: 'run_command', args: {}, settle: () => {}, expiresInMs: 300000 });
    await wait(60);
    assert.equal(pushes.length, 0);
    inbox.remove('a4', 'deny');
}));
