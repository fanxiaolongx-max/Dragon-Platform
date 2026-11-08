// Composer context menu reuses the existing upload, Skill and connector workflows.
(function () {
    'use strict';
    function init() {
        if (document.documentElement.dataset.ui !== 'v2') return;
        const button = document.getElementById('dcAttach'), form = document.getElementById('dcComposer'), input = document.getElementById('dcInput');
        if (!button || !form || !input) return;
        const menu = document.createElement('div'), sub = document.createElement('div');
        menu.id = 'dcAttachMenu'; menu.className = 'dc-composer-menu'; menu.setAttribute('role', 'menu');
        sub.id = 'dcAttachSubmenu'; sub.className = 'dc-composer-menu dc-composer-submenu'; sub.setAttribute('role', 'dialog');
        menu.hidden = sub.hidden = true;
        document.body.append(menu, sub);
        button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', menu.id); button.setAttribute('aria-expanded', 'false');
        const en = () => window.ToolsI18n?.getLanguage?.() === 'en-US';
        const text = (zh, english) => en() ? english : zh;
        const esc = value => String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        const icons = {
            file: '<path d="M14 8 8 14a3 3 0 0 1-4-4l7-7a2 2 0 0 1 3 3l-7 7"/>',
            references: '<path d="M7 7h9v10H7zM4 13H3V3h9v1"/>',
            skills: '<path d="m10 2 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z"/>',
            connectors: '<circle cx="10" cy="5" r="2"/><circle cx="5" cy="15" r="2"/><circle cx="15" cy="15" r="2"/><path d="m9 7-3 6m5-6 3 6M7 15h6"/>',
            folder: '<path d="M2 5h6l2 2h8v10H2V5Z"/>',
            tools: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>'
        };
        const glyph = name => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
        let current = '', revision = 0, hoverTimer;
        const hasSub = key => ['file', 'references', 'skills'].includes(key);
        function row(key, label) {
            return `<button type="button" role="menuitem" data-composer-action="${key}"${hasSub(key) ? ' aria-haspopup="dialog" aria-expanded="false" aria-controls="dcAttachSubmenu"' : ''}>${glyph(key)}<span>${esc(label)}</span>${hasSub(key) ? '<span class="dc-composer-chevron" aria-hidden="true">›</span>' : ''}</button>`;
        }
        function render() {
            const label = text('添加文件或上下文', 'Add files or context');
            button.removeAttribute('data-dc-i18n-title');
            button.title = label; button.setAttribute('aria-label', label);
            button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
            menu.setAttribute('aria-label', label);
            menu.innerHTML = row('file', text('添加文件', 'Add files')) + row('references', text('引用对话中的文件', 'Files from this chat'))
                + '<div class="dc-context-divider" role="separator"></div>' + row('skills', text('技能', 'Skills')) + row('connectors', text('连接器', 'Connectors'))
                + (document.body.classList.contains('dc-workspace-enabled') ? row('folder', text('选择工作区', 'Choose workspace')) : '') + row('tools', text('浏览工具', 'Browse tools'));
        }
        function closeSub() {
            revision++; current = ''; sub.hidden = true; clearTimeout(hoverTimer);
            menu.querySelectorAll('[aria-expanded]').forEach(item => item.setAttribute('aria-expanded', 'false'));
        }
        function close(focus = false) {
            closeSub(); menu.hidden = true; button.setAttribute('aria-expanded', 'false');
            if (focus) button.focus({ preventScroll: true });
        }
        function position() {
            if (menu.hidden) return;
            const pad = 8, gap = 7, rect = button.getBoundingClientRect(), height = innerHeight, width = innerWidth;
            menu.style.left = `${Math.max(pad, Math.min(rect.left - 7, width - menu.offsetWidth - pad))}px`;
            menu.style.top = `${Math.max(pad, rect.top >= menu.offsetHeight + gap + pad ? rect.top - menu.offsetHeight - gap : Math.min(rect.bottom + gap, height - menu.offsetHeight - pad))}px`;
            if (sub.hidden) return;
            const anchor = menu.querySelector(`[data-composer-action="${current}"]`)?.getBoundingClientRect();
            if (!anchor) return;
            const main = menu.getBoundingClientRect(), sw = sub.offsetWidth;
            const right = main.right + gap, left = main.left - sw - gap;
            const x = right + sw <= width - pad ? right : left >= pad ? left : Math.max(pad, Math.min(main.left, width - sw - pad));
            sub.classList.toggle('is-stacked', x < main.right && x + sw > main.left);
            sub.style.left = `${x}px`;
            sub.style.top = `${Math.max(pad, Math.min(anchor.top - 7, height - sub.offsetHeight - pad))}px`;
        }
        function toggle() {
            if (!menu.hidden) return close(true);
            // Close other composer popovers without changing their selection.
            document.querySelectorAll('.dc-context-picker[open]').forEach(item => item.open = false);
            window.HomeAgentDiscussion?.closePicker?.();
            document.getElementById('dcModelMenu')?.setAttribute('hidden', '');
            document.getElementById('dcModelBtn')?.setAttribute('aria-expanded', 'false');
            window.DragonClawSkills?.closeSuggestions?.();
            render(); menu.hidden = false; button.setAttribute('aria-expanded', 'true'); position();
            menu.querySelector('button')?.focus({ preventScroll: true });
        }
        function filesFromChat() {
            const seen = new Set();
            return [...document.querySelectorAll('#dcThread [data-ai-file]')].flatMap(item => {
                const path = item.dataset.aiFile;
                if (!window.ChatFiles?.isLocalFile(path) || /[<>\r\n]/.test(path) || seen.has(path)) return [];
                seen.add(path);
                return [{ path, name: item.querySelector('.ai-file-chip-name')?.textContent || path.split(/[\\/]/).pop(), missing: item.classList.contains('is-missing') }];
            });
        }
        function subButton(action, label, detail = '') {
            return `<button type="button" data-sub-action="${action}">${glyph('file')}<span><b>${esc(label)}</b>${detail ? `<small>${esc(detail)}</small>` : ''}</span></button>`;
        }
        async function openSub(key, focus = false) {
            if (current === key && !sub.hidden) { if (focus) sub.querySelector('input,button')?.focus(); return; }
            closeSub(); current = key; const turn = revision;
            menu.querySelector(`[data-composer-action="${key}"]`)?.setAttribute('aria-expanded', 'true');
            sub.setAttribute('aria-label', menu.querySelector(`[data-composer-action="${key}"] span`)?.textContent || '');
            sub.innerHTML = `<button type="button" class="dc-composer-back" data-sub-action="back">‹ ${text('返回', 'Back')}</button>`;
            sub.hidden = false;
            if (key === 'file') {
                sub.insertAdjacentHTML('beforeend', subButton('upload', text('从本地添加文件', 'Upload from computer'), text('文档、表格、图片等 · 最多 5 个，每个 20 MB', 'Documents, spreadsheets, images · 5 files, 20 MB each')));
            } else if (key === 'references') {
                const files = filesFromChat();
                const list = document.createElement('div'); list.className = 'dc-composer-options';
                files.forEach(file => {
                    const option = document.createElement('button'); option.type = 'button'; option.disabled = file.missing;
                    option.innerHTML = `${glyph('references')}<span><b>${esc(file.name)}</b><small>${esc(file.missing ? text('文件不可用', 'File unavailable') : file.path)}</small></span>`;
                    option.onclick = () => {
                        // Reference only; access is still checked by the existing file APIs.
                        const link = `[${file.name.replace(/[\[\]\r\n]/g, '')}](<${file.path}>)`;
                        input.value += `${input.value && !/\s$/.test(input.value) ? '\n' : ''}${link} `;
                        close(); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); input.setSelectionRange(input.value.length, input.value.length);
                    };
                    list.append(option);
                });
                if (!files.length) list.innerHTML = `<p class="dc-context-empty">${text('当前对话还没有可引用的文件，可以先从本地添加。', 'No files in this chat yet. Upload a file first.')}</p>`;
                sub.append(list);
            } else if (key === 'skills') {
                if (!input.value.endsWith('@')) {
                    input.value = `${input.value}${input.value && !/\s$/.test(input.value) ? ' ' : ''}@`;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                sub.insertAdjacentHTML('beforeend', `<input type="search" aria-label="${text('搜索技能', 'Search Skills')}" placeholder="${text('搜索技能', 'Search Skills')}"><div class="dc-composer-options" aria-live="polite"><p class="dc-context-empty">${text('正在加载…', 'Loading…')}</p></div><div class="dc-context-divider" role="separator"></div>${subButton('manage', text('管理技能', 'Manage Skills'))}`);
                position(); if (focus) sub.querySelector('input')?.focus();
                try {
                    const items = await window.DragonClawSkills.catalog();
                    if (turn !== revision || menu.hidden) return;
                    const search = sub.querySelector('input'), list = sub.querySelector('.dc-composer-options');
                    const filter = () => {
                        const query = search.value.trim().toLowerCase(); list.replaceChildren();
                        items.filter(item => [item.id, item.name, item.nameEn, item.description, item.descriptionEn].some(value => String(value || '').toLowerCase().includes(query))).forEach(item => {
                            const option = document.createElement('button'); option.type = 'button'; option.className = 'dc-composer-skill-option dc-skill-option'; option.dataset.composerSkill = item.id;
                            const name = en() ? item.nameEn || item.name : item.name;
                            option.innerHTML = `${glyph('skills')}<span><b>${esc(name || item.id)}</b><small>${esc((en() ? item.descriptionEn || item.description : item.description) || `@${item.id}`)}</small></span>`;
                            option.onclick = () => { close(); window.DragonClawSkills.use(item.id); }; list.append(option);
                        });
                        if (!list.children.length) list.innerHTML = `<p class="dc-context-empty">${text('没有匹配的技能', 'No matching Skills')}</p>`;
                        position();
                    };
                    search.addEventListener('input', filter); filter();
                } catch {
                    if (turn === revision) sub.querySelector('.dc-composer-options').innerHTML = `<p class="dc-context-empty">${text('加载失败，请重试', 'Could not load. Please retry.')}</p><button type="button" data-sub-action="retry">${text('重新加载', 'Retry')}</button>`;
                }
            }
            position(); if (focus && key !== 'skills') sub.querySelector('.dc-composer-options button,button:not(.dc-composer-back)')?.focus();
        }
        menu.addEventListener('click', event => {
            const action = event.target.closest('[data-composer-action]')?.dataset.composerAction;
            if (!action) return;
            if (hasSub(action)) { openSub(action, true); return; }
            close();
            if (action === 'connectors') window.HomeAgentDiscussion?.openPicker?.();
            if (action === 'folder') window.DragonClawWorkspace?.openPicker?.();
            if (action === 'tools') window.HomeMode?.set?.('tools', { focus: true });
        });
        menu.addEventListener('pointerover', event => {
            const item = event.target.closest('[data-composer-action]'); if (!item || event.pointerType === 'touch') return;
            clearTimeout(hoverTimer);
            if (hasSub(item.dataset.composerAction)) hoverTimer = setTimeout(() => openSub(item.dataset.composerAction), 100);
            else closeSub();
        });
        menu.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
        sub.addEventListener('click', event => {
            const action = event.target.closest('[data-sub-action]')?.dataset.subAction;
            if (action === 'back') { const key = current; closeSub(); menu.querySelector(`[data-composer-action="${key}"]`)?.focus(); }
            if (action === 'retry') { closeSub(); openSub('skills', true); }
            if (action === 'upload') { close(); button.focus(); document.getElementById('dcAttachInput')?.click(); }
            if (action === 'manage') { close(); window.HomeSkillHub?.open?.('skills'); }
        });
        for (const surface of [menu, sub]) surface.addEventListener('keydown', event => {
            const item = event.target.closest('[data-composer-action]');
            if (surface === menu && event.key === 'ArrowRight' && hasSub(item?.dataset.composerAction)) { event.preventDefault(); openSub(item.dataset.composerAction, true); return; }
            if (surface === sub && (event.key === 'ArrowLeft' && event.target.tagName !== 'INPUT' || event.key === 'Escape')) {
                event.preventDefault(); event.stopPropagation(); const key = current; closeSub(); menu.querySelector(`[data-composer-action="${key}"]`)?.focus(); return;
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target.tagName !== 'INPUT' || ['ArrowDown','ArrowUp'].includes(event.key))) {
                const options = [...surface.querySelectorAll('button:not(:disabled)')].filter(item => item.getClientRects().length), index = options.indexOf(document.activeElement);
                event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                options[next]?.focus();
            }
            if (event.key === 'Tab') close();
        });
        document.addEventListener('click', event => {
            // render() replaces the clicked SVG. Its original event path still includes the button.
            const path = event.composedPath();
            if (![menu, sub, button].some(node => path.includes(node))) close();
        });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); close(true); } });
        window.addEventListener('resize', position);
        document.addEventListener('scroll', event => { if (!menu.contains(event.target) && !sub.contains(event.target)) position(); }, true);
        form.addEventListener('submit', () => close());
        window.addEventListener('tools:languagechange', () => { close(); render(); });
        for (const name of ['home:chat-state', 'home:mode', 'home:external', 'home:hub']) window.addEventListener(name, () => close());
        window.HomeComposer = { toggle, close, isOpen: () => !menu.hidden };
        render();
        initPromptControls(form, input);
    }
    function initPromptControls(form, input) {
        const enhance = document.getElementById('dcEnhance'), voice = document.getElementById('dcVoice'), send = document.getElementById('dcSend');
        if (!enhance || !voice || !send) return;
        const sparkle = enhance.innerHTML;
        const restore = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6a6 6 0 1 1-1 7M5 2v5h5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        let controller = null, undo = null, replacing = false, epoch = 0;
        const en = () => window.ToolsI18n?.getLanguage?.() === 'en-US';
        const text = (zh, english) => en() ? english : zh;
        const toast = message => window.DragonClawText?.toast?.(message);
        function sync() {
            const generating = form.classList.contains('is-generating');
            enhance.hidden = !input.value.trim();
            enhance.disabled = !!controller || generating || input.disabled || (!undo && (/^\s*\//.test(input.value) || input.value.length > 8000));
            const label = controller ? text('增强中…', 'Enhancing…') : undo ? text('恢复原文', 'Restore original') : text('增强提示词', 'Enhance prompt');
            enhance.dataset.tooltip = label; enhance.setAttribute('aria-label', label); enhance.setAttribute('aria-busy', String(!!controller));
            enhance.classList.toggle('is-loading', !!controller);
            enhance.innerHTML = controller ? '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="25 13"/></svg>' : undo ? restore : sparkle;
            window.ChatVoiceInput?.refresh?.();
            send.dataset.tooltip = generating ? text('停止生成', 'Stop generating') : text('Enter 发送 · Shift+Enter 换行', 'Enter to send · Shift+Enter for a new line');
        }
        function cancel() { epoch++; controller?.abort(); controller = null; sync(); }
        function replace(value) {
            replacing = true;
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            replacing = false;
            input.focus({ preventScroll: true }); input.setSelectionRange(value.length, value.length);
        }
        enhance.addEventListener('click', async () => {
            if (enhance.disabled) return;
            if (undo) { const original = undo.before; undo = null; replace(original); sync(); return; }
            const before = input.value, turn = ++epoch;
            const request = new AbortController(); controller = request; sync();
            const timeout = setTimeout(() => request.abort(), 35000);
            try {
                const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
                const response = await fetch('/api/ai/enhance-prompt', { method: 'POST', credentials: 'same-origin', signal: request.signal,
                    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify({ text: before, modelId: document.getElementById('dcModel')?.dataset.modelId || '', uiLanguage: en() ? 'en' : 'zh' }) });
                const data = await response.json().catch(() => ({}));
                if (turn !== epoch || input.value !== before) return;
                if (!response.ok) throw new Error(data.error || text('增强失败，原文已保留', 'Enhancement failed. Your draft is unchanged.'));
                if (typeof data.prompt !== 'string' || !data.prompt.trim()) throw new Error(text('增强结果为空，原文已保留', 'Empty result. Your draft is unchanged.'));
                undo = { before, after: data.prompt }; replace(data.prompt);
                toast(text('已增强提示词，可恢复原文', 'Prompt enhanced. You can restore the original.'));
            } catch (error) {
                if (turn === epoch) toast(error.name === 'AbortError' ? text('增强已取消或超时，原文已保留', 'Enhancement cancelled or timed out. Your draft is unchanged.') : error.message);
            } finally {
                clearTimeout(timeout);
                if (turn === epoch) { controller = null; sync(); }
            }
        });
        input.addEventListener('input', () => { if (!replacing) { undo = null; if (controller) cancel(); } sync(); });
        form.addEventListener('submit', () => { cancel(); undo = null; sync(); }, true);
        document.getElementById('dcNewChat')?.addEventListener('click', () => { cancel(); undo = null; sync(); });
        window.addEventListener('home:chat-state', () => { cancel(); undo = null; sync(); });
        window.addEventListener('home:mode', cancel);
        window.addEventListener('tools:languagechange', sync);
        new MutationObserver(sync).observe(form, { attributes: true, attributeFilter: ['class'] });
        sync();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
