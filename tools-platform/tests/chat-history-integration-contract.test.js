const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const router = require('../backend/routes/chat-history');
const builtinSync = require('../backend/models/builtin-tools-sync');

function routeLayer(routePath, method) {
    return router.stack.find(layer => layer.route
        && layer.route.path === routePath
        && layer.route.methods[method]);
}

test('shared chat mutations keep imports and deletion admin-only', () => {
    const statusLayer = routeLayer('/status', 'get');
    const importLayer = routeLayer('/import', 'post');
    const deleteLayer = routeLayer('/sources/:sourceId', 'delete');
    const refreshStatsLayer = routeLayer('/stats/refresh', 'post');
    const settingsLayer = routeLayer('/settings', 'put');
    const favoriteLayer = routeLayer('/favorites/:stableKey', 'put');
    assert.ok(importLayer);
    assert.ok(statusLayer);
    assert.equal(statusLayer.route.stack.some(layer => layer.handle.name === 'requireAdmin'), false);
    assert.ok(deleteLayer);
    assert.ok(refreshStatsLayer);
    assert.ok(importLayer.route.stack.some(layer => layer.handle.name === 'requireAdmin'));
    assert.ok(deleteLayer.route.stack.some(layer => layer.handle.name === 'requireAdmin'));
    assert.ok(refreshStatsLayer.route.stack.some(layer => layer.handle.name === 'requireAdmin'));
    assert.equal(settingsLayer.route.stack.some(layer => layer.handle.name === 'requireAdmin'), false);
    assert.equal(favoriteLayer.route.stack.some(layer => layer.handle.name === 'requireAdmin'), false);

    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const personalException = serverSource.match(/\^\\\/chat-history.*?return next\(\)/s)?.[0] || '';
    assert.match(personalException, /settings/);
    assert.match(personalException, /favorites/);
    assert.doesNotMatch(personalException, /import/);
    assert.doesNotMatch(personalException, /sources/);
});

test('chat history center is a valid bundled platform-only HTML tool', () => {
    const sourceDir = path.join(__dirname, '../backend/builtin-tools');
    const bundled = builtinSync.listBundledTools(sourceDir).find(item => item.slug === 'chat-history-center');
    assert.ok(bundled);
    assert.equal(bundled.manifest.tool.publicAccess, false);
    assert.ok(bundled.files.includes('index.html'));
    assert.ok(bundled.files.includes('chat-viewer.js'));
    const html = fs.readFileSync(path.join(sourceDir, 'chat-history-center/index.html'), 'utf8');
    assert.match(html, /webkitdirectory/);
    const js = fs.readFileSync(path.join(sourceDir, 'chat-history-center/chat-viewer.js'), 'utf8');
    assert.match(js, /window\.location\.protocol === 'file:'/);
    assert.match(js, /webkitRelativePath/);
    assert.match(js, /ANALYTICS_PAGE_SIZE = 100/);
    assert.match(js, /setupAnalyticsLazyLoading/);
    assert.match(js, /setupResizableTableColumns/);
    assert.match(js, /chat_history_analytics_column_widths_v1/);
    assert.match(js, /group-name-cell/);
    assert.match(js, /ANALYTICS_COLUMN_MIN_WIDTHS/);
    assert.match(js, /offset: ANALYTICS_PAGE_SIZE|limit: ANALYTICS_PAGE_SIZE/);
    assert.match(js, /\/api\/chat-history\/stats\/refresh/);
    assert.match(js, /正在读取会话概览/);
    assert.match(js, /\/api\/chat-history\/status/);
    assert.match(js, /withServiceProgress/);
    assert.match(js, /peopleDebounce = setTimeout\(loadPeopleOnly/);
    assert.doesNotMatch(js, /peopleDebounce = setTimeout\(loadStats/);
    const css = fs.readFileSync(path.join(sourceDir, 'chat-history-center/chat-viewer.css'), 'utf8');
    assert.match(css, /max-width:1600px/);
    assert.match(css, /column-resize-handle/);
    assert.match(css, /group-name-link\{display:block;width:100%;max-width:100%;overflow:hidden;text-overflow:ellipsis/);
    assert.match(css, /resizable-table td\{min-width:0;overflow:hidden;text-overflow:ellipsis/);

    // Verify elegant delete source dialog and prompt removal
    assert.match(html, /id="deleteSourceDialog"/);
    assert.match(html, /id="confirmDeleteSourceBtn"/);
    assert.match(js, /openDeleteSourceDialog/);
    assert.doesNotMatch(js, /window\.prompt/);
    assert.match(css, /\.confirm-dialog/);
    assert.match(css, /\.btn-danger/);
});

test('chat history center conversation list supports drag resizing and width memory', () => {
    const sourceDir = path.join(__dirname, '../backend/builtin-tools');
    const html = fs.readFileSync(path.join(sourceDir, 'chat-history-center/index.html'), 'utf8');
    const css = fs.readFileSync(path.join(sourceDir, 'chat-history-center/chat-viewer.css'), 'utf8');
    const js = fs.readFileSync(path.join(sourceDir, 'chat-history-center/chat-viewer.js'), 'utf8');

    // HTML checks
    assert.match(html, /id="conversationResizeHandle"/);
    assert.match(html, /class="conversation-resize-handle"/);
    assert.match(html, /chat_history_conv_pane_width_v1/);

    // CSS checks
    assert.match(css, /--conv-pane-width:\s*320px/);
    assert.match(css, /grid-template-columns:\s*var\(--conv-pane-width/);
    assert.match(css, /\.conversation-resize-handle\s*\{/);
    assert.match(css, /cursor:\s*col-resize/);
    assert.match(css, /body\.is-resizing-pane/);

    // JS checks
    assert.match(js, /CONVERSATION_PANE_WIDTH_STORAGE_KEY\s*=\s*'chat_history_conv_pane_width_v1'/);
    assert.match(js, /setupConversationPaneResize/);
    assert.match(js, /pointerdown/);
    assert.match(js, /pointermove/);
    assert.match(js, /dblclick/);
    assert.match(js, /ArrowLeft/);
    assert.match(js, /ArrowRight/);
    assert.match(js, /localStorage\.setItem\(CONVERSATION_PANE_WIDTH_STORAGE_KEY/);
    assert.match(js, /showToast\('已恢复会话列表默认宽度'\)/);
});


