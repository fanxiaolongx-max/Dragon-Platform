const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-claw-ws-choice-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const { tenantMiddleware } = require('../backend/models/tenant-context');
const authSessions = require('../backend/models/auth-sessions-repository');
const chat = require('../backend/models/ai-chat-repository');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const runManager = require('../backend/models/agent-run-manager');
const toolRegistry = require('../backend/models/agent-tool-registry');
const agentWorkspaceAccess = require('../backend/models/agent-workspace-access');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');
const router = require('../backend/routes/ai');
const agentWorkspaceRouter = require('../backend/routes/agent-workspace');
const agentSkills = require('../backend/models/agent-skills');

async function readNdjsonStream(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const events = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) {
                const evt = JSON.parse(line);
                events.push(evt);
                if (onEvent) await onEvent(evt);
            }
            nl = buffer.indexOf('\n');
        }
    }
    const tail = buffer.trim();
    if (tail) {
        const evt = JSON.parse(tail);
        events.push(evt);
        if (onEvent) await onEvent(evt);
    }
    return events;
}

test('temporary timed workspaces expire and delete files, and core=false blocks workspace skills without upgrade handler', async () => {
    const user = { username: 'tempuser', role: 'admin' };
    const chatId = 'chat-temp-ttl-1';
    const tempSession = runManager.ensureTemporarySession({ user, tenantId: 'default', chatSessionId: chatId, ttlMs: 120_000 });
    assert.equal(tempSession.scratch, true);
    assert.equal(tempSession.temporary, true);
    assert.ok(fs.existsSync(tempSession.root));
    assert.ok(chat.isScratchDirectory(tempSession.root));
    fs.writeFileSync(path.join(tempSession.root, 'note.txt'), 'ephemeral');

    // Simulating restart (memory eviction) still recovers non-expired temporary workspace
    runManager._internal.sessions.delete(tempSession.id);
    const restored = runManager.existingTemporarySession({ user, tenantId: 'default', chatSessionId: chatId });
    assert.ok(restored, 'non-expired temporary workspace is restored for the same chat');
    assert.equal(restored.root, tempSession.root);

    // Expiring the metadata triggers automatic directory & session cleanup
    const metaPath = `${tempSession.root}.ttl.json`;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.expiresAt = Date.now() - 1000;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    const afterExpiry = runManager.existingTemporarySession({ user, tenantId: 'default', chatSessionId: chatId });
    assert.equal(afterExpiry, null);
    assert.equal(fs.existsSync(tempSession.root), false, 'expired temporary directory is deleted from disk');
    assert.equal(fs.existsSync(metaPath), false, 'expired metadata sidecar is deleted from disk');

    // Without workspace tools (core: false) and without upgrade handler, loading a workspace skill fails instead of leaking bash instructions
    await require('../backend/models/tool-distribution').setEntryAccess('skill:debug', true);
    const chatReg = await toolRegistry.create({ session: { readOnly: false }, user: { username: 'admin', role: 'admin' }, core: false, skillCatalog: true });
    const searchRes = await chatReg.runMeta({ name: 'tool_search', args: { select: ['debug'] } });
    assert.equal(searchRes.isError, true);
    assert.match(searchRes.summary, /需要工作区/);
    assert.doesNotMatch(searchRes.content, /### @debug/);
    const loadRes = await chatReg.runMeta({ name: 'load_skill', args: { id: 'debug' } });
    assert.equal(loadRes.isError, true);
    assert.match(loadRes.summary, /需要工作区/);

    // autoSelect carries @wechat-vault across short/message follow-ups when @wechat-vault was used earlier,
    // without pulling unrelated conversations into wechat-vault
    assert.deepEqual(agentSkills.autoSelect('今天谁找我了', { contextMessages: [{ role: 'user', content: 'hi' }] }).includes('wechat-vault'), false);
    assert.equal(
        agentSkills.autoSelect('今天谁找我了', { contextMessages: [{ role: 'user', content: '@wechat-vault 总结今天消息' }] }).includes('wechat-vault'),
        true
    );
    assert.equal(
        agentSkills.autoSelect('18号', { contextMessages: [{ role: 'model', content: '...', events: [{ type: 'skills', skills: ['wechat-vault'] }] }] }).includes('wechat-vault'),
        true
    );
});

test('web stream prompts workspace choice card at turn start and mid-turn upgrade, supporting scratch, folder selection, cancel, and follow-up reuse', async t => {
    const origGetRuntime = settings.getRuntimeSettings;
    const origGetSecrets = settings.getRedactionSecrets;
    const origCreateClient = provider.createClient;
    const origWorkspaceAllowed = agentWorkspaceAccess.isAgentWorkspaceAllowed;

    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    app.use('/api/ai', router);
    app.use('/api/agent-workspace', agentWorkspaceRouter);
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
    agentWorkspaceAccess.isAgentWorkspaceAllowed = () => true;
    await authSessions.saveSession('web-admin-token', 'admin', 'admin', Date.now() + 60000, 'default');
    const headers = { Authorization: 'Bearer web-admin-token', 'Content-Type': 'application/json' };
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    let modelCalls = 0;
    const respondOnApproval = (decisionPayload, onApproved) => async evt => {
        if (evt.type === 'approval' && evt.preview?.kind === 'workspace_choice') {
            const res = await fetch(`${baseUrl}/api/agent-workspace/approvals/${encodeURIComponent(evt.id)}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(decisionPayload)
            });
            const body = await res.json();
            if (onApproved) onApproved(res.status, body);
        }
    };

    // 1. Cancel on turn-start card: never calls the model
    const cancelEvents = await readNdjsonStream(await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '@debug 帮我排查下问题' }]
        })
    }), respondOnApproval({ decision: 'deny' }));
    assert.equal(modelCalls, 0);
    assert.ok(cancelEvents.some(e => e.type === 'approval' && e.preview?.kind === 'workspace_choice'));
    assert.ok(cancelEvents.some(e => e.type === 'approval_result' && e.decision === 'deny'));
    assert.match(cancelEvents.find(e => e.type === 'done')?.reply || '', /已取消/);

    // 2. Choose temporary timed workspace on turn-start card, run command, then follow up seamlessly without re-prompting
    let cmdSeen = '';
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            modelCalls += 1;
            const hasRunCommand = (options.tools || []).some(tool => tool.name === 'run_command');
            assert.equal(hasRunCommand, true, 'agent mode provides run_command after scratch choice');
            if (!options.messages.some(m => m.role === 'tool')) {
                return { toolCalls: [{ id: 'rc-1', name: 'run_command', args: { command: 'node -p "21 * 2"' } }] };
            }
            cmdSeen = options.messages.find(m => m.role === 'tool')?.toolResults?.[0]?.content || '';
            options.onDelta?.('临时工作区执行结果 42');
            return { text: '临时工作区执行结果 42', toolCalls: [] };
        }
    });

    const scratchEvents = await readNdjsonStream(await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '@debug 跑一下验证' }]
        })
    }), async evt => {
        if (evt.type === 'approval' && evt.preview?.kind === 'workspace_choice') {
            await respondOnApproval({ decision: 'scratch' })(evt);
        } else if (evt.type === 'approval' && evt.tool === 'run_command') {
            await fetch(`${baseUrl}/api/agent-workspace/approvals/${encodeURIComponent(evt.id)}`, {
                method: 'POST', headers, body: JSON.stringify({ decision: 'allow' })
            });
        }
    });
    const chatSessionId = scratchEvents.find(e => e.type === 'start')?.sessionId;
    assert.ok(chatSessionId);
    assert.ok(scratchEvents.some(e => e.type === 'approval_result' && e.decision === 'scratch' && e.ttlHours === 24));
    assert.match(cmdSeen, /42/);
    const doneScratch = scratchEvents.find(e => e.type === 'done');
    assert.equal(doneScratch?.agent?.scratch, true);

    // Follow-up in the same chat session without workspace payload or @debug reuses active temporary workspace with zero workspace prompts
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            assert.equal((options.tools || []).some(t => t.name === 'run_command'), true);
            options.onDelta?.('继续复用临时工作区');
            return { text: '继续复用临时工作区', toolCalls: [] };
        }
    });
    const followupEvents = await readNdjsonStream(await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            sessionId: chatSessionId,
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '@debug 跑一下验证' }, { role: 'model', content: 'done' }, { role: 'user', content: '再看下' }]
        })
    }));
    assert.equal(followupEvents.some(e => e.preview?.kind === 'workspace_choice'), false, 'active temporary workspace is reused without prompting again');
    assert.equal(followupEvents.find(e => e.type === 'done')?.agent?.scratch, true);

    // 3. Choose real directory on turn-start card
    const chosenFolder = path.join(sandbox, 'picked-project');
    fs.mkdirSync(chosenFolder, { recursive: true });
    fs.writeFileSync(path.join(chosenFolder, 'marker.txt'), 'REAL_DIR');
    const folderEvents = await readNdjsonStream(await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '@debug 检查目录' }]
        })
    }), respondOnApproval({ decision: 'select_workspace', root: chosenFolder }));
    const doneFolder = folderEvents.find(e => e.type === 'done');
    assert.equal(doneFolder?.agent?.root, fs.realpathSync(chosenFolder));

    // 4. Mid-turn upgrade from database/normal chat when model calls tool_search for a workspace skill
    let phase = 'chat';
    let upgradedToolNames = [];
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            const names = (options.tools || []).map(t => t.name);
            if (!names.length) return { text: '测试对话', toolCalls: [] };
            if (phase === 'chat') {
                assert.equal(names.includes('run_command'), false);
                phase = 'upgrading';
                return { toolCalls: [{ id: 'ts-1', name: 'tool_search', args: { select: ['debug'] } }] };
            }
            upgradedToolNames = names;
            assert.equal(names.includes('run_command'), true, 'upgraded turn has run_command immediately');
            options.onDelta?.('升级工作区后完成');
            return { text: '升级工作区后完成', toolCalls: [] };
        }
    });
    const midTurnEvents = await readNdjsonStream(await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '帮我调试这个问题' }]
        })
    }), respondOnApproval({ decision: 'scratch' }));
    assert.ok(midTurnEvents.some(e => e.type === 'tool_start' && e.tool === 'tool_search'));
    assert.ok(midTurnEvents.some(e => e.type === 'approval' && e.preview?.kind === 'workspace_choice'));
    assert.ok(midTurnEvents.some(e => e.type === 'approval_result' && e.decision === 'scratch'));
    assert.ok(midTurnEvents.some(e => e.type === 'tool_result' && e.ok === true));
    assert.equal(upgradedToolNames.includes('run_command'), true);
    assert.equal(midTurnEvents.find(e => e.type === 'done')?.agent?.scratch, true);
    assert.match(midTurnEvents.find(e => e.type === 'done')?.reply || '', /升级工作区后完成/);

    // 5. Mid-turn upgrade cancelled (deny): stays out of run_command and informs model cancellation
    let midCancelToolResult = '';
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            const names = (options.tools || []).map(t => t.name);
            if (!names.length) return { text: '测试对话', toolCalls: [] };
            if (!options.messages.some(m => m.role === 'tool')) {
                return { toolCalls: [{ id: 'ls-1', name: 'load_skill', args: { id: 'debug' } }] };
            }
            midCancelToolResult = options.messages.find(m => m.role === 'tool')?.toolResults?.[0]?.content || '';
            assert.equal(names.includes('run_command'), false);
            options.onDelta?.('好的，已取消分配工作区');
            return { text: '好的，已取消分配工作区', toolCalls: [] };
        }
    });
    const midCancelEvents = await readNdjsonStream(await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '帮我查一下' }]
        })
    }), respondOnApproval({ decision: 'deny' }));
    assert.ok(midCancelEvents.some(e => e.type === 'approval_result' && e.decision === 'deny'));
    assert.match(midCancelToolResult, /用户取消了选择或分配工作区/);
    assert.equal(Boolean(midCancelEvents.find(e => e.type === 'done')?.agent), false);
});
