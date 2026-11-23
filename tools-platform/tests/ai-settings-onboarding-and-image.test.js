const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-ai-onboard-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const tenantPool = require('../backend/models/tenant-sqlite-pool');
const { createClient } = require('../backend/models/ai-provider-client');
const repo = require('../backend/models/ai-settings-repository');

test.after(async () => {
    await tenantPool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

function createFakeDom() {
    const byId = new Map();
    const parseHtmlElements = html => {
        byId.clear();
        const attrsRe = /([a-zA-Z0-9:-]+)(?:="([^"]*)")?/g;
        const tagRe = /<(input|select|textarea|button|div|span|section)\b([^>]*)>/gi;
        let m;
        while ((m = tagRe.exec(html))) {
            const tag = m[1].toLowerCase();
            const rawAttrs = m[2];
            const attrs = {};
            let a;
            attrsRe.lastIndex = 0;
            while ((a = attrsRe.exec(rawAttrs))) {
                attrs[a[1]] = a[2] !== undefined ? a[2] : '';
            }
            const id = attrs.id;
            if (!id) continue;
            const el = {
                id,
                tagName: tag.toUpperCase(),
                type: attrs.type || 'text',
                value: attrs.value || '',
                checked: 'checked' in attrs,
                hidden: 'hidden' in attrs,
                disabled: 'disabled' in attrs,
                className: attrs.class || '',
                textContent: '',
                innerHTML: '',
                dataset: {},
                style: {},
                _attrs: { ...attrs },
                setAttribute(k, v) { this._attrs[k] = String(v); },
                getAttribute(k) { return this._attrs[k] ?? null; },
                focus() { this._focused = true; },
                scrollIntoView() {},
                classList: { toggle() {}, add() {}, remove() {} },
                querySelectorAll() { return []; },
                querySelector() { return null; }
            };
            byId.set(id, el);
        }
    };
    const rootContent = {
        id: 'navSettingsContent',
        _html: '',
        set innerHTML(val) {
            this._html = String(val || '');
            parseHtmlElements(this._html);
        },
        get innerHTML() {
            return this._html;
        }
    };
    return {
        byId,
        rootContent,
        document: {
            getElementById(id) {
                if (id === 'navSettingsContent') return rootContent;
                if (id === 'navAiModelsList') {
                    return { id, innerHTML: '' };
                }
                return byId.get(id) || null;
            },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement() {
                return { style: {}, setAttribute() {}, select() {}, remove() {}, value: '' };
            },
            body: { appendChild() {} },
            execCommand() { return true; }
        }
    };
}

function loadSettingsUiHarness({ fetchImpl }) {
    const dom = createFakeDom();
    const settingsCode = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/platform-settings.js'), 'utf8');
    const timers = [];
    const windowObj = {
        location: { pathname: '/', search: '', hash: '' },
        addEventListener() {},
        dispatchEvent() {},
        CustomEvent: function CustomEvent(name, detail) { this.type = name; this.detail = detail; },
        Event: function Event(name) { this.type = name; },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        matchMedia() { return { matches: false, addEventListener() {} }; }
    };
    const ctx = {
        window: windowObj,
        location: windowObj.location,
        document: dom.document,
        localStorage: windowObj.localStorage,
        sessionStorage: windowObj.sessionStorage,
        Event: windowObj.Event,
        CustomEvent: windowObj.CustomEvent,
        fetch: fetchImpl,
        URL,
        URLSearchParams,
        FormData: class FormData {},
        Headers: globalThis.Headers,
        navigator: { userAgent: 'node-test', clipboard: { writeText: async () => {} } },
        setTimeout(fn, ms) {
            const handle = globalThis.setTimeout(fn, Math.min(ms, 5));
            timers.push(handle);
            return handle;
        },
        clearTimeout(id) { globalThis.clearTimeout(id); },
        console,
        showPlatformConfirm: async () => true,
        showPlatformAlert: async () => {},
        isNavSuperAdmin: () => false,
        resolveAiAuthModeForUi: s => s?.authMode || (s?.provider === 'gemini' ? 'x-goog-api-key' : 'bearer'),
        renderAiUsagePanel: () => '',
        loadAiUsageData: () => {},
        navState: {
            lang: 'zh-CN',
            aiSettings: null,
            aiSelectedProfileId: null,
            aiCategory: 'chat',
            aiSaveTimer: null,
            aiQuickAutoTestTimer: null,
            aiQuickDraftBaseUrl: 'http://models.ascend.huawei.com',
            aiQuickDraftToken: '',
            aiQuickShowToken: false,
            aiQuickForceOpen: false,
            aiQuickLastStatus: null,
            currentEditingModels: null
        },
        getAuthHeaderForNav: () => ({}),
        navEscape: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
        navT: key => key,
        navLocaleText: (zh, en) => zh || en
    };
    windowObj.window = windowObj;
    windowObj.document = dom.document;
    vm.createContext(ctx);
    vm.runInContext(settingsCode, ctx);
    // Sync window bindings back onto global context object just like browser window
    for (const k of Object.keys(windowObj)) {
        if (!(k in ctx) && typeof windowObj[k] === 'function') ctx[k] = windowObj[k];
    }
    return {
        dom,
        ctx,
        win: windowObj,
        cleanup: () => timers.forEach(t => globalThis.clearTimeout(t))
    };
}

test('openai-compatible generateImage supports b64_json and remote image url (qwen-image-2.1)', async t => {
    const requests = [];
    const upstream = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            if (req.url === '/images/demo.png') {
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.end(Buffer.from('PNG_REMOTE_BYTES'));
                return;
            }
            requests.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
            if (requests.length === 1) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    data: [{ b64_json: Buffer.from('FAKE_PNG_B64').toString('base64') }]
                }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                data: [{ url: `http://127.0.0.1:${upstream.address().port}/images/demo.png` }]
            }));
        });
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => upstream.close(resolve)));

    const client = createClient({
        provider: 'openai-compatible',
        authMode: 'bearer',
        apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
        apiKey: 'sk-zero-one-image-key',
        model: 'qwen-image-2.1'
    });

    const first = await client.generateImage({ prompt: 'a mountain logo', aspectRatio: '16:9' });
    assert.equal(first.images[0].mimeType, 'image/png');
    assert.equal(Buffer.from(first.images[0].data, 'base64').toString('utf8'), 'FAKE_PNG_B64');
    assert.equal(requests[0].url, '/v1/images/generations');
    assert.equal(requests[0].headers.authorization, 'Bearer sk-zero-one-image-key');
    assert.equal(requests[0].body.model, 'qwen-image-2.1');
    assert.equal(requests[0].body.size, '1344x768');

    const second = await client.generateImage({ prompt: 'second image' });
    assert.equal(Buffer.from(second.images[0].data, 'base64').toString('utf8'), 'PNG_REMOTE_BYTES');
    assert.equal(requests[1].body.size, '1024x1024');
});

test('image profile connection test routes to /images/generations and buildRuntimeSettings preserves category', async t => {
    const seenUrls = [];
    const upstream = http.createServer((req, res) => {
        seenUrls.push(req.url);
        req.resume();
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('IMG').toString('base64') }] }));
        });
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => upstream.close(resolve)));

    const runtime = await repo.buildRuntimeSettings({
        category: 'image',
        provider: 'openai-compatible',
        apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
        apiKey: 'sk-test-image-key-123456',
        model: 'qwen-image-2.1'
    });
    assert.equal(runtime.category, 'image');

    const app = express();
    app.use(express.json());
    app.use('/api/ai-settings', require('../backend/routes/ai-settings'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));

    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/ai-settings/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            category: 'image',
            provider: 'openai-compatible',
            apiBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
            apiKey: 'sk-test-image-key-123456',
            model: 'qwen-image-2.1'
        })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(seenUrls[0], '/v1/images/generations');
});

test('01 onboarding card, provider change preservation, HTTP domain auto verifySsl, and auto-retry flow', async t => {
    const calls = [];
    let store = {
        activeProfileId: 'default',
        activeImageProfileId: '',
        profiles: [
            {
                id: 'default',
                name: '默认配置',
                category: 'chat',
                provider: 'gemini',
                authMode: 'x-goog-api-key',
                apiBaseUrl: '',
                model: 'gemini-2.5-flash',
                models: ['gemini-2.5-flash'],
                hasApiKey: false,
                maskedApiKey: '',
                apiKeySource: 'none',
                keyLooksValid: false,
                isActive: true,
                verifySsl: false
            }
        ]
    };

    const fetchMock = async (url, init = {}) => {
        const method = String(init.method || 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url, method, body });

        if (url === '/api/ai-settings' && method === 'GET') {
            return new Response(JSON.stringify(store), { status: 200 });
        }
        if (url === '/api/ai-settings/test' && method === 'POST') {
            return new Response(JSON.stringify({
                success: true,
                model: body.model,
                reply: 'OK',
                durationMs: 18
            }), { status: 200 });
        }
        if (url === '/api/ai-settings/profiles' && method === 'POST') {
            const createdId = body.category === 'image' ? 'zeroone-img' : 'zeroone-chat';
            const created = {
                id: createdId,
                name: body.name,
                category: body.category || 'chat',
                provider: body.provider,
                authMode: body.authMode,
                apiBaseUrl: body.apiBaseUrl,
                model: body.model,
                models: body.models,
                hasApiKey: true,
                maskedApiKey: 'sk-0***test',
                apiKeySource: 'stored',
                keyLooksValid: true,
                isActive: body.activate === true,
                verifySsl: body.verifySsl === true
            };
            if (created.isActive) {
                store.profiles.forEach(p => {
                    if ((p.category || 'chat') === (created.category || 'chat')) p.isActive = false;
                });
                if (created.category === 'image') store.activeImageProfileId = createdId;
                else store.activeProfileId = createdId;
            }
            store.profiles.push(created);
            return new Response(JSON.stringify({ ...store, createdProfileId: createdId }), { status: 201 });
        }
        const activateMatch = url.match(/^\/api\/ai-settings\/profiles\/([^/]+)\/activate$/);
        if (activateMatch && method === 'POST') {
            const id = decodeURIComponent(activateMatch[1]);
            const target = store.profiles.find(p => p.id === id);
            store.profiles.forEach(p => {
                if ((p.category || 'chat') === (target.category || 'chat')) {
                    p.isActive = p.id === id;
                }
            });
            if (target.category === 'image') store.activeImageProfileId = id;
            else store.activeProfileId = id;
            return new Response(JSON.stringify(store), { status: 200 });
        }
        const putMatch = url.match(/^\/api\/ai-settings\/profiles\/([^/]+)$/);
        if (putMatch && method === 'PUT') {
            const id = decodeURIComponent(putMatch[1]);
            const target = store.profiles.find(p => p.id === id);
            if (target && body) {
                Object.assign(target, body);
                if (body.apiKey) {
                    target.hasApiKey = true;
                    target.keyLooksValid = true;
                    target.apiKeySource = 'stored';
                    target.maskedApiKey = 'sk-0***test';
                }
            }
            return new Response(JSON.stringify(store), { status: 200 });
        }
        const testMatch = url.match(/^\/api\/ai-settings\/profiles\/([^/]+)\/test$/);
        if (testMatch && method === 'POST') {
            if (body.verifySsl === false) {
                return new Response(JSON.stringify({
                    success: false,
                    error: '连接模型超时（30017ms，超过 30 秒未响应）',
                    details: {
                        httpStatus: 504,
                        errorCode: '20',
                        cause: 'This operation was aborted'
                    }
                }), { status: 504 });
            }
            return new Response(JSON.stringify({
                success: true,
                model: body.model,
                reply: 'OK',
                durationMs: 42
            }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: `Unhandled ${method} ${url}` }), { status: 404 });
    };

    const h = loadSettingsUiHarness({ fetchImpl: fetchMock });
    t.after(h.cleanup);

    await h.ctx.renderAiSettings(h.dom.rootContent);

    // 1. Built-in sample profile alone must show the 01平台接入 onboarding card
    const html = h.dom.rootContent.innerHTML;
    assert.match(html, /01平台接入/);
    assert.match(html, /API TOKEN · default 分组/);
    assert.match(html, /http:\/\/models\.ascend\.huawei\.com\/sign-up\?aff=KizX/);
    assert.match(html, /平台地址填到域名即可，不用带 \/v1（接口路径已内置；带了也会自动兼容）/);

    // 2. Typing/pasting a token triggers auto-test and displays "连接成功 · Token 验证通过"
    const quickTokenEl = h.dom.document.getElementById('navAiQuickToken');
    quickTokenEl.value = 'sk-01-valid-token-987654';
    h.win.handleZeroOneTokenInput();
    await new Promise(resolve => setTimeout(resolve, 40));
    const quickTestCall = calls.find(c => c.url === '/api/ai-settings/test');
    assert.ok(quickTestCall, 'auto-triggered quick test');
    assert.equal(quickTestCall.body.apiBaseUrl, 'http://models.ascend.huawei.com/v1');
    assert.equal(quickTestCall.body.verifySsl, true);
    assert.equal(quickTestCall.body.model, 'qwen3.8-27b');
    assert.match(h.dom.document.getElementById('navAiQuickStatus').innerHTML, /连接成功 · Token 验证通过/);

    // 3. Clicking Save configures & activates BOTH qwen3.8-27b (chat) and qwen-image-2.1 (image)
    await h.win.saveZeroOneQuickConfig();
    const chatProfile = store.profiles.find(p => p.id === store.activeProfileId);
    const imgProfile = store.profiles.find(p => p.id === store.activeImageProfileId);
    assert.ok(chatProfile, 'active chat profile present');
    assert.ok(imgProfile, 'active image profile present');
    assert.equal(chatProfile.model, 'qwen3.8-27b');
    assert.equal(chatProfile.isActive, true);
    assert.equal(imgProfile.model, 'qwen-image-2.1');
    assert.equal(imgProfile.isActive, true);
    assert.doesNotMatch(h.dom.rootContent.innerHTML, /id="navAiQuickCard"/, 'collapses quick onboarding card once user has custom models');

    // 4. Switching provider preserves custom models and custom URL
    h.ctx.navState.currentEditingModels = ['deepseek-v4.1-flash', 'qwen3.8-27b'];
    h.dom.document.getElementById('navAiModel').value = 'deepseek-v4.1-flash';
    h.dom.document.getElementById('navAiApiBaseUrl').value = 'http://models.ascend.huawei.com/v1';
    h.dom.document.getElementById('navAiProvider').value = 'anthropic';
    h.win.handleAiProviderChange();
    assert.deepEqual(h.ctx.navState.currentEditingModels, ['deepseek-v4.1-flash', 'qwen3.8-27b']);
    assert.equal(h.dom.document.getElementById('navAiModel').value, 'deepseek-v4.1-flash');
    assert.equal(h.dom.document.getElementById('navAiApiBaseUrl').value, 'http://models.ascend.huawei.com/v1');

    // 5. Typing an HTTP domain URL auto-checks verifySsl
    const verifyBox = h.dom.document.getElementById('navAiVerifySsl');
    verifyBox.checked = false;
    delete verifyBox.dataset.userTouched;
    h.dom.document.getElementById('navAiApiBaseUrl').value = 'http://models.ascend.huawei.com';
    h.win.handleAiApiBaseUrlInput();
    assert.equal(verifyBox.checked, true);

    // 6. Connection test failure with verifySsl=false (504 timeout) auto-retries with verifySsl=true and saves
    verifyBox.checked = false;
    await h.win.testAiSettingsNow('deepseek-v4.1-flash');
    const testRequests = calls.filter(c => c.url.endsWith('/test') && c.url.includes('/profiles/'));
    assert.equal(testRequests.length, 2);
    assert.equal(testRequests[0].body.verifySsl, false);
    assert.equal(testRequests[1].body.verifySsl, true);
    assert.equal(verifyBox.checked, true);
    assert.equal(calls.some(c => c.method === 'PUT' && c.url.includes('/profiles/') && c.body.verifySsl === true), true);
});
