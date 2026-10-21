/* 首页右上角平台推广区：内置推广视频 + 推广链接（全局设置 › 平台推广 配置显示与自定义链接）。
 * - 同一时间只有一个推广项在悬浮小窗里显示（视频或链接），其余以横幅显示；点击横幅即互换。
 * - 首次打开优先展示推广链接，之后视频与链接混合随机轮换，一轮内不重复；视频小窗用低码率版本，点击放大高清观看。
 * - 链接：桌面端在屏幕右下角以置顶卡片堆打开（desktop-promo/），小窗显示其实时画面，点击弹出对应大窗；
 *   浏览器端显示封面卡片，点击在固定命名的标签页打开（已打开则直接切换过去），并预连接推广站点。
 * - 链接横幅最多显示 maxLinks 个，超出时每 rotateSeconds 秒轮换。
 * - 关闭小窗可选“仅本次关闭”（下次打开首页还会出现）或“永久关闭”；关闭后全部以横幅保留。
 * - 浏览器拦截带声音自动播放时降级为静音，首次点击页面后恢复声音。
 * - 用户开始使用页面（点击推广区以外的任意位置、聚焦输入框、打开菜单）后，推广区像抽屉一样收起到右侧边缘的小标签；点击标签再抽出。 */
(function () {
    'use strict';
    const STORE_KEY = 'tools.home.promoVideos.dismissed';
    const STORE_VALUE = 'v2';
    const VER = '20261019-02';
    const VIDEOS = {
        rfc: {
            mini: '/assets/promotions/netcare-rfc-ai-guide.mp4?v=' + VER,
            hd: '/assets/promotions/netcare-rfc-ai-guide-hd.mp4?v=' + VER,
            poster: '/assets/promotions/netcare-rfc-ai-guide-poster.jpg?v=' + VER
        },
        incentive: {
            mini: '/assets/promotions/operation-incentive-guide.mp4?v=' + VER,
            hd: '/assets/promotions/operation-incentive-guide-hd.mp4?v=' + VER,
            poster: '/assets/promotions/operation-incentive-guide-poster.jpg?v=' + VER
        },
        eos: {
            mini: '/assets/promotions/eos-report-guide.mp4?v=' + VER,
            hd: '/assets/promotions/eos-report-guide-hd.mp4?v=' + VER,
            poster: '/assets/promotions/eos-report-guide-poster.jpg?v=' + VER
        },
        guide: {
            mini: '/assets/promotions/platform-guide.mp4?v=' + VER,
            hd: '/assets/promotions/platform-guide-hd.mp4?v=' + VER,
            poster: '/assets/promotions/platform-guide-poster.jpg?v=' + VER
        }
    };
    // 英文界面使用英文配音/字幕版本（文件名加 -en）
    const EN_FILES = {
        rfc: { mini: 'netcare-rfc-ai-guide-en.mp4', hd: 'netcare-rfc-ai-guide-en-hd.mp4', poster: 'netcare-rfc-ai-guide-en-poster.jpg' },
        incentive: { mini: 'operation-incentive-guide-en.mp4', hd: 'operation-incentive-guide-en-hd.mp4', poster: 'operation-incentive-guide-en-poster.jpg' },
        eos: { mini: 'eos-report-guide-en.mp4', hd: 'eos-report-guide-en-hd.mp4', poster: 'eos-report-guide-en-poster.jpg' },
        guide: { mini: 'platform-guide-en.mp4', hd: 'platform-guide-en-hd.mp4', poster: 'platform-guide-en-poster.jpg' }
    };
    const isEnglish = () => { try { return /^en/i.test((window.ToolsI18n && window.ToolsI18n.getLanguage && window.ToolsI18n.getLanguage()) || document.documentElement.lang || ''); } catch (_) { return false; } };
    const media = (key, kind) => isEnglish() && EN_FILES[key] ? '/assets/promotions/' + EN_FILES[key][kind] + '?v=' + VER : VIDEOS[key][kind];
    const ORDER = ['rfc', 'incentive', 'eos', 'guide'];
    const ROTATION_KEY = 'tools.home.promotions.rotation';
    const PROMO_API = '/api/platform-promotions';
    const FRAME_INTERVAL_MS = 1000;
    // 后端不可用（静态快照等）时只显示内置视频；推广链接的默认值统一在 backend/platform-promotions-defaults.json
    const DEFAULT_CONFIG = { maxLinks: 3, rotateSeconds: 30, desktopStack: true, videos: ORDER.map(id => ({ id, enabled: true })), links: [] };
    const i18n = window.ToolsI18n;
    if (i18n) i18n.register('home-promo-video', {
        'zh-CN': {
            'home.nrv.rfc.badge': '新功能', 'home.nrv.rfc.name': 'NetCare RFC 方案与 AI 审计', 'home.nrv.rfc.banner': '新功能 · NetCare RFC 方案与 AI 审计介绍',
            'home.nrv.incentive.badge': '核算', 'home.nrv.incentive.name': '操作激励统计：怎么算准每一笔', 'home.nrv.incentive.banner': '核算指南 · 操作激励统计，算得准、对得上',
            'home.nrv.eos.badge': '月报', 'home.nrv.eos.name': 'EOS 风险收编：一键取数，自动成月报', 'home.nrv.eos.banner': '月报指南 · EOS 取数、测算目标、一键成月报',
            'home.nrv.guide.badge': '指南', 'home.nrv.guide.name': 'Dragon 平台五站使用指南', 'home.nrv.guide.banner': '使用指南 · 数据抓取到月报，五站通关',
            'home.nrv.hint': '点击放大高清观看', 'home.nrv.close': '关闭', 'home.nrv.mute': '静音', 'home.nrv.unmute': '开启声音', 'home.nrv.replay': '重新播放',
            'home.nrv.askTitle': '关闭推广小窗？', 'home.nrv.askBody': '仅本次关闭：下次打开首页还会出现；永久关闭：只保留右上角的推广横幅，点击即可观看或打开。',
            'home.nrv.once': '仅本次关闭', 'home.nrv.forever': '永久关闭', 'home.nrv.cancel': '取消',
            'home.nrv.bannerLabel': '观看视频：{name}', 'home.nrv.dialogClose': '关闭视频',
            'home.nrv.tab': '平台推广', 'home.nrv.tabLabel': '展开平台推广',
            'home.nrv.link.badge': '推广', 'home.nrv.link.open': '打开', 'home.nrv.link.bannerLabel': '打开推广页面：{name}',
            'home.nrv.link.hintDesktop': '点击打开大窗浏览', 'home.nrv.link.hintTab': '点击在新标签页打开', 'home.nrv.link.live': '实时画面'
        },
        'en-US': {
            'home.nrv.rfc.badge': 'NEW', 'home.nrv.rfc.name': 'NetCare RFC Plans and AI Audit', 'home.nrv.rfc.banner': 'New · NetCare RFC Plans and AI Audit intro',
            'home.nrv.incentive.badge': 'PAYOUT', 'home.nrv.incentive.name': 'Operation Incentive Statistics: getting every payout right', 'home.nrv.incentive.banner': 'Guide · Operation incentive statistics, accurate and verifiable',
            'home.nrv.eos.badge': 'REPORT', 'home.nrv.eos.name': 'EOS incorporation: one-click data, automatic monthly report', 'home.nrv.eos.banner': 'Guide · EOS data capture, target forecast, one-click report',
            'home.nrv.guide.badge': 'GUIDE', 'home.nrv.guide.name': 'Dragon Platform five-step guide', 'home.nrv.guide.banner': 'Guide · From data capture to monthly reports',
            'home.nrv.hint': 'Click to watch in HD', 'home.nrv.close': 'Close', 'home.nrv.mute': 'Mute', 'home.nrv.unmute': 'Turn sound on', 'home.nrv.replay': 'Replay',
            'home.nrv.askTitle': 'Close the promo window?', 'home.nrv.askBody': 'Close for now: it returns next time you open the home page. Close permanently: only the promo banners stay at the top right.',
            'home.nrv.once': 'Just this time', 'home.nrv.forever': 'Close permanently', 'home.nrv.cancel': 'Cancel',
            'home.nrv.bannerLabel': 'Watch video: {name}', 'home.nrv.dialogClose': 'Close video',
            'home.nrv.tab': 'Promotions', 'home.nrv.tabLabel': 'Show platform promotions',
            'home.nrv.link.badge': 'LINK', 'home.nrv.link.open': 'Open', 'home.nrv.link.bannerLabel': 'Open promoted page: {name}',
            'home.nrv.link.hintDesktop': 'Click to open the full window', 'home.nrv.link.hintTab': 'Click to open in a new tab', 'home.nrv.link.live': 'Live'
        }
    });
    const t = (key, fallback, params) => (i18n && i18n.t ? i18n.t(key, params) : fallback);
    const ICON = {
        play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
        link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
        replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
        on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
        off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6m0-6 6 6"/></svg>'
    };
    function readDismissed() { try { return localStorage.getItem(STORE_KEY) === STORE_VALUE; } catch (_) { return false; } }
    function writeDismissed() { try { localStorage.setItem(STORE_KEY, STORE_VALUE); } catch (_) { /* 存储不可用时仅本次生效 */ } }
    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const authHeaders = () => { try { const token = localStorage.getItem('tools_token'); return token ? { Authorization: 'Bearer ' + token } : {}; } catch (_) { return {}; } };
    const linkText = (link, key) => (isEnglish() && link[key + 'En']) || link[key] || '';
    const linkHost = link => { try { return new URL(link.url).host; } catch (_) { return ''; } };
    // 推广项：视频用视频 key（rfc/eos…），链接用 link:<id>
    const isLink = key => typeof key === 'string' && key.startsWith('link:');
    const nameOf = key => isLink(key) ? linkText(linkOf(key) || {}, 'name') : t('home.nrv.' + key + '.name', key);
    let config = DEFAULT_CONFIG;
    function linkOf(key) { return isLink(key) ? config.links.find(link => 'link:' + link.id === key) || null : null; }
    const enabledVideos = () => ORDER.filter(key => (config.videos.find(video => video.id === key) || { enabled: true }).enabled !== false);
    const enabledLinks = () => config.links.filter(link => link.enabled !== false && link.url);
    // 首次展示第一个已启用链接；后续从视频和链接的洗牌队列取出一项，刷新不丢失进度。
    function nextPromotion() {
        const links = enabledLinks().map(link => 'link:' + link.id);
        const keys = enabledVideos().concat(links);
        if (!keys.length) return null;
        let state;
        try { state = JSON.parse(localStorage.getItem(ROTATION_KEY)); } catch (_) { /* 存储损坏或不可用时重新开始 */ }
        const signature = keys.join('|');
        const shuffle = values => {
            for (let i = values.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [values[i], values[j]] = [values[j], values[i]];
            }
            return values;
        };
        let remaining = state?.signature === signature && Array.isArray(state.remaining)
            ? [...new Set(state.remaining)].filter(key => keys.includes(key)) : [];
        let key;
        if (!state?.last && links.length) {
            key = links[0];
            remaining = shuffle(keys.filter(item => item !== key));
        } else {
            if (!remaining.length) {
                remaining = shuffle([...keys]);
                // 新一轮也避免与上次相同，只有一个可用项时继续展示该项。
                if (remaining.length > 1 && remaining[0] === state?.last) [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
            }
            key = remaining.shift();
        }
        try { localStorage.setItem(ROTATION_KEY, JSON.stringify({ signature, last: key, remaining })); } catch (_) { /* 存储不可用时仍正常展示 */ }
        return key;
    }
    async function api(method, path) {
        const res = await fetch(PROMO_API + path, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, credentials: 'same-origin' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
    }
    // 点击统计：打开视频大窗、浏览器新标签页打开链接时上报（桌面大窗由服务端记录）；失败不影响使用
    function reportClick(kind, id) {
        try {
            fetch(PROMO_API + '/clicks', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ kind, id }) }).catch(() => {});
        } catch (_) { /* noop */ }
    }
    async function loadConfig() {
        try {
            const res = await Promise.race([api('GET', ''), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))]);
            const data = await res.json();
            if (data && Array.isArray(data.links) && Array.isArray(data.videos)) config = data;
        } catch (_) { /* 静态快照或未登录：使用默认配置 */ }
    }

    function init() {
        if (document.getElementById('nrvStack')) return;
        const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const stack = document.createElement('div');
        stack.className = 'nrv-stack'; stack.id = 'nrvStack';
        stack.innerHTML = `
            <div class="nrv-float" id="nrvFloat" hidden>
                <video muted playsinline preload="auto"><source type="video/mp4"></video>
                <div class="nrv-link" hidden>
                    <img class="nrv-link-image" alt="" referrerpolicy="no-referrer" hidden>
                    <div class="nrv-link-cover"><span class="nrv-link-host" data-k="host"></span><strong data-k="linkName"></strong><p data-k="linkDesc"></p><span class="nrv-link-open"><span data-k="linkOpen"></span>${ICON.link}</span></div>
                    <img class="nrv-link-frame" alt="" hidden>
                    <span class="nrv-link-live" hidden><i></i><span data-k="live"></span></span>
                </div>
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
        dlg.innerHTML = '<div class="nrv-dialog-head"><h2><b data-k="dBadge"></b><span data-k="dName"></span></h2><button type="button" class="nrv-dialog-close">×</button></div><video controls playsinline preload="metadata"><source type="video/mp4"></video>';
        const tab = document.createElement('button');
        tab.type = 'button'; tab.className = 'nrv-tab'; tab.id = 'nrvTab'; tab.tabIndex = -1;
        tab.setAttribute('aria-hidden', 'true');
        tab.innerHTML = `<span class="nrv-tab-orb" aria-hidden="true">${ICON.play}<span class="nrv-tab-count"></span></span><span class="nrv-tab-label" data-k="tab"></span>`;
        document.body.append(stack, tab, dlg);

        const float = stack.querySelector('#nrvFloat');
        const bannersBox = stack.querySelector('.nrv-banners');
        const mini = float.querySelector('video');
        const big = dlg.querySelector('video');
        const linkBox = float.querySelector('.nrv-link');
        const frameImg = float.querySelector('.nrv-link-frame');
        const liveBadge = float.querySelector('.nrv-link-live');
        // GitHub Release 下载响应是 octet-stream；Safari 需要 source 的显式媒体类型。
        // 更换 source 子元素后主动 load，保留普通版、高清版及语言切换的加载行为。
        function setSource(video, url) {
            const source = video.querySelector('source');
            if (url) source.setAttribute('src', url); else source.removeAttribute('src');
            video.load();
        }
        const ask = float.querySelector('.nrv-ask');
        const soundBtn = float.querySelector('[data-act="sound"]');
        const replayBtn = float.querySelector('[data-act="replay"]');
        const bar = float.querySelector('.nrv-progress i');
        let current = null;   // 当前在小窗显示的推广项；null 表示小窗已关闭
        let bigKey = null;
        let wantSound = true;
        let ended = false;
        let soundUnlocked = false;
        let wasPlayingBeforeHide = false;
        let previousOverflow = '';
        let tucked = false;
        let resumeOnUntuck = false;
        let desktop = false;   // 桌面端可用：链接在右下角卡片堆打开，首页显示实时画面
        let linkOffset = 0;    // 链接横幅轮换起点
        let rotateTimer = null;
        let frameTimer = null;
        let frameUrl = '';
        let frameBusy = false;

        // 横幅：所有已启用视频 + 最多 maxLinks 个链接（超出时定时轮换）；当前小窗里的项不重复出现
        function visibleLinkKeys() {
            const links = enabledLinks();
            const limit = Math.max(1, Number(config.maxLinks) || 3);
            if (links.length <= limit) return links.map(link => 'link:' + link.id);
            return Array.from({ length: limit }, (_, i) => 'link:' + links[(linkOffset + i) % links.length].id);
        }
        const allKeys = () => enabledVideos().concat(enabledLinks().map(link => 'link:' + link.id));
        function renderSound() {
            const muted = mini.muted;
            soundBtn.innerHTML = muted ? ICON.off : ICON.on;
            const label = muted ? t('home.nrv.unmute', '开启声音') : t('home.nrv.mute', '静音');
            soundBtn.setAttribute('aria-label', label); soundBtn.title = label;
        }
        function bannerHtml(key) {
            if (isLink(key)) {
                const link = linkOf(key);
                const name = linkText(link, 'name');
                return `<button type="button" class="nrv-banner is-link" data-promo="${escapeHtml(key)}" data-color="${escapeHtml(link.color || 'teal')}" aria-label="${escapeHtml(t('home.nrv.link.bannerLabel', '打开推广页面', { name }))}"><b>${escapeHtml(linkText(link, 'badge') || t('home.nrv.link.badge', '推广'))}</b><span>${escapeHtml(name)}${linkText(link, 'description') ? ' · ' + escapeHtml(linkText(link, 'description')) : ''}</span>${ICON.link}</button>`;
            }
            return `<button type="button" class="nrv-banner" data-promo="${key}" data-video="${key}" aria-label="${escapeHtml(t('home.nrv.bannerLabel', '观看视频', { name: nameOf(key) }))}"><b>${t('home.nrv.' + key + '.badge', '')}</b><span>${t('home.nrv.' + key + '.banner', '')}</span>${ICON.play}</button>`;
        }
        function renderBanners() {
            const keys = enabledVideos().concat(visibleLinkKeys()).filter(key => key !== current);
            bannersBox.innerHTML = keys.map(bannerHtml).join('');
            tab.querySelector('.nrv-tab-count').textContent = String(allKeys().length);
            tab.hidden = !allKeys().length;
        }
        function translate() {
            const key = current || enabledVideos()[0] || allKeys()[0] || ORDER[0];
            const link = linkOf(key);
            const map = {
                badge: link ? (linkText(link, 'badge') || t('home.nrv.link.badge', '推广')) : t('home.nrv.' + key + '.badge', ''),
                name: link && linkText(link, 'badge') === linkText(link, 'name') ? '' : nameOf(key),
                hint: link ? (desktop ? t('home.nrv.link.hintDesktop', '点击打开大窗浏览') : t('home.nrv.link.hintTab', '点击在新标签页打开')) : t('home.nrv.hint', '点击放大高清观看'),
                askTitle: t('home.nrv.askTitle', '关闭推广小窗？'), askBody: t('home.nrv.askBody', ''),
                dBadge: bigKey ? t('home.nrv.' + bigKey + '.badge', '') : '', dName: bigKey ? nameOf(bigKey) : '',
                tab: t('home.nrv.tab', '平台推广'),
                host: link ? linkHost(link) : '', linkName: link ? linkText(link, 'name') : '', linkDesc: link ? linkText(link, 'description') : '',
                linkOpen: t('home.nrv.link.open', '打开'), live: t('home.nrv.link.live', '实时画面')
            };
            document.querySelectorAll('#nrvStack [data-k], #nrvDialog [data-k], #nrvTab [data-k]').forEach(el => { el.textContent = map[el.dataset.k] || ''; });
            float.dataset.video = link ? '' : key;
            float.dataset.kind = link ? 'link' : 'video';
            float.dataset.color = link ? (link.color || 'teal') : '';
            const cover = float.querySelector('.nrv-link-image');
            const coverUrl = link?.coverImage || '';
            if ((cover.getAttribute('src') || '') !== coverUrl) {
                cover.hidden = true;
                float.classList.remove('has-link-image');
                cover.onload = () => { cover.hidden = false; float.classList.add('has-link-image'); };
                cover.onerror = () => { cover.hidden = true; float.classList.remove('has-link-image'); };
                if (coverUrl) cover.src = coverUrl;
                else cover.removeAttribute('src');
            }
            float.querySelector('[data-act="close"]').setAttribute('aria-label', t('home.nrv.close', '关闭'));
            float.querySelector('[data-act="once"]').textContent = t('home.nrv.once', '仅本次关闭');
            float.querySelector('[data-act="forever"]').textContent = t('home.nrv.forever', '永久关闭');
            float.querySelector('[data-act="cancel"]').textContent = t('home.nrv.cancel', '取消');
            replayBtn.setAttribute('aria-label', t('home.nrv.replay', '重新播放'));
            dlg.querySelector('.nrv-dialog-close').setAttribute('aria-label', t('home.nrv.dialogClose', '关闭视频'));
            tab.setAttribute('aria-label', t('home.nrv.tabLabel', '展开平台推广')); tab.title = t('home.nrv.tabLabel', '展开平台推广');
            renderSound();
            renderBanners();
        }
        function playMini() {
            if (isLink(current)) return;
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

        // ── 链接：实时画面（桌面端）/ 封面卡片 + 新标签页（浏览器端） ──
        function showFrame(blob) {
            const next = URL.createObjectURL(blob);
            frameImg.onload = () => { if (frameUrl && frameUrl !== next) URL.revokeObjectURL(frameUrl); frameUrl = next; frameImg.hidden = false; liveBadge.hidden = false; };
            frameImg.src = next;
        }
        function clearFrame() {
            frameImg.hidden = true; liveBadge.hidden = true;
            frameImg.removeAttribute('src');
            if (frameUrl) { URL.revokeObjectURL(frameUrl); frameUrl = ''; }
        }
        async function pullFrame() {
            const link = linkOf(current);
            if (!desktop || !link || frameBusy || tucked || document.hidden || float.hidden) return;
            frameBusy = true;
            try {
                const res = await fetch(PROMO_API + '/desktop/frame/' + encodeURIComponent(link.id), { headers: authHeaders(), credentials: 'same-origin', cache: 'no-store' });
                if (linkOf(current) !== link) return;
                if (res.ok) showFrame(await res.blob()); else clearFrame();
            } catch (_) { clearFrame(); } finally { frameBusy = false; }
        }
        function updateFrameLoop() {
            clearInterval(frameTimer); frameTimer = null;
            if (desktop && isLink(current) && !tucked) { pullFrame(); frameTimer = setInterval(pullFrame, FRAME_INTERVAL_MS); }
        }
        // 浏览器端：固定命名的标签页；已打开过就切换过去，不重复打开、不重新加载
        function openInTab(link) {
            reportClick('link', link.id);
            const name = 'tools-promo-' + link.id.replace(/[^a-zA-Z0-9_-]/g, '_');
            const win = window.open('', name);
            if (!win) { window.open(link.url, '_blank', 'noopener'); return; }
            let fresh = false;
            try { fresh = win.location.href === 'about:blank'; } catch (_) { fresh = false; /* 已是跨域推广页：直接切换过去 */ }
            if (fresh) { try { win.opener = null; } catch (_) { /* noop */ } win.location.replace(link.url); }
            try { win.focus(); } catch (_) { /* noop */ }
        }
        async function openLink(key) {
            const link = linkOf(key);
            if (!link) return;
            if (desktop) {
                try { await api('POST', '/desktop/open/' + encodeURIComponent(link.id)); return; } catch (_) { /* 桌面窗口不可用时退回新标签页 */ }
            }
            openInTab(link);
        }
        function preconnect() {
            if (desktop) return;
            enabledLinks().forEach(link => {
                let origin = '';
                try { origin = new URL(link.url).origin; } catch (_) { return; }
                if (document.head.querySelector(`link[rel="preconnect"][href="${CSS.escape(origin)}"]`)) return;
                const hint = document.createElement('link');
                hint.rel = 'preconnect'; hint.href = origin;
                document.head.appendChild(hint);
            });
        }
        async function connectDesktop() {
            try {
                const res = await api('GET', '/desktop');
                const status = await res.json();
                desktop = !!(status && status.available);
                // 登录后打开 / 更新右下角卡片堆
                if (desktop && config.desktopStack !== false) await api('POST', '/desktop/sync').catch(() => {});
            } catch (_) { desktop = false; }
            translate();
            updateFrameLoop();
            preconnect();
        }
        function scheduleRotation() {
            clearInterval(rotateTimer); rotateTimer = null;
            const links = enabledLinks();
            if (links.length <= Math.max(1, Number(config.maxLinks) || 3)) return;
            rotateTimer = setInterval(() => {
                if (tucked || document.hidden || stack.matches(':hover') || !ask.hidden) return;
                linkOffset = (linkOffset + 1) % enabledLinks().length;
                renderBanners();
            }, Math.max(10, Number(config.rotateSeconds) || 30) * 1000);
        }

        // 首次进入：9 秒后自动收起；垂直位置由 CSS 跟随对话状态。
        const tuckTimer = setTimeout(() => {
            if (!dlg.open && ask.hidden && !stack.matches(':hover') && !stack.contains(document.activeElement)) tuck();
        }, 9000);
        function cancelAutoTuck() {
            clearTimeout(tuckTimer);
        }
        stack.addEventListener('pointerdown', cancelAutoTuck);
        stack.addEventListener('focusin', cancelAutoTuck);
        // 抽屉：收起到右侧边缘标签 / 从标签抽出
        function tuck() {
            if (tucked) return;
            cancelAutoTuck();
            tucked = true;
            resumeOnUntuck = !!current && !isLink(current) && !mini.paused && !ended;
            try { mini.pause(); } catch (_) { /* noop */ }
            if (!ask.hidden) ask.hidden = true;
            stack.classList.add('is-tucked'); stack.setAttribute('aria-hidden', 'true'); stack.inert = true;
            tab.classList.add('is-shown'); tab.setAttribute('aria-hidden', 'false'); tab.tabIndex = 0;
            updateFrameLoop();
        }
        function untuck() {
            if (!tucked) return;
            tucked = false;
            stack.classList.remove('is-tucked'); stack.removeAttribute('aria-hidden'); stack.inert = false;
            tab.classList.remove('is-shown'); tab.setAttribute('aria-hidden', 'true'); tab.tabIndex = -1;
            updateFrameLoop();
            // 点击标签本身就是用户手势：恢复播放时可以带声音
            if (current && !isLink(current) && !ended && (resumeOnUntuck || mini.paused)) { mini.muted = !wantSound; soundBtn.classList.remove('is-hint'); renderSound(); mini.play().catch(() => {}); }
        }
        const isOwn = target => !!(target && target.closest && (target.closest('#nrvStack') || target.closest('#nrvTab') || target.closest('#nrvDialog')));
        // 点在推广区内 → 解锁声音；点在别处（Dragon Claw 输入框、菜单、页面任意位置）或在输入框里打字 → 收起抽屉
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
            if (current && !isLink(current) && !tucked && wantSound && mini.muted && !dlg.open && ask.hidden) {
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

        // 切换小窗显示的推广项（横幅点击时调用）；视频从头播放，链接显示实时画面或封面
        function setCurrent(key) {
            current = key;
            ended = false; replayBtn.hidden = true; ask.hidden = true; bar.style.width = '0%';
            clearFrame();
            if (!key) { try { mini.pause(); } catch (_) { /* noop */ } setSource(mini, ''); float.hidden = true; translate(); updateFrameLoop(); return; }
            const link = isLink(key);
            mini.hidden = link; linkBox.hidden = !link;
            if (link) {
                try { mini.pause(); } catch (_) { /* noop */ }
                if (mini.querySelector('source').getAttribute('src')) setSource(mini, '');
                mini.removeAttribute('poster');
            } else {
                mini.poster = media(key, 'poster');
                setSource(mini, media(key, 'mini'));
            }
            float.hidden = false;
            float.classList.remove('nrv-swap'); void float.offsetWidth; float.classList.add('nrv-swap');
            translate();
            updateFrameLoop();
            playMini();
        }
        // 大窗：始终加载高清版并从头播放
        function openBig(key) {
            if (dlg.open || !key || isLink(key)) return;
            reportClick('video', key);
            bigKey = key;
            try { mini.pause(); } catch (_) { /* noop */ }
            big.poster = media(key, 'poster');
            if (big.querySelector('source').getAttribute('src') !== media(key, 'hd')) setSource(big, media(key, 'hd'));
            translate();
            previousOverflow = document.body.style.overflow;
            dlg.showModal(); document.body.style.overflow = 'hidden';
            const start = () => { try { big.currentTime = 0; } catch (_) { /* noop */ } big.muted = false; big.play().catch(() => {}); };
            if (big.readyState >= 1) start(); else big.addEventListener('loadedmetadata', start, { once: true });
        }
        function closeBig() { if (dlg.open) dlg.close(); }

        mini.addEventListener('click', () => openBig(current));
        linkBox.addEventListener('click', () => openLink(current));
        bannersBox.addEventListener('click', event => {
            const key = event.target.closest('[data-promo]')?.dataset.promo;
            if (!key) return;
            if (current) { wantSound = true; setCurrent(key); }           // 小窗开着：横幅与小窗互换
            else if (isLink(key)) openLink(key);                          // 小窗已关闭：链接直接打开
            else openBig(key);                                            // 小窗已关闭：视频直接大窗观看
        });
        float.addEventListener('click', event => {
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (!act) return;
            event.stopPropagation();
            if (act === 'close') { try { mini.pause(); } catch (_) { /* noop */ } ask.hidden = false; ask.querySelector('[data-act="once"]').focus(); }
            else if (act === 'cancel') { ask.hidden = true; if (!isLink(current) && !ended && mini.paused) mini.play().catch(() => {}); }
            else if (act === 'once') { setCurrent(null); }
            else if (act === 'forever') { writeDismissed(); setCurrent(null); }
            else if (act === 'sound') { mini.muted = !mini.muted; wantSound = !mini.muted; soundBtn.classList.remove('is-hint'); renderSound(); if (mini.paused && !ended && ask.hidden) mini.play().catch(() => {}); }
            else if (act === 'replay') { ended = false; replayBtn.hidden = true; mini.currentTime = 0; mini.play().catch(() => {}); }
        });
        float.addEventListener('keydown', event => { if (event.key === 'Escape' && !ask.hidden) { ask.hidden = true; if (!isLink(current) && !ended) mini.play().catch(() => {}); } });
        mini.addEventListener('timeupdate', () => { if (mini.duration) bar.style.width = (mini.currentTime / mini.duration * 100) + '%'; });
        mini.addEventListener('ended', () => { ended = true; replayBtn.hidden = false; });
        mini.addEventListener('error', () => { if (mini.querySelector('source').getAttribute('src') && !float.querySelector('.nrv-load-status')) float.hidden = true; }, true);
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
            if (current && !isLink(current) && ask.hidden && !ended && !tucked) { mini.muted = true; wantSound = false; renderSound(); mini.play().catch(() => {}); }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { wasPlayingBeforeHide = !mini.paused; if (wasPlayingBeforeHide) mini.pause(); }
            else {
                if (wasPlayingBeforeHide && current && !isLink(current) && !tucked && !dlg.open && ask.hidden && !ended) mini.play().catch(() => {});
                if (isLink(current)) pullFrame();
            }
        });
        window.addEventListener('tools:languagechange', () => {
            translate();
            // 语言切换后换成对应语言的视频（重新从头播放）
            if (dlg.open && bigKey) { big.poster = media(bigKey, 'poster'); setSource(big, media(bigKey, 'hd')); big.play().catch(() => {}); }
            else if (current && !isLink(current) && !float.hidden) { const was = !mini.paused; mini.poster = media(current, 'poster'); setSource(mini, media(current, 'mini')); ended = false; replayBtn.hidden = true; bar.style.width = '0%'; if (was) mini.play().catch(() => {}); }
        });
        // 全局设置保存后即时生效
        window.addEventListener('tools:platform-promotions-changed', event => {
            if (event.detail && Array.isArray(event.detail.links)) config = event.detail;
            if (current && !allKeys().includes(current)) setCurrent(readDismissed() ? null : nextPromotion());
            else translate();
            scheduleRotation();
            preconnect();
        });

        translate();
        loadConfig().then(() => {
            setCurrent(readDismissed() ? null : nextPromotion());
            scheduleRotation();
            connectDesktop();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
