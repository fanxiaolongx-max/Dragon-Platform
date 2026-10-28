const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

test('ai-report.html wraps #airReport inside #airReportPane so report has its own scrollbar', () => {
    const htmlPath = path.join(rootDir, 'frontend/pages/ai-report.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('<main class="air-layout">'), 'air-layout main exists');
    assert.ok(html.includes('<div class="air-report-pane" id="airReportPane">'), '#airReportPane container exists');
    assert.ok(html.includes('<article id="airReport" class="air-report" aria-live="polite"></article>'), '#airReport exists');
    assert.ok(html.includes('<aside id="airChat" class="air-chat" hidden></aside>'), '#airChat exists');

    // #airReport must be nested inside #airReportPane
    const paneStart = html.indexOf('<div class="air-report-pane" id="airReportPane">');
    const paneEnd = html.indexOf('</div><aside id="airChat"');
    const reportPos = html.indexOf('<article id="airReport"');
    assert.ok(paneStart !== -1 && reportPos > paneStart && (paneEnd === -1 || reportPos < paneEnd), '#airReport is inside #airReportPane');
});

test('ai-report.css configures #airReportPane with its own vertical scrollbar right beside the report', () => {
    const cssPath = path.join(rootDir, 'frontend/css/ai-report.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Page overflow is locked so whole window does not scroll vertically
    assert.match(css, /body\.ai-report-page\s*\{[^}]*overflow:\s*hidden/);
    assert.match(css, /body\.ai-report-page\s*\{[^}]*height:\s*100vh/);

    // .air-layout fits viewport below toolbar and clips vertical overflow
    assert.match(css, /\.air-layout\s*\{[^}]*height:\s*calc\(100vh\s*-\s*var\(--navbar-h,52px\)\s*-\s*var\(--air-toolbar-h\)\)/);
    assert.match(css, /\.air-layout\s*\{[^}]*overflow-y:\s*hidden/);
    assert.match(css, /html\.air-chrome-hidden\s+\.air-layout\s*\{[^}]*height:\s*100vh/);

    // .air-report-pane owns the vertical scrollbar
    assert.match(css, /\.air-report-pane\s*\{[^}]*overflow-y:\s*auto/);
    assert.match(css, /\.air-report-pane\s*\{[^}]*scrollbar-gutter:\s*stable/);
    assert.match(css, /\.air-report-pane\s*\{[^}]*scrollbar-width:\s*thin/);
    assert.match(css, /\.air-report-pane::-webkit-scrollbar\s*\{[^}]*width:\s*8px/);
    assert.match(css, /\.air-report-pane::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*#b9cadb/);

    // .air-chat is placed neatly alongside .air-report-pane
    assert.match(css, /\.air-chat\s*\{[^}]*margin-top:\s*20px/);
    assert.match(css, /\.air-chat\s*\{[^}]*height:\s*calc\(100%\s*-\s*32px\)/);

    // Print & export modes allow full expansion without scrollbar clipping
    assert.match(css, /body\.air-export\s*\.air-layout,\s*body\.air-export\s*\.air-report-pane\s*\{[^}]*overflow:\s*visible/);
    assert.match(css, /\.air-report-pane\s*\{[^}]*overflow:\s*visible!important/);
});

test('app.js scrolls the report pane during zoom, chapter navigation and cell drag autoscroll', () => {
    const appJsPath = path.join(rootDir, 'frontend/js/ai-report/app.js');
    const js = fs.readFileSync(appJsPath, 'utf8');

    // zoomOut and zoomIn support .air-report-pane
    assert.match(js, /function zoomOut\(\)\s*\{[^}]*closest\('\.air-report-pane'\)/);
    assert.match(js, /function zoomIn\(chapterId\)\s*\{[^}]*closest\('\.air-report-pane'\)/);
    assert.match(js, /pane\.scrollTop\s*=\s*scrollTarget/);

    // autoScroll during cell dragging moves pane.scrollTop
    assert.match(js, /function autoScroll\(\)\s*\{[^}]*pane\.scrollTop\s*\+=\s*speed/);

    // wheel events on outer layout outside chat forward to paneHost
    assert.match(js, /paneHost\.scrollTop\s*\+=\s*event\.deltaY/);
});
