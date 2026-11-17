const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('all platform-home workspace grid rules respect --workspace-panel-width fallback chain', () => {
    const shellCss = read('frontend/css/home-shell.css');
    const matches = [...shellCss.matchAll(/html\.platform-home[^\n{]*\.dc-workspace-open[^\n{]*\{\s*grid-template-columns:([^;]+);/g)];
    assert.equal(matches.length, 4, 'expected 4 dc-workspace-open grid rules in home-shell.css');
    for (const match of matches) {
        assert.match(
            match[1],
            /var\(--ai-preview-width,\s*var\(--workspace-panel-width,\s*var\(--ws-panel-w\)\)\)/,
            `missing --workspace-panel-width fallback in: ${match[0]}`
        );
    }
    assert.match(shellCss, /html\.platform-home body\.dc-browser-open\s*\{\s*--home-right-panel-width:\s*var\(--browser-panel-width,\s*480px\);/);
    assert.match(shellCss, /html\.platform-home body\.dc-terminal-open\s*\{\s*--home-right-panel-width:\s*var\(--terminal-panel-width,\s*560px\);/);
});

test('mobile workspace drawer stacks above .wsp-backdrop so its resize handle stays interactive', () => {
    const themeCss = read('frontend/css/home-theme.css');
    const workspaceCss = read('frontend/css/workspace-panel.css');
    const backdropZ = Number(/\.wsp-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(workspaceCss)?.[1]);
    const mobileBlock = /@media\s*\(max-width:\s*860px\)\s*\{([\s\S]*?)\n\}/.exec(themeCss)?.[1] || '';
    const drawerZ = Number(/html\.platform-home \.home-workspace-panel\s*\{[^}]*z-index:\s*(\d+)/.exec(mobileBlock)?.[1]);
    assert.ok(Number.isFinite(backdropZ) && Number.isFinite(drawerZ));
    assert.ok(drawerZ > backdropZ, `drawer z-index ${drawerZ} must exceed backdrop z-index ${backdropZ}`);
});

test('legacy chat-files preview grid rules do not override platform-home collapsed layout', () => {
    const chatFilesJs = read('frontend/js/shared/chat-files.js');
    assert.match(chatFilesJs, /html:not\(\.platform-home\)\s+body\.ai-file-preview-open\.home-mode-chat\.dc-workspace-open/);
    assert.match(chatFilesJs, /html:not\(\.platform-home\)\s+body\.ai-file-preview-open\.home-sidebar-collapsed\.home-mode-chat\.dc-workspace-open/);
});

test('desktop window drag exclusions include right sidebar resize handles', () => {
    const browserCss = read('frontend/css/browser-sidebar.css');
    const desktopWindowJs = read('frontend/js/shared/desktop-window.js');
    assert.match(browserCss, /html\.is-desktop-app \.dc-browser-panel :is\([^)]*\.dc-sidebar-resize[^)]*\)\s*\{\s*-webkit-app-region:\s*no-drag/);
    assert.match(desktopWindowJs, /html\.is-desktop-app :is\([^)]*\.dc-sidebar-resize[^)]*\.ai-file-preview-resize[^)]*\)\s*\{\s*-webkit-app-region:\s*no-drag;/);
});
