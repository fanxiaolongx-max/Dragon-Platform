const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const historyJsPath = path.join(__dirname, '..', 'frontend', 'js', 'sla', 'history.js');
const historySource = fs.readFileSync(historyJsPath, 'utf8');

function createMockDom() {
    class MockElement {
        constructor(tagName = 'div', id = '', className = '') {
            this.tagName = tagName.toUpperCase();
            this.id = id;
            this.className = className;
            this.children = [];
            this.style = {
                setProperty: (k, v) => { this.style[k] = v; }
            };
            this.dataset = {};
            this._innerHTML = '';
            this.textContent = '';
            this.attributes = {};
            this._listeners = {};
        }

        get innerHTML() {
            return this._innerHTML;
        }

        set innerHTML(val) {
            this._innerHTML = String(val);
            this.children = [];
        }

        setAttribute(name, value) {
            this.attributes[name] = String(value);
        }

        getAttribute(name) {
            return this.attributes[name] || null;
        }

        querySelector(sel) {
            if (sel === '#history-feather-loader') {
                if (this._innerHTML.includes('id="history-feather-loader"')) {
                    const el = new MockElement('div', 'history-feather-loader');
                    el._innerHTML = this._innerHTML;
                    return el;
                }
                return null;
            }
            if (sel === '[data-startup-feather]') {
                return new MockElement('div', '', 'startup-feather');
            }
            if (sel === '#history-feather-track') {
                return new MockElement('div', 'history-feather-track');
            }
            if (sel === '#history-feather-percent') {
                return new MockElement('strong', 'history-feather-percent');
            }
            if (sel === '#history-feather-step-count') {
                return new MockElement('span', 'history-feather-step-count');
            }
            if (sel === '#history-feather-msg') {
                return new MockElement('p', 'history-feather-msg');
            }
            if (sel.startsWith('[data-step=')) {
                return new MockElement('div');
            }
            if (sel.includes('data-history-scroll-')) {
                const el = new MockElement('div');
                el.setAttribute = () => {};
                return el;
            }
            if (sel.includes('history-table-wrapper')) {
                return new MockElement('div', '', 'history-table-wrapper');
            }
            return null;
        }

        querySelectorAll(sel) {
            return [];
        }

        addEventListener(ev, fn) {
            if (!this._listeners[ev]) this._listeners[ev] = [];
            this._listeners[ev].push(fn);
        }

        removeEventListener(ev, fn) {
            if (!this._listeners[ev]) return;
            this._listeners[ev] = this._listeners[ev].filter(f => f !== fn);
        }
    }

    const elements = new Map();
    const doc = {
        createElement(tag) {
            return new MockElement(tag);
        },
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, new MockElement('div', id));
            }
            return elements.get(id);
        },
        querySelector(sel) {
            if (sel.startsWith('#')) return doc.getElementById(sel.slice(1));
            return null;
        },
        querySelectorAll() {
            return [];
        },
        body: new MockElement('body')
    };

    return { doc, elements };
}

function createEnv() {
    const { doc, elements } = createMockDom();
    const mockModal = doc.getElementById('history-modal');
    const mockList = doc.getElementById('history-modal-list');
    const mockPagination = doc.getElementById('history-pagination-bar');
    const mockScroll = doc.getElementById('history-horizontal-scroll');

    const sandbox = {
        console,
        document: doc,
        window: {
            addEventListener: () => {},
            ToolsI18n: {
                getLanguage: () => 'zh-CN'
            },
            ToolsStartup: {
                feather: (container) => {
                    const el = container.querySelector('[data-startup-feather]');
                    if (el) el.innerHTML = '<svg viewBox="0 0 180 205" data-test-feather="1"></svg>';
                }
            }
        },
        escapeHTML: str => String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
        SLAT: (key, params = {}) => {
            if (key === 'sla.history.stepSnapshots') return '读取历史快照记录';
            if (key === 'sla.history.stepConfig') return '加载预警目标与格式配置';
            if (key === 'sla.history.stepCatalog') return '检索原始文件存档清单';
            if (key === 'sla.history.stepRender') return '渲染分页数据与指标视图';
            if (key === 'sla.history.stepCount') return `${params.settled} / ${params.total} 个步骤`;
            if (key === 'sla.history.stepReady') return '完成';
            if (key === 'sla.history.stepRunning') return '正在加载';
            if (key === 'sla.history.stepWaiting') return '等待';
            if (key === 'sla.history.paginationSummary') return `共 ${params.total} 条快照 · 展示第 ${params.start} - ${params.end} 条`;
            if (key === 'sla.history.paginationSummaryAll') return `共 ${params.total} 条快照 · 展示全部记录`;
            if (key === 'sla.history.pageSizeLabel') return '每页展示：';
            if (key === 'sla.history.pageSizeDefault') return '10 条 / 页 (默认)';
            if (key === 'sla.history.pageSizeUnit') return `${params.size} 条 / 页`;
            if (key === 'sla.history.pageSizeAll') return '全部展示';
            if (key === 'sla.history.featherLoading') return '正在准备历史预警快照…';
            if (key === 'sla.history.empty') return '暂无历史快照记录。请先使用上方按钮导入表格数据以生成。';
            return key;
        },
        API: {
            getSourceMode: () => 'auto',
            get: async (url) => {
                if (url.includes('/api/sla/snapshots')) return [];
                if (url.includes('/api/sla/config')) return {};
                if (url.includes('/api/upload/source-catalog')) return { files: [] };
                return null;
            }
        },
        showToast: () => {},
        requestAnimationFrame: fn => setTimeout(fn, 0),
        cancelAnimationFrame: id => clearTimeout(id),
        ResizeObserver: class {
            observe() {}
            disconnect() {}
        }
    };

    sandbox.window.document = doc;
    vm.createContext(sandbox);
    vm.runInContext(historySource, sandbox);

    return { sandbox, doc, mockModal, mockList, mockPagination, mockScroll };
}

test('SLA snapshot pagination defaults to 10 records and slices on-demand', () => {
    const { sandbox, mockList, mockPagination } = createEnv();

    // Create 25 mock snapshots
    const mockSnapshots = Array.from({ length: 25 }, (_, i) => ({
        id: `snap-${i + 1}`,
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        files: ['test.xlsx'],
        topMetrics: [
            { label: '整改完成率', value: '98%', isWarn: false },
            { label: '逾期任务数', value: i, isWarn: i > 0 }
        ],
        summary: []
    }));

    // Render with 25 snapshots
    sandbox.window.renderHistory(mockSnapshots);

    // 1. Pagination bar should be visible
    assert.strictEqual(mockPagination.style.display, 'flex');

    // 2. Summary text should state: "共 25 条快照 · 展示第 1 - 10 条"
    assert.ok(mockPagination.innerHTML.includes('共 25 条快照 · 展示第 1 - 10 条'), 'Summary should display range 1 - 10');

    // 3. Default page size dropdown should have value="10" selected
    assert.ok(mockPagination.innerHTML.includes('value="10" selected'), '10 records per page should be selected by default');

    // 4. In mockList HTML, only 10 snapshot rows (snap-1 to snap-10) should be rendered
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-1\')'), 'snap-1 should be on page 1');
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-10\')'), 'snap-10 should be on page 1');
    assert.ok(!mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-11\')'), 'snap-11 should NOT be on page 1');
    assert.ok(!mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-25\')'), 'snap-25 should NOT be on page 1');

    // 5. Navigate to page 2
    sandbox.window.gotoHistoryPage(2);

    assert.ok(mockPagination.innerHTML.includes('共 25 条快照 · 展示第 11 - 20 条'), 'Page 2 summary should show 11 - 20');
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-11\')'), 'snap-11 should be on page 2');
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-20\')'), 'snap-20 should be on page 2');
    assert.ok(!mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-1\')'), 'snap-1 should NOT be on page 2');
    assert.ok(!mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-25\')'), 'snap-25 should NOT be on page 2');

    // 6. Navigate to page 3
    sandbox.window.gotoHistoryPage(3);
    assert.ok(mockPagination.innerHTML.includes('共 25 条快照 · 展示第 21 - 25 条'), 'Page 3 summary should show 21 - 25');
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-21\')'), 'snap-21 should be on page 3');
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-25\')'), 'snap-25 should be on page 3');
});

test('SLA snapshot pagination page size can be changed to 20, 50, or all', () => {
    const { sandbox, mockList, mockPagination } = createEnv();

    const mockSnapshots = Array.from({ length: 25 }, (_, i) => ({
        id: `snap-${i + 1}`,
        timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        files: ['test.xlsx'],
        topMetrics: [{ label: '指标A', value: '10' }]
    }));
    sandbox.window.renderHistory(mockSnapshots);

    // Change page size to 20
    sandbox.window.setHistoryPageSize(20);
    assert.ok(mockPagination.innerHTML.includes('共 25 条快照 · 展示第 1 - 20 条'));
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-1\')'));
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-20\')'));
    assert.ok(!mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-21\')'));

    // Change page size to 'all'
    sandbox.window.setHistoryPageSize('all');
    assert.ok(mockPagination.innerHTML.includes('共 25 条快照 · 展示全部记录'));
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-1\')'));
    assert.ok(mockList.innerHTML.includes('deleteHistorySnapshot(\'snap-25\')'));
});

test('SLA snapshot feather loading state renders vector feather art and step progress bar', () => {
    const { sandbox, mockList } = createEnv();

    // Trigger feather loading state
    sandbox.window.renderHistoryLoadingState(mockList, 'snapshots', 25);

    // Check feather loading structure
    assert.ok(mockList.innerHTML.includes('history-feather-loader'), 'Feather loader container should exist');
    assert.ok(mockList.innerHTML.includes('startup-art'), 'Startup art container should exist');
    assert.ok(mockList.innerHTML.includes('startup-feather'), 'Startup feather container should exist');
    assert.ok(mockList.innerHTML.includes('startup-halo'), 'Startup halo element should exist');
    assert.ok(mockList.innerHTML.includes('history-feather-track'), 'Track element should exist');
    assert.ok(mockList.innerHTML.includes('history-feather-steps'), 'Steps list should exist');
    assert.ok(mockList.innerHTML.includes('读取历史快照记录'), 'Step 1 label should exist');
    assert.ok(mockList.innerHTML.includes('渲染分页数据与指标视图'), 'Step 4 label should exist');

    // Progressing to 100%
    sandbox.window.renderHistoryLoadingState(mockList, 'render', 100);
});

test('SLA snapshot pagination clamps out-of-range page numbers', () => {
    const { sandbox, mockList, mockPagination } = createEnv();

    const mockSnapshots = Array.from({ length: 15 }, (_, i) => ({
        id: `snap-${i + 1}`,
        timestamp: new Date().toISOString(),
        files: ['test.xlsx'],
        topMetrics: []
    }));
    sandbox.window.renderHistory(mockSnapshots);

    // Negative page should clamp to 1
    sandbox.window.gotoHistoryPage(-5);
    assert.ok(mockPagination.innerHTML.includes('展示第 1 - 10 条'));

    // Huge page number should clamp to max page (2)
    sandbox.window.gotoHistoryPage(999);
    assert.ok(mockPagination.innerHTML.includes('展示第 11 - 15 条'));
});

test('SLA empty snapshot list hides pagination bar and shows empty notice', () => {
    const { sandbox, mockList, mockPagination } = createEnv();

    sandbox.window.renderHistory([]);
    assert.strictEqual(mockPagination.style.display, 'none');
    assert.ok(mockList.innerHTML.includes('暂无历史快照记录'));
});

