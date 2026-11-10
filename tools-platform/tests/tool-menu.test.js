const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createDOM() {
    const docListeners = {};
    const winListeners = {};
    const elements = [];

    class Element {
        constructor(tagName = 'div') {
            this.tagName = tagName.toUpperCase();
            this.classList = {
                classes: new Set(),
                add: cls => this.classList.classes.add(cls),
                remove: cls => this.classList.classes.delete(cls),
                contains: cls => this.classList.classes.has(cls),
                clear: () => this.classList.classes.clear(),
                toggle: (cls, force) => {
                    if (force !== undefined) {
                        if (force) this.classList.classes.add(cls);
                        else this.classList.classes.delete(cls);
                        return force;
                    }
                    const has = this.classList.classes.has(cls);
                    if (has) this.classList.classes.delete(cls);
                    else this.classList.classes.add(cls);
                    return !has;
                }
            };
            this.attributes = {};
            this.dataset = {};
            this.style = {};
            this.children = [];
            this.parentNode = null;
            this.listeners = {};
            this._innerHTML = '';
        }
        click() {
            this.dispatchEvent({ type: 'click' });
        }
        get className() { return [...this.classList.classes].join(' '); }
        set className(val) {
            this.classList.classes.clear();
            String(val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList.classes.add(c));
        }
        get innerHTML() { return this._innerHTML; }
        set innerHTML(html) {
            this._innerHTML = html;
            this.children = [];
            // 简单解析 button / div / span
            const tagMatches = [...html.matchAll(/<(button|div|span|a)\b([^>]*)>(.*?)<\/\1>|<div\b([^>]*)\/?>/gis)];
            for (const match of tagMatches) {
                const tag = match[1] || 'div';
                const attrs = match[2] || match[4] || '';
                const inner = match[3] || '';
                const child = new Element(tag);
                child.parentNode = this;
                const attrMatches = [...attrs.matchAll(/([a-zA-Z0-9\-_:]+)(?:=["']([^"']*)["'])?/g)];
                for (const am of attrMatches) {
                    const attrName = am[1];
                    const attrVal = am[2] ?? '';
                    child.setAttribute(attrName, attrVal);
                    if (attrName.startsWith('data-')) {
                        const dataKey = attrName.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
                        child.dataset[dataKey] = attrVal;
                    }
                }
                child.innerHTML = inner;
                this.children.push(child);
            }
        }
        get textContent() {
            return this.children.length ? this.children.map(c => c.textContent).join('') : this._innerHTML.replace(/<[^>]+>/g, '');
        }
        set textContent(v) { this._innerHTML = String(v); this.children = []; }
        setAttribute(name, val) { this.attributes[name] = String(val); }
        getAttribute(name) { return this.attributes[name] ?? null; }
        hasAttribute(name) { return name in this.attributes; }
        removeAttribute(name) { delete this.attributes[name]; }
        addEventListener(type, fn) {
            this.listeners[type] = this.listeners[type] || [];
            this.listeners[type].push(fn);
        }
        removeEventListener(type, fn) {
            if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter(f => f !== fn);
        }
        dispatchEvent(evt) {
            evt.target = evt.target || this;
            if (this.listeners[evt.type]) {
                for (const fn of this.listeners[evt.type]) fn(evt);
            }
            if (!evt.stopped && this.parentNode) this.parentNode.dispatchEvent(evt);
        }
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            elements.push(child);
            return child;
        }
        append(...nodes) {
            for (const n of nodes) this.appendChild(n);
        }
        remove() {
            if (this.parentNode) {
                this.parentNode.children = this.parentNode.children.filter(c => c !== this);
            }
        }
        closest(selector) {
            let cur = this;
            while (cur) {
                if (cur.matches && cur.matches(selector)) return cur;
                cur = cur.parentNode;
            }
            return null;
        }
        matches(selector) {
            if (!selector) return false;
            if (selector.startsWith('.')) {
                return this.classList.contains(selector.slice(1));
            }
            if (selector.startsWith('[') && selector.endsWith(']')) {
                const attr = selector.slice(1, -1);
                if (attr.includes('=')) {
                    const [k, v] = attr.split('=');
                    const cleanV = v.replace(/["']/g, '');
                    return this.attributes[k] === cleanV || this.dataset[k.replace('data-', '')] === cleanV;
                }
                return this.hasAttribute(attr);
            }
            return this.tagName.toLowerCase() === selector.toLowerCase();
        }
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        }
        querySelectorAll(selector) {
            const results = [];
            const walk = el => {
                for (const child of el.children) {
                    if (child.matches(selector)) results.push(child);
                    walk(child);
                }
            };
            walk(this);
            return results;
        }
        getBoundingClientRect() {
            return { left: 100, top: 100, right: 130, bottom: 130, width: 30, height: 30 };
        }
        focus() {}
    }

    const body = new Element('body');
    const doc = {
        nodeType: 9,
        body,
        documentElement: {
            classList: new Set(),
            dataset: { ui: 'v2' }
        },
        createElement: tag => new Element(tag),
        appendChild: node => body.appendChild(node),
        querySelector: sel => body.querySelector(sel),
        querySelectorAll: sel => body.querySelectorAll(sel),
        addEventListener: (type, fn) => {
            docListeners[type] = docListeners[type] || [];
            docListeners[type].push(fn);
        },
        removeEventListener: (type, fn) => {
            if (docListeners[type]) docListeners[type] = docListeners[type].filter(f => f !== fn);
        },
        dispatchEvent: evt => {
            if (docListeners[evt.type]) for (const fn of docListeners[evt.type]) fn(evt);
        }
    };

    const win = {
        document: doc,
        innerWidth: 1024,
        innerHeight: 768,
        location: new URL('https://platform.test/'),
        addEventListener: (type, fn) => {
            winListeners[type] = winListeners[type] || [];
            winListeners[type].push(fn);
        },
        removeEventListener: (type, fn) => {
            if (winListeners[type]) winListeners[type] = winListeners[type].filter(f => f !== fn);
        },
        dispatchEvent: evt => {
            if (winListeners[evt.type]) for (const fn of winListeners[evt.type]) fn(evt);
        },
        navigator: {
            clipboard: {
                copiedText: '',
                writeText(txt) { this.copiedText = txt; return Promise.resolve(); }
            }
        }
    };

    return { win, doc, body, docListeners, winListeners };
}

test('HomeToolMenu: resolves custom tool and builds complete action list', async () => {
    const { win, doc, body } = createDOM();
    const storage = { tools_role: 'admin' };
    win.localStorage = { getItem: k => storage[k] || null };
    win.__homeCustomTools = [
        { slug: 'ai-101', name: 'AI 101', href: '/tools/ai-101', hostedApp: false, builtIn: false }
    ];
    let favorited = false;
    win.NavFavorites = {
        has: id => id === 'custom:ai-101' && favorited,
        toggle: id => { favorited = !favorited; return favorited; }
    };
    win.isNavSuperAdmin = () => true;
    win.BuiltinPromotion = {
        toggle: async () => true
    };
    let downloadedSlug = null;
    win.downloadCustomTool = slug => { downloadedSlug = slug; };
    let renamedSlug = null;
    win.renameCustomTool = async slug => { renamedSlug = slug; return 'AI 101 Pro'; };
    let deletedSlug = null;
    win.deleteCustomTool = async slug => { deletedSlug = slug; return true; };
    let updatedSlug = null;
    let updateOpts = null;
    win.openCustomToolUpdateModal = (slug, opts) => { updatedSlug = slug; updateOpts = opts; };

    const script = fs.readFileSync(path.join(__dirname, '../frontend/js/home/tool-menu.js'), 'utf8');
    vm.runInNewContext(script, {
        window: win,
        document: doc,
        localStorage: win.localStorage,
        location: win.location,
        URL,
        navigator: win.navigator,
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        console
    });

    const menuApi = win.HomeToolMenu;
    assert.ok(menuApi, 'HomeToolMenu exposed');

    // 1. Target resolution from href
    const target = menuApi.resolveTarget({ href: '/tools/ai-101' });
    assert.equal(target.kind, 'tool');
    assert.equal(target.slug, 'ai-101');
    assert.equal(target.name, 'AI 101');

    // 2. Open menu anchored to a button
    const anchor = doc.createElement('button');
    body.appendChild(anchor);

    let onRenamed = null;
    let onDeleted = false;
    let onReloaded = false;

    menuApi.open({
        anchor,
        href: '/tools/ai-101',
        title: 'AI 101',
        onRename: newName => { onRenamed = newName; },
        onDelete: () => { onDeleted = true; },
        onReload: () => { onReloaded = true; }
    });

    assert.equal(menuApi.isOpen(), true);
    const menuEl = body.querySelector('.tool-context-menu');
    assert.ok(menuEl, 'menu element rendered in DOM');

    // Verify all actions are present
    const actions = menuEl.querySelectorAll('[data-tool-action]').map(btn => btn.dataset.toolAction);
    assert.ok(actions.includes('fav'), 'has favorite');
    assert.ok(actions.includes('download'), 'has download');
    assert.ok(actions.includes('promote'), 'has promote');
    assert.ok(actions.includes('update'), 'has update tool');
    assert.ok(actions.includes('rename'), 'has rename');
    assert.ok(actions.includes('delete'), 'has delete');
    assert.ok(actions.includes('reload'), 'has reload');
    assert.ok(actions.includes('external'), 'has open external');
    assert.ok(actions.includes('copyLink'), 'has copy link');

    // 3. Test favorite click
    const favBtn = menuEl.querySelector('[data-tool-action="fav"]');
    assert.ok(favBtn, 'found favBtn');
    menuEl.dispatchEvent({ type: 'click', target: favBtn, preventDefault() {}, stopPropagation() {} });
    await new Promise(r => setImmediate(r));
    assert.equal(favorited, true, 'NavFavorites.toggle called');
    assert.equal(menuApi.isOpen(), false, 'menu closed after action');

    // 4. Test update click
    menuApi.open({
        anchor,
        href: '/tools/ai-101',
        title: 'AI 101',
        onReload: () => { onReloaded = true; }
    });
    const newMenuEl = body.querySelector('.tool-context-menu');
    assert.ok(newMenuEl, 'newMenuEl rendered');
    const updateBtn = newMenuEl.querySelector('[data-tool-action="update"]');
    assert.ok(updateBtn, 'found updateBtn');
    newMenuEl.dispatchEvent({ type: 'click', target: updateBtn, preventDefault() {}, stopPropagation() {} });
    await new Promise(r => setImmediate(r));
    assert.equal(updatedSlug, 'ai-101', 'openCustomToolUpdateModal called with slug');
    assert.ok(typeof updateOpts?.onUpdated === 'function', 'onUpdated callback passed');
    updateOpts.onUpdated();
    assert.equal(onReloaded, true, 'onReload called when tool updated');
});

test('HomeToolMenu: opens for Skill items with skill-specific actions', async () => {
    const { win, doc, body } = createDOM();
    win.localStorage = { getItem: () => 'admin' };
    const skillItem = { id: 'test-skill', name: '测试技能', builtIn: false };
    let improved = false;
    let historyShown = false;
    let downloadedSkill = null;
    win.HomeSkills = {
        items: () => [skillItem],
        improve: s => { improved = true; },
        showHistory: s => { historyShown = true; },
        download: id => { downloadedSkill = id; }
    };

    const script = fs.readFileSync(path.join(__dirname, '../frontend/js/home/tool-menu.js'), 'utf8');
    vm.runInNewContext(script, {
        window: win,
        document: doc,
        localStorage: win.localStorage,
        location: win.location,
        URL,
        navigator: win.navigator,
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        console
    });

    const menuApi = win.HomeToolMenu;
    menuApi.open({ item: { kind: 'skill', id: 'test-skill', title: '测试技能' } });
    assert.equal(menuApi.isOpen(), true);

    const menuEl = body.querySelector('.tool-context-menu');
    const actions = menuEl.querySelectorAll('[data-tool-action]').map(btn => btn.dataset.toolAction);
    assert.ok(actions.includes('use'), 'has use in chat');
    assert.ok(actions.includes('improve'), 'has improve');
    assert.ok(actions.includes('history'), 'has history');
    assert.ok(actions.includes('download'), 'has download');
    assert.ok(actions.includes('rename'), 'has rename');
    assert.ok(actions.includes('delete'), 'has delete');
    assert.ok(actions.includes('copySkill'), 'has copy skill @');

    // Test improve click
    const improveBtn = menuEl.querySelector('[data-tool-action="improve"]');
    menuEl.dispatchEvent({ type: 'click', target: improveBtn, preventDefault() {}, stopPropagation() {} });
    await new Promise(r => setImmediate(r));
    assert.equal(improved, true, 'HomeSkills.improve called');
});

test('HomeToolMenu: keyboard navigation and outside click closes menu', () => {
    const { win, doc, body } = createDOM();
    win.localStorage = { getItem: () => 'admin' };
    win.__homeCustomTools = [
        { slug: 'ai-tool', name: 'AI Tool', href: '/tools/ai-tool' }
    ];

    const script = fs.readFileSync(path.join(__dirname, '../frontend/js/home/tool-menu.js'), 'utf8');
    vm.runInNewContext(script, {
        window: win,
        document: doc,
        localStorage: win.localStorage,
        location: win.location,
        URL,
        navigator: win.navigator,
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        console
    });

    win.HomeToolMenu.open({ href: '/tools/ai-tool' });
    assert.equal(win.HomeToolMenu.isOpen(), true);

    const menuEl = body.querySelector('.tool-context-menu');
    assert.ok(menuEl);

    // Escape closes
    menuEl.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
    assert.equal(win.HomeToolMenu.isOpen(), false);

    // Reopen and test pointerdown outside
    win.HomeToolMenu.open({ href: '/tools/ai-tool' });
    assert.equal(win.HomeToolMenu.isOpen(), true);
    doc.dispatchEvent({ type: 'pointerdown', target: body });
    assert.equal(win.HomeToolMenu.isOpen(), false);
});

test('HomeToolMenu: rename and delete trigger callbacks for embedded tool frame', async () => {
    const { win, doc, body } = createDOM();
    win.localStorage = { getItem: () => 'admin' };
    win.__homeCustomTools = [
        { slug: 'ai-tool', name: 'AI Tool', href: '/tools/ai-tool' }
    ];
    let renamed = null;
    let deleted = false;
    win.renameCustomTool = async slug => 'AI Tool Renovated';
    win.deleteCustomTool = async slug => true;

    const script = fs.readFileSync(path.join(__dirname, '../frontend/js/home/tool-menu.js'), 'utf8');
    vm.runInNewContext(script, {
        window: win,
        document: doc,
        localStorage: win.localStorage,
        location: win.location,
        URL,
        navigator: win.navigator,
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        console
    });

    // Test rename
    win.HomeToolMenu.open({
        href: '/tools/ai-tool',
        onRename: newTitle => { renamed = newTitle; },
        onDelete: () => { deleted = true; }
    });

    let menuEl = body.querySelector('.tool-context-menu');
    const renameBtn = menuEl.querySelector('[data-tool-action="rename"]');
    assert.ok(renameBtn);
    menuEl.dispatchEvent({ type: 'click', target: renameBtn, preventDefault() {}, stopPropagation() {} });
    await new Promise(r => setImmediate(r));
    assert.equal(renamed, 'AI Tool Renovated');

    // Test delete
    win.HomeToolMenu.open({
        href: '/tools/ai-tool',
        onDelete: () => { deleted = true; }
    });
    menuEl = body.querySelector('.tool-context-menu');
    const deleteBtn = menuEl.querySelector('[data-tool-action="delete"]');
    assert.ok(deleteBtn);
    menuEl.dispatchEvent({ type: 'click', target: deleteBtn, preventDefault() {}, stopPropagation() {} });
    await new Promise(r => setImmediate(r));
    assert.equal(deleted, true);
});

test('HomeToolMenu: admin does not see submitUpdate, normal user only sees submitUpdate after local update, and must test before submit', async () => {
    const { win, doc, body } = createDOM();
    const storage = { tools_role: 'admin', tools_tenant_id: 'default' };
    win.localStorage = {
        getItem: k => storage[k] ?? null,
        setItem: (k, v) => { storage[k] = String(v); }
    };
    win.isNavSuperAdmin = () => true;
    win.__homeCustomTools = [
        { slug: 'ops-calc', name: 'Ops Calc', href: '/tools/ops-calc', shared: false }
    ];

    const script = fs.readFileSync(path.join(__dirname, '../frontend/js/home/tool-menu.js'), 'utf8');
    vm.runInNewContext(script, {
        window: win,
        document: doc,
        localStorage: win.localStorage,
        location: win.location,
        URL,
        navigator: win.navigator,
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        console
    });

    // 1. As admin, submitUpdate should NOT appear on tools, skills, or capabilities
    win.HomeToolMenu.open({ href: '/tools/ops-calc' });
    let menuEl = body.querySelector('.tool-context-menu');
    let actions = menuEl.querySelectorAll('[data-tool-action]').map(btn => btn.dataset.toolAction);
    assert.equal(actions.includes('submitUpdate'), false, 'admin has no submitUpdate on tool');

    win.HomeToolMenu.open({ item: { kind: 'skill', id: 'my-skill', title: 'My Skill', href: '/?skill=my-skill' } });
    menuEl = body.querySelector('.tool-context-menu');
    actions = menuEl.querySelectorAll('[data-tool-action]').map(btn => btn.dataset.toolAction);
    assert.equal(actions.includes('submitUpdate'), false, 'admin has no submitUpdate on skill');

    win.HomeToolMenu.open({ item: { kind: 'plugin', key: 'my-cap', capabilityId: 'my-cap', title: 'My Cap', href: '/plugins/my-cap' } });
    menuEl = body.querySelector('.tool-context-menu');
    actions = menuEl.querySelectorAll('[data-tool-action]').map(btn => btn.dataset.toolAction);
    assert.equal(actions.includes('submitUpdate'), false, 'admin has no submitUpdate on plugin');

    // 2. Switch to non-admin user
    storage.tools_role = 'user';
    storage.tools_tenant_id = 'team-a';
    win.isNavSuperAdmin = () => false;

    // A tool without local update should NOT have submitUpdate
    win.HomeToolMenu.open({ href: '/tools/ops-calc' });
    menuEl = body.querySelector('.tool-context-menu');
    actions = menuEl.querySelectorAll('[data-tool-action]').map(btn => btn.dataset.toolAction);
    assert.equal(actions.includes('submitUpdate'), false, 'normal user without local update has no submitUpdate');

    // A pristine skill without customization should NOT have submitUpdate
    win.HomeToolMenu.open({ item: { kind: 'skill', id: 'my-skill', title: 'My Skill', href: '/?skill=my-skill', skill: { id: 'my-skill', builtIn: true, customized: false } } });
    menuEl = body.querySelector('.tool-context-menu');
    actions = menuEl.querySelectorAll('[data-tool-action]').map(btn => btn.dataset.toolAction);
    assert.equal(actions.includes('submitUpdate'), false, 'normal user without customized skill has no submitUpdate');

    // 3. Mark tool as updated locally
    win.CatalogUpdateAudit.markUpdated('tool', 'ops-calc');

    // Now submitUpdate appears!
    win.HomeToolMenu.open({ href: '/tools/ops-calc' });
    menuEl = body.querySelector('.tool-context-menu');
    actions = menuEl.querySelectorAll('[data-tool-action]').map(btn => btn.dataset.toolAction);
    assert.equal(actions.includes('submitUpdate'), true, 'submitUpdate appears after local update');

    // 4. Click submitUpdate before using it -> triggers mustUseBeforeSubmit warning!
    let alertCalled = false;
    let confirmCalled = false;
    let promptCalled = false;
    win.AppDialog = {
        alert: async (msg, opts) => { alertCalled = true; },
        confirm: async (msg, opts) => { confirmCalled = true; return true; },
        prompt: async (msg, opts) => { promptCalled = true; return 'Fixed edge cases'; }
    };
    win.RequirementsClient = {
        submitPayload: async () => ({ success: true })
    };

    const submitBtn = menuEl.querySelector('[data-tool-action="submitUpdate"]');
    menuEl.dispatchEvent({ type: 'click', target: submitBtn, preventDefault() {}, stopPropagation() {} });
    await new Promise(r => setImmediate(r));
    assert.equal(alertCalled, true, 'must use before submit alert was shown');
    assert.equal(confirmCalled, false, 'confirm was not shown since user has not used it');

    // 5. Test skill: mark as used after update and submit saved version directly
    win.CatalogUpdateAudit.markUsed('skill', 'my-skill');
    alertCalled = false;
    confirmCalled = false;
    promptCalled = false;

    win.HomeToolMenu.open({ item: { kind: 'skill', id: 'my-skill', title: 'My Skill', href: '/?skill=my-skill', builtIn: true, customized: true } });
    menuEl = body.querySelector('.tool-context-menu');
    const submitBtn2 = menuEl.querySelector('[data-tool-action="submitSavedSkill"]');
    assert.ok(submitBtn2, 'submitSavedSkill exists for customized skill');
    menuEl.dispatchEvent({ type: 'click', target: submitBtn2, preventDefault() {}, stopPropagation() {} });
    await new Promise(r => setImmediate(r));
    assert.equal(alertCalled, false, 'no warning alert because skill was marked as used');
    assert.equal(confirmCalled, true, 'confirmation dialog was prompted before submitting');
    assert.equal(promptCalled, true, 'reason prompt was requested');
});
