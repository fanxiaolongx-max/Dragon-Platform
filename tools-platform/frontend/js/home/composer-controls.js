// The + menu routes to existing file, Skill and workspace workflows.
(function () {
    'use strict';
    function init() {
        if (document.documentElement.dataset.ui !== 'v2') return;
        const button = document.getElementById('dcAttach'), form = document.getElementById('dcComposer'), input = document.getElementById('dcInput');
        if (!button || !form || !input) return;
        const menu = document.createElement('div');
        menu.id = 'dcAttachMenu'; menu.className = 'dc-composer-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
        form.append(menu);
        button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', menu.id); button.setAttribute('aria-expanded', 'false');
        const en = () => window.ToolsI18n?.getLanguage?.() === 'en-US';
        const text = (zh, english) => en() ? english : zh;
        const icon = name => ({ file: '<path d="M14 8 8 14a3 3 0 0 1-4-4l7-7a2 2 0 0 1 3 3l-7 7"/>', skills: '<path d="m10 2 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z"/>', folder: '<path d="M2 5h6l2 2h8v10H2V5Z"/>', tools: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>' }[name]);
        function render() {
            const label = text('添加文件或上下文', 'Add files or context');
            button.title = label; button.setAttribute('aria-label', label);
            button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
            menu.setAttribute('aria-label', label);
            const entries = [['file', text('添加文件', 'Add files')], ['skills', text('使用技能', 'Use a Skill')], ...(document.body.classList.contains('dc-workspace-enabled') ? [['folder', text('选择工作区', 'Choose workspace')]] : []), ['tools', text('浏览工具', 'Browse tools')]];
            menu.innerHTML = entries.map(([key, label]) => `<button type="button" role="menuitem" data-composer-action="${key}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon(key)}</svg><span>${label}</span>${key === 'skills' ? '<kbd>@</kbd>' : ''}</button>`).join('');
        }
        function close(focus = false) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus(); }
        function toggle() {
            if (!menu.hidden) return close(true);
            render(); menu.hidden = false; button.setAttribute('aria-expanded', 'true');
            const top = button.offsetTop - menu.offsetHeight - 8;
            menu.style.top = `${Math.max(-menu.offsetHeight - 8, top)}px`;
            menu.querySelector('button')?.focus();
        }
        menu.addEventListener('click', event => {
            const action = event.target.closest('[data-composer-action]')?.dataset.composerAction;
            if (!action) return;
            close();
            if (action === 'file') { button.focus(); document.getElementById('dcAttachInput').click(); }
            if (action === 'skills') {
                input.value = `${input.value}${input.value && !/\s$/.test(input.value) ? ' ' : ''}@`;
                input.focus(); input.setSelectionRange(input.value.length, input.value.length);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (action === 'folder') window.DragonClawWorkspace?.openPicker?.();
            if (action === 'tools') window.HomeMode?.set?.('tools', { focus: true });
        });
        menu.addEventListener('keydown', event => {
            const buttons = [...menu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
            }
            if (event.key === 'Tab') close();
        });
        document.addEventListener('click', event => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); close(true); } });
        form.addEventListener('submit', () => close());
        window.addEventListener('tools:languagechange', render);
        window.addEventListener('home:chat-state', () => close());
        window.HomeComposer = { toggle, close };
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
            voice.dataset.tooltip = text('语音输入 · 即将支持', 'Voice input · Coming soon');
            voice.setAttribute('aria-label', voice.dataset.tooltip);
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
        voice.addEventListener('click', () => toast(text('语音输入即将支持，目前请使用键盘输入', 'Voice input is coming soon. Please type for now.')));
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
