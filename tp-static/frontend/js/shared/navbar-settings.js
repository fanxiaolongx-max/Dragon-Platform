/**
 * shared/navbar-settings.js - 全局设置各页签的渲染与操作（从 navbar.js 拆出）
 *
 * 由 navbar.js 的 ensureNavSettingsPack() 在首次打开全局设置时按需加载；
 * 与 navbar.js 同为普通脚本，共用全局作用域里的状态与工具函数（navState、navT、navEscape…）。
 * 这里只放打开设置后才会用到的代码：页面加载时执行的逻辑必须留在 navbar.js。
 */

function moveArrayItem(arr, index, delta) {
    const next = index + delta;
    if (index < 0 || next < 0 || next >= arr.length) return arr;
    const copy = arr.slice();
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    return copy;
}

function renderNavigationRestorePanel() {
    return `
        <section class="nav-settings-restore-card">
            <div>
                <strong>${navEscape(navT('nav.set.restore.title'))}</strong>
                <p>${navEscape(navT('nav.set.restore.desc'))}</p>
            </div>
            <div class="nav-settings-restore-actions">
                <button type="button" class="nav-settings-btn-restore" onclick="restoreSystemNavigationDefaults()">${navEscape(navT('nav.set.restore.button'))}</button>
                <button type="button" class="nav-settings-btn-setdefault" onclick="setCurrentNavigationAsDefault()">${navEscape(navT('nav.set.default.button'))}</button>
            </div>
        </section>
    `;
}

window.restoreSystemNavigationDefaults = async function () {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.set.restore.confirmTitle'),
        message: navT('nav.set.restore.confirmMessage'),
        hint: navT('nav.set.restore.confirmHint'),
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.set.restore.action')
    });
    if (!confirmed) return;

    clearTimeout(navState.saveTimer);
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.set.restore.restoring');
    try {
        const res = await fetch('/api/nav-settings/restore-defaults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: '{}'
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.settings) throw new Error(payload.error || `HTTP ${res.status}`);
        navState.settings = normalizeNavSettings(payload.settings);
        writeNavigationBootstrapCache();
        renderNavLinksFromState();
        renderNavSettingsContent();
        const nextIndicator = document.getElementById('navSettingsSaveState');
        if (nextIndicator) {
            nextIndicator.textContent = navT('nav.set.restore.success', {
                tools: Number(payload.preservedCustomToolCount || 0),
                categories: Number(payload.preservedCustomCategoryCount || 0)
            });
        }
    } catch (error) {
        const nextIndicator = document.getElementById('navSettingsSaveState');
        if (nextIndicator) nextIndicator.textContent = navT('nav.set.restore.fail') + error.message;
    }
};

window.setCurrentNavigationAsDefault = async function () {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.set.default.confirmTitle'),
        message: navT('nav.set.default.confirmMessage'),
        hint: navT('nav.set.default.confirmHint'),
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.set.default.action')
    });
    if (!confirmed) return;

    clearTimeout(navState.saveTimer);
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.set.default.saving');
    try {
        const res = await fetch('/api/nav-settings/set-as-default', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ settings: navState.settings })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.success) throw new Error(payload.error || `HTTP ${res.status}`);
        if (payload.settings) {
            navState.settings = normalizeNavSettings(payload.settings);
        }
        writeNavigationBootstrapCache();
        renderNavLinksFromState();
        renderNavSettingsContent();
        const nextIndicator = document.getElementById('navSettingsSaveState');
        if (nextIndicator) {
            nextIndicator.textContent = navT('nav.set.default.success');
        }
    } catch (error) {
        const nextIndicator = document.getElementById('navSettingsSaveState');
        if (nextIndicator) nextIndicator.textContent = navT('nav.set.default.fail') + error.message;
    }
};

function renderPrimarySettings(content) {
    const items = sortNavItems(getAllNavItems(), navState.settings.primaryIds);
    const primaryIds = new Set(navState.settings.primaryIds || []);
    content.innerHTML = `
        ${renderNavigationRestorePanel()}
        <div class="nav-settings-help">${navEscape(navT('nav.set.help.primary'))}</div>
        <div class="nav-settings-list">
            ${items.map(item => {
        const index = navState.settings.primaryIds.indexOf(item.id);
        return `
                    <div class="nav-settings-row">
                        <label class="nav-settings-check">
                            <input type="checkbox" ${primaryIds.has(item.id) ? 'checked' : ''} onchange="togglePrimaryNavItem('${navEscape(item.id)}', this.checked)">
                            <span>${item.icon} ${navEscape(getNavLabel(item))}</span>
                        </label>
                        <div class="nav-settings-actions">
                            <button onclick="movePrimaryNavItem('${navEscape(item.id)}', -1)" ${index <= 0 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.up'))}</button>
                            <button onclick="movePrimaryNavItem('${navEscape(item.id)}', 1)" ${index < 0 || index >= navState.settings.primaryIds.length - 1 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.down'))}</button>
                        </div>
                    </div>
                `;
    }).join('')}
        </div>
    `;
}

window.togglePrimaryNavItem = function (id, checked) {
    const ids = navState.settings.primaryIds || [];
    if (checked && !ids.includes(id)) ids.push(id);
    if (!checked) navState.settings.primaryIds = ids.filter(item => item !== id);
    else navState.settings.primaryIds = ids;
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

window.movePrimaryNavItem = function (id, delta) {
    const ids = navState.settings.primaryIds || [];
    const index = ids.indexOf(id);
    navState.settings.primaryIds = moveArrayItem(ids, index, delta);
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

function renderCategorySettings(content) {
    const categories = navState.settings.categories || [];
    content.innerHTML = `
        ${renderNavigationRestorePanel()}
        <div class="nav-settings-help">${navEscape(navT('nav.set.help.categories'))}</div>
        <div class="nav-settings-list">
            ${categories.map((cat, index) => `
                <div class="nav-settings-row" style="flex-wrap: wrap; gap: 8px; padding-bottom: 12px;">
                    <div style="display: flex; gap: 8px; flex: 1; min-width: min(300px, 100%);">
                        <input class="nav-settings-input" placeholder="${navEscape(navT('nav.set.placeholder.zh'))}" value="${navEscape(cat.name)}" oninput="renameNavCategory('${navEscape(cat.id)}', this.value, 'zh')">
                        <input class="nav-settings-input" placeholder="${navEscape(navT('nav.set.placeholder.en'))}" value="${navEscape(cat.nameEn || '')}" oninput="renameNavCategory('${navEscape(cat.id)}', this.value, 'en')">
                    </div>
                    <div class="nav-settings-actions" style="margin-left: auto;">
                        <button onclick="moveNavCategory(${index}, -1)" ${index === 0 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.up'))}</button>
                        <button onclick="moveNavCategory(${index}, 1)" ${index === categories.length - 1 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.down'))}</button>
                        <button onclick="deleteNavCategory('${navEscape(cat.id)}')" ${categories.length <= 1 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.delete'))}</button>
                    </div>
                </div>
            `).join('')}
        </div>
        <button class="nav-settings-add" onclick="addNavCategory()">${navEscape(navT('nav.set.btn.addCategory'))}</button>
    `;
}

window.renameNavCategory = function (id, name, lang = 'zh') {
    const cat = (navState.settings.categories || []).find(item => item.id === id);
    if (cat) {
        if (lang === 'zh') cat.name = name.trim();
        else if (lang === 'en') cat.nameEn = name.trim();
    }
    scheduleNavSettingsSave();
};

window.moveNavCategory = function (index, delta) {
    navState.settings.categories = moveArrayItem(navState.settings.categories || [], index, delta);
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

window.addNavCategory = function () {
    const id = `cat_${Date.now().toString(36)}`;
    navState.settings.categories.push({ id, name: navT('nav.set.newCategory') });
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

window.deleteNavCategory = function (id) {
    const categories = navState.settings.categories || [];
    const fallback = categories.find(item => item.id !== id);
    navState.settings.categories = categories.filter(item => item.id !== id);
    Object.keys(navState.settings.categoryByItem || {}).forEach(itemId => {
        if (navState.settings.categoryByItem[itemId] === id && fallback) {
            navState.settings.categoryByItem[itemId] = fallback.id;
        }
    });
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

function renderItemCategorySettings(content) {
    const settings = navState.settings;
    const primaryIds = new Set(settings.primaryIds || []);
    const items = sortNavItems(getAllNavItems().filter(item => !primaryIds.has(item.id)), settings.itemOrder);
    const categories = settings.categories || [];
    content.innerHTML = `
        ${renderNavigationRestorePanel()}
        <div class="nav-settings-help">${navEscape(navT('nav.set.help.items'))}</div>
        <div class="nav-settings-list">
            ${items.map((item, index) => {
        const selected = settings.categoryByItem[item.id] || item.defaultCategory || (categories[0] && categories[0].id) || '';
        return `
                    <div class="nav-settings-row">
                        <div class="nav-settings-item-name">${item.icon} ${navEscape(getNavLabel(item))}</div>
                        <select class="nav-settings-select" onchange="setNavItemCategory('${navEscape(item.id)}', this.value)">
                            ${categories.map(cat => `<option value="${navEscape(cat.id)}" ${cat.id === selected ? 'selected' : ''}>${navEscape(getNavCategoryName(cat))}</option>`).join('')}
                        </select>
                        <div class="nav-settings-actions">
                            <button onclick="moveOverflowNavItem('${navEscape(item.id)}', -1)" ${index === 0 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.up'))}</button>
                            <button onclick="moveOverflowNavItem('${navEscape(item.id)}', 1)" ${index === items.length - 1 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.down'))}</button>
                        </div>
                    </div>
                `;
    }).join('') || `<div class="nav-settings-empty">${navEscape(navT('nav.set.emptyItems'))}</div>`}
        </div>
    `;
}

window.setNavItemCategory = function (id, categoryId) {
    navState.settings.categoryByItem[id] = categoryId;
    scheduleNavSettingsSave();
};

window.moveOverflowNavItem = function (id, delta) {
    const primaryIds = new Set(navState.settings.primaryIds || []);
    const overflowIds = sortNavItems(getAllNavItems().filter(item => !primaryIds.has(item.id)), navState.settings.itemOrder).map(item => item.id);
    const moved = moveArrayItem(overflowIds, overflowIds.indexOf(id), delta);
    const primaryOrder = new Set(moved);
    const rest = (navState.settings.itemOrder || []).filter(itemId => !primaryOrder.has(itemId));
    navState.settings.itemOrder = [...moved, ...rest];
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

function sourceLabelForAiSettings(source) {
    if (source === 'stored') return navT('nav.ai.srcStored');
    if (source === 'env') return navT('nav.ai.srcEnv');
    return navT('nav.ai.srcNone');
}

function keyHealthLabelForAiSettings(settings) {
    if (!settings.hasApiKey) return navT('nav.ai.keyNone');
    if (!settings.keyLooksValid) return navT('nav.ai.keyInvalid') + (settings.maskedApiKey || '');
    return navT('nav.ai.keyValid') + (settings.maskedApiKey || '');
}

async function fetchAiSettingsForNav() {
    const res = await fetch('/api/ai-settings', { headers: getAuthHeaderForNav() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    navState.aiSettings = await res.json();
    const profiles = Array.isArray(navState.aiSettings.profiles) ? navState.aiSettings.profiles : [];
    if (!profiles.some(item => item.id === navState.aiSelectedProfileId)) {
        navState.aiSelectedProfileId = navState.aiSettings.activeProfileId || profiles[0]?.id || null;
    }
    return navState.aiSettings;
}

function formatAiUsageNumber(value) {
    const number = Number(value || 0);
    if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 1 : 2)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(number >= 100000 ? 1 : 2)}K`;
    return Math.round(number).toLocaleString();
}

function logoUploadError(error) {
    const messages = {
        LOGO_FORMAT: navLocaleText('请选择 PNG、JPG 或 WEBP 图片。', 'Choose a PNG, JPG or WEBP image.'),
        LOGO_SIZE: navLocaleText('图片不能超过 25 MB。', 'The image must be 25 MB or smaller.'),
        LOGO_DECODE: navLocaleText('无法读取图片，请检查文件是否损坏。', 'Cannot decode the image. Check that the file is valid.'),
        LOGO_BUSY: navLocaleText('正在处理另一张图标，请稍后重试。', 'Another logo is being processed. Please retry shortly.')
    };
    return messages[error.code || error.message] || error.message;
}

async function renderLogoSettings(content) {
    const text = navLocaleText;
    content.innerHTML = `<div class="nav-settings-empty">${text('正在加载平台标识…', 'Loading platform identity…')}</div>`;
    let statusData;
    try {
        const res = await fetch('/api/platform-logo/status', { headers: getAuthHeaderForNav() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        statusData = await res.json();
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${text('无法读取图标状态：', 'Could not load logo status: ')}${navEscape(error.message)}</div>`;
        return;
    }
    const logoUrl = navEscape(statusData.logoUrl || './tp-static/frontend/assets/logo.png');
    const timestamp = statusData.updatedAt ? new Date(statusData.updatedAt).toLocaleString() : text('默认内置', 'Bundled default');
    const runtime = statusData.storageMode === 'runtime';
    content.innerHTML = `
        <div class="logo-settings-container">
            <div class="logo-settings-card">
                <h3>✏️ ${text('平台标识与名称设定', 'Platform identity & names')}</h3>
                <p>${text('支持配置中英文主名称、副标题与登录页专属标语。在中文界面优先显示中文名称，英文界面自动倒置为主英辅中。保存后自动同步为平台全局默认配置。', 'Configure Chinese and English platform names, subtitle and login slogan. Display order reverses automatically based on current language. Saved values become the system defaults.')}</p>
                <form onsubmit="event.preventDefault(); savePlatformName()">
                    <input type="hidden" id="platformNameInput" value="${navEscape(navState.settings.platformName || 'Dragon Claw')}">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:14px;margin-top:12px;">
                        <div>
                            <label for="platformNameZhInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">🇨🇳 ${text('主名称 (中文)', 'Main Name (Chinese)')}</label>
                            <input id="platformNameZhInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="80" value="${navEscape(navState.settings.platformNameZh || (/[^\x00-\x7F]/.test(navState.settings.platformName || '') ? navState.settings.platformName : 'Dragon Claw'))}" placeholder="Dragon Claw" autocomplete="off" oninput="document.getElementById('platformNameInput').value = this.value">
                        </div>
                        <div>
                            <label for="platformNameEnInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">🇬🇧 ${text('主名称 (英文)', 'Main Name (English)')}</label>
                            <input id="platformNameEnInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="80" value="${navEscape(navState.settings.platformNameEn || (!/[^\x00-\x7F]/.test(navState.settings.platformName || '') && navState.settings.platformName ? navState.settings.platformName : 'Dragon Claw'))}" placeholder="Dragon Claw" autocomplete="off">
                        </div>
                        <div>
                            <label for="platformSubtitleInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">📑 ${text('页面副标题 (中文)', 'Page Subtitle (Chinese)')}</label>
                            <input id="platformSubtitleInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="120" value="${navEscape(navState.settings.platformSubtitle || '埃及 CS 工具与知识中心')}" placeholder="埃及 CS 工具与知识中心" autocomplete="off">
                        </div>
                        <div>
                            <label for="platformSubtitleEnInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">📑 ${text('页面副标题 (英文)', 'Page Subtitle (English)')}</label>
                            <input id="platformSubtitleEnInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="120" value="${navEscape(navState.settings.platformSubtitleEn || 'Egypt CS Tools & Knowledge Center')}" placeholder="Egypt CS Tools & Knowledge Center" autocomplete="off">
                        </div>
                        <div style="grid-column: 1 / -1;">
                            <label for="platformSloganInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">✨ ${text('登录页标语 (中文)', 'Login Page Slogan (Chinese)')}</label>
                            <input id="platformSloganInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="200" value="${navEscape(navState.settings.platformSlogan || '“认真做好每一个工具，让日常工作更省心。”')}" placeholder="“认真做好每一个工具，让日常工作更省心。”" autocomplete="off">
                        </div>
                        <div style="grid-column: 1 / -1;">
                            <label for="platformSloganEnInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">✨ ${text('登录页标语 (英文)', 'Login Page Slogan (English)')}</label>
                            <input id="platformSloganEnInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="200" value="${navEscape(navState.settings.platformSloganEn || '“Build every tool with care. Make everyday work easier.”')}" placeholder="“Build every tool with care. Make everyday work easier.”" autocomplete="off">
                        </div>
                    </div>
                    <div style="margin-top:14px">
                        <label for="platformGuideVideoUrlInput">${text('平台使用介绍视频（可选）', 'Platform introduction video (optional)')}</label>
                        <input type="url" id="platformGuideVideoUrlInput" class="nav-settings-input" style="width:100%;box-sizing:border-box;margin-top:6px" maxlength="2048" value="${navEscape(navState.settings.platformGuideVideoUrl || '')}" placeholder="https://…">
                        <p style="font-size:12px;opacity:.7">${text('AI 回答平台使用问题时附上此链接；清空后关闭视频推荐。', 'AI adds this link to platform usage answers. Leave blank to disable.')}</p>
                    </div>
                    <div class="nav-settings-actions" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px">
                        <button type="submit" class="primary" id="platformNameSaveBtn">${text('保存标识设置', 'Save identity settings')}</button>
                        <span id="platformNameSaveStatus" role="status" style="font-size:12px"></span>
                    </div>
                </form>
            </div>
            <div class="logo-ci-banner">
                <strong>✦ ${text('平台品牌与应用图标', 'Platform branding and app icons')}</strong>
                <span>${runtime
                    ? text('新 Logo 保存在本机用户数据目录，页面、浏览器图标及运行中的托盘图标会更新，重启后仍保留。', 'Your logo is saved in local user data. Pages, favicons and the running tray update, and the logo persists after restart.')
                    : text('上传后生成页面 Logo、浏览器图标及各平台打包图标，可将生成的资源提交到源码仓库用于下次打包。', 'Uploading generates page logos, favicons and packaging assets. Commit the generated assets to your source repository for the next build.')}</span><br>
                <span>${text('EXE 文件图标、macOS 应用包与安装包图标在重新打包后生效。', 'EXE file icons, macOS application bundles and installer icons change after rebuilding.')}</span>
            </div>
            <div class="logo-settings-card">
                <h3>👁 ${text('实时多场景预览', 'Live previews')}</h3>
                <p>${text('检查透明边缘、浅色背景和桌面图标的清晰度。', 'Check transparent edges, light backgrounds and desktop icon clarity.')}</p>
                <div class="logo-preview-grid">
                    <div class="logo-preview-box dark-bg">
                        <span class="logo-preview-tag">${text('深色背景', 'Dark background')}</span>
                        <div class="logo-preview-img-row">
                            <div style="text-align:center"><img src="${logoUrl}" alt="Logo 24px" class="brand-logo-img" style="width:24px;height:24px;object-fit:contain"><div>24px</div></div>
                            <div style="text-align:center"><img src="${logoUrl}" alt="Logo 72px" style="width:72px;height:72px;object-fit:contain"><div>72px</div></div>
                        </div>
                    </div>
                    <div class="logo-preview-box light-bg">
                        <span class="logo-preview-tag">${text('浅色背景', 'Light background')}</span>
                        <img src="${logoUrl}" alt="Logo" style="width:72px;height:72px;object-fit:contain">
                    </div>
                    <div class="logo-preview-box neutral-bg">
                        <span class="logo-preview-tag">${text('桌面应用图标预览', 'Desktop icon preview')}</span>
                        <div class="logo-preview-img-row">
                            <div style="text-align:center"><img src="./tp-static/frontend/assets/icon-windows.png?t=${statusData.updatedAt}" alt="Standard" style="width:48px;height:48px;object-fit:contain"><div>${text('标准版', 'Standard')}</div></div>
                            <div style="text-align:center"><img src="./tp-static/frontend/assets/icon-windows-portable.png?t=${statusData.updatedAt}" alt="Portable" style="width:48px;height:48px;object-fit:contain"><div>${text('便携版（P 标）', 'Portable (P)')}</div></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="logo-settings-card">
                <h3>📤 ${text('上传 Logo 并生成各尺寸', 'Upload a logo and generate all sizes')}</h3>
                <p>${text('支持 PNG、JPG、JPEG、WEBP，最大 25 MB；建议使用 512×512 或更高分辨率。', 'PNG, JPG, JPEG and WEBP, up to 25 MB; 512×512 or higher is recommended.')}</p>
                <div class="logo-upload-zone" id="logoDropZone" onclick="document.getElementById('logoFileInput').click()">
                    <span class="logo-upload-icon">📁</span>
                    <span class="logo-upload-title" id="logoUploadTitle">${text('点击选择图片，或拖拽到此处', 'Choose an image or drop it here')}</span>
                    <span class="logo-upload-hint">${text('支持白底和透明底，保留图标比例及透明图片内部白色细节。', 'White or transparent backgrounds; preserves proportions and white details in transparent artwork.')}</span>
                    <input type="file" id="logoFileInput" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="handleLogoFileSelect(event)">
                </div>
                <div class="logo-option-row">
                    <label class="logo-option-item"><input type="checkbox" id="logoOptCropBottom" checked><span><b>${text('自动裁切下方附加文本（推荐，仅保留核心主体徽标）', 'Auto crop bottom text (recommended: keep main badge only)')}</b></span></label>
                    <label class="logo-option-item"><input type="checkbox" id="logoOptRemoveBg" checked><span><b>${text('移除外围白色背景', 'Remove outer white background')}</b></span></label>
                    <label class="logo-option-item"><input type="checkbox" id="logoOptDarkEnhance" checked><span><b>${text('暗色背景边缘微光', 'Subtle edge glow on dark backgrounds')}</b></span></label>
                </div>
                <div class="nav-settings-actions" style="margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                    <button type="button" class="primary" id="logoUploadSubmitBtn" onclick="submitLogoUpload()" disabled>${text('生成并应用图标', 'Generate and apply icons')}</button>
                    <button type="button" id="logoDownloadBundleBtn" onclick="downloadLogoBundle()" ${statusData.hasLogo ? '' : 'disabled'}>📦 ${text('一键下载全部运营物料资产包 (.zip)', 'Download brand assets bundle (.zip)')}</button>
                    <span id="logoUploadStatus" role="status" style="font-size:12px">${text('最近更新：', 'Last updated: ')}${navEscape(timestamp)}</span>
                </div>
                <label for="logoStoreScreenshots" style="display:block;margin-top:14px;font-size:12px">${text('商店截图（可选，1–5 张 PNG/JPEG，每张不超过 10 MB）', 'Store screenshots (optional, 1–5 PNG/JPEG files, up to 10 MB each)')}</label>
                <input id="logoStoreScreenshots" type="file" accept="image/png,image/jpeg" multiple style="display:block;margin-top:8px;max-width:100%">
                <p style="font-size:12px;margin-top:8px">${text('资产包包含商店图标 128×128、小型宣传图 440×280、顶部宣传图 1400×560 和标准宣传截图 1280×800。未选择截图时由服务端自动生成标准宣传截图；若用于插件上架，可选择该插件的真实界面截图。视频需自行上传 YouTube 后填写网址。', 'Includes a 128×128 store icon, 440×280 small promo, 1400×560 marquee and standard 1280×800 promo screenshots. With no selected images, the server automatically generates standard promo screenshots. For an extension listing, you can select actual screenshots of that extension. Upload videos to YouTube separately.')}</p>
                <div id="logoUploadResultDetail" style="margin-top:12px;font-size:11px;white-space:pre-wrap;display:none"></div>
            </div>
        </div>`;
    const dropZone = document.getElementById('logoDropZone');
    dropZone.ondragover = event => { event.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = event => {
        event.preventDefault(); dropZone.classList.remove('dragover');
        if (event.dataTransfer.files?.[0]) handleLogoFileSelect({ target: { files: event.dataTransfer.files } });
    };
}

window.savePlatformName = async function () {
    const input = document.getElementById('platformNameInput');
    const button = document.getElementById('platformNameSaveBtn');
    const status = document.getElementById('platformNameSaveStatus');
    if (!input || !button || button.disabled) return;

    const zhInput = document.getElementById('platformNameZhInput');
    const enInput = document.getElementById('platformNameEnInput');
    const subInput = document.getElementById('platformSubtitleInput');
    const subEnInput = document.getElementById('platformSubtitleEnInput');
    const sloganInput = document.getElementById('platformSloganInput');
    const sloganEnInput = document.getElementById('platformSloganEnInput');

    const clean = (val, max = 120) => typeof val === 'string'
        ? val.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
        : '';

    const rawInput = clean(input.value, 80);
    const platformNameZh = zhInput
        ? (clean(zhInput.value, 80) || rawInput || 'Dragon Claw')
        : (rawInput || 'Dragon Claw');
    const platformNameEn = enInput
        ? (clean(enInput.value, 80) || navState.settings?.platformNameEn || 'Dragon Claw')
        : (rawInput || 'Dragon Claw');
    const platformSubtitle = (subInput ? clean(subInput.value, 120) : '') || navState.settings?.platformSubtitle || '埃及 CS 工具与知识中心';
    const platformSubtitleEn = (subEnInput ? clean(subEnInput.value, 120) : '') || navState.settings?.platformSubtitleEn || 'Egypt CS Tools & Knowledge Center';
    const platformSlogan = (sloganInput ? clean(sloganInput.value, 200) : '') || navState.settings?.platformSlogan || '“认真做好每一个工具，让日常工作更省心。”';
    const platformSloganEn = (sloganEnInput ? clean(sloganEnInput.value, 200) : '') || navState.settings?.platformSloganEn || '“Build every tool with care. Make everyday work easier.”';
    const platformName = rawInput || platformNameZh;

    button.disabled = true;
    if (status) status.textContent = navT('nav.set.saving');
    clearTimeout(navState.saveTimer);
    try {
        const response = await fetch('/api/nav-settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({
                ...navState.settings,
                platformGuideVideoUrl: document.getElementById('platformGuideVideoUrlInput')?.value.trim() ?? navState.settings.platformGuideVideoUrl,
                platformName,
                platformNameZh,
                platformNameEn,
                platformSubtitle,
                platformSubtitleEn,
                platformSlogan,
                platformSloganEn
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        navState.settings = normalizeNavSettings(data);
        writeNavigationBootstrapCache();
        renderNavLinksFromState();
        input.value = navState.settings.platformName;
        if (zhInput) zhInput.value = navState.settings.platformNameZh;
        if (enInput) enInput.value = navState.settings.platformNameEn;
        if (subInput) subInput.value = navState.settings.platformSubtitle;
        if (subEnInput) subEnInput.value = navState.settings.platformSubtitleEn;
        if (sloganInput) sloganInput.value = navState.settings.platformSlogan;
        if (sloganEnInput) sloganEnInput.value = navState.settings.platformSloganEn;
        if (status) status.textContent = navT('nav.set.saved');
    } catch (error) {
        if (status) status.textContent = navT('nav.set.saveFail') + error.message;
    } finally {
        button.disabled = false;
    }
};

window.handleLogoFileSelect = function (event) {
    const file = event.target.files?.[0];
    if (!file) return;
    window._selectedLogoFile = file;
    const title = document.getElementById('logoUploadTitle');
    if (title) title.textContent = `${navLocaleText('已选择：', 'Selected: ')}${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    const button = document.getElementById('logoUploadSubmitBtn');
    if (button) button.disabled = false;
};

window.submitLogoUpload = async function () {
    const file = window._selectedLogoFile || document.getElementById('logoFileInput')?.files?.[0];
    if (!file) {
        await showNavbarNotice({ title: navLocaleText('选择图片', 'Choose an image'), message: navLocaleText('请先选择 Logo 图片。', 'Select a logo image first.') });
        return;
    }
    const button = document.getElementById('logoUploadSubmitBtn');
    if (button?.disabled) return;
    const status = document.getElementById('logoUploadStatus');
    const detail = document.getElementById('logoUploadResultDetail');
    const cropBottom = document.getElementById('logoOptCropBottom')?.checked ?? true;
    const removeBg = document.getElementById('logoOptRemoveBg')?.checked ?? true;
    const darkEnhance = document.getElementById('logoOptDarkEnhance')?.checked ?? true;
    if (button) { button.disabled = true; button.textContent = navLocaleText('正在生成…', 'Generating…'); }
    if (status) status.textContent = navLocaleText('正在处理图片并生成 PNG / ICO / BMP…', 'Processing image and generating PNG / ICO / BMP…');
    if (detail) { detail.style.display = 'none'; detail.textContent = ''; }
    try {
        const prepared = await window.PlatformLogoUpload.prepareFile(file);
        const body = new FormData();
        body.append('logo', prepared);
        body.append('cropBottomText', String(cropBottom));
        body.append('removeBg', String(removeBg));
        body.append('darkEnhance', String(darkEnhance));
        const response = await fetch('/api/platform-logo/upload', { method: 'POST', headers: getAuthHeaderForNav(), body });
        const data = await response.json().catch(() => { throw new Error(navLocaleText(`服务返回异常（HTTP ${response.status}），请检查后端或代理。`, `Unexpected response (HTTP ${response.status}); check the backend or proxy.`)); });
        if (!response.ok || !data.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.code = data.code; throw error; }
        document.querySelectorAll('.brand-logo-img, .hero-logo-img, #navBrandLogo, #homeHeroLogo').forEach(image => { image.src = data.logoUrl; });
        const favicon = document.querySelector('link[rel="icon"]');
        if (favicon) favicon.href = `/favicon.ico?t=${data.updatedAt}`;
        const content = document.getElementById('navSettingsContent');
        if (content && navState.settingsTab === 'logo') await renderLogoSettings(content);
        const updatedStatus = document.getElementById('logoUploadStatus');
        if (updatedStatus) updatedStatus.textContent = navLocaleText(`已生成 ${data.assetCount} 处图标并应用。`, `Generated and applied ${data.assetCount} icon assets.`);
        const downloadBtn = document.getElementById('logoDownloadBundleBtn');
        if (downloadBtn) downloadBtn.disabled = false;
    } catch (error) {
        const message = logoUploadError(error);
        if (status) status.textContent = navLocaleText('处理失败：', 'Failed: ') + message;
        await showNavbarNotice({ title: navLocaleText('图标更新失败', 'Logo update failed'), message, tone: 'error' });
    } finally {
        if (button) { button.disabled = false; button.textContent = navLocaleText('生成并应用图标', 'Generate and apply icons'); }
    }
};

// 平台服务的每个响应都带 X-Request-Id（server.js 请求 ID 中间件）；缺失说明请求被本机代理、
// 企业安全软件或网关拦截，没有到达平台服务，给出可排查的提示而不是只有状态码。
async function describeLogoBundleFailure(response) {
    const requestId = response.headers.get('x-request-id');
    const raw = await response.text().catch(() => '');
    let data = {};
    try { data = JSON.parse(raw); } catch (_) {}
    if (data.error) return requestId ? `${data.error} (${requestId})` : data.error;
    if (response.status === 403) {
        const adminMsg = navLocaleText('权限不足，需要超级管理员账号 (HTTP 403)', 'Permission denied: Super administrator role required (HTTP 403)');
        return requestId ? `${adminMsg} (${requestId})` : adminMsg;
    }
    if (!requestId) {
        return navLocaleText(
            `HTTP ${response.status}：请求未到达平台服务，可能被本机代理或企业安全软件（如上传/DLP 管控）拦截`,
            `HTTP ${response.status}: the request never reached the platform service; a local proxy or security software (upload/DLP control) may have blocked it`
        );
    }
    return `HTTP ${response.status} (${requestId})`;
}

window.downloadLogoBundle = async function () {
    const button = document.getElementById('logoDownloadBundleBtn');
    const status = document.getElementById('logoUploadStatus');
    const originalText = button ? button.textContent : '';
    if (button) {
        button.disabled = true;
        button.textContent = navLocaleText('正在打包资产…', 'Packaging assets…');
    }
    if (status) status.textContent = navLocaleText('正在打包全套运营物料与各端徽标，请稍候…', 'Packaging brand and icon assets, please wait…');
    try {
        const screenshotInput = document.getElementById('logoStoreScreenshots');
        const customFiles = Array.from(screenshotInput?.files || []);
        let response;

        if (customFiles.length > 0) {
            // 用户显式上传了自定义截图：使用 store-assets 验证并以 multipart/form-data POST 上传
            if (!window.ToolsStoreAssets) await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = './tp-static/frontend/js/shared/store-assets.js';
                script.onload = resolve;
                script.onerror = () => reject(new Error(navLocaleText('无法加载商店物料组件', 'Store assets component could not load')));
                document.head.appendChild(script);
            });
            const body = await window.ToolsStoreAssets.form(customFiles);
            response = await fetch('/api/platform-logo/download-bundle', {
                method: 'POST',
                body,
                headers: getAuthHeaderForNav()
            });
        } else {
            // 默认情况：前端单纯发起 GET 下载请求，全套物料与标准宣传截图由服务端纯后台生成，无需前端截屏与大文件 POST
            const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token') || '';
            const downloadUrl = token ? `/api/platform-logo/download-bundle?token=${encodeURIComponent(token)}` : '/api/platform-logo/download-bundle';
            response = await fetch(downloadUrl, {
                method: 'GET',
                headers: getAuthHeaderForNav()
            });
        }

        if (!response.ok) throw new Error(await describeLogoBundleFailure(response));
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match ? match[1] : `brand-assets-${new Date().toISOString().slice(0, 10)}.zip`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (status) status.textContent = `${navLocaleText('下载完成：', 'Downloaded: ')}${filename} (${(blob.size / 1024).toFixed(1)} KB)`;
    } catch (error) {
        await showNavbarNotice({
            title: navLocaleText('物料包下载失败', 'Download failed'),
            message: error.message || navLocaleText('无法下载运营物料资产包', 'Could not download brand assets bundle'),
            tone: 'error'
        });
        if (status) status.textContent = navLocaleText('下载失败：', 'Download failed: ') + error.message;
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
};

function buildAiUsageChart(series) {
    const rows = Array.isArray(series) ? series : [];
    const width = 720, height = 260, left = 62, right = 24;
    const plotWidth = width - left - right;
    const tokenBand = { top: 24, height: 78 };
    const costBand = { top: 132, height: 78 };
    const maxTokens = Math.max(1, ...rows.map(item => Number(item.tokens || 0)));
    const maxCost = Math.max(0.000001, ...rows.map(item => Number(item.costCny || 0)));
    const x = index => rows.length <= 1 ? left + plotWidth / 2 : left + index * plotWidth / (rows.length - 1);
    const bandY = (value, max, band) => band.top + band.height - Number(value || 0) / max * band.height;
    const tokenY = value => bandY(value, maxTokens, tokenBand);
    const costY = value => bandY(value, maxCost, costBand);
    const tokenPoints = rows.map((item, index) => `${x(index).toFixed(1)},${tokenY(item.tokens).toFixed(1)}`).join(' ');
    const costPoints = rows.map((item, index) => `${x(index).toFixed(1)},${costY(item.costCny).toFixed(1)}`).join(' ');
    const labelStep = Math.max(1, Math.ceil(rows.length / 7));
    const grid = [tokenBand, costBand].map(band => [0, .5, 1].map(rate => {
        const y = band.top + band.height * rate;
        return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="nav-ai-chart-grid"/>`;
    }).join('')).join('');
    const labels = rows.map((item, index) => (index % labelStep === 0 || index === rows.length - 1)
        ? `<text x="${x(index)}" y="${height - 9}" text-anchor="middle" class="nav-ai-chart-label">${navEscape(item.label)}</text>`
        : '').join('');
    const tokenDots = rows.map((item, index) => `<circle cx="${x(index)}" cy="${tokenY(item.tokens)}" r="3" class="nav-ai-chart-token-dot"><title>${navEscape(item.label)} · ${Number(item.tokens || 0).toLocaleString()} Tokens</title></circle>`).join('');
    const costDots = rows.map((item, index) => `<circle cx="${x(index)}" cy="${costY(item.costCny)}" r="3" class="nav-ai-chart-cost-dot"><title>${navEscape(item.label)} · ¥${Number(item.costCny || 0).toFixed(4)}</title></circle>`).join('');
    return `<svg class="nav-ai-usage-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${navEscape(navT('nav.ai.usageTitle'))}">
        ${grid}
        <text x="8" y="${tokenBand.top + 10}" class="nav-ai-chart-band-title token">Token</text>
        <text x="8" y="${tokenBand.top + 24}" class="nav-ai-chart-band-max">${navEscape(formatAiUsageNumber(maxTokens))}</text>
        <polyline points="${tokenPoints}" class="nav-ai-chart-token-line"/>${tokenDots}
        <text x="8" y="${costBand.top + 10}" class="nav-ai-chart-band-title cost">${navEscape(navT('nav.ai.usageChartCost'))}</text>
        <text x="8" y="${costBand.top + 24}" class="nav-ai-chart-band-max">¥${Number(maxCost).toFixed(4)}</text>
        <polyline points="${costPoints}" class="nav-ai-chart-cost-line"/>${costDots}${labels}
    </svg>`;
}

function renderAiUsageDashboard(data) {
    const host = document.getElementById('navAiUsageBody');
    if (!host) return;
    const models = Array.isArray(data?.models) ? data.models : [];
    // Model buttons only for models configured in a profile now; older ones stay in the detail list below for clearing.
    // Usage is grouped per profile and model: a group counts when that profile still exists and still uses that model.
    const profiles = navState.aiSettings?.profiles || [];
    const configured = new Set(profiles.map(profile => `${profile.id}|${profile.provider}|${profile.model}`));
    const isConfigured = item => configured.has(`${item.profileId}|${item.provider}|${item.model}`);
    const shownModels = configured.size ? models.filter(isConfigured) : models;
    const selectedKey = navState.aiUsageModelKey || 'all';
    const selectedModel = shownModels.find(item => item.key === selectedKey) || null;
    if (selectedKey !== 'all' && !selectedModel) navState.aiUsageModelKey = 'all';
    const totals = selectedModel?.totals || data?.totals || {};
    const series = Array.isArray(selectedModel?.series) ? selectedModel.series : (Array.isArray(data?.series) ? data.series : []);
    const period = series.reduce((sum, item) => ({ tokens: sum.tokens + Number(item.tokens || 0), costCny: sum.costCny + Number(item.costCny || 0) }), { tokens: 0, costCny: 0 });
    const unclassified = data?.unclassified || {};
    host.innerHTML = `
        <div style="margin:12px 0 10px;display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding-bottom:3px;">
            <button type="button" class="nav-settings-add ${selectedModel ? 'secondary' : ''}" onclick="setAiUsageModel('all')" style="margin:0;white-space:nowrap;">${navEscape(navT('nav.ai.usageAllModels'))}</button>
            ${shownModels.map(item => `<button type="button" class="nav-settings-add ${selectedModel?.key === item.key ? '' : 'secondary'}" onclick="setAiUsageModel('${navEscape(item.key)}')" style="margin:0;white-space:nowrap;">${navEscape(item.profileName || item.provider)} · ${navEscape(item.model)} · ${formatAiUsageNumber(item.totals?.tokens)}</button>`).join('')}
            ${selectedModel ? `
                <button type="button" class="nav-settings-add danger" onclick="clearSelectedModelAiUsage()" style="margin:0 0 0 auto;white-space:nowrap;font-size:12px;padding:3px 10px;height:28px;" title="${navEscape(navT('nav.ai.clearSelectedHint'))}">🗑 ${navEscape(navT('nav.ai.clearModelUsage'))}</button>
            ` : (models.length > 0 ? `
                <button type="button" class="nav-settings-add secondary" onclick="promptClearAllAiUsage()" style="margin:0 0 0 auto;white-space:nowrap;font-size:12px;padding:3px 10px;height:28px;" title="${navEscape(navT('nav.ai.clearAllHint'))}">🗑 ${navEscape(navT('nav.ai.clearAllModelUsage'))}…</button>
            ` : '')}
        </div>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px;">${navEscape(navT('nav.ai.usageByModel'))}${Number(unclassified.tokens || 0) > 0 ? ` · ${navEscape(navT('nav.ai.usageLegacy'))} ${formatAiUsageNumber(unclassified.tokens)} Tokens` : ''}</div>
        <div class="nav-ai-usage-kpis">
            <div><span>${navEscape(navT('nav.ai.usageTokens'))}</span><strong>${formatAiUsageNumber(totals.tokens)}</strong><small>${Number(totals.tokens || 0).toLocaleString()} tokens</small></div>
            <div><span>${navEscape(navT('nav.ai.usageCostCny'))}</span><strong>¥${Number(totals.costCny || 0).toFixed(4)}</strong><small>${navEscape(navT('nav.ai.usageCostUsd'))} $${Number(totals.costUsd || 0).toFixed(4)}</small></div>
            <div><span>${navEscape(navT('nav.ai.usageRequests'))}</span><strong>${Number(totals.requests || 0).toLocaleString()}</strong><small>${navEscape(navT('nav.ai.usagePeriod'))} ${formatAiUsageNumber(period.tokens)} tokens</small></div>
        </div>
        <div class="nav-ai-usage-legend"><span class="tokens">Token</span><span class="cost">${navEscape(navT('nav.ai.costLegend'))}</span><b>${navEscape(navT('nav.ai.usagePeriod'))}：${formatAiUsageNumber(period.tokens)} Tokens · ¥${period.costCny.toFixed(4)}</b></div>
        <div class="nav-ai-chart-wrap">${buildAiUsageChart(series)}</div>
        ${models.length > 0 ? `
        <div class="nav-ai-usage-history" style="margin-top:12px;background:var(--v2-side, rgba(248,250,252,0.78));border:1px solid var(--v2-line, #e2e8f0);border-radius:10px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
                <span style="font-size:12px;font-weight:600;color:var(--v2-ink, #334155);">${navEscape(navT('nav.ai.usageHistory'))} (${models.length})</span>
                <span style="font-size:11px;color:var(--v2-ink3, #64748b);">${navEscape(navT('nav.ai.usageHistoryHelp'))}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;max-height:150px;overflow-y:auto;padding-right:2px;">
                ${models.map(item => {
                    const displayName = `${item.profileName || item.provider} · ${item.model}`;
                    return `
                    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--v2-chip, #fff);border:1px solid var(--v2-line, #edf2f7);border-radius:8px;padding:5px 9px;font-size:12px;">
                        <div style="display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                            <strong style="color:var(--v2-ink, #1e293b);">${navEscape(displayName)}</strong>${configured.size && !isConfigured(item) ? `<em style="font-style:normal;font-size:10.5px;color:var(--v2-ink3, #94a3b8);border:1px solid var(--v2-line, #e2e8f0);border-radius:8px;padding:0 6px;">${navEscape(navT('nav.ai.unconfigured'))}</em>` : ''}
                            <span style="color:var(--v2-ink3, #64748b);font-size:11px;">(${formatAiUsageNumber(item.totals?.tokens)} Tokens · ¥${Number(item.totals?.costCny || 0).toFixed(4)})</span>
                        </div>
                        <button type="button" class="nav-settings-add danger" onclick="clearSpecificModelUsage('${navEscape(item.key)}', '${navEscape(displayName)}', ${item.totals?.tokens || 0}, ${Number(item.totals?.costCny || 0).toFixed(4)})" style="margin:0;font-size:11px;padding:2px 8px;height:24px;line-height:20px;" title="${navEscape(navT('nav.ai.clearModelUsage'))}">🗑 ${navEscape(navT('nav.ai.clearModelUsage'))}</button>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}
    `;
}

window.setAiUsageModel = function (key) {
    navState.aiUsageModelKey = key || 'all';
    if (navState.aiUsageData) renderAiUsageDashboard(navState.aiUsageData);
};

window.clearSpecificModelUsage = async function (key, displayName, tokens, costCny) {
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('清空模型统计信息', 'Clear Model Statistics'),
        message: navLocaleText(
            `确定清空模型 “${displayName}” 的全部历史 Token 用量与计费统计吗？`,
            `Clear all historical token usage and cost statistics for “${displayName}”?`
        ),
        hint: navLocaleText(
            `当前累计：${formatAiUsageNumber(tokens)} Tokens，¥${costCny} 元。清空后不可恢复。`,
            `Current totals: ${formatAiUsageNumber(tokens)} Tokens, ¥${costCny}. This cannot be undone.`
        ),
        tone: 'danger',
        confirmText: navLocaleText('确认清空', 'Clear Statistics')
    });
    if (!confirmed) return;

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.ai.clearingModel');
    try {
        const res = await fetch(`/api/ai-settings/usage?key=${encodeURIComponent(key)}`, {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (navState.aiUsageModelKey === key) navState.aiUsageModelKey = 'all';
        if (indicator) indicator.textContent = `${navT('nav.ai.clearedModel', { name: displayName })}`;
        await loadAiUsageDashboard(navState.aiUsageDimension);
    } catch (err) {
        if (indicator) indicator.textContent = navT('nav.ai.clearFail') + err.message;
        showNavbarNotice({ title: navT('nav.dialog.error'), message: navT('nav.ai.clearStatsFail') + err.message, tone: 'error' });
    }
};

window.clearSelectedModelAiUsage = async function () {
    const models = Array.isArray(navState.aiUsageData?.models) ? navState.aiUsageData.models : [];
    const selected = models.find(item => item.key === navState.aiUsageModelKey);
    if (!selected) return;
    const displayName = `${selected.profileName || selected.provider} · ${selected.model}`;
    await clearSpecificModelUsage(selected.key, displayName, selected.totals?.tokens || 0, Number(selected.totals?.costCny || 0).toFixed(4));
};

window.promptClearAllAiUsage = async function () {
    const totals = navState.aiUsageData?.totals || {};
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('清空全部模型统计信息', 'Clear All Models Statistics'),
        message: navLocaleText(
            '确定清空全部模型的历史 Token 用量与计费统计吗？',
            'Are you sure you want to clear historical token usage and cost statistics for ALL models?'
        ),
        hint: navLocaleText(
            `当前全部累计：${formatAiUsageNumber(totals.tokens)} Tokens，¥${Number(totals.costCny || 0).toFixed(4)} 元。清空后全部模型与每日图表都将归零，不可恢复。`,
            `Current all totals: ${formatAiUsageNumber(totals.tokens)} Tokens, ¥${Number(totals.costCny || 0).toFixed(4)}. Cannot be undone.`
        ),
        tone: 'danger',
        confirmText: navLocaleText('全部清空', 'Clear All')
    });
    if (!confirmed) return;

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.ai.clearingAll');
    try {
        const res = await fetch('/api/ai-settings/usage?clearAll=true', {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        navState.aiUsageModelKey = 'all';
        if (indicator) indicator.textContent = navT('nav.ai.clearedAll');
        await loadAiUsageDashboard(navState.aiUsageDimension);
    } catch (err) {
        if (indicator) indicator.textContent = navT('nav.ai.clearFail') + err.message;
        showNavbarNotice({ title: navT('nav.dialog.error'), message: navT('nav.ai.clearFail') + err.message, tone: 'error' });
    }
};

async function loadAiUsageDashboard(dimension = navState.aiUsageDimension || 'day') {
    navState.aiUsageDimension = ['day', 'week', 'month', 'year'].includes(dimension) ? dimension : 'day';
    document.querySelectorAll('[data-ai-usage-dimension]').forEach(button => button.classList.toggle('active', button.dataset.aiUsageDimension === navState.aiUsageDimension));
    const host = document.getElementById('navAiUsageBody');
    if (host) host.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ai.usageLoading'))}</div>`;
    try {
        const expectedDimension = navState.aiUsageDimension;
        const res = await fetch(`/api/ai-settings/usage?dimension=${encodeURIComponent(expectedDimension)}`, { headers: getAuthHeaderForNav() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (expectedDimension !== navState.aiUsageDimension) return;
        navState.aiUsageData = data;
        renderAiUsageDashboard(data);
    } catch (err) {
        if (host) host.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ai.usageFail'))}${navEscape(err.message)}</div>`;
    }
}

window.setAiUsageDimension = function (dimension) {
    loadAiUsageDashboard(dimension);
};

// 频道对接（WeLink 助理）设置页按需加载，逻辑在 shared/channel-settings.js
async function renderChannelSettings(content) {
    try {
        if (!window.ToolsChannelSettings) await loadNavLazyScript('./tp-static/frontend/js/shared/channel-settings.js', navLocaleText('无法加载频道对接组件', 'Channel settings component could not load'));
        await window.ToolsChannelSettings.render(content);
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(error.message)}</div>`;
    }
}

// 智能体工具设置页（MCP 服务、工具清单）按需加载，逻辑在 shared/agent-tools-settings.js
async function renderAgentToolsSettings(content) {
    try {
        if (!window.ToolsAgentToolsSettings) await loadNavLazyScript('./tp-static/frontend/js/shared/agent-tools-settings.js', navLocaleText('无法加载智能体工具组件', 'Agent tools component could not load'));
        await window.ToolsAgentToolsSettings.render(content);
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(error.message)}</div>`;
    }
}

// 平台推广设置页按需加载，逻辑在 shared/promotion-settings.js
async function renderPromotionSettings(content) {
    try {
        if (!window.ToolsPromotionSettings) await loadNavLazyScript('./tp-static/frontend/js/shared/promotion-settings.js', navLocaleText('无法加载平台推广组件', 'Promotion settings component could not load'));
        await window.ToolsPromotionSettings.render(content);
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(error.message)}</div>`;
    }
}

async function renderAiSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ai.empty'))}</div>`;
    try {
        const settingsStore = await fetchAiSettingsForNav();
        const allProfiles = Array.isArray(settingsStore.profiles) ? settingsStore.profiles : [];
        // Two categories as tabs: 文心 (chat models) and 丹青 (image models); each lists, creates and activates its own.
        const picked = allProfiles.find(item => item.id === navState.aiSelectedProfileId);
        const category = navState.aiCategory || picked?.category || 'chat';
        navState.aiCategory = category;
        const profiles = allProfiles.filter(item => (item.category || 'chat') === category);
        const settings = profiles.find(item => item.id === navState.aiSelectedProfileId) || profiles.find(item => item.isActive) || profiles[0] || null;
        if (settings) navState.aiSelectedProfileId = settings.id;
        const isImage = category === 'image';
        const isActiveProfile = !!settings?.isActive;
        const chatCount = allProfiles.filter(item => (item.category || 'chat') === 'chat').length, imageCount = allProfiles.length - chatCount;
        const tabs = `<div class="nav-ai-tabs" role="tablist" aria-label="${navEscape(navT('nav.ai.categoryLabel'))}">
            <button type="button" role="tab" class="nav-ai-tab ${isImage ? '' : 'is-active'}" aria-selected="${!isImage}" onclick="switchAiCategory('chat')"><span class="nav-ai-tab-icon">${navEscape(navT('nav.ai.chatIcon'))}</span><span><b>${navEscape(navT('nav.ai.chatTitle'))}</b><small>${navEscape(navT('nav.ai.chatSummary', { count: chatCount }))}</small></span></button>
            <button type="button" role="tab" class="nav-ai-tab ${isImage ? 'is-active' : ''}" aria-selected="${isImage}" onclick="switchAiCategory('image')"><span class="nav-ai-tab-icon">${navEscape(navT('nav.ai.imageIcon'))}</span><span><b>${navEscape(navT('nav.ai.imageTitle'))}</b><small>${navEscape(navT('nav.ai.imageSummary', { count: imageCount }))}</small></span></button>
        </div>`;
        if (!settings) {
            content.innerHTML = `${tabs}<div class="nav-ai-tab-empty"><strong>${navEscape(navT('nav.ai.imageEmpty'))}</strong><span>${navEscape(navT('nav.ai.imageEmptyHelp'))}</span><button type="button" class="nav-settings-add" onclick="createAiProfile()">${navEscape(navT('nav.ai.imageNew'))}</button></div>`;
            return;
        }
        content.innerHTML = `
            ${tabs}
            <div class="nav-settings-help">${isImage ? navT('nav.ai.imageHelp') : navEscape(navT('nav.ai.help'))}</div>
            <section class="nav-ai-profile-panel">
                <div class="nav-ai-profile-head">
                    <div>
                        <strong>${isImage ? navT('nav.ai.imageProfiles') : navT('nav.ai.chatProfiles')}</strong>
                        <span>${isImage ? navT('nav.ai.imageProfilesHelp') : navT('nav.ai.chatProfilesHelp')}</span>
                    </div>
                    <div class="nav-ai-profile-head-actions">
                        <button type="button" class="nav-settings-add" onclick="createAiProfile()">${navEscape(navT('nav.ai.profileNew'))}</button>
                        <button type="button" class="nav-settings-add secondary" onclick="cloneAiProfile()">${navEscape(navT('nav.ai.profileClone'))}</button>
                    </div>
                </div>
                <div class="nav-ai-profile-list">
                    ${profiles.map(profile => {
                        const profileModels = Array.isArray(profile.models) && profile.models.length
                            ? profile.models
                            : [profile.model].filter(Boolean);
                        const countStr = profileModels.length > 1 ? ` · ${profileModels.length}个模型` : ` · ${profile.model}`;
                        return `
                        <button type="button" class="nav-ai-profile-card ${profile.id === settings.id ? 'selected' : ''} ${profile.isActive ? 'active' : ''}" onclick="selectAiProfile('${navEscape(profile.id)}')">
                            <span class="nav-ai-profile-card-top"><b>${navEscape(profile.name)}</b>${profile.isActive ? `<em>${navEscape(navT('nav.ai.profileActive'))}</em>` : ''}</span>
                            <span>${navEscape(profile.provider)}${navEscape(countStr)}${profile.provider === 'anthropic' || /claude/i.test(profile.model) ? ` · ${profile.anthropicAuthType === 'ANTHROPIC_API_KEY' ? 'API_KEY' : 'AUTH_TOKEN'}` : ''}</span>
                            <div class="nav-ai-card-models">${profileModels.map(m => `<span class="nav-ai-model-tag${m === profile.model ? ' is-primary' : ''}">${navEscape(m)}</span>`).join('')}</div>
                            <small class="${profile.keyLooksValid ? 'ready' : ''}">${profile.keyLooksValid ? navT('nav.ai.tokenReady') : navT('nav.ai.tokenNotReady')}</small>
                        </button>
                    `;}).join('')}
                </div>
                ${isImage ? '' : `<label class="nav-settings-check nav-ai-autoswitch-check" style="margin-top:8px;padding:9px 10px;border:1px solid var(--v2-line, rgba(129,140,248,.24));border-radius:10px;background:var(--v2-chip, rgba(255,255,255,.68));display:flex;align-items:center;gap:8px;color:var(--v2-ink, inherit);">
                    <input id="navAiAutoSwitch" type="checkbox" ${settingsStore.autoSwitchEnabled ? 'checked' : ''} onchange="scheduleAiSettingsSave()">
                    <span><b>${navEscape(navT('nav.ai.autoSwitch'))}</b><small style="display:block;margin-top:2px;color:var(--v2-ink3, #64748b);font-weight:500;">${navEscape(navT('nav.ai.autoSwitchHelp'))}</small></span>
                </label>`}
                <div class="nav-ai-profile-toolbar">
                    <label>
                        <span>${navEscape(navT('nav.ai.profileName'))}</span>
                        <input id="navAiProfileName" class="nav-settings-input" maxlength="60" value="${navEscape(settings.name || navT('nav.ai.profileDefault'))}" oninput="scheduleAiSettingsSave()">
                    </label>
                    <div>
                        <button type="button" class="nav-settings-add" onclick="testAiSettingsNow()">${navEscape(navT('nav.ai.testConnection'))}</button>
                        <button type="button" class="nav-settings-add activate" onclick="activateAiProfile()" ${isActiveProfile ? 'disabled' : ''}>${isActiveProfile ? (isImage ? navT('nav.ai.imageActive') : navT('nav.ai.chatActive')) : (isImage ? navT('nav.ai.imageActivate') : navT('nav.ai.chatActivate'))}</button>
                        <button type="button" class="nav-settings-add danger" onclick="deleteAiProfile()" ${!isImage && profiles.length <= 1 ? 'disabled' : ''}>${navEscape(navT('nav.ai.profileDelete'))}</button>
                    </div>
                </div>
            </section>
            ${isImage ? '' : `<p class="nav-settings-help">${navEscape(navT('nav.ai.modelIdentityHelp'))}</p>`}
            <div class="nav-ai-status">
                <span>${isActiveProfile ? (isImage ? navT('nav.ai.imageStatus') : navT('nav.ai.chatStatus')) : navT('nav.ai.inactiveStatus')}</span>
                <span>${navEscape(navT('nav.ai.sourcePrefix'))}${navEscape(sourceLabelForAiSettings(settings.apiKeySource))}</span>
                <span class="${settings.hasApiKey && !settings.keyLooksValid ? 'warning' : ''}">${navEscape(keyHealthLabelForAiSettings(settings))}</span>
            </div>
            <section class="nav-ai-usage-panel">
                <div class="nav-ai-usage-head">
                    <div><strong>${navEscape(navT('nav.ai.usageTitle'))}</strong><span>${navEscape(navT('nav.ai.usageHelp'))}</span></div>
                    <div class="nav-ai-usage-dimensions">
                        <button type="button" data-ai-usage-dimension="day" onclick="setAiUsageDimension('day')">${navEscape(navT('nav.ai.usageDay'))}</button>
                        <button type="button" data-ai-usage-dimension="week" onclick="setAiUsageDimension('week')">${navEscape(navT('nav.ai.usageWeek'))}</button>
                        <button type="button" data-ai-usage-dimension="month" onclick="setAiUsageDimension('month')">${navEscape(navT('nav.ai.usageMonth'))}</button>
                        <button type="button" data-ai-usage-dimension="year" onclick="setAiUsageDimension('year')">${navEscape(navT('nav.ai.usageYear'))}</button>
                    </div>
                </div>
                <div id="navAiUsageBody"><div class="nav-settings-empty">${navEscape(navT('nav.ai.usageLoading'))}</div></div>
            </section>
            <div class="nav-ai-grid">
                <label class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.lblProvider'))}</span>
                    <select id="navAiProvider" class="nav-settings-input" onchange="handleAiProviderChange()">
                        <option value="gemini" ${settings.provider === 'gemini' ? 'selected' : ''}>Gemini</option>
                        <option value="openai" ${settings.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                        <option value="anthropic" ${settings.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
                        <option value="minimax" ${settings.provider === 'minimax' ? 'selected' : ''}>MiniMax</option>
                        <option value="openai-compatible" ${settings.provider === 'openai-compatible' ? 'selected' : ''}>OpenAI Compatible</option>
                    </select>
                </label>
                <label class="nav-ai-field nav-ai-field-wide" id="navAiAnthropicAuthWrap" style="${(settings.provider === 'anthropic' || /claude|anthropic/i.test(settings.model)) ? '' : 'display:none;'}">
                    <span>${navEscape(navT('nav.ai.anthropicAuthField'))}</span>
                    <select id="navAiAnthropicAuthType" class="nav-settings-input" onchange="scheduleAiSettingsSave()">
                        <option value="ANTHROPIC_AUTH_TOKEN" ${settings.anthropicAuthType !== 'ANTHROPIC_API_KEY' ? 'selected' : ''}>${navEscape(navT('nav.ai.anthropicAuthToken'))}</option>
                        <option value="ANTHROPIC_API_KEY" ${settings.anthropicAuthType === 'ANTHROPIC_API_KEY' ? 'selected' : ''}>${navEscape(navT('nav.ai.anthropicApiKey'))}</option>
                    </select>
                </label>
                <label class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.lblApiUrl'))}</span>
                    <input id="navAiApiBaseUrl" class="nav-settings-input" value="${navEscape(settings.apiBaseUrl || '')}" placeholder="${navEscape(navT('nav.ai.plhApiUrl'))}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.lblToken'))}</span>
                    <div class="nav-ai-token-row">
                        <input id="navAiApiKey" type="text" inputmode="text" class="nav-settings-input nav-ai-token-input" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="${settings.hasApiKey ? `${navEscape(navT('nav.ai.plhKeep'))}${navEscape(settings.maskedApiKey)}` : navEscape(navT('nav.ai.plhToken'))}" onfocus="this.dataset.userTouched='1'" oninput="scheduleAiSettingsSave({ tokenTouched: this.dataset.userTouched === '1' })">
                        <button type="button" class="nav-settings-add" onclick="clearAiApiKey()">${navEscape(navT('nav.ai.btnClear'))}</button>
                    </div>
                </label>
                <div class="nav-ai-field nav-ai-field-wide nav-ai-models-box">
                    <div class="nav-ai-models-header">
                        <div>
                            <b>${navEscape(navT('nav.ai.channelModelsTitle'))}</b>
                            <small style="display:block;margin-top:2px;">${navEscape(navT('nav.ai.channelModelsHelp'))}</small>
                        </div>
                    </div>
                    <input id="navAiModel" type="hidden" value="${navEscape(settings.model)}">
                    <div id="navAiModelsList" class="nav-ai-models-chips"></div>
                    <div class="nav-ai-add-model-bar">
                        <input id="navAiAddModelInput" class="nav-settings-input" list="navAiModelOptions" placeholder="${navEscape(navT('nav.ai.plhAddModel'))}" onkeydown="if(event.key==='Enter'){event.preventDefault();navAiAddModel();}">
                        <button type="button" class="nav-settings-add" onclick="navAiAddModel()">${navEscape(navT('nav.ai.btnAddModel'))}</button>
                    </div>
                    <datalist id="navAiModelOptions">
                        <option value="gemini-2.5-flash"></option>
                        <option value="gemini-2.5-pro"></option>
                        <option value="gemini-1.5-flash"></option>
                        <option value="gpt-4o-mini"></option>
                        <option value="gpt-4o"></option>
                        <option value="gpt-4.1-mini"></option>
                        <option value="claude-3-5-sonnet-latest"></option>
                        <option value="claude-3-5-haiku-latest"></option>
                        <option value="MiniMax-M2.7-highspeed"></option>
                        <option value="MiniMax-M2.7"></option>
                        <option value="MiniMax-M3"></option>
                    </datalist>
                </div>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.temperature'))}</span>
                    <input id="navAiTemperature" type="number" min="0" max="2" step="0.1" class="nav-settings-input" value="${navEscape(settings.temperature)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblMax'))}</span>
                    <input id="navAiMaxTokens" type="number" min="128" max="8192" step="128" class="nav-settings-input" value="${navEscape(settings.maxOutputTokens)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblContext'))}</span>
                    <input id="navAiContextWindow" type="number" min="0" max="10000000" step="1000" class="nav-settings-input" value="${navEscape(settings.contextWindowTokens || 0)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblInputCost'))}</span>
                    <input id="navAiInputCost" type="number" min="0" step="0.001" class="nav-settings-input" value="${navEscape(settings.inputCostPerMillionUsd)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblOutputCost'))}</span>
                    <input id="navAiOutputCost" type="number" min="0" step="0.001" class="nav-settings-input" value="${navEscape(settings.outputCostPerMillionUsd)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblUsdCny'))}</span>
                    <input id="navAiUsdToCny" type="number" min="0" step="0.01" class="nav-settings-input" value="${navEscape(settings.usdToCny)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.lblPrompt'))}</span>
                    <textarea id="navAiSystemPrompt" class="nav-ai-textarea" maxlength="5000" placeholder="${navEscape(navT('nav.ai.plhPrompt'))}" oninput="scheduleAiSettingsSave()">${navEscape(settings.systemPrompt || '')}</textarea>
                </label>
                <div class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.testResult'))}</span>
                    <div id="navAiTestResult" class="nav-ai-test-result"></div>
                </div>
            </div>
        `;
        navState.currentEditingModels = Array.isArray(settings.models) && settings.models.length
            ? [...settings.models]
            : [settings.model].filter(Boolean);
        renderNavAiModelChips(settings);
        loadAiUsageDashboard(navState.aiUsageDimension);
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ai.failLoad'))}${navEscape(e.message)}</div>`;
    }
}

function collectAiSettingsPayload(options = {}) {
    const tokenInput = document.getElementById('navAiApiKey');
    const authTypeSelect = document.getElementById('navAiAnthropicAuthType');
    const models = getNavAiEditingModels();
    const primaryModel = document.getElementById('navAiModel')?.value || models[0] || 'gemini-2.5-flash';
    const payload = {
        profileId: navState.aiSelectedProfileId,
        name: document.getElementById('navAiProfileName')?.value || 'AI 配置',
        provider: document.getElementById('navAiProvider')?.value || 'gemini',
        anthropicAuthType: authTypeSelect?.value || 'ANTHROPIC_AUTH_TOKEN',
        apiBaseUrl: document.getElementById('navAiApiBaseUrl')?.value || '',
        model: primaryModel,
        models: models,
        temperature: document.getElementById('navAiTemperature')?.value || 0.7,
        maxOutputTokens: document.getElementById('navAiMaxTokens')?.value || 2048,
        contextWindowTokens: document.getElementById('navAiContextWindow')?.value || 0,
        inputCostPerMillionUsd: document.getElementById('navAiInputCost')?.value || 0.075,
        outputCostPerMillionUsd: document.getElementById('navAiOutputCost')?.value || 0.3,
        usdToCny: document.getElementById('navAiUsdToCny')?.value || 7.2,
        systemPrompt: document.getElementById('navAiSystemPrompt')?.value || ''
    };
    // Only the chat tab shows the failover switch; saving a drawing profile leaves the setting as it is.
    const autoSwitch = document.getElementById('navAiAutoSwitch');
    if (autoSwitch) payload.autoSwitchEnabled = autoSwitch.checked === true;
    const token = tokenInput ? tokenInput.value.trim() : '';
    if (token) payload.apiKey = token;
    if (options.clearApiKey) payload.clearApiKey = true;
    return payload;
}

function currentAiProfile() {
    const profiles = Array.isArray(navState.aiSettings?.profiles) ? navState.aiSettings.profiles : [];
    return profiles.find(item => item.id === navState.aiSelectedProfileId) || profiles[0] || null;
}

async function requestAiProfile(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...getAuthHeaderForNav(),
            ...(options.headers || {})
        }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (options.method && options.method !== 'GET') window.dispatchEvent(new Event('tools:ai-models-changed'));
    return data;
}

window.switchAiCategory = async function (category) {
    if (navState.aiCategory === category) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        if (document.getElementById('navAiProvider')) await saveAiSettingsNow();
        navState.aiCategory = category;
        const profiles = (navState.aiSettings?.profiles || []).filter(item => (item.category || 'chat') === category);
        navState.aiSelectedProfileId = (profiles.find(item => item.isActive) || profiles[0])?.id || null;
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = navT('nav.ai.switchSaveFail') + error.message;
    }
};

window.selectAiProfile = async function (profileId) {
    if (profileId === navState.aiSelectedProfileId) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow();
        navState.currentEditingModels = null;
        navState.aiSelectedProfileId = profileId;
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = navT('nav.ai.switchSaveFail') + error.message;
    }
};

window.createAiProfile = async function () {
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow();
        navState.currentEditingModels = null;
        if (indicator) indicator.textContent = navT('nav.ai.creating');
        const data = await requestAiProfile('/api/ai-settings/profiles', {
            method: 'POST',
            body: JSON.stringify(navState.aiCategory === 'image' ? { name: navT('nav.ai.newImageName'), category: 'image', provider: 'gemini' } : { name: navT('nav.ai.newChatName'), category: 'chat' })
        });
        navState.aiSettings = data;
        navState.aiSelectedProfileId = data.createdProfileId;
        if (indicator) indicator.textContent = navT('nav.ai.created');
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = navT('nav.ai.createFail') + error.message;
    }
};

window.cloneAiProfile = async function () {
    const profile = currentAiProfile();
    if (!profile) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow();
        navState.currentEditingModels = null;
        const sourceName = document.getElementById('navAiProfileName')?.value.trim() || profile.name;
        const data = await requestAiProfile('/api/ai-settings/profiles', {
            method: 'POST',
            body: JSON.stringify({ sourceProfileId: profile.id, name: `${sourceName} ${navT('nav.ai.copySuffix')}` })
        });
        navState.aiSettings = data;
        navState.aiSelectedProfileId = data.createdProfileId;
        if (indicator) indicator.textContent = navT('nav.ai.cloned');
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = navT('nav.ai.cloneFail') + error.message;
    }
};

window.activateAiProfile = async function () {
    const profileId = navState.aiSelectedProfileId;
    if (!profileId) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow();
        if (indicator) indicator.textContent = navT('nav.ai.activating');
        navState.aiSettings = await requestAiProfile(`/api/ai-settings/profiles/${encodeURIComponent(profileId)}/activate`, { method: 'POST' });
        if (indicator) indicator.textContent = navT('nav.ai.activated');
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = navT('nav.ai.activateFail') + error.message;
    }
};

window.deleteAiProfile = async function () {
    const profile = currentAiProfile();
    if (!profile) return;
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('删除 AI 配置', 'Delete AI profile'),
        message: navLocaleText(`确定删除 AI 配置“${profile.name}”吗？`, `Delete the AI profile “${profile.name}”?`),
        hint: navLocaleText('删除后无法恢复，当前业务调用不会自动切换到该配置。', 'This cannot be undone. Active requests will no longer use this profile.'),
        tone: 'danger',
        confirmText: navLocaleText('删除配置', 'Delete profile')
    });
    if (!confirmed) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        const data = await requestAiProfile(`/api/ai-settings/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
        navState.aiSettings = data;
        navState.aiSelectedProfileId = data.activeProfileId;
        if (indicator) indicator.textContent = navT('nav.ai.deleted');
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = navT('nav.ai.deleteFail') + error.message;
    }
};

function getNavAiEditingModels() {
    if (Array.isArray(navState.currentEditingModels) && navState.currentEditingModels.length) {
        return navState.currentEditingModels;
    }
    const settings = (navState.aiSettings?.profiles || []).find(p => p.id === navState.aiSelectedProfileId) || navState.aiSettings || {};
    return Array.isArray(settings.models) && settings.models.length
        ? [...settings.models]
        : [settings.model || 'gemini-2.5-flash'].filter(Boolean);
}

function renderNavAiModelChips(settings) {
    const host = document.getElementById('navAiModelsList');
    if (!host) return;
    const models = getNavAiEditingModels();
    const primaryInput = document.getElementById('navAiModel');
    let primaryModel = primaryInput ? primaryInput.value.trim() : (settings?.model || models[0]);
    if (!models.includes(primaryModel) && models.length > 0) {
        primaryModel = models[0];
        if (primaryInput) primaryInput.value = primaryModel;
    }
    host.innerHTML = models.map(m => {
        const isPrimary = m === primaryModel;
        return `
            <div class="nav-ai-chip ${isPrimary ? 'is-primary' : ''}" data-model="${navEscape(m)}">
                <span class="nav-ai-chip-name">${navEscape(m)}</span>
                ${isPrimary
                    ? `<span class="nav-ai-chip-star" title="${navEscape(navT('nav.ai.modelPrimary'))}">${navEscape(navT('nav.ai.modelPrimary'))}</span>`
                    : `<button type="button" class="nav-ai-chip-star" onclick="navAiSetPrimaryModel('${navEscape(m)}')" title="${navEscape(navT('nav.ai.modelSetPrimary'))}">☆ ${navEscape(navT('nav.ai.modelSetPrimary'))}</button>`
                }
                <button type="button" class="nav-ai-chip-test" onclick="testAiSettingsNow('${navEscape(m)}')" title="${navEscape(navT('nav.ai.modelTest'))}">⌁ ${navEscape(navT('nav.ai.modelTest'))}</button>
                ${models.length > 1
                    ? `<button type="button" class="nav-ai-chip-del" onclick="navAiRemoveModel('${navEscape(m)}')" title="删除模型">✕</button>`
                    : ''
                }
            </div>
        `;
    }).join('');
}

window.navAiAddModel = function () {
    const input = document.getElementById('navAiAddModelInput');
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;
    const tokens = raw.split(/[\r\n,，\s]+/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return;
    const current = getNavAiEditingModels();
    for (const t of tokens) {
        if (!current.includes(t)) {
            current.push(t);
        }
    }
    navState.currentEditingModels = current;
    input.value = '';
    renderNavAiModelChips();
    scheduleAiSettingsSave();
};

window.navAiRemoveModel = function (modelName) {
    let current = getNavAiEditingModels().filter(m => m !== modelName);
    if (!current.length) current = ['gemini-2.5-flash'];
    navState.currentEditingModels = current;
    const primaryInput = document.getElementById('navAiModel');
    if (primaryInput && primaryInput.value === modelName) {
        primaryInput.value = current[0];
    }
    renderNavAiModelChips();
    scheduleAiSettingsSave();
};

window.navAiSetPrimaryModel = function (modelName) {
    const current = getNavAiEditingModels();
    if (!current.includes(modelName)) return;
    const updated = [modelName, ...current.filter(m => m !== modelName)];
    navState.currentEditingModels = updated;
    const primaryInput = document.getElementById('navAiModel');
    if (primaryInput) primaryInput.value = modelName;
    renderNavAiModelChips();
    scheduleAiSettingsSave();
};

window.handleAiProviderChange = function () {
    const provider = document.getElementById('navAiProvider')?.value || 'gemini';
    const modelInput = document.getElementById('navAiModel');
    const authWrap = document.getElementById('navAiAnthropicAuthWrap');
    if (authWrap) {
        authWrap.style.display = (provider === 'anthropic' || /claude|anthropic/i.test(modelInput?.value || '')) ? '' : 'none';
    }
    const defaults = {
        gemini: 'gemini-2.5-flash',
        openai: 'gpt-4o-mini',
        anthropic: 'claude-3-5-sonnet-latest',
        minimax: 'MiniMax-M2.7-highspeed',
        'openai-compatible': 'gpt-4o-mini'
    };
    if (defaults[provider]) {
        navState.currentEditingModels = [defaults[provider]];
        if (modelInput) modelInput.value = defaults[provider];
        renderNavAiModelChips();
        if (authWrap) {
            authWrap.style.display = (provider === 'anthropic' || /claude|anthropic/i.test(defaults[provider])) ? '' : 'none';
        }
    }
    const apiBaseUrlInput = document.getElementById('navAiApiBaseUrl');
    if (apiBaseUrlInput) {
        if (provider === 'minimax') apiBaseUrlInput.value = 'https://api.minimax.io/v1';
        if (['gemini', 'openai', 'anthropic'].includes(provider)) apiBaseUrlInput.value = '';
    }
    scheduleAiSettingsSave();
};

window.updateAiModelAuthVisibility = function () {
    const provider = document.getElementById('navAiProvider')?.value || 'gemini';
    const model = document.getElementById('navAiModel')?.value || '';
    const authWrap = document.getElementById('navAiAnthropicAuthWrap');
    if (authWrap) {
        authWrap.style.display = (provider === 'anthropic' || /claude|anthropic/i.test(model)) ? '' : 'none';
    }
};

window.testAiSettingsNow = async function (specificModel) {
    const resultEl = document.getElementById('navAiTestResult');
    const indicator = document.getElementById('navSettingsSaveState');
    clearTimeout(navState.aiSaveTimer);
    const targetModel = specificModel || document.getElementById('navAiModel')?.value;
    const testingLabel = targetModel ? `${navT('nav.ai.testing')} [${targetModel}]` : navT('nav.ai.testing');
    if (resultEl) {
        resultEl.className = 'nav-ai-test-result testing';
        resultEl.textContent = testingLabel;
    }
    if (indicator) indicator.textContent = testingLabel;
    try {
        const profileId = navState.aiSelectedProfileId;
        const payload = collectAiSettingsPayload();
        if (specificModel) payload.model = specificModel;
        const res = await fetch(`/api/ai-settings/profiles/${encodeURIComponent(profileId)}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaderForNav()
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        const reply = data.reply ? `：${data.reply}` : '';
        const modelTag = data.model ? `[${data.model}] ` : '';
        if (resultEl) {
            resultEl.className = 'nav-ai-test-result ok';
            resultEl.textContent = `${modelTag}${navT('nav.ai.testOk')}${reply}`;
        }
        if (indicator) indicator.textContent = `${modelTag}${navT('nav.ai.testOk')}`;
    } catch (e) {
        const modelTag = targetModel ? `[${targetModel}] ` : '';
        if (resultEl) {
            resultEl.className = 'nav-ai-test-result fail';
            resultEl.textContent = `${modelTag}${navT('nav.ai.testFail')}${e.message}`;
        }
        if (indicator) indicator.textContent = `${modelTag}${navT('nav.ai.testFail')}${e.message}`;
    }
};

async function saveAiSettingsNow(options = {}) {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.ai.saving');
    const profileId = navState.aiSelectedProfileId;
    if (!profileId) throw new Error(navT('nav.ai.noProfile'));
    const res = await fetch(`/api/ai-settings/profiles/${encodeURIComponent(profileId)}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaderForNav()
        },
        body: JSON.stringify(collectAiSettingsPayload(options))
    });
    if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
            const data = await res.json();
            if (data && data.error) message = data.error;
        } catch (e) { }
        throw new Error(message);
    }
    navState.aiSettings = await res.json();
    window.dispatchEvent(new Event('tools:ai-models-changed'));
    const savedProfile = currentAiProfile();
    const tokenInput = document.getElementById('navAiApiKey');
    if (tokenInput) {
        tokenInput.value = '';
        tokenInput.placeholder = savedProfile?.hasApiKey
            ? `${navT('nav.ai.plhKeep')}${savedProfile.maskedApiKey}`
            : navT('nav.ai.plhToken');
    }
    const status = document.querySelector('.nav-ai-status');
    if (status) {
        status.innerHTML = `
            <span>${navEscape(navT(savedProfile?.isActive ? (savedProfile.category === 'image' ? 'nav.ai.imageStatus' : 'nav.ai.chatStatus') : 'nav.ai.inactiveStatus'))}</span>
            <span>${navEscape(navT('nav.ai.sourcePrefix'))}${navEscape(sourceLabelForAiSettings(savedProfile?.apiKeySource))}</span>
            <span class="${savedProfile?.hasApiKey && !savedProfile?.keyLooksValid ? 'warning' : ''}">${navEscape(keyHealthLabelForAiSettings(savedProfile || {}))}</span>
        `;
    }
    if (indicator) indicator.textContent = navT('nav.ai.saved');
}

window.scheduleAiSettingsSave = function (options = {}) {
    const tokenInput = document.getElementById('navAiApiKey');
    if (tokenInput && tokenInput.value.trim() && !options.tokenTouched) {
        tokenInput.value = '';
        return;
    }
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.ai.waitSave');
    clearTimeout(navState.aiSaveTimer);
    navState.aiSaveTimer = setTimeout(async () => {
        try {
            await saveAiSettingsNow();
        } catch (e) {
            if (indicator) indicator.textContent = navT('nav.set.saveFail') + e.message;
        }
    }, 700);
};

window.clearAiApiKey = async function () {
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow({ clearApiKey: true });
    } catch (e) {
        const indicator = document.getElementById('navSettingsSaveState');
        if (indicator) indicator.textContent = `清除失败: ${e.message}`;
    }
};

function updaterStateLabel(state) {
    const key = `nav.up.state.${state || 'idle'}`;
    const label = navT(key);
    return label === key ? (state || 'idle') : label;
}

function setUpdaterBusy(isBusy) {
    document.querySelectorAll('[data-updater-action]').forEach(btn => {
        btn.disabled = Boolean(isBusy);
    });
}

function updateUpdaterPanel(status = navState.updaterStatus || {}) {
    navState.updaterStatus = status || {};
    const state = navState.updaterStatus.state || 'idle';
    const progress = Math.max(0, Math.min(100, Number(navState.updaterStatus.progress) || 0));
    const latest = navState.updaterStatus.latestVersion || '-';
    const message = navState.updaterStatus.message || updaterStateLabel(state);

    const latestEl = document.getElementById('navUpdaterLatest');
    const statusEl = document.getElementById('navUpdaterStatus');
    const progressEl = document.getElementById('navUpdaterProgress');
    const progressTextEl = document.getElementById('navUpdaterProgressText');
    const checkBtn = document.getElementById('navUpdaterCheckBtn');
    const downloadBtn = document.getElementById('navUpdaterDownloadBtn');
    const installBtn = document.getElementById('navUpdaterInstallBtn');

    if (latestEl) latestEl.textContent = latest;
    if (statusEl) statusEl.textContent = `${updaterStateLabel(state)} · ${message}`;
    if (progressEl) progressEl.style.width = `${progress}%`;
    if (progressTextEl) progressTextEl.textContent = `${Math.round(progress)}%`;

    const checking = state === 'checking';
    const downloading = state === 'downloading';
    if (checkBtn) checkBtn.disabled = checking || downloading;
    if (downloadBtn) downloadBtn.disabled = state !== 'available';
    if (installBtn) installBtn.disabled = state !== 'downloaded';
}

async function renderUpdaterSettings(content) {
    if (!window.ToolsUpdater) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.up.unavailable'))}</div>`;
        return;
    }

    let versionInfo;
    let status;
    try {
        versionInfo = await window.ToolsUpdater.getVersion();
        status = await window.ToolsUpdater.getStatus();
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(e.message || navT('nav.up.unavailable'))}</div>`;
        return;
    }
    navState.updaterVersion = versionInfo;
    navState.updaterStatus = status;

    if (!navState.updaterUnsubscribe) {
        navState.updaterUnsubscribe = window.ToolsUpdater.onStatus((nextStatus) => {
            updateUpdaterPanel(nextStatus);
        });
    }

    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.up.help'))}</div>
        <div class="nav-update-card">
            <div class="nav-update-grid">
                <div class="nav-update-field">
                    <span>${navEscape(navT('nav.up.current'))}</span>
                    <strong>${navEscape(versionInfo.version || '-')}</strong>
                </div>
                <div class="nav-update-field">
                    <span>${navEscape(navT('nav.up.latest'))}</span>
                    <strong id="navUpdaterLatest">${navEscape(status.latestVersion || '-')}</strong>
                </div>
                <div class="nav-update-field">
                    <span>${navEscape(navT('nav.up.packaged'))}</span>
                    <strong>${navEscape(versionInfo.packaged ? navT('nav.up.packagedYes') : navT('nav.up.packagedNo'))}</strong>
                </div>
            </div>
            <div class="nav-update-status">
                <span>${navEscape(navT('nav.up.status'))}</span>
                <strong id="navUpdaterStatus">${navEscape(updaterStateLabel(status.state))} · ${navEscape(status.message || '')}</strong>
            </div>
            <div class="nav-update-progress-row">
                <span>${navEscape(navT('nav.up.progress'))}</span>
                <div class="nav-update-progress">
                    <div id="navUpdaterProgress" style="width:${Math.max(0, Math.min(100, Number(status.progress) || 0))}%"></div>
                </div>
                <b id="navUpdaterProgressText">${Math.round(Number(status.progress) || 0)}%</b>
            </div>
            <div class="nav-backup-toolbar nav-update-actions">
                <button id="navUpdaterCheckBtn" data-updater-action="check" onclick="checkToolsUpdate()">${navEscape(navT('nav.up.btnCheck'))}</button>
                <button id="navUpdaterDownloadBtn" data-updater-action="download" onclick="downloadToolsUpdate()">${navEscape(navT('nav.up.btnDownload'))}</button>
                <button id="navUpdaterInstallBtn" data-updater-action="install" onclick="installToolsUpdate()">${navEscape(navT('nav.up.btnInstall'))}</button>
            </div>
        </div>
    `;
    updateUpdaterPanel(status);
}

window.checkToolsUpdate = async function () {
    if (!window.ToolsUpdater) return;
    setUpdaterBusy(true);
    try {
        updateUpdaterPanel(await window.ToolsUpdater.check());
    } catch (e) {
        updateUpdaterPanel({ state: 'error', message: e.message, progress: 0 });
    } finally {
        setUpdaterBusy(false);
        updateUpdaterPanel(navState.updaterStatus);
    }
};

window.downloadToolsUpdate = async function () {
    if (!window.ToolsUpdater) return;
    try {
        updateUpdaterPanel(await window.ToolsUpdater.download());
    } catch (e) {
        updateUpdaterPanel({ state: 'error', message: e.message, progress: 0 });
    }
};

window.installToolsUpdate = async function () {
    if (!window.ToolsUpdater) return;
    try {
        updateUpdaterPanel(await window.ToolsUpdater.install());
    } catch (e) {
        updateUpdaterPanel({ state: 'error', message: e.message, progress: 100 });
    }
};

function formatBackupSize(bytes) {
    const size = Number(bytes) || 0;
    if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
}

function formatBackupTime(value) {
    if (!value) return '-';
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('zh-CN', {
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        });
    } catch (e) {
        return value;
    }
}

function getLocalTimeZoneLabel() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '浏览器本地时区';
    } catch (e) {
        return '浏览器本地时区';
    }
}

async function fetchBackupList() {
    const res = await fetch('/api/global-backup/list', { headers: getAuthHeaderForNav() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function fetchRemoteBackupSettings() {
    const res = await fetch('/api/global-backup/remote-settings', { headers: getAuthHeaderForNav() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function fetchScheduleBackupSettings() {
    const res = await fetch('/api/global-backup/schedule-settings', { headers: getAuthHeaderForNav() });
    if (res.status === 404) {
        return {
            enabled: true,
            time: '02:00',
            retentionDays: 90,
            maxTotalSizeGB: 10,
            nextRunAt: null,
            lastSuccessAt: null,
            lastBackupName: '',
            lastError: '定时备份接口未加载，请重启后端服务。'
        };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function renderScheduleBackupSettings(settings = {}) {
    const nextRunText = settings.enabled
        ? formatBackupTime(settings.nextRunAt)
        : navT('nav.bk.scheduleDisabled');
    const lastSuccessText = settings.lastSuccessAt
        ? formatBackupTime(settings.lastSuccessAt)
        : navT('nav.bk.scheduleNotRun');
    return `
        <div class="nav-schedule-backup-card">
            <div class="nav-remote-backup-head">
                <div>
                    <div class="nav-backup-panel-title">${navEscape(navT('nav.bk.scheduleTitle'))}</div>
                    <div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.scheduleDesc'))}</div>
                </div>
                <label class="nav-remote-switch">
                    <input id="scheduleBackupEnabled" type="checkbox" ${settings.enabled !== false ? 'checked' : ''} onchange="scheduleBackupSettingsSave()">
                    ${navEscape(navT('nav.bk.scheduleEnabled'))}
                </label>
            </div>
            <div class="nav-schedule-backup-grid">
                <label>
                    <span>${navEscape(navT('nav.bk.scheduleTime'))}</span>
                    <input id="scheduleBackupTime" type="time" class="nav-settings-input" value="${navEscape(settings.time || '02:00')}" oninput="scheduleBackupSettingsSave()">
                </label>
                <label>
                    <span>${navEscape(navT('nav.bk.scheduleRetention'))}</span>
                    <div class="nav-schedule-retention-row">
                        <input id="scheduleBackupRetentionDays" type="number" min="1" max="3650" step="1" class="nav-settings-input" value="${navEscape(settings.retentionDays || 90)}" oninput="scheduleBackupSettingsSave()">
                        <em>${navEscape(navT('nav.bk.scheduleDays'))}</em>
                    </div>
                </label>
                <label>
                    <span>${navEscape(navT('nav.bk.scheduleCapacity'))}</span>
                    <div class="nav-schedule-retention-row">
                        <input id="scheduleBackupMaxTotalSizeGB" type="number" min="0.1" max="10240" step="0.1" class="nav-settings-input" value="${navEscape(settings.maxTotalSizeGB || 10)}" oninput="scheduleBackupSettingsSave()">
                        <em>${navEscape(navT('nav.bk.scheduleGB'))}</em>
                    </div>
                </label>
                <div class="nav-backup-toolbar nav-remote-backup-actions">
                    <button type="button" onclick="runScheduledBackupNow()">${navEscape(navT('nav.bk.scheduleRun'))}</button>
                </div>
            </div>
            <div class="nav-remote-backup-status">
                <span>${navEscape(navT('nav.bk.scheduleNext'))}${navEscape(nextRunText)}</span>
                <span>${navEscape(navT('nav.bk.scheduleLast'))}${navEscape(lastSuccessText)}</span>
                <span id="scheduleBackupCapacityStatus" class="${settings.capacityExceeded ? 'warning' : ''}">${navEscape(navT('nav.bk.scheduleUsage', { used: formatBackupSize(settings.currentTotalBytes || 0), limit: formatBackupSize(settings.maxTotalBytes || (Number(settings.maxTotalSizeGB || 10) * 1024 * 1024 * 1024)) }))}${settings.capacityExceeded ? ` · ${navEscape(navT('nav.bk.scheduleOver'))}` : ''}</span>
                ${settings.lastBackupName ? `<span>${navEscape(navT('nav.bk.scheduleLastFile'))}${navEscape(settings.lastBackupName)}</span>` : ''}
                ${settings.lastError ? `<span class="warning">${navEscape(navT('nav.bk.scheduleError'))}${navEscape(settings.lastError)}</span>` : ''}
            </div>
        </div>
    `;
}

function renderRemoteBackupSyncSettings(settings = {}) {
    const lastSync = settings.lastSync || {};
    const lastRemote = lastSync.remoteBackup || {};
    const lastCheck = settings.lastCheck || {};
    const checkLatest = lastCheck.latest || {};
    const lastSyncText = lastSync.restoredAt
        ? `${formatBackupTime(lastSync.restoredAt)} · ${lastRemote.name || '-'}`
        : '尚未恢复远端备份';
    const lastCheckText = lastCheck.checkedAt
        ? `${formatBackupTime(lastCheck.checkedAt)} · 最新：${checkLatest.name || '-'}`
        : '尚未检查远端';
    return `
        <div class="nav-remote-backup-card">
            <div class="nav-remote-backup-head">
                <div>
                    <div class="nav-backup-panel-title">${navEscape(navT('nav.bk.remoteTitle'))}</div>
                    <div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.remoteDesc'))}</div>
                </div>
                <label class="nav-remote-switch">
                    <input id="remoteBackupEnabled" type="checkbox" ${settings.enabled ? 'checked' : ''} onchange="scheduleRemoteBackupSettingsSave()">
                    ${navEscape(navT('nav.bk.enable'))}
                </label>
            </div>
            <div class="nav-remote-backup-grid">
                <label>
                    <span>${navEscape(navT('nav.bk.remoteDomain'))}</span>
                    <input id="remoteBackupBaseUrl" class="nav-settings-input" value="${navEscape(settings.baseUrl || '')}" placeholder="例如：https://cs.fanxiaolong.uk" oninput="scheduleRemoteBackupSettingsSave()">
                </label>
                <label>
                    <span>${navEscape(navT('nav.bk.remoteUser'))}</span>
                    <input id="remoteBackupUsername" class="nav-settings-input" value="${navEscape(settings.username || '')}" autocomplete="username" oninput="scheduleRemoteBackupSettingsSave()">
                </label>
                <label>
                    <span>${navEscape(navT('nav.bk.remotePwd'))}</span>
                    <input id="remoteBackupPassword" type="password" class="nav-settings-input" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" placeholder="${settings.hasPassword ? `留空保持当前：${navEscape(settings.maskedPassword || '已保存')}` : navEscape(navT('nav.bk.plhPwd'))}" onfocus="this.dataset.userTouched='1'" oninput="scheduleRemoteBackupSettingsSave({ passwordTouched: this.dataset.userTouched === '1' })">
                </label>
                <div class="nav-remote-checks">
                    <label><input id="remoteBackupCompare" type="checkbox" ${settings.compareBeforeRestore !== false ? 'checked' : ''} onchange="scheduleRemoteBackupSettingsSave()"> ${navEscape(navT('nav.bk.optCompare'))}</label>
                    <label><input id="remoteBackupCreateBeforePull" type="checkbox" ${settings.createRemoteBackupBeforePull !== false ? 'checked' : ''} onchange="scheduleRemoteBackupSettingsSave()"> ${navEscape(navT('nav.bk.optPull'))}</label>
                    <label title="${settings.startupAutoRestoreSupported === false ? navEscape(navT('nav.bk.optAutoDefaultOnly')) : ''}"><input id="remoteBackupAutoRestore" type="checkbox" ${settings.autoRestore ? 'checked' : ''} ${settings.startupAutoRestoreSupported === false ? 'disabled' : ''} onchange="scheduleRemoteBackupSettingsSave()"> ${navEscape(navT('nav.bk.optAuto'))}</label>
                </div>
                ${settings.startupAutoRestoreSupported === false ? `<div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.optAutoDefaultOnly'))}</div>` : ''}
            </div>
            <div class="nav-remote-backup-status">
                <span>${navEscape(navT('nav.bk.stLocal', { tz: getLocalTimeZoneLabel() }))}</span>
                <span>${navEscape(navT('nav.bk.stCheck'))}${navEscape(lastCheckText)}</span>
                <span>${navEscape(navT('nav.bk.stSync'))}${navEscape(lastSyncText)}</span>
                ${settings.lastError ? `<span class="warning">${navEscape(navT('nav.bk.stError'))}${navEscape(settings.lastError)}</span>` : ''}
            </div>
            <div class="nav-backup-toolbar nav-remote-backup-actions">
                <button type="button" onclick="checkRemoteBackupNow()">${navEscape(navT('nav.bk.btnCheck'))}</button>
                <button type="button" onclick="pullRemoteBackupNow(false)">${navEscape(navT('nav.bk.btnPull'))}</button>
                <button type="button" class="danger" onclick="pullRemoteBackupNow(true)">${navEscape(navT('nav.bk.btnForce'))}</button>
                <button type="button" onclick="clearRemoteBackupPassword()">${navEscape(navT('nav.bk.btnClearPwd'))}</button>
            </div>
        </div>
    `;
}

async function renderBackupSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.bk.empty'))}</div>`;
    try {
        const [data, remoteSettings, scheduleSettings] = await Promise.all([
            fetchBackupList(),
            fetchRemoteBackupSettings(),
            fetchScheduleBackupSettings()
        ]);
        if (data.tenantId && data.tenantId !== (navState.activeTenantId || 'default')) {
            throw new Error(navLocaleText(
                `页面数据空间已发生变化（页面：${navState.activeTenantId || 'default'}，服务端：${data.tenantId}），请刷新页面后再操作备份。`,
                `The data scope changed (page: ${navState.activeTenantId || 'default'}, server: ${data.tenantId}). Refresh before using backup actions.`
            ));
        }
        navState.remoteBackupSettings = remoteSettings;
        navState.scheduleBackupSettings = scheduleSettings;
        const targetText = (data.targets || []).map(item => item.relPath || item.path).join('、') || 'backend/data、data';
        const rows = (data.backups || []).map(item => `
            <tr>
                <td>
                    <div class="nav-backup-name" title="${navEscape(item.name)}">
                        ${navEscape(item.name)}
                        ${item.triggerType === 'remote-sync-request' ? `<span class="nav-backup-badge remote">${navEscape(navT('nav.bk.badgeSync'))}</span>` : ''}
                        ${item.triggerType === 'pre-restore' ? `<span class="nav-backup-badge safety">${navEscape(navT('nav.bk.badgeSafe'))}</span>` : ''}
                        ${item.triggerType === 'scheduled-auto' ? `<span class="nav-backup-badge automatic">${navEscape(navT('nav.bk.badgeAuto'))}</span>` : ''}
                    </div>
                    <div class="nav-backup-meta">${formatBackupTime(item.modifiedAt)} · ${formatBackupSize(item.size)}</div>
                    ${item.reason ? `<div class="nav-backup-meta">Reason: ${navEscape(item.reason)}</div>` : ''}
                </td>
                <td class="nav-backup-action-cell">
                    <div class="nav-backup-actions">
                        <button onclick="downloadGlobalBackup('${navEscape(item.name)}')" title="${navEscape(navT('nav.bk.dlTitle'))}">⬇️</button>
                        <button class="danger" onclick="restoreGlobalBackupFromServer('${navEscape(item.name)}')" title="${navEscape(navT('nav.bk.rsTitle'))}">⏪</button>
                        <button class="danger delete" onclick="deleteGlobalBackup('${navEscape(item.name)}')" title="${navEscape(navT('nav.bk.delTitle'))}">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');

        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(navT('nav.bk.help', { tenant: activeTenantName(), tenantId: navState.activeTenantId || 'default', target: targetText }))}</div>
            ${renderScheduleBackupSettings(scheduleSettings)}
            ${renderRemoteBackupSyncSettings(remoteSettings)}
            <div class="nav-backup-panel">
                <div>
                    <div class="nav-backup-panel-title">${navEscape(navT('nav.bk.svrTitle'))}</div>
                    <div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.svrDesc'))}</div>
                </div>
                <div class="nav-backup-toolbar">
                    <button onclick="createGlobalBackup(false)">${navEscape(navT('nav.bk.btnCreate'))}</button>
                    <button onclick="createGlobalBackup(true)">${navEscape(navT('nav.bk.btnCreateDL'))}</button>
                </div>
            </div>
            <div class="nav-backup-upload">
                <div>
                    <div class="nav-backup-panel-title">${navEscape(navT('nav.bk.upTitle'))}</div>
                    <div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.upDesc'))}</div>
                </div>
                <input id="globalBackupUploadInput" type="file" accept=".zip,application/zip">
                <button class="danger" onclick="restoreGlobalBackupFromUpload()">${navEscape(navT('nav.bk.btnUp'))}</button>
            </div>
            <div class="nav-account-table-wrap">
                <table class="nav-account-table nav-backup-table">
                    <thead><tr><th>${navEscape(navT('nav.bk.thFile'))}</th><th>${navEscape(navT('nav.bk.thAction'))}</th></tr></thead>
                    <tbody>${rows || `<tr><td colspan="2">${navEscape(navT('nav.bk.noData'))}</td></tr>`}</tbody>
                </table>
            </div>
        `;
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.bk.fail'))}${navEscape(e.message)}</div>`;
    }
}

async function renderSnapshotPublishSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(snapshotText('正在读取推送配置与历史…', 'Loading publishing settings and history…'))}</div>`;
    try {
        const [settings, jobs] = await Promise.all([snapshotApi('/settings'), snapshotApi('/jobs')]);
        if (navState.settingsTab !== 'snapshotPublish') return;
        const configKey = getSnapshotConfigKey(settings);
        const cached = getSnapshotPrereqCache(configKey);
        const prereqClass = cached ? (cached.result.gitFound && cached.result.branchReady ? 'ready' : 'attention') : '';
        const prereqContent = cached ? formatSnapshotPrereqHtml(cached.result) : navEscape(snapshotText('正在检测 Git 与 CodeHub 连接…', 'Checking Git and CodeHub access…'));
        content.innerHTML = `
            <div class="snapshot-settings">
                <div id="snapshotPrerequisites" class="snapshot-prerequisites ${prereqClass}" role="status">${prereqContent}</div>
                <div class="snapshot-hero"><span class="snapshot-hero-icon">↗</span><div><strong>${navEscape(snapshotText('平台工具 · 静态页面发布（Git Pages）', 'Platform Tools · Static Page Publishing (Git Pages)'))}</strong><p>${navEscape(snapshotText('推送与平台一致的主页和只读工具，统一使用本地账号登录。账号密码按推送时同步，修改后请再次推送；站点需使用 HTTPS。', 'Publish the platform homepage and read-only tools with one sign-in using local accounts. Account changes take effect after publishing again. HTTPS is required.'))}</p></div></div>
                <div class="snapshot-fields">
                    <label>${navEscape(snapshotText('推送格式', 'Publishing format'))}<select id="snapshotPublishMode" class="nav-settings-input" onchange="updateSnapshotPublishPathPreview(); restartSnapshotEstimates();"><option value="single" ${settings.publishMode !== 'pages' ? 'selected' : ''}>${navEscape(snapshotText('单文件 HTML（数据内嵌）', 'Single HTML (embedded data)'))}</option><option value="pages" ${settings.publishMode === 'pages' ? 'selected' : ''}>${navEscape(snapshotText('Pages 分离版（HTML + JSON + 附件）', 'Split Pages (HTML + JSON + evidence)'))}</option></select><small>${navEscape(snapshotText('下载按钮始终导出可离线查看的单 HTML。Pages 分离版按工具目录存储文件，仅提交有变化的文件。', 'The download button always exports a standalone offline HTML. Split Pages stores assets under the tool directory and commits only changed files.'))}</small></label>
                    <label>${navEscape(snapshotText('远端仓库地址（推荐）', 'Remote Git URL (recommended)'))}<input id="snapshotRemoteUrl" class="nav-settings-input" value="${navEscape(settings.remoteUrl || '')}" placeholder="https://codehub.example.com/team/project.git" autocomplete="off"><small>${navEscape(snapshotText('HTTPS 或 SSH；不要在地址中包含密码或 Token。服务器需已配置 Git 认证。填写后优先使用此地址。', 'HTTPS or SSH; never put a password or token in the URL. Git authentication must be configured on the server. This takes priority when set.'))}</small></label>
                    <label>${navEscape(snapshotText('本地 Git 镜像仓库（可选）', 'Local Git mirror (optional)'))}<input id="snapshotRepoDir" class="nav-settings-input" value="${navEscape(settings.repoDir || '')}" placeholder="D:\\03-工具开发\\privacy-policy-main\\CNBG\\_CS\\_Tools\\_Platform" autocomplete="off"><small>${navEscape(snapshotText('远端地址留空时读取此目录的 origin；不覆盖镜像工作区。', 'When the remote URL is empty, its origin is used. The mirror checkout remains untouched.'))}</small></label>
                    <label>${navEscape(snapshotText('目标分支', 'Target branch'))}<input id="snapshotBranch" class="nav-settings-input" value="${navEscape(settings.branch || 'master')}" autocomplete="off"></label>
                    <label>${navEscape(snapshotText('仓库内 HTML 路径模板', 'HTML path template in repository'))}<input id="snapshotFile" class="nav-settings-input" value="${navEscape(settings.file || '{toolSlug}/index.html')}" placeholder="{toolSlug}/index.html" autocomplete="off" oninput="updateSnapshotPublishPathPreview()"><small>${navEscape(snapshotText('{toolSlug} 使用平台页面或工具的稳定标识。仓库根目录 index.html 将作为工具菜单；更改路径不会自动删除旧路径。', '{toolSlug} uses the stable platform page or tool identifier. Root index.html is reserved for the tool menu; changing paths does not delete old files.'))}</small><small id="snapshotPathPreview" class="snapshot-path-preview">${navEscape(snapshotText('实际页面：', 'Resolved page: '))}${navEscape(settings.resolvedFile || '{toolSlug}/index.html')}${settings.publishMode === 'pages' ? ` · ${navEscape(snapshotText('数据目录：', 'Data directory: '))}${navEscape((settings.resolvedFile || '{toolSlug}/index.html').replace(/[^/]+$/, 'data/'))}` : ''}</small></label>
                </div>
                <div class="snapshot-security">
                    <div class="snapshot-security-head">
                        <div>
                            <strong>${navEscape(snapshotText('已接入静态发布的工具', 'Tools with Snapshot Publishing'))}</strong>
                            <p>${navEscape(snapshotText('勾选参与全量与定时推送的平台页面和工具。默认统一登录；勾选免密码可直接访问。数据抓取可展示脚本，浏览器插件安装包不发布。', 'Choose platform pages and tools for full and scheduled publishing. One sign-in covers private pages; public pages open directly. Capture scripts are included; browser extension packages are excluded.'))}</p>
                        </div>
                        <input type="search" id="snapshotToolsFilter" class="nav-settings-input" style="max-width: 170px; padding: 5px 10px; font-size: 12px; margin-left: auto;" placeholder="${navEscape(snapshotText('搜索工具…', 'Filter tools…'))}" oninput="filterSnapshotTools(this.value)">
                    </div>
                    <div class="snapshot-tools-toolbar">
                        <button type="button" onclick="toggleAllSnapshotTools(true)">${navEscape(snapshotText('全选可推送工具', 'Select eligible tools'))}</button>
                        <button type="button" onclick="toggleAllSnapshotTools(false)">${navEscape(snapshotText('取消全选', 'Clear selection'))}</button>
                        <small>${navEscape(snapshotText('达到 10 MiB 或 100 个文件的工具自动跳过；仅可从该工具顶部强制推送。', 'Tools at 10 MiB or 100 files are skipped; use Force publish from that tool’s top menu.'))}</small>
                    </div>
                    <div class="snapshot-tools-list">
                        ${(settings.tools || [
                            { toolSlug: 'department-reward-penalty', name: '负向事件管理', encryptionEnabled: settings.encryptionEnabled, hasPassword: settings.hasPassword, enabled: true },
                            { toolSlug: 'reward-program', name: '奖励申报与评优', encryptionEnabled: false, hasPassword: false, enabled: true }
                        ]).filter(t => !['f12-to-extension', 'python-updater'].includes(t.toolSlug)).map(t => `
                            <div class="snapshot-tool-item" data-tool-slug="${navEscape(t.toolSlug)}">
                                <div class="snapshot-tool-row">
                                    <label class="snapshot-tool-enable">
                                        <input type="checkbox" id="snapshotToolEnabled_${navEscape(t.toolSlug)}" ${t.enabled !== false ? 'checked' : ''}>
                                        <strong>${navEscape(t.name || t.toolSlug)}</strong>
                                        <small class="snapshot-tool-slug">${navEscape(t.toolSlug)}</small>
                                    </label>
                                    <div class="snapshot-tool-meta-right">
                                        ${t.platformPage ? `<label><input type="checkbox" id="snapshotToolPublic_${navEscape(t.toolSlug)}" ${t.publicAccess ? 'checked' : ''}> ${navEscape(snapshotText('免密码访问', 'Access without sign-in'))}</label><button type="button" onclick="startSnapshotPublish({ toolSlug: '${navEscape(t.toolSlug)}', force: true })">${navEscape(snapshotText('单独强制推送', 'Force publish this page'))}</button>` : ''}
                                        <button type="button" class="snapshot-tool-size-badge pending" id="snapshotToolSize_${navEscape(t.toolSlug)}" title="${navEscape(snapshotText('点击重新预估此工具大小', 'Click to re-estimate data volume'))}" onclick="estimateSingleSnapshotTool('${navEscape(t.toolSlug)}')">
                                            <span class="snapshot-size-loading-dot"></span>
                                            <span class="snapshot-size-text">${navEscape(snapshotText('待预估', 'Pending'))}</span>
                                        </button>
                                    </div>
                                </div>
                                <div class="snapshot-tool-warning-row" id="snapshotToolWarning_${navEscape(t.toolSlug)}" style="display:none"></div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="snapshot-schedule"><div><strong>${navEscape(snapshotText('自动同步', 'Automatic sync'))}</strong><p>${navEscape(snapshotText('后台按周期生成最新只读快照；不需要打开工具页面。仅在服务端或绿色版程序运行时执行。', 'The backend periodically generates a fresh read-only snapshot without opening the tool page. It runs only while the server or portable app is running.'))}</p></div><label class="snapshot-schedule-toggle"><input id="snapshotScheduleEnabled" type="checkbox" ${settings.scheduleEnabled ? 'checked' : ''}> ${navEscape(snapshotText('启用定时推送', 'Enable scheduled publishing'))}</label><label class="snapshot-interval">${navEscape(snapshotText('每隔', 'Every'))} <input id="snapshotIntervalMinutes" class="nav-settings-input" type="number" min="5" max="1440" step="1" value="${Number(settings.intervalMinutes) || 60}"> ${navEscape(snapshotText('分钟', 'minutes'))}</label><div class="snapshot-schedule-status">${settings.scheduleEnabled ? `${navEscape(snapshotText('下次计划执行：', 'Next scheduled run: '))}${navEscape(settings.nextRunAt ? new Date(settings.nextRunAt).toLocaleString() : '-')}` : navEscape(snapshotText('自动推送未启用', 'Scheduled publishing is off'))}${settings.lastAutoError ? `<br>${navEscape(snapshotText('最近调度错误：', 'Last scheduling error: '))}${navEscape(settings.lastAutoError)}` : ''}</div></div>
                <div class="snapshot-actions"><button type="button" onclick="saveSnapshotPublishSettings()">${navEscape(snapshotText('保存推送配置', 'Save destination'))}</button><button type="button" onclick="startSnapshotPublish({ force: true })" title="${navEscape(snapshotText('即使文件未变更，也强制向远端提交并推送，以触发 Pages 重新部署', 'Force a Git commit & push even if no file changes, triggering Pages redeploy'))}">${navEscape(snapshotText('强制推送', 'Force publish'))}</button><button type="button" class="snapshot-primary" onclick="startSnapshotPublish()">${navEscape(snapshotText('生成并推送快照', 'Generate & publish'))}</button></div>
                <div class="snapshot-history-head"><strong>${navEscape(snapshotText('推送历史', 'Publishing history'))}</strong><button type="button" onclick="renderSnapshotPublishSettings(document.getElementById('navSettingsContent'))">↻ ${navEscape(snapshotText('刷新', 'Refresh'))}</button></div>
                <div class="snapshot-history">${jobs.length ? jobs.map(job => `<button type="button" class="snapshot-history-item" data-job-id="${navEscape(job.id)}"><span class="snapshot-dot ${navEscape(job.status)}"></span><span><strong>${job.trigger === 'scheduled' ? navEscape(snapshotText('定时', 'Scheduled')) + ' · ' : ''}${navEscape(job.stage)}</strong><small>${navEscape(new Date(job.createdAt).toLocaleString())} · ${navEscape(job.path)}</small></span><span class="snapshot-percent">${Number(job.progress)}%</span></button>`).join('') : `<div class="snapshot-history-empty">${navEscape(snapshotText('还没有推送记录', 'No publishing runs yet'))}</div>`}</div>
            </div>`;
        content.querySelectorAll('[data-job-id]').forEach(button => button.addEventListener('click', () => openSnapshotPublishProgress(button.dataset.jobId)));
        startSnapshotToolsEstimateQueue();
        if (!cached) {
            checkSnapshotPrerequisites({ settings });
        }
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(snapshotText('读取失败：', 'Failed to load: '))}${navEscape(error.message)}</div>`;
    }
}

window.restartSnapshotEstimates = function () {
    if (snapshotEstimateAbortController) {
        snapshotEstimateAbortController.abort();
        snapshotEstimateAbortController = null;
    }
    startSnapshotToolsEstimateQueue();
};

window.estimateSingleSnapshotTool = async function (toolSlug) {
    const badge = document.getElementById('snapshotToolSize_' + toolSlug);
    const item = document.querySelector(`.snapshot-tool-item[data-tool-slug="${toolSlug}"]`);
    const warnRow = document.getElementById('snapshotToolWarning_' + toolSlug);
    const mode = document.getElementById('snapshotPublishMode')?.value || 'pages';
    if (!badge || !item) return;
    markSnapshotEstimatePending(item);
    const requestId = item.dataset.estimateRequest = String(Date.now()) + Math.random();
    badge.className = 'snapshot-tool-size-badge loading';
    badge.innerHTML = `<span class="snapshot-size-loading-dot"></span><span class="snapshot-size-text">${navEscape(snapshotText('预估中…', 'Estimating…'))}</span>`;

    try {
        const res = await snapshotApi('/estimate/' + encodeURIComponent(toolSlug) + '?mode=' + encodeURIComponent(mode) + '&refresh=1');
        if (item.dataset.estimateRequest !== requestId) return;
        applyToolEstimateResult(toolSlug, res, badge, item, warnRow);
    } catch (err) {
        if (item.dataset.estimateRequest === requestId) failSnapshotEstimate(item, badge);
    }
};

function applyToolEstimateResult(toolSlug, res, badge, item, warnRow) {
    if (!badge || !res || !item?.isConnected) return;
    const countText = snapshotText(`${res.fileCount} 个文件`, `${res.fileCount} files`);
    const sizeText = res.totalSizeFormatted || '0 B';
    const reduced = res.demoLevel === 'latest' || res.demoLevel === 'empty';
    const blocked = (res.isHeavy && !reduced) || res.supported === false;
    item.dataset.estimateState = blocked ? 'blocked' : 'ready';
    const checkbox = document.getElementById('snapshotToolEnabled_' + toolSlug);
    if (checkbox) {
        checkbox.disabled = blocked;
        checkbox.checked = !blocked && item.dataset.requestedEnabled === '1';
    }
    badge.className = 'snapshot-tool-size-badge badge-' + (blocked ? 'danger' : reduced ? 'warning' : res.warningLevel || 'normal');
    badge.title = snapshotText('点击重新预估此工具大小', 'Click to re-estimate data volume');
    badge.innerHTML = `${blocked ? '⚠️ ' : ''}<span class="snapshot-size-text">${navEscape(countText)} · ${navEscape(sizeText)}</span>`;
    item.classList.toggle('snapshot-tool-heavy', blocked);
    if (warnRow) {
        warnRow.style.display = blocked || reduced ? 'flex' : 'none';
        warnRow.className = 'snapshot-tool-warning-row snapshot-heavy-warning';
        warnRow.textContent = res.demoLevel === 'latest'
            ? snapshotText('完整快照超限，自动发布仅包含最新数据的演示。', 'The full snapshot exceeds the size limit. Only the latest data will be published.')
            : res.demoLevel === 'empty'
                ? snapshotText('快照数据超限，自动发布不带业务数据的演示页面。', 'Snapshot data exceeds the size limit. The demo page will be published without business data.')
                : blocked ? snapshotText('批量与定时推送自动跳过，已发布版本保留。请打开该工具，在顶部选择“强制推送”单独更新；不会截断历史数据。', 'Skipped in bulk and scheduled publishing; the published version is retained. Open this tool and use Force publish from its top menu. History is preserved.') : '';
    }
}

window.toggleAllSnapshotTools = function (checked) {
    document.querySelectorAll('.snapshot-tool-item[data-tool-slug]').forEach(item => {
        if (item.hidden) return;
        item.dataset.requestedEnabled = checked ? '1' : '0';
        const checkbox = document.getElementById('snapshotToolEnabled_' + item.dataset.toolSlug);
        if (checkbox) checkbox.checked = !checkbox.disabled && checked;
    });
};

function markSnapshotEstimatePending(item) {
    const input = document.getElementById('snapshotToolEnabled_' + item.dataset.toolSlug);
    if (input) {
        if (!input.disabled) item.dataset.requestedEnabled = input.checked ? '1' : '0';
        input.disabled = true; input.checked = false;
    }
    item.dataset.estimateState = 'pending';
}

function failSnapshotEstimate(item, badge) {
    item.dataset.estimateState = 'error';
    badge.className = 'snapshot-tool-size-badge error';
    badge.textContent = snapshotText('预估失败，点击重试', 'Estimate failed; click to retry');
}

function startSnapshotToolsEstimateQueue() {
    if (snapshotEstimateAbortController) {
        snapshotEstimateAbortController.abort();
    }
    const ac = new AbortController();
    snapshotEstimateAbortController = ac;

    const items = Array.from(document.querySelectorAll('.snapshot-tool-item[data-tool-slug]'));
    if (!items.length) return;

    const mode = document.getElementById('snapshotPublishMode')?.value || 'pages';

    // 初始将所有 badge 标记为待预估
    items.forEach(item => {
        markSnapshotEstimatePending(item);
        item.dataset.estimateRequest = '';
        const slug = item.dataset.toolSlug;
        const badge = document.getElementById('snapshotToolSize_' + slug);
        if (badge) {
            badge.className = 'snapshot-tool-size-badge pending';
            badge.innerHTML = `<span class="snapshot-size-text">${navEscape(snapshotText('排队中…', 'Queued…'))}</span>`;
        }
    });

    // 串行预估，避免同时生成多个业务快照。
    (async () => {
        for (const item of items) {
            if (ac.signal.aborted) return;
            const slug = item.dataset.toolSlug;
            if (!slug) continue;
            const badge = document.getElementById('snapshotToolSize_' + slug);
            const warnRow = document.getElementById('snapshotToolWarning_' + slug);
            if (!badge || item.dataset.estimateState !== 'pending' || item.dataset.estimateRequest) continue;
            const requestId = item.dataset.estimateRequest = String(Date.now()) + Math.random();

            badge.className = 'snapshot-tool-size-badge loading';
            badge.innerHTML = `<span class="snapshot-size-loading-dot"></span><span class="snapshot-size-text">${navEscape(snapshotText('预估中…', 'Estimating…'))}</span>`;

            try {
                const res = await snapshotApi('/estimate/' + encodeURIComponent(slug) + '?mode=' + encodeURIComponent(mode), {
                    signal: ac.signal
                });
                if (ac.signal.aborted) return;
                if (item.dataset.estimateRequest !== requestId) continue;
                applyToolEstimateResult(slug, res, badge, item, warnRow);
            } catch (err) {
                if (ac.signal.aborted) return;
                if (item.dataset.estimateRequest === requestId) failSnapshotEstimate(item, badge);
            }

            // 每个工具间隔 60ms 释放 CPU 与渲染线程，防止卡顿
            await new Promise(r => setTimeout(r, 60));
        }
    })().catch(() => {});
}

window.filterSnapshotTools = function (query) {
    const q = String(query || '').trim().toLowerCase();
    document.querySelectorAll('.snapshot-tool-item[data-tool-slug]').forEach(item => {
        const slug = (item.dataset.toolSlug || '').toLowerCase();
        const name = (item.querySelector('strong')?.textContent || '').toLowerCase();
        const match = !q || slug.includes(q) || name.includes(q);
        item.style.display = match ? '' : 'none';
    });
};

window.updateSnapshotPublishPathPreview = function () {
    const preview = document.getElementById('snapshotPathPreview');
    const input = document.getElementById('snapshotFile');
    if (!preview || !input) return;
    const path = input.value.trim().replace('{toolSlug}', 'department-reward-penalty');
    const valid = path !== 'index.html' && /^[\w./-]+\.html$/.test(path) && !path.startsWith('/') && !path.split('/').some(part => !part || part === '..');
    preview.textContent = valid ? snapshotText('实际页面：', 'Resolved page: ') + path + (document.getElementById('snapshotPublishMode')?.value === 'pages' ? ' · ' + snapshotText('数据目录：', 'Data directory: ') + path.replace(/[^/]+$/, 'data/') : '') : snapshotText('路径格式无效，请使用 {toolSlug}/index.html 等相对路径', 'Invalid path. Use a relative path such as {toolSlug}/index.html');
};

function renderInitializationSettings(content) {
    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.init.help'))}</div>
        <section class="nav-init-card">
            <div>
                <div class="nav-backup-panel-title">🚀 ${navEscape(navT('nav.init.quickTitle'))}</div>
                <div class="nav-backup-panel-desc">${navEscape(navT('nav.init.quickDesc'))}</div>
            </div>
            <button type="button" onclick="enableQuickStartMode()">${navEscape(navT('nav.init.quickButton'))}</button>
        </section>
        <section class="nav-init-card danger-zone">
            <div>
                <div class="nav-init-danger-label">⚠ ${navEscape(navT('nav.init.dangerLabel'))}</div>
                <div class="nav-backup-panel-title">${navEscape(navT('nav.init.resetTitle'))}</div>
                <div class="nav-backup-panel-desc">${navEscape(navT('nav.init.resetDesc'))}</div>
                <div class="nav-init-note">${navEscape(navT('nav.init.resetArchive'))}</div>
            </div>
            <button type="button" class="danger" onclick="factoryResetProgramData()">${navEscape(navT('nav.init.resetButton'))}</button>
        </section>
        <div id="navInitializationStatus" class="nav-init-status" role="status"></div>
    `;
}

function setInitializationStatus(message, tone = '') {
    const element = document.getElementById('navInitializationStatus');
    if (!element) return;
    element.textContent = message || '';
    element.className = `nav-init-status ${tone}`.trim();
}

window.enableQuickStartMode = async function () {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.init.quickConfirmTitle'),
        message: navT('nav.init.quickConfirmMessage'),
        hint: navT('nav.init.quickConfirmHint'),
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.init.quickButton')
    });
    if (!confirmed) return;
    setInitializationStatus(navT('nav.init.quickRunning'));
    try {
        const response = await fetch('/api/onboarding/defaults/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ importScripts: true, importMetricRules: true })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        const result = data.state?.result || {};
        const message = navT('nav.init.quickSuccess')
            .replace('{scripts}', result.scriptsAdded || 0)
            .replace('{rules}', (result.targetsAdded || 0) + (result.preferencesAdded || 0))
            .replace('{groups}', result.groupsAdded || 0);
        setInitializationStatus(message, 'success');
    } catch (error) {
        setInitializationStatus(navT('nav.init.failed') + error.message, 'error');
    }
};

window.factoryResetProgramData = async function () {
    const confirmed = await showNavbarTypedConfirm({
        title: navT('nav.init.resetConfirmTitle'),
        message: navT('nav.init.resetConfirmMessage'),
        hint: navT('nav.init.resetConfirmHint'),
        placeholder: navT('nav.init.resetPlaceholder'),
        requiredText: 'RESET',
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.init.resetAction')
    });
    if (!confirmed) return;
    setInitializationStatus(navT('nav.init.resetRunning'));
    try {
        const response = await fetch('/api/onboarding/factory-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ confirmation: 'RESET' })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        const successKey = data.needsRestart === false ? 'nav.init.resetSuccessNoRestart' : 'nav.init.resetSuccess';
        setInitializationStatus(navT(successKey).replace('{backup}', data.backup || '-'), 'success');
        localStorage.clear();
        sessionStorage.clear();
        if (data.needsRestart === false) setTimeout(() => { window.location.href = './login.html'; }, 900);
    } catch (error) {
        setInitializationStatus(navT('nav.init.failed') + error.message, 'error');
    }
};

function customToolDependencyBadges(tool) {
    const dependencies = tool.dependencies || {};
    const badges = [
        `<span class="nav-custom-backup-badge files">${navEscape(customToolBackupText('nav.ctbk.files', { count: tool.fileCount || 0 }))}</span>`,
        `<span class="nav-custom-backup-badge state">${navEscape(navT('nav.ctbk.serverState'))}</span>`
    ];
    const mappings = [
        ['localStorageKeys', 'nav.ctbk.localState', 'local'],
        ['platformApiPaths', 'nav.ctbk.apiDeps', 'api'],
        ['externalUrls', 'nav.ctbk.externalDeps', 'external'],
        ['indexedDbNames', 'nav.ctbk.indexedDb', 'warning']
    ];
    mappings.forEach(([field, key, tone]) => {
        const count = Array.isArray(dependencies[field]) ? dependencies[field].length : 0;
        if (count) badges.push(`<span class="nav-custom-backup-badge ${tone}">${navEscape(customToolBackupText(key, { count }))}</span>`);
    });
    return badges.join('');
}

async function renderCustomToolBackupSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ctbk.loading'))}</div>`;
    try {
        const res = await fetch('/api/custom-tools/backup/summary', { headers: getAuthHeaderForNav() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        navState.customToolBackupSummary = data;
        const tools = Array.isArray(data.tools) ? data.tools : [];
        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(navT('nav.ctbk.help'))}</div>
            <div class="nav-custom-backup-portability">
                <div class="nav-custom-backup-portability-icon">🧭</div>
                <div><strong>${navEscape(navT('nav.ctbk.portabilityTitle'))}</strong><p>${navEscape(navT('nav.ctbk.portability'))}</p></div>
            </div>
            <section class="nav-custom-backup-card">
                <div class="nav-custom-backup-head">
                    <div><div class="nav-backup-panel-title">${navEscape(navT('nav.ctbk.exportTitle'))}</div><div class="nav-backup-panel-desc">${navEscape(navT('nav.ctbk.exportDesc'))}</div></div>
                    <div id="customToolBackupSelectionSummary" class="nav-custom-backup-selection"></div>
                </div>
                <div class="nav-custom-backup-list">
                    ${tools.map(tool => `
                        <label class="nav-custom-backup-tool">
                            <input type="checkbox" data-custom-backup-slug="${navEscape(tool.slug)}" checked onchange="updateCustomToolBackupSelectionSummary()">
                            <span class="nav-custom-backup-tool-icon">${navEscape(tool.icon || '🧩')}</span>
                            <span class="nav-custom-backup-tool-main">
                                <strong>${navEscape(tool.name || tool.slug)}</strong>
                                <code>${navEscape(tool.slug)}</code>
                                <span class="nav-custom-backup-badges">${customToolDependencyBadges(tool)}</span>
                            </span>
                            <span class="nav-custom-backup-size">${navEscape(formatBackupSize(tool.totalBytes || 0))}</span>
                        </label>
                    `).join('') || `<div class="nav-settings-empty">${navEscape(navT('nav.ctbk.empty'))}</div>`}
                </div>
                ${tools.length ? `<div class="nav-backup-toolbar nav-custom-backup-actions">
                    <button type="button" onclick="setAllCustomToolBackupSelections(true)">${navEscape(navT('nav.ctbk.btnAll'))}</button>
                    <button type="button" onclick="setAllCustomToolBackupSelections(false)">${navEscape(navT('nav.ctbk.btnNone'))}</button>
                    <button type="button" class="primary" onclick="exportCustomToolBackup()">${navEscape(navT('nav.ctbk.btnExport'))}</button>
                </div>` : ''}
            </section>
            <section class="nav-custom-backup-card restore">
                <div><div class="nav-backup-panel-title">${navEscape(navT('nav.ctbk.restoreTitle'))}</div><div class="nav-backup-panel-desc">${navEscape(navT('nav.ctbk.restoreDesc'))}</div></div>
                <div class="nav-custom-backup-restore-row">
                    <input id="customToolBackupRestoreInput" type="file" accept=".zip,application/zip">
                    <select id="customToolBackupConflictStrategy" class="nav-settings-input">
                        <option value="replace">${navEscape(navT('nav.ctbk.strategyReplace'))}</option>
                        <option value="skip">${navEscape(navT('nav.ctbk.strategySkip'))}</option>
                    </select>
                    <button type="button" class="danger" onclick="restoreCustomToolBackup()">${navEscape(navT('nav.ctbk.btnRestore'))}</button>
                </div>
            </section>
        `;
        updateCustomToolBackupSelectionSummary();
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ctbk.fail'))}${navEscape(e.message)}</div>`;
    }
}

async function renderMediaSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">正在加载媒体资源库...</div>`;
    try {
        const [overviewRes, videosRes] = await Promise.all([
            fetch('/api/media/admin/overview', { headers: getAuthHeaderForNav() }),
            fetch('/api/media/admin/videos', { headers: getAuthHeaderForNav() })
        ]);

        if (!overviewRes.ok || !videosRes.ok) {
            throw new Error(`无法获取媒体资源数据 (HTTP ${overviewRes.status}/${videosRes.status})`);
        }

        const overview = await overviewRes.json();
        const videosData = await videosRes.json();
        navState.mediaOverviewCache = overview;
        navState.mediaVideosCache = videosData.data || [];
        navState.mediaCategoriesCache = videosData.categories || [];

        renderMediaSettingsHtml(content, overview, navState.mediaVideosCache, navState.mediaCategoriesCache);
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty" style="color:#ef4444;">加载媒体资源管理失败：${navEscape(e.message)}</div>`;
    }
}

function renderMediaSettingsHtml(content, overview, videos, categories) {
    const managedCategories = categories.filter(category => category.id !== 'all');
    const categoryCount = category => videos.filter(video => {
        if (category.folder) return video.folder === category.folder || video.category === category.id;
        return video.category === category.id;
    }).length;

    const activeFilter = navState.mediaCategoryFilter || 'all';
    const query = (navState.mediaSearchQuery || '').trim().toLowerCase();
    const feiniu = overview.feiniu || {
        url: 'https://feiniu.fanxiaolong.uk/v',
        username: 'admin',
        hasPassword: true,
        enabled: true,
        serverName: '雪花肥牛',
        connected: false,
        totalVideos: 0,
        lastError: ''
    };

    let filteredVideos = videos;
    if (activeFilter !== 'all') {
        filteredVideos = filteredVideos.filter(v => (v.folder || '') === activeFilter || v.category === activeFilter);
    }
    if (query) {
        filteredVideos = filteredVideos.filter(v =>
            (v.title && v.title.toLowerCase().includes(query)) ||
            (v.fileName && v.fileName.toLowerCase().includes(query)) ||
            (v.tags && v.tags.some(t => t.toLowerCase().includes(query)))
        );
    }

    content.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <!-- 资产总体概况卡片 -->
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px;">
                <div class="nav-media-stat-card" style="border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:12px; color:var(--v2-ink3, #64748b); margin-bottom:4px;">🎬 视频资产总数</div>
                    <div style="font-size:22px; font-weight:800; color:var(--v2-ink, #0f172a);">${overview.totalVideos} <span style="font-size:12px; font-weight:500; color:var(--v2-ink3, #64748b);">部</span></div>
                </div>
                <div class="nav-media-stat-card" style="border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:12px; color:var(--v2-ink3, #64748b); margin-bottom:4px;">📁 分类文件夹</div>
                    <div style="font-size:22px; font-weight:800; color:var(--v2-ink, #0f172a);">${overview.totalCategories} <span style="font-size:12px; font-weight:500; color:var(--v2-ink3, #64748b);">个</span></div>
                </div>
                <div class="nav-media-stat-card" style="border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:12px; color:var(--v2-ink3, #64748b); margin-bottom:4px;">💾 媒体库占用</div>
                    <div style="font-size:22px; font-weight:800; color:#6366f1;">${overview.totalSizeFormatted}</div>
                </div>
                <div class="nav-media-stat-card" style="border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:12px; color:var(--v2-ink3, #64748b); margin-bottom:4px;">💽 磁盘可用空间</div>
                    <div style="font-size:22px; font-weight:800; color:#10b981;">${overview.disk.freeGb} <span style="font-size:12px; font-weight:500; color:var(--v2-ink3, #64748b);">GB 可用</span></div>
                </div>
            </div>

            <!-- 飞牛影视远程对接配置卡片 -->
            <div class="nav-media-remote-card" style="border:1px solid #bfdbfe; border-radius:12px; padding:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span style="font-size:15px; font-weight:800; color:var(--v2-ink, #0f172a);">☁️ 飞牛影视对接</span>
                        ${feiniu.connected
                            ? `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:#dcfce7; color:#15803d; font-size:12px; font-weight:600;">● 已连接「${navEscape(feiniu.serverName || '飞牛影视')}」· 同步 ${Number(feiniu.totalVideos) || 0} 部视频</span>`
                            : (!feiniu.enabled
                                ? `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:var(--v2-chip, #e2e8f0); color:var(--v2-ink3, #475569); font-size:12px; font-weight:600;">⏸️ 已暂停对接</span>`
                                : `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:#fef3c7; color:#b45309; font-size:12px; font-weight:600;">⚠️ 未连接${feiniu.lastError ? '：' + navEscape(feiniu.lastError) : ''}</span>`
                            )
                        }
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--v2-ink, #334155); cursor:pointer;">
                            <input type="checkbox" id="feiniuEnabledInput" ${feiniu.enabled !== false ? 'checked' : ''} style="width:15px; height:15px; accent-color:#2563eb;">
                            <span>启用飞牛片源接入</span>
                        </label>
                    </div>
                </div>
                <div class="nav-media-feiniu-fields">
                    <label style="display:block; font-size:12px; font-weight:600; color:var(--v2-ink, #334155);">
                        对接链接
                        <input type="url" id="feiniuUrlInput" class="nav-settings-input" value="${navEscape(feiniu.url || 'https://feiniu.fanxiaolong.uk/v')}" placeholder="https://feiniu.fanxiaolong.uk/v" style="display:block; width:100%; box-sizing:border-box; margin-top:4px; padding:8px 10px; border-radius:8px; font-size:13px;">
                    </label>
                    <label style="display:block; font-size:12px; font-weight:600; color:var(--v2-ink, #334155);">
                        账号
                        <input type="text" id="feiniuUsernameInput" class="nav-settings-input" value="${navEscape(feiniu.username || 'admin')}" placeholder="输入飞牛账号" autocomplete="username" style="display:block; width:100%; box-sizing:border-box; margin-top:4px; padding:8px 10px; border-radius:8px; font-size:13px;">
                    </label>
                    <label style="display:block; font-size:12px; font-weight:600; color:var(--v2-ink, #334155);">
                        密码
                        <input type="password" id="feiniuPasswordInput" class="nav-settings-input" value="${feiniu.hasPassword ? '********' : ''}" placeholder="输入飞牛密码" autocomplete="current-password" style="display:block; width:100%; box-sizing:border-box; margin-top:4px; padding:8px 10px; border-radius:8px; font-size:13px;">
                    </label>
                    <div style="display:flex; gap:8px;">
                        <button type="button" onclick="saveFeiniuMediaConfig(this)" style="height:36px; padding:0 14px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap;">
                            🔗 保存并对接
                        </button>
                        <button type="button" class="nav-settings-add" onclick="syncFeiniuMediaCatalog(this)" style="height:36px; padding:0 12px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;" title="立即从飞牛影视同步影片列表">
                            🔄 同步片库
                        </button>
                    </div>
                </div>
            </div>

            <!-- 操作工具条 -->
            <div class="nav-media-toolbar-card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:12px; border:1px solid #e2e8f0; border-radius:10px;">
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button type="button" class="sys-btn" onclick="openCreateMediaFolderModal()" style="background:#6366f1; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                        <span>+</span> 新建分类文件夹
                    </button>
                    <button type="button" class="sys-btn" onclick="openImportLocalMediaModal()" style="background:#0ea5e9; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                        <span>📥</span> 本地目录一键导入
                    </button>
                    <a href="${navToolShellUrl('/cinema')}" target="_blank" class="nav-settings-add" style="text-decoration:none; border-radius:6px; padding:6px 12px; font-size:13px; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                        <span>🎬</span> 预览点播大厅 ↗
                    </a>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button type="button" class="nav-settings-add" onclick="renderMediaSettings(document.getElementById('navSettingsContent'))" style="border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;" title="重新扫描磁盘视频">
                        🔄 刷新
                    </button>
                </div>
            </div>

            <!-- 分类切换与实时筛选 -->
            <div class="nav-media-filter-row">
                <div class="nav-media-category-tabs" aria-label="${navEscape(navT('nav.media.categoryFilter'))}">
                    <button type="button" class="tab-item" aria-pressed="${activeFilter === 'all'}" onclick="switchMediaCategoryFilter('all')" style="border-radius:20px; padding:4px 14px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid ${activeFilter === 'all' ? '#6366f1' : 'var(--v2-line, #cbd5e1)'}; background:${activeFilter === 'all' ? '#6366f1' : 'var(--v2-chip, #fff)'}; color:${activeFilter === 'all' ? '#fff' : 'var(--v2-ink2, #475569)'};">
                        全部 (${videos.length})
                    </button>
                    ${managedCategories.map(c => {
        const filterValue = c.folder || c.id;
        const cnt = categoryCount(c);
        const isAct = activeFilter === filterValue;
        return `
                            <button type="button" class="tab-item" aria-pressed="${isAct}" onclick="switchMediaCategoryFilter('${navEscape(filterValue)}')" style="border-radius:20px; padding:4px 14px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid ${isAct ? '#6366f1' : 'var(--v2-line, #cbd5e1)'}; background:${isAct ? '#6366f1' : 'var(--v2-chip, #fff)'}; color:${isAct ? '#fff' : 'var(--v2-ink2, #475569)'}; display:inline-flex; align-items:center; gap:4px;">
                                <span>${c.icon || '📁'}</span> ${navEscape(c.name || filterValue || '独家影院')} (${cnt})
                            </button>
                        `;
    }).join('')}
                </div>
                <label class="nav-media-search">
                    <span aria-hidden="true">🔍</span>
                    <input type="search" id="mediaSearchInput" value="${navEscape(navState.mediaSearchQuery)}" placeholder="搜索片名、文件名或标签..." oninput="handleMediaSearchInput(this.value)" aria-label="${navEscape(navT('nav.media.searchLabel'))}">
                </label>
            </div>

            <!-- 视频表格管理区 -->
            <div style="background:var(--v2-side, #fff); border:1px solid var(--v2-line, #e2e8f0); border-radius:10px; overflow:hidden;">
                <div class="nav-media-table-scroll">
                    <table class="nav-media-table">
                        <thead>
                            <tr style="background:var(--v2-chip, #f8fafc); border-bottom:1px solid var(--v2-line, #e2e8f0); color:var(--v2-ink3, #64748b); font-weight:600;">
                                <th style="padding:10px 12px; width:70px;">封面</th>
                                <th style="padding:10px 12px;">片名 & 文件名</th>
                                <th style="padding:10px 12px; width:130px;">所属分类</th>
                                <th style="padding:10px 12px; width:100px;">大小规格</th>
                                <th style="padding:10px 12px; width:248px; text-align:center;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredVideos.length === 0 ? `
                                <tr>
                                    <td colspan="5" style="padding:40px; text-align:center; color:#94a3b8;">未找到匹配的视频媒体文件</td>
                                </tr>
                            ` : filteredVideos.map(item => `
                                <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                                    <td style="padding:8px 12px;">
                                        <div onclick="previewMediaVideo('${navEscape(item.src)}', '${navEscape(item.title)}')" style="width:64px; height:40px; border-radius:4px; overflow:hidden; position:relative; cursor:pointer; background:#000;">
                                            <img src="${item.poster || './tp-static/frontend/assets/videos/龙餐馆_poster.jpg'}" style="width:100%; height:100%; object-fit:cover;" loading="lazy">
                                            <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.3); opacity:0; transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0'">
                                                <span style="color:#fff; font-size:14px;">▶</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td style="padding:8px 12px;">
                                        <div style="font-weight:600; color:#0f172a; margin-bottom:2px; display:flex; align-items:center; gap:6px;" title="${navEscape(item.title)}">
                                            <span>${navEscape(item.title)}</span>
                                            ${item.source === 'feiniu' ? `<span style="padding:1px 6px; border-radius:999px; background:#dbeafe; color:#1d4ed8; font-size:10px; font-weight:700;">☁️ 飞牛</span>` : ''}
                                        </div>
                                        <div class="nav-media-item-meta">
                                            <span class="nav-media-file-name">${navEscape(item.fileName)}</span>
                                            <label class="nav-media-priority" title="数字越小，在影视作品展播中越靠前">
                                                <span>优先级</span>
                                                <input type="number" step="1" value="${Number.isSafeInteger(item.order) ? item.order : 1000}" onchange="setMediaPriority('${navEscape(item.id)}', this.value, this)" aria-label="${navEscape(item.title)} 展播优先级">
                                            </label>
                                        </div>
                                    </td>
                                    <td style="padding:8px 12px;">
                                        <span style="display:inline-block; padding:2px 8px; border-radius:12px; background:#eff6ff; color:#2563eb; font-size:11px; font-weight:500;">
                                            ${navEscape(item.categoryName || item.folder || '独家影院')}
                                        </span>
                                    </td>
                                    <td style="padding:8px 12px;">
                                        <div style="font-weight:500; color:#334155;">${navEscape(item.fileSizeFormatted)}</div>
                                        <div style="font-size:11px; color:#94a3b8;">${navEscape(item.format)} · ${navEscape(item.resolution || 'HD')}</div>
                                    </td>
                                    <td style="padding:8px 12px; text-align:center;">
                                        <div class="nav-media-row-actions">
                                            <button type="button" class="nav-media-action" onclick="previewMediaVideo('${navEscape(item.src)}', '${navEscape(item.title)}')" title="在线预览播放">
                                                👁️ 预览
                                            </button>
                                            <button type="button" class="nav-media-action" onclick="openEditMediaModal('${navEscape(item.id)}')" title="修改标题、分类与简介">
                                                ✏️ 编辑
                                            </button>
                                            ${item.source === 'feiniu' ? `
                                                <span style="font-size:11px; color:#64748b; padding:0 6px;" title="飞牛远程流媒体">☁️ 远程源</span>
                                            ` : `
                                                <button type="button" class="nav-media-action" onclick="extractMediaPoster('${navEscape(item.id)}')" title="重新截取高清封面帧">
                                                    🖼️ 抽帧
                                                </button>
                                                <button type="button" class="nav-media-action danger" onclick="deleteMediaVideo('${navEscape(item.id)}', '${navEscape(item.title)}')" title="彻底删除该视频" aria-label="删除 ${navEscape(item.title)}">
                                                    🗑️
                                                </button>
                                            `}
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 分类文件夹管理卡片 -->
            <div class="nav-media-folder-card" style="border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                <div style="font-size:13px; font-weight:700; color:var(--v2-ink, #0f172a); margin-bottom:10px;">📁 现有分类文件夹列表</div>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px;">
                    ${managedCategories.map(cat => {
        const f = cat.folder || '';
        const isFeiniuCat = cat.source === 'feiniu' || String(cat.id || '').startsWith('feiniu-');
        const isSystem = !f || f === 'film' || isFeiniuCat;
        const cnt = categoryCount(cat);
        return `
                            <div class="nav-media-folder-item" style="border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
                                <div>
                                    <div style="font-weight:600; font-size:13px; color:var(--v2-ink, #0f172a);">${cat.icon || '📁'} ${navEscape(cat.name || f || '独家影院')}</div>
                                    <div style="font-size:11px; color:var(--v2-ink3, #64748b); margin-top:2px;">目录: ${f ? navEscape(f) : '根目录'} · ${cnt} 部视频</div>
                                    <label class="nav-media-priority" title="数字越小，分类越靠前" style="margin-top:6px;">
                                        <span>分类优先级</span>
                                        <input type="number" step="1" value="${Number.isSafeInteger(cat.order) ? cat.order : 0}" onchange="setMediaCategoryPriority('${navEscape(cat.id)}', this.value, this)" aria-label="${navEscape(cat.name || f)} 分类优先级">
                                    </label>
                                </div>
                                <div style="display:flex; gap:4px;">
                                    ${!isFeiniuCat ? `
                                        <button type="button" class="nav-settings-add" onclick="openEditMediaCategoryModal('${navEscape(cat.id)}')" style="border-radius:6px;padding:3px 9px;font-size:11px;font-weight:600;cursor:pointer;" title="设置分类访问保护">
                                            ${cat.protected ? '🔒 PIN' : '设置'}
                                        </button>
                                    ` : ''}
                                    ${!isSystem ? `
                                        <button type="button" class="nav-settings-add danger" onclick="deleteMediaFolder('${navEscape(f)}')" style="border-radius:6px; padding:3px 9px; font-size:11px; font-weight:600; cursor:pointer;" title="删除分类">
                                            删除
                                        </button>
                                    ` : `<span style="font-size:11px; color:var(--v2-ink3, #94a3b8);">${isFeiniuCat ? '飞牛媒体库' : '系统内置'}</span>`}
                                </div>
                            </div>
                        `;
    }).join('')}
                </div>
            </div>
        </div>
    `;
}

// 保存并对接飞牛影视配置
window.saveFeiniuMediaConfig = async function (btn) {
    const urlInput = document.getElementById('feiniuUrlInput');
    const usernameInput = document.getElementById('feiniuUsernameInput');
    const passwordInput = document.getElementById('feiniuPasswordInput');
    const enabledInput = document.getElementById('feiniuEnabledInput');

    const url = (urlInput?.value || 'https://feiniu.fanxiaolong.uk/v').trim() || 'https://feiniu.fanxiaolong.uk/v';
    const username = (usernameInput?.value || 'admin').trim() || 'admin';
    const password = passwordInput?.value || '';
    const enabled = enabledInput ? Boolean(enabledInput.checked) : true;

    const origText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在对接...';
    }
    try {
        const res = await fetch('/api/media/admin/feiniu/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ url, username, password, enabled })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        await renderMediaSettings(document.getElementById('navSettingsContent'));
        showNavbarNotice({
            title: '飞牛影视对接成功',
            message: data.message || '飞牛影视配置已保存并完成影片同步。',
            tone: 'success'
        });
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = origText || '🔗 保存并对接';
        }
        showNavbarNotice({
            title: '飞牛影视对接失败',
            message: error.message || '请检查飞牛影视地址、账号与密码是否正确。',
            tone: 'error'
        });
    }
};

// 手动立即同步飞牛影视片库
window.syncFeiniuMediaCatalog = async function (btn) {
    const origText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 同步中...';
    }
    try {
        const res = await fetch('/api/media/admin/feiniu/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        await renderMediaSettings(document.getElementById('navSettingsContent'));
        showNavbarNotice({
            title: '飞牛片库已同步',
            message: data.message || '已同步最新飞牛影视列表。',
            tone: 'success'
        });
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = origText || '🔄 同步片库';
        }
        showNavbarNotice({
            title: '同步失败',
            message: error.message || '无法从飞牛影视拉取最新列表。',
            tone: 'error'
        });
    }
};

// 客户端即时筛选分类
window.switchMediaCategoryFilter = function (category) {
    navState.mediaCategoryFilter = category;
    const content = document.getElementById('navSettingsContent');
    if (content && navState.mediaOverviewCache) {
        renderMediaSettingsHtml(content, navState.mediaOverviewCache, navState.mediaVideosCache, navState.mediaCategoriesCache);
    }
};

// 客户端即时搜索
window.handleMediaSearchInput = function (val) {
    navState.mediaSearchQuery = val;
    clearTimeout(navState.mediaSearchTimer);
    navState.mediaSearchTimer = setTimeout(() => {
        const content = document.getElementById('navSettingsContent');
        if (!content || !navState.mediaOverviewCache) return;
        renderMediaSettingsHtml(content, navState.mediaOverviewCache, navState.mediaVideosCache, navState.mediaCategoriesCache);
        const input = document.getElementById('mediaSearchInput');
        if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }, 180);
};

window.setMediaPriority = async function (videoId, value, input) {
    const order = Number(value);
    if (!Number.isSafeInteger(order)) {
        showNavbarNotice({
            title: '输入提示',
            message: '优先级请输入整数；数字越小，展播顺序越靠前。',
            tone: 'info'
        });
        return;
    }
    if (input) input.disabled = true;
    try {
        const response = await fetch(`/api/media/admin/videos/${encodeURIComponent(videoId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ order })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        await renderMediaSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (input) input.disabled = false;
        showNavbarNotice({
            title: '保存失败',
            message: `优先级保存失败：${error.message}`,
            tone: 'error'
        });
    }
};

// 播放预览弹窗
window.previewMediaVideo = function (src, title) {
    let modal = document.getElementById('mediaPreviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'mediaPreviewModal';
        modal.className = 'nav-media-preview-modal';
        modal.addEventListener('click', event => {
            if (event.target === modal) closeMediaPreview();
        });
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="nav-media-preview-dialog" role="dialog" aria-modal="true" aria-label="播放预览：${navEscape(title)}">
            <div class="nav-media-preview-head">
                <div class="nav-media-preview-title">🎬 播放预览：${navEscape(title)}</div>
                <button type="button" class="nav-media-preview-back" onclick="closeMediaPreview()">← ${navEscape(navT('nav.media.previewBack'))}</button>
            </div>
            <div class="nav-media-preview-player">
                <video id="previewVideoEl" src="${navEscape(src)}" controls autoplay playsinline></video>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    modal.querySelector('.nav-media-preview-back')?.focus();
};

// 媒体分类与设备文件导入
function openMediaForm(importing) {
    document.getElementById('mediaFormDialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'mediaFormDialog';
    if (importing) dialog.classList.add('is-importing');
    dialog.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);margin:0;width:min(${importing ? '650px' : '520px'},calc(100vw - 32px));max-height:85vh;padding:26px 28px;border:1px solid rgba(148,163,184,0.35);border-radius:18px;background:var(--v2-bg, #ffffff);color:var(--v2-ink, #172033);box-shadow:0 28px 80px rgba(15,23,42,0.28);overflow:auto;z-index:100005;`;
    dialog.innerHTML = `
        <form method="dialog" style="margin:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <h2 style="margin:0;font-size:20px;font-weight:700;color:var(--v2-ink, #0f172a);">${importing ? '📥 导入媒体' : '📁 新建分类'}</h2>
                <button type="button" id="mediaFormCloseX" title="关闭" style="border:none;background:none;font-size:22px;line-height:1;color:var(--v2-ink3, #94a3b8);cursor:pointer;padding:4px 6px;border-radius:6px;transition:all .15s ease;">×</button>
            </div>
            <p style="color:var(--v2-ink3, #64748b);font-size:13px;line-height:1.6;margin:0 0 16px;">${importing ? '从此设备选择文件夹或多个视频，上传至指定分类。同名文件会自动重命名。' : '为视频创建一个分类，例如：经典纪录片、少儿动画。'}</p>
            <label style="display:block;font-size:13px;font-weight:600;color:var(--v2-ink, #1e293b);margin-bottom:6px;">分类名称
                <input id="mediaFormName" class="nav-settings-input" required maxlength="80" placeholder="输入分类名称" style="display:block;width:100%;box-sizing:border-box;margin:6px 0 16px;padding:10px 12px;border-radius:8px;font-size:14px;outline:none;">
            </label>
            ${!importing ? `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--v2-ink, #1e293b);margin:0 0 10px;">
                    <input id="mediaFormProtected" type="checkbox" style="width:16px;height:16px;accent-color:#6366f1;">
                    🔒 设为 PIN 保护分类
                </label>
                <label id="mediaFormPinWrap" style="display:none;font-size:13px;font-weight:600;color:var(--v2-ink, #1e293b);margin-bottom:12px;">4 位 PIN
                    <input id="mediaFormPin" class="nav-settings-input" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="输入 4 位数字" style="display:block;width:100%;box-sizing:border-box;margin:6px 0 4px;padding:10px 12px;border-radius:8px;font-size:14px;outline:none;">
                    <span style="font-size:11px;font-weight:400;color:var(--v2-ink3, #64748b);">分类名称会显示，内容需验证 PIN 后才会加载。</span>
                </label>
            ` : ''}
            ${importing ? `
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
                    <button type="button" class="nav-media-action" id="mediaChooseFolder" style="height:34px;padding:0 12px;font-size:12px;">📂 选择文件夹</button>
                    <button type="button" class="nav-media-action" id="mediaChooseFiles" style="height:34px;padding:0 12px;font-size:12px;">🎬 选择视频</button>
                    <input hidden type="file" id="mediaFolderFiles" webkitdirectory multiple>
                    <input hidden type="file" id="mediaVideoFiles" accept=".mp4,.webm,.mkv,.mov,.m4v" multiple>
                </div>
                <p id="mediaFileSummary" style="font-size:12px;color:#64748b;margin-bottom:8px;">尚未选择文件 · 支持 MP4 / WebM / MKV / MOV / M4V</p>

                <!-- 实时上传进度与详情日志看板 -->
                <div id="mediaUploadDashboard" class="nav-media-dashboard" style="display:none;">
                    <!-- 总进度卡片 -->
                    <div class="nav-media-progress-card">
                        <div class="nav-media-progress-header">
                            <span id="mediaOverallTitle">总进度：等待开始...</span>
                            <span class="nav-media-progress-pct" id="mediaOverallPct">0%</span>
                        </div>
                        <div class="nav-media-progress-track">
                            <div class="nav-media-progress-bar" id="mediaOverallBar" style="width:0%;"></div>
                        </div>
                        <div class="nav-media-progress-meta">
                            <span id="mediaOverallSize">0 MB / 0 MB</span>
                            <span id="mediaOverallSpeed">-- MB/s</span>
                            <span id="mediaOverallEta">剩余时间: --</span>
                        </div>
                    </div>

                    <!-- 当前文件卡片 -->
                    <div class="nav-media-current-card" id="mediaCurrentCard">
                        <div class="nav-media-current-header">
                            <span class="nav-media-current-name" id="mediaCurrentName">当前文件：就绪</span>
                            <span class="nav-media-current-pct" id="mediaCurrentPct">0%</span>
                        </div>
                        <div class="nav-media-current-track">
                            <div class="nav-media-current-bar" id="mediaCurrentBar" style="width:0%;"></div>
                        </div>
                    </div>

                    <!-- 文件队列清单 -->
                    <div class="nav-media-file-queue" id="mediaFileQueue"></div>

                    <!-- 实时详情日志窗口 -->
                    <div class="nav-media-log-wrap">
                        <div class="nav-media-log-header">
                            <span class="nav-media-log-title"><span class="nav-media-log-dot" id="mediaLogDot"></span> 实时详情日志</span>
                            <span class="nav-media-log-badge" id="mediaLogCount">0 条记录</span>
                        </div>
                        <div class="nav-media-log-terminal" id="mediaLogTerminal" role="log" aria-live="polite"></div>
                    </div>
                </div>
            ` : ''}
            <p id="mediaFormStatus" role="status" style="font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0;"></p>
            <div style="display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:20px;">
                <button type="button" class="nav-media-dialog-btn secondary" id="mediaFormCancel">关闭</button>
                <button type="submit" class="nav-media-dialog-btn primary" id="mediaFormSubmit">${importing ? '开始上传' : '创建分类'}</button>
            </div>
        </form>`;
    document.body.appendChild(dialog);

    let files = [], busy = false;
    const name = dialog.querySelector('#mediaFormName');
    const status = dialog.querySelector('#mediaFormStatus');
    const submit = dialog.querySelector('#mediaFormSubmit');
    const cancel = dialog.querySelector('#mediaFormCancel');
    const closeBtn = dialog.querySelector('#mediaFormCloseX');
    const protectedInput = dialog.querySelector('#mediaFormProtected');
    const pinInput = dialog.querySelector('#mediaFormPin');
    const pinWrap = dialog.querySelector('#mediaFormPinWrap');

    if (protectedInput && pinInput && pinWrap) {
        protectedInput.onchange = () => {
            pinWrap.style.display = protectedInput.checked ? 'block' : 'none';
            pinInput.required = protectedInput.checked;
            if (protectedInput.checked) pinInput.focus();
            else pinInput.value = '';
        };
    }

    if (closeBtn) {
        closeBtn.onmouseover = () => { closeBtn.style.color = '#334155'; closeBtn.style.background = '#f1f5f9'; };
        closeBtn.onmouseout = () => { closeBtn.style.color = '#94a3b8'; closeBtn.style.background = 'none'; };
    }

    const forceClose = () => {
        busy = false;
        try { dialog.close(); } catch (_) { }
        dialog.remove();
        document.querySelectorAll('#mediaFormDialog').forEach(el => el.remove());
    };
    const close = () => {
        if (!busy) {
            forceClose();
        }
    };
    cancel.onclick = close;
    closeBtn?.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
        const rect = dialog.getBoundingClientRect();
        const isInDialog = (
            rect.top <= event.clientY && event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX && event.clientX <= rect.left + rect.width
        );
        if (!isInDialog) close();
    });

    const formatMediaBytes = bytes => {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
        return bytes + ' B';
    };

    const formatMediaEta = seconds => {
        if (!Number.isFinite(seconds) || seconds <= 0) return '即将完成';
        if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
        const m = Math.floor(seconds / 60);
        const s = Math.ceil(seconds % 60);
        return `${m} 分 ${s} 秒`;
    };

    let logCount = 0;
    const addMediaLog = (msg, type = 'info') => {
        const term = dialog.querySelector('#mediaLogTerminal');
        const badge = dialog.querySelector('#mediaLogCount');
        if (!term) return;
        const time = new Date().toTimeString().slice(0, 8);
        const line = document.createElement('div');
        line.className = `nav-media-log-line ${type}`;
        line.innerHTML = `<span class="nav-media-log-time">[${time}]</span><span class="nav-media-log-text">${navEscape(msg)}</span>`;
        term.appendChild(line);
        term.scrollTop = term.scrollHeight;
        logCount++;
        if (badge) badge.textContent = `${logCount} 条记录`;
    };

    if (importing) {
        const dashboard = dialog.querySelector('#mediaUploadDashboard');
        const queueEl = dialog.querySelector('#mediaFileQueue');
        const summaryEl = dialog.querySelector('#mediaFileSummary');
        const overallSizeEl = dialog.querySelector('#mediaOverallSize');

        const selectFiles = event => {
            files = Array.from(event.target.files).filter(file => /\.(mp4|webm|mkv|mov|m4v)$/i.test(file.name));
            if (!files.length) {
                summaryEl.textContent = '未选定有效的视频文件（支持 MP4 / WebM / MKV / MOV / M4V）';
                if (dashboard) dashboard.style.display = 'none';
                return;
            }
            const folder = files[0]?.webkitRelativePath?.split('/')[0];
            if (!name.value && folder) name.value = folder;

            const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
            summaryEl.textContent = `已选择 ${files.length} 个视频 · 共 ${formatMediaBytes(totalBytes)}`;
            if (overallSizeEl) overallSizeEl.textContent = `0 B / ${formatMediaBytes(totalBytes)}`;

            if (queueEl) {
                queueEl.innerHTML = files.map((file, idx) => `
                    <div class="nav-media-queue-item" id="mediaQueueItem_${idx}">
                        <div class="nav-media-queue-name" title="${navEscape(file.name)}">
                            <span>🎬</span>
                            <span>${navEscape(file.name)}</span>
                        </div>
                        <div class="nav-media-queue-meta">
                            <span>${formatMediaBytes(file.size)}</span>
                            <span class="nav-media-queue-status waiting" id="mediaQueueStatus_${idx}">⏳ 待上传</span>
                        </div>
                    </div>
                `).join('');
            }
            if (dashboard) dashboard.style.display = 'flex';
            addMediaLog(`已扫描并选定 ${files.length} 个媒体文件，总计 ${formatMediaBytes(totalBytes)}。准备就绪。`, 'info');
        };

        dialog.querySelector('#mediaFolderFiles').onchange = selectFiles;
        dialog.querySelector('#mediaVideoFiles').onchange = selectFiles;
        dialog.querySelector('#mediaChooseFolder').onclick = () => dialog.querySelector('#mediaFolderFiles').click();
        dialog.querySelector('#mediaChooseFiles').onclick = () => dialog.querySelector('#mediaVideoFiles').click();
    }

    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        if (importing && !files.length) {
            status.style.color = '#dc2626';
            status.textContent = '请先选择视频文件或文件夹。';
            return;
        }
        busy = true;
        dialog.querySelectorAll('button,input').forEach(el => { el.disabled = true; });
        try {
            if (!importing) {
                const folderName = name.value.trim();
                const response = await fetch('/api/media/admin/folders', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
                    body: JSON.stringify({
                        name: folderName,
                        icon: '📁',
                        protected: Boolean(protectedInput?.checked),
                        pin: pinInput?.value || ''
                    })
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || '创建失败');

                forceClose();
                await renderMediaSettings(document.getElementById('navSettingsContent'));
                showNavbarNotice({
                    title: '分类创建成功',
                    message: `已成功创建分类“${folderName}”。`,
                    tone: 'success'
                });
                return;
            } else {
                const folderName = name.value.trim() || '未分类';
                const totalFiles = files.length;
                const totalBytes = files.reduce((s, f) => s + f.size, 0);
                let completedFiles = 0;
                let failedFiles = 0;
                let completedBytesBefore = 0;

                const overallTitle = dialog.querySelector('#mediaOverallTitle');
                const overallPct = dialog.querySelector('#mediaOverallPct');
                const overallBar = dialog.querySelector('#mediaOverallBar');
                const overallSize = dialog.querySelector('#mediaOverallSize');
                const overallSpeed = dialog.querySelector('#mediaOverallSpeed');
                const overallEta = dialog.querySelector('#mediaOverallEta');
                const currentName = dialog.querySelector('#mediaCurrentName');
                const currentPct = dialog.querySelector('#mediaCurrentPct');
                const currentBar = dialog.querySelector('#mediaCurrentBar');
                const logDot = dialog.querySelector('#mediaLogDot');

                if (logDot) logDot.classList.add('busy');
                submit.textContent = '正在上传中...';

                addMediaLog(`🚀 开始批量上传：共 ${totalFiles} 个文件，目标分类：“${folderName}”`, 'start');

                let speedWindowBytes = 0;
                let speedWindowTime = Date.now();
                let currentSpeed = 0;

                for (let i = 0; i < totalFiles; i++) {
                    const file = files[i];
                    const queueStatus = dialog.querySelector(`#mediaQueueStatus_${i}`);
                    if (queueStatus) {
                        queueStatus.className = 'nav-media-queue-status uploading';
                        queueStatus.textContent = '⚡ 上传中 0%';
                    }
                    if (currentName) currentName.textContent = `当前文件 [${i + 1}/${totalFiles}]：${file.name}`;
                    if (currentPct) currentPct.textContent = '0%';
                    if (currentBar) currentBar.style.width = '0%';

                    addMediaLog(`[${i + 1}/${totalFiles}] 开始传输：${file.name} (${formatMediaBytes(file.size)})`, 'start');
                    const fileStartTime = Date.now();
                    let lastLoggedMilestone = 0;

                    try {
                        const result = await new Promise((resolve, reject) => {
                            const xhr = new XMLHttpRequest();
                            xhr.open('POST', '/api/media/admin/upload');
                            Object.entries(getAuthHeaderForNav()).forEach(([key, value]) => xhr.setRequestHeader(key, value));

                            xhr.upload.onprogress = ev => {
                                if (!ev.lengthComputable) return;
                                const fileLoaded = ev.loaded;
                                const fileTotal = ev.total;
                                const filePctVal = Math.min(100, (fileLoaded / fileTotal) * 100);

                                if (currentPct) currentPct.textContent = `${filePctVal.toFixed(0)}%`;
                                if (currentBar) currentBar.style.width = `${filePctVal}%`;
                                if (queueStatus) queueStatus.textContent = `⚡ 上传中 ${filePctVal.toFixed(0)}%`;

                                const overallLoaded = completedBytesBefore + fileLoaded;
                                const overallPctVal = Math.min(100, (overallLoaded / totalBytes) * 100);
                                if (overallBar) overallBar.style.width = `${overallPctVal}%`;
                                if (overallPct) overallPct.textContent = `${overallPctVal.toFixed(1)}%`;
                                if (overallTitle) overallTitle.textContent = `总进度：正在上传第 ${i + 1} / ${totalFiles} 个文件`;
                                if (overallSize) overallSize.textContent = `${formatMediaBytes(overallLoaded)} / ${formatMediaBytes(totalBytes)}`;

                                const now = Date.now();
                                const deltaT = (now - speedWindowTime) / 1000;
                                if (deltaT >= 0.5) {
                                    const deltaB = overallLoaded - speedWindowBytes;
                                    currentSpeed = deltaB / deltaT;
                                    speedWindowBytes = overallLoaded;
                                    speedWindowTime = now;

                                    if (overallSpeed) overallSpeed.textContent = `${formatMediaBytes(currentSpeed)}/s`;
                                    if (overallEta) {
                                        const remainingBytes = Math.max(0, totalBytes - overallLoaded);
                                        const etaSec = currentSpeed > 0 ? remainingBytes / currentSpeed : 0;
                                        overallEta.textContent = `剩余时间: ${formatMediaEta(etaSec)}`;
                                    }
                                }

                                const curMilestone = Math.floor(filePctVal / 25) * 25;
                                if (curMilestone > lastLoggedMilestone && curMilestone < 100) {
                                    lastLoggedMilestone = curMilestone;
                                    addMediaLog(`📡 [${i + 1}/${totalFiles}] ${file.name} 进度 ${curMilestone}% · 当前速度 ${formatMediaBytes(currentSpeed)}/s`, 'progress');
                                }
                            };

                            xhr.onerror = () => reject(new Error('网络连接中断'));
                            xhr.onload = () => {
                                let data;
                                try { data = JSON.parse(xhr.responseText); } catch (_) { }
                                if (xhr.status >= 200 && xhr.status < 300 && data?.success) resolve(data);
                                else reject(new Error(data?.error || `HTTP ${xhr.status}`));
                            };

                            const form = new FormData();
                            form.append('folder', folderName);
                            form.append('fileName', file.name);
                            form.append('video', file);
                            xhr.send(form);
                        });

                        const elapsed = ((Date.now() - fileStartTime) / 1000).toFixed(1);
                        completedFiles++;
                        completedBytesBefore += file.size;

                        if (queueStatus) {
                            queueStatus.className = 'nav-media-queue-status success';
                            queueStatus.textContent = '✅ 已完成';
                        }
                        if (currentBar) currentBar.style.width = '100%';
                        if (currentPct) currentPct.textContent = '100%';

                        const savedAs = result.fileName && result.fileName !== file.name ? `（服务端保存为 ${result.fileName}）` : '';
                        addMediaLog(`✅ [${i + 1}/${totalFiles}] ${file.name} 上传成功${savedAs}，耗时 ${elapsed}s`, 'success');
                    } catch (fileErr) {
                        failedFiles++;
                        completedBytesBefore += file.size;
                        if (queueStatus) {
                            queueStatus.className = 'nav-media-queue-status error';
                            queueStatus.textContent = '❌ 失败';
                        }
                        addMediaLog(`❌ [${i + 1}/${totalFiles}] ${file.name} 上传失败：${fileErr.message}`, 'error');
                    }
                }

                if (logDot) logDot.classList.remove('busy');
                if (overallBar) overallBar.style.width = '100%';
                if (overallPct) overallPct.textContent = '100%';
                if (overallSpeed) overallSpeed.textContent = '传输完成';
                if (overallEta) overallEta.textContent = '全部完成';
                if (overallTitle) overallTitle.textContent = `总进度：传输完毕（成功 ${completedFiles} / 失败 ${failedFiles}）`;

                addMediaLog(`🎉 全部上传任务处理完成！成功 ${completedFiles} 个，失败 ${failedFiles} 个，总计 ${formatMediaBytes(totalBytes)}。`, completedFiles > 0 ? 'success' : 'error');

                await renderMediaSettings(document.getElementById('navSettingsContent'));

                submit.style.display = 'none';
                if (cancel) {
                    cancel.textContent = '完成并关闭';
                    cancel.className = 'nav-media-dialog-btn primary';
                    cancel.disabled = false;
                    busy = false;
                    cancel.onclick = () => forceClose();
                }
            }
        } catch (error) {
            status.style.color = '#dc2626';
            status.textContent = error.message;
            busy = false;
            dialog.querySelectorAll('button,input').forEach(el => { el.disabled = false; });
        }
    };
    dialog.showModal();
    name.focus();
}

window.openCreateMediaFolderModal = () => openMediaForm(false);

window.setMediaCategoryPriority = async function (categoryId, value, input) {
    const category = (navState.mediaCategoriesCache || []).find(item => item.id === categoryId);
    const order = Number(value);
    if (!category || !Number.isSafeInteger(order)) {
        showNavbarNotice({ title: '输入提示', message: '分类优先级请输入整数；数字越小排名越靠前。', tone: 'info' });
        return;
    }
    if (input) input.disabled = true;
    try {
        const response = await fetch(`/api/media/admin/folders/${encodeURIComponent(category.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ newName: category.name, order })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
        await renderMediaSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (input) input.disabled = false;
        showNavbarNotice({ title: '保存失败', message: `分类优先级保存失败：${error.message}`, tone: 'error' });
    }
};

window.openEditMediaCategoryModal = async function (categoryId) {
    const category = (navState.mediaCategoriesCache || []).find(item => item.id === categoryId);
    if (!category) return;
    const values = await showNavbarFormDialog({
        title: `分类设置：${category.name}`,
        eyebrow: '媒体库访问保护',
        icon: category.protected ? '🔒' : '📁',
        message: '隐藏分类的名称仍可见，点击后需输入 4 位 PIN 才能加载内容。',
        fields: [
            {
                name: 'order',
                label: '分类优先级（数字越小越靠前）',
                value: String(category.order ?? 0),
                type: 'number',
                required: true
            },
            {
                name: 'protected',
                label: '访问方式',
                value: String(Boolean(category.protected)),
                required: true,
                options: [
                    { value: 'false', label: '🌐 公开分类' },
                    { value: 'true', label: '🔒 4 位 PIN 保护' }
                ]
            },
            {
                name: 'pin',
                label: category.protected ? '新 PIN（留空则保持原 PIN）' : '4 位 PIN',
                value: '',
                type: 'password',
                maxLength: 4,
                placeholder: category.protected ? '不修改可留空' : '输入 4 位数字',
                enabledWhen: { field: 'protected', value: 'true' }
            }
        ],
        confirmText: '保存设置',
        cancelText: '取消'
    });
    if (!values) return;
    const shouldProtect = values.protected === 'true';
    const order = Number(values.order);
    const pin = String(values.pin || '').trim();
    if (!Number.isSafeInteger(order)) {
        return showNavbarNotice({ title: '优先级格式不正确', message: '分类优先级必须是整数。', tone: 'error' });
    }
    if (shouldProtect && !category.protected && !/^\d{4}$/.test(pin)) {
        return showNavbarNotice({ title: 'PIN 格式不正确', message: '请输入 4 位数字 PIN。', tone: 'error' });
    }
    if (pin && !/^\d{4}$/.test(pin)) {
        return showNavbarNotice({ title: 'PIN 格式不正确', message: 'PIN 必须是 4 位数字。', tone: 'error' });
    }
    try {
        const response = await fetch(`/api/media/admin/folders/${encodeURIComponent(category.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ newName: category.name, protected: shouldProtect, pin, order })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
        await renderMediaSettings(document.getElementById('navSettingsContent'));
        showNavbarNotice({
            title: '分类设置已更新',
            message: shouldProtect ? `“${category.name}”现在需要 4 位 PIN 才能查看。` : `“${category.name}”已设为公开分类。`,
            tone: 'success'
        });
    } catch (error) {
        showNavbarNotice({ title: '保存失败', message: error.message, tone: 'error' });
    }
};

// 删除分类文件夹
window.deleteMediaFolder = async function (folderName) {
    const confirmed = await showNavbarConfirm({
        title: '删除分类文件夹',
        eyebrow: '危险操作 · 分类删除',
        message: `确定彻底删除分类文件夹“${folderName}”吗？`,
        hint: '⚠️ 警告：该文件夹下的所有视频资源将被一并清理，此操作无法撤销！',
        confirmText: '确认删除',
        cancelText: '取消',
        tone: 'danger',
        icon: '🗑'
    });
    if (!confirmed) return;

    try {
        const response = await fetch(`/api/media/admin/folders/${encodeURIComponent(folderName)}`, {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await response.json();
        if (data.success) {
            await renderMediaSettings(document.getElementById('navSettingsContent'));
            showNavbarNotice({
                title: '删除成功',
                message: data.message || `分类“${folderName}”已成功删除。`,
                tone: 'success'
            });
        } else {
            showNavbarNotice({
                title: '删除失败',
                message: data.error || '未能删除该分类',
                tone: 'error'
            });
        }
    } catch (e) {
        showNavbarNotice({
            title: '请求失败',
            message: e.message || '网络连接异常，请重试',
            tone: 'error'
        });
    }
};

// 从当前设备选择文件夹或视频上传
window.openImportLocalMediaModal = () => openMediaForm(true);

// 编辑视频元数据
window.openEditMediaModal = async function (videoId) {
    const video = navState.mediaVideosCache?.find(v => v.id === videoId);
    if (!video) return;

    const categoryOptions = (navState.mediaCategoriesCache || [])
        .filter(category => category.id !== 'all')
        .map(category => ({ value: category.id, label: `${category.icon || '📁'} ${category.name || category.folder || '未命名分类'}` }));

    const values = await showNavbarFormDialog({
        title: '编辑视频展示信息',
        eyebrow: '媒体库管理',
        icon: '✎',
        fields: [
            { name: 'title', label: '视频展示标题', value: video.title || '', required: true, maxLength: 80, placeholder: '输入视频标题' },
            { name: 'category', label: '所属分类', value: video.category || '', required: true, options: categoryOptions },
            { name: 'description', label: '视频简介', value: video.description || '', multiline: true, maxLength: 300, placeholder: '输入视频简介描述' }
        ],
        confirmText: '保存修改',
        cancelText: '取消'
    });
    if (!values) return;

    try {
        const response = await fetch(`/api/media/admin/videos/${encodeURIComponent(videoId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({
                title: (values.title || '').trim(),
                category: values.category,
                description: (values.description || '').trim()
            })
        });
        const data = await response.json();
        if (data.success) {
            await renderMediaSettings(document.getElementById('navSettingsContent'));
            showNavbarNotice({
                title: '修改成功',
                message: '视频信息已更新。',
                tone: 'success'
            });
        } else {
            showNavbarNotice({
                title: '修改失败',
                message: data.error || '保存失败',
                tone: 'error'
            });
        }
    } catch (e) {
        showNavbarNotice({
            title: '请求失败',
            message: e.message || '网络连接异常，请重试',
            tone: 'error'
        });
    }
};

// 抽取封面帧
window.extractMediaPoster = async function (videoId) {
    const values = await showNavbarFormDialog({
        title: '重新截取封面帧',
        message: '请输入抽取封面的时间点（格式如 00:00:06 或 00:01:20）：',
        eyebrow: '媒体库管理',
        icon: '🎬',
        fields: [
            { name: 'timeOffset', label: '截取时间点', value: '00:00:06', required: true, placeholder: '00:00:06' }
        ],
        confirmText: '开始截取',
        cancelText: '取消'
    });
    if (!values || !values.timeOffset) return;

    try {
        const response = await fetch(`/api/media/admin/extract-poster/${encodeURIComponent(videoId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ timeOffset: values.timeOffset.trim() })
        });
        const data = await response.json();
        if (data.success) {
            await renderMediaSettings(document.getElementById('navSettingsContent'));
            showNavbarNotice({
                title: '封面抽帧成功',
                message: '视频高清封面帧已更新！',
                tone: 'success'
            });
        } else {
            showNavbarNotice({
                title: '抽帧失败',
                message: data.error || '截取失败',
                tone: 'error'
            });
        }
    } catch (e) {
        showNavbarNotice({
            title: '请求失败',
            message: e.message || '网络连接异常，请重试',
            tone: 'error'
        });
    }
};

// 删除单个视频
window.deleteMediaVideo = async function (videoId, title) {
    const confirmed = await showNavbarConfirm({
        title: '删除视频',
        eyebrow: '不可逆操作',
        message: `确定彻底删除视频“${title}”吗？`,
        hint: '⚠️ 该视频文件及关联封面资源将被永久清除，且无法恢复。',
        confirmText: '确认删除',
        cancelText: '取消',
        tone: 'danger',
        icon: '🗑'
    });
    if (!confirmed) return;

    try {
        const response = await fetch(`/api/media/admin/videos/${encodeURIComponent(videoId)}`, {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await response.json();
        if (data.success) {
            await renderMediaSettings(document.getElementById('navSettingsContent'));
            showNavbarNotice({
                title: '删除成功',
                message: '视频已成功删除。',
                tone: 'success'
            });
        } else {
            showNavbarNotice({
                title: '删除失败',
                message: data.error || '未能删除该视频',
                tone: 'error'
            });
        }
    } catch (e) {
        showNavbarNotice({
            title: '请求失败',
            message: e.message || '网络连接异常，请重试',
            tone: 'error'
        });
    }
};

window.setAllCustomToolBackupSelections = function (checked) {
    document.querySelectorAll('[data-custom-backup-slug]').forEach(box => { box.checked = checked; });
    updateCustomToolBackupSelectionSummary();
};

function collectCustomToolBrowserState(selectedSlugs) {
    const summary = navState.customToolBackupSummary || {};
    const selected = new Set(selectedSlugs);
    const keys = new Set();
    const reservedPlatformKeys = new Set(['tools_token', 'tools_role', 'tools_user', 'tools_language']);
    (summary.tools || []).filter(tool => selected.has(tool.slug)).forEach(tool => {
        (tool.dependencies?.localStorageKeys || []).forEach(key => {
            if (!reservedPlatformKeys.has(key) && !/(?:token|password|passwd|secret|authorization|session|credential)/i.test(key)) keys.add(key);
        });
    });
    const state = {};
    keys.forEach(key => {
        try {
            const value = localStorage.getItem(key);
            if (value !== null) state[key] = value;
        } catch (_) { }
    });
    return state;
}

window.exportCustomToolBackup = async function () {
    const slugs = Array.from(document.querySelectorAll('[data-custom-backup-slug]:checked')).map(box => box.dataset.customBackupSlug);
    if (!slugs.length) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.ctbk.noSelection'), tone: 'info' });
    await runGlobalBackupAction(navT('nav.ctbk.exporting'), async () => {
        const res = await fetch('/api/custom-tools/backup/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ slugs, browserState: collectCustomToolBrowserState(slugs) })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const disposition = res.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match ? match[1] : `tools-platform-custom-tools_${Date.now()}.zip`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { filename, size: blob.size };
    });
};

window.restoreCustomToolBackup = async function () {
    const input = document.getElementById('customToolBackupRestoreInput');
    const file = input?.files?.[0];
    if (!file) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.ctbk.noFile'), tone: 'info' });
    const strategy = document.getElementById('customToolBackupConflictStrategy')?.value === 'skip' ? 'skip' : 'replace';
    const strategyLabel = strategy === 'skip' ? navT('nav.ctbk.strategySkip') : navT('nav.ctbk.strategyReplace');
    const message = customToolBackupText('nav.ctbk.restoreConfirm', { file: file.name, strategy: strategyLabel });
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('恢复自定义工具备份', 'Restore custom-tool backup'),
        message,
        hint: navLocaleText('请确认冲突处理策略和备份文件无误后继续。', 'Verify the backup file and conflict strategy before continuing.'),
        tone: 'warning',
        confirmText: navLocaleText('开始恢复', 'Restore')
    });
    if (!confirmed) return;
    const result = await runGlobalBackupAction(navT('nav.ctbk.restoring'), async () => {
        const form = new FormData();
        form.append('backup', file);
        form.append('conflictStrategy', strategy);
        const res = await fetch('/api/custom-tools/backup/restore', {
            method: 'POST',
            headers: getAuthHeaderForNav(),
            body: form
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        Object.entries(data.browserState || {}).forEach(([key, value]) => {
            try { localStorage.setItem(key, value); } catch (_) { }
        });
        const dependencyCount = Array.isArray(data.dependencyWarnings) ? data.dependencyWarnings.length : 0;
        let done = customToolBackupText('nav.ctbk.restoreDone', {
            restored: data.restored?.length || 0,
            skipped: data.skipped?.length || 0
        });
        if (dependencyCount) done += `\n\n${customToolBackupText('nav.ctbk.dependencyWarn', { count: dependencyCount })}`;
        await showNavbarNotice({ title: navT('nav.dialog.success'), message: done, tone: 'success' });
        return data;
    });
    if (result) {
        try {
            const toolsRes = await fetch('/api/custom-tools', { headers: getAuthHeaderForNav() });
            if (toolsRes.ok) {
                navState.customTools = await toolsRes.json();
                writeNavigationBootstrapCache();
            }
        } catch (_) { }
        renderCustomToolBackupSettings(document.getElementById('navSettingsContent'));
    }
};

function collectRemoteBackupSettings(options = {}) {
    const passwordInput = document.getElementById('remoteBackupPassword');
    const payload = {
        enabled: Boolean(document.getElementById('remoteBackupEnabled')?.checked),
        baseUrl: document.getElementById('remoteBackupBaseUrl')?.value || '',
        username: document.getElementById('remoteBackupUsername')?.value || '',
        compareBeforeRestore: Boolean(document.getElementById('remoteBackupCompare')?.checked),
        createRemoteBackupBeforePull: Boolean(document.getElementById('remoteBackupCreateBeforePull')?.checked),
        autoRestore: Boolean(document.getElementById('remoteBackupAutoRestore')?.checked)
    };
    if (options.clearPassword) {
        payload.clearPassword = true;
    } else if (options.passwordTouched && passwordInput) {
        payload.password = passwordInput.value || '';
    }
    return payload;
}

function collectScheduleBackupSettings() {
    return {
        enabled: Boolean(document.getElementById('scheduleBackupEnabled')?.checked),
        time: document.getElementById('scheduleBackupTime')?.value || '02:00',
        retentionDays: parseInt(document.getElementById('scheduleBackupRetentionDays')?.value || '90', 10),
        maxTotalSizeGB: parseFloat(document.getElementById('scheduleBackupMaxTotalSizeGB')?.value || '10')
    };
}

async function saveScheduleBackupSettingsNow() {
    const res = await fetch('/api/global-backup/schedule-settings', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaderForNav()
        },
        body: JSON.stringify(collectScheduleBackupSettings())
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    navState.scheduleBackupSettings = data;
    const capacityStatus = document.getElementById('scheduleBackupCapacityStatus');
    if (capacityStatus) {
        capacityStatus.textContent = navT('nav.bk.scheduleUsage', {
            used: formatBackupSize(data.currentTotalBytes || 0),
            limit: formatBackupSize(data.maxTotalBytes || 0)
        }) + (data.capacityExceeded ? ` · ${navT('nav.bk.scheduleOver')}` : '');
        capacityStatus.classList.toggle('warning', Boolean(data.capacityExceeded));
    }
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = data.capacityCleanup?.removedCount
        ? `${navT('nav.bk.scheduleSaved')} · ${navLocaleText(`已清理 ${data.capacityCleanup.removedCount} 个旧备份`, `Removed ${data.capacityCleanup.removedCount} old backup(s)`)}`
        : navT('nav.bk.scheduleSaved');
    return data;
}

window.scheduleBackupSettingsSave = function () {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.bk.scheduleSaving');
    clearTimeout(navState.scheduleBackupSaveTimer);
    navState.scheduleBackupSaveTimer = setTimeout(async () => {
        try {
            await saveScheduleBackupSettingsNow();
        } catch (e) {
            if (indicator) indicator.textContent = `${navT('nav.set.saveFail')}${e.message}`;
        }
    }, 650);
};

window.runScheduledBackupNow = async function () {
    clearTimeout(navState.scheduleBackupSaveTimer);
    await saveScheduleBackupSettingsNow();
    await runGlobalBackupAction('正在执行定时备份...', async () => {
        const res = await fetch('/api/global-backup/schedule-run', {
            method: 'POST',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    });
    renderNavSettingsContent();
};

async function saveRemoteBackupSettingsNow(options = {}) {
    const res = await fetch('/api/global-backup/remote-settings', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaderForNav()
        },
        body: JSON.stringify(collectRemoteBackupSettings(options))
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    navState.remoteBackupSettings = data;
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = '远端同步设置已保存';
    return data;
}

window.scheduleRemoteBackupSettingsSave = function (options = {}) {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = '正在保存远端同步设置...';
    clearTimeout(navState.remoteBackupSaveTimer);
    navState.remoteBackupSaveTimer = setTimeout(async () => {
        try {
            await saveRemoteBackupSettingsNow(options);
        } catch (e) {
            if (indicator) indicator.textContent = `保存失败: ${e.message}`;
        }
    }, 650);
};

window.clearRemoteBackupPassword = async function () {
    await runGlobalBackupAction('正在清除远端密码...', async () => {
        await saveRemoteBackupSettingsNow({ clearPassword: true });
    });
    renderNavSettingsContent();
};

window.checkRemoteBackupNow = async function () {
    clearTimeout(navState.remoteBackupSaveTimer);
    await saveRemoteBackupSettingsNow();
    const result = await runGlobalBackupAction('正在检查远端备份...', async () => {
        const res = await fetch('/api/global-backup/remote-check', {
            method: 'POST',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    });
    const latest = result.latest || {};
    await showNavbarNotice({
        title: navLocaleText('远端连接成功', 'Remote connection successful'),
        message: `${result.remoteCreatedBackup?.name ? `${navLocaleText('已请求主站生成新备份', 'Requested a new remote backup')}：${result.remoteCreatedBackup.name}\n` : ''}${navLocaleText('备份数量', 'Backups')}：${result.backups?.length || 0}\n${navLocaleText('最新备份', 'Latest backup')}：${latest.name || '-'}\n${navLocaleText('时间', 'Time')}：${formatBackupTime(latest.modifiedAt || latest.createdAt)}`,
        tone: 'success'
    });
    renderNavSettingsContent();
};

window.pullRemoteBackupNow = async function (force) {
    clearTimeout(navState.remoteBackupSaveTimer);
    await saveRemoteBackupSettingsNow();
    const ok = await showNavbarConfirm({
        title: force ? navLocaleText('强制恢复远端备份', 'Force remote restore') : navLocaleText('拉取并恢复远端备份', 'Pull and restore remote backup'),
        message: force ? navLocaleText('确定要强制恢复远端最新备份吗？', 'Force restore the latest remote backup?') : navLocaleText('确定要按规则拉取并恢复远端备份吗？', 'Pull and restore a remote backup using the configured rules?'),
        hint: navLocaleText('此操作只会覆盖当前平台的本地业务数据，不影响其他数据空间。恢复成功后服务会自动重启，手动启动方式可能需要重新启动服务。', 'This only overwrites local business data for the current platform and does not affect other data spaces. The service restarts automatically when possible; manual deployments may need a restart.'),
        tone: 'danger',
        confirmText: navLocaleText('确认恢复', 'Restore')
    });
    if (!ok) return;
    await runGlobalBackupAction('正在拉取远端备份并恢复...', async () => {
        const res = await fetch('/api/global-backup/remote-pull', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaderForNav()
            },
            body: JSON.stringify({ restore: true, force })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.restored) {
            await showNavbarNotice({
                title: navLocaleText('远端备份恢复完成', 'Remote backup restored'),
                message: `${data.latest?.name || '-'}\n\n${navLocaleText('服务将自动重启；如果是手动 npm start，请重新启动服务。', 'The service will restart automatically. If it was started manually with npm start, restart it yourself.')}`,
                tone: 'success'
            });
        } else {
            await showNavbarNotice({
                title: navT('nav.dialog.notice'),
                message: data.message || navLocaleText('远端备份未更新，未执行恢复。', 'The remote backup is unchanged; no restore was performed.'),
                tone: 'info'
            });
        }
        return data;
    });
};

async function runGlobalBackupAction(actionText, action) {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = actionText;
    try {
        const result = await action();
        if (indicator) indicator.textContent = '操作完成';
        if (document.getElementById('backupOperationConsole')) {
            appendBackupConsoleEntry('客户端已收到服务端完成响应', 'success');
            setBackupConsoleProgress(100, 'COMPLETED');
        }
        return result;
    } catch (e) {
        if (indicator) indicator.textContent = `操作失败: ${e.message}`;
        if (document.getElementById('backupOperationConsole')) {
            appendBackupConsoleEntry(`操作失败：${e.message}`, 'error');
            setBackupConsoleProgress(100, 'FAILED');
        }
        if (e.code !== 'BACKUP_TENANT_MISMATCH') {
            await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
        }
        throw e;
    }
}

function createBackupApiError(data = {}, status = 500) {
    const error = new Error(data.error || `HTTP ${status}`);
    error.status = status;
    Object.assign(error, data);
    return error;
}

async function confirmCrossTenantRestore() {
    await showNavbarNotice({ title: navLocaleText('无法恢复此备份', 'Cannot restore this backup'), message: navLocaleText('备份的数据范围与当前平台不一致，请选择本平台的备份。', 'This backup belongs to a different data scope. Select a backup from this platform.'), tone: 'error' });
    return false;
}

function createBackupOperationId() {
    return `backup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureBackupOperationConsole(title = '备份任务控制台') {
    let panel = document.getElementById('backupOperationConsole');
    if (!panel) {
        panel = document.createElement('aside');
        panel.id = 'backupOperationConsole';
        panel.className = 'backup-operation-console';
        panel.innerHTML = `
            <div class="backup-console-head">
                <div>
                    <div class="backup-console-kicker">DRAGON CLAW · DATA OPS</div>
                    <strong id="backupConsoleTitle"></strong>
                </div>
                <div class="backup-console-actions">
                    <button type="button" onclick="toggleBackupOperationConsole()" title="折叠/展开">−</button>
                    <button type="button" onclick="clearBackupOperationConsole()" title="关闭">×</button>
                </div>
            </div>
            <div class="backup-console-progress"><span id="backupConsoleProgress"></span></div>
            <div class="backup-console-body" id="backupConsoleBody"></div>
            <div class="backup-console-foot"><span class="backup-console-pulse"></span><span id="backupConsoleStatus">READY</span></div>
        `;
        document.body.appendChild(panel);
    }
    panel.classList.remove('collapsed');
    document.getElementById('backupConsoleTitle').textContent = title;
    return panel;
}

function appendBackupConsoleEntry(message, level = 'info', detail = null, timestamp = null) {
    ensureBackupOperationConsole();
    const body = document.getElementById('backupConsoleBody');
    const row = document.createElement('div');
    row.className = `backup-console-entry ${level}`;
    const time = timestamp ? new Date(timestamp) : new Date();
    const timeText = Number.isNaN(time.getTime())
        ? '--:--:--'
        : time.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    row.innerHTML = `
        <span class="backup-console-time">${navEscape(timeText)}</span>
        <span class="backup-console-dot"></span>
        <span class="backup-console-message">${navEscape(message)}</span>
        ${detail ? `<code>${navEscape(typeof detail === 'string' ? detail : JSON.stringify(detail))}</code>` : ''}
    `;
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
}

function setBackupConsoleProgress(percent, status) {
    const bar = document.getElementById('backupConsoleProgress');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    const statusEl = document.getElementById('backupConsoleStatus');
    if (statusEl && status) statusEl.textContent = status;
}

function stopBackupConsolePolling() {
    if (backupConsolePollTimer) {
        clearTimeout(backupConsolePollTimer);
        backupConsolePollTimer = null;
    }
}

async function pollBackupOperation(operationId, operationEndpoint = '/api/global-backup/operations') {
    stopBackupConsolePolling();
    try {
        const res = await fetch(`${operationEndpoint}/${encodeURIComponent(operationId)}`, {
            headers: getAuthHeaderForNav()
        });
        if (res.ok) {
            const operation = await res.json();
            const entries = Array.isArray(operation.entries) ? operation.entries : [];
            entries.slice(backupConsoleSeenEntries).forEach(entry => {
                const message = navLocaleText(entry.message, entry.messageEn || entry.message);
                appendBackupConsoleEntry(message, entry.level, entry.detail, entry.timestamp);
            });
            backupConsoleSeenEntries = entries.length;
            const reportedProgress = Number(operation.progress);
            const progress = operation.status === 'completed' || operation.status === 'failed'
                ? 100
                : Number.isFinite(reportedProgress) ? reportedProgress : 72;
            setBackupConsoleProgress(progress, operation.status.toUpperCase());
            if (operation.status === 'completed' || operation.status === 'failed') return;
        }
    } catch (e) {
        // The service may be restarting after a successful restore.
    }
    backupConsolePollTimer = setTimeout(() => pollBackupOperation(operationId, operationEndpoint), 650);
}

function startBackupOperationConsole(title, operationEndpoint = '/api/global-backup/operations', suppliedOperationId = '') {
    stopBackupConsolePolling();
    ensureBackupOperationConsole(title);
    document.getElementById('backupConsoleBody').innerHTML = '';
    backupConsoleSeenEntries = 0;
    setBackupConsoleProgress(4, 'STARTING');
    const operationId = suppliedOperationId || createBackupOperationId();
    appendBackupConsoleEntry(navLocaleText('任务已创建，正在连接服务端', 'Task created; connecting to the server'), 'info');
    pollBackupOperation(operationId, operationEndpoint);
    return operationId;
}

window.toggleBackupOperationConsole = function () {
    document.getElementById('backupOperationConsole')?.classList.toggle('collapsed');
};

window.clearBackupOperationConsole = function () {
    stopBackupConsolePolling();
    document.getElementById('backupOperationConsole')?.remove();
};

window.createGlobalBackup = async function (downloadAfterCreate) {
    const operationId = startBackupOperationConsole('生成当前平台备份');
    const result = await runGlobalBackupAction('正在生成备份...', async () => {
        const res = await fetch('/api/global-backup/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Backup-Operation-Id': operationId,
                ...getAuthHeaderForNav()
            },
            body: JSON.stringify({ reason: 'manual' })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
    if (downloadAfterCreate && result?.name) {
        await downloadGlobalBackupFile(result.name);
    }
    renderNavSettingsContent();
};

async function downloadGlobalBackupFile(name) {
    ensureBackupOperationConsole('下载备份包');
    appendBackupConsoleEntry(`开始下载：${name}`);
    const res = await fetch(`/api/global-backup/download/${encodeURIComponent(name)}`, {
        headers: getAuthHeaderForNav()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    let loaded = 0;
    const reader = res.body.getReader();
    const chunks = [];
    const indicator = document.getElementById('navSettingsSaveState');

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (indicator) {
            if (total) {
                const percent = Math.round((loaded / total) * 100);
                indicator.textContent = `正在下载... ${percent}% (${formatBackupSize(loaded)} / ${formatBackupSize(total)})`;
                setBackupConsoleProgress(percent, `DOWNLOADING ${percent}%`);
            } else {
                indicator.textContent = `正在下载... 已接收 ${formatBackupSize(loaded)}`;
            }
        }
    }

    const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    appendBackupConsoleEntry(`下载完成：${formatBackupSize(loaded)}`, 'success');
    setBackupConsoleProgress(100, 'COMPLETED');
}

window.downloadGlobalBackup = async function (name) {
    await runGlobalBackupAction('正在下载备份...', () => downloadGlobalBackupFile(name));
};

window.deleteGlobalBackup = async function (name) {
    const ok = await showNavbarConfirm({
        title: navLocaleText('永久删除备份', 'Permanently delete backup'),
        message: name,
        hint: navLocaleText('删除后无法恢复，请确认该备份已经不再需要。', 'This cannot be undone. Make sure this backup is no longer needed.'),
        tone: 'danger',
        confirmText: navLocaleText('永久删除', 'Delete permanently')
    });
    if (!ok) return;
    await runGlobalBackupAction('正在删除备份...', async () => {
        const res = await fetch(`/api/global-backup/delete/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    });
    renderNavSettingsContent();
};

function getGlobalRestoreCompletionMessage(data = {}) {
    const missing = Array.isArray(data.missingTargets) ? data.missingTargets : [];
    const crossTenantText = data.forcedCrossTenant
        ? `\n\n已强制跨数据空间恢复：${data.sourceTenant?.name || data.sourceTenant?.id || '-'}（${data.sourceTenant?.id || '-'}） → ${data.targetTenant?.name || data.targetTenant?.id || '-'}（${data.targetTenant?.id || '-'}）。`
        : '';
    const partialText = data.partialRestore
        ? `\n\n注意：这是旧版或不完整备份，未包含：${missing.join('、')}。对应的现有数据未被覆盖。`
        : '';
    return `恢复完成。恢复前安全备份：${data.safetyBackup?.name || '-'}${crossTenantText}${partialText}\n\n建议重启服务或刷新页面，确保 SQLite 连接重新加载。`;
}

async function performServerBackupRestore(name, forceCrossTenant = false) {
    const operationId = startBackupOperationConsole(forceCrossTenant ? '强制跨数据空间恢复服务器备份' : '恢复服务器备份');
    return runGlobalBackupAction('正在从服务器备份恢复...', async () => {
        const res = await fetch(`/api/global-backup/restore/server/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Backup-Operation-Id': operationId,
                ...getAuthHeaderForNav()
            },
            body: JSON.stringify({ forceCrossTenant, targetTenantId: navState.activeTenantId || 'default' })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw createBackupApiError(data, res.status);
        await showNavbarNotice({ title: navT('nav.dialog.success'), message: getGlobalRestoreCompletionMessage(data), tone: 'success' });
        return data;
    });
}

window.restoreGlobalBackupFromServer = async function (name) {
    const ok = await showNavbarConfirm({
        title: navLocaleText('从服务器备份恢复', 'Restore server backup'),
        message: name,
        hint: navLocaleText('此操作只会覆盖当前平台的业务数据，不影响其他数据空间。系统会先自动生成当前平台的恢复前安全备份。', 'This only overwrites business data for the current platform and does not affect other data spaces. A safety backup for the current platform is created first.'),
        tone: 'danger',
        confirmText: navLocaleText('开始恢复', 'Restore')
    });
    if (!ok) return;
    try {
        await performServerBackupRestore(name, false);
    } catch (error) {
        if (error.code !== 'BACKUP_TENANT_MISMATCH') throw error;
        if (await confirmCrossTenantRestore(error)) await performServerBackupRestore(name, true);
    }
    renderNavSettingsContent();
};

window.restoreGlobalBackupFromUpload = async function (forceCrossTenant = false, skipInitialConfirm = false) {
    const input = document.getElementById('globalBackupUploadInput');
    const file = input && input.files && input.files[0];
    if (!file) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navLocaleText('请先选择备份 zip 包。', 'Select a backup ZIP package first.'), tone: 'info' });
    if (!skipInitialConfirm) {
        const ok = await showNavbarConfirm({
            title: navLocaleText('上传并恢复备份', 'Upload and restore backup'),
            message: file.name,
            hint: navLocaleText('系统会先校验备份数据空间 ID；如与当前平台不同，会在不修改数据的情况下暂停并要求再次确认。', 'The data scope ID is checked first. If it differs from the current platform, the restore pauses without changing data and asks for another confirmation.'),
            tone: 'danger',
            confirmText: navLocaleText('上传并校验', 'Upload and validate')
        });
        if (!ok) return;
    }
    const operationId = startBackupOperationConsole(forceCrossTenant ? '强制跨数据空间上传恢复' : '上传并恢复备份');
    appendBackupConsoleEntry(`已选择文件：${file.name}`, 'info', { size: formatBackupSize(file.size) });

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = '准备上传备份...';

    try {
        const data = await new Promise((resolve, reject) => {
            const form = new FormData();
            form.append('backup', file);
            form.append('forceCrossTenant', forceCrossTenant ? 'true' : 'false');
            form.append('targetTenantId', navState.activeTenantId || 'default');
            let uploadCompleteLogged = false;

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/global-backup/restore/upload', true);

            const headers = getAuthHeaderForNav();
            Object.keys(headers).forEach(key => {
                xhr.setRequestHeader(key, headers[key]);
            });
            xhr.setRequestHeader('X-Backup-Operation-Id', operationId);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && indicator) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    indicator.textContent = `正在上传并解压... ${percent}% (${formatBackupSize(e.loaded)} / ${formatBackupSize(e.total)})`;
                    setBackupConsoleProgress(Math.min(45, Math.round(percent * 0.45)), `UPLOADING ${percent}%`);
                    if (percent === 100 && !uploadCompleteLogged) {
                        uploadCompleteLogged = true;
                        appendBackupConsoleEntry('上传完成，服务端开始校验和恢复', 'success');
                    }
                }
            };

            xhr.onload = () => {
                let resData = {};
                try { resData = JSON.parse(xhr.responseText); } catch (err) { }
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(resData);
                } else {
                    reject(createBackupApiError(resData, xhr.status));
                }
            };

            xhr.onerror = () => reject(new Error('网络请求失败'));
            xhr.send(form);
        });

        if (indicator) indicator.textContent = '操作完成';
        appendBackupConsoleEntry('客户端已收到恢复完成响应', 'success');
        setBackupConsoleProgress(100, 'COMPLETED');
        await showNavbarNotice({ title: navT('nav.dialog.success'), message: getGlobalRestoreCompletionMessage(data), tone: 'success' });
    } catch (e) {
        if (indicator) indicator.textContent = `操作失败: ${e.message}`;
        appendBackupConsoleEntry(`恢复失败：${e.message}`, 'error');
        setBackupConsoleProgress(100, 'FAILED');
        if (e.code === 'BACKUP_TENANT_MISMATCH' && !forceCrossTenant) {
            if (await confirmCrossTenantRestore(e)) {
                return window.restoreGlobalBackupFromUpload(true, true);
            }
        } else {
            await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
        }
    }
    renderNavSettingsContent();
};

let f12ShortcutLoader;

async function renderF12PageSettings(content) {
    const text = navLocaleText;
    content.innerHTML = `<div class="nav-settings-help">${navEscape(text('正在读取插件列表…', 'Loading plugins…'))}</div>`;
    try {
        if (!window.ToolsF12QuickDownloads) {
            if (!f12ShortcutLoader) f12ShortcutLoader = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = './tp-static/frontend/js/shared/f12-quick-downloads.js';
                script.onload = resolve;
                script.onerror = () => { f12ShortcutLoader = null; script.remove(); reject(new Error(text('无法加载打包服务', 'Unable to load the packager'))); };
                document.head.append(script);
            });
            await f12ShortcutLoader;
        }
        const plugins = await window.ToolsF12QuickDownloads.catalog();
        if (navState.settingsTab !== 'page:f12-extension' || !content.isConnected) return;
        const name = plugin => text(plugin.name, plugin.nameEn || plugin.name);
        const render = () => {
            const shortcuts = navState.settings.f12QuickDownloads;
            content.innerHTML = `
                <div class="nav-settings-help">${navEscape(text('在首页知识图谱旁显示一键打包下载按钮。可添加任意数量，按钮会自动换行；除打包用途外，其余使用所选插件的默认参数。下载沿用 F12 打包的管理员权限。', 'Show one-click package downloads beside the knowledge graph on the home page. Add as many as needed; buttons wrap automatically. All other options use the selected plugin defaults. Downloads require the existing F12 administrator permissions.'))}</div>
                <div class="nav-settings-list">
                    ${shortcuts.map((item, index) => `
                        <div class="nav-settings-row" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
                            <label style="flex:1 1 240px;min-width:0;font-size:12px">${navEscape(text('插件', 'Plugin'))}
                                <select class="nav-settings-select" style="display:block;margin-top:6px;min-width:0" data-plugin="${index}">
                                    ${plugins.some(plugin => plugin.id === item.scriptId) ? '' : `<option value="${navEscape(item.scriptId)}" selected>${navEscape(text('插件已不可用：', 'Unavailable plugin: ') + item.scriptId)}</option>`}
                                    ${plugins.map(plugin => `<option value="${navEscape(plugin.id)}" ${plugin.id === item.scriptId ? 'selected' : ''}>${navEscape(name(plugin))} · ${navEscape(plugin.id.startsWith('builtin:') ? text('内置', 'Built-in') : text('脚本库', 'Script library'))}</option>`).join('')}
                                </select>
                            </label>
                            <label style="flex:1 1 195px;min-width:0;font-size:12px">${navEscape(text('默认打包用途', 'Default package target'))}
                                <select class="nav-settings-select" style="display:block;margin-top:6px;min-width:0" data-target="${index}">
                                    <option value="store" ${item.target === 'store' ? 'selected' : ''}>${navEscape(text('Edge 插件商店', 'Edge store'))}</option>
                                    <option value="local" ${item.target === 'local' ? 'selected' : ''}>${navEscape(text('本地安装 / 企业分发', 'Local / enterprise distribution'))}</option>
                                </select>
                            </label>
                            <div class="nav-settings-actions">
                                <button type="button" data-up="${index}" ${index === 0 ? 'disabled' : ''} aria-label="${navEscape(text('上移', 'Move up'))}" title="${navEscape(text('上移', 'Move up'))}">↑</button>
                                <button type="button" data-down="${index}" ${index === shortcuts.length - 1 ? 'disabled' : ''} aria-label="${navEscape(text('下移', 'Move down'))}" title="${navEscape(text('下移', 'Move down'))}">↓</button>
                                <button type="button" data-remove="${index}">${navEscape(text('删除', 'Remove'))}</button>
                            </div>
                        </div>`).join('') || `<div class="nav-settings-empty">${navEscape(text('尚未配置快捷下载插件', 'No download shortcuts configured'))}</div>`}
                </div>
                <button type="button" class="nav-settings-add" data-add-shortcut style="margin-top:14px" ${plugins.length ? '' : 'disabled'}>＋ ${navEscape(text('添加快捷插件', 'Add plugin shortcut'))}</button>`;
            content.querySelectorAll('[data-plugin]').forEach(select => select.addEventListener('change', () => {
                navState.settings.f12QuickDownloads[Number(select.dataset.plugin)].scriptId = select.value;
                scheduleNavSettingsSave();
            }));
            content.querySelectorAll('[data-target]').forEach(select => select.addEventListener('change', () => {
                navState.settings.f12QuickDownloads[Number(select.dataset.target)].target = select.value;
                scheduleNavSettingsSave();
            }));
            content.querySelectorAll('[data-up], [data-down], [data-remove]').forEach(button => button.addEventListener('click', () => {
                const current = navState.settings.f12QuickDownloads;
                if (button.dataset.remove !== undefined) current.splice(Number(button.dataset.remove), 1);
                else navState.settings.f12QuickDownloads = moveArrayItem(current, Number(button.dataset.up ?? button.dataset.down), button.dataset.up !== undefined ? -1 : 1);
                render();
                scheduleNavSettingsSave();
            }));
            content.querySelector('[data-add-shortcut]').addEventListener('click', () => {
                const current = navState.settings.f12QuickDownloads;
                current.push({ scriptId: plugins.find(plugin => plugin.id === 'builtin:netcare-rfc-word')?.id || plugins[0].id, target: 'store' });
                render();
                content.querySelector('[data-plugin="' + (current.length - 1) + '"]')?.focus();
                scheduleNavSettingsSave();
            });
        };
        render();
    } catch (error) {
        if (navState.settingsTab !== 'page:f12-extension' || !content.isConnected) return;
        content.innerHTML = `<div class="nav-settings-help">${navEscape(text('插件列表读取失败：', 'Unable to load plugins: ') + error.message)}</div><button type="button" class="nav-settings-add" data-retry-shortcuts>${navEscape(text('重试', 'Retry'))}</button>`;
        content.querySelector('[data-retry-shortcuts]').addEventListener('click', () => renderF12PageSettings(content));
    }
}

function renderPageSettings(content, pageId) {
    if (pageId === 'sla') return renderDataImportPageSettings(content);
    if (pageId === 'f12-extension') return renderF12PageSettings(content);
    if (pageId === 'home') return renderHomePageSettings(content);
    if (pageId === 'report') return renderReportPageSettings(content);
    if (pageId === 'duty-roster') return renderDutyRosterPageSettings(content);
    const item = NAV_BUILTIN_LINKS.find(link => link.id === pageId);
    content.innerHTML = `
        <div class="nav-page-config-placeholder">
            <div class="nav-page-config-icon">${item?.icon || '🧩'}</div>
            <div>
                <div class="nav-page-config-title">${navEscape(navT('nav.page.placeholderTitle', { page: getNavLabel(item) || '页面' }))}</div>
                <div class="nav-page-config-desc">${navEscape(navT('nav.page.placeholderDesc'))}</div>
            </div>
        </div>
    `;
}

function renderDutyRosterPageSettings(content) {
    const text = navLocaleText;
    content.innerHTML = `
        <div class="nav-settings-help">
            ${navEscape(text('夜间运维值班表支持按目标月份自动计算自然周并标记埃及周末（周五/周六高亮），排班数据直接保存在服务端数据库，并已打通至“护网与网络安全月报编辑器”数据资料库。', 'The night operation duty roster calculates weekly intervals and Egyptian weekends (Fri/Sat highlighted), with persistence to server database and direct integration with the Monthly Report Designer data library.'))}
        </div>
        <div class="nav-page-config-placeholder" style="margin-top: 16px;">
            <div class="nav-page-config-icon">🌙</div>
            <div>
                <div class="nav-page-config-title">${navEscape(text('夜间运维值班表管理', 'Night Operation Duty Roster Management'))}</div>
                <div class="nav-page-config-desc">${navEscape(text('值班表采用专属独立编辑工作区，支持月份切换、一键引入上月人员、中英文切换及快捷保存。', 'The duty roster has a dedicated editing workspace supporting month switching, last-month import, bilingual toggles, and server sync.'))}</div>
                <div style="margin-top: 14px;">
                    <a href="${navToolShellUrl('/duty-roster')}" target="_blank" class="nav-settings-add" style="display:inline-flex;align-items:center;text-decoration:none;padding:6px 14px;font-size:13px;font-weight:600;border-radius:6px;background:#312e81;color:#fff;border:none;">
                        🌙 ${navEscape(text('打开夜间运维值班表编辑器 ↗', 'Open Duty Roster Editor ↗'))}
                    </a>
                </div>
            </div>
        </div>
    `;
}

async function renderDataImportPageSettings(content) {
    const text = navLocaleText;
    content.innerHTML = `<div class="nav-settings-help">${navEscape(text('正在读取导入设置…', 'Loading import settings…'))}</div>`;
    try {
        const response = await fetch('/api/upload/import-settings', { headers: getAuthHeaderForNav(), cache: 'no-store' });
        const settings = await response.json();
        if (!response.ok) throw new Error(settings.error || `HTTP ${response.status}`);
        if (navState.settingsTab !== 'page:sla' || !content.isConnected) return;
        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(text('开启时，先保存所有选中文件的完整原表，包括全部月份、全部工作表，再按目标月份筛选、清洗和提取指标。没有提取规则的表格也会保存。', 'When enabled, all selected original files, months and worksheets are saved before target-month filtering, cleaning and metric extraction. Tables without extraction rules are also archived.'))}</div>
            <div class="nav-settings-row" style="flex-wrap:wrap;gap:12px">
                <label class="nav-settings-check"><input id="navUploadOriginals" type="checkbox" ${settings.uploadOriginals ? 'checked' : ''}><span>${navEscape(text('原始数据上传到服务器（默认开启）', 'Upload original data to the server (on by default)'))}</span></label>
            </div>
            <div class="nav-settings-help" style="margin-top:12px">${navEscape(text('关闭后仍正常提取指标并保存快照，只停止新增原文件及全部工作表存档。已保存的原始表不会删除。此设置作用于当前平台，自动保存。', 'When disabled, metric extraction and snapshots continue; new original files and full worksheets are not archived. Existing archives are retained. This setting is saved automatically for the current platform.'))}</div>`;
        content.querySelector('#navUploadOriginals').addEventListener('change', async event => {
            const checkbox = event.target;
            const enabled = checkbox.checked;
            const indicator = document.getElementById('navSettingsSaveState');
            checkbox.disabled = true;
            if (indicator) indicator.textContent = navT('nav.set.saving');
            try {
                const saved = await fetch('/api/upload/import-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }, body: JSON.stringify({ uploadOriginals: enabled }) });
                const data = await saved.json();
                if (!saved.ok) throw new Error(data.error || `HTTP ${saved.status}`);
                checkbox.checked = data.uploadOriginals;
                if (indicator) indicator.textContent = navT('nav.set.saved');
            } catch (error) {
                checkbox.checked = !enabled;
                if (indicator) indicator.textContent = navT('nav.set.saveFail') + error.message;
            } finally { checkbox.disabled = false; }
        });
    } catch (error) {
        if (navState.settingsTab !== 'page:sla' || !content.isConnected) return;
        content.innerHTML = `<div class="nav-settings-help">${navEscape(text('导入设置读取失败：', 'Unable to load import settings: ') + error.message)}</div><button type="button" class="nav-settings-add" data-retry-import-settings>${navEscape(text('重试', 'Retry'))}</button>`;
        content.querySelector('[data-retry-import-settings]').addEventListener('click', () => renderDataImportPageSettings(content));
    }
}

function renderHomePageSettings(content) {
    const tools = Array.isArray(navState.customTools) ? navState.customTools : [];
    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.page.home.help'))}</div>
        <div class="nav-settings-list">
            ${tools.map(tool => `
                <div class="nav-settings-row">
                    <div class="nav-settings-item-name">
                        ${navEscape(tool.icon || '🧩')} ${navEscape(tool.name || tool.slug)}
                        <div style="font-size:11px;color:#7b8794;font-weight:500;margin-top:4px;">/custom-tools/${navEscape(tool.slug)}/index.html</div>
                    </div>
                    <label class="nav-settings-check" style="margin-left:auto;">
                        <input type="checkbox" ${tool.publicAccess === true ? 'checked' : ''} onchange="setCustomToolPublicAccess('${navEscape(tool.slug)}', this.checked, this)">
                        <span>${navEscape(tool.publicAccess === true ? navT('nav.page.home.public') : navT('nav.page.home.private'))}</span>
                    </label>
                </div>
            `).join('') || `<div class="nav-settings-empty">${navEscape(navT('nav.page.home.empty'))}</div>`}
        </div>
    `;
}

window.setCustomToolPublicAccess = async function (slug, publicAccess, checkbox) {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.set.saving');
    if (checkbox) checkbox.disabled = true;
    try {
        const res = await fetch(`/api/custom-tools/${encodeURIComponent(slug)}/access`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ publicAccess })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const index = navState.customTools.findIndex(item => item.slug === slug);
        if (index >= 0) navState.customTools[index] = data.tool;
        writeNavigationBootstrapCache();
        if (indicator) indicator.textContent = navT('nav.set.saved');
        renderHomePageSettings(document.getElementById('navSettingsContent'));
    } catch (err) {
        if (checkbox) checkbox.checked = !publicAccess;
        if (indicator) indicator.textContent = navT('nav.set.saveFail') + err.message;
    } finally {
        if (checkbox) checkbox.disabled = false;
    }
};

function renderReportPageSettings(content) {
    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.page.report.help'))}</div>
        <div class="nav-report-cleanup-card nav-report-transfer-card">
            <div class="nav-report-cleanup-main">
                <div class="nav-backup-panel-title">${navEscape(navT('nav.page.report.backupTitle'))}</div>
                <div class="nav-backup-panel-desc">${navEscape(navT('nav.page.report.backupDesc'))}</div>
                <label class="nav-report-cleanup-field">
                    <span>${navEscape(navT('nav.page.report.importMode'))}</span>
                    <select id="reportDataRestoreMode" onchange="updateReportDataRestoreHint()">
                        <option value="merge" selected>${navEscape(navT('nav.page.report.modeMerge'))}</option>
                        <option value="replace">${navEscape(navT('nav.page.report.modeReplace'))}</option>
                    </select>
                </label>
                <div id="reportDataRestoreHint" class="nav-backup-panel-desc">${navEscape(navT('nav.page.report.modeMergeHint'))}</div>
                <input id="reportDataBackupFile" type="file" accept=".zip,application/zip" hidden onchange="importReportDataBackup(this)">
            </div>
            <div class="nav-backup-toolbar nav-report-transfer-actions">
                <button onclick="exportReportDataBackup()">${navEscape(navT('nav.page.report.exportButton'))}</button>
                <button onclick="document.getElementById('reportDataBackupFile').click()">${navEscape(navT('nav.page.report.chooseImport'))}</button>
            </div>
        </div>
        <div id="reportDataTransferResult" class="nav-report-cleanup-result" hidden></div>
        <div class="nav-report-cleanup-card">
            <div class="nav-report-cleanup-main">
                <div class="nav-backup-panel-title">${navEscape(navT('nav.page.report.title'))}</div>
                <div class="nav-backup-panel-desc">${navEscape(navT('nav.page.report.desc'))}</div>
                <label class="nav-report-cleanup-field">
                    <span>${navEscape(navT('nav.page.report.mode'))}</span>
                    <select id="reportSnapshotCleanupMode" onchange="updateReportSnapshotCleanupFields()">
                        <option value="latest-only">${navEscape(navT('nav.page.report.modeLatest'))}</option>
                        <option value="retain-days">${navEscape(navT('nav.page.report.modeRetain'))}</option>
                    </select>
                </label>
                <label id="reportSnapshotCleanupDaysField" class="nav-report-cleanup-field" hidden>
                    <span>${navEscape(navT('nav.page.report.retainLast'))}</span>
                    <input id="reportSnapshotCleanupDays" type="number" min="1" max="3650" step="1" value="30">
                    <span>${navEscape(navT('nav.page.report.days'))}</span>
                </label>
            </div>
            <div class="nav-backup-toolbar">
                <button onclick="previewReportSnapshotCleanup()">${navEscape(navT('nav.page.report.btnPreview'))}</button>
                <button class="danger" onclick="runReportSnapshotCleanup()">${navEscape(navT('nav.page.report.btnRun'))}</button>
            </div>
        </div>
        <div id="reportSnapshotCleanupResult" class="nav-report-cleanup-result">${navEscape(navT('nav.page.report.wait'))}</div>
    `;
}

window.updateReportDataRestoreHint = function () {
    const mode = document.getElementById('reportDataRestoreMode')?.value === 'replace' ? 'replace' : 'merge';
    const hint = document.getElementById('reportDataRestoreHint');
    if (hint) hint.textContent = navT(mode === 'replace' ? 'nav.page.report.modeReplaceHint' : 'nav.page.report.modeMergeHint');
};

function reportBackupDownloadName(response) {
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return match?.[1] || `tools-report-data-${new Date().toISOString().slice(0, 10)}.zip`;
}

window.exportReportDataBackup = async function () {
    await runGlobalBackupAction(navLocaleText('正在生成报表独立备份...', 'Creating report data backup...'), async () => {
        const response = await fetch('/api/db/report-data-backup/export', { headers: getAuthHeaderForNav() });
        if (!response.ok) throw new Error(await describeLogoBundleFailure(response));
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = reportBackupDownloadName(response);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { success: true };
    });
};

function renderReportDataTransferResult(data) {
    const result = document.getElementById('reportDataTransferResult');
    if (!result) return;
    const counts = data.counts || {};
    result.hidden = false;
    result.textContent = navT('nav.page.report.importDone', {
        sla: counts.slaSnapshots || 0,
        reports: counts.reportSnapshots || 0,
        scores: counts.reportCategoryScores || 0,
        metrics: counts.reportMetricData || 0,
        attachments: counts.attachments || 0
    });
}

window.importReportDataBackup = async function (input) {
    const file = input?.files?.[0];
    if (!file) return;
    const mode = document.getElementById('reportDataRestoreMode')?.value === 'replace' ? 'replace' : 'merge';
    let confirmationText = '';
    try {
        if (mode === 'replace') {
            const confirmed = await showNavbarTypedConfirm({
                title: navT('nav.page.report.replaceConfirmTitle'),
                message: navT('nav.page.report.replaceConfirmWarning'),
                hint: navT('nav.page.report.replaceConfirmHint'),
                placeholder: navT('nav.page.report.replaceConfirmPlaceholder'),
                requiredText: '确认清空恢复',
                cancelText: navT('nav.set.restore.cancel'),
                confirmText: navT('nav.page.report.replaceConfirmAction')
            });
            if (!confirmed) return;
            confirmationText = '确认清空恢复';
        }
        await runGlobalBackupAction(navLocaleText('正在导入报表历史数据...', 'Importing report history...'), async () => {
            const form = new FormData();
            form.append('backup', file);
            form.append('mode', mode);
            if (confirmationText) form.append('confirmationText', confirmationText);
            const response = await fetch('/api/db/report-data-backup/import', {
                method: 'POST',
                headers: getAuthHeaderForNav(),
                body: form
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            renderReportDataTransferResult(data);
            return data;
        });
    } finally {
        if (input) input.value = '';
    }
};

function getReportSnapshotCleanupDays() {
    const input = document.getElementById('reportSnapshotCleanupDays');
    return Math.max(1, Math.min(3650, parseInt(input?.value, 10) || 30));
}

function getReportSnapshotCleanupMode() {
    const select = document.getElementById('reportSnapshotCleanupMode');
    return select?.value === 'retain-days' ? 'retain-days' : 'latest-only';
}

window.updateReportSnapshotCleanupFields = function () {
    const field = document.getElementById('reportSnapshotCleanupDaysField');
    if (field) field.hidden = getReportSnapshotCleanupMode() !== 'retain-days';
};

function renderReportSnapshotCleanupResult(result) {
    const el = document.getElementById('reportSnapshotCleanupResult');
    if (!el) return;
    const removedPreview = (result.removed || []).slice(0, 8)
        .map(item => `<li>${navEscape(item.date || '-')} · ${navEscape(item.timestamp || '-')} · ${navEscape(item.id || '-')}</li>`)
        .join('');
    const titleText = result.dryRun ? navT('nav.page.report.res.preview') : navT('nav.page.report.res.done');
    const summaryKey = result.mode === 'latest-only'
        ? 'nav.page.report.res.summaryLatest'
        : 'nav.page.report.res.summaryRetain';
    const summaryText = navT(summaryKey, { days: result.days, beforeCount: result.beforeCount, afterCount: result.afterCount, removedCount: result.removedCount })
        .replace('{days}', result.days).replace('{beforeCount}', result.beforeCount).replace('{afterCount}', result.afterCount).replace('{removedCount}', result.removedCount);
    const keptText = navT('nav.page.report.res.keptLatest', { latestSnapshotId: result.latestSnapshotId || '-' }).replace('{latestSnapshotId}', result.latestSnapshotId || '-');
    const emptyText = navT('nav.page.report.res.empty');
    const moreText = result.removedCount > 8 ? navT('nav.page.report.res.more', { remaining: result.removedCount - 8 }).replace('{remaining}', result.removedCount - 8) : '';

    el.innerHTML = `
        <div><strong>${navEscape(titleText)}</strong></div>
        <div>${navEscape(summaryText)}</div>
        <div>${navEscape(keptText)}</div>
        <div>${navEscape(navT('nav.page.report.res.archiveSafe'))}</div>
        ${removedPreview ? `<ul>${removedPreview}</ul>` : `<div>${navEscape(emptyText)}</div>`}
        ${moreText ? `<div>${navEscape(moreText)}</div>` : ''}
    `;
}

async function requestReportSnapshotCleanup(dryRun, confirmationText = '') {
    const res = await fetch('/api/sla/snapshots/cleanup-redundant', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaderForNav()
        },
        body: JSON.stringify({
            days: getReportSnapshotCleanupDays(),
            mode: getReportSnapshotCleanupMode(),
            dryRun,
            confirmationText
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

window.previewReportSnapshotCleanup = async function () {
    await runGlobalBackupAction('正在预览快照清理...', async () => {
        const result = await requestReportSnapshotCleanup(true);
        renderReportSnapshotCleanupResult(result);
        return result;
    });
};

window.runReportSnapshotCleanup = async function () {
    const days = getReportSnapshotCleanupDays();
    const mode = getReportSnapshotCleanupMode();
    const preview = await requestReportSnapshotCleanup(true);
    renderReportSnapshotCleanupResult(preview);
    if (!preview.removedCount) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.page.report.res.empty'), tone: 'info' });
    let confirmationText = '';
    let ok = false;
    if (mode === 'latest-only') {
        ok = await showNavbarTypedConfirm({
            title: navT('nav.page.report.confirmLatestTitle'),
            message: navT('nav.page.report.confirmLatestWarning', { count: preview.removedCount }).replace('{count}', preview.removedCount),
            hint: navT('nav.page.report.confirmLatestHint'),
            placeholder: navT('nav.page.report.confirmLatestPlaceholder'),
            requiredText: '确认删除',
            cancelText: navT('nav.set.restore.cancel'),
            confirmText: navT('nav.page.report.confirmLatestAction')
        });
        confirmationText = ok ? '确认删除' : '';
    } else {
        const confirmText = navT('nav.page.report.confirmRetain', { count: preview.removedCount, days })
            .replace('{count}', preview.removedCount)
            .replace('{days}', days);
        ok = await showNavbarConfirm({
            title: navLocaleText('清理报表快照', 'Clean report snapshots'),
            message: confirmText,
            hint: navLocaleText('系统将按照当前保留策略删除冗余快照。', 'Redundant snapshots will be deleted using the current retention policy.'),
            tone: 'danger',
            confirmText: navLocaleText('确认清理', 'Clean snapshots')
        });
    }
    if (!ok) return;
    await runGlobalBackupAction('正在清理冗余快照...', async () => {
        const result = await requestReportSnapshotCleanup(false, confirmationText);
        renderReportSnapshotCleanupResult(result);
        return result;
    });
};

function ensureNavbarTypedConfirmDialog() {
    let modal = document.getElementById('navbarTypedConfirmModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'navbarTypedConfirmModal';
    modal.className = 'nav-confirm-modal nav-confirm-modal-danger';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="nav-confirm-backdrop" onclick="resolveNavbarTypedConfirm(false)"></div>
        <section class="nav-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="navbarTypedConfirmTitle" aria-describedby="navbarTypedConfirmMessage navbarTypedConfirmHint">
            <div class="nav-confirm-danger-label">⚠ 不可撤销的删除操作</div>
            <div class="nav-confirm-copy">
                <h3 id="navbarTypedConfirmTitle"></h3>
                <p id="navbarTypedConfirmMessage"></p>
                <div class="nav-confirm-hint" id="navbarTypedConfirmHint"></div>
                <input id="navbarTypedConfirmInput" class="nav-confirm-type-input" type="text" autocomplete="off" spellcheck="false">
            </div>
            <div class="nav-confirm-actions">
                <button type="button" class="nav-confirm-cancel" onclick="resolveNavbarTypedConfirm(false)"></button>
                <button type="button" class="nav-confirm-submit" onclick="resolveNavbarTypedConfirm(true)" disabled></button>
            </div>
        </section>`;
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            window.resolveNavbarTypedConfirm(false);
        }
    });
    document.body.appendChild(modal);
    return modal;
}

function showNavbarTypedConfirm({ title, message, hint, placeholder, requiredText, cancelText, confirmText }) {
    const modal = ensureNavbarTypedConfirmDialog();
    if (navTypedConfirmResolver) {
        navTypedConfirmResolver(false);
        navTypedConfirmResolver = null;
    }
    modal.querySelector('#navbarTypedConfirmTitle').textContent = title || '';
    modal.querySelector('#navbarTypedConfirmMessage').textContent = message || '';
    modal.querySelector('#navbarTypedConfirmHint').textContent = hint || '';
    const input = modal.querySelector('#navbarTypedConfirmInput');
    const submit = modal.querySelector('.nav-confirm-submit');
    input.value = '';
    input.placeholder = placeholder || '';
    submit.textContent = confirmText || '确认删除';
    submit.disabled = true;
    input.oninput = () => { submit.disabled = input.value.trim() !== requiredText; };
    input.onkeydown = event => {
        if (event.key === 'Enter' && !submit.disabled) {
            event.preventDefault();
            window.resolveNavbarTypedConfirm(true);
        }
    };
    modal.querySelector('.nav-confirm-cancel').textContent = cancelText || '取消';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => input.focus());
    return new Promise(resolve => { navTypedConfirmResolver = resolve; });
}

window.resolveNavbarTypedConfirm = function (confirmed) {
    const modal = document.getElementById('navbarTypedConfirmModal');
    const submit = modal?.querySelector('.nav-confirm-submit');
    if (confirmed && submit?.disabled) return;
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    const resolve = navTypedConfirmResolver;
    navTypedConfirmResolver = null;
    if (resolve) resolve(Boolean(confirmed));
};

async function fetchSecuritySettingsForNav() {
    const [settings, locks] = await Promise.all([
        API.get('/api/auth/security/settings'),
        API.get('/api/auth/security/locks')
    ]);
    navState.securitySettings = settings;
    navState.securityLocks = locks;
    return settings;
}

function renderSecurityPolicyRows(kind, rows) {
    return (rows || []).map((policy, index) => `
        <tr>
            <td data-label="${navEscape(navT('nav.sec.thEnabled'))}"><input type="checkbox" ${policy.enabled !== false ? 'checked' : ''} onchange="updateSecurityPolicy('${kind}', ${index}, 'enabled', this.checked)"></td>
            <td data-label="${navEscape(navT('nav.sec.thCount'))}"><input class="nav-settings-input nav-security-number" type="number" min="1" max="1000" step="1" value="${navEscape(policy.count)}" oninput="updateSecurityPolicy('${kind}', ${index}, 'count', this.value)"></td>
            <td data-label="${navEscape(navT('nav.sec.thWindow'))}"><input class="nav-settings-input nav-security-number" type="number" min="1" max="10080" step="1" value="${navEscape(policy.windowMinutes)}" oninput="updateSecurityPolicy('${kind}', ${index}, 'windowMinutes', this.value)"></td>
            <td data-label="${navEscape(navT('nav.sec.thLock'))}"><input class="nav-settings-input nav-security-number" type="number" min="1" max="10080" step="1" value="${navEscape(policy.lockMinutes)}" oninput="updateSecurityPolicy('${kind}', ${index}, 'lockMinutes', this.value)"></td>
            <td data-label="${navEscape(navT('nav.sec.thSeverity'))}">
                <select class="nav-settings-input nav-security-severity" onchange="updateSecurityPolicy('${kind}', ${index}, 'severity', this.value)">
                    ${['info', 'warn', 'error', 'critical'].map(level => `<option value="${level}" ${policy.severity === level ? 'selected' : ''}>${level}</option>`).join('')}
                </select>
            </td>
        </tr>
    `).join('');
}

function renderSecurityPolicyTable(title, kind, rows) {
    return `
        <div class="nav-security-section">
            <div class="nav-security-section-title">${navEscape(title)}</div>
            <div class="nav-account-table-wrap">
                <table class="nav-account-table nav-security-table">
                    <thead>
                        <tr>
                            <th>${navEscape(navT('nav.sec.thEnabled'))}</th>
                            <th>${navEscape(navT('nav.sec.thCount'))}</th>
                            <th>${navEscape(navT('nav.sec.thWindow'))}</th>
                            <th>${navEscape(navT('nav.sec.thLock'))}</th>
                            <th>${navEscape(navT('nav.sec.thSeverity'))}</th>
                        </tr>
                    </thead>
                    <tbody>${renderSecurityPolicyRows(kind, rows)}</tbody>
                </table>
            </div>
        </div>
    `;
}

function getSecurityLockTarget(lock) {
    return lock.lock_type === 'account' ? lock.username : lock.ip;
}

function renderSecurityLocksTable() {
    const locks = navState.securityLocks || [];
    const rows = locks.map(lock => `
        <tr>
            <td>${navEscape(lock.lock_type)}</td>
            <td>${navEscape(getSecurityLockTarget(lock))}</td>
            <td>${navEscape(lock.reason || '')}</td>
            <td>${navEscape(lock.fail_count || 0)}</td>
            <td>${navEscape(lock.locked_until || '')}</td>
            <td class="nav-account-actions">
                <button onclick="unlockSecurityLock('${navEscape(lock.lock_key)}')">${navEscape(navT('nav.sec.btnUnlock'))}</button>
            </td>
        </tr>
    `).join('');
    return `
        <div class="nav-security-section">
            <div class="nav-security-lock-head">
                <div class="nav-security-section-title">${navEscape(navT('nav.sec.locksTitle'))}</div>
                <button class="nav-settings-add" onclick="reloadSecurityLocks()">${navEscape(navT('nav.sec.btnRefresh'))}</button>
            </div>
            <div class="nav-account-table-wrap">
                <table class="nav-account-table">
                    <thead>
                        <tr>
                            <th>${navEscape(navT('nav.sec.thType'))}</th>
                            <th>${navEscape(navT('nav.sec.thTarget'))}</th>
                            <th>${navEscape(navT('nav.sec.thReason'))}</th>
                            <th>${navEscape(navT('nav.sec.thFailCount'))}</th>
                            <th>${navEscape(navT('nav.sec.thUntil'))}</th>
                            <th>${navEscape(navT('nav.acc.thAction'))}</th>
                        </tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="6">${navEscape(navT('nav.sec.noLocks'))}</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
}

async function renderSecuritySettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.sec.empty'))}</div>`;
    try {
        const settings = await fetchSecuritySettingsForNav();
        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(navT('nav.sec.help'))}</div>
            <div class="nav-security-grid">
                <label class="nav-security-toggle">
                    <input type="checkbox" id="navSecurityEnabled" ${settings.enabled !== false ? 'checked' : ''} onchange="scheduleSecuritySettingsSave()">
                    <span>${navEscape(navT('nav.sec.enabled'))}</span>
                </label>
                <label class="nav-security-toggle">
                    <input type="checkbox" id="navSecurityAlertOnLock" ${settings.alertOnLock !== false ? 'checked' : ''} onchange="scheduleSecuritySettingsSave()">
                    <span>${navEscape(navT('nav.sec.alertOnLock'))}</span>
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.sec.sessionHours'))}</span>
                    <input id="navSecuritySessionHours" class="nav-settings-input" type="number" min="1" max="720" step="1" value="${navEscape(settings.sessionMaxAgeHours || 168)}" oninput="scheduleSecuritySettingsSave()">
                </label>
            </div>
            ${renderSecurityPolicyTable(navT('nav.sec.accountPolicy'), 'accountLockPolicies', settings.accountLockPolicies)}
            ${renderSecurityPolicyTable(navT('nav.sec.ipPolicy'), 'ipLockPolicies', settings.ipLockPolicies)}
            ${renderSecurityPolicyTable(navT('nav.sec.multiPolicy'), 'ipMultiUserPolicies', settings.ipMultiUserPolicies)}
            ${renderSecurityLocksTable()}
        `;
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.sec.failLoad'))}${navEscape(e.message)}</div>`;
    }
}

function collectSecuritySettingsPayload() {
    const current = navState.securitySettings || {};
    return {
        enabled: document.getElementById('navSecurityEnabled')?.checked !== false,
        alertOnLock: document.getElementById('navSecurityAlertOnLock')?.checked !== false,
        sessionMaxAgeHours: Number(document.getElementById('navSecuritySessionHours')?.value || current.sessionMaxAgeHours || 168),
        accountLockPolicies: current.accountLockPolicies || [],
        ipLockPolicies: current.ipLockPolicies || [],
        ipMultiUserPolicies: current.ipMultiUserPolicies || []
    };
}

window.updateSecurityPolicy = function (kind, index, field, value) {
    if (!navState.securitySettings || !Array.isArray(navState.securitySettings[kind])) return;
    const policy = navState.securitySettings[kind][index];
    if (!policy) return;
    policy[field] = field === 'enabled' ? Boolean(value) : (field === 'severity' ? value : Number(value));
    scheduleSecuritySettingsSave();
};

window.scheduleSecuritySettingsSave = function () {
    if (!navState.securitySettings) return;
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.sec.saving');
    clearTimeout(navState.securitySaveTimer);
    navState.securitySaveTimer = setTimeout(async () => {
        try {
            const res = await fetch('/api/auth/security/settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaderForNav()
                },
                body: JSON.stringify(collectSecuritySettingsPayload())
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            navState.securitySettings = await res.json();
            if (indicator) indicator.textContent = navT('nav.sec.saved');
        } catch (e) {
            if (indicator) indicator.textContent = navT('nav.set.saveFail') + e.message;
        }
    }, 420);
};

window.reloadSecurityLocks = async function () {
    const content = document.getElementById('navSettingsContent');
    try {
        navState.securityLocks = await API.get('/api/auth/security/locks');
        if (content && navState.settingsTab === 'security') renderSecuritySettings(content);
    } catch (e) {
        const indicator = document.getElementById('navSettingsSaveState');
        if (indicator) indicator.textContent = navT('nav.sec.failLoad') + e.message;
    }
};

window.unlockSecurityLock = async function (lockKey) {
    const res = await fetch(`/api/auth/security/locks/${encodeURIComponent(lockKey)}`, {
        method: 'DELETE',
        headers: getAuthHeaderForNav()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await window.reloadSecurityLocks();
};

async function renderAccountSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.acc.empty'))}</div>`;
    try {
        const users = await API.get('/api/auth/users');
        const rows = users.map(u => {
            const roleBadge = u.role === 'admin'
                ? `<span class="nav-account-role admin">${navEscape(navT('nav.acc.admin'))}</span>`
                : `<span class="nav-account-role readonly">${navEscape(navT('nav.acc.readonly'))}</span>`;
            return `
                <tr>
                    <td>${navEscape(u.username)}</td>
                    <td>${roleBadge}</td>
                    <td class="nav-account-actions">
                        ${u.username !== 'admin' ? `<button onclick="deleteUser('${navEscape(u.username)}')">${navEscape(navT('nav.acc.btnDel'))}</button>` : ''}
                        <button onclick="resetPwd('${navEscape(u.username)}')">${navEscape(navT('nav.acc.btnReset'))}</button>
                    </td>
                </tr>
            `;
        }).join('');

        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(navT('nav.acc.help'))}</div>
            <div class="nav-account-create">
                <input id="nu_name" placeholder="${navEscape(navT('nav.acc.plhUser'))}">
                <input id="nu_pwd" placeholder="${navEscape(navT('nav.acc.plhPwd'))}" type="password">
                <select id="nu_role">
                    <option value="readonly">${navEscape(navT('nav.acc.readonly'))}</option>
                    <option value="admin">${navEscape(navT('nav.acc.admin'))}</option>
                </select>
                <button onclick="addUser()">${navEscape(navT('nav.acc.btnAdd'))}</button>
            </div>
            <div class="nav-account-table-wrap">
                <table class="nav-account-table">
                    <thead>
                        <tr><th>${navEscape(navT('nav.acc.thUser'))}</th><th>${navEscape(navT('nav.acc.thRole'))}</th><th>${navEscape(navT('nav.acc.thAction'))}</th></tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="3">${navEscape(navT('nav.acc.noData'))}</td></tr>`}</tbody>
                </table>
            </div>
        `;
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.acc.fail'))}${navEscape(e.message)}</div>`;
    }
}

window.openUserModal = async function () {
    if (localStorage.getItem('tools_role') !== 'admin') return;

    let m = document.getElementById('user-mgmt-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'user-mgmt-modal';
        m.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(15,23,42,0.6); backdrop-filter:blur(4px); z-index:99999; display:none; align-items:center; justify-content:center;';
        document.body.appendChild(m);
    }

    try {
        const res = await API.get('/api/auth/users');

        let trs = res.map(u => {
            const roleBadge = u.role === 'admin'
                ? '<span style="background:rgba(99,102,241,0.18); color:#a5b4fc; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid rgba(99,102,241,0.35);">超级管理</span>'
                : '<span style="background:var(--v2-chip, #f1f5f9); color:var(--v2-ink2, #64748b); padding:4px 10px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid var(--v2-line, #e2e8f0);">只读用户</span>';

            return `
            <tr style="transition: background 0.2s;">
                <td style="padding:14px 16px; border-bottom:1px solid var(--v2-line, #f1f5f9); font-weight:500; color:var(--v2-ink, #334155);">${u.username}</td>
                <td style="padding:14px 16px; border-bottom:1px solid var(--v2-line, #f1f5f9);">${roleBadge}</td>
                <td style="padding:14px 16px; border-bottom:1px solid var(--v2-line, #f1f5f9); text-align:right;">
                    ${u.username !== 'admin' ? `<button onclick="deleteUser('${u.username}')" style="background:rgba(239,68,68,0.12); color:#f87171; border:1px solid rgba(239,68,68,0.3); padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.2s;">删除</button>` : ''}
                    <button onclick="resetPwd('${u.username}')" style="background:rgba(2,132,199,0.12); color:#38bdf8; border:1px solid rgba(2,132,199,0.3); padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.2s; margin-left:8px;">重置密码</button>
                </td>
            </tr>
            `;
        }).join('');

        m.innerHTML = `
            <div style="background:var(--v2-bg, #ffffff); color:var(--v2-ink, #172033); border:1px solid var(--v2-line, rgba(148,163,184,0.35)); width:650px; max-width:90%; padding:32px; border-radius:16px; box-shadow:0 20px 40px rgba(0,0,0,0.2); position:relative; animation: fadeIn 0.3s ease;">
                <button onclick="document.getElementById('user-mgmt-modal').style.display='none'" style="position:absolute; top:24px; right:24px; background:none; border:none; font-size:24px; color:var(--v2-ink3, #94a3b8); cursor:pointer; line-height:1; transition:color 0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--v2-ink3, #94a3b8)'">&times;</button>
                
                <h3 style="margin-top:0; margin-bottom:24px; font-size:20px; font-weight:700; color:var(--v2-ink, #1e293b); display:flex; align-items:center; gap:8px; border-bottom:2px solid var(--v2-line, #f1f5f9); padding-bottom:16px;">
                    👥 账号管理与权限
                </h3>
                
                <div style="background:var(--v2-side, #f8fafc); border:1px solid var(--v2-line, #e2e8f0); border-radius:12px; padding:16px; margin-bottom:24px;">
                    <div style="font-size:13px; font-weight:600; color:var(--v2-ink2, #475569); margin-bottom:12px;">➕ 新增账号</div>
                    <div style="display:flex; gap:12px;">
                        <input id="nu_name" class="nav-settings-input" placeholder="输入新用户名" style="flex:1; padding:10px 14px; border:1px solid var(--v2-line-strong, #cbd5e1); border-radius:8px; outline:none; font-size:14px; background:var(--v2-chip, #fff); color:var(--v2-ink, #0f172a);">
                        <input id="nu_pwd" class="nav-settings-input" placeholder="设置密码" style="flex:1; padding:10px 14px; border:1px solid var(--v2-line-strong, #cbd5e1); border-radius:8px; outline:none; font-size:14px; background:var(--v2-chip, #fff); color:var(--v2-ink, #0f172a);">
                        <select id="nu_role" class="nav-settings-select" style="padding:10px 14px; border:1px solid var(--v2-line-strong, #cbd5e1); border-radius:8px; outline:none; font-size:14px; background:var(--v2-chip, #fff); color:var(--v2-ink, #0f172a); cursor:pointer;">
                            <option value="readonly">只读权限</option>
                            <option value="admin">超级管理</option>
                        </select>
                        <button onclick="addUser()" style="background:#10b981; color:#fff; border:none; padding:10px 20px; border-radius:8px; font-weight:600; cursor:pointer; transition:background 0.2s; box-shadow:0 2px 4px rgba(16,185,129,0.2);" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">新增</button>
                    </div>
                </div>
                
                <div style="border:1px solid var(--v2-line, #e2e8f0); border-radius:12px; overflow:hidden;">
                    <table style="width:100%; border-collapse:collapse; text-align:left;">
                        <thead>
                            <tr style="background:var(--v2-side, #f8fafc); border-bottom:1px solid var(--v2-line, #e2e8f0);">
                                <th style="padding:12px 16px; font-size:13px; font-weight:600; color:var(--v2-ink3, #64748b);">账号名称</th>
                                <th style="padding:12px 16px; font-size:13px; font-weight:600; color:var(--v2-ink3, #64748b);">权限角色</th>
                                <th style="padding:12px 16px; font-size:13px; font-weight:600; color:var(--v2-ink3, #64748b); text-align:right;">快捷操作</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                    </table>
                </div>
                
                <div style="text-align:right; margin-top:24px;">
                    <button onclick="document.getElementById('user-mgmt-modal').style.display='none'" class="nav-settings-add" style="margin:0; border:none; padding:10px 24px; border-radius:8px; font-weight:600; font-size:14px; cursor:pointer;">完成并关闭</button>
                </div>
            </div>
        `;
        m.style.display = 'flex';
    } catch (e) {
        await showNavbarNotice({
            title: navT('nav.dialog.error'),
            message: navLocaleText('获取用户列表失败：', 'Failed to load accounts: ') + e.message,
            tone: 'error'
        });
    }
};

window.addUser = async function () {
    const username = document.getElementById('nu_name').value.trim();
    const password = document.getElementById('nu_pwd').value;
    const role = document.getElementById('nu_role').value;
    if (!username || !password) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.acc.required'), tone: 'info' });
    try {
        await API.post('/api/auth/users', { username, password, role });
        await showNavbarNotice({
            title: navT('nav.acc.added'),
            message: navT('nav.acc.addedDesc').replace('{user}', username),
            tone: 'success'
        });
        if (document.getElementById('navSettingsModal')?.style.display === 'flex') renderNavSettingsContent();
        else openUserModal();
    } catch (e) {
        await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
    }
};

window.deleteUser = async function (u) {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.acc.deleteTitle'),
        message: navT('nav.acc.deleteDesc').replace('{user}', u),
        hint: navLocaleText('账号删除不会清理其历史操作记录。', 'Deleting the account does not remove its historical audit records.'),
        tone: 'danger',
        confirmText: navT('nav.acc.btnDel')
    });
    if (!confirmed) return;
    try {
        await API.delete('/api/auth/users/' + u);
        if (document.getElementById('navSettingsModal')?.style.display === 'flex') renderNavSettingsContent();
        else openUserModal();
    } catch (e) {
        await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
    }
};

window.resetPwd = async function (u) {
    const values = await showNavbarFormDialog({
        title: navT('nav.acc.resetTitle'),
        message: navT('nav.acc.resetDesc').replace('{user}', u),
        fields: [{
            name: 'password',
            label: navT('nav.acc.newPassword'),
            placeholder: navT('nav.acc.plhPwd'),
            type: 'password',
            autocomplete: 'new-password',
            required: true,
            maxLength: 200
        }],
        icon: '●',
        confirmText: navT('nav.acc.btnReset')
    });
    if (!values?.password) return;
    try {
        await API.put('/api/auth/users/' + u + '/password', { password: values.password });
        await showNavbarNotice({
            title: navT('nav.acc.resetDone'),
            message: navT('nav.acc.resetDoneDesc').replace('{user}', u),
            tone: 'success'
        });
    } catch (e) {
        await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
    }
};

async function renderDesktopAgentSettings(content) {
    if (!window.ToolsDesktopAgentSettings) {
        try {
            // 带内容版本号加载：无版本号的地址会被浏览器/CDN 缓存数小时，更新后仍显示旧卡片
            window.desktopAgentSettingsScript ||= loadNavLazyScript('./tp-static/frontend/js/shared/desktop-agent-settings.js','Desktop agent settings failed to load').catch(error=>{window.desktopAgentSettingsScript=null;throw error;});
            await window.desktopAgentSettingsScript;
        } catch(error) { if(content.isConnected)content.textContent=error.message;return; }
    }
    if(navState.settingsTab==='desktopAgents')return window.ToolsDesktopAgentSettings.render(content);
}

window.__navSettingsPackLoaded = true;
