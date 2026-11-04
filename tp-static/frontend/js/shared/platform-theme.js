// 工具主题固定为亮色；原生暗色工具由服务端 data-tool-theme="dark" 声明。
// 运行时在页面脚本之前执行，CSS 媒体查询、JS matchMedia、主题属性和原生控件保持同一主题。
// 不读取、不改写平台或工具自身的 localStorage 偏好，也不随系统/平台切换。
(function () {
    'use strict';
    if (window.__toolsPlatformTheme) return;
    const root = document.documentElement;
    const theme = document.currentScript?.dataset.toolTheme === 'dark' ? 'dark' : 'light';
    const FEATURE = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi;
    const originals = new WeakMap();

    function applyRoot() {
        for (const node of [root, document.body].filter(Boolean)) {
            if (node.dataset.platformTheme !== theme) node.dataset.platformTheme = theme;
            if (node.dataset.theme !== theme) node.dataset.theme = theme;
            for (const cls of ['dark', 'dark-mode', 'theme-dark', 'dark-theme']) if (theme === 'light' && node.classList.contains(cls)) node.classList.remove(cls);
            for (const cls of ['light-mode', 'theme-light', 'light-theme']) if (theme === 'dark' && node.classList.contains(cls)) node.classList.remove(cls);
        }
        if (root.style.colorScheme !== theme) root.style.colorScheme = theme;
    }
    const controls = document.createElement('style');
    controls.id = 'tools-fixed-tool-theme';
    controls.textContent = `:root,body,input,textarea,select,button { color-scheme: ${theme} !important; }
        #themeToggleButton,#themeToggle,#themeToggleBtn,#theme-toggle,#theme-btn,#themeBtn,#themeSwitcher,button#theme,.theme-toggle,.btn-theme-toggle,.theme-switch,[data-theme-toggle] { display:none !important; }`;
    (document.head || root).appendChild(controls);

    // 成立写成 (min-width: 0px)；不成立用无效条件 (max-width: -1px)，整条查询按 not all 处理（宽度为 0 的框里也不会误判）
    function rewrite(text) {
        return text.replace(FEATURE, (match, value) => ((value.toLowerCase() === 'dark') === (theme === 'dark') ? '(min-width: 0px)' : '(max-width: -1px)'));
    }

    function walk(rules) {
        for (const rule of Array.from(rules || [])) {
            if (rule.media && typeof rule.media.mediaText === 'string') {
                const original = originals.get(rule) ?? rule.media.mediaText;
                if (/prefers-color-scheme/i.test(original)) {
                    originals.set(rule, original);
                    const next = rewrite(original);
                    if (rule.media.mediaText !== next) rule.media.mediaText = next;
                }
            }
            if (rule.cssRules) walk(rule.cssRules);
        }
    }

    function fixSheet(sheet) {
        if (!sheet) return;
        try {
            if (sheet.media && /prefers-color-scheme/i.test(originals.get(sheet) ?? sheet.media.mediaText)) {
                const original = originals.get(sheet) ?? sheet.media.mediaText;
                originals.set(sheet, original);
                sheet.media.mediaText = rewrite(original);
            }
            walk(sheet.cssRules);
        } catch { /* 跨源样式表读不到规则，跳过 */ }
    }

    function fixAll() {
        for (const sheet of Array.from(document.styleSheets)) fixSheet(sheet);
        for (const sheet of document.adoptedStyleSheets || []) fixSheet(sheet);
    }

    // 脚本运行时 <head> 里的样式还没解析：边解析边改，加载完再整体过一遍
    new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes' && (record.target === root || record.target === document.body)) applyRoot();
            for (const node of record.addedNodes) {
                if (node.nodeName === 'BODY') applyRoot();
                if (node.nodeName === 'STYLE') fixSheet(node.sheet);
                else if (node.nodeName === 'LINK' && /stylesheet/i.test(node.rel || '')) {
                    if (node.sheet) fixSheet(node.sheet);
                    node.addEventListener('load', () => fixSheet(node.sheet), { once: true });
                }
            }
            if (record.type === 'characterData' || (record.target?.nodeName === 'STYLE')) fixSheet(record.target.sheet || record.target.parentNode?.sheet);
        }
    }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-theme','data-platform-theme','class','style'] });
    document.addEventListener('DOMContentLoaded', () => { applyRoot(); fixAll(); }, { once: true });
    window.addEventListener('load', fixAll, { once: true });

    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
        const text = String(query);
        if (!/prefers-color-scheme/i.test(text)) return nativeMatchMedia(query);
        // 保留原生 MediaQueryList 事件语义（含混合宽度查询），仅固定颜色偏好条件。
        const list = nativeMatchMedia(rewrite(text));
        Object.defineProperty(list, 'media', { value: text });
        return list;
    };

    // 平台 storage 事件不会改变工具主题，也不触发工具的主题 change 回调。
    applyRoot();
    fixAll();
    window.__toolsPlatformTheme = { get theme() { return theme; }, fixed: true };
})();
