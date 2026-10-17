const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const packer = require('../backend/builtin-tools/f12-to-extension/packer-core');

const base = path.join(__dirname, '../backend/builtin-tools/f12-to-extension');
const source = fs.readFileSync(path.join(base, 'netcare-rfc-word.js'), 'utf8');
const pageCode = require('./helpers/netcare-page');
const pkg = packer.buildPackage({
    name: 'NetCare worker identity regression', version: '1.0.0', code: source,
    matches: [
        'https://netcare-ae.gts.huawei.com/p/netcare/index.html*',
        'https://netcare.huawei.com/p/netcare/index.html*',
        'https://netcare-de.gts.huawei.com/p/netcare/index.html*',
        'https://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*'
    ].join('\n'),
    world: 'MAIN', allFrames: true, manualLaunch: false, includePopup: false,
    license: { enabled: false }
});
const first = 'NC20260227000221', second = 'NC20260928001979';
const exportUrl = docId => `https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html?id=${docId}`;
const utility = { URL, URLSearchParams, Blob, TextEncoder, Uint8Array, DataView, location: new URL('https://test.example'), window: {} };
vm.runInNewContext(pageCode, utility);

function frameDocument() {
    const frames = [];
    return {
        frames,
        createElement() {
            return { style: {}, isConnected: false, contentWindow: {}, remove() { this.isConnected = false; } };
        },
        body: { append(frame) { frame.isConnected = true; frames.push(frame); } }
    };
}

// A minimal asynchronous IndexedDB surface; production artifact validation,
// chunk assembly and storage policy are all executed unchanged in the VM.
function memoryIndexedDb() {
    const stores = Object.fromEntries(['files', 'parts', 'snapshots', 'settings', 'performance'].map(name => [name, new Map()]));
    const database = {
        close() {},
        transaction() {
            let completeTimer, aborted = false;
            const transaction = {
                abort() { aborted = true; clearImmediate(completeTimer); queueMicrotask(() => transaction.onabort?.()); },
                objectStore(name) {
                    const request = operation => {
                        clearImmediate(completeTimer);
                        const request = {};
                        queueMicrotask(() => {
                            if (aborted) return;
                            request.result = operation();
                            request.onsuccess?.();
                            completeTimer = setImmediate(() => { if (!aborted) transaction.oncomplete?.(); });
                        });
                        return request;
                    };
                    return {
                        get: id => request(() => stores[name].get(id)),
                        getAll: () => request(() => [...stores[name].values()]),
                        put: item => request(() => { stores[name].set(item.id, structuredClone(item)); return item.id; }),
                        delete: id => request(() => stores[name].delete(id))
                    };
                }
            };
            completeTimer = setImmediate(() => { if (!aborted) transaction.oncomplete?.(); });
            return transaction;
        }
    };
    return { stores, open() { const request = { result: database }; queueMicrotask(() => request.onsuccess?.()); return request; } };
}

function background() {
    const listeners = [], indexedDB = memoryIndexedDb();
    const context = {
        URL, crypto, indexedDB, TextEncoder, Uint8Array, atob, btoa, AbortController, setTimeout, clearTimeout,
        chrome: {
            runtime: { id: 'identity-fixture', onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listeners.push(fn); } } },
            storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }
        }
    };
    vm.runInNewContext(pkg.files['background.js'], context);
    return {
        cache: context.tpNetcareArtifactCache,
        dispatch(message, url) {
            return new Promise(resolve => {
                for (const listener of listeners) {
                    let answered = false;
                    const result = listener(message, { id: 'identity-fixture', url, frameId: 5, tab: { id: 10 } }, response => { answered = true; resolve(response); });
                    if (result === true || answered) return;
                }
                throw Error('No production background listener accepted the message');
            });
        }
    };
}

function exportWorker(url, bg, cacheFailure = false) {
    const listeners = new Map(), messages = [], requests = [], saved = [], timers = new Set();
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const location = new URL(url);
    location.ancestorOrigins = ['https://netcare.huawei.com'];
    const parent = { postMessage(message) { messages.push(message); if (['done', 'error'].includes(message.type)) finish(message); } };
    const window = {
        name: 'rfc-word-worker',
        addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        postMessage(data) { queueMicrotask(() => { for (const fn of listeners.get('message') || []) fn({ source: window, origin: location.origin, data }); }); },
        jQuery: { ajax(settings) {
            requests.push(new URL(settings.url));
            const api = {
                done(fn) { queueMicrotask(() => fn(settings.url.includes('addPublishToolTask')
                    ? { status: 'Success', returnValue: 'task-fixture', obj: 'Solution' }
                    : settings.url.includes('getPublishToolStatus') ? { status: '9', fileName: 'Solution' } : {})); return api; },
                fail() { return api; }, abort() {}
            };
            return api;
        } }
    };
    const document = {
        documentElement: { getAttribute() { return ''; }, setAttribute() {} },
        createElement() { return { click() { saved.push(this.download); }, remove() {} }; },
        body: { append() {} }
    };
    class XHR {
        open(method, url) { assert.equal(method, 'GET'); requests.push(new URL(url)); }
        setRequestHeader() {}
        send() { this.status = 200; this.response = new Blob([Uint8Array.from([80, 75, 3, 4, 7])]); queueMicrotask(() => this.onload()); }
        abort() { this.onabort(); }
    }
    const context = {
        window, document, parent, location, crypto, Blob, Uint8Array, atob, btoa, AbortController,
        URL: class extends URL { static createObjectURL() { return 'blob:identity-fixture'; } static revokeObjectURL() {} },
        sessionStorage: { getItem() { return null; } }, XMLHttpRequest: XHR,
        setTimeout(fn, delay) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay); timers.add(timer); return timer; },
        clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
        setInterval() { return 1; }, clearInterval() {},
        chrome: {
            runtime: { id: 'identity-fixture', sendMessage(message) {
                if (cacheFailure) return Promise.resolve({ ok: false, error: 'Storage capacity exceeded' });
                return bg.dispatch(message, url);
            } }
        }
    };
    vm.runInNewContext(pageCode, context);
    vm.runInNewContext(pkg.files['netcare-artifact-relay.js'], context);
    return {
        requests, messages, saved,
        run(order, bundleOnly = true) {
            const data = { channel: 'netcare-rfc-word-v1', type: 'run', job: crypto.randomUUID(), order, bundleOnly };
            for (const listener of listeners.get('message')) listener({ source: parent, origin: location.ancestorOrigins[0], data });
            return finished;
        },
        close() { window.__rfcWordWorkerCleanup(); window.__tpNetcareArtifactRelayCleanup(); timers.forEach(clearTimeout); }
    };
}

test('same KDP origin keeps RFC and selected DNC/NC frames separate and releases each frame', () => {
    const bridges = new Map(), doc = frameDocument(), signal = new AbortController();
    const a = utility.netcareCreateWordBridge(bridges, exportUrl('D' + first), first, doc, signal.signal);
    const b = utility.netcareCreateWordBridge(bridges, exportUrl(second), second, doc, signal.signal);
    const original = utility.netcareCreateWordBridge(bridges, exportUrl(first), first, doc, signal.signal);
    assert.equal(bridges.size, 3);
    assert.notEqual(a.frame, b.frame);
    assert.notEqual(a.frame, original.frame);
    assert.equal(new URL(a.frame.src).searchParams.get('id'), 'D' + first);
    utility.netcareReleaseWordBridge(bridges, a);
    assert.equal(a.frame.isConnected, false);
    assert.equal(b.frame.isConnected, true);
    assert.equal(bridges.size, 2);
    signal.abort();
    assert.equal(bridges.size, 0);
    assert.ok(doc.frames.every(frame => !frame.isConnected));
    assert.throws(() => utility.netcareCreateWordBridge(bridges, exportUrl(first), second, doc), /does not match/);
    assert.equal(doc.frames.length, 3, 'a mismatched RFC cannot create an export frame');
});

test('timeout and cancellation still settle the RFC after its completed Word worker has been removed', async () => {
    const start = source.indexOf('  function transfer(order, connection, signal) {');
    const end = source.indexOf('  async function start()', start);
    assert.ok(start >= 0 && end > start);
    for (const mode of ['timeout', 'cancel']) {
        const bridges = new Map(), jobs = new Map(), doc = frameDocument(), controller = new AbortController(), timers = [];
        const connection = utility.netcareCreateWordBridge(bridges, exportUrl(first), first, doc, controller.signal);
        const transfer = vm.runInNewContext(`(()=>{${source.slice(start, end)};return transfer;})()`, {
            crypto, jobs, bridges, extractionSettings: { textEnabled: true }, currentBatch: { started: Date.now() },
            netcareReleaseWordBridge: utility.netcareReleaseWordBridge,
            setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
            post(value) { assert.equal(value.frame.isConnected, true, 'no message may target a removed worker'); }
        });
        const pending = transfer(first, connection, controller.signal);
        utility.netcareReleaseWordBridge(bridges, connection);
        const rejected = assert.rejects(pending, mode === 'timeout' ? /timed out/ : /已停止等待/);
        if (mode === 'timeout') timers[0](); else controller.abort();
        await rejected;
        assert.equal(jobs.size, 0);
        assert.equal(bridges.size, 0);
    }
});

test('same-origin consecutive RFCs pass the real artifact relay and policy and preserve DNC bytes in the combined ZIP', async () => {
    const bg = background(), bridges = new Map(), doc = frameDocument(), records = [];
    for (const [order, docId] of [[first, 'D' + first], [second, second]]) {
        const connection = utility.netcareCreateWordBridge(bridges, exportUrl(docId), order, doc);
        const worker = exportWorker(connection.url, bg);
        try {
            const result = await worker.run(order);
            assert.equal(result.type, 'done', result.text);
            assert.equal(worker.saved.length, 0);
            assert.equal(worker.requests[0].searchParams.get('id'), docId);
            assert.equal(worker.requests[1].searchParams.get('owsId'), docId);
            assert.ok(worker.requests.slice(2).every(url => url.searchParams.get('docId') === docId));
            records.push({ order, wordFilename: result.filename, items: [], reports: [], materials: [] });
        } finally { worker.close(); utility.netcareReleaseWordBridge(bridges, connection); }
    }
    assert.equal(bridges.size, 0);
    const files = await bg.cache.list([first, second]);
    assert.equal(files.length, 2);
    const materials = await utility.netcareAuditMaterials(records, files, async file => {
        const onlineUrl = `https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=${file.order}`;
        const result = await bg.dispatch({ type: 'TP_RFC_ARTIFACT_REQUEST', action: 'read', order: file.order, fileId: file.id, index: 0 }, onlineUrl);
        assert.equal(result.ok, true, result.error);
        return new Blob([Buffer.from(result.data, 'base64')]);
    });
    const JSZip = require('../backend/node_modules/jszip');
    const zip = await JSZip.loadAsync(await (await utility.createNetcareZip(materials.entries)).arrayBuffer());
    for (const record of records) assert.deepEqual(await zip.file(record.order + '/' + record.wordFilename).async('uint8array'), Uint8Array.from([80, 75, 3, 4, 7]));
    await bg.cache.close();
});

test('a fixed worker URL rejects a different RFC before calling native conversion or storage', async () => {
    const bg = background(), worker = exportWorker(exportUrl('D' + first), bg);
    try {
        const result = await worker.run(second);
        assert.equal(result.type, 'error');
        assert.match(result.text, /does not match/);
        assert.equal(worker.requests.length, 0);
        assert.equal(worker.saved.length, 0);
    } finally { worker.close(); }
    const denied = await bg.dispatch({ type: 'TP_RFC_ARTIFACT_REQUEST', action: 'begin', order: second, fileId: crypto.randomUUID(), name: 'other.docx', size: 5, role: 'word' }, exportUrl('D' + first));
    assert.equal(denied.ok, false, 'the production cache policy must still reject cross-RFC uploads');
});

test('audit/extraction cache failures remain failures without downloading a separate Word or sending done', async () => {
    const worker = exportWorker(exportUrl(first), null, true);
    try {
        const result = await worker.run(first);
        assert.equal(result.type, 'error');
        assert.match(result.text, /本单未完成/);
        assert.match(result.text, /重新运行/);
        assert.match(result.text, /Storage capacity exceeded/);
        assert.equal(worker.saved.length, 0);
        assert.ok(!worker.messages.some(message => message.type === 'done'));
    } finally { worker.close(); }
});

test('Word-only mode still saves the requested Word when cache storage is unavailable', async () => {
    const worker = exportWorker(exportUrl(first), null, true);
    try {
        const result = await worker.run(first, false);
        assert.equal(result.type, 'done');
        assert.deepEqual(worker.saved, [first + '_Solution.docx']);
    } finally { worker.close(); }
});
