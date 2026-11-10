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
