/**
 * 桌面宠物系统级全局键盘监听模块 (跨平台 macOS / Windows)
 * 基于 uiohook-napi 实现底层的无侵入全局按键监听与事件分发
 */

const { systemPreferences, shell } = require('electron');

// 原生模块只在真正启动监听时才加载：桌宠停用后主进程里不会有全局键盘钩子。
let uIOhook = null;
let hookLoaded = false;
function loadHook() {
    if (hookLoaded) return uIOhook;
    hookLoaded = true;
    try {
        uIOhook = require('uiohook-napi').uIOhook;
    } catch (err) {
        console.warn('[PetKeyboardHook] Failed to load uiohook-napi:', err.message || err);
    }
    return uIOhook;
}

let isRunning = false;
let onKeyPressCallback = null;
let lastPressTimestamp = 0;
const THROTTLE_MS = 25; // 限制最小触发间隔，防止长按按键导致高频 IPC 积压

/**
 * 检查当前系统是否有全局按键监听权限
 * @param {boolean} prompt 是否在未授权时弹出系统授权引导弹窗 (仅 macOS)
 * @returns {boolean} 是否已有权限
 */
function checkAccessibilityPermission(prompt = false) {
    if (process.platform !== 'darwin') {
        return true; // Windows 和 Linux 通常不需要特殊的辅助功能权限
    }
    try {
        if (systemPreferences && typeof systemPreferences.isTrustedAccessibilityClient === 'function') {
            return systemPreferences.isTrustedAccessibilityClient(Boolean(prompt));
        }
    } catch (err) {
        console.warn('[PetKeyboardHook] Failed to check macOS accessibility:', err.message || err);
    }
    return false;
}

/**
 * 在 macOS 上打开系统“辅助功能”授权设置面板
 */
function openAccessibilitySettings() {
    if (process.platform === 'darwin') {
        try {
            shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        } catch (_) {}
    }
}

/**
 * 内部按键事件处理
 */
function handleKeyDown(event) {
    if (!isRunning || typeof onKeyPressCallback !== 'function') return;

    const now = Date.now();
    if (now - lastPressTimestamp < THROTTLE_MS) {
        return;
    }
    lastPressTimestamp = now;

    try {
        onKeyPressCallback(event);
    } catch (err) {
        console.warn('[PetKeyboardHook] Callback error:', err.message || err);
    }
}

/**
 * 启动全局键盘监听
 * @param {Function} callback 按键触发时的回调函数
 * @returns {boolean} 是否成功启动
 */
function startKeyboardHook(callback) {
    if (typeof callback === 'function') {
        onKeyPressCallback = callback;
    }

    if (!loadHook()) {
        console.warn('[PetKeyboardHook] uiohook-napi is not available');
        return false;
    }

    if (isRunning) {
        return true;
    }

    // macOS 辅助功能权限检查
    if (process.platform === 'darwin') {
        const hasPermission = checkAccessibilityPermission(false);
        if (!hasPermission) {
            console.log('[PetKeyboardHook] macOS 辅助功能未授权，尝试请求授权...');
            checkAccessibilityPermission(true);
            // 系统授权是异步交互；等待用户授权后通过原有开关/显示操作重试。
            return false;
        }
    }

    try {
        uIOhook.removeListener('keydown', handleKeyDown);
        uIOhook.on('keydown', handleKeyDown);
        uIOhook.start();
        isRunning = true;
        console.log('[PetKeyboardHook] 全局键盘监听已就绪并启动');
        return true;
    } catch (err) {
        console.warn('[PetKeyboardHook] 启动键盘监听失败:', err.message || err);
        isRunning = false;
        return false;
    }
}

/**
 * 停止全局键盘监听
 */
function stopKeyboardHook() {
    if (!isRunning || !uIOhook) return;
    try {
        uIOhook.removeListener('keydown', handleKeyDown);
        uIOhook.stop();
        console.log('[PetKeyboardHook] 全局键盘监听已停止');
    } catch (err) {
        console.warn('[PetKeyboardHook] 停止键盘监听异常:', err.message || err);
    } finally {
        isRunning = false;
    }
}

/**
 * 获取当前监听运行状态
 */
function isKeyboardHookRunning() {
    return isRunning;
}

module.exports = {
    startKeyboardHook,
    stopKeyboardHook,
    isKeyboardHookRunning,
    checkAccessibilityPermission,
    openAccessibilitySettings
};
