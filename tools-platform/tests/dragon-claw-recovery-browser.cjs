// Run: node_modules/.bin/electron tests/dragon-claw-recovery-browser.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict'), acorn = require('acorn');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-recovery-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
function parsed(file) {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/js/home', file), 'utf8');
    return { source, nodes: acorn.parse(source, { ecmaVersion: 'latest' }).body[0].expression.callee.body.body };
}
const home = parsed('dragon-claw.js'), panel = parsed('workspace-panel.js');
function functions(module, names) { return module.nodes.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name)).map(node => module.source.slice(node.start, node.end)).join('\n'); }
const apiNode = panel.nodes.find(node => node.type === 'ExpressionStatement' && node.expression.left?.property?.name === 'DragonClawWorkspace');
const methods = apiNode.expression.right.properties.filter(node => ['resumeWorkspace', 'adoptSession', 'resetSession', 'getWorkspacePayload'].includes(node.key.name)).map(node => panel.source.slice(node.start, node.end)).join(',\n');
let win;
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);
app.whenReady().then(async () => {
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await win.loadURL('data:text/html,<div id="thread"></div><form><textarea></textarea><button></button></form>');
    await win.webContents.executeJavaScript(`
        window.selection = null;
        window.panelFixture = (() => {
            const state = { enabled: true, root: '/B', agentSessionId: 'agent-B', permissionMode: 'full', selectionEpoch: 0, prefs: {}, pr: null };
            const API = '/fixture', SESSION_KEY = 'fixture-id', SESSION_ROOT_KEY = 'fixture-root';
            const prLog = document.createElement('div'), approvalCards = new Map(), toolRows = new Map();
            const renderAll = () => {}, renderContext = () => {}, renderChanges = () => {}, renderEnv = () => {}, setOpen = () => {}, toast = () => {};
            let changesRefreshing = false;
            const applyChanges = changes => { state.changes = changes; };
            const confirmRevertConflict = () => new Promise(resolve => { window.resolveConfirmation = resolve; });
            const tx = key => key, baseName = value => value, restoreState = async () => {};
            const adoptSessionId = value => value, newSessionId = () => 'new-agent-id';
            window.networkTrace = [];
            const request = async (method, url, body) => new Promise((resolve, reject) => { window.networkTrace.push({ method, url, body }); window.selection = { path: body?.path, resolve, reject }; });
            ${functions(panel, ['selectDirectory', 'clearDirectory', 'handleEvent', 'applyDone', 'refreshChanges', 'toggleDiff', 'revert'])}
            const api = { ${methods} };
            return { state, api, handleEvent, applyDone, refreshChanges, toggleDiff, revert };
        })();
        const state = { messages: [], controller: null, restoring: false, sessionId: 'chat-B' };
        let resumeEpoch = 0;
        const el = { thread: document.getElementById('thread'), input: document.querySelector('textarea'), form: document.querySelector('form'), send: document.querySelector('button') };
        const workspace = () => panelFixture.api;
        const tx = key => key, escapeHtml = value => value;
        const lang = () => 'zh-CN';
        const addHistoryMessage = () => {}, rememberLastChat = () => {}, hideResumeCard = () => {}, setChatting = () => {}, scrollThread = () => {};
        const showToast = text => { window.lastToast = text; }, refreshResumeCard = () => {}, prefersReducedMotion = () => true;
        const AVATAR = '', renderMarkdown = value => value, autoResize = () => {};
        const runSlashCommand = () => false, currentModel = () => null, buildContext = () => '', collectClientToolData = async () => [];
        const waitForAssistant = async () => ({ async requestStreamingChat(payload) { window.lastPayload = payload; return { reply: 'done' }; } });
        const addMessageTools = () => {};
        ${functions(home, ['updateSendButton', 'resumeChat', 'newChat', 'send', 'addMessage', 'showThinking', 'createRenderer'])}
        window.fixture = { state, el, resumeChat, newChat, send };
        void 0;
    `);
    const pending = await evaluate(() => {
        window.resumeTask = fixture.resumeChat({ sessionId: 'chat-A', items: [], agent: { root: '/A', agentSessionId: 'agent-A' } });
        return { restoring: fixture.state.restoring, disabled: fixture.el.input.disabled, session: fixture.state.sessionId };
    });
    assert.deepEqual(pending, { restoring: true, disabled: true, session: 'chat-B' });
    await evaluate(() => fixture.send('must not execute during restoration'));
    assert.equal(await evaluate(() => !!window.lastPayload), false);
    await evaluate(() => { selection.resolve({ root: '/A', name: 'A', agentSessionId: 'latest-A' }); });
    await evaluate(() => window.resumeTask);
    assert.equal(await evaluate(() => fixture.state.sessionId), 'chat-A');
    assert.deepEqual(await evaluate(() => panelFixture.api.getWorkspacePayload()), { root: '/A', agentSessionId: 'agent-A', permissionMode: 'full' });
    await evaluate(() => fixture.send('continue A'));
    assert.equal(await evaluate(() => window.lastPayload.workspace.root), '/A');
    assert.equal(await evaluate(() => window.lastPayload.workspace.agentSessionId), 'agent-A');

    await evaluate(() => {
        panelFixture.state.root = '/B'; panelFixture.state.agentSessionId = 'agent-B';
        window.resumeTask = fixture.resumeChat({ sessionId: 'missing-chat', items: [], agent: { root: '/missing', agentSessionId: 'missing-agent' } });
        selection.reject(new Error('missing directory'));
    });
    await evaluate(() => window.resumeTask);
    assert.equal(await evaluate(() => panelFixture.api.getWorkspacePayload()), null, 'missing A must never fall back to B');
    assert.equal(await evaluate(() => fixture.state.sessionId), 'missing-chat');
    assert.equal(await evaluate(() => fixture.el.input.disabled), false);

    await evaluate(async () => { panelFixture.state.root = '/B'; await fixture.resumeChat({ sessionId: 'plain-chat', items: [] }); });
    assert.equal(await evaluate(() => panelFixture.api.getWorkspacePayload()), null, 'plain histories clear an unrelated selected workspace');

    await evaluate(() => {
        panelFixture.state.root = '/B'; panelFixture.state.agentSessionId = 'agent-B';
        window.resumeTask = fixture.resumeChat({ sessionId: 'stale-A', items: [], agent: { root: '/A', agentSessionId: 'agent-A' } });
        fixture.newChat();
        selection.resolve({ root: '/A', name: 'A', agentSessionId: 'old-A' });
    });
    await evaluate(() => window.resumeTask);
    assert.equal(await evaluate(() => fixture.state.sessionId), null);
    assert.equal(await evaluate(() => panelFixture.state.root), '/B', 'a late directory response must not override New Chat');
    assert.equal(await evaluate(() => fixture.state.restoring), false);
    await evaluate(() => {
        panelFixture.state.root = '/B'; panelFixture.state.agentSessionId = 'agent-B'; panelFixture.state.changes = [];
        panelFixture.applyDone({ agentSessionId: 'agent-A', agent: { root: '/A' }, changes: [{ path: 'old-A' }] });
        panelFixture.handleEvent(document.body, { type: 'change', path: 'old-A' }, { root: '/A', agentSessionId: 'agent-A' });
    });
    assert.deepEqual(await evaluate(() => panelFixture.state.changes), []);
    await evaluate(() => {
        window.pollTask = panelFixture.refreshChanges();
        panelFixture.state.agentSessionId = 'other-chat-in-B';
        selection.resolve({ changes: [{ path: 'stale-poll' }] });
    });
    await evaluate(() => window.pollTask);
    assert.deepEqual(await evaluate(() => panelFixture.state.changes), [], 'polling cannot cross sessions even when the root stays the same');
    await evaluate(() => {
        panelFixture.state.root = '/A'; panelFixture.state.agentSessionId = 'agent-A';
        window.revertTask = panelFixture.revert('same-name.txt');
        selection.reject(Object.assign(new Error('conflict'), { code: 'AGENT_CHANGE_CONFLICT' }));
    });
    const before = await evaluate(() => window.networkTrace.length);
    await evaluate(() => {
        panelFixture.state.root = '/B'; panelFixture.state.agentSessionId = 'agent-B';
        resolveConfirmation(true);
    });
    await evaluate(() => window.revertTask);
    assert.equal(await evaluate(() => window.networkTrace.length), before, 'confirming an old conflict must not force-revert the same filename in B');
    console.log('PASS: restore/send ordering, missing directory/plain chat isolation, stale restoration/poll/completion guards and target-bound conflict undo.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { win?.destroy(); app.exit(process.exitCode || 0); });
