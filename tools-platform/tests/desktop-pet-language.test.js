const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const express = require('../backend/node_modules/express');
const language = require('../backend/models/desktop-language');
const router = require('../backend/routes/desktop-pet');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('local desktop language API rejects remote, unauthenticated and invalid changes', async () => {
    const previousRuntime = process.env.TOOLS_DESKTOP_RUNTIME;
    process.env.TOOLS_DESKTOP_RUNTIME = '1';
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (req.headers['x-test-user']) req.user = { username: 'viewer', role: 'viewer' };
        Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: req.headers['x-test-remote'] ? '192.0.2.1' : '127.0.0.1' });
        next();
    });
    app.use(router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (value, extra = {}) => fetch(`${base}/language`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...extra },
        body: JSON.stringify({ language: value })
    });
    try {
        language.setLanguage('zh-CN');
        assert.equal((await post('en-US')).status, 401);
        assert.equal((await post('en-US', { 'x-test-user': 'yes', 'x-test-remote': 'yes' })).status, 403);
        assert.equal((await post('en-US', { 'x-test-user': 'yes', origin: 'https://example.com' })).status, 403);
        assert.equal((await post('fr', { 'x-test-user': 'yes' })).status, 400);
        assert.equal(language.getLanguage(), 'zh-CN');
        assert.equal((await post('en-US', { 'x-test-user': 'yes', origin: base })).status, 200);
        assert.equal(language.getLanguage(), 'en-US');
        process.env.TOOLS_DESKTOP_RUNTIME = '0';
        assert.equal((await post('zh-CN', { 'x-test-user': 'yes' })).status, 403);
        assert.equal(language.getLanguage(), 'en-US');
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (previousRuntime === undefined) delete process.env.TOOLS_DESKTOP_RUNTIME;
        else process.env.TOOLS_DESKTOP_RUNTIME = previousRuntime;
        language.setLanguage('zh-CN');
    }
});

function renderer() {
    const listeners = {};
    const nodes = [];
    const attrs = [];
    const document = {
        documentElement: {}, body: {}, addEventListener() {},
        createTreeWalker() { let index = 0; return { nextNode: () => nodes[index++] || null }; },
        querySelectorAll: () => attrs
    };
    function text(value, history = false, ui = false) {
        const node = { nodeValue: value, parentElement: { closest(selector) {
            if (selector === '.msg-row') return history;
            if (selector === '[data-pet-ui]') return ui;
            return false;
        } } };
        nodes.push(node); return node;
    }
    let resolveInitial;
    const window = { dispatchEvent() {} };
    vm.runInNewContext(read('desktop-pet/pet-i18n.js'), {
        window, document, NodeFilter: { SHOW_TEXT: 4 }, CustomEvent: class {},
        require: () => ({ ipcRenderer: {
            on: (name, fn) => { listeners[name] = fn; },
            invoke: () => new Promise(resolve => { resolveInitial = resolve; })
        } })
    });
    return { window, document, listeners, text, resolveInitial: value => resolveInitial(value) };
}

test('pet menus and speech switch in both directions while conversation text stays intact', async () => {
    const runtime = renderer();
    const menu = runtime.text('发送');
    const speech = runtime.text('✦ 我在这里，Dragon随时为你效劳');
    const message = runtime.text('发送', true);
    const welcome = runtime.text('「Dragon」', true, true);
    runtime.listeners['pet-language-change']({}, 'en-US');
    assert.equal(menu.nodeValue, 'Send');
    assert.match(speech.nodeValue, /right here/);
    assert.equal(message.nodeValue, '发送');
    assert.equal(welcome.nodeValue, '“Dragon”');
    runtime.resolveInitial('zh-CN');
    await Promise.resolve();
    assert.equal(runtime.window.PetI18n.getLanguage(), 'en-US', 'late initial IPC must not undo a toggle');
    runtime.window.PetI18n.setLanguage('zh-CN');
    assert.equal(menu.nodeValue, '发送');
    assert.equal(welcome.nodeValue, '「Dragon」');
    runtime.window.PetI18n.setLanguage('en-US');
    menu.nodeValue = '正常在线'; // newly rendered quota text
    runtime.window.PetI18n.apply();
    assert.equal(menu.nodeValue, 'Online');
});

test('new pet windows initialize to the current desktop language', async () => {
    const runtime = renderer();
    const title = runtime.text('Dragon桌宠设置');
    runtime.resolveInitial('en-US');
    await Promise.resolve();
    assert.equal(title.nodeValue, 'Dragon pet settings');
    assert.equal(runtime.document.documentElement.lang, 'en-US');
});

test('web language sync sends rapid toggles sequentially and restores saved language', async () => {
    const listeners = {};
    const saved = new Map([['tools_token', 'test-token'], ['tools_lang', 'en-US']]);
    const requests = [];
    let release;
    const window = { location: { hostname: '127.0.0.1' },
        addEventListener: (name, fn) => { listeners[name] = fn; },
        dispatchEvent: event => listeners[event.type]?.(event)
    };
    const context = {
        window, document: { documentElement: {}, querySelectorAll: () => [] }, navigator: {},
        localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        fetch: (_url, options) => {
            requests.push(JSON.parse(options.body).language);
            return new Promise(resolve => { release = resolve; });
        }
    };
    vm.runInNewContext(read('frontend/js/shared/i18n.js'), context);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, ['en-US']);
    window.ToolsI18n.setLanguage('zh-CN');
    window.ToolsI18n.setLanguage('en-US');
    window.ToolsI18n.setLanguage('zh-CN');
    assert.equal(requests.length, 1);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, ['en-US', 'zh-CN']);
    release();
    await new Promise(resolve => setImmediate(resolve));
    release();
    await new Promise(resolve => setImmediate(resolve));
    release();
});

test('AI requests use the selected language and preserve previous messages', async () => {
    const html = read('desktop-pet/pet-chat.html');
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
    let selected = 'en-US';
    const payloads = [];
    const element = () => ({ style: {}, value: '', appendChild() {}, addEventListener() {} });
    const elements = new Map();
    const context = {
        window: { addEventListener() {}, PetI18n: { t: value => value, getLanguage: () => selected } },
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        }, createElement: element, querySelectorAll: () => [] },
        AbortController, navigator: {}, setTimeout, clearTimeout,
        fetch: async (_url, options) => {
            payloads.push(JSON.parse(options.body));
            return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ reply: 'Hello!' }) };
        }
    };
    vm.runInNewContext(script, context);
    await context.handleSendMessage('Hi');
    assert.equal(payloads[0].uiLanguage, 'en-US');
    assert.match(payloads[0].context, /Reply in English/);
    assert.match(payloads[0].context, /Dragon.*毛毡小龙/);
    assert.match(payloads[0].context, /guardian personality/);
    assert.doesNotMatch(payloads[0].context, /猫咪|喵|kitty/);
    selected = 'zh-CN';
    await context.handleSendMessage('你好');
    assert.equal(payloads[1].uiLanguage, 'zh-CN');
    assert.match(payloads[1].context, /守护者性格/);
    assert.equal(payloads[1].messages[0].content, 'Hi');
    assert.equal(payloads[1].messages[1].content, 'Hello!');
});

test('desktop pet typing combo tiers and speech bubble text colors maintain high contrast', () => {
    const petJs = read('desktop-pet/gemini-pet.js');
    // Verify no dark #123743 text is used in speech bubble text
    assert.doesNotMatch(petJs, /showTypingBubble[\s\S]*?'#123743'/, 'showTypingBubble must not use dark #123743 text');
    assert.doesNotMatch(petJs, /showCustomSpeechBubble\([^)]*?'#147d7a'\)/, 'Custom speech bubbles must not use dark #147d7a text');
    assert.doesNotMatch(petJs, /showCustomSpeechBubble\([^)]*?'#64748b'\)/, 'Custom speech bubbles must not use dark #64748b text');

    // Verify combo tier classes and milestone triggers
    assert.ok(petJs.includes('gpet-combo-t1'));
    assert.ok(petJs.includes('gpet-combo-t2'));
    assert.ok(petJs.includes('gpet-combo-t3'));
    assert.ok(petJs.includes('gpet-combo-t4'));
    assert.ok(petJs.includes('gpet-combo-t5'));
    assert.ok(petJs.includes('gpet-combo-t6'));
    assert.ok(petJs.includes('showComboMilestoneBubble'));

    // Verify i18n has milestone quotes
    const i18nJs = read('desktop-pet/pet-i18n.js');
    assert.ok(i18nJs.includes('✦ 30 连击！心流渐入佳境，专注力拉满 ✦'));
    assert.ok(i18nJs.includes('🔥 50 连击！键盘敲出残影了，这就是大神的手速吗？！'));
    assert.ok(i18nJs.includes('⚡ 100 连击突破！反重力编译器超频全开 ⚡'));
    assert.ok(i18nJs.includes('🐉 500 连击！Dragon 的小尾巴都跟着你的手速摇起来了 ✨'));
    assert.ok(i18nJs.includes('✦ 1000 连击破壁！唯有绝对专注与智慧不可阻挡 ✦'));
});

