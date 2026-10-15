const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('../frontend/js/shared/xlsx.full.min.js');

const slaDir = path.join(__dirname, '../frontend/js/sla');
const modes = ['rectification', 'special', 'risk', 'sr', 'vulnerability'];
const fileStems = {
    rectification: 'PBI_自动抓取-整改详单_整改',
    special: 'PBI_自动抓取-CPT风险详表',
    risk: 'PBI_自动抓取-风险详单',
    sr: 'PBI_自动抓取-详单-SR',
    vulnerability: 'PBI_自动抓取-详单漏洞_漏洞预警'
};
const rows = {
    rectification: { task_id: 'rect', task_status: 'Checking', task_create_time: '2026/09/17 12:00:00' },
    special: { task_id: 'special', task_status_en: 'Processing', required_completion_time: '2026/10/17 12:00:00' },
    risk: { task_id: 'risk', risk_status: 'Risk Open', ticket_close_due_date: '2026/10/17 12:00:00' },
    sr: { sr_num: 'sr', sr_status_name: 'Open', open_date: '2026/10/01 12:00:00', exp_close_date: '2026/10/17 12:00:00' },
    vulnerability: { task_id: 'vuln', task_status: 'Checking', create_time: '2026/09/17 12:00:00' }
};

function file(name, data) {
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(data));
    return Object.assign(new Blob([csv], { type: 'text/csv' }), { name });
}

function context() {
    const requests = [];
    const cache = new Map();
    const main = { innerHTML: '' };
    const nav = { innerHTML: '', style: {} };
    class FixedDate extends Date {
        constructor(...args) { super(...(args.length ? args : ['2026-10-15T12:00:00'])); }
        static now() { return new Date('2026-10-15T12:00:00').getTime(); }
    }
    class FileReader {
        readAsArrayBuffer(source) {
            source.arrayBuffer().then(result => this.onload({ target: { result } }));
        }
    }
    const window = {
        SLATargetMonth: { get: () => 10 },
        SLASourceArchive: { archive: async () => 'batch', withLock: fn => fn() }
    };
    const ctx = vm.createContext({
        window, Blob, Date: FixedDate, FileReader, XLSX,
        console: { log() {}, info() {}, warn() {}, error() {} },
        document: {
            addEventListener() {},
            head: { appendChild() {} },
            createElement: () => ({}),
            getElementById: id => id === 'main-wrapper' ? main : id === 'summary-nav-area' ? nav : null,
            querySelector: () => null,
            querySelectorAll: () => []
        },
        API: {
            get: async () => null,
            post: async (url, body) => requests.push({ url, body: JSON.parse(JSON.stringify(body)) }),
            logHistory() {}
        },
        SLAPrefs: { loadPrefs: async () => {} },
        localStorage: { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) },
        SLAT: key => key,
        alert: message => { throw new Error(message); },
        showToast() {}, bindEvents() {}, updateView() {}, evaluateAllMetrics() {},
        setTimeout: fn => { fn(); }
    });
    for (const name of ['upload.js', 'risk-rules.js', 'other-rules.js', 'section.js']) {
        vm.runInContext(fs.readFileSync(path.join(slaDir, name), 'utf8'), ctx);
        if (name === 'upload.js') ctx.SLAUpload = window.SLAUpload;
    }
    // Exercise real initialization and SLA calculations, without rendering table DOM.
    vm.runInContext('buildDOM = () => {};', ctx);
    return { ctx, window, cache, requests, snapshot: () => requests.find(item => item.url === '/api/sla/snapshot')?.body };
}

for (const structured of [false, true]) {
    test(`batch import routes CN/DE detail files into all five alert collections (${structured ? 'UIVF12 rows' : 'local CSVs'})`, async () => {
        const c = context();
        const sources = modes.map(mode => ({
            name: fileStems[mode] + (['special', 'risk', 'sr'].includes(mode) ? '-CN' : '') + '_Latest.csv',
            data: [rows[mode]]
        }));
        sources.push(...['special', 'risk'].map(mode => ({ name: fileStems[mode] + '-DE_Latest (1).csv', data: [{ ...rows[mode], task_id: mode + '-DE' }] })));
        const files = sources.map(source => structured ? { name: source.name, __uivRows: source.data } : file(source.name, source.data));
        await c.window.SLAUpload.processBatchFiles(files);
        assert.deepEqual(Object.keys(c.window.AppState).sort(), [...modes].sort());
        assert.deepEqual(c.snapshot().expiringTickets.map(ticket => ticket.collection), ['rectification', 'special', 'special', 'risk', 'risk', 'sr', 'vulnerability']);
        for (const mode of modes) {
            const section = c.window.AppState[mode];
            assert.equal(section.mode, mode);
            assert.ok(section.globalData.every(row => row._slaDays === 2), mode);
            assert.deepEqual(Array.from(section.sourceFiles), files.filter(source => source.name.startsWith(fileStems[mode])).map(source => source.name));
        }
        assert.equal(c.snapshot().sourceSections.length, 5);
        assert.equal(JSON.parse(c.cache.get('sla_last_import_workspace_v1')).sections.length, 5);
    });
}

test('legacy filenames still route correctly while summary tables remain other tables', async () => {
    const c = context();
    const files = modes.map(mode => file(fileStems[mode] + '_Latest.csv', [rows[mode]]));
    files.push(file('PBI_自动抓取-SRFRT-CN_Latest_2026年10月.csv', [{ count: 3 }]));
    files.push(file('PBI_自动抓取_漏洞预警_Latest.csv', [{ count: 5 }]));
    await c.window.SLAUpload.processBatchFiles(files);
    assert.equal(c.snapshot().expiringTickets.length, 5);
    assert.equal(Object.values(c.window.AppState).filter(section => section.mode === 'other').length, 2);
});

test('site-suffixed detail files keep target-month filtering', async () => {
    const c = context();
    await c.window.SLAUpload.processBatchFiles([
        file(fileStems.sr + '-CN_Latest_2026年10月.csv', [rows.sr]),
        file(fileStems.sr + '-CN_Latest_2026年09月.csv', [{ ...rows.sr, sr_num: 'September' }])
    ]);
    assert.equal(c.snapshot().expiringTickets.length, 1);
    assert.equal(c.snapshot().expiringTickets[0].data.sr_num, 'sr');
    assert.equal(c.window.AppState.sr.sourceFiles.length, 1);
});

test('batch and specific import produce the same SLA results for site-suffixed files', async () => {
    const batch = context();
    const files = modes.map(mode => file(fileStems[mode] + '-CN_Latest.csv', [rows[mode]]));
    await batch.window.SLAUpload.processBatchFiles(files);
    for (const [index, mode] of modes.entries()) {
        const specific = context();
        await specific.window.SLAUpload.handleSpecificUpload({ target: { files: [files[index]], value: 'selected' } }, mode);
        assert.deepEqual(batch.snapshot().expiringTickets.filter(ticket => ticket.collection === mode).map(ticket => ticket.data), specific.snapshot().expiringTickets.map(ticket => ticket.data));
    }
});

test('archive review recognizes site suffixes and respects saved explicit import modes', () => {
    const c = context();
    for (const mode of modes) {
        c.ctx.original = { name: fileStems[mode] + '-DE_Latest_2026年10月.csv' };
        assert.equal(vm.runInContext('archivedImportDescriptor(original).mode', c.ctx), mode);
    }
    c.ctx.original = { name: 'renamed.csv' };
    assert.equal(vm.runInContext("archivedImportDescriptor(original, { key: 'risk', mode: 'risk' }).mode", c.ctx), 'risk');
    assert.equal(vm.runInContext('archivedImportDescriptor(original).mode', c.ctx), 'other');
});
