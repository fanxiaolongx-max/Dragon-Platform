// Dragon 浏览器下载横幅：最新的在最上方紧贴下载按钮，最多同时显示 3 条；
// 新横幅挤掉最旧的；完成后停留片刻，按完成先后逐条滑出并收拢。
(function () {
    'use strict';
    const api = window.DragonDownloadToast;
    const stack = document.getElementById('stack');
    const MAX_VISIBLE = 3, DONE_MS = 4200, FAIL_MS = 6000, STAGGER_MS = 420, RESUME_MS = 1400;
    const FINAL = new Set(['completed', 'failed', 'interrupted', 'cancelled']);
    const cards = new Map();
    let lang = 'zh-CN', hovering = false, lastDismissAt = 0, reportedHeight = -1;
    const T = (zh, en) => lang === 'en-US' ? en : zh;
    const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ICONS = {
        check: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 6.2 2.3 2.3 4.7-5"/></svg>',
        alert: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3v3.4M6 8.8v.1"/></svg>',
        folder: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.8 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
        close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m6 6 8 8M14 6l-8 8"/></svg>'
    };
    const KINDS = [
        [/^(pdf)$/, '#e5484d'], [/^(docx?|rtf|odt|pages|txt|md)$/, '#3b82f6'], [/^(xlsx?|csv|ods|numbers)$/, '#16a34a'],
        [/^(pptx?|key|odp)$/, '#f97316'], [/^(png|jpe?g|gif|webp|svg|bmp|heic|ico)$/, '#8b5cf6'], [/^(mp4|mov|mkv|avi|webm|mp3|wav|flac|m4a)$/, '#ec4899'],
        [/^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/, '#d97706'], [/^(dmg|pkg|exe|msi|apk|ipa|deb|rpm|appimage)$/, '#0f766e'],
        [/^(js|ts|json|html?|css|py|java|kt|swift|go|rs|c|cpp|h|sh|sql|xml|ya?ml)$/, '#475569']
    ];

    function splitName(name) {
        const match = /^(.+?)(\.[^.\s]{1,10})$/.exec(name);
        return match ? [match[1], match[2]] : [name, ''];
    }
    function bytes(value) {
        if (!(value > 0)) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
        const number = value / Math.pow(1024, index);
        return `${number >= 100 || index === 0 ? Math.round(number) : number.toFixed(1)} ${units[index]}`;
    }

    function reportSize() {
        const height = cards.size ? Math.ceil(stack.getBoundingClientRect().height) : 0;
        if (height === reportedHeight) return;
        reportedHeight = height;
        api?.size(height);
    }
    new ResizeObserver(reportSize).observe(stack);

    function create(item) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.innerHTML = `<article class="card" tabindex="-1"><div class="tile"><span class="ext"></span><span class="badge"></span></div>
            <div class="meta"><div class="name"><span class="stem"></span><span class="suffix"></span></div><div class="sub"></div></div>
            <div class="actions"><button type="button" data-act="show">${ICONS.folder}</button><button type="button" data-act="dismiss">${ICONS.close}</button></div>
            <div class="bar"><i></i></div></article>`;
        const card = { id: item.id, slot, el: slot.firstElementChild, item, timer: 0, dismissAt: 0, leaving: false };
        const [stem, suffix] = splitName(item.name || 'download');
        const ext = suffix.slice(1).toLowerCase();
        card.el.querySelector('.stem').textContent = stem;
        card.el.querySelector('.suffix').textContent = suffix;
        card.el.querySelector('.ext').textContent = (ext || 'FILE').slice(0, 4).toUpperCase();
        card.el.querySelector('.tile').style.setProperty('--tile', (KINDS.find(([pattern]) => pattern.test(ext)) || [0, '#64748b'])[1]);
        card.el.title = item.name || '';
        card.el.addEventListener('click', event => {
            const act = event.target.closest('button')?.dataset.act;
            if (act === 'dismiss') return leave(card);
            if (act === 'show') { api?.action(card.id, 'show'); return; }
            if (card.item.state === 'completed') { api?.action(card.id, 'open'); leave(card); }
        });

        // FLIP：先记下旧横幅的位置，新横幅插到最上面后再让旧横幅从原位滑下去。
        const before = new Map([...cards.values()].map(other => [other, other.slot.getBoundingClientRect().top]));
        stack.prepend(slot);
        cards.set(card.id, card);
        if (!reduceMotion()) {
            for (const [other, top] of before) {
                const delta = top - other.slot.getBoundingClientRect().top;
                if (Math.abs(delta) > .5) other.slot.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
            }
            card.el.animate([
                { opacity: 0, transform: 'translateY(-10px) scale(.94)' },
                { opacity: 1, transform: 'translateY(1px) scale(1.01)', offset: .7 },
                { opacity: 1, transform: 'translateY(0) scale(1)' }
            ], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
        // 超出上限时，最旧的（最下方）横幅让位。
        const live = [...cards.values()].filter(other => !other.leaving);
        for (const old of live.slice(0, Math.max(0, live.length - MAX_VISIBLE))) leave(old, true);
        reportSize();
        return card;
    }

    function update(card, item) {
        card.item = item;
        const state = FINAL.has(item.state) || item.state === 'paused' ? item.state : 'progressing';
        if (card.el.dataset.state !== state) {
            card.el.dataset.state = state;
            card.el.querySelector('.badge').innerHTML = state === 'completed' ? ICONS.check : state === 'failed' || state === 'interrupted' ? ICONS.alert : '';
        }
        const known = item.total > 0, percent = known ? Math.min(100, Math.round(item.received / item.total * 100)) : 0;
        card.el.classList.toggle('is-indeterminate', state === 'progressing' && !known);
        card.el.querySelector('.bar i').style.width = `${state === 'completed' ? 100 : percent}%`;
        card.el.classList.toggle('is-openable', state === 'completed');
        const sub = state === 'completed' ? T(`已下载 · ${bytes(item.total || item.received)} · 点击打开`, `Downloaded · ${bytes(item.total || item.received)} · Click to open`)
            : state === 'paused' ? T(`已暂停 · ${percent}%`, `Paused · ${percent}%`)
            : state === 'failed' || state === 'interrupted' ? T('下载失败', 'Download failed')
            : state === 'cancelled' ? T('已取消', 'Cancelled')
            : known ? T(`下载中 · ${bytes(item.received)} / ${bytes(item.total)}`, `Downloading · ${bytes(item.received)} of ${bytes(item.total)}`)
            : T(`下载中 · ${bytes(item.received)}`, `Downloading · ${bytes(item.received)}`);
        const subNode = card.el.querySelector('.sub');
        if (subNode.textContent !== sub) subNode.textContent = sub;
        const [show, dismiss] = card.el.querySelectorAll('.actions button');
        show.hidden = state !== 'completed';
        show.title = T('在文件夹中显示', 'Show in folder'); show.setAttribute('aria-label', show.title);
        dismiss.title = T('关闭', 'Dismiss'); dismiss.setAttribute('aria-label', dismiss.title);
    }

    // 逐条消失：每条的离场时间至少比上一条晚 STAGGER_MS，保证按完成先后依次滑出。
    function schedule(card, delay) {
        if (card.leaving || card.dismissAt) return;
        const at = Math.max(Date.now() + delay, lastDismissAt + STAGGER_MS);
        lastDismissAt = at; card.dismissAt = at;
        if (!hovering) arm(card);
    }
    function arm(card) {
        clearTimeout(card.timer);
        card.timer = setTimeout(() => leave(card), Math.max(0, card.dismissAt - Date.now()));
    }

    function leave(card, evicted = false) {
        if (card.leaving) return;
        card.leaving = true; clearTimeout(card.timer);
        card.el.style.pointerEvents = 'none';
        let done = false;
        const finish = () => { if (done) return; done = true; card.slot.remove(); cards.delete(card.id); reportSize(); };
        if (reduceMotion()) { finish(); return; }
        // 窗口被隐藏/最小化时 Chromium 可能暂停动画帧，兜底保证横幅仍会移除。
        setTimeout(finish, 720);
        card.el.animate([
            { opacity: 1, transform: 'translateX(0) scale(1)' },
            { opacity: 0, transform: evicted ? 'translateY(8px) scale(.96)' : 'translateX(24px) scale(.97)' }
        ], { duration: evicted ? 220 : 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished.then(() => {
            const height = card.slot.getBoundingClientRect().height;
            card.slot.style.overflow = 'hidden';
            return card.slot.animate([
                { height: `${height}px`, paddingBottom: getComputedStyle(card.slot).paddingBottom },
                { height: '0px', paddingBottom: '0px' }
            ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished;
        }).catch(() => {}).then(finish);
    }

    function clearAll() {
        for (const card of cards.values()) { clearTimeout(card.timer); card.slot.remove(); }
        cards.clear(); lastDismissAt = 0; hovering = false; reportSize();
    }

    stack.addEventListener('mouseenter', () => {
        hovering = true;
        for (const card of cards.values()) clearTimeout(card.timer);
    });
    stack.addEventListener('mouseleave', () => {
        hovering = false;
        // 鼠标移开后再给一点阅读时间，仍按原先顺序逐条离开。
        const pending = [...cards.values()].filter(card => card.dismissAt && !card.leaving).sort((a, b) => a.dismissAt - b.dismissAt);
        let at = Date.now() + RESUME_MS;
        for (const card of pending) { card.dismissAt = Math.max(card.dismissAt, at); at = card.dismissAt + STAGGER_MS; arm(card); }
        if (pending.length) lastDismissAt = Math.max(lastDismissAt, pending[pending.length - 1].dismissAt);
    });

    function handle(message) {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'config') {
            lang = message.lang === 'en-US' ? 'en-US' : 'zh-CN';
            document.documentElement.dataset.theme = message.theme === 'dark' ? 'dark' : 'light';
            document.documentElement.lang = lang;
            for (const card of cards.values()) update(card, card.item);
            return;
        }
        if (message.type === 'clear') { clearAll(); return; }
        if (message.type !== 'download' || !message.item?.id) return;
        const item = message.item;
        let card = cards.get(item.id);
        if (card?.leaving) return;
        if (!card) {
            if (!(message.started || message.finished) || item.state === 'cancelled') return;
            card = create(item);
        }
        update(card, item);
        if (item.state === 'cancelled') leave(card);
        else if (item.state === 'completed') schedule(card, DONE_MS);
        else if (FINAL.has(item.state)) schedule(card, FAIL_MS);
    }

    api?.onEvent(handle);
    // 供本地预览/测试直接驱动，不经过 Electron。
    window.__dragonDownloadToast = { handle, count: () => cards.size };
})();
