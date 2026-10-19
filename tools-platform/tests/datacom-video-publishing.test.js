const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildManifest, checkManifest } = require('../scripts/prepare-datacom-videos');
const { planReleases, verifyAsset } = require('../scripts/sync-media-releases');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-media-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const bytes = Buffer.from([0, 0, 0, 8, 109, 111, 111, 118]); // moov before payload
    for (const name of ['ospf-fsm.mp4', 'ospf-fsm-hd.mp4']) fs.writeFileSync(path.join(directory, name), bytes);
    fs.writeFileSync(path.join(directory, 'ospf-fsm-poster.jpg'), 'poster');
    return { directory, catalog: { 'ospf-fsm': { title: 'OSPF', v: '20261020-1', duration: 118 } } };
}
test('lesson registration freezes two qualities and an immutable media release', t => {
    const data = fixture(t);
    const result = buildManifest(data);
    assert.equal(Object.keys(result.assets).length, 2);
    assert.match(result.assets['datacom/ospf-fsm.mp4'].url, /Dragon-Platform-Media\/releases\/download\/datacom-ospf-fsm-20261020-1\/ospf-fsm.mp4$/);
    assert.equal(result.assets['datacom/ospf-fsm.mp4'].chunks.length, 1);
    fs.unlinkSync(path.join(data.directory, 'ospf-fsm.mp4'));
    fs.unlinkSync(path.join(data.directory, 'ospf-fsm-hd.mp4'));
    assert.deepEqual(buildManifest({ ...data, previous: result }), result, 'fresh CI checkout needs no MP4');
    data.catalog['ospf-fsm'].v = '20261020-2';
    assert.throws(() => buildManifest({ ...data, previous: result }), /Missing new video/);
});
test('changing bytes under an existing version is blocked; new versions register automatically', t => {
    const data = fixture(t);
    const previous = buildManifest(data);
    fs.appendFileSync(path.join(data.directory, 'ospf-fsm.mp4'), 'changed');
    assert.throws(() => buildManifest({ ...data, previous }), /Immutable video changed/);
    data.catalog['ospf-fsm'].v = '20261020-2';
    assert.match(buildManifest({ ...data, previous }).assets['datacom/ospf-fsm.mp4'].url, /20261020-2/);
    data.catalog['../escape'] = data.catalog['ospf-fsm'];
    assert.throws(() => buildManifest(data), /Invalid video id/);
});
test('remote planning accepts only the separate media repository and verifies actual assets', t => {
    const data = fixture(t);
    const catalog = buildManifest(data);
    const plans = planReleases([{ catalog, directory: data.directory, manifest: '/manifest.json' }]);
    assert.equal(plans.length, 1);
    const item = plans[0].assets[0];
    assert.equal(item.local, path.join(data.directory, 'ospf-fsm.mp4'));
    const remote = { name: item.file, size: item.meta.size, state: 'uploaded', digest: `sha256:${item.meta.sha256}` };
    verifyAsset(plans[0].tag, item, remote);
    assert.throws(() => verifyAsset(plans[0].tag, item, { ...remote, digest: 'sha256:wrong' }), /checksum mismatch/);
    assert.throws(() => verifyAsset(plans[0].tag, item, null), /Missing\/incomplete/);
    catalog.assets['datacom/ospf-fsm.mp4'].url = 'https://example.test/stolen.mp4';
    assert.throws(() => planReleases([{ catalog, directory: data.directory }]), /Invalid media repository/);
});
test('committed datacom manifest matches the page catalog and local files when available', () => {
    const catalog = checkManifest();
    assert.ok(catalog.assets['datacom/ospf-fsm.mp4']);
});
