// 笔记讲解视频：文件与首页推广视频同源存放（/assets/promotions/datacom/），按 manifest 判断哪些笔记已有视频。
// 发布规则见本模块 AGENTS.md：成品只上传 Dragon-Platform-Media Releases，运行 npm run datacom:publish-videos；禁止提交 MP4。
// 小窗播放低码率版本，点击放大加载高清版；浏览器拦截带声音自动播放时降级为静音并提示开声音。
// 只读导出使用冻结的公开 Release 地址。source 显式声明 video/mp4 以兼容 Safari；不设置 crossorigin。
const BASE = '/assets/promotions/datacom/';
const AUTOPLAY_KEY = 'dk_video_autoplay';
let manifestPromise = null;

const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* 隐私模式 */ } }
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const clock = seconds => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function loadVideoManifest({ offline = false } = {}) {
    // 只读导出内嵌公开视频清单；平台仍走原有同源清单和缓存接口。
    if (offline) return Promise.resolve(globalThis.__DATACOM_SNAPSHOT__?.videos || {});
    if (!manifestPromise) {
        manifestPromise = fetch(`${BASE}manifest.json?t=${Date.now()}`, { credentials: 'same-origin' })
            .then(response => (response.ok ? response.json() : {}))
            .catch(() => ({}));
    }
    return manifestPromise;
}

export const autoplayEnabled = () => store.get(AUTOPLAY_KEY) !== 'off';

function src(id, kind, meta, offline) {
    if (offline) return meta.sources?.[kind] || '';
    const file = kind === 'hd' ? `${id}-hd.mp4` : kind === 'poster' ? `${id}-poster.jpg` : `${id}.mp4`;
    return `${BASE}${encodeURIComponent(file)}?v=${encodeURIComponent(meta.v || '1')}`;
}

// 在 host 中挂载视频讲解区块；没有视频时什么都不显示。返回 dispose。
export async function mountNoteVideo(host, articleId, { offline = false, autoplay = true, floating = true, showAutoplayToggle = true, preload = 'metadata' } = {}) {
    const manifest = await loadVideoManifest({ offline });
    const meta = manifest[articleId];
    if (!meta || !host.isConnected) { host.hidden = true; return () => {}; }
    host.hidden = false;
    host.innerHTML = `<div class="dk-video-head"><span class="dk-video-kicker">🎬 视频讲解</span><strong>${esc(meta.title || '')}</strong>${meta.duration ? `<span class="dk-mini-note">${clock(meta.duration)}</span>` : ''}
            ${showAutoplayToggle ? `<label class="dk-video-auto"><input type="checkbox" ${autoplayEnabled() ? 'checked' : ''}> 打开笔记自动播放</label>` : ''}</div>
        <div class="dk-video-frame">
            <video playsinline preload="${preload === 'none' ? 'none' : 'metadata'}" poster="${esc(src(articleId, 'poster', meta, offline))}"><source type="video/mp4" src="${esc(src(articleId, 'mini', meta, offline))}"></video>
            <button type="button" class="dk-video-sound" hidden>🔇 点击开启声音</button>
            <button type="button" class="dk-video-play" aria-label="播放视频讲解">▶</button>
            <button type="button" class="dk-video-hd" title="高清大窗观看">⛶ 高清</button>
        </div>`;
    const video = host.querySelector('video');
    const sound = host.querySelector('.dk-video-sound');
    const bigPlay = host.querySelector('.dk-video-play');
    video.controls = preload !== 'none';

    const sync = () => {
        if (!video.paused) video.controls = true;
        bigPlay.hidden = !video.paused || video.currentTime > 0;
    };
    video.addEventListener('play', sync);
    video.addEventListener('pause', sync);
    bigPlay.addEventListener('click', () => { video.muted = false; video.play().catch(() => {}); });
    sound.addEventListener('click', () => { video.muted = false; sound.hidden = true; video.play().catch(() => {}); });
    video.addEventListener('volumechange', () => { if (!video.muted) sound.hidden = true; });
    host.querySelector('.dk-video-auto input')?.addEventListener('change', event => store.set(AUTOPLAY_KEY, event.target.checked ? 'on' : 'off'));
    let closeHd = () => {};
    host.querySelector('.dk-video-hd').addEventListener('click', () => { video.pause(); closeHd(); closeHd = openHd(articleId, meta, video.currentTime, offline); });

    if (autoplay && autoplayEnabled()) {
        try {
            await video.play();
        } catch (_) {
            // 浏览器不允许带声音自动播放：静音播放并提示
            video.muted = true;
            try { await video.play(); sound.hidden = false; } catch (__) { /* 仍被拦截则保留大播放按钮 */ }
        }
    }
    sync();

    // 播放中滚出视野：转为右下角悬浮小窗继续讲解；关闭小窗则暂停
    const frame = host.querySelector('.dk-video-frame');
    const release = () => { closeHd(); video.pause(); video.querySelector('source')?.remove(); video.load(); };
    if (!floating) return release;
    const dock = document.createElement('button');
    dock.type = 'button';
    dock.className = 'dk-video-dock';
    dock.title = '关闭悬浮小窗';
    dock.textContent = '×';
    frame.appendChild(dock);
    let dismissed = false;
    const setFloating = floating => {
        frame.classList.toggle('is-floating', floating);
        host.style.minHeight = floating ? `${host.dataset.height}px` : '';
    };
    dock.addEventListener('click', () => { dismissed = true; video.pause(); setFloating(false); });
    video.addEventListener('play', () => { dismissed = false; });
    video.addEventListener('ended', () => setFloating(false));
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) { setFloating(false); return; }
            host.dataset.height = String(host.offsetHeight);
            setFloating(!video.paused && !dismissed);
        });
    }, { threshold: 0.2 });
    observer.observe(host);
    return () => { observer.disconnect(); release(); frame.classList.remove('is-floating'); };
}

function openHd(articleId, meta, startAt = 0, offline = false) {
    const previousFocus = document.activeElement;
    const mask = document.createElement('div');
    mask.className = 'dk-video-dialog';
    mask.innerHTML = `<div class="dk-video-dialog-box" role="dialog" aria-modal="true" aria-label="视频讲解"><header><strong>🎬 ${esc(meta.title || '')}</strong><button type="button" class="dk-icon-btn" aria-label="关闭">×</button></header>
        <video controls autoplay playsinline poster="${esc(src(articleId, 'poster', meta, offline))}"><source type="video/mp4" src="${esc(src(articleId, 'hd', meta, offline))}"></video></div>`;
    document.body.appendChild(mask);
    const video = mask.querySelector('video');
    video.addEventListener('loadedmetadata', () => { if (startAt > 0 && startAt < video.duration) video.currentTime = startAt; }, { once: true });
    const close = () => {
        if (!mask.isConnected) return;
        video.pause(); video.querySelector('source')?.remove(); video.load();
        mask.remove(); document.removeEventListener('keydown', onKey);
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab') {
            const first = mask.querySelector('header button');
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); video.focus(); }
            else if (!event.shiftKey && document.activeElement === video) { event.preventDefault(); first.focus(); }
        }
    };
    document.addEventListener('keydown', onKey);
    mask.querySelector('header button').addEventListener('click', close);
    mask.addEventListener('click', event => { if (event.target === mask) close(); });
    mask.querySelector('header button').focus();
    return close;
}

// 仅推荐当前目录中已登记的视频，随机抽取最多六节，不重复。
export function selectVideoRecommendations(articles, manifest, limit = 6, random = Math.random) {
    const available = articles.filter(article => Object.hasOwn(manifest, article.id));
    for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
    }
    return available.slice(0, limit);
}

export function mountVideoRecommendations(host, { articles, offline = false }) {
    let disposed = false;
    let disposePlayer = () => {};
    let items = [];
    let selectedId = '';
    let manifest = {};

    async function select(id, play = false) {
        selectedId = id;
        disposePlayer();
        disposePlayer = () => {};
        const player = document.createElement('section');
        player.className = 'dk-note-video';
        host.querySelector('.dk-recommended-player').replaceChildren(player);
        host.querySelector('.dk-video-read').href = `#/a/${encodeURIComponent(id)}`;
        host.querySelectorAll('[data-video-id]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.videoId === id)));
        const dispose = await mountNoteVideo(player, id, { offline, autoplay: false, floating: false, showAutoplayToggle: false, preload: 'none' });
        if (disposed || !player.isConnected) { dispose(); return; }
        disposePlayer = dispose;
        if (play) {
            const video = player.querySelector('video');
            if (video) { video.muted = false; video.play().catch(() => {}); }
        }
    }

    function render() {
        host.hidden = false;
        host.closest('.dk-home-layout')?.classList.add('has-videos');
        host.innerHTML = `<header class="dk-video-recommend-head"><div><div class="dk-hud-kicker">VIDEO CLASSROOM</div><h2>视频课堂 <span>${items.length} 节讲解</span></h2></div><button type="button" class="dk-btn ghost small" data-video-shuffle aria-label="随机更换推荐视频">↻ 换一组</button></header>
            <div class="dk-video-recommend-body"><div class="dk-video-recommend-featured"><div class="dk-recommended-player"></div><a class="dk-video-read" href="#/">阅读配套笔记 <span aria-hidden="true">→</span></a></div>
            <div class="dk-video-recommend-list" aria-label="推荐视频">${items.map(article => {
                const meta = manifest[article.id];
                return `<button type="button" class="dk-video-pick" data-video-id="${esc(article.id)}" aria-pressed="false" aria-label="播放：${esc(meta.title || article.title)}"><span class="dk-video-thumb"><img loading="lazy" src="${esc(src(article.id, 'poster', meta, offline))}" alt=""><i aria-hidden="true">▶</i></span><span class="dk-video-pick-copy"><strong>${esc(meta.title || article.title)}</strong><small>${esc(clock(meta.duration || 0))} · 视频讲解</small></span></button>`;
            }).join('')}</div></div>`;
        void select(items[0].id);
    }

    function onClick(event) {
        const pick = event.target.closest('[data-video-id]');
        if (pick) { void select(pick.dataset.videoId, true); return; }
        if (!event.target.closest('[data-video-shuffle]')) return;
        const next = selectVideoRecommendations(articles, manifest);
        if (next.length > 1 && next[0].id === selectedId) next.push(next.shift());
        items = next;
        disposePlayer();
        render();
        host.querySelector('[data-video-shuffle]').focus({ preventScroll: true });
    }
    host.addEventListener('click', onClick);
    loadVideoManifest({ offline }).then(data => {
        if (disposed || !host.isConnected) return;
        manifest = data || {};
        items = selectVideoRecommendations(articles, manifest);
        if (items.length) render();
    });
    return { dispose() { disposed = true; disposePlayer(); host.removeEventListener('click', onClick); } };
}
