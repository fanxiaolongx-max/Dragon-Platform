const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/python-updater/index.html'), 'utf8');
const pageScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).find(script => script.includes('function initPage()'));
const currentScript = {
    id: 'pr-audit-sampler', name: '当前抽查工具', current_version: '1.1.0',
    code: '__version__ = "1.1.0"\nprint("current tool")\n'
};

class Element {
    constructor() {
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.disabled = false;
        this.children = [];
        this.listeners = new Map();
        this.classList = { add() {}, remove() {} };
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    appendChild(child) { this.children.push(child); }
    remove() {}
    async dispatch(type, extra = {}) {
        if (this.disabled) return;
        const listener = this.listeners.get(type);
        if (listener) await listener({ target: this, ...extra });
    }
}

function createPage(responder = async url => {
    if (url.endsWith('/versions')) {
        return { success: true, versions: [{ id: 'current-version', version: '1.1.0', changelog: '当前版本', created_at: '2026-10-14' }] };
    }
    return { success: true, script: currentScript };
}) {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
    };
    element('scriptName').value = 'PR 报告抽查脚本';
    element('scriptVersion').value = '1.0.0';
    const calls = [];
    const context = vm.createContext({
        Blob,
        document: { getElementById: element, createElement: () => new Element() },
        window: { location: { href: '' } },
        navigator: { clipboard: { writeText: async () => {} } },
        confirm: () => true,
        console: { warn() {} },
        setTimeout: () => 0,
        requestAnimationFrame: callback => callback(),
        FileReader: class {
            readAsText(file) { this.onload({ target: { result: file.text } }); }
        },
        fetch: async (url, options) => {
            calls.push({ url, options });
            const data = await responder(url, options);
            return { ok: true, status: 200, json: async () => data };
        }
    });
    // Capture the real page initialization promise so API failures and races can be exercised.
    vm.runInContext(pageScript.replace(/\binitPage\(\);\s*$/, 'globalThis.pageReady = initPage();'), context);
    return { context, element, calls, ready: context.pageReady };
}

test('reopening the updater loads and saves the persisted code and metadata', async () => {
    const page = createPage();
    assert.equal(page.element('btnSaveVersion').disabled, true);
    assert.equal(page.element('btnSyncRepo').disabled, true);
    await page.ready;

    assert.equal(page.element('codeEditor').value, currentScript.code);
    assert.equal(page.element('scriptName').value, currentScript.name);
    assert.equal(page.element('scriptVersion').value, '1.1.0');
    assert.equal(page.element('versionCount').textContent, 1);
    assert.equal(page.element('btnSaveVersion').disabled, false);

    await page.element('btnSaveVersion').dispatch('click');
    const save = page.calls.find(call => call.url === '/api/python-updater/scripts');
    const payload = JSON.parse(save.options.body);
    assert.equal(payload.code, currentScript.code);
    assert.equal(payload.version, '1.1.0');
    assert.equal(payload.name, currentScript.name);
});

test('a failed current-script request keeps publishing disabled instead of loading an old embedded version', async () => {
    const page = createPage(async () => { throw new Error('登录已过期'); });
    await page.ready;
    assert.equal(page.element('codeEditor').value, '');
    assert.equal(page.element('btnSaveVersion').disabled, true);
    assert.equal(page.element('btnSyncRepo').disabled, true);
    assert.equal(page.calls.length, 1);
    assert.match(page.element('toastContainer').children[0].innerHTML, /当前脚本加载失败/);

    page.context.handleFileUpload({ name: 'recovered.py', text: 'print("local recovery")\n' });
    assert.equal(page.element('btnSaveVersion').disabled, false);
    assert.equal(page.element('codeEditor').value, 'print("local recovery")\n');
});

test('history loading failure preserves the loaded current code', async () => {
    const page = createPage(async url => {
        if (url.endsWith('/versions')) throw new Error('历史记录暂不可用');
        return { script: currentScript };
    });
    await page.ready;
    assert.equal(page.element('codeEditor').value, currentScript.code);
    assert.equal(page.element('btnSyncRepo').disabled, false);
    assert.match(page.element('toastContainer').children[0].innerHTML, /历史版本加载失败/);
});

test('late initialization never overwrites a script imported while the request is pending', async () => {
    let resolveRequest;
    const pendingRequest = new Promise(resolve => { resolveRequest = resolve; });
    const page = createPage(() => pendingRequest);
    const imported = '__version__ = "2.0.0"\nprint("imported tool")\n';
    page.context.handleFileUpload({ name: 'imported.PY', text: imported });
    resolveRequest({ script: currentScript });
    await page.ready;

    assert.equal(page.element('codeEditor').value, imported);
    assert.equal(page.element('scriptName').value, 'imported');
    assert.equal(page.element('scriptVersion').value, '2.0.0');
    assert.equal(page.element('btnSyncRepo').disabled, false);
});

test('import recognizes Python extensions and version declarations and counts real lines', async () => {
    const page = createPage();
    await page.ready;
    const code = '__version__ = "2.3.4"\r\nprint("hello")\r\n';
    page.context.handleFileUpload({ name: 'My sampler.PY', text: code });
    assert.equal(page.element('scriptName').value, 'My sampler');
    assert.equal(page.element('scriptVersion').value, '2.3.4');
    assert.equal(page.element('codeEditor').value, code);
    assert.equal(page.element('codeLineCount').textContent, '3 行');

    page.element('codeEditor').value = '';
    await page.element('codeEditor').dispatch('input');
    assert.equal(page.element('codeLineCount').textContent, '0 行');
    assert.equal(page.element('btnSaveVersion').disabled, true);
});

test('new scripts contain Python source with real newlines and start with their own history', async () => {
    const page = createPage();
    await page.ready;
    await page.element('btnNewScript').dispatch('click');
    const code = page.element('codeEditor').value;
    assert.ok(code.includes('\ndef main():\n    print("Hello from Python Universal Shell!")\n'));
    assert.ok(code.includes("\nif __name__ == '__main__':\n    main()\n"));
    assert.equal(code.includes('\\n'), false);
    assert.equal(page.element('scriptVersion').value, '1.0.0');
    assert.equal(page.element('versionCount').textContent, 0);
    assert.equal(page.element('btnSaveVersion').disabled, false);
});

test('diff compares individual lines and treats CRLF and LF as equivalent line endings', async () => {
    const page = createPage();
    await page.ready;
    const changed = page.context.clientComputeDiff('same\r\nold\r\nend', 'same\nnew\nend');
    assert.deepEqual(JSON.parse(JSON.stringify(changed.stats)), { adds: 1, dels: 1, sames: 2 });
    assert.deepEqual(Array.from(changed.lines.filter(line => line.type === 'same'), line => line.text), ['same', 'end']);
    const unchanged = page.context.clientComputeDiff('same\r\nend', 'same\nend');
    assert.equal(unchanged.stats.adds, 0);
    assert.equal(unchanged.stats.dels, 0);
    assert.equal(unchanged.stats.sames, 2);
});
