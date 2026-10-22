/**
 * shared/toast.js - 全局消息提示组件
 */
function showToast(message, type = 'success') {
    let toast = document.getElementById('globalToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalToast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl !== document.documentElement && fsEl !== document.body) {
        fsEl.appendChild(toast);
    } else if (toast.parentElement !== document.body) {
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.className = `toast toast-${type} show`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

window.showToast = showToast;
