(function () {
    window.__PRAUDIT_OFFLINE__ = true;

    const WORKSPACE_ID = String(
        window.__PRAUDIT_OFFLINE_WORKSPACE_ID__
        || window.location.pathname
        || 'default'
    );
    const WORKSPACE_PREFIX = `PRAUDIT_OFFLINE_WS_${WORKSPACE_ID}__`;
    const OFFLINE_CONFIGS_KEY = `${WORKSPACE_PREFIX}PRAUDIT_OFFLINE_CONFIGS_V1`;
    const OFFLINE_GUIDE_DISMISSED_KEY = `${WORKSPACE_PREFIX}PRAUDIT_OFFLINE_GUIDE_DISMISSED`;
    const SOURCE_MODE_KEY = `${WORKSPACE_PREFIX}tools_data_source_modes`;
    const LAST_CONFIG_KEY = `${WORKSPACE_PREFIX}PR_Auditor_LastConfigId`;

    function namespacedKey(key) {
        return `${WORKSPACE_PREFIX}${String(key || '')}`;
    }

    function shouldNamespacePrauditKey(key) {
        return /^PR_Auditor_/.test(String(key || ''));
    }

    function patchLocalStorageForWorkspace() {
        if (!window.localStorage || window.localStorage.__prauditOfflinePatched) return;
        const storage = window.localStorage;
        const originalGetItem = storage.getItem.bind(storage);
        const originalSetItem = storage.setItem.bind(storage);
        const originalRemoveItem = storage.removeItem.bind(storage);

        storage.getItem = function (key) {
            if (key === 'PR_Auditor_LastConfigId') return originalGetItem(LAST_CONFIG_KEY);
            if (shouldNamespacePrauditKey(key)) return originalGetItem(namespacedKey(key));
            return originalGetItem(key);
        };

        storage.setItem = function (key, value) {
            if (key === 'PR_Auditor_LastConfigId') return originalSetItem(LAST_CONFIG_KEY, value);
            if (shouldNamespacePrauditKey(key)) return originalSetItem(namespacedKey(key), value);
            return originalSetItem(key, value);
        };

        storage.removeItem = function (key) {
            if (key === 'PR_Auditor_LastConfigId') return originalRemoveItem(LAST_CONFIG_KEY);
            if (shouldNamespacePrauditKey(key)) return originalRemoveItem(namespacedKey(key));
            return originalRemoveItem(key);
        };

        storage.__prauditOfflinePatched = true;
    }

    function patchLocalForageForWorkspace() {
        if (!window.localforage || window.localforage.__prauditOfflinePatched) return;
        const lf = window.localforage;
        if (lf.LOCALSTORAGE && typeof lf.config === 'function') {
            try {
                lf.config({
                    driver: lf.LOCALSTORAGE,
                    name: 'tools-platform-praudit-offline',
                    storeName: 'praudit_offline'
                });
            } catch (e) {
                console.warn('离线 localforage 驱动切换失败，继续使用默认驱动:', e);
            }
        }
        const originalGetItem = lf.getItem.bind(lf);
        const originalSetItem = lf.setItem.bind(lf);
        const originalRemoveItem = lf.removeItem.bind(lf);

        lf.getItem = function (key) {
            if (shouldNamespacePrauditKey(key)) return originalGetItem(namespacedKey(key));
            return originalGetItem(key);
        };

        lf.setItem = function (key, value) {
            if (shouldNamespacePrauditKey(key)) return originalSetItem(namespacedKey(key), value);
            return originalSetItem(key, value);
        };

        lf.removeItem = function (key) {
            if (shouldNamespacePrauditKey(key)) return originalRemoveItem(namespacedKey(key));
            return originalRemoveItem(key);
        };

        lf.__prauditOfflinePatched = true;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createId() {
        return `offline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function readConfigs() {
        try {
            const raw = JSON.parse(localStorage.getItem(OFFLINE_CONFIGS_KEY) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch (e) {
            return [];
        }
    }

    function writeConfigs(configs) {
        localStorage.setItem(OFFLINE_CONFIGS_KEY, JSON.stringify(configs));
    }

    function normalizeConfig(config) {
        const fields = Array.isArray(config.fields) ? config.fields.slice() : [];
        const allFields = Array.isArray(config.allFields) && config.allFields.length ? config.allFields.slice() : fields.slice();
        return {
            id: config.id || createId(),
            name: String(config.name || 'Imported Snapshot'),
            fields,
            allFields,
            checkpoints: Array.isArray(config.checkpoints) ? clone(config.checkpoints) : [],
            reportFields: Array.isArray(config.reportFields) ? config.reportFields.slice(0, 6) : [],
            groupField: String(config.groupField || ''),
            filterRules: Array.isArray(config.filterRules) ? clone(config.filterRules) : [],
            reasonTemplates: config.reasonTemplates ? clone(config.reasonTemplates) : [],
            workspaceId: config.workspaceId ? String(config.workspaceId) : '',
            workspace: config.workspace ? clone(config.workspace) : null
        };
    }

    function ensureOfflineBadge() {
        let badge = document.getElementById('offlineModeBadge');
        if (badge) return badge;
        badge = document.createElement('div');
        badge.id = 'offlineModeBadge';
        badge.style.cssText = [
            'position:fixed',
            'right:16px',
            'bottom:16px',
            'z-index:99999',
            'padding:9px 12px',
            'border-radius:12px',
            'background:rgba(15,23,42,0.92)',
            'color:#e2e8f0',
            'font-size:12px',
            'line-height:1.5',
            'box-shadow:0 10px 28px rgba(0,0,0,0.22)'
        ].join(';');
        badge.innerHTML = '离线模式 / Offline Mode<br><span style="color:#93c5fd;">Snapshot-only workflow enabled</span>';
        document.body.appendChild(badge);
        return badge;
    }

    function getOfflineLanguage() {
        const lang = localStorage.getItem('tools_lang') || navigator.language || 'zh-CN';
        return String(lang).startsWith('en') ? 'en-US' : 'zh-CN';
    }

    function applyOfflineLanguage(lang) {
        const normalized = String(lang || '').startsWith('en') ? 'en-US' : 'zh-CN';
        if (window.ToolsI18n && typeof window.ToolsI18n.setLanguage === 'function') {
            window.ToolsI18n.setLanguage(normalized);
        } else {
            localStorage.setItem('tools_lang', normalized);
            document.documentElement.lang = normalized;
            window.dispatchEvent(new CustomEvent('tools:languagechange', { detail: { lang: normalized } }));
        }
        updateOfflineLanguageToggle();
    }

    function updateOfflineLanguageToggle() {
        const btn = document.getElementById('prauditOfflineLanguageToggle');
        if (!btn) return;
        const lang = getOfflineLanguage();
        btn.textContent = lang === 'en-US' ? '🌐 EN' : '🌐 中文';
        btn.title = lang === 'en-US' ? 'Switch language' : '切换语言';
    }

    function ensureOfflineLanguageToggle() {
        if (document.getElementById('prauditOfflineLanguageToggle')) {
            updateOfflineLanguageToggle();
            return;
        }
        const btn = document.createElement('button');
        btn.id = 'prauditOfflineLanguageToggle';
        btn.type = 'button';
        btn.style.cssText = [
            'position:fixed',
            'right:16px',
            'bottom:76px',
            'z-index:99999',
            'padding:8px 11px',
            'border-radius:12px',
            'border:1px solid rgba(148,163,184,0.45)',
            'background:rgba(255,255,255,0.96)',
            'color:#1e293b',
            'font-size:12px',
            'font-weight:700',
            'line-height:1.2',
            'box-shadow:0 10px 24px rgba(15,23,42,0.18)',
            'cursor:pointer'
        ].join(';');
        btn.addEventListener('click', () => {
            applyOfflineLanguage(getOfflineLanguage() === 'en-US' ? 'zh-CN' : 'en-US');
        });
        document.body.appendChild(btn);
        updateOfflineLanguageToggle();
    }

    function showOfflineGuide(autoOpen = false) {
        if (document.getElementById('prauditOfflineGuide')) return;
        const guide = document.createElement('div');
        guide.id = 'prauditOfflineGuide';
        guide.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:99998',
            'background:rgba(15,23,42,0.55)',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:24px'
        ].join(';');
        guide.innerHTML = `
            <div style="width:min(92vw, 620px); background:#fff; border-radius:18px; box-shadow:0 24px 60px rgba(0,0,0,0.24); padding:26px 28px;">
                <div style="font-size:24px; font-weight:800; color:#1e293b; margin-bottom:8px;">PR审计报告系统</div>
                <div style="font-size:14px; color:#64748b; margin-bottom:16px;">Offline PR Audit Workspace</div>
                <div style="font-size:14px; line-height:1.75; color:#334155;">
                    请先导入同目录中的快照包或快照 zip/json，再开始离线审计。<br>
                    Please import the snapshot package or inner snapshot zip/json from the same folder to start offline auditing.
                </div>
                <div style="margin-top:14px; padding:12px 14px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0; font-size:13px; color:#475569; line-height:1.7;">
                    说明：如果你解压后看到了 <strong>PR审计快照.zip</strong>，请选择这个文件导入即可。<br>
                    Tip: If you see an inner <strong>PR Audit Snapshot .zip</strong> after extracting the package, import that file directly.
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                    <button type="button" id="offlineGuideLaterBtn" style="padding:10px 16px; border-radius:10px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-weight:600; cursor:pointer;">稍后 / Later</button>
                    <button type="button" id="offlineGuideImportBtn" style="padding:10px 16px; border-radius:10px; border:none; background:#2563eb; color:#fff; font-weight:700; cursor:pointer;">导入快照 / Import Snapshot</button>
                </div>
            </div>
        `;
        document.body.appendChild(guide);

        const closeGuide = (remember) => {
            if (remember) localStorage.setItem(OFFLINE_GUIDE_DISMISSED_KEY, '1');
            guide.remove();
        };

        guide.querySelector('#offlineGuideLaterBtn').addEventListener('click', () => closeGuide(true));
        guide.querySelector('#offlineGuideImportBtn').addEventListener('click', () => {
            const input = document.getElementById('snapshotFileInput');
            if (input) input.click();
            closeGuide(false);
        });

        if (autoOpen) localStorage.removeItem(OFFLINE_GUIDE_DISMISSED_KEY);
    }

    function showToast(message, type = 'success') {
        let toast = document.getElementById('globalToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'globalToast';
            toast.style.cssText = [
                'position:fixed',
                'left:50%',
                'bottom:28px',
                'transform:translateX(-50%) translateY(10px)',
                'padding:10px 14px',
                'border-radius:12px',
                'color:#fff',
                'font-size:13px',
                'font-weight:600',
                'opacity:0',
                'transition:all 0.25s ease',
                'z-index:100000',
                'box-shadow:0 12px 28px rgba(0,0,0,0.18)'
            ].join(';');
            document.body.appendChild(toast);
        }
        const bg = type === 'error' ? '#dc2626' : (type === 'warning' ? '#d97706' : '#16a34a');
        toast.style.background = bg;
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(10px)';
        }, 2600);
    }

    function showOfflineDisabledToast() {
        showToast('离线包已隐藏该功能，请导入/审计/导出回传。 / This action is disabled in the offline package.', 'warning');
    }

    function lockDownOfflineUi() {
        const selectorsToHide = [
            'button[onclick="openWizard()"]',
            'button[onclick="editWizard()"]',
            '#btnEditConfig',
            '#btnDeleteConfig',
            'button[onclick="deleteWizardConfig()"]',
            'button[onclick="loadMockData()"]',
            'button[onclick="exportPDFByGroup(this)"]',
            'button[onclick="exportAuditSnapshotByGroup(this)"]'
        ];
        selectorsToHide.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                el.style.display = 'none';
            });
        });
    }

    function lockDownOfflineActions() {
        window.openWizard = showOfflineDisabledToast;
        window.editWizard = showOfflineDisabledToast;
        window.deleteWizardConfig = showOfflineDisabledToast;
        window.loadMockData = showOfflineDisabledToast;
        window.exportPDFByGroup = showOfflineDisabledToast;
        window.exportAuditSnapshotByGroup = showOfflineDisabledToast;
    }

    function readSourceModeMap() {
        try {
            return JSON.parse(localStorage.getItem(SOURCE_MODE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function writeSourceModeMap(map) {
        localStorage.setItem(SOURCE_MODE_KEY, JSON.stringify(map));
    }

    async function getConfigs() {
        return readConfigs();
    }

    async function saveConfig(payload) {
        const configs = readConfigs();
        const normalized = normalizeConfig(payload || {});
        const index = configs.findIndex(item => item.id === normalized.id);
        if (index >= 0) configs[index] = normalized;
        else configs.push(normalized);
        writeConfigs(configs);
        return clone(normalized);
    }

    async function removeConfigById(id) {
        const configs = readConfigs().filter(item => item.id !== id);
        writeConfigs(configs);
        return { success: true };
    }

    async function offlineApiGet(path) {
        if (path === '/api/praudit/configs') return clone(await getConfigs());
        if (path === '/api/health') return { ok: true, mode: 'offline' };
        throw new Error(`Offline mode does not support GET ${path}`);
    }

    async function offlineApiPost(path, body) {
        if (path === '/api/praudit/configs') return saveConfig(body || {});
        if (path === '/api/upload/history') return { success: true };
        throw new Error(`Offline mode does not support POST ${path}`);
    }

    async function offlineApiDelete(path) {
        const match = String(path || '').match(/^\/api\/praudit\/configs\/(.+)$/);
        if (match) return removeConfigById(decodeURIComponent(match[1]));
        throw new Error(`Offline mode does not support DELETE ${path}`);
    }

    window.showToast = showToast;
    window.renderNavbar = function () {};
    window.API = {
        get: offlineApiGet,
        post: offlineApiPost,
        put: async function () { throw new Error('Offline mode does not support this action.'); },
        delete: offlineApiDelete,
        patch: async function () { throw new Error('Offline mode does not support this action.'); },
        logHistory: async function () { return { success: true }; },
        getLastDataSource: function () { return 'offline'; },
        getLastDataSourceMeta: function () { return { primary: 'offline', extras: {} }; },
        getSourceMode: function (scope) {
            const map = readSourceModeMap();
            const mode = map[scope || 'default'];
            return ['auto', 'json', 'sqlite'].includes(mode) ? mode : 'auto';
        },
        setSourceMode: function (scope, mode) {
            const normalized = ['auto', 'json', 'sqlite'].includes(mode) ? mode : 'auto';
            const map = readSourceModeMap();
            map[scope || 'default'] = normalized;
            writeSourceModeMap(map);
            return normalized;
        }
    };

    patchLocalStorageForWorkspace();
    patchLocalForageForWorkspace();

    document.addEventListener('DOMContentLoaded', () => {
        patchLocalStorageForWorkspace();
        patchLocalForageForWorkspace();
        lockDownOfflineActions();
        ensureOfflineBadge();
        ensureOfflineLanguageToggle();
        document.documentElement.style.setProperty('--navbar-h', '0px');
        setTimeout(() => {
            lockDownOfflineUi();
            const configs = readConfigs();
            if (!configs.length) showOfflineGuide(true);
        }, 280);
    });
})();
