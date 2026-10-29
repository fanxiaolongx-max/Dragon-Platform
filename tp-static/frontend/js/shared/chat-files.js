/**
 * 对话里的文件与图片：Agent / 微信 / WeLink / 我的对话 共用。
 * - Markdown 渲染时把本机文件路径、:codex-file-citation{path=...}、[名称](</本机/路径>) 变成带下载按钮的文件卡片；
 * - ![说明](地址) 和图片路径直接显示成图片，点击放大预览（滚轮缩放、拖拽、左右切换、下载）；
 * - 文件经 /api/agent-files 读取（后端按本机/管理员/outputs 目录校验权限）。
 */
(function () {
    if (window.ChatFiles) return;

    const LOCAL_PATH_RE = /^(?:file:\/\/)?(?:~\/|\/(?:Volumes|Users|private|tmp|home|var|opt|mnt|srv|data|root|Applications|workspace)\/|[A-Za-z]:[\\/])/;
    const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'];
    // 正文里不带链接的裸路径只认常见产出物扩展名，避免把普通文字误判成文件
    const BARE_EXT = [...IMAGE_EXT, 'pdf', 'xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'docx', 'doc', 'pptx', 'ppt', 'zip', '7z', 'rar', 'gz', 'tgz', 'html', 'htm', 'md', 'txt', 'json', 'log', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a'];
    const BARE_PATH_RE = new RegExp(String.raw`(^|[\s(（:：，,、"“'])((?:~\/|\/(?:Volumes|Users|private|tmp|home|var|opt|mnt|srv|data|root|Applications|workspace)\/)[^\s<>"'\`，。；、（）()\[\]{}|]*?\.(?:${BARE_EXT.join('|')}))((?::\d+){0,2})(?=$|[\s，。；、）),.:;!?！？"”'])`, 'gi');

    const lang = () => String(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
    const T = { zh: { download: '下载', open: '打开', missing: '文件不存在或无权限', close: '关闭', prev: '上一张', next: '下一张', reset: '原始大小', preview: '点击放大' }, en: { download: 'Download', open: 'Open', missing: 'Missing or no access', close: 'Close', prev: 'Previous', next: 'Next', reset: 'Reset zoom', preview: 'Click to zoom' } };
    const t = key => T[lang()][key];

    function esc(value) {
        return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function unwrap(href) {
        const value = String(href || '').trim();
        return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1).trim() : value;
    }
    /** 去掉引用里的行号（a.md:55、a.md:55:3、a.md#L55），只留文件路径 */
    function cleanPath(value) {
        return String(value || '').replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/(\.[A-Za-z0-9]{1,8}):\d+(?::\d+)?$/, '$1');
    }
    function isLocalFile(value) {
        const clean = cleanPath(unwrap(value));
        return LOCAL_PATH_RE.test(clean) && /\.[A-Za-z0-9]{1,8}$/.test(clean.split(/[\\/]/).pop() || '');
    }
    function extOf(value) {
        const name = cleanPath(value).split(/[\\/]/).pop() || '';
        return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    }
    const isImage = value => IMAGE_EXT.includes(extOf(String(value).split(/[?#]/)[0]));
    const baseName = value => cleanPath(value).split(/[\\/]/).pop() || value;
    function fileUrl(filePath, download) {
        return `/api/agent-files/raw?path=${encodeURIComponent(cleanPath(filePath))}${download ? '&download=1' : ''}`;
    }

    function chipHtml(rawPath, label) {
        const filePath = cleanPath(unwrap(rawPath));
        if (isImage(filePath)) return imageHtml(fileUrl(filePath), label || baseName(filePath), fileUrl(filePath, true), baseName(filePath));
        const name = baseName(filePath);
        const ext = extOf(filePath);
        const text = label && label !== filePath ? label : name;
        return `<span class="ai-file-chip" data-ai-file="${esc(filePath)}" data-ext="${esc(ext)}"><span class="ai-file-chip-icon" aria-hidden="true">${esc((ext || 'file').slice(0, 4).toUpperCase())}</span><span class="ai-file-chip-text"><a class="ai-file-chip-name" href="${esc(fileUrl(filePath))}" target="_blank" rel="noopener" title="${esc(String(rawPath))}">${esc(text)}</a><span class="ai-file-chip-meta">${esc(text === name ? '' : name)}</span></span><a class="ai-file-chip-download" href="${esc(fileUrl(filePath, true))}" download="${esc(name)}" title="${esc(t('download'))} ${esc(name)}" aria-label="${esc(t('download'))} ${esc(name)}"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/></svg><span>${esc(t('download'))}</span></a></span>`;
    }

    function imageHtml(src, alt, downloadHref, name) {
        const label = alt || name || '';
        return `<span class="ai-md-image"><img src="${esc(src)}" alt="${esc(label)}" loading="lazy" data-ai-zoom="1" data-download="${esc(downloadHref || src)}" data-name="${esc(name || label || 'image')}" title="${esc(t('preview'))}"></span>`;
    }

    /** 站外/站内图片地址：只放行 http(s)、站内绝对路径和 data:image */
    function imageSourceHtml(rawSrc, alt) {
        const src = unwrap(rawSrc);
        if (isLocalFile(src)) return imageHtml(fileUrl(src), alt || baseName(src), fileUrl(src, true), baseName(src));
        if (/^https?:\/\//i.test(src) || /^\/(?!\/)/.test(src) || /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(src)) return imageHtml(src, alt, src, alt || baseName(src.split(/[?#]/)[0]));
        return null;
    }

    function parseAttrs(text) {
        const attrs = {};
        String(text || '').replace(/([\w-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g, (_m, key, value) => { attrs[key] = value.replace(/\\(.)/g, '$1'); return ''; });
        return attrs;
    }

    /**
     * 行内渲染前处理：文件引用指令、图片、本机文件链接、反引号路径、裸路径 → 先换成占位符（keep 返回占位符）。
     * 返回处理后的原文；剩下的文字照常转义。
     */
    function transformInline(source, keep) {
        let text = String(source || '');
        // Codex 桌面版的文件引用：:codex-file-citation{path="..." artifact_kind="workbook"}
        text = text.replace(/:{1,3}[\w-]*file-citation\{([^{}\n]*)\}/g, (match, body) => {
            const attrs = parseAttrs(body);
            return attrs.path ? keep(chipHtml(attrs.path, attrs.title || attrs.label || '')) : match;
        });
        // 反引号先整体占位：路径变卡片，其余保持代码样式，免得里面的 [..](..) 被当成链接
        text = text.replace(/`([^`\n]+)`/g, (_match, code) => keep(isLocalFile(code.trim()) ? chipHtml(code.trim()) : `<code>${esc(code)}</code>`));
        text = text.replace(/!\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\)/g, (match, alt, src) => {
            const html = imageSourceHtml(src, alt);
            return html ? keep(html) : match;
        });
        text = text.replace(/\[([^\]\n]+)\]\((<[^>\n]+>|[^\s)]+)\)/g, (match, label, href) => isLocalFile(href) ? keep(chipHtml(unwrap(href), label)) : match);
        text = text.replace(BARE_PATH_RE, (_match, lead, filePath, line) => `${lead}${keep(chipHtml(filePath + line))}`);
        return text;
    }

    // —— 文件卡片补充大小、标记失效 ——
    const statCache = new Map();
    function stat(filePath) {
        const hit = statCache.get(filePath);
        if (hit && Date.now() - hit.at < 60000) return hit.promise;
        const promise = fetch(`/api/agent-files/stat?path=${encodeURIComponent(filePath)}`, { credentials: 'same-origin', cache: 'no-store', headers: authHeaders() })
            .then(response => response.ok ? response.json() : response.json().catch(() => ({})).then(data => ({ error: data.error || t('missing') })))
            .catch(() => ({ error: t('missing') }));
        statCache.set(filePath, { at: Date.now(), promise });
        return promise;
    }
    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }
    function formatSize(bytes) {
        if (!Number.isFinite(bytes)) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    function hydrate(root) {
        (root || document).querySelectorAll?.('.ai-file-chip:not([data-hydrated])').forEach(chip => {
            chip.dataset.hydrated = '1';
            stat(chip.dataset.aiFile).then(info => {
                const meta = chip.querySelector('.ai-file-chip-meta');
                if (info.error) {
                    chip.classList.add('is-missing');
                    chip.title = info.error;
                    if (meta) meta.textContent = info.error;
                    return;
                }
                if (meta) meta.textContent = [meta.textContent, formatSize(info.size)].filter(Boolean).join(' · ');
            });
        });
    }

    // —— 图片放大预览 ——
    let viewer = null;
    function buildViewer() {
        const node = document.createElement('div');
        node.className = 'ai-lightbox';
        node.setAttribute('role', 'dialog');
        node.setAttribute('aria-modal', 'true');
        node.hidden = true;
        node.innerHTML = `<div class="ai-lightbox-stage"><img alt=""></div>
            <div class="ai-lightbox-bar">
                <span class="ai-lightbox-name"></span>
                <span class="ai-lightbox-count"></span>
                <button type="button" data-lb="prev" aria-label="${esc(t('prev'))}">‹</button>
                <button type="button" data-lb="next" aria-label="${esc(t('next'))}">›</button>
                <button type="button" data-lb="reset">${esc(t('reset'))}</button>
                <a data-lb="open" target="_blank" rel="noopener">${esc(t('open'))}</a>
                <a data-lb="download" download>${esc(t('download'))}</a>
                <button type="button" data-lb="close" aria-label="${esc(t('close'))}">✕</button>
            </div>`;
        document.body.appendChild(node);
        const img = node.querySelector('.ai-lightbox-stage img');
        const state = { list: [], index: 0, scale: 1, x: 0, y: 0, drag: null };
        const apply = () => { img.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`; };
        const reset = () => { state.scale = 1; state.x = 0; state.y = 0; apply(); };
        function show(index) {
            state.index = (index + state.list.length) % state.list.length;
            const source = state.list[state.index];
            img.src = source.currentSrc || source.src;
            img.alt = source.alt || '';
            node.querySelector('.ai-lightbox-name').textContent = source.dataset.name || source.alt || '';
            node.querySelector('.ai-lightbox-count').textContent = state.list.length > 1 ? `${state.index + 1} / ${state.list.length}` : '';
            node.querySelectorAll('[data-lb="prev"],[data-lb="next"]').forEach(button => { button.hidden = state.list.length < 2; });
            const download = node.querySelector('[data-lb="download"]');
            download.href = source.dataset.download || source.src;
            download.setAttribute('download', source.dataset.name || '');
            node.querySelector('[data-lb="open"]').href = source.src;
            reset();
        }
        function close() {
            node.hidden = true;
            document.removeEventListener('keydown', onKey, true);
            state.opener?.focus?.({ preventScroll: true });
        }
        function onKey(event) {
            if (node.hidden) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
            else if (event.key === 'ArrowLeft' && state.list.length > 1) show(state.index - 1);
            else if (event.key === 'ArrowRight' && state.list.length > 1) show(state.index + 1);
        }
        node.addEventListener('click', event => {
            const action = event.target.closest('[data-lb]')?.dataset.lb;
            if (action === 'close') close();
            else if (action === 'prev') show(state.index - 1);
            else if (action === 'next') show(state.index + 1);
            else if (action === 'reset') reset();
            else if (!action && event.target === node.querySelector('.ai-lightbox-stage')) close();
        });
        node.addEventListener('wheel', event => {
            if (!event.target.closest('.ai-lightbox-stage')) return;
            event.preventDefault();
            state.scale = Math.min(8, Math.max(0.2, state.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
            apply();
        }, { passive: false });
        img.addEventListener('dblclick', () => { if (state.scale === 1) { state.scale = 2; apply(); } else reset(); });
        img.addEventListener('pointerdown', event => {
            event.preventDefault();
            state.drag = { id: event.pointerId, x: event.clientX - state.x, y: event.clientY - state.y };
            img.setPointerCapture(event.pointerId);
        });
        img.addEventListener('pointermove', event => {
            if (!state.drag || state.drag.id !== event.pointerId) return;
            state.x = event.clientX - state.drag.x;
            state.y = event.clientY - state.drag.y;
            apply();
        });
        const endDrag = () => { state.drag = null; };
        img.addEventListener('pointerup', endDrag);
        img.addEventListener('pointercancel', endDrag);
        return {
            open(source) {
                const scope = source.closest('.dc-msg, .ai-msg, .wl-detail, .dc-msg-body') || document;
                state.list = [...scope.querySelectorAll('img[data-ai-zoom]')];
                if (!state.list.includes(source)) state.list = [source];
                state.opener = source;
                node.hidden = false;
                show(state.list.indexOf(source));
                document.addEventListener('keydown', onKey, true);
                node.querySelector('[data-lb="close"]').focus({ preventScroll: true });
            }
        };
    }

    document.addEventListener('click', event => {
        const img = event.target.closest?.('img[data-ai-zoom]');
        if (!img || event.button !== 0) return;
        event.preventDefault();
        (viewer ||= buildViewer()).open(img);
    });
    // 图片加载失败（文件不存在或无权限）时换成提示，避免碎图
    document.addEventListener('error', event => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || !img.matches('img[data-ai-zoom]')) return;
        const wrap = img.closest('.ai-md-image');
        if (wrap) { wrap.classList.add('is-missing'); wrap.textContent = `🖼 ${img.dataset.name || img.alt || ''} · ${t('missing')}`; }
    }, true);

    new MutationObserver(records => {
        if (records.some(record => record.addedNodes.length)) hydrate(document);
    }).observe(document.documentElement, { childList: true, subtree: true });

    const style = document.createElement('style');
    style.textContent = `
        .ai-file-chip { display: inline-flex; align-items: center; gap: 10px; max-width: 100%; margin: 4px 2px; padding: 8px 8px 8px 10px; border-radius: 12px; border: 1px solid rgba(125, 211, 252, 0.28); background: rgba(14, 165, 233, 0.08); vertical-align: middle; box-sizing: border-box; line-height: 1.3; }
        .ai-file-chip-icon { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .02em; color: #fff; background: #64748b; }
        .ai-file-chip[data-ext^="xls"] .ai-file-chip-icon, .ai-file-chip[data-ext="csv"] .ai-file-chip-icon, .ai-file-chip[data-ext="tsv"] .ai-file-chip-icon { background: #16a34a; }
        .ai-file-chip[data-ext^="doc"] .ai-file-chip-icon, .ai-file-chip[data-ext="md"] .ai-file-chip-icon, .ai-file-chip[data-ext="txt"] .ai-file-chip-icon { background: #2563eb; }
        .ai-file-chip[data-ext^="ppt"] .ai-file-chip-icon { background: #ea580c; }
        .ai-file-chip[data-ext="pdf"] .ai-file-chip-icon { background: #dc2626; }
        .ai-file-chip[data-ext="zip"] .ai-file-chip-icon, .ai-file-chip[data-ext="7z"] .ai-file-chip-icon, .ai-file-chip[data-ext="rar"] .ai-file-chip-icon, .ai-file-chip[data-ext="gz"] .ai-file-chip-icon { background: #a16207; }
        .ai-file-chip-text { display: flex; flex-direction: column; min-width: 0; }
        .ai-file-chip a.ai-file-chip-name { color: inherit; font-weight: 600; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch; }
        .ai-file-chip a.ai-file-chip-name:hover { text-decoration: underline; }
        .ai-file-chip-meta { font-size: 12px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch; }
        .ai-file-chip-meta:empty { display: none; }
        .ai-file-chip a.ai-file-chip-download { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; text-decoration: none; color: #0c4a6e; background: #7dd3fc; }
        .ai-file-chip a.ai-file-chip-download:hover { background: #bae6fd; }
        .ai-file-chip.is-missing { opacity: .6; border-style: dashed; }
        .ai-file-chip.is-missing a.ai-file-chip-download { pointer-events: none; opacity: .5; }
        .ai-md-image { display: inline-block; max-width: 100%; margin: 6px 0; vertical-align: top; }
        .ai-md-image img { display: block; max-width: min(100%, 520px); max-height: 360px; border-radius: 10px; border: 1px solid rgba(148, 163, 184, .3); cursor: zoom-in; object-fit: contain; background: rgba(148, 163, 184, .08); }
        .ai-md-image.is-missing { padding: 8px 12px; border-radius: 10px; border: 1px dashed rgba(148, 163, 184, .5); font-size: 13px; opacity: .7; }
        .ai-lightbox { position: fixed; inset: 0; z-index: 2147483000; background: rgba(2, 6, 23, .9); display: flex; flex-direction: column; }
        .ai-lightbox[hidden] { display: none; }
        .ai-lightbox-stage { flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; cursor: zoom-out; }
        .ai-lightbox-stage img { max-width: 92vw; max-height: calc(100vh - 96px); object-fit: contain; cursor: grab; user-select: none; touch-action: none; transition: transform .06s linear; border-radius: 6px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
        .ai-lightbox-stage img:active { cursor: grabbing; }
        .ai-lightbox-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); color: #e2e8f0; font-size: 13px; background: rgba(15, 23, 42, .85); border-top: 1px solid rgba(148, 163, 184, .2); }
        .ai-lightbox-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ai-lightbox-count { opacity: .7; }
        .ai-lightbox-bar button, .ai-lightbox-bar a { min-height: 34px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, .35); background: rgba(30, 41, 59, .9); color: #e2e8f0; font: inherit; text-decoration: none; display: inline-flex; align-items: center; cursor: pointer; }
        .ai-lightbox-bar button:hover, .ai-lightbox-bar a:hover { background: rgba(51, 65, 85, .95); }
        .ai-lightbox-bar a[data-lb="download"] { background: #7dd3fc; color: #0c4a6e; border-color: transparent; font-weight: 600; }
        .ai-lightbox-bar [hidden] { display: none; }
    `;
    document.head.appendChild(style);

    window.ChatFiles = { transformInline, chipHtml, imageHtml, isLocalFile, cleanPath, fileUrl, hydrate };
})();
