const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-skill-tools-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const skillTools = require('../backend/models/agent-skill-tools');
const store = require('../backend/models/agent-skills-store');
const builtinSkills = require('../backend/models/agent-skills');
const extraTools = require('../backend/models/agent-extra-tools');
const manager = require('../backend/models/agent-run-manager');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

const root = path.join(sandbox, 'repo');
fs.mkdirSync(root, { recursive: true });
const user = { username: 'admin', role: 'admin' };
const usage = { promptTokens: 100, outputTokens: 10, totalTokens: 110 };
let counter = 0;

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const skillMd = steps => `---
id: demo-report
name: 演示报告
name_en: Demo Report
description: 打开页面读表格生成报告
description_en: Read a table and build a report
workspace: false
---
## 步骤
${steps}`;

async function waitFor(predicate, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = predicate();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('waitFor timed out');
}

function saveTurn(session, markdown) {
    const events = [];
    const script = [{ toolCalls: [{ id: `s${counter += 1}`, name: 'save_skill', args: { markdown, reason: '补上等待步骤' } }] }, { text: 'ok' }];
    const client = { model: 'mock', async generateText() { const next = script.shift(); return { text: next.text || '', toolCalls: next.toolCalls || [], usage }; } };
    const turn = manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: '完善技能' }], write: event => events.push(event), signal: new AbortController().signal });
    return { events, turn };
}

test('skills that store or fetch credentials are refused', () => {
    for (const text of ['登录时输入 密码：Abc12345', '从 platform:requirements.db 读取密码后登录', '遇到登录页自动输入密码', 'token=sk-1234567890']) {
        assert.ok(skillTools.credentialProblem(text), text);
    }
    assert.equal(skillTools.credentialProblem('遇到登录页停下来，提示用户手动登录后回复「已登录」'), '');
});

test('save_skill asks in ask mode, shows the diff, and keeps a backup', async () => {
    const session = manager.ensureSession({ agentSessionId: `skill-${process.pid}`, user, tenantId: 'default', root, permissionMode: 'ask' });
    const first = saveTurn(session, skillMd('1. 打开页面\n2. 读表格'));
    const approval = await waitFor(() => first.events.find(event => event.type === 'approval'));
    assert.equal(approval.tool, 'save_skill');
    assert.match(approval.preview.path, /^@demo-report（新技能） · 补上等待步骤/);
    assert.match(approval.preview.diff, /\+2\. 读表格/);
    manager.resolveApproval(approval.id, 'allow', user, 'default');
    assert.equal((await first.turn).denied, 0);
    assert.match((await store.getSkill('demo-report')).markdown, /2\. 读表格/);

    const second = saveTurn(session, skillMd('1. 打开页面\n2. 等表格加载完\n3. 读表格'));
    const update = await waitFor(() => second.events.find(event => event.type === 'approval'));
    assert.match(update.preview.diff, /-2\. 读表格[\s\S]*\+2\. 等表格加载完/);
    manager.resolveApproval(update.id, 'always', user, 'default');
    await second.turn;
    assert.match((await store.getSkill('demo-report')).markdown, /等表格加载完/);
    assert.equal((await store.listBackups('demo-report')).length, 1, 'the earlier version was backed up');

    // 本对话选了「总是允许」：再次保存不再弹卡
    const third = saveTurn(session, skillMd('1. 打开页面\n2. 等表格加载完\n3. 读表格\n4. 导出'));
    await third.turn;
    assert.equal(third.events.some(event => event.type === 'approval'), false);
    assert.match((await store.getSkill('demo-report')).markdown, /4\. 导出/);
});

test('save_skill does not ask again when the user chose full access (backup still kept)', async () => {
    const session = manager.ensureSession({ agentSessionId: `skill-full-${process.pid}`, user, tenantId: 'default', root, permissionMode: 'full' });
    const before = (await store.listBackups('demo-report')).length;
    const turn = saveTurn(session, skillMd('1. 打开页面\n2. 等表格加载完\n3. 读表格\n4. 导出\n5. 完全访问下保存'));
    assert.equal((await turn.turn).denied, 0);
    assert.equal(turn.events.some(event => event.type === 'approval'), false);
    assert.match((await store.getSkill('demo-report')).markdown, /完全访问下保存/);
    assert.equal((await store.listBackups('demo-report')).length, before + 1, 'overwriting still keeps a backup');
});

test('a skill with credentials is refused before any approval card, and channels never save', async () => {
    const session = manager.ensureSession({ agentSessionId: `skill-cred-${process.pid}`, user, tenantId: 'default', root, permissionMode: 'full' });
    const bad = saveTurn(session, skillMd('1. 从需求管理读取密码\n2. 自动输入密码登录'));
    const result = await bad.turn;
    assert.equal(bad.events.some(event => event.type === 'approval'), false);
    assert.match(bad.events.find(event => event.type === 'tool_result').summary, /没有提交|账号密码/);
    assert.equal(result.denied, 0);
    assert.doesNotMatch((await store.getSkill('demo-report')).markdown, /读取密码/);

    const channel = manager.ensureWeLinkSession({ user, tenantId: 'default', chatSessionId: `skill-ch-${process.pid}` });
    const blocked = saveTurn(channel, skillMd('频道里改的'));
    assert.equal((await blocked.turn).denied, 1);
    assert.doesNotMatch((await store.getSkill('demo-report')).markdown, /频道里改的/);
});

test('read-only accounts get no skill_evolution group; drafting skills point the model at save_skill', async () => {
    assert.deepEqual((await extraTools.toolsets({ owner: 'default::guest', readOnly: true })).map(set => set.id), ['platform_tools']);
    assert.ok((await extraTools.toolsets({ owner: 'default::alice', readOnly: false })).some(set => set.id === 'skill_evolution'));
    const drafting = builtinSkills.buildPrompt(['### @improve-skill\n完善技能']);
    assert.match(drafting, /有 save_skill 工具时[\s\S]*read_skill[\s\S]*save_skill/);
    const using = builtinSkills.buildPrompt(['### @demo-report\n步骤']);
    assert.match(using, /技能自我进化/);
});
