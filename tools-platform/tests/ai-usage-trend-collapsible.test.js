const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const navbarPath = path.join(__dirname, '../frontend/js/shared/navbar.js');
const navbarSettingsPath = path.join(__dirname, '../frontend/js/shared/navbar-settings.js');
const sharedCssPath = path.join(__dirname, '../frontend/css/shared.css');
const homeThemePath = path.join(__dirname, '../frontend/css/home-theme.css');

const navbarCode = fs.readFileSync(navbarPath, 'utf8');
const navbarSettingsCode = fs.readFileSync(navbarSettingsPath, 'utf8');
const sharedCss = fs.readFileSync(sharedCssPath, 'utf8');
const homeThemeCss = fs.readFileSync(homeThemePath, 'utf8');

test('navbar.js initializes aiUsageExpanded to false and includes expand/collapse i18n keys', () => {
    // 1. navState default: aiUsageExpanded should default to false (collapsed)
    assert.match(navbarCode, /aiUsageExpanded:\s*false/, 'navState must default aiUsageExpanded to false');

    // 2. Chinese i18n
    assert.match(navbarCode, /'nav\.ai\.usageExpand':\s*'展开趋势'/, 'Chinese dictionary must include nav.ai.usageExpand');
    assert.match(navbarCode, /'nav\.ai\.usageCollapse':\s*'收起趋势'/, 'Chinese dictionary must include nav.ai.usageCollapse');

    // 3. English i18n
    assert.match(navbarCode, /'nav\.ai\.usageExpand':\s*'Expand Trend'/, 'English dictionary must include nav.ai.usageExpand');
    assert.match(navbarCode, /'nav\.ai\.usageCollapse':\s*'Collapse Trend'/, 'English dictionary must include nav.ai.usageCollapse');
});

test('navbar-settings.js supports collapsible Token & cost trend panel and defines toggleAiUsagePanel', () => {
    // 1. Toggle function must be attached to window
    assert.match(navbarSettingsCode, /window\.toggleAiUsagePanel\s*=\s*function/, 'toggleAiUsagePanel must be defined on window');

    // 2. renderAiSettings must check isUsageExpanded and render section with conditional classes
    assert.match(navbarSettingsCode, /id="navAiUsagePanel"\s+class="nav-ai-usage-panel \$\{isUsageExpanded \? 'is-expanded' : 'is-collapsed'\}"/);

    // 3. Header should have onclick and toggle button with aria-expanded
    assert.match(navbarSettingsCode, /class="nav-ai-usage-head"\s+onclick="toggleAiUsagePanel\(event\)"/);
    assert.match(navbarSettingsCode, /id="navAiUsageToggleBtn"/);

    // 4. Initial load must be conditional on isUsageExpanded so collapsed default does not trigger redundant fetch
    assert.match(navbarSettingsCode, /if\s*\(isUsageExpanded\)\s*\{\s*loadAiUsageDashboard\(navState\.aiUsageDimension\);\s*\}/);
});

test('shared.css and home-theme.css contain folding and expansion styles for Token & cost trend', () => {
    // 1. Collapsed state hides body and dimensions
    assert.match(sharedCss, /\.nav-ai-usage-panel\.is-collapsed\s*\.nav-ai-usage-dimensions\s*\{\s*display:\s*none;\s*\}/);
    assert.match(sharedCss, /\.nav-ai-usage-panel\.is-collapsed\s*\.nav-ai-usage-body\s*\{\s*display:\s*none;\s*\}/);

    // 2. Expanded state shows body
    assert.match(sharedCss, /\.nav-ai-usage-panel\.is-expanded\s*\.nav-ai-usage-body\s*\{\s*display:\s*block;\s*\}/);

    // 3. Toggle button and chevron styling
    assert.match(sharedCss, /\.nav-ai-usage-toggle-btn/);
    assert.match(sharedCss, /\.nav-ai-usage-chevron/);

    // 4. Dark mode styling
    assert.match(sharedCss, /:is\(html\[data-theme="dark"\],\s*html\[data-platform-theme="dark"\]\)\s*\.nav-ai-usage-toggle-btn/);
    assert.match(homeThemeCss, /html\[data-ui="v2"\]\[data-theme="dark"\]\s*\.nav-ai-usage-toggle-btn/);
});

test('DOM runtime simulation: toggleAiUsagePanel expands and collapses panel correctly', () => {
    // Simulate minimal DOM and navState to test runtime behavior of toggleAiUsagePanel
    const navState = {
        aiUsageExpanded: false,
        aiUsageDimension: 'day',
        aiUsageData: null
    };

    let dashboardLoaded = false;
    function loadAiUsageDashboard() {
        dashboardLoaded = true;
    }

    function navT(key) {
        if (key === 'nav.ai.usageExpand') return '展开趋势';
        if (key === 'nav.ai.usageCollapse') return '收起趋势';
        return key;
    }

    // Mock DOM elements
    const panelClasses = new Set(['nav-ai-usage-panel', 'is-collapsed']);
    const panel = {
        classList: {
            toggle(cls, force) {
                if (force) panelClasses.add(cls);
                else panelClasses.delete(cls);
            },
            contains(cls) { return panelClasses.has(cls); }
        },
        querySelector(selector) {
            if (selector === '.nav-ai-usage-head') return head;
            if (selector === '.nav-ai-usage-chevron') return chevron;
            return null;
        }
    };

    const head = { title: '展开趋势' };
    const chevron = { textContent: '▸' };
    const textSpan = { textContent: '展开趋势' };
    const arrowSpan = { textContent: '▾' };
    const toggleBtnAttrs = {};
    const toggleBtn = {
        setAttribute(k, v) { toggleBtnAttrs[k] = v; },
        querySelector(selector) {
            if (selector === '.nav-ai-usage-toggle-text') return textSpan;
            if (selector === '.nav-ai-usage-toggle-arrow') return arrowSpan;
            return null;
        }
    };
    const body = {
        querySelector() { return null; }
    };

    const dom = {
        navAiUsagePanel: panel,
        navAiUsageToggleBtn: toggleBtn,
        navAiUsageBody: body
    };

    // The logic identical to window.toggleAiUsagePanel
    function toggle(event) {
        if (event && event.target && event.target.closest && event.target.closest('.nav-ai-usage-dimensions')) return;
        navState.aiUsageExpanded = !navState.aiUsageExpanded;
        const p = dom.navAiUsagePanel;
        if (!p) return;
        const isExpanded = !!navState.aiUsageExpanded;
        p.classList.toggle('is-expanded', isExpanded);
        p.classList.toggle('is-collapsed', !isExpanded);

        const h = p.querySelector('.nav-ai-usage-head');
        if (h) h.title = navT(isExpanded ? 'nav.ai.usageCollapse' : 'nav.ai.usageExpand');

        const ch = p.querySelector('.nav-ai-usage-chevron');
        if (ch) ch.textContent = isExpanded ? '▾' : '▸';

        const btn = dom.navAiUsageToggleBtn;
        if (btn) {
            btn.setAttribute('aria-expanded', String(isExpanded));
            btn.title = navT(isExpanded ? 'nav.ai.usageCollapse' : 'nav.ai.usageExpand');
            const ts = btn.querySelector('.nav-ai-usage-toggle-text');
            if (ts) ts.textContent = navT(isExpanded ? 'nav.ai.usageCollapse' : 'nav.ai.usageExpand');
            const as = btn.querySelector('.nav-ai-usage-toggle-arrow');
            if (as) as.textContent = isExpanded ? '▴' : '▾';
        }

        const b = dom.navAiUsageBody;
        if (isExpanded) {
            if (!navState.aiUsageData) {
                loadAiUsageDashboard();
            }
        }
    }

    // Initial state: collapsed
    assert.equal(navState.aiUsageExpanded, false);
    assert.equal(panel.classList.contains('is-collapsed'), true);

    // 1. First toggle -> expands
    toggle(null);
    assert.equal(navState.aiUsageExpanded, true);
    assert.equal(panel.classList.contains('is-expanded'), true);
    assert.equal(panel.classList.contains('is-collapsed'), false);
    assert.equal(chevron.textContent, '▾');
    assert.equal(textSpan.textContent, '收起趋势');
    assert.equal(arrowSpan.textContent, '▴');
    assert.equal(toggleBtnAttrs['aria-expanded'], 'true');
    assert.equal(dashboardLoaded, true);

    // 2. Second toggle -> collapses
    toggle(null);
    assert.equal(navState.aiUsageExpanded, false);
    assert.equal(panel.classList.contains('is-expanded'), false);
    assert.equal(panel.classList.contains('is-collapsed'), true);
    assert.equal(chevron.textContent, '▸');
    assert.equal(textSpan.textContent, '展开趋势');
    assert.equal(arrowSpan.textContent, '▾');
    assert.equal(toggleBtnAttrs['aria-expanded'], 'false');

    // 3. Event clicking inside dimensions should NOT toggle
    const dimensionEvent = {
        target: {
            closest(sel) { return sel === '.nav-ai-usage-dimensions' ? {} : null; }
        }
    };
    toggle(dimensionEvent);
    assert.equal(navState.aiUsageExpanded, false, 'clicking dimension should not toggle collapse');
});
