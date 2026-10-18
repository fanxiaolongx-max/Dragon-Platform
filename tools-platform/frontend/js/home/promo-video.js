/* 首页右上角推广视频：NetCare RFC 方案与 AI 审计 + Dragon 平台五站使用指南。
 * - 同一时间只有一个视频以悬浮小窗自动播放，另一个以横幅显示；点击横幅即互换（横幅变小窗播放，原小窗变横幅）。
 * - 小窗用低码率版本；点击小窗打开大窗，加载高清版并从头播放。
 * - 关闭小窗可选“仅本次关闭”（下次打开首页还会出现）或“永久关闭”；关闭后两个视频都以横幅保留，点击横幅直接大窗观看。
 * - 浏览器拦截带声音自动播放时降级为静音，首次点击页面后恢复声音。
 * - 用户开始使用页面（点击视频以外的任意位置、聚焦输入框、打开菜单）后，视频区像抽屉一样收起到右侧边缘的小标签；点击标签再抽出。 */
(function () {
    'use strict';
    const STORE_KEY = 'tools.home.promoVideos.dismissed';
    const STORE_VALUE = 'v2';
    const VER = '20261018-03';
    const VIDEOS = {
        rfc: {
            mini: '/assets/promotions/netcare-rfc-ai-guide.mp4?v=' + VER,
            hd: '/assets/promotions/netcare-rfc-ai-guide-hd.mp4?v=' + VER,
            poster: '/assets/promotions/netcare-rfc-ai-guide-poster.jpg?v=' + VER
        },
        guide: {
            mini: '/assets/promotions/platform-guide.mp4?v=' + VER,
            hd: '/assets/promotions/platform-guide-hd.mp4?v=' + VER,
            poster: '/assets/promotions/platform-guide-poster.jpg?v=' + VER
        }
    };
    const ORDER = ['rfc', 'guide'];
    const DEFAULT_CURRENT = 'rfc';
    const i18n = window.ToolsI18n;
    if (i18n) i18n.register('home-promo-video', {
        'zh-CN': {
            'home.nrv.rfc.badge': '新功能', 'home.nrv.rfc.name': 'NetCare RFC 方案与 AI 审计', 'home.nrv.rfc.banner': '新功能 · NetCare RFC 方案与 AI 审计介绍',
            'home.nrv.guide.badge': '指南', 'home.nrv.guide.name': 'Dragon 平台五站使用指南', 'home.nrv.guide.banner': '使用指南 · 数据抓取到月报，五站通关',
            'home.nrv.hint': '点击放大高清观看', 'home.nrv.close': '关闭', 'home.nrv.mute': '静音', 'home.nrv.unmute': '开启声音', 'home.nrv.replay': '重新播放',
            'home.nrv.askTitle': '关闭推广视频？', 'home.nrv.askBody': '仅本次关闭：下次打开首页还会出现；永久关闭：只保留右上角的视频横幅，点击即可观看。',
            'home.nrv.once': '仅本次关闭', 'home.nrv.forever': '永久关闭', 'home.nrv.cancel': '取消',
            'home.nrv.bannerLabel': '观看视频：{name}', 'home.nrv.dialogClose': '关闭视频',
            'home.nrv.tab': '视频介绍', 'home.nrv.tabLabel': '展开视频介绍'
        },
        'en-US': {
            'home.nrv.rfc.badge': 'NEW', 'home.nrv.rfc.name': 'NetCare RFC Plans and AI Audit', 'home.nrv.rfc.banner': 'New · NetCare RFC Plans and AI Audit intro',
            'home.nrv.guide.badge': 'GUIDE', 'home.nrv.guide.name': 'Dragon Platform five-step guide', 'home.nrv.guide.banner': 'Guide · From data capture to monthly reports',
            'home.nrv.hint': 'Click to watch in HD', 'home.nrv.close': 'Close', 'home.nrv.mute': 'Mute', 'home.nrv.unmute': 'Turn sound on', 'home.nrv.replay': 'Replay',
            'home.nrv.askTitle': 'Close the promo video?', 'home.nrv.askBody': 'Close for now: it returns next time you open the home page. Close permanently: only the video banners stay at the top right.',
            'home.nrv.once': 'Just this time', 'home.nrv.forever': 'Close permanently', 'home.nrv.cancel': 'Cancel',
            'home.nrv.bannerLabel': 'Watch video: {name}', 'home.nrv.dialogClose': 'Close video',
            'home.nrv.tab': 'Videos', 'home.nrv.tabLabel': 'Show intro videos'
        }
    });
    const t = (key, fallback, params) => (i18n && i18n.t ? i18n.t(key, params) : fallback);
    const ICON = {
        play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
        replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
        on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
        off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6m0-6 6 6"/></svg>'
    };
    function readDismissed() { try { return localStorage.getItem(STORE_KEY) === STORE_VALUE; } catch (_) { return false; } }
    function writeDismissed() { try { localStorage.setItem(STORE_KEY, STORE_VALUE); } catch (_) { /* 存储不可用时仅本次生效 */ } }
    const nameOf = key => t('home.nrv.' + key + '.name', key);

    function init() {
        if (document.getElementById('nrvStack')) return;
        const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const stack = document.createElement('div');
        stack.className = 'nrv-stack'; stack.id = 'nrvStack';
        stack.innerHTML = `
            <div class="nrv-float" id="nrvFloat" hidden>
                <video muted playsinline preload="auto"></video>
                <div class="nrv-badge"><b data-k="badge"></b><span data-k="name"></span></div>
                <button type="button" class="nrv-btn nrv-close" data-act="close">×</button>
                <button type="button" class="nrv-btn nrv-sound" data-act="sound"></button>
                <button type="button" class="nrv-btn nrv-replay" data-act="replay" hidden>${ICON.replay}</button>
                <span class="nrv-hint" data-k="hint"></span>
                <div class="nrv-progress"><i></i></div>
                <div class="nrv-ask" hidden role="alertdialog" aria-labelledby="nrvAskTitle">
                    <strong id="nrvAskTitle" data-k="askTitle"></strong><p data-k="askBody"></p>
                    <div class="nrv-ask-actions"><button type="button" data-act="once"></button><button type="button" class="primary" data-act="forever"></button><button type="button" data-act="cancel"></button></div>
                </div>
            </div>
            <div class="nrv-banners"></div>`;
        const dlg = document.createElement('dialog');
        dlg.className = 'nrv-dialog'; dlg.id = 'nrvDialog';
        dlg.innerHTML = '<div class="nrv-dialog-head"><h2><b data-k="dBadge"></b><span data-k="dName"></span></h2><button type="button" class="nrv-dialog-close">×</button></div><video controls playsinline preload="metadata"></video>';
        const tab = document.createElement('button');
        tab.type = 'button'; tab.className = 'nrv-tab'; tab.id = 'nrvTab'; tab.tabIndex = -1;
        tab.setAttribute('aria-hidden', 'true');
        tab.innerHTML = `<span class="nrv-tab-orb" aria-hidden="true">${ICON.play}<span class="nrv-tab-count">${ORDER.length}</span></span><span class="nrv-tab-label" data-k="tab"></span>`;
        document.body.append(stack, tab, dlg);

        const float = stack.querySelector('#nrvFloat');
        const bannersBox = stack.querySelector('.nrv-banners');
        const mini = float.querySelector('video');
        const big = dlg.querySelector('video');
        const ask = float.querySelector('.nrv-ask');
        const soundBtn = float.querySelector('[data-act="sound"]');
        const replayBtn = float.querySelector('[data-act="replay"]');
        const bar = float.querySelector('.nrv-progress i');
        let current = readDismissed() ? null : DEFAULT_CURRENT;   // 当前在小窗播放的视频；null 表示小窗已关闭
        let bigKey = null;
        let wantSound = true;
        let ended = false;
        let soundUnlocked = false;
        let wasPlayingBeforeHide = false;
        let previousOverflow = '';
        let tucked = false;
        let resumeOnUntuck = false;

        function renderSound() {
            const muted = mini.muted;
            soundBtn.innerHTML = muted ? ICON.off : ICON.on;
            const label = muted ? t('home.nrv.unmute', '开启声音') : t('home.nrv.mute', '静音');
            soundBtn.setAttribute('aria-label', label); soundBtn.title = label;
        }
        function renderBanners() {
            const keys = ORDER.filter(key => key !== current);
            bannersBox.innerHTML = keys.map(key => `<button type="button" class="nrv-banner" data-video="${key}" aria-label="${t('home.nrv.bannerLabel', '观看视频', { name: nameOf(key) }).replace(/"/g, '&quot;')}"><b>${t('home.nrv.' + key + '.badge', '')}</b><span>${t('home.nrv.' + key + '.banner', '')}</span>${ICON.play}</button>`).join('');
        }
        function translate() {
            const key = current || ORDER[0];
            const map = {
                badge: t('home.nrv.' + key + '.badge', ''), name: nameOf(key), hint: t('home.nrv.hint', '点击放大高清观看'),
                askTitle: t('home.nrv.askTitle', '关闭推广视频？'), askBody: t('home.nrv.askBody', ''),
                dBadge: bigKey ? t('home.nrv.' + bigKey + '.badge', '') : '', dName: bigKey ? nameOf(bigKey) : '',
                tab: t('home.nrv.tab', '视频介绍')
            };
            document.querySelectorAll('#nrvStack [data-k], #nrvDialog [data-k], #nrvTab [data-k]').forEach(el => { el.textContent = map[el.dataset.k] || ''; });
            float.dataset.video = key;
            float.querySelector('[data-act="close"]').setAttribute('aria-label', t('home.nrv.close', '关闭'));
            float.querySelector('[data-act="once"]').textContent = t('home.nrv.once', '仅本次关闭');
            float.querySelector('[data-act="forever"]').textContent = t('home.nrv.forever', '永久关闭');
            float.querySelector('[data-act="cancel"]').textContent = t('home.nrv.cancel', '取消');
            replayBtn.setAttribute('aria-label', t('home.nrv.replay', '重新播放'));
            dlg.querySelector('.nrv-dialog-close').setAttribute('aria-label', t('home.nrv.dialogClose', '关闭视频'));
            tab.setAttribute('aria-label', t('home.nrv.tabLabel', '展开视频介绍')); tab.title = t('home.nrv.tabLabel', '展开视频介绍');
            renderSound();
            renderBanners();
        }
        function playMini() {
            if (reducedMotion && !soundUnlocked) return;
            mini.muted = !wantSound; renderSound();
            const attempt = mini.play();
            if (!attempt || !attempt.catch) return;
            attempt.catch(() => {
                // 浏览器拦截带声音的自动播放：先静音播放，等用户首次与页面交互后恢复声音
                mini.muted = true; renderSound();
                soundBtn.classList.add('is-hint');
                mini.play().catch(() => { /* 仍被拦截则停在封面 */ });
            });
        }
        // 抽屉：收起到右侧边缘标签 / 从标签抽出
        function tuck() {
            if (tucked) return;
            tucked = true;
            resumeOnUntuck = !!current && !mini.paused && !ended;
            try { mini.pause(); } catch (_) { /* noop */ }
            if (!ask.hidden) ask.hidden = true;
            stack.classList.add('is-tucked'); stack.setAttribute('aria-hidden', 'true'); stack.inert = true;
            tab.classList.add('is-shown'); tab.setAttribute('aria-hidden', 'false'); tab.tabIndex = 0;
        }
        function untuck() {
            if (!tucked) return;
            tucked = false;
            stack.classList.remove('is-tucked'); stack.removeAttribute('aria-hidden'); stack.inert = false;
            tab.classList.remove('is-shown'); tab.setAttribute('aria-hidden', 'true'); tab.tabIndex = -1;
            // 点击标签本身就是用户手势：恢复播放时可以带声音
            if (current && !ended && (resumeOnUntuck || mini.paused)) { mini.muted = !wantSound; soundBtn.classList.remove('is-hint'); renderSound(); mini.play().catch(() => {}); }
        }
        const isOwn = target => !!(target && target.closest && (target.closest('#nrvStack') || target.closest('#nrvTab') || target.closest('#nrvDialog')));
        // 点在视频区内 → 解锁声音；点在别处（Dragon Claw 输入框、菜单、页面任意位置）或在输入框里打字 → 收起抽屉
        const isEditable = target => !!(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
        let lastKeyAt = -1e9;
        function onInteract(event) {
            const own = dlg.open || isOwn(event.target);
            if (event.type === 'keydown') {
                lastKeyAt = performance.now();
                if (!own && isEditable(event.target)) { soundUnlocked = true; tuck(); return; }
                if (own || !tucked) unlockSound();
                return;
            }
            if (own) { if (!event.target.closest('[data-act="sound"]')) unlockSound(); return; }
            soundUnlocked = true;
            tuck();
        }
        function unlockSound() {
            if (soundUnlocked && !mini.muted) return;
            soundUnlocked = true;
            if (current && !tucked && wantSound && mini.muted && !dlg.open && ask.hidden) {
                mini.muted = false; soundBtn.classList.remove('is-hint'); renderSound();
                if (mini.paused && !ended) mini.play().catch(() => {});
            }
        }
        ['pointerdown', 'keydown', 'touchstart'].forEach(name => document.addEventListener(name, onInteract, true));
        // 只响应键盘 Tab 导航带来的焦点变化，避免页面自动聚焦输入框时误收起
        document.addEventListener('focusin', event => { if (performance.now() - lastKeyAt < 800 && !dlg.open && !isOwn(event.target) && event.target !== document.body) tuck(); }, true);
        // 中文输入法可能不产生普通 keydown：在页面输入框里输入（含输入法组合）也视为开始使用，收起抽屉
        ['input', 'compositionstart'].forEach(name => document.addEventListener(name, event => { if (!dlg.open && !isOwn(event.target) && isEditable(event.target)) { soundUnlocked = true; tuck(); } }, true));
        // 进入 Dragon Claw 对话模式（顶部出现“工作区 / 新对话 / 浏览工具”）时也收起，避免遮挡
        let chatting = document.body.classList.contains('dc-chatting');
        new MutationObserver(() => { const now = document.body.classList.contains('dc-chatting'); if (now && !chatting) tuck(); chatting = now; }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        tab.addEventListener('click', untuck);

        // 切换小窗播放的视频（横幅点击时调用）；切换后从头播放
        function setCurrent(key) {
            current = key;
            ended = false; replayBtn.hidden = true; ask.hidden = true; bar.style.width = '0%';
            if (!key) { try { mini.pause(); } catch (_) { /* noop */ } mini.removeAttribute('src'); mini.load(); float.hidden = true; translate(); return; }
            mini.poster = VIDEOS[key].poster;
            mini.src = VIDEOS[key].mini;
            float.hidden = false;
            float.classList.remove('nrv-swap'); void float.offsetWidth; float.classList.add('nrv-swap');
            translate();
            playMini();
        }
        // 大窗：始终加载高清版并从头播放
        function openBig(key) {
            if (dlg.open || !key) return;
            bigKey = key;
            try { mini.pause(); } catch (_) { /* noop */ }
            big.poster = VIDEOS[key].poster;
            if (big.getAttribute('src') !== VIDEOS[key].hd) big.src = VIDEOS[key].hd;
            translate();
            previousOverflow = document.body.style.overflow;
            dlg.showModal(); document.body.style.overflow = 'hidden';
            const start = () => { try { big.currentTime = 0; } catch (_) { /* noop */ } big.muted = false; big.play().catch(() => {}); };
            if (big.readyState >= 1) start(); else big.addEventListener('loadedmetadata', start, { once: true });
        }
        function closeBig() { if (dlg.open) dlg.close(); }

        mini.addEventListener('click', () => openBig(current));
        bannersBox.addEventListener('click', event => {
            const key = event.target.closest('[data-video]')?.dataset.video;
            if (!key) return;
            if (current) { wantSound = true; setCurrent(key); }   // 小窗开着：横幅与小窗互换
            else openBig(key);                                   // 小窗已关闭：直接大窗观看
        });
        float.addEventListener('click', event => {
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (!act) return;
            event.stopPropagation();
            if (act === 'close') { try { mini.pause(); } catch (_) { /* noop */ } ask.hidden = false; ask.querySelector('[data-act="once"]').focus(); }
            else if (act === 'cancel') { ask.hidden = true; if (!ended && mini.paused) mini.play().catch(() => {}); }
            else if (act === 'once') { setCurrent(null); }
            else if (act === 'forever') { writeDismissed(); setCurrent(null); }
            else if (act === 'sound') { mini.muted = !mini.muted; wantSound = !mini.muted; soundBtn.classList.remove('is-hint'); renderSound(); if (mini.paused && !ended && ask.hidden) mini.play().catch(() => {}); }
            else if (act === 'replay') { ended = false; replayBtn.hidden = true; mini.currentTime = 0; mini.play().catch(() => {}); }
        });
        float.addEventListener('keydown', event => { if (event.key === 'Escape' && !ask.hidden) { ask.hidden = true; if (!ended) mini.play().catch(() => {}); } });
        mini.addEventListener('timeupdate', () => { if (mini.duration) bar.style.width = (mini.currentTime / mini.duration * 100) + '%'; });
        mini.addEventListener('ended', () => { ended = true; replayBtn.hidden = false; });
        mini.addEventListener('error', () => { if (mini.getAttribute('src')) float.hidden = true; });
        dlg.querySelector('.nrv-dialog-close').addEventListener('click', closeBig);
        dlg.addEventListener('click', event => {
            const rect = dlg.getBoundingClientRect();
            if (event.target === dlg && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeBig();
        });
        dlg.addEventListener('close', () => {
            document.body.style.overflow = previousOverflow;
            big.pause();
            bigKey = null;
            // 大窗看过后，小窗静音继续，避免两段声音叠加
            if (current && ask.hidden && !ended && !tucked) { mini.muted = true; wantSound = false; renderSound(); mini.play().catch(() => {}); }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { wasPlayingBeforeHide = !mini.paused; if (wasPlayingBeforeHide) mini.pause(); }
            else if (wasPlayingBeforeHide && current && !tucked && !dlg.open && ask.hidden && !ended) mini.play().catch(() => {});
        });
        window.addEventListener('tools:languagechange', translate);

        setCurrent(current);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
