/* 首页右上角推广视频：NetCare RFC 方案与 AI 审计。
 * - 默认显示右上角悬浮小窗并自动播放（浏览器拦截带声音自动播放时降级为静音，首次点击页面后恢复声音）。
 * - 点击小窗放大观看；关闭时可选“仅本次关闭”（下次打开首页仍出现）或“永久关闭”（改为右上角半透明新功能条幅，点击可再看）。 */
(function () {
    'use strict';
    const VIDEO_ID = 'netcare-rfc-ai-guide-v1';
    const STORE_KEY = 'tools.home.nrvPromo.dismissed';
    const SRC = '/assets/promotions/netcare-rfc-ai-guide.mp4?v=20261018-01';
    const POSTER = '/assets/promotions/netcare-rfc-ai-guide-poster.jpg?v=20261018-01';
    const i18n = window.ToolsI18n;
    if (i18n) i18n.register('home-promo-video', {
        'zh-CN': {
            'home.nrv.badge': '新功能', 'home.nrv.name': 'NetCare RFC 方案与 AI 审计',
            'home.nrv.hint': '点击放大', 'home.nrv.close': '关闭', 'home.nrv.mute': '静音', 'home.nrv.unmute': '开启声音', 'home.nrv.replay': '重新播放',
            'home.nrv.askTitle': '关闭推广视频？', 'home.nrv.askBody': '仅本次关闭后，下次打开首页还会出现；永久关闭后将收起为右上角的新功能条幅。',
            'home.nrv.once': '仅本次关闭', 'home.nrv.forever': '永久关闭', 'home.nrv.cancel': '取消',
            'home.nrv.banner': '新功能 · 观看 NetCare RFC 方案与 AI 审计介绍', 'home.nrv.bannerLabel': '观看 NetCare RFC 方案与 AI 审计介绍视频', 'home.nrv.dialogClose': '关闭视频'
        },
        'en-US': {
            'home.nrv.badge': 'NEW', 'home.nrv.name': 'NetCare RFC Plans and AI Audit',
            'home.nrv.hint': 'Click to enlarge', 'home.nrv.close': 'Close', 'home.nrv.mute': 'Mute', 'home.nrv.unmute': 'Turn sound on', 'home.nrv.replay': 'Replay',
            'home.nrv.askTitle': 'Close the promo video?', 'home.nrv.askBody': 'Closing for now brings it back next time you open the home page; closing permanently collapses it into a small banner at the top right.',
            'home.nrv.once': 'Just this time', 'home.nrv.forever': 'Close permanently', 'home.nrv.cancel': 'Cancel',
            'home.nrv.banner': 'New · Watch the NetCare RFC Plans and AI Audit intro', 'home.nrv.bannerLabel': 'Watch the NetCare RFC Plans and AI Audit intro video', 'home.nrv.dialogClose': 'Close video'
        }
    });
    const t = (key, fallback) => (i18n && i18n.t ? i18n.t(key) : fallback);
    const ICON = {
        play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
        replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
        on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
        off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6m0-6 6 6"/></svg>'
    };
    function readDismissed() { try { return localStorage.getItem(STORE_KEY) === VIDEO_ID; } catch (_) { return false; } }
    function writeDismissed() { try { localStorage.setItem(STORE_KEY, VIDEO_ID); } catch (_) { /* 存储不可用时仅本次生效 */ } }

    function init() {
        if (document.getElementById('nrvFloat')) return;
        const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const float = document.createElement('div');
        float.className = 'nrv-float'; float.id = 'nrvFloat'; float.hidden = true;
        float.innerHTML = `
            <video muted playsinline preload="auto" poster="${POSTER}"></video>
            <div class="nrv-badge"><b data-k="badge"></b><span data-k="name"></span></div>
            <button type="button" class="nrv-btn nrv-close" data-act="close">×</button>
            <button type="button" class="nrv-btn nrv-sound" data-act="sound"></button>
            <button type="button" class="nrv-btn nrv-replay" data-act="replay" hidden>${ICON.replay}</button>
            <span class="nrv-hint" data-k="hint"></span>
            <div class="nrv-progress"><i></i></div>
            <div class="nrv-ask" hidden role="alertdialog" aria-labelledby="nrvAskTitle">
                <strong id="nrvAskTitle" data-k="askTitle"></strong><p data-k="askBody"></p>
                <div class="nrv-ask-actions"><button type="button" data-act="once"></button><button type="button" class="primary" data-act="forever"></button><button type="button" data-act="cancel"></button></div>
            </div>`;
        const banner = document.createElement('button');
        banner.type = 'button'; banner.className = 'nrv-banner'; banner.id = 'nrvBanner'; banner.hidden = true;
        banner.innerHTML = `<b data-k="badge"></b><span data-k="banner"></span>${ICON.play}`;
        const dlg = document.createElement('dialog');
        dlg.className = 'nrv-dialog'; dlg.id = 'nrvDialog';
        dlg.innerHTML = `<div class="nrv-dialog-head"><h2><b data-k="badge"></b><span data-k="name"></span></h2><button type="button" class="nrv-dialog-close">×</button></div><video controls playsinline preload="metadata" poster="${POSTER}"></video>`;
        document.body.append(float, banner, dlg);

        const mini = float.querySelector('video');
        const big = dlg.querySelector('video');
        const ask = float.querySelector('.nrv-ask');
        const soundBtn = float.querySelector('[data-act="sound"]');
        const replayBtn = float.querySelector('[data-act="replay"]');
        const bar = float.querySelector('.nrv-progress i');
        let dismissedThisVisit = false;
        let wantSound = true;
        let ended = false;
        let wasPlayingBeforeHide = false;
        let previousOverflow = '';

        function translate() {
            const map = {
                badge: t('home.nrv.badge', '新功能'), name: t('home.nrv.name', 'NetCare RFC 方案与 AI 审计'), hint: t('home.nrv.hint', '点击放大'),
                askTitle: t('home.nrv.askTitle', '关闭推广视频？'), askBody: t('home.nrv.askBody', '仅本次关闭后，下次打开首页还会出现；永久关闭后将收起为右上角的新功能条幅。'),
                banner: t('home.nrv.banner', '新功能 · 观看 NetCare RFC 方案与 AI 审计介绍')
            };
            document.querySelectorAll('#nrvFloat [data-k], #nrvBanner [data-k], #nrvDialog [data-k]').forEach(el => { el.textContent = map[el.dataset.k] || ''; });
            float.querySelector('[data-act="close"]').setAttribute('aria-label', t('home.nrv.close', '关闭'));
            float.querySelector('[data-act="once"]').textContent = t('home.nrv.once', '仅本次关闭');
            float.querySelector('[data-act="forever"]').textContent = t('home.nrv.forever', '永久关闭');
            float.querySelector('[data-act="cancel"]').textContent = t('home.nrv.cancel', '取消');
            replayBtn.setAttribute('aria-label', t('home.nrv.replay', '重新播放'));
            banner.setAttribute('aria-label', t('home.nrv.bannerLabel', '观看 NetCare RFC 方案与 AI 审计介绍视频'));
            dlg.querySelector('.nrv-dialog-close').setAttribute('aria-label', t('home.nrv.dialogClose', '关闭视频'));
            renderSound();
        }
        function renderSound() {
            const muted = mini.muted;
            soundBtn.innerHTML = muted ? ICON.off : ICON.on;
            const label = muted ? t('home.nrv.unmute', '开启声音') : t('home.nrv.mute', '静音');
            soundBtn.setAttribute('aria-label', label); soundBtn.title = label;
        }
        function showFloat() { banner.hidden = true; float.hidden = false; }
        function showBanner() { try { mini.pause(); } catch (_) { /* noop */ } float.hidden = true; banner.hidden = false; }

        // 自动播放：优先带声音；被浏览器拦截时静音播放，并在用户首次与页面交互后自动恢复声音。
        function autoplay() {
            if (reducedMotion) return;
            mini.muted = false; renderSound();
            const attempt = mini.play();
            if (!attempt || !attempt.catch) return;
            attempt.catch(() => {
                mini.muted = true; renderSound();
                soundBtn.classList.add('is-hint');
                const retry = mini.play();
                if (retry && retry.catch) retry.catch(() => { /* 仍被拦截则停在封面，等待用户点击 */ });
                const unlock = () => {
                    ['pointerdown', 'keydown', 'touchstart'].forEach(name => document.removeEventListener(name, unlock, true));
                    if (!dismissedThisVisit && wantSound && !float.hidden && !dlg.open) { mini.muted = false; soundBtn.classList.remove('is-hint'); renderSound(); if (mini.paused && !ended) mini.play().catch(() => {}); }
                };
                ['pointerdown', 'keydown', 'touchstart'].forEach(name => document.addEventListener(name, unlock, true));
            });
        }
        function openBig() {
            if (dlg.open) return;
            if (!big.getAttribute('src')) big.src = SRC;
            const start = ended ? 0 : (mini.currentTime || 0);
            try { mini.pause(); } catch (_) { /* noop */ }
            previousOverflow = document.body.style.overflow;
            dlg.showModal(); document.body.style.overflow = 'hidden';
            const seek = () => { try { big.currentTime = start; } catch (_) { /* noop */ } big.muted = false; big.play().catch(() => {}); };
            if (big.readyState >= 1) seek(); else big.addEventListener('loadedmetadata', seek, { once: true });
        }
        function closeBig() { if (dlg.open) dlg.close(); }

        mini.addEventListener('click', openBig);
        banner.addEventListener('click', openBig);
        float.addEventListener('click', event => {
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (!act) return;
            event.stopPropagation();
            if (act === 'close') { try { mini.pause(); } catch (_) { /* noop */ } ask.hidden = false; ask.querySelector('[data-act="once"]').focus(); }
            else if (act === 'cancel') { ask.hidden = true; if (!ended && mini.paused) mini.play().catch(() => {}); }
            else if (act === 'once') { dismissedThisVisit = true; ask.hidden = true; float.hidden = true; }
            else if (act === 'forever') { writeDismissed(); dismissedThisVisit = true; ask.hidden = true; showBanner(); }
            else if (act === 'sound') { mini.muted = !mini.muted; wantSound = !mini.muted; soundBtn.classList.remove('is-hint'); renderSound(); if (mini.paused && !ended && ask.hidden) mini.play().catch(() => {}); }
            else if (act === 'replay') { ended = false; replayBtn.hidden = true; mini.currentTime = 0; mini.play().catch(() => {}); }
        });
        float.addEventListener('keydown', event => { if (event.key === 'Escape' && !ask.hidden) { ask.hidden = true; if (!ended) mini.play().catch(() => {}); } });
        mini.addEventListener('timeupdate', () => { if (mini.duration) bar.style.width = (mini.currentTime / mini.duration * 100) + '%'; });
        mini.addEventListener('ended', () => { ended = true; replayBtn.hidden = false; });
        mini.addEventListener('error', () => { float.hidden = true; banner.hidden = true; });
        dlg.querySelector('.nrv-dialog-close').addEventListener('click', closeBig);
        dlg.addEventListener('click', event => {
            const rect = dlg.getBoundingClientRect();
            if (event.target === dlg && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeBig();
        });
        dlg.addEventListener('close', () => {
            document.body.style.overflow = previousOverflow;
            const resumeAt = big.currentTime || 0;
            const finished = big.ended;
            big.pause();
            if (!float.hidden && ask.hidden) {
                if (finished) { ended = true; replayBtn.hidden = false; }
                else { try { mini.currentTime = resumeAt; } catch (_) { /* noop */ } ended = false; replayBtn.hidden = true; mini.muted = true; wantSound = false; renderSound(); mini.play().catch(() => {}); }
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { wasPlayingBeforeHide = !mini.paused; if (wasPlayingBeforeHide) mini.pause(); }
            else if (wasPlayingBeforeHide && !float.hidden && !dlg.open && ask.hidden && !ended) mini.play().catch(() => {});
        });
        window.addEventListener('tools:languagechange', translate);

        translate();
        if (readDismissed()) { showBanner(); return; }
        mini.src = SRC;
        showFloat();
        autoplay();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
