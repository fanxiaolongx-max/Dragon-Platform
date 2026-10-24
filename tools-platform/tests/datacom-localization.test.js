'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const seed = require('../backend/builtin-tools/datacom-protocol-expert/knowledge-seed.json');
const load = name => import(pathToFileURL(path.join(__dirname, '../backend/builtin-tools/datacom-protocol-expert/assets', name)).href);

test('bundled RFC fields have concrete descriptions, preserve original notes and explain the MTU boundary', async () => {
    const { rfcLesson, packetLesson } = await load('packet-lesson.js');
    const { isRfcDiagram } = await load('rfc-parser.js');
    const { translate } = await load('i18n.js');
    let mtu;
    for (const article of seed.articles) {
        const before = article.bodyMd;
        for (const m of article.bodyMd.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
            if (!isRfcDiagram(m[1])) continue;
            const lesson = rfcLesson(m[1], article.title, article.bodyMd).build();
            for (const part of lesson.parts) {
                assert.ok(part.desc.trim(), `${article.id}: ${part.name}`);
                assert.doesNotMatch(part.desc, /字段含义请结合原文|^本图中/);
                assert.doesNotMatch(translate(part.desc, 'en'), /[\u3400-\u9fff]/, `${article.id}: ${part.name} explanation needs English`);
                if (part.name === 'Interface MTU') mtu = part;
            }
        }
        assert.equal(article.bodyMd, before);
    }
    assert.ok(mtu.rows.some(([label, value]) => label === '原文说明' && value.includes('ospf mtu-enable')));
    for (const term of ['16 bit', '字节', '1500', '9000', 'ExStart/Exchange', '虚链路', 'RFC 2328', 'Huawei VRP']) assert.ok(mtu.desc.includes(term), term);
    assert.doesNotMatch(translate(mtu.desc, 'en'), /[\u3400-\u9fff]/);
    for (let type = 1; type <= 5; type++) for (const auth of ['null', 'simple', 'crypto']) {
        assert.ok(packetLesson.build({ type, auth }).parts.every(part => part.desc.trim()));
    }
});

test('ASCII comments are not interpreted as fields, and labeled auth continuation retains 64 bits', async () => {
    const { parseRfcDiagram, isRfcDiagram } = await load('rfc-parser.js');
    const article = seed.articles.find(item => item.id === 'ospf-lsa-handbook');
    const source = [...article.bodyMd.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m => m[1]).find(s => s.includes('| DN'));
    assert.equal(parseRfcDiagram(source).fields.length, 8);
    const auth = seed.articles.find(item => item.id === 'ospf-auth');
    for (const m of auth.bodyMd.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) if (isRfcDiagram(m[1]) && m[1].includes('Authentication')) {
        assert.equal(parseRfcDiagram(m[1]).fields.find(f => f.name === 'Authentication').bits, 64);
    }
});

test('English dynamic summaries retain arbitrary counts and source text can always be displayed unchanged', async () => {
    const { translate } = await load('i18n.js');
    const source = '17 次连续变化累计等待 12345 ms。超过 max-interval 且无新震荡后，才退出退避重新从 start 开始。';
    const english = translate(source, 'en');
    assert.match(english, /17 consecutive changes: 12345 ms/);
    assert.doesNotMatch(english, /[\u3400-\u9fff]/);
    assert.equal(translate(source, 'zh'), source);
    assert.equal(translate('set protocols ospf area 0.0.0.0 interface ge-0/0/0.0', 'en'), 'set protocols ospf area 0.0.0.0 interface ge-0/0/0.0');
});
