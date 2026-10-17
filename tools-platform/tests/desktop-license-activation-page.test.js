const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const os = require('os');

// 签发会写密钥文件与台账：测试一律指向临时目录，绝不触碰 backend/data 下的正式数据
const licenseSandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-license-test-'));
process.env.DESKTOP_LICENSE_SIGNING_KEY_FILE = path.join(licenseSandbox, 'signing-key.json');
process.env.DESKTOP_LICENSE_REGISTRY_FILE = path.join(licenseSandbox, 'registry.json');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'frontend/pages/desktop-license-activation.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('License Activation Page: HTML markup contains complete bilingual elements and progress bar', () => {
    // Top bar & Language buttons
    assert.match(html, /id="lang-btn-zh"/);
    assert.match(html, /id="lang-btn-en"/);
    assert.match(html, /id="brand-tag"/);

    // Title & subtitle
    assert.match(html, /id="title"/);
    assert.match(html, /id="subtitle"/);

    // Input & Tools
    assert.match(html, /id="license-token"/);
    assert.match(html, /id="btn-paste"/);
    assert.match(html, /id="btn-clear"/);

    // Sample box elements
    assert.match(html, /id="sample-box"/);
    assert.match(html, /id="sample-badge"/);
    assert.match(html, /id="sample-title-text"/);
    assert.match(html, /id="btn-fill-sample"/);
    assert.match(html, /id="btn-fill-sample-text"/);
    assert.match(html, /id="btn-copy-sample"/);
    assert.match(html, /id="btn-copy-sample-text"/);
    assert.match(html, /id="sample-code-row"/);
    assert.match(html, /id="sample-code"/);
    assert.match(html, /id="sample-tip"/);

    // Progress card elements
    assert.match(html, /id="progress-card"/);
    assert.match(html, /id="progress-stage-desc"/);
    assert.match(html, /id="progress-percent"/);
    assert.match(html, /id="progress-bar-fill"/);
    assert.match(html, /id="step-1"/);
    assert.match(html, /id="step-2"/);
    assert.match(html, /id="step-3"/);
    assert.match(html, /id="step-4"/);

    // Action buttons
    assert.match(html, /id="btn-activate"/);
    assert.match(html, /id="btn-quit"/);

    // Status box
    assert.match(html, /id="status-box"/);
    assert.match(html, /id="status-text"/);

    // Security feature pills
    assert.match(html, /id="pill-signature"/);
    assert.match(html, /id="pill-offline"/);
    assert.match(html, /id="pill-security"/);
    assert.match(html, /id="meta-note"/);
    assert.match(html, /id="shortcut-hints"/);
});

test('License Activation Page: Inline script is syntactically valid and executes with bilingual switching and progress tracking', async () => {
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'Inline script must exist');
    const script = scriptMatch[1];

    // Mock DOM environment for testing
    const store = new Map();
    const storageMock = {
        getItem: (k) => store.get(k) || null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };

    const listeners = {};
    const dom = {
        title: '',
        documentElement: { lang: '' },
        body: { classList: { add: () => {}, remove: () => {} } },
        elements: {}
    };

    function createMockElement(id) {
        return {
            id,
            textContent: '',
            innerHTML: '',
            value: '',
            placeholder: '',
            className: '',
            dataset: {},
            style: {},
            classList: {
                toggle: function (cls, val) {
                    this[cls] = Boolean(val);
                },
                add: function (cls) { this[cls] = true; },
                remove: function (cls) { this[cls] = false; },
                contains: function (cls) { return Boolean(this[cls]); }
            },
            addEventListener: function (evt, handler) {
                if (!listeners[id]) listeners[id] = {};
                listeners[id][evt] = handler;
            },
            focus: () => {}
        };
    }

    const elementIds = [
        'title', 'subtitle', 'brand-tag', 'input-label', 'license-token',
        'btn-paste-text', 'btn-clear-text', 'btn-activate-text', 'btn-quit-text',
        'pill-signature', 'pill-offline', 'pill-security', 'meta-note',
        'shortcut-hints', 'status-box', 'status-icon', 'status-text',
        'lang-btn-zh', 'lang-btn-en', 'btn-paste', 'btn-clear',
        'btn-activate', 'btn-quit',
        'sample-box', 'sample-badge', 'sample-title-text', 'btn-fill-sample', 'btn-fill-sample-text',
        'btn-copy-sample', 'btn-copy-sample-text', 'sample-code-row', 'sample-code', 'sample-tip',
        'progress-card', 'progress-stage-desc', 'progress-percent', 'progress-bar-fill',
        'step-1', 'step-2', 'step-3', 'step-4',
        'step-1-title', 'step-2-title', 'step-3-title', 'step-4-title',
        'machine-card', 'machine-title', 'machine-device', 'machine-code', 'machine-hint',
        'btn-copy-machine', 'btn-copy-machine-text'
    ];

    elementIds.forEach(id => {
        dom.elements[id] = createMockElement(id);
    });

    const windowListeners = {};
    let quitCalled = false;
    let activatedToken = null;
    let progressCallback = null;

    const context = {
        console,
        document: {
            get title() { return dom.title; },
            set title(v) { dom.title = v; },
            documentElement: dom.documentElement,
            body: dom.body,
            getElementById: (id) => dom.elements[id] || createMockElement(id),
            activeElement: dom.elements['license-token']
        },
        window: {
            localStorage: storageMock,
            navigator: { language: 'zh-CN' },
            addEventListener: (evt, handler) => { windowListeners[evt] = handler; },
            DesktopLicense: {
                getState: async () => ({ valid: false, reasonCode: 'LICENSE_REQUIRED' }),
                activate: async (tok) => {
                    activatedToken = tok;
                    if (progressCallback) {
                        progressCallback({ stage: 'PARSE_TOKEN', percent: 25 });
                        progressCallback({ stage: 'CHECK_SIGNATURE', percent: 50 });
                        progressCallback({ stage: 'CONNECT_SERVER', percent: 75 });
                        progressCallback({ stage: 'FINALIZE', percent: 100 });
                    }
                    return { valid: true };
                },
                quit: () => { quitCalled = true; },
                readClipboard: () => 'DSKL1.test.signature',
                onProgress: (cb) => { progressCallback = cb; }
            }
        },
        localStorage: storageMock,
        navigator: { language: 'zh-CN' },
        setTimeout: (fn) => fn(),
        clearTimeout: () => {}
    };

    vm.createContext(context);
    assert.doesNotThrow(() => vm.runInContext(script, context), 'Script execution should succeed without errors');

    // 1. Initial Chinese mode check
    assert.equal(dom.documentElement.lang, 'zh-CN');
    assert.equal(dom.elements['title'].textContent, '本机授权激活');
    assert.equal(dom.elements['machine-title'].textContent, '第 1 步 · 将本机机器码发给管理员');
    assert.equal(dom.elements['step-1-title'].textContent, '格式解析');
    assert.equal(dom.elements['step-2-title'].textContent, '签名验签');
    assert.equal(dom.elements['btn-activate-text'].textContent, '验证并启动（支持离线）');
    assert.equal(dom.elements['sample-badge'].textContent, '输入样例');
    assert.equal(dom.elements['btn-fill-sample-text'].textContent, '填入输入框');
    assert.equal(dom.elements['btn-copy-sample-text'].textContent, '复制样例');
    assert.match(dom.title, /Dragon Platform - 软件授权激活/);

    // 2. Switch to English
    assert.ok(listeners['lang-btn-en'] && listeners['lang-btn-en']['click']);
    listeners['lang-btn-en']['click']();

    assert.equal(dom.documentElement.lang, 'en');
    assert.equal(dom.elements['title'].textContent, 'Device License Activation');
    assert.equal(dom.elements['machine-title'].textContent, 'Step 1 · Send this machine code to your administrator');
    assert.equal(dom.elements['step-1-title'].textContent, 'Format');
    assert.equal(dom.elements['step-2-title'].textContent, 'Signature');
    assert.equal(dom.elements['step-3-title'].textContent, 'Verification');
    assert.equal(dom.elements['step-4-title'].textContent, 'Activation');
    assert.equal(dom.elements['btn-activate-text'].textContent, 'Verify & Launch (Offline Supported)');
    assert.equal(dom.elements['btn-quit-text'].textContent, 'Quit');
    assert.equal(dom.elements['sample-badge'].textContent, 'Sample Format');
    assert.equal(dom.elements['btn-fill-sample-text'].textContent, 'Fill Sample');
    assert.equal(dom.elements['btn-copy-sample-text'].textContent, 'Copy Sample');
    assert.match(dom.elements['license-token'].placeholder, /Paste your complete license key/);
    assert.match(dom.title, /Dragon Platform - License Activation/);
    assert.equal(storageMock.getItem('tools_license_lang'), 'en');

    // 3. Switch back to Chinese
    listeners['lang-btn-zh']['click']();
    assert.equal(dom.documentElement.lang, 'zh-CN');
    assert.equal(dom.elements['step-1-title'].textContent, '格式解析');
    assert.equal(dom.elements['sample-badge'].textContent, '输入样例');
    assert.equal(storageMock.getItem('tools_license_lang'), 'zh');

    // 4. Test Fill Sample functionality
    assert.ok(listeners['btn-fill-sample'] && listeners['btn-fill-sample']['click']);
    listeners['btn-fill-sample']['click']();
    assert.match(dom.elements['license-token'].value, /^DSKL1\./);
    assert.match(dom.elements['status-text'].textContent, /已填入样例/);

    // 5. Test Copy Sample functionality
    assert.ok(listeners['btn-copy-sample'] && listeners['btn-copy-sample']['click']);
    await listeners['btn-copy-sample']['click']();
    assert.match(dom.elements['status-text'].textContent, /已复制到剪贴板/);

    // 6. Test Clipboard Paste functionality
    assert.ok(listeners['btn-paste'] && listeners['btn-paste']['click']);
    listeners['btn-paste']['click']();
    assert.equal(dom.elements['license-token'].value, 'DSKL1.test.signature');

    // 5. Test Activation and Progress tracking
    assert.ok(listeners['btn-activate'] && listeners['btn-activate']['click']);
    await listeners['btn-activate']['click']();

    assert.equal(activatedToken, 'DSKL1.test.signature');
    assert.equal(dom.elements['progress-card'].classList.contains('show'), true, 'Progress card should be displayed during activation');
    assert.equal(dom.elements['progress-percent'].textContent, '100%');
    assert.equal(dom.elements['progress-bar-fill'].style.width, '100%');
    assert.match(dom.elements['progress-stage-desc'].textContent, /授权验证成功/);

    // 6. Test Clear functionality resets progress
    assert.ok(listeners['btn-clear'] && listeners['btn-clear']['click']);
    listeners['btn-clear']['click']();
    assert.equal(dom.elements['license-token'].value, '');
    assert.equal(dom.elements['progress-card'].className, 'progress-card', 'Progress card should be reset on clear');

    // 7. Test Quit button
    assert.ok(listeners['btn-quit'] && listeners['btn-quit']['click']);
    listeners['btn-quit']['click']();
    assert.equal(quitCalled, true, 'DesktopLicense.quit should be called on quit button click');
});

test('License Activation Page: Preload exposes readClipboard, getState, activate, quit, and onProgress', () => {
    const preloadPath = path.join(root, 'desktop-license-preload.js');
    const preloadCode = fs.readFileSync(preloadPath, 'utf8');

    assert.match(preloadCode, /contextBridge\.exposeInMainWorld\('DesktopLicense'/);
    assert.match(preloadCode, /getState:/);
    assert.match(preloadCode, /activate:/);
    assert.match(preloadCode, /quit:/);
    assert.match(preloadCode, /readClipboard:/);
    assert.match(preloadCode, /onProgress:/);
});

test('Desktop License Client: validate reports progress stages to callback', async () => {
    const { createDesktopLicenseClient } = require('../desktop-license-client');
    const { encodeMachineCode } = require('../backend/models/desktop-machine-code');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-progress-test-'));
    const authority = require('../backend/models/desktop-license-authority');

    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
        version: 1,
        productId: 'tools-platform-desktop',
        validationUrl: 'http://127.0.0.1:9999/validate',
        publicKeyJwk: authority.getPublicKeyJwk()
    }));

    const machine = { machineId: 'a'.repeat(32), host: 'TEST-PC', platform: 'win32', arch: 'x64', source: 'win32' };
    const client = createDesktopLicenseClient({
        configPath,
        statePath: path.join(tempDir, 'state.json'),
        publicStatusPath: path.join(tempDir, 'status.json'),
        machineIdentity: machine
    });

    const issued = authority.issue({ label: '测试进度报告', days: 30, machineCode: encodeMachineCode(machine) });
    const stages = [];

    const result = await client.validate(issued.token, {
        onProgress: (p) => {
            stages.push(p.stage);
        }
    });

    assert.equal(result.valid, true);
    assert.ok(stages.includes('PARSE_TOKEN'), 'Should report PARSE_TOKEN');
    assert.ok(stages.includes('CHECK_SIGNATURE'), 'Should report CHECK_SIGNATURE');
    assert.ok(stages.includes('CONNECT_SERVER'), 'Should report CONNECT_SERVER');
    assert.ok(stages.includes('FINALIZE'), 'Should report FINALIZE');
});

test('Desktop License Activation Window: electron-main enforces topmost layer and paste support over startup window', () => {
    const mainPath = path.join(root, 'electron-main.js');
    const mainCode = fs.readFileSync(mainPath, 'utf8');

    // 1. licenseWindow has alwaysOnTop enabled
    assert.match(mainCode, /function createLicenseWindow\(\)[\s\S]*?alwaysOnTop:\s*true/);

    // 2. startupWindow alwaysOnTop is revoked when license window is shown
    assert.match(mainCode, /startupWindow\.setAlwaysOnTop\(false\)/);

    // 3. Right-click context menu with paste support is registered
    assert.match(mainCode, /licenseWindow\.webContents\.on\('context-menu'/);
    assert.match(mainCode, /role:\s*'paste'/);

    // 4. Focus redirection from startup window to license window
    assert.match(mainCode, /startupWindow\.on\('focus'/);

    // 5. Restoration of startupWindow on successful activation
    assert.match(mainCode, /startupWindow\.setAlwaysOnTop\(true\)/);

    // 6. second-instance prioritizes licenseWindow
    assert.match(mainCode, /app\.on\('second-instance'[\s\S]*?if\s*\(licenseWindow && !licenseWindow\.isDestroyed\(\)\)/);
});

