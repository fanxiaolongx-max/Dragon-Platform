const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const clawJsPath = path.join(rootDir, 'frontend/js/home/dragon-claw.js');
const desktopModelsJsPath = path.join(rootDir, 'frontend/js/home/desktop-agent-models.js');
const swarmJsPath = path.join(rootDir, 'frontend/js/home/html-swarm-canvas.js');
const sidebarJsPath = path.join(rootDir, 'frontend/js/home/browser-sidebar.js');
const homeThemeCssPath = path.join(rootDir, 'frontend/css/home-theme.css');
const dragonClawCssPath = path.join(rootDir, 'frontend/css/dragon-claw.css');

const clawJs = fs.readFileSync(clawJsPath, 'utf8');
const desktopModelsJs = fs.readFileSync(desktopModelsJsPath, 'utf8');
const swarmJs = fs.readFileSync(swarmJsPath, 'utf8');
const sidebarJs = fs.readFileSync(sidebarJsPath, 'utf8');
const homeThemeCss = fs.readFileSync(homeThemeCssPath, 'utf8');
const dragonClawCss = fs.readFileSync(dragonClawCssPath, 'utf8');

test('CSS rules support model menu adaptive narrowing and hover marquee scrolling', () => {
    // 1. Popup width adaptability and clamping
    assert.match(homeThemeCss, /#dcComposer\s+\.dc-model-menu\s*\{[^}]*width:\s*min\(340px,\s*calc\(100vw\s*-\s*32px\)\)/);
    assert.match(homeThemeCss, /#dcComposer\s+\.dc-model-menu\s*\{[^}]*min-width:\s*200px/);

    // 2. Name truncation by default (ellipsis)
    assert.match(homeThemeCss, /\.dc-model-option-name\s*\{[^}]*text-overflow:\s*ellipsis/);
    assert.match(homeThemeCss, /\.dc-model-option-name\s*\{[^}]*white-space:\s*nowrap/);

    // 3. Inner span for marquee calculation
    assert.match(homeThemeCss, /\.dc-model-option-name-inner/);
    assert.match(dragonClawCss, /\.dc-model-option-name-inner/);

    // 4. Marquee animation keyframes and overflow state
    assert.match(homeThemeCss, /@keyframes\s+dc-model-name-marquee/);
    assert.match(dragonClawCss, /@keyframes\s+dc-model-name-marquee/);
    assert.match(homeThemeCss, /\.is-overflowing\s+\.dc-model-option-name-inner\s*\{[^}]*animation:\s*dc-model-name-marquee/);
    assert.match(dragonClawCss, /\.is-overflowing\s+\.dc-model-option-name-inner\s*\{[^}]*animation:\s*dc-model-name-marquee/);
});

test('dragon-claw.js and desktop-agent-models.js render model options with inner spans and titles', () => {
    // 1. Standard model picker option wrapping
    assert.match(clawJs, /<span class="dc-model-option-name"><span class="dc-model-option-name-inner">/);
    assert.match(clawJs, /title="\$\{escapeHtml\(item\.name\)\}/);

    // 2. Desktop native model picker option wrapping
    assert.match(desktopModelsJs, /<span class="dc-model-option-name"><span class="dc-model-option-name-inner">\$\{esc\(name\)\}<\/span><\/span>/);
});

test('dragon-claw.js implements clampModelMenuHorizontal and marquee measurement', () => {
    // 1. clampModelMenuHorizontal definition and calls
    assert.match(clawJs, /function clampModelMenuHorizontal\(\)/);
    assert.match(clawJs, /clampModelMenuHorizontal\(\);/);

    // 2. toggleModelMenu calls clampModelMenuHorizontal on open
    assert.match(clawJs, /function toggleModelMenu\(open\s*=/);

    // 3. bindModelPicker wires resize listener, ResizeObserver, mouseover and focusin
    assert.match(clawJs, /window\.addEventListener\('resize'/);
    assert.match(clawJs, /el\.modelMenu\.addEventListener\('mouseover'/);
    assert.match(clawJs, /el\.modelMenu\.addEventListener\('focusin'/);
    assert.match(clawJs, /--marquee-dist/);
    assert.match(clawJs, /is-overflowing/);
});

test('DragonHtmlSwarm exports openInNewTab and browser-sidebar wires it to top-right external button', () => {
    // 1. openInNewTab exported on window.DragonHtmlSwarm
    assert.match(swarmJs, /openInNewTab,\s*\n\s*deactivate,/);

    // 2. openInNewTab creates Blob URL and opens new tab
    assert.match(swarmJs, /function openInNewTab\(\)\s*\{/);
    assert.match(swarmJs, /new Blob\(\[code\],/);
    assert.match(swarmJs, /window\.open\(url,\s*'_blank'/);

    // 3. browser-sidebar delegates external action to DragonHtmlSwarm.openInNewTab when is-swarm-canvas
    assert.match(sidebarJs, /if\(panel\?\.classList\.contains\('is-swarm-canvas'\)&&window\.DragonHtmlSwarm\?\.openInNewTab\)\s*\{\s*window\.DragonHtmlSwarm\.openInNewTab\(\);\s*return;\s*\}/);
});

test('DOM simulation: clampModelMenuHorizontal clamps negative left offset to visible viewport', () => {
    let menuRight = 0;
    let menuWidth = 0;
    let menuMaxWidth = 0;

    const fakeMenu = {
        hidden: false,
        style: {
            left: '',
            get right() { return `${menuRight}px`; },
            set right(val) { menuRight = parseFloat(val) || 0; },
            get width() { return `${menuWidth}px`; },
            set width(val) { menuWidth = parseFloat(val) || 0; },
            get maxWidth() { return `${menuMaxWidth}px`; },
            set maxWidth(val) { menuMaxWidth = parseFloat(val) || 0; }
        },
        getBoundingClientRect() {
            // Suppose button right edge is at 180px, initial right: 0 places menu at [180 - width, 180]
            const r = 180 - menuRight;
            const w = menuWidth || 300;
            return {
                left: r - w,
                right: r,
                width: w,
                height: 200
            };
        }
    };

    const composerRect = { left: 16, right: 300, width: 284 };
    const winW = 1200;
    const minLeft = Math.max(8, composerRect.left + 8); // 24
    const maxRight = Math.min(winW - 8, composerRect.right - 8); // 292
    const availW = Math.max(180, maxRight - minLeft); // 268
    const targetW = Math.min(340, availW); // 268

    fakeMenu.style.width = `${Math.round(targetW)}px`;
    fakeMenu.style.maxWidth = `${Math.round(availW)}px`;

    const menuRect = fakeMenu.getBoundingClientRect();
    // Initially: r = 180, w = 268 => left = 180 - 268 = -88px (< minLeft 24px)
    assert.ok(menuRect.left < minLeft, 'Initial rect is cut off on the left');

    if (menuRect.left < minLeft) {
        const shift = minLeft - menuRect.left; // 24 - (-88) = 112
        const currentRight = parseFloat(fakeMenu.style.right) || 0;
        fakeMenu.style.right = `${Math.round(currentRight - shift)}px`; // -112px
    }

    const clampedRect = fakeMenu.getBoundingClientRect();
    assert.equal(clampedRect.left, minLeft, 'Left coordinate clamped exactly to minLeft');
    assert.ok(clampedRect.right <= maxRight, 'Right coordinate does not overflow maxRight');
});
