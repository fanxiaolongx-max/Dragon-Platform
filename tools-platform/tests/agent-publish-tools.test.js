// 对话里的 publish_html_tool / send_notification（与基座 Web 版对齐）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-publish-tools-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const publishTools = require('../backend/models/agent-publish-tools');
const extraTools = require('../backend/models/agent-extra-tools');
const repo = require('../backend/models/custom-tools-repository');
const channels = require('../backend/models/channels');
const welinkConfig = require('../backend/models/channels/welink-config-repository');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

const superAdmin = { username: 'boss', role: 'admin', isSuper: true };
const teamAdmin = { username: 'lead', role: 'admin' };
const member = { username: 'amy', role: 'user' };
const HTML = '<!doctype html><html><head><title>t</title></head><body><h1>百分比计算器</h1></body></html>';

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('chat toolsets include the publish tools for writable chats only', async () => {
    assert.ok((await extraTools.toolsets({ owner: 'default::boss', user: superAdmin, readOnly: false })).some(set => set.id === 'publish_tools'));
    assert.ok(!(await extraTools.toolsets({ owner: 'default::guest', readOnly: true })).some(set => set.id === 'publish_tools'));
    const set = publishTools.toolset({ user: superAdmin });
    assert.equal(set.kindOf('publish_html_tool'), 'write', 'goes through the approval card');
    assert.equal(set.kindOf('send_notification'), 'write');
});

test('publish_html_tool previews, validates and creates a custom tool', async () => {
    const set = publishTools.toolset({ user: superAdmin });
    const preview = await set.preview('publish_html_tool', { name: '百分比计算器', description: '算占比', html: HTML });
    assert.match(preview.path, /发布自定义工具「百分比计算器」/);
    await assert.rejects(() => set.preview('publish_html_tool', { name: 'x', html: '<div>不完整</div>' }), /完整的 HTML/);
    const out = await set.execute({ name: 'publish_html_tool', args: { name: '百分比计算器', description: '算占比', icon: '🧮', html: HTML } });
    assert.equal(out.isError, undefined, out.content);
    const tool = (await repo.listTools()).find(item => item.name === '百分比计算器');
    assert.ok(tool, 'tool is registered');
    assert.equal(tool.icon, '🧮');
    assert.match(out.content, new RegExp(tool.href.replace(/[/]/g, '\\/')));
    assert.match(fs.readFileSync(path.join(repo.getCustomToolsDir(), tool.slug, 'index.html'), 'utf8'), /百分比计算器/);
    // 团队管理员不能往系统空间发布
    const denied = await publishTools.toolset({ user: teamAdmin }).execute({ name: 'publish_html_tool', args: { name: 'x', html: HTML } });
    assert.equal(denied.isError, true);
    assert.match(denied.content, /系统空间/);
});

test('send_notification is admin-only and only reaches the configured default push targets', async () => {
    const pushes = [];
    const originalPush = channels.push;
    const originalConfig = welinkConfig.getConfig;
    channels.push = async payload => { pushes.push(payload); return { sent: payload.targets.length }; };
    try {
        assert.match((await publishTools.toolset({ user: member }).execute({ name: 'send_notification', args: { text: 'hi' } })).content, /管理员权限/);
        welinkConfig.getConfig = async () => ({ push: { defaultTargets: [] } });
        assert.match((await publishTools.toolset({ user: superAdmin }).execute({ name: 'send_notification', args: { text: 'hi' } })).content, /默认推送范围/);
        welinkConfig.getConfig = async () => ({ push: { defaultTargets: [{ kind: 'group', id: 'g1', name: '运维群' }] } });
        const set = publishTools.toolset({ user: superAdmin });
        assert.equal((await set.preview('send_notification', { text: '月报已发布' })).targets, '运维群');
        const out = await set.execute({ name: 'send_notification', args: { text: '月报已发布' } });
        assert.match(out.summary, /已推送 1 个会话/);
        assert.deepEqual(pushes.map(p => [p.channel, p.text, p.targets.length]), [['welink', '月报已发布', 1]]);
        assert.equal((await set.execute({ name: 'send_notification', args: { text: '  ' } })).isError, true);
    } finally {
        channels.push = originalPush;
        welinkConfig.getConfig = originalConfig;
    }
});
