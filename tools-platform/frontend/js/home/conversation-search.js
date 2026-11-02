// Find within the loaded conversation. Ranges preserve Markdown, links and streaming DOM.
(function () {
    'use strict';
    function init() {
        const thread = document.getElementById('dcThread');
        const actions = document.querySelector('.dc-chat-actions');
        if (!thread || !actions) return;
        const host = document.createElement('div');
        host.className = 'dc-find';
        host.innerHTML = `<button type="button" class="dc-ghost-btn dc-find-toggle" aria-expanded="false" aria-controls="dcFindBar"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.6"/></svg></button>
            <div class="dc-find-bar" id="dcFindBar" role="search" hidden><input type="search" autocomplete="off" spellcheck="false"><span class="dc-find-count" role="status" aria-live="polite"></span><button type="button" data-find-prev>⌃</button><button type="button" data-find-next>⌄</button><button type="button" data-find-close>×</button></div>`;
        actions.prepend(host);
        const toggle = host.querySelector('.dc-find-toggle');
        const bar = host.querySelector('.dc-find-bar');
        const input = host.querySelector('input');
        const count = host.querySelector('.dc-find-count');
        const prev = host.querySelector('[data-find-prev]');
        const next = host.querySelector('[data-find-next]');
        const close = host.querySelector('[data-find-close]');
        let matches = [], active = -1, timer;
        const highlights = typeof Highlight === 'function' && !!CSS.highlights;
        const openedDetails = new Set();
        const english = () => window.ToolsI18n?.getLanguage?.() === 'en-US';
        function texts() {
            toggle.title = english() ? 'Find in conversation · ⌘/Ctrl F' : '对话内搜索 · ⌘/Ctrl F';
            toggle.setAttribute('aria-label', toggle.title);
            input.placeholder = english() ? 'Search loaded messages' : '搜索已加载的对话内容';
            input.setAttribute('aria-label', input.placeholder);
            [[prev, 'Previous match (Shift+Enter)', '上一个匹配（Shift+Enter）'], [next, 'Next match (Enter)', '下一个匹配（Enter）'], [close, 'Close search (Esc)', '关闭搜索（Esc）']].forEach(([button, en, zh]) => {
                button.title = english() ? en : zh;
                button.setAttribute('aria-label', button.title);
            });
            updateCount();
        }
        function updateCount() {
            count.textContent = input.value ? (matches.length ? `${active + 1}/${matches.length}` : (english() ? 'No matches' : '无匹配')) : '';
            prev.disabled = next.disabled = !matches.length;
        }
        function clearReveal() {
            thread.querySelectorAll('.dc-find-reveal').forEach(node => node.classList.remove('dc-find-reveal'));
            openedDetails.forEach(node => { node.open = false; });
            openedDetails.clear();
        }
        function select(index, scroll = true) {
            clearReveal();
            active = matches.length ? (index + matches.length) % matches.length : -1;
            if (highlights) CSS.highlights.delete('dc-find-current');
            const range = matches[active];
            if (range) {
                const node = range.startContainer.parentElement;
                node.closest('.dc-msg')?.classList.add('dc-find-reveal');
                for (let parent = node; parent && parent !== thread; parent = parent.parentElement) {
                    if (parent.tagName === 'DETAILS' && !parent.open) { openedDetails.add(parent); parent.open = true; }
                }
                if (highlights) CSS.highlights.set('dc-find-current', new Highlight(range));
                else { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
                if (scroll) {
                    // Range coordinates locate a match even deep inside a long code block.
                    const rect = range.getBoundingClientRect(), box = thread.getBoundingClientRect();
                    thread.scrollBy({ top: rect.top - box.top - box.height / 2, behavior: 'instant' });
                    node.closest('pre')?.scrollTo({ left: Math.max(0, rect.left - node.closest('pre').getBoundingClientRect().left), behavior: 'instant' });
                }
            }
            updateCount();
        }
        function search(scroll = true) {
            clearTimeout(timer);
            const previous = matches[active];
            matches = [];
            const query = input.value;
            if (query) thread.querySelectorAll('.dc-msg-body').forEach(body => {
                const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, { acceptNode: node => node.parentElement.closest('script,style,[hidden],button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
                const nodes = []; let text = '', node;
                while ((node = walker.nextNode())) { nodes.push({ node, start: text.length }); text += node.data; }
                // Match against the original text: lowercasing can change Unicode offsets.
                const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
                for (const match of text.matchAll(pattern)) {
                    const at = match.index, length = match[0].length;
                    const first = nodes.findLast(item => item.start <= at);
                    const last = nodes.findLast(item => item.start < at + length);
                    if (!first || !last) continue;
                    const range = document.createRange();
                    range.setStart(first.node, at - first.start);
                    range.setEnd(last.node, at + length - last.start);
                    matches.push(range);
                }
            });
            if (highlights) {
                const all = new Highlight();
                matches.forEach(range => all.add(range));
                CSS.highlights.set('dc-find-matches', all);
            }
            const preserved = matches.findIndex(range => previous && range.startContainer === previous.startContainer && range.startOffset === previous.startOffset);
            select(scroll ? 0 : Math.max(0, preserved), scroll);
        }
        function open() {
            bar.hidden = false; toggle.hidden = true; toggle.setAttribute('aria-expanded', 'true');
            input.focus(); input.select(); search();
        }
        function dismiss(focus = true) {
            clearTimeout(timer); clearReveal();
            if (highlights) { CSS.highlights.delete('dc-find-matches'); CSS.highlights.delete('dc-find-current'); }
            else if (matches.length) window.getSelection()?.removeAllRanges();
            matches = []; active = -1; input.value = ''; bar.hidden = true; toggle.hidden = false;
            toggle.setAttribute('aria-expanded', 'false'); updateCount();
            if (focus) toggle.focus();
        }
        toggle.addEventListener('click', open);
        close.addEventListener('click', () => dismiss());
        prev.addEventListener('click', () => select(active - 1));
        next.addEventListener('click', () => select(active + 1));
        input.addEventListener('input', () => search());
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); select(active + (event.shiftKey ? -1 : 1)); }
        });
        document.addEventListener('keydown', event => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && document.body.classList.contains('dc-chatting') && !document.body.classList.contains('home-mode-tools')) { event.preventDefault(); open(); }
            if (event.key === 'Escape' && !bar.hidden) { event.preventDefault(); dismiss(); }
        });
        new MutationObserver(() => {
            if (bar.hidden) return;
            clearTimeout(timer); timer = setTimeout(() => search(false), 100);
        }).observe(thread, { childList: true, characterData: true, subtree: true });
        window.addEventListener('home:chat-state', () => dismiss(false));
        document.getElementById('dcNewChat')?.addEventListener('click', () => dismiss(false));
        window.addEventListener('tools:languagechange', texts);
        texts();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
