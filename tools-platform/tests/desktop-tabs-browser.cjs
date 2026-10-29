// node_modules/.bin/electron --disable-gpu tests/desktop-tabs-browser.cjs
// 全部使用临时数据和本地模拟页面，不连接公司内网或读取登录凭据。
const { app, BrowserWindow, ipcMain, Menu, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-tabs-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
const extensionsStatePath = path.join(temp, 'extensions.json');
const extensionDir = path.join(temp, 'fixture-extension');
fs.mkdirSync(extensionDir);
fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({ manifest_version: 2, name: 'Fixture Extension', version: '1.0', browser_action: { default_popup: 'popup.html' }, options_page: 'options.html' }));
fs.writeFileSync(path.join(extensionDir, 'popup.html'), '<title>Fixture Extension</title><h1>Extension panel</h1>');
fs.writeFileSync(path.join(extensionDir, 'options.html'), '<title>Fixture Options</title><h1>Extension options</h1>');
fs.writeFileSync(extensionsStatePath, JSON.stringify({ imported: [{ key: 'folder:fixture', source: 'folder', dir: extensionDir, name: 'Fixture Extension' }], disabled: ['auto:icpm', 'bundled:chrome-capture-pro', 'bundled:overseas-salary-calculator'] }));
const { createPromoStack } = require('../desktop-promo/promo-stack');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let stack, server, language = 'zh-CN';
const errors = [];
async function until(fn) {
    for (let i = 0; i < 180; i++) { if (await fn()) return; await delay(40); }
    throw new Error('Timed out: ' + fn);
}
const evaluate = async (wc, fn, ...args) => {
    let timer;
    try {
        return await Promise.race([
            wc.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Evaluation timed out: ' + fn)), 5000); })
        ]);
    } finally { clearTimeout(timer); }
};
const pageOf = win => win.getBrowserViews()[0].webContents;
const count = win => evaluate(win.webContents, () => document.querySelectorAll('.tab').length);
const selected = win => evaluate(win.webContents, () => document.querySelector('.tab[aria-selected="true"]').dataset.id);
const clickTab = (win, id, close = false) => evaluate(win.webContents, (id, close) => document.querySelector(`[data-tab="${id}"][data-act="${close ? 'tab-close' : 'tab-select'}"]`).click(), id, close);
app.whenReady().then(async () => {
    console.log('Checking Dragon tabs with local fixture pages…');
    const web = express();
    web.use(express.urlencoded({ extended: false }));
    web.get(['/one', '/two', '/popup'], (req, res) => res.send(`<!doctype html><title>${req.path}</title><style>body{background:#e5f5f1;color:#16394c;font:20px sans-serif;margin:30px}input{font:inherit}</style><h1>Dragon ${req.path}</h1><input id="value" value="initial"><a id="popup" target="_blank" href="/popup">Open new tab</a><form id="post" method="post" action="/posted" target="_blank"><input name="message" value="preserve body"></form>`));
    web.post('/posted', (req, res) => res.send(`<title>Posted</title><p id="posted">${req.body.message}</p>`));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    stack = createPromoStack({ statePath: path.join(temp, 'stack.json'), extensionsStatePath, getLanguage: () => language });
    ipcMain.on('promo-card:action', (event, action, payload) => stack.handleAction(event.sender, action, payload));
    const link = { id: 'fixture', enabled: true, name: '示例推广', nameEn: 'Sample promotion', url: base + '/one' };
    stack.sync({ desktopStack: true, maxLinks: 1, links: [link] });
    const compact = BrowserWindow.getAllWindows()[0];
    const preview = pageOf(compact);
    await until(() => evaluate(preview, () => !!document.querySelector('#value')));
    await evaluate(preview, () => { document.querySelector('#value').value = 'preview input'; });
    const site = { origin: base, name: '示例脚本', url: base + '/two', code: 'window.scriptRuns = (window.scriptRuns || 0) + 1' };

    // 本机 API / 数据抓取入口，每次请求新建标签；后台同步脚本不打开标签。
    stack.putSiteScript(site);
    const dragon = BrowserWindow.getAllWindows().find(win => win !== compact);
    dragon.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await until(() => count(dragon).then(n => n === 1));
    const firstId = await selected(dragon), first = pageOf(dragon);
    await until(() => evaluate(first, () => window.scriptRuns === 1));
    await evaluate(first, () => { document.querySelector('#value').value = 'first tab preserved'; });
    stack.putSiteScript(site);
    await until(() => count(dragon).then(n => n === 2));
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    stack.putSiteScript({ ...site, code: 'window.updatedScript = true' }, { run: false });
    assert.equal(await count(dragon), 2);
    assert.equal(stack.runSiteScript(base), true); // 托盘入口
    await until(() => count(dragon).then(n => n === 3));

    // 浏览器右上角脚本菜单也在同一窗口新增标签。
    let scriptMenu;
    const originalBuild = Menu.buildFromTemplate;
    Menu.buildFromTemplate = template => { scriptMenu = template; return { popup() {} }; };
    try { stack.handleAction(dragon.webContents, 'scripts'); }
    finally { Menu.buildFromTemplate = originalBuild; }
    scriptMenu.find(item => item.label?.includes('打开 示例脚本')).click();
    await until(() => count(dragon).then(n => n === 4));
    await until(() => evaluate(pageOf(dragon), () => window.updatedScript === true));
    console.log('Checked script entry points and shared window.');

    // 首页推广每次点击新增标签。
    stack.openInBrowser(link); stack.openInBrowser(link);
    await until(() => count(dragon).then(n => n === 6));
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    await clickTab(dragon, firstId);
    await until(() => pageOf(dragon) === first);
    assert.equal(await evaluate(first, () => document.querySelector('#value').value), 'first tab preserved');

    // 网页原生 target=_blank 和 POST 新页不覆盖来源页面。
    await evaluate(first, () => document.querySelector('#popup').click());
    await until(() => count(dragon).then(n => n === 7));
    await until(() => pageOf(dragon).getURL() === base + '/popup');
    assert.equal(first.getURL(), base + '/two');
    await clickTab(dragon, firstId);
    await until(() => pageOf(dragon) === first);
    await evaluate(first, () => document.querySelector('#post').submit());
    await until(() => count(dragon).then(n => n === 8));
    const posted = pageOf(dragon);
    await until(() => evaluate(posted, () => !!document.querySelector('#posted')));
    assert.equal(await evaluate(posted, () => document.querySelector('#posted').textContent), 'preserve body');
    console.log('Checked promotion, target=_blank and POST tabs.');

    const postedId = await selected(dragon);
    const inactiveId = await evaluate(dragon.webContents, () => document.querySelectorAll('.tab')[1].dataset.id);
    await clickTab(dragon, inactiveId, true);
    await until(() => count(dragon).then(n => n === 7));
    assert.equal(await selected(dragon), postedId);
    await clickTab(dragon, postedId, true);
    await until(() => count(dragon).then(n => n === 6));
    assert.ok(await selected(dragon));
    console.log('Checked tab closing.');

    // 地址栏 IPC 只接受 http(s)，远程页面无法冒充浏览器工具栏操作。
    const current = pageOf(dragon), oldUrl = current.getURL();
    stack.handleAction(current, 'tab-close', await selected(dragon));
    stack.handleAction(dragon.webContents, 'navigate', 'file:///tmp/should-not-open');
    await delay(100);
    assert.equal(current.getURL(), oldUrl);
    assert.equal(await count(dragon), 6);
    await evaluate(dragon.webContents, url => { document.querySelector('#address').value = url; document.querySelector('#url').requestSubmit(); }, base + '/one');
    await until(() => current.getURL() === base + '/one');
    console.log('Checked toolbar boundary and navigation.');

    // 从预览移入标签、切换、最小化、恢复、关闭大窗，均保留同一页面实例。
    stack.handleAction(compact.webContents, 'expand');
    await until(() => pageOf(dragon) === preview);
    assert.equal(await count(dragon), 7);
    await until(() => evaluate(preview, () => !document.getElementById('tools-desktop-preview-scrollbars')));
    assert.equal(await evaluate(preview, () => document.querySelector('#value').value), 'preview input');
    console.log('Checked preview page state before live capture.');
    const frame = await Promise.race([stack.frame('fixture'), delay(4000).then(() => { throw new Error('Live capture timed out after preview adoption'); })]);
    assert.ok(frame === null || Buffer.isBuffer(frame), 'during view transfer the thumbnail either resolves or falls back to its cover, never hangs');
    stack.handleAction(dragon.webContents, 'minimize');
    await until(() => evaluate(preview, () => !!document.getElementById('tools-desktop-preview-scrollbars')));
    stack.openInBrowser(link);
    await until(() => count(dragon).then(n => n === 8));
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    await clickTab(dragon, firstId);
    await until(() => pageOf(dragon) === first);
    assert.equal(await evaluate(first, () => document.querySelector('#value').value), 'first tab preserved');

    // 标签过多、640px 窄窗、双语和深浅主题的工具栏可用。
    console.log('Checked address bar, tab state and preview adoption.');
    dragon.setSize(640, 520);
    for (const [lang, theme] of [['zh-CN', 'dark'], ['en-US', 'light']]) {
        language = lang; nativeTheme.themeSource = theme; stack.languageChanged();
        await until(() => evaluate(dragon.webContents, expected => document.querySelector('#browserBrand').textContent === expected, lang === 'en-US' ? 'Dragon Browser' : 'Dragon 浏览器'));
        await delay(150);
        assert.equal(await evaluate(dragon.webContents, () => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await evaluate(dragon.webContents, () => document.querySelector('#closeBtn').getBoundingClientRect().right <= innerWidth), true);
        fs.writeFileSync(path.join(temp, theme + '.png'), (await dragon.webContents.capturePage({ x: 0, y: 0, width: 640, height: 74 })).toPNG());
    }
    assert.deepEqual(errors, []);
    const beforeNew = await count(dragon);
    await evaluate(dragon.webContents, () => document.querySelector('#newTabBtn').click());
    await until(() => count(dragon).then(n => n === beforeNew + 1));
    const blank = pageOf(dragon);
    await until(() => blank.getURL() === 'about:blank');
    blank.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
    await until(() => count(dragon).then(n => n === beforeNew));

    stack.handleAction(dragon.webContents, 'close');
    await until(() => dragon.isDestroyed());
    await until(() => evaluate(preview, () => !!document.getElementById('tools-desktop-preview-scrollbars')));
    assert.equal(await evaluate(preview, () => document.querySelector('#value').value), 'preview input');
    await until(() => first.isDestroyed());
    stack.openInBrowser(link);
    const reopened = BrowserWindow.getAllWindows().find(win => win !== compact);
    assert.notEqual(reopened, dragon);
    await until(() => count(reopened).then(n => n === 1));
    let pluginMenu;
    Menu.buildFromTemplate = template => { pluginMenu = template; return { popup() {} }; };
    try { stack.handleAction(reopened.webContents, 'plugins'); }
    finally { Menu.buildFromTemplate = originalBuild; }
    const extensionMenu = pluginMenu.find(item => item.label?.startsWith('Fixture Extension')).submenu;
    extensionMenu.find(item => item.label === 'Open extension panel').click();
    await until(() => count(reopened).then(n => n === 2));
    await until(() => pageOf(reopened).getURL().endsWith('/popup.html'));
    const panelId = await selected(reopened);
    extensionMenu.find(item => item.label === 'Extension options').click();
    await until(() => count(reopened).then(n => n === 3));
    await until(() => pageOf(reopened).getURL().endsWith('/options.html'));
    assert.equal(BrowserWindow.getAllWindows().length, 2, 'extension panels also use the shared window');
    await clickTab(reopened, await selected(reopened), true);
    await clickTab(reopened, panelId, true);
    await until(() => count(reopened).then(n => n === 1));
    const lastId = await selected(reopened);
    await clickTab(reopened, lastId, true);
    await until(() => reopened.isDestroyed());
    console.log('PASS: one Dragon window; API, tray, script menu, promotion, target=_blank and POST tabs; independent state; close/switch; toolbar IPC boundary; address bar; preview adoption/minimize/restore; bilingual 640px dark/light toolbar; new tab/shortcut; extension panel/options tabs; close last tab and reopen. Screenshots: ' + temp);
}).then(async () => { stack?.destroy(); server?.close(); await delay(200); app.quit(); }).catch(error => {
    console.error(error); stack?.destroy(); server?.close(); app.exit(1);
});
