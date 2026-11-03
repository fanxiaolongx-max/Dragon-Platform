const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relPath => fs.readFileSync(path.join(root, relPath), 'utf8');

test('Dragon Claw floating avatar drawer matches modern light homepage theme', () => {
    const assistantJs = read('frontend/js/shared/ai-assistant.js');

    // .ai-fab 悬浮抽屉按钮样式为与主页氛围一致的浅色玻璃态
    assert.match(assistantJs, /\.ai-fab\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255/);
    assert.match(assistantJs, /\.ai-fab\s*\{[^}]*color:\s*#1f2328/);

    // 头像背景清晰：设置了 #ffffff 背景并提高对比度
    assert.match(assistantJs, /\.ai-fab-avatar\s*\{[^}]*background:\s*#ffffff/);
    assert.match(assistantJs, /\.ai-fab-avatar\s*\{[^}]*image-rendering:\s*-webkit-optimize-contrast/);

    // 在线绿点与外圈渐变对齐主题色
    assert.match(assistantJs, /\.ai-fab-dot\s*\{[^}]*background:\s*#10a37f/);
    assert.match(assistantJs, /conic-gradient\(from 210deg,\s*#10a37f/);

    // 支持深色主题切换
    assert.match(assistantJs, /html\[data-theme="dark"\]\s*\.ai-fab/);
    assert.match(assistantJs, /html\[data-theme="dark"\]\s*\.ai-header/);

    // .ai-header 与用户气泡采用主题色
    assert.match(assistantJs, /\.ai-msg\.user\s*\{[^}]*background:\s*linear-gradient\(135deg,\s*#10a37f/);
});

test('home-v2.css allows .ai-fab to be visible globally across the homepage', () => {
    const homeV2Css = read('frontend/css/home-v2.css');
    // .ai-fab 不在 display: none !important 的列表中
    assert.doesNotMatch(homeV2Css, /:is\(.*\.ai-fab.*\) \{\s*display:\s*none !important/);
});

test('electron-main.js implements silent download to directory without blocking save dialog', () => {
    const electronMain = read('electron-main.js');

    // 不再使用阻塞式 showSaveDialogSync
    assert.doesNotMatch(electronMain, /dialog\.showSaveDialogSync/);
    // 不再使用丑陋的原生 dialog.showMessageBox 提示保存
    assert.doesNotMatch(electronMain, /detail:\s*savePath,\s*buttons:\s*\['打开所在文件夹',\s*'确定'\]/);

    // 默认直接指定保存路径，支持获取唯一路径防重名
    assert.match(electronMain, /function getDownloadDirectory\(\)/);
    assert.match(electronMain, /function getUniqueSavePath\(dir,\s*filename\)/);
    assert.match(electronMain, /item\.setSavePath\(savePath\)/);

    // 广播下载事件与注册 IPC
    assert.match(electronMain, /win\.webContents\.send\('desktop-download:event'/);
    assert.match(electronMain, /ipcMain\.handle\('desktop-download:change-directory'/);
    assert.match(electronMain, /ipcMain\.handle\('desktop-download:open-file'/);
    assert.match(electronMain, /ipcMain\.handle\('desktop-download:show-item-in-folder'/);
});

test('electron-preload.js exposes DragonDownload API', () => {
    const preload = read('electron-preload.js');
    assert.match(preload, /contextBridge\.exposeInMainWorld\('DragonDownload'/);
    ['onEvent', 'changeDirectory', 'getDirectory', 'openFile', 'showItemInFolder', 'cancel'].forEach(fn => {
        assert.ok(preload.includes(fn), `${fn} is exposed in DragonDownload`);
    });
});

test('desktop-download-manager.js creates floating banner and right-side collapsed progress ring', () => {
    const dlManager = read('frontend/js/shared/desktop-download-manager.js');

    // 包含右上角横幅和右侧折叠圆环
    assert.match(dlManager, /desktopDlBanner/);
    assert.match(dlManager, /desktopDlFab/);

    // 横幅包含「更换目录」、「收起」和「关闭」
    assert.match(dlManager, /id="desktopDlChangeDirBtn"/);
    assert.match(dlManager, /id="desktopDlCollapseBtn"/);
    assert.match(dlManager, /id="desktopDlCloseBtn"/);

    // 右侧折叠圆环对齐 Dragonclaw 客服助手（半胶囊形，位于上移后的智能体抽屉上方 328px，避免遮挡推广视频）
    assert.match(dlManager, /\.desktop-dl-fab\s*\{[^}]*bottom:\s*328px/);
    assert.match(dlManager, /\.desktop-dl-fab\s*\{[^}]*border-radius:\s*24px 0 0 24px/);

    // 外环为 SVG 进度环，中央为黑白主题下载符号
    assert.match(dlManager, /class="desktop-dl-fab-ring"/);
    assert.match(dlManager, /class="desktop-dl-ring-fill"/);
    assert.match(dlManager, /id="desktopDlRingFill"/);
    assert.match(dlManager, /stroke-dashoffset/);

    // 支持完成自动倒计时消失与打开文件/文件夹
    assert.match(dlManager, /scheduleAutoDismiss/);
    assert.match(dlManager, /desktopDlOpenFileBtn/);
    assert.match(dlManager, /desktopDlShowFolderBtn/);
});

test('desktop-window.js implements Windows caption controls at top-right with standard order', () => {
    const desktopWinJs = read('frontend/js/shared/desktop-window.js');
    assert.doesNotThrow(() => new (require('node:vm').Script)(desktopWinJs), 'caption/drag initialization script must parse');
    assert.match(desktopWinJs, /\.desktop-controls\s*\{[^}]*top:\s*0/);
    assert.match(desktopWinJs, /\.desktop-controls\s*\{[^}]*right:\s*0/);
    assert.match(desktopWinJs, /data-act="minimize"/);
    assert.match(desktopWinJs, /data-act="maximize"/);
    assert.match(desktopWinJs, /data-act="close"/);
    assert.match(desktopWinJs, /html\.desktop-mac\s*\.desktop-controls\s*\{\s*display:\s*none\s*!important/);
});

test('home-v2 implements bottom-left direct channel QR login with black-white ring spinner', () => {
    const homeV2Js = read('frontend/js/home/home-v2.js');
    const homeV2Css = read('frontend/css/home-v2.css');
    const welinkRunner = read('backend/models/channels/welink-cli-runner.js');

    // 扫码弹窗直连 welink-cli 与 微信 接口
    assert.match(homeV2Js, /\/api\/channels\/welink-cli\/status/);
    assert.match(homeV2Js, /\/api\/channels\/welink-cli\/login/);
    assert.match(homeV2Js, /\/api\/channels\/weixin\/qrcode-auth/);
    assert.match(homeV2Js, /\/api\/channels\/weixin\/status/);

    // 黑白符合主题风格的圆环加载进度
    assert.match(homeV2Css, /\.v2-scan-ring-spinner/);
    assert.match(homeV2Css, /\.v2-scan-ring-spinner\s+svg/);
    assert.match(homeV2Css, /\.v2-scan-ring-bg/);
    assert.match(homeV2Css, /\.v2-scan-ring-bar/);
    assert.match(homeV2Css, /\.v2-scan-qr-box/);

    // welink-cli-runner 支持内置/vendor 候选路径，无需强制用户手动选 CLI 路径
    assert.match(welinkRunner, /localCandidates/);
    assert.match(welinkRunner, /vendor/);
});

test('dc-history-banner matches modern light theme with high contrast text and emerald icon', () => {
    const homeV2Css = read('frontend/css/home-v2.css');
    const homeThemeCss = read('frontend/css/home-theme.css');

    // 历史恢复条在浅色主题下文字清晰高对比度，不泛白
    assert.match(homeV2Css, /html\[data-ui="v2"\]\s*\.dc-history-banner\s*\{[^}]*background:\s*#f1f5f9/);
    assert.match(homeV2Css, /html\[data-ui="v2"\]\s*\.dc-history-banner\s*\{[^}]*color:\s*#334155/);
    assert.match(homeV2Css, /html\[data-ui="v2"\]\s*\.dc-history-banner\s+span\[aria-hidden="true"\]\s*\{[^}]*color:\s*#059669/);

    // 深色主题下优雅融合
    assert.match(homeV2Css, /html\[data-ui="v2"\]\[data-theme="dark"\]\s*\.dc-history-banner/);

    // 历史分割线样式
    assert.match(homeV2Css, /html\[data-ui="v2"\]\s*\.dc-history-divider/);
    assert.match(homeThemeCss, /\.dc-history-banner/);
});

test('channels nav item disables when unconfigured or not enabled and shows tooltip explanation', () => {
    const homeV2Js = read('frontend/js/home/home-v2.js');
    const homeV2Css = read('frontend/css/home-v2.css');
    const channelsRoute = read('backend/routes/channels.js');

    // 后端 /available 返回 channels summary（区分未对接与已对接未启用）
    assert.match(channelsRoute, /summary\[id\]\s*=\s*\{\s*configured:\s*Boolean\(status\.configured\),\s*enabled:\s*Boolean\(status\.enabled\)/);

    // 前端多语言提示文本
    assert.match(homeV2Js, /channelDisabledNoChannel:\s*'当前未对接任何频道（WeLink \/ 微信），可在全局设置中对接'/);
    assert.match(homeV2Js, /channelDisabledNotEnabled:\s*'已配置频道凭据但尚未启用，请在全局设置中开启'/);
    assert.match(homeV2Js, /channelDisabledNoChannel:\s*'No channels configured/);
    assert.match(homeV2Js, /channelDisabledNotEnabled:\s*'Channels configured but not enabled/);

    // 导航项禁用样式与悬停提示气泡
    assert.match(homeV2Css, /\.v2-nav-item\.is-disabled\s*\{[^}]*cursor:\s*not-allowed\s*!important/);
    assert.match(homeV2Css, /\.v2-nav-tip\s*\{[^}]*position:\s*fixed/);

    // 状态更新与点击拦截
    assert.match(homeV2Js, /function updateChannelsNavState/);
    assert.match(homeV2Js, /navItem\.classList\.add\('is-disabled'\)/);
    assert.match(homeV2Js, /navItem\.title\s*=\s*reason/);
    assert.match(homeV2Js, /ACTIONS[\s\S]*channels\(\)[\s\S]*navItem\?\.classList\.contains\('is-disabled'\)/);
});

test('alert center popup replaces fullAlerts button with clearAll button and API', () => {
    const homeV2Js = read('frontend/js/home/home-v2.js');
    const alertRoutes = read('backend/routes/alert-center.js');
    const alertRepo = read('backend/models/alert-center-repository.js');

    // 不再包含完整告警台按钮
    assert.doesNotMatch(homeV2Js, /data-msg-full/);
    assert.doesNotMatch(homeV2Js, /fullAlerts:\s*'完整告警台'/);

    // 换成全部清除功能与按钮
    assert.match(homeV2Js, /clearAll:\s*'全部清除'/);
    assert.match(homeV2Js, /clearAll:\s*'Clear all'/);
    assert.match(homeV2Js, /data-msg-clear/);
    assert.match(homeV2Js, /\/api\/alert-center\/events\/clear-all/);

    // 后端仓库与路由支持清空告警
    assert.match(alertRepo, /async function clearAllEvents\(\)/);
    assert.match(alertRepo, /DELETE FROM alert_center_events/);
    assert.match(alertRoutes, /\/events\/clear-all/);
});

test('Dragon Claw floating avatar supports vertical edge dragging, position persistence and idle opacity fade', () => {
    const assistantJs = read('frontend/js/shared/ai-assistant.js');
    const homeV2Css = read('frontend/css/home-v2.css');
    const dlManager = read('frontend/js/shared/desktop-download-manager.js');

    // 1. .ai-fab 样式定义：手形光标 grab、不活动淡出 .is-idle、拖动状态 .is-dragging
    assert.match(assistantJs, /\.ai-fab\s*\{[^}]*cursor:\s*grab/);
    assert.match(assistantJs, /\.ai-fab\.is-dragging\s*\{[^}]*cursor:\s*grabbing !important/);
    assert.match(assistantJs, /\.ai-fab\.is-dragging\s*\{[^}]*transition:\s*none !important/);
    assert.match(assistantJs, /\.ai-fab\.is-idle\s*\{[^}]*opacity:\s*0\.42/);
    assert.match(assistantJs, /\.ai-fab\.is-idle\s*\{[^}]*transform:\s*translateX\(8px\)/);
    assert.match(assistantJs, /\.ai-fab\.is-idle:hover[\s\S]*opacity:\s*1/);
    assert.match(assistantJs, /html\[data-theme="dark"\]\s*\.ai-fab\.is-idle/);

    // 2. 纵向边缘拖动与防误触点击
    assert.match(assistantJs, /const FAB_STORAGE_KEY\s*=\s*'tools_ai_fab_top'/);
    assert.match(assistantJs, /function clampFabTop/);
    assert.match(assistantJs, /function applyFabTop/);
    assert.match(assistantJs, /function restoreFabPosition/);
    assert.match(assistantJs, /fabDrag\s*=\s*\{/);
    assert.match(assistantJs, /suppressFabClickUntil/);
    assert.match(assistantJs, /setPointerCapture/);
    assert.match(assistantJs, /releasePointerCapture/);

    // 3. 不活动调度与唤醒
    assert.match(assistantJs, /function wakeFab/);
    assert.match(assistantJs, /function scheduleFabIdle/);
    assert.match(assistantJs, /FAB_IDLE_DELAY_MS\s*=\s*3500/);

    // 4. home-v2.css 支持 CSS 变量定位与覆盖
    assert.match(homeV2Css, /top:\s*var\(--ai-fab-top,\s*auto\)/);
    assert.match(homeV2Css, /bottom:\s*var\(--ai-fab-bottom,\s*270px\)/);

    // 5. desktop-download-manager.js 监听 tools:ai-fab-position 并跟随定位
    assert.match(dlManager, /tools:ai-fab-position/);
    assert.match(dlManager, /function syncFabPlacement/);
});

test('desktop-credentials.js manages encrypted credentials persistence and fallback cleanly', () => {
    const os = require('node:os');
    const { createDesktopCredentialsManager } = require('../desktop-credentials');
    const tempFile = path.join(os.tmpdir(), `test-creds-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

    try {
        const mgr = createDesktopCredentialsManager({ credentialsPath: tempFile });
        // 初始无凭据
        assert.equal(mgr.getCredentials(), null);

        // 保存凭据
        const saved = mgr.saveCredentials({ username: 'admin', password: 'SecretPassword123!' });
        assert.equal(saved, true);

        // 验证文件持久化且明文不直接暴露
        const rawContent = fs.readFileSync(tempFile, 'utf8');
        assert.doesNotMatch(rawContent, /SecretPassword123!/);
        assert.match(rawContent, /"username":\s*"admin"/);

        // 解密读取
        const loaded = mgr.getCredentials();
        assert.ok(loaded);
        assert.equal(loaded.username, 'admin');
        assert.equal(loaded.password, 'SecretPassword123!');

        // 清理凭据
        const cleared = mgr.clearCredentials();
        assert.equal(cleared, true);
        assert.equal(fs.existsSync(tempFile), false);
        assert.equal(mgr.getCredentials(), null);
    } finally {
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
    }
});

test('electron-main.js, preload and login.html integrate desktop auto-login credentials', () => {
    const electronMain = read('electron-main.js');
    const preload = read('electron-preload.js');
    const loginHtml = read('frontend/pages/login.html');
    const navbarJs = read('frontend/js/shared/navbar.js');

    // 1. electron-main 注册 desktop-auth IPC 处理程序
    assert.match(electronMain, /ipcMain\.handle\('desktop-auth:get-credentials'/);
    assert.match(electronMain, /ipcMain\.handle\('desktop-auth:save-credentials'/);
    assert.match(electronMain, /ipcMain\.handle\('desktop-auth:clear-credentials'/);

    // 2. preload 暴露 ToolsDesktopAuth
    assert.match(preload, /contextBridge\.exposeInMainWorld\('ToolsDesktopAuth'/);
    assert.match(preload, /getSavedCredentials/);
    assert.match(preload, /saveCredentials/);
    assert.match(preload, /clearCredentials/);

    // 3. login.html 支持自动登录且登录成功后自动记住，无需显式勾选项
    assert.match(loginHtml, /async function checkDesktopAutoLogin/);
    assert.match(loginHtml, /window\.ToolsDesktopAuth\?\.saveCredentials/);
    assert.match(loginHtml, /checkDesktopAutoLogin\(\);/);

    // 4. 用户手动退出时携带 ?logout=1，避免陷入自动登录死循环
    assert.match(navbarJs, /window\.location\.href\s*=\s*['"]\/login\.html\?logout=1['"]/);
});

test('conversation-list and dragon-claw support status and time filtering', () => {
    const listJs = read('frontend/js/home/conversation-list.js');
    const clawJs = read('frontend/js/home/dragon-claw.js');

    // conversation-list.js 过滤支持置顶、讨论组、工作区，以及时间筛选
    assert.match(listJs, /filter\.status==='group'/);
    assert.match(listJs, /filter\.status==='workspace'/);
    assert.match(listJs, /filter\.time==='today'/);
    assert.match(listJs, /passesFilter/);

    // dragon-claw.js 在 unified mode 下响应状态与时间过滤
    assert.match(clawJs, /activeFilter\.status === 'pinned'/);
    assert.match(clawJs, /activeFilter\.status === 'group'/);
    assert.match(clawJs, /activeFilter\.status === 'workspace'/);
    assert.match(clawJs, /activeFilter\.time === 'today'/);
});
