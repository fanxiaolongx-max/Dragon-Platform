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

test('web stream auto-assigns a hidden scratch workspace when no folder is chosen, reuses it on follow-ups, and respects explicit folders', async t => {
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

    // 1. Turn without workspace automatically runs in hidden scratch workspace without workspace_choice interruption
    let cmdSeen = '';
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            const hasRunCommand = (options.tools || []).some(tool => tool.name === 'run_command');
            assert.equal(hasRunCommand, true, 'agent mode provides run_command automatically via hidden scratch workspace');
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
        if (evt.type === 'approval' && evt.tool === 'run_command') {
            await fetch(`${baseUrl}/api/agent-workspace/approvals/${encodeURIComponent(evt.id)}`, {
                method: 'POST', headers, body: JSON.stringify({ decision: 'allow' })
            });
        }
    });
    const chatSessionId = scratchEvents.find(e => e.type === 'start')?.sessionId;
    assert.ok(chatSessionId);
    assert.equal(scratchEvents.some(e => e.preview?.kind === 'workspace_choice'), false);
    assert.match(cmdSeen, /42/);
    const doneScratch = scratchEvents.find(e => e.type === 'done');
    assert.equal(doneScratch?.agent?.scratch, true);
    assert.equal(doneScratch?.agent?.root, undefined);
    const savedSession = await chat.getSession(chatSessionId);
    assert.equal(savedSession?.agent || null, null, 'hidden scratch path is not exposed in chat session metadata');

    // 2. Follow-up in the same chat session reuses hidden scratch workspace seamlessly
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
    assert.equal(followupEvents.some(e => e.preview?.kind === 'workspace_choice'), false);
    assert.equal(followupEvents.find(e => e.type === 'done')?.agent?.scratch, true);

    // 3. Explicit folder selection uses the selected folder
    const chosenFolder = path.join(sandbox, 'picked-project');
    fs.mkdirSync(chosenFolder, { recursive: true });
    fs.writeFileSync(path.join(chosenFolder, 'marker.txt'), 'REAL_DIR');
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            assert.equal((options.tools || []).some(t => t.name === 'run_command'), true);
            options.onDelta?.('目录检查完成');
            return { text: '目录检查完成', toolCalls: [] };
        }
    });
    const folderEvents = await readNdjsonStream(await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            stream: true,
            workspace: { agentSessionId: 'ws-explicit-test-1', root: chosenFolder, permissionMode: 'auto' },
            messages: [{ role: 'user', content: '@debug 检查目录' }]
        })
    }));
    const doneFolder = folderEvents.find(e => e.type === 'done');
    assert.equal(doneFolder?.agent?.root, fs.realpathSync(chosenFolder));

    // 4. Ordinary chat without explicit @skill also enters scratch workspace and can dynamically load_skill
    provider.createClient = () => ({
        model: 'mock-model',
        async generateText(options) {
            const names = (options.tools || []).map(t => t.name);
            assert.equal(names.includes('run_command'), true);
            assert.equal(names.includes('ask_user'), true);
            if (!options.messages.some(m => m.role === 'tool')) {
                return { toolCalls: [{ id: 'ls-1', name: 'load_skill', args: { id: 'debug' } }] };
            }
            options.onDelta?.('统一工作区链路完成');
            return { text: '统一工作区链路完成', toolCalls: [] };
        }
    });
    const ordinaryEvents = await readNdjsonStream(await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            agent: 'dragon-claw-home',
            pageTitle: 'Dragon Claw · 首页',
            pagePath: '/',
            stream: true,
            messages: [{ role: 'user', content: '帮我查一下' }]
        })
    }));
    assert.ok(ordinaryEvents.some(e => e.type === 'tool_result' && e.tool === 'load_skill' && e.ok === true));
    assert.equal(ordinaryEvents.find(e => e.type === 'done')?.agent?.scratch, true);
    assert.match(ordinaryEvents.find(e => e.type === 'done')?.reply || '', /统一工作区链路完成/);
});
