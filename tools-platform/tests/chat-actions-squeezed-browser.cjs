const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');

let server;
const root = path.resolve(__dirname, '..');

function serve() {
    return new Promise((resolve) => {
        server = http.createServer((req, res) => {
            let reqPath = req.url.split('?')[0];
            if (reqPath === '/') reqPath = '/index.html';
            let filePath = path.join(root, 'frontend', reqPath);
            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end();
                return;
            }
            const ext = path.extname(filePath);
            const mimeTypes = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg'
            };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
            res.end(fs.readFileSync(filePath));
        });
        server.listen(0, '127.0.0.1', () => {
            resolve(server.address().port);
        });
    });
}

app.whenReady().then(async () => {
    const port = await serve();
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.webContents.on('console-message', (e, level, msg) => console.log('Renderer:', msg));
    await win.loadURL(`http://127.0.0.1:${port}/index.html`);

    async function evaluate(fnStr) {
        return await win.webContents.executeJavaScript(fnStr);
    }

    // Wait for DOM and enter chat mode
    await evaluate(`new Promise(res => {
        if (document.readyState === 'complete') res();
        else window.addEventListener('DOMContentLoaded', () => res());
    })`);

    await evaluate(`
        document.documentElement.classList.add('platform-home');
        document.body.classList.add('dc-chatting');
        const wsToggle = document.getElementById('dcWorkspaceToggle');
        if (wsToggle) wsToggle.hidden = false;
    `);

    await new Promise(r => setTimeout(r, 200));

    // In wide mode (1400px), buttons should be on a single row
    const wideInfo = await evaluate(`(() => {
        const actions = document.querySelector('.dc-chat-actions');
        const btns = Array.from(actions.querySelectorAll('.dc-ghost-btn'));
        const labels = Array.from(actions.querySelectorAll('.dc-btn-label'));
        const visibleBtns = btns.filter(b => b.offsetWidth > 0 && b.offsetHeight > 0);
        const firstTop = visibleBtns[0].getBoundingClientRect().top;
        const allSameRow = visibleBtns.every(b => Math.abs(b.getBoundingClientRect().top - firstTop) < 4);
        return {
            allSameRow,
            actionsHeight: actions.getBoundingClientRect().height,
            visibleLabels: labels.filter(l => window.getComputedStyle(l).opacity !== '0' && l.offsetWidth > 0).length
        };
    })()`);

    console.log('Wide mode info:', wideInfo);
    assert.ok(wideInfo.allSameRow, 'Wide mode buttons are all in a single row');
    assert.ok(wideInfo.actionsHeight <= 45, 'Actions container does not wrap in wide mode');
    assert.ok(wideInfo.visibleLabels >= 5, 'Action buttons display text labels in wide mode');

    // Simulate squeezed condition:
    // 1. Squeeze window down (simulating right sidebar opened taking 50% width)
    win.setSize(760, 800);
    await evaluate(`
        document.body.classList.add('dc-workspace-open');
        document.querySelector('.dc-chat-head').classList.add('is-squeezed');
        document.querySelector('.dc-chat-actions').classList.add('is-squeezed');
    `);
    await new Promise(r => setTimeout(r, 350));

    const squeezedInfo = await evaluate(`(() => {
        const actions = document.querySelector('.dc-chat-actions');
        const btns = Array.from(actions.querySelectorAll('.dc-ghost-btn'));
        const visibleBtns = btns.filter(b => b.offsetWidth > 0 && b.offsetHeight > 0);
        const labels = Array.from(actions.querySelectorAll('.dc-btn-label'));
        const firstTop = visibleBtns[0].getBoundingClientRect().top;
        const allSameRow = visibleBtns.every(b => Math.abs(b.getBoundingClientRect().top - firstTop) < 4);
        const iconWidths = visibleBtns.map(b => b.getBoundingClientRect().width);
        return {
            allSameRow,
            actionsHeight: actions.getBoundingClientRect().height,
            maxIconWidth: Math.max(...iconWidths),
            visibleLabels: labels.filter(l => window.getComputedStyle(l).opacity !== '0' && l.offsetWidth > 0).length
        };
    })()`);

    console.log('Squeezed mode info:', squeezedInfo);
    assert.ok(squeezedInfo.allSameRow, 'Squeezed buttons MUST all remain in a single row');
    assert.ok(squeezedInfo.actionsHeight <= 36, `Actions container height is compact (${squeezedInfo.actionsHeight}px) and never wraps`);
    assert.equal(squeezedInfo.visibleLabels, 0, 'In squeezed mode, labels must be completely hidden (0 visible)');
    assert.ok(squeezedInfo.maxIconWidth <= 34, `Buttons collapse into compact square icon buttons (max width ${squeezedInfo.maxIconWidth}px)`);

    console.log('PASS: Chat actions smoothly collapse into elegant icon buttons without wrapping under squeeze conditions!');

    // Simulate ultra-squeezed condition:
    // Squeeze window down to extreme narrow width (e.g. 360px)
    win.setSize(420, 800);
    await evaluate(`
        document.querySelector('.dc-chat-head').classList.add('is-ultra-squeezed');
        document.querySelector('.dc-chat-actions').classList.add('is-ultra-squeezed');
        const moreWrap = document.getElementById('dcActionsMore');
        if (moreWrap) moreWrap.hidden = false;
    `);
    await new Promise(r => setTimeout(r, 350));

    const ultraInfo = await evaluate(`(() => {
        const moreWrap = document.getElementById('dcActionsMore');
        const moreBtn = document.getElementById('dcActionsMoreBtn');
        const menu = document.getElementById('dcActionsMenu');
        const normalBtns = [
            document.getElementById('dcWorkspaceToggle'),
            document.getElementById('dcBrowserToggle'),
            document.getElementById('dcHistoryBtn'),
            document.getElementById('dcExport'),
            document.getElementById('dcNewChat'),
            document.getElementById('dcBackToTools')
        ].filter(Boolean);
        const title = document.querySelector('.dc-chat-title');

        const allNormalHidden = normalBtns.every(b => window.getComputedStyle(b).display === 'none');
        const moreVisible = window.getComputedStyle(moreWrap).display !== 'none' && moreBtn.offsetWidth > 0;
        const titleRect = title.getBoundingClientRect();
        const moreRect = moreBtn.getBoundingClientRect();
        const noOverlap = titleRect.right <= moreRect.left;

        // Test opening menu
        moreBtn.click();
        const menuOpenAfterClick = !menu.hidden && window.getComputedStyle(menu).display !== 'none';
        const menuItemsCount = menu.querySelectorAll('.dc-actions-item').length;

        // Test closing menu by clicking outside
        document.body.click();
        const menuClosedAfterOutsideClick = menu.hidden;

        return {
            titleRect: { left: titleRect.left, right: titleRect.right, width: titleRect.width },
            moreRect: { left: moreRect.left, right: moreRect.right, width: moreRect.width },
            allNormalHidden,
            moreVisible,
            moreWidth: moreRect.width,
            noOverlap,
            menuOpenAfterClick,
            menuItemsCount,
            menuClosedAfterOutsideClick
        };
    })()`);

    console.log('Ultra-squeezed mode info:', ultraInfo);
    assert.ok(ultraInfo.allNormalHidden, 'In ultra-squeezed mode, all normal action buttons must be hidden (display: none)');
    assert.ok(ultraInfo.moreVisible, 'More actions button (···) is visible in ultra-squeezed mode');
    assert.ok(ultraInfo.moreWidth <= 34, `More actions button is compact square (width ${ultraInfo.moreWidth}px)`);
    assert.ok(ultraInfo.noOverlap, 'Zero collision/overlap between chat title and action button');
    assert.ok(ultraInfo.menuOpenAfterClick, 'Clicking more button opens dropdown menu');
    assert.ok(ultraInfo.menuItemsCount >= 5, `Dropdown menu contains all actions (${ultraInfo.menuItemsCount} items)`);
    assert.ok(ultraInfo.menuClosedAfterOutsideClick, 'Clicking outside closes dropdown menu');

    console.log('PASS: Ultra-squeezed dropdown menu smoothly replaces cramped icons with zero text overlap!');

    // 自动检测（不手动加 class）：缩窄收成「···」，再拉宽必须恢复；终端按钮可用时菜单里有终端
    const headState = () => evaluate(`(() => {
        const head = document.querySelector('.dc-chat-head');
        const title = head.querySelector('.dc-chat-title');
        return { ultra: head.classList.contains('is-ultra-squeezed'), titleWidth: title.getBoundingClientRect().width };
    })()`);
    await evaluate(`document.body.classList.remove('dc-workspace-open'); (() => { const t = document.getElementById('dcTerminalToggle'); if (t) t.hidden = false; })()`);
    for (const width of [1400, 900, 560]) {
        win.setSize(width, 800);
        await new Promise(r => setTimeout(r, 400));
        const state = await headState();
        assert.equal(state.ultra, false, `not collapsed at ${width}px`);
    }
    win.setSize(420, 800);
    await new Promise(r => setTimeout(r, 400));
    assert.equal((await headState()).ultra, true, 'collapses into the more menu at 420px');
    if (await evaluate(`Boolean(document.getElementById('dcTerminalToggle'))`)) {
        const items = await evaluate(`(() => { document.getElementById('dcActionsMoreBtn').click(); const list = [...document.querySelectorAll('#dcActionsMenu .dc-actions-item')].map(b => b.dataset.action); document.body.click(); return list; })()`);
        assert.ok(items.includes('terminal'), `terminal is offered in the more menu (${items.join(',')})`);
    }
    for (const width of [560, 900, 1400]) {
        win.setSize(width, 800);
        await new Promise(r => setTimeout(r, 400));
        const state = await headState();
        assert.equal(state.ultra, false, `restores buttons when widened back to ${width}px`);
        assert.ok(state.titleWidth >= 100, `title keeps a readable width at ${width}px (${state.titleWidth}px)`);
    }
    console.log('PASS: collapse/restore follows the real header width in both directions');
    win.destroy();
    server.close();
    app.exit(0);
}).catch(err => {
    console.error(err);
    if (server) server.close();
    process.exit(1);
});
