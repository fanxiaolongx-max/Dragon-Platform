const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const navbar = require('./helpers/platform-source.cjs').readPlatformSource();
const assistant = fs.readFileSync(path.join(root, 'frontend/js/shared/ai-assistant.js'), 'utf8');

test('navbar manages alert-center polling lifecycle and stops on 401 or logout', () => {
    assert.match(navbar, /function stopAlertCenterPolling\(\)/);
    assert.match(navbar, /function startAlertCenterPolling\(intervalMs = 60000\)/);
    assert.match(navbar, /window\.startAlertCenterPolling = startAlertCenterPolling;/);
    assert.match(navbar, /window\.stopAlertCenterPolling = stopAlertCenterPolling;/);
    assert.match(navbar, /stopAlertCenterPolling\(\);\s*updateAlertCenterBadge\(\{ unread: 0 \}\);/);
    assert.match(navbar, /window\.doLogout = async function \(\) \{\s*stopAlertCenterPolling\(\);/);
    assert.match(navbar, /else if \(res\.status === 401\) \{\s*stopAlertCenterPolling\(\);/);
    assert.match(navbar, /if \(hasNavAuthToken\(\)\) \{\s*refreshAlertCenterBadge\(\);\s*startAlertCenterPolling\(60000\);/);
});

test('ai-assistant stops proactive alerts polling when unauthenticated or received 401', () => {
    assert.match(assistant, /const token = localStorage\.getItem\('tools_token'\) \|\| sessionStorage\.getItem\('tools_token'\);\s*if \(!token\) return;/);
    assert.match(assistant, /if \(response\.status === 401\) \{\s*\/\/[^\n]*\s*return;\s*\}/);
});
