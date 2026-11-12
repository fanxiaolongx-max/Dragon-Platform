// A bounded index of loaded questions, shared by local, desktop and channel chats.
(function () {
    'use strict';
    const MAX_QUESTIONS = 100;
    function init() {
        const thread = document.getElementById('dcThread');
        if (!thread) return;
        const rail = document.createElement('nav');
        rail.className = 'conversation-rail';
        rail.hidden = true;
        const preview = document.createElement('div');
        preview.className = 'conversation-rail-preview';
        preview.hidden = true;
        preview.id = 'conversationRailPreview';
        preview.setAttribute('role', 'tooltip');
        document.body.append(rail, preview);
        let questions = [], buttons = [], active = -1, shown = -1, frame = 0, timer = 0, hovered = false;
        const english = () => window.ToolsI18n?.getLanguage?.() === 'en-US';
        function label() {
            rail.setAttribute('aria-label', english() ? 'Conversation navigation · Latest 100 loaded questions' : '对话导航 · 最多最近 100 个已加载提问');
        }
        function dismiss() {
            shown = -1;
            preview.hidden = true;
            buttons.forEach(button => button.style.removeProperty('--rail-scale'));
        }
        function show(index) {
            const button = buttons[index];
            if (!button) return;
            shown = index;
            const box = button.getBoundingClientRect();
            const boundary = thread.getBoundingClientRect();
            preview.textContent = button.getAttribute('aria-label');
            preview.hidden = false;
            preview.style.left = `${box.right + 10}px`;
            preview.style.maxWidth = `${Math.max(100, Math.min(320, boundary.right - box.right - 24))}px`;
            preview.style.top = `${Math.max(boundary.top + 8, Math.min(box.top - 18, boundary.bottom - preview.offsetHeight - 8))}px`;
            buttons.forEach((item, at) => item.style.setProperty('--rail-scale', String(1 + 2 * Math.exp(-Math.abs(at - index) / 1.7))));
        }
        function jump(index) {
            const target = questions[index];
            if (!target?.isConnected) return;
            const box = thread.getBoundingClientRect();
            thread.scrollTo({ top: thread.scrollTop + target.getBoundingClientRect().top - box.top - 24,
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }
        function update() {
            if (frame) { cancelAnimationFrame(frame); frame = 0; }
            const box = thread.getBoundingClientRect();
            const visible = questions.length >= 2 && box.width > 0 && box.height >= 100 && thread.getClientRects().length > 0;
            let next = 0;
            if (visible) {
                const threshold = box.top + box.height * .35;
                questions.forEach((question, index) => { if (question.getBoundingClientRect().top <= threshold) next = index; });
            }
            rail.hidden = !visible;
            if (!visible) { dismiss(); return; }
            rail.style.left = `${box.left + 3}px`;
            rail.style.top = `${box.top + box.height / 2}px`;
            rail.style.maxHeight = `${Math.min(240, box.height - 48)}px`;
            buttons.forEach((button, index) => {
                button.classList.toggle('is-active', index === next);
                if (index === next) button.setAttribute('aria-current', 'true');
                else button.removeAttribute('aria-current');
            });
            if (active !== next && !hovered && !rail.contains(document.activeElement)) {
                rail.scrollTop = Math.max(0, buttons[next].offsetTop - rail.clientHeight / 2);
            }
            active = next;
            if (shown >= 0 && !preview.hidden) show(shown);
        }
        function schedule() { if (!frame) frame = requestAnimationFrame(update); }
        function rebuild() {
            const next = [...thread.querySelectorAll('.dc-msg--user')].slice(-MAX_QUESTIONS);
            if (next.length === questions.length && next.every((node, index) => node === questions[index])) { schedule(); return; }
            dismiss();
            questions = next;
            active = -1;
            buttons = questions.map((question, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                const text = (question.querySelector('.dc-msg-body')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
                button.setAttribute('aria-label', `${index + 1}. ${text || (english() ? 'Attachment' : '附件消息')}`);
                button.setAttribute('aria-describedby', preview.id);
                button.appendChild(document.createElement('i'));
                button.addEventListener('pointerenter', () => show(index));
                button.addEventListener('focus', () => show(index));
                button.addEventListener('blur', dismiss);
                button.addEventListener('click', () => jump(index));
                button.addEventListener('keydown', event => {
                    let at;
                    if (event.key === 'ArrowDown') at = Math.min(buttons.length - 1, index + 1);
                    if (event.key === 'ArrowUp') at = Math.max(0, index - 1);
                    if (event.key === 'Home') at = 0;
                    if (event.key === 'End') at = buttons.length - 1;
                    if (at !== undefined) { event.preventDefault(); buttons[at].focus({ preventScroll: true }); rail.scrollTop = buttons[at].offsetTop - rail.clientHeight / 2; show(at); }
                    if (event.key === 'Escape') { dismiss(); button.blur(); }
                });
                return button;
            });
            rail.replaceChildren(...buttons);
            schedule();
        }
        rail.addEventListener('pointerenter', () => { hovered = true; });
        rail.addEventListener('pointerleave', () => { hovered = false; dismiss(); });
        rail.addEventListener('scroll', () => {
            const index = buttons.indexOf(document.activeElement);
            if (index >= 0) show(index);
            else dismiss();
        }, { passive: true });
        thread.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', update);
        window.addEventListener('dragon-claw:sidebar-layout', update);
        window.addEventListener('scroll', schedule, { passive: true, capture: true });
        // Update synchronously before paint when layout containers resize or shift.
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(thread);
        for (const container of [thread.closest('.home-main'), document.querySelector('.home-sidebar')]) {
            if (container && container !== thread) resizeObserver.observe(container);
        }
        // Coalesce streaming DOM updates. Never request or load older history here.
        new MutationObserver(() => { if (!timer) timer = setTimeout(() => { timer = 0; rebuild(); }, 100); }).observe(thread, { childList: true, subtree: true });
        new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('tools:languagechange', () => { label(); questions = []; rebuild(); });
        label(); rebuild();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
