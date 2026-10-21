'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROTATION_KEY = 'tools.home.promotions.rotation';
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/home/promo-video.js'), 'utf8');
const videos = ['rfc', 'incentive', 'eos', 'guide'];
const config = () => ({ videos: videos.map(id => ({ id, enabled: true })), links: [
    { id: 'first', enabled: true, url: 'https://first.example/' },
    { id: 'second', enabled: true, url: 'https://second.example/' },
    { id: 'hidden', enabled: false, url: 'https://hidden.example/' }
] });
const keys = [...videos, 'link:first', 'link:second'];
function load(storage = new Map(), random = () => 0.4) {
    const context = {
        window: {},
        document: { readyState: 'loading', addEventListener() {} },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        Math: Object.assign(Object.create(Math), { random })
    };
    // 运行原组件，跳过 DOM 初始化；只在测试副本中暴露选择器。
    vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.rotationTest = { next: nextPromotion, configure(value) { config = value; } };})();'), context);
    context.window.rotationTest.configure(config());
    return context.window.rotationTest;
}

test('first visit prefers the first enabled link, even with legacy video history', () => {
    const storage = new Map([['tools.home.promoVideos.lastVideo', 'eos']]);
    const rotation = load(storage);
    assert.equal(rotation.next(), 'link:first');
    const cycle = ['link:first', ...Array.from({ length: 5 }, () => rotation.next())];
    assert.deepEqual([...cycle].sort(), [...keys].sort(), 'every video and enabled link appears once');
});

test('refreshes retain a shuffled cycle and avoid repeats across cycle boundaries', () => {
    const storage = new Map();
    const selected = Array.from({ length: 24 }, () => load(storage).next());
    for (let i = 0; i < selected.length; i += keys.length) assert.deepEqual(selected.slice(i, i + keys.length).sort(), [...keys].sort());
    for (let i = 1; i < selected.length; i++) assert.notEqual(selected[i], selected[i - 1]);
    const low = load(new Map(), () => 0), high = load(new Map(), () => 0.99);
    assert.notDeepEqual(Array.from({ length: 6 }, () => low.next()), Array.from({ length: 6 }, () => high.next()), 'randomness affects the order');
});

test('configuration changes exclude disabled items and include newly added links', () => {
    const rotation = load();
    rotation.next();
    rotation.configure({ videos: videos.map(id => ({ id, enabled: false })), links: [{ id: 'new', enabled: true, url: 'https://new.example/' }] });
    assert.equal(rotation.next(), 'link:new');
    assert.equal(rotation.next(), 'link:new', 'a single available item remains usable');
    rotation.configure({ videos: videos.map(id => ({ id, enabled: false })), links: [] });
    assert.equal(rotation.next(), null);
});

test('without links, enabled videos still cycle without repeating', () => {
    const rotation = load();
    rotation.configure({ videos: config().videos, links: [] });
    assert.deepEqual(Array.from({ length: 4 }, () => rotation.next()).sort(), [...videos].sort());
});

test('corrupt or blocked browser storage does not prevent showing a promotion', () => {
    for (const value of ['invalid-json', 'null', '42', '{"signature":"stale","remaining":["link:deleted"]}']) {
        assert.equal(load(new Map([[ROTATION_KEY, value]])).next(), 'link:first');
    }
    const blocked = { get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); } };
    assert.equal(load(blocked).next(), 'link:first');
});
