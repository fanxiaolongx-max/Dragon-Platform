(function () {
    if (window.__toolsCustomI18nReady) return;
    window.__toolsCustomI18nReady = true;

    const config = window.__TOOLS_CUSTOM_I18N__ || {};
    const translations = config.translations && typeof config.translations === 'object' ? config.translations : {};
    const reverseTranslations = Object.fromEntries(Object.entries(translations).map(([zh, en]) => [en, zh]));
    const textOriginals = new WeakMap();
    const attributeOriginals = new WeakMap();
    const ignoredParents = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA']);
    const originalDocumentTitle = document.title;
    let currentLang = normalizeLanguage(readStoredLanguage() || document.documentElement.lang);
    let applying = false;
    let syncingNativeControl = false;
    let observer = null;
    let iconFallbackReady = false;

    const remixIconFallbacks = {
        'ri-edit-box-line': ['✎', '编辑', 'Edit'],
        'ri-arrow-go-back-line': ['↶', '撤销', 'Undo'],
        'ri-arrow-go-forward-line': ['↷', '重做', 'Redo'],
        'ri-folder-open-line': ['▣', '打开文件', 'Open file'],
        'ri-file-code-line': ['⇧', '导入工程', 'Import project'],
        'ri-save-2-line': ['↓', '保存工程', 'Save project'],
        'ri-save-3-line': ['⇩', '导出文件', 'Export file'],
        'ri-cursor-line': ['↖', '选择', 'Select'],
        'ri-text': ['T', '文本', 'Text'],
        'ri-shape-fill': ['■', '形状', 'Shape'],
        'ri-pencil-fill': ['✎', '画笔', 'Draw'],
        'ri-mark-pen-fill': ['▂', '高亮', 'Highlight'],
        'ri-image-add-line': ['▧', '添加图片', 'Add image'],
        'ri-grid-line': ['#', '网格', 'Grid'],
        'ri-file-copy-line': ['⧉', '复制', 'Copy'],
        'ri-delete-bin-line': ['×', '删除', 'Delete'],
        'ri-anticlockwise-2-line': ['↺', '向左旋转', 'Rotate left'],
        'ri-clockwise-2-line': ['↻', '向右旋转', 'Rotate right'],
        'ri-eraser-line': ['◇', '清除', 'Clear'],
        'ri-arrow-left-s-line': ['‹', '上一页', 'Previous page'],
        'ri-arrow-right-s-line': ['›', '下一页', 'Next page'],
        'ri-subtract-line': ['−', '缩小', 'Zoom out'],
        'ri-add-line': ['+', '放大', 'Zoom in'],
        'ri-aspect-ratio-line': ['⛶', '适应宽度', 'Fit to width'],
        'ri-upload-cloud-2-line': ['↑', '上传', 'Upload']
    };

    function normalizeLanguage(value) {
        return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
    }

    function readStoredLanguage() {
        try { return localStorage.getItem('tools_lang'); } catch (_) { return ''; }
    }

    function storeLanguage(value) {
        try { localStorage.setItem('tools_lang', value); } catch (_) {}
    }

    function findRemixIconClass(element) {
        return Array.from(element?.classList || []).find(name => name.startsWith('ri-') && remixIconFallbacks[name]) || '';
    }

    function updateFallbackIconLabels() {
        if (!iconFallbackReady) return;
        document.querySelectorAll('i[class^="ri-"], i[class*=" ri-"]').forEach(icon => {
            const iconClass = findRemixIconClass(icon);
            const button = icon.closest('button, [role="button"]');
            if (!iconClass || !button) return;
            const fallback = remixIconFallbacks[iconClass];
            const label = currentLang === 'en' ? fallback[2] : fallback[1];
            if (!button.hasAttribute('title') || button.dataset.toolsFallbackTitle === '1') {
                button.title = label;
                button.dataset.toolsFallbackTitle = '1';
            }
            if ((!button.hasAttribute('aria-label') || button.dataset.toolsFallbackAria === '1') && !(button.textContent || '').trim()) {
                button.setAttribute('aria-label', label);
                button.dataset.toolsFallbackAria = '1';
            }
        });
    }

    function installRemixIconFallback() {
        if (iconFallbackReady) return;
        iconFallbackReady = true;
        const style = document.createElement('style');
        style.id = 'toolsCustomIconFallback';
        style.dataset.toolsI18nIgnore = '1';
        const mappings = Object.entries(remixIconFallbacks)
            .map(([className, values]) => `.${className}::before{content:${JSON.stringify(values[0])}!important}`)
            .join('');
        style.textContent = `[class^="ri-"]::before,[class*=" ri-"]::before{content:"◆"!important;font-family:system-ui,-apple-system,"Segoe UI Symbol",sans-serif!important;font-style:normal!important;font-weight:700!important;line-height:1!important;speak:none}${mappings}button:disabled:has(i[class^="ri-"],i[class*=" ri-"]){opacity:.52!important}`;
        document.head.appendChild(style);
        updateFallbackIconLabels();
    }

    async function repairMissingRemixIcons() {
        if (iconFallbackReady || !document.querySelector('i[class^="ri-"], i[class*=" ri-"]')) return;
        if (!document.fonts) return installRemixIconFallback();
        try {
            await document.fonts.ready;
            const faces = [];
            document.fonts.forEach(face => {
                if (String(face.family || '').replace(/["']/g, '').toLowerCase() === 'remixicon') faces.push(face);
            });
            if (faces.some(face => face.status === 'loaded')) return;
        } catch (_) {}
        installRemixIconFallback();
    }

    function preserveWhitespace(original, replacement) {
        const leading = original.match(/^\s*/)?.[0] || '';
        const trailing = original.match(/\s*$/)?.[0] || '';
        return `${leading}${replacement}${trailing}`;
    }

    function translateValue(value, dictionary) {
        const source = String(value || '');
        const trimmed = source.trim();
        if (!trimmed) return source;
        if (dictionary[trimmed]) return preserveWhitespace(source, dictionary[trimmed]);
        let translated = trimmed;
        const candidates = Object.keys(dictionary)
            .filter(key => key.length >= 2 && translated.includes(key))
            .sort((a, b) => b.length - a.length);
        candidates.forEach(key => { translated = translated.split(key).join(dictionary[key]); });
        return translated === trimmed ? source : preserveWhitespace(source, translated);
    }

    function shouldIgnore(node) {
        const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        return !parent || ignoredParents.has(parent.tagName) || parent.closest('[data-tools-i18n-ignore], [contenteditable="true"]');
    }

    function usesNativeLanguageControl() {
        return Boolean(document.querySelector('[data-set-lang], [data-lang-btn], .lang-switch [data-lang], #langBtn, #lang-btn, #language-toggle, #langZh, #langEn, .lang-toggle'));
    }

    function applyTextNode(node) {
        if (shouldIgnore(node)) return;
        if (!textOriginals.has(node)) textOriginals.set(node, node.nodeValue || '');
        const original = textOriginals.get(node);
        const sourceIsChinese = /[\u3400-\u9fff]/.test(original);
        const next = currentLang === 'en'
            ? (sourceIsChinese ? translateValue(original, translations) : original)
            : (sourceIsChinese ? original : translateValue(original, reverseTranslations));
        if (node.nodeValue !== next) node.nodeValue = next;
    }

    function applyElementAttributes(element) {
        if (!(element instanceof Element) || shouldIgnore(element)) return;
        const attributes = ['placeholder', 'title', 'aria-label', 'data-empty-text'];
        if (element instanceof HTMLInputElement && /^(?:button|submit|reset)$/i.test(element.type)) attributes.push('value');
        let originals = attributeOriginals.get(element);
        if (!originals) {
            originals = {};
            attributeOriginals.set(element, originals);
        }
        attributes.forEach(name => {
            if (!element.hasAttribute(name)) return;
            if (!(name in originals)) originals[name] = element.getAttribute(name) || '';
            const original = originals[name];
            const sourceIsChinese = /[\u3400-\u9fff]/.test(original);
            const next = currentLang === 'en'
                ? (sourceIsChinese ? translateValue(original, translations) : original)
                : (sourceIsChinese ? original : translateValue(original, reverseTranslations));
            if (element.getAttribute(name) !== next) element.setAttribute(name, next);
        });
    }

    function applyTree(root = document.body) {
        if (!root || applying) return;
        applying = true;
        try {
            if (usesNativeLanguageControl()) {
                document.documentElement.lang = currentLang === 'en' ? 'en-US' : 'zh-CN';
                updateButton();
                return;
            }
            if (root.nodeType === Node.TEXT_NODE) applyTextNode(root);
            if (root instanceof Element) applyElementAttributes(root);
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (node.nodeType === Node.TEXT_NODE) applyTextNode(node);
                else applyElementAttributes(node);
            }
            document.documentElement.lang = currentLang === 'en' ? 'en-US' : 'zh-CN';
            const titleIsChinese = /[\u3400-\u9fff]/.test(originalDocumentTitle);
            document.title = currentLang === 'en'
                ? (titleIsChinese ? translateValue(originalDocumentTitle, translations) : originalDocumentTitle)
                : (titleIsChinese ? originalDocumentTitle : translateValue(originalDocumentTitle, reverseTranslations));
            updateButton();
        } finally {
            observer?.takeRecords();
            applying = false;
        }
    }

    function updateButton() {
        const button = document.getElementById('toolsCustomLanguageButton');
        if (!button) return;
        button.innerHTML = `<span aria-hidden="true" style="font-size:13px;line-height:1">🌐</span><span style="font-weight:700;font-size:11px;letter-spacing:0.5px">${currentLang === 'en' ? '中' : 'EN'}</span>`;
        button.title = currentLang === 'en' ? 'Switch to Chinese' : '切换为英文';
        button.setAttribute('aria-label', button.title);
    }

    function notifyParent() {
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'tools-custom-tool-language', lang: currentLang === 'en' ? 'en-US' : 'zh-CN' }, window.location.origin);
        }
    }

    function nativeControlTarget(lang) {
        const explicitSelectors = lang === 'en'
            ? ['button[data-set-lang="en"]', 'button[data-lang="en"]', 'button[data-lang-btn="en"]', '#langEn']
            : ['button[data-set-lang="zh"]', 'button[data-lang="zh"]', 'button[data-lang-btn="zh"]', '#langZh'];
        for (const selector of explicitSelectors) {
            const el = document.querySelector(selector);
            if (el && el.id !== 'toolsCustomLanguageButton') return el;
        }
        return null;
    }

    function syncNativeLanguageControl(lang) {
        if (syncingNativeControl) return;
        const explicit = nativeControlTarget(lang);
        if (explicit) {
            const isActive = explicit.classList.contains('active') || explicit.getAttribute('aria-pressed') === 'true';
            if (!isActive) {
                syncingNativeControl = true;
                try { explicit.click(); } finally { syncingNativeControl = false; }
            }
            return;
        }
        const toggle = document.querySelector('#langBtn, #lang-btn, #language-toggle, .lang-toggle');
        if (!toggle || toggle.id === 'toolsCustomLanguageButton') return;
        const label = (toggle.textContent || '').trim().toLowerCase();
        const offersEnglish = /^(?:en|english)$/.test(label) || /\ben\b|english/.test(label);
        const offersChinese = /中文|\bzh\b/.test(label) || label === '中';
        const shouldClick = (lang === 'en' && offersEnglish) || (lang === 'zh' && offersChinese);
        if (shouldClick) {
            syncingNativeControl = true;
            try { toggle.click(); } finally { syncingNativeControl = false; }
        }
    }

    function setLanguage(value, options = {}) {
        const next = normalizeLanguage(value);
        currentLang = next;
        storeLanguage(next === 'en' ? 'en-US' : 'zh-CN');
        if (options.syncNative !== false) syncNativeLanguageControl(next);
        applyTree();
        updateFallbackIconLabels();
        if (options.notify !== false) notifyParent();
        window.dispatchEvent(new CustomEvent('tools:custom-languagechange', { detail: { lang: next } }));
    }

    function createButton() {
        if (document.getElementById('toolsCustomLanguageButton')) return;
        const style = document.createElement('style');
        style.dataset.toolsI18nIgnore = '1';
        style.textContent = `#toolsCustomLanguageButton{position:fixed;right:0;bottom:84px;z-index:2147483647;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:54px;height:38px;padding:0 10px 0 12px;border:1px solid rgba(148,163,184,.38);border-right:none;border-radius:19px 0 0 19px;background:rgba(15,23,42,.88);box-shadow:-4px 6px 20px rgba(2,6,23,.24);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:#f8fafc;font:600 12px/1 system-ui,-apple-system,sans-serif;cursor:pointer;user-select:none;touch-action:manipulation;transition:transform .22s cubic-bezier(.2,.8,.2,1),background .22s,border-color .22s,box-shadow .22s;outline:none}#toolsCustomLanguageButton:hover{border-color:rgba(103,232,249,.65);background:rgba(15,23,42,.98);transform:translateX(-5px);box-shadow:-6px 8px 24px rgba(2,6,23,.32),0 0 16px rgba(103,232,249,.18)}#toolsCustomLanguageButton:active{transform:translateX(-2px) scale(.97)}@media (max-width:520px){#toolsCustomLanguageButton{bottom:74px;height:34px;min-width:48px;padding:0 8px 0 10px;border-radius:17px 0 0 17px;font-size:11px}}@media print{#toolsCustomLanguageButton{display:none!important}}`;
        document.head.appendChild(style);
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'toolsCustomLanguageButton';
        button.dataset.toolsI18nIgnore = '1';
        button.addEventListener('click', () => setLanguage(currentLang === 'en' ? 'zh' : 'en'));
        document.body.appendChild(button);
        updateButton();
    }

    function start() {
        createButton();
        void repairMissingRemixIcons();
        syncNativeLanguageControl(currentLang);
        applyTree();
        observer = new MutationObserver(records => {
            if (applying) return;
            records.forEach(record => {
                if (record.type === 'characterData') {
                    textOriginals.set(record.target, record.target.nodeValue || '');
                    applyTree(record.target);
                }
                record.addedNodes?.forEach(node => {
                    applyTree(node);
                    if (node instanceof Element && (node.matches?.('i[class^="ri-"], i[class*=" ri-"]') || node.querySelector?.('i[class^="ri-"], i[class*=" ri-"]'))) {
                        void repairMissingRemixIcons();
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        document.addEventListener('click', event => {
            if (syncingNativeControl) return;
            const control = event.target.closest?.('[data-set-lang], [data-lang-btn], .lang-btn, #langBtn, #lang-btn, #language-toggle, #langZh, #langEn, .lang-toggle');
            if (!control || control.id === 'toolsCustomLanguageButton') return;
            const explicit = control.dataset.setLang || control.dataset.lang || control.dataset.langBtn
                || (control.id === 'langEn' ? 'en' : control.id === 'langZh' ? 'zh' : '');
            if (explicit === 'both' || explicit === 'ar') return;
            const next = explicit || (currentLang === 'en' ? 'zh' : 'en');
            setTimeout(() => setLanguage(next, { syncNative: false }), 0);
        });
    }

    window.addEventListener('message', event => {
        if (event.origin !== window.location.origin || event.data?.type !== 'tools-platform-language') return;
        setLanguage(event.data.lang, { notify: false });
    });
    window.addEventListener('storage', event => {
        if (event.key === 'tools_lang' && event.newValue) setLanguage(event.newValue, { notify: false });
    });
    window.ToolsCustomI18n = { setLanguage, getLanguage: () => currentLang, apply: applyTree };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
