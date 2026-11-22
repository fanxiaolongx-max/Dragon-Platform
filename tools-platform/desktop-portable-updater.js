'use strict';
// 绿色版（便携版）自动更新。
// electron-updater 只支持安装版：它下载 NSIS 安装包静默重装到安装目录；便携版没有安装目录，
// electron-builder 也不给便携版生成 app-update.yml。这里自己实现：
//   检查：读 GitHub 最新发行版，找 Dragon-Platform-Portable-<版本>.exe；
//   下载：写到用户数据目录的 portable-updates，使用发行资产名，校验大小与 SHA-256；
//   安装：启动新 EXE 并带上旧进程 pid 后退出。旧版 NSIS 启动器运行期间锁着自己的 EXE（不允许改名），
//        所以由新版在启动最早期等旧进程全部退出后，把旧 EXE 改名为 .old、把自己复制回原文件名；
//        以后从原位置启动的就是新版，残留的 .old / .update.exe 下次启动时清理。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTABLE_ASSET = /^Dragon-Platform-Portable-(\d+\.\d+\.\d+)\.exe$/i;
const SWAP_ARG = '--dragon-portable-swap=';
const WAIT_ARG = '--dragon-wait-pids=';
const WAIT_LIMIT_MS = 30000;

function compareVersions(a, b) {
    const parse = value => String(value || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => Number(n) || 0);
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
}

function parseRepo(releaseUrl) {
    const match = String(releaseUrl || '').match(/github\.com\/([^/]+)\/([^/]+)/);
    return match ? { owner: match[1], repo: match[2] } : null;
}

function createPortableUpdater({
    exePath, currentVersion, releaseUrl, userDataDir, fetchImpl, spawnImpl, quit, onStatus = () => {},
    fsImpl = fs, now = () => Date.now(), pid = process.pid, ppid = process.ppid
}) {
    const repo = parseRepo(releaseUrl);
    let release = null;
    let downloadedPath = '';
    let downloading = null;

    async function check() {
        if (!repo) throw new Error('未配置 GitHub 发行地址');
        onStatus({ state: 'checking', message: '正在检查更新...', progress: 0 });
        const res = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DragonClaw-Portable-Updater' }
        });
        if (!res.ok) throw new Error(`读取 GitHub 发行版失败（HTTP ${res.status}）`);
        const data = await res.json();
        const latestVersion = String(data.tag_name || data.name || '').replace(/^v/i, '');
        const asset = (Array.isArray(data.assets) ? data.assets : []).find(item => PORTABLE_ASSET.test(item.name || ''));
        if (!asset || compareVersions(latestVersion, currentVersion) <= 0) {
            release = null;
            return onStatus({ state: 'not-available', latestVersion: latestVersion || currentVersion, message: '当前已是最新版本', progress: 0 });
        }
        const digest = /^sha256:([a-f0-9]{64})$/i.exec(String(asset.digest || ''));
        release = {
            version: latestVersion,
            name: asset.name,
            url: asset.browser_download_url,
            size: Number(asset.size) || 0,
            sha256: digest ? digest[1].toLowerCase() : '',
            releaseNotes: String(data.body || '')
        };
        if (downloadedPath && path.basename(downloadedPath) !== stagedName(release)) downloadedPath = '';
        return onStatus({ state: 'available', latestVersion, releaseNotes: release.releaseNotes, message: `发现新版本 ${latestVersion}`, progress: 0 });
    }

    async function download() {
        if (!release) throw new Error('请先检查并确认有可用更新');
        if (downloading) return downloading;
        downloading = (async () => {
            const downloadingRelease = release;
            const dir = path.join(userDataDir, 'portable-updates');
            fsImpl.mkdirSync(dir, { recursive: true });
            const finalPath = path.join(dir, stagedName(downloadingRelease));
            const partPath = `${finalPath}.part`;
            onStatus({ state: 'downloading', message: '正在准备下载更新...', progress: 0, total: downloadingRelease.size, transferred: 0 });
            const res = await fetchImpl(downloadingRelease.url, { headers: { 'User-Agent': 'DragonClaw-Portable-Updater' } });
            if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）`);
            const total = Number(res.headers?.get?.('content-length')) || downloadingRelease.size;
            const hash = crypto.createHash('sha256');
            const fd = fsImpl.openSync(partPath, 'w');
            let transferred = 0;
            let lastPercent = -1;
            const startedAt = now();
            try {
                const reader = res.body.getReader();
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const chunk = Buffer.from(value);
                    fsImpl.writeSync(fd, chunk);
                    hash.update(chunk);
                    transferred += chunk.length;
                    const percent = total ? Math.min(99, Math.floor(transferred / total * 100)) : 0;
                    if (percent !== lastPercent) {
                        lastPercent = percent;
                        const seconds = Math.max(0.001, (now() - startedAt) / 1000);
                        onStatus({ state: 'downloading', message: `正在下载更新 ${percent}%`, progress: percent, transferred, total, bytesPerSecond: Math.round(transferred / seconds) });
                    }
                }
            } finally {
                fsImpl.closeSync(fd);
            }
            const actual = hash.digest('hex');
            if ((downloadingRelease.size && transferred !== downloadingRelease.size) || (downloadingRelease.sha256 && actual !== downloadingRelease.sha256)) {
                try { fsImpl.unlinkSync(partPath); } catch { /* ignore */ }
                throw new Error('下载的更新文件校验失败，请重试');
            }
            try { fsImpl.unlinkSync(finalPath); } catch { /* 不存在 */ }
            fsImpl.renameSync(partPath, finalPath);
            downloadedPath = finalPath;
            onStatus({ state: 'downloaded', latestVersion: downloadingRelease.version, message: '更新已下载，重启后生效', progress: 100, transferred, total });
            return finalPath;
        })();
        try { return await downloading; } finally { downloading = null; }
    }

    function install() {
        if (!downloadedPath) throw new Error('更新尚未下载完成');
        onStatus({ state: 'installing', message: '正在重启并安装更新...', progress: 100 });
        const args = [`${WAIT_ARG}${[pid, ppid].filter(Boolean).join(',')}`, `${SWAP_ARG}${Buffer.from(exePath).toString('base64url')}`];
        spawnImpl(downloadedPath, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exePath) }).unref?.();
        quit();
    }

    return { check, download, install, get release() { return release; }, get downloadedPath() { return downloadedPath; } };
}

function stagedName(release) {
    return release.name.replace(/\.exe$/i, '.update.exe');
}

function pidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(fsImpl, from, to, sleep) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            fsImpl.renameSync(from, to);
            return;
        } catch (error) {
            // Windows can report both sharing conflicts and permanent access failures with these codes.
            if (attempt === 5 || !['EBUSY', 'EACCES', 'EPERM'].includes(error.code)) throw error;
            sleep(200);
        }
    }
}

/**
 * 新版启动的最早期调用（在单实例锁之前）：等旧版进程退出，再把自己换到原 EXE 的位置。
 * 返回 { swapped, target, error }；没有更新参数时返回 null。
 */
function completePortableSwap({ argv = process.argv, selfPath = process.env.PORTABLE_EXECUTABLE_FILE, fsImpl = fs, alive = pidAlive, sleep = sleepSync, limitMs = WAIT_LIMIT_MS } = {}) {
    const waitArg = argv.find(arg => arg.startsWith(WAIT_ARG));
    const swapArg = argv.find(arg => arg.startsWith(SWAP_ARG));
    if (!waitArg && !swapArg) return null;
    const pids = (waitArg ? waitArg.slice(WAIT_ARG.length) : '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
    for (let waited = 0; waited < limitMs && pids.some(alive); waited += 200) sleep(Math.min(200, limitMs - waited));
    if (!swapArg || !selfPath) return { swapped: false, target: '' };
    let target = '';
    try { target = Buffer.from(swapArg.slice(SWAP_ARG.length), 'base64url').toString(); } catch { target = ''; }
    if (!target || path.resolve(target) === path.resolve(selfPath)) return { swapped: false, target };
    if (pids.some(alive)) {
        return { swapped: false, target, stage: 'wait', code: 'ETIMEDOUT', error: '等待旧进程退出超时' };
    }
    const replacement = path.join(path.dirname(target), `.dragon-update-${crypto.randomUUID()}.part`);
    const backup = `${target}.old`;
    let stage = 'copy';
    let movedOriginal = false;
    try {
        fsImpl.copyFileSync(selfPath, replacement);
        if (fsImpl.existsSync(target)) {
            stage = 'backup';
            renameWithRetry(fsImpl, target, backup, sleep);
            movedOriginal = true;
        }
        stage = 'replace';
        renameWithRetry(fsImpl, replacement, target, sleep);
        return { swapped: true, target };
    } catch (error) {
        const result = { swapped: false, target, stage, code: error.code, error: error.message };
        if (movedOriginal) {
            try { renameWithRetry(fsImpl, backup, target, sleep); } catch (restoreError) {
                result.error += `；恢复原文件失败：${restoreError.message}`;
            }
        }
        return result;
    } finally {
        try { fsImpl.unlinkSync(replacement); } catch { /* 已移动或无法清理 */ }
    }
}

/** 从原位置启动时清理上次更新留下的 .old 与已用过的 .update.exe（正在运行的文件跳过）。 */
function cleanupPortableLeftovers({
    exePath = process.env.PORTABLE_EXECUTABLE_FILE, runningExePath = exePath, userDataDir = '', fsImpl = fs
} = {}) {
    if (!exePath) return [];
    const removed = [];
    const files = [`${exePath}.old`];
    if (userDataDir) {
        const dir = path.join(userDataDir, 'portable-updates');
        try {
            for (const name of fsImpl.readdirSync(dir)) {
                if (/\.update\.exe(\.part)?$/i.test(name)) files.push(path.join(dir, name));
            }
        } catch { /* 更新目录尚未创建 */ }
    }
    const active = [exePath, runningExePath].filter(Boolean).map(file => path.resolve(file));
    for (const file of files) {
        if (!active.includes(path.resolve(file))) {
            try { fsImpl.unlinkSync(file); removed.push(file); } catch { /* 仍在使用或已不存在 */ }
        }
    }
    return removed;
}

module.exports = { createPortableUpdater, completePortableSwap, cleanupPortableLeftovers, compareVersions, PORTABLE_ASSET, SWAP_ARG, WAIT_ARG };
