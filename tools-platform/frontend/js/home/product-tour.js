/**
 * 首页新手引导（v2）：7 步焦点蒙版 + 浮层说明卡片。
 * 严格避免与首次导入弹窗（first-run-onboarding）、系统模态框以及工具页面（独立路由或 ?app= 内嵌框）冲突。
 */
(function initHomeProductTour() {
    if (window.HomeProductTour) return;

    const STORAGE_PREFIX = 'tp_home_tour_v1:';
    const PAD = 8;
    const CARD_WIDTH = 340;
    const CARD_GAP = 14;
    const MARGIN = 14;

    const I18N = {
        'zh-CN': {
            stepOf: '{i} / {n}',
            skip: '跳过引导',
            back: '上一步',
            next: '下一步',
            done: '开始使用',
            kbd: '← → 切换 · Esc 关闭',
            steps: [
                {
                    id: 'composer',
                    badge: 'AI 工作台',
                    title: '随时向 Dragon Claw 提问',
                    desc: '在这里输入需求、上传表格或文件，或者通过命令让 Dragon Claw 自动分析数据、生成报告、操作桌面与网页。'
                },
                {
                    id: 'modes',
                    badge: '模式切换',
                    title: '在对话与工具面板间秒切',
                    desc: '“对话”聚焦 AI 协作与文件分析，“工具”汇总了你常用与扩展的效率应用，支持一键打开。'
                },
                {
                    id: 'sidebar-chats',
                    badge: '会话与频道',
                    title: '管理历史对话与多端消息',
                    desc: '随时开启新对话，或通过“频道会话”同步查看 WeLink、微信等外接通道的实时消息与任务记录。'
                },
                {
                    id: 'skills',
                    badge: '扩展能力',
                    title: '探索技能、插件与工具市场',
                    desc: '一站查看已装配的内置技能、第三方插件与自定义脚本，也可导入专属工具扩展工作流。'
                },
                {
                    id: 'more-tools',
                    badge: '快捷入口',
                    title: '展开更多常用工作流与导航',
                    desc: '点击或悬停“更多”，可快速直达个人工作流、外部链接与各业务专项模块，支持自定义置顶。'
                },
                {
                    id: 'alerts',
                    badge: '消息中心',
                    title: '集中查看 SLA 预警与系统通知',
                    desc: '指标异常、服务状态变化和任务完成都会推送到这里，支持按未读与告警等级快速筛选。'
                },
                {
                    id: 'account',
                    badge: '个人中心',
                    title: '个性化设置与随时重温引导',
                    desc: '点击左下角头像可切换明暗主题、中英文、宽屏布局、查看服务状态与版本，或随时重开本引导。'
                }
            ]
        },
        'en-US': {
            stepOf: '{i} / {n}',
            skip: 'Skip tour',
            back: 'Back',
            next: 'Next',
            done: 'Get started',
            kbd: '← → navigate · Esc close',
            steps: [
                {
                    id: 'composer',
                    badge: 'AI Workspace',
                    title: 'Ask Dragon Claw anything',
                    desc: 'Type instructions, attach spreadsheets or files, and let Dragon Claw analyze data, write reports, or automate workflows.'
                },
                {
                    id: 'modes',
                    badge: 'Mode Switch',
                    title: 'Switch between Chat and Tools',
                    desc: 'Stay in Chat for AI collaboration, or switch to Tools for instant access to your workspace apps.'
                },
                {
                    id: 'sidebar-chats',
                    badge: 'Chats & Channels',
                    title: 'Manage conversations & channels',
                    desc: 'Start a fresh chat anytime, or open Channels to inspect synced WeLink and WeChat conversations.'
                },
                {
                    id: 'skills',
                    badge: 'Capabilities',
                    title: 'Explore skills, plugins & tools',
                    desc: 'Browse built-in skills, scripts, and marketplace plugins, or import custom tools into your workspace.'
                },
                {
                    id: 'more-tools',
                    badge: 'Shortcuts',
                    title: 'Open more tools and workflows',
                    desc: 'Hover or click More to reach pinned workflows, links, and specialized tool pages quickly.'
                },
                {
                    id: 'alerts',
                    badge: 'Notifications',
                    title: 'Stay on top of alerts & updates',
                    desc: 'View SLA warnings, service incidents, and task notifications in one place with quick filters.'
                },
                {
                    id: 'account',
                    badge: 'Account',
                    title: 'Preferences and replay tour',
                    desc: 'Switch dark/light theme, language, wide layout, check service health, or replay this guide anytime.'
                }
            ]
        }
    };

    const getLang = () => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN');
    const getCopy = () => I18N[getLang()] || I18N['zh-CN'];

    function storageKey() {
        const user = String(localStorage.getItem('tools_user') || '').trim();
        return `${STORAGE_PREFIX}${user || 'guest'}`;
    }

    function isVisibleElement(el, { ignoreOpacity = false } = {}) {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (!ignoreOpacity && style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function hasOpenModalDialog() {
        if (window.__tpOnboardingPending === true) return true;
        const modalSelectors = [
            'dialog[open]',
            '#firstRunOnboardingModal',
            '.quick-start-backdrop',
            '#builtinToolsSyncModal',
            '.tools-dialog',
            '.app-dialog',
            '[role="dialog"]:not(.v2-tour-root)',
            '[aria-modal="true"]:not(.v2-tour-root)',
            '#loginModal:not([hidden])',
            '.auth-overlay.is-open'
        ];
        for (const sel of modalSelectors) {
            for (const el of document.querySelectorAll(sel)) {
                if (isVisibleElement(el)) return true;
            }
        }
        const navModal = document.getElementById('navSettingsModal');
        if (navModal && isVisibleElement(navModal)) return true;
        return false;
    }

    function isHomeChatContext() {
        if (!document.documentElement.matches('[data-ui="v2"]')) return false;
        const cleanPath = (location.pathname || '/').replace(/\/+$/, '') || '/';
        if (cleanPath !== '/' && cleanPath !== '/index.html') return false;
        const params = new URLSearchParams(location.search);
        if (params.has('app')) return false;
        if (window.HomeToolFrame?.isOpen?.()) return false;
        if (window.HomeSkillHub?.isOpen?.()) return false;
        if (document.documentElement.classList.contains('v2-library-open')) return false;
        return true;
    }

    function hasActiveUserWork() {
        if (document.body.classList.contains('dc-chatting')) return true;
        const input = document.getElementById('dcInput');
        if (input && input.value.trim().length > 0) return true;
        const activePop = document.querySelector('.v2-pop.is-open, .v2-messages.is-open, #v2LinksSubmenu.is-open, #dcAttachMenu:not([hidden]), #dcSkillMenu:not([hidden]), .dc-connector-popover');
        if (activePop && isVisibleElement(activePop)) return true;
        return false;
    }

    function isAutomatedTestHarness() {
        return Boolean(navigator.webdriver || window.fixtureErrors || localStorage.getItem('tools_token') === 'fixture-session');
    }

    function canAutoStart() {
        if (!isHomeChatContext()) return false;
        const params = new URLSearchParams(location.search);
        if (params.get('tour') === '0') return false;
        if (isAutomatedTestHarness() && !window.__tpAllowTourInTests && params.get('tour') !== '1') return false;
        if (!localStorage.getItem('tools_user')) return false;
        if (localStorage.getItem(storageKey()) === 'done' && params.get('tour') !== '1') return false;
        if (hasOpenModalDialog()) return false;
        if (hasActiveUserWork() && params.get('tour') !== '1') return false;
        return true;
    }

    const STEPS = [
        {
            id: 'composer',
            placement: 'top',
            find: () => document.querySelector('#dcComposer') || document.querySelector('#dcInput')
        },
        {
            id: 'modes',
            placement: 'bottom',
            find: () => document.querySelector('.v2-main .v2-modes [data-v2-modes]')
                || document.querySelector('[data-v2-modes]')
        },
        {
            id: 'sidebar-chats',
            placement: 'right',
            find: () => document.querySelector('#homeSidebar .v2-nav > [data-v2-action="newChat"]')
                || document.querySelector('#homeSidebar .v2-nav')
        },
        {
            id: 'skills',
            placement: 'right',
            find: () => document.querySelector('#homeSidebar .v2-nav > [data-v2-action="skillHub"]')
                || document.querySelector('#homeSidebar .v2-nav')
        },
        {
            id: 'more-tools',
            placement: 'right',
            find: () => document.querySelector('#homeSidebar [data-v2-flyout="more"]')
                || document.querySelector('#homeSidebar .v2-sidebar-more')
                || document.querySelector('#homeSidebar')
        },
        {
            id: 'alerts',
            placement: 'right',
            find: () => document.getElementById('v2AlertBtn')
        },
        {
            id: 'account',
            placement: 'right',
            prepare: async () => {
                const openMenu = document.querySelector('.v2-account.is-open');
                if (!openMenu) {
                    document.getElementById('v2UserBtn')?.click();
                    state.openedAccountMenu = Boolean(document.querySelector('.v2-account.is-open'));
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    setTimeout(() => { if (state.active && STEPS[state.index]?.id === 'account') updateSpotlight(); }, 220);
                }
            },
            cleanup: () => {
                if (state.openedAccountMenu && document.querySelector('.v2-account.is-open')) {
                    document.getElementById('v2UserBtn')?.click();
                }
                state.openedAccountMenu = false;
            },
            ignoreOpacity: true,
            find: () => {
                const openMenu = document.querySelector('.v2-account.is-open');
                return (openMenu && isVisibleElement(openMenu, { ignoreOpacity: true })) ? openMenu : document.getElementById('v2UserBtn');
            }
        }
    ];

    const state = {
        active: false,
        index: 0,
        manual: false,
        openedAccountMenu: false,
        wasSidebarCollapsed: false,
        initialMode: null,
        root: null,
        cutout: null,
        ring: null,
        card: null,
        scheduleTimer: 0,
        retryCount: 0,
        repositionRaf: 0
    };

    function markDone() {
        try { localStorage.setItem(storageKey(), 'done'); } catch {}
    }

    function ensureRoot() {
        if (state.root) return state.root;
        const root = document.createElement('div');
        root.className = 'v2-tour-root';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'v2TourTitle');
        root.innerHTML = `
            <div class="v2-tour-backdrop">
                <svg class="v2-tour-svg" width="100%" height="100%" aria-hidden="true">
                    <defs>
                        <mask id="v2TourCutoutMask">
                            <rect width="100%" height="100%" fill="white"></rect>
                            <rect class="v2-tour-cutout" x="0" y="0" width="0" height="0" rx="14" ry="14" fill="black"></rect>
                        </mask>
                    </defs>
                    <rect class="v2-tour-scrim" width="100%" height="100%" mask="url(#v2TourCutoutMask)"></rect>
                </svg>
            </div>
            <div class="v2-tour-ring" aria-hidden="true"></div>
            <section class="v2-tour-card">
                <div class="v2-tour-top">
                    <div class="v2-tour-meta">
                        <span class="v2-tour-eyebrow"></span>
                        <span class="v2-tour-badge"></span>
                    </div>
                    <button type="button" class="v2-tour-skip"></button>
                </div>
                <div class="v2-tour-body">
                    <h2 class="v2-tour-title" id="v2TourTitle"></h2>
                    <p class="v2-tour-desc"></p>
                </div>
                <div class="v2-tour-foot">
                    <div class="v2-tour-dots" role="tablist"></div>
                    <div class="v2-tour-actions">
                        <button type="button" class="v2-tour-btn is-ghost" data-tour-prev></button>
                        <button type="button" class="v2-tour-btn is-primary" data-tour-next></button>
                    </div>
                </div>
                <div class="v2-tour-kbd"></div>
            </section>
        `;
        document.body.appendChild(root);

        state.root = root;
        state.cutout = root.querySelector('.v2-tour-cutout');
        state.ring = root.querySelector('.v2-tour-ring');
        state.card = root.querySelector('.v2-tour-card');

        root.querySelector('.v2-tour-backdrop').addEventListener('click', () => {
            if (!state.card) return;
            state.card.classList.remove('is-nudge');
            void state.card.offsetWidth;
            state.card.classList.add('is-nudge');
        });
        root.querySelector('.v2-tour-skip').addEventListener('click', () => close(true));
        root.querySelector('[data-tour-prev]').addEventListener('click', () => go(state.index - 1));
        root.querySelector('[data-tour-next]').addEventListener('click', () => {
            if (state.index >= STEPS.length - 1) close(true);
            else go(state.index + 1);
        });
        root.querySelector('.v2-tour-dots').addEventListener('click', event => {
            const dot = event.target.closest('[data-tour-dot]');
            if (!dot) return;
            const targetIdx = Number(dot.dataset.tourDot);
            if (Number.isInteger(targetIdx)) go(targetIdx);
        });
        return root;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function placeSpotlight(targetRect, preferredPlacement) {
        if (!state.cutout || !state.ring || !state.card) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.min(CARD_WIDTH, Math.max(240, vw - MARGIN * 2));
        state.card.style.width = `${width}px`;
        const cardRect = state.card.getBoundingClientRect();
        const cardW = cardRect.width || width;
        const cardH = cardRect.height || 200;

        if (!targetRect) {
            state.cutout.setAttribute('width', '0');
            state.cutout.setAttribute('height', '0');
            state.ring.style.opacity = '0';
            const cx = Math.round((vw - cardW) / 2);
            const cy = Math.round((vh - cardH) / 2);
            state.card.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
            return;
        }

        const x = clamp(targetRect.left - PAD, 4, vw - 8);
        const y = clamp(targetRect.top - PAD, 4, vh - 8);
        const w = Math.max(24, Math.min(vw - x - 4, targetRect.width + PAD * 2));
        const h = Math.max(24, Math.min(vh - y - 4, targetRect.height + PAD * 2));
        const radius = Math.min(16, Math.round(Math.min(w, h) / 4));

        state.cutout.setAttribute('x', String(Math.round(x)));
        state.cutout.setAttribute('y', String(Math.round(y)));
        state.cutout.setAttribute('width', String(Math.round(w)));
        state.cutout.setAttribute('height', String(Math.round(h)));
        state.cutout.setAttribute('rx', String(radius));
        state.cutout.setAttribute('ry', String(radius));

        state.ring.style.opacity = '1';
        state.ring.style.borderRadius = `${radius}px`;
        state.ring.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
        state.ring.style.width = `${Math.round(w)}px`;
        state.ring.style.height = `${Math.round(h)}px`;

        const candidates = {
            right: { left: x + w + CARD_GAP, top: clamp(y + h / 2 - cardH / 2, MARGIN, vh - cardH - MARGIN) },
            left: { left: x - cardW - CARD_GAP, top: clamp(y + h / 2 - cardH / 2, MARGIN, vh - cardH - MARGIN) },
            bottom: { left: clamp(x + w / 2 - cardW / 2, MARGIN, vw - cardW - MARGIN), top: y + h + CARD_GAP },
            top: { left: clamp(x + w / 2 - cardW / 2, MARGIN, vw - cardW - MARGIN), top: y - cardH - CARD_GAP }
        };
        const fits = pos => pos.left >= MARGIN && pos.left + cardW <= vw - MARGIN && pos.top >= MARGIN && pos.top + cardH <= vh - MARGIN;
        const order = [preferredPlacement, 'right', 'bottom', 'top', 'left'];
        let chosen = null;
        for (const dir of order) {
            if (dir && candidates[dir] && fits(candidates[dir])) {
                chosen = candidates[dir];
                break;
            }
        }
        if (!chosen) {
            const fallback = candidates[preferredPlacement] || candidates.bottom;
            chosen = {
                left: clamp(fallback.left, MARGIN, vw - cardW - MARGIN),
                top: clamp(fallback.top, MARGIN, vh - cardH - MARGIN)
            };
        }
        state.card.style.transform = `translate3d(${Math.round(chosen.left)}px, ${Math.round(chosen.top)}px, 0)`;
    }

    function updateSpotlight() {
        if (!state.active) return;
        const step = STEPS[state.index];
        const el = step?.find?.();
        const rect = el && isVisibleElement(el, { ignoreOpacity: Boolean(step?.ignoreOpacity) }) ? el.getBoundingClientRect() : null;
        placeSpotlight(rect, step?.placement || 'bottom');
    }

    async function go(nextIndex) {
        if (!state.active) return;
        const prevStep = STEPS[state.index];
        const clamped = clamp(nextIndex, 0, STEPS.length - 1);
        if (prevStep && prevStep !== STEPS[clamped]) {
            prevStep.cleanup?.();
        }
        state.index = clamped;
        const step = STEPS[state.index];
        if (typeof step.prepare === 'function') {
            await step.prepare();
        }

        const copy = getCopy();
        const stepCopy = copy.steps[state.index] || copy.steps[0];
        const root = ensureRoot();
        root.querySelector('.v2-tour-eyebrow').textContent = copy.stepOf
            .replace('{i}', String(state.index + 1))
            .replace('{n}', String(STEPS.length));
        const badge = root.querySelector('.v2-tour-badge');
        badge.textContent = stepCopy.badge || '';
        badge.hidden = !stepCopy.badge;
        root.querySelector('.v2-tour-skip').textContent = copy.skip;
        root.querySelector('.v2-tour-title').textContent = stepCopy.title;
        root.querySelector('.v2-tour-desc').textContent = stepCopy.desc;
        root.querySelector('.v2-tour-kbd').textContent = copy.kbd;

        const prevBtn = root.querySelector('[data-tour-prev]');
        prevBtn.textContent = copy.back;
        prevBtn.hidden = state.index === 0;

        const nextBtn = root.querySelector('[data-tour-next]');
        nextBtn.textContent = state.index === STEPS.length - 1 ? copy.done : copy.next;

        const dotsWrap = root.querySelector('.v2-tour-dots');
        dotsWrap.innerHTML = STEPS.map((_, idx) => {
            const cls = idx < state.index ? 'is-done' : idx === state.index ? 'is-active' : '';
            return `<button type="button" class="v2-tour-dot ${cls}" data-tour-dot="${idx}" aria-label="${idx + 1} / ${STEPS.length}"></button>`;
        }).join('');

        updateSpotlight();
    }

    function onKeyDown(event) {
        if (!state.active) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
            if (document.activeElement?.closest('.v2-tour-dots, [data-tour-prev], .v2-tour-skip')) return;
            event.preventDefault();
            if (state.index >= STEPS.length - 1) close(true);
            else go(state.index + 1);
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            if (state.index > 0) go(state.index - 1);
        }
    }

    function onViewportChange() {
        if (!state.active) return;
        cancelAnimationFrame(state.repositionRaf);
        state.repositionRaf = requestAnimationFrame(updateSpotlight);
    }

    async function start(options = {}) {
        const manual = Boolean(options.manual);
        if (state.active) return true;
        if (!manual && !canAutoStart()) return false;
        if (!document.documentElement.matches('[data-ui="v2"]')) return false;

        clearTimeout(state.scheduleTimer);
        state.manual = manual;
        state.active = true;
        state.index = 0;

        if (manual && (window.HomeToolFrame?.isOpen?.() || window.HomeSkillHub?.isOpen?.())) {
            document.documentElement.classList.add('v2-tour-suspending');
        }
        state.initialMode = window.HomeMode?.get?.() || null;
        if (state.initialMode && state.initialMode !== 'chat') {
            window.HomeMode?.set?.('chat');
        }
        state.wasSidebarCollapsed = document.documentElement.classList.contains('v2-side-collapsed');
        if (state.wasSidebarCollapsed) {
            document.documentElement.classList.remove('v2-side-collapsed');
        }

        const root = ensureRoot();
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onViewportChange);
        await go(0);
        requestAnimationFrame(() => root.classList.add('is-open'));
        return true;
    }

    function close(completed = true) {
        if (!state.active) return;
        STEPS[state.index]?.cleanup?.();
        state.active = false;
        if (completed) markDone();
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onViewportChange);
        cancelAnimationFrame(state.repositionRaf);

        if (state.root) {
            state.root.classList.remove('is-open');
            state.root.hidden = true;
            state.root.style.display = 'none';
            state.root.style.pointerEvents = 'none';
            const oldRoot = state.root;
            state.root = null;
            state.cutout = null;
            state.ring = null;
            state.card = null;
            setTimeout(() => { try { oldRoot.remove(); } catch {} }, 280);
        }
        document.documentElement.classList.remove('v2-tour-suspending');
        if (state.wasSidebarCollapsed) {
            document.documentElement.classList.add('v2-side-collapsed');
            state.wasSidebarCollapsed = false;
        }
        if (state.initialMode && state.initialMode !== 'chat') {
            window.HomeMode?.set?.(state.initialMode);
        }
        state.initialMode = null;
        state.manual = false;
    }

    function replay() {
        return start({ manual: true });
    }

    function reset() {
        try { localStorage.removeItem(storageKey()); } catch {}
    }

    function scheduleAutoStart(delayMs = 1100) {
        clearTimeout(state.scheduleTimer);
        if (state.active) return;
        state.scheduleTimer = setTimeout(() => {
            if (state.active) return;
            if (canAutoStart()) {
                start({ manual: false });
                return;
            }
            // Only defer while waiting for onboarding status / open onboarding modal on the homepage;
            // never retry on tool routes, ?app= tool frames, or when already done/disabled.
            const params = new URLSearchParams(location.search);
            if (isHomeChatContext()
                && params.get('tour') !== '0'
                && localStorage.getItem('tools_user')
                && (localStorage.getItem(storageKey()) !== 'done' || params.get('tour') === '1')
                && !(isAutomatedTestHarness() && !window.__tpAllowTourInTests && params.get('tour') !== '1')
                && hasOpenModalDialog()
                && state.retryCount < 60) {
                state.retryCount += 1;
                scheduleAutoStart(1000);
            }
        }, delayMs);
    }

    window.HomeProductTour = {
        start,
        replay,
        close,
        reset,
        isOpen: () => state.active,
        isCompleted: () => localStorage.getItem(storageKey()) === 'done',
        stepCount: () => STEPS.length
    };

    window.addEventListener('tools:authchange', () => {
        state.retryCount = 0;
        scheduleAutoStart(900);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => scheduleAutoStart(1100), { once: true });
    } else {
        scheduleAutoStart(1100);
    }
})();
