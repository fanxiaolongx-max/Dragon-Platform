const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relPath => fs.readFileSync(path.join(root, relPath), 'utf8');

function loadMarkdownRenderer() {
    const source = read('frontend/js/shared/ai-assistant.js');
    const escape = source.match(/function escapeHtml\(text\) \{[\s\S]*?\n {4}\}/)[0];
    const render = source.match(/function renderMarkdownLike\(text\) \{[\s\S]*?\n {8}return blocks\.join\(''\);\n {4}\}/)[0];
    return new Function(`${escape}\n${render}\nreturn renderMarkdownLike;`)();
}

test('assistant markdown renders safe links only', () => {
    const render = loadMarkdownRenderer();
    const html = render('打开 [会议考勤](/tools/tool-msf5b7nn)、[官网](https://example.com)、[坏](javascript:alert(1))、[跨站](//evil.com) 与 `[x](/y)`');
    assert.match(html, /<a class="ai-md-link" href="\/tools\/tool-msf5b7nn">会议考勤<\/a>/);
    assert.match(html, /<a class="ai-md-link" href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">官网<\/a>/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.doesNotMatch(html, /href="\/\/evil\.com"/);
    assert.match(html, /<code>\[x\]\(\/y\)<\/code>/);
    assert.doesNotMatch(render('[<img src=x onerror=alert(1)>](/a)'), /<img/);
});

test('assistant exposes rendering and streaming helpers for the home agent', () => {
    const source = read('frontend/js/shared/ai-assistant.js');
    const exportBlock = source.slice(source.indexOf('window.ToolsAIAssistant = {'));
    ['renderMarkdown: renderMarkdownLike', 'renderGrounding', 'requestStreamingChat', 'openKnowledgeGraph'].forEach(name => {
        assert.ok(exportBlock.includes(name), `${name} is exported`);
    });
});

test('chat route switches to an all-round persona for the home agent only', () => {
    const source = read('backend/routes/ai.js');
    assert.match(source, /const homeAgent = agent === 'dragon-claw-home';/);
    assert.match(source, /scopeRule = homeAgent\s*\?\s*`8\. 不要声称自己只专注于本平台/);
    // 页面内悬浮助手保持原有的平台范围约束
    assert.match(source, /: `8\. 如果用户的提问超出系统功能范畴，礼貌说明你专注于本工具中台。`/);
    assert.match(source, /\$\{scopeRule\}\n\$\{aiSettings\.systemPrompt/);
});

test('home page hosts Dragon Claw above the tool grid and wires it to the agent mode', () => {
    const html = read('frontend/index.html');
    const agent = read('frontend/js/home/dragon-claw.js');
    assert.match(html, /<section class="dc" id="dragonClaw"/);
    assert.ok(html.indexOf('id="dragonClaw"') < html.indexOf('id="toolsGrid"'));
    ['dcThread', 'dcComposer', 'dcInput', 'dcSpotlight', 'dcPrompts', 'dcNewChat', 'dcBackToTools', 'homeKnowledgeGraphEntry', 'homeF12QuickDownloads']
        .forEach(id => assert.match(html, new RegExp(`id="${id}"`), `${id} exists`));
    assert.match(html, /href="\/css\/dragon-claw\.css"/);
    assert.ok(html.indexOf('src="/js/home/workspace.js"') < html.indexOf('src="/js/home/dragon-claw.js"'));
    assert.match(agent, /agent: 'dragon-claw-home'/);
    assert.match(agent, /requestStreamingChat/);
});

test('navbar version badge shows the platform release instead of asset hashes', () => {
    const navbar = read('frontend/js/shared/navbar.js');
    const block = navbar.slice(navbar.indexOf("getElementById('nav-resource-version-display')"), navbar.indexOf('renderNavLinksFromState();', navbar.indexOf("getElementById('nav-resource-version-display')")));
    assert.match(block, /ToolsAppVersion\?\.get|\/api\/app-version/);
    assert.doesNotMatch(block, /v1\.1\.0|\?v=/);
});

test('dragon-claw styles grounding basis chips for dark theme and prevents light hover wash out', () => {
    const css = read('frontend/css/dragon-claw.css');
    assert.match(css, /\.dc-msg\s+\.ai-grounding/);
    assert.match(css, /\.dc-msg\s+button\.ai-grounding-item:hover,\s*\.dc-msg\s+\.ai-grounding-graph:hover/);
    assert.match(css, /\.dc-msg\s+button\.ai-grounding-item:hover[\s\S]*?background:\s*rgba\(100,\s*255,\s*218,/);
    assert.match(css, /\.dc-msg\s+\.ai-grounding-graph\.metric-reference/);
});

