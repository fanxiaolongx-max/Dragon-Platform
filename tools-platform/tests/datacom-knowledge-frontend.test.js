'use strict';

// 数通协议专家前端的纯逻辑：RFC 位图解析、校验和/定时器/仲裁/前缀匹配实验室、Mermaid 兼容处理。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const assets = path.join(__dirname, '../backend/builtin-tools/datacom-protocol-expert/assets');
const load = name => import(pathToFileURL(path.join(assets, name)).href);

test('video recommendations only use registered notes visible in the current catalog and never mutate the catalog', async () => {
    const { selectVideoRecommendations } = await load('note-video.js');
    const manifest = require('../frontend/assets/promotions/datacom/manifest.json');
    const catalog = Object.keys(manifest).map(id => ({ id }));
    const before = catalog.map(article => article.id);
    const all = selectVideoRecommendations([...catalog, { id: 'private-note' }], manifest, 6, () => 0);
    assert.equal(all.length, 5);
    assert.equal(new Set(all.map(article => article.id)).size, 5);
    assert.equal(all.some(article => article.id === 'private-note'), false);
    assert.deepEqual(catalog.map(article => article.id), before);
    assert.deepEqual(selectVideoRecommendations(catalog.slice(0, 1), manifest), catalog.slice(0, 1));
    assert.deepEqual(selectVideoRecommendations(catalog, {}), []);
    const more = Object.fromEntries(Array.from({ length: 10 }, (_, n) => ['note-' + n, {}]));
    assert.equal(selectVideoRecommendations(Object.keys(more).map(id => ({ id })), more).length, 6);
});

const HELLO = `
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Network Mask                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         HelloInterval         |    Options    |    Rtr Pri    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Authentication                          |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|         Interface MTU         |    Options    |0|0|0|0|0|I|M|MS
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Link State ID                          | (生成LSA的Router-ID)
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+`;

test('RFC ASCII diagrams are parsed into fields with bit widths', async () => {
    const { parseRfcDiagram, isRfcDiagram } = await load('scenes-misc.js');
    assert.equal(isRfcDiagram(HELLO), true);
    assert.equal(isRfcDiagram('+----------+\n| 普通文本框 |\n+----------+'), false);
    const parsed = parseRfcDiagram(HELLO);
    assert.equal(parsed.bitsPerRow, 32);
    const byName = Object.fromEntries(parsed.fields.map(field => [field.name, field.bits]));
    assert.equal(byName['Network Mask'], 32);
    assert.equal(byName.HelloInterval, 16);
    assert.equal(byName['Rtr Pri'], 8);
    assert.equal(byName.Authentication, 64, '空白续行合并为 64 bit');
    assert.equal(byName.MS, 1, '行尾缺少竖线时按分隔线宽度补齐');
    assert.equal(parsed.fields.find(field => field.name === 'Link State ID').desc, '生成LSA的Router-ID');
    const total = parsed.fields.reduce((sum, field) => sum + field.bits, 0);
    assert.equal(total % 32, 0);

    const options = parseRfcDiagram(`
  0    1    2    3    4    5    6    7
+----+----+----+----+----+----+----+----+
| DN | O  | DC | L  |N/P | MC | E  | MT |
+----+----+----+----+----+----+----+----+`);
    assert.equal(options.bitsPerRow, 8);
    assert.deepEqual(options.fields.map(field => field.bits), [1, 1, 1, 1, 1, 1, 1, 1]);
});

test('checksum, timer, LSA arbitration and prefix labs compute the documented results', async () => {
    const { timerIntervals, arbitrate, prefixMatch, electRouterId } = await load('labs.js');
    assert.deepEqual(timerIntervals({ max: 5000, start: 50, hold: 200, count: 8, mode: 'spf' }), [50, 200, 400, 800, 1600, 3200, 5000, 5000]);
    assert.deepEqual(timerIntervals({ max: 1000, start: 500, hold: 500, count: 7, mode: 'lsa' }), [500, 500, 1000, 1000, 1000, 500, 500]);

    assert.equal(arbitrate({ seq: '7FFFFFF0', checksum: '1', age: 1 }, { seq: '80000001', checksum: '1', age: 1 }).winner, 'A', '序列号为有符号数');
    assert.equal(arbitrate({ seq: '80000006', checksum: '3C4D', age: 120 }, { seq: '80000006', checksum: '3C4D', age: 3600 }).winner, 'B');
    assert.equal(arbitrate({ seq: '80000006', checksum: '3C4D', age: 1500 }, { seq: '80000006', checksum: '3C4D', age: 200 }).winner, 'B');
    assert.equal(arbitrate({ seq: '80000006', checksum: '3C4D', age: 700 }, { seq: '80000006', checksum: '3C4D', age: 200 }).winner, 'same');

    const route = { prefix: '1.1.1.0', len: 24 };
    assert.equal(prefixMatch({ prefix: '1.1.0.0', len: 16, ge: '', le: '' }, route).match, false);
    assert.equal(prefixMatch({ prefix: '1.1.0.0', len: 16, ge: '', le: 24 }, route).match, true);
    assert.equal(prefixMatch({ prefix: '1.1.1.1', len: 32, ge: '', le: '' }, route).match, false);
    assert.equal(prefixMatch({ prefix: '0.0.0.0', len: 0, ge: '', le: 32 }, route).match, true);

    const interfaces = [{ name: 'Lo0', ip: '10.0.0.1', loopback: true, up: true }, { name: 'GE1', ip: '192.168.1.1', loopback: false, up: true }];
    assert.equal(electRouterId({ processId: '', globalId: '', interfaces }).id, '10.0.0.1');
    assert.equal(electRouterId({ processId: '9.9.9.9', globalId: '2.2.2.2', interfaces }).id, '9.9.9.9');
    assert.equal(electRouterId({ processId: '', globalId: '', interfaces: interfaces.map(item => ({ ...item, up: false })) }).id, '0.0.0.0');
});

test('mermaid state diagram labels with extra colons are normalized', async () => {
    const { normalizeMermaid } = await load('markdown.js');
    const fixed = normalizeMermaid('stateDiagram-v2\n    Down --> Attempt : Event: Start (NBMA)\n    [*] --> Down : 接口使能');
    assert.match(fixed, /Down --> Attempt : Event： Start/);
    assert.equal(normalizeMermaid('flowchart TD\n A -->|"x: y"| B'), 'flowchart TD\n A -->|"x: y"| B');
});

test('snapshotApi handles /preference without throwing and returns defaults', async () => {
    const { createSnapshotApi } = await load('snapshot-api.js');
    const api = createSnapshotApi({ data: { domains: [], categories: [], articles: [], learningPath: [] } });
    const getRes = await api('/preference');
    assert.deepEqual(getRes.preference, { navWidth: 290, navCollapsed: false, payload: {}, updatedAt: null });
    const putRes = await api('/preference', { method: 'PUT', body: { navWidth: 420, navCollapsed: true } });
    assert.equal(putRes.preference.navWidth, 420);
    assert.equal(putRes.preference.navCollapsed, true);
});
