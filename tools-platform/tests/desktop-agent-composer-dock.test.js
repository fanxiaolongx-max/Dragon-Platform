const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('home-theme.css and desktop-agents.css ensure voice and send buttons stay docked on the right in external sessions', () => {
    const homeThemePath = path.join(__dirname, '../frontend/css/home-theme.css');
    const desktopAgentsCssPath = path.join(__dirname, '../frontend/css/desktop-agents.css');
    const homeTheme = fs.readFileSync(homeThemePath, 'utf8');
    const desktopAgents = fs.readFileSync(desktopAgentsCssPath, 'utf8');

    // Verify home-theme.css handles hidden enhance + hidden model, keeping voice/send docked right
    assert.match(
        homeTheme,
        /html\[data-ui="v2"\] #dcComposer #dcEnhance\[hidden\] ~ #dcModel\[hidden\] ~ #dcVoice:not\(\[hidden\]\)/,
        'home-theme.css should anchor #dcVoice to margin-left: auto when both #dcEnhance and #dcModel are hidden'
    );
    assert.match(
        homeTheme,
        /html\[data-ui="v2"\] body\.dc-external-compose #dcComposer #dcEnhance\[hidden\] ~ #dcVoice:not\(\[hidden\]\)/,
        'home-theme.css should anchor #dcVoice to margin-left: auto in body.dc-external-compose when #dcEnhance is hidden'
    );

    // Verify desktop-agents.css also handles right-docking in body.dc-external-compose
    assert.match(
        desktopAgents,
        /body\.dc-external-compose #dcComposer #dcEnhance\[hidden\] ~ #dcVoice/,
        'desktop-agents.css should anchor #dcVoice to margin-left: auto when enhance is hidden in external compose'
    );
    assert.match(
        desktopAgents,
        /body\.dc-external-compose #dcComposer #dcEnhance\[hidden\] ~ #dcVoice\[hidden\] ~ #dcSend/,
        'desktop-agents.css should anchor #dcSend to margin-left: auto if both enhance and voice are hidden'
    );
});

test('dragon-claw.js hides el.model when entering external compose and restores on exit', () => {
    const dragonClawPath = path.join(__dirname, '../frontend/js/home/dragon-claw.js');
    const dragonClawCode = fs.readFileSync(dragonClawPath, 'utf8');

    assert.match(
        dragonClawCode,
        /if \(el\.model\) el\.model\.hidden = Boolean\(composer\)/,
        'setExternalComposer should explicitly hide el.model when composer is active'
    );
    assert.match(
        dragonClawCode,
        /renderModelPicker\(\);\s*autoResize\(\);/,
        'exitExternal should restore model picker visibility via renderModelPicker()'
    );
});
