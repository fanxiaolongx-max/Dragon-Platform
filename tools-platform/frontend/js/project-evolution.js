(function () {
    'use strict';
    const i18n = window.ToolsI18n;
    const dictionary = {
        'zh-CN': {
            'evolution.title': '项目演进 · 银河之旅', 'evolution.back': '← 返回登录',
            'evolution.description': '88 秒，回看一个工具平台如何逐步生长。',
            'evolution.caption': '1080p 高清 · 可全屏观看', 'evolution.videoLabel': '项目演进高清视频',
            'evolution.loading': '视频加载中…', 'evolution.failed': '视频暂时无法加载，请检查网络后重试。',
            'evolution.playPrompt': '点击播放，开启这段旅程。', 'evolution.play': '播放', 'evolution.retry': '重试'
        },
        'en-US': {
            'evolution.title': 'Project evolution · Galaxy', 'evolution.back': '← Back to sign in',
            'evolution.description': 'An 88-second journey through the growth of a tools platform.',
            'evolution.caption': '1080p HD · Fullscreen available', 'evolution.videoLabel': 'Project evolution video in HD',
            'evolution.loading': 'Loading video…', 'evolution.failed': 'Video unavailable. Check your connection and retry.',
            'evolution.playPrompt': 'Press play to begin the journey.', 'evolution.play': 'Play', 'evolution.retry': 'Retry'
        }
    };
    if (i18n) i18n.register('project-evolution', dictionary);
    const t = key => i18n ? i18n.t(key) : dictionary['zh-CN'][key];
    function attachPlayer(video, status, label, action, onRender = () => {}) {
        let state = '', active = true;
        function render() {
            if (!active) return;
            onRender();
            status.hidden = !state;
            label.textContent = t(state === 'error' ? 'evolution.failed' : state === 'play' ? 'evolution.playPrompt' : 'evolution.loading');
            action.hidden = state !== 'error' && state !== 'play';
            action.textContent = t(state === 'error' ? 'evolution.retry' : 'evolution.play');
        }
        function show(next) { if (active) { state = next; render(); } }
        function play() {
            video.play().catch(error => {
                if (!active) return;
                if (error.name === 'NotAllowedError') show('play');
                else if (video.error) show('error');
            });
        }
        video.addEventListener('loadstart', () => { if (state !== 'play') show('loading'); });
        video.addEventListener('waiting', () => { if (state !== 'play') show('loading'); });
        video.addEventListener('playing', () => show(''));
        video.addEventListener('canplay', () => { if (state === 'loading') show(''); });
        video.addEventListener('error', () => show('error'), true);
        action.addEventListener('click', () => { if (state === 'error') video.load(); play(); });
        const source = document.createElement('source');
        source.type = 'video/mp4';
        source.src = '/assets/promotions/project-evolution-galaxy-hd.mp4';
        video.append(source);
        video.load(); render(); play();
        return {
            refresh: render,
            destroy() {
                active = false;
                video.pause();
                video.removeAttribute('src');
                source.remove();
                video.load();
                video.remove();
            }
        };
    }

    let modalPlayer = null;
    window.ProjectEvolutionPlayer = {
        mount(container) {
            this.close();
            container.innerHTML = `<p class="legal-video-description" data-i18n="evolution.description"></p>
                <div class="legal-video-player"><video controls playsinline preload="metadata" tabindex="0" poster="/assets/promotions/project-evolution-galaxy-poster.jpg" data-i18n-aria-label="evolution.videoLabel"></video>
                    <div class="legal-video-status" role="status" aria-live="polite" hidden><span></span><button type="button" hidden></button></div>
                </div><p class="legal-video-caption" data-i18n="evolution.caption"></p>`;
            container.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
            const video = container.querySelector('video');
            video.setAttribute('aria-label', t('evolution.videoLabel'));
            const status = container.querySelector('.legal-video-status');
            modalPlayer = attachPlayer(video, status, status.querySelector('span'), status.querySelector('button'));
        },
        close() { modalPlayer?.destroy(); modalPlayer = null; }
    };
    window.addEventListener('tools:languagechange', () => modalPlayer?.refresh());

    // Direct public links keep their standalone player; login creates a player only on click.
    const video = document.getElementById('evolutionVideo');
    if (!video) return;
    const player = attachPlayer(video, document.getElementById('evolutionStatus'), document.getElementById('evolutionStatusText'), document.getElementById('evolutionAction'), () => { document.title = t('evolution.title'); });
    document.getElementById('evolutionLanguage').addEventListener('click', () => i18n?.toggleLanguage());
    window.addEventListener('tools:languagechange', player.refresh);
})();
