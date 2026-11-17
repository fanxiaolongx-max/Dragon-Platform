const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-claw-mobile-skill-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const { tenantMiddleware } = require('../backend/models/tenant-context');
const authSessions = require('../backend/models/auth-sessions-repository');
const chat = require('../backend/models/ai-chat-repository');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const skillsStore = require('../backend/models/agent-skills-store');
const runManager = require('../backend/models/agent-run-manager');
const agentWorkspaceAccess = require('../backend/models/agent-workspace-access');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');
const router = require('../backend/routes/ai');

function parseNdjson(raw) {
    return String(raw || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('mobile admin runs external CLI skills in scratch workspace without approval hang, resumes saved agent_root, and blocks danger rules', async t => {
    const origGetRuntime = settings.getRuntimeSettings;
    const origGetSecrets = settings.getRedactionSecrets;
    const origCreateClient = provider.createClient;
    const origWorkspaceAllowed = agentWorkspaceAccess.isAgentWorkspaceAllowed;

    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    app.use('/api/ai', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));

    t.after(async () => {
        settings.getRuntimeSettings = origGetRuntime;
        settings.getRedactionSecrets = origGetSecrets;
        provider.createClient = origCreateClient;
        agentWorkspaceAccess.isAgentWorkspaceAllowed = origWorkspaceAllowed;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await pool.closeAll();
        await appDb.closeDatabase();
        await platformDb.closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true, model: 'mock-model', maxOutputTokens: 2048, temperature: 0.2 });
    settings.getRedactionSecrets = async () => [];
    await authSessions.saveSession('mobile-admin-token', 'admin', 'admin', Date.now() + 60000, 'default');
    await authSessions.saveSession('mobile-viewer-token', 'bob', 'viewer', Date.now() + 60000, 'default');

    // Simulate an external CLI skill stored with legacy workspace=0 in agent_skills
    const externalHome = path.join(sandbox, 'ext-home');
    const skillDir = path.join(externalHome, '.claude', 'skills', 'thcli-image');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: thcli-image\ndescription: 生图命令技能\n---\n\n`thcli +gen wand/si-image/generation --prompt "test"`\n\n可引导执行。\n');
    await skillsStore.captureExternalSkills({ since: Date.now() - 5000, home: externalHome, createdBy: 'admin' });
    await appDb.run("UPDATE agent_skills SET workspace = 0 WHERE id = 'thcli-image'");

    const endpoint = `http://127.0.0.1:${server.address().port}/api/ai/chat`;

    // 1. Mobile admin calls @thcli-image with no workspace payload -> auto scratch workspace + run_command works, danger rule blocked immediately
    let round = 0;
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            if (!Array.isArray(options.tools)) return { text: '测试对话' };
            round += 1;
            if (round === 1) {
                assert.ok(options.tools.some(tool => tool.name === 'run_command'), 'mobile admin must receive run_command');
                return {
                    text: '',
                    toolCalls: [
                        { id: 'c1', name: 'run_command', args: { command: 'node -p "6 * 7"' } },
                        { id: 'c2', name: 'run_command', args: { command: 'pm2 restart tools-platform' } }
                    ]
                };
            }
            const answer = '手机端命令执行完成';
            options.onDelta?.(answer);
            return { text: answer, toolCalls: [] };
        }
    });

    const res1 = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer mobile-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 移动端',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '@thcli-image 生成一张测试图' }]
        })
    });
    assert.equal(res1.status, 200);
    const events1 = parseNdjson(await res1.text());
    const toolResults1 = events1.filter(e => e.type === 'tool_result');
    assert.equal(toolResults1.length, 2, `round=${round} events1=${JSON.stringify(events1)}`);
    assert.equal(toolResults1[0].ok, true, 'safe command executes immediately without mobile approval hang');
    assert.equal(toolResults1[1].ok, false, 'dangerous system command is still rejected on mobile');
    assert.match(toolResults1[1].summary, /手机端暂不支持审批弹窗/);
    assert.equal(events1.some(e => e.type === 'approval'), false, 'must not emit blocking approval wait on mobile');
    const done1 = events1.find(e => e.type === 'done');
    assert.match(done1?.reply || '', /手机端命令执行完成/);

    // Follow-up message in the same mobile scratch session retains loaded external skill & run_command
    let followRound = 0;
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            if (!Array.isArray(options.tools)) return { text: '测试对话' };
            followRound += 1;
            if (followRound === 1) {
                assert.match(options.systemInstruction, /thcli \+gen/);
                assert.ok(options.tools.some(tool => tool.name === 'run_command'));
                return { text: '', toolCalls: [{ id: 'c-follow', name: 'run_command', args: { command: 'node -p "10 + 1"' } }] };
            }
            const answer = '追问续接执行成功';
            options.onDelta?.(answer);
            return { text: answer, toolCalls: [] };
        }
    });
    const followRes = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer mobile-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 移动端',
            pagePath: '/',
            sessionId: done1.sessionId,
            stream: true,
            messages: [
                { role: 'user', content: '@thcli-image 生成一张测试图' },
                { role: 'model', content: done1.reply },
                { role: 'user', content: '再试一次' }
            ]
        })
    });
    assert.equal(followRes.status, 200);
    const followEvents = parseNdjson(await followRes.text());
    assert.equal(followEvents.find(e => e.type === 'tool_result')?.ok, true);
    assert.match(followEvents.find(e => e.type === 'done')?.reply || '', /追问续接执行成功/);

    // 2. Mobile admin resuming an existing session that already has saved agent_root uses that folder even when workspace is omitted;
    //    switching back to web with workspace clears mobileClient/unattended flags.
    const savedRoot = path.join(sandbox, 'saved-project');
    fs.mkdirSync(savedRoot, { recursive: true });
    fs.writeFileSync(path.join(savedRoot, 'marker.txt'), 'hello-mobile');
    const savedChatId = await chat.addMessage({ owner: 'admin', pagePath: '/', role: 'user', content: 'init' });
    await chat.setSessionAgent(savedChatId, { agentSessionId: 'saved-mobile-resume-1', root: savedRoot, owner: 'admin' });

    round = 0;
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            if (!Array.isArray(options.tools)) return { text: '测试对话' };
            round += 1;
            if (round === 1) {
                return { text: '', toolCalls: [{ id: 'c-pwd', name: 'run_command', args: { command: 'node -p "process.cwd()"' } }] };
            }
            const answer = '已恢复原目录';
            options.onDelta?.(answer);
            return { text: answer, toolCalls: [] };
        }
    });

    const res2 = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer mobile-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · Mobile',
            pagePath: '/',
            sessionId: savedChatId,
            stream: true,
            messages: [{ role: 'user', content: '看下当前目录' }]
        })
    });
    assert.equal(res2.status, 200);
    const events2 = parseNdjson(await res2.text());
    assert.equal(events2.find(e => e.type === 'tool_result')?.ok, true);
    const resumedSession = runManager.getSession('saved-mobile-resume-1', { username: 'admin', role: 'admin' }, 'default');
    assert.equal(resumedSession?.root, fs.realpathSync(savedRoot));
    assert.equal(resumedSession?.mobileClient, true);
    assert.equal(resumedSession?.unattended, true);

    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            options.onDelta?.('网页端正常');
            return { text: '网页端正常', toolCalls: [] };
        }
    });
    const webRes = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer mobile-admin-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            sessionId: savedChatId,
            workspace: { root: savedRoot, agentSessionId: 'saved-mobile-resume-1', permissionMode: 'ask' },
            stream: true,
            messages: [{ role: 'user', content: '回到网页端' }]
        })
    });
    assert.equal(webRes.status, 200);
    await webRes.text();
    assert.equal(resumedSession?.mobileClient, false);
    assert.equal(resumedSession?.unattended, false);
    assert.equal(resumedSession?.permissionMode, 'ask');

    // 3. Even when an external CLI skill is shared, a remote non-admin viewer remains blocked from workspace command execution
    await require('../backend/models/tool-distribution').setEntryAccess('skill:thcli-image', true);
    agentWorkspaceAccess.isAgentWorkspaceAllowed = () => false;
    const viewerRes = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer mobile-viewer-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 移动端',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '@thcli-image 生图' }]
        })
    });
    assert.equal(viewerRes.status, 400);
    const viewerJson = await viewerRes.json();
    assert.equal(viewerJson.code, 'SKILL_WORKSPACE_REQUIRED');
});
