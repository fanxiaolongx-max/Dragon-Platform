const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const metricsPath = path.join(__dirname, '..', 'frontend', 'js', 'sla', 'metrics.js');
const metricsSource = fs.readFileSync(metricsPath, 'utf8');

function createMockDom() {
    class MockClassList {
        constructor() {
            this.classes = new Set();
        }
        add(...names) {
            names.forEach(n => this.classes.add(n));
        }
        remove(...names) {
            names.forEach(n => this.classes.delete(n));
        }
        contains(name) {
            return this.classes.has(name);
        }
        toggle(name, force) {
            if (force === true) {
                this.classes.add(name);
                return true;
            }
            if (force === false) {
                this.classes.delete(name);
                return false;
            }
            if (this.classes.has(name)) {
                this.classes.delete(name);
                return false;
            }
            this.classes.add(name);
            return true;
        }
    }

    class MockElement {
        constructor(tagName, id = '', className = '') {
            this.tagName = tagName.toUpperCase();
            this.id = id;
            this.classList = new MockClassList();
            if (className) {
                className.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
            }
            this.children = [];
            this.parentNode = null;
            this.style = {};
            this.dataset = {};
            this.innerHTML = '';
            this.textContent = '';
            this.scrollWidth = 1000;
            this.clientWidth = 500;
            this.scrollLeft = 0;
            this._listeners = {};
        }

        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        }

        closest(selector) {
            let cur = this;
            while (cur) {
                if (selector.startsWith('.') && cur.classList.contains(selector.slice(1))) {
                    return cur;
                }
                if (selector.startsWith('#') && cur.id === selector.slice(1)) {
                    return cur;
                }
                cur = cur.parentNode;
            }
            return null;
        }

        querySelector(selector) {
            const all = this.querySelectorAll(selector);
            return all.length ? all[0] : null;
        }

        querySelectorAll(selector) {
            const results = [];
            function walk(node) {
                node.children.forEach(c => {
                    let match = false;
                    if (selector.startsWith('.') && c.classList.contains(selector.slice(1))) {
                        match = true;
                    } else if (selector.includes('.sub-metrics-list.open') && c.classList.contains('sub-metrics-list') && c.classList.contains('open')) {
                        match = true;
                    } else if (selector.includes('sub-metrics-list') && c.classList.contains('sub-metrics-list')) {
                        if (selector.includes('display: block') && c.style.display === 'block') {
                            match = true;
                        } else if (!selector.includes('display: block')) {
                            match = true;
                        }
                    }
                    if (match) results.push(c);
                    walk(c);
                });
            }
            walk(this);
            return results;
        }

        addEventListener(evt, fn) {
            this._listeners[evt] = this._listeners[evt] || [];
            this._listeners[evt].push(fn);
        }

        scrollIntoView() {}
    }

    const bar = new MockElement('div', 'global-sticky-bar');
    const title = new MockElement('div', '', 'sticky-bar-title');
    const content = new MockElement('div', 'sticky-bar-content');
    const btnTarget = new MockElement('button', 'btn-target-config');
    const btnExpand = new MockElement('button', 'btn-expand-metrics');

    bar.appendChild(title);
    bar.appendChild(content);
    bar.appendChild(btnTarget);
    bar.appendChild(btnExpand);

    const doc = {
        getElementById(id) {
            if (id === 'global-sticky-bar') return bar;
            if (id === 'sticky-bar-content') return content;
            if (id === 'btn-target-config') return btnTarget;
            if (id === 'btn-expand-metrics') return btnExpand;
            return null;
        },
        querySelector(sel) {
            if (sel === '.sticky-bar-title') return title;
            return null;
        },
        addEventListener() {}
    };

    return { bar, content, title, btnExpand, btnTarget, doc, MockElement };
}

test('toggleMetricSub expands down-arrow item, adds sub-expanded to global sticky bar, and collapses smoothly back', () => {
    const { bar, content, doc, MockElement } = createMockDom();

    // Create sandbox context
    const context = {
        document: doc,
        window: {},
        escapeHTML: str => String(str || ''),
        SLAT: (key, args) => key,
        getSLATargetMonth: () => '2026-10',
        Intl,
        requestAnimationFrame: () => {}
    };
    context.window = context;

    vm.runInNewContext(metricsSource, context);

    // Setup an info-group with sub-metrics
    const group = new MockElement('div', '', 'info-group');
    const item = new MockElement('div', '', 'info-item');
    item.dataset.metricKey = 'sec1_rule1';

    const header = new MockElement('div');
    const btn = new MockElement('span', '', 'metric-sub-toggle-btn');
    btn.innerHTML = '🔽';
    header.appendChild(btn);

    const list = new MockElement('div', '', 'sub-metrics-list');
    list.style.display = 'none';

    item.appendChild(header);
    item.appendChild(list);
    group.appendChild(item);
    content.appendChild(group);

    // 1. Initially, bar has no sub-expanded class
    assert.equal(bar.classList.contains('sub-expanded'), false);
    assert.equal(list.style.display, 'none');

    // 2. Click down-arrow to expand
    context.toggleMetricSub(btn);

    assert.equal(list.style.display, 'block');
    assert.equal(list.classList.contains('open'), true);
    assert.equal(item.classList.contains('sub-open'), true);
    assert.equal(group.classList.contains('sub-open'), true);
    assert.equal(btn.innerHTML, '🔼');
    assert.equal(bar.classList.contains('sub-expanded'), true, 'global sticky bar should have sub-expanded class when sub-metrics are opened');
    assert.equal(context.window.expandedSubMetrics.has('sec1_rule1'), true);

    // 3. Click up-arrow to collapse
    context.toggleMetricSub(btn);

    assert.equal(list.style.display, 'none');
    assert.equal(list.classList.contains('open'), false);
    assert.equal(item.classList.contains('sub-open'), false);
    assert.equal(group.classList.contains('sub-open'), false);
    assert.equal(btn.innerHTML, '🔽');
    assert.equal(bar.classList.contains('sub-expanded'), false, 'global sticky bar should remove sub-expanded class and restore original height');
    assert.equal(context.window.expandedSubMetrics.has('sec1_rule1'), false);
});

test('multiple sub-metrics keep sub-expanded until all are collapsed', () => {
    const { bar, content, doc, MockElement } = createMockDom();

    const context = {
        document: doc,
        window: {},
        escapeHTML: str => String(str || ''),
        SLAT: (key, args) => key,
        getSLATargetMonth: () => '2026-10',
        Intl,
        requestAnimationFrame: () => {}
    };
    context.window = context;

    vm.runInNewContext(metricsSource, context);

    function createMetricItem(key) {
        const group = new MockElement('div', '', 'info-group');
        const item = new MockElement('div', '', 'info-item');
        item.dataset.metricKey = key;

        const header = new MockElement('div');
        const btn = new MockElement('span', '', 'metric-sub-toggle-btn');
        btn.innerHTML = '🔽';
        header.appendChild(btn);

        const list = new MockElement('div', '', 'sub-metrics-list');
        list.style.display = 'none';

        item.appendChild(header);
        item.appendChild(list);
        group.appendChild(item);
        content.appendChild(group);
        return { group, item, btn, list };
    }

    const item1 = createMetricItem('rule_a');
    const item2 = createMetricItem('rule_b');

    // Open item 1
    context.toggleMetricSub(item1.btn);
    assert.equal(bar.classList.contains('sub-expanded'), true);

    // Open item 2
    context.toggleMetricSub(item2.btn);
    assert.equal(bar.classList.contains('sub-expanded'), true);

    // Close item 1 -> item 2 still open, bar must STAY sub-expanded!
    context.toggleMetricSub(item1.btn);
    assert.equal(item1.list.style.display, 'none');
    assert.equal(item2.list.style.display, 'block');
    assert.equal(bar.classList.contains('sub-expanded'), true, 'bar should stay sub-expanded while item 2 is still open');

    // Close item 2 -> all items closed, bar must restore
    context.toggleMetricSub(item2.btn);
    assert.equal(item2.list.style.display, 'none');
    assert.equal(bar.classList.contains('sub-expanded'), false, 'bar should restore when all items are closed');
});
