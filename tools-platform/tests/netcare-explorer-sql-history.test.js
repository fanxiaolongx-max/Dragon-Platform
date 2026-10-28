const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const jsSource = fs.readFileSync(path.join(__dirname, '../frontend/js/netcare-explorer.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '../frontend/css/netcare-explorer.css'), 'utf8');

function createExplorerContext(initialStorage = {}) {
    const storage = new Map(Object.entries(initialStorage));
    const listeners = {};
    const rootEl = {
        innerHTML: '',
        style: { setProperty() {} },
        querySelector: (sel) => {
            if (sel === '[data-nx="sql"]') return rootEl._textarea;
            if (sel === '[data-nx-role="sql-history"]') return rootEl._historySection;
            return null;
        },
        querySelectorAll: () => [],
        addEventListener: (evt, handler) => { listeners[evt] = handler; }
    };
    rootEl._textarea = {
        value: '',
        classList: {
            remove() {},
            add() {}
        },
        focus() { rootEl._textarea.focused = true; },
        scrollIntoView() { rootEl._textarea.scrolled = true; }
    };

    const windowMock = {
        addEventListener: () => {},
        showToast: (msg, type) => { windowMock.toasts.push({ msg, type }); },
        toasts: [],
        AppDialog: {
            confirm: async () => true
        }
    };

    const documentMock = {
        getElementById: (id) => id === 'nxApp' ? rootEl : null,
        createElement: (tag) => ({
            innerHTML: '',
            firstElementChild: null,
            lastElementChild: null,
            replaceWith(el) {}
        }),
        body: { classList: { add() {}, remove() {} } }
    };

    const localStorageMock = {
        getItem: (k) => storage.has(k) ? storage.get(k) : null,
        setItem: (k, v) => storage.set(k, String(v)),
        removeItem: (k) => storage.delete(k)
    };

    const sandbox = {
        window: windowMock,
        document: documentMock,
        localStorage: localStorageMock,
        sessionStorage: localStorageMock,
        fetch: async () => ({ ok: true, json: async () => ({ tables: [] }) }),
        setTimeout: (fn) => fn(),
        clearTimeout: () => {},
        Date,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        JSON,
        Set,
        performance: { now: () => 100 }
    };

    vm.createContext(sandbox);
    vm.runInContext(jsSource, sandbox);

    return {
        context: sandbox,
        window: windowMock,
        storage,
        root: rootEl,
        api: sandbox.window.__NetCareExplorer
    };
}

test('SQL history helper methods and state initialization', () => {
    const { api } = createExplorerContext();
    assert.ok(api, '__NetCareExplorer should be exposed');
    assert.equal(api.state.sqlHistory.length, 0);
    assert.equal(api.state.sqlHistoryPage, 1);
    assert.equal(api.state.sqlHistoryPageSize, 10);
    assert.equal(api.state.sqlHistoryScope, 'all');
});

test('SQL history loads existing entries from localStorage and handles corruption', () => {
    const mockList = [
        { id: '1', sql: 'SELECT * FROM test', createdAt: 1700000000000, scope: 'business', status: 'success', durationMs: 42, rowCount: 10 }
    ];
    const { api } = createExplorerContext({
        netcare_explorer_sql_history_v1: JSON.stringify(mockList)
    });
    assert.equal(api.state.sqlHistory.length, 1);
    assert.equal(api.state.sqlHistory[0].sql, 'SELECT * FROM test');

    // Test corrupted JSON
    const { api: apiCorrupt } = createExplorerContext({
        netcare_explorer_sql_history_v1: '{ corrupt json'
    });
    assert.equal(apiCorrupt.state.sqlHistory.length, 0);
});

test('recordSqlHistory prepends entries, caps at 100 items and resets page to 1', () => {
    const { api, storage } = createExplorerContext();

    for (let i = 1; i <= 105; i++) {
        api.recordSqlHistory({
            id: 'h_' + i,
            sql: `SELECT ${i}`,
            scope: i % 2 === 0 ? 'business' : 'app',
            createdAt: Date.now() + i,
            status: 'success',
            durationMs: 10 + i,
            rowCount: i
        });
    }

    assert.equal(api.state.sqlHistory.length, 100, 'History should cap at MAX_SQL_HISTORY (100)');
    assert.equal(api.state.sqlHistory[0].sql, 'SELECT 105', 'Latest query should be at index 0');
    assert.equal(api.state.sqlHistoryPage, 1, 'Page should reset to 1');

    const saved = JSON.parse(storage.get('netcare_explorer_sql_history_v1'));
    assert.equal(saved.length, 100);
    assert.equal(saved[0].sql, 'SELECT 105');
});

test('getFilteredSqlHistory filters by keyword, scope and table', () => {
    const { api } = createExplorerContext();
    api.recordSqlHistory({ id: 'h1', sql: 'SELECT * FROM common_data_rep', scope: 'business', table: 'common_data_rep', status: 'success' });
    api.recordSqlHistory({ id: 'h2', sql: 'SELECT * FROM t_report_template', scope: 'app', table: 't_report_template', status: 'success' });
    api.recordSqlHistory({ id: 'h3', sql: 'SELECT count(1) FROM op_ioc_alarm_d_dws', scope: 'business', table: 'op_ioc_alarm', status: 'error', error: 'syntax error' });

    // 1. All
    api.state.sqlHistoryScope = 'all';
    api.state.sqlHistoryFilter = '';
    assert.equal(api.getFilteredSqlHistory().length, 3);

    // 2. By scope
    api.state.sqlHistoryScope = 'app';
    assert.equal(api.getFilteredSqlHistory().length, 1);
    assert.equal(api.getFilteredSqlHistory()[0].id, 'h2');

    api.state.sqlHistoryScope = 'business';
    assert.equal(api.getFilteredSqlHistory().length, 2);

    // 3. By keyword in sql
    api.state.sqlHistoryScope = 'all';
    api.state.sqlHistoryFilter = 'template';
    assert.equal(api.getFilteredSqlHistory().length, 1);
    assert.equal(api.getFilteredSqlHistory()[0].id, 'h2');

    // 4. By keyword in error
    api.state.sqlHistoryFilter = 'syntax';
    assert.equal(api.getFilteredSqlHistory().length, 1);
    assert.equal(api.getFilteredSqlHistory()[0].id, 'h3');
});

test('renderSqlHistory displays history items, status, action buttons, and pagination', () => {
    const { api } = createExplorerContext();

    // Empty state
    let html = api.renderSqlHistory();
    assert.match(html, /暂无执行记录/);

    // Add 12 items
    for (let i = 1; i <= 12; i++) {
        api.recordSqlHistory({
            id: 'item_' + i,
            sql: `SELECT * FROM table_${i}`,
            scope: 'business',
            createdAt: 1700000000000 + i * 1000,
            status: i === 1 ? 'error' : 'success',
            durationMs: 25,
            rowCount: i * 5,
            error: i === 1 ? 'Table not found' : null
        });
    }

    // Default pageSize = 10 -> page 1 has 10 items, total 12
    api.state.sqlHistoryPageSize = 10;
    api.state.sqlHistoryPage = 1;
    html = api.renderSqlHistory();

    assert.match(html, /最近 12 次/);
    assert.match(html, /第 1 \/ 2 页 · 共 12 条/);
    assert.match(html, /data-nx-action="apply-sql-history"/);
    assert.match(html, /data-nx-action="copy-sql-history"/);
    assert.match(html, /data-nx-action="delete-sql-history"/);
    assert.match(html, /一键填入/);

    // Page 2 (contains item_1 with error)
    api.state.sqlHistoryPage = 2;
    const htmlPage2 = api.renderSqlHistory();
    assert.match(htmlPage2, /第 2 \/ 2 页 · 共 12 条/);
    assert.match(htmlPage2, /Table not found/);

    // Change pageSize to 5 -> 3 pages
    api.state.sqlHistoryPageSize = 5;
    api.state.sqlHistoryPage = 1;
    const htmlPageSize5 = api.renderSqlHistory();
    assert.match(htmlPageSize5, /第 1 \/ 3 页 · 共 12 条/);
});

test('applySqlToEditor sets sqlText, updates textarea, focuses and flashes highlight', () => {
    const { api, root, window } = createExplorerContext();
    const query = 'SELECT col1, col2 FROM my_table WHERE active = 1';

    api.applySqlToEditor(query);

    assert.equal(api.state.sqlText, query);
    assert.equal(root._textarea.value, query);
    assert.equal(root._textarea.focused, true);
    assert.equal(root._textarea.scrolled, true);
    assert.ok(window.toasts.some(t => t.msg.includes('SQL')));
});

test('netcare-explorer.css includes all required styling rules for SQL history', () => {
    assert.match(cssSource, /\.nx-history-section/);
    assert.match(cssSource, /\.nx-history-header/);
    assert.match(cssSource, /\.nx-history-title/);
    assert.match(cssSource, /\.nx-history-count/);
    assert.match(cssSource, /\.nx-history-toolbar/);
    assert.match(cssSource, /\.nx-history-pagesize/);
    assert.match(cssSource, /\.nx-history-item/);
    assert.match(cssSource, /\.nx-history-sql/);
    assert.match(cssSource, /\.nx-history-pagination/);
    assert.match(cssSource, /\.nx-flash-highlight/);
});
