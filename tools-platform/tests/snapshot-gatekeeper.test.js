const test = require('node:test');
const assert = require('node:assert/strict');
const { injectGatekeeper, GATEKEEPER_STYLE } = require('../backend/models/snapshot-gatekeeper');

test('gatekeeper injects physically decoupled backdrop, dialog form and keep classes', () => {
    const rawHtml = `<!doctype html><html><head><title>Test</title></head><body><div class="content">App</div></body></html>`;
    const enc = {
        enabled: true,
        passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        passwordSalt: 'test-salt'
    };
    const html = injectGatekeeper(rawHtml, enc, 'test-tool');

    // 1. Gatekeeper keep class on styles and scripts
    assert.ok(html.includes('class="tp-gatekeeper-keep"'), 'Must have keep class');
    assert.ok(html.includes('id="tpGatekeeperModal" class="tp-gatekeeper-root tp-gatekeeper-keep"'), 'Modal must have root and keep class');

    // 2. Physical decoupling: backdrop has pointer-events: none and dialog has isolation
    assert.ok(html.includes('<div class="tp-gatekeeper-backdrop" aria-hidden="true"></div>'), 'Must contain separate backdrop element');
    assert.ok(GATEKEEPER_STYLE.includes('pointer-events: none !important;'), 'Backdrop must not intercept pointer events');
    assert.ok(GATEKEEPER_STYLE.includes('isolation: isolate !important;'), 'Dialog must isolate stacking context');

    // 3. Form element wrapping input and submit button
    assert.ok(html.includes('<form class="tp-gatekeeper-form" onsubmit="tpUnlockSnapshot(event); return false;" action="#">'), 'Must use semantic form with onsubmit');
    assert.ok(html.includes('<button type="submit" id="tpGatekeeperSubmit"'), 'Must use submit button');
    assert.ok(html.includes('id="tpGatekeeperInput"'), 'Must have password input');

    // 4. Modal is placed at bottom of body (before </body>)
    const modalPos = html.indexOf('id="tpGatekeeperModal"');
    const contentPos = html.indexOf('class="content"');
    const bodyEndPos = html.indexOf('</body>');
    assert.ok(modalPos > contentPos, 'Modal must appear after main content in DOM');
    assert.ok(modalPos < bodyEndPos, 'Modal must be inside body before </body>');
});

test('gatekeeper style preserves user-select on input and hides unkept body elements', () => {
    assert.ok(GATEKEEPER_STYLE.includes('body.tp-locked > *:not(.tp-gatekeeper-keep)'), 'Must hide non-kept children');
    assert.ok(GATEKEEPER_STYLE.includes('user-select: text !important;'), 'Must allow text selection in password input');
    assert.ok(GATEKEEPER_STYLE.includes('cursor: text !important;'), 'Input must have text cursor');
});

test('gatekeeper intercepts HTMLDialogElement showModal while locked to prevent top layer inert barrier', () => {
    const rawHtml = `<!doctype html><html><head><title>Test</title></head><body><div class="content">App</div></body></html>`;
    const enc = {
        enabled: true,
        passwordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        passwordSalt: 'test-salt'
    };
    const html = injectGatekeeper(rawHtml, enc, 'test-tool');
    assert.ok(html.includes('HTMLDialogElement.prototype.showModal'), 'Must intercept showModal on HTMLDialogElement');
    assert.ok(GATEKEEPER_STYLE.includes('html.tp-locked dialog'), 'Must hide dialogs while locked');
});

test('unified publication strips only the legacy tool gate and preserves nested page content', () => {
    const { stripLegacyGatekeeper } = require('../backend/models/snapshot-gatekeeper');
    const raw = '<html class="theme-dark tp-locked"><head></head><body class="tp-locked"><main><div><div>Business data</div></div></main><script>window.business=true;</script></body></html>';
    const locked = injectGatekeeper(raw, { enabled: true, passwordHash: 'old-hash', passwordSalt: 'old-salt' }, 'old-tool');
    const cleaned = stripLegacyGatekeeper(locked);
    assert.doesNotMatch(cleaned, /tpGatekeeper|old-hash|old-salt|tp-locked|访问受限/);
    assert.match(cleaned, /<main><div><div>Business data<\/div><\/div><\/main>/);
    assert.match(cleaned, /window.business=true/);
    assert.match(cleaned, /theme-dark/);
    assert.equal(stripLegacyGatekeeper(cleaned), cleaned);
});
