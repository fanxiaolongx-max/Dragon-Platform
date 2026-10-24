// 桌面推广卡片堆：登录后在屏幕右下角以置顶、无边框的小窗打开推广链接，像蜘蛛纸牌一样错落叠放。
// - 后面的卡片只露出顶部标题条，点击标题条把它换到最前；点击最前卡片的页面区域放大为普通窗口。
// - 所有大窗入口统一在 Dragon 浏览器新增标签；预览页面可移入标签，最小化时移回卡片堆。
// - 首页通过本机接口读取每张卡片的实时画面（capturePage），点击首页画面直接弹出对应大窗。
// - 防打扰：托盘可暂停；关闭卡片堆当天不再自动弹出；Windows 检测到全屏/演示时自动隐藏卡片堆。
// 页面运行在独立持久分区（persist:platform-promo），登录态只保存在本机；没有有效期的会话 Cookie 自动续存 7 天。
// 浮窗脚本、推广链接和网站的新窗口链接共用同一个 Dragon 浏览器窗口。
const { app, BrowserWindow, BrowserView, Menu, dialog, screen, session, shell } = require('electron');
const { createExtensionManager } = require('./browser-extensions');
const { createSiteScriptStore } = require('./site-scripts');
const { createPagePreview } = require('./page-preview');
const { createDragonBrowser } = require('./dragon-browser');
const { configureDownloads } = require('./downloads');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:platform-promo';
const CARD_WIDTH = 360;
const HEADER_HEIGHT = 30;
const PAGE_HEIGHT = 203;
const PEEK = HEADER_HEIGHT;
const MARGIN = 16;
const FRAME_CACHE_MS = 700;
const MIN_DESKTOP_ROTATE_SECONDS = 60;
const SESSION_COOKIE_KEEP_DAYS = 7;
const SITE_SCRIPT_DELAY_MS = 1500;

function createPromoStack({ statePath, extensionsStatePath, siteScriptsPath, getLanguage = () => 'zh-CN', onChange = () => {}, onCardOpen = () => {}, openAppPath = () => {} }) {
    let config = null;
    let cards = [];             // 卡片堆中的窗口，cards[0] 为最前
    let extensions = null;
    const siteScripts = createSiteScriptStore(siteScriptsPath || path.join(path.dirname(statePath), 'desktop-site-scripts.json'));
    let queue = [];             // 已启用但超出最大数量、等待轮换的链接
    const closedIds = new Set(); // 本次运行中用户在大窗点了“关闭”的链接
    let fullscreenBusy = false;
    let rotateTimer = null;
    let fullscreenWatcher = null;
    let sessionReady = false;
    let unregisterDownloads = null;
    let state = readState();

    function readState() {
        try {
            const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            return { paused: value.paused === true, hiddenDate: typeof value.hiddenDate === 'string' ? value.hiddenDate : '' };
        } catch (_) {
            return { paused: false, hiddenDate: '' };
        }
    }
    function writeState() {
        try {
            fs.mkdirSync(path.dirname(statePath), { recursive: true });
            fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        } catch (error) {
            console.warn('[DesktopPromo] 保存状态失败：', error.message || error);
        }
    }
    const today = () => new Date().toLocaleDateString('sv');
    const hiddenToday = () => state.hiddenDate === today();
    const english = () => getLanguage() === 'en-US';
    const label = (link, key) => (english() && link[`${key}En`]) || link[key] || '';
    const stackAllowed = () => !!config && config.desktopStack && !state.paused && !hiddenToday() && !fullscreenBusy;
    const T = (zh, en) => (english() ? en : zh);
    const isBig = card => !!card.inBrowser;
    const browser = createDragonBrowser({
        partition: PARTITION, whenReady: () => extensions.whenReady(), getLanguage, getWorkArea: workArea,
        onPageCreated: tab => {
            tab.page.webContents.on('did-finish-load', () => { if (tab.tool?.autoRun) runToolScript(tab, { onlyOnOrigin: true }); });
        },
        onAction: (card, action) => {
            if (action === 'plugins') showPluginMenu(card);
            if (action === 'scripts') showScriptMenu(card);
        },
        onVisibilityChange: () => { layoutStack(); onChange(); }
    });
    const hostWindow = card => browser.findContext(card) ? browser.getWindow() : card.win;

    function ensureSession() {
        if (sessionReady) return;
        sessionReady = true;
        const promoSession = session.fromPartition(PARTITION);
        unregisterDownloads = configureDownloads(promoSession, () => app.getPath('downloads'));
        // 推广页面不需要摄像头、麦克风、通知等权限
        promoSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        promoSession.setPermissionCheckHandler(() => false);
        // 没有有效期的会话 Cookie 在程序退出后会丢，登录态随之失效：原样补上 7 天有效期（网站每次更新都会重新续期）
        promoSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
            if (removed || !cookie.session) return;
            keepSessionCookie(promoSession, cookie);
        });
        ['display-metrics-changed', 'display-added', 'display-removed'].forEach(name => screen.on(name, () => layoutStack()));
        extensions = createExtensionManager({ session: promoSession, statePath: extensionsStatePath || path.join(path.dirname(statePath), 'desktop-browser-extensions.json') });
        extensions.init().catch(error => console.warn('[DesktopBrowser] 加载插件失败：', error.message || error));
    }

    function keepSessionCookie(promoSession, cookie) {
        const host = String(cookie.domain || '').replace(/^\./, '');
        if (!host) return;
        const details = {
            url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || '/',
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite || 'unspecified',
            expirationDate: Math.floor(Date.now() / 1000) + SESSION_COOKIE_KEEP_DAYS * 86400
        };
        // hostOnly 的 Cookie 不带 domain，保持只对原主机生效（__Host- 前缀也要求如此）
        if (!cookie.hostOnly) details.domain = cookie.domain;
        promoSession.cookies.set(details).catch(error => console.warn('[DesktopPromo] 续存会话 Cookie 失败：', cookie.name, error.message || error));
    }

    function workArea() {
        return screen.getPrimaryDisplay().workArea;
    }

    function createCard(link) { return createCardFor(link, {}); }

    function createCardFor(link, base) {
        ensureSession();
        const win = new BrowserWindow({
            width: CARD_WIDTH, height: HEADER_HEIGHT + PAGE_HEIGHT,
            frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
            alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: true,
            backgroundColor: '#0f172a', title: label(link, 'name'),
            webPreferences: { preload: path.join(__dirname, 'card-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
        });
        win.setAlwaysOnTop(true, 'floating');
        const page = new BrowserView({ webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
        const shield = new BrowserView({ webPreferences: { preload: path.join(__dirname, 'card-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
        shield.setBackgroundColor('#00000000');
        const card = Object.assign(base, { link, win, page, shield, frame: null, frameAt: 0, maximized: false, ready: false });

        win.addBrowserView(page);
        win.addBrowserView(shield);
        win.loadFile(path.join(__dirname, 'card.html')).catch(() => {});
        shield.webContents.loadFile(path.join(__dirname, 'shield.html')).catch(() => {});
        win.webContents.on('did-finish-load', () => { card.ready = true; pushState(card); });

        const wc = page.webContents;
        card.preview = createPagePreview(wc, {
            isExpanded: () => isBig(card), getBounds: () => page.getBounds(), getDesktopSize: workArea
        });
        wc.on('did-navigate', () => pushState(card));
        wc.on('did-navigate-in-page', () => pushState(card));
        wc.on('page-title-updated', () => pushState(card));
        // 缩小预览不接受网页弹窗；移入 Dragon 标签后由标签管理器接管。
        wc.setWindowOpenHandler(({ url }) => {
            if (/^https?:/i.test(url) && isBig(card)) browser.open({ link: { name: url, url } });
            return { action: 'deny' };
        });
        // 等插件加载完再打开页面，插件的内容脚本才能生效
        extensions.whenReady().then(() => { if (!wc.isDestroyed()) wc.loadURL(link.url).catch(() => {}); });

        win.on('closed', () => {
            cards = cards.filter(item => item !== card);
            // 页面借给 Dragon 标签期间由浏览器管理其生命周期。
            if (browser.findContext(card)) return;
            [page, shield].forEach(view => { try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch (_) { /* noop */ } });
        });
        bindWindowEvents(card);
        layoutCard(card);
        return card;
    }

    function destroyCard(card) {
        if (!card || card.win.isDestroyed()) return;
        // BrowserView 统一由 closed 回调释放，避免异步 close 尚未完成时重复关闭。
        card.win.destroy();
    }

    function layoutCard(card) {
        if (card.inBrowser) { card.preview.update(); return; }
        const [width, height] = card.win.getContentSize();
        const top = HEADER_HEIGHT;
        card.page.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
        card.preview.update();
        // 小窗状态用透明遮罩接住点击；放大后移除遮罩，页面可正常操作
        card.shield.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
    }

    function pushState(card) {
        if (!card.ready || card.win.isDestroyed()) return;
        const wc = card.page.webContents;
        const isExpanded = isBig(card);
        card.win.webContents.send('promo-card:state', {
            mode: isExpanded ? 'expanded' : 'card',
            tool: !!card.tool,
            front: cards[0] === card,
            count: cards.length,
            lang: english() ? 'en-US' : 'zh-CN',
            name: label(card.link, 'name'),
            badge: label(card.link, 'badge') || label(card.link, 'name'),
            color: card.link.color || 'teal',
            url: wc.isDestroyed() ? card.link.url : (wc.getURL() || card.link.url),
            title: wc.isDestroyed() ? '' : wc.getTitle(),
            canBack: !wc.isDestroyed() && wc.canGoBack(),
            canForward: !wc.isDestroyed() && wc.canGoForward(),
            maximized: card.maximized
        });
    }

    function layoutStack() {
        const area = workArea();
        const visible = stackAllowed() && !browser.isVisible();
        const frontY = area.y + area.height - (HEADER_HEIGHT + PAGE_HEIGHT) - MARGIN;
        const x = area.x + area.width - CARD_WIDTH - MARGIN;
        cards.forEach((card, depth) => {
            card.win.setBounds({ x, y: Math.max(area.y, frontY - depth * PEEK), width: CARD_WIDTH, height: HEADER_HEIGHT + PAGE_HEIGHT });
            layoutCard(card);
            pushState(card);
            if (!visible) { if (card.win.isVisible()) card.win.hide(); }
        });
        if (!visible) return;
        // 从最后一张到最前一张依次置顶，保证叠放次序
        [...cards].reverse().forEach(card => {
            if (!card.win.isVisible()) card.win.showInactive();
            card.win.moveTop();
        });
    }

    function enabledLinks() {
        return config ? config.links.filter(link => link.enabled && !closedIds.has(link.id)) : [];
    }

    function rebuild() {
        // 暂停、当天关闭或关闭桌面推广时释放全部卡片（正在放大的大窗除外）；全屏只是临时隐藏
        const alive = !!config && config.desktopStack && !state.paused && !hiddenToday();
        const links = alive ? enabledLinks() : [];
        const limit = Math.max(1, Number(config && config.maxLinks) || 3);
        const wanted = links.slice(0, limit);
        queue = links.slice(limit);
        const keep = wanted.map(link => {
            const existing = cards.find(card => card.link.id === link.id);
            if (!existing) return createCard(link);
            const urlChanged = existing.link.url !== link.url;
            existing.link = link;
            if (urlChanged) existing.page.webContents.loadURL(link.url).catch(() => {});
            return existing;
        });
        // 浏览器借用中的页面保留到标签关闭，其余不再需要的预览立即释放。
        cards.filter(card => !keep.includes(card) && !browser.findContext(card)).forEach(destroyCard);
        cards.filter(card => !keep.includes(card) && browser.findContext(card)).forEach(card => card.win.hide());
        cards = keep;
        layoutStack();
        scheduleRotation();
        updateFullscreenWatch();
    }

    function scheduleRotation() {
        clearInterval(rotateTimer);
        rotateTimer = null;
        if (!queue.length || !config) return;
        const seconds = Math.max(MIN_DESKTOP_ROTATE_SECONDS, Number(config.rotateSeconds) || 30);
        rotateTimer = setInterval(rotate, seconds * 1000);
    }

    // 超过最大展示数量时轮换：最后一张卡片换成等待队列里的下一个链接
    function rotate() {
        if (browser.isVisible() || !queue.length || !cards.length || !stackAllowed()) return;
        const back = [...cards].reverse().find(card => !browser.findContext(card));
        if (!back) return;
        const next = queue.shift();
        queue.push(back.link);
        back.link = next;
        back.page.webContents.loadURL(next.url).catch(() => {});
        // 轮换进来的卡片放到最前，便于用户看到
        cards = [back, ...cards.filter(card => card !== back)];
        layoutStack();
    }

    function bringToFront(card) {
        if (!cards.includes(card) || cards[0] === card) return;
        cards = [card, ...cards.filter(item => item !== card)];
        layoutStack();
    }

    function expand(card) {
        if (!card || card.win.isDestroyed()) return;
        const existing = browser.findContext(card);
        if (existing) { browser.showTab(existing.id); return; }
        browser.open({
            link: card.link, page: card.page, context: card,
            onModeChange(shown) {
                card.inBrowser = shown;
                if (card.win.isDestroyed()) return;
                if (shown) card.win.removeBrowserView(card.page);
                else {
                    card.win.addBrowserView(card.page);
                    card.win.setTopBrowserView(card.shield);
                    layoutCard(card);
                }
            },
            onLayout: () => card.preview.update(),
            release() {
                card.page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
                if (!cards.includes(card)) destroyCard(card);
                layoutStack();
            }
        });
    }

    function hideStackToday() {
        state.hiddenDate = today();
        writeState();
        rebuild();
        onChange();
    }

    function handleAction(sender, action, payload) {
        if (browser.handleAction(sender, action, payload)) return;
        const card = cards.find(item => item.win.webContents === sender || item.shield.webContents === sender);
        if (!card) return;
        switch (action) {
        case 'activate':
            if (cards[0] !== card) { bringToFront(card); break; }
            onCardOpen(card.link);
            expand(card);
            break;
        case 'front': bringToFront(card); break;
        case 'expand': onCardOpen(card.link); expand(card); break;
        case 'hide-stack': hideStackToday(); break;
        default: break;
        }
    }

    function bindWindowEvents(card) {
        card.win.on('resize', () => layoutCard(card));
        card.win.on('maximize', () => { card.maximized = true; layoutCard(card); pushState(card); });
        card.win.on('unmaximize', () => { card.maximized = false; layoutCard(card); pushState(card); });
    }

    // 每次显式打开都在同一个 Dragon 浏览器新增标签。
    function openTool(site) {
        ensureSession();
        const link = { id: 'site:' + site.origin, name: site.name, badge: T('浮窗', 'Float'), color: 'blue', url: site.url };
        return browser.open({ link, tool: { origin: site.origin, code: site.code, autoRun: true } });
    }

    function runToolScript(card, { onlyOnOrigin = false } = {}) {
        const wc = card.page.webContents;
        const code = card.tool && card.tool.code;
        if (!code || wc.isDestroyed()) return;
        let origin = '';
        try { origin = new URL(wc.getURL()).origin; } catch (_) { return; }
        // 还停在单点登录等其他站点：等登录完成跳回目标站点再运行
        if (onlyOnOrigin && origin !== card.tool.origin) return;
        clearTimeout(card.tool.timer);
        card.tool.timer = setTimeout(() => {
            if (wc.isDestroyed()) return;
            try { if (new URL(wc.getURL()).origin !== card.tool.origin) return; } catch (_) { return; }
            wc.executeJavaScript(code, true).catch(error => console.warn('[DesktopBrowser] 浮窗脚本运行失败：', error.message || error));
        }, SITE_SCRIPT_DELAY_MS);
    }

    function runSiteScriptHere(card, site) {
        card.page.webContents.executeJavaScript(site.code, true).catch(error => console.warn('[DesktopBrowser] 浮窗脚本运行失败：', error.message || error));
    }

    function popupMenu(card, template) {
        Menu.buildFromTemplate(template).popup({ window: hostWindow(card) });
    }

    function notify(card, message, type = 'info') {
        dialog.showMessageBox(hostWindow(card), { type, message, buttons: [T('好的', 'OK')] }).catch(() => {});
    }

    function showScriptMenu(card) {
        const sites = siteScripts.list();
        const wc = card.page.webContents;
        let pageOrigin = '';
        try { pageOrigin = new URL(wc.getURL()).origin; } catch (_) { /* noop */ }
        const here = sites.find(site => site.origin === pageOrigin);
        const template = [{ label: T('🪟 浮窗脚本', '🪟 Floating scripts'), enabled: false }];
        if (card.tool) template.push({ label: T('▶ 在当前标签重新运行浮窗脚本', '▶ Run the floating script again in this tab'), click: () => runToolScript(card) });
        else if (here) template.push({ label: T(`▶ 在当前页面运行「${here.name}」`, `▶ Run “${here.name}” on this page`), click: () => runSiteScriptHere(card, siteScripts.get(here.origin)) });
        if (template.length > 1) template.push({ type: 'separator' });
        if (sites.length) {
            sites.forEach(site => template.push({ label: T(`打开 ${site.name}（登录后自动运行）`, `Open ${site.name} (runs after sign-in)`), click: () => openTool(siteScripts.get(site.origin)) }));
        } else {
            template.push({ label: T('还没有浮窗脚本：在「数据抓取 → 📋 浮窗脚本」里点「🖥 Dragon 浏览器」', 'No scripts yet: use “🖥 Dragon Browser” in Data Capture → Floating scripts'), enabled: false });
        }
        template.push({ type: 'separator' }, { label: T('打开浮窗脚本列表…', 'Open the floating script list…'), click: () => openAppPath('/uivf12?siteScripts=1') });
        popupMenu(card, template);
    }

    function openExtensionPage(card, ext, page) {
        browser.open({ link: { name: ext.name, url: `chrome-extension://${ext.id}/${page}` } });
    }

    async function pick(card, kind) {
        const result = await dialog.showOpenDialog(hostWindow(card), kind === 'zip'
            ? { title: T('选择插件压缩包', 'Choose an extension .zip'), properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] }
            : { title: T('选择插件文件夹（包含 manifest.json）', 'Choose the extension folder (with manifest.json)'), properties: ['openDirectory'] });
        if (result.canceled || !result.filePaths[0]) return;
        try {
            const info = kind === 'zip' ? await extensions.importZip(result.filePaths[0]) : await extensions.importFolder(result.filePaths[0]);
            if (info && info.error) notify(card, T(`插件已导入，但加载失败：${info.error}`, `Imported, but loading failed: ${info.error}`), 'warning');
            else notify(card, T(`已加载插件「${info.name}」，刷新页面后生效。`, `Loaded “${info.name}”. Reload the page to apply it.`));
        } catch (error) {
            notify(card, T(`导入失败：${error.message}`, `Import failed: ${error.message}`), 'warning');
        }
    }

    function showPluginMenu(card) {
        const wc = card.page.webContents;
        const loaded = extensions ? extensions.list() : [];
        const template = [{ label: T('🧩 本浏览器已加载的插件', '🧩 Extensions in this browser'), enabled: false }];
        if (!loaded.length) template.push({ label: T('（还没有加载插件）', '(No extensions loaded)'), enabled: false });
        loaded.forEach(ext => {
            if (ext.error) { template.push({ label: T(`⚠️ ${ext.name}：${ext.error}`, `⚠️ ${ext.name}: ${ext.error}`), enabled: false }); return; }
            const title = `${ext.name}${ext.version ? ' ' + ext.version : ''}`;
            const submenu = [];
            if ((ext.warnings || []).includes('nativeMessaging')) {
                submenu.push({ label: T('⚠ 本机通信不受支持，可能影响免密登录', '⚠ Native messaging unsupported; passwordless login may fail'), enabled: false });
                submenu.push({ label: T('在系统浏览器打开当前页面', 'Open current page in system browser'), click: () => shell.openExternal(wc.getURL() || card.link.url).catch(() => {}) });
            }
            if (ext.popup) submenu.push({ label: T('打开插件面板', 'Open extension panel'), click: () => openExtensionPage(card, ext, ext.popup) });
            if (ext.options) submenu.push({ label: T('插件设置', 'Extension options'), click: () => openExtensionPage(card, ext, ext.options.replace(/^\.?\//, '')) });
            template.push(submenu.length ? { label: title, submenu } : { label: T(`${title} · 已加载，无独立面板`, `${title} · loaded, no panel`), enabled: false });
        });
        const installed = extensions ? extensions.scanInstalledBrowserExtensions() : [];
        const importedKeys = new Set(extensions ? extensions.imported().map(item => item.key) : []);
        const removable = extensions ? extensions.imported().filter(item => item.source !== 'browser') : [];
        template.push(
            { type: 'separator' },
            { label: T('从 .zip 加载打包好的插件…', 'Load a packed extension (.zip)…'), click: () => pick(card, 'zip') },
            { label: T('从文件夹加载插件…', 'Load an extension folder…'), click: () => pick(card, 'folder') },
            {
                label: T('本机 Chrome / Edge 插件', 'Chrome / Edge extensions on this computer'),
                submenu: installed.length
                    ? installed.map(item => ({
                        label: `${item.name}（${item.browser} ${item.version}）`, type: 'checkbox', checked: importedKeys.has(item.key),
                        click: menuItem => extensions.toggleBrowserExtension(item, menuItem.checked).then(() => notify(card, T('已更新插件，刷新页面后生效。', 'Extensions updated. Reload the page to apply.')))
                    }))
                    : [{ label: T('没有找到本机 Chrome / Edge 插件', 'No Chrome / Edge extensions found'), enabled: false }]
            },
            {
                label: T('项目自带插件', 'Built-in extensions'),
                submenu: extensions.bundled().map(item => ({
                    label: item.info ? item.info.name : item.key, type: 'checkbox', checked: item.enabled,
                    click: menuItem => extensions.setBundledEnabled(item.key, menuItem.checked)
                }))
            },
            {
                label: T('移除导入的插件', 'Remove an imported extension'),
                enabled: removable.length > 0,
                submenu: removable.length ? removable.map(item => ({ label: item.name || item.key, click: () => extensions.removeImported(item.key) })) : [{ label: '—', enabled: false }]
            },
            { type: 'separator' },
            { label: T('重新加载全部插件', 'Reload all extensions'), click: () => extensions.reloadAll().then(() => notify(card, T('插件已重新加载，刷新页面后生效。', 'Extensions reloaded. Reload the page to apply.'))) },
            { label: T('刷新当前页面', 'Reload this page'), click: () => wc.reload() }
        );
        popupMenu(card, template);
    }

    // ── Windows：检测全屏应用 / 演示模式，期间隐藏卡片堆 ──
    function updateFullscreenWatch() {
        const need = process.platform === 'win32' && cards.length > 0;
        if (need && !fullscreenWatcher) startFullscreenWatch();
        if (!need && fullscreenWatcher) { fullscreenWatcher.kill(); fullscreenWatcher = null; }
    }
    function startFullscreenWatch() {
        // SHQueryUserNotificationState：2=全屏应用(busy) 3=D3D 全屏 4=演示模式
        const script = [
            'Add-Type -Namespace TP -Name Shell -MemberDefinition \'[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);\'',
            '$s = 0',
            'while ($true) { [void][TP.Shell]::SHQueryUserNotificationState([ref]$s); [Console]::Out.WriteLine($s); [Console]::Out.Flush(); Start-Sleep -Seconds 3 }'
        ].join('; ');
        try {
            const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
            fullscreenWatcher = child;
            let buffer = '';
            child.stdout.on('data', chunk => {
                buffer += chunk.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop();
                const last = lines.filter(Boolean).pop();
                if (last === undefined) return;
                const busy = ['2', '3', '4'].includes(last.trim());
                if (busy !== fullscreenBusy) { fullscreenBusy = busy; layoutStack(); }
            });
            child.on('exit', () => { if (fullscreenWatcher === child) fullscreenWatcher = null; });
            child.on('error', () => { if (fullscreenWatcher === child) fullscreenWatcher = null; });
        } catch (error) {
            console.warn('[DesktopPromo] 全屏检测不可用：', error.message || error);
        }
    }

    const api = {
        // 首页登录后 / 全局设置保存后调用
        sync(nextConfig) {
            config = nextConfig;
            rebuild();
        },
        status() {
            return {
                paused: state.paused,
                hiddenToday: hiddenToday(),
                enabled: !!(config && config.desktopStack),
                items: cards.map((card, depth) => ({
                    id: card.link.id,
                    depth,
                    expanded: !!browser.findContext(card),
                    live: !card.win.isDestroyed() && (card.win.isVisible() || (card.inBrowser && browser.isVisible())),
                    title: card.page.webContents.isDestroyed() ? '' : card.page.webContents.getTitle()
                }))
            };
        },
        async frame(id) {
            const card = cards.find(item => item.link.id === id);
            if (!card || card.win.isDestroyed() || (!card.win.isVisible() && !(card.inBrowser && browser.isVisible()))) return null;
            // Electron 28 移交 BrowserView 后可能不再完成截图；浏览器中的页面用首页封面回退，
            // 不发起无法取消的截图请求。页面回到右下角后继续实时预览。
            if (card.inBrowser) return null;
            if (card.frame && Date.now() - card.frameAt < FRAME_CACHE_MS) return card.frame;
            // BrowserView 移交期间截图可能一直等待合成帧；只允许一个在途请求，超时返回封面回退。
            if (!card.framePending) {
                const pending = card.page.webContents.capturePage(undefined, { stayHidden: true }).catch(() => null);
                card.framePending = pending;
                pending.then(() => { if (card.framePending === pending) card.framePending = null; });
            }
            let timer;
            const image = await Promise.race([
                card.framePending,
                new Promise(resolve => { timer = setTimeout(() => resolve(null), 2000); })
            ]).finally(() => clearTimeout(timer));
            if (!image || image.isEmpty()) return null;
            const size = image.getSize();
            card.frame = (size.width > 640 ? image.resize({ width: 640, quality: 'good' }) : image).toJPEG(72);
            card.frameAt = Date.now();
            return card.frame;
        },
        // 首页推广每次显式点击都在 Dragon 浏览器打开新标签。
        open(link, nextConfig) {
            ensureSession();
            if (nextConfig) config = nextConfig;
            browser.open({ link });
            return true;
        },
        isPaused: () => state.paused,
        isHiddenToday: hiddenToday,
        hasCards: () => cards.length > 0,
        setPaused(paused) {
            state.paused = !!paused;
            if (!paused) state.hiddenDate = '';
            writeState();
            rebuild();
            onChange();
        },
        showNow() {
            state.hiddenDate = '';
            if (state.paused) state.paused = false;
            writeState();
            rebuild();
            onChange();
        },
        handleAction,
        init() { ensureSession(); return extensions.whenReady(); },
        // 数据抓取页「🖥 Dragon 浏览器」：缓存脚本；run 为 true 时打开站点窗口，登录完成后自动运行
        putSiteScript(site, { run = true } = {}) {
            const saved = siteScripts.put(site);
            browser.list().filter(item => item.tool?.origin === saved.origin).forEach(item => { item.tool.code = saved.code; });
            if (run) openTool(saved);
            onChange();
            return { origin: saved.origin, name: saved.name, updatedAt: saved.updatedAt };
        },
        listSiteScripts: () => siteScripts.list(),
        listExtensions: () => (extensions ? extensions.list() : []),
        runSiteScript(origin) {
            const site = siteScripts.get(origin);
            if (!site) return false;
            openTool(site);
            return true;
        },
        destroy() {
            browser.destroy();
            unregisterDownloads?.();
            unregisterDownloads = null;
            try { session.fromPartition(PARTITION).cookies.flushStore().catch(() => {}); } catch (_) { /* noop */ }
            clearInterval(rotateTimer);
            if (fullscreenWatcher) { fullscreenWatcher.kill(); fullscreenWatcher = null; }
            cards.forEach(destroyCard);
            cards = [];
        },
        languageChanged() { cards.forEach(pushState); browser.pushState(); }
    };

    return api;
}

module.exports = { createPromoStack, PARTITION };
