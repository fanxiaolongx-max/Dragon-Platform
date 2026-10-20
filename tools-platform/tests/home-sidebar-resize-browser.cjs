/* Run: node_modules/.bin/electron tests/home-sidebar-resize-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-sidebar-resize-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);
const width = () => evaluate('homeSidebar.getBoundingClientRect().width');
const pref = mode => `home_sidebar_width:default:alice:${mode}`;
async function reload() {
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
    await wait(30);
}
async function drag(delta, { cancel = false } = {}) {
    const box = await evaluate('homeSidebarResizer.getBoundingClientRect().toJSON()');
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
    const send = params => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', params);
    await send({ type: 'mouseMoved', x, y });
    await send({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send({ type: 'mouseMoved', x: x + delta, y, button: 'left', buttons: 1 });
    await wait(30);
    if (cancel) await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
    await send({ type: 'mouseReleased', x: x + delta, y, button: 'left', buttons: 0, clickCount: 1 });
    await wait(25);
}
const key = name => evaluate(`homeSidebarResizer.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(name)},bubbles:true}))`);
app.whenReady().then(async () => {
    const web = express();
    web.get('/', (req, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, tag => {
            if (tag.includes('id="homeModeBootstrap"')) return tag;
            if (req.query.preinit && tag.includes('/js/home/home-mode.js')) return '';
            return /src="\/js\/(?:home\/home-mode|shared\/i18n)\.js"/.test(tag) ? tag : '';
        });
        html = html.replace(/<body\b[^>]*>/, tag => `${tag}<script>
            if (!localStorage.getItem('tools_user')) localStorage.setItem('tools_user','alice');
            if (!localStorage.getItem('tools_tenant_id')) localStorage.setItem('tools_tenant_id','default');
            if (!localStorage.getItem('home_sidebar_mode')) localStorage.setItem('home_sidebar_mode','expanded');
            localStorage.setItem('tools_lang','zh-CN');
        </script>`);
        res.type('html').send(html);
    });
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 950, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (_, level, message) => { if (level === 3) errors.push(message); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    // 不加载主模式脚本，确认即使它尚未就绪，浏览器首屏也只有一个模式。
    for (const hash of ['', '#tools', '#unknown']) {
        await win.loadURL(`${origin}/?preinit=1&case=${encodeURIComponent(hash)}${hash}`);
        assert.equal(await evaluate('typeof HomeMode'), 'undefined');
        const tools = hash === '#tools';
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.tools-grid')).display==='none'"), !tools);
        assert.equal(await evaluate("getComputedStyle(dragonClaw).display==='none'"), tools);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-home-panel=chat]')).display==='none'"), tools);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('[data-home-panel=tools]')).display==='none'"), !tools);
    }
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    win.webContents.debugger.attach('1.3');
    assert.ok(Math.abs(await width() - 352) < 1, 'Default is wider than the previous 300px');
    await drag(72);
    assert.ok(Math.abs(await width() - 424) < 2, `Pointer drag changes width: ${await width()}`);
    assert.equal(await evaluate(`localStorage.getItem('${pref('chat')}')`), '424');
    await evaluate("HomeMode.set('tools')");
    assert.ok(Math.abs(await width() - 352) < 1, 'Tools start with their own default');
    await drag(-40);
    assert.equal(await evaluate(`localStorage.getItem('${pref('tools')}')`), '312');
    await evaluate("HomeMode.set('chat')");
    assert.ok(Math.abs(await width() - 424) < 1);
    await drag(50, { cancel: true });
    assert.ok(Math.abs(await width() - 424) < 1, 'Escape cancels an active drag');
    await evaluate("document.querySelector('[data-home-mode=chat]').click()");
    assert.equal(await evaluate('homeSidebarResizer.hidden'), true);
    assert.ok(Math.abs(await width() - 60) < 1);
    await evaluate("document.querySelector('[data-home-mode=chat]').click()");
    assert.ok(Math.abs(await width() - 424) < 1);
    await reload();
    assert.ok(Math.abs(await width() - 424) < 1, 'Reload restores saved chat width');
    await evaluate("HomeMode.set('tools')");
    assert.ok(Math.abs(await width() - 312) < 1);
    await evaluate("localStorage.setItem('tools_user','bob')");
    await reload();
    assert.ok(Math.abs(await width() - 352) < 1, 'Another account has independent preferences');
    await drag(48);
    await evaluate("localStorage.setItem('tools_user','alice')");
    await reload();
    assert.ok(Math.abs(await width() - 312) < 1);
    await evaluate("localStorage.setItem('tools_tenant_id','other')");
    await reload();
    assert.ok(Math.abs(await width() - 352) < 1, 'Another tenant has independent preferences');
    await evaluate("localStorage.setItem('tools_tenant_id','default')");
    await reload();
    assert.ok(Math.abs(await width() - 312) < 1);
    await evaluate("HomeMode.set('chat')");
    await key('End');
    assert.ok(Math.abs(await width() - 560) < 1);
    win.setSize(950, 950); await wait(60);
    assert.ok(await width() < 560, 'A narrow viewport temporarily caps the width');
    assert.equal(await evaluate(`localStorage.getItem('${pref('chat')}')`), '560');
    win.setSize(1440, 950); await wait(60);
    assert.ok(Math.abs(await width() - 560) < 1, 'Returning to a wide viewport restores the preference');
    await evaluate("dcWorkspacePanel.hidden=false; document.body.classList.add('dc-workspace-open')");
    await wait(40);
    assert.equal(await evaluate('homeSidebarResizer.hidden'), true, 'Existing automatic collapse works with the workspace');
    await evaluate("document.querySelector('[data-home-mode=chat]').click()");
    assert.equal(await evaluate('homeSidebarResizer.hidden'), false);
    assert.ok(await evaluate("document.querySelector('.home-workspace').scrollWidth <= document.querySelector('.home-workspace').clientWidth+1"));
    await evaluate("document.body.classList.remove('dc-workspace-open');dcWorkspacePanel.hidden=true");
    await wait(30);
    win.setSize(390, 844); await wait(60);
    assert.equal(await evaluate('homeSidebarResizer.hidden'), true, 'Mobile layout has no resize grip');
    win.setSize(1440, 950); await wait(60);
    await evaluate("homeSidebarResizer.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
    assert.ok(Math.abs(await width() - 352) < 1, 'Double-click restores the default');
    assert.equal(await evaluate(`localStorage.getItem('${pref('chat')}')`), null);
    await key('ArrowRight');
    assert.ok(Math.abs(await width() - 368) < 1);
    await evaluate("ToolsI18n.setLanguage('en-US')");
    assert.equal(await evaluate("homeSidebarResizer.getAttribute('aria-label')"), 'Resize sidebar');
    await key('Enter');
    await evaluate("ToolsI18n.setLanguage('zh-CN');homeChatList.innerHTML='<div class=home-chat-group>今天</div>'+Array.from({length:14},()=>'<button class=home-chat-item><span class=home-chat-title>请结合项目源码，解释并优化这段工具脚本</span><span class=home-chat-meta>19:52</span></button>').join('')");
    await wait(70);
    fs.writeFileSync(path.join(temp, 'preview.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log(`PASS: initial chat/tools visibility before mode script, default width, native dragging, separate chat/tools preferences, reload, account/tenant isolation, Escape, keyboard, reset, viewport/workspace/mobile handling. Preview: ${path.join(temp, 'preview.png')}`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    win?.destroy(); server?.closeAllConnections(); server?.close(); app.exit(process.exitCode || 0);
});
