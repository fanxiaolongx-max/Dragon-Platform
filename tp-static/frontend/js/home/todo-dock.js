// 任务清单：进行中的清单停靠在输入框正上方（可折叠），完成或结束后收回到消息里。
// 停靠区是对话区与输入框之间的普通 flex 子项，展开/收起只会让对话区变矮，不覆盖回答。
(function () {
    'use strict';
    const COLLAPSE_KEY = 'dragon_claw_todo_dock_collapsed';
    const english = () => /^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '');
    const L = (zh, en) => english() ? en : zh;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.3 5 8.6l4.4-5"/></svg>';
    let dock = null, owner = null, ownerBox = null, hideTimer = null, observer = null;

    function readCollapsed() { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } }
    function saveCollapsed(value) { try { localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0'); } catch {} }

    // 按位置复用列表项：状态变化只改 class，划线与打勾才会以过渡动画呈现。
    function renderList(list, items) {
        const same = list.children.length === items.length && items.every((item, index) => list.children[index].dataset.content === String(item.content));
        if (!same) {
            list.innerHTML = items.map(item => `<li data-content="${esc(item.content)}"><span class="dc-todo-mark" aria-hidden="true">${CHECK}<i></i></span><span class="dc-todo-text"><span>${esc(item.content)}</span></span></li>`).join('');
        }
        items.forEach((item, index) => {
            const li = list.children[index], status = ['completed', 'in_progress'].includes(item.status) ? item.status : 'pending';
            if (!same) li.className = `is-${status} is-instant`;
            else li.className = `is-${status}`;
        });
        if (!same) requestAnimationFrame(() => list.querySelectorAll('.is-instant').forEach(li => li.classList.remove('is-instant')));
    }

    function ensureDock() {
        if (dock?.isConnected) return dock;
        const composer = document.getElementById('dcComposer');
        if (!composer) return null;
        dock = document.createElement('section');
        dock.className = 'dc-todo-dock';
        dock.setAttribute('aria-live', 'polite');
        dock.innerHTML = `<div class="dc-todo-dock-inner"><div class="dc-todo-dock-card">
            <button type="button" class="dc-todo-dock-head" aria-expanded="true">
                <svg class="dc-todo-dock-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>
                <b class="dc-todo-dock-title"></b><span class="dc-todo-dock-current"></span><span class="dc-todo-dock-count"></span>
            </button>
            <div class="dc-todo-dock-progress" aria-hidden="true"><i></i></div>
            <div class="dc-todo-dock-body"><div class="dc-todo-dock-scroll"><ol class="dc-todo-list"></ol></div></div>
        </div></div>`;
        dock.querySelector('.dc-todo-dock-head').addEventListener('click', () => setCollapsed(!dock.classList.contains('is-collapsed'), true));
        composer.parentNode.insertBefore(dock, composer);
        setCollapsed(readCollapsed(), false);
        // 切换对话、新对话会清空对话区：所属消息不在了就收起停靠区。
        const thread = document.getElementById('dcThread');
        if (thread) {
            observer = new MutationObserver(() => { if (owner && !owner.isConnected) hide(true); });
            observer.observe(thread, { childList: true });
        }
        return dock;
    }

    function setCollapsed(value, remember) {
        if (!dock) return;
        dock.classList.toggle('is-collapsed', value);
        const head = dock.querySelector('.dc-todo-dock-head');
        head.setAttribute('aria-expanded', String(!value));
        head.title = value ? L('展开任务清单', 'Expand tasks') : L('收起任务清单', 'Collapse tasks');
        if (remember) saveCollapsed(value);
    }

    function show() {
        clearTimeout(hideTimer);
        if (dock.classList.contains('is-visible')) return;
        dock.hidden = false;
        requestAnimationFrame(() => requestAnimationFrame(() => dock.classList.add('is-visible')));
    }

    function hide(immediate) {
        clearTimeout(hideTimer);
        ownerBox?.classList.remove('is-docked');
        owner = null; ownerBox = null;
        if (!dock) return;
        dock.classList.remove('is-visible');
        if (immediate) dock.hidden = true;
        else hideTimer = setTimeout(() => { if (!dock.classList.contains('is-visible')) dock.hidden = true; }, 420);
    }

    /** 实时清单更新：messageEl 为所属回复，box 为消息里的清单（停靠期间隐藏，避免重复） */
    function update(messageEl, items, box) {
        if (!ensureDock() || !items.length) return;
        if (owner !== messageEl) { ownerBox?.classList.remove('is-docked'); owner = messageEl; }
        ownerBox = box; box?.classList.add('is-docked');
        const done = items.filter(item => item.status === 'completed').length;
        const current = items.find(item => item.status === 'in_progress') || items.find(item => item.status !== 'completed');
        dock.querySelector('.dc-todo-dock-title').textContent = L('任务清单', 'Tasks');
        dock.querySelector('.dc-todo-dock-current').textContent = current ? current.content : L('全部完成', 'All done');
        dock.querySelector('.dc-todo-dock-count').textContent = `${done}/${items.length}`;
        dock.querySelector('.dc-todo-dock-progress i').style.transform = `scaleX(${items.length ? done / items.length : 0})`;
        const list = dock.querySelector('.dc-todo-list');
        renderList(list, items);
        show();
        // 当前步骤保持在可视范围内（清单较长时）
        const active = list.querySelector('.is-in_progress');
        const scroller = dock.querySelector('.dc-todo-dock-scroll');
        if (active && scroller.scrollHeight > scroller.clientHeight) {
            scroller.scrollTo({ top: Math.max(0, active.offsetTop - scroller.clientHeight / 2), behavior: 'smooth' });
        }
        // 全部完成：留一会儿让最后一条的划线动画走完，再收回消息里
        if (done === items.length) hideTimer = setTimeout(() => { if (owner === messageEl) hide(); }, 1600);
    }

    /** 回复结束（完成、出错或停止）：收回停靠区 */
    function finish(messageEl) {
        if (owner && owner === messageEl) hideTimer = setTimeout(() => { if (owner === messageEl) hide(); }, 900);
    }

    window.DragonClawTodoDock = { update, finish, renderList, hide: () => hide(true) };
})();
