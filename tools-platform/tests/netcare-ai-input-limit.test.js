const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const packer = require('../backend/builtin-tools/f12-to-extension/packer-core');
const backupFactory = require('../backend/builtin-tools/f12-to-extension/netcare-backup.js');

const dir = path.join(__dirname, '../backend/builtin-tools/f12-to-extension');
const code = fs.readFileSync(path.join(dir, 'netcare-rfc-word.js'), 'utf8');
// The packed page loads netcare-settings.js first; vm runs it the same way.
const pageCode = require('./helpers/netcare-page');
const options = {
    name: 'NetCare RFC 方案 Word 下载', version: '1.0.0', description: 'RFC Word downloader',
    matches: 'https://netcare-ae.gts.huawei.com/p/netcare/index.html*\nhttps://netcare.huawei.com/p/netcare/index.html*\nhttps://netcare-de.gts.huawei.com/p/netcare/index.html*\nhttps://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*',
    world: 'MAIN', allFrames: true, manualLaunch: true, includePopup: false,
    runAt: 'document_idle', license: { enabled: false }, code
};
const onlineOrder = 'NC20261004000263';
const onlineUrl = `https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId=${onlineOrder}&order_id=${onlineOrder}&type=NCReadOnly`;
const page = () => {const ctx = {URL, URLSearchParams, Blob, TextDecoder, location: new URL('https://unrelated.example'), window: {}}; vm.runInNewContext(pageCode, ctx); return ctx;};
const pass = {ok: true, model: 'm', report: {status: 'pass', summary: 'OK', summaryI18n: {zh: '通过', en: 'OK'}, findings: [], findingsI18n: []}};
// Section 3.3 from a real run: a 34,500-character TXT plus a Word guide, 90,000 characters in all.
const largeGroup = () => [{section: '3.3', kind: 'attachments', filename: '3.3-commands.txt', text: 'MOD NODE: CID=1;' + 'a'.repeat(34500 - 16)}, {section: '3.3', kind: 'attachments', filename: '3.3-guide.docx', text: 'b'.repeat(55500 - 13) + 'LST DBSRLINK;'}];
const strict = ctx => ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(), aiAuditEnabled: true, auditLevel: 'strict', textEnabled: false, sections: [{number: '3.3', title: 'Steps', attachments: true, attachmentsPrompt: 'Check scripts'}]});

test('default 60000 limit keeps the existing budget, extraction cap and oversized check', async () => {
    const ctx = page(), settings = strict(ctx);
    assert.equal(ctx.netcareAuditInputLimit(undefined), 60000);assert.equal(ctx.netcareAuditInputLimit(10000), 60000);assert.equal(ctx.netcareAuditInputLimit(900000), 60000);assert.equal(ctx.netcareAuditInputLimit(1.5e5 + 0.5), 60000);
    const cut = ctx.netcareTruncateEvidenceText('x'.repeat(70000));assert.equal(cut.indexOf('\n'), 59000);assert.match(cut, /前59000字.*Truncated to 59000 chars/);
    assert.equal((await ctx.netcareExtractTxt(new Blob(['y'.repeat(70000)]))).indexOf('\n'), 59000);
    const [group] = ctx.netcareGroupAuditItems(largeGroup(), settings);assert.ok(group.text.length <= 58000);assert.ok(group.truncated > 30000);assert.ok(group.remainder.length);
    const sent = [];
    const reports = await ctx.netcareRunAudits(largeGroup(), settings, async item => {sent.push(item);return item.phase === 'keywords' ? {...pass, requirements: [{id: 'q', zh: '查询', en: 'Query', metInContent: false, keywords: [{term: 'LST DBSRLINK', weight: 3}]}]} : pass;}, new AbortController().signal, () => {});
    assert.equal(sent[0].phase, 'keywords');assert.ok(sent[0].text.length <= 60000);assert.equal(reports[0].status, 'pass');
    const oversized = await ctx.netcareRunAudits([{section: '3.3', kind: 'text', filename: 't.txt', text: 'z'.repeat(60001)}], ctx.netcareNormalizeSettings({...ctx.netcareDefaultSettings(), aiAuditEnabled: true, attachmentsEnabled: false, sections: [{number: '3.3', title: 'Steps', text: true, textPrompt: 'Check'}]}), async item => {assert.ok(item.text.length <= 60000);return pass;}, new AbortController().signal, () => {});
    assert.equal(oversized[0].status, 'needs_review');assert.ok(oversized[0].truncated > 2000);
});

test('a larger model limit sends a 90,000-character attachment group whole, without keyword scoring', async () => {
    const ctx = page(), settings = strict(ctx), sent = [], logs = [];
    assert.equal((await ctx.netcareExtractTxt(new Blob(['y'.repeat(90000)]), 199000)).length, 90000);
    const reports = await ctx.netcareRunAudits(largeGroup(), settings, async item => {sent.push(item);return pass;}, new AbortController().signal, () => {}, (action, data) => logs.push({action, data}), null, null, 200000);
    assert.equal(sent.length, 1);assert.equal(sent[0].phase, undefined);assert.equal(sent[0].truncated, undefined);assert.equal(sent[0].remainder, undefined);
    assert.ok(sent[0].text.length > 90000 && sent[0].text.length <= 200000);assert.ok(sent[0].text.includes('a'.repeat(34484)));assert.match(sent[0].text, /LST DBSRLINK;/);assert.doesNotMatch(sent[0].text, /已截断/);
    assert.ok(logs.find(l => l.action === 'audit.evidence').data.files.every(f => f.sent === f.characters));assert.ok(!logs.some(l => l.action === 'audit.keywords'));
    assert.equal(reports[0].status, 'pass');assert.equal(reports[0].truncated, undefined);
    // A group still above the larger limit keeps the keyword-scoring path.
    const big = [{section: '3.3', kind: 'attachments', filename: 'huge.txt', text: 'c'.repeat(110000)}], keywordSent = [];
    await ctx.netcareRunAudits(big, settings, async item => {keywordSent.push(item);return item.phase === 'keywords' ? {...pass, requirements: [{id: 'q', zh: '查询', en: 'Query', metInContent: false, keywords: [{term: 'LST', weight: 3}]}]} : pass;}, new AbortController().signal, () => {}, () => {}, null, null, 100000);
    assert.equal(keywordSent[0].phase, 'keywords');assert.ok(keywordSent[0].text.length <= 100000 && keywordSent[0].text.length > 90000);
});

test('background enforces the selected model limit instead of a fixed 60000', async () => {
    const pkg = packer.buildPackage(options), callbacks = [], requests = [];
    const stored = {netcareAiSelectedModel: 'big', netcareExtractionSettings: {aiAuditEnabled: true, sections: [{number: '3.4', textPrompt: 'Check KPI tests'}]}, netcareAiModels: [{id: 'small', name: 'Small', protocol: 'openai', url: 'https://model.example/v1', model: 'small', key: 'test-key'}, {id: 'big', name: 'Flash', protocol: 'openai', url: 'https://model.example/v1', model: 'flash', key: 'test-key', maxInputChars: 100000}]};
    const ctx = {URL, AbortController, TextDecoder, setTimeout, clearTimeout, console, chrome: {runtime: {id: 'test', getURL: p => 'chrome-extension://test/' + p, onInstalled: {addListener() {}}, onMessage: {addListener: fn => callbacks.push(fn)}}, storage: {local: {get: async () => stored}}}, fetch: async (url, request) => {requests.push(request);return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({status: 'pass', summary: {zh: '符合', en: 'OK'}, findings: []})}}]}), {status: 200});}};
    vm.runInNewContext(pkg.files['background.js'], ctx);
    const audit = text => new Promise(reply => callbacks[1]({type: 'TP_RFC_AI_AUDIT', id: crypto.randomUUID(), order: onlineOrder, section: '3.4', kind: 'text', filename: '3.4.txt', text}, {id: 'test', url: onlineUrl, frameId: 0, tab: {id: 2}}, reply));
    const accepted = await audit('k'.repeat(90000));assert.equal(accepted.ok, true, accepted.error);assert.equal(requests.length, 1);assert.ok(requests[0].body.includes('k'.repeat(90000)));
    const rejected = await audit('k'.repeat(100001));assert.equal(rejected.ok, false);assert.match(rejected.error, /超过100000字符/);assert.equal(requests.length, 1);
    stored.netcareAiSelectedModel = 'small';
    assert.match((await audit('k'.repeat(60001))).error, /超过60000字符/);assert.equal(requests.length, 1);
    assert.equal((await audit('k'.repeat(60000))).ok, true);assert.equal(requests.length, 2);
    const build = vm.runInContext('tpBuildModelRequest', ctx), model = stored.netcareAiModels[0];
    for (const maxInputChars of [19999, 800001, 65000.5, '90000']) assert.throws(() => build({...model, maxInputChars}, 'test'), /Max input characters/);
    for (const maxInputChars of [undefined, 20000, 800000]) build({...model, maxInputChars}, 'test');
});

test('collector handshake carries only the selected model limit and refreshes when models change', async () => {
    const pkg = packer.buildPackage(options), messages = [], stored = {netcareAiModels: [{id: 'a', url: 'https://model.example/v1', model: 'a', protocol: 'openai', key: 'collector-secret', maxInputChars: 300000}], netcareAiSelectedModel: 'a'};
    let changed;
    const window = {addEventListener() {}, removeEventListener() {}, postMessage: m => messages.push(m)};window.top = window;
    vm.runInNewContext(pkg.files['netcare-collector-bridge.js'], {window, location: new URL(onlineUrl), URL, chrome: {runtime: {sendMessage: async () => ({ok: true})}, storage: {onChanged: {addListener: fn => {changed = fn;}, removeListener() {}}, local: {get: async keys => Object.fromEntries(keys.map(k => [k, stored[k]]))}}}});
    changed({netcareAiSelectedModel: {newValue: 'a'}}, 'local');await new Promise(r => setImmediate(r));
    assert.equal(messages.at(-1).inputLimit, 300000);assert.ok(!JSON.stringify(messages).includes('collector-secret'));assert.ok(!JSON.stringify(messages).includes('model.example'));
    stored.netcareAiModels = [{...stored.netcareAiModels[0], maxInputChars: 5}];changed({netcareAiModels: {newValue: stored.netcareAiModels}}, 'local');await new Promise(r => setImmediate(r));
    assert.equal(messages.at(-1).inputLimit, 60000);
});

test('AI page saves the max input field with the model and backups validate it', async () => {
    const pkg = packer.buildPackage(options), nodes = new Map(), stored = {};
    assert.match(pkg.files['netcare-ai.html'], /id="maxInputChars" type="number" min="20000" max="800000"[^>]*placeholder="60000"/);
    const node = id => {if (!nodes.has(id)) nodes.set(id, {id, value: '', style: {}, replaceChildren() {}, append() {}, textContent: ''});return nodes.get(id);};
    const document = {getElementById: node, addEventListener() {}, createElement: () => ({}), body: {}};
    const chrome = {runtime: {sendMessage: async () => ({ok: true})}, storage: {onChanged: {addListener() {}}, local: {get: async () => ({...stored}), set: async data => Object.assign(stored, data)}}};
    vm.runInNewContext(pkg.files['netcare-ai.js'], {window: {addEventListener() {}}, document, chrome, crypto, URL, location: {pathname: '/netcare-ai.html'}, navigator: {language: 'zh'}});
    await new Promise(r => setImmediate(r));
    Object.assign(node('name'), {value: 'Flash'});Object.assign(node('protocol'), {value: 'openai'});Object.assign(node('url'), {value: 'https://model.example/v1'});Object.assign(node('model'), {value: 'gemini-3.1-flash-lite'});Object.assign(node('key'), {value: 'k'});node('maxInputChars').value = '400000';
    await node('save').onclick();assert.equal(stored.netcareAiModels[0].maxInputChars, 400000);
    node('maxInputChars').value = '';await node('save').onclick();assert.equal(stored.netcareAiModels[0].maxInputChars, undefined);
    node('maxInputChars').value = '1000';await node('save').onclick();assert.match(node('status').textContent, /20000-800000/);assert.equal(stored.netcareAiModels[0].maxInputChars, undefined);
    const backup = backupFactory(), model = {id: 'm', name: 'Flash', url: 'https://model.example/v1', protocol: 'openai', model: 'flash', key: 'k'};
    const restored = await backup.decrypt(await backup.encrypt({netcareAiModels: [{...model, maxInputChars: 400000}], netcareAiSelectedModel: 'm'}, 'test-pass-2026'), 'test-pass-2026');
    assert.equal(backup.validate(restored, () => true, () => {}).netcareAiModels[0].maxInputChars, 400000);
    backup.validate({netcareAiModels: [model], netcareAiSelectedModel: 'm'}, () => true, () => {});
    for (const maxInputChars of [10000, 900000, '400000', 50000.5]) assert.throws(() => backup.validate({netcareAiModels: [{...model, maxInputChars}]}, () => true, () => {}), /模型信息无效/);
});
