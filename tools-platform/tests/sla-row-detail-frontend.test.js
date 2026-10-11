const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('SLARowDetail client-side logic tests', async t => {
    // 1. Load row-detail.js content
    const code = fs.readFileSync(path.join(__dirname, '../frontend/js/sla/row-detail.js'), 'utf8');

    // 2. Setup mock browser environment
    const documentListeners = {};
    const elements = {};
    const createdElements = [];

    const mockDocument = {
        readyState: 'complete',
        createElement(tag) {
            const el = {
                tagName: tag,
                id: '',
                className: '',
                style: {},
                dataset: {},
                _innerHTML: '',
                get innerHTML() { return this._innerHTML; },
                set innerHTML(val) {
                    this._innerHTML = val;
                    // Extract IDs from innerHTML into elements map
                    const idMatches = String(val).matchAll(/id="([^"]+)"/g);
                    for (const m of idMatches) {
                        const childId = m[1];
                        if (!elements[childId]) {
                            elements[childId] = mockDocument.createElement('div');
                            elements[childId].id = childId;
                        }
                    }
                },
                classList: {
                    add(cls) { if (!this._classes.includes(cls)) this._classes.push(cls); },
                    remove(cls) { this._classes = this._classes.filter(c => c !== cls); },
                    contains(cls) { return this._classes.includes(cls); },
                    _classes: []
                },
                _listeners: {},
                addEventListener(evt, fn) {
                    if (!this._listeners[evt]) this._listeners[evt] = [];
                    this._listeners[evt].push(fn);
                },
                setAttribute(k, v) { this[k] = v; },
                focus() {},
                select() {},
                matches() { return false; },
                querySelector(sel) {
                    return this._children ? this._children.find(c => sel.includes(c.className)) : null;
                }
            };
            createdElements.push(el);
            return el;
        },
        getElementById(id) {
            return elements[id] || null;
        },
        execCommand() { return true; },
        body: {
            appendChild(el) {
                if (el.id) elements[el.id] = el;
            },
            removeChild() {}
        },
        addEventListener(evt, fn) {
            if (!documentListeners[evt]) documentListeners[evt] = [];
            documentListeners[evt].push(fn);
        }
    };

    let postedData = [];
    const mockAPI = {
        get: async (url) => {
            if (url.includes('rectification')) {
                return {
                    success: true,
                    tableType: 'rectification',
                    frequentFields: ['task_id', 'task_status'],
                    fieldCounts: { 'task_id': 10, 'task_status': 5 }
                };
            }
            return { success: true, frequentFields: [], fieldCounts: {} };
        },
        post: async (url, data) => {
            postedData.push({ url, data });
            return { success: true };
        }
    };

    const mockWindow = {
        document: mockDocument,
        API: mockAPI,
        escapeHTML: str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        showToast: () => {},
        AppState: {
            rectification: {
                mode: 'rectification',
                title: '🔧 整改详单合集',
                orderedHeaders: ['task_id', 'task_status', 'task_owner', 'empty_col_1', 'empty_col_2', 'plan_date', 'source_name'],
                currentDisplayData: [
                    {
                        task_id: 'RECT-2026-001',
                        task_status: 'Checking',
                        task_owner: '张三',
                        empty_col_1: '',
                        empty_col_2: null,
                        plan_date: '2026-10-30',
                        source_name: '  Orange E\n  Egypt for Telecommunications  ',
                        _slaText: '超期 3 天',
                        _rowClass: 'danger-row'
                    }
                ]
            }
        }
    };

    // Execute script in mock context
    const fn = new Function('window', 'document', 'API', 'escapeHTML', code);
    fn(mockWindow, mockDocument, mockAPI, mockWindow.escapeHTML);

    const SLARowDetail = mockWindow.SLARowDetail;
    assert.ok(SLARowDetail, 'SLARowDetail should be defined on window');

    // Test fetch & caching
    const fetched = await SLARowDetail.fetchCopiedFields('rectification');
    assert.deepEqual(fetched.frequentFields, ['task_id', 'task_status']);
    assert.equal(SLARowDetail.getFieldCopyCount('rectification', 'task_id'), 10);
    assert.equal(SLARowDetail.getFieldCopyCount('rectification', 'task_status'), 5);

    // Test recording a copy
    await SLARowDetail.recordFieldCopy('rectification', 'task_id');
    assert.equal(SLARowDetail.getFieldCopyCount('rectification', 'task_id'), 11);
    assert.equal(postedData.length, 1);
    assert.equal(postedData[0].data.fieldName, 'task_id');

    // Test header prioritization
    const originalHeaders = ['plan_date', 'task_status', 'task_id', 'other_col'];
    const prioritized = SLARowDetail.prioritizeHeadersWithFrequent('rectification', originalHeaders);
    // task_id has 11 copies, task_status has 5 -> task_id first, then task_status, then others
    assert.equal(prioritized[0], 'task_id');
    assert.equal(prioritized[1], 'task_status');
    assert.equal(prioritized[2], 'plan_date');
    assert.equal(prioritized[3], 'other_col');

    // Test modal open and DOM render
    await SLARowDetail.open('rectification', 0);
    const modal = elements['sla-row-detail-modal'];
    assert.ok(modal, 'Modal overlay DOM should be created and attached to body');
    assert.equal(modal.style.display, 'flex');

    const bodyEl = elements['sla-row-detail-body'];
    assert.ok(bodyEl, 'Modal body element should exist');
    assert.ok(bodyEl.innerHTML.includes('RECT-2026-001'), 'Modal body should render row values');
    assert.ok(bodyEl.innerHTML.includes('⭐ 常用 (11次)'), 'Frequent field should display star and copy count');
    assert.ok(!bodyEl.innerHTML.includes('empty_col_1'), 'Empty fields should be automatically hidden by default');
    assert.ok(bodyEl.innerHTML.includes('>Orange E Egypt for Telecommunications</div>'), 'Imported whitespace should be compact in the detail view');
    assert.equal(mockWindow.AppState.rectification.currentDisplayData[0].source_name, '  Orange E\n  Egypt for Telecommunications  ', 'Original value should remain available for copying');

    // Test copy button feedback
    const mockBtn = mockDocument.createElement('button');
    mockBtn.innerHTML = '📋';
    mockBtn.closest = () => null;
    mockWindow.navigator = { clipboard: { writeText: async () => {} } };
    await SLARowDetail.handleCopy('task_id', mockBtn);
    assert.ok(mockBtn.innerHTML.includes('已复制'), 'Button text should display copy feedback');
    assert.ok(mockBtn.innerHTML.includes('sla-copy-check'), 'Button should include checkmark element');
    assert.ok(mockBtn.classList.contains('copied'), 'Button should have copied class');

    // Verify sla.css contains auto grid and nowrap for copy button
    const css = fs.readFileSync(path.join(__dirname, '../frontend/css/sla.css'), 'utf8');
    assert.ok(css.includes('grid-template-columns: minmax(95px, 130px) minmax(0, 1fr) auto;'), 'sla-detail-field-item grid should end with auto');
    assert.ok(css.includes('.sla-detail-copy-btn.copied') && css.includes('white-space: nowrap;'), 'copied button must have white-space: nowrap');
});

