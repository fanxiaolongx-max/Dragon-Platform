import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mainlineRoot = path.resolve(__dirname, '..');
const baseRoot = '/Volumes/512G/06-工具开发/digital-human-web';

test('Mainline chat action buttons have icons, labels, titles and never-wrap structure', () => {
    const html = fs.readFileSync(path.join(mainlineRoot, 'frontend/index.html'), 'utf8');
    const startIdx = html.indexOf('<div class="dc-chat-actions">');
    const endIdx = html.indexOf('</header>', startIdx);
    assert.ok(startIdx !== -1 && endIdx !== -1, 'dc-chat-actions container exists in frontend/index.html');
    const actionsHtml = html.slice(startIdx, endIdx);

    // Every key action button must have an icon, a label, and a title
    const requiredButtons = [
        { id: 'dcWorkspaceToggle', titleAttr: 'workspace', labelKey: 'workspace' },
        { id: 'dcBrowserToggle', titleAttr: 'browser' },
        { id: 'dcHistoryBtn', titleAttr: 'history', labelKey: 'history' },
        { id: 'dcExportLog', titleAttr: 'exportLog', labelKey: 'exportLog' },
        { id: 'dcNewChat', titleAttr: 'newChat', labelKey: 'newChat' },
        { id: 'dcBackToTools', titleAttr: 'backToTools', labelKey: 'backToTools' }
    ];

    for (const btn of requiredButtons) {
        assert.ok(actionsHtml.includes(`id="${btn.id}"`), `${btn.id} is present in actions`);
        assert.ok(actionsHtml.includes(`data-dc-i18n-title="${btn.titleAttr}"`), `${btn.id} has data-dc-i18n-title="${btn.titleAttr}"`);
        assert.ok(actionsHtml.includes('class="dc-btn-ico"'), `${btn.id} includes dc-btn-ico SVG icon`);
        assert.ok(actionsHtml.includes('class="dc-btn-label"'), `${btn.id} includes dc-btn-label span`);
    }

    // Export log must keep caret for open/closed visual indication
    assert.ok(actionsHtml.includes('class="dc-model-caret"'), 'Export log includes dropdown caret');
});

test('Base (digital-human-web) chat action buttons have icons, labels, titles and never-wrap structure', () => {
    const html = fs.readFileSync(path.join(baseRoot, 'static/index.html'), 'utf8');
    const startIdx = html.indexOf('<div class="dc-chat-actions">');
    const endIdx = html.indexOf('</header>', startIdx);
    assert.ok(startIdx !== -1 && endIdx !== -1, 'dc-chat-actions container exists in base static/index.html');
    const actionsHtml = html.slice(startIdx, endIdx);

    const requiredButtons = [
        { id: 'dcWorkspaceToggle', titleAttr: 'workspace' },
        { id: 'dcBrowserToggle', titleAttr: 'browser' },
        { id: 'dcHistoryBtn', titleAttr: 'history' },
        { id: 'dcExportLog', titleAttr: 'exportLog' },
        { id: 'dcNewChat', titleAttr: 'newChat' },
        { id: 'dcBackToTools', titleAttr: 'backToTools' }
    ];

    for (const btn of requiredButtons) {
        assert.ok(actionsHtml.includes(`id="${btn.id}"`), `${btn.id} is present in base actions`);
        assert.ok(actionsHtml.includes(`data-dc-i18n-title="${btn.titleAttr}"`), `${btn.id} has data-dc-i18n-title in base`);
        assert.ok(actionsHtml.includes('class="dc-btn-ico"'), `${btn.id} includes dc-btn-ico in base`);
        assert.ok(actionsHtml.includes('class="dc-btn-label"'), `${btn.id} includes dc-btn-label in base`);
    }
});

test('Terminal toggle and Browser toggle dynamically inject SVG icon and preserve label across language changes', () => {
    const termCode = fs.readFileSync(path.join(mainlineRoot, 'frontend/js/home/terminal-sidebar.js'), 'utf8');
    assert.ok(termCode.includes('class="dc-btn-ico"'), 'Terminal toggle injects dc-btn-ico SVG');
    assert.ok(termCode.includes('class="dc-btn-label"'), 'Terminal toggle injects dc-btn-label span');
    assert.ok(termCode.includes('termLabel.textContent = L('), 'Terminal languagechange updates termLabel without overwriting icon');

    const browserCode = fs.readFileSync(path.join(mainlineRoot, 'frontend/js/home/browser-sidebar.js'), 'utf8');
    assert.ok(browserCode.includes('browserLabel.textContent'), 'Browser render updates browserLabel without overwriting icon');
});

test('Agent radar in mainline supports squeezed compact state with dot and count', () => {
    const radarCode = fs.readFileSync(path.join(mainlineRoot, 'frontend/js/home/agent-radar.js'), 'utf8');
    assert.ok(radarCode.includes('dc-radar-short'), 'agent-radar.js provides dc-radar-short for compact count');
    assert.ok(radarCode.includes('dc-radar-label'), 'agent-radar.js wraps full status in dc-radar-label');
});

test('Dragon Claw CSS defines container query, smooth transitions, and squeezed icon-only modes in both repositories', () => {
    for (const [name, cssPath] of [
        ['mainline', path.join(mainlineRoot, 'frontend/css/dragon-claw.css')],
        ['base', path.join(baseRoot, 'static/css/dragon-claw.css')]
    ]) {
        const css = fs.readFileSync(cssPath, 'utf8');
        assert.ok(css.includes('container-type: inline-size'), `${name} has container-type: inline-size`);
        assert.ok(css.includes('container-name: dc-chat'), `${name} has container-name: dc-chat`);
        assert.ok(css.includes('.dc-btn-ico'), `${name} styles .dc-btn-ico`);
        assert.ok(css.includes('.dc-btn-label'), `${name} styles .dc-btn-label with smooth transition`);
        assert.ok(css.includes('@container dc-chat (max-width: 860px)'), `${name} defines @container squeezed rule`);
        assert.ok(css.includes('.is-squeezed'), `${name} defines .is-squeezed rule`);
        assert.ok(css.includes('body:is(.dc-workspace-open, .dc-browser-open, .dc-terminal-open, .ai-preview-open)'), `${name} handles sidebar open squeeze`);
    }
});

test('Home theme CSS prevents wrapping of chat action buttons in both repositories', () => {
    for (const [name, cssPath] of [
        ['mainline', path.join(mainlineRoot, 'frontend/css/home-theme.css')],
        ['base', path.join(baseRoot, 'static/css/home-theme.css')]
    ]) {
        const css = fs.readFileSync(cssPath, 'utf8');
        assert.ok(css.includes('.dc-chat-actions { flex: 0 1 auto; min-width: 0; flex-wrap: nowrap !important;'), `${name} forces flex-wrap: nowrap !important`);
    }
});
