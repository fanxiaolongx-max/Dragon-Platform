const { app, BrowserWindow, dialog, ipcMain, session, shell, Tray, Menu, nativeImage, clipboard, net, screen } = require('electron');

// 保证程序单实例运行，避免多开冲突导致 SQLite 锁死 (SQLITE_BUSY: database is locked)
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    console.warn('[Electron] 检测到已有实例在运行，当前第二实例静默退出');
    app.quit();
    process.exit(0);
}

// 首页推广视频需要带声音自动播放；桌面端不要求先有用户手势（浏览器端会自动降级为静音播放）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const util = require('util');
const { spawn } = require('child_process');
const http = require('http');

// IMPORTANT: Set the data directory to the OS's native user data path BEFORE requiring server.js
const userDataPath = app.getPath('userData');
process.env.TOOLS_DATA_DIR = path.join(userDataPath, 'data');
process.env.TOOLS_BRANDING_DIR = path.join(userDataPath, 'branding');
process.env.TOOLS_PROMO_CACHE_DIR = path.join(userDataPath, 'cache', 'home-videos');
// Electron networking follows the system/enterprise proxy, including GitHub redirects.
require('./backend/models/home-promo-videos').configurePromoVideoFetch((url, init) => net.fetch(url, init));
if (app.isPackaged) {
    process.env.TOOLS_MEDIA_DIR = path.join(userDataPath, 'media');
}
process.env.TOOLS_DESKTOP_RUNTIME = '1';
const electronLogRoot = path.join(userDataPath, 'logs');
const desktopLicenseStatePath = path.join(userDataPath, 'desktop-license.json');
const desktopLicensePublicStatusPath = path.join(userDataPath, 'desktop-license-public-status.json');
const desktopLicenseRequestPath = path.join(userDataPath, 'desktop-license-request.json');
process.env.TOOLS_DESKTOP_LICENSE_STATUS_PATH = desktopLicensePublicStatusPath;
const { createDesktopLicenseClient } = require('./desktop-license-client');
const { getDesktopMachineIdentity } = require('./desktop-machine-id');
const desktopLicenseClient = createDesktopLicenseClient({
    configPath: path.join(__dirname, 'frontend/desktop-license-client-config.json'),
    statePath: desktopLicenseStatePath,
    publicStatusPath: desktopLicensePublicStatusPath,
    requestStatePath: desktopLicenseRequestPath,
    // 走系统代理（企业内网常见），与浏览器访问授权服务器的网络路径一致
    fetchImpl: (url, init) => net.fetch(url, init)
});
const runtimeStatusPath = path.join(electronLogRoot, 'runtime-status.json');
const runtimeCommandPath = path.join(electronLogRoot, 'runtime-command.json');
const isPortableWindows = process.platform === 'win32' && Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
const latestReleaseUrl = 'https://github.com/fanxiaolongx-max/privacy-policy/releases/latest';
process.env.TOOLS_LOG_DIR = electronLogRoot;
if (process.env.TOOLS_DAILY_LOGS === undefined) {
    process.env.TOOLS_DAILY_LOGS = '0';
}
const petManager = require('./desktop-pet/pet-manager');
const { resolveLogoAsset } = require('./backend/models/platform-logo-runtime');
require('./backend/models/desktop-language').events.on('change', () => refreshTrayMenu());

function getAppIconPath() {
    const resolver = typeof resolveLogoAsset === 'function'
        ? resolveLogoAsset
        : (name) => path.join(__dirname, 'frontend/assets', name);
    if (process.platform === 'darwin') {
        return resolver('icon-windows.png');
    }
    if (process.platform !== 'win32') {
        return resolver('icon.ico');
    }
    const filename = isPortableWindows ? 'icon-windows-portable.ico' : 'icon-windows.ico';
    return resolver(filename);
}

function getLogDay(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function getLocalLogTimestamp() {
    const now = new Date();
    const date = getLogDay(now);
    const time = [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ].join(':');
    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absOffset = Math.abs(offsetMinutes);
    const offset = `${sign}${String(Math.floor(absOffset / 60)).padStart(2, '0')}:${String(absOffset % 60).padStart(2, '0')}`;
    return `${date} ${time} ${offset}`;
}

function appendElectronLog(type, args) {
    try {
        const dayDir = path.join(electronLogRoot, getLogDay());
        fs.mkdirSync(dayDir, { recursive: true });
        const line = `[${getLocalLogTimestamp()}] ${args.map((arg) => {
            if (typeof arg === 'string') return arg;
            return util.inspect(arg, { depth: 5, breakLength: 160 });
        }).join(' ')}\n`;
        fs.appendFileSync(path.join(dayDir, type === 'error' ? 'error.log' : 'out.log'), line, 'utf-8');
    } catch (_err) {
        // Avoid recursive logging failures while the app is starting.
    }
}

function setupElectronFileLogging() {
    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);
    console.log = (...args) => {
        appendElectronLog('out', args);
        originalLog(...args);
    };
    console.warn = (...args) => {
        appendElectronLog('out', args);
        originalWarn(...args);
    };
    console.error = (...args) => {
        appendElectronLog('error', args);
        originalError(...args);
    };
}

setupElectronFileLogging();

process.on('uncaughtException', (err) => {
    console.error('[Electron] Uncaught Exception:', err);
    const msg = String(err && (err.message || err.stack) || '');
    if (msg.includes('SQLITE_BUSY') || (err && err.code === 'SQLITE_BUSY')) {
        try {
            dialog.showErrorBox(
                '数据服务忙碌 / Database Busy',
                '检测到本地数据库正被占用或有残留进程在运行。\n\n' +
                '建议排查方式：\n' +
                '1. 请在任务管理器中检查并结束可能残留的 Tools Platform 进程；\n' +
                '2. 避免同时在网盘实时同步目录或受限磁盘中多开运行。'
            );
        } catch (_) {}
    }
});

console.log('[Electron] User Data Path:', process.env.TOOLS_DATA_DIR);

const { chooseLocalPort, writePreferredPort } = require('./desktop-local-port');
const launchStatePath = path.join(userDataPath, 'launch-state.json');

const localPortStatePath = path.join(userDataPath, 'local-port.json');

let utilityWindow = null;
let startupWindow = null;
let licenseWindow = null;
let licenseActivationResolve = null;
let desktopLicenseStatus = { valid: false, reasonCode: 'LICENSE_REQUIRED' };
let desktopLicenseRefreshTimer = null;
let startupWindowLoaded = false;
let startupWindowCreatedAt = 0;
let startupProgressState = {
    percent: 34,
    title: '运行环境已就绪',
    detail: '解压完成，正在接力启动桌面环境…',
    stage: '阶段 2/2 · 启动接力',
    finished: false
};
let localPort = null;
let localServerStarted = false;
let tray = null;
require('./backend/models/platform-logo-runtime').events.on('change', () => {
    try {
        const icon = nativeImage.createFromPath(getAppIconPath());
        if (tray) tray.setImage(process.platform === 'darwin' ? icon.resize({ width: 18, height: 18 }) : icon);
        if (process.platform === 'darwin' && app.dock) app.dock.setIcon(icon);
        if (process.platform !== 'darwin') BrowserWindow.getAllWindows().forEach(window => window.setIcon(icon));
    } catch (error) { console.warn('[Electron] Could not refresh runtime logo:', error.message); }
});
let isQuitting = false;
let downloadHandlerRegistered = false;
let updateInfo = null;
let updateDownloaded = false;
let updateStatus = {
    state: isPortableWindows ? 'portable-manual' : 'idle',
    version: app.getVersion(),
    message: isPortableWindows ? '绿色版请手动下载更新' : '等待检查更新',
    progress: 0
};
let latestDownloadProgress = null;
let updateBalloonMilestonesShown = new Set();
let runtimeCommandTimer = null;
let lastRuntimeCommandId = '';

function createLicenseWindow() {
    if (licenseWindow && !licenseWindow.isDestroyed()) {
        if (licenseWindow.isMinimized()) licenseWindow.restore();
        licenseWindow.show();
        licenseWindow.focus();
        licenseWindow.setAlwaysOnTop(true);
        licenseWindow.moveTop();
        return licenseWindow;
    }

    // 阶段二发现授权过期弹出激活弹窗时，先取消启动窗口置顶，避免启动窗遮挡激活弹窗
    if (startupWindow && !startupWindow.isDestroyed()) {
        startupWindow.setAlwaysOnTop(false);
        updateStartupProgress(40, '等待授权激活', '检测到 License 尚未激活或已过期，请在授权激活窗口中完成激活…', '阶段 2/2 · 等待授权');
    }

    const licenseArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const licenseWidth = Math.min(1040, Math.max(1, licenseArea.width - 32));
    const licenseHeight = Math.min(740, Math.max(1, licenseArea.height - 32));
    licenseWindow = new BrowserWindow({
        width: licenseWidth,
        height: licenseHeight,
        minWidth: Math.min(560, licenseWidth),
        minHeight: Math.min(480, licenseHeight),
        x: Math.round(licenseArea.x + (licenseArea.width - licenseWidth) / 2),
        y: Math.round(licenseArea.y + (licenseArea.height - licenseHeight) / 2),
        backgroundColor: '#090e17',
        show: false,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        title: 'Dragon Platform - 软件授权激活 / License Activation',
        icon: getAppIconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'desktop-license-preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    // 右键上下文菜单：支持在输入框等位置快速粘贴、剪切、复制
    licenseWindow.webContents.on('context-menu', (_e, params) => {
        if (!licenseWindow || licenseWindow.isDestroyed()) return;
        const menuTemplate = [];
        if (params.isEditable) {
            menuTemplate.push(
                { role: 'undo', label: '撤销 / Undo' },
                { role: 'redo', label: '重做 / Redo' },
                { type: 'separator' },
                { role: 'cut', label: '剪切 / Cut' },
                { role: 'copy', label: '复制 / Copy' },
                { role: 'paste', label: '粘贴 / Paste' },
                { role: 'selectAll', label: '全选 / Select All' }
            );
        } else {
            menuTemplate.push(
                { role: 'copy', label: '复制 / Copy' },
                { role: 'selectAll', label: '全选 / Select All' }
            );
        }
        const menu = Menu.buildFromTemplate(menuTemplate);
        menu.popup({ window: licenseWindow });
    });

    licenseWindow.once('ready-to-show', () => {
        if (!licenseWindow || licenseWindow.isDestroyed()) return;
        licenseWindow.show();
        licenseWindow.focus();
        licenseWindow.setAlwaysOnTop(true);
        licenseWindow.moveTop();
    });

    licenseWindow.on('closed', () => {
        licenseWindow = null;
        if (licenseActivationResolve) {
            licenseActivationResolve(false);
            licenseActivationResolve = null;
        }
    });

    // 当启动窗口被点击时，如果授权窗口正在等待激活，自动将焦点还给授权窗口
    if (startupWindow && !startupWindow.isDestroyed()) {
        const onStartupFocus = () => {
            if (licenseWindow && !licenseWindow.isDestroyed()) {
                licenseWindow.focus();
            }
        };
        startupWindow.on('focus', onStartupFocus);
        licenseWindow.once('closed', () => {
            if (startupWindow && !startupWindow.isDestroyed()) {
                startupWindow.removeListener('focus', onStartupFocus);
            }
        });
    }

    licenseWindow.loadFile(path.join(__dirname, 'frontend/pages/desktop-license-activation.html'));
    return licenseWindow;
}

function waitForLicenseActivation() {
    createLicenseWindow();
    return new Promise(resolve => { licenseActivationResolve = resolve; });
}

// 本机设备指纹：每次启动现场采集（不缓存），授权判断前必须就绪
let desktopMachineIdentityPromise = null;
function ensureDesktopMachineIdentity() {
    if (!desktopMachineIdentityPromise) {
        desktopMachineIdentityPromise = getDesktopMachineIdentity({ fallbackDir: userDataPath })
            .then(identity => {
                desktopLicenseClient.setMachineIdentity(identity);
                console.log(`[Electron] Machine identity ready (${identity.source}, signals: ${identity.signals.join(', ')})`);
                return identity;
            });
    }
    return desktopMachineIdentityPromise;
}

function getPublicMachineInfo() {
    const identity = desktopLicenseClient.getMachineIdentity();
    return identity ? { machineCode: identity.machineCode, host: identity.host, platform: identity.platform, source: identity.source } : null;
}

function copyMachineCodeToClipboard() {
    const info = getPublicMachineInfo();
    if (!info) return;
    clipboard.writeText(info.machineCode);
    showTrayBalloon('已复制本机机器码', '请将机器码发送给管理员，用于签发或续期绑定本机的 License。');
}

// ── 一键申请 License：待审批期间定期查询；激活窗口打开时 15 秒一次，否则 60 秒一次 ──
let licenseRequestTimer = null;
let licenseRequestPolling = false;

function sendLicenseRequestUpdate(payload) {
    if (licenseWindow && !licenseWindow.isDestroyed() && !licenseWindow.webContents.isDestroyed()) {
        licenseWindow.webContents.send('desktop-license:request-update', payload);
    }
}

function finishLicenseActivation() {
    const resolve = licenseActivationResolve;
    licenseActivationResolve = null;
    stopLicenseRequestPolling();
    setTimeout(() => {
        if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
        if (startupWindow && !startupWindow.isDestroyed()) {
            startupWindow.setAlwaysOnTop(true);
            startupWindow.show();
            startupWindow.focus();
        }
        if (resolve) resolve(true);
    }, 500);
}

async function pollLicenseRequestOnce() {
    if (licenseRequestPolling) return null;
    licenseRequestPolling = true;
    try {
        const result = await desktopLicenseClient.pollLicenseRequest();
        if (result.license && result.license.valid) {
            desktopLicenseStatus = result.license;
            refreshTrayMenu();
        }
        sendLicenseRequestUpdate(result);
        if (result.license && result.license.valid) {
            finishLicenseActivation();
        } else if (!result.request || result.request.status !== 'pending') {
            stopLicenseRequestPolling();
        }
        return result;
    } finally {
        licenseRequestPolling = false;
    }
}

function scheduleLicenseRequestPolling() {
    stopLicenseRequestPolling();
    const request = desktopLicenseClient.getLicenseRequest();
    if (!request || request.status !== 'pending') return;
    const interval = licenseWindow && !licenseWindow.isDestroyed() ? 15000 : 60000;
    licenseRequestTimer = setTimeout(async () => {
        licenseRequestTimer = null;
        await pollLicenseRequestOnce().catch(error => console.warn('[Electron] License request poll failed:', error.message || error));
        scheduleLicenseRequestPolling();
    }, interval);
    licenseRequestTimer.unref?.();
}

function stopLicenseRequestPolling() {
    if (licenseRequestTimer) clearTimeout(licenseRequestTimer);
    licenseRequestTimer = null;
}

async function ensureDesktopLicense() {
    await ensureDesktopMachineIdentity();
    desktopLicenseStatus = await desktopLicenseClient.validateStored();
    if (desktopLicenseStatus.valid) {
        desktopLicenseClient.clearLicenseRequest();
        return true;
    }
    // 上次启动提交过申请：先查一次，管理员已批准则直接激活，不再弹激活窗口；否则在窗口中恢复申请状态并继续定期查询
    if (desktopLicenseClient.getLicenseRequest()) {
        const result = await pollLicenseRequestOnce().catch(() => null);
        if (result && result.license && result.license.valid) return true;
    }
    const activation = waitForLicenseActivation();
    scheduleLicenseRequestPolling();
    return activation;
}

function registerDesktopLicenseIpcHandlers() {
    ipcMain.handle('desktop-license:get-state', async () => {
        await ensureDesktopMachineIdentity().catch(() => null);
        return { ...desktopLicenseStatus, machine: getPublicMachineInfo() };
    });
    ipcMain.handle('desktop-license:activate', async (event, rawToken) => {
        const token = String(rawToken || '').trim();
        await ensureDesktopMachineIdentity();
        desktopLicenseStatus = await desktopLicenseClient.validate(token, {
            onProgress: (progress) => {
                try {
                    if (event && event.sender && !event.sender.isDestroyed()) {
                        event.sender.send('desktop-license:progress', progress);
                    }
                } catch (_) {}
            }
        });
        if (desktopLicenseStatus.valid) {
            desktopLicenseClient.clearLicenseRequest();
            finishLicenseActivation();
        }
        return desktopLicenseStatus;
    });
    ipcMain.handle('desktop-license:request-info', async () => {
        await ensureDesktopMachineIdentity().catch(() => null);
        const onlineAvailable = await desktopLicenseClient.probeRequestService();
        if (!onlineAvailable) console.warn(`[Electron] License request service unreachable: ${desktopLicenseClient.getLastProbeError()}`);
        return { onlineAvailable, request: desktopLicenseClient.getLicenseRequest() };
    });
    ipcMain.handle('desktop-license:request-submit', async (_event, form = {}) => {
        try {
            await ensureDesktopMachineIdentity();
            const request = await desktopLicenseClient.submitLicenseRequest({
                applicantName: form.applicantName,
                applicantNote: form.applicantNote,
                clientVersion: app.getVersion()
            });
            scheduleLicenseRequestPolling();
            return { ok: true, request };
        } catch (error) {
            return { ok: false, code: error.code || 'REQUEST_FAILED', error: error.message };
        }
    });
    ipcMain.handle('desktop-license:request-refresh', async () => {
        const result = await pollLicenseRequestOnce().catch(error => ({ error: error.code || 'REQUEST_FAILED' }));
        scheduleLicenseRequestPolling();
        return result || { request: desktopLicenseClient.getLicenseRequest() };
    });
    ipcMain.handle('desktop-license:request-cancel', async () => {
        stopLicenseRequestPolling();
        await desktopLicenseClient.cancelLicenseRequest();
        return { ok: true };
    });
    ipcMain.handle('desktop-license:quit', () => {
        isQuitting = true;
        app.quit();
        return true;
    });
}

function startDesktopLicenseRefresh() {
    if (desktopLicenseRefreshTimer) clearInterval(desktopLicenseRefreshTimer);
    desktopLicenseRefreshTimer = setInterval(async () => {
        const previousValid = desktopLicenseStatus.valid;
        desktopLicenseStatus = await desktopLicenseClient.validateStored();
        refreshTrayMenu();
        if (previousValid && !desktopLicenseStatus.valid) {
            dialog.showMessageBox({
                type: 'warning',
                title: 'Tools Platform License',
                message: '当前 License 已失效',
                detail: '请联系管理员续期或恢复授权，然后重新启动程序。'
            });
        }
    }, 10 * 60 * 1000);
    desktopLicenseRefreshTimer.unref?.();
}

function readLaunchState() {
    try {
        if (!fs.existsSync(launchStatePath)) return {};
        return JSON.parse(fs.readFileSync(launchStatePath, 'utf-8'));
    } catch (err) {
        console.warn('[Electron] Failed to read launch state:', err.message);
        return {};
    }
}

function writeLaunchState(state) {
    try {
        fs.mkdirSync(path.dirname(launchStatePath), { recursive: true });
        fs.writeFileSync(launchStatePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
        console.warn('[Electron] Failed to write launch state:', err.message);
    }
}

function prepareLaunchExperience() {
    const state = readLaunchState();
    const currentVersion = app.getVersion();
    const previousVersion = state.lastSeenVersion || '';
    const launchKind = previousVersion
        ? (previousVersion === currentVersion ? 'normal' : 'updated')
        : 'first';

    const nextState = {
        ...state,
        lastSeenVersion: currentVersion,
        lastLaunchAt: new Date().toISOString(),
        openInternalBrowser: false,
        openSystemBrowserOnSpecialLaunch: state.openSystemBrowserOnSpecialLaunch !== false
    };
    writeLaunchState(nextState);

    return {
        kind: launchKind,
        previousVersion,
        currentVersion,
        shouldShowWelcome: launchKind !== 'normal',
        shouldOpenSystemBrowser: true
    };
}

function buildLaunchUrl(port, launchExperience) {
    const url = new URL(`http://127.0.0.1:${port}/`);
    if (launchExperience.shouldShowWelcome) {
        url.searchParams.set('welcome', launchExperience.kind);
        url.searchParams.set('version', launchExperience.currentVersion);
        if (launchExperience.previousVersion) {
            url.searchParams.set('from', launchExperience.previousVersion);
        }
    }
    return url.toString();
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function showTrayBalloon(title, content) {
    if (!tray || process.platform !== 'win32') return;
    try {
        tray.displayBalloon({
            title,
            content,
            iconType: 'info',
            noSound: true
        });
    } catch (err) {
        console.warn('[Electron] Failed to show tray balloon:', err.message || err);
    }
}

function formatUpdaterError(err) {
    const raw = err && err.message ? err.message : String(err || '');
    const statusMatch = raw.match(/\b(?:HttpError|HTTP|status(?: code)?)[^\d]{0,12}(\d{3})\b/i);
    const statusCode = statusMatch ? statusMatch[1] : '';
    const hasHtml = /<!doctype html|<html[\s>]|<body[\s>]/i.test(raw);
    const isGitHub = /github\.com|api\.github\.com/i.test(raw);

    if (statusCode === '502' && isGitHub) {
        return {
            message: 'GitHub 更新服务暂时不可用，请稍后重试。',
            detail: 'GitHub 返回了 502 错误页，当前发布包通常没有问题。可过几分钟再点“检查更新”。'
        };
    }
    if (statusCode === '404' || /Cannot find latest(?:-mac)?\.yml/i.test(raw)) {
        return {
            message: '当前已是最新版本',
            detail: '云端暂未发现更新的发行版本。'
        };
    }
    if (hasHtml && isGitHub) {
        return {
            message: statusCode
                ? `GitHub 更新接口返回异常页面（HTTP ${statusCode}），请稍后重试。`
                : 'GitHub 更新接口返回异常页面，请稍后重试。',
            detail: '已隐藏 GitHub 返回的 HTML 错误页内容，避免弹窗过长。'
        };
    }
    if (/Unable to find latest version on GitHub/i.test(raw)) {
        return {
            message: '暂时无法获取 GitHub 最新版本信息，请稍后重试。',
            detail: statusCode ? `GitHub HTTP ${statusCode}` : raw.slice(0, 500)
        };
    }
    const cleanMsg = raw.split(/[\r\n]/)[0].slice(0, 60);
    return {
        message: cleanMsg || '检查更新失败',
        detail: raw.length > 500 ? `${raw.slice(0, 500)}...` : raw
    };
}

function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function buildDownloadProgressText() {
    const status = latestDownloadProgress || updateStatus || {};
    const percent = Math.max(0, Math.min(100, Math.round(Number(status.percent ?? status.progress) || 0)));
    const transferred = formatBytes(status.transferred);
    const total = formatBytes(status.total);
    const speed = formatBytes(status.bytesPerSecond);
    const parts = [`已下载 ${percent}%`];
    if (transferred && total) parts.push(`${transferred} / ${total}`);
    if (speed) parts.push(`${speed}/s`);
    return parts.join(' · ');
}

function stopUpdateProgressBalloons(finalTitle, finalContent) {
    latestDownloadProgress = null;
    updateBalloonMilestonesShown = new Set();
    if (finalTitle && finalContent) {
        showTrayBalloon(finalTitle, finalContent);
    }
}

function startUpdateProgressBalloons() {
    stopUpdateProgressBalloons();
    updateBalloonMilestonesShown = new Set(['start']);
    showTrayBalloon('Tools Platform 更新', '开始下载更新。可在“查看实时日志/更新进度”窗口查看实时进度。');
}

function maybeShowDownloadMilestoneBalloon(progress) {
    const percent = Math.max(0, Math.min(100, Math.round(Number(progress && progress.percent) || 0)));
    const milestone = [25, 50, 75].find((value) => percent >= value && !updateBalloonMilestonesShown.has(value));
    if (!milestone) return;
    updateBalloonMilestonesShown.add(milestone);
    showTrayBalloon('Tools Platform 更新下载中', buildDownloadProgressText());
}

function broadcastUpdateStatus(patch = {}) {
    updateStatus = {
        ...updateStatus,
        ...patch,
        version: app.getVersion(),
        updatedAt: new Date().toISOString()
    };

    BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
            win.webContents.send('updater:status', updateStatus);
        }
    });

    writeRuntimeStatusSnapshot();
    refreshTrayMenu();

    return updateStatus;
}

function setupAutoUpdater() {
    autoUpdater.on('checking-for-update', () => {
        broadcastUpdateStatus({
            state: 'checking',
            message: '正在检查更新...',
            progress: 0
        });
    });

    autoUpdater.on('update-available', (info) => {
        updateInfo = info;
        updateDownloaded = false;
        broadcastUpdateStatus({
            state: 'available',
            latestVersion: info.version,
            message: `发现新版本 ${info.version}`,
            progress: 0
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        updateInfo = info;
        updateDownloaded = false;
        stopUpdateProgressBalloons();
        broadcastUpdateStatus({
            state: 'not-available',
            latestVersion: info.version,
            message: '当前已是最新版本',
            progress: 0
        });
    });

    autoUpdater.on('download-progress', (progress) => {
        latestDownloadProgress = progress || null;
        maybeShowDownloadMilestoneBalloon(progress);
        broadcastUpdateStatus({
            state: 'downloading',
            message: `正在下载更新 ${Math.round(progress.percent || 0)}%`,
            progress: Math.round(progress.percent || 0),
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        updateInfo = info;
        updateDownloaded = true;
        stopUpdateProgressBalloons('Tools Platform 更新已下载', '更新已下载完成，可在托盘菜单中选择“重启并安装更新”。');
        broadcastUpdateStatus({
            state: 'downloaded',
            latestVersion: info.version,
            message: '更新已下载，重启后生效',
            progress: 100
        });
    });

    autoUpdater.on('error', (err) => {
        const formatted = formatUpdaterError(err);
        stopUpdateProgressBalloons('Tools Platform 更新失败', formatted.message);
        broadcastUpdateStatus({
            state: 'error',
            message: formatted.message,
            detail: formatted.detail,
            progress: 0
        });
    });
}

function getPortableUpdateStatus() {
    return broadcastUpdateStatus({
        state: 'portable-manual',
        message: '绿色版不自动安装更新，请从 GitHub Releases 下载新版 EXE',
        detail: latestReleaseUrl,
        progress: 0
    });
}

function openLatestReleasePage() {
    return shell.openExternal(latestReleaseUrl).catch((err) => {
        const message = err && err.message ? err.message : String(err);
        broadcastUpdateStatus({
            state: 'error',
            message: '无法打开 GitHub Releases',
            detail: message,
            progress: 0
        });
    });
}

function registerUpdaterIpcHandlers() {
    ipcMain.handle('updater:get-version', () => ({
        version: app.getVersion(),
        packaged: app.isPackaged,
        portable: isPortableWindows
    }));

    ipcMain.handle('updater:get-status', () => updateStatus);

    ipcMain.handle('updater:check', async () => {
        if (isPortableWindows) {
            return getPortableUpdateStatus();
        }
        if (!app.isPackaged) {
            return broadcastUpdateStatus({
                state: 'dev-unavailable',
                message: '开发模式不支持自动更新',
                progress: 0
            });
        }

        try {
            await autoUpdater.checkForUpdates();
            return updateStatus;
        } catch (err) {
            const formatted = formatUpdaterError(err);
            return broadcastUpdateStatus({
                state: 'error',
                message: formatted.message,
                detail: formatted.detail,
                progress: 0
            });
        }
    });

    ipcMain.handle('updater:download', async () => {
        if (isPortableWindows) {
            await openLatestReleasePage();
            return getPortableUpdateStatus();
        }
        if (!app.isPackaged) {
            return broadcastUpdateStatus({
                state: 'dev-unavailable',
                message: '开发模式不支持自动更新',
                progress: 0
            });
        }
        if (!updateInfo || updateStatus.state !== 'available') {
            return broadcastUpdateStatus({
                message: '请先检查并确认有可用更新'
            });
        }

        try {
            broadcastUpdateStatus({
                state: 'downloading',
                message: '正在准备下载更新...',
                progress: 0
            });
            startUpdateProgressBalloons();
            await autoUpdater.downloadUpdate();
            return updateStatus;
        } catch (err) {
            const formatted = formatUpdaterError(err);
            stopUpdateProgressBalloons('Tools Platform 更新失败', formatted.message);
            return broadcastUpdateStatus({
                state: 'error',
                message: formatted.message,
                detail: formatted.detail,
                progress: 0
            });
        }
    });

    ipcMain.handle('updater:install', () => {
        if (isPortableWindows) {
            openLatestReleasePage();
            return getPortableUpdateStatus();
        }
        if (!updateDownloaded) {
            return broadcastUpdateStatus({
                message: '更新尚未下载完成'
            });
        }

        broadcastUpdateStatus({
            state: 'installing',
            message: '正在重启并安装更新...',
            progress: 100
        });
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
        return updateStatus;
    });
}

function registerDesktopIpcHandlers() {
    ipcMain.handle('desktop:get-runtime-snapshot', () => ({
        baseUrl: getAppBaseUrl(),
        version: app.getVersion(),
        packaged: app.isPackaged,
        updateStatus,
        logs: getRecentLogFiles().map((item) => ({
            label: item.label,
            content: item.content !== undefined ? item.content : readTail(item.filePath)
        }))
    }));

    ipcMain.handle('desktop:open-logs-folder', () => {
        openLogsFolder();
        return true;
    });
}

function scheduleStartupUpdateCheck() {
    if (!app.isPackaged || isPortableWindows) return;
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
            broadcastUpdateStatus({
                state: 'error',
                message: err && err.message ? err.message : String(err),
                progress: 0
            });
        });
    }, 3500);
}

function registerDownloadHandler() {
    if (downloadHandlerRegistered) return;
    downloadHandlerRegistered = true;

    session.defaultSession.on('will-download', (event, item, webContents) => {
        const ownerWindow = BrowserWindow.fromWebContents(webContents) || BrowserWindow.getFocusedWindow() || undefined;
        const filename = item.getFilename();
        const savePath = dialog.showSaveDialogSync(ownerWindow, {
            title: '保存文件',
            defaultPath: path.join(app.getPath('downloads'), filename),
            buttonLabel: '保存'
        });

        if (!savePath) {
            event.preventDefault();
            return;
        }

        item.setSavePath(savePath);
        item.once('done', async (_event, state) => {
            if (state === 'completed') {
                const result = await dialog.showMessageBox(ownerWindow, {
                    type: 'info',
                    title: '下载完成',
                    message: '文件已保存',
                    detail: savePath,
                    buttons: ['打开所在文件夹', '确定'],
                    defaultId: 0,
                    cancelId: 1
                });

                if (result.response === 0) {
                    shell.showItemInFolder(savePath);
                }
                return;
            }

            if (state === 'interrupted') {
                dialog.showErrorBox('下载失败', `文件下载中断：${filename}`);
            }
        });
    });
}

function createTray() {
    const iconPath = getAppIconPath();
    try {
        // macOS does not decode ICO files; keep the menu bar icon at its native size.
        const icon = process.platform === 'darwin'
            ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
            : iconPath;
        tray = new Tray(icon);
        tray.setToolTip('Tools Platform 本地服务');
        // On macOS setContextMenu handles clicks; opening a browser here would also
        // launch a tab whenever the user only wants to operate the menu.
        if (process.platform !== 'darwin') {
            tray.on('click', () => openAppPath('/'));
            tray.on('double-click', () => openAppPath('/'));
        }
        refreshTrayMenu();
    } catch (e) {
        console.warn('[Electron] Failed to create Tray:', e);
    }
}

function getAppBaseUrl() {
    return localPort ? `http://127.0.0.1:${localPort}` : null;
}

function openAppPath(pathname = '/') {
    const baseUrl = getAppBaseUrl();
    if (!baseUrl) {
        dialog.showMessageBox({
            type: 'warning',
            title: '本地服务启动中',
            message: 'Tools Platform 本地服务还在启动，请稍后再试。'
        });
        return;
    }
    const target = new URL(pathname, baseUrl).toString();
    shell.openExternal(target).catch((err) => {
        dialog.showErrorBox('打开失败', err.message || String(err));
    });
}

function shouldShowStartupWindow() {
    return isPortableWindows || process.env.TOOLS_SHOW_STARTUP_WINDOW === '1';
}

// 绿色版阶段 1 的 NSIS 启动图会一直保留，直到看到这个标记文件才销毁（见 scripts/patch-portable-nsis.js），
// 从而让两段启动画面重叠交接，不出现空白期。
const STARTUP_HANDOFF_MARKER = '.startup-window-visible';
const STARTUP_WINDOW_SIZE = { width: 620, height: 340 };

function signalSplashHandoff() {
    if (!isPortableWindows) return;
    try {
        fs.writeFileSync(path.join(path.dirname(process.execPath), STARTUP_HANDOFF_MARKER), String(Date.now()));
    } catch (err) {
        console.warn('[Electron] Failed to signal splash handoff:', err.message || err);
    }
}

// NSIS 的 BgImage 按整屏（而非工作区）居中，且以 96 DPI 渲染后由系统缩放，
// 因此用主屏 bounds 居中、DIP 尺寸与 BMP 像素一致，阶段 2 窗口即可与启动图严丝合缝地重叠。
function getStartupWindowBounds() {
    const { screen } = require('electron');
    const { bounds } = screen.getPrimaryDisplay();
    return {
        ...STARTUP_WINDOW_SIZE,
        x: Math.round(bounds.x + (bounds.width - STARTUP_WINDOW_SIZE.width) / 2),
        y: Math.round(bounds.y + (bounds.height - STARTUP_WINDOW_SIZE.height) / 2)
    };
}

function createStartupWindow() {
    if (!shouldShowStartupWindow() || startupWindow && !startupWindow.isDestroyed()) return startupWindow;
    startupWindowLoaded = false;
    startupWindowCreatedAt = Date.now();
    startupWindow = new BrowserWindow({
        ...getStartupWindowBounds(),
        useContentSize: true,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        hasShadow: false,
        backgroundColor: '#00000000',
        icon: getAppIconPath(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });
    const showWindow = () => {
        if (startupWindow && !startupWindow.isDestroyed() && !startupWindow.isVisible()) {
            startupWindow.show();
        }
    };
    // 首帧已绘制后再通知 NSIS 撤下阶段 1 启动图
    startupWindow.once('show', () => setTimeout(signalSplashHandoff, 60));
    startupWindow.once('ready-to-show', showWindow);
    // 保护性保底：防止在特定 Windows 驱动/透明模式下 ready-to-show 滞后，120ms 内强制唤起呈现
    setTimeout(showWindow, 120);
    startupWindow.webContents.once('did-finish-load', () => {
        startupWindowLoaded = true;
        renderStartupProgress();
    });
    startupWindow.on('closed', () => {
        startupWindow = null;
        startupWindowLoaded = false;
    });
    startupWindow.loadFile(path.join(__dirname, 'frontend/pages/startup.html')).catch((err) => {
        console.warn('[Electron] Failed to load startup window:', err.message || err);
        signalSplashHandoff();
    });
    return startupWindow;
}

function renderStartupProgress() {
    const win = startupWindow;
    if (!startupWindowLoaded || !win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    const payload = JSON.stringify(startupProgressState).replace(/</g, '\\u003c');
    win.webContents.executeJavaScript(`window.setStartupProgress && window.setStartupProgress(${payload})`)
        .catch(() => {});
}

function updateStartupProgress(percent, title, detail, stage, finished = false, state = 'running') {
    startupProgressState = { percent, title, detail, stage, finished, state };
    renderStartupProgress();
}

function closeStartupWindow(success = true) {
    const win = startupWindow;
    signalSplashHandoff();
    if (!win || win.isDestroyed()) return;
    if (success) {
        updateStartupProgress(100, '工作空间已就绪', '正在打开 Dragon Platform 主页面…', '阶段 2/2 · 启动完成', true);
    } else {
        win.webContents.executeJavaScript('document.body.classList.add("is-finished")').catch(() => {});
    }
    const minimumVisibleMs = 1200;
    const closeDelay = Math.max(360, minimumVisibleMs - (Date.now() - startupWindowCreatedAt));
    setTimeout(() => {
        if (win && !win.isDestroyed()) win.close();
    }, closeDelay);
}

function probeLocalHealth(port) {
    return new Promise((resolve) => {
        const request = http.get({
            hostname: '127.0.0.1',
            port,
            path: '/api/health',
            timeout: 1200
        }, (response) => {
            response.resume();
            resolve(response.statusCode === 200);
        });
        request.on('timeout', () => {
            request.destroy();
            resolve(false);
        });
        request.on('error', () => resolve(false));
    });
}

async function waitForLocalServer(port, timeoutMs = 45000) {
    const startedAt = Date.now();
    let attempt = 0;
    while (Date.now() - startedAt < timeoutMs) {
        attempt += 1;
        if (await probeLocalHealth(port)) return;
        const elapsed = Date.now() - startedAt;
        // 紧接"服务加载"(80%) 之后渐近逼近 94%，保证进度只进不退
        const progress = 80 + 14 * (1 - Math.exp(-elapsed / 6000));
        const phase = elapsed < 2500
            ? {
                title: '正在初始化数据存储',
                detail: '检查配置、数据库与历史数据迁移…',
                stage: '阶段 2/2 · 数据初始化'
            }
            : elapsed < 8000
                ? {
                    title: '正在同步系统工具',
                    detail: '核对内置工具、注册信息与用户数据…',
                    stage: '阶段 2/2 · 工具同步'
                }
                : {
                    title: '正在等待本地服务',
                    detail: '服务即将就绪，请保持当前窗口开启…',
                    stage: '阶段 2/2 · 健康检查'
                };
        updateStartupProgress(progress, phase.title, phase.detail, phase.stage);
        await new Promise(resolve => setTimeout(resolve, 260));
    }
    throw new Error(`本地服务在 ${Math.round(timeoutMs / 1000)} 秒内未就绪`);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function readTail(filePath, maxBytes = 90000) {
    try {
        if (!fs.existsSync(filePath)) return '';
        const stat = fs.statSync(filePath);
        const start = Math.max(0, stat.size - maxBytes);
        const buffer = Buffer.alloc(stat.size - start);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, buffer.length, start);
        fs.closeSync(fd);
        return buffer.toString('utf-8');
    } catch (err) {
        return `[读取失败] ${filePath}\n${err.message || err}`;
    }
}

function getRecentLogFiles() {
    const logRoots = [
        { label: '运行日志', root: electronLogRoot },
        { label: '项目日志', root: path.join(__dirname, 'backend/logs') }
    ];
    const files = [];
    logRoots.forEach(({ label, root }) => {
        try {
            if (fs.existsSync(root)) {
                const dayDirs = fs.readdirSync(root)
                    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
                    .sort()
                    .reverse()
                    .slice(0, 3);
                dayDirs.forEach((day) => {
                    ['error.log', 'out.log'].forEach((name) => {
                        const filePath = path.join(root, day, name);
                        if (fs.existsSync(filePath)) files.push({ label: `${label}/${day}/${name}`, filePath });
                    });
                });
                ['error.log', 'out.log'].forEach((name) => {
                    const filePath = path.join(root, name);
                    if (fs.existsSync(filePath)) files.push({ label: `${label}/${name}`, filePath });
                });
            }
        } catch (err) {
            files.push({ label: `${label}目录读取失败`, content: err.message || String(err) });
        }
    });
    return files;
}

function writeRuntimeStatusSnapshot() {
    try {
        fs.mkdirSync(electronLogRoot, { recursive: true });
        const payload = {
            baseUrl: getAppBaseUrl(),
            version: app.getVersion(),
            packaged: app.isPackaged,
            updateStatus,
            commandPath: runtimeCommandPath,
            logs: getRecentLogFiles()
                .filter((item) => item.filePath)
                .map((item) => ({
                    label: item.label,
                    filePath: item.filePath
                })),
            updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(runtimeStatusPath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
        console.warn('[Electron] Failed to write runtime status:', err.message || err);
    }
}

function readRuntimeCommand() {
    try {
        if (!fs.existsSync(runtimeCommandPath)) return null;
        const text = fs.readFileSync(runtimeCommandPath, 'utf-8').replace(/^\uFEFF/, '');
        if (!text.trim()) return null;
        return JSON.parse(text);
    } catch (err) {
        console.warn('[Electron] Failed to read runtime command:', err.message || err);
        return null;
    }
}

async function handleRuntimeCommand(command) {
    if (!command || !command.action) return;
    const commandId = String(command.id || '');
    if (commandId && commandId === lastRuntimeCommandId) return;
    lastRuntimeCommandId = commandId || `${command.action}:${Date.now()}`;
    if (command.action === 'check-update') {
        await checkForUpdatesFromTray({ showDialog: false });
    } else if (command.action === 'download-update') {
        await downloadUpdateFromTray({ showDialog: false });
    } else if (command.action === 'install-update') {
        installUpdateFromTray();
    }
}

function startRuntimeCommandWatcher() {
    if (runtimeCommandTimer) return;
    const existingCommand = readRuntimeCommand();
    if (existingCommand && existingCommand.id) {
        lastRuntimeCommandId = String(existingCommand.id);
    }
    runtimeCommandTimer = setInterval(() => {
        const command = readRuntimeCommand();
        if (!command) return;
        handleRuntimeCommand(command).catch((err) => {
            console.warn('[Electron] Failed to handle runtime command:', err.message || err);
        });
    }, 1000);
}

function createLogWindow() {
    if (utilityWindow && !utilityWindow.isDestroyed()) {
        utilityWindow.focus();
    } else {
        utilityWindow = new BrowserWindow({
            width: 980,
            height: 720,
            minWidth: 760,
            minHeight: 520,
            title: 'Tools Platform 运行日志',
            autoHideMenuBar: true,
            icon: getAppIconPath(),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'electron-preload.js')
            }
        });
        utilityWindow.on('closed', () => {
            utilityWindow = null;
        });
    }

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Tools Platform 运行日志</title>
<style>
body{margin:0;background:#0f172a;color:#dbeafe;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;}
header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;background:rgba(15,23,42,.94);border-bottom:1px solid rgba(148,163,184,.25);backdrop-filter:blur(12px);}
h1{margin:0;font-size:18px;color:#f8fafc;}
.meta{font-size:12px;color:#93c5fd;margin-top:4px;}
button{border:1px solid rgba(96,165,250,.35);background:#1d4ed8;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;}
button:disabled{opacity:.45;cursor:not-allowed;}
.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;}
main{padding:18px 20px 28px;}
.status{border:1px solid rgba(34,211,238,.28);border-radius:12px;margin-bottom:16px;background:linear-gradient(135deg,rgba(8,47,73,.86),rgba(15,23,42,.72));padding:14px;}
.statusTop{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px;}
.statusTitle{font-size:14px;font-weight:800;color:#f8fafc;}
.statusMsg{font-size:12px;color:#bfdbfe;margin-top:3px;}
.pill{font-size:12px;color:#67e8f9;border:1px solid rgba(103,232,249,.28);border-radius:999px;padding:4px 9px;background:rgba(14,116,144,.25);}
.bar{height:9px;background:rgba(148,163,184,.18);border-radius:999px;overflow:hidden;border:1px solid rgba(148,163,184,.16);}
.bar span{display:block;height:100%;width:0;background:linear-gradient(90deg,#06b6d4,#3b82f6,#8b5cf6);box-shadow:0 0 18px rgba(34,211,238,.42);transition:width .25s ease;}
section{border:1px solid rgba(148,163,184,.22);border-radius:10px;margin-bottom:16px;overflow:hidden;background:rgba(15,23,42,.62);}
h2{margin:0;padding:10px 12px;font-size:13px;color:#67e8f9;background:rgba(30,41,59,.85);border-bottom:1px solid rgba(148,163,184,.18);}
pre{margin:0;padding:12px;max-height:340px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e2e8f0;}
.empty{border:1px dashed rgba(148,163,184,.28);border-radius:10px;padding:18px;color:#94a3b8;}
</style>
</head>
<body>
<header>
<div>
<h1>Tools Platform 运行日志</h1>
<div class="meta" id="runtimeMeta">加载中...</div>
</div>
<div class="actions">
<button id="checkUpdateButton">检查更新</button>
<button id="downloadUpdateButton">下载更新</button>
<button id="installUpdateButton">安装更新</button>
<button id="openLogsButton">打开日志目录</button>
<button id="refreshButton">刷新</button>
</div>
</header>
<main>
<div class="status">
<div class="statusTop">
<div>
<div class="statusTitle">更新状态</div>
<div class="statusMsg" id="updateMessage">等待检查更新</div>
</div>
<div class="pill" id="updateState">idle</div>
</div>
<div class="bar"><span id="updateProgress"></span></div>
</div>
<div id="logs"><div class="empty">正在读取日志...</div></div>
</main>
<script>
(function () {
    const runtimeMeta = document.getElementById('runtimeMeta');
    const updateMessage = document.getElementById('updateMessage');
    const updateState = document.getElementById('updateState');
    const updateProgress = document.getElementById('updateProgress');
    const logs = document.getElementById('logs');
    const refreshButton = document.getElementById('refreshButton');
    const openLogsButton = document.getElementById('openLogsButton');
    const checkUpdateButton = document.getElementById('checkUpdateButton');
    const downloadUpdateButton = document.getElementById('downloadUpdateButton');
    const installUpdateButton = document.getElementById('installUpdateButton');

    function setText(node, value) {
        node.textContent = value == null ? '' : String(value);
    }

    function renderLogs(items) {
        logs.innerHTML = '';
        if (!items || !items.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = '未发现日志文件。';
            logs.appendChild(empty);
            return;
        }
        items.forEach((item) => {
            const section = document.createElement('section');
            const title = document.createElement('h2');
            const pre = document.createElement('pre');
            title.textContent = item.label || '日志';
            pre.textContent = item.content || '暂无内容';
            section.appendChild(title);
            section.appendChild(pre);
            logs.appendChild(section);
        });
    }

    async function refreshSnapshot() {
        if (!window.ToolsDesktop || !window.ToolsDesktop.getRuntimeSnapshot) {
            setText(runtimeMeta, '当前窗口缺少桌面桥接能力，请重启应用。');
            return;
        }
        const snapshot = await window.ToolsDesktop.getRuntimeSnapshot();
        const status = snapshot.updateStatus || {};
        setText(runtimeMeta, '本地服务：' + (snapshot.baseUrl || '启动中') + ' · 版本 v' + snapshot.version + ' · 每 2 秒自动刷新');
        setText(updateMessage, status.message || '等待检查更新');
        setText(updateState, status.state || 'idle');
        updateProgress.style.width = Math.max(0, Math.min(100, Number(status.progress) || 0)) + '%';
        const state = status.state || 'idle';
        checkUpdateButton.disabled = state === 'checking' || state === 'downloading' || state === 'installing';
        downloadUpdateButton.disabled = state !== 'available';
        installUpdateButton.disabled = state !== 'downloaded';
        renderLogs(snapshot.logs || []);
    }

    refreshButton.addEventListener('click', refreshSnapshot);
    openLogsButton.addEventListener('click', () => {
        if (window.ToolsDesktop && window.ToolsDesktop.openLogsFolder) window.ToolsDesktop.openLogsFolder();
    });
    checkUpdateButton.addEventListener('click', async () => {
        if (window.ToolsUpdater && window.ToolsUpdater.check) await window.ToolsUpdater.check();
        await refreshSnapshot();
    });
    downloadUpdateButton.addEventListener('click', async () => {
        if (window.ToolsUpdater && window.ToolsUpdater.download) await window.ToolsUpdater.download();
        await refreshSnapshot();
    });
    installUpdateButton.addEventListener('click', async () => {
        if (window.ToolsUpdater && window.ToolsUpdater.install) await window.ToolsUpdater.install();
    });
    refreshSnapshot();
    setInterval(refreshSnapshot, 2000);
})();
</script>
</body>
</html>`;

    utilityWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function openRuntimeStatusWindow() {
    if (process.platform === 'win32') {
        openNativeRuntimeWindow();
        return;
    }
    createLogWindow();
}

function openNativeRuntimeWindow() {
    try {
        writeRuntimeStatusSnapshot();
        const scriptPath = path.join(userDataPath, 'tools-platform-runtime-monitor.ps1');
        fs.writeFileSync(scriptPath, `\uFEFF${getNativeRuntimeMonitorScript()}`, 'utf-8');
        let stderr = '';
        let stdout = '';
        let settled = false;
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-STA',
            '-File',
            scriptPath,
            '-StatusPath',
            runtimeStatusPath
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: false
        });

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', (err) => {
            if (settled) return;
            settled = true;
            console.warn('[Electron] Failed to start native runtime window:', err.message || err);
            dialog.showMessageBox({
                type: 'warning',
                title: '原生窗口打开失败',
                message: 'Windows 原生日志窗口启动失败，将使用备用窗口显示。',
                detail: err.message || String(err)
            }).finally(createLogWindow);
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            if (code !== 0) {
                const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n\n') || `PowerShell exit code: ${code}`;
                console.warn('[Electron] Native runtime window exited early:', detail);
                dialog.showMessageBox({
                    type: 'warning',
                    title: '原生窗口打开失败',
                    message: 'Windows 原生日志窗口启动后立即退出，将使用备用窗口显示。',
                    detail
                }).finally(createLogWindow);
            }
        });
        setTimeout(() => {
            if (!settled) {
                settled = true;
            }
        }, 1800);
        return true;
    } catch (err) {
        console.warn('[Electron] Failed to open native runtime window:', err.message || err);
        dialog.showMessageBox({
            type: 'warning',
            title: '原生窗口打开失败',
            message: 'Windows 原生日志窗口打开失败，将使用备用窗口显示。',
            detail: err.message || String(err)
        }).finally(createLogWindow);
        return false;
    }
}

function getNativeRuntimeMonitorScript() {
    return String.raw`param(
    [Parameter(Mandatory=$true)][string]$StatusPath
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Normalize-LogText([string]$Text) {
    if ($null -eq $Text) { return "" }
    $ansiPattern = ([string][char]27) + "\[[0-9;?]*[ -/]*[@-~]"
    $clean = [regex]::Replace($Text, $ansiPattern, "")
    $clean = $clean -replace "(\S)(\[\d{4}-\d{2}-\d{2}T)", ('$1' + [Environment]::NewLine + '$2')
    $clean = $clean -replace "(\S)(\[\d{2}:\d{2}:\d{2}\])", ('$1' + [Environment]::NewLine + '$2')
    $clean = $clean -replace "(\S)(GET\s+/)", ('$1' + [Environment]::NewLine + '$2')
    $clean = $clean -replace "(\S)(POST\s+/)", ('$1' + [Environment]::NewLine + '$2')
    $clean = $clean -replace "(\S)(\[(?:DATA SOURCE|Electron|AI|UIVF12|SLA Upload)\])", ('$1' + [Environment]::NewLine + '$2')
    $clean = $clean -replace "\r?\n{3,}", ([Environment]::NewLine + [Environment]::NewLine)
    return $clean.Trim()
}

function Append-ColoredText([System.Windows.Forms.RichTextBox]$Box, [string]$Text, [System.Drawing.Color]$Color, [System.Drawing.FontStyle]$Style) {
    $start = $Box.TextLength
    $Box.AppendText($Text)
    $Box.Select($start, $Text.Length)
    $Box.SelectionColor = $Color
    $Box.SelectionFont = New-Object System.Drawing.Font($Box.Font, $Style)
    $Box.Select($Box.TextLength, 0)
}

function Append-LogLine([System.Windows.Forms.RichTextBox]$Box, [string]$Line) {
    if ([string]::IsNullOrWhiteSpace($Line)) {
        $Box.AppendText([Environment]::NewLine)
        return
    }
    $color = [System.Drawing.Color]::FromArgb(31, 41, 55)
    $style = [System.Drawing.FontStyle]::Regular
    if ($Line -match "ERROR|Error|failed|Failed|失败|Exception|HttpError| 5\d\d ") {
        $color = [System.Drawing.Color]::FromArgb(185, 28, 28)
        $style = [System.Drawing.FontStyle]::Bold
    } elseif ($Line -match "->\s*200|成功|downloaded|已下载") {
        $color = [System.Drawing.Color]::FromArgb(4, 120, 87)
    } elseif ($Line -match "\[DATA SOURCE\]|SQLITE|SQLite") {
        $color = [System.Drawing.Color]::FromArgb(29, 78, 216)
    } elseif ($Line -match "\[Electron\]|\[AI\]|\[UIVF12\]|\[SLA Upload\]") {
        $color = [System.Drawing.Color]::FromArgb(126, 34, 206)
    } elseif ($Line -match "->\s*30\d") {
        $color = [System.Drawing.Color]::FromArgb(180, 83, 9)
    }

    $timeMatch = [regex]::Match($Line, "^(\[\d{4}-\d{2}-\d{2}T[^\]]+\]|\[\d{2}:\d{2}:\d{2}\])")
    if ($timeMatch.Success) {
        Append-ColoredText $Box $timeMatch.Value ([System.Drawing.Color]::FromArgb(100, 116, 139)) ([System.Drawing.FontStyle]::Bold)
        Append-ColoredText $Box ($Line.Substring($timeMatch.Length) + [Environment]::NewLine) $color $style
    } else {
        Append-ColoredText $Box ($Line + [Environment]::NewLine) $color $style
    }
}

function Set-LogBoxText([System.Windows.Forms.RichTextBox]$Box, [string]$Text) {
    $Box.SuspendLayout()
    $Box.Clear()
    $lines = $Text -split "\r?\n"
    foreach ($line in $lines) {
        Append-LogLine $Box $line
    }
    $Box.SelectionStart = $Box.TextLength
    $Box.ScrollToCaret()
    $Box.ResumeLayout()
}

function Append-LogBoxText([System.Windows.Forms.RichTextBox]$Box, [string]$Text, [bool]$ScrollToEnd) {
    if ([string]::IsNullOrEmpty($Text)) { return }
    $Box.SuspendLayout()
    $lines = $Text -split "\r?\n"
    foreach ($line in $lines) {
        Append-LogLine $Box $line
    }
    if ($ScrollToEnd) {
        $Box.SelectionStart = $Box.TextLength
        $Box.ScrollToCaret()
    }
    $Box.ResumeLayout()
}

function Update-LogBoxText([System.Windows.Forms.RichTextBox]$Box, [string]$NextText) {
    $previousText = [string]$Box.AccessibleDescription
    if ($previousText -eq $NextText) { return }

    $wasAtEnd = ($Box.SelectionStart -ge [Math]::Max(0, $Box.TextLength - 2))
    if ($previousText -and $NextText.StartsWith($previousText)) {
        $delta = $NextText.Substring($previousText.Length)
        $Box.AccessibleDescription = $NextText
        Append-LogBoxText $Box $delta $wasAtEnd
        return
    }

    $Box.AccessibleDescription = $NextText
    Set-LogBoxText $Box $NextText
}

function Read-TailText([string]$Path, [int]$MaxChars) {
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    try {
        $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
        if ($text.Length -gt $MaxChars) { return Normalize-LogText ($text.Substring($text.Length - $MaxChars)) }
        return Normalize-LogText $text
    } catch {
        return "[Read failed] " + $Path + [Environment]::NewLine + $_.Exception.Message
    }
}

function Load-Snapshot {
    if (-not (Test-Path -LiteralPath $StatusPath)) { return $null }
    try {
        return Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Write-Command([string]$Action) {
    $snapshot = Load-Snapshot
    if ($null -eq $snapshot -or -not $snapshot.commandPath) {
        [System.Windows.Forms.MessageBox]::Show("Runtime command path is missing. Please refresh and try again.", "Tools Platform") | Out-Null
        return
    }
    try {
        $payload = @{
            id = ([DateTime]::UtcNow.Ticks.ToString())
            action = $Action
            createdAt = ([DateTime]::UtcNow.ToString("o"))
        } | ConvertTo-Json -Compress
        Set-Content -LiteralPath ([string]$snapshot.commandPath) -Value $payload -Encoding UTF8
        Render-Snapshot
    } catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Tools Platform") | Out-Null
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Tools Platform Runtime Monitor"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(1000, 720)
$form.MinimumSize = New-Object System.Drawing.Size(820, 560)
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Tools Platform Runtime Monitor"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(16, 14)
$form.Controls.Add($title)

$meta = New-Object System.Windows.Forms.Label
$meta.Text = "Loading runtime status..."
$meta.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$meta.AutoSize = $true
$meta.Location = New-Object System.Drawing.Point(18, 48)
$form.Controls.Add($meta)

$openFolder = New-Object System.Windows.Forms.Button
$openFolder.Text = "日志目录"
$openFolder.Size = New-Object System.Drawing.Size(82, 30)
$openFolder.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
$openFolder.Location = New-Object System.Drawing.Point(612, 16)
$form.Controls.Add($openFolder)

$checkUpdate = New-Object System.Windows.Forms.Button
$checkUpdate.Text = "检查更新"
$checkUpdate.Size = New-Object System.Drawing.Size(82, 30)
$checkUpdate.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
$checkUpdate.Location = New-Object System.Drawing.Point(700, 16)
$form.Controls.Add($checkUpdate)

$downloadUpdate = New-Object System.Windows.Forms.Button
$downloadUpdate.Text = "下载更新"
$downloadUpdate.Size = New-Object System.Drawing.Size(82, 30)
$downloadUpdate.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
$downloadUpdate.Location = New-Object System.Drawing.Point(788, 16)
$form.Controls.Add($downloadUpdate)

$installUpdate = New-Object System.Windows.Forms.Button
$installUpdate.Text = "安装更新"
$installUpdate.Size = New-Object System.Drawing.Size(82, 30)
$installUpdate.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
$installUpdate.Location = New-Object System.Drawing.Point(876, 16)
$form.Controls.Add($installUpdate)

$refresh = New-Object System.Windows.Forms.Button
$refresh.Text = "刷新"
$refresh.Size = New-Object System.Drawing.Size(60, 30)
$refresh.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
$refresh.Location = New-Object System.Drawing.Point(898, 50)
$form.Controls.Add($refresh)

$statusBox = New-Object System.Windows.Forms.GroupBox
$statusBox.Text = "Update Status"
$statusBox.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$statusBox.Location = New-Object System.Drawing.Point(18, 78)
$statusBox.Size = New-Object System.Drawing.Size(940, 92)
$statusBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$form.Controls.Add($statusBox)

$statusText = New-Object System.Windows.Forms.Label
$statusText.Text = "Waiting for update check"
$statusText.AutoSize = $true
$statusText.Location = New-Object System.Drawing.Point(16, 28)
$statusBox.Controls.Add($statusText)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(18, 56)
$progress.Size = New-Object System.Drawing.Size(900, 20)
$progress.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$progress.Minimum = 0
$progress.Maximum = 100
$statusBox.Controls.Add($progress)

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Location = New-Object System.Drawing.Point(18, 184)
$tabs.Size = New-Object System.Drawing.Size(940, 470)
$tabs.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$form.Controls.Add($tabs)

$lastLogKeys = ""

function Render-Snapshot {
    $snapshot = Load-Snapshot
    if ($null -eq $snapshot) {
        $meta.Text = "Runtime status file is not readable: " + $StatusPath
        return
    }
    $baseUrlText = "Starting"
    if ($snapshot.baseUrl) { $baseUrlText = [string]$snapshot.baseUrl }
    $meta.Text = "Local service: " + $baseUrlText + "    Version: v" + $snapshot.version + "    Refreshed: " + (Get-Date).ToString("HH:mm:ss")
    $up = $snapshot.updateStatus
    if ($null -ne $up) {
        $statusText.Text = "[" + $up.state + "] " + $up.message
        $state = [string]$up.state
        $checkUpdate.Enabled = ($state -ne "checking" -and $state -ne "downloading" -and $state -ne "installing")
        $downloadUpdate.Enabled = ($state -eq "available")
        $installUpdate.Enabled = ($state -eq "downloaded")
        $value = 0
        [int]::TryParse([string]$up.progress, [ref]$value) | Out-Null
        if ($value -lt 0) { $value = 0 }
        if ($value -gt 100) { $value = 100 }
        $progress.Value = $value
    }

    $logs = @($snapshot.logs)
    $keys = ($logs | ForEach-Object { $_.label + "|" + $_.filePath }) -join ";;"
    if ($keys -ne $script:lastLogKeys) {
        $tabs.TabPages.Clear()
        foreach ($log in $logs) {
            $page = New-Object System.Windows.Forms.TabPage
            $page.Text = $log.label
            $box = New-Object System.Windows.Forms.RichTextBox
            $box.ReadOnly = $true
            $box.ScrollBars = "Both"
            $box.WordWrap = $false
            $box.Dock = "Fill"
            $box.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
            $box.BackColor = [System.Drawing.Color]::FromArgb(252, 253, 255)
            $box.Font = New-Object System.Drawing.Font("Consolas", 9)
            $box.Tag = $log.filePath
            $box.AccessibleDescription = ""
            $page.Controls.Add($box)
            $tabs.TabPages.Add($page) | Out-Null
        }
        $script:lastLogKeys = $keys
    }

    foreach ($page in $tabs.TabPages) {
        if ($page.Controls.Count -gt 0) {
            $box = $page.Controls[0]
            $nextText = Read-TailText $box.Tag 120000
            Update-LogBoxText $box $nextText
        }
    }
}

$openFolder.Add_Click({
    $root = Split-Path -Parent $StatusPath
    if (Test-Path -LiteralPath $root) { Start-Process explorer.exe $root }
})
$refresh.Add_Click({ Render-Snapshot })
$checkUpdate.Add_Click({ Write-Command "check-update" })
$downloadUpdate.Add_Click({ Write-Command "download-update" })
$installUpdate.Add_Click({ Write-Command "install-update" })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Render-Snapshot })
$timer.Start()

Render-Snapshot
[void]$form.ShowDialog()
`;
}

function openLogsFolder() {
    const logRoot = electronLogRoot;
    fs.mkdirSync(logRoot, { recursive: true });
    shell.openPath(logRoot).catch((err) => {
        dialog.showErrorBox('打开日志目录失败', err.message || String(err));
    });
}

async function checkForUpdatesFromTray(options = {}) {
    const showDialog = options.showDialog !== false;
    if (isPortableWindows) {
        getPortableUpdateStatus();
        if (showDialog) await openLatestReleasePage();
        return;
    }
    if (!app.isPackaged) {
        broadcastUpdateStatus({
            state: 'dev-unavailable',
            message: '开发模式不支持自动更新',
            progress: 0
        });
        if (showDialog) {
            dialog.showMessageBox({
                type: 'info',
                title: '检查更新',
                message: '开发模式不支持自动更新。',
                detail: `当前开发版本：v${app.getVersion()}`
            });
        }
        return;
    }
    try {
        await autoUpdater.checkForUpdates();
        if (showDialog) {
            dialog.showMessageBox({
                type: updateStatus.state === 'available' ? 'info' : 'none',
                title: '检查更新',
                message: updateStatus.message || '检查完成',
                detail: updateStatus.latestVersion ? `最新版本：${updateStatus.latestVersion}` : ''
            });
        }
    } catch (err) {
        const formatted = formatUpdaterError(err);
        broadcastUpdateStatus({
            state: 'error',
            message: formatted.message,
            detail: formatted.detail,
            progress: 0
        });
        if (showDialog) {
            dialog.showMessageBox({
                type: 'error',
                title: '检查更新失败',
                message: formatted.message,
                detail: formatted.detail
            });
        }
    }
}

async function downloadUpdateFromTray(options = {}) {
    const showDialog = options.showDialog !== false;
    if (isPortableWindows) {
        getPortableUpdateStatus();
        if (showDialog) await openLatestReleasePage();
        return;
    }
    if (!app.isPackaged) {
        broadcastUpdateStatus({
            state: 'dev-unavailable',
            message: '开发模式不支持自动更新',
            progress: 0
        });
        if (showDialog) dialog.showMessageBox({ type: 'info', title: '下载更新', message: '开发模式不支持自动更新。' });
        return;
    }
    if (!updateInfo || updateStatus.state !== 'available') {
        broadcastUpdateStatus({ message: '请先检查并确认有可用更新' });
        if (showDialog) dialog.showMessageBox({ type: 'info', title: '下载更新', message: '请先检查并确认有可用更新。' });
        return;
    }
    try {
        broadcastUpdateStatus({
            state: 'downloading',
            message: '正在准备下载更新...',
            progress: 0
        });
        startUpdateProgressBalloons();
        await autoUpdater.downloadUpdate();
    } catch (err) {
        const formatted = formatUpdaterError(err);
        stopUpdateProgressBalloons('Tools Platform 更新失败', formatted.message);
        broadcastUpdateStatus({
            state: 'error',
            message: formatted.message,
            detail: formatted.detail,
            progress: 0
        });
        if (showDialog) {
            dialog.showMessageBox({
                type: 'error',
                title: '下载更新失败',
                message: formatted.message,
                detail: formatted.detail
            });
        }
    }
}

function installUpdateFromTray() {
    if (isPortableWindows) {
        openLatestReleasePage();
        return;
    }
    if (!updateDownloaded) return;
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
}

function restartApp() {
    isQuitting = true;
    app.relaunch();
    app.quit();
}

function toggleOpenAtLogin(menuItem) {
    const next = !!menuItem.checked;
    app.setLoginItemSettings({ openAtLogin: next });
    refreshTrayMenu();
}

function refreshTrayMenu() {
    if (!tray) return;
    writeRuntimeStatusSnapshot();
    const baseUrl = getAppBaseUrl();
    const loginSettings = app.getLoginItemSettings();
    const petT = (zh, en) => require('./backend/models/desktop-language').getLanguage() === 'en-US' ? en : zh;
    const menuTemplate = [
        { label: `Tools Platform v${app.getVersion()}`, enabled: false },
        { label: baseUrl || '本地服务启动中...', enabled: false },
        { label: desktopLicenseStatus.valid
            ? `License：已授权至 ${new Date(desktopLicenseStatus.expiresAt).toLocaleDateString()}`
            : `License：已失效 (${desktopLicenseStatus.reasonCode || 'UNKNOWN'})`, enabled: false },
        { label: '复制本机机器码（申请/续期 License）', enabled: Boolean(getPublicMachineInfo()), click: copyMachineCodeToClipboard },
        { type: 'separator' },
        { label: '打开 Tools Platform', click: () => openAppPath('/') },
        { label: '打开数据抓取', click: () => openAppPath('/uivf12') },
        { label: '打开数据导入', click: () => openAppPath('/sla') },
        { label: '打开报表看板', click: () => openAppPath('/report') },
        { type: 'separator' },
        {
            label: petT('🐾 桌面宠物 (哈基米)', '🐾 Desktop pet (Hajimi)'),
            submenu: [
                {
                    label: petT('开机/启动自动运行桌宠', 'Start pet with app'),
                    type: 'checkbox',
                    checked: petManager.isPetEnabled(),
                    click: (item) => {
                        petManager.setPetEnabled(item.checked);
                        refreshTrayMenu();
                    }
                },
                {
                    label: petManager.isPetVisible() ? petT('🙈 本次隐藏桌宠', '🙈 Hide pet for now') : petT('👀 唤回显示桌宠', '👀 Show pet'),
                    enabled: petManager.isPetEnabled(),
                    click: () => {
                        if (petManager.isPetVisible()) {
                            petManager.hidePetForNow();
                        } else {
                            petManager.showPetForNow();
                        }
                        refreshTrayMenu();
                    }
                },
                {
                    label: petT('💬 呼出桌宠AI客服对话', '💬 Chat with Hajimi'),
                    enabled: petManager.isPetEnabled(),
                    click: () => {
                        petManager.createChatWindow().show();
                    }
                }
            ]
        },
        { type: 'separator' },
        { label: '查看实时日志/更新进度', click: openRuntimeStatusWindow },
        { label: '打开日志文件夹', click: openLogsFolder },
        { type: 'separator' },
        { label: `更新状态：${String(updateStatus.message || '等待检查更新').replace(/[\r\n\t]+/g, ' ').slice(0, 24)}`, enabled: false },
        ...(isPortableWindows
            ? [{ label: '打开 GitHub 绿色版下载页', click: openLatestReleasePage }]
            : [{ label: '检查更新', click: checkForUpdatesFromTray }]),
        ...(!isPortableWindows && updateStatus.state === 'available' ? [{ label: '下载更新', click: downloadUpdateFromTray }] : []),
        ...(!isPortableWindows && updateStatus.state === 'downloaded' ? [{ label: '重启并安装更新', click: installUpdateFromTray }] : []),
        { type: 'separator' },
        ...(!isPortableWindows ? [{ label: '开机自启动', type: 'checkbox', checked: !!loginSettings.openAtLogin, click: toggleOpenAtLogin }] : []),
        { label: '重启本地服务', click: restartApp },
        { label: '完全退出程序', click: () => {
            isQuitting = true;
            app.quit();
        }}
    ];
    tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

async function startTrayApp() {
    // 第一时间弹出启动窗口，无缝接力阶段一解压，消除空白真空期
    createStartupWindow();
    updateStartupProgress(36, '运行环境已就绪', '正在加载桌面环境与授权验证…', '阶段 2/2 · 启动接力');

    const licensed = await ensureDesktopLicense();
    if (!licensed) {
        closeStartupWindow(false);
        isQuitting = true;
        app.quit();
        return;
    }
    const launchExperience = prepareLaunchExperience();
    registerDownloadHandler();
    updateStartupProgress(52, '正在初始化运行服务', '加载绿色版运行环境与本地配置…', '阶段 2/2 · 启动初始化');

    try {
        updateStartupProgress(65, '正在分配本地服务', '选择可用端口并准备安全的本地访问地址…', '阶段 2/2 · 网络准备');
        // 复用上次端口：端口不变，浏览器里的登录信息与 Dragon Claw 会话才不会丢。
        const { port: PORT, source: portSource } = await chooseLocalPort({ statePath: localPortStatePath });
        writePreferredPort(localPortStatePath, PORT);
        console.log(`[Electron] Local server port ${PORT} (${portSource})`);
        process.env.PORT = PORT;
        localPort = PORT;
        writeRuntimeStatusSnapshot();

        if (!localServerStarted) {
            updateStartupProgress(80, '正在加载核心服务', '启动数据库、备份恢复与系统工具模块…', '阶段 2/2 · 服务加载');
            localServerStarted = true;
            require('./backend/server.js');
        }

        if (!tray) {
            createTray();
        } else {
            refreshTrayMenu();
        }

        startRuntimeCommandWatcher();
        await waitForLocalServer(PORT);
        updateStartupProgress(96, '本地服务已经就绪', '正在连接浏览器并打开主页面…', '阶段 2/2 · 打开主页面');
        const launchUrl = buildLaunchUrl(PORT, launchExperience);
        if (launchExperience.shouldOpenSystemBrowser) {
            await shell.openExternal(launchUrl);
        }
        closeStartupWindow();
        startDesktopLicenseRefresh();
        scheduleStartupUpdateCheck();

        // 启动桌面宠物组件
        try {
            petManager.initDesktopPet({ port: PORT, baseUrl: `http://127.0.0.1:${PORT}` });
        } catch (petErr) {
            console.warn('[Electron] Failed to initialize desktop pet:', petErr.message || petErr);
        }
    } catch (err) {
        updateStartupProgress(100, '启动未完成', err.message || String(err), '阶段 2/2 · 启动失败', false, 'error');
        setTimeout(() => closeStartupWindow(false), 1600);
        dialog.showErrorBox('Server Startup Failed', `Failed to start the local server: ${err.message}`);
    }
}

app.on('before-quit', () => {
    isQuitting = true;
    try {
        petManager.cleanupDesktopPet();
    } catch (_) {}
});

app.whenReady().then(() => {
    ensureDesktopMachineIdentity().catch(error => console.warn('[Electron] Machine identity failed:', error.message || error));
    if (!isPortableWindows) setupAutoUpdater();
    registerUpdaterIpcHandlers();
    registerDesktopIpcHandlers();
    registerDesktopLicenseIpcHandlers();
    startTrayApp();
});

app.on('window-all-closed', function () {
    if (isQuitting && process.platform !== 'darwin') {
        app.quit();
    }
});

function focusPendingAppWindow() {
    if (licenseWindow && !licenseWindow.isDestroyed()) {
        if (licenseWindow.isMinimized()) licenseWindow.restore();
        licenseWindow.show();
        licenseWindow.focus();
        licenseWindow.setAlwaysOnTop(true);
        licenseWindow.moveTop();
        return true;
    }
    if (startupWindow && !startupWindow.isDestroyed()) {
        if (startupWindow.isMinimized()) startupWindow.restore();
        startupWindow.show();
        startupWindow.focus();
        return true;
    }
    return false;
}

app.on('second-instance', () => {
    console.log('[Electron] 检测到用户重复运行程序，自动唤起已有界面');
    if (licenseWindow && !licenseWindow.isDestroyed()) {
        focusPendingAppWindow();
        return;
    }
    if (focusPendingAppWindow()) return;
    openAppPath('/');
});

app.on('activate', function () {
    if (focusPendingAppWindow()) return;
    // Dock activation can arrive before startup has created a window or a port.
    if (!localPort) return;
    openAppPath('/');
});
