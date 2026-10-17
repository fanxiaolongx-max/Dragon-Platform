const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const packer = require('../backend/builtin-tools/f12-to-extension/packer-core');

const code = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/f12-to-extension/netcare-rfc-word.js'), 'utf8');
const order = 'NC20260928001979', batchId = 1000;
const bundleFileId = '00000000-0000-0000-0000-000000000001';
const record = {order, batchId, generationAt: 1001, wordFilename: 'plan.docx', bundleFilename: 'plan.zip', bundleFileId, reports: []};
const files = [{id: bundleFileId, order, name: 'plan.zip', role: 'audit-bundle'}];

function workflow() {
    const ctx = {URL, URLSearchParams, location: new URL('https://unrelated.example'), window: {}};
    vm.runInNewContext(code, ctx);
    const outcomes = [], jobs = new Map();
    const job = {order, batchId, requiresAudit: true, wordReady: true, filename: 'plan.docx',
        resolve: value => {outcomes.push({ok: true, value}); jobs.delete('job');},
        reject: error => {outcomes.push({ok: false, error: error.message}); jobs.delete('job');}};
    jobs.set('job', job);
    return {...ctx, jobs, job, outcomes, complete: (records = [record], list = async () => files) =>
        ctx.netcareCompleteRfcJobs(jobs, records, batchId, list, () => 'ZIP ready')};
}

test('Word alone does not finish an RFC; current result and cached ZIP must both be ready', async () => {
    const h = workflow();
    await h.complete([]);
    assert.deepEqual(h.outcomes, []);
    h.job.wordReady = false;
    await h.complete();
    assert.deepEqual(h.outcomes, []);
    h.job.wordReady = true;
    await h.complete();
    assert.deepEqual(h.outcomes, [{ok: true, value: 'ZIP ready'}]);
});

test('previous batch, previous generation and another plan cannot finish a current RFC', async () => {
    const h = workflow();
    for (const change of [{batchId: 999}, {generationAt: 999}, {wordFilename: 'other.docx'}, {order: 'NC20260817002874'}]) {
        await h.complete([{...record, ...change}]);
        assert.deepEqual(h.outcomes, []);
    }
    await h.complete();
    assert.equal(h.outcomes[0].ok, true);
});

test('published summary without a cached audit ZIP fails rather than reporting completion', async () => {
    for (const value of [[], [{id: bundleFileId, name: 'plan.zip', role: 'word'}],
        [{id: 'old-pinned-zip', name: 'plan.zip', role: 'audit-bundle'}]]) {
        const h = workflow();
        await h.complete([record], async () => value);
        assert.equal(h.outcomes[0].ok, false);
        assert.match(h.outcomes[0].error, /ZIP.*缓存/);
    }
});

test('a directory scan failure immediately reports extraction failure and releases scanning state', async () => {
    const start = code.indexOf('  async function scan(automatic = false) {');
    const end = code.indexOf('  async function download(automatic = false) {', start);
    assert.ok(start >= 0 && end > start);
    const events = [], messages = [];
    const ctx = {AbortController, controller: null, settingsReady: true, autoAttempted: false,
        settings: {attachmentsEnabled: true}, scanFinished: false,
        editor: () => ({get navigationTree() {throw Error('Directory is unavailable');}}),
        netcareTopicCatalogue: value => value,
        startAutoScroll() {}, stopAutoScroll() {}, updateCollectorButtons() {}, maybeAuto() {},
        trace: (action, message, data) => events.push({action, message, data}), status: value => messages.push(value)};
    vm.createContext(ctx);
    vm.runInContext(code.slice(start, end), ctx);
    await ctx.scan(true);
    assert.equal(ctx.controller, null);
    assert.equal(ctx.scanFinished, false);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'extraction.failed');
    assert.equal(events[0].data.error, 'Directory is unavailable');
    assert.match(messages[0], /Scan incomplete/);
});

test('a rejected result publication reports a failure while snapshot-only warnings remain warnings', () => {
    const start = code.indexOf('  const receiveSlot = event => {');
    const end = code.indexOf("  window.addEventListener('message', receiveSlot);", start);
    assert.ok(start >= 0 && end > start);
    const window = {}, location = new URL('https://de.kdp.gts.huawei.com'), events = [], status = {textContent: ''};
    const ctx = {window, location, order, $: () => status,
        trace: (action, message, data) => events.push({action, message, data})};
    vm.createContext(ctx);
    vm.runInContext(code.slice(start, end) + '\nglobalThis.receive = receiveSlot;', ctx);
    const message = data => ctx.receive({source: window, origin: location.origin,
        data: {source: 'TP_RFC_AUDIT_PUBLISHED', order, ...data}});
    message({ok: true, snapshotError: 'Snapshot failed'});
    assert.equal(events.length, 0);
    message({ok: false, error: 'Summary save failed'});
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'extraction.failed');
    assert.equal(events[0].data.error, 'Summary save failed');
});

test('missing publication acknowledgment reports a bounded failure rather than waiting for the batch deadline', async () => {
    const start = code.indexOf('      const published=new Promise(');
    const end = code.indexOf("      window.postMessage({source:'TP_RFC_AUDIT_PUBLISH'", start);
    assert.ok(start >= 0 && end > start);
    const events = [];
    let expire;
    const ctx = {order, window: {addEventListener() {}, removeEventListener() {}},
        setTimeout: (fn, ms) => {assert.equal(ms, 15000); expire = fn;}, clearTimeout() {},
        trace: (action, message, data) => events.push({action, message, data})};
    vm.createContext(ctx);
    vm.runInContext(code.slice(start, end) + '\nglobalThis.publishedResult = published;', ctx);
    expire();
    assert.equal(await ctx.publishedResult, false);
    assert.equal(events[0].action, 'extraction.failed');
    assert.match(events[0].data.error, /timed out/);
});

test('AI collection publishes the exact committed ZIP identity and never publishes a failed ZIP', async () => {
    const start = code.indexOf('  async function download(automatic = false) {');
    const end = code.indexOf("  $('scan').onclick", start);
    assert.ok(start >= 0 && end > start);
    for (const cacheFailure of [false, true]) {
        const events = [], published = [], nodes = new Map(), listeners = new Map();
        const $ = id => {if (!nodes.has(id)) nodes.set(id, {value: id === 'filename' ? 'plan.docx' : '', textContent: ''}); return nodes.get(id);};
        const window = {
            addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type),
            postMessage: message => {published.push(message); listeners.get('message')?.({source: window, origin: 'https://de.kdp.gts.huawei.com',
                data: {source: 'TP_RFC_AUDIT_PUBLISHED', order, ok: true}});}
        };
        const ctx = {order, batchId, generationAt: 1001, window, location: new URL('https://de.kdp.gts.huawei.com'), $, Blob, AbortController,
            settings: {aiAuditEnabled: true, sections: [], textEnabled: true, attachmentsEnabled: true, screenshotsEnabled: false},
            controller: null, downloadInProgress: false, downloadCompleted: false, topics: [], attachments: [], cleanScan: true,
            editor: () => ({}), startAutoScroll() {}, stopAutoScroll() {}, updateCollectorButtons() {}, renderCaptureDiagnostics() {},
            trace: (action, message, data) => events.push({action, message, data}), status: value => {$('status').textContent = value;},
            netcareArtifactRequest: async () => [{id: 'word', name: 'plan.docx'}], netcareReadArtifact: async () => new Blob(['Word']),
            netcareUniqueFilename: value => value, netcareSafeFilename: value => value, netcareCacheAudit() {}, localStorage: {},
            netcareRunAudits: async () => [], requestAudit() {}, promptAiRetry() {}, appendTopLog() {}, netcareAuditLevel: () => 'standard',
            createNetcareZip: async () => new Blob(['ZIP']), netcareStoreArtifact: async () => {if (cacheFailure) throw Error('Cache full'); return bundleFileId;},
            netcareLogQueue: Promise.resolve(), netcareLogFailures: 0, captureDiagnostics: [], setTimeout: () => 1, clearTimeout() {}};
        vm.createContext(ctx);
        vm.runInContext(code.slice(start, end), ctx);
        await ctx.download(true);
        if (cacheFailure) {
            assert.equal(published.length, 0);
            assert.equal(ctx.downloadCompleted, false);
            assert.ok(events.some(e => e.action === 'extraction.failed'));
            assert.match($('status').textContent, /Cache full/);
        } else {
            assert.equal(published.length, 1, $('status').textContent);
            assert.equal(published[0].source, 'TP_RFC_AUDIT_PUBLISH');
            assert.equal(published[0].record.bundleFileId, bundleFileId);
            assert.equal(ctx.downloadCompleted, true);
            assert.ok(events.some(e => e.action === 'bundle.download.cached'));
        }
    }
});

test('cancellation and duplicate storage events cannot finish the same RFC twice', async () => {
    const h = workflow();
    let release;
    const pending = h.complete([record], () => new Promise(resolve => {release = resolve;}));
    await h.complete();
    assert.deepEqual(h.outcomes, []);
    h.jobs.delete('job');
    release(files);
    await pending;
    assert.deepEqual(h.outcomes, []);
});

test('extraction failures propagate only to the matching current-batch job', () => {
    const h = workflow(), fail = {order, batchId, action: 'extraction.failed', error: 'Word cache missing'};
    h.netcareRejectRfcJobs(h.jobs, {...fail, batchId: 999}, batchId);
    h.netcareRejectRfcJobs(h.jobs, {...fail, order: 'NC20260817002874'}, batchId);
    h.netcareRejectRfcJobs(h.jobs, {...fail, action: 'collector.ready'}, batchId);
    assert.deepEqual(h.outcomes, []);
    h.netcareRejectRfcJobs(h.jobs, fail, batchId);
    assert.deepEqual(h.outcomes, [{ok: false, error: 'Word cache missing'}]);
});

test('generated background sends extraction errors to both root and delegated source pages', async () => {
    const pkg = packer.buildPackage({name: 'NetCare', version: '1.0.0', code,
        matches: 'https://netcare.huawei.com/p/netcare/index.html*\nhttps://netcare-ae.gts.huawei.com/p/netcare/index.html*\nhttps://netcare-de.gts.huawei.com/p/netcare/index.html*\nhttps://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*',
        world: 'MAIN', allFrames: true, manualLaunch: true, license: {enabled: false}});
    const callbacks = [], sent = [], owner = {order, batchId, openerTabId: 1, sourceTabId: 2};
    const ctx = {URL, chrome: {
        runtime: {id: 'test', onInstalled: {addListener() {}}, onMessage: {addListener: fn => callbacks.push(fn)}},
        storage: {local: {get: async key => ({[key]: owner})}},
        tabs: {sendMessage: async (id, message) => {sent.push({id, message});}}
    }};
    vm.runInNewContext(pkg.files['background.js'], ctx);
    ctx.tpNetcareArtifactCache.log = async () => ({});
    const listener = callbacks.find(fn => fn.toString().includes('Invalid artifact source'));
    const message = {type: 'TP_RFC_ARTIFACT_REQUEST', action: 'log', order,
        event: {order, action: 'extraction.failed', message: 'Extraction failed', data: {error: 'Word cache missing'}}};
    const sender = {id: 'test', tab: {id: 3}, frameId: 0,
        url: `https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=${order}`};
    const reply = await new Promise(resolve => listener(message, sender, resolve));
    assert.equal(reply.ok, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent.map(s => s.id), [1, 2]);
    for (const {message: m} of sent) {
        assert.equal(m.type, 'TP_RFC_ROUTE_EVENT');
        assert.equal(m.data.action, 'extraction.failed');
        assert.equal(m.data.batchId, batchId);
        assert.equal(m.data.error, 'Word cache missing');
    }
    sent.length = 0;
    const rejected = await new Promise(resolve => listener(message, {...sender, url: 'https://unrelated.example'}, resolve));
    assert.equal(rejected.ok, false);
    assert.equal(sent.length, 0);
});
