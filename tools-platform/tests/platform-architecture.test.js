const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.join(__dirname, '../frontend');
const modules = ['core', 'dialogs', 'settings-controller', 'alerts', 'services', 'tool-updates', 'runtime'];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('platform pages load all shared capabilities in order without retired home entries', () => {
    for (const name of ['index.html', ...fs.readdirSync(path.join(root, 'pages')).filter(n => n.endsWith('.html')).map(n => 'pages/' + n)]) {
        const html = read(name);
        assert.doesNotMatch(html, /(?:navbar(?:-settings)?|home-page|home-v2)\.js/, name);
        if (!html.includes('/js/shared/platform-core.js')) continue;
        let previous = -1;
        for (const module of modules) {
            const at = html.indexOf(`/js/shared/platform-${module}.js`);
            assert.ok(at > previous, `${name}: ${module} must follow dependencies`);
            previous = at;
        }
        for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
            if (/\bsrc=|type=["'](?:application|importmap)/.test(script[1])) continue;
            assert.doesNotThrow(() => acorn.parse(script[2], { ecmaVersion: 'latest', sourceType: /module/.test(script[1]) ? 'module' : 'script' }), name);
        }
    }
    const shell = read('js/home/home-shell.js');
    assert.doesNotMatch(shell, /app-navbar|mirrorNavbar|watchNavbar|click\('(?:homeChatNew|toolMarketBtn|customToolUploadBtn)/);
    assert.doesNotMatch(read('index.html'), /data-ui=|tools_home_ui|class="home-rail"/);
    for (const name of ['js/shared/navbar.js', 'js/shared/navbar-settings.js', 'js/home/home-page.js', 'js/home/home-v2.js', 'css/home-page.css', 'css/home-v2.css']) {
        assert.equal(fs.existsSync(path.join(root, name)), false, name);
    }
});

test('shared status publishes fresh snapshots without requiring a navigation DOM', () => {
    const source = read('js/shared/platform-core.js');
    const end = source.indexOf('// Shared platform context.');
    const events = [];
    const context = { window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
    vm.runInNewContext(source.slice(0, end), context);
    vm.runInNewContext("publishPlatformStatus({ unread: 4, online: false, version: 'v1.2.3' })", context);
    const snapshot = context.window.ToolsPlatform.status();
    assert.equal(snapshot.unread, 4);
    assert.equal(snapshot.online, false);
    assert.equal(events[0].type, 'tools:platform-status');
    snapshot.unread = 0;
    assert.equal(context.window.ToolsPlatform.status().unread, 4);
});
