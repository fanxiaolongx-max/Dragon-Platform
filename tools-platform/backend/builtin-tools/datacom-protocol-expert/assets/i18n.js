// 本工具的完整内容翻译。只改显示层，编辑器和数据库始终保留用户原文。
import { english } from './i18n-en.js';
const chinese = /[\u3400-\u9fff]/;
const keys = Object.keys(english).filter(Boolean).sort((a, b) => b.length - a.length);
const buckets = new Map();
for (const key of keys) {
    const first = key[0];
    if (!buckets.has(first)) buckets.set(first, []);
    buckets.get(first).push(key);
}
let language = 'zh';
try { language = /^en/i.test(localStorage.getItem('tools_lang') || '') ? 'en' : 'zh'; } catch (_) { /* privacy mode */ }
const originals = new WeakMap();
const attributes = new WeakMap();
export const getLanguage = () => language;

export function translate(value, lang = language) {
    const source = String(value ?? '');
    if (lang !== 'en' || !chinese.test(source)) return source;
    const timer = /^(\d+) 次连续变化累计等待 (\d+) ms。([\s\S]*)$/.exec(source);
    if (timer) return `${timer[1]} consecutive changes: ${timer[2]} ms total wait. ${translate(timer[3], lang)}`;
    const trimmed = source.trim();
    if (Object.hasOwn(english, trimmed)) return source.replace(trimmed, () => english[trimmed]);
    // Composite UI strings include counts, addresses and other runtime values.
    // Match against the source only, so English output is never translated again.
    let result = '';
    for (let i = 0; i < source.length;) {
        const found = buckets.get(source[i])?.find(key => source.startsWith(key, i));
        if (found) { result += english[found]; i += found.length; }
        else { result += source[i]; i += 1; }
    }
    return result;
}

export function originalText(node) {
    if (node.nodeType === 3) return originals.get(node)?.source ?? node.nodeValue;
    return [...node.childNodes].map(originalText).join('');
}

// Map a selection in the translated view back to the saved source passage.
// A translated text node is an indivisible phrase; protocol/code text keeps
// precise character offsets because it has not changed between languages.
export function originalSelection(range, root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node, before = '', exact = '', after = '';
    while ((node = walker.nextNode())) {
        const source = originalText(node);
        const value = node.nodeValue || '';
        if (range.intersectsNode(node)) {
            const start = node === range.startContainer ? range.startOffset : 0;
            const end = node === range.endContainer ? range.endOffset : value.length;
            if (source === value) { before += source.slice(0, start); exact += source.slice(start, end); after += source.slice(end); }
            else if (end > start) exact += source;
        } else if (node.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) before += source;
        else after += source;
    }
    return { exact, prefix: before.slice(-80), suffix: after.slice(0, 80) };
}

const ignored = element => !element || Boolean(element.closest('script, style, noscript, textarea, [contenteditable="true"], [data-tools-i18n-ignore], #langBtn, #toolsCustomLanguageButton'));
function fitLabel(node) {
    const element = node.parentElement;
    if (element?.tagName.toLowerCase() !== 'text' || !element.closest('.dk-diagram, .dk-mm-svg')) return;
    element.removeAttribute('textLength');
    element.removeAttribute('lengthAdjust');
    if (language !== 'en') return;
    const rect = element.parentElement.querySelector(':scope > rect');
    const width = Number(rect?.getAttribute('width')) || (element.classList.contains('region-title') ? 768 : 0);
    if (width > 30 && element.getComputedTextLength?.() > width - 12) {
        element.setAttribute('textLength', String(width - 12));
        element.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    }
}
function applyText(node) {
    if (ignored(node.parentElement)) return;
    const current = node.nodeValue || '';
    let record = originals.get(node);
    if (!record || current !== record.rendered) record = { source: current, rendered: current };
    record.rendered = translate(record.source);
    originals.set(node, record);
    if (current !== record.rendered) node.nodeValue = record.rendered;
    fitLabel(node);
}
function applyAttributes(element) {
    if (ignored(element)) return;
    let records = attributes.get(element);
    if (!records) { records = {}; attributes.set(element, records); }
    for (const name of ['title', 'placeholder', 'aria-label', 'alt', 'label', 'data-empty-text']) {
        if (!element.hasAttribute(name)) continue;
        const current = element.getAttribute(name);
        let record = records[name];
        if (!record || current !== record.rendered) record = { source: current, rendered: current };
        record.rendered = translate(record.source);
        records[name] = record;
        if (current !== record.rendered) element.setAttribute(name, record.rendered);
    }
}
let observer;
export function applyLanguage(root = document.body) {
    if (root.nodeType === 3) applyText(root);
    else {
        if (root.nodeType === 1) applyAttributes(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (node.nodeType === 3) applyText(node);
            else applyAttributes(node);
        }
    }
    // Discard our own changes, preserving detection of future external updates.
    observer?.takeRecords();
}

export function initLanguage() {
    const button = document.getElementById('langBtn');
    const setLanguage = (value, notify = true) => {
        const next = /^en/i.test(value) ? 'en' : 'zh';
        const changed = next !== language;
        if (changed) document.dispatchEvent(new CustomEvent('dk:beforelanguagechange'));
        language = next;
        try { localStorage.setItem('tools_lang', next === 'en' ? 'en-US' : 'zh-CN'); } catch (_) { /* privacy mode */ }
        document.documentElement.lang = next === 'en' ? 'en-US' : 'zh-CN';
        document.title = translate('数通协议专家');
        button.textContent = next === 'en' ? '中文' : 'EN';
        button.title = next === 'en' ? 'Switch to Chinese' : '切换为英文';
        button.setAttribute('aria-label', button.title);
        applyLanguage();
        if (changed) document.dispatchEvent(new CustomEvent('dk:languagechange', { detail: { lang: next } }));
        if (notify && window.parent !== window) window.parent.postMessage({ type: 'tools-custom-tool-language', lang: document.documentElement.lang }, window.location.origin);
    };
    button.addEventListener('click', () => {
        setLanguage(language === 'en' ? 'zh' : 'en');
    });
    window.addEventListener('tools:custom-languagechange', event => setLanguage(event.detail.lang, false));
    window.addEventListener('storage', event => { if (event.key === 'tools_lang' && event.newValue) setLanguage(event.newValue, false); });
    window.addEventListener('message', event => {
        if (event.origin === window.location.origin && event.data?.type === 'tools-platform-language') setLanguage(event.data.lang, false);
    });
    const hidePlatformButton = () => {
        const platformButton = document.getElementById('toolsCustomLanguageButton');
        if (!platformButton) return;
        platformButton.hidden = true;
        platformButton.style.display = 'none';
        const header = document.querySelector('.dk-topbar');
        if (platformButton.parentElement !== header) header.append(platformButton);
    };
    hidePlatformButton();
    observer = new MutationObserver(records => {
        hidePlatformButton();
        const roots = new Set();
        for (const record of records) {
            if (record.type === 'characterData' || record.type === 'attributes') roots.add(record.target);
            for (const node of record.addedNodes || []) if (node.nodeType === 1 || node.nodeType === 3) roots.add(node);
        }
        for (const root of roots) if (root.isConnected) applyLanguage(root);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'alt', 'label', 'data-empty-text'] });
    setLanguage(language, false);
}
