const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');

test('DragonHtmlSwarm detects HTML generation prompts and extracts streaming HTML fences', () => {
    const code = fs.readFileSync(path.join(rootDir, 'frontend/js/home/html-swarm-canvas.js'), 'utf8');
    const context = vm.createContext({
        window: {
            innerWidth: 1440,
            devicePixelRatio: 2,
            addEventListener() {},
            matchMedia: () => ({ matches: false, addEventListener() {} })
        },
        document: {
            documentElement: { lang: 'zh-CN', getAttribute: () => 'zh-CN' },
            getElementById: () => null,
            createElement: () => ({
                style: {},
                classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                addEventListener() {},
                querySelector: () => null,
                querySelectorAll: () => [],
                setAttribute() {}
            })
        },
        localStorage: { getItem: () => 'zh-CN' },
        performance: { now: () => 1000 },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
        Blob,
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} }
    });
    context.window.window = context.window;
    context.window.document = context.document;
    vm.runInContext(code, context);

    const swarm = context.window.DragonHtmlSwarm;
    assert.ok(swarm, 'DragonHtmlSwarm should be exposed on window');

    // Prompt detection
    assert.equal(swarm.isHtmlGenerationPrompt('帮我生成一个赛博朋克风格的html登录页面'), true);
    assert.equal(swarm.isHtmlGenerationPrompt('写一个数据大屏网页看板'), true);
    assert.equal(swarm.isHtmlGenerationPrompt('Create a landing page in HTML'), true);
    assert.equal(swarm.isHtmlGenerationPrompt('今天天气怎么样？'), false);

    // Streaming HTML extraction (unclosed fence during streaming)
    const partialStream = '好的，为您生成页面：\n```html\n<!DOCTYPE html>\n<html><head><title>星际控制台</title><style>body{background:#0f172a;}</style></head><body><h1>Hello Swarm</h1>';
    const extracted1 = swarm.extractStreamingHtml(partialStream);
    assert.equal(extracted1.found, true);
    assert.equal(extracted1.complete, false);
    assert.equal(extracted1.title, '星际控制台');
    assert.match(extracted1.code, /<h1>Hello Swarm<\/h1>/);

    // Closed HTML fence
    const fullStream = `${partialStream}</body></html>\n\`\`\`\n希望你喜欢！`;
    const extracted2 = swarm.extractStreamingHtml(fullStream);
    assert.equal(extracted2.found, true);
    assert.equal(extracted2.complete, true);
    assert.equal(extracted2.title, '星际控制台');
    assert.doesNotMatch(extracted2.code, /希望你喜欢/);
});

test('index.html, browser-sidebar.js and dragon-claw.js wire DragonHtmlSwarm only for normal chat', () => {
    const indexHtml = fs.readFileSync(path.join(rootDir, 'frontend/index.html'), 'utf8');
    const sidebarJs = fs.readFileSync(path.join(rootDir, 'frontend/js/home/browser-sidebar.js'), 'utf8');
    const clawJs = fs.readFileSync(path.join(rootDir, 'frontend/js/home/dragon-claw.js'), 'utf8');
    const swarmCss = fs.readFileSync(path.join(rootDir, 'frontend/css/html-swarm-canvas.css'), 'utf8');

    assert.match(indexHtml, /\/css\/html-swarm-canvas\.css/);
    assert.match(indexHtml, /\/js\/home\/html-swarm-canvas\.js/);
    assert.match(sidebarJs, /is-swarm-canvas/);
    assert.match(sidebarJs, /liveCanvas/);
    assert.match(clawJs, /const isNormalChat = !external\.active && !homeConnector;/);
    assert.match(clawJs, /window\.DragonHtmlSwarm\?\.onStreamDelta/);
    assert.match(clawJs, /window\.DragonHtmlSwarm\?\.onStreamFinish/);
    assert.match(swarmCss, /\.dc-swarm-cursor/);
});

test('html-swarm-canvas uses paced smooth reveal and real wireframe drafting without synthetic curves', () => {
    const swarmJs = fs.readFileSync(path.join(rootDir, 'frontend/js/home/html-swarm-canvas.js'), 'utf8');

    // 严禁包含虚构正弦波动图/雷达环
    assert.doesNotMatch(swarmJs, /drawSyntheticSketches/);
    assert.doesNotMatch(swarmJs, /'spline'/);
    assert.doesNotMatch(swarmJs, /'radar'/);

    // 必须包含真实的组件骨架线框测绘与平滑渐进推进引擎
    assert.match(swarmJs, /drawWireframeDrafts/);
    assert.match(swarmJs, /stepPacedReveal/);
    assert.match(swarmJs, /streamTargetCode/);
    assert.match(swarmJs, /revealedCode/);
});

test('swarm palettes stay small: three tones per page mode, a handful of sets, one picked per drawing', () => {
    const swarmJs = fs.readFileSync(path.join(rootDir, 'frontend/js/home/html-swarm-canvas.js'), 'utf8');
    const context = vm.createContext({
        window: {}, document: {}, localStorage: { getItem: () => 'zh-CN' },
        performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout
    });
    context.window.window = context.window;
    vm.runInContext(swarmJs, context);
    const palettes = context.window.DragonHtmlSwarm.palettes;

    assert.ok(palettes.length >= 3 && palettes.length <= 6, 'a few curated sets, not a rainbow');
    for (const palette of palettes) {
        for (const tones of [palette.dark, palette.light]) {
            assert.equal(tones.length, 3, `${palette.id} uses exactly three tones`);
            tones.forEach(tone => assert.match(tone, /^#[0-9A-Fa-f]{6}$/));
        }
    }
    // Pantone 2026 年度色 Cloud Dancer 作为深色页面上的中性色
    assert.ok(palettes.some(palette => palette.dark.includes('#F0EEE9')));
    // 指针不再各自写死颜色，也不再有十种高饱和色
    assert.doesNotMatch(swarmJs, /glow:\s*'rgba/);
    assert.match(swarmJs, /pickPalette\(\)/);
    assert.match(swarmJs, /minJerk/);
});

test('sidebar resize handle sits above the swarm stage so the whole left edge is draggable', () => {
    const sidebarCss = fs.readFileSync(path.join(rootDir, 'frontend/css/browser-sidebar.css'), 'utf8');
    const swarmCss = fs.readFileSync(path.join(rootDir, 'frontend/css/html-swarm-canvas.css'), 'utf8');
    const handleZ = Number(/\.dc-sidebar-resize\{[^}]*z-index:(\d+)/.exec(sidebarCss)[1]);
    const stageZ = Number(/\.dc-swarm-stage \{[^}]*z-index: (\d+)/.exec(swarmCss)[1]);
    assert.ok(handleZ > stageZ, `handle z-index ${handleZ} must exceed stage z-index ${stageZ}`);
});

test('swarm stage eliminates fake placeholder cards and activates cursors only on real DOM tree mount', () => {
    const swarmJs = fs.readFileSync(path.join(rootDir, 'frontend/js/home/html-swarm-canvas.js'), 'utf8');
    const swarmCss = fs.readFileSync(path.join(rootDir, 'frontend/css/html-swarm-canvas.css'), 'utf8');

    // 严禁包含编造的假结构卡片与假槽位
    assert.doesNotMatch(swarmJs, /data-bp-slot/);
    assert.doesNotMatch(swarmJs, /hero-metric/);
    assert.doesNotMatch(swarmJs, /glass-card/);
    assert.doesNotMatch(swarmJs, /visual-chart/);
    assert.doesNotMatch(swarmJs, /interactive-viewport/);
    assert.doesNotMatch(swarmCss, /\.dc-swarm-bp-grid/);
    assert.doesNotMatch(swarmCss, /\.dc-swarm-bp-card/);

    // 必须仅在真实 DOM 框架挂载后才开启绘制计划并对准真实 DOM 元素
    assert.match(swarmJs, /onRealDomReady/);
    assert.match(swarmJs, /planningAllowed\s*=\s*\(\)\s*=>\s*state\.bodyReady/);
    assert.match(swarmJs, /\.dc-swarm-scaffold/);
    assert.match(swarmCss, /\.dc-swarm-scaffold/);
    assert.match(swarmCss, /\.dc-swarm-scaffold-card/);
});

test('swarm canvas supports Figma multi-tool cursors, rulers, spacing redlines, and safe audio toggle', () => {
    const swarmJs = fs.readFileSync(path.join(rootDir, 'frontend/js/home/html-swarm-canvas.js'), 'utf8');
    const swarmCss = fs.readFileSync(path.join(rootDir, 'frontend/css/html-swarm-canvas.css'), 'utf8');

    // 多工具光标形态切换（CSS + DOM data-tool + JS setTool）
    for (const tool of ['arrow', 'crosshair', 'ibeam', 'pen']) {
        assert.match(swarmCss, new RegExp(`data-tool="${tool}"`), `CSS handles ${tool} cursor`);
        assert.match(swarmCss, new RegExp(`\\.dc-swarm-cursor-svg--${tool}`), `CSS styles ${tool} SVG`);
        assert.match(swarmJs, new RegExp(`dc-swarm-cursor-svg--${tool}`), `JS builds ${tool} SVG`);
    }
    assert.match(swarmJs, /function setTool\(/);

    // Figma 标尺、间距红线、I-beam 输入与钢笔矢量工具，且清理已移除的 markSlotHot 死调用
    assert.match(swarmJs, /function drawRulers\(/);
    assert.match(swarmJs, /function drawSpacingGuides\(/);
    assert.match(swarmJs, /function drawTypingEffect\(/);
    assert.match(swarmJs, /function drawPenDraft\(/);
    assert.match(swarmJs, /data-swarm-action="sound"/);
    assert.doesNotMatch(swarmJs, /markSlotHot\(/);

    // 沙箱运行时校验：computeGuidesForBox 邻近间距/对齐计算，以及无 AudioContext 下 toggleSound 安全性
    const store = { tools_lang: 'zh-CN' };
    const context = vm.createContext({
        window: {
            innerWidth: 1440,
            devicePixelRatio: 2,
            addEventListener() {},
            matchMedia: () => ({ matches: false, addEventListener() {} })
        },
        document: {
            documentElement: { lang: 'zh-CN', getAttribute: () => 'zh-CN' },
            getElementById: () => null,
            createElement: () => ({
                style: {},
                classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                addEventListener() {},
                querySelector: () => null,
                querySelectorAll: () => [],
                setAttribute() {}
            })
        },
        localStorage: {
            getItem: key => store[key] || null,
            setItem: (key, val) => { store[key] = String(val); }
        },
        performance: { now: () => 1000 },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
        Blob,
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} }
    });
    context.window.window = context.window;
    context.window.document = context.document;
    vm.runInContext(swarmJs, context);

    const swarm = context.window.DragonHtmlSwarm;
    const guides = swarm.computeGuidesForBox(
        { x: 100, y: 100, w: 120, h: 80 },
        [
            { x: 80, y: 80, w: 400, h: 300 },   // 外层父容器应被跳过
            { x: 244, y: 100, w: 120, h: 80 },  // 右侧相距 24px 且上下边缘对齐
            { x: 100, y: 200, w: 120, h: 60 }   // 下方相距 20px 且左右边缘对齐
        ]
    );
    assert.deepEqual(Array.from(guides.gaps, g => g.dist), [20, 24]);
    assert.ok(guides.aligns.length >= 2, 'detects aligned edges between siblings');

    assert.equal(swarm.toggleSound(true), true);
    assert.equal(store.dc_swarm_sound, '1');
    assert.equal(swarm.toggleSound(false), false);
    assert.equal(store.dc_swarm_sound, '0');
});

test('auto collapses HTML preview cards when right side swarm browser opens and workspace-panel respects it', () => {
    const workspaceJs = fs.readFileSync(path.join(__dirname, '../frontend/js/home/workspace-panel.js'), 'utf8');
    const swarmJs = fs.readFileSync(path.join(__dirname, '../frontend/js/home/html-swarm-canvas.js'), 'utf8');

    assert.ok(swarmJs.includes('collapseAutoOpenedHtmlCards'), 'swarm canvas implements collapseAutoOpenedHtmlCards');
    assert.ok(swarmJs.includes('isSwarmBrowserOpen'), 'swarm canvas implements isSwarmBrowserOpen');
    assert.ok(workspaceJs.includes('isSwarmBrowserActive'), 'workspace-panel implements isSwarmBrowserActive');
    assert.ok(workspaceJs.includes('suppressAutoPreview'), 'workspace-panel suppresses auto preview for html files when swarm active');
    assert.ok(workspaceJs.includes('userOpened'), 'workspace-panel tracks manual user clicks with userOpened');
    assert.ok(workspaceJs.includes('DragonHtmlSwarm.playFullHtml'), 'workspace-panel feeds loaded HTML file content into DragonHtmlSwarm');

    const dragonClawJs = fs.readFileSync(path.join(__dirname, '../frontend/js/home/dragon-claw.js'), 'utf8');
    assert.ok(dragonClawJs.includes('!swarmHtmlTools.size'), 'dragon-claw avoids premature finish when html tools are active');
});

test('swarm canvas implements progressive blur/mosaic veil reveal and coordinated completion audio', () => {
    const swarmJs = fs.readFileSync(path.join(rootDir, 'frontend/js/home/html-swarm-canvas.js'), 'utf8');

    // 1. 渐进显影 CSS 约束：hidden 状态禁止 transition（避免挂载首帧闪烁），painting -> revealed 具备丝滑模糊消融过渡
    assert.match(swarmJs, /\[data-sw="hidden"\]\s*\{[^}]*opacity:\s*0\s*!important[^}]*filter:\s*blur\(18px\)/);
    assert.match(swarmJs, /\[data-sw="painting"\]\s*\{[^}]*filter:\s*blur\(8px\)/);
    assert.match(swarmJs, /\[data-sw="revealed"\]\s*\{[^}]*opacity:\s*1\s*!important[^}]*filter:\s*blur\(0px\)/);

    // 2. 马赛克消融遮罩、祖先提升不变量、优先调度未绘制目标以及收尾交错清扫
    for (const sym of [
        'function spawnMosaicVeil(',
        'function dissolveMosaicVeil(',
        'function drawMosaicVeils(',
        'function setTargetPaintStatus(',
        'function revealTargetAndChildren(',
        'function applyInitialMasks(',
        'function sweepRemainingTargets(',
        'function isTargetUnpainted(',
        'function hasAnyUnpaintedTargets('
    ]) {
        assert.ok(swarmJs.includes(sym), `missing ${sym}`);
    }
    assert.match(swarmJs, /applyInitialMasks\(doc\)/);
    assert.match(swarmJs, /drawMosaicVeils\(fxCtx,\s*now\)/);

    // 3. 与显影进度及全页完成同步的多声部音频设计（局部消融音 + 双阶段和弦尾奏）
    for (const sym of ['getRevealProgress', 'playGlassNote', 'playReveal:', 'playFinish:']) {
        assert.ok(swarmJs.includes(sym), `missing audio capability ${sym}`);
    }
    assert.match(swarmJs, /SwarmAudio\.playFinish\(swapDelay\s*\/\s*1000\)/);

    // 4. 沙箱 Web Audio 行为验证：静音不创建上下文，开启音频后能安全合成琉璃揭示音
    let ctxCreated = 0;
    let oscStarted = 0;
    const makeParam = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    const makeNode = () => ({ connect() {}, start() { oscStarted += 1; }, stop() {}, gain: makeParam(), frequency: makeParam(), Q: makeParam(), threshold: makeParam(), knee: makeParam(), ratio: makeParam(), attack: makeParam(), release: makeParam(), pan: makeParam(), type: 'sine' });
    class FakeAudioContext {
        constructor() { ctxCreated += 1; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
        createGain() { return makeNode(); }
        createOscillator() { return makeNode(); }
        createBiquadFilter() { return makeNode(); }
        createStereoPanner() { return makeNode(); }
        createDynamicsCompressor() { return makeNode(); }
        resume() { return Promise.resolve(); }
    }
    const store = { tools_lang: 'zh-CN' };
    const context = vm.createContext({
        window: {
            innerWidth: 1440,
            devicePixelRatio: 2,
            AudioContext: FakeAudioContext,
            addEventListener() {},
            matchMedia: () => ({ matches: false, addEventListener() {} })
        },
        document: {
            documentElement: { lang: 'zh-CN', getAttribute: () => 'zh-CN' },
            getElementById: () => null,
            createElement: () => ({
                style: {},
                classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                addEventListener() {},
                querySelector: () => null,
                querySelectorAll: () => [],
                setAttribute() {}
            })
        },
        localStorage: {
            getItem: key => store[key] || null,
            setItem: (key, val) => { store[key] = String(val); }
        },
        performance: { now: () => 1000 },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
        Blob,
        URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} }
    });
    context.window.window = context.window;
    context.window.document = context.document;
    vm.runInContext(swarmJs, context);

    const swarm = context.window.DragonHtmlSwarm;
    assert.equal(ctxCreated, 0, 'default muted session must not initialize AudioContext');
    assert.equal(swarm.toggleSound(true), true);
    assert.equal(ctxCreated, 1, 'enabling sound initializes AudioContext');
    assert.ok(oscStarted >= 2, 'enabling sound triggers layered glass reveal chime');
    const countAfterEnable = oscStarted;
    assert.equal(swarm.toggleSound(false), false);
    assert.equal(oscStarted, countAfterEnable, 'disabling sound produces no extra oscillators');
});
