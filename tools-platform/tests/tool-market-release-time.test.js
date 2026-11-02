'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { releaseVersion } = require('../scripts/build-tools-market');
const { stampToolRelease } = require('../scripts/stamp-tool-release');

test('release stamping preserves metadata and distinguishes updates on the same day', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-time-'));
    try {
        const dir = path.join(root, 'sample');
        fs.mkdirSync(dir);
        const target = path.join(dir, '.tool-manifest.json');
        const original = { version: 1, tool: { slug: 'sample', name: 'Sample', createdAt: '2026-01-01T00:00:00.000Z' }, history: { keep: true } };
        fs.writeFileSync(target, JSON.stringify(original));
        const versions = [];
        for (const time of ['2026-10-31T01:02:03.456Z', '2026-10-31T17:18:19.789Z']) {
            assert.equal(stampToolRelease('sample', { sourceRoot: root, now: new Date(time) }), time);
            const manifest = JSON.parse(fs.readFileSync(target));
            assert.deepEqual(manifest, { ...original, tool: { ...original.tool, updatedAt: time } });
            versions.push(releaseVersion(manifest.tool));
        }
        assert.deepEqual(versions, ['2026.10.31.01.02.03', '2026.10.31.17.18.19']);
        assert.equal(releaseVersion({ releaseVersion: 'v2.1.0' }), 'v2.1.0');
        assert.throws(() => stampToolRelease('../sample', { sourceRoot: root }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('market timestamps show seconds and timezone, and do not invent precision for old dates', () => {
    const html = fs.readFileSync(path.join(__dirname, '../frontend/js/home/home-page.js'), 'utf8');
    const start = html.indexOf('const formatMarketTime =');
    const end = html.indexOf('const labels =', start);
    for (const en of [false, true]) {
        const format = vm.runInNewContext(`${html.slice(start, end)}; formatMarketTime`, {
            english: () => en, text: (zh, english) => en ? english : zh
        });
        const time = new Date('2026-10-31T17:18:19.789Z');
        const localTime = new Intl.DateTimeFormat(en ? 'en-GB' : 'zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
            second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset'
        }).format(time);
        assert.equal(format(time.toISOString()), localTime);
        assert.match(format(time.toISOString()), /:19/);
        assert.match(format('2026.10.30'), en ? /time not recorded/ : /未记录时分秒/);
        assert.equal(format('v2.1.0'), 'v2.1.0');
        assert.equal(format(null), en ? 'Unknown' : '未知');
    }
});
