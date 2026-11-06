const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('skill-hub.js and tool-frame.js prevent default card navigation when clicking more options button', () => {
    const skillHubPath = path.join(__dirname, '../frontend/js/home/skill-hub.js');
    const toolFramePath = path.join(__dirname, '../frontend/js/home/tool-frame.js');
    const workspacePath = path.join(__dirname, '../frontend/js/home/workspace.js');

    const skillHubCode = fs.readFileSync(skillHubPath, 'utf8');
    const toolFrameCode = fs.readFileSync(toolFramePath, 'utf8');
    const workspaceCode = fs.readFileSync(workspacePath, 'utf8');

    // 1. Verify skill-hub.js intercepts card action clicks immediately BEFORE item lookup
    assert.match(
        skillHubCode,
        /const actBtn = event\.target\.closest\('\[data-hub-act\]'\);[\s\S]*?if \(actBtn \|\| isMoreArea\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/,
        'skill-hub.js must call preventDefault and stopPropagation immediately on actBtn or isMoreArea'
    );
    assert.match(
        skillHubCode,
        /window\.HomeToolMenu\?\.open\(\{ anchor: btn, item, card: cardEl \}\);/,
        'skill-hub.js must open HomeToolMenu with anchor and cardEl'
    );

    // 2. Verify tool-frame.js ignores action button clicks so it never opens the tool frame on more-btn clicks
    assert.match(
        toolFrameCode,
        /if \(event\.target\.closest\?\.\(.*\[data-hub-act\].*v2-hub-more.*card-more-toggle/,
        'tool-frame.js must ignore clicks on [data-hub-act], .v2-hub-more, .card-more-toggle'
    );

    // 3. Verify workspace.js also handles .card-more-toggle click cleanly
    assert.match(
        workspaceCode,
        /const moreBtn = event\.target\.closest\('\.card-more-toggle'\);[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?window\.HomeToolMenu\?\.open/,
        'workspace.js must catch .card-more-toggle in grid click listener'
    );
});

test('navbar-settings.js, home-theme.css, and shared.css properly adapt AI auto-switch and settings cards to dark mode', () => {
    const navbarSettingsPath = path.join(__dirname, '../frontend/js/shared/navbar-settings.js');
    const homeThemePath = path.join(__dirname, '../frontend/css/home-theme.css');
    const sharedCssPath = path.join(__dirname, '../frontend/css/shared.css');

    const navbarSettingsCode = fs.readFileSync(navbarSettingsPath, 'utf8');
    const homeThemeCss = fs.readFileSync(homeThemePath, 'utf8');
    const sharedCss = fs.readFileSync(sharedCssPath, 'utf8');

    // 1. Verify navbar-settings.js uses theme CSS variables for auto-switch check
    assert.match(
        navbarSettingsCode,
        /nav-ai-autoswitch-check/,
        'navbar-settings.js should include nav-ai-autoswitch-check class'
    );
    assert.match(
        navbarSettingsCode,
        /background:var\(--v2-chip,\s*rgba\(255,255,255,\.68\)\)/,
        'navbar-settings.js should use var(--v2-chip) for auto switch card'
    );
    assert.match(
        navbarSettingsCode,
        /background:var\(--v2-side,\s*rgba\(248,250,252,0\.78\)\)/,
        'navbar-settings.js should use var(--v2-side) for usage history panel'
    );

    // 2. Verify home-theme.css has dark mode styles for auto-switch and media tabs
    assert.match(
        homeThemeCss,
        /html\[data-ui="v2"\]\[data-theme="dark"\] \.nav-ai-profile-panel \.nav-settings-check/,
        'home-theme.css must style nav-settings-check in dark mode'
    );
    assert.match(
        homeThemeCss,
        /html\[data-ui="v2"\]\[data-theme="dark"\] \.nav-ai-usage-panel \.nav-ai-usage-history/,
        'home-theme.css must style usage history in dark mode'
    );

    // 3. Verify shared.css has dark mode overrides
    assert.match(
        sharedCss,
        /\.nav-ai-profile-panel \.nav-settings-check[\s\S]*?background: var\(--nsw-chip\) !important;/,
        'shared.css must override nav-settings-check background with !important'
    );
});
