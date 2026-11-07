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
    const TEXT_EXT = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'xml', 'sql', 'ndjson', 'html', 'htm', 'py', 'js', 'ts', 'sh', 'ps1', 'css', 'jsx', 'tsx', 'vue', 'svelte', 'toml', 'ini', 'cfg', 'conf', 'c', 'h', 'cpp', 'hpp', 'java', 'kt', 'kts', 'swift', 'rb', 'go', 'rs', 'r', 'lua', 'bash', 'zsh']);
    // 正文里不带链接的裸路径只认常见产出物扩展名，避免把普通文字误判成文件
    const BARE_EXT = [...IMAGE_EXT, ...TEXT_EXT, 'pdf', 'xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'docx', 'doc', 'pptx', 'ppt', 'zip', '7z', 'rar', 'gz', 'tgz', 'html', 'htm', 'md', 'txt', 'json', 'log', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a'];
    const BARE_PATH_RE = new RegExp(String.raw`(^|[\s(（:：，,、"“'])((?:~\/|\/(?:Volumes|Users|private|tmp|home|var|opt|mnt|srv|data|root|Applications|workspace)\/)[^\s<>"'\`，。；、（）()\[\]{}|]*?\.(?:${BARE_EXT.join('|')}))((?::\d+){0,2})(?=$|[\s，。；、）),.:;!?！？"”'])`, 'gi');

    const lang = () => String(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
    const T = {
        zh: {
            download: '下载', open: '打开', missing: '文件不存在或无权限', close: '关闭',
            prev: '上一张', next: '下一张', reset: '原始大小', preview: '点击放大',
            filePreview: '文件预览', loading: '正在读取…',
            unsupported: '此类型暂不支持内嵌预览，请下载查看', tooLarge: '文件超过 5 MB，请下载查看',
            resize: '拖动调整预览宽度（方向键微调）',
            tabPreview: '预览', tabCode: '源码', tabDiff: '对比',
            diffEmpty: '当前文件与基准版本一致，暂无改动差异',
            diffLoading: '正在读取版本差异…'
        },
        en: {
            download: 'Download', open: 'Open', missing: 'Missing or no access', close: 'Close',
            prev: 'Previous', next: 'Next', reset: 'Reset zoom', preview: 'Click to zoom',
            filePreview: 'File preview', loading: 'Loading…',
            unsupported: 'Preview is unavailable for this file type. Download to view it.', tooLarge: 'File exceeds 5 MB. Download to view it.',
            resize: 'Drag to resize preview (arrow keys to adjust)',
            tabPreview: 'Preview', tabCode: 'Source', tabDiff: 'Diff',
            diffEmpty: 'No changes against baseline.',
            diffLoading: 'Comparing versions…'
        }
    };
    const t = key => T[lang()][key] || key;

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
        // 扩展名前要有文件名：~/.ssh、.config 这类以点开头的隐藏目录不是文件
        return LOCAL_PATH_RE.test(clean) && /[^.\\/]\.[A-Za-z0-9]{1,8}$/.test(clean.split(/[\\/]/).pop() || '');
    }
    function extOf(value) {
        const name = cleanPath(value).split(/[\\/]/).pop() || '';
        return name.lastIndexOf('.') > 0 ? name.split('.').pop().toLowerCase() : '';
    }
    const isImage = value => IMAGE_EXT.includes(extOf(String(value).split(/[?#]/)[0]));
    const baseName = value => cleanPath(value).split(/[\\/]/).pop() || value;
    function fileUrl(filePath, download) {
        return `/api/agent-files/raw?path=${encodeURIComponent(cleanPath(filePath))}${download ? '&download=1' : ''}`;
    }

    function fileCategoryOf(ext) {
        const e = String(ext || '').toLowerCase();
        if (/^(xlsx?|csv|tsv|xlsm|ods|numbers)$/.test(e)) return 'sheet';
        if (/^(docx?|wps|odt|rtf|pages)$/.test(e)) return 'doc';
        if (/^(pptx?|key|odp)$/.test(e)) return 'slide';
        if (e === 'pdf') return 'pdf';
        if (/^(md|markdown|mdown)$/.test(e)) return 'md';
        if (/^(py|js|ts|jsx|tsx|html|htm|css|scss|sass|less|vue|svelte|sh|bash|zsh|sql|java|c|cpp|h|hpp|cs|go|rs|php|rb|swift|kt|kts|lua|pl|r)$/.test(e)) return 'code';
        if (/^(json|ya?ml|xml|toml|ini|cfg|conf|env|properties)$/.test(e)) return 'data';
        if (/^(db|sqlite3?|parquet|duckdb)$/.test(e)) return 'db';
        if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz|iso)$/.test(e)) return 'zip';
        if (/^(png|jpe?g|gif|webp|svg|ico|bmp|avif|tiff?)$/.test(e)) return 'image';
        if (/^(mp4|mov|webm|mkv|avi|mp3|wav|flac|m4a|aac|ogg)$/.test(e)) return 'media';
        if (/^(txt|log|out|err)$/.test(e)) return 'text';
        return 'unknown';
    }

    function fileIconSvg(ext) {
        const cat = fileCategoryOf(ext);
        let glyph = '';
        switch (cat) {
            case 'sheet':
                glyph = '<rect x="11" y="14" width="10" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11 17H21M11 20H21" stroke="currentColor" stroke-width="1.1"/><path d="M15.5 14V23" stroke="currentColor" stroke-width="1.1"/>';
                break;
            case 'doc':
                glyph = '<path d="M11 14H17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 17.5H21" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11 20.5H21" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11 23.5H16" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>';
                break;
            case 'slide':
                glyph = '<rect x="10.5" y="13.5" width="11" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M13 19V17M16 19V15.5M19 19V16.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M13.5 24.5L16 21.5L18.5 24.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>';
                break;
            case 'pdf':
                glyph = '<rect x="10.5" y="14.5" width="11" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><text x="16" y="21" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="5.5" font-weight="900" text-anchor="middle" fill="currentColor">PDF</text>';
                break;
            case 'md':
                glyph = '<path d="M10.5 21V15L12.5 17.5L14.5 15V21" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M18.5 15V21M16.5 19L18.5 21L20.5 19" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>';
                break;
            case 'code':
                glyph = '<path d="M13.5 15L11 18.5L13.5 22" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 15L21 18.5L18.5 22" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 14L15 23" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>';
                break;
            case 'data':
                glyph = '<path d="M13.5 14.5C12.5 14.5 12 15.3 12 16.5C12 17.5 11 18 10.5 18.5C11 19 12 19.5 12 20.5C12 21.7 12.5 22.5 13.5 22.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/><path d="M18.5 14.5C19.5 14.5 20 15.3 20 16.5C20 17.5 21 18 21.5 18.5C21 19 20 19.5 20 20.5C20 21.7 19.5 22.5 18.5 22.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>';
                break;
            case 'db':
                glyph = '<ellipse cx="16" cy="14.5" rx="5" ry="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11 14.5V18.5C11 19.6 13.2 20.5 16 20.5C18.8 20.5 21 19.6 21 18.5V14.5" stroke="currentColor" stroke-width="1.3"/><path d="M11 18.5V22.5C11 23.6 13.2 24.5 16 24.5C18.8 24.5 21 23.6 21 22.5V18.5" stroke="currentColor" stroke-width="1.3"/>';
                break;
            case 'zip':
                glyph = '<path d="M14.5 13H17.5M14.5 15H17.5M14.5 17H17.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="14" y="18.5" width="4" height="4" rx="0.8" fill="currentColor"/><path d="M16 22.5V25" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>';
                break;
            case 'image':
                glyph = '<circle cx="18.5" cy="15.5" r="1.3" fill="currentColor"/><path d="M11 22.5L14.5 18L16.8 20.5L18.5 19L21 22.5H11Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>';
                break;
            case 'media':
                glyph = '<circle cx="16" cy="18.5" r="4.8" fill="none" stroke="currentColor" stroke-width="1.3"/><polygon points="14.8,16.5 18.2,18.5 14.8,20.5" fill="currentColor"/>';
                break;
            case 'text':
                glyph = '<path d="M11 15H21M11 18H21M11 21H18" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>';
                break;
            default:
                glyph = '<path d="M14.2 16C14.2 14.9 15 14 16 14C17 14 17.8 14.8 17.8 15.8C17.8 17 16 17.4 16 19M16 21.8H16.02" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>';
                break;
        }
        return `<svg viewBox="0 0 32 32" width="34" height="34" class="ai-file-svg" data-file-cat="${cat}" aria-hidden="true"><path class="ai-file-svg-paper" d="M7 4.5C7 3.4 7.9 2.5 9 2.5H19.5L25.5 8.5V27.5C25.5 28.6 24.6 29.5 23.5 29.5H9C7.9 29.5 7 28.6 7 27.5V4.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path class="ai-file-svg-fold" d="M19.5 2.5V8.5H25.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>${glyph}</svg>`;
    }

    function chipHtml(rawPath, label) {
        const filePath = cleanPath(unwrap(rawPath));
        if (isImage(filePath)) return imageHtml(fileUrl(filePath), label || baseName(filePath), fileUrl(filePath, true), baseName(filePath));
        const name = baseName(filePath);
        const ext = extOf(filePath);
        const cat = fileCategoryOf(ext);
        const text = label && label !== filePath ? label : name;
        return `<span class="ai-file-chip" data-ai-file="${esc(filePath)}" data-ext="${esc(ext)}" data-cat="${esc(cat)}"><span class="ai-file-chip-icon" aria-hidden="true">${fileIconSvg(ext)}</span><span class="ai-file-chip-text"><a class="ai-file-chip-name" href="${esc(fileUrl(filePath))}" title="${esc(String(rawPath))}">${esc(text)}</a><span class="ai-file-chip-meta">${esc(text === name ? '' : name)}</span></span><a class="ai-file-chip-download" href="${esc(fileUrl(filePath, true))}" download="${esc(name)}" title="${esc(t('download'))} ${esc(name)}" aria-label="${esc(t('download'))} ${esc(name)}"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1Zm-7 15a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/></svg><span>${esc(t('download'))}</span></a></span>`;
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
    // 按回复归组，不跨消息合并；流式回复新增/撤回文件时也能恢复单文件卡片。
    const FILE_MESSAGE_SCOPE = '.dc-msg, .ai-msg, .wl-detail, .dc-btw-a';
    function compactFileReferences(root) {
        const groups = new Map();
        (root || document).querySelectorAll?.('.ai-file-chip').forEach(chip => {
            const scope = chip.closest(FILE_MESSAGE_SCOPE);
            if (!scope || scope.matches('.dc-msg--user, .ai-msg.user')) return;
            if (!groups.has(scope)) groups.set(scope, []);
            groups.get(scope).push(chip);
        });
        groups.forEach(chips => {
            const compact = chips.length > 1;
            chips.forEach(chip => {
                chip.classList.toggle('ai-file-chip--compact', compact);
                const link = chip.querySelector('.ai-file-chip-name');
                if (!link) return;
                // CODE0 等引用标签在紧凑模式下显示真实文件名，便于识别。
                if (!('fileLabel' in link.dataset)) link.dataset.fileLabel = link.textContent;
                const label = compact ? baseName(chip.dataset.aiFile) : link.dataset.fileLabel;
                if (link.textContent !== label) link.textContent = label;
            });
        });
    }
    function hydrate(root) {
        // hydrate 也会由附件容器调用；归组时包含正文及附件。
        compactFileReferences(root?.closest?.(FILE_MESSAGE_SCOPE) || root);
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

    // 预览独立于外部会话卡片，关闭时保留原卡片 DOM、滚动位置和面板开关。
    const PREVIEW_LIMIT = 5 * 1024 * 1024;
    let filePreview = null;
    let previewWidth = null;
    function bindPreviewResize(current) {
        const handle = current.node.querySelector('.ai-file-preview-resize');
        const target = () => current.mounted ? current.node.parentElement : current.node;
        const limit = () => {
            const layout = current.mounted && window.innerWidth > 860 ? target().closest('.home-workspace') : null;
            if (!layout) return Math.max(240, window.innerWidth - 32);
            const main = layout.querySelector('.home-main');
            return Math.max(240, target().getBoundingClientRect().right - main.getBoundingClientRect().left - 340);
        };
        const resize = width => {
            previewWidth = Math.round(Math.max(Math.min(280, limit()), Math.min(width, limit())));
            document.body.style.setProperty('--ai-preview-width', `${previewWidth}px`);
            handle.setAttribute('aria-valuenow', String(previewWidth));
        };
        let drag = null;
        const end = () => { drag = null; document.body.classList.remove('ai-preview-resizing'); };
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            drag = { x: event.clientX, width: target().getBoundingClientRect().width };
            handle.setPointerCapture(event.pointerId);
            document.body.classList.add('ai-preview-resizing');
        });
        const move = event => { if (drag) resize(drag.width + drag.x - event.clientX); };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
        handle.addEventListener('lostpointercapture', end);
        handle.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            resize(target().getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 40 : -40));
        });
        const onResize = () => { if (previewWidth !== null) resize(previewWidth); };
        window.addEventListener('resize', onResize);
        current.cleanupResize = () => {
            end();
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', end);
            window.removeEventListener('resize', onResize);
        };
        if (previewWidth !== null) resize(previewWidth);
    }
    function closePreview() {
        if (!filePreview) return;
        const current = filePreview;
        filePreview = null;
        current.cleanupResize?.();
        current.controller.abort();
        if (current.url) URL.revokeObjectURL(current.url);
        current.node.remove();
        if (current.mounted) window.DragonClawWorkspace?.unmountFilePreview();
        document.body.classList.remove('ai-file-preview-open');
        document.body.style.removeProperty('--ai-preview-width');
        document.removeEventListener('keydown', onPreviewKey, true);
        current.opener?.focus?.({ preventScroll: true });
    }
    function onPreviewKey(event) {
        if (event.key !== 'Escape' || !filePreview) return;
        event.preventDefault();
        event.stopPropagation();
        closePreview();
    }
    let highlighterLoading = null;
    function ensureHighlighter() {
        if (window.IdeHighlighter) return Promise.resolve(window.IdeHighlighter);
        if (!highlighterLoading) {
            highlighterLoading = new Promise(resolve => {
                const script = document.createElement('script');
                script.src = '/js/shared/ide-highlighter.js';
                script.onload = () => resolve(window.IdeHighlighter || null);
                script.onerror = () => resolve(null);
                document.head.appendChild(script);
            });
        }
        return highlighterLoading;
    }

    function previewConfigFor(filePath) {
        const ext = extOf(filePath);
        if (['md', 'markdown'].includes(ext)) {
            return { mode: 'md', tabs: ['preview', 'code', 'diff'], defaultTab: 'preview', lang: 'markdown' };
        }
        if (['html', 'htm', 'xhtml'].includes(ext)) {
            return { mode: 'html', tabs: ['preview', 'code', 'diff'], defaultTab: 'preview', lang: 'html' };
        }
        if (ext === 'svg') {
            return { mode: 'svg', tabs: ['preview', 'code', 'diff'], defaultTab: 'preview', lang: 'html' };
        }
        if (ext === 'pdf') {
            return { mode: 'pdf', tabs: [], defaultTab: 'pdf', lang: 'text' };
        }
        return { mode: 'text', tabs: ['code', 'diff'], defaultTab: 'code', lang: ext };
    }

    function renderCode(content, filePath) {
        const ext = extOf(filePath);
        const lang = window.IdeHighlighter ? window.IdeHighlighter.detectLanguage(filePath) : ext;
        const rawLines = String(content || '').split('\n');
        if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') rawLines.pop();

        let highlightedHtml = '';
        if (window.IdeHighlighter && lang && lang !== 'text') {
            try {
                highlightedHtml = window.IdeHighlighter.highlight(rawLines.join('\n'), lang);
            } catch (_err) {
                highlightedHtml = rawLines.map(line => esc(line)).join('\n');
            }
        } else {
            highlightedHtml = rawLines.map(line => esc(line)).join('\n');
        }

        const lines = highlightedHtml.split('\n');
        const numDigits = Math.max(2, String(lines.length).length);
        const numsHtml = lines.map((_, i) => `<span>${String(i + 1).padStart(numDigits, ' ')}</span>`).join('');
        const codeHtml = lines.map(line => `<span class="ai-file-line">${line || ' '}</span>`).join('\n');

        return `<div class="ai-file-code-container"><div class="ai-file-line-numbers" aria-hidden="true">${numsHtml}</div><pre class="ai-file-preview-code"><code>${codeHtml}</code></pre></div>`;
    }

    function renderMarkdownContent(content) {
        if (typeof window.ToolsAIAssistant?.renderMarkdown === 'function') {
            return `<div class="ai-file-md">${window.ToolsAIAssistant.renderMarkdown(content)}</div>`;
        }
        if (typeof window.DragonClaw?.renderMarkdown === 'function') {
            return `<div class="ai-file-md">${window.DragonClaw.renderMarkdown(content)}</div>`;
        }
        return `<div class="ai-file-md"><pre>${esc(content)}</pre></div>`;
    }

    function renderDiffView(diffText) {
        if (!diffText || !diffText.trim()) {
            return `<div class="ai-file-diff-empty"><span class="ai-file-diff-empty-icon">✓</span><p>${esc(t('diffEmpty'))}</p></div>`;
        }
        const lines = String(diffText).split('\n');
        const rendered = lines.map(line => {
            const cls = line.startsWith('+') && !line.startsWith('+++') ? 'wsp-diff-add'
                : line.startsWith('-') && !line.startsWith('---') ? 'wsp-diff-del'
                    : line.startsWith('@@') ? 'wsp-diff-hunk' : 'wsp-diff-ctx';
            return `<span class="${cls}">${esc(line) || ' '}</span>`;
        }).join('\n');
        return `<pre class="wsp-diff"><code>${rendered}</code></pre>`;
    }

    function setupTabs(current, config) {
        const header = current.node.querySelector('header');
        if (!config.tabs || config.tabs.length < 2) return;

        const tabLabels = {
            preview: t('tabPreview'),
            code: t('tabCode'),
            diff: t('tabDiff')
        };

        const tabsNav = document.createElement('div');
        tabsNav.className = 'ai-file-preview-tabs';
        tabsNav.setAttribute('role', 'tablist');
        tabsNav.innerHTML = config.tabs.map(tab => `
            <button type="button" role="tab" class="ai-file-preview-tab ${tab === current.activeTab ? 'is-active' : ''}" data-tab="${tab}" aria-selected="${tab === current.activeTab}">${esc(tabLabels[tab] || tab)}</button>
        `).join('');

        header.insertAdjacentElement('afterend', tabsNav);

        tabsNav.addEventListener('click', async event => {
            const tabBtn = event.target.closest('.ai-file-preview-tab');
            if (!tabBtn) return;
            const tab = tabBtn.dataset.tab;
            if (current.activeTab === tab) return;

            current.activeTab = tab;
            tabsNav.querySelectorAll('.ai-file-preview-tab').forEach(b => {
                const active = b.dataset.tab === tab;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-selected', String(active));
            });

            const views = current.node.querySelectorAll('.ai-file-preview-view');
            views.forEach(v => {
                v.hidden = v.dataset.view !== tab;
            });

            if (tab === 'diff' && !current.diffLoaded) {
                current.diffLoaded = true;
                const diffView = current.node.querySelector('.ai-file-preview-view[data-view="diff"]');
                if (diffView) {
                    diffView.innerHTML = `<div class="ai-file-diff-status">${esc(t('diffLoading'))}</div>`;
                    let diffText = null;
                    try {
                        const ws = window.DragonClawWorkspace?.getWorkspaceState?.();
                        if (ws?.agentSessionId && ws?.root) {
                            const res = await fetch(`/api/agent-workspace/changes/${encodeURIComponent(ws.agentSessionId)}?path=${encodeURIComponent(current.filePath)}&root=${encodeURIComponent(ws.root)}`, {
                                credentials: 'same-origin',
                                headers: authHeaders(),
                                signal: current.controller.signal
                            });
                            if (res.ok) {
                                const data = await res.json();
                                diffText = data.diff?.text || null;
                            }
                        }
                    } catch (_err) {
                        diffText = null;
                    }
                    if (filePreview === current) {
                        diffView.innerHTML = renderDiffView(diffText);
                    }
                }
            }
        });
    }

    async function openPreview(filePath, opener) {
        if (filePreview) {
            filePreview.cleanupResize?.();
            filePreview.controller.abort();
            if (filePreview.url) URL.revokeObjectURL(filePreview.url);
            filePreview.node.remove();
        }
        const node = document.createElement('section');
        node.className = 'ai-file-preview';
        node.setAttribute('role', 'region');
        node.setAttribute('aria-label', t('filePreview'));
        node.innerHTML = `<span class="ai-file-preview-resize" role="separator" tabindex="0" aria-orientation="vertical" aria-label="${esc(t('resize'))}" title="${esc(t('resize'))}"></span><header><strong title="${esc(filePath)}">${esc(baseName(filePath))}</strong><a href="${esc(fileUrl(filePath, true))}" download="${esc(baseName(filePath))}">${esc(t('download'))}</a><button type="button" aria-label="${esc(t('close'))}">✕</button></header><div class="ai-file-preview-body" aria-live="polite"></div>`;
        const current = { node, opener, filePath, controller: new AbortController(), mounted: false, url: null, activeTab: '', diffLoaded: false };
        filePreview = current;
        current.mounted = Boolean(window.DragonClawWorkspace?.mountFilePreview(node));
        if (!current.mounted) { node.classList.add('ai-file-preview--floating'); document.body.appendChild(node); }
        document.body.classList.add('ai-file-preview-open');
        bindPreviewResize(current);
        node.querySelector('button').addEventListener('click', closePreview);
        node.querySelector('button').focus({ preventScroll: true });
        document.addEventListener('keydown', onPreviewKey, true);
        const body = node.querySelector('.ai-file-preview-body');
        body.textContent = t('loading');
        try {
            const info = await stat(filePath);
            if (filePreview !== current) return;
            if (info.error) throw new Error(info.error);
            const ext = extOf(filePath);
            if (!TEXT_EXT.has(ext) && ext !== 'pdf') { body.textContent = t('unsupported'); return; }
            if (info.size > PREVIEW_LIMIT) { body.textContent = t('tooLarge'); return; }
            const response = await fetch(fileUrl(filePath), { credentials: 'same-origin', headers: authHeaders(), signal: current.controller.signal });
            if (!response.ok) throw new Error(t('missing'));
            // 限制实际读取量，防止 stat 后文件增长导致预览占用过多内存。
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > PREVIEW_LIMIT) { await reader.cancel(); throw new Error(t('tooLarge')); }
                chunks.push(value);
            }
            if (filePreview !== current) return;
            const blob = new Blob(chunks, { type: ext === 'pdf' ? 'application/pdf' : 'text/plain' });
            if (ext === 'pdf') {
                current.url = URL.createObjectURL(blob);
                const frame = document.createElement('iframe');
                frame.title = baseName(filePath);
                frame.src = current.url;
                body.replaceChildren(frame);
                return;
            }

            await ensureHighlighter().catch(() => {});
            if (filePreview !== current) return;

            const textContent = await blob.text();
            if (filePreview !== current) return;

            body.innerHTML = '';
            const config = previewConfigFor(filePath);
            current.activeTab = config.defaultTab;

            // 1. 渲染预览视图（.md / .html / .svg 优先展示）
            if (config.tabs.includes('preview')) {
                const previewView = document.createElement('div');
                previewView.className = 'ai-file-preview-view is-preview';
                previewView.dataset.view = 'preview';
                previewView.hidden = config.defaultTab !== 'preview';

                if (config.mode === 'md') {
                    previewView.innerHTML = renderMarkdownContent(textContent);
                } else if (config.mode === 'html') {
                    const frame = document.createElement('iframe');
                    frame.className = 'ai-file-preview-frame';
                    frame.title = baseName(filePath);
                    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
                    frame.setAttribute('referrerpolicy', 'no-referrer');
                    frame.srcdoc = textContent;
                    previewView.appendChild(frame);
                } else if (config.mode === 'svg') {
                    const frame = document.createElement('iframe');
                    frame.className = 'ai-file-preview-frame';
                    frame.title = baseName(filePath);
                    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
                    frame.setAttribute('referrerpolicy', 'no-referrer');
                    frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff;}svg{max-width:96%;max-height:96vh;}</style>${textContent}`;
                    previewView.appendChild(frame);
                }
                body.appendChild(previewView);
            }

            // 2. 源码/代码视图（支持行号与语法高亮）
            const codeView = document.createElement('div');
            codeView.className = 'ai-file-preview-view is-code';
            codeView.dataset.view = 'code';
            codeView.hidden = config.defaultTab !== 'code';
            codeView.innerHTML = renderCode(textContent, filePath);
            body.appendChild(codeView);

            // 3. 对比视图（查看 Diff）
            const diffView = document.createElement('div');
            diffView.className = 'ai-file-preview-view is-diff';
            diffView.dataset.view = 'diff';
            diffView.hidden = config.defaultTab !== 'diff';
            diffView.innerHTML = `<div class="ai-file-diff-empty"><span class="ai-file-diff-empty-icon">✓</span><p>${esc(t('diffEmpty'))}</p></div>`;
            body.appendChild(diffView);

            // 挂载顶部切换 Tab
            setupTabs(current, config);

        } catch (error) {
            if (filePreview === current && error.name !== 'AbortError') body.textContent = error.message || t('missing');
        }
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
        const link = event.target.closest?.('.ai-file-chip-name');
        if (link && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            openPreview(link.closest('[data-ai-file]').dataset.aiFile, link);
            return;
        }
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
        if (records.some(record => record.addedNodes.length || record.removedNodes.length)) hydrate(document);
    }).observe(document.documentElement, { childList: true, subtree: true });

    const style = document.createElement('style');
    style.textContent = `
        .ai-file-chip { display: flex; width: fit-content; align-items: center; gap: 10px; max-width: 100%; margin: 8px 0; padding: 7px 10px 7px 8px; border-radius: 12px; border: 1px solid rgba(148, 163, 184, 0.22); background: rgba(15, 23, 42, 0.55); vertical-align: middle; box-sizing: border-box; line-height: 1.3; transition: border-color .15s, background .15s; }
        .ai-file-chip:hover { border-color: rgba(148, 163, 184, 0.38); background: rgba(15, 23, 42, 0.75); }
        .ai-file-chip-icon { flex: none; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 8px; background: transparent !important; }
        .ai-file-svg { display: block; width: 34px; height: 34px; overflow: visible; }
        .ai-file-svg-paper { fill: var(--file-paper-bg, rgba(148, 163, 184, 0.1)); }
        .ai-file-svg-fold { fill: var(--file-fold-bg, rgba(148, 163, 184, 0.22)); }

        /* Dark Mode 类型微色调（契合深色主题、克制雅致） */
        .ai-file-svg { color: #94a3b8; --file-paper-bg: rgba(148, 163, 184, 0.1); --file-fold-bg: rgba(148, 163, 184, 0.22); }
        .ai-file-svg[data-file-cat="sheet"] { color: #34d399; --file-paper-bg: rgba(16, 185, 129, 0.14); --file-fold-bg: rgba(16, 185, 129, 0.26); }
        .ai-file-svg[data-file-cat="doc"]   { color: #60a5fa; --file-paper-bg: rgba(59, 130, 246, 0.14); --file-fold-bg: rgba(59, 130, 246, 0.26); }
        .ai-file-svg[data-file-cat="slide"] { color: #fb923c; --file-paper-bg: rgba(249, 115, 22, 0.14); --file-fold-bg: rgba(249, 115, 22, 0.26); }
        .ai-file-svg[data-file-cat="pdf"]   { color: #f43f5e; --file-paper-bg: rgba(244, 63, 94, 0.14); --file-fold-bg: rgba(244, 63, 94, 0.26); }
        .ai-file-svg[data-file-cat="md"]    { color: #22d3ee; --file-paper-bg: rgba(6, 182, 212, 0.14); --file-fold-bg: rgba(6, 182, 212, 0.26); }
        .ai-file-svg[data-file-cat="code"]  { color: #a78bfa; --file-paper-bg: rgba(139, 92, 246, 0.14); --file-fold-bg: rgba(139, 92, 246, 0.26); }
        .ai-file-svg[data-file-cat="data"]  { color: #fbbf24; --file-paper-bg: rgba(245, 158, 11, 0.14); --file-fold-bg: rgba(245, 158, 11, 0.26); }
        .ai-file-svg[data-file-cat="db"]    { color: #2dd4bf; --file-paper-bg: rgba(20, 184, 166, 0.14); --file-fold-bg: rgba(20, 184, 166, 0.26); }
        .ai-file-svg[data-file-cat="zip"]   { color: #f59e0b; --file-paper-bg: rgba(217, 119, 6, 0.14); --file-fold-bg: rgba(217, 119, 6, 0.26); }
        .ai-file-svg[data-file-cat="image"] { color: #34d399; --file-paper-bg: rgba(16, 185, 129, 0.14); --file-fold-bg: rgba(16, 185, 129, 0.26); }
        .ai-file-svg[data-file-cat="media"] { color: #f472b6; --file-paper-bg: rgba(236, 72, 153, 0.14); --file-fold-bg: rgba(236, 72, 153, 0.26); }
        .ai-file-svg[data-file-cat="text"]  { color: #94a3b8; --file-paper-bg: rgba(148, 163, 184, 0.1); --file-fold-bg: rgba(148, 163, 184, 0.22); }
        .ai-file-svg[data-file-cat="unknown"] { color: #94a3b8; --file-paper-bg: rgba(148, 163, 184, 0.08); --file-fold-bg: rgba(148, 163, 184, 0.2); }

        .ai-file-chip-text { display: flex; flex-direction: column; min-width: 0; }
        .ai-file-chip a.ai-file-chip-name { color: #f1f5f9; font-weight: 600; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch; }
        .ai-file-chip a.ai-file-chip-name:hover { text-decoration: underline; color: #38bdf8; }
        .ai-file-chip-meta { font-size: 11.5px; opacity: .7; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch; }
        .ai-file-chip-meta:empty { display: none; }
        .ai-file-chip a.ai-file-chip-download { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 7px; font-size: 11.5px; font-weight: 600; text-decoration: none; color: #e2e8f0; background: rgba(148, 163, 184, 0.14); border: 1px solid rgba(148, 163, 184, 0.22); }
        .ai-file-chip a.ai-file-chip-download:hover { background: rgba(148, 163, 184, 0.24); color: #fff; }
        .ai-file-chip.is-missing { opacity: .6; border-style: dashed; }
        .ai-file-chip.is-missing a.ai-file-chip-download { pointer-events: none; opacity: .5; }
        html .ai-file-chip.ai-file-chip--compact,
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-chip.ai-file-chip--compact {
            display: inline; width: auto; margin: 0; padding: 0; border: 0; border-radius: 0;
            background: transparent; box-shadow: none; line-height: inherit; vertical-align: baseline;
        }
        .ai-file-chip--compact .ai-file-chip-text { display: inline; }
        .ai-file-chip--compact .ai-file-chip-icon,
        .ai-file-chip--compact .ai-file-chip-meta,
        .ai-file-chip.ai-file-chip--compact a.ai-file-chip-download { display: none; }
        .ai-file-chip.ai-file-chip--compact a.ai-file-chip-name {
            display: inline; max-width: none; white-space: normal; overflow-wrap: anywhere;
            font-size: .95em; font-weight: 500; color: #7dd3fc;
            text-decoration: underline; text-decoration-color: #7dd3fc55;
            text-decoration-thickness: 1px; text-underline-offset: 3px;
        }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-chip.ai-file-chip--compact a.ai-file-chip-name { color: #2563a6; text-decoration-color: #2563a64d; }
        .ai-file-chip.ai-file-chip--compact a.ai-file-chip-name:hover { color: #38bdf8; text-decoration-color: currentColor; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-chip.ai-file-chip--compact a.ai-file-chip-name:hover { color: #1d4ed8; text-decoration-color: currentColor; }
        .ai-file-chip--compact a.ai-file-chip-name:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; border-radius: 2px; }
        .ai-md-image { display: block; width: fit-content; max-width: 100%; margin: 6px 0; vertical-align: top; }
        .ai-md-image img { display: block; max-width: min(100%, 520px); max-height: 360px; border-radius: 10px; border: 1px solid rgba(148, 163, 184, .3); cursor: zoom-in; object-fit: contain; background: rgba(148, 163, 184, .08); }
        .ai-md-image.is-missing { padding: 8px 12px; border-radius: 10px; border: 1px dashed rgba(148, 163, 184, .5); font-size: 13px; opacity: .7; }
        .home-workspace-panel.has-file-preview > :not(.ai-file-preview) { display: none !important; }
        .ai-file-preview { display: flex; flex-direction: column; min-width: 0; position: relative; height: auto; color: var(--wsp-text, var(--text-primary, #e2e8f0)); background: var(--wsp-panel, var(--bg-secondary, #0f172a)); border-radius: 12px; overflow: hidden; }
        .ai-file-preview--floating { position: fixed; right: 16px; top: calc(var(--navbar-h, 60px) + 16px); bottom: 18px; width: min(var(--ai-preview-width, 560px), calc(100vw - 32px)); max-height: none; z-index: 10010; border: 1px solid #94a3b855; box-shadow: 0 12px 40px #0004; }
        .home-workspace-panel.has-file-preview { height: calc(100dvh - var(--navbar-h) - 36px); max-height: none; box-sizing: border-box; overflow: hidden; }
        .home-workspace-panel.has-file-preview > .ai-file-preview { flex: 1 1 auto; min-height: 0; }
        .ai-file-preview-resize { position: absolute; left: 0; top: 0; bottom: 0; width: 8px; z-index: 2; cursor: col-resize; touch-action: none; border-radius: 5px; }
        body.ai-preview-resizing { cursor: col-resize; user-select: none; }
        body.ai-preview-resizing .ai-file-preview iframe { pointer-events: none; }
        @media (min-width: 861px) {
            body.ai-file-preview-open.home-mode-chat.dc-workspace-open .home-content.home-workspace { grid-template-columns: var(--ws-side) minmax(0, 1fr) var(--ai-preview-width, var(--ws-panel-w)); }
            body.ai-file-preview-open.home-sidebar-collapsed.home-mode-chat.dc-workspace-open .home-content.home-workspace { grid-template-columns: var(--ws-rail) minmax(0, 1fr) var(--ai-preview-width, var(--ws-panel-w)); }
        }
        @media (max-width: 860px) {
            .home-workspace-panel.has-file-preview,
            html[data-ui="v2"] .home-workspace-panel.has-file-preview { height: calc(100dvh - var(--navbar-h)); width: min(var(--ai-preview-width, 360px), calc(100vw - 32px)); }
        }
        .ai-file-preview header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid rgba(148, 163, 184, 0.2); }
        .ai-file-preview header strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13.5px; }
        .ai-file-preview header a, .ai-file-preview header button { flex: none; color: inherit; font: inherit; }
        .ai-file-preview header button { background: transparent; border: 0; cursor: pointer; padding: 6px; font-size: 14px; border-radius: 6px; }
        .ai-file-preview header button:hover { background: rgba(148, 163, 184, 0.15); }
        .ai-file-preview-tabs { display: flex; gap: 6px; padding: 6px 14px 10px; border-bottom: 1px solid rgba(148, 163, 184, 0.2); background: rgba(15, 23, 42, 0.25); }
        .ai-file-preview-tab { background: transparent; border: 1px solid transparent; color: inherit; opacity: .7; padding: 3px 11px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all .15s ease; font-family: inherit; }
        .ai-file-preview-tab:hover { opacity: 1; background: rgba(148, 163, 184, 0.12); }
        .ai-file-preview-tab.is-active { opacity: 1; font-weight: 600; color: #38bdf8; background: rgba(56, 189, 248, 0.14); border-color: rgba(56, 189, 248, 0.3); }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-tabs { background: rgba(241, 245, 249, 0.6); }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-tab.is-active { color: #0284c7; background: rgba(2, 132, 199, 0.12); border-color: rgba(2, 132, 199, 0.25); }
        .ai-file-preview-body { flex: 1; min-height: 0; overflow: auto; padding: 0; display: flex; flex-direction: column; }
        .ai-file-preview-view { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
        .ai-file-preview-view[hidden] { display: none !important; }
        .ai-file-md { padding: 14px 18px; font-size: 13.5px; line-height: 1.7; color: inherit; word-break: break-word; overflow-y: auto; flex: 1; }
        .ai-file-md h1, .ai-file-md h2, .ai-file-md h3, .ai-file-md h4 { margin: 1.2em 0 0.5em; font-weight: 600; line-height: 1.35; color: inherit; }
        .ai-file-md h1 { font-size: 1.4em; border-bottom: 1px solid rgba(148, 163, 184, 0.25); padding-bottom: 0.3em; }
        .ai-file-md h2 { font-size: 1.2em; border-bottom: 1px solid rgba(148, 163, 184, 0.2); padding-bottom: 0.25em; }
        .ai-file-md h3 { font-size: 1.08em; }
        .ai-file-md p { margin: 0.6em 0; }
        .ai-file-md ul, .ai-file-md ol { padding-left: 1.5em; margin: 0.5em 0; }
        .ai-file-md li { margin: 0.25em 0; }
        .ai-file-md blockquote { margin: 0.8em 0; padding: 0.4em 1em; border-left: 3px solid #38bdf8; background: rgba(56, 189, 248, 0.08); border-radius: 0 6px 6px 0; }
        .ai-file-md table { width: 100%; border-collapse: collapse; margin: 0.8em 0; font-size: 12.5px; }
        .ai-file-md th, .ai-file-md td { border: 1px solid rgba(148, 163, 184, 0.25); padding: 6px 10px; text-align: left; }
        .ai-file-md th { background: rgba(148, 163, 184, 0.12); font-weight: 600; }
        .ai-file-md code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9em; padding: 2px 5px; border-radius: 4px; background: rgba(148, 163, 184, 0.15); }
        .ai-file-md pre { background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; padding: 10px 12px; margin: 0.8em 0; overflow-x: auto; }
        .ai-file-md pre code { background: transparent; padding: 0; border-radius: 0; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-md pre { background: rgba(241, 245, 249, 0.9); }
        .ai-file-code-container { display: flex; min-height: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.6; overflow-x: auto; flex: 1; }
        .ai-file-line-numbers { flex: none; padding: 10px 8px; text-align: right; user-select: none; opacity: .45; border-right: 1px solid rgba(148, 163, 184, 0.18); display: flex; flex-direction: column; background: rgba(148, 163, 184, 0.03); }
        .ai-file-line-numbers span { display: block; min-height: 1.6em; }
        .ai-file-preview-code { flex: 1; margin: 0; padding: 10px 12px; white-space: pre; overflow-x: auto; font-family: inherit; font-size: inherit; line-height: inherit; background: transparent; }
        .ai-file-line { display: block; min-height: 1.6em; }
        .ai-file-preview-frame { width: 100%; height: 100%; min-height: 380px; flex: 1; border: 0; background: white; }
        .ai-file-preview-view.is-diff { padding: 12px; overflow-y: auto; flex: 1; }
        .ai-file-diff-status { padding: 24px; text-align: center; opacity: .65; font-size: 13px; }
        .ai-file-diff-empty { padding: 36px 16px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; opacity: .7; }
        .ai-file-diff-empty-icon { font-size: 26px; line-height: 1; }
        .ai-file-diff-empty p { margin: 0; font-size: 13px; }
        .ai-file-preview-code .tok-keyword { color: #f47067; font-weight: 500; }
        .ai-file-preview-code .tok-builtin { color: #79c0ff; }
        .ai-file-preview-code .tok-string { color: #a5d6ff; }
        .ai-file-preview-code .tok-comment { color: #8b949e; font-style: italic; }
        .ai-file-preview-code .tok-number { color: #d2a8ff; }
        .ai-file-preview-code .tok-decorator { color: #ffa657; }
        .ai-file-preview-code .tok-operator { color: #f47067; }
        .ai-file-preview-code .tok-tag { color: #7ee787; font-weight: 500; }
        .ai-file-preview-code .tok-attr { color: #79c0ff; }
        .ai-file-preview-code .tok-key { color: #7ee787; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-keyword { color: #cf222e; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-builtin { color: #0550ae; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-string { color: #0a3069; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-comment { color: #6e7781; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-number { color: #8250df; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-decorator { color: #953800; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-operator { color: #cf222e; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-tag { color: #116329; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-attr { color: #0550ae; }
        html[data-ui="v2"]:not([data-theme="dark"]) .ai-file-preview-code .tok-key { color: #116329; }
        .ai-file-preview pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.7 ui-monospace, monospace; color: inherit; background: transparent; }
        .ai-file-preview iframe { width: 100%; height: 100%; border: 0; background: white; }
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

    window.ChatFiles = { transformInline, chipHtml, imageHtml, isLocalFile, cleanPath, fileUrl, hydrate, openPreview, closePreview };
})();
