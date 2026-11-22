const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPortableUpdater, completePortableSwap, cleanupPortableLeftovers, compareVersions, SWAP_ARG, WAIT_ARG } = require('../desktop-portable-updater');

const RELEASE_URL = 'https://github.com/fanxiaolongx-max/Dragon-Platform/releases/latest';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'portable-updater-'));
const payload = Buffer.from('MZ new portable build '.repeat(2000));
const sha = crypto.createHash('sha256').update(payload).digest('hex');

function releaseJson({ version = '1.0.600', digest = `sha256:${sha}`, size = payload.length } = {}) {
    return {
        tag_name: `v${version}`,
        body: '- 修复绿色版更新\n- 新增进度条',
        assets: [
            { name: `Dragon-Platform-Setup-${version}.exe`, browser_download_url: 'https://example.invalid/setup.exe', size: 1 },
            { name: `Dragon-Platform-Portable-${version}.exe`, browser_download_url: 'https://example.invalid/portable.exe', size, digest }
        ]
    };
}
function fakeFetch({ release = releaseJson(), body = payload, chunk = 4096, status = 200 } = {}) {
    const calls = [];
    const impl = async (url, init) => {
        calls.push({ url, init });
        if (url.includes('api.github.com')) return { ok: status < 400, status, json: async () => release };
        let offset = 0;
        return {
            ok: true, status: 200, headers: { get: name => (name === 'content-length' ? String(body.length) : null) },
            body: { getReader: () => ({ read: async () => (offset >= body.length ? { done: true } : { done: false, value: new Uint8Array(body.subarray(offset, (offset += chunk))) }) }) }
        };
    };
    impl.calls = calls;
    return impl;
}
function setup(overrides = {}) {
    const dir = tmp(), userData = tmp();
    const exePath = path.join(dir, 'Dragon-Platform-Portable-1.0.546.exe');
    fs.writeFileSync(exePath, 'old build');
    const statuses = [], spawns = [];
    let quits = 0;
    const updater = createPortableUpdater({
        exePath, currentVersion: '1.0.546', releaseUrl: RELEASE_URL, userDataDir: userData,
        fetchImpl: fakeFetch(overrides.fetch), onStatus: s => statuses.push(s),
        spawnImpl: (file, args, options) => { spawns.push({ file, args, options }); return { unref() {} }; },
        quit: () => { quits += 1; }, pid: 111, ppid: 222, ...(overrides.updater || {})
    });
    return { dir, userData, exePath, statuses, spawns, updater, quits: () => quits };
}

test('versions compare numerically, ignoring a leading v', () => {
    assert.equal(compareVersions('v1.0.600', '1.0.546'), 1);
    assert.equal(compareVersions('1.0.546', '1.0.546'), 0);
    assert.equal(compareVersions('1.0.99', '1.0.546'), -1);
    assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

test('check reads the latest GitHub release and offers the portable asset with its notes', async () => {
    const { updater, statuses } = setup();
    await updater.check();
    assert.deepEqual(statuses.map(s => s.state), ['checking', 'available']);
    assert.equal(statuses[1].latestVersion, '1.0.600');
    assert.match(statuses[1].releaseNotes, /新增进度条/);
    assert.equal(updater.release.url, 'https://example.invalid/portable.exe', 'portable asset, not the installer');
    assert.equal(updater.release.sha256, sha);
});

test('check reports up to date when the release is not newer or has no portable build, and throws on HTTP errors', async () => {
    for (const release of [releaseJson({ version: '1.0.546' }), { tag_name: 'v9.0.0', assets: [{ name: 'Dragon-Platform-Setup-9.0.0.exe' }] }]) {
        const { updater, statuses } = setup({ fetch: { release } });
        await updater.check();
        assert.equal(statuses.at(-1).state, 'not-available');
        await assert.rejects(updater.download(), /先检查/);
    }
    const { updater } = setup({ fetch: { status: 403 } });
    await assert.rejects(updater.check(), /HTTP 403/);
});

test('download streams into the update cache with rising progress and verifies the hash', async () => {
    const { updater, statuses, userData } = setup();
    await updater.check();
    const file = await updater.download();
    assert.equal(file, path.join(userData, 'portable-updates', 'Dragon-Platform-Portable-1.0.600.update.exe'));
    assert.deepEqual(fs.readFileSync(file), payload);
    assert.equal(fs.existsSync(`${file}.part`), false);
    const progress = statuses.filter(s => s.state === 'downloading').map(s => s.progress);
    assert.ok(progress.length > 5, 'several progress updates');
    assert.deepEqual(progress, [...progress].sort((a, b) => a - b), 'progress never goes backwards');
    assert.ok(progress.at(-1) <= 99);
    const done = statuses.at(-1);
    assert.equal(done.state, 'downloaded');assert.equal(done.progress, 100);assert.equal(done.transferred, payload.length);
});

test('a corrupted or truncated download is rejected and removed', async () => {
    for (const release of [releaseJson({ digest: `sha256:${'0'.repeat(64)}` }), releaseJson({ size: payload.length + 1, digest: '' })]) {
        const { updater, userData } = setup({ fetch: { release } });
        await updater.check();
        await assert.rejects(updater.download(), /校验失败/);
        assert.deepEqual(fs.readdirSync(path.join(userData, 'portable-updates')), [], 'no partial or staged file left');
        assert.throws(() => updater.install(), /尚未下载完成/);
    }
});

test('updates from a legacy chained EXE name use only the next release name for staging', async () => {
    const exePath = path.join(tmp(), 'Dragon-Platform-Portable-1.0.400.update-1.0.546.update.exe');
    fs.writeFileSync(exePath, 'old build');
    const { updater, userData, spawns } = setup({ updater: { exePath } });
    await updater.check();
    assert.equal(await updater.download(), path.join(userData, 'portable-updates', 'Dragon-Platform-Portable-1.0.600.update.exe'));
    updater.install();
    const result = completePortableSwap({ argv: spawns[0].args, selfPath: spawns[0].file, alive: () => false });
    assert.deepEqual(result, { swapped: true, target: exePath });
    assert.deepEqual(fs.readFileSync(exePath), payload);
});

test('install launches the staged EXE detached with the pids to wait for and the original path, then quits', async () => {
    const { updater, spawns, exePath, statuses, quits } = setup();
    await updater.check();
    await updater.download();
    updater.install();
    assert.equal(statuses.at(-1).state, 'installing');
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].file, updater.downloadedPath);
    assert.equal(spawns[0].options.detached, true);
    assert.ok(spawns[0].args.includes(`${WAIT_ARG}111,222`), 'waits for the app and its NSIS launcher');
    const swap = spawns[0].args.find(arg => arg.startsWith(SWAP_ARG));
    assert.equal(Buffer.from(swap.slice(SWAP_ARG.length), 'base64url').toString(), exePath);
    assert.equal(quits(), 1);
});

test('the new build waits for the old processes, then replaces the original EXE and keeps the old one aside', () => {
    const dir = tmp();
    const target = path.join(dir, 'Dragon Claw 绿色版.exe'), self = path.join(dir, 'Dragon-Platform-Portable-1.0.600.update.exe');
    fs.writeFileSync(target, 'old build');fs.writeFileSync(self, 'new build');
    let polls = 0;
    const result = completePortableSwap({
        argv: ['app', `${WAIT_ARG}111,222`, `${SWAP_ARG}${Buffer.from(target).toString('base64url')}`], selfPath: self,
        alive: pid => { polls += 1; return polls <= 4 && pid === 111; }, sleep: () => {}
    });
    assert.deepEqual(result, { swapped: true, target });
    assert.ok(polls > 2, 'waited while the old app was alive');
    assert.equal(fs.readFileSync(target, 'utf8'), 'new build');
    assert.equal(fs.readFileSync(`${target}.old`, 'utf8'), 'old build');
    // Ordinary launches and self-targets do nothing.
    assert.equal(completePortableSwap({ argv: ['app'], selfPath: self }), null);
    assert.equal(completePortableSwap({ argv: ['app', `${SWAP_ARG}${Buffer.from(self).toString('base64url')}`], selfPath: self, alive: () => false }).swapped, false);
});

test('a timeout leaves the original EXE untouched while an old process is still running', () => {
    const dir = tmp();
    const target = path.join(dir, 'Dragon.exe'), selfPath = path.join(dir, 'cached.exe');
    fs.writeFileSync(target, 'old build');
    fs.writeFileSync(selfPath, 'new build');
    let waited = 0;
    const result = completePortableSwap({
        argv: [`${WAIT_ARG}111`, `${SWAP_ARG}${Buffer.from(target).toString('base64url')}`],
        selfPath, alive: () => true, sleep: ms => { waited += ms; }, limitMs: 1050
    });
    assert.equal(waited, 1050);
    assert.deepEqual(result, { swapped: false, target, stage: 'wait', code: 'ETIMEDOUT', error: '等待旧进程退出超时' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'old build');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['Dragon.exe', 'cached.exe']);
});

test('a transient sharing conflict during rename is retried', () => {
    const dir = tmp();
    const target = path.join(dir, 'Dragon.exe'), selfPath = path.join(dir, 'cached.exe');
    fs.writeFileSync(target, 'old build');
    fs.writeFileSync(selfPath, 'new build');
    let retries = 0;
    const fsImpl = { ...fs, renameSync(source, destination) {
        if (source === target && retries < 2) throw Object.assign(new Error('file in use'), { code: 'EBUSY' });
        fs.renameSync(source, destination);
    } };
    const result = completePortableSwap({
        argv: [`${SWAP_ARG}${Buffer.from(target).toString('base64url')}`],
        selfPath, fsImpl, sleep: () => { retries += 1; }
    });
    assert.equal(retries, 2);
    assert.deepEqual(result, { swapped: true, target });
    assert.equal(fs.readFileSync(target, 'utf8'), 'new build');
});

test('a failed replacement restores the original EXE and can be retried', () => {
    const dir = tmp();
    const target = path.join(dir, 'Dragon.exe'), selfPath = path.join(dir, 'cached.exe');
    fs.writeFileSync(target, 'old build');
    fs.writeFileSync(selfPath, 'new build');
    const options = { argv: [`${SWAP_ARG}${Buffer.from(target).toString('base64url')}`], selfPath, alive: () => false, sleep: () => {} };
    const fsImpl = { ...fs, renameSync(source, destination) {
        if (source.endsWith('.part')) throw Object.assign(new Error('access denied'), { code: 'EACCES' });
        fs.renameSync(source, destination);
    } };
    assert.deepEqual(completePortableSwap({ ...options, fsImpl }), { swapped: false, target, stage: 'replace', code: 'EACCES', error: 'access denied' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'old build');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['Dragon.exe', 'cached.exe']);
    assert.deepEqual(completePortableSwap(options), { swapped: true, target });
    assert.equal(fs.readFileSync(target, 'utf8'), 'new build');
});

test('cleanup removes the target backup and cached files while preserving running and neighboring EXEs', () => {
    const dir = tmp(), userData = tmp();
    const exe = path.join(dir, 'Dragon-Platform-Portable-1.0.546.exe');
    for (const name of ['Dragon-Platform-Portable-1.0.546.exe', 'Dragon-Platform-Portable-1.0.546.exe.old', 'Dragon-Platform-Portable-1.0.600.update.exe', 'Dragon-Platform-Portable-1.0.600.update.exe.part', 'notes.txt']) fs.writeFileSync(path.join(dir, name), 'x');
    const cacheDir = path.join(userData, 'portable-updates');
    const runningExePath = path.join(cacheDir, 'Dragon-Platform-Portable-1.0.600.update.exe');
    const cachedPart = path.join(cacheDir, 'Dragon-Platform-Portable-1.0.650.update.exe.part');
    fs.mkdirSync(cacheDir);
    fs.writeFileSync(runningExePath, 'x');
    fs.writeFileSync(cachedPart, 'x');
    const removed = cleanupPortableLeftovers({ exePath: exe, runningExePath, userDataDir: userData });
    assert.deepEqual(removed.sort(), [`${exe}.old`, cachedPart].sort());
    assert.ok(fs.existsSync(exe));
    assert.ok(fs.existsSync(runningExePath));
    assert.ok(fs.existsSync(path.join(dir, 'Dragon-Platform-Portable-1.0.600.update.exe')));
    assert.deepEqual(cleanupPortableLeftovers({ exePath: exe, userDataDir: userData }), [runningExePath]);
});

test('every root module electron-main.js requires is packaged (a missing file once broke 1.0.544)', () => {
    const root = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8');
    const files = require('../package.json').build.files;
    const rootModules = [...new Set([...main.matchAll(/require\('\.\/([\w.-]+?)(?:\.js)?'\)/g)].map(m => `${m[1]}.js`))];
    assert.ok(rootModules.includes('desktop-portable-updater.js'));
    for (const file of rootModules) {
        assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
        assert.ok(files.includes(file), `${file} is listed in package.json build.files`);
    }
});
