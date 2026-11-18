/**
 * shared/i18n.js - Lightweight client-side language helper.
 * Pages register dictionaries and mark translatable nodes with data-i18n.
 */
(function () {
    const STORAGE_KEY = 'tools_lang';
    const DEFAULT_LANG = 'zh-CN';
    const SUPPORTED_LANGS = ['zh-CN', 'en-US'];
    const dictionaries = {};

    function detectBrowserLang() {
        try {
            const candidates = [];
            if (Array.isArray(navigator.languages)) {
                candidates.push(...navigator.languages);
            }
            if (navigator.language) candidates.push(navigator.language);
            if (navigator.userLanguage) candidates.push(navigator.userLanguage);
            for (const lang of candidates) {
                if (!lang || typeof lang !== 'string') continue;
                const l = lang.trim().toLowerCase();
                if (l.startsWith('zh')) return 'zh-CN';
                if (l.startsWith('en')) return 'en-US';
            }
            const primary = candidates[0] ? String(candidates[0]).trim().toLowerCase() : '';
            if (primary && !primary.startsWith('zh')) {
                return 'en-US';
            }
        } catch (e) {}
        return DEFAULT_LANG;
    }

    function getStoredLang() {
        const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('tools_language');
        if (SUPPORTED_LANGS.includes(saved)) return saved;
        return detectBrowserLang();
    }

    function interpolate(template, params = {}) {
        return String(template).replace(/\{(\w+)\}/g, (_, key) => (
            Object.prototype.hasOwnProperty.call(params, key) ? params[key] : `{${key}}`
        ));
    }

    function translate(key, params = {}, lang = getStoredLang()) {
        const dict = dictionaries[lang] || {};
        const fallback = dictionaries[DEFAULT_LANG] || {};
        const value = dict[key] ?? fallback[key] ?? key;
        return interpolate(value, params);
    }

    function hasTranslation(key, lang = getStoredLang()) {
        const dict = dictionaries[lang] || {};
        const fallback = dictionaries[DEFAULT_LANG] || {};
        return (key in dict) || (key in fallback);
    }

    function applyI18n(root = document) {
        const lang = getStoredLang();
        document.documentElement.lang = lang;
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (hasTranslation(key, lang)) el.textContent = translate(key, {}, lang);
        });
        root.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.dataset.i18nHtml;
            if (hasTranslation(key, lang)) el.innerHTML = translate(key, {}, lang);
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.dataset.i18nTitle;
            if (hasTranslation(key, lang)) el.title = translate(key, {}, lang);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if (hasTranslation(key, lang)) el.placeholder = translate(key, {}, lang);
        });
        root.querySelectorAll('[data-i18n-value]').forEach(el => {
            const key = el.dataset.i18nValue;
            if (hasTranslation(key, lang)) el.value = translate(key, {}, lang);
        });
        root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            const key = el.dataset.i18nAriaLabel;
            if (hasTranslation(key, lang)) el.setAttribute('aria-label', translate(key, {}, lang));
        });
    }

    // Desktop opens the platform in the system browser, so sync via its local API.
    // Serialize requests so rapid toggles cannot arrive in reverse order.
    let desktopSync = Promise.resolve();
    function syncDesktopLanguage() {
        if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
        desktopSync = desktopSync.catch(() => {}).then(async () => {
            const token = localStorage.getItem('tools_token');
            if (!token) return;
            await fetch('/api/desktop-pet/language', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ language: getStoredLang() })
            });
        }).catch(() => {});
    }
    function normalizeLang(value) {
        const clean = String(value || '').trim().toLowerCase();
        if (!clean) return '';
        if (clean.startsWith('en')) return 'en-US';
        if (clean.startsWith('zh')) return 'zh-CN';
        return '';
    }

    function syncExternalLanguage(rawLang) {
        const next = normalizeLang(rawLang) || getStoredLang();
        if (!SUPPORTED_LANGS.includes(next)) return;
        let stored = '';
        try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch (_) {}
        if (stored !== next) {
            try {
                localStorage.setItem(STORAGE_KEY, next);
                localStorage.setItem('tools_language', next);
            } catch (_) {}
        }
        const changed = document.documentElement.lang !== next;
        applyI18n(document);
        if (changed) {
            window.dispatchEvent(new CustomEvent('tools:languagechange', { detail: { lang: next } }));
        }
    }

    window.addEventListener('tools:languagechange', syncDesktopLanguage);
    window.addEventListener('storage', event => {
        if (event.key === STORAGE_KEY || event.key === 'tools_language') {
            syncExternalLanguage(event.newValue);
            syncDesktopLanguage();
        }
    });
    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
        if (event.data.type === 'tools-platform-language') {
            syncExternalLanguage(event.data.lang);
        } else if (event.data.type === 'tools-custom-tool-language') {
            const next = normalizeLang(event.data.lang);
            if (next && getStoredLang() !== next) setLanguage(next);
        }
    });
    window.addEventListener('pageshow', syncDesktopLanguage);
    syncDesktopLanguage();

    function setLanguage(lang) {
        const normalized = normalizeLang(lang) || lang;
        if (!SUPPORTED_LANGS.includes(normalized)) return;
        localStorage.setItem(STORAGE_KEY, normalized);
        try { localStorage.setItem('tools_language', normalized); } catch (e) {}
        applyI18n(document);
        window.dispatchEvent(new CustomEvent('tools:languagechange', { detail: { lang: normalized } }));
        try {
            if (window.parent && window.parent !== window && window.parent.location.origin === window.location.origin) {
                if (window.parent.ToolsI18n?.getLanguage?.() !== normalized) {
                    window.parent.ToolsI18n?.setLanguage?.(normalized);
                }
            }
        } catch (_) {}
    }

    function toggleLanguage() {
        setLanguage(getStoredLang() === 'zh-CN' ? 'en-US' : 'zh-CN');
    }

    function register(namespace, entries) {
        Object.entries(entries || {}).forEach(([lang, values]) => {
            dictionaries[lang] = { ...(dictionaries[lang] || {}), ...values };
        });
        applyI18n(document);
    }

    window.ToolsI18n = {
        defaultLang: DEFAULT_LANG,
        supportedLangs: SUPPORTED_LANGS,
        getLanguage: getStoredLang,
        setLanguage,
        toggleLanguage,
        register,
        apply: applyI18n,
        t: translate
    };
})();
