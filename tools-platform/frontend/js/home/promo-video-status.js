/* Loading/retry UI kept separate from the home video's creative content. */
(function () {
    'use strict';
    const i18n = window.ToolsI18n;
    if (i18n) i18n.register('home-promo-video-status', {
        'zh-CN': { 'home.video.loading': '视频加载中…', 'home.video.failed': '视频暂时无法加载，请检查网络后重试', 'home.video.retry': '重试' },
        'en-US': { 'home.video.loading': 'Loading video…', 'home.video.failed': 'Video unavailable. Check your connection and retry.', 'home.video.retry': 'Retry' }
    });
    const t = key => i18n && i18n.t ? i18n.t(key) : ({
        'home.video.loading': '视频加载中…', 'home.video.failed': '视频暂时无法加载，请检查网络后重试', 'home.video.retry': '重试'
    })[key];
    function init() {
        document.querySelectorAll('#nrvFloat video, #nrvDialog video').forEach(video => {
            const panel = document.createElement('div');
            panel.className = 'nrv-load-status'; panel.hidden = true;
            panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
            const spinner = document.createElement('span');
            spinner.className = 'nrv-load-spinner'; spinner.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            const retry = document.createElement('button'); retry.type = 'button';
            panel.append(spinner, label, retry); video.after(panel);
            let state = '';
            function render() {
                panel.hidden = !state;
                label.textContent = t(state === 'error' ? 'home.video.failed' : 'home.video.loading');
                retry.textContent = t('home.video.retry');
                retry.hidden = state !== 'error'; spinner.hidden = state === 'error';
            }
            function show(next) { state = video.getAttribute('src') ? next : ''; render(); }
            video.addEventListener('loadstart', () => show('loading'));
            video.addEventListener('waiting', () => show('loading'));
            video.addEventListener('error', () => show('error'));
            ['playing', 'canplay', 'ended', 'emptied'].forEach(event => video.addEventListener(event, () => show('')));
            retry.addEventListener('click', event => {
                event.stopPropagation(); show('loading'); video.load(); video.play().catch(() => {});
            });
            window.addEventListener('tools:languagechange', render);
            if (video.error) show('error');
            else if (video.getAttribute('src') && video.readyState < 3) show('loading');
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
