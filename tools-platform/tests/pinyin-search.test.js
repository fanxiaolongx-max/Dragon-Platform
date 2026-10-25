const test = require('node:test');
const assert = require('node:assert/strict');
const { isPinyinQuery, pinyinMatches } = require('../frontend/js/shared/pinyin-search');

test('pinyin search matches full pinyin, initials and mixed input', () => {
    for (const q of ['weifuwu', 'wfw', 'weifw', 'wfuwu', 'WeiFuWu', 'wei fu wu', 'fuwujiao', 'weifuw']) {
        assert.equal(pinyinMatches('微服务交付群', q), true, q);
    }
    assert.equal(pinyinMatches('重庆项目', 'cq'), true);
    assert.equal(pinyinMatches('重庆项目', 'chongqing'), true);
    assert.equal(pinyinMatches('张三', 'zhs'), true);
    assert.equal(pinyinMatches('Dragon平台', 'dragonpt'), true);
    assert.equal(pinyinMatches('聊天记录/群组/微服务群.txt', 'wfwq'), true);
    for (const q of ['wfx', 'xyz', 'wuweifu']) assert.equal(pinyinMatches('微服务交付群', q), false, q);
    assert.equal(pinyinMatches('abc', 'abc'), false);
});

test('only latin queries use pinyin matching', () => {
    assert.equal(isPinyinQuery('wfw'), true);
    assert.equal(isPinyinQuery('wei fu'), true);
    assert.equal(isPinyinQuery('微服务'), false);
    assert.equal(isPinyinQuery('123'), false);
    assert.equal(isPinyinQuery('wfw群'), false);
});
