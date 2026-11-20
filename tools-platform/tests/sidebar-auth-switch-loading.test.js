const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dcSource = fs.readFileSync(path.join(__dirname, '../frontend/js/home/dragon-claw.js'), 'utf8');
const wlSource = fs.readFileSync(path.join(__dirname, '../frontend/js/home/welink-threads.js'), 'utf8');
const clSource = fs.readFileSync(path.join(__dirname, '../frontend/js/home/conversation-list.js'), 'utf8');
const shSource = fs.readFileSync(path.join(__dirname, '../frontend/js/home/shared-conversations.js'), 'utf8');
const daSource = fs.readFileSync(path.join(__dirname, '../frontend/js/home/desktop-agents.js'), 'utf8');

function extractSlice(src, startMarker, endMarker) {
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `Expected slice between ${startMarker} and ${endMarker}`);
    return src.slice(start, end);
}

test('dragon-claw.js loadChatList recovers cleanly when employee ID switches mid-flight or via authchange/storage', async () => {
    const store = new Map([
        ['tools_user', 'userA'],
        ['tools_tenant_id', 'default'],
        ['tools_token', 'tokA']
    ]);
    const localStorage = {
        getItem: k => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v))
    };
    const sessionStorage = { getItem: () => null };
    const chatListEl = { innerHTML: '', hidden: false, addEventListener() {}, querySelectorAll: () => [] };
    const listeners = new Map();
    let renders = 0;

    let firstResolve;
    const requests = [];
    const fetch = async (url, opts) => {
        requests.push({ url, auth: opts?.headers?.Authorization, cache: opts?.cache, signal: opts?.signal });
        if (requests.length === 1) {
            return new Promise(resolve => { firstResolve = resolve; });
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({ items: [{ id: `chat-for-${store.get('tools_user')}`, title: `Chat ${store.get('tools_user')}` }] })
        };
    };

    const block = extractSlice(dcSource, 'const CHAT_PAGE = 80;', 'function chatGroupKey(')
        + '\n'
        + extractSlice(dcSource, 'function resetChatListForIdentity(', '// 滚到列表底部附近');

    const context = {
        localStorage,
        sessionStorage,
        AbortController,
        setTimeout,
        clearTimeout,
        fetch,
        el: { chatList: chatListEl, chatSearch: { value: '' } },
        state: { sessionId: '', controller: null },
        external: { active: false },
        currentUser: () => store.get('tools_user') || '',
        authHeaders: () => ({ Authorization: `Bearer ${store.get('tools_token')}` }),
        newChat: () => {},
        renderChatList: () => {
            renders += 1;
            chatListEl.innerHTML = context.chatList.loaded
                ? (context.chatList.failed ? '<div class="home-chat-empty">failed</div>' : context.chatList.items.map(i => i.id).join(','))
                : '<div class="home-chat-skeleton"></div>';
        },
        window: {
            addEventListener: (type, fn) => {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(fn);
            },
            HomeConversationList: { get: () => ({}) }
        }
    };
    vm.runInNewContext(`
        ${block}
        this.chatList = chatList;
        this.chatIdentity = chatIdentity;
        this.loadChatList = loadChatList;
        this.resetChatListForIdentity = resetChatListForIdentity;
    `, context);

    // 1. Mid-flight employee ID switch during initial load must not leave chatList stuck on skeleton.
    const firstPromise = context.loadChatList();
    store.set('tools_user', 'userB');
    store.set('tools_token', 'tokB');
    firstResolve({ ok: true, status: 200, json: async () => ({ items: [{ id: 'stale-userA' }] }) });
    await firstPromise;

    assert.equal(context.chatList.loaded, true, 'chatList must leave skeleton loading state after account switch');
    assert.equal(context.chatList.failed, false);
    assert.deepEqual([...context.chatList.items].map(i => i.id), ['chat-for-userB']);
    assert.equal(requests[1].auth, 'Bearer tokB');
    assert.equal(requests[1].cache, 'no-store');
    assert.equal(chatListEl.innerHTML, 'chat-for-userB');

    // 2. Subsequent in-tab identity switch clears stale items and loads new account cleanly.
    store.set('tools_user', 'userC');
    store.set('tools_token', 'tokC');
    context.resetChatListForIdentity();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.chatList.loaded, true);
    assert.deepEqual([...context.chatList.items].map(i => i.id), ['chat-for-userC']);
    assert.ok(renders > 0);
});

test('welink-threads.js loadThreads retries on mid-flight identity change instead of stranding skeleton', async () => {
    const store = new Map([
        ['tools_user', 'userA'],
        ['tools_tenant_id', 'default'],
        ['tools_token', 'tokA']
    ]);
    let listLoaded = false;
    let firstResolve;
    const requests = [];
    const context = {
        API_BASE: '/api/channels',
        CHANNEL_IDS: ['welink', 'weixin'],
        THREAD_PAGE: 40,
        localStorage: { getItem: k => store.get(k) ?? null },
        sessionStorage: { getItem: () => null },
        identity: () => ['tools_user', 'tools_tenant_id', 'tools_token'].map(k => store.get(k) || '').join('|'),
        el: { search: { value: '' }, list: { innerHTML: '' } },
        state: {
            source: 'welink',
            seq: 0,
            loaded: false,
            failed: false,
            threads: [],
            allThreads: [],
            threadsByChannel: new Map(),
            pinnedEntries: [],
            drafts: new Map(),
            allChannelThreads: [],
            allChannelSignature: '',
            listIdentity: '',
            listQuery: '',
            serverCount: 0,
            hasMore: false,
            openLatestSource: null,
            active: null,
            identity: 'userA|default|tokA',
            threadsAbort: null
        },
        AbortController,
        renderThreads: () => { listLoaded = context.state.loaded; },
        loadChannels: () => {},
        window: { HomeConversationList: { get: () => ({}) }, DragonClaw: { newChat: () => {} } },
        request: async (_method, url) => {
            requests.push(store.get('tools_user'));
            if (requests.length === 1) return new Promise(resolve => { firstResolve = resolve; });
            return { items: [{ kind: 'group', id: `g-${store.get('tools_user')}`, name: '群' }], hasMore: false };
        }
    };
    const fnSlice = extractSlice(wlSource, 'async function loadThreads(', 'function isThreadLiveBusy(')
        + '\n'
        + extractSlice(wlSource, 'function resetForIdentityChange(', 'function init()');
    vm.runInNewContext(`${fnSlice}\nthis.loadThreads = loadThreads;`, context);

    const p = context.loadThreads();
    assert.equal(listLoaded, false);
    store.set('tools_user', 'userB');
    store.set('tools_token', 'tokB');
    firstResolve({ items: [{ kind: 'group', id: 'g-stale', name: '旧群' }], hasMore: false });
    await p;

    assert.equal(context.state.loaded, true, 'loadThreads must not stay stuck with state.loaded=false');
    assert.deepEqual([...context.state.threads].map(t => t.id), ['g-userB']);
    assert.equal(listLoaded, true);
});

test('all sidebar modules synchronize on both tools:authchange and storage events', () => {
    assert.match(dcSource, /addEventListener\('tools:authchange'/);
    assert.match(dcSource, /addEventListener\('storage'/);
    assert.match(wlSource, /addEventListener\('tools:authchange'/);
    assert.match(wlSource, /addEventListener\('storage'/);
    assert.match(clSource, /addEventListener\('tools:authchange'/);
    assert.match(clSource, /addEventListener\('storage'/);
    assert.match(shSource, /addEventListener\('tools:authchange'/);
    assert.match(shSource, /addEventListener\('storage'/);
    assert.match(daSource, /addEventListener\('tools:authchange'/);
    assert.match(daSource, /addEventListener\('storage'/);
});
