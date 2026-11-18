/**
 * 首页新手引导：工作台入口、系统工具和 AI 提问示例。
 * 对话和工具步骤只展示 product-tour-demos.js 里的静态示范，不发真实对话、不加载工具页面。
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
            send: '发送',
            done: '开始使用',
            kbd: '← → 切换 · Esc 关闭',
            tool: '系统工具',
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
            send: 'Send',
            done: 'Get started',
            kbd: '← → navigate · Esc close',
            tool: 'System tool',
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

    // 工具步骤只在目录里有对应工具时出现；画面来自 HomeProductTourDemos，不打开真实页面。
    const TOOL_STEPS = [
        {
            id: 'uivf12',
            zh: ['数据抓取', '用现成脚本批量抓表，省去逐个网站手动下载。'],
            en: ['Data Capture', 'Run a saved script to collect tables in batches.']
        },
        {
            id: 'sla',
            zh: ['数据导入', '批量导入表格，系统按规则算指标、标临期。'],
            en: ['Data Import', 'Import tables in bulk to calculate metrics and flag deadlines.']
        },
        {
            id: 'report',
            zh: ['报表看板', '选月份和快照，一眼看清谁达标、差多少。'],
            en: ['Report Dashboard', 'Choose a month and snapshot to see scores and gaps.']
        },
        {
            id: 'expedite',
            zh: ['一键催办', '选报表快照，一键生成可复制的催办简报。'],
            en: ['One-Click Follow-Up', 'Pick a report snapshot to generate a follow-up brief.']
        },
        {
            id: 'monthly',
            zh: ['月报页面', '选月份、套模板，让 AI 帮你出图和写结论。'],
            en: ['Monthly Report', 'Pick a month and template, then ask AI for charts and findings.']
        },
        {
            id: 'bigscreen',
            zh: ['大屏看板', '开会直接看趋势、客户群排名和风险。'],
            en: ['Big Screen Dashboard', 'Present trends, customer-group rankings, and risks on one screen.']
        },
        {
            id: 'opsDrafts', always: true,
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
            find: () => state.chatSent ? document.getElementById('dcThread')
                : document.querySelector('#dcComposer') || document.querySelector('#dcInput')
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
                    // 菜单有展开动画：动画结束时再定位一次，保证高亮框框住完整菜单。
                    const menu = document.querySelector('.v2-account');
                    const settle = () => { if (state.active && state.steps[state.index]?.id === 'account') updateSpotlight(); };
                    menu?.addEventListener('transitionend', settle, { once: true });
                    setTimeout(settle, 220);
                    setTimeout(settle, 480);
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
        const catalog = new Set((window.ToolsPlatform?.catalog?.() || []).map(tool => tool.id));
        const tools = TOOL_STEPS.filter(tool => tool.always || catalog.has(tool.id))
            .map(tool => ({ ...tool, stage: 'tool' }));
        return [...HOME_STEPS.slice(0, -2), ...tools, ...HOME_STEPS.slice(-2)];
    }

    const state = {
        active: false,
        index: 0,
        steps: [],
        previousFocus: null,
        chatPhase: '',
        chatRun: 0,
        chatDemo: null,
        chatSent: false,
        restoreChat: null,
        openedAccountMenu: false,
        wasSidebarCollapsed: false,
        initialMode: null,
        root: null,
        stage: null,
        cutout: null,
        ring: null,
        card: null,
        cardObserver: null,
        scheduleTimer: 0,
        retryCount: 0,
        repositionRaf: 0
    };

    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const L = (zh, en) => (getLang() === 'en-US' ? en : zh);

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
            <div class="v2-tour-stage" aria-hidden="true"></div>
            <div class="v2-tour-backdrop">
                <svg class="v2-tour-svg" width="100%" height="100%" aria-hidden="true">
                    <defs>
                        <mask id="v2TourCutoutMask">
                            <rect width="100%" height="100%" fill="white"></rect>
                            <rect class="v2-tour-cutout" x="0" y="0" width="0" height="0" rx="14" ry="14" fill="black"></rect>
                            <g class="v2-tour-pin-cuts"></g>
                        </mask>
                    </defs>
                    <rect class="v2-tour-scrim" width="100%" height="100%" mask="url(#v2TourCutoutMask)"></rect>
                </svg>
            </div>
            <div class="v2-tour-flow" aria-hidden="true"></div>
            <div class="v2-tour-pins" aria-hidden="true"></div>
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
                    <ol class="v2-tour-points"></ol>
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
        state.stage = root.querySelector('.v2-tour-stage');
        state.cutout = root.querySelector('.v2-tour-cutout');
        state.ring = root.querySelector('.v2-tour-ring');
        state.card = root.querySelector('.v2-tour-card');
        state.cardObserver = new ResizeObserver(onViewportChange);
        state.cardObserver.observe(state.card);
        state.stage.addEventListener('transitionend', onViewportChange);

        root.querySelector('.v2-tour-backdrop').addEventListener('click', () => {
            if (!state.card) return;
            state.card.classList.remove('is-nudge');
            void state.card.offsetWidth;
            state.card.classList.add('is-nudge');
        });
        root.addEventListener('wheel', onWheel, { passive: false });
        root.querySelector('.v2-tour-skip').addEventListener('click', () => close(true));
        root.querySelector('[data-tour-prev]').addEventListener('click', () => go(state.index - 1));
        root.querySelector('[data-tour-next]').addEventListener('click', forward);
        return root;
    }

    function forward() {
        if (state.chatPhase === 'typing') finishTyping();
        else if (state.chatPhase === 'ready') sendChat();
        else if (state.chatPhase === 'replying') finishChat();
        else if (state.index >= state.steps.length - 1) close(true);
        else go(state.index + 1);
    }

    function renderStage(step) {
        const demos = window.HomeProductTourDemos;
        const stage = state.stage;
        renderPins([]);
        stopAutoScroll();
        state.pinTargets = null;
        state.chatRun += 1;
        state.chatPhase = '';
        const demo = step.stage === 'tool' && demos?.tools[step.id];
        if (demo?.page) {
            // 无脚本的静态快照：只渲染页面本身，不跑工具代码，也不请求业务接口。
            stage.className = `v2-tour-stage is-tool is-${step.id}`;
            stage.innerHTML = `<div class="tm-page-box"><iframe class="tm-page" title="" tabindex="-1" sandbox="allow-same-origin" src="${demo.page}"></iframe></div>`;
            const frame = stage.querySelector('iframe');
            frame.inert = true;
            frame.addEventListener('load', () => { preparePage(frame); onViewportChange(); }, { once: true });
        } else if (demo?.html) {
            ensureStylesheet('./tp-static/frontend/css/ops-inbox.css');
            stage.className = `v2-tour-stage is-tool is-panel is-${step.id}`;
            stage.innerHTML = `<div class="tm-panel-box">${demo.html(L)}</div>`;
        } else {
            stage.className = 'v2-tour-stage';
            stage.innerHTML = '';
        }
        state.root.classList.toggle('is-staged', Boolean(stage.innerHTML));
        if (step.id === 'composer') playChat();
        else endChat();
    }

    const pause = ms => new Promise(resolve => setTimeout(resolve, reducedMotion() ? 0 : ms));

    // 第一步在真实首页上演示：真实输入框里逐字输入问题，再在真实对话区流式显示预写回答。
    // 由 DragonClaw.startTourDemo 负责，不发请求、不建会话，离开这一步就把原来的对话和草稿放回去。
    async function playChat() {
        const run = state.chatRun;
        const live = () => state.active && state.chatRun === run;
        const chat = window.HomeProductTourDemos?.chat(L);
        endChat();
        state.chatDemo = window.DragonClaw?.startTourDemo?.() || null;
        if (!chat || !state.chatDemo) return;
        state.chatPhase = 'typing';
        setChatSent(false);
        await pause(500);
        if (!live() || !await state.chatDemo.type(chat.prompt) || !live()) return;
        // 打完字停住，让用户看清问题，点「发送」再继续。
        state.chatPhase = 'ready';
        renderStep();
    }

    function finishTyping() {
        state.chatRun += 1;
        state.chatDemo?.fill(window.HomeProductTourDemos.chat(L).prompt);
        state.chatPhase = 'ready';
        renderStep();
    }

    async function sendChat() {
        const run = ++state.chatRun;
        const chat = window.HomeProductTourDemos.chat(L);
        state.chatPhase = 'replying';
        setChatSent(true);
        if (await state.chatDemo?.reply(chat.prompt, chat.answer) && state.active && state.chatRun === run) {
            state.chatPhase = 'done';
            renderStep();
        }
    }

    function finishChat() {
        const chat = window.HomeProductTourDemos.chat(L);
        state.chatRun += 1;
        state.chatDemo?.show(chat.prompt, chat.answer);
        state.chatPhase = 'done';
        setChatSent(true);
    }

    function endChat() {
        state.chatDemo?.restore();
        state.chatDemo = null;
        state.chatPhase = '';
        setChatSent(false);
    }

    // 发送后卡片停靠到对话区旁边（窄屏在底部），高亮整个对话区。
    function setChatSent(sent) {
        state.chatSent = sent;
        state.root?.classList.toggle('is-chat-demo', sent);
        document.documentElement.classList.toggle('v2-tour-chat', sent);
        if (sent) state.card.style.removeProperty('transform');
        if (state.active && state.root) renderStep();
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
        const docked = state.root.matches('.is-staged, .is-chat-demo');

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
        const staged = state.root.classList.contains('is-staged');
        if (staged || state.root.classList.contains('is-chat-demo')) {
            document.documentElement.style.setProperty('--v2-tour-card-height', `${state.card.offsetHeight}px`);
        }
        if (staged && step.stage === 'tool') {
            placeSpotlight(layoutPage(step) || null, step.placement || 'bottom');
            return;
        }
        renderPins([]);
        const el = staged ? state.stage.querySelector('[data-tour-focus]') : step.find?.();
        const visible = el && (staged || isVisibleElement(el, { ignoreOpacity: Boolean(step?.ignoreOpacity) }));
        if (!visible) {
            placeSpotlight(null, step?.placement || 'bottom');
            return;
        }
        // 高亮框只框住舞台里可见的部分，避免超出演示画面。
        let rect = el.getBoundingClientRect();
        if (staged) {
            const bounds = state.stage.getBoundingClientRect();
            const left = Math.max(rect.left, bounds.left);
            const top = Math.max(rect.top, bounds.top);
            const right = Math.min(rect.right, bounds.right);
            const bottom = Math.min(rect.bottom, bounds.bottom);
            rect = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
        }
        placeSpotlight(rect, step?.placement || 'bottom');
    }

    function ensureStylesheet(href) {
        if (document.querySelector(`link[rel="stylesheet"][href^="${href}"]`)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.append(link);
    }

    // 还原导出时的滚动位置，让重点元素停在原来的位置；隐藏快照里的滚动条。
    function preparePage(frame) {
        const doc = frame.contentDocument;
        if (!doc?.documentElement) return;
        const style = doc.createElement('style');
        style.textContent = '*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}html,body{overflow:hidden!important}#dataSourceBadge,#globalBackToTop{display:none!important}';
        doc.head.append(style);
        alignFocus(doc);
    }

    function alignFocus(doc) {
        for (const el of doc.querySelectorAll('[data-tour-scroll]')) el.scrollTop = Number(el.dataset.tourScroll.split(',')[0]) || 0;
        const focus = doc.querySelector('[data-tour-focus]');
        const anchor = Number(doc.documentElement.dataset.tourAnchor);
        if (focus && Number.isFinite(anchor)) doc.scrollingElement.scrollTop += focus.getBoundingClientRect().top - anchor;
    }

    // 内嵌页按舞台的真实宽高排版，再统一缩放到 80%，内容更完整；返回重点区域在视口中的位置。
    const PAGE_ZOOM = 0.8;
    function layoutPage(step) {
        const demo = window.HomeProductTourDemos?.tools[step.id];
        const stage = state.stage;
        if (demo?.html) {
            renderPins([]);
            return stage.querySelector('[data-tour-focus]')?.getBoundingClientRect();
        }
        const box = stage.querySelector('.tm-page-box');
        const frame = stage.querySelector('.tm-page');
        if (!demo?.page || !frame) return null;
        const width = Math.round(stage.clientWidth / PAGE_ZOOM);
        const height = Math.round(stage.clientHeight / PAGE_ZOOM);
        box.style.width = `${stage.clientWidth}px`;
        box.style.height = `${stage.clientHeight}px`;
        frame.style.width = `${width}px`;
        frame.style.height = `${height}px`;
        frame.style.transform = `scale(${PAGE_ZOOM})`;
        const doc = frame.contentDocument;
        const focus = doc?.querySelector('[data-tour-focus]');
        if (!focus) return null;
        // 尺寸变化后重新对齐，让重点元素保持在导出时的位置。
        if (frame.dataset.layout !== `${width}x${height}`) {
            frame.dataset.layout = `${width}x${height}`;
            alignFocus(doc);
            startAutoScroll(frame);
        }
        const outer = box.getBoundingClientRect();
        // 快照里的坐标换算到视口，并裁到内嵌页可见范围内。
        const toViewport = rect => {
            const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
            const right = Math.min(width, rect.right), bottom = Math.min(height, rect.bottom);
            if (right <= left || bottom <= top) return null;
            return { left: outer.left + left * PAGE_ZOOM, top: outer.top + top * PAGE_ZOOM,
                width: (right - left) * PAGE_ZOOM, height: (bottom - top) * PAGE_ZOOM };
        };
        state.pinTargets ||= (demo.pins || []).map(item => findPinTarget(doc, item));
        renderPins(state.pinTargets.map(el => el?.isConnected ? toViewport(el.getBoundingClientRect()) : null));
        return toViewport(focus.getBoundingClientRect());
    }

    // 按选择器或按钮文字找重点元素：取可见元素里面积最小（最贴近文字）的那个。
    function findPinTarget(doc, item) {
        if (item.selector) return doc.querySelector(item.selector);
        const candidates = [...doc.querySelectorAll('button, a, select, summary, th, h1, h2, h3, h4, label, [role="button"], [class*="btn"]')]
            .filter(el => el.textContent.replace(/\s+/g, ' ').includes(item.text))
            .map(el => ({ el, rect: el.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width && rect.height && rect.bottom > 0 && rect.top < doc.defaultView.innerHeight);
        candidates.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
        return candidates[0]?.el || null;
    }

    // 快照里能滚动的区域：页面本身或内部滚动容器里，可滚动距离最大的那个。
    function pageScroller(frame) {
        const doc = frame?.contentDocument;
        if (!doc?.scrollingElement) return null;
        const range = el => el.scrollHeight - el.clientHeight;
        return [doc.scrollingElement, ...doc.querySelectorAll('[data-tour-scroll]')]
            .sort((a, b) => range(b) - range(a))[0];
    }

    // 长页面先停 3 秒，再慢慢向下滚到底，停一会后回到开头，循环播放；高亮框和编号跟着移动。
    function startAutoScroll(frame) {
        stopAutoScroll();
        const scroller = pageScroller(frame);
        if (!scroller || reducedMotion()) return;
        const SPEED = 34;
        // 开始前多停一会，先看清重点按钮的标注。
        let phase = 'hold', since = performance.now(), last = since, hold = 3000, top = scroller.scrollTop, pos = top;
        const auto = { frame, scroller, raf: 0 };
        const tick = now => {
            if (state.auto !== auto || !frame.isConnected) return;
            const dt = Math.min(64, now - last);
            last = now;
            const bottom = scroller.scrollHeight - scroller.clientHeight;
            if (phase === 'hold') {
                if (now - since > hold) phase = pos >= bottom - 1 ? 'up' : 'down';
            } else if (phase === 'down') {
                pos = Math.min(bottom, pos + SPEED * dt / 1000);
                if (pos >= bottom) { phase = 'hold'; since = now; hold = 2400; }
            } else {
                pos = Math.max(top, pos - SPEED * 5 * dt / 1000);
                if (pos <= top) { phase = 'hold'; since = now; hold = 1800; }
            }
            if (Math.abs(scroller.scrollTop - pos) >= 0.5) {
                scroller.scrollTop = pos;
                updateSpotlight();
            }
            auto.raf = requestAnimationFrame(tick);
        };
        if (scroller.scrollHeight - scroller.clientHeight - top < 40) return;
        state.auto = auto;
        auto.raf = requestAnimationFrame(tick);
    }

    function stopAutoScroll() {
        if (state.auto) cancelAnimationFrame(state.auto.raf);
        state.auto = null;
    }

    // 滚轮：第一步翻看输入框里的问题（发送后滚动对话区）；工具步骤改为手动滚动快照。
    function onWheel(event) {
        const step = state.steps[state.index];
        let target = null;
        if (step?.id === 'composer') target = document.getElementById(state.chatSent ? 'dcThread' : 'dcInput');
        else if (step?.stage === 'tool') {
            stopAutoScroll();
            target = pageScroller(state.stage.querySelector('.tm-page'));
        }
        if (!target) return;
        event.preventDefault();
        target.scrollTop += step.stage === 'tool' ? event.deltaY / PAGE_ZOOM : event.deltaY;
        onViewportChange();
    }

    // 重点按钮：遮罩上挖出亮区，并在左上角标编号；编号和卡片里的说明一一对应。
    function renderPins(rects) {
        const layer = state.root.querySelector('.v2-tour-pins');
        const cuts = state.root.querySelector('.v2-tour-pin-cuts');
        if (layer.children.length !== rects.length) {
            layer.innerHTML = rects.map((_, index) => `<div class="v2-tour-pin" style="--pin-delay:${260 + index * 140}ms"><b>${index + 1}</b></div>`).join('');
            cuts.innerHTML = rects.map(() => '<rect rx="8" ry="8" fill="black"></rect>').join('');
        }
        rects.forEach((rect, order) => {
            const pinEl = layer.children[order];
            const cut = cuts.children[order];
            pinEl.hidden = !rect;
            if (!rect) {
                cut.setAttribute('width', '0');
                cut.setAttribute('height', '0');
                return;
            }
            const pad = 4;
            const x = Math.round(rect.left - pad), y = Math.round(rect.top - pad);
            const w = Math.round(rect.width + pad * 2), h = Math.round(rect.height + pad * 2);
            pinEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            pinEl.style.width = `${w}px`;
            pinEl.style.height = `${h}px`;
            cut.setAttribute('x', String(x));
            cut.setAttribute('y', String(y));
            cut.setAttribute('width', String(w));
            cut.setAttribute('height', String(h));
        });
    }

    // 工作流步骤顶部的流程线：已完成的打勾，当前步骤高亮，进度条随步骤平滑推进。
    function renderFlow(step) {
        const flow = window.HomeProductTourDemos?.flow || [];
        const ids = flow.filter(id => state.steps.some(item => item.id === id));
        const current = ids.indexOf(step.id);
        const el = state.root.querySelector('.v2-tour-flow');
        state.root.classList.toggle('is-flow', current >= 0);
        if (current < 0) return;
        const key = `${getLang()}:${ids.join(',')}`;
        if (el.dataset.key !== key) {
            el.dataset.key = key;
            const label = id => (getLang() === 'en-US' ? TOOL_STEPS.find(item => item.id === id).en : TOOL_STEPS.find(item => item.id === id).zh)[0];
            el.innerHTML = `<div class="tf-track"><i class="tf-fill"></i></div><ol>${ids.map((id, index) => `<li data-flow="${id}"><span class="tf-dot"><b>${index + 1}</b></span><span class="tf-label">${label(id)}</span></li>`).join('')}</ol>`;
            el.style.setProperty('--tf-count', String(ids.length));
        }
        el.style.setProperty('--tf-progress', String(ids.length > 1 ? current / (ids.length - 1) : 1));
        [...el.querySelectorAll('li')].forEach((li, index) => {
            li.classList.toggle('is-done', index < current);
            li.classList.toggle('is-current', index === current);
        });
    }

    // 预取快照，切到工具步骤时直接从缓存渲染。
    function prefetchPages() {
        for (const demo of Object.values(window.HomeProductTourDemos?.tools || {})) {
            if (!demo.page || document.querySelector(`link[rel="prefetch"][href="${demo.page}"]`)) continue;
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = demo.page;
            document.head.append(link);
        }
    }

    async function go(nextIndex) {
        if (!state.active) return;
        const clamped = clamp(nextIndex, 0, state.steps.length - 1);
        const step = state.steps[clamped];
        if (state.index !== clamped || !state.stage.dataset.step) {
            state.steps[state.index]?.cleanup?.();
            state.index = clamped;
            state.stage.dataset.step = step.id;
            renderStage(step);
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
        root.querySelector('.v2-tour-desc').textContent = tool ? tool[1] : stepCopy.desc;
        const pins = window.HomeProductTourDemos?.tools[step.id]?.pins || [];
        const points = root.querySelector('.v2-tour-points');
        points.hidden = !pins.length;
        points.innerHTML = pins.map((item, index) => {
            const [name, text] = getLang() === 'en-US' ? item.en : item.zh;
            return `<li><b>${index + 1}</b><span><strong>${name}</strong>${text}</span></li>`;
        }).join('');
        renderFlow(step);
        root.querySelector('.v2-tour-kbd').textContent = copy.kbd;
        if (root.matches('.is-staged, .is-chat-demo')) state.card.style.removeProperty('transform');

        const prevBtn = root.querySelector('[data-tour-prev]');
        prevBtn.textContent = copy.back;
        prevBtn.hidden = state.index === 0;

        const nextBtn = root.querySelector('[data-tour-next]');
        nextBtn.textContent = state.chatPhase === 'ready' ? copy.send
            : state.index === state.steps.length - 1 ? copy.done : copy.next;

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
            const current = controls.indexOf(document.activeElement);
            const direction = event.shiftKey ? -1 : 1;
            const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
                : (current + direction + controls.length) % controls.length;
            event.preventDefault();
            controls[next]?.focus({ preventScroll: true });
        } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
            if (event.key === 'Enter' && event.target.closest?.('button')) return;
            event.preventDefault();
            forward();
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
        prefetchPages();
        // 示范步骤画在引导层里；首页保持在落地页，方便后面高亮模式切换等入口。
        state.restoreChat = window.DragonClaw?.showTourLanding?.() || null;
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
        await go(0);
        requestAnimationFrame(() => {
            if (state.root !== root) return;
            root.classList.add('is-open');
            updateSpotlight();
            root.querySelector('[data-tour-next]').focus({ preventScroll: true });
        });
        return true;
    }

    function close(completed = true) {
        if (!state.active) return;
        state.steps[state.index]?.cleanup?.();
        state.chatRun += 1;
        stopAutoScroll();
        endChat();
        state.cardObserver?.disconnect();
        state.cardObserver = null;
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
            state.stage = null;
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
        if (!state.active) return;
        renderStage(state.steps[state.index]);
        renderStep();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => scheduleAutoStart(1100), { once: true });
    } else {
        scheduleAutoStart(1100);
    }
})();
