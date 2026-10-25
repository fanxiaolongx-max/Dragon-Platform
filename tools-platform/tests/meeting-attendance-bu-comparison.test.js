const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMeetingAttendance(lang = 'zh') {
    const htmlPath = path.resolve(__dirname, '../backend/builtin-tools/tool-msf5b7nn/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const scriptMatch = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    assert.ok(scriptMatch, 'Script block must be present');
    const code = scriptMatch[1];

    const storage = new Map([
        ['tools_lang', lang === 'en' ? 'en-US' : 'zh-CN'],
        ['meeting_attendance_lang_v1', lang]
    ]);

    const mockElements = new Map();
    function getEl(id) {
        if (!mockElements.has(id)) {
            const classes = new Set(id.toLowerCase().includes('modal') ? ['hidden'] : []);
            mockElements.set(id, {
                id,
                classList: {
                    contains: (cls) => classes.has(cls),
                    remove: (cls) => { classes.delete(cls); },
                    add: (cls) => { classes.add(cls); },
                    toggle: (cls) => { classes.has(cls) ? classes.delete(cls) : classes.add(cls); }
                },
                querySelectorAll: () => [],
                querySelector: () => null,
                appendChild: () => {},
                addEventListener: () => {},
                setAttribute: () => {},
                style: {},
                textContent: '',
                innerHTML: '',
                value: ''
            });
        }
        return mockElements.get(id);
    }

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        TextEncoder,
        Uint8Array,
        DataView,
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        localStorage: {
            getItem: (k) => storage.get(k) ?? null,
            setItem: (k, v) => storage.set(k, String(v)),
            removeItem: (k) => storage.delete(k),
            clear: () => storage.clear()
        },
        sessionStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {}
        },
        document: {
            documentElement: { lang: lang === 'en' ? 'en' : 'zh-CN' },
            title: '',
            querySelector: (sel) => {
                if (sel === '#welinkModal') return getEl('welinkModal');
                return getEl(sel.replace(/^[#.]/, ''));
            },
            querySelectorAll: () => [],
            getElementById: (id) => getEl(id),
            createElement: () => ({ ...getEl('created') }),
            body: { appendChild: () => {}, classList: { contains: () => false, add: () => {}, remove: () => {} } },
            addEventListener: () => {}
        },
        window: {
            location: { reload: () => {} },
            addEventListener: () => {},
            dispatchEvent: () => {}
        }
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.localStorage = sandbox.localStorage;

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    return sandbox.window.__meetingAttendance;
}

test('BU comparison table renders required English headers and aggregates across sessions without month separation', () => {
    const api = loadMeetingAttendance('zh');
    const sessions = [
        { name: '2026-08-15 网安例会', date: '2026-08-15' },
        { name: '2026-09-15 网安例会', date: '2026-09-15' }
    ];
    const people = [
        {
            name: '张三',
            account: 'z10001',
            bu: 'Software BU',
            sessionRecords: {
                '2026-08-15 网安例会': { required: true, attendance: 'Attend on Time' },
                '2026-09-15 网安例会': { required: true, attendance: 'Absent' }
            }
        },
        {
            name: '李四',
            account: 'l10002',
            bu: 'Software BU',
            sessionRecords: {
                '2026-08-15 网安例会': { required: true, attendance: 'Delay' },
                '2026-09-15 网安例会': { required: true, attendance: 'Fake Attendance' }
            }
        },
        {
            name: '王五',
            account: 'w10003',
            bu: 'Hardware BU',
            sessionRecords: {
                '2026-08-15 网安例会': { required: true, attendance: 'Attend on Time' },
                '2026-09-15 网安例会': { required: false, attendance: 'Not Required' }
            }
        }
    ];

    const html = api.renderBuOverallComparisonCard(sessions, people);

    // Verify required English headers
    assert.match(html, /<th>BU Name<\/th>/);
    assert.match(html, /<th>Absent<\/th>/);
    assert.match(html, /<th>Attend on Time<\/th>/);
    assert.match(html, /<th>Late Attendance<\/th>/);
    assert.match(html, /<th>Abnormal Attendance<\/th>/);
    assert.match(html, /<th>Total<\/th>/);
    assert.match(html, /<th>Absence Rate<\/th>/);
    assert.match(html, /<th>Late Attendance Rate<\/th>/);

    // Software BU total = 4 across both sessions (1 Attend on Time, 1 Absent, 1 Delay, 1 Fake Attendance)
    assert.match(html, /<strong>Software BU<\/strong>/);
    assert.match(html, /<td class="num absent">1<\/td>/);
    assert.match(html, /<td class="num ontime">1<\/td>/);
    assert.match(html, /<td class="num delay">1<\/td>/);
    assert.match(html, /<td class="num fake">1<\/td>/);
    assert.match(html, /<td class="num" style="font-weight:700">4<\/td>/);
    assert.match(html, /<td class="num absent-rate"[^>]*>25\.0%<\/td>/);
    assert.match(html, /<td class="num delay-rate"[^>]*>25\.0%<\/td>/);

    // Hardware BU total = 1 (1 Attend on Time)
    assert.match(html, /<strong>Hardware BU<\/strong>/);

    // Footer Total
    assert.match(html, /<td>Total<\/td>/);
    assert.match(html, /<td class="num" style="font-weight:700">5<\/td>/);
});

test('renderAttendanceDashboard also renders exact English headers for single session view', () => {
    const api = loadMeetingAttendance('zh');
    const rows = [
        { name: '赵六', account: 'z20001', bu: 'Network BU', attendance: 'Absent' },
        { name: '钱七', account: 'q20002', bu: 'Network BU', attendance: 'Attend on Time' }
    ];

    const html = api.renderAttendanceDashboard(rows);

    assert.match(html, /<th>BU Name<\/th>/);
    assert.match(html, /<th>Absent<\/th>/);
    assert.match(html, /<th>Attend on Time<\/th>/);
    assert.match(html, /<th>Late Attendance<\/th>/);
    assert.match(html, /<th>Abnormal Attendance<\/th>/);
    assert.match(html, /<th>Total<\/th>/);
    assert.match(html, /<th>Absence Rate<\/th>/);
    assert.match(html, /<th>Late Attendance Rate<\/th>/);
    assert.match(html, /<td>Total<\/td>/);
    assert.match(html, /50\.0%/);
});
