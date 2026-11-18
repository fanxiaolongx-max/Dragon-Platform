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
            done: '开始使用',
            kbd: '← → 切换 · Esc 关闭',
            tool: '系统工具',
            exampleTyping: '示范：向 AI 提一个问题…',
            exampleRunning: '示范：AI 正在整理回答…',
            exampleDone: '这是预先写好的示范回答，数据来自真实报表并已匿名。真实提问时，AI 会读取你自己的报表和催办快照。',
            showResult: '直接看结果',
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
            exampleTyping: 'Demo: asking AI a question…',
            exampleRunning: 'Demo: AI is preparing a reply…',
            exampleDone: 'This is a prewritten sample reply based on real, anonymized report data. When you ask for real, AI reads your own report and follow-up snapshots.',
            showResult: 'Show result',
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
            stage: 'chat'
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
        root.querySelector('.v2-tour-skip').addEventListener('click', () => close(true));
        root.querySelector('[data-tour-prev]').addEventListener('click', () => go(state.index - 1));
        root.querySelector('[data-tour-next]').addEventListener('click', forward);
        return root;
    }

    function forward() {
        if (state.chatPhase === 'playing') finishChat();
        else if (state.index >= state.steps.length - 1) close(true);
        else go(state.index + 1);
    }

    function renderStage(step) {
        const demos = window.HomeProductTourDemos;
        const stage = state.stage;
        state.chatRun += 1;
        state.chatPhase = '';
        const shot = step.stage === 'tool' && demos?.tools[step.id];
        if (shot) {
            stage.className = `v2-tour-stage is-tool is-${step.id}`;
            stage.innerHTML = `<img class="tm-shot" alt="" src="${shot.src}" width="${shot.w}" height="${shot.h}" decoding="async"><em class="tm-sample tm-shot-badge">${L('真实界面 · 数据已匿名', 'Real screen · anonymized')}</em>`;
            stage.querySelector('img').addEventListener('load', onViewportChange, { once: true });
        } else if (step.stage === 'chat' && demos) {
            stage.className = 'v2-tour-stage is-chat';
            stage.innerHTML = demos.chat(L).html;
            playChat();
        } else {
            stage.className = 'v2-tour-stage';
            stage.innerHTML = '';
        }
        state.root.classList.toggle('is-staged', Boolean(stage.innerHTML));
    }

    const pause = ms => new Promise(resolve => setTimeout(resolve, reducedMotion() ? 0 : ms));

    // 示范对话：输入问题 → 发送 → 分段显示预写回答。全程只改引导层，不触碰真实会话。
    async function playChat() {
        const run = state.chatRun;
        const live = () => state.active && state.chatRun === run;
        const demo = window.HomeProductTourDemos.chat(L);
        const stage = state.stage;
        const input = stage.querySelector('[data-chat-input]');
        state.chatPhase = 'playing';
        setFocus('[data-chat-composer]');
        await pause(420);
        const chars = Array.from(demo.prompt);
        const started = performance.now();
        const duration = reducedMotion() ? 0 : 1500;
        while (live()) {
            const count = duration ? Math.min(chars.length, Math.ceil(chars.length * (performance.now() - started) / duration)) : chars.length;
            input.textContent = chars.slice(0, count).join('');
            if (count >= chars.length) break;
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        await pause(450);
        if (!live()) return;
        showQuestion(demo);
        await pause(900);
        const ai = stage.querySelector('[data-chat-ai]');
        for (const block of demo.answer) {
            if (!live()) return;
            ai.querySelector('.tm-typing')?.remove();
            ai.insertAdjacentHTML('beforeend', `<div class="tm-reveal">${block}</div>`);
            scrollThread();
            await pause(520);
        }
        if (live()) {
            state.chatPhase = 'done';
            renderStep();
        }
    }

    function showQuestion(demo) {
        const stage = state.stage;
        stage.querySelector('[data-chat-input]').textContent = '';
        stage.classList.add('is-sent');
        const user = stage.querySelector('[data-chat-user]');
        user.textContent = demo.prompt;
        user.hidden = false;
        stage.querySelector('[data-chat-ai]').hidden = false;
        setFocus('[data-chat-thread]');
        renderStep();
    }

    function finishChat() {
        const demo = window.HomeProductTourDemos.chat(L);
        state.chatRun += 1;
        showQuestion(demo);
        state.stage.querySelector('[data-chat-ai]').innerHTML = demo.answer.map(block => `<div>${block}</div>`).join('');
        scrollThread();
        state.chatPhase = 'done';
        renderStep();
    }

    function scrollThread() {
        const thread = state.stage.querySelector('[data-chat-thread]');
        thread.scrollTop = thread.scrollHeight;
    }

    function setFocus(selector) {
        state.stage.querySelectorAll('[data-tour-focus]').forEach(el => el.removeAttribute('data-tour-focus'));
        state.stage.querySelector(selector)?.setAttribute('data-tour-focus', '');
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
        const docked = state.root.classList.contains('is-staged');

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
        if (staged) {
            document.documentElement.style.setProperty('--v2-tour-card-height', `${state.card.offsetHeight}px`);
        }
        const shot = staged && layoutShot(step);
        if (shot) {
            placeSpotlight(shot, step.placement || 'bottom');
            return;
        }
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

    // 截图按比例放进舞台并居中；返回截图里重点区域在视口中的位置。
    function layoutShot(step) {
        const shot = window.HomeProductTourDemos?.tools[step.id];
        const img = state.stage.querySelector('.tm-shot');
        if (!shot || !img) return null;
        const scale = Math.min(state.stage.clientWidth / shot.w, state.stage.clientHeight / shot.h);
        const width = Math.round(shot.w * scale);
        const height = Math.round(shot.h * scale);
        img.style.width = `${width}px`;
        img.style.height = `${height}px`;
        const badge = state.stage.querySelector('.tm-shot-badge');
        badge.style.top = `${img.offsetTop + 10}px`;
        badge.style.right = `${state.stage.clientWidth - img.offsetLeft - width + 10}px`;
        const box = img.getBoundingClientRect();
        const [left, top, right, bottom] = shot.focus;
        return { left: box.left + left * box.width, top: box.top + top * box.height,
            width: (right - left) * box.width, height: (bottom - top) * box.height };
    }

    function preloadShots() {
        for (const shot of Object.values(window.HomeProductTourDemos?.tools || {})) new Image().src = shot.src;
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
        const sent = state.stage.classList.contains('is-sent');
        const description = state.chatPhase === 'playing' ? (sent ? copy.exampleRunning : copy.exampleTyping)
            : state.chatPhase === 'done' ? copy.exampleDone
            : (tool ? tool[1] : stepCopy.desc);
        root.querySelector('.v2-tour-desc').textContent = description;
        root.querySelector('.v2-tour-kbd').textContent = copy.kbd;
        if (root.classList.contains('is-staged')) state.card.style.removeProperty('transform');

        const prevBtn = root.querySelector('[data-tour-prev]');
        prevBtn.textContent = copy.back;
        prevBtn.hidden = state.index === 0;

        const nextBtn = root.querySelector('[data-tour-next]');
        nextBtn.textContent = state.chatPhase === 'playing' ? copy.showResult
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
        preloadShots();
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
        state.chatPhase = '';
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
