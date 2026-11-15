// Shared platform capability: platform-runtime. See docs/frontend-architecture.md.
let pageScrollbarIdleTimer;
window.addEventListener('scroll', () => {
    document.documentElement.classList.add('is-page-scrolling');
    clearTimeout(pageScrollbarIdleTimer);
    pageScrollbarIdleTimer = setTimeout(() => {
        document.documentElement.classList.remove('is-page-scrolling');
    }, 900);
}, { passive: true });

let platformMounted = false;
function mountPlatformEarly() {
    if (platformMounted || !document.body) return;
    ensureMigrationStatusLoaded();
    registerPlatformI18n();
    hydrateNavigationFromCache();
    applyPlatformIdentity();
    platformMounted = true;
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!platformMounted) {
        mountPlatformEarly();
    }
    await ensureToolsI18nLoaded();
    registerPlatformI18n();
    applyPlatformIdentity();
    const getVersion = window.ToolsAppVersion?.get || (() => fetch('/api/app-version', { cache: 'no-store' }).then(res => res.ok ? res.json() : null).then(data => data?.version || ''));
    getVersion().then(version => publishPlatformStatus({ version: version ? `v${version}` : '' })).catch(() => {});
    const navigationCacheReady = hydrateNavigationFromCache();
    if (!navigationCacheReady) await loadNavigationData();
    publishPlatformCatalog();
    syncNavUserSession();
    initBackToTopButton();
    if (navigationCacheReady) loadNavigationData();
    trackCurrentToolOpen();
    if (hasNavAuthToken()) {
        refreshAlertCenterBadge();
        startAlertCenterPolling(60000);
    }
    setTimeout(checkServerStatus, 500);
    const scheduleBuiltinToolsSync = () => setTimeout(checkBuiltinToolsSync, 8000);
    if (window.top === window) {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(scheduleBuiltinToolsSync, { timeout: 12000 });
        else scheduleBuiltinToolsSync();
    }
});

mountPlatformEarly();

// 全部平台页共用草稿提醒；组件自身排除 iframe，避免工具容器中重复提醒。
loadNavLazyScript('./tp-static/frontend/js/shared/ops-inbox.js', 'Ops inbox could not load').catch(() => {});

let navReloginPrompted = false;

async function promptNavRelogin() {
    if (navReloginPrompted) return;
    navReloginPrompted = true;
    const confirmed = await showPlatformConfirm({
        title: navT('nav.relogin.title'),
        message: navT('nav.relogin.message'),
        hint: navT('nav.relogin.hint'),
        confirmText: navT('nav.relogin.confirm'),
        cancelText: navT('nav.relogin.later'),
        tone: 'info',
        icon: '🔑'
    });
    if (confirmed) window.location.href = './login.html';
}

async function syncNavUserSession() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            if (data && data.username) {
                const previousRole = localStorage.getItem('tools_role');
                const previousUser = localStorage.getItem('tools_user');
                const previousSuper = localStorage.getItem('tools_super');
                localStorage.setItem('tools_user', data.username);
                if (data.role) localStorage.setItem('tools_role', data.role);
                if (await syncTenantWorkspace(data)) return;
                const currentSuper = localStorage.getItem('tools_super');
                if (typeof window?.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                    try { window.dispatchEvent(new CustomEvent('tools:authchange')); } catch (_) {}
                }
                // 服务端 cookie 仍有效但浏览器本地没有 token（换了端口/清过站点数据）：依赖 token 的功能会失效，引导重新登录。
                if (!hasNavAuthToken()) promptNavRelogin();
            }
        } else if (res.status === 401) {
            stopAlertCenterPolling();
            const pathname = (window.__TP_STATIC_PATH__ || window.location.pathname);
            const isPublicPage = pathname === './login.html' || pathname === '/pages/login.html' ||
                pathname === '/privacy' || pathname === '/privacy.html' ||
                pathname === '/terms' || pathname === '/terms.html' ||
                pathname === '/cinema' || pathname === '/cinema.html';
            if (!isPublicPage) {
                window.location.replace('./login.html');
            }
        }
    } catch (_) {}
}

// EXE 授权角标在普通 Web 部署中会自动隐藏，仅桌面版本地服务显示。
if (!document.querySelector('script[data-desktop-license-badge]')) {
    const desktopLicenseBadgeScript = document.createElement('script');
    desktopLicenseBadgeScript.src = './tp-static/frontend/js/shared/desktop-license-badge.js';
    desktopLicenseBadgeScript.dataset.desktopLicenseBadge = '1';
    document.head.appendChild(desktopLicenseBadgeScript);
}

// 源码启动、Windows 安装版和绿色版共用同一个服务端首次启动状态。
// 首页内嵌打开的工具页里不再弹（首页自己会弹一次）
if (!PLATFORM_EMBEDDED && !document.querySelector('script[data-first-run-onboarding]')) {
    const firstRunOnboardingScript = document.createElement('script');
    firstRunOnboardingScript.src = './tp-static/frontend/js/shared/first-run-onboarding.js';
    firstRunOnboardingScript.dataset.firstRunOnboarding = '1';
    document.head.appendChild(firstRunOnboardingScript);
}


// App surfaces keep custom context menus; editing and copying selected text retain native actions.
document.addEventListener('contextmenu', event => {
    if(event.defaultPrevented || event.target.closest('input, textarea, [contenteditable="true"]') || window.getSelection()?.toString().trim()) return;
    event.preventDefault();
});

(function () {
    // 华子胶片设计工具内置了自己的 AI 助手，避免重复显示全局悬浮入口。
    if ((window.__TP_STATIC_PATH__ || window.location.pathname).startsWith('/tools/network_safety_meeting_summary')) return;
    // 公开的隐私/条款页在未登录时不请求受保护的 AI 接口，避免无效 401 日志。
    if (!hasNavAuthToken()) return;

    // 自动初始化与手动打开共用同一加载链，等待文件组件就绪后再启动助手。
    ensureToolsAIAssistantScript().catch(error => console.warn(error.message));
})();

