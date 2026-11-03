// 工具页跟随平台主题（亮 / 暗，localStorage.tools_theme，默认亮色），而不是跟随操作系统的深色模式。
// 服务端把本脚本注入到每个工具页 <head> 最前面（backend/models/asset-versioning.js injectPlatformTheme）：
// 1. 把样式表里的 @media (prefers-color-scheme: …) 条件改写成按平台主题成立 / 不成立；
// 2. matchMedia('(prefers-color-scheme: …)') 按平台主题返回；
// 3. 根元素 color-scheme 设为平台主题，原生控件、滚动条和 light-dark() 一并跟随。
// 旧版首页（tools_home_ui=v1）保持原来的跟随系统行为。
(function () {
    'use strict';
    if (window.__toolsPlatformTheme) return;
    let legacy = false;
    let theme = 'light';
    try {
        legacy = localStorage.getItem('tools_home_ui') === 'v1';
        theme = localStorage.getItem('tools_theme') === 'dark' ? 'dark' : 'light';
    } catch { /* 无痕模式：按亮色 */ }
    if (legacy) return;
    const root = document.documentElement;
    const FEATURE = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi;
    const originals = new WeakMap();

    function applyRoot() {
        root.dataset.platformTheme = theme;
        root.style.colorScheme = theme;
    }

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
            for (const node of record.addedNodes) {
                if (node.nodeName === 'STYLE') fixSheet(node.sheet);
                else if (node.nodeName === 'LINK' && /stylesheet/i.test(node.rel || '')) {
                    if (node.sheet) fixSheet(node.sheet);
                    node.addEventListener('load', () => fixSheet(node.sheet), { once: true });
                }
            }
            if (record.type === 'characterData' || (record.target?.nodeName === 'STYLE')) fixSheet(record.target.sheet || record.target.parentNode?.sheet);
        }
    }).observe(root, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', fixAll, { once: true });
    window.addEventListener('load', fixAll, { once: true });

    const nativeMatchMedia = window.matchMedia.bind(window);
    const listeners = new Set();
    window.matchMedia = function (query) {
        const text = String(query);
        if (!/prefers-color-scheme/i.test(text)) return nativeMatchMedia(query);
        const evaluate = () => nativeMatchMedia(rewrite(text)).matches;
        const list = {
            media: text,
            onchange: null,
            get matches() { return evaluate(); },
            addListener(fn) { if (typeof fn === 'function') listeners.add([list, fn]); },
            removeListener(fn) { for (const entry of listeners) if (entry[1] === fn) listeners.delete(entry); },
            addEventListener(type, fn) { if (type === 'change') list.addListener(fn); },
            removeEventListener(type, fn) { if (type === 'change') list.removeListener(fn); },
            dispatchEvent() { return true; }
        };
        return list;
    };

    // 其他标签页切换了平台主题：样式与监听者一起更新
    window.addEventListener('storage', event => {
        if (event.key !== 'tools_theme') return;
        const next = event.newValue === 'dark' ? 'dark' : 'light';
        if (next === theme) return;
        theme = next;
        applyRoot();
        fixAll();
        for (const [list, fn] of listeners) {
            const change = { matches: list.matches, media: list.media };
            try { fn.call(list, change); list.onchange?.(change); } catch { /* 工具自己的回调出错不影响其他 */ }
        }
    });

    applyRoot();
    fixAll();
    window.__toolsPlatformTheme = { get theme() { return theme; } };
})();
