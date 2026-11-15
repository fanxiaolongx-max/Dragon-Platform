// Shared platform capability: platform-settings-controller. See docs/frontend-architecture.md.
function scheduleNavSettingsSave() {
    publishPlatformCatalog();
    writeNavigationBootstrapCache();
    window.dispatchEvent(new Event('tools:nav-layout-change'));
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.set.saving');
    clearTimeout(navState.saveTimer);
    navState.saveTimer = setTimeout(async () => {
        try {
            const res = await fetch('/api/nav-settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaderForNav()
                },
                body: JSON.stringify(navState.settings)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            navState.settings = normalizeNavSettings(await res.json());
            writeNavigationBootstrapCache();
            window.dispatchEvent(new Event('tools:f12shortcutschange'));
            if (indicator) indicator.textContent = navT('nav.set.saved');
        } catch (e) {
            if (indicator) indicator.textContent = navT('nav.set.saveFail') + e.message;
        }
    }, 420);
}

function renderNavSettingsTabLabel(icon, label) {
    return `<span class="nav-settings-tab-icon" aria-hidden="true">${navEscape(icon)}</span><span class="nav-settings-tab-label">${navEscape(label)}</span>`;
}

function renderPageSettingsTabs() {
    // 「工具中台」页配置的是工具免密访问，属于超级管理员
    // 迁移状态、NetCare 数据探查依赖超级管理员专属接口
    return NAV_BUILTIN_LINKS.filter(item => !['home', 'storage', 'netcare-explorer'].includes(item.id) || isNavSuperAdmin()).map(item => `
        <button class="nav-settings-tab nav-settings-tab-page ${navState.settingsTab === `page:${item.id}` ? 'active' : ''}" data-tab="page:${navEscape(item.id)}" onclick="switchNavSettingsTab('page:${navEscape(item.id)}')">${renderNavSettingsTabLabel(item.icon, getNavLabel(item))}</button>
    `).join('');
}

function hasHomeSidebarMenu() {
    return Boolean(document.querySelector('#homeSidebar [data-v2-flyout="more"]'));
}

function isNavSidebarShortcut(href) {
    if (!href || href.startsWith('#')) return false;
    const clean = String(href).split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    return clean !== '/' && clean !== '/index.html';
}

function getPrimarySettingsTitle() {
    return navT(hasHomeSidebarMenu() ? 'nav.set.tab.sidebar' : 'nav.set.tab.primary');
}

function renderNavSettingsSidebar() {
    const sidebar = document.querySelector('.nav-settings-sidebar');
    if (!sidebar) return;
    const t = navState.settingsTab;
    const agentToolsTab = `<button class="nav-settings-tab ${t === 'agentTools' ? 'active' : ''}" data-tab="agentTools" onclick="switchNavSettingsTab('agentTools')">${renderNavSettingsTabLabel('🧰', navLocaleText('智能体工具', 'Agent tools'))}</button>`;
    const vaultTab = `<button class="nav-settings-tab ${t === 'vault' ? 'active' : ''}" data-tab="vault" onclick="switchNavSettingsTab('vault')">${renderNavSettingsTabLabel('🔐', navLocaleText('保险箱', 'Vault'))}</button>`;
    if (localStorage.getItem('tools_role') !== 'admin') {
        sidebar.innerHTML = agentToolsTab + vaultTab;
        syncNavSettingsMobileNav();
        return;
    }
    sidebar.innerHTML = `
        <div class="nav-settings-title">${navEscape(navT('nav.set.title'))}</div>
        <button class="nav-settings-tab ${t === 'primary' ? 'active' : ''}" data-tab="primary" onclick="switchNavSettingsTab('primary')">${renderNavSettingsTabLabel('🧭', getPrimarySettingsTitle())}</button>
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'logo' ? 'active' : ''}" data-tab="logo" onclick="switchNavSettingsTab('logo')">${renderNavSettingsTabLabel('🏷️', navT('nav.set.tab.logo'))}</button>` : ''}
        <button class="nav-settings-tab ${t === 'categories' ? 'active' : ''}" data-tab="categories" onclick="switchNavSettingsTab('categories')">${renderNavSettingsTabLabel('🗂️', navT('nav.set.tab.categories'))}</button>
        <button class="nav-settings-tab ${t === 'items' ? 'active' : ''}" data-tab="items" onclick="switchNavSettingsTab('items')">${renderNavSettingsTabLabel('↕️', navT('nav.set.tab.items'))}</button>
        <button class="nav-settings-tab ${t === 'ai' ? 'active' : ''}" data-tab="ai" onclick="switchNavSettingsTab('ai')">${renderNavSettingsTabLabel('🤖', navT('nav.set.tab.ai'))}</button>
        ${agentToolsTab}
        ${vaultTab}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'channels' ? 'active' : ''}" data-tab="channels" onclick="switchNavSettingsTab('channels')">${renderNavSettingsTabLabel('🔌', navT('nav.set.tab.channels'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'desktopAgents' ? 'active' : ''}" data-tab="desktopAgents" onclick="switchNavSettingsTab('desktopAgents')">${renderNavSettingsTabLabel('🖥️', navLocaleText('桌面 Agent', 'Desktop Agents'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'update' ? 'active' : ''}" data-tab="update" onclick="switchNavSettingsTab('update')">${renderNavSettingsTabLabel('🔄', navT('nav.set.tab.update'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'backup' ? 'active' : ''}" data-tab="backup" onclick="switchNavSettingsTab('backup')">${renderNavSettingsTabLabel('💾', navT('nav.set.tab.backup'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'snapshotPublish' ? 'active' : ''}" data-tab="snapshotPublish" onclick="switchNavSettingsTab('snapshotPublish')">${renderNavSettingsTabLabel('📤', navT('nav.set.tab.snapshotPublish'))}</button>` : ''}
        <button class="nav-settings-tab ${t === 'initialize' ? 'active' : ''}" data-tab="initialize" onclick="switchNavSettingsTab('initialize')">${renderNavSettingsTabLabel('🌱', navT('nav.set.tab.initialize'))}</button>
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'media' ? 'active' : ''}" data-tab="media" onclick="switchNavSettingsTab('media')">${renderNavSettingsTabLabel('🎬', navT('nav.set.tab.media'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'promotions' ? 'active' : ''}" data-tab="promotions" onclick="switchNavSettingsTab('promotions')">${renderNavSettingsTabLabel('📣', navT('nav.set.tab.promotions'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'customBackup' ? 'active' : ''}" data-tab="customBackup" onclick="switchNavSettingsTab('customBackup')">${renderNavSettingsTabLabel('🧰', navT('nav.set.tab.customBackup'))}</button>` : ''}
        <button class="nav-settings-tab ${t === 'accounts' ? 'active' : ''}" data-tab="accounts" onclick="switchNavSettingsTab('accounts')">${renderNavSettingsTabLabel('👤', isNavSuperAdmin() ? navT('nav.set.tab.accounts') : navLocaleText('我的账号', 'My account'))}</button>
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'security' ? 'active' : ''}" data-tab="security" onclick="switchNavSettingsTab('security')">${renderNavSettingsTabLabel('🛡️', navT('nav.set.tab.security'))}</button>` : ''}
        <div class="nav-settings-title nav-settings-section-title">${navEscape(navT('nav.set.tab.pages'))}</div>
        ${renderPageSettingsTabs()}
        <div class="nav-settings-section-title" aria-hidden="true"></div>
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'page:f12-extension' ? 'active' : ''}" data-tab="page:f12-extension" onclick="switchNavSettingsTab('page:f12-extension')">${renderNavSettingsTabLabel('🧩', navT('nav.page.f12.title'))}</button>` : ''}
    `;
    syncNavSettingsMobileNav();
}

// 手机分类复用现有侧栏的标签与分组，避免维护第二套设置目录。
function syncNavSettingsMobileNav() {
    const select = document.getElementById('navSettingsMobileSection');
    const sidebar = document.querySelector('.nav-settings-sidebar');
    if (!select || !sidebar) return;
    select.replaceChildren();
    let group = null;
    for (const item of sidebar.children) {
        if (item.classList.contains('nav-settings-title') && item.textContent.trim()) {
            group = document.createElement('optgroup'); group.label = item.textContent.trim(); select.append(group);
        } else if (item.matches('button[data-tab]')) {
            const option = document.createElement('option'); option.value = item.dataset.tab;
            option.textContent = item.querySelector('.nav-settings-tab-label')?.textContent || item.textContent;
            (group || select).append(option);
        }
    }
    select.value = navState.settingsTab;
    select.setAttribute('aria-label', navLocaleText('设置分类', 'Settings category'));
    document.querySelector('.nav-settings-mobile-label').textContent = navT('nav.set.title');
}
let navSettingsViewportCleanup = null;
function bindNavSettingsViewport(modal) {
    navSettingsViewportCleanup?.();
    const viewport = window.visualViewport;
    const update = () => {
        if (window.innerWidth <= 860) {
            modal.style.setProperty('--nav-settings-viewport-h', `${Math.round(viewport?.height || window.innerHeight)}px`);
            modal.style.setProperty('--nav-settings-viewport-top', `${Math.round(viewport?.offsetTop || 0)}px`);
        } else {
            modal.style.removeProperty('--nav-settings-viewport-h'); modal.style.removeProperty('--nav-settings-viewport-top');
        }
    };
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    navSettingsViewportCleanup = () => {
        window.removeEventListener('resize', update);
        viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update);
        navSettingsViewportCleanup = null;
    };
    update();
}

function openNavSettingsModal() {
    const role = localStorage.getItem('tools_role');
    if (!role) return;
    if (role !== 'admin' && navState.settingsTab !== 'vault') navState.settingsTab = 'agentTools';
    let modal = document.getElementById('navSettingsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'navSettingsModal';
        modal.className = 'nav-settings-modal';
        modal.innerHTML = `
            <div class="nav-settings-window" role="dialog" aria-modal="true" aria-labelledby="navSettingsHeading">
                <div class="nav-settings-mobile-nav"><label class="nav-settings-mobile-label" for="navSettingsMobileSection"></label><select id="navSettingsMobileSection" onchange="switchNavSettingsTab(this.value)"></select></div>
                <div class="nav-settings-sidebar"></div>
                <div class="nav-settings-main">
                    <button type="button" class="nav-settings-close" aria-label="${navEscape(navLocaleText('关闭设置', 'Close settings'))}" onclick="closeNavSettingsModal()">×</button>
                    <div class="nav-settings-head">
                        <div>
                            <div class="nav-settings-heading" id="navSettingsHeading"></div>
                            <div class="nav-settings-subtitle" id="navSettingsSubtitle"></div>
                        </div>
                        <div class="nav-settings-save-state" id="navSettingsSaveState">${navEscape(navT('nav.set.loaded'))}</div>
                    </div>
                    <div id="navSettingsContent"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', event => { if (event.target === modal) closeNavSettingsModal(); });
        modal.addEventListener('keydown', event => { if (event.key === 'Escape' && event.target.tagName !== 'SELECT') { event.stopPropagation(); closeNavSettingsModal(); } });
    }
    modal.style.display = 'flex';
    document.body.classList.add('nav-settings-open');
    bindNavSettingsViewport(modal);
    renderNavSettingsSidebar();
    return renderNavSettingsContent();
}

let chatModelSettingsReturnTarget = null;
function closeNavSettingsModal() {
    const modal = document.getElementById('navSettingsModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('nav-settings-open');
    navSettingsViewportCleanup?.();
    if (chatModelSettingsReturnTarget?.isConnected) chatModelSettingsReturnTarget.focus({ preventScroll: true });
    chatModelSettingsReturnTarget = null;
}

window.openNavSettingsModal = openNavSettingsModal;
window.openChatModelSettings = async function () {
    if (localStorage.getItem('tools_role') !== 'admin') return;
    chatModelSettingsReturnTarget = document.getElementById('dcModelBtn');
    navState.settingsTab = 'ai';
    navState.aiCategory = 'chat';
    navState.aiSelectedProfileId = null;
    await openNavSettingsModal();
    const field = document.getElementById('navAiModel');
    field?.scrollIntoView({ block: 'center' });
    field?.focus({ preventScroll: true });
};
window.closeNavSettingsModal = closeNavSettingsModal;

// 只有超级管理员能看到的平台级设置页
const NAV_SUPER_ONLY_SETTINGS_TABS = new Set(['logo', 'channels', 'desktopAgents', 'update', 'snapshotPublish', 'media', 'promotions', 'security', 'backup', 'customBackup', 'page:home', 'page:f12-extension', 'page:storage', 'page:netcare-explorer']);
window.switchNavSettingsTab = function (tab) {
    if (localStorage.getItem('tools_role') !== 'admin' && tab !== 'vault') tab = 'agentTools';
    if (tab === 'tenants') tab = 'accounts';
    if (NAV_SUPER_ONLY_SETTINGS_TABS.has(tab) && !isNavSuperAdmin()) tab = 'primary';
    navState.settingsTab = tab;
    const mobileSelect = document.getElementById('navSettingsMobileSection');
    if (mobileSelect) mobileSelect.value = tab;
    const settingsContent = document.getElementById('navSettingsContent');
    if (settingsContent) settingsContent.scrollTop = 0;
    document.querySelectorAll('.nav-settings-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    renderNavSettingsContent();
};

function getNavSettingsTitle() {
    if (navState.settingsTab === 'page:f12-extension') return navT('nav.page.f12.title');
    if (navState.settingsTab.startsWith('page:')) {
        const pageId = navState.settingsTab.slice(5);
        const item = NAV_BUILTIN_LINKS.find(link => link.id === pageId);
        return item ? navT('nav.set.pageConfig', { page: getNavLabel(item) }) : navT('nav.set.tab.pages');
    }
    if (navState.settingsTab === 'accounts') return isNavSuperAdmin() ? navT('nav.set.tab.accounts') : navLocaleText('我的账号', 'My account');
    if (navState.settingsTab === 'security') return navT('nav.set.tab.security');
    if (navState.settingsTab === 'ai') return navT('nav.set.tab.ai');
    if (navState.settingsTab === 'agentTools') return navLocaleText('智能体工具', 'Agent tools');
    if (navState.settingsTab === 'vault') return navLocaleText('保险箱', 'Vault');
    if (navState.settingsTab === 'desktopAgents') return navLocaleText('桌面 Agent', 'Desktop Agents');
    if (navState.settingsTab === 'channels') return navT('nav.set.tab.channels');
    if (navState.settingsTab === 'update') return navT('nav.set.tab.update');
    if (navState.settingsTab === 'backup') return navT('nav.set.tab.backup');
    if (navState.settingsTab === 'snapshotPublish') return navT('nav.set.tab.snapshotPublish');
    if (navState.settingsTab === 'initialize') return navT('nav.set.tab.initialize');
    if (navState.settingsTab === 'media') return navT('nav.set.tab.media');
    if (navState.settingsTab === 'promotions') return navT('nav.set.tab.promotions');
    if (navState.settingsTab === 'customBackup') return navT('nav.set.tab.customBackup');
    if (navState.settingsTab === 'categories') return navT('nav.set.tab.categories');
    if (navState.settingsTab === 'items') return navT('nav.set.tab.items');
    if (navState.settingsTab === 'logo') return navT('nav.set.tab.logo');
    return getPrimarySettingsTitle();
}

function getNavSettingsSubtitle() {
    if (navState.settingsTab === 'page:f12-extension') return navLocaleText('选择首页快捷下载插件及默认打包用途，修改后自动保存。', 'Choose home download shortcuts and default package targets. Changes save automatically.');
    if (navState.settingsTab.startsWith('page:')) {
        const pageId = navState.settingsTab.slice(5);
        if (pageId === 'report') return navT('nav.set.sub.report');
        if (pageId === 'duty-roster') return navLocaleText('夜间运维值班表服务端持久化及月报资料库互通说明。', 'Night operation duty roster server persistence and report library overview.');
        return navT('nav.set.sub.pageFallback');
    }
    if (navState.settingsTab === 'accounts') return navT('nav.set.sub.accounts');
    if (navState.settingsTab === 'security') return navT('nav.set.sub.security');
    if (navState.settingsTab === 'ai') return navT('nav.set.sub.ai');
    if (navState.settingsTab === 'agentTools') return navLocaleText('Dragon Claw 的 MCP 服务与工具清单：哪些工具常驻、哪些按需加载、占多少上下文、被调用了多少次。', 'Dragon Claw MCP servers and tool catalog: what is always loaded, what loads on demand, context cost and call counts.');
    if (navState.settingsTab === 'vault') return navLocaleText('只属于你的网站账号密码：Dragon 浏览器自动保存、自动填写并登录，AI 也能代你登录，但看不到密码。', 'Your own website logins: saved, filled and signed in automatically by the Dragon browser. The AI can sign in for you without seeing the password.');
    if (navState.settingsTab === 'desktopAgents') return navLocaleText('连接本机原生桌面会话，同步最近对话并在 Web 继续交流。', 'Sync recent native desktop sessions and continue them from the Web.');
    if (navState.settingsTab === 'channels') return navT('nav.set.sub.channels');
    if (navState.settingsTab === 'update') return navT('nav.set.sub.update');
    if (navState.settingsTab === 'backup') return navT('nav.set.sub.backup');
    if (navState.settingsTab === 'snapshotPublish') return navT('nav.set.sub.snapshotPublish');
    if (navState.settingsTab === 'initialize') return navT('nav.set.sub.initialize');
    if (navState.settingsTab === 'media') {
        const isEn = Boolean(navState.mediaOverviewCache?.enabled);
        const statusNote = isEn
            ? navLocaleText('【已启用】', ' [Enabled]')
            : navLocaleText('【未启用】', ' [Disabled]');
        return navT('nav.set.sub.media') + ' ' + statusNote;
    }
    if (navState.settingsTab === 'promotions') return navT('nav.set.sub.promotions');
    if (navState.settingsTab === 'customBackup') return navT('nav.set.sub.customBackup');
    const sidebar = hasHomeSidebarMenu();
    if (navState.settingsTab === 'categories') return navT(sidebar ? 'nav.set.sub.toolCategories' : 'nav.set.sub.categories');
    if (navState.settingsTab === 'items') return navT(sidebar ? 'nav.set.sub.toolOrder' : 'nav.set.sub.items');
    if (navState.settingsTab === 'logo') return navT('nav.set.sub.logo');
    return navT(sidebar ? 'nav.set.sub.sidebar' : 'nav.set.sub.primary');
}

// 全局设置各页签的渲染与操作（约占本文件一半）放在 shared/platform-settings.js，首次打开设置时才加载：
// 平台页面共用设置入口，设置内容在首次打开时按需加载。
let navSettingsPackPromise = null;
function ensureNavSettingsPack() {
    if (window.__navSettingsPackLoaded) return Promise.resolve();
    navSettingsPackPromise ||= loadNavLazyScript('./tp-static/frontend/js/shared/platform-settings.js', navLocaleText('无法加载设置组件，请刷新后重试', 'Settings could not load. Refresh and try again'))
        .catch(error => { navSettingsPackPromise = null; throw error; });
    return navSettingsPackPromise;
}

async function renderNavSettingsContent() {
    const content = document.getElementById('navSettingsContent');
    const heading = document.getElementById('navSettingsHeading');
    const subtitle = document.getElementById('navSettingsSubtitle');
    if (!content) return;
    if (heading) heading.textContent = getNavSettingsTitle();
    if (subtitle) subtitle.textContent = getNavSettingsSubtitle();
    if (!window.__navSettingsPackLoaded) {
        content.innerHTML = `<div class="nav-settings-loading">${navEscape(navLocaleText('正在加载设置…', 'Loading settings…'))}</div>`;
        try {
            await ensureNavSettingsPack();
        } catch (error) {
            content.innerHTML = `<div class="nav-settings-loading">${navEscape(error.message)}</div>`;
            return;
        }
        // 加载期间可能切换了页签或关闭了弹窗：按当前状态重新渲染
        return renderNavSettingsContent();
    }

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator && (indicator.textContent === '已加载' || indicator.textContent === 'Loaded')) {
        indicator.textContent = navT('nav.set.loaded');
    }

    if (NAV_SUPER_ONLY_SETTINGS_TABS.has(navState.settingsTab) && !isNavSuperAdmin()) navState.settingsTab = 'primary';
    if (navState.settingsTab.startsWith('page:')) return renderPageSettings(content, navState.settingsTab.slice(5));
    if (navState.settingsTab === 'accounts') return renderAccountSettings(content);
    if (navState.settingsTab === 'security') return renderSecuritySettings(content);
    if (navState.settingsTab === 'ai') return renderAiSettings(content);
    if (navState.settingsTab === 'agentTools') return renderAgentToolsSettings(content);
    if (navState.settingsTab === 'vault') return renderVaultSettings(content);
    if (navState.settingsTab === 'desktopAgents') return renderDesktopAgentSettings(content);
    if (navState.settingsTab === 'channels') return renderChannelSettings(content);
    if (navState.settingsTab === 'update') return renderUpdaterSettings(content);
    if (navState.settingsTab === 'backup') return renderBackupSettings(content);
    if (navState.settingsTab === 'snapshotPublish') return renderSnapshotPublishSettings(content);
    if (navState.settingsTab === 'initialize') return renderInitializationSettings(content);
    if (navState.settingsTab === 'media') return renderMediaSettings(content);
    if (navState.settingsTab === 'promotions') return renderPromotionSettings(content);
    if (navState.settingsTab === 'customBackup') return renderCustomToolBackupSettings(content);
    if (navState.settingsTab === 'categories') return renderCategorySettings(content);
    if (navState.settingsTab === 'items') return renderItemCategorySettings(content);
    if (navState.settingsTab === 'logo') return renderLogoSettings(content);
    renderPrimarySettings(content);
}

// ============================================================
// 🎨 平台图标与品牌管理 (Platform Logo & Branding Settings)
// ============================================================
window._selectedLogoFile = null;

// 按需加载的设置脚本带上内容版本号：CDN 会给无版本号的脚本加数小时缓存，平台更新后仍拿到旧版
async function loadNavLazyScript(src, errorText) {
    let url = src;
    try {
        const res = await fetch(`/api/asset-version?path=${encodeURIComponent(src)}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        if (data && data.version) url = `${src}?v=${encodeURIComponent(data.version)}`;
    } catch (_) { /* 拿不到版本号时按原地址加载 */ }
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(errorText));
        document.head.appendChild(script);
    });
}


const SNAPSHOT_API = '/api/department-reward-penalty/snapshot';
let snapshotProgressTimer = null;
let snapshotProgressJobId = '';
const snapshotText = (zh, en) => navLocaleText(zh, en);

async function snapshotApi(path, options = {}) {
    const response = await fetch(SNAPSHOT_API + path, {
        ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...getAuthHeaderForNav() }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

const SNAPSHOT_PREREQ_CACHE_KEY = 'tools_snapshot_prereq_cache';
const SNAPSHOT_PREREQ_TTL = 10 * 60 * 1000;

function getSnapshotConfigKey(settings) {
    if (!settings) {
        const remoteUrl = document.getElementById('snapshotRemoteUrl')?.value || '';
        const repoDir = document.getElementById('snapshotRepoDir')?.value || '';
        const branch = document.getElementById('snapshotBranch')?.value || '';
        return `${remoteUrl.trim()}::${repoDir.trim()}::${branch.trim()}`;
    }
    return `${(settings.remoteUrl || '').trim()}::${(settings.repoDir || '').trim()}::${(settings.branch || '').trim()}`;
}

function getSnapshotPrereqCache(configKey) {
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_PREREQ_CACHE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !data.result || !data.checkedAt) return null;
        if (Date.now() - data.checkedAt > SNAPSHOT_PREREQ_TTL) return null;
        if (configKey && data.configKey !== configKey) return null;
        return data;
    } catch {
        return null;
    }
}

function setSnapshotPrereqCache(result, configKey) {
    try {
        sessionStorage.setItem(SNAPSHOT_PREREQ_CACHE_KEY, JSON.stringify({
            result,
            checkedAt: Date.now(),
            configKey: configKey || ''
        }));
    } catch (_) {}
}

let lastSnapshotPrereqResult = null;

function formatSnapshotPrereqHtml(result) {
    lastSnapshotPrereqResult = result;
    const isReady = result.gitFound && result.branchReady;
    const latencyHtml = result.latencyMs != null
        ? `<span class="snapshot-prereq-latency ${result.latencyMs > 1000 ? 'warn' : ''}">⚡ ${result.latencyMs}ms</span>`
        : '';
    const attemptText = result.attempts ? ` · ${snapshotText('尝试', 'Attempt')} ${result.attempts}/${result.maxAttempts || 10}` : '';
    return `<div><strong>${isReady ? navEscape(snapshotText('运行环境就绪', 'Environment ready')) : navEscape(snapshotText('运行前检查', 'Preflight check'))}${latencyHtml}</strong><p>${navEscape(result.message)}${attemptText}</p>${result.gitVersion ? `<small>${navEscape(result.gitVersion)}</small>` : ''}</div><div class="snapshot-prereq-actions">${!result.gitFound ? `<a href="https://git-scm.com/install/windows" target="_blank" rel="noopener noreferrer">${navEscape(snapshotText('Git 官方安装页', 'Official Git installer'))} ↗</a>` : ''}<a href="https://open.codehub.huawei.com/" target="_blank" rel="noopener noreferrer">${navEscape(snapshotText('打开 CodeHub · 查看右上角帮助中心', 'Open CodeHub · Help Center'))} ↗</a><button type="button" class="snapshot-prereq-log-btn" onclick="openSnapshotPrereqLogs()">${navEscape(snapshotText('详细检测日志', 'Detailed check logs'))}</button><button type="button" onclick="checkSnapshotPrerequisites({ force: true })">${navEscape(snapshotText('重新检测', 'Check again'))}</button></div>`;
}

let snapshotEstimateAbortController = null;

window.toggleSnapshotToolPassword = function (slug) {
    const enabled = document.getElementById('snapshotEncryptionEnabled_' + slug)?.checked;
    const row = document.getElementById('snapshotPasswordRow_' + slug);
    if (row) row.style.display = enabled ? '' : 'none';
};

window.toggleSnapshotToolPasswordVisibility = function (slug) {
    const input = document.getElementById('snapshotPassword_' + slug);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
};

window.toggleSnapshotPasswordInput = function () {
    window.toggleSnapshotToolPassword('department-reward-penalty');
};

window.toggleSnapshotPasswordVisibility = function () {
    window.toggleSnapshotToolPasswordVisibility('department-reward-penalty');
};

window.checkSnapshotPrerequisites = async function (options = {}) {
    const panel = document.getElementById('snapshotPrerequisites');
    if (!panel) return;
    const configKey = getSnapshotConfigKey(options.settings);
    if (!options.force) {
        const cached = getSnapshotPrereqCache(configKey);
        if (cached) {
            lastSnapshotPrereqResult = cached.result;
            panel.className = 'snapshot-prerequisites ' + (cached.result.gitFound && cached.result.branchReady ? 'ready' : 'attention');
            panel.innerHTML = formatSnapshotPrereqHtml(cached.result);
            return;
        }
    }
    panel.className = 'snapshot-prerequisites';
    panel.innerHTML = `<div><strong>${navEscape(snapshotText('正在检测 Git 与 CodeHub 连接…', 'Checking Git and CodeHub access…'))}</strong><p>${navEscape(snapshotText('正在探测本地 Git 环境与远端分支连通性（最多自动重试 10 次）…', 'Testing local Git and remote branch access (up to 10 retries)…'))}</p></div><div class="snapshot-prereq-actions">${lastSnapshotPrereqResult ? `<button type="button" class="snapshot-prereq-log-btn" onclick="openSnapshotPrereqLogs()">${navEscape(snapshotText('查看上次日志', 'View last logs'))}</button>` : ''}</div>`;
    try {
        const result = await snapshotApi('/prerequisites');
        if (!panel.isConnected) return;
        lastSnapshotPrereqResult = result;
        setSnapshotPrereqCache(result, configKey);
        panel.classList.add(result.gitFound && result.branchReady ? 'ready' : 'attention');
        panel.innerHTML = formatSnapshotPrereqHtml(result);
        const modal = document.getElementById('snapshotPrereqLogModal');
        if (modal && !modal.hidden) {
            renderSnapshotPrereqLogs(result);
        }
    } catch (error) {
        panel.classList.add('attention');
        panel.textContent = snapshotText('环境检测失败：', 'Preflight failed: ') + error.message;
    }
};

window.openSnapshotPrereqLogs = function () {
    let modal = document.getElementById('snapshotPrereqLogModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'snapshotPrereqLogModal';
        modal.className = 'snapshot-progress-overlay';
        modal.innerHTML = `
            <section class="snapshot-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshotPrereqLogTitle">
                <button type="button" class="snapshot-progress-close" aria-label="Close" onclick="closeSnapshotPrereqLogs()">×</button>
                <div class="snapshot-progress-eyebrow">GIT &amp; CODEHUB PREFLIGHT CHECK</div>
                <h2 id="snapshotPrereqLogTitle">${navEscape(snapshotText('连接检测详情', 'Connection Check Details'))}</h2>
                <p id="snapshotPrereqLogDetail"></p>
                <div id="snapshotPrereqLogMeta" class="snapshot-progress-meta"></div>
                <div class="snapshot-progress-logs-section">
                    <div class="snapshot-progress-logs-head">
                        <span><strong>${navEscape(snapshotText('详细执行与探测日志', 'Detailed Diagnostic Logs'))}</strong></span>
                        <div style="display: flex; gap: 8px;">
                            <button type="button" class="snapshot-progress-log-btn" onclick="checkSnapshotPrerequisites({ force: true })">${navEscape(snapshotText('重新检测', 'Re-check'))}</button>
                            <button type="button" class="snapshot-progress-log-btn" onclick="copySnapshotPrereqLogs()">${navEscape(snapshotText('复制日志', 'Copy Logs'))}</button>
                        </div>
                    </div>
                    <div id="snapshotPrereqTerminal" class="snapshot-progress-terminal" role="region" aria-label="Preflight check logs"></div>
                </div>
                <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
                    <button type="button" class="snapshot-progress-log-btn" style="padding: 8px 16px; font-size: 12px; font-weight: 700;" onclick="closeSnapshotPrereqLogs()">${navEscape(snapshotText('关闭', 'Close'))}</button>
                </div>
            </section>
        `;
        document.body.appendChild(modal);
    }
    modal.hidden = false;
    const result = lastSnapshotPrereqResult || getSnapshotPrereqCache(getSnapshotConfigKey())?.result;
    if (result) {
        renderSnapshotPrereqLogs(result);
    } else {
        checkSnapshotPrerequisites({ force: true });
    }
};

window.closeSnapshotPrereqLogs = function () {
    const modal = document.getElementById('snapshotPrereqLogModal');
    if (modal) modal.hidden = true;
};

function renderSnapshotPrereqLogs(result) {
    const modal = document.getElementById('snapshotPrereqLogModal');
    if (!modal) return;
    const isReady = result.gitFound && result.branchReady;
    modal.querySelector('#snapshotPrereqLogTitle').textContent = isReady
        ? snapshotText('运行环境就绪', 'Environment Ready')
        : snapshotText('环境检测未完成', 'Check Incomplete');
    modal.querySelector('#snapshotPrereqLogDetail').textContent = result.message || '';
    const metaParts = [];
    if (result.gitVersion) metaParts.push(result.gitVersion);
    if (result.latencyMs != null) metaParts.push(snapshotText(`往返延迟: ${result.latencyMs}ms`, `Latency: ${result.latencyMs}ms`));
    if (result.attempts != null) metaParts.push(snapshotText(`尝试次数: ${result.attempts}/${result.maxAttempts || 10}`, `Attempts: ${result.attempts}/${result.maxAttempts || 10}`));
    if (result.branch) metaParts.push(snapshotText(`目标分支: ${result.branch}`, `Branch: ${result.branch}`));
    modal.querySelector('#snapshotPrereqLogMeta').textContent = metaParts.join(' · ');

    const terminal = modal.querySelector('#snapshotPrereqTerminal');
    if (!terminal) return;
    const logs = Array.isArray(result.logs) ? result.logs : [];
    if (!logs.length) {
        terminal.innerHTML = `<div class="snapshot-terminal-item info"><span class="snapshot-terminal-msg">${navEscape(snapshotText('暂无详细日志。可点击“重新检测”立即执行实时探测。', 'No logs available. Click Re-check to run diagnostic.'))}</span></div>`;
        terminal.dataset.copyText = result.message || '';
        return;
    }

    const copyLines = [];
    terminal.innerHTML = logs.map(l => {
        const timeStr = l.at ? new Date(l.at).toLocaleTimeString() : '';
        const durStr = l.latencyMs != null ? `${l.latencyMs}ms` : '';
        const lineText = `[${timeStr}] [${l.stage}]${durStr ? ' (' + durStr + ')' : ''} ${l.msg}${l.cmd ? ' | $ ' + l.cmd : ''}`;
        copyLines.push(lineText);
        return `<div class="snapshot-terminal-item ${navEscape(l.type || 'info')}">` +
            `<div class="snapshot-terminal-cmd-row">` +
                `<span class="snapshot-terminal-time">${navEscape(timeStr)}</span>` +
                `<span class="snapshot-terminal-badge" style="font-size: 10px; background: rgba(255,255,255,0.1); padding: 1px 5px; border-radius: 3px; margin-right: 6px;">[${navEscape(l.stage)}]</span>` +
                (l.cmd ? `<span class="snapshot-terminal-cmd" style="margin-right: 6px; color: #7dd3fc;">$ ${navEscape(l.cmd)}</span>` : '') +
                `<span class="snapshot-terminal-msg">${navEscape(l.msg)}</span>` +
                (durStr ? `<span class="snapshot-terminal-duration" style="margin-left: auto;">${navEscape(durStr)}</span>` : '') +
            `</div>` +
        `</div>`;
    }).join('');
    terminal.dataset.copyText = copyLines.join('\n');
}

window.copySnapshotPrereqLogs = async function () {
    const terminal = document.getElementById('snapshotPrereqTerminal');
    const button = document.querySelector('#snapshotPrereqLogModal .snapshot-progress-log-btn:last-child');
    if (!terminal) return;
    const text = terminal.dataset.copyText || terminal.textContent.trim();
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        if (button) {
            const orig = button.textContent;
            button.textContent = snapshotText('已复制 ✓', 'Copied ✓');
            setTimeout(() => { button.textContent = orig; }, 2000);
        }
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (button) {
            const orig = button.textContent;
            button.textContent = snapshotText('已复制 ✓', 'Copied ✓');
            setTimeout(() => { button.textContent = orig; }, 2000);
        }
    }
};

window.saveSnapshotPublishSettings = async function (options = {}) {
    const button = document.querySelector('.snapshot-actions button');
    const indicator = document.getElementById('navSettingsSaveState');
    if (button) button.disabled = true;
    if (indicator && !options.silent) indicator.textContent = snapshotText('正在保存…', 'Saving…');
    const toolsList = [];
    document.querySelectorAll('.snapshot-tool-item[data-tool-slug]').forEach(el => {
        const slug = el.dataset.toolSlug;
        if (el.dataset.estimateState !== 'ready') {
            if (document.getElementById('snapshotToolPublic_' + slug)) toolsList.push({ toolSlug: slug, publicAccess: document.getElementById('snapshotToolPublic_' + slug).checked });
            return;
        }
        const en = document.getElementById('snapshotToolEnabled_' + slug)?.checked !== false;
        toolsList.push({ toolSlug: slug, enabled: en, ...(document.getElementById('snapshotToolPublic_' + slug) ? { publicAccess: document.getElementById('snapshotToolPublic_' + slug).checked } : {}) });
    });
    const newSettings = {
        remoteUrl: document.getElementById('snapshotRemoteUrl').value,
        repoDir: document.getElementById('snapshotRepoDir').value,
        branch: document.getElementById('snapshotBranch').value,
        file: document.getElementById('snapshotFile').value,
        publishMode: document.getElementById('snapshotPublishMode').value,
        scheduleEnabled: document.getElementById('snapshotScheduleEnabled').checked,
        intervalMinutes: Number(document.getElementById('snapshotIntervalMinutes').value),
        tools: toolsList
    };
    try {
        const saved = await snapshotApi('/settings', { method: 'PUT', body: JSON.stringify(newSettings) });
        if (indicator) indicator.textContent = snapshotText('推送配置已保存', 'Destination saved');
        (saved.tools || []).forEach(t => {
            const pwdInput = document.getElementById('snapshotPassword_' + t.toolSlug);
            if (pwdInput) {
                pwdInput.value = '';
                if (t.hasPassword) {
                    pwdInput.placeholder = snapshotText('留空表示保持当前已设置的密码', 'Leave blank to keep existing password');
                }
            }
        });
        if (!options.skipPrereq) {
            checkSnapshotPrerequisites({ force: true, settings: newSettings });
        }
        return { ok: true, saved };
    } catch (error) {
        if (indicator) indicator.textContent = snapshotText('保存失败：', 'Save failed: ') + error.message;
        return { ok: false, error: error.message };
    } finally { if (button) button.disabled = false; }
};

window.startSnapshotPublish = async function (options = {}) {
    window.snapshotLastPublishOptions = Object.assign({}, options);
    if (document.getElementById('navSettingsModal')?.style.display === 'flex'
        && document.getElementById('snapshotBranch') && document.getElementById('snapshotFile')) {
        const saveRes = await window.saveSnapshotPublishSettings({ silent: true, skipPrereq: true });
        if (saveRes && !saveRes.ok) {
            showPlatformNotice({ title: navT('nav.dialog.error'), message: snapshotText('保存推送配置失败，无法启动推送：', 'Failed to save snapshot settings before publish: ') + saveRes.error, tone: 'error' });
            return;
        }
    }
    const isForce = Boolean(options.force);
    const sizeNotice = snapshotText(' 大工具在全量与定时推送中自动跳过；只有单工具的强制推送才可更新，已发布版本保留。', ' Large tools are skipped in bulk and scheduled runs; only per-tool Force publish updates them. Published versions are retained.');
    const selectedTool = options.toolSlug ? (options.toolName || options.toolSlug) : '';
    const confirmed = await showPlatformConfirm({
        title: isForce
            ? snapshotText('确认强制重新发布快照', 'Force republish snapshot?')
            : snapshotText('确认发布只读快照', 'Publish read-only snapshot?'),
        message: (isForce
            ? snapshotText(`${selectedTool ? `仅针对「${selectedTool}」，` : '本次还会清理远端已发布但现已取消勾选的工具。'}即使文件未发生变化，本次也将强制创建 Git 提交并推送到远端仓库，以触发静态托管平台（Pages）的重新构建与部署。`, `${selectedTool ? `For ${selectedTool}, ` : 'Previously published tools that are now unchecked will also be removed from the remote. '}this will create a Git commit and push to remote even when files have not changed, triggering a Pages redeploy.`)
            : selectedTool
                ? snapshotText(`本次将根据已保存配置生成「${selectedTool}」的只读快照，并推送到目标仓库。`, `This will publish a read-only snapshot of ${selectedTool} using the saved destination settings.`)
                : snapshotText('本次将生成并推送各已启用工具的只读快照，同时从远端删除已发布但现已取消勾选的工具页面及受管理资源。请确认目标仓库及 Pages 的访问权限。', 'This will publish read-only snapshots of enabled tools and remove previously published, now unchecked tools and their managed assets from the remote. Confirm repository and Pages access first.')) + sizeNotice,
        confirmText: isForce ? snapshotText('强制推送', 'Force publish') : snapshotText('生成并推送', 'Generate & publish'),
        cancelText: snapshotText('取消', 'Cancel')
    });
    if (!confirmed) return;
    try {
        const job = await snapshotApi('/publish', { method: 'POST', body: JSON.stringify(options) });
        openSnapshotPublishProgress(job.id);
    } catch (error) {
        openSnapshotPublishProgress(null, error.message);
    }
};

window.retrySnapshotPublish = function () {
    const opts = window.snapshotLastPublishOptions || {};
    window.startSnapshotPublish(opts);
};

window.openSnapshotPublishProgress = function (jobId, initialError = '') {
    let modal = document.getElementById('snapshotProgressModal');
    if (!modal) {
        modal = document.createElement('div'); modal.id = 'snapshotProgressModal'; modal.className = 'snapshot-progress-overlay';
        modal.innerHTML = `<section class="snapshot-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshotProgressTitle"><button type="button" class="snapshot-progress-close" aria-label="Close" onclick="closeSnapshotPublishProgress()">×</button><div class="snapshot-progress-eyebrow">PUBLISHING WORKFLOW</div><h2 id="snapshotProgressTitle"></h2><p id="snapshotProgressDetail"></p><div class="snapshot-progress-bar"><i id="snapshotProgressFill"></i></div><div id="snapshotProgressMeta" class="snapshot-progress-meta"></div><div id="snapshotProgressFailureArea" class="snapshot-progress-failure-bar" style="display:none"></div><div id="snapshotProgressEntries" class="snapshot-progress-entries" aria-live="polite"></div><div class="snapshot-progress-logs-section"><div class="snapshot-progress-logs-head"><span><strong>${navEscape(snapshotText('详细执行日志', 'Detailed Execution Logs'))}</strong></span><button type="button" class="snapshot-progress-log-btn" onclick="copySnapshotPublishLogs()">${navEscape(snapshotText('复制日志', 'Copy Logs'))}</button></div><div id="snapshotProgressTerminal" class="snapshot-progress-terminal" role="region" aria-label="Detailed logs"></div></div><button type="button" class="snapshot-config-shortcut" onclick="closeSnapshotPublishProgress(); navState.settingsTab='snapshotPublish'; openNavSettingsModal()">${navEscape(snapshotText('查看推送配置与历史', 'View destination & history'))} ↗</button></section>`;
        document.body.appendChild(modal);
    }
    modal.hidden = false;
    snapshotProgressJobId = jobId || '';
    clearTimeout(snapshotProgressTimer);
    if (initialError) { renderSnapshotProgress({ status: 'failed', stage: snapshotText('无法启动推送', 'Could not start'), progress: 0, entries: [{ at: new Date().toISOString(), stage: snapshotText('启动失败', 'Start Error'), message: initialError }] }); return; }
    pollSnapshotProgress();
};

window.closeSnapshotPublishProgress = function () {
    const modal = document.getElementById('snapshotProgressModal');
    if (modal) modal.hidden = true;
    clearTimeout(snapshotProgressTimer);
};

window.copySnapshotPublishLogs = async function () {
    const terminal = document.getElementById('snapshotProgressTerminal');
    const button = document.querySelector('.snapshot-progress-log-btn');
    if (!terminal) return;
    const text = terminal.dataset.copyText || terminal.textContent.trim();
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        if (button) {
            const orig = button.textContent;
            button.textContent = snapshotText('已复制 ✓', 'Copied ✓');
            setTimeout(() => { button.textContent = orig; }, 2000);
        }
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (button) {
            const orig = button.textContent;
            button.textContent = snapshotText('已复制 ✓', 'Copied ✓');
            setTimeout(() => { button.textContent = orig; }, 2000);
        }
    }
};

function renderSnapshotProgress(job) {
    const modal = document.getElementById('snapshotProgressModal');
    if (!modal || modal.hidden) return;
    modal.querySelector('#snapshotProgressTitle').textContent = job.status === 'success' ? snapshotText('推送完成', 'Published') : job.status === 'failed' || job.status === 'interrupted' ? snapshotText('推送未完成', 'Publishing incomplete') : snapshotText('正在推送只读页面', 'Publishing read-only page');
    modal.querySelector('#snapshotProgressDetail').textContent = job.stage;
    modal.querySelector('#snapshotProgressFill').style.width = `${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`;
    modal.querySelector('#snapshotProgressFill').className = job.status;
    modal.querySelector('#snapshotProgressMeta').textContent = `${job.progress || 0}%${job.commit ? ' · ' + job.commit.slice(0, 12) : ''}`;
    const failureArea = modal.querySelector('#snapshotProgressFailureArea');
    if (failureArea) {
        if (job.status === 'failed' || job.status === 'interrupted') {
            failureArea.style.display = 'flex';
            const lastEntry = (job.entries && job.entries.length ? job.entries[job.entries.length - 1].message : '') || job.stage;
            let tip = snapshotText('建议：点击右侧“重新尝试推送”再次执行；或在全局设置中配置“本地 Git 镜像仓库”提升克隆与检查速度。', 'Tip: Click Retry Publishing on the right to try again, or configure a local mirror repository in Settings.');
            if (/体积|大小|MiB|大工具|大载荷|大文件/.test(lastEntry)) {
                tip = snapshotText('体积限制无法通过重试绕过。大工具请从自身顶部选择强制推送；业务载荷会自动分片加密。公共资源超限或远端历史含大文件时，请按日志处理。', 'Retry cannot bypass size limits. Use per-tool Force publish; business payloads are encrypted in chunks. Check logs for oversized public assets or old Git objects.');
            } else if (/文件暂存|检查变更|索引|超长|大量/i.test(lastEntry) || job.stage === '检查变更') {
                tip = snapshotText('单步提示：本次生成的工具快照包含大量文件（如多媒体或离线数据）。系统已自动放宽超时限制，可直接点击重试；若只需更新单个工具，可在该工具页面使用“独立推送”。', 'Step hint: Large number of files generated. Timeout has been extended; click Retry, or push this tool individually from its own page.');
            } else if (/网络|连接|超时|codehub|fetch|clone|push|远程/i.test(lastEntry) || /获取分支|推送远端/i.test(job.stage)) {
                tip = snapshotText('单步提示：与内网 CodeHub 连接缓慢或网络波动。系统已开启自动重试，建议确认内网 VPN 连接正常；若仓库较大，建议在设置中配置“本地 Git 镜像仓库”。', 'Step hint: CodeHub connection slow. Ensure VPN connection is active, or configure a local mirror repository.');
            }
            failureArea.innerHTML = `
                <div class="snapshot-failure-content">
                    <div class="snapshot-failure-msg"><strong>${navEscape(snapshotText('推送遇阻', 'Publishing Blocked'))}：</strong>${navEscape(lastEntry)}</div>
                    <div class="snapshot-failure-tip">${navEscape(tip)}</div>
                </div>
                <button type="button" class="snapshot-retry-btn" onclick="retrySnapshotPublish()">
                    🔄 ${navEscape(snapshotText('重新尝试推送', 'Retry Publishing'))}
                </button>
            `;
        } else {
            failureArea.style.display = 'none';
            failureArea.innerHTML = '';
        }
    }
    modal.querySelector('#snapshotProgressEntries').innerHTML = (job.entries || []).map(entry => `<div class="snapshot-progress-entry"><time>${navEscape(new Date(entry.at).toLocaleTimeString())}</time><span>${navEscape(entry.message)}</span></div>`).join('');
    const terminal = modal.querySelector('#snapshotProgressTerminal');
    if (terminal) {
        const commandLogs = job.commandLogs && job.commandLogs.length ? job.commandLogs : null;
        if (commandLogs) {
            const copyLines = [];
            terminal.innerHTML = commandLogs.map(log => {
                const timeStr = log.at ? new Date(log.at).toLocaleTimeString() : '';
                if (log.cmd) {
                    const durStr = log.durationMs != null ? `${(log.durationMs / 1000).toFixed(1)}s` : '';
                    copyLines.push(`[${timeStr}] $ ${log.cmd}${durStr ? ' (' + durStr + ')' : ''}${log.output ? '\n' + log.output : ''}`);
                    return `<div class="snapshot-terminal-item snapshot-terminal-cmd-block ${log.failed ? 'error' : ''}">` +
                        `<div class="snapshot-terminal-cmd-row">` +
                            `<span class="snapshot-terminal-time">${navEscape(timeStr)}</span>` +
                            `<span class="snapshot-terminal-prompt">$</span>` +
                            `<span class="snapshot-terminal-cmd">${navEscape(log.cmd)}</span>` +
                            (durStr ? `<span class="snapshot-terminal-duration">${navEscape(durStr)}</span>` : '') +
                        `</div>` +
                        (log.output ? `<pre class="snapshot-terminal-out">${navEscape(log.output)}</pre>` : '') +
                    `</div>`;
                }
                const msg = log.msg || '';
                copyLines.push(`[${timeStr}] [INFO] ${msg}`);
                return `<div class="snapshot-terminal-item snapshot-terminal-info-row">` +
                    `<span class="snapshot-terminal-time">${navEscape(timeStr)}</span>` +
                    `<span class="snapshot-terminal-info-tag">ℹ</span>` +
                    `<span class="snapshot-terminal-info-text">${navEscape(msg)}</span>` +
                `</div>`;
            }).join('');
            terminal.dataset.copyText = copyLines.join('\n');
            terminal.scrollTop = terminal.scrollHeight;
        } else {
            const entries = job.entries || [];
            if (!entries.length) {
                terminal.innerHTML = `<div class="snapshot-terminal-empty">${navEscape(snapshotText('等待日志输出…', 'Waiting for logs…'))}</div>`;
                terminal.dataset.copyText = '';
            } else {
                const copyLines = [];
                terminal.innerHTML = entries.map((entry, idx) => {
                    const isError = (job.status === 'failed' || job.status === 'interrupted') && idx === entries.length - 1;
                    const timeStr = new Date(entry.at).toLocaleTimeString();
                    const stageTag = entry.stage ? `[${entry.stage}] ` : '';
                    copyLines.push(`[${timeStr}] ${stageTag}${entry.message || ''}`);
                    return `<div class="snapshot-terminal-line ${isError ? 'error' : ''}"><span class="snapshot-terminal-time">${navEscape(timeStr)}</span><span class="snapshot-terminal-stage">${navEscape(stageTag)}</span><span class="snapshot-terminal-msg">${navEscape(entry.message)}</span></div>`;
                }).join('');
                terminal.dataset.copyText = copyLines.join('\n');
                terminal.scrollTop = terminal.scrollHeight;
            }
        }
    }
}

async function pollSnapshotProgress() {
    const id = snapshotProgressJobId;
    if (!id || document.getElementById('snapshotProgressModal')?.hidden) return;
    try {
        const job = await snapshotApi('/jobs/' + encodeURIComponent(id));
        if (snapshotProgressJobId !== id) return;
        renderSnapshotProgress(job);
        if (job.status === 'running') snapshotProgressTimer = setTimeout(pollSnapshotProgress, 1400);
        else {
            if (job.status === 'success') {
                const cached = getSnapshotPrereqCache();
                if (cached) {
                    cached.checkedAt = Date.now();
                    sessionStorage.setItem(SNAPSHOT_PREREQ_CACHE_KEY, JSON.stringify(cached));
                }
            }
            if (navState.settingsTab === 'snapshotPublish' && document.getElementById('navSettingsModal')?.style.display === 'flex') renderSnapshotPublishSettings(document.getElementById('navSettingsContent'));
        }
    } catch (error) {
        renderSnapshotProgress({ status: 'failed', stage: snapshotText('读取进度失败', 'Could not read progress'), progress: 0, entries: [{ at: new Date().toISOString(), stage: snapshotText('网络错误', 'Network Error'), message: error.message }] });
    }
}

function customToolBackupText(key, values = {}) {
    let text = navT(key);
    Object.entries(values).forEach(([name, value]) => {
        text = text.replaceAll(`{${name}}`, String(value));
    });
    return text;
}

function updateCustomToolBackupSelectionSummary() {
    const boxes = Array.from(document.querySelectorAll('[data-custom-backup-slug]'));
    const selected = boxes.filter(box => box.checked).length;
    const summary = document.getElementById('customToolBackupSelectionSummary');
    if (summary) summary.textContent = customToolBackupText('nav.ctbk.selected', { selected, total: boxes.length });
}

// ============================================================
// 🎬 媒体资源管理中心 (Media Resource Management)
// ============================================================
navState.mediaCategoryFilter = 'all';
navState.mediaSearchQuery = '';
navState.mediaVideosCache = [];
navState.mediaCategoriesCache = [];
navState.mediaOverviewCache = null;
navState.mediaSearchTimer = null;

window.closeMediaPreview = function () {
    const modal = document.getElementById('mediaPreviewModal');
    if (!modal) return;
    modal.querySelector('video')?.pause();
    modal.style.display = 'none';
    document.querySelector('.nav-settings-tab[data-tab="media"]')?.focus();
};

document.addEventListener('keydown', event => {
    const modal = document.getElementById('mediaPreviewModal');
    if (event.key === 'Escape' && modal?.style.display === 'flex') closeMediaPreview();
});

window.updateCustomToolBackupSelectionSummary = updateCustomToolBackupSelectionSummary;

let backupConsolePollTimer = null;
let backupConsoleSeenEntries = 0;

