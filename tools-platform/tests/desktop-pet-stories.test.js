const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-stories-'));
process.env.TOOLS_DATA_DIR = sandbox;
process.env.TOOLS_DESKTOP_RUNTIME = '1';
const db = require('../backend/models/app-db');
const repo = require('../backend/models/pet-stories-repository');
const seeds = require('../backend/builtin-content/pet-stories');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
test.after(async () => { await db.closeDatabase(); fs.rmSync(sandbox, { recursive: true, force: true }); });

test('40 complete bilingual stories seed once, preserve edits, isolate tenants and survive reopen', async () => {
    assert.equal(seeds.length, 40);
    assert.equal(new Set(seeds.map(s => s.id)).size, 40);
    for (const seed of seeds) {
        assert.ok(seed.zh.body.length >= 200 && seed.en.body.length >= 300, seed.id);
        assert.equal(seed.zh.body.split('\n\n').length, 3);
        assert.ok(seed.zh.hook.length < 90 && seed.en.hook.length < 190);
        assert.ok(seed.sources.length && seed.sources.every(s => s.url.startsWith('https://')));
    }
    const catalogs = await Promise.all([repo.listStories('zh-CN'), repo.listStories('en-US'), repo.listStories('zh-CN')]);
    assert.equal(catalogs[0].length, 40);
    assert.notEqual(catalogs[0][0].title, catalogs[1][0].title);
    assert.equal(catalogs[0][0].body, undefined, 'catalog only transfers hooks');
    await db.run("UPDATE desktop_pet_stories SET body_zh=? WHERE id='moon-days'", ['tenant default customized story']);
    await runWithTenant('story-a', async () => {
        assert.equal((await repo.listStories('zh-CN')).length, 40);
        assert.match((await repo.getStory('moon-days')).body, /我是图特/);
        await db.run("UPDATE desktop_pet_stories SET body_zh=? WHERE id='moon-days'", ['tenant a customized story']);
    });
    await runWithTenant('story-b', async () => assert.match((await repo.getStory('moon-days')).body, /我是图特/));
    assert.equal(await repo.getStory("' OR 1=1 --"), null);
    assert.equal(await repo.getStory('missing-story'), null);
    await db.closeDatabase();
    assert.equal((await repo.getStory('moon-days')).body, 'tenant default customized story');
    await runWithTenant('story-a', async () => assert.equal((await repo.getStory('moon-days')).body, 'tenant a customized story'));
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM desktop_pet_stories')).n, 40);
});

test('story API requires authenticated local desktop and applies session tenant', async () => {
    const express = require('../backend/node_modules/express');
    const app = express();
    app.use((req, res, next) => {
        if (req.headers['x-test-user']) req.user = { tenantId: req.headers['x-test-tenant'] || 'default' };
        Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: req.headers['x-test-remote'] ? '192.0.2.1' : '127.0.0.1' });
        next();
    });
    app.use(tenantMiddleware);
    app.use('/api/desktop-pet', require('../backend/routes/desktop-pet'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/desktop-pet`;
    try {
        assert.equal((await fetch(base + '/stories')).status, 401);
        const headers = { 'x-test-user': 'yes' };
        assert.equal((await fetch(base + '/stories', { headers: { ...headers, 'x-test-remote': 'yes' } })).status, 403);
        assert.equal((await fetch(base + '/stories', { headers: { ...headers, origin: 'https://example.com' } })).status, 403);
        const response = await fetch(base + '/stories?language=en-US', { headers });
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.json()).stories.length, 40);
        const detail = await fetch(base + '/stories/moon-days', { headers: { ...headers, 'x-test-tenant': 'story-a' } });
        assert.equal((await detail.json()).story.body, 'tenant a customized story');
        assert.equal((await fetch(base + '/stories/missing-story', { headers })).status, 404);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

function chat(fetcher) {
    const script = [...fs.readFileSync(path.join(__dirname, '../desktop-pet/pet-chat.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
    const events = {}, ipc = {}, rows = [], payloads = [];
    const element = () => ({ style: {}, value: '', events: {}, appendChild(el) { rows.push(el); }, addEventListener(name, fn) { this.events[name] = fn; } });
    const elements = new Map();
    const story = id => { const seed = seeds.find(s => s.id === id); return { id, kind: seed.kind, ...seed.zh, sources: seed.sources, language: 'zh-CN' }; };
    const context = {
        window: { addEventListener() {}, PetI18n: { t: value => value, getLanguage: () => 'zh-CN' } },
        document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element, querySelectorAll: () => [] },
        require: () => ({ ipcRenderer: {
            on(name, fn) { ipc[name] = fn; }, send(name, val) { (events[name] ||= []).push(val); },
            async invoke(name, id) { if (name === 'pet-get-story') return story(id); if (name === 'pet-get-stories') return seeds.map(s => ({id:s.id})); return null; }
        } }), AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout,
        fetch: async (url, options) => { payloads.push(JSON.parse(options.body)); return fetcher(url, options); }
    };
    vm.runInNewContext(script, context);
    return { context, elements, events, ipc, rows, payloads, story };
}
function jsonReply(reply) { return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ reply }) }; }
function ndjson(lines) {
    let delivered = false;
    return { ok: true, headers: { get: () => 'application/x-ndjson' }, body: { getReader: () => ({ async read() {
        if (delivered) return { done: true }; delivered = true;
        return { value: new TextEncoder().encode(lines), done: false };
    } }) } };
}

test('clicked story auto-expands offline, then passes stored story and history into AI follow-up', async () => {
    let available = false;
    const r = chat(async () => { if (!available) throw new Error('offline'); return jsonReply('进一步讨论的回答'); });
    await r.context.openStory({ id: 'white-pyramid', requestId: 1 });
    assert.match(r.rows.filter(row => row.className === 'msg-bubble').at(-1).innerHTML, /白色|白石/);
    assert.match(r.elements.get('storyStatus').textContent, /内置故事/);
    assert.equal(r.elements.get('offlineStoryBtn').hidden, false);
    available = true;
    await r.context.handleSendMessage('这是真的吗？');
    assert.match(r.payloads[1].context, /white-pyramid/);
    assert.match(r.payloads[1].messages[1].content, /白色|白石/);
    assert.match(r.rows.filter(row => row.className === 'msg-bubble').at(-1).innerHTML, /进一步讨论/);
    assert.deepEqual(r.events['pet-chat-generating'], [true, false, true, false]);
    assert.equal(r.elements.get('typingIndicator').style.display, 'none');
});

test('NDJSON errors and empty answers use full fallback; final undelimited delta succeeds', async () => {
    for (const answer of [ndjson('{"type":"delta","delta":"片段"}\n{"type":"error","error":"disabled"}\n'), jsonReply('')]) {
        const r = chat(async () => answer);
        await r.context.openStory({ id: 'moon-days', requestId: 1 });
        assert.match(r.elements.get('storyStatus').textContent, /内置故事/);
        assert.match(r.rows.filter(row => row.className === 'msg-bubble').at(-1).innerHTML, /努特/);
    }
    const r = chat(async () => ndjson('{"type":"delta","delta":"完整回复"}'));
    await r.context.openStory({ id: 'moon-days', requestId: 1 });
    assert.match(r.elements.get('storyStatus').textContent, /AI 讲述/);
    assert.equal(r.rows.filter(row => row.className === 'msg-bubble').at(-1).innerHTML, '完整回复');
});

test('rapid story selection cancels old generation and duplicate delivery does not repeat stories', async () => {
    let calls = 0;
    const r = chat((_url, options) => {
        if (++calls > 1) return jsonReply('新故事完成');
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    const first = r.context.openStory({ id: 'moon-days', requestId: 1 });
    await new Promise(resolve => setImmediate(resolve));
    await r.context.openStory({ id: 'weigh-heart', requestId: 2 });
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.match(r.payloads[1].context, /weigh-heart/);
    assert.equal(r.rows.filter(row => row.className === 'msg-bubble').at(-1).innerHTML, '新故事完成');
    await r.context.openStory({ id: 'weigh-heart', requestId: 2 });
    assert.equal(calls, 2);
    r.elements.get('newChatBtn').events.click();
    await r.context.handleSendMessage('新对话');
    assert.doesNotMatch(r.payloads[2].context, /weigh-heart/);
    assert.equal(r.payloads[2].messages.length, 1);
});

test('manager restricts story IPC and delivers queued story once without toggling visible chat closed', async () => {
    const { EventEmitter } = require('node:events');
    const windows = [], handles = {}, listeners = {}, requests = [];
    class FakeWindow extends EventEmitter {
        constructor(options) {
            super(); this.bounds = { ...options }; this.visible = false; this.destroyed = false;
            this.webContents = new EventEmitter(); this.webContents.sent = []; this.webContents.loading = true;
            this.webContents.send = (name, value) => this.webContents.sent.push({ name, value });
            this.webContents.isLoading = () => this.webContents.loading;
            windows.push(this);
        }
        loadFile() { return Promise.resolve(); }
        show() { this.visible = true; }
        hide() { this.visible = false; }
        focus() {}
        isVisible() { return this.visible; }
        isDestroyed() { return this.destroyed; }
        getBounds() { return this.bounds; }
        getSize() { return [this.bounds.width, this.bounds.height]; }
        setBounds(bounds) { this.bounds = bounds; }
        destroy() { this.destroyed = true; this.emit('closed'); }
    }
    const display = { workArea: { x:0, y:0, width:1440, height:900 } };
    const module = { exports: {} };
    const context = {
        module, exports: module.exports, __dirname: path.join(__dirname, '../desktop-pet'),
        process, console: { log() {}, warn() {} }, AbortController, setTimeout, clearTimeout,
        setInterval: () => 1, clearInterval() {},
        fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ story: { id:'moon-days' }, stories: [] }) }; },
        require(name) {
            if (name === 'electron') return { app: { getPath: () => sandbox }, BrowserWindow: FakeWindow,
                screen: { getPrimaryDisplay: () => display, getDisplayMatching: () => display },
                ipcMain: { handle: (name, fn) => handles[name] = fn, on: (name, fn) => listeners[name] = fn } };
            if (name.endsWith('desktop-language')) return { events: new EventEmitter(), getLanguage: () => 'zh-CN' };
            if (name.endsWith('quota-panel-layout')) return require('../desktop-pet/quota-panel-layout');
            if (name.endsWith('quota-history-client')) return require('../desktop-pet/quota-history-client');
            if (name.endsWith('quota-detector')) return { detectAllQuotas: async () => null };
            if (name.endsWith('pet-keyboard-hook')) return { startKeyboardHook() {}, stopKeyboardHook() {} };
            if (name.endsWith('auth-sessions-repository')) return { saveSession: async () => {} };
            return require(name);
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop-pet/pet-manager.js'), 'utf8'), context);
    fs.writeFileSync(path.join(sandbox, 'desktop-pet-config.json'), JSON.stringify({scaleVersion:2,quotaStandalone:false}));
    module.exports.initDesktopPet();
    const pet = windows[0];
    assert.equal(pet.getBounds().width, 218, 'pet window width at default 0.75 scale');
    assert.equal(pet.getBounds().height, 293, 'pet window height at default 0.75 scale');
    pet.webContents.loading = false;
    listeners['pet-request-environment']({ sender: pet.webContents });
    const environment = pet.webContents.sent.at(-1);
    assert.equal(environment.name, 'pet-environment');
    assert.equal(environment.value.workArea.width, 1440);
    assert.equal(environment.value.bounds.width, pet.getBounds().width);
    const count = pet.webContents.sent.length;
    listeners['pet-request-environment']({ sender: {} });
    assert.equal(pet.webContents.sent.length, count, 'other windows cannot request cursor environment');
    assert.throws(() => handles['pet-get-stories']({ sender:{} }), /WINDOW_REQUIRED/);
    listeners['pet-open-story']({ sender:{} }, 'moon-days');
    assert.equal(windows.length, 1);
    listeners['pet-open-story']({ sender:pet.webContents }, 'moon-days');
    const chat = windows[1];
    assert.equal(chat.visible, true);
    assert.equal(chat.webContents.sent.length, 0);
    const request = handles['pet-story-ready']({ sender:chat.webContents });
    assert.equal(request.id, 'moon-days');
    assert.equal(handles['pet-story-ready']({ sender:chat.webContents }), null);
    chat.webContents.loading = false;
    listeners['pet-open-story']({ sender:pet.webContents }, 'weigh-heart');
    assert.equal(chat.visible, true);
    assert.equal(chat.webContents.sent[0].value.id, 'weigh-heart');
    assert.throws(() => handles['pet-get-story']({ sender:pet.webContents }, 'moon-days'), /WINDOW_REQUIRED/);
    assert.throws(() => handles['pet-get-story']({ sender:chat.webContents }, '../secret'), /INVALID_PET_STORY/);
    await handles['pet-get-story']({ sender:chat.webContents }, 'moon-days', 'en-US');
    assert.match(requests[0].url, /\/stories\/moon-days\?language=en-US$/);
    assert.match(requests[0].options.headers.Authorization, /^Bearer pet_/);
    listeners['pet-chat-generating']({ sender:chat.webContents }, true);
    assert.equal(pet.webContents.sent.at(-1).value, true);
    module.exports.cleanupDesktopPet();

    // Verify baseUrl normalization when launched with welcome/update query params
    module.exports.initDesktopPet({
        port: 3030,
        baseUrl: 'http://127.0.0.1:3030/?welcome=update&version=1.0.354&from=1.0.353'
    });
    const windowsCount = windows.length;
    listeners['pet-open-story']({ sender: windows[windowsCount - 1].webContents }, 'moon-days');
    const newChat = windows[windowsCount];
    await handles['pet-get-story']({ sender: newChat.webContents }, 'moon-days', 'zh-CN');
    const latestRequest = requests.at(-1);
    assert.equal(latestRequest.url, 'http://127.0.0.1:3030/api/desktop-pet/stories/moon-days?language=zh-CN');
    module.exports.cleanupDesktopPet();
});

test('pet chat renders markdown tables with friendly structure and alignments', async () => {
    const r = chat(async () => jsonReply('| 标题1 | 达成率 |\n| :--- | ---: |\n| 巡检任务 | 100% |'));
    await r.context.handleSendMessage('请汇报');
    const bubble = r.rows.filter(row => row.className === 'msg-bubble').at(-1);
    assert.match(bubble.innerHTML, /<div class="ai-table-wrap"/);
    assert.match(bubble.innerHTML, /<table class="ai-markdown-table"/);
    assert.match(bubble.innerHTML, /<th scope="col" class="align-left">标题1<\/th>/);
    assert.match(bubble.innerHTML, /<th scope="col" class="align-right">达成率<\/th>/);
    assert.match(bubble.innerHTML, /<td class="align-right numeric">100%<\/td>/);
});
