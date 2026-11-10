/**
 * Dragon Claw · Multi-Agent Swarm HTML Live Painter (右侧浏览器多指针协同实时绘制画布)
 *
 * 在普通对话（非三方连接器 Agent）中：
 * - 当检测到 AI 正在流式生成 HTML 页面（或通过工作区工具写入 .html 文件）时，
 *   自动打开右侧内置浏览器，启动 10 个各司其职的多彩 AI 鼠标指针群进行 60fps 丝滑协同绘制预览。
 * - 实时解析流式输出中的 <title>、CSS 颜色/选择器、DOM 标签与文案，驱动指针群任务气泡、
 *   拖拽选框、贝塞尔激光轨迹、矢量图表手绘（假图真画）与无闪烁增量 DOM 预览。
 */
(function () {
    'use strict';
    if (window.DragonHtmlSwarm) return;

    const L = (zh, en) => /^en/i.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const esc = val => String(val ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    // 10 位专业分工的 AI 协同绘制指针特工
    const AGENTS = [
        { id: 'arch',   zh: 'Arch·架构师',   en: 'Arch·Layout',   color: '#6366f1', glow: 'rgba(99,102,241,0.45)',  tool: '⬚', role: 'layout',  defaultTaskZh: '构建栅格与弹性容器', defaultTaskEn: 'Scaffolding Grid & Flex' },
        { id: 'style',  zh: 'Style·视觉总监', en: 'Style·Visual',  color: '#ec4899', glow: 'rgba(236,72,153,0.45)',  tool: '✦', role: 'style',   defaultTaskZh: '渲染流光渐变与毛玻璃', defaultTaskEn: 'Painting Glass & Gradients' },
        { id: 'dom',    zh: 'DOM·组件工匠',  en: 'DOM·Builder',   color: '#06b6d4', glow: 'rgba(6,182,212,0.45)',   tool: '◈', role: 'dom',     defaultTaskZh: '装配卡片与交互控件', defaultTaskEn: 'Mounting UI Components' },
        { id: 'motion', zh: 'Motion·动效大师',en: 'Motion·FX',     color: '#f59e0b', glow: 'rgba(245,158,11,0.45)',  tool: '⚡', role: 'motion',  defaultTaskZh: '注入阻尼曲线与关键帧', defaultTaskEn: 'Injecting Keyframe Curves' },
        { id: 'chart',  zh: 'Chart·图形引擎', en: 'Chart·Vector',  color: '#10b981', glow: 'rgba(16,185,129,0.45)',  tool: '📈', role: 'chart',   defaultTaskZh: '绘制矢量曲线与数据图', defaultTaskEn: 'Sketching Vector Charts' },
        { id: 'type',   zh: 'Type·排版专家',  en: 'Type·Copy',     color: '#8b5cf6', glow: 'rgba(139,92,246,0.45)',  tool: 'T', role: 'type',    defaultTaskZh: '校准字重层级与标题', defaultTaskEn: 'Typesetting Hierarchy' },
        { id: 'logic',  zh: 'Logic·交互核心', en: 'Logic·Script',  color: '#f43f5e', glow: 'rgba(244,63,94,0.45)',   tool: '⚙', role: 'logic',   defaultTaskZh: '绑定状态机与事件监听', defaultTaskEn: 'Wiring Event Listeners' },
        { id: 'shader', zh: 'Shader·光影渲染',en: 'Shader·Glow',   color: '#3b82f6', glow: 'rgba(59,130,246,0.45)',  tool: '◐', role: 'style',   defaultTaskZh: '计算环境光遮蔽与阴影', defaultTaskEn: 'Computing Ambient Shadows' },
        { id: 'layout', zh: 'Layout·响应式',  en: 'Layout·Flex',   color: '#14b8a6', glow: 'rgba(20,184,166,0.45)',  tool: '⊞', role: 'layout',  defaultTaskZh: '自适应断点与留白对齐', defaultTaskEn: 'Responsive Breakpoints' },
        { id: 'qa',     zh: 'QA·像素校准',    en: 'QA·Pixel',      color: '#eab308', glow: 'rgba(234,179,8,0.45)',   tool: '⌖', role: 'qa',      defaultTaskZh: '亚像素级边距测量校准', defaultTaskEn: 'Sub-pixel Alignment Check' }
    ];

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

    const state = {
        active: false,
        streaming: false,
        finished: false,
        replaying: false,
        replayTimer: null,
        fadeTimer: null,
        cursorsHidden: false,
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
        domTargets: [],       // 真实 iframe 内的 DOM 元素矩形 [{ x, y, w, h, tag, label, kind }]
        syntheticBoxes: [],   // 蓝图/合成图形区块 [{ x, y, w, h, kind, color, label, progress }]
        ripples: [],          // 点击波纹 [{ x, y, r, maxR, color, alpha }]
        sparks: [],           // 粒子火花 [{ x, y, vx, vy, color, alpha, size }]
        sketches: [],         // 假绘制的高级矢量图形 [{ x, y, w, h, kind, color, progress, bornAt, ttl }]
        links: [],            // 两个 Agent 之间的激光同步连线 [{ a, b, color, bornAt, ttl }]
        cursors: [],          // 10 个指针实体
        iframeReady: false,
        lastBodySig: '',
        lastStyleSig: ''
    };

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
                        ${AGENTS.map(a => `<span class="dc-swarm-agent-dot" data-agent-dot="${a.id}" style="background:${a.color}" title="${esc(L(a.zh, a.en))}">${esc(a.id[0].toUpperCase())}</span>`).join('')}
                    </div>
                    <div class="dc-swarm-ticker" data-swarm-ticker>${esc(L('正在初始化多智能体协同画布…', 'Initializing multi-agent swarm canvas…'))}</div>
                </div>
                <div class="dc-swarm-topbar-actions">
                    <button type="button" class="dc-swarm-btn" data-swarm-action="replay" title="${esc(L('让 AI 指针群重新演示绘制过程', 'Replay multi-agent swarm drawing'))}">✨ ${esc(L('重播绘制', 'Replay'))}</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="cursors" aria-pressed="true" title="${esc(L('显示或隐藏 AI 指针群图层', 'Toggle AI cursors overlay'))}">👁 ${esc(L('指针群', 'Cursors'))}</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="source" aria-pressed="false" title="${esc(L('切换实时预览与源码视图', 'Toggle preview and source code'))}">&lt;/&gt; ${esc(L('源码', 'Code'))}</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="popout" title="${esc(L('在新标签页打开完整网页', 'Open in new tab'))}">⤢</button>
                    <button type="button" class="dc-swarm-btn" data-swarm-action="download" title="${esc(L('下载生成的 HTML 文件', 'Download HTML file'))}">↓</button>
                </div>
            </div>
            <div class="dc-swarm-viewport">
                <div class="dc-swarm-preview-wrap"></div>
                <div class="dc-swarm-blueprint">
                    <div class="dc-swarm-bp-header">
                        <div class="dc-swarm-bp-brand">
                            <span class="dc-swarm-bp-logo"></span>
                            <span class="dc-swarm-bp-title" data-swarm-bp-title>AI Swarm Live Blueprint</span>
                        </div>
                        <div class="dc-swarm-bp-swatches" data-swarm-swatches>
                            ${state.palette.map(c => `<span class="dc-swarm-bp-swatch" style="background:${c}"></span>`).join('')}
                        </div>
                    </div>
                    <div class="dc-swarm-bp-grid">
                        <div class="dc-swarm-bp-card" data-bp-slot="0" style="--bp-accent:#6366f1">
                            <span class="dc-swarm-bp-card-tag">&lt;section.hero-metric&gt;</span>
                            <div class="dc-swarm-bp-bar"></div>
                            <div class="dc-swarm-bp-bar is-short"></div>
                        </div>
                        <div class="dc-swarm-bp-card" data-bp-slot="1" style="--bp-accent:#ec4899">
                            <span class="dc-swarm-bp-card-tag">&lt;div.glass-card&gt;</span>
                            <div class="dc-swarm-bp-bar"></div>
                            <div class="dc-swarm-bp-bar is-short"></div>
                        </div>
                        <div class="dc-swarm-bp-card" data-bp-slot="2" style="--bp-accent:#06b6d4">
                            <span class="dc-swarm-bp-card-tag">&lt;canvas.visual-chart&gt;</span>
                            <div class="dc-swarm-bp-bar"></div>
                            <div class="dc-swarm-bp-bar is-short"></div>
                        </div>
                    </div>
                    <div class="dc-swarm-bp-main">
                        <div class="dc-swarm-bp-stage-box" data-bp-slot="3">
                            <span class="dc-swarm-bp-card-tag">&lt;main.interactive-viewport&gt; · SVG / Canvas Vector Stage</span>
                            <div class="dc-swarm-bp-code-stream" data-swarm-bp-stream></div>
                        </div>
                        <div class="dc-swarm-bp-side-box" data-bp-slot="4">
                            <span class="dc-swarm-bp-card-tag">&lt;aside.control-panel&gt; · CSS Tokens</span>
                            <div class="dc-swarm-bp-bar"></div>
                            <div class="dc-swarm-bp-bar is-short"></div>
                            <div class="dc-swarm-bp-bar"></div>
                            <div class="dc-swarm-bp-bar is-short"></div>
                        </div>
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
        blueprintEl = stageEl.querySelector('.dc-swarm-blueprint');
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
            node.className = 'dc-swarm-cursor';
            node.style.setProperty('--cursor-color', agent.color);
            node.style.setProperty('--cursor-glow', agent.glow);
            node.innerHTML = `
                <svg class="dc-swarm-cursor-svg" viewBox="0 0 24 26" fill="none" aria-hidden="true">
                    <path d="M3 2.5L20.5 14.2L12.2 15.6L8.2 23.5L3 2.5Z" fill="${agent.color}" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
                </svg>
                <span class="dc-swarm-cursor-tool">${esc(agent.tool)}</span>
                <div class="dc-swarm-cursor-tag">
                    <span class="dc-swarm-cursor-role">${esc(L(agent.zh, agent.en))}</span>
                    <span class="dc-swarm-cursor-task">${esc(L(agent.defaultTaskZh, agent.defaultTaskEn))}</span>
                </div>
            `;
            cursorsWrapEl.appendChild(node);

            const angle = (idx / AGENTS.length) * Math.PI * 2;
            const startX = 240 + Math.cos(angle) * 180;
            const startY = 220 + Math.sin(angle) * 140;
            return {
                agent,
                index: idx,
                node,
                roleNode: node.querySelector('.dc-swarm-cursor-role'),
                taskNode: node.querySelector('.dc-swarm-cursor-task'),
                x: startX,
                y: startY,
                vx: 0,
                vy: 0,
                tx: startX,
                ty: startY,
                trail: [],
                mode: 'PATROL', // 'DRAG_BOX' | 'PAINT_SWEEP' | 'SKETCH_GRAPHIC' | 'MEASURE_ALIGN' | 'PATROL'
                boxStart: null,
                boxEnd: null,
                boxColor: agent.color,
                boxLabel: '',
                modeUntil: 0,
                nextRetargetAt: 0,
                phaseOffset: idx * 0.85
            };
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
                collectDomTargets();
            }, { once: true });
            previewWrapEl.replaceChildren(finalFrame);
            iframeEl = finalFrame;
            blueprintEl?.classList.add('is-faded');
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
            if (cleanBody.trim().length > 12) {
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
                if (state.domTargets.length >= 2 || cleanBody.length > 180) {
                    state.bodyReady = true;
                    blueprintEl?.classList.add('is-faded');
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
            const candidates = doc.body.querySelectorAll('header, nav, main, section, article, aside, footer, h1, h2, h3, button, input, select, textarea, canvas, svg, table, ul, form, [class*="card"], [class*="chart"], [class*="panel"], [class*="hero"], [class*="stat"], [class*="box"], [class*="btn"], div');
            const targets = [];
            const vw = state.width || 800;
            const vh = state.height || 600;

            for (let i = 0; i < candidates.length && targets.length < 48; i++) {
                const el = candidates[i];
                const r = el.getBoundingClientRect();
                if (r.width < 24 || r.height < 18) continue;
                if (r.bottom < 0 || r.top > vh + 40 || r.right < 0 || r.left > vw + 40) continue;
                // 避免全屏大外框把所有注意力占满
                if (r.width > vw * 0.94 && r.height > vh * 0.9 && candidates.length > 4) continue;

                const tag = el.tagName.toLowerCase();
                const cls = typeof el.className === 'string' && el.className.trim()
                    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
                    : '';
                const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18);
                const isChartLike = tag === 'canvas' || tag === 'svg' || /chart|graph|plot|canvas|ring|gauge|trend|visual|echarts/i.test(cls + ' ' + (el.id || ''));

                targets.push({
                    x: Math.max(8, Math.min(vw - 40, r.left)),
                    y: Math.max(8, Math.min(vh - 36, r.top)),
                    w: Math.min(vw - 16, r.width),
                    h: Math.min(vh - 16, r.height),
                    tag,
                    label: `<${tag}${cls}>${text ? ' ' + text : ''}`,
                    kind: isChartLike ? 'chart' : (tag === 'button' || tag === 'input' || tag === 'form') ? 'logic' : (tag === 'h1' || tag === 'h2' || tag === 'h3') ? 'type' : 'dom'
                });
            }

            state.domTargets = targets;
            state.nodeCount = doc.body.querySelectorAll('*').length;

            // 如果检测到图表容器（如 <canvas> 或 .chart），自动生成假的高级矢量图表手绘动画覆盖在对应坐标上！
            targets.filter(t => t.kind === 'chart' && t.w >= 80 && t.h >= 60).slice(0, 4).forEach((t, idx) => {
                const key = `chart-${Math.round(t.x / 20)}-${Math.round(t.y / 20)}`;
                if (!state.sketches.some(s => s.key === key)) {
                    state.sketches.push({
                        key,
                        x: t.x + 8,
                        y: t.y + 8,
                        w: Math.max(80, t.w - 16),
                        h: Math.max(50, t.h - 16),
                        kind: idx % 3 === 0 ? 'spline' : idx % 3 === 1 ? 'bars' : 'radar',
                        color: state.palette[idx % state.palette.length] || '#10b981',
                        label: t.label,
                        bornAt: performance.now(),
                        ttl: 5500
                    });
                }
            });
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
            const bpTitle = stageEl?.querySelector('[data-swarm-bp-title]');
            if (bpTitle) bpTitle.textContent = title;
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

        // 4. 提取最新生成的最后几行代码用于蓝图流展示与任务派发
        const tailLines = text.slice(-900).split('\n').map(l => l.trim()).filter(Boolean);
        const bpStream = stageEl?.querySelector('[data-swarm-bp-stream]');
        if (bpStream && !state.bodyReady) {
            bpStream.innerHTML = tailLines.slice(-6).map(line => `<div class="dc-swarm-bp-code-line"><span>›</span> ${esc(line.slice(0, 72))}</div>`).join('');
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
            role = 'chart';
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
            const dot = stageEl?.querySelector(`[data-agent-dot="${picked.agent.id}"]`);
            if (dot) {
                dot.classList.add('is-active');
                setTimeout(() => dot.classList.remove('is-active'), 360);
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

    // ── 60FPS 指针群物理运动与炫酷特效绘制循环 ─────────────────
    function assignNextCursorTarget(cursor, now) {
        const w = Math.max(320, state.width);
        const h = Math.max(260, state.height);
        const pad = 36;

        // 优先飞向真实的 iframe DOM 节点！
        if (state.domTargets.length > 0) {
            // 按角色偏好挑选节点，或挑最新生成的末尾节点
            const rolePool = state.domTargets.filter(t => t.kind === cursor.agent.role);
            const pool = rolePool.length ? rolePool : state.domTargets;
            // 偏向于底部/新生成的节点
            const weightedIndex = Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), 0.65) * pool.length));
            const target = pool[weightedIndex];

            const actionRoll = Math.random();
            if (actionRoll < 0.38) {
                // 拖拽拉框动作：从元素左上角拉到右下角
                cursor.mode = 'DRAG_BOX';
                cursor.x = Math.max(pad, Math.min(w - pad, target.x + (Math.random() - 0.5) * 14));
                cursor.y = Math.max(pad, Math.min(h - pad, target.y + (Math.random() - 0.5) * 14));
                cursor.boxStart = { x: target.x, y: target.y };
                cursor.tx = Math.max(pad, Math.min(w - pad, target.x + Math.min(target.w, 320)));
                cursor.ty = Math.max(pad, Math.min(h - pad, target.y + Math.min(target.h, 180)));
                cursor.boxColor = cursor.agent.color;
                cursor.boxLabel = target.label;
                cursor.modeUntil = now + 900 + Math.random() * 650;
                cursor.nextRetargetAt = cursor.modeUntil;
                cursor.node.classList.add('is-clicking');
                spawnRipple(cursor.x, cursor.y, cursor.agent.color, 26);
                return;
            }
            if (actionRoll < 0.65 && (cursor.agent.role === 'chart' || target.kind === 'chart')) {
                // 手绘矢量图形/图表动作
                cursor.mode = 'SKETCH_GRAPHIC';
                cursor.tx = Math.max(pad, Math.min(w - pad, target.x + target.w * (0.2 + Math.random() * 0.6)));
                cursor.ty = Math.max(pad, Math.min(h - pad, target.y + target.h * (0.2 + Math.random() * 0.6)));
                cursor.modeUntil = now + 1100;
                cursor.nextRetargetAt = cursor.modeUntil;
                cursor.node.classList.add('is-sketching');
                return;
            }

            // 涂抹上色 / 测量校准
            cursor.mode = cursor.agent.role === 'qa' || cursor.agent.role === 'layout' ? 'MEASURE_ALIGN' : 'PAINT_SWEEP';
            cursor.tx = Math.max(pad, Math.min(w - pad, target.x + Math.random() * Math.min(target.w, w - target.x - pad)));
            cursor.ty = Math.max(pad, Math.min(h - pad, target.y + Math.random() * Math.min(target.h, h - target.y - pad)));
            cursor.boxStart = { x: target.x, y: target.y, w: target.w, h: target.h };
            cursor.boxLabel = target.label;
            cursor.modeUntil = now + 750 + Math.random() * 600;
            cursor.nextRetargetAt = cursor.modeUntil;
            cursor.node.classList.remove('is-clicking', 'is-sketching');
            if (Math.random() < 0.5) spawnRipple(cursor.tx, cursor.ty, cursor.agent.color, 22);
            return;
        }

        // 蓝图阶段（<body> 尚未大面积成型）：围绕蓝图槽位进行协同绘制与假图表手绘
        const slots = stageEl ? [...stageEl.querySelectorAll('[data-bp-slot]')] : [];
        if (slots.length && viewportEl) {
            const vpRect = viewportEl.getBoundingClientRect();
            const slotEl = slots[cursor.index % slots.length];
            const sr = slotEl.getBoundingClientRect();
            if (sr.width > 20 && sr.height > 20) {
                const rx = sr.left - vpRect.left;
                const ry = sr.top - vpRect.top;
                slotEl.classList.add('is-hot');
                setTimeout(() => slotEl.classList.remove('is-hot'), 520);

                if (cursor.index % 3 === 0) {
                    cursor.mode = 'DRAG_BOX';
                    cursor.boxStart = { x: rx + 6, y: ry + 6 };
                    cursor.tx = Math.max(pad, Math.min(w - pad, rx + sr.width - 12));
                    cursor.ty = Math.max(pad, Math.min(h - pad, ry + sr.height - 12));
                    cursor.boxColor = cursor.agent.color;
                    cursor.boxLabel = `${Math.round(sr.width)} × ${Math.round(sr.height)} px`;
                    cursor.modeUntil = now + 950;
                    cursor.nextRetargetAt = cursor.modeUntil;
                    spawnRipple(rx + 12, ry + 12, cursor.agent.color, 24);

                    // 在主舞台槽位定期生成假矢量图表手绘动画
                    if (slotEl.dataset.bpSlot === '3' && state.sketches.length < 2) {
                        state.sketches.push({
                            key: 'bp-stage-chart',
                            x: rx + 18,
                            y: ry + 34,
                            w: Math.max(120, sr.width - 36),
                            h: Math.max(80, sr.height - 110),
                            kind: Math.random() < 0.5 ? 'spline' : 'bars',
                            color: cursor.agent.color,
                            label: 'AI Vector Synthesizer',
                            bornAt: now,
                            ttl: 4200
                        });
                    }
                    return;
                }

                cursor.mode = 'PAINT_SWEEP';
                cursor.tx = Math.max(pad, Math.min(w - pad, rx + 14 + Math.random() * (sr.width - 28)));
                cursor.ty = Math.max(pad, Math.min(h - pad, ry + 14 + Math.random() * (sr.height - 28)));
                cursor.boxStart = { x: rx, y: ry, w: sr.width, h: sr.height };
                cursor.modeUntil = now + 700 + Math.random() * 500;
                cursor.nextRetargetAt = cursor.modeUntil;
                return;
            }
        }

        // 兜底巡航
        cursor.mode = 'PATROL';
        cursor.tx = pad + Math.random() * (w - pad * 2);
        cursor.ty = pad + Math.random() * (h - pad * 2);
        cursor.nextRetargetAt = now + 800 + Math.random() * 600;
    }

    function spawnRipple(x, y, color, maxR = 28) {
        state.ripples.push({ x, y, r: 3, maxR, color, alpha: 0.9 });
        for (let i = 0; i < 6; i++) {
            const ang = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
            const spd = 1.2 + Math.random() * 2.4;
            state.sparks.push({
                x,
                y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd,
                color,
                alpha: 0.95,
                size: 1.8 + Math.random() * 1.8
            });
        }
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

        // 1. 绘制顶部柔和激光扫描线（仅在绘制进行中显示）
        if (!state.finished || state.replaying) {
            const scanY = ((now * 0.14) % (h + 120)) - 60;
            const scanGrad = fxCtx.createLinearGradient(0, scanY - 36, 0, scanY + 36);
            scanGrad.addColorStop(0, 'rgba(99, 102, 241, 0)');
            scanGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.09)');
            scanGrad.addColorStop(1, 'rgba(236, 72, 153, 0)');
            fxCtx.fillStyle = scanGrad;
            fxCtx.fillRect(0, scanY - 36, w, 72);
        }

        // 2. 绘制假矢量图表/几何图形手绘层（Spline 曲线图 / 柱状矩阵 / 雷达环）
        drawSyntheticSketches(fxCtx, now);

        // 3. 更新并绘制 10 个 AI 指针的物理轨迹、选框与标尺
        const activeCursors = state.cursors;
        for (let i = 0; i < activeCursors.length; i++) {
            const c = activeCursors[i];
            if (now >= c.nextRetargetAt && (!state.finished || state.replaying)) {
                assignNextCursorTarget(c, now);
                if (Math.random() < 0.28) {
                    const mate = activeCursors[(i + 1 + Math.floor(Math.random() * 3)) % activeCursors.length];
                    state.links.push({ a: c, b: mate, color: c.agent.color, bornAt: now, ttl: 950 });
                }
            }

            // 阻尼弹簧 + 弧线微扰动，让鼠标轨迹像真人大师一样丝滑柔顺
            const dx = c.tx - c.x;
            const dy = c.ty - c.y;
            const dist = Math.hypot(dx, dy);
            const spring = 0.085;
            const damping = 0.76;
            const wobbleX = Math.sin(now * 0.006 + c.phaseOffset) * Math.min(1.6, dist * 0.03);
            const wobbleY = Math.cos(now * 0.005 + c.phaseOffset) * Math.min(1.6, dist * 0.03);

            c.vx = (c.vx + dx * spring + wobbleX * 0.15) * damping;
            c.vy = (c.vy + dy * spring + wobbleY * 0.15) * damping;
            c.x += c.vx;
            c.y += c.vy;

            // 防止右侧气泡超出画布右边界
            const tagFlipX = c.x > w - 195;
            const tagFlipY = c.y > h - 56;
            c.node.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0)`;
            const tagEl = c.node.querySelector('.dc-swarm-cursor-tag');
            if (tagEl) {
                tagEl.style.left = tagFlipX ? '-172px' : '16px';
                tagEl.style.top = tagFlipY ? '-26px' : '16px';
            }

            // 记录彗星拖尾
            c.trail.push({ x: c.x + 3, y: c.y + 3, t: now });
            while (c.trail.length > 18 || (c.trail.length && now - c.trail[0].t > 340)) {
                c.trail.shift();
            }

            // 绘制丝滑渐变彗星尾迹
            if (c.trail.length > 2) {
                fxCtx.save();
                fxCtx.beginPath();
                fxCtx.moveTo(c.trail[0].x, c.trail[0].y);
                for (let k = 1; k < c.trail.length - 1; k++) {
                    const xc = (c.trail[k].x + c.trail[k + 1].x) / 2;
                    const yc = (c.trail[k].y + c.trail[k + 1].y) / 2;
                    fxCtx.quadraticCurveTo(c.trail[k].x, c.trail[k].y, xc, yc);
                }
                const lastPt = c.trail[c.trail.length - 1];
                fxCtx.lineTo(lastPt.x, lastPt.y);
                fxCtx.strokeStyle = c.agent.color;
                fxCtx.lineWidth = 2.4;
                fxCtx.lineCap = 'round';
                fxCtx.globalAlpha = 0.42;
                fxCtx.shadowColor = c.agent.color;
                fxCtx.shadowBlur = 8;
                fxCtx.stroke();
                fxCtx.restore();
            }

            // 绘制当前指针正在执行的动作（拉框 / 标尺 / 涂抹高亮）
            if (c.mode === 'DRAG_BOX' && c.boxStart && now < c.modeUntil) {
                drawDragMarquee(fxCtx, c.boxStart.x, c.boxStart.y, c.x, c.y, c.agent.color, c.boxLabel);
            } else if (c.mode === 'MEASURE_ALIGN' && c.boxStart && now < c.modeUntil) {
                drawMeasureGuides(fxCtx, c.x, c.y, c.boxStart, c.agent.color);
            } else if (c.mode === 'PAINT_SWEEP' && c.boxStart && now < c.modeUntil) {
                drawPaintHighlight(fxCtx, c.boxStart, c.x, c.y, c.agent.color);
            }
        }

        // 4. 绘制双指针协同同步激光连线
        for (let i = state.links.length - 1; i >= 0; i--) {
            const link = state.links[i];
            const age = now - link.bornAt;
            if (age > link.ttl) {
                state.links.splice(i, 1);
                continue;
            }
            const alpha = (1 - age / link.ttl) * 0.48;
            const prog = age / link.ttl;
            fxCtx.save();
            fxCtx.beginPath();
            const mx = (link.a.x + link.b.x) / 2;
            const my = (link.a.y + link.b.y) / 2 - 28;
            fxCtx.moveTo(link.a.x + 4, link.a.y + 4);
            fxCtx.quadraticCurveTo(mx, my, link.b.x + 4, link.b.y + 4);
            fxCtx.strokeStyle = link.color;
            fxCtx.globalAlpha = alpha;
            fxCtx.setLineDash([4, 4]);
            fxCtx.lineWidth = 1.3;
            fxCtx.stroke();

            // 沿连线飞行的能量脉冲光点
            const t = prog;
            const px = (1 - t) * (1 - t) * link.a.x + 2 * (1 - t) * t * mx + t * t * link.b.x;
            const py = (1 - t) * (1 - t) * link.a.y + 2 * (1 - t) * t * my + t * t * link.b.y;
            fxCtx.fillStyle = '#ffffff';
            fxCtx.shadowColor = link.color;
            fxCtx.shadowBlur = 10;
            fxCtx.beginPath();
            fxCtx.arc(px, py, 3, 0, Math.PI * 2);
            fxCtx.fill();
            fxCtx.restore();
        }

        // 5. 绘制点击冲击波与火花粒子
        for (let i = state.ripples.length - 1; i >= 0; i--) {
            const rp = state.ripples[i];
            rp.r += (rp.maxR - rp.r) * 0.14 + 0.6;
            rp.alpha *= 0.91;
            if (rp.alpha < 0.04) {
                state.ripples.splice(i, 1);
                continue;
            }
            fxCtx.save();
            fxCtx.beginPath();
            fxCtx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
            fxCtx.strokeStyle = rp.color;
            fxCtx.globalAlpha = rp.alpha;
            fxCtx.lineWidth = 1.6;
            fxCtx.stroke();
            fxCtx.restore();
        }

        for (let i = state.sparks.length - 1; i >= 0; i--) {
            const sp = state.sparks[i];
            sp.x += sp.vx;
            sp.y += sp.vy;
            sp.vx *= 0.94;
            sp.vy *= 0.94;
            sp.alpha *= 0.9;
            if (sp.alpha < 0.05) {
                state.sparks.splice(i, 1);
                continue;
            }
            fxCtx.save();
            fxCtx.fillStyle = sp.color;
            fxCtx.globalAlpha = sp.alpha;
            fxCtx.beginPath();
            fxCtx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
            fxCtx.fill();
            fxCtx.restore();
        }

        fxCtx.restore();
    }

    // 绘制拖拽选框（带四角控制点与实时像素尺寸标签）
    function drawDragMarquee(ctx, x1, y1, x2, y2, color, label) {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const width = Math.max(16, Math.abs(x2 - x1));
        const height = Math.max(14, Math.abs(y2 - y1));

        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.06;
        ctx.fillRect(left, top, width, height);

        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(left, top, width, height);
        ctx.setLineDash([]);

        // 四角小方块控制柄
        const corners = [
            [left, top],
            [left + width, top],
            [left, top + height],
            [left + width, top + height]
        ];
        ctx.fillStyle = '#ffffff';
        for (const [cx, cy] of corners) {
            ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
            ctx.strokeRect(cx - 2.5, cy - 2.5, 5, 5);
        }

        // 尺寸标注胶囊
        const dimText = label ? `${label.slice(0, 22)} · ${Math.round(width)}×${Math.round(height)}` : `${Math.round(width)} × ${Math.round(height)} px`;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        const tw = ctx.measureText(dimText).width + 10;
        const pillX = Math.min(state.width - tw - 6, Math.max(4, left));
        const pillY = top > 22 ? top - 18 : top + height + 4;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.88;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, tw, 15, 4);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 1;
        ctx.fillText(dimText, pillX + 5, pillY + 10.5);
        ctx.restore();
    }

    // 绘制 CAD / Figma 风格对齐标尺线
    function drawMeasureGuides(ctx, cx, cy, box, color) {
        if (!box || !box.w) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);

        // 十字基准线
        ctx.beginPath();
        ctx.moveTo(box.x, cy);
        ctx.lineTo(box.x + box.w, cy);
        ctx.moveTo(cx, box.y);
        ctx.lineTo(cx, box.y + box.h);
        ctx.stroke();
        ctx.restore();
    }

    // 绘制元素着色扫描高光框
    function drawPaintHighlight(ctx, box, cx, cy, color) {
        if (!box || !box.w) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(box.x, box.y, box.w, box.h);

        const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 48);
        grad.addColorStop(0, color);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.restore();
    }

    // 绘制假的高难度矢量图表（Spline 动态曲线图、柱状能量图、雷达仪表盘）
    function drawSyntheticSketches(ctx, now) {
        for (let i = state.sketches.length - 1; i >= 0; i--) {
            const sk = state.sketches[i];
            const age = now - sk.bornAt;
            if (age > sk.ttl) {
                state.sketches.splice(i, 1);
                continue;
            }
            const progress = Math.min(1, age / 1400);
            const fadeOut = age > sk.ttl - 900 ? Math.max(0, (sk.ttl - age) / 900) : 1;
            const alpha = fadeOut * 0.78;

            ctx.save();
            ctx.globalAlpha = alpha;

            if (sk.kind === 'spline') {
                // 贝塞尔平滑面积图 + 控制点手柄
                const pts = 7;
                const coords = [];
                for (let k = 0; k < pts; k++) {
                    const px = sk.x + (sk.w * k) / (pts - 1);
                    const wave = Math.sin(k * 1.15 + now * 0.003) * 0.32 + 0.5;
                    const py = sk.y + sk.h * (0.18 + wave * 0.64);
                    coords.push({ x: px, y: py });
                }
                const visibleCount = Math.max(2, Math.ceil(coords.length * progress));
                ctx.beginPath();
                ctx.moveTo(coords[0].x, coords[0].y);
                for (let k = 1; k < visibleCount; k++) {
                    const prev = coords[k - 1];
                    const cur = coords[k];
                    const mx = (prev.x + cur.x) / 2;
                    ctx.bezierCurveTo(mx, prev.y, mx, cur.y, cur.x, cur.y);
                }
                ctx.strokeStyle = sk.color;
                ctx.lineWidth = 2.2;
                ctx.shadowColor = sk.color;
                ctx.shadowBlur = 10;
                ctx.stroke();

                // 绘制数据节点圆环
                for (let k = 0; k < visibleCount; k++) {
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(coords[k].x, coords[k].y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else if (sk.kind === 'bars') {
                // 动态生长柱状矩阵
                const count = 8;
                const gap = 6;
                const barW = Math.max(6, (sk.w - gap * (count - 1)) / count);
                for (let k = 0; k < count; k++) {
                    if (k / count > progress) break;
                    const ratio = (0.3 + 0.65 * Math.abs(Math.sin(k * 0.9 + now * 0.0025))) * Math.min(1, (progress - k / count) * 3);
                    const bh = sk.h * ratio;
                    const bx = sk.x + k * (barW + gap);
                    const by = sk.y + sk.h - bh;
                    ctx.fillStyle = sk.color;
                    ctx.globalAlpha = alpha * 0.55;
                    ctx.beginPath();
                    ctx.roundRect(bx, by, barW, bh, 3);
                    ctx.fill();
                }
            } else {
                // 科幻雷达圆环仪表
                const cx = sk.x + sk.w / 2;
                const cy = sk.y + sk.h / 2;
                const r = Math.min(sk.w, sk.h) * 0.38;
                ctx.strokeStyle = sk.color;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress * 0.88);
                ctx.stroke();

                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.arc(cx, cy, r * 0.68, now * 0.002, now * 0.002 + Math.PI * 1.4);
                ctx.stroke();
            }

            ctx.restore();
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
        state.active = true;
        state.streaming = true;
        state.finished = false;
        state.replaying = false;
        state.cursorsHidden = false;
        state.showSource = false;
        state.startedAt = performance.now();
        state.htmlCode = '';
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
        state.sketches = [];
        state.ripples = [];
        state.sparks = [];
        state.links = [];

        if (!openBrowserStage()) return;

        stageEl.classList.remove('is-finished', 'is-cursors-hidden');
        blueprintEl?.classList.remove('is-faded');
        if (codeViewEl) codeViewEl.hidden = true;
        const cursorsBtn = stageEl.querySelector('[data-swarm-action="cursors"]');
        cursorsBtn?.setAttribute('aria-pressed', 'true');
        const sourceBtn = stageEl.querySelector('[data-swarm-action="source"]');
        sourceBtn?.setAttribute('aria-pressed', 'false');

        if (livePillTextEl) livePillTextEl.textContent = L('10 AI 协同绘制中', '10 AI Agents Painting');
        if (tickerEl) tickerEl.textContent = L('正在构建全息蓝图与响应式栅格…', 'Scaffolding holographic blueprint & grid…');
        updateBrowserChromeTitle(state.pageTitle || L('AI实时协同画布', 'ai-swarm-canvas'));

        ensureLiveIframe();
        state.cursors.forEach((c, idx) => {
            c.taskNode.textContent = L(c.agent.defaultTaskZh, c.agent.defaultTaskEn);
            c.nextRetargetAt = performance.now() + idx * 90;
        });
        updateMetricsUi();
    }

    function onStreamDelta(fullStreamText, { prompt = '' } = {}) {
        const extracted = extractStreamingHtml(fullStreamText);
        if (!extracted.found) return false;

        if (!state.active || state.finished) {
            startSession({ prompt, title: extracted.title });
        }

        state.htmlCode = extracted.code;
        analyzeStreamTokens(extracted.code);

        if (state.showSource && codeViewEl) {
            const codeEl = codeViewEl.querySelector('code');
            if (codeEl) codeEl.textContent = state.htmlCode;
        }

        const now = performance.now();
        if (now - state.lastRenderAt >= 130) {
            state.lastRenderAt = now;
            updateIncrementalIframe(state.htmlCode, false);
        } else if (!state.renderTimer) {
            state.renderTimer = setTimeout(() => {
                state.renderTimer = null;
                state.lastRenderAt = performance.now();
                updateIncrementalIframe(state.htmlCode, false);
            }, 130);
        }
        return true;
    }

    function onStreamFinish(finalText = '', { prompt = '' } = {}) {
        if (state.renderTimer) {
            clearTimeout(state.renderTimer);
            state.renderTimer = null;
        }
        const extracted = extractStreamingHtml(finalText);
        if (!extracted.found && !state.htmlCode) {
            // 如果预触发了但最终回答里根本没有 HTML 代码，自动收起舞台
            if (state.active && !state.lineCount) deactivate();
            return false;
        }

        if (extracted.found) {
            if (!state.active) startSession({ prompt, title: extracted.title });
            state.htmlCode = extracted.code;
            analyzeStreamTokens(extracted.code);
        }

        state.streaming = false;
        state.finished = true;
        updateIncrementalIframe(state.htmlCode, true);
        if (state.showSource && codeViewEl) {
            const codeEl = codeViewEl.querySelector('code');
            if (codeEl) codeEl.textContent = state.htmlCode;
        }
        updateMetricsUi();

        if (stageEl) stageEl.classList.add('is-finished');
        if (livePillTextEl) livePillTextEl.textContent = L('10 AI 协同绘制完成', '10 AI Swarm Complete');
        if (tickerEl) tickerEl.innerHTML = `<strong>✓</strong> ${esc(L('页面渲染与交互脚本已就绪，可直接点击体验或重播绘制', 'Page & scripts ready — interact directly or replay'))}`;

        // 庆祝花火：所有指针在最后 2.4 秒做一次终检巡礼，随后自动淡出让用户无遮挡交互
        state.cursors.forEach(c => {
            spawnRipple(c.x, c.y, c.agent.color, 36);
            c.taskNode.textContent = L('✓ 绘制校验完成', '✓ Verified & Polished');
        });
        clearTimeout(state.fadeTimer);
        state.fadeTimer = setTimeout(() => {
            if (state.active && state.finished && !state.replaying) {
                toggleCursors(true);
            }
        }, 2600);
        return true;
    }

    // 用于工作区 write_file / edit_file 生成完 HTML 文件、或点击「重播绘制」时的高速流式仿真演练
    function playFullHtml(htmlContent, { title = '' } = {}) {
        const code = String(htmlContent || '').trim();
        if (!code) return;
        startSession({ title: title || extractTitle(code) });
        state.replaying = true;

        const totalLen = code.length;
        const steps = 28;
        let step = 0;
        const stepMs = 110;

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
                onStreamFinish('```html\n' + code + '\n```');
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
        if (!stageEl) return;
        stageEl.classList.toggle('is-cursors-hidden', state.cursorsHidden);
        const btn = stageEl.querySelector('[data-swarm-action="cursors"]');
        btn?.setAttribute('aria-pressed', String(!state.cursorsHidden));
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
        if (!state.htmlCode) return;
        const blob = new Blob([state.htmlCode], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
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
        if (state.renderTimer) {
            clearTimeout(state.renderTimer);
            state.renderTimer = null;
        }
        state.active = false;
        state.streaming = false;
        state.replaying = false;
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
        btn.innerHTML = `<span>✨</span><span>${esc(L('右侧浏览器 AI 指针群协同绘制预览', 'AI Cursor Swarm Live Preview in Browser'))}</span>`;
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
        deactivate,
        decorateMessageHtmlBlocks,
        isActive: () => state.active
    };
})();
