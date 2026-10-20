// 桌面推广卡片堆：登录后在屏幕右下角以置顶、无边框的小窗打开推广链接，像蜘蛛纸牌一样错落叠放。
// - 后面的卡片只露出顶部标题条，点击标题条把它换到最前；点击最前卡片的页面区域放大为普通窗口。
// - 放大后是正常浏览窗口（后退/前进/刷新/最小化/最大化/关闭），最小化缩回卡片堆，页面状态不丢。
// - 首页通过本机接口读取每张卡片的实时画面（capturePage），点击首页画面直接弹出对应大窗。
// - 防打扰：托盘可暂停；关闭卡片堆当天不再自动弹出；Windows 检测到全屏/演示时自动隐藏卡片堆。
// 页面运行在独立持久分区（persist:platform-promo），登录态只保存在本机；没有有效期的会话 Cookie 自动续存 7 天。
// 同一套窗口也用来打开浮窗脚本站点（独立的普通窗口，不进卡片堆），工具栏可加载浏览器插件、运行浮窗脚本。
const { BrowserWindow, BrowserView, Menu, dialog, screen, session, shell } = require('electron');
const { createExtensionManager } = require('./browser-extensions');
const { createSiteScriptStore } = require('./site-scripts');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:platform-promo';
const CARD_WIDTH = 360;
const HEADER_HEIGHT = 30;
const PAGE_HEIGHT = 203;
const TOOLBAR_HEIGHT = 40;
const PEEK = HEADER_HEIGHT;
const MARGIN = 16;
const CARD_ZOOM = 0.3;
const FRAME_CACHE_MS = 700;
const MIN_DESKTOP_ROTATE_SECONDS = 60;
const SESSION_COOKIE_KEEP_DAYS = 7;
const SITE_SCRIPT_DELAY_MS = 1500;

function createPromoStack({ statePath, extensionsStatePath, siteScriptsPath, getLanguage = () => 'zh-CN', onChange = () => {}, onCardOpen = () => {}, openAppPath = () => {} }) {
    let config = null;
    let cards = [];             // 卡片堆中的窗口，cards[0] 为最前
    let tools = [];             // 浮窗脚本站点窗口：普通窗口，不进卡片堆
    let extensions = null;
    const siteScripts = createSiteScriptStore(siteScriptsPath || path.join(path.dirname(statePath), 'desktop-site-scripts.json'));
    let queue = [];             // 已启用但超出最大数量、等待轮换的链接
    let expanded = null;        // 当前放大的卡片
    const closedIds = new Set(); // 本次运行中用户在大窗点了“关闭”的链接
    let fullscreenBusy = false;
    let rotateTimer = null;
    let fullscreenWatcher = null;
    let sessionReady = false;
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
    // 卡片堆里放大的卡片和浮窗脚本窗口都是“大窗”：显示工具栏、页面可操作、原始缩放
    const isBig = card => expanded === card || !!card.tool;

    function ensureSession() {
        if (sessionReady) return;
        sessionReady = true;
        const promoSession = session.fromPartition(PARTITION);
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
        const applyZoom = () => { if (!wc.isDestroyed()) wc.setZoomFactor(isBig(card) ? 1 : CARD_ZOOM); };
        wc.on('did-navigate', () => { applyZoom(); pushState(card); });
        wc.on('did-navigate-in-page', () => pushState(card));
        wc.on('did-finish-load', applyZoom);
        // 浮窗脚本窗口：登录跳转回目标站点并加载完成后自动运行脚本（每次整页加载运行一次）
        wc.on('did-finish-load', () => { if (card.tool && card.tool.autoRun) runToolScript(card, { onlyOnOrigin: true }); });
        wc.on('page-title-updated', () => pushState(card));
        // 页面里的新窗口在本窗口内打开（仅 http/https），避免弹出不受控的窗口
        wc.setWindowOpenHandler(({ url }) => {
            if (/^https?:/i.test(url) && isBig(card)) wc.loadURL(url).catch(() => {});
            return { action: 'deny' };
        });
        // 等插件加载完再打开页面，插件的内容脚本才能生效
        extensions.whenReady().then(() => { if (!wc.isDestroyed()) wc.loadURL(link.url).catch(() => {}); });

        win.on('closed', () => {
            cards = cards.filter(item => item !== card);
            tools = tools.filter(item => item !== card);
            if (expanded === card) expanded = null;
            if (card.tool) clearTimeout(card.tool.timer);
            [page, shield].forEach(view => { try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch (_) { /* noop */ } });
        });
        bindWindowEvents(card);
        layoutCard(card);
        return card;
    }

    function destroyCard(card) {
        if (!card || card.win.isDestroyed()) return;
        try { card.page.webContents.close(); } catch (_) { /* noop */ }
        try { card.shield.webContents.close(); } catch (_) { /* noop */ }
        card.win.destroy();
    }

    function layoutCard(card) {
        const [width, height] = card.win.getContentSize();
        const isExpanded = isBig(card);
        const top = isExpanded ? TOOLBAR_HEIGHT : HEADER_HEIGHT;
        card.page.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
        // 小窗状态用透明遮罩接住点击；放大后移除遮罩，页面可正常操作
        if (isExpanded) card.shield.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        else card.shield.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
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
        const visible = stackAllowed() && !expanded;
        const frontY = area.y + area.height - (HEADER_HEIGHT + PAGE_HEIGHT) - MARGIN;
        const x = area.x + area.width - CARD_WIDTH - MARGIN;
        cards.forEach((card, depth) => {
            if (card === expanded) return;
            card.win.setBounds({ x, y: Math.max(area.y, frontY - depth * PEEK), width: CARD_WIDTH, height: HEADER_HEIGHT + PAGE_HEIGHT });
            layoutCard(card);
            pushState(card);
            if (!visible) { if (card.win.isVisible()) card.win.hide(); }
        });
        if (!visible) return;
        // 从最后一张到最前一张依次置顶，保证叠放次序
        [...cards].reverse().forEach(card => {
            if (card === expanded) return;
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
            const existing = cards.find(card => card.link.id === link.id) || (expanded && expanded.link.id === link.id ? expanded : null);
            if (!existing) return createCard(link);
            const urlChanged = existing.link.url !== link.url;
            existing.link = link;
            if (urlChanged) existing.page.webContents.loadURL(link.url).catch(() => {});
            return existing;
        });
        // 不再需要的卡片销毁；正在放大的大窗收起时再销毁（collapse 发现它不在卡片堆里）
        cards.filter(card => !keep.includes(card) && card !== expanded).forEach(destroyCard);
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
        if (expanded || !queue.length || !cards.length || !stackAllowed()) return;
        const back = cards[cards.length - 1];
        const next = queue.shift();
        queue.push(back.link);
        back.link = next;
        back.page.webContents.loadURL(next.url).catch(() => {});
        // 轮换进来的卡片放到最前，便于用户看到
        cards = [back, ...cards.slice(0, -1)];
        layoutStack();
    }

    function bringToFront(card) {
        if (!cards.includes(card) || cards[0] === card) return;
        cards = [card, ...cards.filter(item => item !== card)];
        layoutStack();
    }

    function expand(card) {
        if (!card || card.win.isDestroyed()) return;
        if (expanded && expanded !== card) collapse(expanded, { silent: true });
        expanded = card;
        const area = workArea();
        const width = Math.min(1360, Math.round(area.width * 0.86));
        const height = Math.min(900, Math.round(area.height * 0.88));
        card.win.setAlwaysOnTop(false);
        card.win.setSkipTaskbar(false);
        card.win.setFocusable(true);
        card.win.setResizable(true);
        card.win.setMinimumSize(640, 420);
        card.maximized = false;
        card.win.setBounds({ x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height });
        card.page.webContents.setZoomFactor(1);
        layoutCard(card);
        // 放大时其他卡片隐藏，避免置顶小窗挡住大窗
        cards.forEach(item => { if (item !== card && item.win.isVisible()) item.win.hide(); });
        card.win.show();
        card.win.focus();
        card.page.webContents.focus();
        pushState(card);
        onChange();
    }

    function collapse(card, { silent = false } = {}) {
        if (!card || card.win.isDestroyed()) return;
        if (card.win.isMaximized()) card.win.unmaximize();
        if (card.win.isFullScreen()) card.win.setFullScreen(false);
        expanded = null;
        card.maximized = false;
        card.win.setMinimumSize(0, 0);
        card.win.setResizable(false);
        card.win.setSkipTaskbar(true);
        card.win.setFocusable(false);
        card.win.setAlwaysOnTop(true, 'floating');
        card.page.webContents.setZoomFactor(CARD_ZOOM);
        if (!stackAllowed()) card.win.hide();
        // 同源页面的缩放会联动，收起后统一恢复小窗缩放
        cards.forEach(item => { if (!item.page.webContents.isDestroyed()) item.page.webContents.setZoomFactor(CARD_ZOOM); });
        if (!cards.includes(card)) destroyCard(card);
        layoutStack();
        if (!silent) onChange();
    }

    function hideStackToday() {
        state.hiddenDate = today();
        writeState();
        rebuild();
        onChange();
    }

    function handleAction(sender, action) {
        const card = cards.concat(tools, expanded && !cards.includes(expanded) ? [expanded] : [])
            .find(item => item.win.webContents === sender || item.shield.webContents === sender);
        if (!card) return;
        if (card.tool && ['minimize', 'close'].includes(action)) {
            if (action === 'minimize') card.win.minimize(); else destroyCard(card);
            return;
        }
        const wc = card.page.webContents;
        switch (action) {
        case 'activate': // 点击卡片页面区域或最前卡片标题
            if (cards[0] !== card) { bringToFront(card); break; }
            if (expanded !== card) onCardOpen(card.link);
            expand(card);
            break;
        case 'front': bringToFront(card); break;
        case 'expand':
            if (expanded !== card) onCardOpen(card.link);
            expand(card);
            break;
        case 'hide-stack': hideStackToday(); break;
        case 'minimize': collapse(card); break;
        case 'close': // 本次运行不再显示这个链接，空位由等待轮换的链接补上
            closedIds.add(card.link.id);
            cards = cards.filter(item => item !== card);
            collapse(card);
            rebuild();
            break;
        case 'maximize':
            if (card.win.isMaximized()) card.win.unmaximize(); else card.win.maximize();
            break;
        case 'back': if (wc.canGoBack()) wc.goBack(); break;
        case 'forward': if (wc.canGoForward()) wc.goForward(); break;
        case 'reload': wc.reload(); break;
        case 'home': wc.loadURL(card.link.url).catch(() => {}); break;
        case 'external': shell.openExternal(wc.getURL() || card.link.url).catch(() => {}); break;
        case 'plugins': showPluginMenu(card); break;
        case 'scripts': showScriptMenu(card); break;
        default: break;
        }
    }

    function bindWindowEvents(card) {
        card.win.on('resize', () => layoutCard(card));
        card.win.on('maximize', () => { card.maximized = true; layoutCard(card); pushState(card); });
        card.win.on('unmaximize', () => { card.maximized = false; layoutCard(card); pushState(card); });
    }

    // ── 浮窗脚本站点窗口 ──
    function openTool(site) {
        const existing = tools.find(item => item.tool.origin === site.origin);
        if (existing) {
            existing.tool.code = site.code;
            if (existing.win.isMinimized()) existing.win.restore();
            existing.win.show(); existing.win.focus();
            return existing;
        }
        const link = { id: 'site:' + site.origin, name: site.name, badge: T('浮窗', 'Float'), color: 'blue', url: site.url };
        const card = createCardFor(link, { tool: { origin: site.origin, code: site.code, autoRun: true } });
        tools.push(card);
        const area = workArea();
        const width = Math.min(1360, Math.round(area.width * 0.86));
        const height = Math.min(900, Math.round(area.height * 0.88));
        card.win.setAlwaysOnTop(false);
        card.win.setSkipTaskbar(false);
        card.win.setFocusable(true);
        card.win.setResizable(true);
        card.win.setMinimizable(true);
        card.win.setMaximizable(true);
        card.win.setMinimumSize(640, 420);
        const offset = (tools.length - 1) % 6 * 28;
        card.win.setBounds({ x: area.x + Math.round((area.width - width) / 2) + offset, y: area.y + Math.round((area.height - height) / 2) + offset, width, height });
        layoutCard(card);
        card.win.show();
        card.win.focus();
        return card;
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
        Menu.buildFromTemplate(template).popup({ window: card.win });
    }

    function notify(card, message, type = 'info') {
        dialog.showMessageBox(card.win, { type, message, buttons: [T('好的', 'OK')] }).catch(() => {});
    }

    function showScriptMenu(card) {
        const sites = siteScripts.list();
        const wc = card.page.webContents;
        let pageOrigin = '';
        try { pageOrigin = new URL(wc.getURL()).origin; } catch (_) { /* noop */ }
        const here = sites.find(site => site.origin === pageOrigin);
        const template = [{ label: T('🪟 浮窗脚本', '🪟 Floating scripts'), enabled: false }];
        if (card.tool) template.push({ label: T('▶ 在本窗口重新运行浮窗脚本', '▶ Run the floating script again here'), click: () => runToolScript(card) });
        else if (here) template.push({ label: T(`▶ 在当前页面运行「${here.name}」`, `▶ Run “${here.name}” on this page`), click: () => runSiteScriptHere(card, siteScripts.get(here.origin)) });
        if (template.length > 1) template.push({ type: 'separator' });
        if (sites.length) {
            sites.forEach(site => template.push({ label: T(`打开 ${site.name}（登录后自动运行）`, `Open ${site.name} (runs after sign-in)`), click: () => openTool(siteScripts.get(site.origin)) }));
        } else {
            template.push({ label: T('还没有浮窗脚本：在「数据抓取 → 📋 浮窗脚本」里点「🖥 桌面浏览器运行」', 'No scripts yet: use “🖥 Run in desktop browser” in Data Capture → Floating scripts'), enabled: false });
        }
        template.push({ type: 'separator' }, { label: T('打开浮窗脚本列表…', 'Open the floating script list…'), click: () => openAppPath('/uivf12?siteScripts=1') });
        popupMenu(card, template);
    }

    function openExtensionPage(card, ext, page) {
        const promoSession = session.fromPartition(PARTITION);
        const bounds = card.win.getBounds();
        const popup = new BrowserWindow({
            parent: card.win, width: 420, height: 620, x: bounds.x + bounds.width - 440, y: bounds.y + TOOLBAR_HEIGHT + 8,
            title: ext.name, autoHideMenuBar: true, backgroundColor: '#ffffff',
            webPreferences: { session: promoSession, contextIsolation: true, sandbox: true, nodeIntegration: false }
        });
        popup.loadURL(`chrome-extension://${ext.id}/${page}`).catch(error => notify(card, T(`无法打开插件页面：${error.message}`, `Cannot open the extension page: ${error.message}`), 'warning'));
    }

    async function pick(card, kind) {
        const result = await dialog.showOpenDialog(card.win, kind === 'zip'
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
            if (ext.popup) submenu.push({ label: T('打开插件面板', 'Open extension panel'), click: () => openExtensionPage(card, ext, ext.popup) });
            if (ext.options) submenu.push({ label: T('插件设置', 'Extension options'), click: () => openExtensionPage(card, ext, ext.options.replace(/^\.?\//, '')) });
            template.push(submenu.length ? { label: title, submenu } : { label: T(`${title} · 自动运行`, `${title} · runs automatically`), enabled: false });
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
                    expanded: expanded === card,
                    live: !card.win.isDestroyed() && card.win.isVisible(),
                    title: card.page.webContents.isDestroyed() ? '' : card.page.webContents.getTitle()
                }))
            };
        },
        async frame(id) {
            const card = cards.find(item => item.link.id === id);
            if (!card || card.win.isDestroyed() || !card.win.isVisible()) return null;
            if (card.frame && Date.now() - card.frameAt < FRAME_CACHE_MS) return card.frame;
            const image = await card.page.webContents.capturePage();
            if (image.isEmpty()) return null;
            const size = image.getSize();
            card.frame = (size.width > 640 ? image.resize({ width: 640, quality: 'good' }) : image).toJPEG(72);
            card.frameAt = Date.now();
            return card.frame;
        },
        // 首页点击推广画面：弹出对应大窗（卡片堆里没有时临时创建）
        open(link, nextConfig) {
            if (nextConfig) config = nextConfig;
            closedIds.delete(link.id);
            let card = cards.find(item => item.link.id === link.id);
            if (!card) {
                card = createCard(link);
                // 卡片堆未满时加入卡片堆；已满（或卡片堆被关闭）则是临时卡片，收起后销毁
                const limit = Math.max(1, Number(config && config.maxLinks) || 3);
                if (stackAllowed() && cards.length < limit) cards = [card, ...cards];
            }
            expand(card);
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
        // 数据抓取页「🖥 桌面浏览器运行」：缓存脚本；run 为 true 时打开站点窗口，登录完成后自动运行
        putSiteScript(site, { run = true } = {}) {
            const saved = siteScripts.put(site);
            const open = tools.find(item => item.tool.origin === saved.origin);
            if (open) open.tool.code = saved.code;
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
            tools.forEach(destroyCard);
            tools = [];
            try { session.fromPartition(PARTITION).cookies.flushStore().catch(() => {}); } catch (_) { /* noop */ }
            clearInterval(rotateTimer);
            if (fullscreenWatcher) { fullscreenWatcher.kill(); fullscreenWatcher = null; }
            cards.forEach(destroyCard);
            cards = [];
            expanded = null;
        },
        languageChanged() { cards.forEach(pushState); }
    };

    return api;
}

module.exports = { createPromoStack, PARTITION };
