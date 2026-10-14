const electron = require('electron');
const app = electron && electron.app ? electron.app : null;
const BrowserWindow = electron && electron.BrowserWindow ? electron.BrowserWindow : null;
const screen = electron && electron.screen ? electron.screen : null;
const ipcMain = electron && electron.ipcMain ? electron.ipcMain : null;
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const desktopLanguage = require('../backend/models/desktop-language');
desktopLanguage.events.on('change', (language) => {
    for (const win of [petWin, chatWin, settingsWin]) {
        if (win && !win.isDestroyed()) win.webContents.send('pet-language-change', language);
    }
});
const { detectAllQuotas } = require('./quota-detector');
const {
    startKeyboardHook,
    stopKeyboardHook,
    isKeyboardHookRunning,
    checkAccessibilityPermission,
    openAccessibilitySettings
} = require('./pet-keyboard-hook');

let petWin = null;
let chatWin = null;
let settingsWin = null;

let localServerPort = 3030;
let localBaseUrl = 'http://localhost:3030';
let quotaPollingTimer = null;
let presencePollingTimer = null;
let ipcRegistered = false;
let storyChatReady = false;
let pendingStoryRequest = null;
let storyRequestSequence = 0;

function normalizeBaseUrl(input, port = 3030) {
    try {
        if (!input) return `http://127.0.0.1:${port}`;
        const parsed = new URL(input);
        return parsed.origin;
    } catch (_) {
        return `http://127.0.0.1:${port}`;
    }
}

async function requestPetStories(id, language) {
    const token = await getOrCreateDesktopPetToken();
    if (!token) throw new Error('PET_STORY_AUTH_UNAVAILABLE');
    const suffix = id ? '/' + encodeURIComponent(id) : '';
    const lang = language === 'en-US' ? 'en-US' : 'zh-CN';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const base = normalizeBaseUrl(localBaseUrl, localServerPort);
        const targetUrl = new URL('/api/desktop-pet/stories' + suffix, base);
        targetUrl.searchParams.set('language', lang);
        const response = await fetch(targetUrl.toString(), {
            headers: { Authorization: 'Bearer ' + token }, signal: controller.signal
        });
        if (!response.ok) throw new Error('PET_STORY_REQUEST_FAILED');
        const contentType = response.headers?.get ? (response.headers.get('content-type') || '') : '';
        if (contentType && !contentType.includes('application/json')) {
            throw new Error('PET_STORY_INVALID_CONTENT_TYPE: ' + contentType);
        }
        let data;
        if (typeof response.text === 'function') {
            const text = await response.text();
            try {
                data = JSON.parse(text);
            } catch (parseError) {
                throw new Error('PET_STORY_INVALID_JSON: ' + parseError.message);
            }
        } else if (typeof response.json === 'function') {
            data = await response.json();
        } else {
            throw new Error('PET_STORY_INVALID_RESPONSE');
        }
        return id ? data.story : data.stories;
    } finally { clearTimeout(timeout); }
}

function openStoryChat(id) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) return;
    pendingStoryRequest = { id, requestId: ++storyRequestSequence };
    const win = createChatWindow();
    if (petWin && !petWin.isDestroyed()) {
        const size = win.getSize();
        win.setBounds(calculateChatBounds(petWin.getBounds(), size[0], size[1]));
    }
    // Story clicks always open the window; they never toggle an open chat closed.
    win.show();
    win.focus();
    if (storyChatReady && !win.webContents.isLoading()) {
        win.webContents.send('pet-open-story', pendingStoryRequest);
        pendingStoryRequest = null;
    }
}

// Screen and cursor coordinates use Electron DIP units and the pet's current monitor.
function sendPetEnvironment() {
    if (!petWin || petWin.isDestroyed() || petWin.webContents.isLoading()) return;
    try {
        const bounds = petWin.getBounds();
        const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
        petWin.webContents.send('pet-environment', {
            bounds, workArea: display.workArea,
            cursor: typeof screen.getCursorScreenPoint === 'function' ? screen.getCursorScreenPoint() : null,
            visible: petWin.isVisible()
        });
    } catch (_) {}
}

/**
 * 向桌宠窗口派发全局或本地按键反馈
 */
function triggerPetKeyPress() {
    try {
        if (petWin && !petWin.isDestroyed() && petWin.isVisible()) {
            petWin.webContents.send('pet-key-press');
        }
    } catch (_) {}
}

/**
 * 根据当前桌宠开关与显隐状态，安全同步全局键盘监听钩子
 */
function syncKeyboardHookState() {
    try {
        const cfg = loadPetConfig();
        const shouldRun = cfg.enabled !== false && cfg.typingOn !== false && isPetVisible();
        if (shouldRun) {
            startKeyboardHook(triggerPetKeyPress);
        } else {
            stopKeyboardHook();
        }
    } catch (err) {
        console.warn('[PetManager] syncKeyboardHookState error:', err.message || err);
    }
}

function getUserDataDir() {
    if (app && typeof app.getPath === 'function') {
        try { return app.getPath('userData'); } catch (_) {}
    }
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(home, '.tools-platform');
}

function getConfigFilePath() {
    return path.join(getUserDataDir(), 'desktop-pet-config.json');
}

const DEFAULT_CONFIG = {
    enabled: true,         // 是否开机/启动自动加载桌宠 (false 为永久无桌宠模式)
    visible: true,         // 当前是否可见 (本次临时隐藏状态)
    scale: 0.75,          // 默认体型缩放 0.75x (适合桌面沉浸式办公，小巧不遮挡)
    soundVol: 0.8,
    soundSet: 'duck',
    bubbleOn: true,
    typingOn: true,
    eyeGazeOn: true,
    randomMotionOn: true,
    proactiveStoriesOn: true,
    storyIntervalMinutes: 3,
    position: null
};

function loadPetConfig() {
    try {
        const filePath = getConfigFilePath();
        if (fs.existsSync(filePath)) {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            // 兼容旧版默认 1.2 缩放：若未设置 scaleVersion 且仍为旧版默认 1.2，则平滑升级为 0.75
            if (!parsed.scaleVersion && (parsed.scale === 1.2 || parsed.scale === undefined || parsed.scale === null)) {
                parsed.scale = 0.75;
                parsed.scaleVersion = 2;
                savePetConfig(parsed);
            }
            return Object.assign({}, DEFAULT_CONFIG, parsed);
        }
    } catch (_) {}
    return Object.assign({}, DEFAULT_CONFIG);
}

function savePetConfig(patch) {
    try {
        const current = loadPetConfig();
        const merged = Object.assign({}, current, patch);
        const filePath = getConfigFilePath();
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
        return merged;
    } catch (err) {
        console.warn('[PetManager] Failed to save config:', err.message || err);
        return loadPetConfig();
    }
}

/**
 * 计算桌宠初始屏幕坐标 (优先右下角贴边)
 */
function getInitialPetPosition(workArea, petW, petH, savedPos) {
    let targetX = workArea.width > 2200
        ? Math.round(workArea.x + workArea.width * 0.8)
        : Math.max(workArea.x, workArea.x + workArea.width - petW - 25);
    let targetY = Math.max(workArea.y, workArea.y + workArea.height - petH - 25);

    if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
        if (savedPos.x >= workArea.x - 60 && savedPos.x <= workArea.x + workArea.width - 60 &&
            savedPos.y >= workArea.y - 60 && savedPos.y <= workArea.y + workArea.height - 60) {
            targetX = savedPos.x;
            targetY = savedPos.y;
        }
    }
    return { x: Math.round(targetX), y: Math.round(targetY) };
}

let cachedPetToken = null;
async function getOrCreateDesktopPetToken() {
    if (cachedPetToken) return cachedPetToken;
    try {
        const crypto = require('crypto');
        const authSessionsRepo = require('../backend/models/auth-sessions-repository');
        cachedPetToken = 'pet_' + crypto.randomBytes(24).toString('hex');
        const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
        await authSessionsRepo.saveSession(cachedPetToken, 'desktop_pet', 'admin', expiresAt, 'default');
        console.log('[PetManager] 已为桌面宠物自动签发本地长期凭证，具备完整 AI 对话与服务权限');
        return cachedPetToken;
    } catch (err) {
        console.warn('[PetManager] Failed to create desktop pet auth session:', err.message || err);
        return null;
    }
}

/**
 * 智能计算对话窗口坐标：
 * 严格保证对话框与桌宠小人左右错开，绝对不产生遮挡覆盖！默认加大宽高度 (440x620)
 */
function calculateChatBounds(petBounds, chatW = 440, chatH = 620) {
    const primaryDisplay = screen.getDisplayMatching(petBounds) || screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    let chatX = 0;
    let chatY = 0;

    const spaceLeft = petBounds.x - workArea.x;
    const spaceRight = (workArea.x + workArea.width) - (petBounds.x + petBounds.width);

    // 优先放置在空间更充裕的一侧
    if (spaceLeft >= chatW + 12) {
        chatX = petBounds.x - chatW - 12; // 放置在桌宠左侧
    } else if (spaceRight >= chatW + 12) {
        chatX = petBounds.x + petBounds.width + 12; // 放置在桌宠右侧
    } else {
        // 如果左右都极度狭窄，退回到屏幕内侧边缘
        chatX = spaceLeft >= spaceRight
            ? Math.max(workArea.x + 8, petBounds.x - chatW - 8)
            : Math.min(workArea.x + workArea.width - chatW - 8, petBounds.x + petBounds.width + 8);
    }

    // 纵向底部对齐桌宠脚底
    chatY = petBounds.y + petBounds.height - chatH;
    // 上下边界保护
    chatY = Math.max(workArea.y + 10, Math.min(workArea.y + workArea.height - chatH - 10, chatY));
    chatX = Math.max(workArea.x + 10, Math.min(workArea.x + workArea.width - chatW - 10, chatX));

    return {
        x: Math.round(chatX),
        y: Math.round(chatY),
        width: chatW,
        height: chatH
    };
}

/**
 * 创建桌宠透明视窗
 */
function createPetWindow() {
    if (petWin && !petWin.isDestroyed()) {
        petWin.show();
        return petWin;
    }

    const cfg = loadPetConfig();
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    const baseW = 290;
    const baseH = 390;
    const s = Math.max(0.6, Math.min(2.5, Number(cfg.scale) || 0.75));
    const petW = Math.max(160, Math.round(baseW * s));
    const petH = Math.max(220, Math.round(baseH * s));

    const pos = getInitialPetPosition(workArea, petW, petH, cfg.position);

    petWin = new BrowserWindow({
        width: petW,
        height: petH,
        x: pos.x,
        y: pos.y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });

    const petHtmlPath = path.join(__dirname, 'pet.html');
    petWin.loadFile(petHtmlPath).catch((err) => {
        console.warn('[PetManager] Failed to load pet.html:', err.message || err);
    });

    petWin.webContents.once('did-finish-load', () => {
        if (!petWin || petWin.isDestroyed()) return;
        petWin.show();
        petWin.setAlwaysOnTop(true);
        petWin.webContents.send('pet-apply-config', cfg);
        sendPetEnvironment();
        refreshQuotas();
        syncKeyboardHookState();
    });

    petWin.on('move', sendPetEnvironment);
    petWin.on('resize', sendPetEnvironment);
    petWin.on('show', sendPetEnvironment);
    petWin.on('hide', sendPetEnvironment);
    petWin.on('closed', () => {
        petWin = null;
        stopKeyboardHook();
    });

    return petWin;
}

/**
 * 创建独立可爱的 AI 对话面板视窗 (不与桌宠覆盖)
 */
function createChatWindow() {
    if (chatWin && !chatWin.isDestroyed()) {
        return chatWin;
    }

    storyChatReady = false;
    const petBounds = petWin && !petWin.isDestroyed()
        ? petWin.getBounds()
        : { x: 800, y: 500, width: 300, height: 400 };

    const bounds = calculateChatBounds(petBounds);

    chatWin = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: true,
        minWidth: 360,
        minHeight: 460,
        maxWidth: 760,
        maxHeight: 960,
        skipTaskbar: true,
        hasShadow: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });

    const chatHtmlPath = path.join(__dirname, 'pet-chat.html');
    chatWin.loadFile(chatHtmlPath).catch((err) => {
        console.warn('[PetManager] Failed to load pet-chat.html:', err.message || err);
    });

    chatWin.webContents.once('did-finish-load', async () => {
        if (chatWin && !chatWin.isDestroyed()) {
            const token = await getOrCreateDesktopPetToken();
            const quotas = await detectAllQuotas().catch(() => null);
            chatWin.webContents.send('pet-chat-init', {
                port: localServerPort,
                baseUrl: localBaseUrl,
                token: token,
                quotas: quotas
            });
            refreshQuotas();
        }
    });

    chatWin.on('closed', () => {
        chatWin = null;
        storyChatReady = false;
        pendingStoryRequest = null;
        if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet-chat-generating', false);
    });
    chatWin.webContents.on('did-start-loading', () => { storyChatReady = false; });

    return chatWin;
}

/**
 * 创建桌宠设置菜单视窗
 */
function createSettingsWindow() {
    if (settingsWin && !settingsWin.isDestroyed()) {
        return settingsWin;
    }

    const menuW = 280;
    const menuH = 570;

    settingsWin = new BrowserWindow({
        width: menuW,
        height: menuH,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        hasShadow: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });

    const settingsHtmlPath = path.join(__dirname, 'settings.html');
    settingsWin.loadFile(settingsHtmlPath).catch((err) => {
        console.warn('[PetManager] Failed to load settings.html:', err.message || err);
    });

    settingsWin.on('blur', () => {
        if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) {
            settingsWin.hide();
        }
    });

    settingsWin.on('closed', () => {
        settingsWin = null;
    });

    return settingsWin;
}

/**
 * 刷新并向前端广播多模型额度数据 (容错静默)
 */
async function refreshQuotas() {
    try {
        const quotas = await detectAllQuotas();
        if (petWin && !petWin.isDestroyed()) {
            petWin.webContents.send('pet-quota-update', quotas);
        }
        if (chatWin && !chatWin.isDestroyed()) {
            chatWin.webContents.send('pet-quota-update', quotas);
        }
    } catch (_) {}
}

/**
 * 注册 IPC 消息处理
 */
function registerIpc() {
    if (ipcRegistered) return;
    ipcRegistered = true;
    ipcMain.handle('pet-get-language', () => desktopLanguage.getLanguage());
    const isPetSender = event => petWin && !petWin.isDestroyed() && event.sender === petWin.webContents;
    const isChatSender = event => chatWin && !chatWin.isDestroyed() && event.sender === chatWin.webContents;
    ipcMain.on('pet-request-environment', event => { if (isPetSender(event)) sendPetEnvironment(); });
    ipcMain.handle('pet-get-stories', (event, language) => {
        if (!isPetSender(event) && !isChatSender(event)) throw new Error('PET_STORY_WINDOW_REQUIRED');
        return requestPetStories(null, language || desktopLanguage.getLanguage()).then(list => (Array.isArray(list) ? list : [])).catch(err => {
            console.warn('[PetManager] Stories fetch suppressed:', err.message || err);
            return [];
        });
    });
    ipcMain.handle('pet-get-story', (event, id, language) => {
        if (!isChatSender(event)) throw new Error('PET_STORY_WINDOW_REQUIRED');
        if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) throw new Error('INVALID_PET_STORY');
        return requestPetStories(id, language || desktopLanguage.getLanguage());
    });
    ipcMain.on('pet-open-story', (event, id) => {
        if (isPetSender(event)) openStoryChat(id);
    });
    ipcMain.handle('pet-story-ready', event => {
        if (!isChatSender(event)) throw new Error('PET_STORY_WINDOW_REQUIRED');
        storyChatReady = true;
        const request = pendingStoryRequest;
        pendingStoryRequest = null;
        return request;
    });
    ipcMain.on('pet-chat-generating', (event, active) => {
        if (isChatSender(event) && petWin && !petWin.isDestroyed()) {
            petWin.webContents.send('pet-chat-generating', !!active);
        }
    });

    // 获取前端初始参数 (端口、Token、配额数据)
    ipcMain.handle('pet-get-init-data', async () => {
        const token = await getOrCreateDesktopPetToken();
        const quotas = await detectAllQuotas().catch(() => null);
        return {
            port: localServerPort,
            baseUrl: localBaseUrl,
            token: token,
            quotas: quotas
        };
    });

    // 切换对话窗口 (点击桌宠时触发)
    ipcMain.on('pet-toggle-chat', () => {
        try {
            if (!chatWin || chatWin.isDestroyed()) {
                createChatWindow();
            }
            if (chatWin.isVisible()) {
                chatWin.hide();
            } else {
                // 每次打开重新根据桌宠当前位置校准对话框坐标，保证不重叠
                if (petWin && !petWin.isDestroyed()) {
                    const currentSize = chatWin.getSize();
                    const bounds = calculateChatBounds(petWin.getBounds(), currentSize[0] || 440, currentSize[1] || 620);
                    chatWin.setBounds(bounds);
                }
                chatWin.show();
                chatWin.focus();
            }
        } catch (err) {
            console.warn('[PetManager] pet-toggle-chat error:', err.message || err);
        }
    });

    // 切换设置窗口
    ipcMain.on('pet-toggle-settings', (event, charRect) => {
        try {
            if (!settingsWin || settingsWin.isDestroyed()) {
                createSettingsWindow();
            }
            if (settingsWin.isVisible()) {
                settingsWin.hide();
                return;
            }

            const menuW = 280;
            const menuH = 570;
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenW, height: screenH } = primaryDisplay.workArea;

            let targetX = charRect ? (charRect.left - menuW - 10) : 500;
            let targetY = charRect ? charRect.top : 300;
            if (targetX < 10) targetX = charRect ? (charRect.right + 10) : 100;
            targetY = Math.max(10, Math.min(screenH - menuH - 10, targetY));

            settingsWin.setBounds({
                x: Math.round(targetX),
                y: Math.round(targetY),
                width: menuW,
                height: menuH
            });

            settingsWin.webContents.send('pet-init-settings', loadPetConfig());
            settingsWin.show();
            settingsWin.focus();
        } catch (err) {
            console.warn('[PetManager] pet-toggle-settings error:', err.message || err);
        }
    });

    ipcMain.on('pet-close-settings', () => {
        if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
    });

    // 记录桌宠新坐标
    ipcMain.on('pet-set-position', (event, x, y) => {
        try {
            if (petWin && !petWin.isDestroyed()) {
                const nx = Math.round(x);
                const ny = Math.round(y);
                petWin.setPosition(nx, ny);
                savePetConfig({ position: { x: nx, y: ny } });
            }
        } catch (_) {}
    });

    // 重置桌宠位置
    ipcMain.on('pet-reset-position', () => {
        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            const workArea = primaryDisplay.workArea;
            const bounds = petWin ? petWin.getBounds() : { width: 300, height: 400 };
            const newX = Math.round(workArea.x + workArea.width - bounds.width - 25);
            const newY = Math.round(workArea.y + workArea.height - bounds.height - 25);
            if (petWin && !petWin.isDestroyed()) {
                petWin.setPosition(newX, newY);
            }
            savePetConfig({ position: { x: newX, y: newY } });
        } catch (_) {}
    });

    // 缩放调整
    ipcMain.on('pet-set-scale', (event, scale) => {
        try {
            const s = Math.max(0.6, Math.min(2.5, Number(scale) || 0.75));
            savePetConfig({ scale: s, scaleVersion: 2 });
            if (petWin && !petWin.isDestroyed()) {
                const baseW = 290;
                const baseH = 390;
                const newW = Math.max(160, Math.round(baseW * s));
                const newH = Math.max(220, Math.round(baseH * s));
                const currentPos = petWin.getPosition();
                petWin.setSize(newW, newH);
                petWin.webContents.send('pet-apply-scale', s);
            }
        } catch (_) {}
    });

    // 音量调节
    ipcMain.on('pet-set-volume', (event, vol) => {
        try {
            const v = Math.round(Math.min(1, Math.max(0, Number(vol))) * 100) / 100;
            savePetConfig({ soundVol: v });
            if (petWin && !petWin.isDestroyed()) {
                petWin.webContents.send('pet-apply-volume', v);
            }
        } catch (_) {}
    });

    // 配置更新
    ipcMain.on('pet-config-changed', (event, cfg) => {
        try {
            const merged = savePetConfig(cfg);
            if (petWin && !petWin.isDestroyed()) {
                petWin.webContents.send('pet-apply-config', merged);
            }
            if (cfg && (cfg.typingOn !== undefined || cfg.enabled !== undefined)) {
                syncKeyboardHookState();
            }
        } catch (_) {}
    });

    // 本地打字输入触发 (如在桌宠 AI 聊天框中输入)
    ipcMain.on('pet-key-press-local', () => {
        triggerPetKeyPress();
    });

    // 检查 macOS 辅助功能权限
    ipcMain.handle('pet-check-accessibility', () => {
        return checkAccessibilityPermission(false);
    });

    // 请求 macOS 辅助功能授权并打开系统设置
    ipcMain.on('pet-request-accessibility', () => {
        checkAccessibilityPermission(true);
        openAccessibilitySettings();
    });

    // 本次隐藏
    ipcMain.on('pet-hide-temporary', () => {
        hidePetForNow();
    });

    // 永久隐藏 / 停用桌宠模式
    ipcMain.on('pet-set-permanent-hidden', (event, hidden) => {
        setPetEnabled(!hidden);
    });

    // 鼠标点击穿透
    ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win && !win.isDestroyed()) {
                win.setIgnoreMouseEvents(ignore, options);
            }
        } catch (_) {}
    });

    // 触发桌宠表情动作联动 (如 typing, happy, chill)
    ipcMain.on('pet-trigger-motion', (event, motion) => {
        try {
            if (petWin && !petWin.isDestroyed()) {
                petWin.webContents.send('pet-trigger-motion', motion);
            }
        } catch (_) {}
    });

    // 请求额度数据
    ipcMain.on('pet-request-quota', () => {
        refreshQuotas();
    });
}

/**
 * 本次临时隐藏
 */
function hidePetForNow() {
    stopKeyboardHook();
    if (chatWin && !chatWin.isDestroyed()) chatWin.hide();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
    if (petWin && !petWin.isDestroyed()) petWin.hide();
}

/**
 * 本次重新唤起显示
 */
function showPetForNow() {
    if (petWin && !petWin.isDestroyed()) {
        petWin.show();
        petWin.focus();
        petWin.setAlwaysOnTop(true);
        syncKeyboardHookState();
    } else {
        createPetWindow();
    }
}

/**
 * 永久开启/关闭桌宠 (切换为无桌宠模式)
 */
function setPetEnabled(enabled) {
    savePetConfig({ enabled: Boolean(enabled) });
    if (enabled) {
        showPetForNow();
    } else {
        stopKeyboardHook();
        // 彻底关闭并销毁窗口，恢复完全无桌宠状态
        if (chatWin && !chatWin.isDestroyed()) chatWin.destroy();
        if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy();
        if (petWin && !petWin.isDestroyed()) petWin.destroy();
        chatWin = null;
        settingsWin = null;
        petWin = null;
    }
}

/**
 * 检查当前桌宠是否永久启用
 */
function isPetEnabled() {
    const cfg = loadPetConfig();
    return cfg.enabled !== false;
}

/**
 * 检查当前桌宠是否在界面上处于可见状态
 */
function isPetVisible() {
    return Boolean(petWin && !petWin.isDestroyed() && petWin.isVisible());
}

/**
 * 初始化桌宠服务
 */
function initDesktopPet({ port = 3030, baseUrl = 'http://localhost:3030' } = {}) {
    localServerPort = port;
    localBaseUrl = normalizeBaseUrl(baseUrl, port);
    registerIpc();

    const cfg = loadPetConfig();
    if (cfg.enabled === false) {
        console.log('[PetManager] 桌面宠物处于永久隐藏状态（无桌宠模式），跳过加载');
        return;
    }

    console.log('[PetManager] 启动桌面宠物组件...');
    createPetWindow();
    if (!presencePollingTimer) presencePollingTimer = setInterval(() => {
        if (isPetVisible()) sendPetEnvironment();
    }, 250);

    // 启动后台静默额度同步探针 (15s 一次，非阻塞)
    if (!quotaPollingTimer) {
        quotaPollingTimer = setInterval(() => {
            if ((petWin && !petWin.isDestroyed() && petWin.isVisible()) ||
                (chatWin && !chatWin.isDestroyed() && chatWin.isVisible())) {
                refreshQuotas();
            }
        }, 15000);
    }
}

function cleanupDesktopPet() {
    if (presencePollingTimer) { clearInterval(presencePollingTimer); presencePollingTimer = null; }
    stopKeyboardHook();
    if (quotaPollingTimer) {
        clearInterval(quotaPollingTimer);
        quotaPollingTimer = null;
    }
    if (chatWin && !chatWin.isDestroyed()) chatWin.destroy();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy();
    if (petWin && !petWin.isDestroyed()) petWin.destroy();
    chatWin = null;
    settingsWin = null;
    petWin = null;
}

module.exports = {
    initDesktopPet,
    cleanupDesktopPet,
    isPetEnabled,
    isPetVisible,
    setPetEnabled,
    showPetForNow,
    hidePetForNow,
    createChatWindow
};
