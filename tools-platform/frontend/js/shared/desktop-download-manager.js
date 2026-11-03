/**
 * 桌面端全局下载进度与抽屉圆环管理器
 * - 默认无侵入下载至系统/配置下载目录（无需每次弹出原生保存窗口）
 * - 右上角浮动条优雅显示下载进度与状态
 * - 支持点击直接更换下载目录（并同步更新配置）
 * - 下载完成后自动倒计时消失，并提供「打开文件」与「打开所在文件夹」
 * - 未下载完时支持点击收起，折叠至右侧抽屉圆环（样式对齐右下角 Dragonclaw 客服助手）
 * - 圆环中央为黑白极简主题下载符号，外环为实时进度环，点击可重新展开横幅
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || window.__desktopDownloadManagerInitialized) return;
    if (window.top !== window) return; // 仅在顶层窗口运行，避免 iframe 重复渲染
    window.__desktopDownloadManagerInitialized = true;

    const api = window.DragonDownload;

    // 格式化文件大小
    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const val = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
        return `${val} ${units[i] || 'MB'}`;
    }

    // 注入组件 CSS 样式
    const style = document.createElement('style');
    style.id = 'desktopDownloadManagerStyles';
    style.textContent = `
        /* ── 右上角优雅浮动下载横幅 ── */
        .desktop-dl-banner {
            position: fixed;
            top: 20px;
            right: 22px;
            width: min(400px, calc(100vw - 36px));
            box-sizing: border-box;
            padding: 14px 16px 14px 16px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.95);
            border: 1px solid rgba(226, 232, 240, 0.9);
            color: #1f2328;
            box-shadow:
                0 16px 42px rgba(15, 23, 42, 0.12),
                0 3px 10px rgba(15, 23, 42, 0.04),
                inset 0 1px 0 #ffffff;
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            z-index: 100010;
            display: flex;
            flex-direction: column;
            gap: 8px;
            animation: desktopDlBannerIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
            transform-origin: top right;
            transition: opacity 0.24s ease, transform 0.24s ease, filter 0.24s ease;
            user-select: none;
            font-family: inherit;
        }
        .desktop-dl-banner.is-hiding {
            opacity: 0;
            transform: translateY(-10px) scale(0.96);
            pointer-events: none;
        }
        .desktop-dl-banner.is-collapsing {
            opacity: 0;
            transform: translate(60px, 120px) scale(0.5);
            pointer-events: none;
            transition: opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1), transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        }
        @keyframes desktopDlBannerIn {
            0% { opacity: 0; transform: translateY(-16px) scale(0.95); filter: blur(4px); }
            100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }

        .desktop-dl-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }
        .desktop-dl-title-group {
            display: flex;
            align-items: center;
            gap: 9px;
            min-width: 0;
            flex: 1;
        }
        .desktop-dl-icon-badge {
            width: 32px;
            height: 32px;
            border-radius: 9px;
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            color: #1f2328;
            display: grid;
            place-items: center;
            flex: none;
            transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .desktop-dl-icon-badge svg {
            width: 17px;
            height: 17px;
            display: block;
        }
        .desktop-dl-banner.is-done .desktop-dl-icon-badge {
            background: #e6fcf5;
            border-color: #b2f2bb;
            color: #10a37f;
        }
        .desktop-dl-banner.is-error .desktop-dl-icon-badge {
            background: #fef2f2;
            border-color: #fecaca;
            color: #ef4444;
        }
        .desktop-dl-filename {
            font-size: 13.5px;
            font-weight: 650;
            color: #1f2328;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.3;
        }
        .desktop-dl-actions {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: none;
        }
        .desktop-dl-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            border-radius: 7px;
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            color: #475569;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.16s, color 0.16s, border-color 0.16s, transform 0.16s;
            outline: none;
        }
        .desktop-dl-btn:hover {
            background: #e2e8f0;
            border-color: #cbd5e1;
            color: #0f172a;
            transform: translateY(-1px);
        }
        .desktop-dl-btn svg { width: 13px; height: 13px; display: block; }
        .desktop-dl-icon-btn {
            width: 28px;
            height: 28px;
            border-radius: 7px;
            background: transparent;
            border: 1px solid transparent;
            color: #64748b;
            display: grid;
            place-items: center;
            cursor: pointer;
            transition: background 0.16s, color 0.16s, border-color 0.16s;
            outline: none;
            padding: 0;
        }
        .desktop-dl-icon-btn:hover {
            background: #f1f5f9;
            border-color: #e2e8f0;
            color: #1f2328;
        }
        .desktop-dl-icon-btn svg { width: 15px; height: 15px; }

        .desktop-dl-body {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .desktop-dl-track {
            position: relative;
            width: 100%;
            height: 6px;
            border-radius: 99px;
            background: #e2e8f0;
            overflow: hidden;
        }
        .desktop-dl-bar {
            height: 100%;
            width: 0%;
            border-radius: 99px;
            background: linear-gradient(90deg, #10a37f, #06b6d4);
            transition: width 0.22s ease-out;
        }
        .desktop-dl-banner.is-done .desktop-dl-bar {
            background: #10a37f;
            width: 100% !important;
        }
        .desktop-dl-banner.is-error .desktop-dl-bar {
            background: #ef4444;
        }
        .desktop-dl-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11.5px;
            color: #64748b;
            line-height: 1.3;
        }
        .desktop-dl-stats {
            font-variant-numeric: tabular-nums;
            font-weight: 500;
        }
        .desktop-dl-status {
            font-weight: 600;
        }
        .desktop-dl-banner.is-done .desktop-dl-status {
            color: #10a37f;
        }
        .desktop-dl-banner.is-error .desktop-dl-status {
            color: #ef4444;
        }

        .desktop-dl-completed-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 4px;
            animation: desktopDlFadeIn 0.2s ease both;
        }
        @keyframes desktopDlFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .desktop-dl-act-btn {
            flex: 1;
            padding: 7px 12px;
            border-radius: 9px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.16s, transform 0.16s, box-shadow 0.16s, border-color 0.16s;
            border: none;
            outline: none;
            text-align: center;
        }
        .desktop-dl-act-btn.primary {
            background: #10a37f;
            color: #ffffff;
            box-shadow: 0 4px 12px rgba(16, 163, 127, 0.25);
        }
        .desktop-dl-act-btn.primary:hover {
            background: #0d8a6b;
            transform: translateY(-1px);
        }
        .desktop-dl-act-btn.secondary {
            background: #f1f5f9;
            color: #334155;
            border: 1px solid #e2e8f0;
        }
        .desktop-dl-act-btn.secondary:hover {
            background: #e2e8f0;
            color: #0f172a;
            transform: translateY(-1px);
        }
        .desktop-dl-hint {
            font-size: 11px;
            color: #64748b;
            margin-top: -2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* ── 右侧折叠下载圆环（对齐 Dragonclaw 客服助手） ── */
        .desktop-dl-fab {
            position: fixed;
            bottom: 328px;
            right: 0;
            height: 48px;
            min-width: 54px;
            box-sizing: border-box;
            padding: 0 11px 0 10px;
            border-radius: 24px 0 0 24px;
            background: rgba(255, 255, 255, 0.94);
            border: 1px solid rgba(226, 232, 240, 0.95);
            border-right: none;
            color: #1f2328;
            display: flex;
            align-items: center;
            box-shadow:
                -6px 10px 24px rgba(15, 23, 42, 0.08),
                0 2px 6px rgba(15, 23, 42, 0.04),
                inset 0 1px 0 #ffffff;
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            cursor: pointer;
            z-index: 100005;
            transition: border-color 0.22s, box-shadow 0.22s, background 0.22s, opacity 0.2s, transform 0.2s;
            user-select: none;
            isolation: isolate;
            outline: none;
            -webkit-tap-highlight-color: transparent;
            font-family: inherit;
            animation: desktopDlFabIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes desktopDlFabIn {
            from { transform: translateX(30px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .desktop-dl-fab.is-hiding {
            opacity: 0;
            transform: translateX(40px);
            pointer-events: none;
        }
        .desktop-dl-fab:hover {
            background: linear-gradient(135deg, #ffffff, #f0fdf9);
            border-color: rgba(16, 163, 127, 0.5);
            box-shadow:
                -8px 14px 28px rgba(16, 163, 127, 0.12),
                0 2px 8px rgba(15, 23, 42, 0.05),
                inset 0 1px 0 #ffffff;
        }
        .desktop-dl-fab-orb {
            position: relative;
            flex: none;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #ffffff;
            display: grid;
            place-items: center;
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
        }
        .desktop-dl-fab-ring {
            position: absolute;
            inset: 0;
            width: 32px;
            height: 32px;
            pointer-events: none;
        }
        .desktop-dl-ring-track {
            stroke: rgba(226, 232, 240, 0.9);
        }
        .desktop-dl-ring-fill {
            stroke: #10a37f;
            transition: stroke-dashoffset 0.25s ease-out, stroke 0.2s ease;
        }
        .desktop-dl-fab.is-done .desktop-dl-ring-fill {
            stroke: #10a37f;
        }
        .desktop-dl-fab.is-error .desktop-dl-ring-fill {
            stroke: #ef4444;
        }
        .desktop-dl-fab-icon {
            position: relative;
            z-index: 1;
            width: 16px;
            height: 16px;
            color: #1f2328;
            display: grid;
            place-items: center;
        }
        .desktop-dl-fab-icon svg {
            width: 15px;
            height: 15px;
            stroke: currentColor;
            display: block;
        }
        .desktop-dl-fab.is-done .desktop-dl-fab-icon {
            color: #10a37f;
        }
        .desktop-dl-fab-label {
            max-width: 0;
            overflow: hidden;
            white-space: nowrap;
            opacity: 0;
            font-size: 13px;
            font-weight: 650;
            color: #1f2328;
            margin-left: 0;
            letter-spacing: 0.01em;
            transition: max-width 0.26s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s, margin 0.26s;
        }
        @media (hover: hover) {
            .desktop-dl-fab:hover .desktop-dl-fab-label,
            .desktop-dl-fab:focus-visible .desktop-dl-fab-label {
                max-width: 140px;
                margin-left: 9px;
                opacity: 1;
            }
        }

        /* ── 深色主题适配 ── */
        html[data-theme="dark"] .desktop-dl-banner {
            background: rgba(21, 24, 29, 0.96);
            border-color: rgba(48, 54, 61, 0.9);
            color: #e6e8eb;
            box-shadow: 0 16px 42px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }
        html[data-theme="dark"] .desktop-dl-icon-badge {
            background: #1b1f26;
            border-color: #353a43;
            color: #e6e8eb;
        }
        html[data-theme="dark"] .desktop-dl-filename { color: #e6e8eb; }
        html[data-theme="dark"] .desktop-dl-btn {
            background: #1b1f26;
            border-color: #353a43;
            color: #b3b9c2;
        }
        html[data-theme="dark"] .desktop-dl-btn:hover {
            background: #232831;
            color: #ffffff;
            border-color: #4b5563;
        }
        html[data-theme="dark"] .desktop-dl-icon-btn { color: #8b949e; }
        html[data-theme="dark"] .desktop-dl-icon-btn:hover {
            background: #1b1f26;
            border-color: #353a43;
            color: #e6e8eb;
        }
        html[data-theme="dark"] .desktop-dl-track { background: #262a31; }
        html[data-theme="dark"] .desktop-dl-meta { color: #8b949e; }
        html[data-theme="dark"] .desktop-dl-act-btn.secondary {
            background: #1b1f26;
            color: #b3b9c2;
            border-color: #353a43;
        }
        html[data-theme="dark"] .desktop-dl-act-btn.secondary:hover {
            background: #232831;
            color: #ffffff;
        }
        html[data-theme="dark"] .desktop-dl-fab {
            background: linear-gradient(135deg, rgba(21, 24, 29, 0.96), rgba(26, 32, 44, 0.96));
            border-color: rgba(62, 207, 158, 0.35);
            color: #e6e8eb;
            box-shadow: -8px 12px 28px rgba(0, 0, 0, 0.45);
        }
        html[data-theme="dark"] .desktop-dl-fab:hover {
            border-color: rgba(62, 207, 158, 0.6);
            background: linear-gradient(135deg, rgba(27, 34, 46, 0.98), rgba(21, 24, 29, 0.98));
        }
        html[data-theme="dark"] .desktop-dl-fab-orb {
            background: #1b1f26;
        }
        html[data-theme="dark"] .desktop-dl-ring-track {
            stroke: #262a31;
        }
        html[data-theme="dark"] .desktop-dl-fab-icon {
            color: #e6e8eb;
        }
        html[data-theme="dark"] .desktop-dl-fab-label {
            color: #e6e8eb;
        }
    `;
    document.head.appendChild(style);

    // SVG 图标集合（黑白极简风格）
    const ICONS = {
        download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
        folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
        collapse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>`,
        close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
        error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
    };

    // 状态管理
    const state = {
        activeDownloads: new Map(),
        latestId: null,
        isCollapsed: false,
        dismissTimer: null,
        autoDismissSeconds: 4
    };

    // DOM 元素引用
    let bannerEl = null;
    let fabEl = null;
    const RING_CIRCUMFERENCE = 84.823; // 2 * Math.PI * 13.5

    function createBanner() {
        if (bannerEl) return bannerEl;
        const div = document.createElement('div');
        div.id = 'desktopDlBanner';
        div.className = 'desktop-dl-banner';
        div.hidden = true;
        div.innerHTML = `
            <div class="desktop-dl-header">
                <div class="desktop-dl-title-group">
                    <span class="desktop-dl-icon-badge" id="desktopDlIconBadge">${ICONS.download}</span>
                    <span class="desktop-dl-filename" id="desktopDlFilename" title=""></span>
                </div>
                <div class="desktop-dl-actions">
                    <button type="button" class="desktop-dl-btn" id="desktopDlChangeDirBtn" title="更换默认下载保存目录">
                        ${ICONS.folder}
                        <span>更换目录</span>
                    </button>
                    <button type="button" class="desktop-dl-icon-btn" id="desktopDlCollapseBtn" title="折叠为右侧下载圆环" aria-label="折叠">
                        ${ICONS.collapse}
                    </button>
                    <button type="button" class="desktop-dl-icon-btn" id="desktopDlCloseBtn" title="关闭" aria-label="关闭">
                        ${ICONS.close}
                    </button>
                </div>
            </div>
            <div class="desktop-dl-hint" id="desktopDlHint" hidden></div>
            <div class="desktop-dl-body" id="desktopDlBody">
                <div class="desktop-dl-track">
                    <div class="desktop-dl-bar" id="desktopDlBar"></div>
                </div>
                <div class="desktop-dl-meta">
                    <span class="desktop-dl-stats" id="desktopDlStats">准备下载…</span>
                    <span class="desktop-dl-status" id="desktopDlStatus">下载中</span>
                </div>
            </div>
            <div class="desktop-dl-completed-actions" id="desktopDlCompletedActions" hidden>
                <button type="button" class="desktop-dl-act-btn primary" id="desktopDlOpenFileBtn">打开文件</button>
                <button type="button" class="desktop-dl-act-btn secondary" id="desktopDlShowFolderBtn">打开所在文件夹</button>
            </div>
        `;

        // 按钮交互绑定
        div.querySelector('#desktopDlChangeDirBtn').addEventListener('click', async () => {
            if (!api?.changeDirectory) return;
            const res = await api.changeDirectory();
            if (res && res.success && res.downloadDir) {
                const hint = div.querySelector('#desktopDlHint');
                hint.hidden = false;
                hint.textContent = `下载目录已更新为：${res.downloadDir}`;
                setTimeout(() => { hint.hidden = true; }, 4000);
            }
        });

        div.querySelector('#desktopDlCollapseBtn').addEventListener('click', () => {
            collapseToFab();
        });

        div.querySelector('#desktopDlCloseBtn').addEventListener('click', () => {
            hideBanner(true);
        });

        div.querySelector('#desktopDlOpenFileBtn').addEventListener('click', () => {
            const dl = getCurrentDl();
            if (dl && dl.savePath && api?.openFile) {
                api.openFile(dl.savePath);
            }
        });

        div.querySelector('#desktopDlShowFolderBtn').addEventListener('click', () => {
            const dl = getCurrentDl();
            if (dl && dl.savePath && api?.showItemInFolder) {
                api.showItemInFolder(dl.savePath);
            }
        });

        // 鼠标悬停暂停自动消失计时器，移开继续
        div.addEventListener('mouseenter', () => {
            if (state.dismissTimer) {
                clearTimeout(state.dismissTimer);
                state.dismissTimer = null;
            }
        });
        div.addEventListener('mouseleave', () => {
            const dl = getCurrentDl();
            if (dl && dl.state === 'completed' && !div.hidden) {
                scheduleAutoDismiss();
            }
        });

        document.body.appendChild(div);
        bannerEl = div;
        return div;
    }

    function createFab() {
        if (fabEl) return fabEl;
        const div = document.createElement('div');
        div.id = 'desktopDlFab';
        div.className = 'desktop-dl-fab';
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
        div.setAttribute('title', '点击展开下载进度');
        div.setAttribute('aria-label', '下载进度');
        div.hidden = true;
        div.innerHTML = `
            <div class="desktop-dl-fab-orb" aria-hidden="true">
                <svg class="desktop-dl-fab-ring" viewBox="0 0 32 32">
                    <circle class="desktop-dl-ring-track" cx="16" cy="16" r="13.5" fill="none" stroke-width="2.2" />
                    <circle class="desktop-dl-ring-fill" id="desktopDlRingFill" cx="16" cy="16" r="13.5" fill="none" stroke-width="2.2" stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}" stroke-linecap="round" transform="rotate(-90 16 16)" />
                </svg>
                <div class="desktop-dl-fab-icon" id="desktopDlFabIcon">
                    ${ICONS.download}
                </div>
            </div>
            <span class="desktop-dl-fab-label" id="desktopDlFabLabel">下载中 0%</span>
        `;

        div.addEventListener('click', () => {
            expandToBanner();
        });

        document.body.appendChild(div);
        fabEl = div;
        syncFabPlacement();
        return div;
    }

    function syncFabPlacement(rect) {
        if (!fabEl) return;
        const targetRect = rect || document.querySelector('.ai-fab')?.getBoundingClientRect();
        if (targetRect) {
            const h = fabEl.offsetHeight || 48;
            let targetTop = Math.round(targetRect.top - h - 10);
            if (targetTop < 56) {
                targetTop = Math.round(targetRect.bottom + 10);
            }
            fabEl.style.setProperty('top', `${targetTop}px`, 'important');
            fabEl.style.setProperty('bottom', 'auto', 'important');
        }
    }

    window.addEventListener('tools:ai-fab-position', (e) => {
        syncFabPlacement(e?.detail?.rect);
    });

    function getCurrentDl() {
        if (!state.latestId) return null;
        return state.activeDownloads.get(state.latestId);
    }

    function collapseToFab() {
        state.isCollapsed = true;
        if (bannerEl) {
            bannerEl.classList.add('is-collapsing');
            setTimeout(() => {
                bannerEl.hidden = true;
                bannerEl.classList.remove('is-collapsing');
            }, 260);
        }
        createFab();
        syncFabPlacement();
        fabEl.hidden = false;
        fabEl.classList.remove('is-hiding');
        render();
    }

    function expandToBanner() {
        state.isCollapsed = false;
        if (fabEl) {
            fabEl.classList.add('is-hiding');
            setTimeout(() => {
                fabEl.hidden = true;
                fabEl.classList.remove('is-hiding');
            }, 200);
        }
        createBanner();
        bannerEl.hidden = false;
        bannerEl.classList.remove('is-hiding');
        render();
    }

    function hideBanner(userClosed = false) {
        if (state.dismissTimer) {
            clearTimeout(state.dismissTimer);
            state.dismissTimer = null;
        }
        const dl = getCurrentDl();
        // 如果当前还在下载中且用户点击收起或关闭，折叠到右侧圆环
        if (userClosed && dl && (dl.state === 'progressing' || dl.state === 'started')) {
            collapseToFab();
            return;
        }
        if (bannerEl) {
            bannerEl.classList.add('is-hiding');
            setTimeout(() => {
                bannerEl.hidden = true;
                bannerEl.classList.remove('is-hiding');
            }, 240);
        }
        if (fabEl) {
            fabEl.classList.add('is-hiding');
            setTimeout(() => {
                fabEl.hidden = true;
                fabEl.classList.remove('is-hiding');
            }, 240);
        }
    }

    function scheduleAutoDismiss() {
        if (state.dismissTimer) clearTimeout(state.dismissTimer);
        state.dismissTimer = setTimeout(() => {
            hideBanner(false);
        }, state.autoDismissSeconds * 1000);
    }

    function render() {
        const dl = getCurrentDl();
        if (!dl) return;

        createBanner();
        createFab();

        const percent = Math.max(0, Math.min(100, dl.percent || 0));
        const filename = dl.filename || '未知文件';
        const receivedStr = formatBytes(dl.receivedBytes || 0);
        const totalStr = dl.totalBytes > 0 ? formatBytes(dl.totalBytes) : '未知大小';

        // 更新横幅内容
        bannerEl.querySelector('#desktopDlFilename').textContent = filename;
        bannerEl.querySelector('#desktopDlFilename').title = dl.savePath || filename;
        bannerEl.querySelector('#desktopDlBar').style.width = `${percent}%`;

        const iconBadge = bannerEl.querySelector('#desktopDlIconBadge');
        const statusEl = bannerEl.querySelector('#desktopDlStatus');
        const statsEl = bannerEl.querySelector('#desktopDlStats');
        const completedActions = bannerEl.querySelector('#desktopDlCompletedActions');
        const collapseBtn = bannerEl.querySelector('#desktopDlCollapseBtn');

        bannerEl.classList.remove('is-done', 'is-error');
        fabEl.classList.remove('is-done', 'is-error');

        if (dl.state === 'completed') {
            bannerEl.classList.add('is-done');
            fabEl.classList.add('is-done');
            iconBadge.innerHTML = ICONS.check;
            statsEl.textContent = `${totalStr} · 下载完成`;
            statusEl.textContent = '已保存';
            completedActions.hidden = false;
            collapseBtn.style.display = 'none'; // 已完成无需折叠
        } else if (dl.state === 'interrupted' || dl.state === 'failed') {
            bannerEl.classList.add('is-error');
            fabEl.classList.add('is-error');
            iconBadge.innerHTML = ICONS.error;
            statsEl.textContent = '下载中断';
            statusEl.textContent = '失败';
            completedActions.hidden = true;
            collapseBtn.style.display = 'none';
        } else {
            iconBadge.innerHTML = ICONS.download;
            statsEl.textContent = dl.totalBytes > 0 ? `${percent}% · ${receivedStr} / ${totalStr}` : `${receivedStr}`;
            statusEl.textContent = dl.state === 'paused' ? '已暂停' : '正在下载…';
            completedActions.hidden = true;
            collapseBtn.style.display = 'grid';
        }

        // 更新折叠圆环
        const ringFill = fabEl.querySelector('#desktopDlRingFill');
        const fabIcon = fabEl.querySelector('#desktopDlFabIcon');
        const fabLabel = fabEl.querySelector('#desktopDlFabLabel');

        const offset = RING_CIRCUMFERENCE * (1 - percent / 100);
        ringFill.style.strokeDashoffset = offset;

        if (dl.state === 'completed') {
            fabIcon.innerHTML = ICONS.check;
            fabLabel.textContent = '下载完成';
        } else if (dl.state === 'interrupted' || dl.state === 'failed') {
            fabIcon.innerHTML = ICONS.error;
            fabLabel.textContent = '下载失败';
        } else {
            fabIcon.innerHTML = ICONS.download;
            fabLabel.textContent = `下载中 ${percent}%`;
        }
    }

    function handleDownloadEvent(event) {
        if (!event || !event.type) return;

        if (event.type === 'started') {
            const dl = {
                id: event.id,
                filename: event.filename,
                savePath: event.savePath,
                downloadDir: event.downloadDir,
                totalBytes: event.totalBytes || 0,
                receivedBytes: 0,
                percent: 0,
                state: 'progressing'
            };
            state.activeDownloads.set(event.id, dl);
            state.latestId = event.id;

            if (!state.isCollapsed) {
                createBanner();
                bannerEl.hidden = false;
                bannerEl.classList.remove('is-hiding');
            } else {
                createFab();
                fabEl.hidden = false;
                fabEl.classList.remove('is-hiding');
            }
            render();
        } else if (event.type === 'progress') {
            const dl = state.activeDownloads.get(event.id);
            if (dl) {
                dl.receivedBytes = event.receivedBytes;
                dl.totalBytes = event.totalBytes;
                dl.percent = event.percent;
                dl.state = event.state;
                if (event.savePath) dl.savePath = event.savePath;
            }
            render();
        } else if (event.type === 'completed') {
            const dl = state.activeDownloads.get(event.id);
            if (dl) {
                dl.percent = 100;
                dl.state = 'completed';
                if (event.savePath) dl.savePath = event.savePath;
            }
            render();
            // 自动倒计时消失
            scheduleAutoDismiss();
        } else if (event.type === 'failed' || event.type === 'cancelled') {
            const dl = state.activeDownloads.get(event.id);
            if (dl) {
                dl.state = event.type === 'cancelled' ? 'cancelled' : 'failed';
            }
            render();
            setTimeout(() => {
                hideBanner(false);
            }, 6000);
        } else if (event.type === 'dir-changed') {
            const hint = bannerEl?.querySelector('#desktopDlHint');
            if (hint && event.downloadDir) {
                hint.hidden = false;
                hint.textContent = `默认下载目录已更新为：${event.downloadDir}`;
                setTimeout(() => { hint.hidden = true; }, 4000);
            }
        }
    }

    // 监听 Electron 桌面端主进程下发的下载事件
    if (api?.onEvent) {
        api.onEvent((payload) => {
            handleDownloadEvent(payload);
        });
    }

    // 暴露供调试或外部脚本协同
    window.DesktopDownloadManager = {
        getState: () => ({ ...state }),
        expand: expandToBanner,
        collapse: collapseToFab,
        hide: () => hideBanner(true)
    };
})();
