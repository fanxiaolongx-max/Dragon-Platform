const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureDownloads, downloadFilename } = require('../desktop-promo/downloads');

test('Dragon downloads avoid overwriting existing and concurrent files, release names and clean up the handler', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-downloads-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const session = new EventEmitter();
    const dispose = configureDownloads(session, () => directory);
    fs.writeFileSync(path.join(directory, '报表.xlsx'), 'keep existing');
    function download(name) {
        const item = new EventEmitter();
        item.getFilename = () => name;
        item.setSavePath = value => { item.savePath = value; };
        item.cancel = () => { item.cancelled = true; };
        session.emit('will-download', {}, item);
        return item;
    }
    const first = download('报表.xlsx'), second = download('报表.xlsx');
    assert.equal(first.savePath, path.join(directory, '报表 (1).xlsx'));
    assert.equal(second.savePath, path.join(directory, '报表 (2).xlsx'));
    assert.equal(fs.readFileSync(path.join(directory, '报表.xlsx'), 'utf8'), 'keep existing');
    first.emit('done', {}, 'cancelled');
    assert.equal(download('报表.xlsx').savePath, first.savePath);
    assert.equal(download('../../outside.txt').savePath, path.join(directory, 'outside.txt'));
    dispose();
    assert.equal(session.listenerCount('will-download'), 0);
});

test('download filenames stay inside Downloads and are usable on Windows', () => {
    assert.equal(downloadFilename('C:\\temp\\报表.zip'), '报表.zip');
    assert.equal(downloadFilename('../report?.zip'), 'report_.zip');
    assert.equal(downloadFilename('CON.txt'), '_CON.txt');
    assert.equal(downloadFilename('..'), 'download');
    assert.equal(downloadFilename('report.txt. '), 'report.txt');
});
