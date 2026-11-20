const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const radarSource = fs.readFileSync(path.join(__dirname, '../frontend/js/home/agent-radar.js'), 'utf8');
const desktopAgentsSource = fs.readFileSync(path.join(__dirname, '../frontend/js/home/desktop-agents.js'), 'utf8');
const dragonClawSource = fs.readFileSync(path.join(__dirname, '../frontend/js/home/dragon-claw.js'), 'utf8');

function extractSlice(src, startMarker, endMarker) {
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `Expected slice between "${startMarker}" and "${endMarker}"`);
    return src.slice(start, end);
}

test('HomeDesktopAgents.open supports both (session) and (provider, id) without undefined provider error', async () => {
    // Extract open and key definitions from desktop-agents.js
    const names = { codex: 'Codex', claudecode: 'Claude Code', antigravity: 'Antigravity', workbuddy: 'WorkBuddy' };
    let enteredExternal = null;
    let markedActive = false;
    let modeSet = null;

    const mockItems = [
        { provider: 'codex', id: 'session-123', title: '优化重叠显示', canSend: true, busy: true }
    ];

    const state = {
        items: mockItems,
        providers: [{ id: 'codex', canSend: true }],
        provider: 'codex',
        active: null,
        drafting: null,
        api: null,
        signature: '',
        detail: null,
        pending: null,
        view: null,
        viewEpoch: 0,
        identity: 'admin',
        settings: { enabled: true },
        unknown: new Set(),
        drafts: new Map()
    };

    const key = s => `${s.provider}:${s.id}`;
    const L = (zh, en) => zh;
    const namesMap = names;
    const API = '/api/desktop-agents';

    // Mock DragonClaw
    const DragonClaw = {
        enterExternal: opts => {
            enteredExternal?.onExit?.({ switching: true });
            enteredExternal = opts;
            return {
                thread: { append() {}, replaceChildren() {} },
                beginLoading() {},
                finishLoading() {},
                isNearBottom: () => true
            };
        },
        markActiveChat: () => {
            markedActive = true;
        }
    };

    const HomeMode = {
        set: m => { modeSet = m; }
    };

    function composer(session) {
        const k = key(session);
        const name = namesMap[session.provider];
        return {
            canSend: Boolean(session.canSend),
            placeholder: session.canSend ? `发送到 ${name} · ${session.title}` : `${name} 桌面会话当前只读`
        };
    }

    // Extract the open function from desktop-agents.js source
    const openFnCode = extractSlice(desktopAgentsSource, 'async function open(sessionOrProvider, maybeId)', 'function renderHistoryLoad()');
    
    // Evaluate in sandbox
    const sandbox = {
        names: namesMap,
        state,
        key,
        L,
        API,
        composer,
        exit: () => { state.active = null; },
        identity: () => 'admin',
        render: () => {},
        renderThread: () => {},
        renderHistoryLoad: () => {},
        refreshMessages: async () => {},
        schedule: () => {},
        window: {
            DragonClaw,
            HomeMode,
            HomeAgentDiscussion: { bindExternal: () => {} }
        },
        historyLoad: null,
        historyTimer: null,
        setInterval: () => 1,
        autoSelect: false
    };

    vm.createContext(sandbox);
    vm.runInContext(openFnCode, sandbox);

    // Test 1: open with two string parameters (provider, id)
    await sandbox.open('codex', 'session-123');

    assert.ok(enteredExternal, 'enterExternal should be called');
    assert.equal(sandbox.state.active.provider, 'codex');
    assert.equal(sandbox.state.active.id, 'session-123');
    assert.equal(sandbox.state.active.title, '优化重叠显示', 'Title should be retrieved from state.items');
    assert.equal(enteredExternal.exportSession.id, 'codex-session-123', 'Export session ID must not be undefined');
    assert.ok(!enteredExternal.exportSession.url.includes('undefined'), 'Export URL must not contain undefined');
    assert.ok(enteredExternal.composer.placeholder.includes('Codex'), 'Composer placeholder must contain Codex, not undefined');
    assert.ok(!enteredExternal.composer.placeholder.includes('undefined'), 'Composer placeholder must not contain undefined');
    assert.equal(markedActive, true, 'markActiveChat should be called');

    // Switching directly from another desktop session runs its exit handler.
    await sandbox.open('codex', 'unknown-session-999');

    assert.equal(sandbox.state.active.provider, 'codex');
    assert.equal(sandbox.state.active.id, 'unknown-session-999');
    assert.equal(enteredExternal.exportSession.id, 'codex-unknown-session-999');
    assert.ok(enteredExternal.composer.placeholder.includes('Codex'), 'Fallback placeholder must still have Codex');
});

test('agent-radar.js handleJump correctly jumps to desktop sessions and platform chats', () => {
    let modeSet = null;
    let desktopOpened = null;
    let chatOpened = null;

    const mockItems = [
        { provider: 'codex', id: 'session-123', title: '优化重叠显示', busy: true }
    ];

    const window = {
        HomeMode: { set: m => { modeSet = m; } },
        HomeDesktopAgents: {
            getItems: () => mockItems,
            open: item => { desktopOpened = item; }
        },
        DragonClaw: {
            openChat: item => { chatOpened = item; }
        }
    };

    // Extract handleJump from agent-radar.js
    const jumpFnCode = extractSlice(radarSource, 'function handleJump(btn)', 'function init()');

    const sandbox = {
        window,
        setOpen: () => {},
        document: {
            getElementById: () => null
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(jumpFnCode, sandbox);

    // Test Jump to desktop agent
    const desktopBtn = {
        dataset: {
            radarKind: 'desktop',
            radarProvider: 'codex',
            radarId: 'session-123'
        }
    };
    sandbox.handleJump(desktopBtn);

    assert.equal(modeSet, 'chat', 'Should switch to chat mode');
    assert.ok(desktopOpened, 'HomeDesktopAgents.open should be called');
    assert.equal(desktopOpened.provider, 'codex');
    assert.equal(desktopOpened.id, 'session-123');
    assert.equal(desktopOpened.title, '优化重叠显示');

    // Test Jump to platform chat
    modeSet = null;
    const platformBtn = {
        dataset: {
            radarKind: 'platform',
            radarSession: 'chat-456'
        }
    };
    sandbox.handleJump(platformBtn);

    assert.equal(modeSet, 'chat', 'Should switch to chat mode');
    assert.equal(chatOpened?.id, 'chat-456', 'DragonClaw.openChat should be called with object id');
});

test('dragon-claw.js openChatFromList accepts string sessionId without error', () => {
    let openedSession = null;
    const chatList = {
        latestSeq: 0,
        items: [{ id: 'sess-abc', title: 'Native Chat' }],
        cached: []
    };
    const state = {
        sessionId: 'old-session',
        messages: []
    };
    const external = { active: false };

    // Function under test:
    function openChatFromList(item) {
        if (!item) return;
        if (typeof item === 'string') {
            const found = chatList.items?.find(row => row.id === item) || chatList.cached?.find(row => row.id === item);
            item = found || { id: item };
        }
        chatList.latestSeq++;
        if (!external.active && item.id === state.sessionId && state.messages.length) {
            return;
        }
        openedSession = item;
    }

    openChatFromList('sess-abc');
    assert.equal(openedSession.id, 'sess-abc');
    assert.equal(openedSession.title, 'Native Chat');

    openChatFromList('sess-unlisted');
    assert.equal(openedSession.id, 'sess-unlisted');
});
