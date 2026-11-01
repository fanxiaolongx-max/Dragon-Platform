const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const REMOTE_MEDIA_BUNDLES = {
    'tool-mtakhxqm': {
        url: 'https://github.com/fanxiaolongx-max/Dragon-Platform-Media/releases/download/classroom-audio-20261101-1/audio.bundle.zip',
        sha256: 'c39933d2e9ea70ebfc6d6440c11bc7d684d180cd124a289ee3a6752705fc53cc',
        filename: 'audio.bundle.zip',
        expectedCount: 1645
    }
};

const pendingDownloads = new Map();
const pendingAudioReady = new Map();

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 解压指定的资源压缩包至目标音频目录
 * @param {string} audioDir 目标目录
 * @param {string} bundlePath 压缩包路径
 * @param {boolean} [force=false] 是否强制覆盖
 * @returns {Promise<number>} 解压的文件数量
 */
async function unpackToolBundle(audioDir, bundlePath, force = false) {
    const buffer = fs.readFileSync(bundlePath);
    const zip = await JSZip.loadAsync(buffer);
    let extracted = 0;
    fs.mkdirSync(audioDir, { recursive: true });

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const filename = path.basename(relativePath);
        if (!filename.endsWith('.mp3')) continue;

        const destFile = path.join(audioDir, filename);
        if (!force && fs.existsSync(destFile)) continue;

        const content = await zipEntry.async('nodebuffer');
        const tempDest = `${destFile}.part-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tempDest, content);
        fs.renameSync(tempDest, destFile);
        extracted++;
    }
    return extracted;
}

/**
 * 从远端媒体仓库下载内置工具资源包
 * @param {string} toolSlug 工具 slug
 * @param {Object} [options]
 */
async function downloadToolAudioBundle(toolSlug, options = {}) {
    const meta = REMOTE_MEDIA_BUNDLES[toolSlug];
    if (!meta) throw new Error(`未配置 ${toolSlug} 的远端媒体资源地址`);

    if (pendingDownloads.has(toolSlug)) {
        return pendingDownloads.get(toolSlug);
    }

    const promise = (async () => {
        const defaultSourceDir = path.resolve(__dirname, '../builtin-tools');
        const toolDir = options.toolDir || path.join(defaultSourceDir, toolSlug);
        const audioDir = path.join(toolDir, 'audio');
        fs.mkdirSync(audioDir, { recursive: true });
        const bundlePath = path.join(audioDir, meta.filename || 'audio.bundle.zip');

        // 如果已有文件且哈希校验一致，直接复用
        if (fs.existsSync(bundlePath)) {
            try {
                const existingBuffer = fs.readFileSync(bundlePath);
                if (sha256(existingBuffer) === meta.sha256) {
                    return bundlePath;
                }
            } catch (_) {}
        }

        console.log(`[builtin-assets] 正在从媒体仓库按需下载 ${toolSlug} 音频包 (${meta.url})...`);
        const fetchFn = options.fetchImpl || globalThis.fetch;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 180000);
        if (typeof timeout.unref === 'function') timeout.unref();

        let response;
        try {
            response = await fetchFn(meta.url, {
                headers: { 'User-Agent': 'Dragon-Platform/1.0' },
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response || !response.ok) {
            throw new Error(`下载音频包失败: HTTP ${response ? response.status : 'unknown'}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const downloadedHash = sha256(buffer);

        if (downloadedHash !== meta.sha256) {
            throw new Error(`音频包校验失败: 期望 ${meta.sha256}，实际 ${downloadedHash}`);
        }

        const tempPath = `${bundlePath}.part-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tempPath, buffer);
        fs.renameSync(tempPath, bundlePath);
        console.log(`[builtin-assets] ${toolSlug} 音频包下载完成并校验通过 (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
        return bundlePath;
    })();

    pendingDownloads.set(toolSlug, promise);
    try {
        return await promise;
    } finally {
        pendingDownloads.delete(toolSlug);
    }
}

/**
 * 确保工具音频就绪（若无则按需下载并解压）
 * @param {string} toolSlug
 * @param {Object} [options]
 */
async function ensureToolAudioReady(toolSlug, options = {}) {
    if (pendingAudioReady.has(toolSlug)) {
        return pendingAudioReady.get(toolSlug);
    }

    const promise = (async () => {
        const meta = REMOTE_MEDIA_BUNDLES[toolSlug];
        const defaultSourceDir = path.resolve(__dirname, '../builtin-tools');
        const toolDir = options.toolDir || path.join(defaultSourceDir, toolSlug);
        const audioDir = path.join(toolDir, 'audio');
        const bundlePath = path.join(audioDir, meta?.filename || 'audio.bundle.zip');

        let expectedCount = meta?.expectedCount || 1645;
        const manifestPath = path.join(audioDir, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (manifest.audioFileCount) expectedCount = manifest.audioFileCount;
            } catch (_) {}
        }

        const existingMp3s = fs.existsSync(audioDir)
            ? fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'))
            : [];

        if (!options.force && existingMp3s.length >= expectedCount) {
            return {
                ready: true,
                tool: toolSlug,
                dir: audioDir,
                status: 'skipped',
                existingCount: existingMp3s.length
            };
        }

        // 检查本地 bundle 是否存在，不存在则从媒体仓库拉取
        if (!fs.existsSync(bundlePath)) {
            if (!meta) {
                return {
                    ready: false,
                    tool: toolSlug,
                    dir: audioDir,
                    status: 'error',
                    error: '未找到音频包且无远端下载配置'
                };
            }
            await downloadToolAudioBundle(toolSlug, {
                toolDir,
                fetchImpl: options.fetchImpl,
                timeoutMs: options.timeoutMs
            });
        }

        const extracted = await unpackToolBundle(audioDir, bundlePath, options.force);
        const total = fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3')).length;
        return {
            ready: true,
            tool: toolSlug,
            dir: audioDir,
            status: 'extracted',
            extractedCount: extracted,
            totalCount: total
        };
    })();

    pendingAudioReady.set(toolSlug, promise);
    try {
        return await promise;
    } finally {
        pendingAudioReady.delete(toolSlug);
    }
}

/**
 * 检查并自动解压内置工具中的资源压缩包（如 audio.bundle.zip）
 * @param {Object} options
 * @param {string} [options.sourceDir] 内置工具源码目录（默认为 backend/builtin-tools）
 * @param {string} [options.targetDir] 运行时自定义工具目录（如 backend/data/custom-tools）
 * @param {boolean} [options.force] 是否强制覆盖解压
 * @param {boolean} [options.download] 若本地缺少资源包是否立即下载
 */
async function ensureBuiltinToolAssets(options = {}) {
    const defaultSourceDir = path.resolve(__dirname, '../builtin-tools');
    const sourceDir = options.sourceDir ? path.resolve(options.sourceDir) : defaultSourceDir;
    const targetDir = options.targetDir ? path.resolve(options.targetDir) : null;
    const force = Boolean(options.force);
    const allowDownload = Boolean(options.download);

    const results = [];
    const dirsToCheck = [sourceDir];
    if (targetDir && fs.existsSync(targetDir) && targetDir !== sourceDir) {
        dirsToCheck.push(targetDir);
    }

    for (const baseDir of dirsToCheck) {
        if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) continue;
        const toolEntries = fs.readdirSync(baseDir, { withFileTypes: true });

        for (const entry of toolEntries) {
            if (!entry.isDirectory()) continue;
            const toolDir = path.join(baseDir, entry.name);
            const audioDir = path.join(toolDir, 'audio');
            const bundlePath = path.join(audioDir, 'audio.bundle.zip');

            if (!fs.existsSync(bundlePath) && !allowDownload) {
                if (REMOTE_MEDIA_BUNDLES[entry.name]) {
                    const existingMp3s = fs.existsSync(audioDir)
                        ? fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'))
                        : [];
                    results.push({
                        tool: entry.name,
                        dir: audioDir,
                        status: existingMp3s.length > 0 ? 'skipped' : 'on_demand',
                        existingCount: existingMp3s.length,
                        note: '音频包将按需从媒体仓库下载'
                    });
                }
                continue;
            }

            try {
                const readyResult = await ensureToolAudioReady(entry.name, {
                    toolDir,
                    force,
                    fetchImpl: options.fetchImpl,
                    timeoutMs: options.timeoutMs
                });
                results.push(readyResult);
            } catch (err) {
                results.push({
                    tool: entry.name,
                    dir: audioDir,
                    status: 'error',
                    error: err.message
                });
            }
        }
    }

    return results;
}

if (require.main === module) {
    const force = process.argv.includes('--force');
    const download = process.argv.includes('--download');
    console.log(`[builtin-assets] 正在检查内置工具媒体资源包 (force=${force}, download=${download})...`);
    ensureBuiltinToolAssets({ force, download })
        .then(results => {
            for (const item of results) {
                if (item.status === 'extracted') {
                    console.log(`[builtin-assets] ${item.tool}: 已解压 ${item.extractedCount} 个音频文件至 ${item.dir}`);
                } else if (item.status === 'skipped') {
                    console.log(`[builtin-assets] ${item.tool}: 音频已就绪 (${item.existingCount} 个文件)，跳过解压`);
                } else if (item.status === 'on_demand') {
                    console.log(`[builtin-assets] ${item.tool}: 音频包未本地缓存，使用时将按需从媒体仓库下载`);
                } else if (item.status === 'error') {
                    console.error(`[builtin-assets] ${item.tool}: 处理失败 - ${item.error}`);
                }
            }
        })
        .catch(err => {
            console.error('[builtin-assets] 处理失败:', err);
            process.exit(1);
        });
}

module.exports = {
    ensureBuiltinToolAssets,
    ensureToolAudioReady,
    downloadToolAudioBundle,
    unpackToolBundle,
    REMOTE_MEDIA_BUNDLES
};
