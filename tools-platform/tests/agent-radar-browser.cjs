// Run: node_modules/.bin/electron tests/agent-radar-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const frontend = path.join(__dirname, '../frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-radar-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
const fixture = path.join(temp, 'index.html');
const base = pathToFileURL(frontend + path.sep).href;
const home = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/(href|src)="\//g, '$1="')
    .replace('<head>', `<head><base href="${base}">`)
    .replace('home-mode-chat home-booting', 'home-mode-chat dc-chatting')
    .replace('</body>', '<script src="js/home/agent-radar.js"></script></body>');
fs.writeFileSync(fixture, home);

let win;
const run = fn => win.webContents.executeJavaScript(`(${fn})()`);
const nextLayout = () => run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

function measure() {
    return run(() => {
        const pill = document.querySelector('.dc-radar-pill');
        const menu = document.querySelector('.dc-radar-popover');
        const chat = document.getElementById('dragonClaw').getBoundingClientRect();
        const anchor = pill.getBoundingClientRect();
        const box = menu.getBoundingClientRect();
        const hit = (node, x, y) => node.contains(document.elementFromPoint(x, y));
        return {
            triggerVisible: hit(pill, anchor.x + anchor.width / 2, anchor.y + anchor.height / 2),
            fullyVisible: [box.left + 5, box.right - 5].every(x =>
                [box.top + 5, box.bottom - 5].every(y => hit(menu, x, y))),
            gap: box.top - anchor.bottom,
            left: box.left,
            right: box.right,
            chatRight: chat.right,
            scrollable: menu.scrollHeight > menu.clientHeight,
            hidden: menu.hidden
        };
    });
}

app.whenReady().then(async () => {
    win = new BrowserWindow({ show: false, width: 1100, height: 640, webPreferences: { sandbox: true } });
    await win.loadFile(fixture);
    await run(() => {
        document.querySelector('.dc-chat-head').getAnimations().forEach(animation => animation.finish());
        window.ApprovalInbox = { items: () => Array.from({ length: 25 }, (_, id) => ({ id, toolName: `Item ${id}` })) };
        document.querySelector('.home-content').insertAdjacentHTML('beforeend', '<aside class="dc-terminal-panel"></aside>');
        document.body.classList.add('dc-terminal-open');
        document.querySelector('.dc-radar-pill').click();
    });
    await nextLayout();
    const before = await measure();
    assert.ok(before.triggerVisible && before.fullyVisible && before.scrollable);
    assert.ok(before.right < before.chatRight && Math.abs(before.gap - 8) < 1);

    await run(() => document.body.style.setProperty('--terminal-panel-width', '680px'));
    await nextLayout();
    const after = await measure();
    assert.ok(after.triggerVisible && after.fullyVisible && after.scrollable);
    assert.ok(after.right < after.chatRight && Math.abs(after.gap - 8) < 1);
    assert.ok(after.left < before.left, 'the open menu follows the resized conversation');

    await run(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    assert.equal((await measure()).hidden, true);
    assert.equal(await run(() => document.activeElement.matches('.dc-radar-pill')), true);

    await run(() => {
        document.documentElement.dataset.theme = 'dark';
        document.documentElement.classList.add('desktop-win', 'is-desktop-app');
        document.body.classList.remove('dc-terminal-open');
        document.body.classList.add('v2-side-collapsed');
        document.querySelector('.dc-terminal-panel').hidden = true;
        localStorage.setItem('tools_lang', 'en-US');
        document.querySelector('.dc-radar-pill').click();
    });
    win.setContentSize(420, 480);
    await nextLayout();
    const narrow = await measure();
    assert.ok(narrow.triggerVisible && narrow.fullyVisible && narrow.scrollable);
    assert.equal(await run(() => document.querySelector('.dc-radar-head strong').textContent), 'Agent Status Radar');
    assert.equal(await run(() => {
        const style = getComputedStyle(document.querySelector('.dc-radar-popover'));
        return style.backgroundColor === getComputedStyle(document.body).backgroundColor;
    }), true);
    await run(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    assert.equal((await measure()).hidden, true);
    console.log('PASS: radar visibility, sidebar resizing, scrolling, narrow layout and dismissal.');
    finish(0);
}).catch(error => {
    console.error(error);
    finish(1);
});

function finish(code) {
    win?.destroy();
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(code);
}
