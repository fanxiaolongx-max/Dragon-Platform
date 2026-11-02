const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('platform auth middleware marks only real session failures as authentication errors', () => {
    const source = read('backend/middleware/auth.js');
    assert.match(source, /code: 'AUTH_REQUIRED'/);
    assert.match(source, /code: 'AUTH_EXPIRED'/);
});

test('shared API client does not log out for an unmarked downstream 401', () => {
    const source = read('frontend/js/shared/api.js');
    assert.match(source, /isPlatformAuthFailure = res\.status === 401/);
    assert.match(source, /\['AUTH_REQUIRED', 'AUTH_EXPIRED'\]\.includes\(body\.code\)/);
    assert.match(source, /if \(isPlatformAuthFailure\)/);
    assert.doesNotMatch(source, /if \(res\.status === 401\) \{/);
});

test('AI metadata failures are isolated and import UI falls back to manual input', () => {
    const route = read('backend/routes/custom-tools.js');
    const home = read('frontend/index.html') + read('frontend/js/home/home-page.js');
    assert.match(route, /res\.status\(503\)\.json\(\{/);
    assert.match(route, /code: 'AI_METADATA_UNAVAILABLE'/);
    assert.match(home, /AI 接口当前不可用，请手动填写下方工具信息；不影响继续导入。/);
    assert.match(home, /setAiStatus\(t\('home\.import\.aiUnavailable'\), 'warning'\)/);
    assert.match(home, /nameInput\.focus\(\)/);
});
