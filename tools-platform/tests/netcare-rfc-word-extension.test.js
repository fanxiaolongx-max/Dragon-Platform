const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const packer = require('../backend/builtin-tools/f12-to-extension/packer-core');

const dir = path.join(__dirname, '../backend/builtin-tools/f12-to-extension');
const code = fs.readFileSync(path.join(dir, 'netcare-rfc-word.js'), 'utf8');
const options = {
    name: 'NetCare RFC 方案 Word 下载', version: '1.0.0', description: 'RFC Word downloader',
    matches: 'https://netcare-ae.gts.huawei.com/p/netcare/index.html*\nhttps://netcare.huawei.com/p/netcare/index.html*\nhttps://netcare-de.gts.huawei.com/p/netcare/index.html*\nhttps://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*',
    world: 'MAIN', allFrames: true, manualLaunch: false, includePopup: false,
    runAt: 'document_idle', license: { enabled: false }, code
};

test('RFC package restricts page injection and permits configured AI API origins without cookies', () => {
    const result = packer.buildPackage(options);
    const content = result.manifest.content_scripts[0];
    assert.equal(content.world, 'MAIN');
    assert.equal(content.all_frames, true);
    assert.equal(content.run_at, 'document_idle');
    assert.deepEqual(content.matches, [
        ...options.matches.split('\n'),
        'https://*.kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*'
    ]);
    assert.deepEqual(result.manifest.host_permissions, [
        ...options.matches.split('\n'),
        'https://*.kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*',
        'https://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html*',
        'https://*.kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html*',
        'https://*/*',
        'http://*/*'
    ]);
    assert.ok(!result.manifest.permissions.includes('cookies'));
    assert.equal(result.files['content.js'], code);
    for (const change of [{ world: 'ISOLATED' }, { allFrames: false },
        { license: { enabled: true } }, { matches: 'https://netcare-ae.gts.huawei.com/*' }]) {
        assert.throws(() => packer.buildPackage({ ...options, ...change }), /NetCare RFC/);
    }
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /<option value="netcare-rfc-word">/);
    assert.match(html, /builtin-catalog\.js\?v=/);
    assert.match(require(path.join(dir, 'builtin-catalog.js'))['netcare-rfc-word'].file, /netcare-rfc-word\.js\?v=/);
});

function workerHarness(fileBytes = [0x50, 0x4b, 0x03, 0x04, 0x00], parentOrigin = 'https://netcare-ae.gts.huawei.com', workerHost = 'https://de.kdp.gts.huawei.com', docId = 'NC20261001000381') {
    const messages = [], requests = [], saved = [], listeners = new Map();
    const parent = { postMessage: (message, target) => messages.push({ message, target }) };
    const window = {
        name: 'rfc-word-worker',
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
        jQuery: { ajax: settings => {
            requests.push(settings.url);
            let fail;
            settings.beforeSend({ setRequestHeader: (name, value) => {
                assert.equal(name, 'X-CSRF-TOKEN');
                assert.equal(value, 'local-test-value');
            } });
            const api = {
                done: fn => { queueMicrotask(() => {
                    const url = new URL(settings.url);
                    fn(url.pathname.endsWith('addPublishToolTask')
                        ? { status: 'Success', returnValue: 'task-' + url.searchParams.get('owsId'), obj: 'Test Solution' }
                        : url.pathname.endsWith('getPublishToolStatus')
                            ? { status: '9', taskId: 'task-test', fileName: 'Test Solution', message: 'word发布成功' }
                            : { id: 'NC20261001000381' });
                }); return api; },
                fail: fn => { fail = fn; return api; },
                abort: () => fail?.({}, 'abort')
            };
            return api;
        } }
    };
    class XHR {
        open(method, url) { requests.push(url); assert.equal(method, 'GET'); }
        setRequestHeader(name, value) { assert.equal(name, 'X-CSRF-TOKEN'); assert.equal(value, 'local-test-value'); }
        send() { this.status = 200; this.response = new Blob([new Uint8Array(fileBytes)]); queueMicrotask(() => this.onload()); }
        abort() { this.onabort(); }
    }
    const location = new URL(`${workerHost}/ows1/static/editor/IdpLiteView/PublishLiteView.html?id=${docId}`);
    location.ancestorOrigins = [parentOrigin];
    const context = { window, parent, location,
        URL: class extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} },
        sessionStorage: { getItem: key => key === 'X-CSRF-TOKEN' ? 'local-test-value' : null },
        XMLHttpRequest: XHR, AbortController, Uint8Array, console,
        setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
        document: { createElement: () => ({ click() { saved.push(this.download); }, remove() {} }), body: { append() {} } }
    };
    vm.runInNewContext(code, context);
    const receive = (message, origin = parentOrigin, source = parent) => listeners.get('message')?.({ origin, source, data: { channel: 'netcare-rfc-word-v1', ...message } });
    return { receive, messages, requests, saved, window, listeners, context };
}

test('export worker rejects unrelated origins/windows and exports only a validated Word response', async () => {
    const harness = workerHarness();
    const message = { type: 'run', job: 'job-test', order: 'NC20261001000381' };
    harness.receive(message, 'https://unrelated.example');
    harness.receive(message, undefined, {});
    harness.receive({ ...message, order: '../other' });
    assert.equal(harness.requests.length, 0);
    harness.receive(message);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.requests.length, 4);
    const download = new URL(harness.requests[3]);
    assert.equal(download.searchParams.get('docId'), message.order);
    assert.equal(download.searchParams.get('taskId'), 'task-' + message.order);
    assert.equal(download.searchParams.get('fileName'), 'Test%20Solution');
    assert.deepEqual(harness.saved, ['NC20261001000381_Test Solution.docx']);
    assert.ok(harness.messages.some(item => item.message.type === 'done' && item.message.filename === harness.saved[0]));
    assert.ok(!JSON.stringify(harness.messages).includes('local-test-value'));
    harness.window.__rfcWordWorkerCleanup();
    assert.equal(harness.listeners.size, 0);
});

test('HTML/login responses must not be saved as Word files', async () => {
    const harness = workerHarness([0x3c, 0x68, 0x74, 0x6d, 0x6c]);
    harness.receive({ type: 'run', job: 'job-test', order: 'NC20261001000381' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.saved.length, 0);
    assert.ok(harness.messages.some(item => item.message.type === 'error'));
});

test('native export dialogs do not initialize a worker or an extra floating panel', () => {
    vm.runInNewContext(code, {
        location: new URL('https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html?id=NC20261001000381'),
        window: { name: '' }, URL
    });
});

for (const parentOrigin of ['https://netcare.huawei.com', 'https://netcare-de.gts.huawei.com']) {
    test(`worker binds messages and responses to its actual parent ${parentOrigin}`, async () => {
        const harness = workerHarness(undefined, parentOrigin);
        const message = { type: 'run', job: 'other-site-test', order: 'NC20261001000381' };
        harness.receive(message, 'https://netcare-ae.gts.huawei.com');
        assert.equal(harness.requests.length, 0, 'another supported site must not control this worker');
        harness.receive(message);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(harness.saved.length, 1);
        assert.ok(harness.messages.every(item => item.target === parentOrigin));
        harness.window.__rfcWordWorkerCleanup();
    });
}

test('an unknown parent origin cannot initialize or control a worker', () => {
    const harness = workerHarness(undefined, 'https://netcare.huawei.com.unrelated.example');
    assert.equal(harness.listeners.size, 0);
    assert.equal(harness.messages.length, 0);
});

function batchHarness() {
    const context = { URL, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, context);
    return context;
}
test('batch statistics count unique completed RFCs, failures and pending work without accumulating updates',()=>{
    const stats=batchHarness().netcareBatchStatistics, outcomes=new Map();
    const orders=['A','B','C','A'];outcomes.set('A',{ok:true});outcomes.set('A',{ok:true});outcomes.set('old',{ok:true});outcomes.set('B',{ok:false});
    assert.deepEqual({...stats(orders,outcomes)},{total:3,completed:1,failed:1,pending:1});
    outcomes.set('C',{ok:true});assert.equal(stats(orders,outcomes).pending,0);
    assert.ok(!code.includes('if(event.data.updated&&auditRecords.length'),'individual audit updates must not automatically open the results modal');
});

test('multi-plan settings default on, migrate old preferences and preserve an explicit opt-out', () => {
    const c = batchHarness(), settings = c.netcareDefaultSettings();
    assert.equal(settings.autoSelectSanitizedPlan, true);
    delete settings.autoSelectSanitizedPlan;
    assert.equal(c.netcareNormalizeSettings(settings).autoSelectSanitizedPlan, true);
    assert.equal(c.netcareNormalizeSettings({...settings, autoSelectSanitizedPlan:false}).autoSelectSanitizedPlan, false);
    assert.throws(() => c.netcareNormalizeSettings({...settings, autoSelectSanitizedPlan:'true'}), /设置/);
    assert.equal(c.netcareNormalizeSettings(settings).sections[0].autoSelectSanitizedPlan, undefined);
});
test('auto selection follows a unique sanitized label, never just the second plan or an ambiguous label', () => {
    const select = batchHarness().netcareSanitizedPlanIndex;
    assert.equal(select([{name:'Original plan'},{name:'脱敏方案：Replacement'}]),1);
    assert.equal(select([{name:'Sanitized solution'},{name:'Original plan'}]),0);
    assert.equal(select([{name:'Original plan'},{name:'Replacement'}]),-1);
    assert.equal(select([{name:'未脱敏方案'},{name:'Not redacted plan'}]),-1);
    assert.equal(select([{name:'脱敏方案 A'},{name:'脱敏方案 B'}]),-1);
    assert.equal(select([{name:'Original plan'},{name:'脱敏方案'}],false),-1);
});
test('simultaneous plan prompts queue with their own RFC and selected index', async () => {
    const queue = batchHarness().netcarePlanChoiceQueue, shown=[], gates=[];
    const ask = queue(request => {shown.push(request.order);return new Promise(resolve=>gates.push(resolve));});
    const signal = new AbortController().signal;
    const first=ask({order:'A'},signal), second=ask({order:'B'},signal);
    await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(shown,['A']);
    gates[0](1); assert.equal(await first,1);
    await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(shown,['A','B']);
    gates[1](0); assert.equal(await second,0);
});
test('queued cancellation does not display the cancelled RFC or block the next choice', async () => {
    const queue = batchHarness().netcarePlanChoiceQueue, shown=[], gates=[];
    const ask = queue(request => {shown.push(request.order);return new Promise(resolve=>gates.push(resolve));});
    const firstController=new AbortController(), cancelled=new AbortController(), lastController=new AbortController();
    const first=ask({order:'A'},firstController.signal), second=ask({order:'B'},cancelled.signal), last=ask({order:'C'},lastController.signal);
    const rejected=assert.rejects(second,/Stopped/); cancelled.abort(); await rejected;
    await new Promise(resolve=>setImmediate(resolve)); gates[0](1); await first;
    await new Promise(resolve=>setImmediate(resolve)); assert.deepEqual(shown,['A','C']); gates[1](0); await last;
});

test('batch input normalizes separators, case and duplicates, and refuses invalid tokens', () => {
    const { parseNetcareRfcOrders: parse } = batchHarness();
    assert.deepEqual(Array.from(parse('nc20260921001984，NC20261005000019\nNC20260921001984; NC20261005100013、NC20260901100036')),
        ['NC20260921001984', 'NC20261005000019', 'NC20261005100013', 'NC20260901100036']);
    assert.throws(() => parse(''), /请输入/);
    assert.throws(() => parse('NC20260921001984 invalid'), /invalid/i);
});

test('batch serializes native UI preparation while independent transfers overlap up to the limit', async () => {
    const { executeNetcareRfcBatch: execute } = batchHarness();
    const gates = [], started = [], completed = [];
    let preparing = 0, exporting = 0, peak = 0;
    const controller = new AbortController();
    const operation = execute(['a', 'b', 'c', 'd'], 2, controller.signal,
        async order => {
            assert.equal(++preparing, 1);
            await new Promise(resolve => setImmediate(resolve));
            preparing--;
            if (order === 'c') throw new Error('no permission');
            return order;
        },
        (order, prepared) => {
            assert.equal(prepared, order);
            started.push(order);
            peak = Math.max(peak, ++exporting);
            return new Promise(resolve => gates.push(() => { exporting--; resolve(order); }));
        }, (order, result) => completed.push({ order, ...result }));
    while (gates.length < 2) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, ['a', 'b']);
    gates.shift()();
    while (started.length < 3) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, ['a', 'b', 'd']);
    gates.splice(0).forEach(resolve => resolve());
    const results = await operation;
    assert.equal(peak, 2);
    assert.deepEqual(Array.from(results, result => result.ok), [true, true, false, true]);
    assert.equal(completed.find(result => result.order === 'c').error, 'no permission');
});

test('stopping a batch prevents queued RFCs from being prepared', async () => {
    const { executeNetcareRfcBatch: execute } = batchHarness();
    const controller = new AbortController(), prepared = [];
    const results = await execute(['a', 'b', 'c'], 1, controller.signal,
        async order => { prepared.push(order); return order; },
        async () => { controller.abort(); throw new Error('stopped'); }, () => {});
    assert.deepEqual(prepared, ['a']);
    assert.ok(results.every(result => !result.ok));
});

test('a document-bound worker limits simultaneous jobs and never changes its RFC identity', async () => {
    const harness = workerHarness();
    const order='NC20261001000381';
    Array.from({length:11},(_,index)=>harness.receive({type:'run',job:`batch-${index}`,order}));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.saved.length, 10);
    assert.ok(harness.saved.every(name=>name.startsWith(order+'_')));
    assert.ok(harness.messages.some(({ message }) => message.job === 'batch-10' && message.type === 'error'));
    const urls=harness.requests.map(url=>new URL(url)).filter(url=>url.searchParams.has('docId'));
    assert.equal(urls.length,20);
    assert.ok(urls.every(url=>url.searchParams.get('docId')===order&&url.searchParams.get('taskId')==='task-'+order));
});


test('manual RFC package uses the standard start/stop popup while future KDP workers auto-inject', () => {
    const result = packer.buildPackage({ ...options, manualLaunch: true, includePopup: true });
    assert.equal(result.manifest.action.default_popup, 'popup.html');
    assert.equal(result.manifest.content_scripts.length, 5);
    assert.equal(result.manifest.content_scripts[1].world, "ISOLATED");
    assert.deepEqual(result.manifest.content_scripts[1].js, ["netcare-online-relay.js"]);
    assert.deepEqual(result.manifest.content_scripts[0].matches, [
        options.matches.split('\n')[3],
        'https://*.kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*'
    ]);
    assert.equal(result.manifest.content_scripts[0].all_frames, true);
    assert.equal(result.manifest.content_scripts[0].world, 'MAIN');
    assert.deepEqual(result.manifest.host_permissions, [
        ...options.matches.split('\n'),
        'https://*.kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*',
        'https://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html*',
        'https://*.kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html*',
        'https://*/*',
        'http://*/*'
    ]);
    assert.match(result.files['popup.html'], /id="startButton"/);
    assert.match(result.files['popup.html'], /id="stopButton"/);
    assert.doesNotMatch(result.files['popup.html'], /id="licensePanel"/);
    assert.match(result.files['popup.js'], /const MANUAL_LAUNCH = true;/);
    assert.doesNotThrow(() => new vm.Script(result.files['popup.js']));
    assert.doesNotThrow(() => new vm.Script(result.files['background.js']));
});

test('RFC popup start injects the script and stop sends the existing page control message', async () => {
    const result = packer.buildPackage({ ...options, manualLaunch: true });
    const elements = new Map(), injections = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: 'zh', addEventListener(type, callback) { this[type] = callback; } });
        return elements.get(id);
    };
    const context = { window:{addEventListener(){}},console, URL, TextEncoder, TextDecoder, Uint8Array, atob, navigator: { language: "zh-CN" },
        document: { addEventListener(){},documentElement: {}, getElementById: element, querySelectorAll: () => [] },
        chrome: {
            storage: { local: { get: async () => ({}), set: async () => {} } },
            tabs: { query: async () => [{ id: 123 }] },
            scripting: { executeScript: async settings => { injections.push(settings); } }
        }
    };
    vm.runInNewContext(result.files['popup.js'], context);
    await new Promise(resolve => setImmediate(resolve));
    await element('startButton').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(injections[0].files), ['netcare-online-relay.js']);
    assert.equal(injections[0].world, 'ISOLATED');
    assert.equal(injections[0].target.allFrames, false);
    assert.deepEqual(Array.from(injections[1].files), ['netcare-language.js','netcare-pip.js','netcare-capture.js','netcare-controls.js','netcare-monitor.js','content.js']);
    assert.equal(injections[1].world, 'MAIN');
    await element('stopButton').click();
    await new Promise(resolve => setImmediate(resolve));
    const posted = [];
    context.window = { postMessage: message => posted.push(message) };
    injections[2].func(...injections[2].args);
    assert.equal(posted[0].source, 'EXTENSION_POPUP');
    assert.equal(posted[0].action, 'STOP');
});


test('local packaging preserves the RFC worker registration marker after obfuscation', () => {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const start = html.indexOf('    function obfuscateCode(code) {');
    const end = html.indexOf('    function showLicenseResult', start);
    const context = { window: { JavaScriptObfuscator: { obfuscate: () => ({ getObfuscatedCode: () => 'console.log("obfuscated");' }) } } };
    vm.runInNewContext(html.slice(start, end), context);
    const obfuscated = context.obfuscateCode(code);
    assert.match(obfuscated, /TP_NETCARE_RFC_WORD_V1/);
    const result = packer.buildPackage({ ...options, code: obfuscated, manualLaunch: true });
    assert.deepEqual(result.manifest.content_scripts[0].matches, [
        options.matches.split('\n')[3],
        'https://*.kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*'
    ]);
});


function onlineBackgroundHarness() {
    const result = packer.buildPackage({ ...options, manualLaunch: true });
    const callbacks = [], created = [];
    vm.runInNewContext(result.files['background.js'], {
        URL, console,
        chrome: { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener: fn => callbacks.push(fn) } },
            tabs: { create: async settings => { created.push(settings); return { id: 456 }; } } }
    });
    return { receive: callbacks[0], created };
}

const onlineOrder = 'NC20261004000263';
const onlineUrl = `https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=${onlineOrder}&order_id=${onlineOrder}&type=NCReadOnly`;
const onlineSender = { tab: { id: 123 }, frameId: 0, url: 'https://netcare-ae.gts.huawei.com/p/netcare/index.html#/rfc' };

test('online relay background opens validated native solution URLs in background tabs without downloads/tabs permissions', async () => {
    const harness = onlineBackgroundHarness(), replies = [];
    assert.equal(harness.receive({ type: 'TP_RFC_OPEN_ONLINE', order: onlineOrder, url: onlineUrl }, onlineSender, result => replies.push(result)), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.created[0].url, onlineUrl);
    assert.equal(harness.created[0].openerTabId, 123);
    assert.equal(harness.created[0].active, false);
    assert.equal(replies[0].ok, true);
    const pack = packer.buildPackage({ ...options, manualLaunch: true });
    assert.ok(!pack.manifest.permissions.includes('tabs'));
    assert.ok(!pack.manifest.permissions.includes('downloads'));
});

test('online background rejects unrelated senders, frames, hosts, paths and mismatched RFCs', () => {
    const harness = onlineBackgroundHarness();
    const message = { type: 'TP_RFC_OPEN_ONLINE', order: onlineOrder, url: onlineUrl };
    for (const [changed, sender] of [
        [message, { ...onlineSender, url: 'https://other.example/p/netcare/index.html' }],
        [message, { ...onlineSender, frameId: 1 }],
        [{ ...message, url: onlineUrl.replace('de.kdp.gts.huawei.com', 'de.kdp.gts.huawei.com.evil.example') }, onlineSender],
        [{ ...message, url: onlineUrl.replace('OwsPage.html', 'PublishLiteView.html') }, onlineSender],
        [{ ...message, order: 'NC20261005000019' }, onlineSender],
        [{ ...message, url: onlineUrl.replace('https:', 'http:') }, onlineSender]
    ]) {
        let reply;
        harness.receive(changed, sender, result => { reply = result; });
        assert.equal(reply.ok, false);
    }
    assert.equal(harness.created.length, 0);
});

test('isolated online relay accepts only requests from its own top page and returns independent results', async () => {
    const result = packer.buildPackage({ ...options, manualLaunch: true });
    let receive;
    const messages = [], requests = [];
    const window = { addEventListener: (_type, fn) => { receive = fn; }, postMessage: (message, origin) => messages.push({ message, origin }) };
    window.top = window;
    const origin = 'https://netcare.huawei.com';
    vm.runInNewContext(result.files['netcare-online-relay.js'], { window, location: { origin },
        chrome: { runtime: { sendMessage: async request => { requests.push(request); return { ok: true }; } } } });
    const data = { source: 'TP_RFC_OPEN_REQUEST', id: 'one', order: onlineOrder, url: onlineUrl };
    receive({ source: {}, origin, data });
    receive({ source: window, origin: 'https://other.example', data });
    assert.equal(requests.length, 0);
    receive({ source: window, origin, data });
    receive({ source: window, origin, data: { ...data, id: 'two' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(messages.filter(item=>item.message.source==='TP_RFC_OPEN_RESULT').map(item => item.message.id), ['one', 'two']);
    assert.ok(messages.filter(item=>item.message.source==='TP_RFC_OPEN_RESULT').every(item => item.origin === origin && item.message.ok));
});

test('clicking Start initializes online opening on an already-open page without declarative injection', async () => {
    const pack = packer.buildPackage({ ...options, manualLaunch: true });
    const background = onlineBackgroundHarness();
    const listeners = new Set(), messages = [], elements = new Map(), injections = [];
    const origin = new URL(onlineSender.url).origin;
    const window = {
        addEventListener: (_type, fn) => listeners.add(fn),
        removeEventListener: (_type, fn) => listeners.delete(fn),
        postMessage(message, target) {
            messages.push(message);
            for (const listener of [...listeners]) listener({ source: window, origin: target, data: message });
        }
    };
    window.top = window;
    const relayContext = { window, location: { origin }, chrome: { runtime: { sendMessage: message =>
        new Promise(resolve => background.receive(message, onlineSender, resolve)) } } };
    const element = id => {
        if (!elements.has(id)) elements.set(id, { addEventListener(type, callback) { this[type] = callback; } });
        return elements.get(id);
    };
    vm.runInNewContext(pack.files['popup.js'], {
        window:{addEventListener(){}},console, navigator: { language: 'zh-CN' }, document: { addEventListener(){},documentElement: {}, getElementById: element, querySelectorAll: () => [] },
        chrome: { storage: { local: { get: async () => ({}), set: async () => {} } }, tabs: { query: async () => [{ id: 123 }] },
            scripting: { executeScript: async settings => {
                injections.push(settings.files[0]);
                if (settings.files[0] === 'netcare-online-relay.js') vm.runInNewContext(pack.files[settings.files[0]], relayContext);
            } }
        }
    });
    assert.equal(listeners.size, 0, 'the already-open page has no automatically injected relay');
    await new Promise(resolve => setImmediate(resolve));
    await element('startButton').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(injections, ['netcare-online-relay.js', 'netcare-language.js']);
    for (const [index, order] of ['NC20260927000189', 'NC20260720002912'].entries()) {
        window.postMessage({ source: 'TP_RFC_OPEN_REQUEST', id: `open-${index}`, order,
            url: onlineUrl.replaceAll(onlineOrder, order) }, origin);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(background.created.length, 2, 'one actual tabs.create request per RFC');
    assert.deepEqual(background.created.map(item => new URL(item.url).searchParams.get('docId')), ['NC20260927000189', 'NC20260720002912']);
    assert.equal(messages.filter(message => message.source === 'TP_RFC_OPEN_RESULT' && message.ok).length, 2);
    await element('startButton').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(listeners.size, 2, 'restarting replaces both relay listeners');
    window.postMessage({ source: 'TP_RFC_OPEN_REQUEST', id: 'after-restart', order: onlineOrder, url: onlineUrl }, origin);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(background.created.length, 3, 'restarting must not open duplicate tabs');
});

test('a synchronously invalidated extension relay returns an error instead of leaving requests to timeout', async () => {
    const pack = packer.buildPackage({ ...options, manualLaunch: true });
    let receive;
    const replies = [];
    const window = { addEventListener: (_type, fn) => { receive = fn; }, removeEventListener() {},
        postMessage: message => replies.push(message) };
    window.top = window;
    vm.runInNewContext(pack.files['netcare-online-relay.js'], { window, location: { origin: 'https://netcare.huawei.com' },
        chrome: { runtime: { sendMessage() { throw new Error('Extension context invalidated'); } } } });
    receive({ source: window, origin: 'https://netcare.huawei.com',
        data: { source: 'TP_RFC_OPEN_REQUEST', id: 'invalid-context', order: onlineOrder, url: onlineUrl } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies.at(-1).ok, false);
    assert.match(replies.at(-1).error, /启动脚本/);
});


test('ZIP bundle preserves UTF-8 filenames and bytes with valid CRC, including empty text', async () => {
    const context = { URL, URLSearchParams, TextEncoder, Uint8Array, DataView, Blob, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, context);
    const zip = await context.createNetcareZip([
        { name: '3.2-FW Checklist CLI V1.txt', blob: new Blob(['commands\n']) },
        { name: '1.1-变更目的.txt', blob: new Blob(['\ufeff测试内容']) },
        { name: '4-empty.txt', blob: new Blob([]) }
    ]);
    const JSZip = require('../backend/node_modules/jszip');
    const loaded = await JSZip.loadAsync(Buffer.from(await zip.arrayBuffer()), { checkCRC32: true });
    assert.equal(await loaded.file('3.2-FW Checklist CLI V1.txt').async('string'), 'commands\n');
    assert.equal(await loaded.file('1.1-变更目的.txt').async('string'), '\ufeff测试内容');
    assert.equal(await loaded.file('4-empty.txt').async('string'), '');
});

test('catalogue covers collapsed chapter groups and file naming prevents collisions/path traversal', () => {
    const context = { URL, URLSearchParams, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, context);
    const chapters = context.netcareTopicCatalogue([['catalognumber=1.1&title=Purpose&number=topic1'],
        ['number=topic2&catalognumber=3.2&title=Preparation', 'number=topic2&catalognumber=3.2&title=Preparation']]);
    assert.deepEqual(Array.from(chapters, item => item.number), ['1.1', '3.2']);
    const used = new Set();
    assert.equal(context.netcareUniqueFilename('3.2-file.txt', used), '3.2-file.txt');
    assert.equal(context.netcareUniqueFilename('3.2-file.txt', used), '3.2-file (2).txt');
    assert.ok(!context.netcareSafeFilename('../x/y.txt').includes('/'));
});

test('online filename bridge transfers only the current RFC filename, no credentials', async () => {
    const pack = packer.buildPackage({ ...options, manualLaunch: true });
    const stored = {}, messages = [];
    let receive;
    const window = { addEventListener: (_type, fn) => { receive = fn; }, removeEventListener() {}, postMessage: message => messages.push(message) };
    window.top = window;
    const context = { window, location: new URL(onlineUrl), URL,
        chrome: { storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]])) } } } };
    vm.runInNewContext(pack.files['netcare-collector-bridge.js'], context);
    stored['netcareWordName:' + onlineOrder] = onlineOrder + '_Word solution.docx';
    receive({ source: window, origin: context.location.origin, data: { source: 'TP_RFC_COLLECTOR_GET_NAME', order: onlineOrder } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages[0].filename, stored['netcareWordName:' + onlineOrder]);
    receive({ source: window, origin: context.location.origin, data: { source: 'TP_RFC_COLLECTOR_GET_NAME', order: 'NC20261005000019' } });
    assert.equal(messages.length, 1);
});

test('collector bridge returns close rejection reasons and preserves fallback audit rule identity', async()=>{
    const pack=packer.buildPackage({...options,manualLaunch:true}),messages=[],requests=[];let receive;
    const window={addEventListener:(_type,fn)=>{receive=fn;},removeEventListener(){},postMessage:m=>messages.push(m)};window.top=window;
    const context={window,location:new URL(onlineUrl),URL,chrome:{runtime:{sendMessage:async m=>{requests.push(m);return {ok:false,error:'Missing audit evidence'};}}}};
    vm.runInNewContext(pack.files['netcare-collector-bridge.js'],context);
    receive({source:window,origin:context.location.origin,data:{source:'TP_RFC_CLOSE_AFTER_AUDIT',order:onlineOrder}});
    await new Promise(r=>setImmediate(r));
    assert.equal(messages[0].source,'TP_RFC_CLOSE_RESULT');assert.equal(messages[0].ok,false);assert.equal(messages[0].error,'Missing audit evidence');
    receive({source:window,origin:context.location.origin,data:{source:'TP_RFC_AI_AUDIT',order:onlineOrder,id:crypto.randomUUID(),section:'8.1',ruleSection:'3.3',kind:'text',text:'Evidence'}});
    await new Promise(r=>setImmediate(r));assert.equal(requests[1].ruleSection,'3.3');
});


test('Word filename relay stores the exact downloaded name and rejects unrelated origins or paths', async () => {
    const pack = packer.buildPackage({ ...options, manualLaunch: true });
    let receive;
    const stored = {};
    const window = { addEventListener: (_type, fn) => { receive = fn; }, removeEventListener() {} }; window.top = window;
    const origin = 'https://netcare-ae.gts.huawei.com';
    vm.runInNewContext(pack.files['netcare-online-relay.js'], { window, location: { origin }, chrome: { storage: { local: { set: async values => Object.assign(stored, values) } } } });
    const data = { source: 'TP_RFC_WORD_FILENAME', order: onlineOrder, filename: onlineOrder + '_原生方案名.docx' };
    receive({ source: window, origin: 'https://unrelated.example', data });
    receive({ source: window, origin, data: { ...data, filename: '../bad.docx' } });
    assert.equal(Object.keys(stored).length, 0);
    receive({ source: window, origin, data });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stored['netcareWordName:' + onlineOrder], data.filename);
});


test('default section template and exact-number preferences validate editable rows', () => {
    const context = { URL, URLSearchParams, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, context);
    const settings = context.netcareDefaultSettings();
    assert.equal(settings.sections.length, 34);
    assert.equal(settings.attachmentsEnabled, false);
    assert.equal(settings.intervalMs, 1500);
    assert.ok(context.netcareSectionMatches(settings, '3.2', 'attachments'));
    assert.ok(context.netcareSectionMatches(settings, '3.2.1', 'attachments'));
    assert.ok(!context.netcareSectionMatches(settings, '3.20', 'attachments'));
    const custom = context.netcareNormalizeSettings({ ...settings, textEnabled: true, intervalMs: 5,
        sections: [{ number: '9.2', title: 'Custom', text: true, attachments: false }] });
    assert.equal(custom.intervalMs, 1000);
    assert.equal(custom.sections[0].title, 'Custom');
    assert.throws(() => context.netcareNormalizeSettings({ ...settings, sections: [settings.sections[0], settings.sections[0]] }), /重复/);
    assert.throws(() => context.netcareNormalizeSettings({ ...settings, sections: [{number: 'x', title: 'bad'}] }), /序号/);
});

test('settings relay persists only bounded template fields and restores them across sites', async () => {
    const pack = packer.buildPackage({ ...options, manualLaunch: true }), stored = {}, messages = [];
    let receive;
    const window = { addEventListener: (_t, fn) => { receive = fn; }, removeEventListener() {}, postMessage: m => messages.push(m) }; window.top = window;
    const origin = 'https://netcare-de.gts.huawei.com';
    vm.runInNewContext(pack.files['netcare-online-relay.js'], { window, location: {origin}, chrome: { storage: { local: { set: async data => Object.assign(stored, data), get: async key => ({ [key]: stored[key] }) } } } });
    const value = { concurrency: 2, openOnline: false, attachmentsEnabled: true, textEnabled: true, intervalMs: 2000, sections: [{ number: '3.2', title: 'Preparation', attachments: true, text: true }], forbidden: 'must not persist' };
    receive({ source: window, origin: 'https://other.example', data: {source: 'TP_RFC_SETTINGS_SET', settings: value} });
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(stored, {});
    receive({ source: window, origin, data: {source: 'TP_RFC_SETTINGS_SET', settings: value} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stored.netcareExtractionSettings.forbidden, undefined);
    assert.equal(stored.netcareExtractionSettings.concurrency, 2); assert.equal(stored.netcareExtractionSettings.openOnline, false);
    assert.equal(messages.at(-1).saved, true);
    receive({ source: window, origin, data: {source: 'TP_RFC_SETTINGS_GET'} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.at(-1).settings.sections[0].number, '3.2');
    const count = Object.keys(stored).length;
    receive({ source: window, origin, data: {source: 'TP_RFC_SETTINGS_SET', settings: {...value, intervalMs: 0}} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(Object.keys(stored).length, count); assert.equal(messages.at(-1).ok, false);
});

test('shared attachment throttle spaces read grants across tabs and rejects unrelated senders', async () => {
    const pack = packer.buildPackage({ ...options, manualLaunch: true }); const listeners=[]; const listener=(...args)=>listeners.forEach(fn=>fn(...args));
    const timers = [], replies = [];
    vm.runInNewContext(pack.files['background.js'], { URL, Promise, setTimeout: (fn, delay) => { timers.push({ fn, delay }); }, chrome: { runtime: { onInstalled: { addListener() {} }, onMessage: { addListener: fn => { listeners.push(fn); } } } } });
    const request = {type: 'TP_RFC_READ_SLOT', order: onlineOrder, intervalMs: 1500};
    const sender = {tab: {id: 1}, frameId: 0, url: onlineUrl};
    listener(request, sender, r => replies.push(r)); listener(request, {...sender,tab:{id:2}}, r=>replies.push(r));
    await new Promise(resolve=>setImmediate(resolve)); assert.equal(timers.length,1); assert.equal(replies.length,0); assert.equal(timers[0].delay,1500);
    timers[0].fn(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(replies.length,1); assert.equal(timers.length,2);
    timers[1].fn(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(replies.length,2);
    listener(request, {...sender,url:'https://unrelated.example/'}, r=>replies.push(r)); assert.equal(replies.at(-1).ok,false);
});


test('configuration export/import roundtrips global preferences and migrates earlier settings', () => {
    const context = { URL, URLSearchParams, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, context);
    const settings = context.netcareDefaultSettings(); settings.concurrency = 2; settings.openOnline = false;
    const exported = context.netcareExportSettings(settings), restored = context.netcareImportSettings(exported);
    assert.equal(restored.concurrency, 2); assert.equal(restored.openOnline, false); assert.equal(restored.sections.length,34);
    delete settings.concurrency; delete settings.openOnline;
    const migrated = context.netcareNormalizeSettings(settings); assert.equal(migrated.concurrency,3); assert.equal(migrated.openOnline,true);
    assert.throws(()=>context.netcareImportSettings('{}'),/配置格式/);
    assert.throws(()=>context.netcareImportSettings(exported.replace('"version": 1','"version": 99')),/版本/);
    assert.throws(()=>context.netcareImportSettings(' '.repeat(2097153)),/2MB/);
    assert.throws(()=>context.netcareNormalizeSettings({...settings,concurrency:11}),/全局设置/);
});

test('AI prompts force required extraction while audit stays off until explicitly enabled', () => {
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}}; vm.runInNewContext(code,ctx);
    const value=ctx.netcareDefaultSettings();value.sections=[{number:'3.2',title:'Preparation',text:false,attachments:false,textPrompt:'Check rollback',attachmentsPrompt:'Check commands'}];
    const off=ctx.netcareNormalizeSettings(value);assert.equal(off.aiAuditEnabled,false);assert.equal(off.sections[0].text,true);assert.equal(off.sections[0].attachments,true);
    const on=ctx.netcareNormalizeSettings({...value,aiAuditEnabled:true});assert.equal(on.textEnabled,true);assert.equal(on.attachmentsEnabled,true);
    const imported=ctx.netcareImportSettings(ctx.netcareExportSettings(on));assert.equal(imported.sections[0].textPrompt,'Check rollback');assert.ok(!ctx.netcareExportSettings({...on,key:'must-not-export'}).includes('must-not-export'));
});

test('audit cache expires old RFCs, remains bounded, and redacts credentials', () => {
    const ctx={URL,URLSearchParams,TextEncoder,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    let data=JSON.stringify([{order:'old',created:Date.now()-86400001,items:[]}]);const storage={getItem:()=>data,setItem:(_k,v)=>{data=v;}};
    for(let n=0;n<6;n++)ctx.netcareCacheAudit(storage,'NC'+n,[{section:'1.1',kind:'text',filename:'x.txt',text:'password=hidden token="two words"\n-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----'}],[]);
    const cached=JSON.parse(data);assert.equal(cached.length,5);assert.ok(!data.includes('hidden'));assert.ok(!data.includes('two words'));assert.ok(!data.includes('secret'));assert.ok(!data.includes('"old"'));
    assert.throws(()=>ctx.netcareCacheAudit(storage,'large',[{text:'x'.repeat(2100000)}],[]),/2MB/);
});

test('audit runner skips unsupported/missing/oversized evidence, continues on model errors, and obeys stop', async () => {
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),aiAuditEnabled:true,sections:[{number:'3.2',title:'Preparation',textPrompt:'text rule',attachmentsPrompt:'attachment rule'}]});
    let calls=0;const items=[{section:'3.2',kind:'text',filename:'text.txt',text:'evidence'},{section:'3.2',kind:'attachments',filename:'x.docx',error:'TXT only'},{section:'3.2',kind:'attachments',filename:'large.txt',text:'x'.repeat(60001)},{section:'3.2',kind:'attachments',filename:'commands.txt',text:'commands'}];
    const r=await ctx.netcareRunAudits(items,settings,async()=>{calls++;if(calls===1)return{ok:true,report:{status:'pass',summary:'OK',findings:[]},model:'mock'};throw Error('HTTP 500');},new AbortController().signal,()=>{});
    assert.equal(calls,1);assert.deepEqual(Array.from(r,x=>x.status),['pass','needs_review']);assert.equal(r[1].sources.length,3);assert.equal(r[1].error,true);
    const stopped=new AbortController();stopped.abort();await assert.rejects(ctx.netcareRunAudits(items,settings,()=>{},stopped.signal,()=>{}),/Stopped/);
});

test('RFC AI background adapts all four protocols, isolates keys and rejects untrusted audit senders', async () => {
    const pkg=packer.buildPackage({...options,manualLaunch:true});const callbacks=[],requests=[],stored={};
    const ctx={URL,Promise,AbortController,TextDecoder,setTimeout,clearTimeout,console,chrome:{runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onInstalled:{addListener(){}},onMessage:{addListener:fn=>callbacks.push(fn)}},storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,stored[k]]))}}},fetch:async(url,request)=>{
        requests.push({url,request});const text=JSON.stringify({status:'pass',summary:{zh:'符合要求',en:'Compliant'},findings:[]});const protocol=stored.netcareAiModels[0].protocol;
        const data=protocol==='anthropic'?{content:[{type:'text',text}]}:protocol==='responses'?{output:[{content:[{type:'output_text',text}]}]}:protocol==='gemini'?{candidates:[{content:{parts:[{text}]}}]}:{choices:[{message:{content:text}}]};return new Response(JSON.stringify(data),{status:200});
    }};
    vm.runInNewContext(pkg.files['background.js'],ctx);const audit=callbacks[1],sender={id:'test-extension',tab:{id:1},frameId:0,url:onlineUrl};
    stored.netcareExtractionSettings={aiAuditEnabled:true,sections:[{number:'3.2',textPrompt:'Check configuration'}]};
    for(const protocol of ['openai','responses','anthropic','gemini']){
      stored.netcareAiModels=[{id:'one',url:'https://model.example/v1',model:'model-test',key:'secret-test-key',protocol}];stored.netcareAiSelectedModel='one';
      const response=await new Promise(reply=>audit({type:'TP_RFC_AI_AUDIT',id:crypto.randomUUID(),order:onlineOrder,section:'3.2',kind:'text',filename:'test.txt',text:'password=hidden evidence'},sender,reply));
      assert.equal(response.ok,true);assert.equal(response.report.status,'pass');const last=requests.at(-1);assert.equal(last.request.credentials,'omit');assert.ok(!last.request.body.includes('secret-test-key'));assert.ok(!last.request.body.includes('hidden'));assert.ok(last.request.body.includes('untrusted evidence'));assert.ok(!JSON.stringify(response).includes('secret-test-key'));
    }
    const before=requests.length;audit({type:'TP_RFC_AI_AUDIT',id:crypto.randomUUID(),order:onlineOrder}, {...sender,url:'https://other.example'},()=>{});await new Promise(r=>setImmediate(r));assert.equal(requests.length,before);
    assert.match(pkg.files['netcare-ai.html'],/type="password"/);assert.ok(!pkg.files['content.js'].includes('secret-test-key'));
});

test('Anthropic bearer and API-key modes send the requested header and preserve legacy defaults', () => {
    const pkg=packer.buildPackage({...options,manualLaunch:true});const ctx={URL,chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}}}};vm.runInNewContext(pkg.files['background.js'],ctx);
    const input={protocol:'anthropic',url:'https://model.example/v1',model:'test',key:'test-key'};
    const a=vm.runInNewContext('tpBuildModelRequest(model,"test")',Object.assign(ctx,{model:{...input,authMode:'bearer'}}));
    assert.equal(a.headers.Authorization,'Bearer test-key');assert.equal(a.headers['x-api-key'],undefined);
    const b=vm.runInNewContext('tpBuildModelRequest(model,"test")',Object.assign(ctx,{model:{...input,authMode:'api-key'}}));
    assert.equal(b.headers['x-api-key'],'test-key');assert.equal(b.headers.Authorization,undefined);
    const c=vm.runInNewContext('tpBuildModelRequest(model,"test")',Object.assign(ctx,{model:input}));assert.equal(c.headers['x-api-key'],'test-key');
});

test('connection test diagnostics include HTTP failure response and never expose the model key', async () => {
    const pkg=packer.buildPackage({...options,manualLaunch:true});const callbacks=[];
    const ctx={URL,AbortController,TextDecoder,setTimeout,clearTimeout,chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onMessage:{addListener:fn=>callbacks.push(fn)}},storage:{local:{get:async()=>({})}}},fetch:async()=>new Response(JSON.stringify({error:{message:'Rejected test-key',api_key:'test-key',code:'intranet_auth_failed'}}),{status:403})};
    vm.runInNewContext(pkg.files['background.js'],ctx);
    const response=await new Promise(reply=>callbacks[1]({type:'TP_RFC_AI_TEST',id:crypto.randomUUID(),model:{protocol:'anthropic',authMode:'bearer',url:'https://model.example/v1',model:'test',key:'test-key'}},{id:'test',url:'chrome-extension://test/netcare-ai.html',frameId:1,tab:{id:1}},reply));
    assert.equal(response.ok,false);assert.equal(response.diagnostics.httpStatus,403);assert.match(response.diagnostics.response,/intranet_auth_failed/);assert.ok(!JSON.stringify(response).includes('test-key'));assert.ok(response.diagnostics.elapsedMs>=0);
});

test('audit summaries serialize concurrent RFCs, reject other sites and redact displayed evidence', async () => {
    const pkg=packer.buildPackage({...options,manualLaunch:true});const callbacks=[],stored={};
    const ctx={URL,chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onMessage:{addListener:fn=>callbacks.push(fn)}},storage:{local:{get:async key=>({[key]:stored[key]}),set:async d=>Object.assign(stored,d)}}}};
    vm.runInNewContext(pkg.files['background.js'],ctx);const publish=callbacks[2];
    const send=order=>new Promise(reply=>publish({type:'TP_RFC_AUDIT_PUBLISH',order,record:{order,materials:[{name:'shot.png',section:'1.1',kind:'text',role:'screenshot',sourceFilename:'1.1.txt',secret:'omit-this'}],items:[{section:'1.1',kind:'text',filename:'1.1.txt',text:'password=hidden'}],reports:[{section:'1.1',kind:'text',filename:'1.1.txt',status:'fail',summary:'Missing scope',summaryI18n:{zh:'password=hidden',en:'Scope missing',secret:'omit-this'},findingsI18n:[{zh:'范围缺失',en:'Scope missing'}],rule:'Check scope',corrections:[{ruleNumber:'1.1',ruleTitle:'Expected',fromNumber:'1.1',fromTitle:'password=hidden',toNumber:'1.2',toTitle:'Actual',reason:'title_mismatch',secret:'omit-this'}]}]}},{id:'test',frameId:0,tab:{id:1},url:onlineUrl.replaceAll(onlineOrder,order)},reply));
    const replies=await Promise.all([send(onlineOrder),send('NC20260903002788')]);assert.ok(replies.every(r=>r.ok));assert.equal(stored.netcareAuditSummaries.length,2);assert.ok(!JSON.stringify(stored).includes('hidden'));assert.equal(stored.netcareAuditSummaries[0].reports[0].corrections[0].toTitle,'Actual');assert.ok(!JSON.stringify(stored).includes('omit-this'));assert.equal(stored.netcareAuditSummaries[0].reports[0].summaryI18n.en,'Scope missing');assert.equal(stored.netcareAuditSummaries[0].materials[0].sourceFilename,'1.1.txt');assert.equal(stored.netcareAuditSummaries[0].materials[0].role,'screenshot');
    let rejected;publish({type:'TP_RFC_AUDIT_PUBLISH',order:onlineOrder,record:{}},{id:'test',frameId:0,tab:{id:1},url:'https://other.example'},r=>{rejected=r;});assert.equal(rejected.ok,false);
});

test('saved audit and draft test use identical authentication; audit 401 details reach reports without keys', async () => {
    const pkg=packer.buildPackage({...options,manualLaunch:true}),callbacks=[],requests=[];
    const model={id:'saved',name:'Intranet',protocol:'openai',url:'https://model.example/v1',model:'test-model',key:'private-test-key',authMode:'bearer'};
    const settings={aiAuditEnabled:true,sections:[{number:'3.4',title:'Test and Verification',textPrompt:'Check KPI tests'}]};
    const stored={netcareAiModels:[model],netcareAiSelectedModel:'saved',netcareExtractionSettings:settings};
    const ctx={URL,AbortController,TextDecoder,setTimeout,clearTimeout,chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onMessage:{addListener:fn=>callbacks.push(fn)}},storage:{local:{get:async()=>stored}}},fetch:async(url,request)=>{requests.push({url,request});return requests.length===1?new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}),{status:200}):new Response(JSON.stringify({error:{code:'invalid_api_key',message:'Rejected private-test-key'}}),{status:401});}};
    vm.runInNewContext(pkg.files['background.js'],ctx);
    const send=(type,sender,data)=>new Promise(reply=>callbacks[1]({type,id:crypto.randomUUID(),...data},sender,reply));
    const tested=await send('TP_RFC_AI_TEST',{id:'test',url:'chrome-extension://test/netcare-ai.html',frameId:1,tab:{id:1}},{model});assert.equal(tested.ok,true);
    const failed=await send('TP_RFC_AI_AUDIT',{id:'test',url:onlineUrl,frameId:0,tab:{id:2}},{order:onlineOrder,section:'3.4',kind:'text',filename:'3.4.txt',text:'KPI service test'});
    assert.equal(failed.ok,false);assert.equal(failed.diagnostics.httpStatus,401);assert.equal(failed.diagnostics.configSource,'saved-audit-model');assert.match(failed.diagnostics.response,/invalid_api_key/);assert.ok(!JSON.stringify(failed).includes(model.key));
    assert.equal(requests[0].url,requests[1].url);assert.equal(requests[0].request.headers.Authorization,requests[1].request.headers.Authorization);
    const page={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,page);
    const reports=await page.netcareRunAudits([{section:'3.4',kind:'text',filename:'3.4.txt',text:'KPI service test'}],settings,async()=>failed,new AbortController().signal,()=>{});
    assert.equal(reports[0].status,'needs_review');assert.equal(reports[0].diagnostics.httpStatus,401);assert.match(reports[0].diagnostics.response,/invalid_api_key/);
});

test('RFC AI background retries HTTP 429 gateway rate-limits with backoff and succeeds on subsequent attempt', async () => {
    const pkg = packer.buildPackage({ ...options, manualLaunch: true });
    const callbacks = [], requests = [], logs = [];
    const model = { id: 'saved', name: 'Gateway', protocol: 'openai', url: 'https://aigateway.huawei.com/v1/chat/completions', model: 'dfa_glm-52', key: 'test-gw-key' };
    const settings = { aiAuditEnabled: true, sections: [{ number: '3.4', textPrompt: 'Check KPIs' }] };
    const stored = { netcareAiModels: [model], netcareAiSelectedModel: 'saved', netcareExtractionSettings: settings };
    let attemptCount = 0;
    const ctx = {
      URL, AbortController, TextDecoder, setTimeout, clearTimeout, __tpFastRetry: true,
      chrome: {
        runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onInstalled: { addListener() {} }, onMessage: { addListener: fn => callbacks.push(fn) } },
        storage: { local: { get: async () => stored } }
      },
      tpNetcareArtifactCache: { log: async event => logs.push(event) },
      fetch: async (url, request) => {
        attemptCount++;
        requests.push({ url, request, attempt: attemptCount });
        if (attemptCount === 1) {
          return new Response(JSON.stringify({ time: '2026-10-13 15:14:01', message: 'Maximum limit connection for user group [122] is [30]', status: 429, source: 'AI-Gateway' }), { status: 429 });
        }
        const text = JSON.stringify({ status: 'pass', summary: { zh: '通过', en: 'Pass' }, findings: [] });
        return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
      }
    };
    vm.runInNewContext(pkg.files['background.js'], ctx);
    ctx.tpNetcareArtifactCache.log = async event => { logs.push(event); };
    const audit = callbacks[1];
    const sender = { id: 'test', tab: { id: 1 }, frameId: 0, url: onlineUrl };
    const res = await new Promise(reply => audit({ type: 'TP_RFC_AI_AUDIT', id: crypto.randomUUID(), order: onlineOrder, section: '3.4', kind: 'text', filename: 'kpi.txt', text: 'KPI Evidence' }, sender, reply));
    assert.equal(res.ok, true);
    assert.equal(res.report.status, 'pass');
    assert.equal(attemptCount, 2);
    assert.ok(logs.some(l => l.action === 'model.request.retrying' && l.data?.status === 429));
});

test('RFC AI background throttles concurrent audits to maximum 3 and processes queue', async () => {
    const pkg = packer.buildPackage({ ...options, manualLaunch: true });
    const callbacks = [], stored = {};
    const model = { id: 'saved', name: 'Gateway', protocol: 'openai', url: 'https://aigateway.huawei.com/v1', model: 'm1', key: 'k1' };
    stored.netcareAiModels = [model];
    stored.netcareAiSelectedModel = 'saved';
    stored.netcareExtractionSettings = { aiAuditEnabled: true, sections: [{ number: '1.1', textPrompt: 'Rule' }] };
    let activeFetches = 0, peakActive = 0;
    const ctx = {
      URL, AbortController, TextDecoder, setTimeout, clearTimeout, __tpFastRetry: true,
      chrome: {
        runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onInstalled: { addListener() {} }, onMessage: { addListener: fn => callbacks.push(fn) } },
        storage: { local: { get: async () => stored } }
      },
      fetch: async () => {
        activeFetches++;
        if (activeFetches > peakActive) peakActive = activeFetches;
        await new Promise(r => setTimeout(r, 20));
        activeFetches--;
        const text = JSON.stringify({ status: 'pass', summary: { zh: '通过', en: 'Pass' }, findings: [] });
        return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
      }
    };
    vm.runInNewContext(pkg.files['background.js'], ctx);
    const audit = callbacks[1];
    const sender = { id: 'test', tab: { id: 1 }, frameId: 0, url: onlineUrl };
    const promises = Array.from({ length: 6 }, () => new Promise(reply => audit({ type: 'TP_RFC_AI_AUDIT', id: crypto.randomUUID(), order: onlineOrder, section: '1.1', kind: 'text', filename: 't.txt', text: 'test' }, sender, reply)));
    const results = await Promise.all(promises);
    assert.ok(results.every(r => r.ok === true));
    assert.equal(peakActive, 3);
});

test('RFC AI cancellation removes queued jobs and aborts in-flight audits', async () => {
    const pkg = packer.buildPackage({ ...options, manualLaunch: true });
    const callbacks = [], stored = {};
    const model = { id: 'saved', name: 'Gateway', protocol: 'openai', url: 'https://aigateway.huawei.com/v1', model: 'm1', key: 'k1' };
    stored.netcareAiModels = [model];
    stored.netcareAiSelectedModel = 'saved';
    stored.netcareExtractionSettings = { aiAuditEnabled: true, sections: [{ number: '1.1', textPrompt: 'Rule' }] };
    let fetchAborted = false;
    const ctx = {
      URL, AbortController, TextDecoder, setTimeout, clearTimeout, __tpFastRetry: true,
      chrome: {
        runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onInstalled: { addListener() {} }, onMessage: { addListener: fn => callbacks.push(fn) } },
        storage: { local: { get: async () => stored } }
      },
      fetch: async (url, { signal }) => {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => { fetchAborted = true; reject(new Error('Aborted')); });
        });
      }
    };
    vm.runInNewContext(pkg.files['background.js'], ctx);
    const audit = callbacks[1];
    const sender = { id: 'test', tab: { id: 1 }, frameId: 0, url: onlineUrl };
    const id1 = crypto.randomUUID();
    const p1 = new Promise(reply => audit({ type: 'TP_RFC_AI_AUDIT', id: id1, order: onlineOrder, section: '1.1', kind: 'text', filename: 't.txt', text: 'test' }, sender, reply));
    await new Promise(r => setTimeout(r, 5));
    const cancelRes = await new Promise(reply => audit({ type: 'TP_RFC_AI_CANCEL', id: id1, order: onlineOrder }, sender, reply));
    assert.equal(cancelRes.ok, true);
    const r1 = await p1;
    assert.equal(r1.ok, false);
    assert.ok(fetchAborted);
});

test('configuration backup roundtrips models and rules, excludes evidence, and rejects wrong passwords or tampering', async()=>{
    const backup=require('../backend/builtin-tools/f12-to-extension/netcare-backup')();
    const data={netcareAiModels:[{id:'m1',name:'AI',protocol:'openai',url:'https://model.example/v1',model:'test',key:'sensitive-backup-token'}],netcareAiSelectedModel:'m1',netcareAuditSummaries:[{order:onlineOrder,at:new Date().toISOString(),items:[{text:'sample evidence'}],reports:[]}],netcareExtractionSettings:{sections:[{number:'3.4',textPrompt:'KPI rule'}]}};
    const text=await backup.encrypt(data,'test-password-2026');assert.ok(!text.includes('sensitive-backup-token'));assert.ok(!text.includes('sample evidence'));assert.ok(!text.includes('KPI rule'));assert.deepEqual(await backup.decrypt(text,'test-password-2026'),backup.configuration(data));assert.equal(JSON.parse(text).version,3);assert.equal(JSON.parse(text).scope,'configuration');
    await assert.rejects(backup.decrypt(text,'wrong-password'),/Wrong password/);const altered=JSON.parse(text);altered.ciphertext='AAAA'+altered.ciphertext.slice(4);await assert.rejects(backup.decrypt(JSON.stringify(altered),'test-password-2026'),/damaged/);
    assert.equal(backup.allowed('netcareAiModels'),true);assert.equal(backup.allowed('netcareWordName:'+onlineOrder),false);assert.equal(backup.allowed('Cookie'),false);
    assert.throws(()=>backup.validate({Cookie:'must not import'},()=>true,()=>{}),/fields/);
    const legacy=await backup.decrypt(JSON.stringify({format:'netcare-rfc-settings',version:1,settings:{sections:[]}}),'');assert.deepEqual(legacy,{netcareExtractionSettings:{sections:[]}});
    const pkg=packer.buildPackage({...options,manualLaunch:true});assert.ok(pkg.files['netcare-backup.html']);assert.ok(pkg.files['netcare-renderer.js'].includes('html2canvas'));assert.ok(pkg.manifest.content_scripts.some(c=>c.world==='MAIN'&&c.js.includes('netcare-renderer.js')));
    for(const [name,script]of Object.entries(pkg.files))if(name.endsWith('.js'))new vm.Script(script,{filename:name});
});

test('native evidence capture splits tall regions and refuses missing or oversized original elements',async()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    let draws=0;const element={isConnected:true,scrollWidth:1000,scrollHeight:3201,getBoundingClientRect:()=>({width:1000,height:3201}),ownerDocument:{createElement:()=>({getContext:()=>({drawImage:()=>draws++}),toBlob:fn=>fn(new Blob(['png']))})}};
    const images=await ctx.netcareCaptureEvidence(element,async()=>({width:1000,height:3201}),new AbortController().signal);assert.equal(images.length,3);assert.equal(draws,3);
    await assert.rejects(ctx.netcareCaptureEvidence(null,()=>{},new AbortController().signal),/Original region/);
    await assert.rejects(ctx.netcareCaptureEvidence({...element,scrollHeight:50000},()=>{},new AbortController().signal),/limit/);
});

test('Excel keeps five columns, merged RFC and chapter cells, full error details and literal spreadsheet content',async()=>{
    const ctx={URL,URLSearchParams,Blob,TextEncoder,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const records=[{order:onlineOrder,wordFilename:onlineOrder+'_方案.docx',items:[{section:'3.4',kind:'text',filename:'3.4-测试.txt',text:'=HYPERLINK("https://example.invalid") <literal>'}],reports:[{section:'3.4',sectionTitle:'Test',kind:'text',filename:'3.4-测试.txt',rule:'Check KPI',status:'fail',summary:'No thresholds'},{section:'3.4',kind:'attachments',filename:'3.4-检查.txt',status:'needs_review',summary:'HTTP 401',diagnostics:{httpStatus:401,response:'Invalid token'}}]}];
    const JSZip=require('../backend/node_modules/jszip');const workbook=await JSZip.loadAsync(await (await ctx.netcareAuditExcel(records)).arrayBuffer()),sheet=await workbook.file('xl/worksheets/sheet1.xml').async('string');
    assert.match(sheet,/mergeCell ref="A2:A3"/);assert.match(sheet,/mergeCell ref="B2:B3"/);assert.match(sheet,/&lt;literal&gt;/);assert.match(sheet,/inlineStr/);assert.ok(!sheet.includes('<f>'));assert.match(sheet,/Invalid token/);
});

test('audit rows provide bilingual reason and localized error text without changing source text',()=>{
    const ctx={URL,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const record={order:'RFC',items:[{section:'3',kind:'text',filename:'source.txt',text:'原文 / Original source = 1/2'}],reports:[{section:'3',kind:'text',filename:'source.txt',summary:'旧摘要 / Legacy summary',summaryI18n:{zh:'缺少指标',en:'Metrics missing'},findingsI18n:[{zh:'补充阈值',en:'Add thresholds'}]}]};
    const zh=ctx.netcareAuditRows([record],'zh')[0],en=ctx.netcareAuditRows([record],'en')[0];assert.equal(zh.summary,'缺少指标 / Metrics missing');assert.equal(en.summary,'缺少指标 / Metrics missing');assert.equal(zh.findings[0],'补充阈值 / Add thresholds');assert.equal(en.findings[0],'补充阈值 / Add thresholds');assert.equal(zh.text,en.text);assert.equal(zh.text,'原文 / Original source = 1/2');
    assert.equal(ctx.netcareAuditLocalized('位置：3.4；缺少阈值 / Location: 3.4; thresholds missing','en'),'Location: 3.4; thresholds missing');assert.equal(ctx.netcareAuditLocalized('缺少阈值 / Thresholds missing','zh'),'缺少阈值');assert.match(ctx.netcareAuditLocalized('旧中文结果','en'),/Run the audit again/);
});

test('screenshots follow actual parent evidence, separate attachments, and exclude ordinary PNG attachments',()=>{
    const ctx={URL,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const record={order:'RFC',materials:[{name:'source.png',section:'3.2',kind:'text',role:'screenshot',sourceFilename:'3.2.txt'},{name:'attach.png',section:'3.2',kind:'attachments',role:'screenshot',sourceFilename:'a.pdf'},{name:'3.2.1-Script-章节原图-001.png',section:'3.2.1'},{name:'diagram.png',section:'3.2',kind:'attachments'},{name:'other.png',section:'3.3',kind:'text',role:'screenshot'}]};
    const text={section:'3.3',kind:'text',sources:[{section:'3.2',kind:'text',filename:'3.2.txt'},{section:'3.2.1',kind:'text',filename:'child.txt'}]},attachment={section:'3.3',kind:'attachments',sources:[{section:'3.2',kind:'attachments',filename:'a.pdf'}]};
    assert.deepEqual(Array.from(ctx.netcareAuditScreenshots(record,text),m=>m.name),['source.png','3.2.1-Script-章节原图-001.png']);assert.deepEqual(Array.from(ctx.netcareAuditScreenshots(record,attachment),m=>m.name),['attach.png']);attachment.sources[0].filename='b.pdf';assert.equal(ctx.netcareAuditScreenshots(record,attachment).length,0);
});

test('Excel embeds source PNGs in evidence rows, preserves grouping and exports English verdicts with bilingual reasons',async()=>{
    const ctx={URL,Blob,TextEncoder,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=','base64'),shot={name:'shot.png',section:'3.2',kind:'text',role:'screenshot',sourceFilename:'source.txt'},report={section:'3.3',kind:'text',filename:'source.txt',sources:[{section:'3.2',kind:'text',filename:'source.txt'}],status:'fail',summaryI18n:{zh:'缺少指标',en:'Metrics missing'},findingsI18n:[{zh:'补充阈值',en:'Add thresholds'}]},record={order:'RFC',materials:[shot],items:[{section:'3.2',kind:'text',filename:'source.txt',text:'original literal'}],reports:[report,{...report,kind:'attachments',sources:undefined,filename:'a.txt',status:'pass'}]},images=new Map([[ctx.netcareAuditImageKey('RFC','shot.png'),new Blob([png])]]),JSZip=require('../backend/node_modules/jszip');
    for(const language of ['zh','en']){const zip=await JSZip.loadAsync(await (await ctx.netcareAuditExcel([record],language,images)).arrayBuffer()),sheet=await zip.file('xl/worksheets/sheet1.xml').async('string'),drawing=await zip.file('xl/drawings/drawing1.xml').async('string');assert.deepEqual(await zip.file('xl/media/image1.png').async('nodebuffer'),png);assert.match(sheet,/mergeCell ref="A2:A4"/);assert.match(sheet,/mergeCell ref="B2:B4"/);assert.match(sheet,/mergeCell ref="D2:D3"/);assert.match(sheet,/<drawing r:id="rId1"/);assert.match(drawing,/<xdr:col>2<\/xdr:col>/);assert.match(drawing,/<xdr:row>2<\/xdr:row>/);assert.match(drawing,/noChangeAspect="1"/);assert.match(sheet,/缺少指标 \/ Metrics missing/);assert.match(sheet,/补充阈值 \/ Add thresholds/);assert.match(sheet,/<t xml:space="preserve">Fail<\/t>/);assert.match(sheet,/<t xml:space="preserve">Pass<\/t>/);assert.doesNotMatch(sheet,/<t xml:space="preserve">(?:通过|不通过|需人工核查)<\/t>/);assert.match(sheet,language==='zh'?/原始区域截图/:/Source screenshot/);assert.match(await zip.file('xl/workbook.xml').async('string'),language==='zh'?/审计结果/:/Audit results/);}
    const missing=await JSZip.loadAsync(await (await ctx.netcareAuditExcel([record],'en')).arrayBuffer());assert.equal(missing.file('xl/drawings/drawing1.xml'),null);assert.match(await missing.file('xl/worksheets/sheet1.xml').async('string'),/Screenshots unavailable/);
    const bundle=await ctx.netcareAuditMaterials([record],[{order:'RFC',name:'shot.png'}],async()=>new Blob([png]),()=>{},'en');const bundled=await JSZip.loadAsync(await (await bundle.entries.find(e=>e.name==='Audit results.xlsx').blob).arrayBuffer());assert.ok(bundled.file('xl/media/image1.png'));
});

test('materials ZIP preserves original Word/attachments in RFC folders and explicitly records missing originals',async()=>{
    const ctx={URL,URLSearchParams,Blob,TextEncoder,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const order=onlineOrder,record={order,wordFilename:order+'_方案.docx',items:[{section:'3.4',kind:'text',filename:'3.4-测试.txt',text:'cached text'}],reports:[{section:'3.4',kind:'text',filename:'3.4-测试.txt',status:'pass',summary:'OK'},{section:'3.4',kind:'attachments',filename:'3.4-附件.docx',status:'needs_review',summary:'TXT only'}]};
    const word=new Blob([new Uint8Array([80,75,0,9])]),attachment=new Blob([new Uint8Array([7,8,9])]);
    const files=[{order,name:record.wordFilename},{order,name:'3.4-附件.docx'}];
    const result=await ctx.netcareAuditMaterials([record],files,async f=>f.name===record.wordFilename?word:attachment);
    assert.equal(result.missing.length,0);assert.equal(result.reconstructed.length,1);
    const JSZip=require('../backend/node_modules/jszip'),zip=await JSZip.loadAsync(await (await ctx.createNetcareZip(result.entries)).arrayBuffer());assert.deepEqual(await zip.file(order+'/'+record.wordFilename).async('uint8array'),new Uint8Array([80,75,0,9]));assert.deepEqual(await zip.file(order+'/3.4-附件.docx').async('uint8array'),new Uint8Array([7,8,9]));assert.match(await zip.file(order+'/3.4-测试.txt').async('string'),/cached text/);assert.ok(zip.file('审计结果.xlsx'));assert.ok(zip.file('文本回填说明.txt'));
    const missing=await ctx.netcareAuditMaterials([record],[],async()=>{throw Error('must not fetch');});assert.equal(missing.missing.length,2);assert.ok(missing.entries.some(e=>e.name==='缺失材料清单.txt'));
});

test('artifact background rejects foreign sites and MAIN uploads before touching file storage',()=>{
    const pkg=packer.buildPackage({...options,manualLaunch:true}),callbacks=[];const ctx={URL,chrome:{runtime:{id:'test',onInstalled:{addListener(){}},onMessage:{addListener:fn=>callbacks.push(fn)}}}};vm.runInNewContext(pkg.files['background.js'],ctx);
    const send=(url,action)=>{let response;callbacks[3]({type:'TP_RFC_ARTIFACT_REQUEST',action,order:onlineOrder,fileId:crypto.randomUUID(),name:'x.docx',size:4},{id:'test',url,frameId:0,tab:{id:1}},r=>response=r);return response;};
    assert.equal(send('https://other.example','read').ok,false);assert.equal(send('https://netcare.huawei.com/p/netcare/index.html','begin').ok,false);assert.equal(send(onlineUrl.replace(onlineOrder,'NC20260903002788'),'read').ok,false);
    assert.ok(pkg.files['netcare-artifact-relay.js']);
});

test('language component renders UI labels without changing raw evidence or filenames', () => {
    const factory = require('../backend/builtin-tools/f12-to-extension/netcare-language');
    const nodes = ['RFC 单号 / RFC numbers', '通过 / Pass', '原文: token=test', '3.4-Test.txt'].map((data, i) => ({ data, get textContent(){return this.data;}, parentElement:{closest(selector){return i===2&&selector.includes('pre')?{}:i===3&&selector==='summary'?{}:null;}} }));
    const root = { ownerDocument:{createTreeWalker(){let i=0;return{nextNode(){return nodes[i++]||null;}};}},querySelectorAll(){return[];} };
    const previous=global.MutationObserver;global.MutationObserver=class{observe(){}disconnect(){}};
    try{const ui=factory(root,'zh');assert.equal(nodes[0].data,'RFC 单号');ui.set('en');assert.equal(nodes[0].data,'RFC numbers');assert.equal(nodes[1].data,'Pass');assert.equal(nodes[2].data,'原文: token=test');assert.equal(nodes[3].data,'3.4-Test.txt');ui.set('zh');assert.equal(nodes[1].data,'通过');ui.stop();}finally{global.MutationObserver=previous;}
});

test('online tab creation sends a second confirmation and accepts a validated online ready signal',async()=>{
    const result=packer.buildPackage({...options,includePopup:true,manualLaunch:true}),callbacks=[],sent=[],runtime={id:'fixture',onMessage:{addListener(f){callbacks.push(f);}},onInstalled:{addListener(){}}};
    const chrome={runtime,storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}},tabs:{create:async()=>({id:31}),sendMessage:async(id,m)=>sent.push({id,m})}};
    vm.runInNewContext(result.files['background.js'],{chrome,URL,AbortController,setTimeout,clearTimeout,fetch:async()=>{},console});
    const url='https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=NC20260906000732&order_id=NC20260906000732';
    let reply;callbacks[0]({type:'TP_RFC_OPEN_ONLINE',id:'open-test',order:'NC20260906000732',url},{tab:{id:10},frameId:0,url:'https://netcare-ae.gts.huawei.com/p/netcare/index.html'},r=>reply=r);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(reply.ok,true);assert.equal(sent[0].id,10);assert.equal(sent[0].m.id,'open-test');
    callbacks[0]({type:'TP_RFC_ONLINE_READY',order:'NC20260906000732'},{id:'fixture',tab:{id:31},frameId:0,url},()=>{});assert.equal(sent.length,2);
    callbacks[0]({type:'TP_RFC_ONLINE_READY',order:'NC20260906000732'},{id:'fixture',tab:{id:31},frameId:0,url:'https://evil.test/'},()=>{});assert.equal(sent.length,2);
});

test('binary cache rejects invalid snapshot and capacity requests before accessing IndexedDB',async()=>{
    const cache=require('../backend/builtin-tools/f12-to-extension/netcare-artifacts')(null);
    await assert.rejects(cache.saveSnapshot([]),/Invalid snapshot/);
    await assert.rejects(cache.saveSnapshot([{order:'bad',reports:[],items:[]}]),/Invalid snapshot/);
    await assert.rejects(cache.configure(10*1024*1024),/safe range/);
    await assert.rejects(cache.cleanup([42]),/Invalid snapshots/);
    await assert.rejects(cache.cleanupMaterials(null),/Invalid cleanup options/);
    await assert.rejects(cache.cleanupMaterials({categories:'invalid'}),/Invalid cleanup options/);
});

test('parent rules cover all descendants with inheritance without changing child drafts', () => {
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),aiAuditEnabled:true,sections:[
        {number:'3',title:'Operations',text:true,textPrompt:'Parent text rule',attachmentsPrompt:'Parent attachment rule'},
        {number:'3.5',title:'Rollback',text:false,textPrompt:'Child draft'},
        {number:'3.5.2',title:'Steps',text:false,attachments:false},
        {number:'30',title:'Other',text:false,attachments:false}
    ]});
    for(const number of ['3.5','3.5.2','3.9.1']){const row=ctx.netcareEffectiveSection(settings,number);assert.equal(row.text,true);assert.equal(row.attachments,true);assert.equal(row.textPrompt,'Parent text rule');assert.equal(row.attachmentsPrompt,'Parent attachment rule');}
    assert.equal(ctx.netcareEffectiveSection(settings,'30').text,false);
    assert.equal(settings.sections[1].textPrompt,'Child draft');
    settings.sections[0].textPrompt='';settings.sections[0].text=false;
    assert.equal(ctx.netcareEffectiveSection(settings,'3.5.2').textPrompt,'Child draft');
    assert.equal(ctx.netcareEffectiveSection(settings,'3.5.2').text,true);
});

test('title fallback applies only after no numbered matches and keeps actual section identity', async () => {
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),aiAuditEnabled:true,titleFallbackEnabled:true,sections:[{number:'3.5',title:'Rollback Steps',textPrompt:'Check rollback',attachmentsPrompt:'Check commands'}]});
    const catalogue=[{number:'8.2',title:'8.2 ROLLBACK: Steps',topic:'a'},{number:'8.2.1',title:'Details',topic:'b'},{number:'8.20',title:'Not related',topic:'c'},{number:'9',title:'Rollback Steps Extra',topic:'d'}];
    const resolved=ctx.netcareResolveTopics(settings,catalogue);assert.deepEqual(Array.from(resolved,t=>t.number),['8.2','8.2.1']);
    assert.equal(ctx.netcareTopicRule(settings,resolved[1],'text').textPrompt,'Check rollback');
    const reports=await ctx.netcareRunAudits([{section:resolved[1].number,ruleSection:'3.5',sectionTitle:'Details',kind:'text',filename:'8.2.1.txt',text:'Actual content'}],settings,async()=>({ok:true,report:{status:'pass',summary:'通过 / Pass',findings:[]}}),new AbortController().signal,()=>{});
    assert.equal(reports[0].section,'3.5');assert.equal(reports[0].sectionTitle,'Rollback Steps');assert.equal(reports[0].sources[0].section,'8.2.1');assert.equal(reports[0].rule,'Check rollback');
    assert.equal(ctx.netcareResolveTopics({...settings,titleFallbackEnabled:false},catalogue).length,0);
    assert.deepEqual(Array.from(ctx.netcareResolveTopics(settings,[...catalogue,{number:'3.5.1',title:'Numbered child',topic:'e'}]),t=>t.number),['3.5.1']);
    const saved=ctx.netcareImportSettings(ctx.netcareExportSettings({...settings,closeAfterAudit:true}));assert.equal(saved.closeAfterAudit,true);assert.equal(saved.titleFallbackEnabled,true);
});

test('automatic close requires owned tab, enabled audit, saved results and unchanged URL across worker restarts', async()=>{
    const pkg=packer.buildPackage({...options,manualLaunch:true}),stored={},removed=[];
    const chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onMessage:{addListener(){}}},storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,stored[k]])),set:async d=>Object.assign(stored,d),remove:async key=>{delete stored[key];}}},tabs:{create:async()=>({id:456}),get:async()=>({url:onlineUrl}),remove:async id=>removed.push(id),sendMessage:async()=>{}}};
    const start=()=>{const listeners=[];chrome.runtime.onMessage.addListener=fn=>listeners.push(fn);vm.runInNewContext(pkg.files['background.js'],{URL,chrome});return listeners[0];};
    let listener=start();await new Promise(reply=>listener({type:'TP_RFC_OPEN_ONLINE',order:onlineOrder,url:onlineUrl},onlineSender,reply));assert.equal(stored['netcareOwnedTab:456'].order,onlineOrder);
    listener=start(); // Durable ownership survives service worker restart.
    const sender={id:'test',tab:{id:456},frameId:0,url:onlineUrl};
    const close=(s=sender)=>new Promise(reply=>listener({type:'TP_RFC_CLOSE_AFTER_AUDIT',order:onlineOrder},s,reply));
    assert.equal((await close()).ok,false);
    stored.netcareExtractionSettings={closeAfterAudit:true,aiAuditEnabled:true};
    stored.netcareAuditSummaries=[{order:onlineOrder,at:new Date().toISOString(),reports:[{status:'pass',summary:'通过 / Pass'}]}];
    assert.equal((await close({...sender,tab:{id:999}})).ok,false);
    assert.equal((await close({...sender,url:'https://evil.example/'})).ok,false);
    chrome.tabs.get=async()=>({url:onlineUrl+'#navigated'});assert.equal((await close()).ok,false);
    chrome.tabs.get=async()=>({url:onlineUrl});stored.netcareAuditSummaries[0].reports[0].error=true;const blocked=await close();assert.equal(blocked.ok,false);assert.match(blocked.error,/Missing audit evidence/);
    stored.netcareAuditSummaries[0].reports[0].error=false;assert.equal((await close()).ok,true);assert.deepEqual(removed,[456]);assert.equal(stored['netcareOwnedTab:456'],undefined);
});

test('selected parent prevents inherited children from falling back outside its actual subtree', ()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),textEnabled:true,attachmentsEnabled:true,titleFallbackEnabled:true,sections:[
        {number:'3.3',title:'Operation Steps for Change',text:true,attachments:true},
        {number:'3.3.1',title:'Operation Scripts'},
        {number:'3.4',title:'Test and Verification',textPrompt:'Check KPI'}
    ]});
    const catalogue=[{number:'3.2',title:'Operation Steps for Change'},{number:'3.2.1',title:'Operation Scripts'},{number:'3.3',title:'Test and Verification'},{number:'3.4',title:'Solution for Changeback In the Case of Failure'},{number:'3.4.1',title:'Definition of Change Failure'}];
    const exact=ctx.netcareResolveTopics({...settings,titleFallbackEnabled:false},catalogue);
    assert.deepEqual(Array.from(exact,t=>t.number),['3.3','3.4','3.4.1']);
    const resolved=ctx.netcareResolveTopics(settings,[{number:'3',title:'Operation Steps for Change'},...catalogue]);
    assert.deepEqual(Array.from(resolved,t=>t.number),['3.2','3.2.1','3.3']);
    assert.equal(ctx.netcareSectionFolder(settings,resolved[0],'text'),'3.3-Operation Steps for Change');
    assert.equal(ctx.netcareTopicRule(settings,resolved[2],'text').textPrompt,'Check KPI');
    assert.equal(ctx.netcareTopicRule(settings,resolved[2],'attachments').attachments,undefined);
    const correction=resolved[2].correctionsByKind.text[0];
    assert.equal(correction.fromNumber,'3.4');assert.equal(correction.fromTitle,'Solution for Changeback In the Case of Failure');
    assert.equal(correction.toNumber,'3.3');assert.equal(correction.toTitle,'Test and Verification');
    assert.equal(resolved[1].correctionsByKind.text[0].toNumber,'3.2'); // Descendants keep the corrected parent, not independent global matches.
    const moved=ctx.netcareResolveTopics({...settings,sections:settings.sections.slice(0,2)},[{number:'8',title:'Operation Steps for Change'},{number:'8.1',title:'Actual child'},{number:'9.1',title:'Operation Scripts'}]);
    assert.deepEqual(Array.from(moved,t=>t.number),['8','8.1']);
    const independent=ctx.netcareResolveTopics({...settings,sections:settings.sections.slice(1,2).map(r=>({...r,text:true}))},catalogue);
    assert.deepEqual(Array.from(independent,t=>t.number),['3.2.1']); // Independently selected children still support global fallback.
});

test('automatic close explains missing evidence without confusing verdicts with execution errors', ()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const completed={settings:{aiAuditEnabled:true},reports:[{status:'fail'},{status:'needs_review'}],failed:0,cached:true,published:true,aborted:false};
    assert.equal(ctx.netcareAutoCloseReason(completed),'');
    assert.match(ctx.netcareAutoCloseReason({...completed,reports:[{section:'3.4',status:'needs_review',error:true,summary:'未提取到附件 / Missing evidence'}]}),/3.4.*Missing evidence/);
    assert.match(ctx.netcareAutoCloseReason({...completed,failed:1}),/extraction or cache errors/);
    assert.match(ctx.netcareAutoCloseReason({...completed,published:false}),/saving was not confirmed/);
    assert.match(ctx.netcareAutoCloseReason({...completed,aborted:true}),/Task stopped/);
});

test('title correction rejects unresolved or ambiguous titles and accepts normalized exact titles', ()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings={textEnabled:true,titleFallbackEnabled:true,sections:[{number:'3.4',title:'Test and Verification',text:true}]};
    const normalized=ctx.netcareResolveTopics(settings,[{number:'3.4',title:'3.4 TEST: and Verification'}]);
    assert.equal(normalized.length,1);assert.equal(normalized[0].correctionsByKind.text.length,0);
    const ambiguous=ctx.netcareResolveTopics(settings,[{number:'3.4',title:'Rollback'},{number:'3.3',title:'Test and Verification'},{number:'3.5',title:'Test and Verification'}]);
    assert.equal(ambiguous.length,0);assert.match(ambiguous.resolutionIssues[0].error,/Multiple matching/);
    const absent=ctx.netcareResolveTopics(settings,[{number:'3.4',title:'Rollback'},{number:'3.4.1',title:'Rollback child'}]);
    assert.equal(absent.length,0);assert.match(absent.resolutionIssues[0].error,/not found/);
});

test('corrected parent reports and Excel retain before and after section names', async()=>{
    const ctx={URL,URLSearchParams,Blob,TextEncoder,Uint8Array,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const correction={ruleNumber:'3.4',ruleTitle:'Test and Verification',fromNumber:'3.4',fromTitle:'Rollback',toNumber:'3.3',toTitle:'Test and Verification',reason:'title_mismatch'};
    const settings={aiAuditEnabled:true,sections:[{number:'3.4',title:'Test and Verification',textPrompt:'Check KPI'}]};
    const items=[{section:'3.3',ruleSection:'3.4',kind:'text',filename:'3.3.txt',text:'Evidence',corrections:[correction]},{section:'3.3.1',ruleSection:'3.4',kind:'text',filename:'3.3.1.txt',text:'Child evidence',corrections:[correction]}];
    const reports=await ctx.netcareRunAudits(items,settings,async()=>({ok:true,report:{status:'fail',summary:'KPI missing',findings:[]}}),new AbortController().signal,()=>{});
    assert.equal(reports.length,1);assert.equal(reports[0].section,'3.4');assert.equal(reports[0].corrections.length,1);assert.equal(reports[0].sources[0].section,'3.3');
    assert.match(ctx.netcareAuditSectionText(reports[0]),/3.4 Rollback[\s\S]*→[\s\S]*3.3 Test and Verification/);
    const JSZip=require('../backend/node_modules/jszip'),zip=await JSZip.loadAsync(await (await ctx.netcareAuditExcel([{order:'RFC',items,reports}])).arrayBuffer());
    const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.match(xml,/3.4 Rollback/);assert.match(xml,/3.3 Test and Verification/);assert.match(xml,/→/);
});

test('AI requires concise bilingual output and rejects monolingual responses', async()=>{
    const pkg=packer.buildPackage({...options,manualLaunch:true}),listeners=[],requests=[];
    const stored={netcareAiModels:[{id:'one',url:'https://model.example/v1',model:'mock',key:'key',protocol:'openai'}],netcareAiSelectedModel:'one',netcareExtractionSettings:{aiAuditEnabled:true,titleFallbackEnabled:true,sections:[{number:'3',textPrompt:'Parent rule'}]}};
    let answer={status:'fail',summary:{zh:'缺少回退步骤',en:'Rollback steps missing'},findings:[{zh:'未说明回退命令',en:'Specify rollback commands'}]};
    const ctx={URL,AbortController,TextDecoder,setTimeout,clearTimeout,chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onMessage:{addListener:fn=>listeners.push(fn)}},storage:{local:{get:async()=>stored}}},fetch:async(url,r)=>{requests.push(r);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}),{status:200});}};
    vm.runInNewContext(pkg.files['background.js'],ctx);
    const send=(section='3.5',ruleSection)=>new Promise(reply=>listeners[1]({type:'TP_RFC_AI_AUDIT',id:crypto.randomUUID(),order:onlineOrder,section,ruleSection,kind:'text',text:'Evidence'}, {id:'test',tab:{id:1},frameId:0,url:onlineUrl},reply));
    const result=await send();assert.equal(result.ok,true);assert.equal(result.report.summary,'缺少回退步骤 / Rollback steps missing');assert.match(requests[0].body,/BOTH Chinese/);assert.match(requests[0].body,/at most 5/);assert.match(requests[0].body,/Parent rule/);
    assert.equal(result.report.status,'fail');assert.equal(result.report.summaryI18n.zh,'缺少回退步骤');assert.equal(result.report.summaryI18n.en,'Rollback steps missing');
    const prompt=JSON.parse(requests[0].body).messages.map(m=>m.content).join('\n');
    assert.match(prompt,/pass only when all applicable requirements/);
    assert.match(prompt,/fail when at least one applicable requirement is demonstrably violated/);
    assert.match(prompt,/required content absent from successfully extracted material/);
    assert.match(prompt,/needs_review only when no violation is established/);
    assert.match(prompt,/A confirmed violation takes precedence/);
    assert.match(prompt,/do not invent KPI or test-case requirements/);
    assert.doesNotMatch(prompt,/If evidence is incomplete or unclear use needs_review/);
    for(const status of ['pass','needs_review']){answer={status,summary:{zh:status==='pass'?'满足要求':'源材料无法读取',en:status==='pass'?'Requirements met':'Source unavailable'},findings:[]};assert.equal((await send()).report.status,status);}
    assert.equal((await send('8.2','3')).ok,true);
    stored.netcareExtractionSettings.titleFallbackEnabled=false;assert.equal((await send('8.2','3')).ok,false);
    answer={status:'pass',summary:'English only',findings:[]};assert.equal((await send()).ok,false);
});

test('selected parent audits all text descendants together and groups attachment checks separately', async()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),aiAuditEnabled:true,sections:[{number:'3',title:'Operations',text:true,attachments:true,textPrompt:'Evaluate complete plan',attachmentsPrompt:'Evaluate scripts'},{number:'3.1',title:'Overview'},{number:'3.1.1',title:'Steps',textPrompt:'Hidden child draft'}]});
    const items=[{section:'3',kind:'text',filename:'3.txt',text:'Purpose'},{section:'3.1',kind:'text',filename:'3.1.txt',text:'Preparation'},{section:'3.1.1',kind:'text',filename:'3.1.1.txt',text:'Rollback'},{section:'3.1.1',kind:'attachments',filename:'commands.txt',text:'Commands'}],sent=[];
    const reports=await ctx.netcareRunAudits(items,settings,async item=>{sent.push(item);return{ok:true,report:{status:'pass',summary:'通过 / Pass',findings:[]}};},new AbortController().signal,()=>{});
    assert.equal(sent.length,2);assert.equal(sent[0].kind,'text');assert.equal(sent[1].kind,'attachments');assert.deepEqual(Array.from(reports,r=>r.section),['3','3']);assert.equal(reports[0].sources.length,3);assert.match(sent[0].text,/Purpose/);assert.match(sent[0].text,/Preparation/);assert.match(sent[0].text,/Rollback/);assert.match(sent[0].text,/3.1.1/);assert.equal(reports[0].rule,'Evaluate complete plan');
    const invertedSent=[];
    await ctx.netcareRunAudits([items[3],items[0]],settings,async item=>{invertedSent.push(item);return{ok:true,report:{status:'pass',summary:'通过 / Pass',findings:[]}};},new AbortController().signal,()=>{});
    assert.equal(invertedSent.length,2);assert.equal(invertedSent[0].kind,'text');assert.equal(invertedSent[1].kind,'attachments');
    const rows=ctx.netcareAuditRows([{order:'RFC',items,reports}]);assert.equal(rows.length,2);assert.match(rows[0].text,/Preparation/);assert.match(rows[0].text,/Rollback/);
    const failed=await ctx.netcareRunAudits(items,settings,async()=>{throw Error('HTTP 500');},new AbortController().signal,()=>{});assert.ok(failed.every(r=>r.error&&r.status==='needs_review'));
});

test('parent selection gathers distinct descendant rules and cannot silently pass oversized aggregate evidence', async()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),aiAuditEnabled:true,sections:[{number:'3',title:'Operations',text:true},{number:'3.1',title:'Preparation',textPrompt:'Check preparation'},{number:'3.2',title:'Rollback',textPrompt:'Check rollback'}]});
    assert.match(ctx.netcareAuditRule(settings,'3','text'),/3.1: Check preparation/);assert.match(ctx.netcareAuditRule(settings,'3','text'),/3.2: Check rollback/);
    const items=[{section:'3.1',kind:'text',filename:'one.txt',text:'x'.repeat(31000)},{section:'3.2',kind:'text',filename:'two.txt',text:'y'.repeat(31000)}];let calls=0;
    const reports=await ctx.netcareRunAudits(items,settings,async()=>{calls++;return{ok:true,report:{status:'pass'}};},new AbortController().signal,()=>{});
    assert.equal(calls,0);assert.equal(reports.length,1);assert.equal(reports[0].status,'needs_review');assert.match(reports[0].summary,/60000/);
});

test('parent audit material export retains individual source files rather than looking for a synthetic summary filename',async()=>{
    const ctx={URL,URLSearchParams,Blob,TextEncoder,Uint8Array,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const record={order:'RFC',wordFilename:'Plan.docx',items:[{section:'3.1',kind:'text',filename:'3.1.txt',text:'Preparation'},{section:'3.2',kind:'text',filename:'3.2.txt',text:'Rollback'}],reports:[{section:'3',sectionTitle:'Operations',kind:'text',filename:'3 · summary',status:'pass',summary:'OK',sources:[{section:'3.1',kind:'text',filename:'3.1.txt'},{section:'3.2',kind:'text',filename:'3.2.txt'}]}]};
    const bundle=await ctx.netcareAuditMaterials([record],[{order:'RFC',name:'Plan.docx'},{order:'RFC',name:'3.1.txt'}],async()=>new Blob(['bytes']));
    assert.equal(bundle.missing.length,0);assert.ok(bundle.entries.some(e=>e.name==='RFC/3.1.txt'));assert.ok(bundle.entries.some(e=>e.name==='RFC/3.2.txt'));assert.ok(!bundle.entries.some(e=>e.name.includes('summary')));
});

test('automatic extraction defers standalone Word saving after a successful cache commit',async()=>{
    const h=workerHarness();let cached=false;h.context.netcareStoreArtifact=async()=>{cached=true;};
    h.receive({type:'run',job:'bundle',order:'NC20261001000381',bundleOnly:true});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(cached,true);assert.equal(h.saved.length,0);assert.ok(h.messages.some(({message:m})=>m.type==='done'&&m.filename.endsWith('.docx')&&m.text.includes('combined ZIP')));
});

test('chapter folder paths use the selected parent for fallback descendants',()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),sections:[{number:'3',title:'Operations',text:true},{number:'3.1',title:'Steps'}]});
    assert.equal(ctx.netcareSectionFolder(settings,{number:'8.1',title:'Actual child',ruleNumbers:['3']},'text'),'3-Operations');
    assert.equal(ctx.netcareSectionFolder(settings,{number:'3.1',title:'Steps'},'text'),'3-Operations');
});

test('current audit batch excludes previous RFCs and stale results for a repeated RFC',()=>{
    const pkg=packer.buildPackage({...options,manualLaunch:true}),ctx={URL,chrome:{runtime:{onInstalled:{addListener(){}},onMessage:{addListener(){}}}}};vm.runInNewContext(pkg.files['background.js'],ctx);
    const started=Date.now()-1000,records=[{order:onlineOrder,at:new Date().toISOString(),generationAt:started+1},{order:'NC20260903002788',at:new Date().toISOString(),generationAt:started+2},{order:onlineOrder,at:new Date(started-1000).toISOString(),generationAt:started-1}];
    const filtered=ctx.netcareBatchRecords(records,{orders:[onlineOrder],started});assert.equal(filtered.length,1);assert.equal(filtered[0].generationAt,started+1);assert.equal(ctx.netcareBatchRecords(records).length,3);
});

test('new chapter numbering respects parent level, existing descendants and large section numbers',()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const rows=[{number:'1'},{number:'1.2'},{number:'1.2.1'},{number:'1.2.3.1'},{number:'2'},{number:'10'}];
    assert.equal(ctx.netcareNextSectionNumber(rows),'11');assert.equal(ctx.netcareNextSectionNumber(rows,'1'),'1.3');assert.equal(ctx.netcareNextSectionNumber(rows,'1.2'),'1.2.4');assert.equal(ctx.netcareNextSectionNumber(rows,'2'),'2.1');
    const huge='99999999999999999999999';assert.equal(ctx.netcareNextSectionNumber([{number:huge}]),'100000000000000000000000');
    const sorted=['3.10','3.2.1','3.2','4','3'].sort(ctx.netcareCompareSectionNumbers);assert.deepEqual(sorted,['3','3.2','3.2.1','3.10','4']);
});

test('packaged canvas cloning reads optimized disposable canvas and clears tainted copies',()=>{
    const pkg=packer.buildPackage({...options,manualLaunch:true}),source=pkg.files['netcare-renderer.js'];
    const start=source.indexOf('fn.prototype.createCanvasClone=function'),end=source.indexOf('fn.prototype.createVideoClone=function',start);
    const cloneCode=source.slice(start,end).replace(/^fn.prototype.createCanvasClone=/,'').replace(/,$/,'');
    const clone=vm.runInNewContext('('+cloneCode+')',{});let sourceReads=0,copied=0,contextSettings;
    const sourceCanvas={width:2,height:2,cloneNode(){return target;},getContext(type){return type==='2d'?{getImageData(){sourceReads++;throw Error('Site canvas must not be read');}}:null;}};
    const target={width:0,height:0,getContext(type,settings){contextSettings=settings;return {drawImage(){copied++;},getImageData(){return new Uint8Array(4);}};}};
    const receiver={options:{inlineImages:false,allowTaint:false},context:{logger:{info(){},warn(){}}}};
    assert.equal(clone.call(receiver,sourceCanvas),target);assert.equal(sourceReads,0);assert.equal(copied,1);assert.equal(contextSettings.willReadFrequently,true);
    let cleared=0;Object.defineProperty(target,'width',{get(){return 2;},set(){cleared++;}});target.getContext=()=>({drawImage(){},getImageData(){throw Error('Tainted canvas');}});
    assert.equal(clone.call(receiver,sourceCanvas),target);assert.equal(cleared,2);assert.equal(sourceReads,0);
});


test('plugin logs redact credentials and URL query strings while retaining useful rules and decisions', () => {
    const cache=require('../backend/builtin-tools/f12-to-extension/netcare-artifacts')(null);
    const entry=cache.sanitizeLog({order:onlineOrder,action:'model.result',category:'audit',level:'warn',generationAt:123,batchId:100,message:'Decision',data:{key:'hidden-api-key',password:'hidden-password',headers:{Authorization:'hidden-auth'},keyConfigured:true,rule:'Check KPI',status:'fail',endpoint:'https://user:password@models.example/api?api_key=hidden-query#hidden-hash',error:'Request https://models.example/path?token=hidden-token failed; Authorization: Bearer hidden-bearer',preview:'password=hidden-preview; api_key=hidden-preview-key',deep:{cookie:'hidden-cookie',value:'safe'}}});
    const serialized=JSON.stringify(entry);assert.ok(!serialized.includes('hidden-'));assert.equal(entry.data.keyConfigured,true);assert.equal(entry.data.rule,'Check KPI');assert.equal(entry.data.status,'fail');assert.equal(entry.generationAt,123);assert.equal(entry.data.endpoint,'https://models.example/api');assert.equal(entry.data.deep.value,'safe');assert.match(entry.data.preview,/REDACTED/);
    assert.throws(()=>cache.sanitizeLog({action:'bad',order:'OTHER'}),/Invalid log/);
    assert.equal(cache.valid({id:'00000000-0000-0000-0000-000000000000',order:onlineOrder,name:'audit.zip',role:'audit-bundle',size:150*1048576}),true);
    assert.equal(cache.valid({id:'00000000-0000-0000-0000-000000000000',order:onlineOrder,name:'file.bin',size:150*1048576}),false);
});

test('log queries combine RFC, category, level, time, generation and keyword filters before paging',()=>{
    const cache=require('../backend/builtin-tools/f12-to-extension/netcare-artifacts')(null);
    const entries=[{id:'a',at:20,order:onlineOrder,generationAt:10,category:'audit',level:'warn',data:{status:'fail'}},{id:'b',at:30,order:onlineOrder,generationAt:10,category:'audit',level:'info',data:{status:'pass'}},{id:'c',at:40,order:'NC20261005000019',generationAt:35,category:'storage',level:'info',data:{name:'audit.zip'}}];
    assert.deepEqual(cache.filterLogs(entries,{order:'00263',category:'audit',level:'warn',from:15,to:25,generationAt:10,search:'FAIL'}).map(e=>e.id),['a']);
    assert.deepEqual(cache.filterLogs(entries,{}).map(e=>e.id),['c','b','a']);
});

test('native browser prompts are absent from the complete NetCare package and packaging controls',()=>{
    const pack=packer.buildPackage({...options,manualLaunch:true,includePopup:true});
    for(const [name,source] of Object.entries(pack.files).filter(([n])=>n.endsWith('.js')&&!n.includes('renderer'))){assert.doesNotMatch(source,/\b(?:alert|confirm|prompt)\s*\(/,name);assert.doesNotThrow(()=>new vm.Script(source,{filename:name}));}
    const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');assert.doesNotMatch(html,/\b(?:alert|confirm|prompt)\s*\(/);for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new vm.Script(match[1]));
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);assert.equal(ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),concurrency:10}).concurrency,10);
});


test('background accepts extension configuration logs but rejects foreign origins, RFCs and log queries',async()=>{
    const pkg=packer.buildPackage({...options,manualLaunch:true}),callbacks=[],calls=[];
    const ctx={URL,chrome:{runtime:{id:'test',onInstalled:{addListener(){}},onMessage:{addListener:fn=>callbacks.push(fn)}}}};vm.runInNewContext(pkg.files['background.js'],ctx);
    ctx.tpNetcareArtifactCache.log=async(event,snapshotId)=>{calls.push({event,snapshotId});return 'logged';};
    ctx.tpNetcareArtifactCache.queryLogs=async filter=>{calls.push({filter});return {entries:[],total:0};};
    const send=async(message,sender)=>{let reply;callbacks[3]({type:'TP_RFC_ARTIFACT_REQUEST',order:onlineOrder,...message},{id:'test',frameId:0,...sender},r=>reply=r);await new Promise(r=>setImmediate(r));return reply;};
    assert.equal((await send({action:'log',event:{action:'ui.change'},snapshotId:'snapshot'}, {url:'chrome-extension://test/netcare-ai.html'})).ok,true);assert.equal(calls[0].snapshotId,'snapshot');
    assert.equal((await send({action:'log',event:{action:'ui.click'}},{url:'chrome-extension://foreign/netcare-ai.html'})).ok,false);
    assert.equal((await send({action:'log',event:{action:'audit',order:'NC20261005000019'}},{url:onlineUrl,tab:{id:1}})).ok,false);
    assert.equal((await send({action:'log',event:{action:'audit',order:onlineOrder},snapshotId:'snapshot'},{url:onlineUrl,tab:{id:1}})).ok,false);
    assert.equal((await send({action:'query-logs'},{url:'chrome-extension://test/netcare-ai.html'})).ok,false);
    assert.equal((await send({action:'query-logs',filter:{category:'audit'}},{url:'https://netcare.huawei.com/p/netcare/index.html',tab:{id:1}})).ok,true);
    assert.equal(calls.length,2);
});


test('snapshot material export includes the unchanged final audit ZIP along with original materials',async()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{},Blob,Uint8Array,Uint32Array,DataView,TextEncoder};vm.runInNewContext(code,ctx);
    const record={order:onlineOrder,items:[],reports:[],materials:[],wordFilename:'Original.docx',bundleFilename:'completed-audit.zip'},bytes=new Uint8Array([80,75,5,6,1,2,3,4]),files=[{order:onlineOrder,name:record.bundleFilename,role:'audit-bundle'},{order:onlineOrder,name:record.wordFilename}];
    const materials=await ctx.netcareAuditMaterials([record],files,async()=>new Blob([bytes]));assert.equal(materials.missing.length,0);const original=materials.entries.find(e=>e.name===onlineOrder+'/'+record.bundleFilename);assert.equal(original.role,'audit-bundle');assert.deepEqual(new Uint8Array(await original.blob.arrayBuffer()),bytes);
    const missing=await ctx.netcareAuditMaterials([record],[],async()=>{throw Error('must not fetch');});assert.ok(missing.missing.some(e=>e.includes('completed-audit.zip')));
});

test('company HTTP endpoints work for both connection tests and saved audits without changing request isolation',async()=>{
 const pkg=packer.buildPackage({...options,manualLaunch:true}),callbacks=[],requests=[];
 const model={id:'saved',protocol:'anthropic',authMode:'api-key',url:'http://7.213.46.213:3155',model:'test-model',key:'dummy-test-key'};
 const stored={netcareAiModels:[model],netcareAiSelectedModel:'saved',netcareExtractionSettings:{aiAuditEnabled:true,sections:[{number:'3.4',textPrompt:'Check cases'}]}};
 const ctx={URL,AbortController,TextDecoder,setTimeout,clearTimeout,chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onInstalled:{addListener(){}},onMessage:{addListener:fn=>callbacks.push(fn)}},storage:{local:{get:async()=>stored}}},fetch:async(url,request)=>{requests.push({url,request});return new Response(JSON.stringify({content:[{type:'text',text:requests.length===1?'OK':JSON.stringify({status:'fail',summary:{zh:'缺少测试用例',en:'Test cases missing'},findings:[]})}]}));}};
 vm.runInNewContext(pkg.files['background.js'],ctx);
 const send=(type,sender,data)=>new Promise(reply=>callbacks[1]({type,id:crypto.randomUUID(),...data},sender,reply));
 assert.equal((await send('TP_RFC_AI_TEST',{id:'test',url:'chrome-extension://test/netcare-ai.html',frameId:1},{model})).ok,true);
 const audited=await send('TP_RFC_AI_AUDIT',{id:'test',url:onlineUrl,frameId:0,tab:{id:1}},{order:onlineOrder,section:'3.4',kind:'text',text:'Only generic commands'});
 assert.equal(audited.ok,true);assert.equal(audited.report.status,'fail');assert.equal(requests.length,2);
 for(const {url,request}of requests){assert.equal(url,'http://7.213.46.213:3155/v1/messages');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');assert.equal(request.headers['x-api-key'],'dummy-test-key');assert.equal(request.headers['anthropic-version'],'2023-06-01');}
 for(const url of ['ftp://example.com','http://user:pass@example.com','http://example.com?token=x','http://example.com#part']){ctx.model={...model,url};assert.throws(()=>vm.runInNewContext('tpBuildModelRequest(model,"test")',ctx),/endpoint/);}
 assert.ok(pkg.manifest.host_permissions.includes('http://*/*'));
});

test('local audit rules default preset, validation, and regex evaluation', () => {
  const ctx = { URL, URLSearchParams, location: new URL('https://unrelated.example'), window: {} }; vm.runInNewContext(code, ctx);
  const defaults = ctx.netcareDefaultLocalRules();
  assert.ok(Array.isArray(defaults) && defaults.length >= 6);
  assert.ok(defaults.some(r => r.sectionNumber === '1.1' && r.pattern.includes('变更目的')));
  assert.ok(defaults.some(r => r.sectionNumber === '3.5' && r.pattern.includes('回退')));

  const settings = ctx.netcareDefaultSettings();
  const normalized = ctx.netcareNormalizeSettings(settings);
  assert.equal(normalized.localRules.length, defaults.length);
  assert.equal(normalized.localRules[0].passCondition, 'match');

  // Regex validation check
  assert.throws(() => ctx.netcareNormalizeSettings({
    ...settings,
    localRules: [{ id: 'bad', name: 'Bad Regex', pattern: '([a-z' }]
  }), /正则表达式无效/);

  // Engine evaluation
  const passItem = { section: '1.1', kind: 'text', text: '本次变更目的为升级交换机核心固件，影响范围已评估。' };
  const passResult = ctx.netcareEvaluateLocalRule(normalized, passItem);
  assert.ok(passResult);
  assert.equal(passResult.status, 'pass');
  assert.ok(passResult.summary.includes('[本地规则回退]'));
  assert.equal(passResult.fallback, true);

  const failItem = { section: '1.1', kind: 'text', text: '完全无关的文本内容，没有任何背景。' };
  const failResult = ctx.netcareEvaluateLocalRule(normalized, failItem);
  assert.ok(failResult);
  assert.equal(failResult.status, 'fail');
  assert.ok(failResult.findings.length > 0);

  // Blacklist condition
  const customRuleSettings = {
    ...normalized,
    localRules: [{ id: 'custom-blacklist', name: '禁含未授权', sectionNumber: '3.3', pattern: '未授权|风险未闭环', passCondition: 'not_match', passSummary: '无敏感项', failSummary: '发现未授权操作', enabled: true }]
  };
  const blacklistedItem = { section: '3.3', kind: 'text', text: '配置脚本包含未授权变更命令。' };
  const blacklistResult = ctx.netcareEvaluateLocalRule(customRuleSettings, blacklistedItem);
  assert.equal(blacklistResult.status, 'fail');
  assert.ok(blacklistResult.summary.includes('发现未授权操作'));
});

test('AI error automatically falls back to local rules in netcareRunAudits', async () => {
  const ctx = { URL, URLSearchParams, location: new URL('https://unrelated.example'), window: {} }; vm.runInNewContext(code, ctx);
  const settings = ctx.netcareNormalizeSettings({
    ...ctx.netcareDefaultSettings(),
    aiAuditEnabled: true,
    sections: [{ number: '1.1', title: 'Change Purpose', text: true, textPrompt: 'Check purpose' }]
  });

  const items = [{ section: '1.1', sectionTitle: 'Change Purpose', kind: 'text', filename: '1.1.txt', text: '变更目的：系统优化升级，影响范围：核心网' }];

  // Simulate AI request failure (e.g. 500 error / network failure)
  const failedRequest = async () => { throw new Error('AI Model Service 503 Unavailable'); };
  const reports = await ctx.netcareRunAudits(items, settings, failedRequest, new AbortController().signal, () => {});

  assert.equal(reports.length, 1);
  const r = reports[0];
  assert.equal(r.status, 'pass');
  assert.equal(r.fallback, true);
  assert.equal(r.model, 'local-rule-fallback');
  assert.ok(r.diagnostics.fallback);
  assert.equal(r.diagnostics.aiError, 'AI Model Service 503 Unavailable');
});

test('settings relay persists localRules and restores them', async () => {
  const pack = packer.buildPackage({ ...options, manualLaunch: true }), stored = {}, messages = [];
  let receive;
  const window = { addEventListener: (_t, fn) => { receive = fn; }, removeEventListener() {}, postMessage: m => messages.push(m) }; window.top = window;
  const origin = 'https://netcare-de.gts.huawei.com';
  vm.runInNewContext(pack.files['netcare-online-relay.js'], { window, location: {origin}, chrome: { storage: { local: { set: async data => Object.assign(stored, data), get: async key => ({ [key]: stored[key] }) } } } });

  const customRules = [{ id: 'r1', name: '自定义规则 1', sectionNumber: '1.1', pattern: '目的', passCondition: 'match', enabled: true }];
  const value = { concurrency: 2, openOnline: false, attachmentsEnabled: true, textEnabled: true, intervalMs: 2000, sections: [{ number: '1.1', title: 'Purpose', attachments: true, text: true }], localRules: customRules };

  receive({ source: window, origin, data: { source: 'TP_RFC_SETTINGS_SET', settings: value } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stored.netcareExtractionSettings.localRules.length, 1);
  assert.equal(stored.netcareExtractionSettings.localRules[0].name, '自定义规则 1');

  receive({ source: window, origin, data: { source: 'TP_RFC_SETTINGS_GET' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).settings.localRules[0].id, 'r1');
});

test('materials ZIP creates 方案截图, 方案文本 and 方案附件 subfolders within chapter folders', async () => {
  const ctx = { URL, URLSearchParams, Blob, TextEncoder, Uint8Array, location: new URL('https://unrelated.example'), window: {} }; vm.runInNewContext(code, ctx);
  const record = {
    order: 'NC20261001000381',
    wordFilename: 'Plan.docx',
    items: [
      { section: '3.1', kind: 'text', filename: '3.1.txt', text: 'Preparation details' },
      { section: '3.2', kind: 'attachments', filename: '3.2-config.txt', text: 'interfaces' }
    ],
    reports: [
      { section: '3.1', kind: 'text', filename: '3.1.txt', status: 'pass', summary: 'OK' },
      { section: '3.2', kind: 'attachments', filename: '3.2-config.txt', status: 'pass', summary: 'OK' }
    ],
    materials: [
      { name: '3.1.txt', section: '3.1', kind: 'text', role: 'text', folder: '3-Operations' },
      { name: '3.2-config.txt', section: '3.2', kind: 'attachments', role: 'attachment', folder: '3-Operations' },
      { name: '3.1-shot.png', section: '3.1', kind: 'text', role: 'screenshot', folder: '3-Operations' }
    ]
  };

  const files = [
    { order: 'NC20261001000381', name: 'Plan.docx' },
    { order: 'NC20261001000381', name: '3.1.txt' },
    { order: 'NC20261001000381', name: '3.2-config.txt' },
    { order: 'NC20261001000381', name: '3.1-shot.png' }
  ];

  const bundle = await ctx.netcareAuditMaterials([record], files, async () => new Blob(['content']));
  assert.equal(bundle.missing.length, 0);

  const entryNames = bundle.entries.map(e => e.name);
  assert.ok(entryNames.includes('NC20261001000381/3-Operations/方案文本/3.1.txt'));
  assert.ok(entryNames.includes('NC20261001000381/3-Operations/方案附件/3.2-config.txt'));
  assert.ok(entryNames.includes('NC20261001000381/3-Operations/方案截图/3.1-shot.png'));
});

test('cache stats provides classified breakdown and cleanupMaterials prunes by category and retention', async () => {
  const storeData = {
    files: new Map([
      ['f1', { id: 'f1', order: 'NC20261001000381', name: '1.1-shot.png', role: 'screenshot', size: 1000, count: 1, ready: true, created: Date.now() - 1000 }],
      ['f2', { id: 'f2', order: 'NC20261001000381', name: 'data.xlsx', role: 'attachments', size: 2000, count: 1, ready: true, created: Date.now() - 100000000 }],
      ['f3', { id: 'f3', order: 'NC20261001000381', name: '1.1-content.txt', role: 'text', size: 500, count: 1, ready: true, created: Date.now() - 1000 }],
      ['f4', { id: 'f4', order: 'NC20261001000381', name: 'NC20261001000381-bundle.zip', role: 'audit-bundle', size: 5000, count: 1, ready: true, created: Date.now() - 1000 }],
      ['f5', { id: 'f5', order: 'NC20261001000381', name: 'pinned.png', role: 'screenshot', size: 1500, count: 1, ready: true, created: Date.now() - 1000 }]
    ]),
    parts: new Map(),
    snapshots: new Map([
      ['snap1', { id: 'snap1', created: Date.now(), fileIds: ['f5'], records: [] }]
    ]),
    settings: new Map([
      ['capacity', { id: 'capacity', bytes: 500 * 1024 * 1024 }],
      ['log-buffer', { id: 'log-buffer', events: [{ id: 'e1', at: Date.now() - 1000, action: 'test' }] }]
    ]),
    performance: new Map()
  };
  const mockIdb = {
    open: () => {
      const req = {
        result: {
          transaction: (names, mode) => {
            const tx = {
              oncomplete: null,
              onerror: null,
              objectStore: name => ({
                getAll: () => {
                  const r = { onsuccess: null, result: Array.from(storeData[name].values()) };
                  setImmediate(() => r.onsuccess?.());
                  return r;
                },
                get: key => {
                  const r = { onsuccess: null, result: storeData[name].get(key) };
                  setImmediate(() => r.onsuccess?.());
                  return r;
                },
                put: item => {
                  storeData[name].set(item.id, item);
                  const r = { onsuccess: null };
                  setImmediate(() => r.onsuccess?.());
                  return r;
                },
                delete: key => {
                  storeData[name].delete(key);
                  const r = { onsuccess: null };
                  setImmediate(() => r.onsuccess?.());
                  return r;
                }
              })
            };
            setImmediate(() => tx.oncomplete?.());
            return tx;
          },
          close: () => {}
        },
        onsuccess: null,
        onerror: null
      };
      setImmediate(() => req.onsuccess?.());
      return req;
    }
  };
  const cache = require('../backend/builtin-tools/f12-to-extension/netcare-artifacts')(mockIdb);
  const stats = await cache.stats();
  assert.equal(stats.breakdown.screenshots.count, 2);
  assert.equal(stats.breakdown.screenshots.bytes, 2500);
  assert.equal(stats.breakdown.attachments.count, 1);
  assert.equal(stats.breakdown.attachments.bytes, 2000);
  assert.equal(stats.breakdown.texts.count, 1);
  assert.equal(stats.breakdown.texts.bytes, 500);
  assert.equal(stats.breakdown.bundles.count, 1);
  assert.equal(stats.breakdown.bundles.bytes, 5000);
  assert.equal(stats.breakdown.snapshots.count, 1);

  // Test preview cleanup with protectSnapshots
  const preview = await cache.cleanupMaterials({ categories: ['screenshots'], protectSnapshots: true });
  // f5 is in snap1 fileIds, so only f1 is dropped
  assert.equal(preview.fileCount, 1);
  assert.equal(preview.released, 1000);

  // Test execute cleanup
  const executed = await cache.cleanupMaterials({ categories: ['screenshots'], protectSnapshots: true }, true);
  assert.equal(executed.fileCount, 1);
  assert.equal(executed.released, 1000);
  assert.equal(storeData.files.has('f1'), false);
  assert.equal(storeData.files.has('f5'), true); // protected!
});

test('plugin log single-line layout and fullscreen toggle mode are present and wired', () => {
  assert.ok(code.includes('.log-row-line{display:flex;align-items:center;'));
  assert.ok(code.includes('.log-row-detail{padding:8px 12px 10px 26px;'));
  assert.ok(code.includes('#settingsDialog.log-fullscreen-mode'));
  assert.ok(code.includes('logFullscreen'));
  assert.ok(code.includes('setLogFullscreen'));
  assert.ok(code.includes('log-fs-btn'));
  assert.ok(code.includes('log-copy-btn') || code.includes('复制 JSON'));
});




test('confirmed empty attachment checks are omitted while the audited section keeps a localized no-attachment label',async()=>{
    const ctx={URL,URLSearchParams,Blob,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),aiAuditEnabled:true,sections:[{number:'3.4',title:'Test',text:true,attachments:true,textPrompt:'Check tests',attachmentsPrompt:'Check files'}]});
    const items=[{section:'3.4',kind:'text',filename:'test.txt',text:'Test content'},{section:'3.4',kind:'attachments',filename:'Test',notApplicable:true}];
    let calls=0;const reports=await ctx.netcareRunAudits(items,settings,async()=>{calls++;return {ok:true,report:{status:'fail',summary:'缺少指标 / Missing metrics',findings:[]}};},new AbortController().signal,()=>{});
    assert.equal(calls,1);assert.ok(reports.some(r=>r.notApplicable));
    const record={order:'RFC',items,reports};const rows=ctx.netcareAuditRows([record]);
    assert.equal(rows.length,1);assert.equal(rows[0].status,'fail');assert.equal(rows[0].noAttachments,true);
    assert.match(ctx.netcareAuditSectionText(rows[0],'zh'),/无附件/);assert.match(ctx.netcareAuditSectionText(rows[0],'en'),/No attachments/);
    ctx.createNetcareZip=async entries=>entries;
    for(const language of ['zh','en']){const entries=await ctx.netcareAuditExcel([record],language);const sheet=await entries.find(e=>e.name==='xl/worksheets/sheet1.xml').blob.text();assert.match(sheet,language==='zh'?/无附件/:/No attachments/);assert.doesNotMatch(sheet,/Missing evidence|需人工核查|Needs review/);}
});

test('legacy generic missing-evidence placeholders are hidden but attachment download and section resolution errors remain visible',()=>{
    const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
    const make=error=>({order:'RFC',items:[{section:'3.4',kind:'attachments',filename:'Test',error}],reports:[{section:'3.4',kind:'attachments',filename:'summary',sources:[{section:'3.4',kind:'attachments',filename:'Test'}],error:true,status:'needs_review',summary:error}]});
    assert.equal(ctx.netcareAuditRows([make('未提取到该章节内容或附件，需人工检查 / Missing evidence')]).length,0);
    for(const error of ['附件下载失败 / Download failed','未定位到章节 / Section not located'])assert.equal(ctx.netcareAuditRows([make(error)]).length,1);
});

test('collector bridge pushes storage changes immediately to background solution tabs without polling',async()=>{
    const pack=packer.buildPackage({...options,manualLaunch:true}),messages=[],stored={};
    let onStorageChanged;
    const window={addEventListener(){},removeEventListener(){},postMessage:m=>messages.push(m)};window.top=window;
    const context={window,location:new URL(onlineUrl),URL,chrome:{runtime:{sendMessage:async()=>({ok:true})},storage:{onChanged:{addListener:fn=>{onStorageChanged=fn;},removeListener(){}},local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,stored[k]]))}}}};
    vm.runInNewContext(pack.files['netcare-collector-bridge.js'],context);
    assert.equal(typeof onStorageChanged,'function');
    stored['netcareWordName:'+onlineOrder]=onlineOrder+'_LargePlan.docx';
    onStorageChanged({['netcareWordName:'+onlineOrder]:{newValue:stored['netcareWordName:'+onlineOrder]}},'local');
    await new Promise(r=>setImmediate(r));
    assert.equal(messages.length,1);
    assert.equal(messages[0].source,'TP_RFC_COLLECTOR_NAME');
    assert.equal(messages[0].filename,onlineOrder+'_LargePlan.docx');
});

test('online background serializes tab activation leases across concurrent solution tabs and restores opener only when queue empties',async()=>{
    const pack=packer.buildPackage({...options,manualLaunch:true});
    const listeners=[],activated=[],stored={'netcareOwnedTab:11':{order:onlineOrder,openerTabId:1},'netcareOwnedTab:12':{order:'NC20261013001000',openerTabId:1}};
    const send=(msg,sender)=>new Promise(reply=>listeners.forEach(fn=>fn(msg,sender,reply)));
    vm.runInNewContext(pack.files['background.js'],{URL,Promise,setTimeout:()=>1,clearTimeout(){},chrome:{runtime:{id:'ext',onInstalled:{addListener(){}},onMessage:{addListener:fn=>listeners.push(fn)}},tabs:{onRemoved:{addListener(){}},update:async(tabId,props)=>{activated.push({tabId,active:props.active});return {id:tabId};}},storage:{local:{get:async k=>typeof k==='string'?{[k]:stored[k]}:stored,set:async()=>{},remove:async()=>{}}}}});
    const sender1={id:'ext',tab:{id:11},frameId:0,url:onlineUrl};
    const sender2={id:'ext',tab:{id:12},frameId:0,url:onlineUrl.replaceAll(onlineOrder,'NC20261013001000')};
    const r1=await send({type:'TP_RFC_ACTIVATE_TAB',order:onlineOrder,mode:'acquire',durationMs:15000,restoreOpener:false},sender1);
    assert.equal(r1.ok,true);
    assert.deepEqual(activated.map(a=>a.tabId),[11]);
    let tab2Resolved=false;
    const p2=send({type:'TP_RFC_ACTIVATE_TAB',order:'NC20261013001000',mode:'acquire',durationMs:15000,restoreOpener:false},sender2).then(r=>{tab2Resolved=true;return r;});
    await new Promise(r=>setImmediate(r));
    assert.equal(tab2Resolved,false);
    assert.deepEqual(activated.map(a=>a.tabId),[11]);
    // Tab 1 releases its lease -> Tab 2 is immediately activated without jumping to openerTabId (1) in between
    const rel1=await send({type:'TP_RFC_ACTIVATE_TAB',order:onlineOrder,mode:'release',restoreOpener:true},sender1);
    assert.equal(rel1.ok,true);
    const r2=await p2;
    assert.equal(r2.ok,true);
    assert.deepEqual(activated.map(a=>a.tabId),[11,12]);
    // Tab 2 releases its lease -> queue is now empty, so openerTabId (1) is restored
    const rel2=await send({type:'TP_RFC_ACTIVATE_TAB',order:'NC20261013001000',mode:'release',restoreOpener:true},sender2);
    assert.equal(rel2.ok,true);
    await new Promise(r=>setImmediate(r));
    assert.deepEqual(activated.map(a=>a.tabId),[11,12,1]);
});

test('China station kdp.idp.huawei.com export worker, online background, and artifact storage work end-to-end', async () => {
    const order = 'NC20260624001106';
    const cnWorker = workerHarness(undefined, 'https://netcare.huawei.com', 'https://kdp.idp.huawei.com',order);
    cnWorker.receive({ type: 'run', job: 'cn-test', order });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cnWorker.saved.length, 1);
    assert.ok(cnWorker.saved[0].startsWith(order + '_'));
    cnWorker.window.__rfcWordWorkerCleanup();

    const harness = onlineBackgroundHarness(), replies = [];
    const cnOnlineUrl = `https://kdp.idp.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=${order}&order_id=${order}&type=NCReadOnly`;
    const cnSender = { tab: { id: 88 }, frameId: 0, url: 'https://netcare.huawei.com/p/netcare/index.html#/rfc' };
    assert.equal(harness.receive({ type: 'TP_RFC_OPEN_ONLINE', order, url: cnOnlineUrl }, cnSender, r => replies.push(r)), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies[0].ok, true);
    assert.equal(harness.created[0].url, cnOnlineUrl);

    const catalogEntry = require(path.join(dir, 'builtin-catalog.js'))['netcare-rfc-word'];
    assert.match(catalogEntry.matches, /kdp\.idp\.huawei\.com\/ows1\/static\/editor\/IdpLiteView\/PublishLiteView\.html\*/);
});

test('attachment audit supports txt, word, excel, and msg with settings multi-select and linkage', async () => {
    const zlib = require('node:zlib');
    const context = { URL, URLSearchParams, Blob, Uint8Array, DataView, TextDecoder, DecompressionStream, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, context);

    // 1. Defaults and settings validation
    const def = context.netcareDefaultSettings();
    assert.deepEqual([...def.attachmentAuditTypes], ['txt']);

    const custom = context.netcareNormalizeSettings({
        ...def,
        attachmentAuditTypes: ['word', 'excel', 'msg', 'unknown']
    });
    assert.deepEqual([...custom.attachmentAuditTypes], ['word', 'excel', 'msg']);

    // 2. Type recognition
    assert.equal(context.netcareGetAttachmentType('test.txt'), 'txt');
    assert.equal(context.netcareGetAttachmentType('doc.docx'), 'word');
    assert.equal(context.netcareGetAttachmentType('legacy.doc'), 'word');
    assert.equal(context.netcareGetAttachmentType('sheet.xlsx'), 'excel');
    assert.equal(context.netcareGetAttachmentType('data.csv'), 'excel');
    assert.equal(context.netcareGetAttachmentType('mail.msg'), 'msg');
    assert.equal(context.netcareGetAttachmentType('photo.png'), null);

    // Helper to generate minimal zip
    function createZip(entries) {
        const localHeaders = [];
        const cdHeaders = [];
        let offset = 0;
        for (const entry of entries) {
            const nameBuf = Buffer.from(entry.name, 'utf8');
            const rawData = Buffer.from(entry.content, 'utf8');
            const compData = zlib.deflateRawSync(rawData);
            const lh = Buffer.alloc(30 + nameBuf.length);
            lh.writeUInt32LE(0x04034b50, 0);
            lh.writeUInt16LE(20, 4);
            lh.writeUInt16LE(0, 6);
            lh.writeUInt16LE(8, 8);
            lh.writeUInt16LE(0, 10);
            lh.writeUInt16LE(0, 12);
            lh.writeUInt32LE(0x12345678, 14);
            lh.writeUInt32LE(compData.length, 18);
            lh.writeUInt32LE(rawData.length, 22);
            lh.writeUInt16LE(nameBuf.length, 26);
            lh.writeUInt16LE(0, 28);
            nameBuf.copy(lh, 30);
            localHeaders.push(lh, compData);
            const cd = Buffer.alloc(46 + nameBuf.length);
            cd.writeUInt32LE(0x02014b50, 0);
            cd.writeUInt16LE(20, 4);
            cd.writeUInt16LE(20, 6);
            cd.writeUInt16LE(0, 8);
            cd.writeUInt16LE(8, 10);
            cd.writeUInt16LE(0, 12);
            cd.writeUInt16LE(0, 14);
            cd.writeUInt32LE(0x12345678, 16);
            cd.writeUInt32LE(compData.length, 20);
            cd.writeUInt32LE(rawData.length, 24);
            cd.writeUInt16LE(nameBuf.length, 28);
            cd.writeUInt16LE(0, 30);
            cd.writeUInt16LE(0, 32);
            cd.writeUInt16LE(0, 34);
            cd.writeUInt16LE(0, 36);
            cd.writeUInt32LE(0, 38);
            cd.writeUInt32LE(offset, 42);
            nameBuf.copy(cd, 46);
            cdHeaders.push(cd);
            offset += lh.length + compData.length;
        }
        const cdTotalSize = cdHeaders.reduce((s, h) => s + h.length, 0);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(0, 4);
        eocd.writeUInt16LE(0, 6);
        eocd.writeUInt16LE(entries.length, 8);
        eocd.writeUInt16LE(entries.length, 10);
        eocd.writeUInt32LE(cdTotalSize, 12);
        eocd.writeUInt32LE(offset, 16);
        eocd.writeUInt16LE(0, 20);
        return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
    }

    // Helper to generate minimal CFBF MSG
    function createMsg(props) {
        const header = Buffer.alloc(512, 0);
        Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(header, 0);
        header.writeUInt16LE(0xFFFE, 0x1C);
        header.writeUInt16LE(9, 0x1E);
        header.writeUInt16LE(6, 0x20);
        header.writeUInt32LE(1, 0x2C);
        header.writeUInt32LE(1, 0x30);
        header.writeUInt32LE(4096, 0x38);
        header.writeUInt32LE(2, 0x3C);
        header.writeUInt32LE(1, 0x40);
        header.writeUInt32LE(0xFFFFFFFE, 0x44);
        header.writeUInt32LE(0, 0x48);
        header.writeUInt32LE(0, 0x4C);

        const entriesData = [
            { name: '__substg1.0_0037001F', text: props.subject || '' },
            { name: '__substg1.0_0C1A001F', text: props.sender || '' },
            { name: '__substg1.0_1000001F', text: props.body || '' }
        ];

        const miniSectors = [];
        const miniFat = [];
        const dirEntries = [];

        const rootEntry = Buffer.alloc(128, 0);
        Buffer.from('Root Entry\0', 'utf16le').copy(rootEntry, 0);
        rootEntry.writeUInt16LE(22, 0x40);
        rootEntry.writeUInt8(5, 0x42);
        rootEntry.writeUInt32LE(0xFFFFFFFF, 0x44);
        rootEntry.writeUInt32LE(0xFFFFFFFF, 0x48);
        rootEntry.writeUInt32LE(1, 0x4C);
        rootEntry.writeUInt32LE(3, 0x74);
        dirEntries.push(rootEntry);

        let currentMiniSector = 0;
        entriesData.forEach((item, idx) => {
            const entryBuf = Buffer.alloc(128, 0);
            const nameBuf = Buffer.from(item.name + '\0', 'utf16le');
            nameBuf.copy(entryBuf, 0);
            entryBuf.writeUInt16LE(nameBuf.length, 0x40);
            entryBuf.writeUInt8(2, 0x42);
            entryBuf.writeUInt32LE(idx === 0 ? 2 : 0xFFFFFFFF, 0x44);
            entryBuf.writeUInt32LE(idx === 0 ? 3 : 0xFFFFFFFF, 0x48);
            entryBuf.writeUInt32LE(0xFFFFFFFF, 0x4C);

            const dataBuf = Buffer.from(item.text, 'utf16le');
            entryBuf.writeUInt32LE(currentMiniSector, 0x74);
            entryBuf.writeUInt32LE(dataBuf.length, 0x78);

            const numSectors = Math.ceil(dataBuf.length / 64) || 1;
            for (let s = 0; s < numSectors; s++) {
                const chunk = Buffer.alloc(64, 0);
                dataBuf.copy(chunk, 0, s * 64, (s + 1) * 64);
                miniSectors.push(chunk);
                miniFat.push(s < numSectors - 1 ? currentMiniSector + 1 : 0xFFFFFFFE);
                currentMiniSector++;
            }
            dirEntries.push(entryBuf);
        });

        const miniStreamData = Buffer.concat(miniSectors);
        rootEntry.writeUInt32LE(miniStreamData.length, 0x78);

        const fatSec = Buffer.alloc(512, 0xFF);
        fatSec.writeUInt32LE(0xFFFFFFFD, 0 * 4);
        fatSec.writeUInt32LE(0xFFFFFFFE, 1 * 4);
        fatSec.writeUInt32LE(0xFFFFFFFE, 2 * 4);
        const numMiniStreamSectors = Math.ceil(miniStreamData.length / 512) || 1;
        for (let s = 0; s < numMiniStreamSectors; s++) {
            fatSec.writeUInt32LE(s < numMiniStreamSectors - 1 ? 4 + s : 0xFFFFFFFE, (3 + s) * 4);
        }

        const dirSec = Buffer.concat(dirEntries);
        const dirPadded = Buffer.alloc(512, 0);
        dirSec.copy(dirPadded, 0);

        const miniFatSec = Buffer.alloc(512, 0xFF);
        miniFat.forEach((val, i) => miniFatSec.writeUInt32LE(val, i * 4));

        const miniStreamPadded = Buffer.alloc(numMiniStreamSectors * 512, 0);
        miniStreamData.copy(miniStreamPadded, 0);

        return Buffer.concat([header, fatSec, dirSec, miniFatSec, miniStreamPadded]);
    }

    // 3. Test TXT extraction
    const txtBlob = new Blob([Buffer.from('操作指南内容', 'utf8')]);
    const resTxt = await context.netcareExtractAttachmentText(txtBlob, 'guide.txt', def, '3.2', '3.2-guide.txt');
    assert.equal(resTxt.text, '操作指南内容');

    // 4. Test Word (.docx) extraction - disabled vs enabled
    const docxBuf = createZip([{
        name: 'word/document.xml',
        content: '<w:document><w:body><w:p><w:t>Word实施步骤 &amp; 说明</w:t></w:p></w:body></w:document>'
    }]);
    const docxBlob = new Blob([docxBuf]);
    const resDocxDisabled = await context.netcareExtractAttachmentText(docxBlob, 'steps.docx', def, '3.2', '3.2-steps.docx');
    assert.match(resDocxDisabled.error, /未开启 Word 附件审计/);

    const allTypesSettings = context.netcareNormalizeSettings({
        ...def,
        attachmentAuditTypes: ['txt', 'word', 'excel', 'msg']
    });
    const resDocxEnabled = await context.netcareExtractAttachmentText(docxBlob, 'steps.docx', allTypesSettings, '3.2', '3.2-steps.docx');
    assert.equal(resDocxEnabled.text, 'Word实施步骤 & 说明');

    // 5. Test Excel (.xlsx) extraction
    const sharedXml = '<sst count="1" uniqueCount="1"><si><t>检查项A</t></si></sst>';
    const sheetXml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>合格</v></c></row></sheetData></worksheet>';
    const xlsxBuf = createZip([
        { name: 'xl/sharedStrings.xml', content: sharedXml },
        { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
    ]);
    const xlsxBlob = new Blob([xlsxBuf]);
    const resXlsxDisabled = await context.netcareExtractAttachmentText(xlsxBlob, 'check.xlsx', def, '3.2', '3.2-check.xlsx');
    assert.match(resXlsxDisabled.error, /未开启 Excel 附件审计/);

    const resXlsxEnabled = await context.netcareExtractAttachmentText(xlsxBlob, 'check.xlsx', allTypesSettings, '3.2', '3.2-check.xlsx');
    assert.match(resXlsxEnabled.text, /检查项A\t合格/);

    // 6. Test CSV extraction
    const csvBlob = new Blob([Buffer.from('Col1,Col2\nVal1,Val2', 'utf8')]);
    const resCsvEnabled = await context.netcareExtractAttachmentText(csvBlob, 'data.csv', allTypesSettings, '3.2', '3.2-data.csv');
    assert.equal(resCsvEnabled.text, 'Col1,Col2\nVal1,Val2');

    // 7. Test MSG extraction
    const msgBuf = createMsg({
        subject: '变更确认邮件',
        sender: '审核人',
        body: '邮件正文：请准时执行变更。'
    });
    const msgBlob = new Blob([msgBuf]);
    const resMsgDisabled = await context.netcareExtractAttachmentText(msgBlob, 'mail.msg', def, '3.2', '3.2-mail.msg');
    assert.match(resMsgDisabled.error, /未开启 MSG 附件审计/);

    const resMsgEnabled = await context.netcareExtractAttachmentText(msgBlob, 'mail.msg', allTypesSettings, '3.2', '3.2-mail.msg');
    assert.match(resMsgEnabled.text, /【主题 \/ Subject】: 变更确认邮件/);
    assert.match(resMsgEnabled.text, /请准时执行变更。/);

    // 8. Unsupported format
    const binBlob = new Blob([Buffer.from([0, 1, 2, 3])]);
    const resBin = await context.netcareExtractAttachmentText(binBlob, 'firmware.bin', allTypesSettings, '3.2', '3.2-firmware.bin');
    assert.match(resBin.error, /不支持自动审计的附件类型/);

    // 9. Relay persistence
    const pack = packer.buildPackage({ ...options, manualLaunch: true }), stored = {};
    let receive;
    const window = { addEventListener: (_t, fn) => { receive = fn; }, removeEventListener() {}, postMessage: () => {} };
    window.top = window;
    const origin = 'https://netcare.huawei.com';
    vm.runInNewContext(pack.files['netcare-online-relay.js'], {
        window, location: { origin },
        chrome: { storage: { local: { set: async d => Object.assign(stored, d), get: async k => ({ [k]: stored[k] }) } } }
    });
    receive({
        source: window, origin,
        data: {
            source: 'TP_RFC_SETTINGS_SET',
            settings: {
                ...def,
                attachmentsEnabled: true,
                textEnabled: true,
                attachmentAuditTypes: ['txt', 'word', 'msg']
            }
        }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...stored.netcareExtractionSettings.attachmentAuditTypes], ['txt', 'word', 'msg']);
});

test('exported logs prefix local timestamp and timezone offset before JSON payload', () => {
    const sandbox = {};
    vm.runInNewContext(code + '\nsandbox.netcareFormatExportLogLine = netcareFormatExportLogLine;', {
        window: { addEventListener: () => {}, removeEventListener: () => {} },
        document: { querySelectorAll: () => [], getElementById: () => ({ value: '' }) },
        location: { protocol: 'https:', hostname: 'netcare.huawei.com', href: 'https://netcare.huawei.com/p/netcare/index.html' },
        Blob, TextDecoder, URL, console, sandbox
    });
    const { netcareFormatExportLogLine } = sandbox;
    assert.equal(typeof netcareFormatExportLogLine, 'function');

    const sample = {
        id: 'c91cafd3-32a1-4254-b1b9-0b26abab878a',
        at: 1791871529058,
        order: 'NC20260624001106',
        category: 'operation',
        level: 'info',
        action: 'ui.click',
        message: '操作控件 / Use control',
        data: { control: 'logExport', label: '导出筛选日志' }
    };
    const formatted = netcareFormatExportLogLine(sample);
    // Format must match: [YYYY-MM-DD HH:mm:ss.SSS GMT(+/-)X] {JSON}
    assert.match(formatted, /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} GMT[+-]\d+(?::\d{2})?\] \{/);

    const jsonPart = formatted.slice(formatted.indexOf('{'));
    const parsed = JSON.parse(jsonPart);
    assert.equal(parsed.id, sample.id);
    assert.equal(parsed.order, sample.order);
    assert.equal(parsed.action, sample.action);
    assert.equal(parsed.timestamp, new Date(sample.at).toISOString());
});

test('AI background request falls back to first available model if selectedModel is unset or mismatched', async () => {
    const pack = packer.buildPackage({ ...options, examAiBridge: false });
    const bgCode = pack.files['background.js'];

    // Test model fallback when netcareAiSelectedModel is undefined or non-existent
    const mockStorage = {
        netcareAiModels: [
            { id: 'model-1', name: 'GLM 5.2', model: 'dfa_glm-52', protocol: 'openai', url: 'https://aigateway.huawei.com/v1/chat/completions', key: 'secret-key-1' }
        ],
        netcareAiSelectedModel: 'non-existent-id',
        netcareExtractionSettings: {
            aiAuditEnabled: true,
            sections: [{ number: '3.5', textPrompt: 'Audit steps' }]
        }
    };

    let capturedFetchUrl = null;
    const listeners = [];

    const mockChrome = {
        runtime: {
            id: 'test-ext-id',
            getURL: path => `chrome-extension://test-ext-id/${path}`,
            onInstalled: { addListener: () => {} },
            onMessage: {
                addListener: fn => listeners.push(fn)
            }
        },
        storage: {
            local: {
                get: async keys => {
                    const result = {};
                    for (const k of (Array.isArray(keys) ? keys : [keys])) {
                        if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
                    }
                    return result;
                },
                set: async () => {},
                getBytesInUse: async () => 0
            },
            onChanged: { addListener: () => {} }
        },
        tabs: {
            sendMessage: async () => {},
            get: async () => ({})
        }
    };

    const answer = { status: 'pass', summary: { zh: '合规', en: 'Compliant' }, findings: [] };
    const context = {
        chrome: mockChrome,
        fetch: async (url, r) => {
            capturedFetchUrl = url;
            return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200 });
        },
        console,
        AbortController,
        TextDecoder,
        URL,
        Date,
        Response,
        crypto: { randomUUID: () => '11111111-2222-3333-4444-555555555555' },
        setTimeout,
        clearTimeout
    };

    vm.runInNewContext(bgCode, context);
    assert.ok(listeners.length > 0);

    const sendAudit = (msg, sender) => new Promise(resolve => {
        for (const fn of listeners) {
            let called = false;
            const res = fn(msg, sender, val => { called = true; resolve(val); });
            if (res === true || called) return;
        }
    });

    const onlineUrl = 'https://kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=' + onlineOrder;
    const sender = { id: 'test-ext-id', url: onlineUrl, frameId: 0, tab: { id: 1 } };
    const auditRes = await sendAudit({
        type: 'TP_RFC_AI_AUDIT',
        id: '11111111-2222-3333-4444-555555555555',
        order: onlineOrder,
        section: '3.5',
        kind: 'text',
        text: 'Some test evidence'
    }, sender);

    assert.equal(auditRes.ok, true);
    assert.equal(auditRes.model, 'dfa_glm-52');
    assert.equal(capturedFetchUrl, 'https://aigateway.huawei.com/v1/chat/completions');
});

test('multi-extension collision yields to first active extension and posts conflict warning', () => {
    const pack = packer.buildPackage({ ...options });
    const bridgeCode = pack.files['netcare-collector-bridge.js'];

    const posted = [];
    const window = {
        top: null,
        addEventListener: () => {},
        postMessage: (data, origin) => posted.push({ data, origin })
    };
    window.top = window;

    const attributes = { 'data-netcare-active-extension-id': 'first-extension-id' };
    const document = {
        documentElement: {
            getAttribute: k => attributes[k] || null,
            setAttribute: (k, v) => { attributes[k] = v; }
        }
    };

    const secondExtId = 'second-extension-id';
    const context = {
        window,
        document,
        location: { href: 'https://kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=NC20260624001106', origin: 'https://kdp.gts.huawei.com' },
        chrome: {
            runtime: { id: secondExtId },
            storage: { local: { get: async () => ({}) } }
        },
        console: { warn: () => {} },
        URL
    };

    vm.runInNewContext(bridgeCode, context);

    // Verify second extension yielded and notified window of conflict
    assert.equal(posted.length, 1);
    assert.equal(posted[0].data.source, 'TP_RFC_EXTENSION_CONFLICT');
    assert.equal(posted[0].data.currentId, secondExtId);
    assert.equal(posted[0].data.activeId, 'first-extension-id');
});

test('sanitized plan (DNC...) is recognized across PublishLiteView export and online background handlers', async () => {
    const pack = packer.buildPackage({ ...options, examAiBridge: false });
    const bgCode = pack.files['background.js'];

    const mockOrder = 'NC20260227000221';
    const sanitizedDocId = 'DNC20260227000221';

    const mockStorage = {
        netcareAiModels: [
            { id: 'm-1', name: 'Test Model', model: 'test-model', protocol: 'openai', url: 'https://aigateway.huawei.com/v1/chat/completions', key: 'key-1' }
        ],
        netcareAiSelectedModel: 'm-1',
        netcareExtractionSettings: {
            aiAuditEnabled: true,
            sections: [{ number: '3.3', textPrompt: 'Check steps' }]
        }
    };

    const listeners = [];
    const mockChrome = {
        runtime: {
            id: 'test-ext-id',
            getURL: path => `chrome-extension://test-ext-id/${path}`,
            onInstalled: { addListener: () => {} },
            onMessage: { addListener: fn => listeners.push(fn) }
        },
        storage: {
            local: {
                get: async keys => {
                    const res = {};
                    for (const k of (Array.isArray(keys) ? keys : [keys])) {
                        if (mockStorage[k] !== undefined) res[k] = mockStorage[k];
                    }
                    return res;
                },
                set: async () => {},
                getBytesInUse: async () => 0
            },
            onChanged: { addListener: () => {} }
        },
        tabs: { sendMessage: async () => {}, get: async () => ({}) }
    };

    const answer = { status: 'pass', summary: { zh: '合规', en: 'Compliant' }, findings: [] };
    const context = {
        chrome: mockChrome,
        fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status: 200 }),
        console,
        AbortController,
        TextDecoder,
        URL,
        Date,
        Response,
        crypto: { randomUUID: () => '22222222-3333-4444-5555-666666666666' },
        setTimeout,
        clearTimeout
    };

    vm.runInNewContext(bgCode, context);
    assert.ok(listeners.length > 0);

    const dispatch = (msg, sender) => new Promise(resolve => {
        for (const fn of listeners) {
            let called = false;
            const res = fn(msg, sender, val => { called = true; resolve(val); });
            if (res === true || called) return;
        }
    });

    // 1. Verify AI audit allows sanitized plan OwsPage tab (docId=DNC20260227000221)
    const sanitizedOnlineUrl = `https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=${sanitizedDocId}&order_id=${mockOrder}`;
    const sender = { id: 'test-ext-id', url: sanitizedOnlineUrl, frameId: 0, tab: { id: 99 } };
    const aiResult = await dispatch({
        type: 'TP_RFC_AI_AUDIT',
        id: '22222222-3333-4444-5555-666666666666',
        order: mockOrder,
        section: '3.3',
        kind: 'text',
        text: 'Operation steps for change'
    }, sender);

    assert.equal(aiResult.ok, true);
    assert.equal(aiResult.report.status, 'pass');

    // 2. Verify collector bridge parses sanitized docId into canonical order
    const bridgeCode = pack.files['netcare-collector-bridge.js'];
    let parsedOrder = null;
    const bridgeWindow = {
        top: null,
        addEventListener: () => {},
        postMessage: () => {}
    };
    bridgeWindow.top = bridgeWindow;
    const bridgeDoc = {
        documentElement: {
            getAttribute: () => null,
            setAttribute: () => {}
        }
    };
    const bridgeContext = {
        window: bridgeWindow,
        document: bridgeDoc,
        location: { href: `https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=${sanitizedDocId}`, origin: 'https://de.kdp.gts.huawei.com' },
        chrome: {
            runtime: { id: 'test-ext-id' },
            storage: { local: { get: async () => ({}) } }
        },
        console: { warn: () => {} },
        URL
    };
    // Bridge should run without returning early
    vm.runInNewContext(bridgeCode, bridgeContext);
    assert.equal(bridgeDoc.documentElement.getAttribute('data-netcare-active-extension-id'), null);
});

test('disableLocalRules prevents local fallback, supports retry loop and friendly top logs', async () => {
    const ctx = { URL, URLSearchParams, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, ctx);

    // 1. Settings normalization checks
    const defaultSet = ctx.netcareDefaultSettings();
    assert.equal(defaultSet.disableLocalRules, false);

    const normDisabledAi = ctx.netcareNormalizeSettings({ ...defaultSet, aiAuditEnabled: false, disableLocalRules: true });
    assert.equal(normDisabledAi.disableLocalRules, false);

    const normEnabledAi = ctx.netcareNormalizeSettings({
        ...defaultSet,
        aiAuditEnabled: true,
        disableLocalRules: true,
        sections: [{ number: '1.1', title: 'Change Purpose', text: true, textPrompt: 'Check purpose' }]
    });
    assert.equal(normEnabledAi.disableLocalRules, true);

    // 2. Audit runner with disableLocalRules: true and promptRetry user rejection
    const settings = normEnabledAi;
    const items = [{ section: '1.1', sectionTitle: 'Change Purpose', kind: 'text', filename: '1.1.txt', text: '变更目的：系统优化升级' }];

    const topLogs = [];
    const topLog = (level, msg) => topLogs.push({ level, msg });

    let retryPrompted = false;
    const promptRetryReject = async (info) => {
        retryPrompted = true;
        assert.equal(info.section, '1.1');
        assert.match(info.error, /Model Timeout/);
        return false; // User decides to skip
    };

    let attempts = 0;
    const failedRequest = async () => {
        attempts++;
        throw new Error('Model Timeout 504');
    };

    const reports = await ctx.netcareRunAudits(items, settings, failedRequest, new AbortController().signal, () => {}, () => {}, promptRetryReject, topLog);

    assert.equal(retryPrompted, true);
    assert.equal(attempts, 1);
    assert.equal(reports.length, 1);
    const r = reports[0];
    assert.equal(r.error, true);
    assert.equal(r.fallback, undefined); // Strictly NO fallback to local rules!
    assert.match(r.summary, /Model Timeout 504/);
    assert.ok(topLogs.some(l => l.level === 'error' && l.msg.includes('Model Timeout 504')));

    // 3. Audit runner with disableLocalRules: true and promptRetry user confirmation -> retry succeeds
    let retryAttempts = 0;
    topLogs.length = 0;
    const retryRequest = async () => {
        retryAttempts++;
        if (retryAttempts === 1) throw new Error('HTTP 429 Rate Limited');
        return { ok: true, report: { status: 'pass', summary: 'Audit passed on retry' }, model: 'test-model' };
    };

    const promptRetryConfirm = async () => true; // User decides to retry

    const retryReports = await ctx.netcareRunAudits(items, settings, retryRequest, new AbortController().signal, () => {}, () => {}, promptRetryConfirm, topLog);

    assert.equal(retryAttempts, 2);
    assert.equal(retryReports.length, 1);
    assert.equal(retryReports[0].status, 'pass');
    assert.equal(retryReports[0].summary, 'Audit passed on retry');
    assert.ok(topLogs.some(l => l.level === 'info' && l.msg.includes('正在重试 AI 接口 (第 2 次)')));
    assert.ok(topLogs.some(l => l.level === 'success' && l.msg.includes('AI 审计成功')));
});

test('AI retry progress reports waiting and each retry without counting failed attempts as completed audits', async()=>{
 const ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(code,ctx);
 const settings=ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(),aiAuditEnabled:true,disableLocalRules:true,sections:[{number:'3.4',title:'Test',text:true,textPrompt:'Check KPI'}]});
 const items=[{section:'3.4',kind:'text',filename:'3.4.txt',text:'KPI evidence'}];
 let attempts=0;const snapshots=[];const request=async()=>{if(++attempts<3)throw Error('HTTP 503');return{ok:true,report:{status:'pass',summary:'Recovered'}};};
 const reports=await ctx.netcareRunAudits(items,settings,request,new AbortController().signal,(_text,counts)=>snapshots.push(JSON.parse(JSON.stringify(counts))),()=>{},async()=>true);
 assert.deepEqual(snapshots.filter(s=>s.retry).map(s=>[s.retry.phase,s.retry.attempt,s.done,s.total]),[['waiting',1,0,1],['requesting',1,0,1],['waiting',2,0,1],['requesting',2,0,1]]);
 assert.deepEqual(snapshots.at(-1),{done:1,total:1,retry:null});assert.equal(reports[0].status,'pass');
 snapshots.length=0;await ctx.netcareRunAudits(items,settings,async()=>{throw Error('Timeout');},new AbortController().signal,(_text,counts)=>snapshots.push(JSON.parse(JSON.stringify(counts))),()=>{},async()=>false);
 assert.equal(snapshots.at(-2).retry.phase,'waiting');assert.deepEqual(snapshots.at(-1),{done:1,total:1,retry:null});
});

test('audit summary publish stores summary without redundant snapshot creation', async () => {
    const pkg = packer.buildPackage({ ...options, manualLaunch: true });
    const callbacks = [], stored = {};
    const ctx = {
        URL,
        chrome: {
            runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onInstalled: { addListener() {} }, onMessage: { addListener: fn => callbacks.push(fn) } },
            storage: { local: { get: async key => ({ [key]: stored[key] }), set: async d => Object.assign(stored, d) } }
        }
    };
    vm.runInNewContext(pkg.files['background.js'], ctx);
    const publish = callbacks[2];

    const reply = await new Promise(r => publish({
        type: 'TP_RFC_AUDIT_PUBLISH',
        order: onlineOrder,
        record: {
            order: onlineOrder,
            materials: [],
            items: [],
            reports: [{ section: '1.1', status: 'pass', summary: 'OK' }]
        }
    }, { id: 'test', frameId: 0, tab: { id: 1 }, url: onlineUrl }, r));

    assert.equal(reply.ok, true);
    assert.equal(stored.netcareAuditSummaries.length, 1);
    assert.equal(stored.netcareAuditSummaries[0].order, onlineOrder);
    // snapStore should NOT have an auto-generated per-order snapshot
    assert.equal(stored.snapStore, undefined);
});

test('confirmation dialog is styled with fit-content to avoid full viewport stretching', () => {
    assert.match(code, /#confirmationDialog\s*\{[^}]*height:\s*fit-content\s*!important/);
    assert.match(code, /#confirmationDialog\s*\{[^}]*min-height:\s*0\s*!important/);
    assert.doesNotMatch(code, /#confirmationDialog\s*\{[^}]*height:\s*auto(?![^}]*fit-content)/);
});

test('embedScreenshotsInExcel defaults to false, avoids squashing images in Excel and preserves screenshots in materials ZIP', async () => {
    const ctx = { URL, Blob, TextEncoder, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, ctx);

    const defaultSettings = ctx.netcareDefaultSettings();
    assert.equal(defaultSettings.embedScreenshotsInExcel, false);
    assert.equal(defaultSettings.screenshotsEnabled, true);

    const norm = ctx.netcareNormalizeSettings({
        sections: [{ number: '1.1', title: 'Scope', text: true, attachments: false }],
        screenshotsEnabled: false,
        embedScreenshotsInExcel: true
    });
    // Linkage: when screenshotsEnabled is false, embedScreenshotsInExcel must be false
    assert.equal(norm.screenshotsEnabled, false);
    assert.equal(norm.embedScreenshotsInExcel, false);

    const normEnabled = ctx.netcareNormalizeSettings({
        sections: [{ number: '1.1', title: 'Scope', text: true, attachments: false }],
        textEnabled: true,
        screenshotsEnabled: true,
        embedScreenshotsInExcel: true
    });
    assert.equal(normEnabled.embedScreenshotsInExcel, true);

    // Verify netcareValidSettings in packer accepts embedScreenshotsInExcel
    const pkg = packer.buildPackage({ ...options, manualLaunch: true });
    assert.ok(pkg.files['netcare-backup.html'].includes('id="password" type="password" style="display:none"'));
    assert.ok(pkg.files['netcare-backup.html'].includes('内置统一内网秘钥'));

    // Test netcareAuditExcel with embedScreenshots = false
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=', 'base64');
    const shot = { name: 'shot.png', folder: '3.2-Test', section: '3.2', kind: 'text', role: 'screenshot', sourceFilename: 'source.txt' };
    const report = { section: '3.2', kind: 'text', filename: 'source.txt', rule: 'Test rule', status: 'pass', summary: 'Pass summary', findings: [] };
    const record = { order: 'NC20261014000001', materials: [shot], items: [{ section: '3.2', kind: 'text', filename: 'source.txt', text: 'Section content' }], reports: [report] };
    const images = new Map([[ctx.netcareAuditImageKey(record.order, 'shot.png'), new Blob([png])]]);
    const JSZip = require('../backend/node_modules/jszip');

    // Without embedding (default user preference: embedScreenshots = false)
    const excelCleanBlob = await ctx.netcareAuditExcel([record], 'zh', images, false);
    const zipClean = await JSZip.loadAsync(await excelCleanBlob.arrayBuffer());
    assert.equal(zipClean.file('xl/drawings/drawing1.xml'), null);
    assert.equal(zipClean.file('xl/media/image1.png'), null);
    const sheetClean = await zipClean.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(!sheetClean.includes('原始区域截图'));
    assert.ok(!sheetClean.includes('drawing'));

    // With embedding enabled (embedScreenshots = true)
    const excelEmbedBlob = await ctx.netcareAuditExcel([record], 'zh', images, true);
    const zipEmbed = await JSZip.loadAsync(await excelEmbedBlob.arrayBuffer());
    assert.ok(zipEmbed.file('xl/drawings/drawing1.xml'));
    assert.ok(zipEmbed.file('xl/media/image1.png'));

    // In materials ZIP with embedScreenshots = false: Excel has no drawing, but materials ZIP preserves the screenshot PNG
    const bundle = await ctx.netcareAuditMaterials([record], [{ order: record.order, name: 'shot.png', role: 'screenshot' }], async () => new Blob([png]), () => {}, 'zh', false);
    assert.ok(bundle.entries.some(e => e.name.includes('方案截图') && e.name.endsWith('shot.png')));
    const bundledExcelBlob = bundle.entries.find(e => e.name === '审计结果.xlsx').blob;
    const bundledZip = await JSZip.loadAsync(await bundledExcelBlob.arrayBuffer());
    assert.equal(bundledZip.file('xl/drawings/drawing1.xml'), null);
});

test('AI audit requires bilingual prompt, English verdict column and bilingual reason column', async () => {
    const pkg = packer.buildPackage({ ...options, manualLaunch: true });
    assert.match(pkg.files['background.js'], /bilingual inspection results in both Chinese and English/);
    assert.match(pkg.files['background.js'], /MANDATORY BILINGUAL REQUIREMENT: Always return BOTH Chinese \(zh\) and English \(en\)/);

    const ctx = { URL, URLSearchParams, Blob, TextEncoder, location: new URL('https://unrelated.example'), window: {} };
    vm.runInNewContext(code, ctx);

    const reports = [
        { section: '1.1', kind: 'text', filename: '1.1.txt', status: 'pass', summary: '变更目的已明确 / Change purpose specified', summaryI18n: { zh: '变更目的已明确', en: 'Change purpose specified' }, findings: [], findingsI18n: [] },
        { section: '3.2', kind: 'text', filename: '3.2.txt', status: 'fail', summary: '缺少回退步骤 / Rollback steps missing', summaryI18n: { zh: '缺少回退步骤', en: 'Rollback steps missing' }, findings: ['未说明回退命令 / Specify rollback commands'], findingsI18n: [{ zh: '未说明回退命令', en: 'Specify rollback commands' }] },
        { section: '3.4', kind: 'text', filename: '3.4.txt', status: 'needs_review', summary: '源材料无法读取 / Source unavailable', summaryI18n: { zh: '源材料无法读取', en: 'Source unavailable' }, findings: [], findingsI18n: [] }
    ];
    const record = { order: 'NC20261015000001', wordFilename: 'test.docx', items: [], reports };

    // 1. Verify netcareAuditRows produces bilingual reasons in all UI languages
    for (const lang of ['zh', 'en']) {
        const rows = ctx.netcareAuditRows([record], lang);
        assert.equal(rows[0].summary, '变更目的已明确 / Change purpose specified');
        assert.equal(rows[1].summary, '缺少回退步骤 / Rollback steps missing');
        assert.equal(rows[1].findings[0], '未说明回退命令 / Specify rollback commands');
        assert.equal(rows[2].summary, '源材料无法读取 / Source unavailable');
    }

    // 2. Verify netcareAuditExcel outputs English verdicts in Column D and bilingual reasons in Column E
    const JSZip = require('../backend/node_modules/jszip');
    for (const lang of ['zh', 'en']) {
        const excelBlob = await ctx.netcareAuditExcel([record], lang);
        const zip = await JSZip.loadAsync(await excelBlob.arrayBuffer());
        const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');

        // Column D verdicts MUST be in English only
        assert.match(sheet, /<t xml:space="preserve">Pass<\/t>/);
        assert.match(sheet, /<t xml:space="preserve">Fail<\/t>/);
        assert.match(sheet, /<t xml:space="preserve">Needs review<\/t>/);
        assert.doesNotMatch(sheet, /<t xml:space="preserve">(?:通过|不通过|需人工核查)<\/t>/);

        // Column E reasons MUST be bilingual
        assert.match(sheet, /变更目的已明确 \/ Change purpose specified/);
        assert.match(sheet, /缺少回退步骤 \/ Rollback steps missing/);
        assert.match(sheet, /未说明回退命令 \/ Specify rollback commands/);
    }
});




