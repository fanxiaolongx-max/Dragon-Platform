// Personal sidebar layout. The live navigation buttons keep their existing actions and badges.
(function () {
    'use strict';
    const entries = [
        ['channels', 'channels', '频道会话', 'Channels'],
        ['skillHub', 'puzzle', '技能·插件·工具', 'Skills · plugins'],
        ['schedule', 'alarm', '定时任务', 'Scheduled'],
        ['library', 'book', '资料库', 'Library'],
        ['opsDrafts', 'inbox', '运维待办', 'Ops drafts'],
        ['links', 'link', '友情链接', 'Links'],
        ['requirements', 'target', '需求管理', 'Requirements'],
        ['promotions', 'compass', '平台推广', 'Promotions']
    ];
    const defaults = () => ({ primary: entries.slice(0, 5).map(item => item[0]), more: entries.slice(5).map(item => item[0]) });
    const L = (zh, en) => window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh;
    const label = id => { const item = entries.find(item => item[0] === id); return L(item[2], item[3]); };
    const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let layout = defaults(), draft, nav, moreButton, stash, overlay, loaded = false, pending = null, busy = false, dragging = null, suppressDragClick = false;
    const buttons = new Map();

    async function request(method, body) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        const response = await fetch('/api/sidebar-menu', {
            method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        const ids = [...(data.primary || []), ...(data.more || [])];
        if (!Array.isArray(data.primary) || !Array.isArray(data.more) || ids.length !== entries.length
            || new Set(ids).size !== entries.length || ids.some(id => !buttons.has(id))) throw new Error(L('服务器返回的菜单配置无效', 'Invalid menu configuration from the server'));
        return data;
    }
    function restoreMore() {
        if (!stash) return;
        layout.more.forEach(id => stash.append(buttons.get(id)));
    }
    function applyLayout() {
        window.HomeV2?.closePop();
        layout.primary.forEach(id => {
            const button = buttons.get(id);
            button.classList.remove('v2-pop-item'); button.removeAttribute('role');
            button.querySelector('.v2-pop-hint')?.remove();
            nav.insertBefore(button, moreButton);
        });
        layout.more.forEach(id => {
            const button = buttons.get(id);
            button.classList.add('v2-pop-item'); button.setAttribute('role', 'menuitem');
            stash.append(button);
        });
        window.HomeV2?.updateChannelsNavState();
    }
    function mountMore(host) {
        if (host) layout.more.forEach(id => host.append(buttons.get(id)));
    }
    function load() {
        if (pending) return pending;
        pending = request('GET').then(data => { layout = data; loaded = true; applyLayout(); })
            .finally(() => { pending = null; });
        return pending;
    }
    function status(text, error = false) {
        const node = overlay.querySelector('[data-menu-status]');
        node.textContent = text; node.classList.toggle('is-error', error);
    }
    function setBusy(value) {
        busy = value;
        overlay.querySelector('fieldset').disabled = value;
        overlay.querySelectorAll('[data-menu-close], [data-menu-save], [data-menu-reset]').forEach(button => { button.disabled = value; });
        overlay.querySelector('[data-menu-save]').disabled = value || !loaded;
    }
    function renderLists(focusId) {
        for (const group of ['primary', 'more']) {
            overlay.querySelector(`[data-menu-list="${group}"]`).innerHTML = draft[group].map((id, index) => {
                const item = entries.find(item => item[0] === id);
                return `<div class="v2-menu-row" data-menu-id="${id}">
                    <span class="v2-ico" data-icon="${item[1]}"></span><span class="v2-menu-label">${esc(label(id))}</span>
                    <span class="v2-menu-actions">
                        <button type="button" data-menu-move="up" aria-label="${esc(label(id) + ' · ' + L('上移', 'Move up'))}" ${index === 0 ? 'disabled' : ''}>↑</button>
                        <button type="button" data-menu-move="down" aria-label="${esc(label(id) + ' · ' + L('下移', 'Move down'))}" ${index === draft[group].length - 1 ? 'disabled' : ''}>↓</button>
                        <button type="button" data-menu-move="group" aria-label="${esc(label(id) + ' · ' + (group === 'primary' ? L('移到更多', 'Move to More') : L('移到一级菜单', 'Move to main menu')))}">${group === 'primary' ? '−' : '+'}</button>
                    </span>
                    <button type="button" class="v2-menu-handle" data-menu-handle aria-label="${esc(label(id) + ' · ' + L('拖动排序，方向键调整位置', 'Drag to reorder, or use arrow keys'))}">⠿</button>
                </div>`;
            }).join('');
        }
        window.HomeV2?.fillIcons(overlay);
        if (focusId) overlay.querySelector(`[data-menu-id="${focusId}"] [data-menu-handle]`)?.focus();
    }
    function move(id, action) {
        const group = draft.primary.includes(id) ? 'primary' : 'more';
        const list = draft[group], index = list.indexOf(id);
        if (action === 'group') { list.splice(index, 1); draft[group === 'primary' ? 'more' : 'primary'].push(id); }
        else {
            const next = index + (action === 'up' ? -1 : 1);
            if (next < 0 || next >= list.length) return;
            [list[index], list[next]] = [list[next], list[index]];
        }
        renderLists(id);
    }
    function close() {
        if (busy || dragging) return;
        overlay.remove(); overlay = null; moreButton.focus();
    }
    function animateReorder(change) {
        const rows = [...overlay.querySelectorAll('[data-menu-id]')].filter(row => row !== dragging.row);
        const before = new Map(rows.map(row => [row, row.getBoundingClientRect()]));
        dragging.animations.forEach(animation => animation.cancel());
        dragging.animations.clear();
        change();
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        for (const row of rows) {
            const after = row.getBoundingClientRect(), previous = before.get(row);
            const x = previous.left - after.left, y = previous.top - after.top;
            if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
            const animation = row.animate([
                { transform: `translate3d(${x}px, ${y}px, 0)` }, { transform: 'none' }
            ], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
            dragging.animations.set(row, animation);
        }
    }
    function updateDrag() {
        const drag = dragging;
        drag.preview.style.transform = `translate3d(${drag.x - drag.startX}px, ${drag.y - drag.startY}px, 0)`;
        const scroll = overlay.querySelector('fieldset'), bounds = scroll.getBoundingClientRect();
        if (drag.y > bounds.top && drag.y < bounds.bottom) {
            if (drag.y < bounds.top + 40) scroll.scrollTop -= Math.ceil((bounds.top + 40 - drag.y) / 4);
            if (drag.y > bounds.bottom - 40) scroll.scrollTop += Math.ceil((drag.y - bounds.bottom + 40) / 4);
        }
        const list = [...overlay.querySelectorAll('[data-menu-list]')].find(node => {
            const rect = node.getBoundingClientRect();
            return drag.x >= rect.left && drag.x <= rect.right && drag.y >= Math.max(rect.top, bounds.top) && drag.y <= Math.min(rect.bottom, bounds.bottom);
        });
        if (!list) return;
        // Use layout positions, so the yielding animation cannot trigger another reorder.
        const top = list.getBoundingClientRect().top + list.clientTop;
        const before = [...list.children].find(row => row !== drag.row && drag.y < top + row.offsetTop + row.offsetHeight / 2) || null;
        if (drag.row.parentElement !== list || drag.row.nextElementSibling !== before) {
            animateReorder(() => list.insertBefore(drag.row, before));
        }
    }
    function dragFrame() {
        if (!dragging || dragging.dropping) return;
        updateDrag();
        dragging.frame = requestAnimationFrame(dragFrame);
    }
    function clearDrag(drag) {
        cancelAnimationFrame(drag.frame);
        drag.animations.forEach(animation => animation.cancel());
        drag.preview.remove();
        dragging = null;
        overlay.classList.remove('is-sorting');
        if (overlay.hasPointerCapture(drag.pointerId)) overlay.releasePointerCapture(drag.pointerId);
        renderLists(drag.id);
        suppressDragClick = true;
        setTimeout(() => { suppressDragClick = false; }, 0);
    }
    function cancelDrag() {
        if (!dragging) return;
        const drag = dragging;
        draft = drag.original;
        clearDrag(drag);
    }
    async function finishDrag(event) {
        if (!dragging || dragging.dropping || event.pointerId !== dragging.pointerId) return;
        if (event.type !== 'pointerup') { cancelDrag(); return; }
        updateDrag();
        const drag = dragging;
        drag.dropping = true;
        cancelAnimationFrame(drag.frame);
        for (const group of ['primary', 'more']) draft[group] = [...overlay.querySelectorAll(`[data-menu-list="${group}"] [data-menu-id]`)].map(row => row.dataset.menuId);
        if (overlay.hasPointerCapture(drag.pointerId)) overlay.releasePointerCapture(drag.pointerId);
        const target = drag.row.getBoundingClientRect();
        const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140;
        try {
            await drag.preview.animate([
                { transform: drag.preview.style.transform },
                { transform: `translate3d(${target.left - drag.left}px, ${target.top - drag.top}px, 0)` }
            ], { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished;
        } catch { /* A cancelled drag is cleaned up below. */ }
        if (dragging === drag) clearDrag(drag);
    }
    function createDialog() {
        overlay = document.createElement('div'); overlay.className = 'v2-menu-overlay';
        overlay.innerHTML = `<section class="v2-menu-dialog" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sidebarMenuTitle">
            <header><h2 id="sidebarMenuTitle">${L('自定义菜单栏', 'Customize menu')}</h2><button type="button" data-menu-close aria-label="${L('关闭', 'Close')}">×</button></header>
            <p class="v2-menu-hint">${L('拖动调整顺序，或在两组之间移动。配置按当前账号保存到服务器。', 'Drag to reorder or move between groups. Your layout is saved to your account on the server.')}</p>
            <fieldset aria-label="${L('菜单配置', 'Menu layout')}">
                <section><h3>${L('一级菜单', 'Main menu')}</h3><div class="v2-menu-row is-fixed"><span class="v2-ico" data-icon="chatPlus"></span><span class="v2-menu-label">${L('新建对话', 'New chat')}</span><small>${L('固定', 'Fixed')}</small></div><div class="v2-menu-list" data-menu-list="primary"></div></section>
                <section><h3>${L('更多', 'More')}</h3><div class="v2-menu-list" data-menu-list="more"></div></section>
            </fieldset><div class="v2-menu-status" role="status" aria-live="polite" data-menu-status></div>
            <footer><button type="button" data-menu-reset>${L('恢复默认', 'Reset')}</button><span></span><button type="button" data-menu-close>${L('取消', 'Cancel')}</button><button type="button" class="is-primary" data-menu-save>${L('保存', 'Save')}</button></footer>
        </section>`;
        document.body.append(overlay);
        overlay.addEventListener('click', event => {
            if (dragging || suppressDragClick) { event.preventDefault(); return; }
            if (event.target === overlay || event.target.closest('[data-menu-close]')) { close(); return; }
            if (event.target.closest('[data-menu-reset]') && !busy) { draft = defaults(); renderLists(); return; }
            const action = event.target.closest('[data-menu-move]');
            if (action && !busy) move(action.closest('[data-menu-id]').dataset.menuId, action.dataset.menuMove);
            if (event.target.closest('[data-menu-save]')) void save();
        });
        overlay.addEventListener('keydown', event => {
            if (dragging) {
                event.preventDefault(); event.stopPropagation();
                if (event.key === 'Escape') cancelDrag();
                return;
            }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
            const handle = event.target.closest('[data-menu-handle]');
            if (handle && !busy && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                move(handle.closest('[data-menu-id]').dataset.menuId, event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : 'group');
            }
            if (event.key === 'Tab') {
                const nodes = [...overlay.querySelectorAll('button:not(:disabled)')];
                if (!nodes.length) { event.preventDefault(); overlay.querySelector('[role=dialog]').focus(); return; }
                const first = nodes[0], last = nodes.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });
        overlay.addEventListener('pointerdown', event => {
            if (busy || dragging || event.button !== 0 || !event.target.closest('[data-menu-handle]')) return;
            event.preventDefault();
            const row = event.target.closest('[data-menu-id]'), rect = row.getBoundingClientRect();
            const preview = row.cloneNode(true);
            preview.removeAttribute('data-menu-id'); preview.classList.add('v2-menu-drag-preview');
            preview.setAttribute('aria-hidden', 'true'); preview.inert = true;
            preview.style.font = getComputedStyle(row).font;
            preview.style.color = getComputedStyle(row).color;
            Object.assign(preview.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
            overlay.append(preview);
            dragging = { id: row.dataset.menuId, row, preview, pointerId: event.pointerId,
                startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
                left: rect.left, top: rect.top, original: structuredClone(draft), animations: new Map(), dropping: false, frame: 0 };
            row.classList.add('is-dragging'); overlay.classList.add('is-sorting');
            overlay.setPointerCapture(event.pointerId);
            dragFrame();
        });
        overlay.addEventListener('pointermove', event => {
            if (!dragging || dragging.dropping || event.pointerId !== dragging.pointerId) return;
            event.preventDefault();
            dragging.x = event.clientX; dragging.y = event.clientY;
        });
        overlay.addEventListener('pointerup', finishDrag);
        overlay.addEventListener('pointercancel', finishDrag);
        overlay.addEventListener('lostpointercapture', finishDrag);
    }
    async function open() {
        window.HomeV2?.closePop();
        if (overlay) return;
        createDialog();
        draft = structuredClone(layout); renderLists();
        overlay.querySelector('[data-menu-close]').focus();
        if (!loaded) {
            setBusy(true); status(L('正在读取服务器配置…', 'Loading your saved layout…'));
            try { await load(); draft = structuredClone(layout); renderLists(); status(''); }
            catch { status(L('读取失败，请关闭后重新打开重试。', 'Could not load. Close and reopen to retry.'), true); }
            finally { setBusy(false); }
        }
    }
    async function save() {
        if (busy || !loaded || dragging) return;
        setBusy(true); status(L('正在保存…', 'Saving…'));
        try {
            layout = await request('PUT', draft); applyLayout();
            setBusy(false); close();
            window.showToast?.(L('菜单配置已保存到服务器', 'Menu layout saved to the server'));
        } catch { setBusy(false); status(L('保存失败，调整仍保留在此窗口，请重试。', 'Could not save. Your changes are still here. Try again.'), true); }
    }
    function init() {
        nav = document.querySelector('#homeSidebar .v2-nav');
        moreButton = nav?.querySelector('[data-v2-flyout="more"]');
        if (!moreButton) return;
        stash = document.createElement('div'); stash.hidden = true; nav.after(stash);
        for (const [id, icon, zh, en] of entries) {
            let button = nav.querySelector(`[data-v2-action="${id}"]`);
            if (!button) {
                button = document.createElement('button'); button.type = 'button'; button.className = 'v2-nav-item'; button.dataset.v2Action = id;
                button.innerHTML = `<span class="v2-ico" data-icon="${icon}"></span><span class="v2-menu-nav-label">${esc(L(zh, en))}</span>`;
            }
            button.dataset.v2Do = id;
            if (id === 'links') { button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', 'v2LinksSubmenu'); }
            buttons.set(id, button);
        }
        applyLayout(); window.HomeV2?.fillIcons(document);
        void load().catch(() => {});
    }
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('tools:languagechange', () => {
        buttons.forEach((button, id) => { const node = button.querySelector('.v2-menu-nav-label'); if (node) node.textContent = label(id); });
    });
    window.HomeSidebarMenu = { open, mountMore, restoreMore };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
