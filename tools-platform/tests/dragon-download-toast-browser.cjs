// node_modules/.bin/electron tests/dragon-download-toast-browser.cjs [截图目录]
// 真实渲染 Dragon 浏览器侧栏下载横幅：透明置顶视图贴在下载按钮下方、最多 3 条、新挤旧、完成后按先后逐条消失、清空后自动卸下视图。
const { app, BrowserWindow, BrowserView } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createDownloadToast } = require('../desktop-promo/download-toast');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-download-toast-'));
app.setPath('userData', path.join(temp, 'profile'));
const shots = process.argv.slice(2).find(arg => !arg.startsWith('-') && !arg.endsWith('.cjs'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
setTimeout(() => { console.error('timeout'); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
    const host = new BrowserWindow({ show: false, width: 900, height: 640, webPreferences: { backgroundThrottling: false } });
    await host.loadURL('data:text/html,<body style="margin:0;background:linear-gradient(135deg,%23e0f2fe,%23fef3c7)"><div style="height:44px;background:%23fff;border-bottom:1px solid %23ddd"></div></body>');
    // 模拟网页 BrowserView，横幅必须叠在它上面。
    const page = new BrowserView();
    host.addBrowserView(page); page.setBounds({ x: 0, y: 45, width: 900, height: 595 });
    await page.webContents.loadURL('data:text/html,<body style="margin:0;background:%23f8fafc;font:14px system-ui;padding:20px">网页内容 Page content</body>');
    const actions = [];
    const toast = createDownloadToast({ getHost: () => host, onAction: (id, action) => actions.push([id, action]) });
    const item = (id, name, state = 'progressing', received = 0, total = 2048000) => ({ id, name, state, received, total });
    const view = () => host.getBrowserViews().find(v => v !== page);
    const count = () => view()?.webContents.executeJavaScript('window.__dragonDownloadToast.count()') ?? 0;
    const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(path.join(shots, name + '.png'), (await view().webContents.capturePage()).toPNG()); } };

    toast.push({ started: true, item: item('ignored', 'no-anchor.zip') });
    assert.equal(view(), undefined, '没有按钮锚点（侧栏收起）时不创建横幅');

    toast.setAnchor({ right: 880, bottom: 40 });
    toast.push({ started: true, item: item('a', '季度经营分析报告-最终版-v3.pdf') });
    await wait(900);
    assert.ok(toast.attached, '有横幅时挂载视图');
    const bounds = view().getBounds();
    assert.equal(bounds.y, 42, '紧贴按钮下方');
    assert.ok(bounds.x + bounds.width >= 880 && bounds.x + bounds.width <= 900, '右侧与按钮对齐: ' + JSON.stringify(bounds));
    assert.ok(bounds.height > 50 && bounds.height < 90, '高度跟随单条内容: ' + bounds.height);
    assert.equal(host.getBrowserViews().at(-1), view(), '横幅位于网页视图之上');

    toast.push({ item: item('a', '季度经营分析报告-最终版-v3.pdf', 'progressing', 1024000) });
    toast.push({ started: true, item: item('b', 'sales-data-2026.xlsx') });
    toast.push({ started: true, item: item('c', 'screenshot.png', 'progressing', 0, 0) });
    await wait(700);
    await shot('1-three-progressing');
    assert.equal(await count(), 3);
    toast.push({ started: true, item: item('d', 'installer-arm64.dmg') });
    await wait(1000);
    assert.equal(await count(), 3, '超过 3 条时最旧的被挤掉');
    const names = await view().webContents.executeJavaScript('[...document.querySelectorAll(".card")].map(c=>c.title)');
    assert.deepEqual(names, ['installer-arm64.dmg', 'screenshot.png', 'sales-data-2026.xlsx'], '最新在最上方');

    toast.push({ finished: true, item: item('b', 'sales-data-2026.xlsx', 'completed', 2048000) });
    toast.push({ finished: true, item: item('d', 'installer-arm64.dmg', 'completed', 2048000) });
    toast.push({ finished: true, item: item('c', 'screenshot.png', 'completed', 512000, 512000) });
    await wait(700);
    await shot('2-completed');
    if (toast.refreshConfig && shots) {
        await view().webContents.executeJavaScript("window.__dragonDownloadToast.handle({type:'config',theme:'dark',lang:'en-US'})");
        await wait(200);
        await shot('3-dark-en');
        await view().webContents.executeJavaScript("window.__dragonDownloadToast.handle({type:'config',theme:'light',lang:'zh-CN'})");
    }
    await view().webContents.executeJavaScript('document.querySelector(".card[title=\'installer-arm64.dmg\']").click()');
    assert.deepEqual(actions, [['d', 'open']], '点击已完成横幅打开文件');
    // 完成后自动停留并在倒计时后丝滑消失，全部消失后自动卸下置顶视图
    await wait(6000);
    assert.equal(await count(), 0, '完成的横幅自动倒计时消失');
    await wait(300);
    assert.equal(toast.attached, false, '全部消失后卸下视图，不再拦截网页点击');

    toast.push({ started: true, item: item('e', 'again.txt') });
    await wait(600);
    assert.ok(toast.attached, '再次下载会重新出现');
    toast.setAnchor(null);
    await wait(300);
    assert.equal(toast.attached, false, '侧栏收起时清空横幅');

    toast.destroy(); host.destroy();
    console.log('dragon download toast ok');
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
