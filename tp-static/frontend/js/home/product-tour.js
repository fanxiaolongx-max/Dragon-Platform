/**
 * 首页新手引导：工作台入口、系统工具和 AI 提问示例。
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
            tool: '系统工具',
            exampleTyping: '正在输入示例…',
            exampleReview: '看完问题，点「下一步」发送。',
            exampleReviewKbd: 'Esc 关闭',
            exampleRunning: '正在查询…',
            exampleDone: '查看回答，然后继续。',
            prompt: '用最新已入库的报表快照查本月未达标指标，列出实际值、目标值和差距。再用「一键催办」的快照列出临期和已超期的 CPT 专项风险、常规风险、整改单和工单，注明单号、截止日期和责任人。优先为未来 3 天内到期的事项拟催办草稿，如果没有就列出最急的已超期事项，等我确认后再发送。',
            steps: [
                {
                    id: 'composer',
                    badge: 'AI 工作台',
                    title: '随时向 Dragon Claw 提问',
                    desc: '让 AI 查本月未达标指标和临期工单。'
                },
                {
                    id: 'modes',
                    badge: '模式切换',
                    title: '在对话与工具面板间秒切',
                    desc: '在「对话」里问 AI，在「工具」里打开业务页面。'
                },
                {
                    id: 'sidebar-chats',
                    badge: '会话与频道',
                    title: '管理历史对话与多端消息',
                    desc: '新建 AI 对话，或在「频道会话」查看 WeLink 和微信消息。'
                },
                {
                    id: 'skills',
                    badge: '扩展能力',
                    title: '探索技能、插件与工具市场',
                    desc: '在这里找技能、插件和脚本，也能导入自己的工具。'
                },
                {
                    id: 'more-tools',
                    badge: '快捷入口',
                    title: '展开更多常用工作流与导航',
                    desc: '打开「更多」，查看其他工作入口。'
                },
                {
                    id: 'alerts',
                    badge: '消息中心',
                    title: '集中查看 SLA 预警与系统通知',
                    desc: '在这里看指标预警和任务通知。'
                },
                {
                    id: 'account',
                    badge: '个人中心',
                    title: '个性化设置与随时重温引导',
                    desc: '点头像切换语言、主题，或重开本引导。'
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
            tool: 'System tool',
            exampleTyping: 'Typing an example…',
            exampleReview: 'Read the question, then select Next to send it.',
            exampleReviewKbd: 'Esc close',
            exampleRunning: 'Checking…',
            exampleDone: 'Read the reply, then continue.',
            prompt: 'Use the latest saved report snapshot to list this month’s missed targets with actuals, targets, and gaps. From the One-Click Follow-Up snapshot, list upcoming and overdue CPT risks, regular risks, rectification tickets, and open tickets with IDs, due dates, and owners. Draft reminders for items due in the next 3 days or urgent overdue items if none are due soon. Wait for confirmation before sending.',
            steps: [
                {
                    id: 'composer',
                    badge: 'AI Workspace',
                    title: 'Ask Dragon Claw anything',
                    desc: 'Ask AI about this month’s missed targets and deadlines.'
                },
                {
                    id: 'modes',
                    badge: 'Mode Switch',
                    title: 'Switch between Chat and Tools',
                    desc: 'Use Chat for AI and Tools for business pages.'
                },
                {
                    id: 'sidebar-chats',
                    badge: 'Chats & Channels',
                    title: 'Manage conversations & channels',
                    desc: 'Start a chat or open Channels for WeLink and WeChat messages.'
                },
                {
                    id: 'skills',
                    badge: 'Capabilities',
                    title: 'Explore skills, plugins & tools',
                    desc: 'Find skills, plugins and scripts, or import your own tools.'
                },
                {
                    id: 'more-tools',
                    badge: 'Shortcuts',
                    title: 'Open more tools and workflows',
                    desc: 'Open More to find additional work shortcuts.'
                },
                {
                    id: 'alerts',
                    badge: 'Notifications',
                    title: 'Stay on top of alerts & updates',
                    desc: 'Check metric alerts and task notifications here.'
                },
                {
                    id: 'account',
                    badge: 'Account',
                    title: 'Preferences and replay tour',
                    desc: 'Open your account menu to change the language or theme, or replay this tour.'
                }
            ]
        }
    };

    const TOOL_STEPS = [
        {
            id: 'uivf12', anchor: '.btn-batch-run-row',
            zh: ['数据抓取', '用现成脚本批量抓表，省去逐个网站手动下载。'],
            en: ['Data Capture', 'Run a saved script to collect tables in batches.']
        },
        {
            id: 'sla', anchor: '.btn-batch-xl',
            zh: ['数据导入', '批量导入表格，系统按规则算指标、标临期。'],
            en: ['Data Import', 'Import tables in bulk to calculate metrics and flag deadlines.']
        },
        {
            id: 'report', anchor: '#report-content', data: true,
            zh: ['报表看板', '选月份和快照，一眼看清谁达标、差多少。'],
            en: ['Report Dashboard', 'Choose a month and snapshot to see scores and gaps.']
        },
        {
            id: 'expedite', anchor: '#brief-textarea', data: true,
            zh: ['一键催办', '选报表快照，一键生成可复制的催办简报。'],
            en: ['One-Click Follow-Up', 'Pick a report snapshot to generate a follow-up brief.']
        },
        {
            id: 'monthly', anchor: '#airReportPane', data: true,
            zh: ['月报页面', '选月份、套模板，让 AI 帮你出图和写结论。'],
            en: ['Monthly Report', 'Pick a month and template, then ask AI for charts and findings.']
        },
        {
            id: 'bigscreen', anchor: '.screen-grid', data: true,
            zh: ['大屏看板', '开会直接看趋势、客户群排名和风险。'],
            en: ['Big Screen Dashboard', 'Present trends, customer-group rankings, and risks on one screen.']
        },
        {
            id: 'opsDrafts', href: '/?tour=0&opsGuide=1#ops-drafts', isolated: true, data: true,
            anchor: '.ops-inbox-panel, #platformConfirmModal.open .nav-confirm-dialog, .app-dialog.open .app-dialog-card',
            zh: ['运维待办', '核对微信或 WeLink 草稿和收件人，再确认发送。'],
            en: ['Ops Drafts', 'Review WeChat or WeLink drafts and confirm the recipients before sending.']
        },
    ];

    const getLang = () => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN');
    const getCopy = () => I18N[getLang()] || I18N['zh-CN'];

    function storageKey() {
        const user = String(localStorage.getItem('tools_user') || '').trim();
        return `${STORAGE_PREFIX}${user || 'guest'}`;
    }

    function isVisibleElement(el, { ignoreOpacity = false } = {}) {
        if (!el || !el.isConnected) return false;
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
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

    const HOME_STEPS = [
        {
            id: 'composer',
            placement: 'top',
            find: () => document.querySelector('#dcComposer') || document.querySelector('#dcInput')
        },
        {
            id: 'modes',
            placement: 'bottom',
            find: () => document.querySelector('.dc-landing [data-v2-modes]')
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
                    setTimeout(() => { if (state.active && state.steps[state.index]?.id === 'account') updateSpotlight(); }, 220);
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

    function availableSteps() {
        const routes = new Map((window.ToolsPlatform?.catalog?.() || []).map(tool => [tool.id, tool.href]));
        const tools = TOOL_STEPS.filter(tool => routes.has(tool.id) || tool.href)
            .map(tool => ({ ...tool, href: routes.get(tool.id) || tool.href, placement: 'right' }));
        return [...HOME_STEPS.slice(0, -2), ...tools, ...HOME_STEPS.slice(-2)];
    }

    const state = {
        active: false,
        index: 0,
        steps: [],
        previousFocus: null,
        toolFrame: null,
        toolDocument: null,
        toolLayout: null,
        toolMutations: null,
        toolLoadTimer: 0,
        toolRevealAt: 0,
        focusTarget: null,
        exampleSent: false,
        examplePending: false,
        exampleTyping: null,
        exampleDraft: null,
        exampleObserver: null,
        exampleLayout: null,
        restoreChat: null,
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
                    <p class="v2-tour-desc" aria-live="polite"></p>
                </div>
                <div class="v2-tour-foot">
                    <button type="button" class="v2-tour-btn is-ghost" data-tour-prev></button>
                    <button type="button" class="v2-tour-btn is-primary" data-tour-next></button>
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
            if (state.exampleDraft) sendExample();
            else if (state.index >= state.steps.length - 1) close(true);
            else go(state.index + 1);
        });
        return root;
    }

    async function typeExample() {
        if (window.HomeToolFrame?.isOpen?.() || window.HomeSkillHub?.isOpen?.()
            || !window.DragonClaw?.typeTourExample) return;
        const typing = new AbortController();
        state.exampleTyping = typing;
        renderStep();
        const draft = await window.DragonClaw.typeTourExample(getCopy().prompt, typing.signal);
        if (typing.signal.aborted) return;
        state.exampleTyping = null;
        state.exampleDraft = draft;
        renderStep();
    }

    function sendExample() {
        const composer = document.getElementById('dcComposer');
        const started = state.exampleDraft.submit();
        state.exampleDraft = null;
        state.examplePending = started && composer.classList.contains('is-generating');
        if (!started) {
            renderStep();
            return;
        }
        state.initialMode = null;
        state.exampleSent = true;
        if (state.examplePending) {
            state.exampleObserver = new MutationObserver(() => {
                if (composer.classList.contains('is-generating')) return;
                state.exampleObserver.disconnect();
                state.exampleObserver = null;
                state.examplePending = false;
                renderStep();
                state.root.querySelector('[data-tour-next]').focus({ preventScroll: true });
            });
            state.exampleObserver.observe(composer, { attributes: true, attributeFilter: ['class'] });
        }
        renderStep();
        (state.root.querySelector('[data-tour-next]:enabled') || state.root.querySelector('.v2-tour-skip')).focus({ preventScroll: true });
    }

    function setExampleLayout(active) {
        const root = document.documentElement;
        state.root.classList.toggle('is-chat-demo', active);
        root.classList.toggle('v2-tour-chat', active);
        if (active && !state.exampleLayout) {
            state.card.style.removeProperty('transform');
            state.exampleLayout = new ResizeObserver(onViewportChange);
            state.exampleLayout.observe(document.getElementById('dcThread'));
            state.exampleLayout.observe(state.card);
        } else if (!active) {
            state.exampleLayout?.disconnect();
            state.exampleLayout = null;
            state.root.querySelector('.v2-tour-backdrop').style.removeProperty('clip-path');
        }
    }

    function openTourTool(step) {
        if (!step.href) return;
        state.root.classList.add('is-tool-loading');
        state.toolRevealAt = performance.now() + 220;
        state.toolLoadTimer = setTimeout(() => {
            endToolLoading();
            updateSpotlight();
        }, 15000);
        const toolFrame = window.HomeToolFrame;
        if (!step.isolated && !toolFrame?.isOpen?.() && !window.HomeSkillHub?.isOpen?.()
            && toolFrame?.open?.(step.href, { syncUrl: false })) {
            state.toolFrame = document.querySelector('#v2ToolFrame .v2-tool-frame-view');
        } else {
            // Keep an already-open tool or hub mounted so its work survives the tour.
            const frame = document.createElement('iframe');
            frame.className = 'v2-tour-tool';
            frame.title = (getLang() === 'en-US' ? step.en : step.zh)[0];
            frame.tabIndex = -1;
            frame.inert = true;
            frame.src = window.ToolsNavigation?.toolUrl(step.href) || step.href;
            state.root.prepend(frame);
            state.toolFrame = frame;
        }
        state.toolFrame?.addEventListener('load', onTourToolLoad);
    }

    function endToolLoading() {
        clearTimeout(state.toolLoadTimer);
        state.root.classList.remove('is-tool-loading');
    }

    function stopToolTracking() {
        state.toolDocument?.removeEventListener('scroll', onViewportChange, true);
        state.toolDocument?.removeEventListener('transitionend', onViewportChange, true);
        state.toolDocument?.removeEventListener('animationend', onViewportChange, true);
        state.toolLayout?.disconnect();
        state.toolMutations?.disconnect();
        state.toolDocument = null;
        state.toolLayout = null;
        state.toolMutations = null;
        state.focusTarget = null;
    }

    function closeTourTool() {
        const frame = state.toolFrame;
        endToolLoading();
        stopToolTracking();
        if (!frame) return;
        frame.removeEventListener('load', onTourToolLoad);
        state.toolFrame = null;
        if (frame.parentElement === state.root) frame.remove();
        else window.HomeToolFrame?.close?.({ push: false, skipConfirm: true });
    }

    function onTourToolLoad(event) {
        const frame = event.currentTarget;
        const doc = frame.contentDocument;
        if (doc?.URL === 'about:blank') return;
        stopToolTracking();
        if (doc?.body) {
            state.toolDocument = doc;
            state.toolLayout = new ResizeObserver(onViewportChange);
            state.toolLayout.observe(frame);
            state.toolLayout.observe(doc.body);
            state.toolMutations = new MutationObserver(onViewportChange);
            state.toolMutations.observe(doc.body, { subtree: true, childList: true, characterData: true,
                attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-state'] });
            doc.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
            doc.addEventListener('transitionend', onViewportChange, true);
            doc.addEventListener('animationend', onViewportChange, true);
        } else {
            endToolLoading();
        }
        onViewportChange();
    }

    function restoreTourChat() {
        state.restoreChat?.();
        state.restoreChat = null;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function placeSpotlight(targetRect, preferredPlacement) {
        if (!state.cutout || !state.ring || !state.card) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.min(CARD_WIDTH, vw - MARGIN * 2);
        state.card.style.width = `${width}px`;
        const cardRect = state.card.getBoundingClientRect();
        const cardW = cardRect.width || width;
        const cardH = cardRect.height || 200;
        const docked = state.root.matches('.is-chat-demo, .is-data-tool');

        if (!targetRect) {
            state.cutout.setAttribute('width', '0');
            state.cutout.setAttribute('height', '0');
            state.ring.style.opacity = '0';
            if (docked) return;
            const cx = Math.round((vw - cardW) / 2);
            const cy = Math.round((vh - cardH) / 2);
            state.card.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
            return;
        }

        const x = clamp(targetRect.left - PAD, 4, vw - 4);
        const y = clamp(targetRect.top - PAD, 4, vh - 4);
        const w = clamp(targetRect.left + targetRect.width + PAD, x, vw - 4) - x;
        const h = clamp(targetRect.top + targetRect.height + PAD, y, vh - 4) - y;
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

        const isChatDemo = state.root.classList.contains('is-chat-demo');
        if (isChatDemo || state.exampleDraft) {
            // Allow reading and scrolling only the message area or the read-only example.
            const input = state.exampleDraft && document.getElementById('dcInput').getBoundingClientRect();
            const left = input ? clamp(input.left, x, x + w) : x;
            const top = input ? clamp(input.top, y, y + h) : y;
            const right = input ? clamp(input.right, left, x + w) : x + w;
            const bottom = input ? clamp(input.bottom, top, y + h) : y + h;
            state.root.querySelector('.v2-tour-backdrop').style.clipPath =
                `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`;
        }
        if (docked) return;

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
        const step = state.steps[state.index];
        if (state.root.matches('.is-chat-demo, .is-data-tool')) {
            document.documentElement.style.setProperty('--v2-tour-card-height', `${state.card.offsetHeight}px`);
        }
        if (state.toolFrame) {
            const frame = state.toolFrame;
            const doc = state.toolDocument;
            const startup = doc?.getElementById('platformStartup');
            const booting = doc?.body.classList.contains('air-booting');
            if (state.root.classList.contains('is-tool-loading')) {
                const starting = !doc || booting || (startup && startup.dataset.state !== 'error');
                if (starting || performance.now() < state.toolRevealAt) {
                    if (!starting) onViewportChange();
                    placeSpotlight(null, step.placement);
                    return;
                }
                endToolLoading();
            }
            if (startup || booting) {
                placeSpotlight(null, step.placement);
                return;
            }
            const target = [...(doc?.querySelectorAll(step.anchor) || [])].find(el => isVisibleElement(el));
            if (target !== state.focusTarget) {
                if (state.focusTarget) state.toolLayout?.unobserve(state.focusTarget);
                state.focusTarget = target;
                if (target) {
                    state.toolLayout?.observe(target);
                    const rect = target.getBoundingClientRect();
                    if (rect.top < 0 || rect.bottom > frame.clientHeight || rect.left < 0 || rect.right > frame.clientWidth) {
                        target.scrollIntoView({ block: step.data ? 'start' : 'nearest', inline: 'nearest' });
                    }
                }
            }
            const rect = target?.getBoundingClientRect();
            const left = Math.max(0, rect?.left ?? 0);
            const top = Math.max(0, rect?.top ?? 0);
            const right = Math.min(frame.clientWidth, rect?.right ?? 0);
            const bottom = Math.min(frame.clientHeight, rect?.bottom ?? 0);
            if (right > left && bottom > top) {
                const outer = frame.getBoundingClientRect();
                placeSpotlight({ left: outer.left + left, top: outer.top + top, width: right - left, height: bottom - top }, 'right');
            } else {
                placeSpotlight(frame.previousElementSibling?.getBoundingClientRect(), 'bottom');
            }
            return;
        }
        const showingExample = step.id === 'composer' && state.exampleSent;
        const el = showingExample ? document.getElementById('dcThread') : step.find?.();
        const rect = el && isVisibleElement(el, { ignoreOpacity: Boolean(step?.ignoreOpacity) }) ? el.getBoundingClientRect() : null;
        placeSpotlight(rect, step?.placement || 'bottom');
    }

    async function go(nextIndex) {
        if (!state.active || state.exampleTyping || state.exampleDraft || state.examplePending) return;
        const clamped = clamp(nextIndex, 0, state.steps.length - 1);
        const step = state.steps[clamped];
        if (state.index !== clamped) {
            state.steps[state.index]?.cleanup?.();
            closeTourTool();
            state.index = clamped;
            if (step.id === 'composer') restoreTourChat();
            else state.restoreChat ||= window.DragonClaw?.showTourLanding?.();
            openTourTool(step);
        }
        if (typeof step.prepare === 'function') {
            await step.prepare();
        }
        if (!state.active || state.steps[state.index] !== step) return;
        renderStep();
    }

    function renderStep() {
        const copy = getCopy();
        const step = state.steps[state.index];
        const tool = getLang() === 'en-US' ? step.en : step.zh;
        const stepCopy = copy.steps.find(item => item.id === step.id);
        const root = state.root;
        root.querySelector('.v2-tour-eyebrow').textContent = copy.stepOf
            .replace('{i}', String(state.index + 1))
            .replace('{n}', String(state.steps.length));
        const badge = root.querySelector('.v2-tour-badge');
        badge.textContent = tool ? copy.tool : stepCopy.badge;
        root.querySelector('.v2-tour-skip').textContent = copy.skip;
        root.querySelector('.v2-tour-title').textContent = tool ? tool[0] : stepCopy.title;
        const sentExample = step.id === 'composer' && state.exampleSent;
        const description = state.exampleTyping ? copy.exampleTyping
            : state.exampleDraft ? copy.exampleReview
            : sentExample ? (state.examplePending ? copy.exampleRunning : copy.exampleDone)
            : (tool ? tool[1] : stepCopy.desc);
        root.querySelector('.v2-tour-desc').textContent = description;
        root.querySelector('.v2-tour-kbd').textContent = state.exampleDraft ? copy.exampleReviewKbd : copy.kbd;
        setExampleLayout(sentExample);
        document.documentElement.classList.toggle('v2-tour-review', Boolean(state.exampleDraft));
        root.classList.toggle('is-data-tool', Boolean(step.data));
        document.documentElement.classList.toggle('v2-tour-data', Boolean(step.data));
        if (step.data) state.card.style.removeProperty('transform');

        const prevBtn = root.querySelector('[data-tour-prev]');
        prevBtn.textContent = copy.back;
        prevBtn.hidden = state.index === 0;

        const nextBtn = root.querySelector('[data-tour-next]');
        nextBtn.textContent = state.index === state.steps.length - 1 ? copy.done : copy.next;
        nextBtn.disabled = Boolean(state.exampleTyping || state.examplePending);

        updateSpotlight();
    }

    function onKeyDown(event) {
        if (!state.active) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        } else if (event.key === 'Tab') {
            const controls = [...state.root.querySelectorAll('button:not([hidden]):enabled')]
                .filter(control => control.getClientRects().length);
            if (state.exampleDraft) controls.unshift(document.getElementById('dcInput'));
            const current = controls.indexOf(document.activeElement);
            const direction = event.shiftKey ? -1 : 1;
            const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
                : (current + direction + controls.length) % controls.length;
            event.preventDefault();
            controls[next]?.focus({ preventScroll: true });
        } else if (state.exampleDraft) {
            return;
        } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
            if (event.key === 'Enter' && event.target.closest?.('button')) return;
            event.preventDefault();
            if (state.index >= state.steps.length - 1) close(true);
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


        clearTimeout(state.scheduleTimer);
        state.steps = availableSteps();
        state.previousFocus = document.activeElement;
        state.exampleSent = false;
        state.examplePending = false;
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
        window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
        await go(0);
        requestAnimationFrame(() => {
            if (state.root !== root) return;
            root.classList.add('is-open');
            updateSpotlight();
            (root.querySelector('[data-tour-next]:enabled') || root.querySelector('.v2-tour-skip')).focus({ preventScroll: true });
            if (state.index === 0) typeExample();
        });
        return true;
    }

    function close(completed = true) {
        if (!state.active) return;
        state.steps[state.index]?.cleanup?.();
        closeTourTool();
        state.exampleTyping?.abort();
        state.exampleTyping = null;
        state.exampleDraft?.cancel();
        state.exampleDraft = null;
        state.exampleObserver?.disconnect();
        state.exampleObserver = null;
        setExampleLayout(false);
        document.documentElement.classList.remove('v2-tour-data', 'v2-tour-review');
        document.documentElement.style.removeProperty('--v2-tour-card-height');
        restoreTourChat();
        state.active = false;
        if (completed) markDone();
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('scroll', onViewportChange, true);
        cancelAnimationFrame(state.repositionRaf);

        if (state.root) {
            state.root.remove();
            state.root = null;
            state.cutout = null;
            state.ring = null;
            state.card = null;
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
        if (isVisibleElement(state.previousFocus)) state.previousFocus.focus({ preventScroll: true });
        state.previousFocus = null;
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
        stepCount: () => (state.active ? state.steps : availableSteps()).length
    };

    window.addEventListener('tools:authchange', () => {
        state.retryCount = 0;
        scheduleAutoStart(900);
    });
    window.addEventListener('tools:languagechange', () => {
        if (state.active) renderStep();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => scheduleAutoStart(1100), { once: true });
    } else {
        scheduleAutoStart(1100);
    }
})();
