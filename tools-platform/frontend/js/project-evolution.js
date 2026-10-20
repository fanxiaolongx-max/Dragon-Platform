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
    const video = document.getElementById('evolutionVideo');
    const status = document.getElementById('evolutionStatus');
    const label = document.getElementById('evolutionStatusText');
    const action = document.getElementById('evolutionAction');
    let state = '';
    function render() {
        document.title = t('evolution.title');
        status.hidden = !state;
        label.textContent = t(state === 'error' ? 'evolution.failed' : state === 'play' ? 'evolution.playPrompt' : 'evolution.loading');
        action.hidden = state !== 'error' && state !== 'play';
        action.textContent = t(state === 'error' ? 'evolution.retry' : 'evolution.play');
    }
    function show(next) { state = next; render(); }
    function play() {
        video.play().catch(error => {
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
    document.getElementById('evolutionLanguage').addEventListener('click', () => i18n?.toggleLanguage());
    window.addEventListener('tools:languagechange', render);
    // This page is opened by an explicit click. The login page itself never sets a video source.
    // 显式声明媒体类型，使 Safari 可播放返回 octet-stream 的 Release 地址。
    const source = document.createElement('source');
    source.type = 'video/mp4';
    source.src = '/assets/promotions/project-evolution-galaxy-hd.mp4';
    video.append(source);
    video.load();
    render();
    play();
})();
