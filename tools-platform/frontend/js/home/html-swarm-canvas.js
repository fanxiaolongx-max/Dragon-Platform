/**
 * Dragon Claw · Multi-Agent Swarm HTML Live Painter (右侧浏览器多指针协同实时绘制画布)
 *
 * 在普通对话（非三方连接器 Agent）中：
 * - 当检测到 AI 正在流式生成 HTML 页面（或通过工作区工具写入 .html 文件）时，
 *   自动打开右侧内置浏览器，启动 10 个各司其职的 AI 指针协同绘制预览（每次绘制随机一套三色配色）。
 * - 实时解析流式输出中的 <title>、CSS 颜色/选择器、DOM 标签与文案，驱动指针群任务气泡、
 *   拖拽选框、贝塞尔激光轨迹、矢量图表手绘（假图真画）与无闪烁增量 DOM 预览。
 */
(function () {
    'use strict';
    if (window.DragonHtmlSwarm) return;

    const L = (zh, en) => /^en/i.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const esc = val => String(val ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    // 10 位分工不同的 AI 协同绘制指针。tone 是三色调色板里的下标：整场绘制只出现三种颜色。
    // tempo 越大动作越慢、停顿越久，让十个指针各有节奏而不是同步运动。
    const AGENTS = [
        { id: 'arch',   zh: 'Arch · 架构',   en: 'Arch · Layout',   tone: 0, tempo: 1.00, role: 'layout', defaultTaskZh: '搭建栅格与容器', defaultTaskEn: 'Scaffolding grid' },
        { id: 'style',  zh: 'Style · 视觉',  en: 'Style · Visual',  tone: 1, tempo: 0.88, role: 'style',  defaultTaskZh: '铺设色彩与质感', defaultTaskEn: 'Laying down color' },
        { id: 'dom',    zh: 'DOM · 组件',    en: 'DOM · Builder',   tone: 2, tempo: 0.94, role: 'dom',    defaultTaskZh: '装配卡片与控件', defaultTaskEn: 'Mounting components' },
        { id: 'motion', zh: 'Motion · 动效', en: 'Motion · FX',     tone: 0, tempo: 0.82, role: 'motion', defaultTaskZh: '调校缓动曲线', defaultTaskEn: 'Tuning easing' },
        { id: 'chart',  zh: 'Frame · 线框',  en: 'Frame · Wireframe', tone: 1, tempo: 1.12, role: 'frame', defaultTaskZh: '勾勒组件轮廓', defaultTaskEn: 'Drafting outlines' },
        { id: 'type',   zh: 'Type · 排版',   en: 'Type · Copy',     tone: 0, tempo: 1.06, role: 'type',   defaultTaskZh: '校准字重层级', defaultTaskEn: 'Setting type scale' },
        { id: 'logic',  zh: 'Logic · 交互',  en: 'Logic · Script',  tone: 2, tempo: 0.90, role: 'logic',  defaultTaskZh: '绑定事件与状态', defaultTaskEn: 'Wiring events' },
        { id: 'shader', zh: 'Shader · 光影', en: 'Shader · Light',  tone: 1, tempo: 1.20, role: 'style',  defaultTaskZh: '计算阴影层次', defaultTaskEn: 'Resolving shadows' },
        { id: 'layout', zh: 'Layout · 响应式', en: 'Layout · Flex', tone: 0, tempo: 1.16, role: 'layout', defaultTaskZh: '对齐留白与断点', defaultTaskEn: 'Aligning spacing' },
        { id: 'qa',     zh: 'QA · 校准',     en: 'QA · Pixel',      tone: 2, tempo: 1.28, role: 'qa',     defaultTaskZh: '逐像素测量校准', defaultTaskEn: 'Measuring pixels' }
    ];

    // 配色：每套只有三个色调，每次绘制随机选一套，指针、头像圆点、进度与高亮全部取自这一套。
    // 色相来自 Pantone 2026：年度色 11-4201 Cloud Dancer (#F0EEE9)，以及 Pantone 时装周
    // 2026 春夏 / 2026-27 秋冬趋势色（Marina、Dutch Canal、All Aboard、Alexandrite、Neptune Green、
    // Amethyst Orchid、Burnished Lilac、Amaranth、Musk Melon、Muted Clay、Arabian Spice、Acacia、
    // Shale Green、Burnt Olive）。dark = 深色页面上用的三色，light = 亮色页面上用的三色；
    // 同一色相在另一种背景上不够清晰时，取它加深或提亮后的衍生色（注释里标「衍生」）。
    const SWARM_PALETTES = [
        { id: 'marina',      dark: ['#96BAE0', '#5C97CB', '#F0EEE9'], light: ['#5085C3', '#2F5F99' /* Marina 衍生 */, '#2A2D33'] },
        { id: 'alexandrite', dark: ['#7FBB9E', '#4FA3A5' /* Alexandrite 衍生 */, '#F0EEE9'], light: ['#00666C', '#3F8F70' /* Neptune Green 衍生 */, '#2A2D33'] },
        { id: 'orchid',      dark: ['#C5AEB1', '#B08CC2' /* Amethyst Orchid 衍生 */, '#F0EEE9'], light: ['#926AA6', '#6B3453', '#2A2D33'] },
        { id: 'melon',       dark: ['#EC935E', '#D29380', '#F0EEE9'], light: ['#C8683A' /* Musk Melon 衍生 */, '#884332', '#2A2D33'] },
        { id: 'acacia',      dark: ['#DACD65', '#9DB89B' /* Shale Green 衍生 */, '#F0EEE9'], light: ['#739072', '#646049', '#2A2D33'] }
    ];

    const hexToRgb = hex => {
        const h = String(hex).replace('#', '');
        const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h;
        const n = parseInt(full, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const luminance = ([r, g, b]) => {
        const lin = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    // 色块上的文字颜色：亮色块配深字，暗色块配白字
    const inkOn = hex => luminance(hexToRgb(hex)) > 0.36 ? '#14161a' : '#ffffff';
    const rgba = (hex, alpha) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${alpha})`; };

    // 运动学工具：最小加加速度曲线（人手移动的钟形速度曲线）、三次贝塞尔、随机数
    const rand = (min, max) => min + Math.random() * (max - min);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const minJerk = t => t * t * t * (10 + t * (-15 + 6 * t));
    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
    const bezier = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };

    // 判断用户提问是否有明确的「生成/制作 HTML 网页」意图
    const HTML_PROMPT_INTENT_RE = /(?:(?:生成|写|做|画|设计|开发|创建|制作|来一个|来个|弄个|编写|重构|美化|构建|build|create|make|generate|design|write|code)\s*(?:一个|个|一份|套|段|出|张)?[\s\S]{0,28}(?:html|htm|网页|前端页面|单页|落地页|landing\s*page|大屏页面|可视化页面|看板页面|小游戏网页))|(?:(?:html|htm|网页|单页应用)[\s\S]{0,16}(?:生成|制作|编写|设计|开发|页面|代码|实现))/i;
    const HTML_QUESTION_EXCLUDE_RE = /^(?:什么是|怎么理解|为什么|区别是什么|如何解释|what\s+is|why\s+does)/i;

    function isHtmlGenerationPrompt(prompt) {
        const text = String(prompt || '').trim();
        if (!text || text.length > 2000) return false;
        if (HTML_QUESTION_EXCLUDE_RE.test(text) && !/生成|写一个|做一个/.test(text)) return false;
        return HTML_PROMPT_INTENT_RE.test(text);
    }

    // 从流式 Markdown 文本中提取正在生成或已生成的 HTML 代码
    function extractStreamingHtml(rawText) {
        const text = String(rawText || '');
        if (!text) return { found: false, code: '', complete: false, title: '' };

        // 1. 匹配 ```html 或 ```htm 代码块（支持流式未闭合）
        const fenceRegex = /```(?:html|htm)\b[^\n]*\n([\s\S]*?)(?:```|$)/gi;
        let match;
        let lastFence = null;
        while ((match = fenceRegex.exec(text)) !== null) {
            lastFence = {
                code: match[1] || '',
                complete: match[0].endsWith('```') && match[0].length > 9
            };
        }
        if (lastFence) {
            return {
                found: true,
                code: lastFence.code,
                complete: lastFence.complete,
                title: extractTitle(lastFence.code)
            };
        }

        // 2. 匹配无语言标记的 ``` 代码块，但内容以 <!DOCTYPE html 或 <html 开头
        const genericFence = /```[^\n]*\n(\s*(?:<!doctype\s+html|<html\b)[\s\S]*?)(?:```|$)/i.exec(text);
        if (genericFence) {
            return {
                found: true,
                code: genericFence[1] || '',
                complete: genericFence[0].endsWith('```'),
                title: extractTitle(genericFence[1] || '')
            };
        }

        // 3. 裸输出的 <!DOCTYPE html> 或 <html ...>
        const rawHtmlMatch = /(<!doctype\s+html[\s\S]*|<html\b[\s\S]*)/i.exec(text);
        if (rawHtmlMatch && /<(?:head|body|style|div|main|section|header|script)\b/i.test(rawHtmlMatch[1])) {
            const rawCode = rawHtmlMatch[1];
            return {
                found: true,
                code: rawCode,
                complete: /<\/html\s*>/i.test(rawCode),
                title: extractTitle(rawCode)
            };
        }

        return { found: false, code: '', complete: false, title: '' };
    }

    function extractTitle(html) {
        const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
        if (m && m[1].trim()) return m[1].replace(/\s+/g, ' ').trim().slice(0, 48);
        const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(String(html || ''));
        if (h1) {
            const clean = h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (clean) return clean.slice(0, 48);
        }
        return '';
    }

    // ── 核心状态 ─────────────────────────────────────────────
    let stageEl = null;
    let viewportEl = null;
    let scaffoldEl = null;
    let blueprintEl = null;
    let previewWrapEl = null;
    let iframeEl = null;
    let codeViewEl = null;
    let fxCanvas = null;
    let fxCtx = null;
    let cursorsWrapEl = null;
    let tickerEl = null;
    let livePillTextEl = null;
    let progressFillEl = null;
    let metricLinesEl = null;
    let metricNodesEl = null;
    let metricStylesEl = null;
    let metricTimeEl = null;
    let lastPaletteId = '';

    const SOUND_STORAGE_KEY = 'dc_swarm_sound';
    const loadSoundPref = () => {
        try { return localStorage.getItem(SOUND_STORAGE_KEY) === '1'; } catch { return false; }
    };
    const saveSoundPref = enabled => {
        try { localStorage.setItem(SOUND_STORAGE_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
    };

    const state = {
        active: false,
        streaming: false,
        finished: false,
        finishedAt: 0,
        replaying: false,
        replayTimer: null,
        fadeTimer: null,
        pacingTimer: null,    // 流式节奏平滑推进定时器（避免 AI 极速输出时闪烁过快）
        streamTargetCode: '', // AI 实际吐出的完整 HTML 代码
        revealedCode: '',     // 画布当前平滑展开渲染的代码
        streamDonePending: false, // AI 流式已经结束，等待画布平滑收尾
        cursorsHidden: false,
        soundEnabled: loadSoundPref(),
        showSource: false,
        startedAt: 0,
        lastRenderAt: 0,
        renderTimer: null,
        rafId: 0,
        width: 800,
        height: 600,
        dpr: 1,
        htmlCode: '',
        pageTitle: '',
        prompt: '',
        lineCount: 0,
        nodeCount: 0,
        styleCount: 0,
        bodyReady: false,
        palette: ['#6366f1', '#ec4899', '#06b6d4', '#10b981', '#f59e0b'],
        seenTokens: new Set(),
        domTargets: [],       // 真实 iframe 内的 DOM 元素矩形 [{ x, y, w, h, tag, label, kind, fontSize, hasText }]
        syntheticBoxes: [],   // 蓝图/合成图形区块 [{ x, y, w, h, kind, color, label, progress }]
        ripples: [],          // 按下涟漪 [{ x, y, color, bornAt, maxR }]
        wireframes: [],       // 框选松手后定格的组件线框 [{ x, y, w, h, color, ink, label, bornAt, ttl, guides }]
        marks: [],            // 进行中的选框 / 标尺 / 点选 / 输入 / 钢笔标记 [{ kind, c, bornAt, endAt, ... }]
        busy: new Map(),      // 正被某个指针处理的元素 → 释放时间
        swarmPalette: null,   // 本次绘制选用的三色调色板
        pageDark: true,       // 指针下方画面是否为深色（蓝图阶段为深色）
        encore: false,        // 绘制完成后用户重新打开指针群
        labelCount: 0,        // 当前亮着名牌的指针数
        collectTimer: null,
        cursors: [],          // 10 个指针实体
        iframeReady: false,
        lastBodySig: '',
        lastStyleSig: ''
    };

    // ── 轻量程序化 Web Audio 协作音效（默认静音，不依赖外部音频文件） ───────
    const SwarmAudio = (() => {
        let ctx = null;
        let master = null;
        let lastPlayAt = 0;
        const CHIME_SCALE = [329.63, 392.0, 493.88, 659.25, 783.99, 987.77]; // E minor/major pentatonic

        function ensureCtx() {
            if (!state.soundEnabled) return null;
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            try {
                if (!ctx) {
                    ctx = new Ctor();
                    master = ctx.createGain();
                    master.gain.value = 0.14;
                    master.connect(ctx.destination);
                }
                if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
                    ctx.resume().catch(() => {});
                }
                return ctx;
            } catch {
                return null;
            }
        }

        function panFor(x) {
            const w = Math.max(1, state.width || 800);
            return clamp((Number(x || 0) / w) * 2 - 1, -0.82, 0.82);
        }

        function connectPanned(audio, node, x) {
            if (typeof audio.createStereoPanner === 'function') {
                const pan = audio.createStereoPanner();
                pan.pan.value = panFor(x);
                node.connect(pan);
                pan.connect(master);
            } else {
                node.connect(master);
            }
        }

        function tone({ freq0, freq1 = freq0, dur = 0.04, gain = 0.25, type = 'triangle', x = 400, minGap = 38 }) {
            const audio = ensureCtx();
            if (!audio || !master) return;
            const nowMs = performance.now();
            if (nowMs - lastPlayAt < minGap) return;
            lastPlayAt = nowMs;
            try {
                const t = audio.currentTime;
                const osc = audio.createOscillator();
                const amp = audio.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq0, t);
                if (freq1 !== freq0) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq1), t + dur);
                amp.gain.setValueAtTime(0.001, t);
                amp.gain.linearRampToValueAtTime(gain, t + 0.004);
                amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
                osc.connect(amp);
                connectPanned(audio, amp, x);
                osc.start(t);
                osc.stop(t + dur + 0.01);
            } catch {
                // ignore blocked audio context
            }
        }

        return {
            unlock: () => { ensureCtx(); },
            playClick: x => tone({ freq0: 760, freq1: 240, dur: 0.024, gain: 0.22, type: 'triangle', x, minGap: 45 }),
            playTick: x => tone({ freq0: 1420, freq1: 620, dur: 0.014, gain: 0.14, type: 'sine', x, minGap: 34 }),
            playSnap: x => {
                const freq = CHIME_SCALE[Math.floor(Math.random() * CHIME_SCALE.length)];
                tone({ freq0: freq, freq1: freq * 1.005, dur: 0.09, gain: 0.16, type: 'sine', x, minGap: 55 });
            },
            playFinish: () => {
                const audio = ensureCtx();
                if (!audio || !master) return;
                [329.63, 493.88, 659.25, 783.99].forEach((freq, idx) => {
                    try {
                        const t = audio.currentTime + idx * 0.055;
                        const osc = audio.createOscillator();
                        const amp = audio.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, t);
                        amp.gain.setValueAtTime(0.001, t);
                        amp.gain.linearRampToValueAtTime(0.14, t + 0.015);
                        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
                        osc.connect(amp);
                        amp.connect(master);
                        osc.start(t);
                        osc.stop(t + 0.36);
                    } catch {
                        // ignore
                    }
                });
            }
        };
    })();

    // ── 创建与挂载右侧浏览器画布舞台 ─────────────────────────
    function ensureStage() {
        const panel = document.getElementById('dcBrowserPanel');
        const surface = panel?.querySelector('.dc-browser-surface');
        if (!panel || !surface) return null;
        if (stageEl && surface.contains(stageEl)) return stageEl;

        stageEl = document.createElement('div');
        stageEl.className = 'dc-swarm-stage';
        stageEl.hidden = true;
        stageEl.innerHTML = `
            <div class="dc-swarm-topbar">
                <div class="dc-swarm-topbar-left">
                    <span class="dc-swarm-live-pill">
                        <span class="dc-swarm-pulse-dot" aria-hidden="true"></span>
                        <span data-swarm-pill-text>${esc(L('10 AI 协同绘制中', '10 AI Agents Painting'))}</span>
                    </span>
                    <div class="dc-swarm-agent-cluster" aria-hidden="true">
                        ${AGENTS.map(a => `<span class="dc-swarm-agent-dot" data-agent-dot="${a.id}" title="${esc(L(a.zh, a.en))}">${esc(a.id[0].toUpperCase())}</span>`).join('')}
                    </div>
                    <div class="dc-swarm-ticker" data-swarm-ticker>${esc(L('正在初始化多智能体协同画布…', 'Initializing multi-agent swarm canvas…'))}</div>
                </div>
                <div class="dc-swarm-topbar-actions">
                    <button type="button" class="dc-swarm-btn" data-swarm-action="replay" title="${esc(L('让 AI 指针群重新演示绘制过程', 'Replay multi-agent swarm drawing'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6v2.9h-2.9"/></svg>${esc(L('重播绘制', 'Replay'))}</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="cursors" aria-pressed="true" title="${esc(L('显示或隐藏 AI 指针群图层', 'Toggle AI cursors overlay'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 2.4 12.6 7.9 8.1 9 5.8 13.4Z"/></svg>${esc(L('指针群', 'Cursors'))}</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="sound" aria-pressed="${state.soundEnabled ? 'true' : 'false'}" title="${esc(L('开启或静音 AI 指针群协作音效', 'Toggle swarm collaboration sound FX'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6.4h2.6l3.4-2.8v8.8L5.1 9.6H2.5z"/><path d="M11 5.6a3.4 3.4 0 0 1 0 4.8M12.8 4a5.6 5.6 0 0 1 0 8"/></svg>${esc(L('音效', 'Sound'))}</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="source" aria-pressed="false" title="${esc(L('切换实时预览与源码视图', 'Toggle preview and source code'))}">&lt;/&gt; ${esc(L('源码', 'Code'))}</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="popout" title="${esc(L('在新标签页打开完整网页', 'Open in new tab'))}">⤢</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="download" title="${esc(L('下载生成的 HTML 文件', 'Download HTML file'))}">↓</button>
                </div>
            </div>
            <div class="dc-swarm-viewport">
                <div class="dc-swarm-preview-wrap"></div>
                <div class="dc-swarm-scaffold">
                    <div class="dc-swarm-scaffold-card">
                        <div class="dc-swarm-scaffold-badge">
                            <span class="dc-swarm-scaffold-dot"></span>
                            <span class="dc-swarm-scaffold-tag" data-swarm-scaffold-title>${esc(state.pageTitle || L('等待真实框架挂载…', 'Awaiting real DOM…'))}</span>
                        </div>
                        <p class="dc-swarm-scaffold-hint">${esc(L('实时解析代码流与样式规则 · 真实 DOM 容器就位后指针群开始绘制', 'Parsing stream & styles · AI swarm begins painting when real DOM mounts'))}</p>
                        <div class="dc-swarm-scaffold-stream" data-swarm-scaffold-stream></div>
                    </div>
                </div>
                <canvas class="dc-swarm-fx"></canvas>
                <div class="dc-swarm-cursors" aria-hidden="true"></div>
                <div class="dc-swarm-code-view" hidden><pre><code></code></pre></div>
            </div>
            <div class="dc-swarm-footer">
                <div class="dc-swarm-metrics">
                    <span class="dc-swarm-metric">${esc(L('代码行', 'Lines'))} <b data-swarm-lines>0</b></span>
                    <span class="dc-swarm-metric">${esc(L('DOM 节点', 'Nodes'))} <b data-swarm-nodes>0</b></span>
                    <span class="dc-swarm-metric">${esc(L('样式规则', 'Styles'))} <b data-swarm-styles>0</b></span>
                    <span class="dc-swarm-metric">${esc(L('耗时', 'Elapsed'))} <b data-swarm-time>0.0s</b></span>
                </div>
                <div class="dc-swarm-progress-track" aria-hidden="true">
                    <div class="dc-swarm-progress-fill" data-swarm-progress></div>
                </div>
            </div>
        `;

        surface.appendChild(stageEl);
        viewportEl = stageEl.querySelector('.dc-swarm-viewport');
        scaffoldEl = stageEl.querySelector('.dc-swarm-scaffold');
        blueprintEl = scaffoldEl;
        previewWrapEl = stageEl.querySelector('.dc-swarm-preview-wrap');
        fxCanvas = stageEl.querySelector('.dc-swarm-fx');
        fxCtx = fxCanvas.getContext('2d');
        cursorsWrapEl = stageEl.querySelector('.dc-swarm-cursors');
        codeViewEl = stageEl.querySelector('.dc-swarm-code-view');
        tickerEl = stageEl.querySelector('[data-swarm-ticker]');
        livePillTextEl = stageEl.querySelector('[data-swarm-pill-text]');
        progressFillEl = stageEl.querySelector('[data-swarm-progress]');
        metricLinesEl = stageEl.querySelector('[data-swarm-lines]');
        metricNodesEl = stageEl.querySelector('[data-swarm-nodes]');
        metricStylesEl = stageEl.querySelector('[data-swarm-styles]');
        metricTimeEl = stageEl.querySelector('[data-swarm-time]');

        buildCursorNodes();

        stageEl.addEventListener('click', event => {
            const btn = event.target.closest('[data-swarm-action]');
            if (!btn) return;
            const act = btn.dataset.swarmAction;
            if (act === 'replay') replayCurrent();
            else if (act === 'cursors') toggleCursors(!state.cursorsHidden);
            else if (act === 'sound') toggleSound(!state.soundEnabled);
            else if (act === 'source') toggleSourceView(!state.showSource);
            else if (act === 'popout') openInNewTab();
            else if (act === 'download') downloadCurrentHtml();
        });

        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => resizeCanvas()).observe(viewportEl);
        }
        return stageEl;
    }

    function buildCursorNodes() {
        cursorsWrapEl.innerHTML = '';
        state.cursors = AGENTS.map((agent, idx) => {
            const node = document.createElement('div');
            node.className = 'dc-swarm-cursor is-away';
            node.setAttribute('data-tool', 'arrow');
            node.innerHTML = `
                <svg class="dc-swarm-cursor-svg dc-swarm-cursor-svg--arrow" viewBox="0 0 20 22" aria-hidden="true">
                    <path d="M2.6 1.9 17.4 10.6 10.3 12.3 6.6 19.2Z"/>
                </svg>
                <svg class="dc-swarm-cursor-svg dc-swarm-cursor-svg--crosshair" viewBox="0 0 18 18" aria-hidden="true">
                    <path class="dc-swarm-cursor-halo" d="M9 2.5V15.5M2.5 9H15.5"/>
                    <path class="dc-swarm-cursor-stroke" d="M9 2.5V15.5M2.5 9H15.5"/>
                    <circle class="dc-swarm-cursor-dot" cx="9" cy="9" r="1.15"/>
                </svg>
                <svg class="dc-swarm-cursor-svg dc-swarm-cursor-svg--ibeam" viewBox="0 0 14 20" aria-hidden="true">
                    <path class="dc-swarm-cursor-halo" d="M3.8 2.8H10.2M7 2.8V17.2M3.8 17.2H10.2"/>
                    <path class="dc-swarm-cursor-stroke" d="M3.8 2.8H10.2M7 2.8V17.2M3.8 17.2H10.2"/>
                </svg>
                <svg class="dc-swarm-cursor-svg dc-swarm-cursor-svg--pen" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M2.2 2.2 14.2 5.4 11.4 11.4 5.4 14.2Z"/>
                    <path class="dc-swarm-cursor-slit" d="M2.4 2.4 8.2 8.2"/>
                    <circle class="dc-swarm-cursor-dot" cx="8.6" cy="8.6" r="1.2"/>
                    <path d="M11.6 11.6 15.8 15.8 14.2 17.4 10 13.2Z"/>
                </svg>
                <div class="dc-swarm-cursor-tag">
                    <span class="dc-swarm-cursor-role">${esc(L(agent.zh, agent.en))}</span>
                    <span class="dc-swarm-cursor-task">${esc(L(agent.defaultTaskZh, agent.defaultTaskEn))}</span>
                </div>
            `;
            cursorsWrapEl.appendChild(node);
            return {
                agent,
                index: idx,
                node,
                taskNode: node.querySelector('.dc-swarm-cursor-task'),
                x: -40,
                y: -40,
                tone: '#96BAE0',
                ink: '#14161a',
                tool: 'arrow',
                steps: [],        // 待执行的计划步骤
                step: null,       // 当前步骤
                stepAt: 0,
                nextPlanAt: 0,
                leaveAt: 0,       // 绘制完成后的离场时间
                labelUntil: 0,
                labeled: false,
                flipX: false,
                flipY: false,
                away: true,
                pressed: false,
                drift: 0,
                trail: [],
                seed: idx * 1.7 + Math.random() * 6,
                side: Math.random() < 0.5 ? -1 : 1
            };
        });
        applyTones();
    }

    // 每次绘制换一套配色，且不与上一次相同
    function pickPalette() {
        const pool = SWARM_PALETTES.filter(p => p.id !== lastPaletteId);
        const picked = pool[Math.floor(Math.random() * pool.length)] || SWARM_PALETTES[0];
        lastPaletteId = picked.id;
        return picked;
    }

    // 把当前配色写到指针、头像圆点和舞台 CSS 变量上。
    // 顶栏/底栏固定深色，用 dark 三色；指针和画布标注按页面明暗取 dark 或 light 三色。
    function applyTones() {
        const palette = state.swarmPalette || SWARM_PALETTES[0];
        const pageTones = state.pageDark ? palette.dark : palette.light;
        state.cursors.forEach(c => {
            c.tone = pageTones[c.agent.tone];
            c.ink = inkOn(c.tone);
            c.node.style.setProperty('--cursor-color', c.tone);
            c.node.style.setProperty('--cursor-ink', c.ink);
        });
        if (!stageEl) return;
        stageEl.dataset.swarmPalette = palette.id;
        stageEl.classList.toggle('is-page-light', !state.pageDark);
        ['a', 'b', 'c'].forEach((key, i) => stageEl.style.setProperty(`--sw-${key}`, palette.dark[i]));
        stageEl.querySelectorAll('[data-agent-dot]').forEach(dot => {
            const agent = AGENTS.find(a => a.id === dot.dataset.agentDot);
            const color = palette.dark[agent ? agent.tone : 0];
            dot.style.background = color;
            dot.style.color = inkOn(color);
        });
    }

    // 读取预览页面的实际背景明暗；蓝图阶段画布是深色的
    function detectPageDark(doc) {
        try {
            const win = doc.defaultView;
            for (const el of [doc.body, doc.documentElement]) {
                if (!el) continue;
                const cs = win.getComputedStyle(el);
                const image = /rgba?\([^)]+\)/.exec(cs.backgroundImage || '');
                for (const value of [image && image[0], cs.backgroundColor]) {
                    const m = /rgba?\(([^)]+)\)/.exec(value || '');
                    if (!m) continue;
                    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
                    if (parts.length >= 4 && parts[3] < 0.5) continue;
                    return luminance(parts.slice(0, 3)) < 0.3;
                }
            }
        } catch {
            // 读不到就按浏览器默认的白底处理
        }
        return false;
    }

    function refreshPageTone() {
        const doc = iframeEl && iframeEl.contentDocument;
        const dark = state.bodyReady && doc ? detectPageDark(doc) : true;
        if (dark === state.pageDark) return;
        state.pageDark = dark;
        applyTones();
    }

    // 预览页面滚动后元素位置会变，重新采集，保证选框贴合真实元素
    function watchFrameScroll(frame) {
        try {
            frame.contentWindow.addEventListener('scroll', () => {
                if (state.collectTimer) return;
                state.collectTimer = setTimeout(() => { state.collectTimer = null; collectDomTargets(); }, 140);
            }, { passive: true });
        } catch {
            // ignore
        }
    }

    // 开场：指针从画布四周错峰入场
    function resetCursors(now) {
        const { w, h } = viewSize();
        const order = state.cursors.map((_, i) => i).sort(() => Math.random() - 0.5);
        state.cursors.forEach((c, i) => {
            c.steps.length = 0;
            c.step = null;
            c.trail.length = 0;
            c.leaveAt = 0;
            c.labelUntil = 0;
            c.drift = 0;
            setTool(c, 'arrow');
            setPressed(c, false);
            setAway(c, true);
            const edge = Math.floor(Math.random() * 4);
            c.x = edge === 0 ? -28 : edge === 1 ? w + 28 : rand(40, w - 40);
            c.y = edge === 2 ? -28 : edge === 3 ? h + 28 : rand(40, h - 40);
            c.nextPlanAt = now + 120 + order[i] * rand(150, 260);
            c.taskNode.textContent = L(c.agent.defaultTaskZh, c.agent.defaultTaskEn);
        });
    }

    function resizeCanvas() {
        if (!viewportEl || !fxCanvas) return;
        const rect = viewportEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        state.width = rect.width;
        state.height = rect.height;
        state.dpr = Math.min(window.devicePixelRatio || 1, 2);
        fxCanvas.width = Math.round(rect.width * state.dpr);
        fxCanvas.height = Math.round(rect.height * state.dpr);
    }

    // ── 无闪烁沙箱 Iframe 管理 ──────────────────────────────
    function ensureLiveIframe() {
        if (!previewWrapEl) return null;
        if (iframeEl && previewWrapEl.contains(iframeEl)) return iframeEl;
        previewWrapEl.innerHTML = '';
        iframeEl = document.createElement('iframe');
        iframeEl.className = 'dc-swarm-iframe';
        iframeEl.title = state.pageTitle || L('AI 实时协同预览', 'AI Swarm Live Preview');
        // 流式阶段使用 allow-same-origin 以便增量更新 DOM 和读取真实元素坐标；所有 <script> 在流式阶段均被剥离，安全无虞
        iframeEl.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-modals allow-popups');
        iframeEl.setAttribute('referrerpolicy', 'no-referrer');
        previewWrapEl.appendChild(iframeEl);

        try {
            const doc = iframeEl.contentDocument;
            if (doc) {
                doc.open();
                doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="__dc_swarm_base">
                    html { scroll-behavior: smooth; }
                    body { margin: 0; min-height: 100vh; transition: background-color 0.25s ease, color 0.25s ease; }
                    @keyframes __dcSwarmReveal {
                        0% { outline: 1.5px solid rgba(56, 189, 248, 0.75); box-shadow: 0 0 18px rgba(99, 102, 241, 0.25); }
                        100% { outline: 1.5px solid transparent; box-shadow: none; }
                    }
                </style><style id="__dc_swarm_live_css"></style></head><body></body></html>`);
                doc.close();
                state.iframeReady = true;
                watchFrameScroll(iframeEl);
            }
        } catch {
            state.iframeReady = false;
        }
        return iframeEl;
    }

    // 剥离未闭合或不安全的标签，保障流式增量渲染平滑无报错
    function sanitizePartialBody(bodyHtml) {
        let clean = String(bodyHtml || '');
        // 流式阶段暂不执行 <script>，避免半截 JS 报错；完成时统一完整执行
        clean = clean.replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, '');
        // 去掉末尾半截未闭合的标签（如 `<div class="ca`）
        clean = clean.replace(/<[^>]*$/, '');
        return clean;
    }

    function extractAllStyles(html) {
        const styles = [];
        const re = /<style\b[^>]*>([\s\S]*?)(?:<\/style>|$)/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            let css = m[1] || '';
            // 若在流式末尾未闭合，自动补齐花括号防止最后一条规则失效
            if (!m[0].toLowerCase().endsWith('</style>')) {
                const openBraces = (css.match(/\{/g) || []).length;
                const closeBraces = (css.match(/\}/g) || []).length;
                if (openBraces > closeBraces) {
                    css = css.replace(/[^;{}]*$/, '') + '}'.repeat(openBraces - closeBraces);
                }
            }
            styles.push(css);
        }
        return styles.join('\n');
    }

    function extractExternalStyleLinks(html) {
        const links = [];
        const re = /<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi;
        let m;
        while ((m = re.exec(html)) !== null) links.push(m[0]);
        return links;
    }

    function updateIncrementalIframe(htmlCode, isFinal = false) {
        if (!htmlCode) return;
        if (isFinal) {
            // 最终完成：使用完整的 srcdoc（仅开放 allow-scripts 等沙箱，执行页面内完整 JS 与图表逻辑）
            if (!previewWrapEl) return;
            const finalFrame = document.createElement('iframe');
            finalFrame.className = 'dc-swarm-iframe';
            finalFrame.title = state.pageTitle || L('AI 实时协同预览', 'AI Swarm Live Preview');
            finalFrame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-same-origin');
            finalFrame.setAttribute('referrerpolicy', 'no-referrer');
            finalFrame.srcdoc = htmlCode;
            finalFrame.addEventListener('load', () => {
                watchFrameScroll(finalFrame);
                collectDomTargets();
            }, { once: true });
            previewWrapEl.replaceChildren(finalFrame);
            iframeEl = finalFrame;
            if (!state.bodyReady) {
                state.bodyReady = true;
                onRealDomReady();
            }
            scaffoldEl?.classList.add('is-faded');
            return;
        }

        const frame = ensureLiveIframe();
        if (!frame) return;
        try {
            const doc = frame.contentDocument;
            if (!doc || !doc.head || !doc.body) return;

            // 1. 同步外部样式表（如 FontAwesome / Google Fonts / Tailwind CDN 样式）
            const links = extractExternalStyleLinks(htmlCode);
            links.forEach(linkTag => {
                const hrefMatch = /href=["']([^"']+)["']/i.exec(linkTag);
                if (hrefMatch && !doc.head.querySelector(`link[href="${CSS.escape(hrefMatch[1])}"]`)) {
                    const linkEl = doc.createElement('link');
                    linkEl.rel = 'stylesheet';
                    linkEl.href = hrefMatch[1];
                    doc.head.appendChild(linkEl);
                }
            });

            // 2. 增量同步 <style>
            const cssText = extractAllStyles(htmlCode);
            if (cssText !== state.lastStyleSig) {
                state.lastStyleSig = cssText;
                let styleNode = doc.getElementById('__dc_swarm_live_css');
                if (!styleNode) {
                    styleNode = doc.createElement('style');
                    styleNode.id = '__dc_swarm_live_css';
                    doc.head.appendChild(styleNode);
                }
                styleNode.textContent = cssText;
            }

            // 3. 增量同步 <body>
            const bodyMatch = /<body([^>]*)>([\s\S]*?)(?:<\/body>|$)/i.exec(htmlCode);
            let rawBody = '';
            if (bodyMatch) {
                const bodyAttrs = bodyMatch[1] || '';
                rawBody = bodyMatch[2] || '';
                const clsMatch = /class=["']([^"']+)["']/i.exec(bodyAttrs);
                if (clsMatch && doc.body.className !== clsMatch[1]) doc.body.className = clsMatch[1];
                const styleAttrMatch = /style=["']([^"']+)["']/i.exec(bodyAttrs);
                if (styleAttrMatch) doc.body.setAttribute('style', styleAttrMatch[1]);
            } else if (!/<head\b/i.test(htmlCode) && /<(?:div|header|main|section|nav|h1|h2|canvas|svg|table|form|button)\b/i.test(htmlCode)) {
                // 没有写 <html>/<head>/<body> 直接写标签的片段
                rawBody = htmlCode.replace(/<style\b[\s\S]*?(?:<\/style>|$)/gi, '');
            }

            const cleanBody = sanitizePartialBody(rawBody);
            if (cleanBody.trim().length > 6) {
                if (cleanBody !== state.lastBodySig) {
                    state.lastBodySig = cleanBody;
                    doc.body.innerHTML = cleanBody;
                    // 自动滚到底部正在生成的区域（如果页面超出视口高度）
                    const win = frame.contentWindow;
                    if (win && doc.body.scrollHeight > state.height + 120) {
                        win.scrollTo({ top: Math.max(0, doc.body.scrollHeight - state.height + 60), behavior: 'smooth' });
                    }
                    collectDomTargets();
                }
                if (state.domTargets.length >= 1 || cleanBody.length > 80) {
                    if (!state.bodyReady) {
                        state.bodyReady = true;
                        onRealDomReady();
                    }
                    refreshPageTone();
                }
            }
        } catch {
            // 忽略跨域或瞬态 DOM 异常
        }
    }

    // 采集 iframe 内部真实 DOM 元素的坐标，供 10 个 AI 指针精准飞过去绘制！
    function collectDomTargets() {
        if (!iframeEl) return;
        try {
            const doc = iframeEl.contentDocument;
            if (!doc || !doc.body) return;
            const candidates = doc.body.querySelectorAll('header, nav, main, section, article, aside, footer, h1, h2, h3, p, a, label, li, blockquote, button, input, select, textarea, canvas, svg, table, ul, form, [class*="card"], [class*="chart"], [class*="panel"], [class*="hero"], [class*="stat"], [class*="box"], [class*="btn"], div');
            const targets = [];
            const vw = state.width || 800;
            const vh = state.height || 600;
            const win = doc.defaultView;

            for (let i = 0; i < candidates.length && targets.length < 64; i++) {
                const el = candidates[i];
                const r = el.getBoundingClientRect();
                if (r.width < 22 || r.height < 14) continue;
                if (r.bottom < 0 || r.top > vh + 40 || r.right < 0 || r.left > vw + 40) continue;
                // 避免全屏大外框把所有注意力占满
                if (r.width > vw * 0.94 && r.height > vh * 0.9 && candidates.length > 4) continue;

                const tag = el.tagName.toLowerCase();
                const cls = typeof el.className === 'string' && el.className.trim()
                    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
                    : '';
                const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18);
                let fontSize = '';
                try {
                    const fs = win?.getComputedStyle?.(el)?.fontSize;
                    if (fs) fontSize = `${Math.round(parseFloat(fs))}px`;
                } catch {
                    // ignore
                }
                const isTypeTag = tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'p' || tag === 'a' || tag === 'label' || tag === 'li' || tag === 'blockquote';

                targets.push({
                    x: Math.max(8, Math.min(vw - 40, r.left)),
                    y: Math.max(8, Math.min(vh - 36, r.top)),
                    w: Math.min(vw - 16, r.width),
                    h: Math.min(vh - 16, r.height),
                    tag,
                    fontSize,
                    hasText: Boolean(text) && (isTypeTag || tag === 'button' || el.childElementCount === 0),
                    label: `<${tag}${cls}>${text ? ' ' + text : ''}`,
                    kind: (tag === 'header' || tag === 'nav' || tag === 'section' || tag === 'main' || tag === 'article' || tag === 'aside' || tag === 'footer' || tag === 'div')
                        ? 'frame'
                        : (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'form')
                            ? 'logic'
                            : isTypeTag ? 'type' : 'dom'
                });
            }

            state.domTargets = targets;
            state.nodeCount = doc.body.querySelectorAll('*').length;

            refreshPageTone();
        } catch {
            // ignore
        }
    }

    // ── 实时解析流式代码中的 Token 驱动指针任务气泡与蓝图 ─────────
    function analyzeStreamTokens(code) {
        const text = String(code || '');
        state.lineCount = text ? text.split('\n').length : 0;

        // 1. 提取标题
        const title = extractTitle(text);
        if (title && title !== state.pageTitle) {
            state.pageTitle = title;
            const scaffoldTitle = stageEl?.querySelector('[data-swarm-scaffold-title], [data-swarm-bp-title]');
            if (scaffoldTitle) scaffoldTitle.textContent = title;
            updateBrowserChromeTitle(title);
        }

        // 2. 提取颜色色板
        const colors = text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
        if (colors.length) {
            const unique = [...new Set(colors.map(c => c.toLowerCase()))].filter(c => c !== '#ffffff' && c !== '#000000' && c !== '#fff' && c !== '#000');
            if (unique.length >= 2) {
                state.palette = unique.slice(-6);
                const swatchBox = stageEl?.querySelector('[data-swarm-swatches]');
                if (swatchBox) {
                    swatchBox.innerHTML = state.palette.map(c => `<span class="dc-swarm-bp-swatch" style="background:${c}"></span>`).join('');
                }
            }
        }

        // 3. 统计 CSS 规则数
        const styleMatches = text.match(/\{[^}]*\}/g);
        state.styleCount = styleMatches ? styleMatches.length : 0;

        // 4. 提取最新生成的最后几行代码用于待命流展示与任务派发
        const tailLines = text.slice(-900).split('\n').map(l => l.trim()).filter(Boolean);
        const scaffoldStream = stageEl?.querySelector('[data-swarm-scaffold-stream], [data-swarm-bp-stream]');
        if (scaffoldStream && !state.bodyReady) {
            scaffoldStream.innerHTML = tailLines.slice(-4).map(line => `<div class="dc-swarm-scaffold-line"><span>›</span> ${esc(line.slice(0, 68))}</div>`).join('');
        }

        const latestLine = tailLines.at(-1) || '';
        if (latestLine && !state.seenTokens.has(latestLine)) {
            state.seenTokens.add(latestLine);
            if (state.seenTokens.size > 400) {
                const first = state.seenTokens.values().next().value;
                state.seenTokens.delete(first);
            }
            dispatchLineToCursor(latestLine);
        }

        updateMetricsUi();
    }

    function dispatchLineToCursor(line) {
        let role = 'dom';
        let taskText = line.slice(0, 38);

        if (/@keyframes|animation|transition|transform/i.test(line)) {
            role = 'motion';
            const m = /(@keyframes\s+[\w-]+|transition\s*:[^;]+|transform\s*:[^;]+)/i.exec(line);
            taskText = `动效 ${m ? m[1] : line.slice(0, 28)}`;
        } else if (/linear-gradient|radial-gradient|background|backdrop-filter|box-shadow|color\s*:/i.test(line)) {
            role = 'style';
            const m = /(linear-gradient\([^)]+\)|#[0-9a-fA-F]{3,6}|backdrop-filter\s*:[^;]+|box-shadow\s*:[^;]+)/i.exec(line);
            taskText = `渲染 ${m ? m[1].slice(0, 28) : line.slice(0, 28)}`;
        } else if (/display\s*:\s*(?:grid|flex)|grid-template|justify-content|align-items|@media|width|padding/i.test(line)) {
            role = 'layout';
            taskText = `布局 ${line.replace(/\{.*$/, '').slice(0, 28)}`;
        } else if (/<(?:canvas|svg|path|circle|rect)\b|chart|echarts|ctx\./i.test(line)) {
            role = 'frame';
            taskText = `绘制图表 ${line.slice(0, 26)}`;
        } else if (/<(?:h[1-6]|p|span|strong|title|label)\b/i.test(line)) {
            role = 'type';
            const clean = line.replace(/<[^>]+>/g, '').trim();
            taskText = clean ? `排版 "${clean.slice(0, 20)}"` : `排版 ${line.slice(0, 26)}`;
        } else if (/<script|function\s+|const\s+|addEventListener|onclick|fetch\(/i.test(line)) {
            role = 'logic';
            taskText = `逻辑 ${line.slice(0, 28)}`;
        } else if (/<([a-zA-Z0-9-]+)([^>]*)>/.test(line)) {
            const m = /<([a-zA-Z0-9-]+)([^>]*)>/.exec(line);
            const tag = m[1].toLowerCase();
            const cls = /class=["']([^"']+)["']/.exec(m[2] || '');
            taskText = `构建 <${tag}${cls ? '.' + cls[1].trim().split(/\s+/)[0] : ''}>`;
            role = 'dom';
        }

        // 找到对应角色的指针更新其气泡文案并触发一次特写动作
        const candidates = state.cursors.filter(c => c.agent.role === role);
        const picked = candidates.length
            ? candidates[Math.floor(Math.random() * candidates.length)]
            : state.cursors[Math.floor(Math.random() * state.cursors.length)];

        if (picked) {
            picked.taskNode.textContent = taskText;
            // 接到任务的指针亮出名牌，并在歇着时提前开工
            const now = performance.now();
            picked.labelUntil = Math.max(picked.labelUntil, now + 2200);
            if (picked.step && picked.step.kind === 'wait' && !picked.steps.length) {
                picked.step.dur = Math.min(picked.step.dur, now - picked.stepAt + 260);
            }
            const dot = stageEl?.querySelector(`[data-agent-dot="${picked.agent.id}"]`);
            if (dot) {
                dot.classList.add('is-active');
                setTimeout(() => dot.classList.remove('is-active'), 620);
            }
        }
        if (tickerEl) {
            tickerEl.innerHTML = `<strong>${esc(L(picked?.agent.zh || 'AI', picked?.agent.en || 'AI'))}</strong> · ${esc(taskText)}`;
        }
    }

    function updateMetricsUi() {
        if (!stageEl) return;
        if (metricLinesEl) metricLinesEl.textContent = String(state.lineCount);
        if (metricNodesEl) metricNodesEl.textContent = String(state.nodeCount || Math.max(1, Math.floor(state.lineCount / 4)));
        if (metricStylesEl) metricStylesEl.textContent = String(state.styleCount);
        if (metricTimeEl && state.startedAt) {
            const sec = ((performance.now() - state.startedAt) / 1000).toFixed(1);
            metricTimeEl.textContent = `${sec}s`;
        }
        if (progressFillEl) {
            const pct = state.finished ? 100 : Math.min(94, 14 + Math.round(Math.sqrt(state.lineCount) * 6.5));
            progressFillEl.style.width = `${pct}%`;
        }
    }

    // ── 指针群运动引擎 ─────────────────────────────────────────
    // 每个指针按「计划」行动：一串带时长的步骤（移动 / 停顿 / 动作）。
    // 移动沿三次贝塞尔弧线，用最小加加速度曲线取时间（钟形速度：起步慢、中段快、收尾慢），
    // 时长按 Fitts 定律随距离对数增长，并乘上各自的 tempo，所以十个指针不会同步。
    const ROLE_KIND = { layout: 'frame', frame: 'frame', type: 'type', logic: 'logic', dom: 'dom', style: 'dom', motion: 'dom' };
    const planningAllowed = () => state.bodyReady && Boolean(state.domTargets.length) && (!state.finished || state.replaying || state.encore);
    const viewSize = () => ({ w: Math.max(320, state.width), h: Math.max(260, state.height) });
    const targetKey = t => `${Math.round(t.x)}|${Math.round(t.y)}|${Math.round(t.w)}|${Math.round(t.h)}`;
    const pushWait = (c, dur) => { c.steps.push({ kind: 'wait', dur }); };
    const pushDo = (c, fn) => { c.steps.push({ kind: 'do', fn, dur: 0 }); };

    function pushMove(c, from, tx, ty, { drag = false, settle = false } = {}) {
        const dx = tx - from.x;
        const dy = ty - from.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) return { x: tx, y: ty };
        // 弧线：控制点沿法线偏移。每个指针有惯用的一侧，拖拽和回正几乎走直线。
        const side = Math.random() < 0.78 ? c.side : -c.side;
        const off = (drag || settle ? dist * rand(0, 0.035) : dist * rand(0.06, 0.2)) * side;
        const nx = -dy / dist;
        const ny = dx / dist;
        const dur = settle
            ? rand(130, 200)
            : ((drag ? 300 : 150) + (drag ? 135 : 105) * Math.log2(dist / 14 + 1)) * c.agent.tempo * rand(0.9, 1.15);
        c.steps.push({
            kind: 'move',
            x0: from.x, y0: from.y, x1: tx, y1: ty,
            cx1: from.x + dx * 0.3 + nx * off, cy1: from.y + dy * 0.3 + ny * off,
            cx2: from.x + dx * 0.72 + nx * off * 0.5, cy2: from.y + dy * 0.72 + ny * off * 0.5,
            dur,
            ease: settle ? easeOutCubic : minJerk
        });
        return { x: tx, y: ty };
    }

    // 远距离移动常会略微冲过目标，停一下再回正
    function pushApproach(c, from, tx, ty) {
        const dist = Math.hypot(tx - from.x, ty - from.y);
        if (dist > 200 && Math.random() < 0.55) {
            const k = rand(5, 11) / dist;
            const over = pushMove(c, from, tx + (tx - from.x) * k + rand(-3, 3), ty + (ty - from.y) * k + rand(-3, 3));
            pushWait(c, rand(40, 90));
            return pushMove(c, over, tx, ty, { settle: true });
        }
        return pushMove(c, from, tx, ty);
    }

    function currentTargets() {
        return state.domTargets || [];
    }

    function pickTarget(c, now) {
        const targets = currentTargets();
        if (!targets.length) return null;
        const want = ROLE_KIND[c.agent.role];
        const preferred = want && Math.random() < 0.6 ? targets.filter(t => t.kind === want) : [];
        const pool = preferred.length ? preferred : targets;
        for (let i = 0; i < 6; i++) {
            // 偏向列表末尾，即最新生成的节点；同一个元素同一时间只让一个指针处理
            const t = pool[Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 0.65) * pool.length))];
            if ((state.busy.get(targetKey(t)) || 0) <= now) return t;
        }
        return null;
    }

    function setPressed(c, pressed) {
        c.pressed = pressed;
        c.node.classList.toggle('is-pressed', pressed);
    }

    function setTool(c, tool) {
        const next = tool || 'arrow';
        if (c.tool === next) return;
        c.tool = next;
        if (c.node && typeof c.node.setAttribute === 'function') {
            c.node.setAttribute('data-tool', next);
        }
    }

    function setAway(c, away) {
        if (c.away === away) return;
        c.away = away;
        c.node.classList.toggle('is-away', away);
    }

    // 计算当前元素与真实 DOM 兄弟节点之间的最小间距红线及边缘对齐线
    function computeGuidesForBox(box, pool = state.domTargets) {
        if (!box || !Array.isArray(pool) || !pool.length) return { gaps: [], aligns: [] };
        const left = box.x;
        const right = box.x + box.w;
        const top = box.y;
        const bottom = box.y + box.h;
        const best = { left: null, right: null, top: null, bottom: null };
        const aligns = [];

        for (let i = 0; i < pool.length; i++) {
            const o = pool[i];
            if (!o) continue;
            if (Math.abs(o.x - box.x) < 2 && Math.abs(o.y - box.y) < 2 && Math.abs(o.w - box.w) < 2 && Math.abs(o.h - box.h) < 2) continue;
            const oLeft = o.x;
            const oRight = o.x + o.w;
            const oTop = o.y;
            const oBottom = o.y + o.h;
            const containsBox = oLeft <= left + 1 && oRight >= right - 1 && oTop <= top + 1 && oBottom >= bottom - 1;
            const insideBox = left <= oLeft + 1 && right >= oRight - 1 && top <= oTop + 1 && bottom >= oBottom - 1;
            if (containsBox || insideBox) continue;

            const yOverlap = Math.min(bottom, oBottom) - Math.max(top, oTop);
            if (yOverlap > 6) {
                const cy = (Math.max(top, oTop) + Math.min(bottom, oBottom)) / 2;
                if (oRight <= left + 0.5) {
                    const dist = Math.round(left - oRight);
                    if (dist >= 2 && dist <= 220 && (!best.left || dist < best.left.dist)) {
                        best.left = { axis: 'x', x1: oRight, y1: cy, x2: left, y2: cy, dist };
                    }
                } else if (oLeft >= right - 0.5) {
                    const dist = Math.round(oLeft - right);
                    if (dist >= 2 && dist <= 220 && (!best.right || dist < best.right.dist)) {
                        best.right = { axis: 'x', x1: right, y1: cy, x2: oLeft, y2: cy, dist };
                    }
                }
            }

            const xOverlap = Math.min(right, oRight) - Math.max(left, oLeft);
            if (xOverlap > 6) {
                const cx = (Math.max(left, oLeft) + Math.min(right, oRight)) / 2;
                if (oBottom <= top + 0.5) {
                    const dist = Math.round(top - oBottom);
                    if (dist >= 2 && dist <= 220 && (!best.top || dist < best.top.dist)) {
                        best.top = { axis: 'y', x1: cx, y1: oBottom, x2: cx, y2: top, dist };
                    }
                } else if (oTop >= bottom - 0.5) {
                    const dist = Math.round(oTop - bottom);
                    if (dist >= 2 && dist <= 220 && (!best.bottom || dist < best.bottom.dist)) {
                        best.bottom = { axis: 'y', x1: cx, y1: bottom, x2: cx, y2: oTop, dist };
                    }
                }
            }

            if (aligns.length < 2) {
                if (Math.abs(left - oLeft) <= 1.5) {
                    aligns.push({ axis: 'y', pos: left, start: Math.min(top, oTop), end: Math.max(bottom, oBottom) });
                } else if (Math.abs(right - oRight) <= 1.5) {
                    aligns.push({ axis: 'y', pos: right, start: Math.min(top, oTop), end: Math.max(bottom, oBottom) });
                } else if (Math.abs(top - oTop) <= 1.5) {
                    aligns.push({ axis: 'x', pos: top, start: Math.min(left, oLeft), end: Math.max(right, oRight) });
                } else if (Math.abs(bottom - oBottom) <= 1.5) {
                    aligns.push({ axis: 'x', pos: bottom, start: Math.min(left, oLeft), end: Math.max(right, oRight) });
                }
            }
        }

        const gaps = [best.left, best.right, best.top, best.bottom]
            .filter(Boolean)
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 2);
        return { gaps, aligns };
    }

    function addMark(mark) {
        state.marks.push(mark);
        return mark;
    }

    function spawnRipple(x, y, color, now, maxR = 16) {
        state.ripples.push({ x, y, color, bornAt: now, maxR });
    }

    // 真实页面框架出现时：淡出待命层，指针群有序入场奔赴真实 DOM 元素
    function onRealDomReady() {
        const now = performance.now();
        scaffoldEl?.classList.add('is-faded');
        if (livePillTextEl) livePillTextEl.textContent = L('10 AI 协同绘制中', '10 AI Agents Painting');
        if (tickerEl) tickerEl.innerHTML = `<strong>✓</strong> ${esc(L('已挂载页面真实框架，指针群开始协同测绘与渲染…', 'Real DOM mounted — swarm measuring & rendering elements…'))}`;
        const order = state.cursors.map((_, i) => i).sort(() => Math.random() - 0.5);
        state.cursors.forEach((c, i) => {
            c.steps.length = 0;
            c.step = null;
            c.nextPlanAt = now + 40 + order[i] * rand(60, 160);
        });
    }

    function retireBlueprintWork() {
        state.wireframes.length = 0;
        state.busy.clear();
        state.marks.length = 0;
    }

    // 给指针排下一段工作：框选容器、间距测量、排版 I-beam 校对、钢笔锚点勾勒或点选元素
    function planNext(c, now) {
        const { w, h } = viewSize();
        c.steps.length = 0;
        setTool(c, 'arrow');
        const from = { x: c.x, y: c.y };
        const target = pickTarget(c, now);
        if (!target) {
            pushWait(c, rand(350, 750));
            return;
        }

        const box = { x: clamp(target.x, 6, w - 30), y: clamp(target.y, 6, h - 24) };
        box.w = clamp(target.w, 12, w - 6 - box.x);
        box.h = clamp(target.h, 10, h - 6 - box.y);
        const label = target.label ? target.label.slice(0, 28) : '';
        const role = c.agent.role;
        const roll = Math.random();
        let kind;
        if (role === 'qa') {
            kind = roll < 0.72 ? 'measure' : 'touch';
        } else if (role === 'type') {
            kind = (target.hasText || target.kind === 'type') ? (roll < 0.68 ? 'type' : 'measure') : (roll < 0.5 ? 'measure' : 'touch');
        } else if (role === 'layout' || role === 'frame') {
            kind = roll < 0.54 ? 'frame' : roll < 0.78 ? 'pen' : 'measure';
        } else if (role === 'style' || role === 'motion') {
            kind = roll < 0.28 ? 'pen' : roll < 0.56 ? 'frame' : roll < 0.8 ? 'measure' : 'touch';
        } else {
            kind = (target.hasText && roll < 0.26) ? 'type' : roll < 0.5 ? 'touch' : roll < 0.78 ? 'frame' : 'measure';
        }

        if (kind === 'frame' && (box.w < 60 || box.h < 28 || box.w * box.h > w * h * 0.42)) kind = 'touch';
        if (kind === 'pen' && (box.w < 70 || box.h < 36 || box.w * box.h > w * h * 0.45)) kind = 'touch';
        if (kind === 'type' && (box.w < 48 || box.h < 16)) kind = 'touch';
        if (kind === 'measure' && (box.w < 40 || box.h < 22)) kind = 'touch';

        const guides = (kind === 'frame' || kind === 'measure' || kind === 'type') ? computeGuidesForBox(box) : null;
        const inside = () => ({ x: box.x + box.w * rand(0.2, 0.8), y: box.y + box.h * rand(0.25, 0.75) });
        let mark = null;
        let at;
        if (kind === 'frame') {
            // 切换十字框选光标 → 移到左上角 → 按下拖到右下角 → 松手定格线框与兄弟间距红线
            at = pushApproach(c, from, box.x, box.y);
            pushDo(c, () => setTool(c, 'crosshair'));
            pushWait(c, rand(80, 190));
            pushDo(c, t => {
                setPressed(c, true);
                SwarmAudio.playClick(box.x);
                mark = addMark({ kind: 'box', c, x: box.x, y: box.y, bornAt: t });
                spawnRipple(box.x, box.y, c.tone, t);
            });
            pushWait(c, rand(50, 110));
            pushMove(c, at, box.x + box.w, box.y + box.h, { drag: true });
            pushWait(c, rand(150, 360));
            pushDo(c, t => {
                setPressed(c, false);
                setTool(c, 'arrow');
                SwarmAudio.playSnap(c.x);
                if (mark) { mark.endAt = t; mark.fx = c.x; mark.fy = c.y; }
                state.wireframes.push({ x: box.x, y: box.y, w: box.w, h: box.h, color: c.tone, ink: c.ink, label, guides, bornAt: t, ttl: 1550 });
            });
        } else if (kind === 'type') {
            // 切换 I-beam 文本光标 → 沿文本基线平滑扫过 + 闪烁输入光标与字号胶囊
            const yMid = clamp(box.y + Math.min(box.h * 0.55, 22), box.y + 8, box.y + box.h - 6);
            const xStart = clamp(box.x + 8, box.x + 4, box.x + box.w - 16);
            const xEnd = clamp(box.x + Math.min(box.w - 8, rand(56, 150)), xStart + 14, box.x + box.w - 4);
            at = pushApproach(c, from, xStart, yMid);
            pushDo(c, t => {
                setTool(c, 'ibeam');
                setPressed(c, true);
                SwarmAudio.playTick(xStart);
                mark = addMark({ kind: 'type', c, box, yLine: yMid, fontSize: target.fontSize || '', guides, bornAt: t });
            });
            pushWait(c, rand(60, 120));
            pushDo(c, () => setPressed(c, false));
            pushMove(c, at, xEnd, yMid, { drag: true });
            pushDo(c, () => SwarmAudio.playTick(xEnd));
            pushWait(c, rand(360, 740));
            pushDo(c, t => {
                setTool(c, 'arrow');
                if (mark) mark.endAt = t;
            });
        } else if (kind === 'pen') {
            // 切换钢笔工具 → 沿元素边缘依次落点绘制矢量轮廓与锚点方块
            const topEdge = Math.random() < 0.5;
            const pts = topEdge
                ? [
                    { x: box.x, y: box.y + box.h * 0.5 },
                    { x: box.x, y: box.y },
                    { x: box.x + box.w * 0.5, y: box.y },
                    { x: box.x + box.w, y: box.y }
                ]
                : [
                    { x: box.x, y: box.y },
                    { x: box.x + box.w, y: box.y },
                    { x: box.x + box.w, y: box.y + box.h }
                ];
            at = pushApproach(c, from, pts[0].x, pts[0].y);
            pushDo(c, t => {
                setTool(c, 'pen');
                SwarmAudio.playTick(pts[0].x);
                mark = addMark({ kind: 'pen', c, box, anchors: [{ x: pts[0].x, y: pts[0].y }], bornAt: t });
            });
            for (let pi = 1; pi < pts.length; pi++) {
                const pt = pts[pi];
                at = pushMove(c, at, pt.x, pt.y, { drag: true });
                pushDo(c, () => {
                    if (mark) mark.anchors.push({ x: pt.x, y: pt.y });
                    SwarmAudio.playSnap(pt.x);
                });
                pushWait(c, rand(60, 140));
            }
            pushWait(c, rand(180, 380));
            pushDo(c, t => {
                setTool(c, 'arrow');
                if (mark) mark.endAt = t;
            });
        } else if (kind === 'measure') {
            // 移入元素 → 显示内边距标尺 + 兄弟间距红线 → 扫过对角测量 → 收起
            const p1 = inside();
            const p2 = inside();
            at = pushApproach(c, from, p1.x, p1.y);
            pushDo(c, t => { mark = addMark({ kind: 'measure', c, box, guides, bornAt: t }); });
            pushWait(c, rand(240, 480));
            pushMove(c, at, p2.x, p2.y, { drag: true });
            pushWait(c, rand(240, 560));
            pushDo(c, t => { if (mark) mark.endAt = t; });
        } else {
            // 移到元素上 → 点一下 → 元素描边短暂亮起
            const p = inside();
            pushApproach(c, from, p.x, p.y);
            pushWait(c, rand(80, 190));
            pushDo(c, t => {
                setPressed(c, true);
                SwarmAudio.playClick(c.x);
                mark = addMark({ kind: 'touch', c, box, bornAt: t });
                spawnRipple(c.x, c.y, c.tone, t);
            });
            pushWait(c, rand(80, 140));
            pushDo(c, () => setPressed(c, false));
            pushWait(c, rand(360, 820));
            pushDo(c, t => { if (mark) mark.endAt = t; });
        }

        const busyFor = c.steps.reduce((sum, step) => sum + step.dur, 0);
        state.busy.set(targetKey(target), now + busyFor);
        if (state.busy.size > 200) state.busy.clear();
        c.labelUntil = Math.max(c.labelUntil, now + busyFor);
        // 做完一件事后停一会儿再接下一件，时长各不相同
        pushWait(c, rand(900, 3200) * c.agent.tempo);
    }

    function stepCursor(c, now) {
        for (let guard = 0; guard < 10; guard++) {
            if (!c.step) {
                if (!c.steps.length) {
                    if (c.leaveAt && now >= c.leaveAt) { setAway(c, true); return; }
                    if (!planningAllowed() || now < c.nextPlanAt) return;
                    planNext(c, now);
                    setAway(c, false);
                }
                c.step = c.steps.shift();
                c.stepAt = now;
            }
            const step = c.step;
            if (step.kind === 'do') {
                step.fn(now);
                c.step = null;
                continue;
            }
            const t = step.dur > 0 ? (now - c.stepAt) / step.dur : 1;
            if (step.kind === 'move') {
                const e = step.ease(clamp(t, 0, 1));
                c.x = bezier(step.x0, step.cx1, step.cx2, step.x1, e);
                c.y = bezier(step.y0, step.cy1, step.cy2, step.y1, e);
            }
            if (t < 1) return;
            c.step = null;
        }
    }

    function renderCursor(c, now, w, h) {
        // 停顿时保留极轻微的手部漂移，移动时淡出，避免指针像钉在屏幕上
        const resting = (!c.step || c.step.kind === 'wait') && !c.pressed;
        c.drift += ((resting ? 1 : 0) - c.drift) * 0.08;
        const jx = (Math.sin(now * 0.0011 + c.seed) * 0.7 + Math.sin(now * 0.0027 + c.seed * 1.9) * 0.3) * c.drift;
        const jy = (Math.cos(now * 0.0013 + c.seed * 1.3) * 0.6 + Math.sin(now * 0.0031 + c.seed * 0.7) * 0.3) * c.drift;
        c.node.style.transform = `translate3d(${(c.x + jx).toFixed(2)}px, ${(c.y + jy).toFixed(2)}px, 0)`;

        // 只有正在做事或刚接到任务的指针显示名牌；类名只在状态变化时切换，不触发逐帧布局
        // 同时最多亮 4 个名牌，画面不拥挤
        const labeled = !c.away && now < c.labelUntil && (c.labeled || state.labelCount < 4);
        if (labeled !== c.labeled) {
            c.labeled = labeled;
            state.labelCount += labeled ? 1 : -1;
            c.node.classList.toggle('is-labeled', labeled);
        }
        const flipX = c.x > w - 210;
        if (flipX !== c.flipX) { c.flipX = flipX; c.node.classList.toggle('is-flip-x', flipX); }
        const flipY = c.y > h - 52;
        if (flipY !== c.flipY) { c.flipY = flipY; c.node.classList.toggle('is-flip-y', flipY); }
    }

    // 快速移动时留下一条很淡、逐渐变细的尾迹；慢速或静止时没有
    function drawTrail(ctx, c, now) {
        const trail = c.trail;
        trail.push({ x: c.x, y: c.y, t: now });
        while (trail.length && now - trail[0].t > 150) trail.shift();
        if (c.away || trail.length < 3) return;
        const first = trail[0];
        const last = trail[trail.length - 1];
        const strength = clamp((Math.hypot(last.x - first.x, last.y - first.y) - 14) / 70, 0, 1);
        if (strength <= 0) return;
        ctx.strokeStyle = c.tone;
        ctx.lineCap = 'round';
        for (let k = 1; k < trail.length; k++) {
            const f = k / (trail.length - 1);
            ctx.globalAlpha = f * f * 0.24 * strength;
            ctx.lineWidth = 0.6 + f * 1.5;
            ctx.beginPath();
            ctx.moveTo(trail[k - 1].x, trail[k - 1].y);
            ctx.lineTo(trail[k].x, trail[k].y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    function tickFrame(now) {
        if (!state.active || !stageEl || stageEl.hidden) {
            state.rafId = 0;
            return;
        }
        state.rafId = requestAnimationFrame(tickFrame);

        if (metricTimeEl && state.startedAt && !state.finished) {
            metricTimeEl.textContent = `${((now - state.startedAt) / 1000).toFixed(1)}s`;
        }

        if (!fxCtx || state.cursorsHidden) return;
        const dpr = state.dpr || 1;
        const w = state.width;
        const h = state.height;

        fxCtx.save();
        fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        fxCtx.clearRect(0, 0, w, h);

        // 1. 已定格的组件线框（指针框选松手后留下，随后淡出）
        drawWireframeDrafts(fxCtx, now);

        // 2. 推进每个指针的计划并更新位置（只写 transform）
        for (let i = 0; i < state.cursors.length; i++) {
            const c = state.cursors[i];
            stepCursor(c, now);
            renderCursor(c, now, w, h);
            drawTrail(fxCtx, c, now);
        }

        // 3. 进行中的选框 / 标尺 / 点选 / 排版输入 / 钢笔矢量高亮
        for (let i = state.marks.length - 1; i >= 0; i--) {
            const mark = state.marks[i];
            const fadeIn = clamp((now - mark.bornAt) / 140, 0, 1);
            const fadeOut = mark.endAt ? 1 - clamp((now - mark.endAt) / (mark.kind === 'box' ? 160 : 280), 0, 1) : 1;
            const alpha = fadeIn * fadeOut;
            if ((mark.endAt && alpha <= 0) || now - mark.bornAt > 9000) {
                state.marks.splice(i, 1);
                continue;
            }
            if (mark.kind === 'box') drawDragMarquee(fxCtx, mark, alpha);
            else if (mark.kind === 'measure') drawMeasureGuides(fxCtx, mark, alpha);
            else if (mark.kind === 'type') drawTypingEffect(fxCtx, mark, alpha, now);
            else if (mark.kind === 'pen') drawPenDraft(fxCtx, mark, alpha);
            else drawTouchHighlight(fxCtx, mark, alpha);
        }

        // 4. 按下时的一圈涟漪
        for (let i = state.ripples.length - 1; i >= 0; i--) {
            const rp = state.ripples[i];
            const t = (now - rp.bornAt) / 420;
            if (t >= 1) {
                state.ripples.splice(i, 1);
                continue;
            }
            fxCtx.beginPath();
            fxCtx.arc(rp.x, rp.y, 3 + (rp.maxR - 3) * easeOutCubic(t), 0, Math.PI * 2);
            fxCtx.strokeStyle = rp.color;
            fxCtx.globalAlpha = 0.5 * (1 - t);
            fxCtx.lineWidth = 1.25;
            fxCtx.stroke();
        }

        // 5. Figma 风格顶部/左侧像素标尺与当前活动选区投射带
        drawRulers(fxCtx, w, h, now);

        fxCtx.restore();
    }

    const FX_FONT = '500 10px ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
    const RULER_FONT = '500 8.5px ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';
    const REDLINE_COLOR = '#f43f5e';
    const crisp = v => Math.round(v) + 0.5;
    const setDash = (ctx, pat) => { if (typeof ctx.setLineDash === 'function') ctx.setLineDash(pat); };

    // 尺寸 / 标签胶囊：色块底 + 自动取反差的文字色。cx 为水平中心。
    function drawPill(ctx, text, cx, y, color, ink, alpha) {
        ctx.font = FX_FONT;
        const tw = ctx.measureText(text).width + 12;
        const x = clamp(cx - tw / 2, 4, Math.max(4, state.width - tw - 4));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(Math.round(x), Math.round(y), tw, 16, 4);
        ctx.fill();
        ctx.fillStyle = ink;
        ctx.fillText(text, Math.round(x) + 6, Math.round(y) + 11.5);
    }

    function drawHandles(ctx, left, top, width, height, color, alpha) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        for (const [hx, hy] of [[left, top], [left + width, top], [left, top + height], [left + width, top + height]]) {
            ctx.fillRect(hx - 2.5, hy - 2.5, 5, 5);
            ctx.strokeRect(hx - 2.5, hy - 2.5, 5, 5);
        }
    }

    // Figma 兄弟元素间距红线与边缘对齐辅助线
    function drawSpacingGuides(ctx, guides, alpha) {
        if (!guides || alpha <= 0.02) return;
        const { gaps = [], aligns = [] } = guides;
        if (!gaps.length && !aligns.length) return;

        ctx.save();
        ctx.strokeStyle = REDLINE_COLOR;
        ctx.lineWidth = 1;

        if (aligns.length) {
            setDash(ctx, [3, 3]);
            ctx.globalAlpha = 0.48 * alpha;
            ctx.beginPath();
            for (let i = 0; i < aligns.length; i++) {
                const a = aligns[i];
                if (a.axis === 'y') {
                    const px = crisp(a.pos);
                    ctx.moveTo(px, a.start);
                    ctx.lineTo(px, a.end);
                } else {
                    const py = crisp(a.pos);
                    ctx.moveTo(a.start, py);
                    ctx.lineTo(a.end, py);
                }
            }
            ctx.stroke();
            setDash(ctx, []);
        }

        for (let i = 0; i < gaps.length; i++) {
            const g = gaps[i];
            ctx.strokeStyle = REDLINE_COLOR;
            ctx.globalAlpha = 0.9 * alpha;
            ctx.beginPath();
            if (g.axis === 'x') {
                const y = crisp(g.y1);
                const x1 = crisp(g.x1);
                const x2 = crisp(g.x2);
                ctx.moveTo(x1, y); ctx.lineTo(x2, y);
                ctx.moveTo(x1, y - 3.5); ctx.lineTo(x1, y + 3.5);
                ctx.moveTo(x2, y - 3.5); ctx.lineTo(x2, y + 3.5);
                ctx.stroke();
                if (g.dist >= 12) {
                    drawPill(ctx, `${g.dist}`, (g.x1 + g.x2) / 2, g.y1 > 24 ? g.y1 - 20 : g.y1 + 5, REDLINE_COLOR, '#ffffff', alpha);
                }
            } else {
                const x = crisp(g.x1);
                const y1 = crisp(g.y1);
                const y2 = crisp(g.y2);
                ctx.moveTo(x, y1); ctx.lineTo(x, y2);
                ctx.moveTo(x - 3.5, y1); ctx.lineTo(x + 3.5, y1);
                ctx.moveTo(x - 3.5, y2); ctx.lineTo(x + 3.5, y2);
                ctx.stroke();
                if (g.dist >= 12) {
                    drawPill(ctx, `${g.dist}`, g.x1 + 20, (g.y1 + g.y2) / 2 - 8, REDLINE_COLOR, '#ffffff', alpha);
                }
            }
        }
        ctx.restore();
    }

    // 拖拽选框：从按下点拉到指针当前位置，下方跟随实时坐标与尺寸
    function drawDragMarquee(ctx, mark, alpha) {
        const x2 = mark.endAt ? mark.fx : mark.c.x;
        const y2 = mark.endAt ? mark.fy : mark.c.y;
        const left = crisp(Math.min(mark.x, x2));
        const top = crisp(Math.min(mark.y, y2));
        const width = Math.max(1, Math.round(Math.abs(x2 - mark.x)));
        const height = Math.max(1, Math.round(Math.abs(y2 - mark.y)));
        const color = mark.c.tone;

        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.07 * alpha;
        ctx.fillRect(left, top, width, height);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.95 * alpha;
        ctx.lineWidth = 1;
        ctx.strokeRect(left, top, width, height);
        drawHandles(ctx, left, top, width, height, color, alpha);
        if (width > 36 && height > 14) {
            const below = top + height + 22 < state.height;
            const label = width > 108 ? `${Math.round(left)},${Math.round(top)} · ${width}×${height}` : `${width} × ${height}`;
            drawPill(ctx, label, left + width / 2, below ? top + height + 6 : top - 22, color, mark.c.ink, alpha);
        }
        ctx.restore();
    }

    // 测量标尺：元素内部到边缘的距离线 + 真实 DOM 兄弟间距红线
    function drawMeasureGuides(ctx, mark, alpha) {
        const box = mark.box;
        const color = mark.c.tone;
        const cx = crisp(clamp(mark.c.x, box.x, box.x + box.w));
        const cy = crisp(clamp(mark.c.y, box.y, box.y + box.h));
        const left = crisp(box.x);
        const top = crisp(box.y);

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.34 * alpha;
        ctx.strokeRect(left, top, Math.round(box.w), Math.round(box.h));
        ctx.globalAlpha = 0.9 * alpha;
        ctx.beginPath();
        ctx.moveTo(left, cy); ctx.lineTo(cx, cy);
        ctx.moveTo(left, cy - 3); ctx.lineTo(left, cy + 3);
        ctx.moveTo(cx, top); ctx.lineTo(cx, cy);
        ctx.moveTo(cx - 3, top); ctx.lineTo(cx + 3, top);
        ctx.stroke();
        const dx = Math.round(cx - left);
        const dy = Math.round(cy - top);
        if (dx > 34) drawPill(ctx, String(dx), left + dx / 2, cy - 20, color, mark.c.ink, alpha);
        if (dy > 30) drawPill(ctx, String(dy), cx + 20, top + dy / 2 - 8, color, mark.c.ink, alpha);
        ctx.restore();
        if (mark.guides) drawSpacingGuides(ctx, mark.guides, alpha);
    }

    // 排版 I-beam 校对效果：虚线文本框、基线扫描高亮、闪烁光标与字号胶囊
    function drawTypingEffect(ctx, mark, alpha, now) {
        const box = mark.box;
        const color = mark.c.tone;
        const left = crisp(box.x);
        const top = crisp(box.y);
        const width = Math.round(box.w);
        const height = Math.round(box.h);
        const yLine = crisp(mark.yLine || (box.y + Math.min(box.h * 0.55, 22)));
        const caretX = crisp(clamp(mark.c.x, box.x + 6, box.x + box.w - 4));

        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.04 * alpha;
        ctx.fillRect(left, top, width, height);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        setDash(ctx, [3, 3]);
        ctx.globalAlpha = 0.72 * alpha;
        ctx.strokeRect(left, top, width, height);
        setDash(ctx, []);

        // 文本基线选中条
        ctx.globalAlpha = 0.45 * alpha;
        ctx.beginPath();
        ctx.moveTo(left + 6, yLine + 5);
        ctx.lineTo(caretX, yLine + 5);
        ctx.stroke();

        // 闪烁竖线输入光标
        const blink = (Math.floor(now / 340) % 2) === 0 ? 1 : 0.35;
        ctx.globalAlpha = 0.95 * alpha * blink;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(caretX, Math.max(top + 3, yLine - 7));
        ctx.lineTo(caretX, Math.min(top + height - 3, yLine + 7));
        ctx.stroke();

        if (width > 42) {
            const badge = mark.fontSize ? `Aa ${mark.fontSize}` : 'Aa';
            drawPill(ctx, badge, left + 22, top > 24 ? top - 20 : top + height + 5, color, mark.c.ink, alpha);
        }
        ctx.restore();
        if (mark.guides) drawSpacingGuides(ctx, mark.guides, alpha * 0.72);
    }

    // 钢笔矢量轮廓勾勒：已落点的锚点方块 + 到当前光标的弹性虚线
    function drawPenDraft(ctx, mark, alpha) {
        const anchors = mark.anchors || [];
        if (!anchors.length) return;
        const color = mark.c.tone;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = 0.88 * alpha;
        if (anchors.length > 1) {
            ctx.beginPath();
            ctx.moveTo(crisp(anchors[0].x), crisp(anchors[0].y));
            for (let i = 1; i < anchors.length; i++) {
                ctx.lineTo(crisp(anchors[i].x), crisp(anchors[i].y));
            }
            ctx.stroke();
        }

        if (!mark.endAt) {
            const last = anchors[anchors.length - 1];
            const dist = Math.round(Math.hypot(mark.c.x - last.x, mark.c.y - last.y));
            if (dist > 3) {
                setDash(ctx, [3, 3]);
                ctx.globalAlpha = 0.7 * alpha;
                ctx.beginPath();
                ctx.moveTo(crisp(last.x), crisp(last.y));
                ctx.lineTo(crisp(mark.c.x), crisp(mark.c.y));
                ctx.stroke();
                setDash(ctx, []);
                if (dist > 28) {
                    drawPill(ctx, `${dist}px`, (last.x + mark.c.x) / 2, (last.y + mark.c.y) / 2 - 20, color, mark.c.ink, alpha * 0.9);
                }
            }
        }

        // 锚点白色小方块
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 1.1;
        ctx.globalAlpha = alpha;
        for (let i = 0; i < anchors.length; i++) {
            const ax = anchors[i].x;
            const ay = anchors[i].y;
            ctx.fillRect(ax - 2.5, ay - 2.5, 5, 5);
            ctx.strokeRect(ax - 2.5, ay - 2.5, 5, 5);
        }
        ctx.restore();
    }

    // 点选高亮：元素描边短暂亮起
    function drawTouchHighlight(ctx, mark, alpha) {
        const box = mark.box;
        const color = mark.c.tone;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(crisp(box.x), crisp(box.y), Math.round(box.w), Math.round(box.h), 4);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.05 * alpha;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7 * alpha;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    // Figma 风格顶部与左侧像素标尺，同步高亮当前活动元素区间
    function drawRulers(ctx, w, h, now) {
        if (w < 220 || h < 160) return;
        let rulerAlpha = 1;
        if (state.finished && !state.encore) {
            if (!state.finishedAt) return;
            const elapsed = now - state.finishedAt;
            if (elapsed > 2800) return;
            if (elapsed > 1900) rulerAlpha = 1 - clamp((elapsed - 1900) / 900, 0, 1);
        }
        if (rulerAlpha <= 0.02) return;

        const R = 16;
        const dark = state.pageDark;
        const bg = dark ? 'rgba(13, 16, 22, 0.56)' : 'rgba(246, 247, 250, 0.78)';
        const border = dark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(15, 23, 42, 0.1)';
        const tick = dark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(15, 23, 42, 0.24)';
        const textCol = dark ? 'rgba(255, 255, 255, 0.44)' : 'rgba(15, 23, 42, 0.48)';

        ctx.save();
        ctx.globalAlpha = rulerAlpha;

        // 背景条与角落交叉方块
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, R);
        ctx.fillRect(0, R, R, h - R);

        // 将进行中 mark 的范围投影到标尺上（最多取 3 个，避免视觉凌乱）
        let bands = 0;
        for (let i = state.marks.length - 1; i >= 0 && bands < 3; i--) {
            const m = state.marks[i];
            let bx = 0; let by = 0; let bw = 0; let bh = 0;
            if (m.kind === 'box') {
                const x2 = m.endAt ? m.fx : m.c.x;
                const y2 = m.endAt ? m.fy : m.c.y;
                bx = Math.min(m.x, x2);
                by = Math.min(m.y, y2);
                bw = Math.abs(x2 - m.x);
                bh = Math.abs(y2 - m.y);
            } else if (m.box) {
                bx = m.box.x; by = m.box.y; bw = m.box.w; bh = m.box.h;
            }
            if (bw > 8 && bh > 8) {
                bands += 1;
                ctx.fillStyle = m.c.tone;
                ctx.globalAlpha = 0.22 * rulerAlpha;
                ctx.fillRect(Math.max(R, bx), 0, Math.min(w - Math.max(R, bx), bw), R);
                ctx.fillRect(0, Math.max(R, by), R, Math.min(h - Math.max(R, by), bh));
            }
        }

        ctx.globalAlpha = rulerAlpha;
        ctx.strokeStyle = tick;
        ctx.fillStyle = textCol;
        ctx.font = RULER_FONT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 20; x < w; x += 10) {
            const px = crisp(x);
            const len = x % 100 === 0 ? 7 : x % 50 === 0 ? 4.5 : 2.5;
            ctx.moveTo(px, R);
            ctx.lineTo(px, R - len);
            if (x % 100 === 0) ctx.fillText(String(x), x + 2, 9.5);
        }
        for (let y = 20; y < h; y += 10) {
            const py = crisp(y);
            const len = y % 100 === 0 ? 7 : y % 50 === 0 ? 4.5 : 2.5;
            ctx.moveTo(R, py);
            ctx.lineTo(R - len, py);
        }
        ctx.stroke();

        // 左侧垂直刻度数字
        for (let y = 100; y < h; y += 100) {
            ctx.save();
            ctx.translate(9.5, y - 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(y), 0, 0);
            ctx.restore();
        }

        // 内边框线
        ctx.strokeStyle = border;
        ctx.beginPath();
        ctx.moveTo(R, crisp(R)); ctx.lineTo(w, crisp(R));
        ctx.moveTo(crisp(R), R); ctx.lineTo(crisp(R), h);
        ctx.stroke();

        ctx.restore();
    }

    // 组件线框：指针框选松手后，选框贴合到真实元素的外框并标注标签、坐标尺寸与兄弟间距红线，停留片刻后淡出。
    // 只描真实元素的轮廓，不画任何虚构图形。
    function drawWireframeDrafts(ctx, now) {
        for (let i = state.wireframes.length - 1; i >= 0; i--) {
            const wf = state.wireframes[i];
            const age = now - wf.bornAt;
            if (age > wf.ttl) {
                state.wireframes.splice(i, 1);
                continue;
            }
            const alpha = age < 120 ? age / 120 : age > wf.ttl - 700 ? (wf.ttl - age) / 700 : 1;
            const left = crisp(wf.x);
            const top = crisp(wf.y);
            const width = Math.round(wf.w);
            const height = Math.round(wf.h);

            ctx.save();
            ctx.strokeStyle = wf.color;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.9 * alpha;
            ctx.strokeRect(left, top, width, height);
            drawHandles(ctx, left, top, width, height, wf.color, alpha);
            if (width > 60) {
                const text = wf.label ? `${wf.label} · ${width}×${height}` : `${width} × ${height}`;
                ctx.font = FX_FONT;
                const half = (ctx.measureText(text).width + 12) / 2;
                drawPill(ctx, text, left + half, top > 24 ? top - 21 : top + 5, wf.color, wf.ink, alpha);
            }
            ctx.restore();
            if (wf.guides && age < 950) {
                const gAlpha = alpha * (1 - clamp((age - 450) / 500, 0, 1)) * 0.85;
                if (gAlpha > 0.03) drawSpacingGuides(ctx, wf.guides, gAlpha);
            }
        }
    }

    // ── 与右侧浏览器顶栏联动 ──────────────────────────────────
    function updateBrowserChromeTitle(title) {
        const panel = document.getElementById('dcBrowserPanel');
        if (!panel) return;
        const addr = panel.querySelector('.dc-browser-address input');
        if (addr && document.activeElement !== addr) {
            const slug = title ? encodeURIComponent(title.slice(0, 24)) : 'live-canvas';
            addr.value = `dragon://ai-swarm-canvas/${slug}.html`;
        }
    }

    function openBrowserStage() {
        const stage = ensureStage();
        if (!stage) return false;
        const panel = document.getElementById('dcBrowserPanel');
        panel?.classList.add('is-swarm-canvas');
        stage.hidden = false;

        // 自动展开右侧浏览器侧栏（窄屏手机端不强行弹出遮挡对话）
        if (window.innerWidth > 860 || window.DragonBrowserSidebar?.isOpen?.()) {
            window.DragonBrowserSidebar?.open?.({ liveCanvas: true, createEmpty: false });
        }
        resizeCanvas();
        if (!state.rafId) state.rafId = requestAnimationFrame(tickFrame);
        return true;
    }

    // ── 外部生命周期接口 ──────────────────────────────────────
    function startSession({ prompt = '', title = '' } = {}) {
        clearTimeout(state.replayTimer);
        clearTimeout(state.fadeTimer);
        clearTimeout(state.pacingTimer);
        state.pacingTimer = null;
        state.active = true;
        state.streaming = true;
        state.finished = false;
        state.finishedAt = 0;
        state.replaying = false;
        state.streamDonePending = false;
        state.cursorsHidden = false;
        state.showSource = false;
        state.startedAt = performance.now();
        state.htmlCode = '';
        state.streamTargetCode = '';
        state.revealedCode = '';
        state.pageTitle = title || '';
        state.prompt = String(prompt || '');
        state.lineCount = 0;
        state.nodeCount = 0;
        state.styleCount = 0;
        state.bodyReady = false;
        state.lastBodySig = '';
        state.lastStyleSig = '';
        state.seenTokens.clear();
        state.domTargets = [];
        state.wireframes = [];
        state.ripples = [];
        state.marks = [];
        state.busy.clear();
        state.encore = false;
        state.pageDark = true;
        state.swarmPalette = pickPalette();

        if (!openBrowserStage()) return;

        stageEl.classList.remove('is-finished', 'is-cursors-hidden');
        scaffoldEl?.classList.remove('is-faded');
        if (codeViewEl) codeViewEl.hidden = true;
        const cursorsBtn = stageEl.querySelector('[data-swarm-action="cursors"]');
        cursorsBtn?.setAttribute('aria-pressed', 'true');
        const sourceBtn = stageEl.querySelector('[data-swarm-action="source"]');
        sourceBtn?.setAttribute('aria-pressed', 'false');

        if (livePillTextEl) livePillTextEl.textContent = L('10 AI 协同准备中', '10 AI Agents Ready');
        if (tickerEl) tickerEl.textContent = L('等待页面真实框架挂载，指针群就位待命…', 'Awaiting real DOM framework — swarm on standby…');
        updateBrowserChromeTitle(state.pageTitle || L('AI实时协同画布', 'ai-swarm-canvas'));

        ensureLiveIframe();
        resetCursors(performance.now());
        applyTones();
        updateMetricsUi();
    }

    // 平滑渐进推进：当 AI 生成极快时，自适应平抑展开节奏，保证 4~8 秒优雅呈现
    function stepPacedReveal() {
        if (!state.active || state.finished || state.replaying) {
            state.pacingTimer = null;
            return;
        }

        const target = state.streamTargetCode || '';
        const currentLen = state.revealedCode.length;
        const totalLen = target.length;

        if (currentLen >= totalLen) {
            state.pacingTimer = null;
            if (state.streamDonePending && !state.finished) {
                finalizeSession();
            }
            return;
        }

        const lag = totalLen - currentLen;
        // 动态自适应步长：滞后多时稍快，AI 已完成时加速收尾，但无论如何不突变
        const step = state.streamDonePending
            ? Math.max(26, Math.min(lag, Math.floor(lag * 0.15) + 20))
            : Math.max(12, Math.min(lag, Math.floor(lag * 0.05) + 10));

        let nextPos = currentLen + step;
        if (nextPos < totalLen) {
            const nextTagEnd = target.indexOf('>', nextPos);
            if (nextTagEnd !== -1 && nextTagEnd - nextPos < 28) {
                nextPos = nextTagEnd + 1;
            }
        } else {
            nextPos = totalLen;
        }

        state.revealedCode = target.slice(0, nextPos);
        state.htmlCode = state.revealedCode;
        analyzeStreamTokens(state.htmlCode);

        if (state.showSource && codeViewEl) {
            const codeEl = codeViewEl.querySelector('code');
            if (codeEl) codeEl.textContent = state.htmlCode;
        }

        updateIncrementalIframe(state.htmlCode, false);
        updateMetricsUi();

        if (state.revealedCode.length < totalLen || state.streamDonePending) {
            const delay = state.streamDonePending ? 36 : 46;
            state.pacingTimer = setTimeout(stepPacedReveal, delay);
        } else {
            state.pacingTimer = null;
        }
    }

    function onStreamDelta(fullStreamText, { prompt = '' } = {}) {
        const extracted = extractStreamingHtml(fullStreamText);
        if (!extracted.found) return false;

        if (!state.active || state.finished) {
            startSession({ prompt, title: extracted.title });
        }

        state.streamTargetCode = extracted.code;
        if (!state.pacingTimer && state.revealedCode.length < state.streamTargetCode.length) {
            stepPacedReveal();
        }
        return true;
    }

    function onStreamFinish(finalText = '', { prompt = '' } = {}) {
        clearTimeout(state.renderTimer);
        state.renderTimer = null;

        const extracted = extractStreamingHtml(finalText);
        if (!extracted.found && !state.streamTargetCode && !state.htmlCode) {
            // 如果预触发了但最终回答里根本没有 HTML 代码，自动收起舞台
            if (state.active && !state.lineCount) deactivate();
            return false;
        }

        if (extracted.found) {
            if (!state.active) startSession({ prompt, title: extracted.title });
            state.streamTargetCode = extracted.code;
        }

        state.streamDonePending = true;
        // 如果当前展开进度已经追平，直接收尾；否则让 stepPacedReveal 步进完成后优雅收官
        if (state.revealedCode.length >= state.streamTargetCode.length) {
            finalizeSession();
        } else if (!state.pacingTimer) {
            stepPacedReveal();
        }
        return true;
    }

    function finalizeSession() {
        clearTimeout(state.pacingTimer);
        state.pacingTimer = null;
        state.streaming = false;
        state.finished = true;
        state.streamDonePending = false;
        state.htmlCode = state.streamTargetCode || state.htmlCode;
        analyzeStreamTokens(state.htmlCode);
        updateIncrementalIframe(state.htmlCode, true);

        if (state.showSource && codeViewEl) {
            const codeEl = codeViewEl.querySelector('code');
            if (codeEl) codeEl.textContent = state.htmlCode;
        }
        updateMetricsUi();

        if (stageEl) stageEl.classList.add('is-finished');
        if (livePillTextEl) livePillTextEl.textContent = L('10 AI 协同绘制完成', '10 AI Swarm Complete');
        if (tickerEl) tickerEl.innerHTML = `<strong>✓</strong> ${esc(L('页面框架与交互脚本已就绪，可直接点击体验或重播绘制', 'Framework & scripts ready — interact directly or replay'))}`;

        // 收尾：指针做完手头的动作后错峰离场，不遮挡用户与页面交互
        const now = performance.now();
        state.finishedAt = now;
        SwarmAudio.playFinish();
        const order = state.cursors.map((_, i) => i).sort(() => Math.random() - 0.5);
        state.cursors.forEach((c, i) => {
            c.taskNode.textContent = L('已完成', 'Done');
            setTool(c, 'arrow');
            while (c.steps.length && c.steps[c.steps.length - 1].kind === 'wait') c.steps.pop();
            if (!c.steps.length && c.step && c.step.kind === 'wait') c.step = null;
            c.leaveAt = now + 450 + order[i] * 140;
            c.labelUntil = Math.min(c.labelUntil, now + 700);
        });
        clearTimeout(state.fadeTimer);
        state.fadeTimer = setTimeout(() => {
            if (state.active && state.finished && !state.replaying) {
                toggleCursors(true);
            }
        }, 3600);
    }

    // 用于工作区 write_file / edit_file 生成完 HTML 文件、或点击「重播绘制」时的高速流式仿真演练
    function playFullHtml(htmlContent, { title = '' } = {}) {
        const code = String(htmlContent || '').trim();
        if (!code) return;
        startSession({ title: title || extractTitle(code) });
        state.replaying = true;

        const totalLen = code.length;
        const steps = 45;
        let step = 0;
        const stepMs = 95;

        const runStep = () => {
            if (!state.active || !state.replaying) return;
            step += 1;
            const ratio = Math.min(1, step / steps);
            const sliceLen = Math.max(1, Math.floor(totalLen * ratio));
            const partial = code.slice(0, sliceLen);
            state.htmlCode = partial;
            analyzeStreamTokens(partial);
            updateIncrementalIframe(partial, step >= steps);
            if (state.showSource && codeViewEl) {
                const codeEl = codeViewEl.querySelector('code');
                if (codeEl) codeEl.textContent = partial;
            }
            if (step < steps) {
                state.replayTimer = setTimeout(runStep, stepMs);
            } else {
                state.replaying = false;
                finalizeSession();
            }
        };
        runStep();
    }

    function replayCurrent() {
        if (!state.htmlCode) return;
        playFullHtml(state.htmlCode, { title: state.pageTitle });
    }

    function toggleCursors(hide) {
        state.cursorsHidden = Boolean(hide);
        // 绘制完成后重新打开指针群：让它们回到画布上继续巡检
        state.encore = !state.cursorsHidden && state.finished && !state.replaying;
        if (state.encore) {
            clearTimeout(state.fadeTimer);
            resetCursors(performance.now());
        }
        if (!stageEl) return;
        stageEl.classList.toggle('is-cursors-hidden', state.cursorsHidden);
        const btn = stageEl.querySelector('[data-swarm-action="cursors"]');
        btn?.setAttribute('aria-pressed', String(!state.cursorsHidden));
    }

    function toggleSound(enable) {
        state.soundEnabled = Boolean(enable);
        saveSoundPref(state.soundEnabled);
        if (state.soundEnabled) {
            SwarmAudio.unlock();
            SwarmAudio.playSnap(state.width / 2);
        }
        const btn = stageEl?.querySelector('[data-swarm-action="sound"]');
        btn?.setAttribute('aria-pressed', String(state.soundEnabled));
        return state.soundEnabled;
    }

    function toggleSourceView(show) {
        state.showSource = Boolean(show);
        if (!stageEl || !codeViewEl) return;
        codeViewEl.hidden = !state.showSource;
        if (state.showSource) {
            const codeEl = codeViewEl.querySelector('code');
            if (codeEl) codeEl.textContent = state.htmlCode || '';
        }
        const btn = stageEl.querySelector('[data-swarm-action="source"]');
        btn?.setAttribute('aria-pressed', String(state.showSource));
    }

    function openInNewTab() {
        const code = state.htmlCode || state.streamTargetCode || (iframeEl && iframeEl.srcdoc);
        if (!code) return false;
        try {
            const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const win = window.open(url, '_blank', 'noopener,noreferrer');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return Boolean(win);
        } catch (e) {
            console.error('Failed to open swarm canvas in new tab', e);
            return false;
        }
    }

    function downloadCurrentHtml() {
        if (!state.htmlCode) return;
        const blob = new Blob([state.htmlCode], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = (state.pageTitle || 'ai-generated-page').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'ai-page';
        a.href = url;
        a.download = `${safeName}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function deactivate() {
        clearTimeout(state.replayTimer);
        clearTimeout(state.fadeTimer);
        clearTimeout(state.pacingTimer);
        state.pacingTimer = null;
        if (state.renderTimer) {
            clearTimeout(state.renderTimer);
            state.renderTimer = null;
        }
        state.active = false;
        state.streaming = false;
        state.replaying = false;
        state.streamDonePending = false;
        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = 0;
        }
        const panel = document.getElementById('dcBrowserPanel');
        panel?.classList.remove('is-swarm-canvas');
        if (stageEl) stageEl.hidden = true;
        if (previewWrapEl) previewWrapEl.innerHTML = '';
        iframeEl = null;
    }

    // 为消息气泡里的 HTML 代码块挂载「✨ AI 指针群协同预览」快捷按钮
    function decorateMessageHtmlBlocks(messageEl, rawContent = '') {
        if (!messageEl) return;
        const extracted = extractStreamingHtml(rawContent);
        if (!extracted.found || extracted.code.trim().length < 40) return;
        const main = messageEl.querySelector('.dc-msg-main') || messageEl;
        if (main.querySelector('.dc-swarm-inline-trigger')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dc-swarm-inline-trigger';
        btn.innerHTML = `<span class="dc-swarm-inline-mark" aria-hidden="true"></span><span>${esc(L('右侧浏览器 AI 指针群协同绘制预览', 'AI Cursor Swarm Live Preview in Browser'))}</span>`;
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 860) {
                window.DragonBrowserSidebar?.open?.({ liveCanvas: true, createEmpty: false });
            }
            playFullHtml(extracted.code, { title: extracted.title });
        });
        main.appendChild(btn);
    }

    window.DragonHtmlSwarm = {
        isHtmlGenerationPrompt,
        extractStreamingHtml,
        startSession,
        onStreamDelta,
        onStreamFinish,
        playFullHtml,
        replayCurrent,
        toggleSound,
        openInNewTab,
        deactivate,
        decorateMessageHtmlBlocks,
        computeGuidesForBox,
        isActive: () => state.active,
        palettes: SWARM_PALETTES,
        currentPalette: () => state.swarmPalette && state.swarmPalette.id
    };
})();
