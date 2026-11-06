// Return to the latest message in the shared local / desktop / channel timeline.
(function () {
    'use strict';
    function init() {
        const thread = document.getElementById('dcThread');
        if (!thread) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'conversation-bottom';
        button.setAttribute('aria-controls', 'dcThread');
        button.hidden = true;
        button.innerHTML = '<span class="conversation-bottom-dots" aria-hidden="true"><i></i><i></i><i></i></span><svg class="conversation-bottom-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15m-6-6 6 6 6-6"/></svg>';
        document.body.append(button);
        let frame = 0, settleTimer = 0;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        function update() {
            frame = 0;
            const box = thread.getBoundingClientRect();
            const gap = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
            button.hidden = !thread.getClientRects().length || box.width < 40 || box.height < 100 || gap <= 80;
            const busy = Boolean(thread.querySelector('.dc-msg[aria-busy="true"], .dc-msg.is-streaming, .desktop-agent-thinking'));
            button.classList.toggle('is-working', busy);
            const english = window.ToolsI18n?.getLanguage?.() === 'en-US';
            const label = busy
                ? (english ? 'Thinking or replying · Back to latest message' : '正在思考或输出 · 回到最新消息')
                : (english ? 'Back to latest message' : '回到最新消息');
            button.setAttribute('aria-label', label);
            button.title = label;
            if (button.hidden) return;
            button.style.left = `${box.left + box.width / 2}px`;
            button.style.top = `${box.bottom - 48}px`;
        }
        function schedule() { if (!frame) frame = requestAnimationFrame(update); }
        function cancelReturn() { clearTimeout(settleTimer); settleTimer = 0; }
        button.addEventListener('click', () => {
            cancelReturn();
            thread.scrollTo({ top: thread.scrollHeight, behavior: reduced.matches ? 'instant' : 'smooth' });
            // Include text received during the smooth trip. A manual scroll cancels this.
            if (!reduced.matches) settleTimer = setTimeout(() => {
                settleTimer = 0;
                if (thread.getClientRects().length) thread.scrollTo({ top: thread.scrollHeight, behavior: 'instant' });
            }, 700);
        });
        for (const event of ['wheel', 'touchstart', 'pointerdown']) thread.addEventListener(event, cancelReturn, { passive: true });
        document.addEventListener('keydown', event => {
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelReturn();
        });
        thread.addEventListener('scroll', schedule, { passive: true });
        thread.addEventListener('load', schedule, true);
        thread.addEventListener('toggle', schedule, true);
        new MutationObserver(() => {
            // A new timeline must never inherit a pending return from the previous chat.
            if (!thread.querySelector('.dc-msg')) cancelReturn();
            schedule();
        }).observe(thread, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-busy'] });
        new ResizeObserver(schedule).observe(thread);
        new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        for (const event of ['resize', 'tools:languagechange']) window.addEventListener(event, schedule);
        window.addEventListener('scroll', schedule, { passive: true, capture: true });
        window.addEventListener('home:chat-state', () => { cancelReturn(); schedule(); });
        window.addEventListener('home:channel-thread', () => { cancelReturn(); schedule(); });
        schedule();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
