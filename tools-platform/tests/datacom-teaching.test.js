'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = (name) =>
    import(pathToFileURL(path.join(__dirname, '../backend/builtin-tools/datacom-protocol-expert/assets', name)).href);
test('CSPF rejects infeasible constraints, computes costs and enforces SRLG separation', async () => {
    const { solveTe, shortestPath } = await load('ospf-lessons.js');
    const normal = solveTe({ bw: 500, color: 'any', srlg: 'on' });
    assert.deepEqual(normal.primary.nodes, ['A', 'B', 'E', 'F']);
    assert.equal(normal.primary.cost, 40);
    assert.equal(normal.backup, null);
    assert.equal(solveTe({ bw: 1000, color: 'any', srlg: 'off' }).primary, null);
    assert.equal(solveTe({ bw: 500, color: 'gold', srlg: 'off' }).primary, null);
    const wide = solveTe({ bw: 0, color: 'any', srlg: 'on' });
    assert.ok(wide.primary);
    if (wide.backup) {
        const risks = new Set(wide.primary.links.map((l) => l[5]));
        assert.ok(wide.backup.links.every((l) => !risks.has(l[5])));
    }
    assert.equal(shortestPath([]), null);
});
test('packet rows preserve exact widths, offsets and OSPF header lengths', async () => {
    const { splitFields } = await load('diagram-kit.js');
    const { ospfHeader, PAYLOADS } = await load('packet-data.js');
    for (const auth of ['null', 'simple', 'crypto'])
        assert.equal(
            ospfHeader(1, auth).fields.reduce((s, f) => s + f.bits, 0),
            192,
        );
    const fields = [
            { name: 'MAC', bits: 48 },
            { name: 'MAC2', bits: 48 },
            { name: 'type', bits: 16 },
        ],
        segments = splitFields(fields);
    assert.deepEqual(
        segments.map((f) => [f.offset, f.take]),
        [
            [0, 32],
            [32, 16],
            [48, 16],
            [64, 32],
            [96, 16],
        ],
    );
    assert.ok(segments.every((f) => f.col + f.take <= 32));
    assert.equal(PAYLOADS[4].find((l) => l.id === 'rlsa').fields.find((f) => f.name === '# links').value, '1');
});
test('area boundaries do not pass area-local LSA or external LSA into stub/NSSA', async () => {
    const { areaAdmission } = await load('ospf-lessons.js');
    for (const type of [1, 2]) assert.equal(areaAdmission(type, 'normal'), 'local');
    for (const area of ['stub', 'totally-stub', 'nssa', 'totally-nssa'])
        for (const type of [4, 5]) assert.equal(areaAdmission(type, area), 'blocked');
    assert.equal(areaAdmission(7, 'nssa'), 'local');
    assert.equal(areaAdmission(7, 'normal'), 'blocked');
    assert.equal(areaAdmission(3, 'totally-stub'), 'default-only');
});
test('checksum round trips and rejects a single-bit payload corruption; LS age is excluded', async () => {
    const { rfc1071Steps, fletcherCompute } = await load('labs.js');
    const words = [0x4500, 0x003c, 0, 0xf820, 0x4000];
    const sum = rfc1071Steps(words).at(-1);
    assert.equal(sum.result, 0x82a2);
    words[2] = sum.result;
    assert.equal(rfc1071Steps(words).at(-1).sum, 0xffff);
    const bytes = Array.from({ length: 36 }, (_, i) => (i * 13) % 256);
    const one = fletcherCompute(bytes);
    bytes[0] = 99;
    bytes[1] = 10;
    const two = fletcherCompute(bytes);
    assert.equal(one.checksum, two.checksum);
    assert.equal(two.v0, 0);
    assert.equal(two.v1, 0);
    const packet = bytes.slice(2);
    packet[14] = two.x;
    packet[15] = two.y;
    packet[25] ^= 1;
    let c0 = 0,
        c1 = 0;
    for (const b of packet) {
        c0 = (c0 + b) % 255;
        c1 = (c1 + c0) % 255;
    }
    assert.ok(c0 || c1);
});
test('prefix validation never wraps malformed IPv4 or accepts an impossible length interval', async () => {
    const { prefixMatch } = await load('labs.js');
    const route = { prefix: '10.0.1.0', len: 24 };
    for (const prefix of ['999.0.0.0', '10.0.0', '10.x.0.0', '-1.0.0.0', '010.0.0.0'])
        assert.equal(prefixMatch({ prefix, len: 16, le: 32 }, route).valid, false);
    assert.equal(prefixMatch({ prefix: '10.0.0.0', len: 16, ge: 25, le: 24 }, route).valid, false);
    assert.equal(prefixMatch({ prefix: '10.0.0.0', len: 16, ge: 24, le: 24 }, route).match, true);
});
test('invalid arbitration and Router-ID inputs do not produce a misleading winner', async () => {
    const { arbitrate, electRouterId } = await load('labs.js');
    const valid = { seq: '80000001', checksum: '1234', age: 30 };
    for (const bad of [
        { ...valid, seq: '80000000' },
        { ...valid, seq: 'garbage' },
        { ...valid, checksum: 'ZZ' },
        { ...valid, age: '' },
        { ...valid, age: 3601 },
    ])
        assert.equal(arbitrate(valid, bad).winner, null);
    assert.equal(electRouterId({ processId: '999.1.1.1', globalId: '', interfaces: [] }).id, null);
});
