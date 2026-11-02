const test = require('node:test');
const assert = require('node:assert/strict');

// 会话列表读取：缓存过期时先返回上一份结果、后台重新扫描；设置变更后旧扫描不得写回缓存
const catalog = require('../backend/models/desktop-agents/catalog');
const repo = require('../backend/models/desktop-agents/repository');
const codex = require('../backend/models/desktop-agents/codex-ipc');
const service = require('../backend/models/desktop-agents/service');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cfg = { syncSeconds: 0.05, recentLimit: 20, allowSend: true, providers: { codex: true, claudecode: false, antigravity: false } };
let scans = 0, delay = 0, title = 'v1';

test.before(() => {
    repo.access = async () => cfg;
    repo.save = async () => cfg;
    catalog.codex = async () => {
        scans++;
        const current = title;
        if (delay) await sleep(delay);
        return [{ id: '00000000-0000-0000-0000-000000000001', provider: 'codex', title: current, updatedAt: 1 }];
    };
    codex.DesktopIPC = class { async initialize() { throw new Error('not running'); } close() {} };
});

test('expired list reads return the previous rows at once and share one background scan', async () => {
    const owner = 'swr-owner';
    assert.equal((await service.list(owner)).items[0].title, 'v1');
    assert.equal(scans, 1);

    await sleep(70); // 超过 syncSeconds，缓存过期
    title = 'v2';
    delay = 150;
    const started = Date.now();
    const results = await Promise.all([service.list(owner), service.list(owner), service.list(owner)]);
    assert.ok(Date.now() - started < 100, 'stale rows come back without waiting for the scan');
    results.forEach(result => assert.equal(result.items[0].title, 'v1'));
    assert.equal(scans, 2, 'concurrent stale reads start a single scan');

    await sleep(200);
    delay = 0;
    assert.equal((await service.list(owner)).items[0].title, 'v2', 'the next read sees the refreshed rows');
});

test('forced sync always scans synchronously', async () => {
    const owner = 'force-owner';
    title = 'f1';
    await service.list(owner);
    title = 'f2';
    assert.equal((await service.list(owner, { force: true })).items[0].title, 'f2');
});

test('a scan that started before a settings change is not written back to the cache', async () => {
    const owner = 'invalidate-owner';
    title = 'old';
    await service.list(owner);
    await sleep(70);
    delay = 150;
    await service.list(owner); // 返回旧结果并启动后台扫描
    await service.save(owner, {}); // 扫描进行中修改设置
    await sleep(200);
    delay = 0;
    const before = scans;
    title = 'after-save';
    assert.equal((await service.list(owner)).items[0].title, 'after-save', 'no stale cache: the read scans again');
    assert.equal(scans, before + 1);
});
