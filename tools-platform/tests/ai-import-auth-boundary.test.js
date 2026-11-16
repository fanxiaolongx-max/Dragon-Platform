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
    const home = read('frontend/index.html') + read('frontend/js/home/home-tools.js');
    assert.match(route, /res\.status\(503\)\.json\(\{/);
    assert.match(route, /code: 'AI_METADATA_UNAVAILABLE'/);
    assert.match(home, /AI 接口当前不可用，请手动填写下方工具信息；不影响继续导入。/);
    assert.match(home, /setAiStatus\(t\('home\.import\.aiUnavailable'\), 'warning'\)/);
    assert.match(home, /nameInput\.focus\(\)/);
});

test('AI metadata parser unwraps Gemini array responses, nested objects, and snake_case keys', () => {
    const router = require('../backend/routes/custom-tools');
    const { parseAiJson, normalizeAiMetadata } = router._aiMetadataHelpers;

    const arrayWrapped = '```json\n[{"name":"攀岩生日纪念","nameEn":"Climbing Birthday Tribute","description":"为攀岩好友定制的互动式生日纪念网页，可视化呈现三年聊天与路线回忆。","descriptionEn":"An interactive climbing-themed birthday tribute webpage visualizing three years of chats and routes.","tags":["生日贺卡","攀岩主题"]}]\n```';
    const meta1 = normalizeAiMetadata(parseAiJson(arrayWrapped));
    assert.equal(meta1.name, '攀岩生日纪念');
    assert.equal(meta1.nameEn, 'Climbing Birthday Tribute');
    assert.ok(meta1.description.length > 10);
    assert.ok(meta1.descriptionEn.length > 10);
    assert.deepEqual(meta1.tags, ['生日贺卡', '攀岩主题']);

    const snakeNested = JSON.stringify({
        metadata: {
            name_zh: '生日祝福页',
            name_en: 'Birthday Greeting Page',
            description_zh: '展示个人生日纪念数据与互动祝福动画。',
            description_en: 'Displays personal birthday stats and interactive animations.',
            keywords: ['Birthday', 'Card']
        }
    });
    const meta2 = normalizeAiMetadata(parseAiJson(snakeNested));
    assert.equal(meta2.name, '生日祝福页');
    assert.equal(meta2.nameEn, 'Birthday Greeting Page');
    assert.ok(meta2.description.length > 5);
    assert.ok(meta2.descriptionEn.length > 5);
    assert.deepEqual(meta2.tags, ['Birthday', 'Card']);
});
