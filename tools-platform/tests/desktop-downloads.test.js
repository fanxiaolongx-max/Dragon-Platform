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

test('download controls track progress, pause/resume/cancel and open only the recorded completed file', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-download-controls-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const session = new EventEmitter(), changes = [], opened = [], revealed = [], saved = [];
    const downloads = configureDownloads(session, () => directory, {
        onChange: (_items, change) => changes.push({ ...change, item: { ...change.item } }),
        library: { downloads: async () => [], saveDownload: async item => saved.push({ ...item }) },
        openFile: file => opened.push(file), showFile: file => revealed.push(file)
    });
    await downloads.ready;
    const item = new EventEmitter();
    let paused = false, cancelled = false;
    Object.assign(item, {
        getFilename: () => 'project.csv', getTotalBytes: () => 100, getReceivedBytes: () => 40,
        setSavePath: file => { item.path = file; }, isPaused: () => paused, canResume: () => true,
        pause: () => { paused = true; }, resume: () => { paused = false; }, cancel: () => { cancelled = true; }
    });
    session.emit('will-download', {}, item);
    const id = downloads.list()[0].id;
    assert.equal(changes.at(-1).started, true);
    item.emit('updated', {}, 'progressing');
    assert.equal(downloads.list()[0].received, 40);
    downloads.action(id, 'pause'); assert.equal(paused, true); assert.equal(downloads.list()[0].state, 'paused');
    downloads.action(id, 'resume'); assert.equal(paused, false);
    downloads.action(id, 'open'); assert.deepEqual(opened, [], 'incomplete downloads never launch');
    downloads.action('unknown', 'cancel'); assert.equal(cancelled, false);
    downloads.action(id, 'cancel'); assert.equal(cancelled, true);
    fs.writeFileSync(item.path, 'fixture');
    item.emit('done', {}, 'completed');
    assert.equal(changes.at(-1).finished, true); assert.equal(saved.at(-1).state, 'completed');
    downloads.action(id, 'open'); downloads.action(id, 'show');
    assert.deepEqual(opened, [item.path]); assert.deepEqual(revealed, [item.path]);
    fs.unlinkSync(item.path);
    downloads.action(id, 'open'); assert.equal(opened.length, 1, 'removed files do not launch');
    downloads(); assert.equal(session.listenerCount('will-download'), 0);
});
