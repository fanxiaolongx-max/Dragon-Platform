const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { exec, execSync, spawn } = require('child_process');
const { checkAuth, requireAdmin } = require('../middleware/auth');
const authSessionsRepo = require('../models/auth-sessions-repository');
const { getTenantId } = require('../models/tenant-context');
const { getSubtitles, searchShooter, readLimitedBody } = require('../models/media-subtitles');
const {
    DEFAULT_FEINIU_URL,
    normalizeFeiniuUrl,
    signFeiniuAuthx,
    loadFeiniuConfig,
    getPublicFeiniuConfig,
    updateFeiniuConfig,
    syncFeiniuCatalog,
    getCachedFeiniuCatalog,
    resolveFeiniuPlayback,
    ensureFeiniuHlsSession,
    keepFeiniuHlsSessionAlive
} = require('../models/feiniu-service');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const configuredMediaDir = String(process.env.TOOLS_MEDIA_DIR || '').trim();
const VIDEOS_DIR = configuredMediaDir
    ? path.resolve(configuredMediaDir)
    : path.join(FRONTEND_DIR, 'assets/videos');
const MANIFEST_PATH = path.join(VIDEOS_DIR, 'media-manifest.json');
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v']);
const multer = require('multer');
const os = require('os');
const mediaUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 8 * 1024 ** 3, files: 1 } });

function validMediaFolder(name) {
    return typeof name === 'string' && name.trim() && name !== '.' && name !== '..' && !/[\\/\x00-\x1f]/.test(name) && !name.startsWith('.');
}
const DEFAULT_MEDIA_ORDER = 1000;
const CATEGORY_ACCESS_TTL_MS = 30 * 60 * 1000;
const CATEGORY_TOKEN_SECRET = crypto.randomBytes(32);
const pinFailures = new Map();

function createCategoryPinRecord(pin) {
    if (!/^\d{4}$/.test(String(pin || ''))) {
        throw Object.assign(new Error('PIN 必须是 4 位数字'), { statusCode: 400 });
    }
    const pinSalt = crypto.randomBytes(16).toString('hex');
    const pinHash = crypto.scryptSync(String(pin), pinSalt, 32).toString('hex');
    return { pinSalt, pinHash };
}

function verifyCategoryPin(category, pin) {
    if (!category?.protected || !category.pinSalt || !category.pinHash || !/^\d{4}$/.test(String(pin || ''))) return false;
    const actual = crypto.scryptSync(String(pin), category.pinSalt, 32);
    const expected = Buffer.from(category.pinHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function applyCategoryProtection(category, { protected: shouldProtect, pin } = {}) {
    if (shouldProtect === undefined) return category;
    if (!shouldProtect) {
        category.protected = false;
        delete category.pinSalt;
        delete category.pinHash;
        return category;
    }
    if (pin) Object.assign(category, createCategoryPinRecord(pin));
    if (!category.pinSalt || !category.pinHash) {
        throw Object.assign(new Error('开启隐藏分类时请设置 4 位 PIN'), { statusCode: 400 });
    }
    category.protected = true;
    return category;
}

function sanitizeCategory(category, count) {
    const { pinSalt, pinHash, ...safe } = category;
    return { ...safe, protected: Boolean(category.protected), ...(count !== undefined && { count }) };
}

function signCategoryAccess(categoryId) {
    const payload = Buffer.from(JSON.stringify({ categoryId, expiresAt: Date.now() + CATEGORY_ACCESS_TTL_MS })).toString('base64url');
    const signature = crypto.createHmac('sha256', CATEGORY_TOKEN_SECRET).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verifyCategoryAccess(token, categoryId) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) return false;
    const expected = crypto.createHmac('sha256', CATEGORY_TOKEN_SECRET).update(payload).digest();
    let actual;
    try { actual = Buffer.from(signature, 'base64url'); } catch (_) { return false; }
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return data.categoryId === categoryId && Number(data.expiresAt) > Date.now();
    } catch (_) {
        return false;
    }
}

function findMediaCategory(categories, value) {
    return (categories || []).find(category => category.id !== 'all' && (
        category.id === value || category.folder === value || category.name === value
    ));
}

function categoryForVideo(categories, video) {
    return findMediaCategory(categories, video.category) || findMediaCategory(categories, video.folder);
}

function withCategoryAccess(video, token) {
    const appendAccess = url => {
        if (!url || !url.startsWith('/assets/videos/')) return url;
        return `${url}${url.includes('?') ? '&' : '?'}access=${encodeURIComponent(token)}`;
    };
    return { ...video, src: appendAccess(video.src), poster: appendAccess(video.poster), backdrop: appendAccess(video.backdrop) };
}

function pinFailureKey(req, categoryId) {
    return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${categoryId}`;
}

function getPinAttemptBlock(req, categoryId) {
    const key = pinFailureKey(req, categoryId);
    const record = pinFailures.get(key);
    if (!record) return null;
    if (record.blockedUntil > Date.now()) return Math.ceil((record.blockedUntil - Date.now()) / 1000);
    if (record.firstAt + 10 * 60 * 1000 < Date.now()) pinFailures.delete(key);
    return null;
}

function recordPinFailure(req, categoryId) {
    const key = pinFailureKey(req, categoryId);
    const now = Date.now();
    const previous = pinFailures.get(key);
    const record = !previous || previous.firstAt + 10 * 60 * 1000 < now
        ? { count: 1, firstAt: now, blockedUntil: 0 }
        : { ...previous, count: previous.count + 1 };
    if (record.count >= 5) record.blockedUntil = now + 5 * 60 * 1000;
    pinFailures.set(key, record);
}

function resolveMediaPath(relativePath) {
    const resolved = path.resolve(VIDEOS_DIR, relativePath || '');
    if (resolved !== VIDEOS_DIR && !resolved.startsWith(VIDEOS_DIR + path.sep)) {
        throw new Error('无效的媒体文件路径');
    }
    return resolved;
}

function moveMediaAssetFiles(sourceRelativePath, targetFolder) {
    const sourcePath = resolveMediaPath(sourceRelativePath);
    const fileName = path.basename(sourceRelativePath);
    const targetRelativePath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
    const targetPath = resolveMediaPath(targetRelativePath);
    if (sourcePath === targetPath) return targetRelativePath;
    if (!fs.existsSync(sourcePath)) throw Object.assign(new Error('视频文件不存在'), { statusCode: 404 });
    if (fs.existsSync(targetPath)) throw Object.assign(new Error('目标分类中已存在同名视频'), { statusCode: 409 });

    const extension = path.extname(sourcePath);
    const sourceBase = sourcePath.slice(0, -extension.length);
    const targetBase = targetPath.slice(0, -extension.length);
    const relatedFiles = [
        [sourceBase + '_poster.jpg', targetBase + '_poster.jpg'],
        [sourceBase + '.jpg', targetBase + '.jpg']
    ].filter(([source]) => fs.existsSync(source));
    if (relatedFiles.some(([, target]) => fs.existsSync(target))) {
        throw Object.assign(new Error('目标分类中已存在同名封面'), { statusCode: 409 });
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const movedFiles = [];
    try {
        fs.renameSync(sourcePath, targetPath);
        movedFiles.push([sourcePath, targetPath]);
        relatedFiles.forEach(([source, target]) => {
            fs.renameSync(source, target);
            movedFiles.push([source, target]);
        });
    } catch (error) {
        movedFiles.reverse().forEach(([source, target]) => {
            try { fs.renameSync(target, source); } catch (_) {}
        });
        throw error;
    }
    return targetRelativePath;
}

// 确保主目录存在
if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

/**
 * 读取或初始化媒体清单元数据
 */
function readManifest() {
    try {
        if (fs.existsSync(MANIFEST_PATH)) {
            const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn('[Media] 读取 media-manifest.json 异常，使用默认结构:', e.message);
    }
    return {
        categories: [
            { id: 'all', name: '全部', icon: '🎬', folder: '' },
            { id: 'film', name: '独家电影', icon: '🌟', folder: '' },
            { id: 'ay-daily', name: '阿语日常', icon: '🗣️', folder: '阿语日常' },
            { id: 'ay-letters', name: '阿语字母', icon: '🔤', folder: '阿语字母' }
        ],
        videos: {}
    };
}

/**
 * 保存媒体清单
 */
function writeManifest(manifest) {
    try {
        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
    } catch (e) {
        console.error('[Media] 保存 media-manifest.json 失败:', e);
    }
}

/**
 * 获取磁盘空间信息
 */
function getDiskSpace() {
    try {
        const out = execSync('df -k "' + FRONTEND_DIR + '"', { encoding: 'utf8' });
        const lines = out.trim().split('\n');
        if (lines.length >= 2) {
            const parts = lines[1].replace(/\s+/g, ' ').split(' ');
            const totalKb = parseInt(parts[1], 10);
            const availKb = parseInt(parts[3], 10);
            const usedKb = parseInt(parts[2], 10);
            return {
                totalGb: (totalKb / (1024 * 1024)).toFixed(1),
                freeGb: (availKb / (1024 * 1024)).toFixed(1),
                usedGb: (usedKb / (1024 * 1024)).toFixed(1)
            };
        }
    } catch (e) {
        // fallback
    }
    return { totalGb: '512.0', freeGb: '10.0', usedGb: '400.0' };
}

function normalizeMediaOrder(savedOrder, isDragonRestaurant = false) {
    const parsed = Number(savedOrder);
    if (Number.isSafeInteger(parsed)) return parsed;
    return isDragonRestaurant ? 0 : DEFAULT_MEDIA_ORDER;
}

function compareMediaOrder(a, b) {
    if (a.order !== b.order) return a.order - b.order;
    return a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true });
}

function normalizeMediaCategoryOrder(savedOrder, fallbackOrder = 0) {
    const parsed = Number(savedOrder);
    return Number.isSafeInteger(parsed) ? parsed : fallbackOrder;
}

function sortMediaCategories(categories = []) {
    return categories
        .map((category, index) => ({
            ...category,
            order: normalizeMediaCategoryOrder(category.order, Math.max(0, index - 1) * 10),
            sourceIndex: index
        }))
        .sort((a, b) => {
            if (a.id === 'all') return -1;
            if (b.id === 'all') return 1;
            if (a.order !== b.order) return a.order - b.order;
            return a.sourceIndex - b.sourceIndex;
        })
        .map(({ sourceIndex, ...category }) => category);
}

function nextMediaCategoryOrder(categories = []) {
    const managed = sortMediaCategories(categories).filter(category => category.id !== 'all');
    return managed.length ? Math.max(...managed.map(category => category.order)) + 10 : 0;
}

/**
 * 递归扫描磁盘视频并与清单元数据融合
 */
function scanMediaList() {
    const manifest = readManifest();
    const categoriesMap = new Map();
    (manifest.categories || []).forEach(cat => categoriesMap.set(cat.folder || '', cat));

    const videos = [];
    const scannedFolders = new Set(['']);

    function scanDir(currentDir, relativeFolder) {
        if (!fs.existsSync(currentDir)) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        // 收集文件夹
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name.startsWith('.')) continue;
                const subRel = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name;
                scannedFolders.add(subRel);
                scanDir(path.join(currentDir, entry.name), subRel);
            }
        }

        // 收集视频文件
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (entry.name.startsWith('.')) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!VIDEO_EXTS.has(ext)) continue;

            const baseName = path.basename(entry.name, ext);
            const relFilePath = relativeFolder ? `${relativeFolder}/${entry.name}` : entry.name;
            const fullPath = path.join(currentDir, entry.name);
            let stat = { size: 0, mtimeMs: Date.now() };
            try {
                stat = fs.statSync(fullPath);
            } catch (e) {}

            const videoId = encodeURIComponent(relFilePath.replace(/\//g, '___'));

            // 检查是否有对应的同名封面图片
            const possiblePosterRel = relativeFolder ? `${relativeFolder}/${baseName}_poster.jpg` : `${baseName}_poster.jpg`;
            const possibleThumbRel = relativeFolder ? `${relativeFolder}/${baseName}.jpg` : `${baseName}.jpg`;
            let posterUrl = '/assets/videos/龙餐馆_poster.jpg';
            if (fs.existsSync(path.join(VIDEOS_DIR, possiblePosterRel))) {
                posterUrl = `/assets/videos/${encodeURI(possiblePosterRel)}`;
            } else if (fs.existsSync(path.join(VIDEOS_DIR, possibleThumbRel))) {
                posterUrl = `/assets/videos/${encodeURI(possibleThumbRel)}`;
            }

            // 元数据融合
            const savedMeta = (manifest.videos && (manifest.videos[videoId] || manifest.videos[relFilePath] || manifest.videos[baseName])) || {};
            const catObj = categoriesMap.get(relativeFolder) || { id: relativeFolder || 'film', name: relativeFolder || '独家影音' };
            const isDragonRestaurant = baseName.includes('龙餐馆');
            const defaultTitle = isDragonRestaurant ? '龙餐馆' : baseName;

            videos.push({
                id: videoId,
                title: savedMeta.title || defaultTitle,
                fileName: entry.name,
                relPath: relFilePath,
                folder: relativeFolder,
                category: savedMeta.category || catObj.id || 'default',
                categoryName: savedMeta.categoryName || catObj.name || (relativeFolder || '默认分类'),
                fileSize: stat.size,
                fileSizeFormatted: (stat.size / (1024 * 1024)).toFixed(1) + ' MB',
                format: ext.replace('.', '').toUpperCase(),
                src: `/assets/videos/${encodeURI(relFilePath)}`,
                poster: savedMeta.poster || posterUrl,
                durationFormatted: savedMeta.durationFormatted || '点播',
                resolution: savedMeta.resolution || (entry.name.includes('1334x720') ? '720P HD' : 'HD'),
                codec: savedMeta.codec || 'H.264 (AVC)',
                audioCodec: savedMeta.audioCodec || 'AAC Stereo 44.1kHz',
                tags: savedMeta.tags || [relativeFolder ? relativeFolder : '独家', '高清'],
                description: savedMeta.description || `${catObj.name || '本地媒体'}：${baseName}`,
                order: normalizeMediaOrder(savedMeta.order, isDragonRestaurant),
                mtime: stat.mtimeMs
            });
        }
    }

    scanDir(VIDEOS_DIR, '');

    // 自动补齐清单中可能新增的物理文件夹分类
    let manifestChanged = false;
    for (const f of scannedFolders) {
        if (f && !categoriesMap.has(f)) {
            const newCat = {
                id: `folder-${Buffer.from(f).toString('hex').slice(0, 8)}`,
                name: f,
                icon: '📁',
                folder: f,
                order: nextMediaCategoryOrder(manifest.categories)
            };
            manifest.categories.push(newCat);
            categoriesMap.set(f, newCat);
            manifestChanged = true;
        }
    }
    if (manifestChanged) {
        writeManifest(manifest);
    }

    // 融合飞牛影视分类与视频
    const feiniuCatalog = getCachedFeiniuCatalog();
    const allCategories = [...(manifest.categories || [])];
    const existingCatIds = new Set(allCategories.map(c => c.id));
    (feiniuCatalog.categories || []).forEach(fnCat => {
        if (!existingCatIds.has(fnCat.id)) {
            allCategories.push(fnCat);
            existingCatIds.add(fnCat.id);
        }
    });

    (feiniuCatalog.videos || []).forEach(fnVideo => {
        const savedMeta = (manifest.videos && manifest.videos[fnVideo.id]) || {};
        const resolvedOrder = savedMeta.order !== undefined
            ? normalizeMediaOrder(savedMeta.order, false)
            : fnVideo.order;
        videos.push({
            ...fnVideo,
            ...(savedMeta.title && { title: savedMeta.title }),
            ...(savedMeta.category && { category: savedMeta.category }),
            ...(savedMeta.categoryName && { categoryName: savedMeta.categoryName }),
            ...(savedMeta.tags && { tags: savedMeta.tags }),
            ...(savedMeta.description && { description: savedMeta.description }),
            order: resolvedOrder
        });
    });

    // 默认排序：有指定 order 的优先，否则按文件名自然升序（适合 01_, 02_ 连载剧集）
    videos.sort(compareMediaOrder);

    return {
        categories: sortMediaCategories(allCategories),
        videos
    };
}

async function scanMediaListAsync({ forceFeiniuSync = false } = {}) {
    await syncFeiniuCatalog({ force: forceFeiniuSync, defaultMediaOrder: DEFAULT_MEDIA_ORDER });
    return scanMediaList();
}

function videoMatchesAsset(video, relativePath) {
    if (video.relPath === relativePath) return true;
    const extension = path.extname(video.relPath);
    const base = extension ? video.relPath.slice(0, -extension.length) : video.relPath;
    if (relativePath === `${base}_poster.jpg` || relativePath === `${base}.jpg`) return true;
    for (const url of [video.poster, video.backdrop]) {
        if (!url?.startsWith('/assets/videos/')) continue;
        const savedPath = decodeURIComponent(url.slice('/assets/videos/'.length).split('?')[0]);
        if (savedPath === relativePath) return true;
    }
    return false;
}

async function hasAdminMediaSession(req) {
    const authHeader = req.headers.authorization;
    const cookieToken = String(req.headers.cookie || '').split(';')
        .map(item => item.trim())
        .find(item => item.startsWith('tools_token='))
        ?.slice('tools_token='.length);
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;
    if (!token) return false;
    try {
        const session = await authSessionsRepo.getSession(token);
        return Boolean(session && session.expiresAt >= Date.now() && session.user?.role === 'admin');
    } catch (_) {
        return false;
    }
}

async function mediaAssetGuard(req, res, next) {
    try {
        const relativePath = decodeURIComponent(req.path).replace(/^\/+/, '');
        const { categories, videos } = scanMediaList();
        const matchedVideo = videos.find(video => videoMatchesAsset(video, relativePath));
        const category = matchedVideo && categoryForVideo(categories, matchedVideo);
        if (!category?.protected) return next();
        if (verifyCategoryAccess(req.query.access, category.id) || await hasAdminMediaSession(req)) return next();
        return res.status(403).json({ error: '该媒体需要 PIN 验证', code: 'MEDIA_PIN_REQUIRED' });
    } catch (error) {
        return res.status(400).json({ error: error.message || '无效的媒体路径' });
    }
}

// ============================================================
// 公开点播 API (无需鉴权)
// ============================================================
// Same visibility boundary as /public/list; the browser cannot supply a URL or file path.
router.get('/public/subtitles/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const { categories, videos } = scanMediaList();
        const item = videos.find(video => video.id === req.params.id);
        if (!item) return res.status(404).json({ error: '视频不存在', code: 'MEDIA_NOT_FOUND' });
        const category = categoryForVideo(categories, item);
        if (category?.protected && !verifyCategoryAccess(req.query.access, category.id) && !await hasAdminMediaSession(req)) {
            return res.status(403).json({ error: '该媒体需要 PIN 验证', code: 'MEDIA_PIN_REQUIRED' });
        }
        const revision = item.source === 'feiniu' ? item.feiniuMediaGuid : item.mtime;
        const key = JSON.stringify([getTenantId(), VIDEOS_DIR, item.id, item.fileSize, revision]);
        const tracks = await getSubtitles(key, async () => {
            if (item.source === 'feiniu') {
                const { origin, token, streamMeta } = await resolveFeiniuPlayback(item.feiniuGuid);
                const rangePath = `/v/api/v1/media/range/${encodeURIComponent(streamMeta.mediaGuid)}`;
                let size = Number(streamMeta.fileSize) || Number(item.fileSize);
                const readRange = async (offset, length) => {
                    const upstream = await fetch(`${origin}${rangePath}`, {
                        headers: {
                            authx: signFeiniuAuthx('GET', rangePath),
                            ...(token && { authorization: token, Cookie: `Trim-MC-token=${token}` }),
                            Range: `bytes=${offset}-${offset + length - 1}`,
                            'Accept-Encoding': 'identity'
                        },
                        signal: AbortSignal.timeout(6000), redirect: 'error'
                    });
                    const match = String(upstream.headers.get('content-range') || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
                    if (upstream.status !== 206 || !match || Number(match[1]) !== offset || Number(match[2]) !== offset + length - 1) {
                        await upstream.body?.cancel();
                        throw new Error('Media range unsupported');
                    }
                    size = Number(match[3]);
                    return readLimitedBody(upstream, length);
                };
                if (!size) await readRange(0, 1);
                return searchShooter({ size, readRange, fileName: streamMeta.fileName || item.fileName });
            }
            const filePath = await fs.promises.realpath(resolveMediaPath(item.relPath));
            const mediaRoot = await fs.promises.realpath(VIDEOS_DIR);
            if (!filePath.startsWith(mediaRoot + path.sep)) throw new Error('Invalid media path');
            const handle = await fs.promises.open(filePath, 'r');
            try {
                const stat = await handle.stat();
                return await searchShooter({
                    size: stat.size, fileName: item.fileName,
                    readRange: async (offset, length) => {
                        const buffer = Buffer.alloc(length);
                        const { bytesRead } = await handle.read(buffer, 0, length, offset);
                        return buffer.subarray(0, bytesRead);
                    }
                });
            } finally { await handle.close(); }
        });
        res.json({ success: true, source: 'shooter', tracks });
    } catch (_) {
        // Subtitle failure is optional and must never interrupt playback or expose upstream credentials.
        res.json({ success: true, source: 'shooter', tracks: [] });
    }
});

router.get('/public/list', async (req, res) => {
    try {
        const { categories, videos } = await scanMediaListAsync();
        const { category, q, access } = req.query;
        const selectedCategory = category && category !== 'all' ? findMediaCategory(categories, category) : null;
        if (selectedCategory?.protected && !verifyCategoryAccess(access, selectedCategory.id)) {
            return res.status(403).json({ error: '该分类需要 PIN 验证', code: 'MEDIA_PIN_REQUIRED' });
        }

        let filtered = videos.filter(video => {
            const videoCategory = categoryForVideo(categories, video);
            return !videoCategory?.protected || videoCategory.id === selectedCategory?.id;
        });
        if (category && category !== 'all') {
            filtered = filtered.filter(v => v.category === selectedCategory?.id || v.folder === selectedCategory?.folder);
        }
        if (q) {
            const query = q.trim().toLowerCase();
            filtered = filtered.filter(v => 
                v.title.toLowerCase().includes(query) ||
                v.fileName.toLowerCase().includes(query) ||
                (v.tags && v.tags.some(t => t.toLowerCase().includes(query)))
            );
        }

        res.setHeader('Cache-Control', 'no-cache');
        const safeCategories = categories.map(item => sanitizeCategory(
            item,
            item.id === 'all' ? videos.length : videos.filter(video => categoryForVideo(categories, video)?.id === item.id).length
        ));
        res.json({
            success: true,
            count: filtered.length,
            total: videos.length,
            categories: safeCategories,
            data: selectedCategory?.protected ? filtered.map(video => withCategoryAccess(video, access)) : filtered
        });
    } catch (err) {
        console.error('[Media API] /public/list error:', err);
        res.status(500).json({ error: '获取媒体列表失败' });
    }
});

/**
 * 飞牛影视海报/剧照代理
 */
router.get('/public/feiniu/image', async (req, res) => {
    try {
        const rawPath = String(req.query.path || '').trim();
        if (!rawPath || !rawPath.startsWith('/')) {
            return res.status(400).json({ error: '无效的图片路径' });
        }
        const config = await loadFeiniuConfig();
        const { origin } = normalizeFeiniuUrl(config.url);
        const apiImgPath = `/v/api/v1/sys/img${rawPath}`;
        const upstream = await fetch(`${origin}${apiImgPath}`, {
            headers: {
                authx: signFeiniuAuthx('GET', apiImgPath),
                ...(config.token && {
                    authorization: config.token,
                    Cookie: `Trim-MC-token=${config.token}`
                })
            }
        });
        if (!upstream.ok) {
            return res.redirect('/assets/videos/龙餐馆_poster.jpg');
        }
        const contentType = upstream.headers.get('content-type') || 'image/webp';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const arrayBuf = await upstream.arrayBuffer();
        res.send(Buffer.from(arrayBuf));
    } catch (_) {
        res.redirect('/assets/videos/龙餐馆_poster.jpg');
    }
});

/**
 * 飞牛影视 HLS 播放列表代理
 */
router.get('/public/feiniu/hls/:guid/index.m3u8', async (req, res) => {
    try {
        const { guid } = req.params;
        let session = await ensureFeiniuHlsSession(guid);
        let upstream = await fetch(`${session.origin}${session.playLink}`, {
            headers: {
                ...(session.token && {
                    authorization: session.token,
                    Cookie: `Trim-MC-token=${session.token}`
                })
            }
        });
        if (upstream.status === 410 || upstream.status === 404) {
            session = await ensureFeiniuHlsSession(guid, { forceNew: true });
            upstream = await fetch(`${session.origin}${session.playLink}`, {
                headers: {
                    ...(session.token && {
                        authorization: session.token,
                        Cookie: `Trim-MC-token=${session.token}`
                    })
                }
            });
        }
        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: '无法读取飞牛 HLS 播放列表' });
        }
        const playlistText = await upstream.text();
        const encodedGuid = encodeURIComponent(guid);
        const rewritten = playlistText.replace(
            /^([A-Za-z0-9_.-]+\.ts)$/gm,
            `/api/media/public/feiniu/hls/${encodedGuid}/$1`
        );
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(rewritten);
    } catch (err) {
        res.status(502).json({ error: err.message || '获取飞牛 HLS 播放列表失败' });
    }
});

/**
 * 飞牛影视 HLS 分片代理（支持会话过期自动重连）
 */
router.get('/public/feiniu/hls/:guid/:segment', async (req, res) => {
    try {
        const { guid, segment } = req.params;
        if (!/^[A-Za-z0-9_.-]+\.ts$/.test(segment)) {
            return res.status(400).json({ error: '无效的 HLS 分片名称' });
        }
        let session = await ensureFeiniuHlsSession(guid);
        let upstream = await fetch(`${session.origin}${session.sessionBase}/${segment}`, {
            headers: {
                ...(session.token && {
                    authorization: session.token,
                    Cookie: `Trim-MC-token=${session.token}`
                })
            }
        });
        if (upstream.status === 410 || upstream.status === 404) {
            const segNum = parseInt(segment, 10) || 0;
            session = await ensureFeiniuHlsSession(guid, {
                forceNew: true,
                startTimestamp: segNum * 4
            });
            upstream = await fetch(`${session.origin}${session.sessionBase}/${segment}`, {
                headers: {
                    ...(session.token && {
                        authorization: session.token,
                        Cookie: `Trim-MC-token=${session.token}`
                    })
                }
            });
        }
        if (!upstream.ok) {
            return res.status(upstream.status).end();
        }
        keepFeiniuHlsSessionAlive(session, (parseInt(segment, 10) || 0) * 4);
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp2t');
        const contentLen = upstream.headers.get('content-length');
        if (contentLen) res.setHeader('Content-Length', contentLen);
        res.setHeader('Cache-Control', 'no-store');
        // Forward bytes as they arrive instead of buffering the whole segment first.
        if (upstream.body) {
            const nodeStream = Readable.fromWeb(upstream.body);
            nodeStream.on('error', () => res.destroy());
            req.on('close', () => nodeStream.destroy());
            nodeStream.pipe(res);
        } else {
            res.end();
        }
    } catch (err) {
        if (!res.headersSent) {
            res.status(502).json({ error: err.message || '获取飞牛视频分片失败' });
        }
    }
});

/**
 * 飞牛影视通用点播流代理（原生兼容视频走 HTTP Range 直链，特殊编码走转码流封装）
 */
router.get('/public/feiniu/stream/:guid', async (req, res) => {
    try {
        const { guid } = req.params;
        const { origin, token, streamMeta } = await resolveFeiniuPlayback(guid);
        const forceRaw = req.query.raw === '1';

        if (streamMeta.directPlayable || forceRaw) {
            const rangePath = `/v/api/v1/media/range/${streamMeta.mediaGuid}`;
            const controller = new AbortController();
            req.on('close', () => controller.abort());

            const headers = {
                authx: signFeiniuAuthx('GET', rangePath),
                ...(token && {
                    authorization: token,
                    Cookie: `Trim-MC-token=${token}`
                })
            };
            if (req.headers.range) {
                headers.Range = req.headers.range;
            }

            const upstream = await fetch(`${origin}${rangePath}`, {
                headers,
                signal: controller.signal
            });
            if (!upstream.ok && upstream.status !== 206) {
                return res.status(upstream.status).json({ error: '获取飞牛媒体流失败' });
            }

            res.status(upstream.status);
            res.setHeader('Accept-Ranges', 'bytes');
            const contentRange = upstream.headers.get('content-range');
            if (contentRange) res.setHeader('Content-Range', contentRange);
            const contentLength = upstream.headers.get('content-length');
            if (contentLength) res.setHeader('Content-Length', contentLength);
            res.setHeader('Content-Type', 'video/mp4');

            if (upstream.body) {
                const nodeStream = Readable.fromWeb(upstream.body);
                nodeStream.on('error', () => {});
                nodeStream.pipe(res);
            } else {
                res.end();
            }
            return;
        }

        // 非浏览器原生支持编码（如 RMVB rv40 / DTS / AC3 / ProRes），通过飞牛转码会话进行零拷贝 fMP4 流式输出
        const startSec = Math.max(0, Math.floor(Number(req.query.start) || 0));
        const session = await ensureFeiniuHlsSession(guid, {
            forceNew: startSec > 0,
            startTimestamp: startSec
        });
        const m3u8Url = `${session.origin}${session.playLink}`;
        const ffmpegBin = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
        const headerArg = session.token
            ? `Authorization: ${session.token}\r\nCookie: Trim-MC-token=${session.token}\r\n`
            : '';

        const ffArgs = [];
        if (headerArg) {
            ffArgs.push('-headers', headerArg);
        }
        ffArgs.push(
            '-i', m3u8Url,
            '-c', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            '-f', 'mp4',
            'pipe:1'
        );

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-store');
        const ff = spawn(ffmpegBin, ffArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
        req.on('close', () => {
            try { ff.kill('SIGTERM'); } catch (_) {}
        });
        ff.on('error', () => {
            if (!res.headersSent) res.status(502).end();
        });
        ff.stdout.pipe(res);
    } catch (err) {
        if (!res.headersSent) {
            res.status(502).json({ error: err.message || '飞牛影视流媒体播放失败' });
        }
    }
});

router.post('/public/unlock', (req, res) => {
    try {
        const { category, pin } = req.body || {};
        const manifest = readManifest();
        const selectedCategory = findMediaCategory(manifest.categories, category);
        if (!selectedCategory?.protected) return res.status(404).json({ error: '未找到需验证的分类' });
        const retryAfter = getPinAttemptBlock(req, selectedCategory.id);
        if (retryAfter) {
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({ error: 'PIN 错误次数过多，请稍后重试', retryAfter });
        }
        if (!verifyCategoryPin(selectedCategory, pin)) {
            recordPinFailure(req, selectedCategory.id);
            return res.status(401).json({ error: 'PIN 不正确' });
        }
        pinFailures.delete(pinFailureKey(req, selectedCategory.id));
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, category: selectedCategory.id, access: signCategoryAccess(selectedCategory.id), expiresIn: CATEGORY_ACCESS_TTL_MS / 1000 });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// ============================================================
// 管理员媒体管理 API (需要超级管理员权限)
// ============================================================
router.use('/admin', checkAuth, requireAdmin);

/**
 * 仪表盘总体概况
 */
router.get('/admin/overview', async (req, res) => {
    try {
        const { categories, videos } = await scanMediaListAsync();
        const feiniu = await getPublicFeiniuConfig();
        const disk = getDiskSpace();
        const totalBytes = videos.reduce((acc, v) => acc + (v.fileSize || 0), 0);
        const folderCounts = {};
        videos.forEach(v => {
            const f = v.folder || '独家影院';
            folderCounts[f] = (folderCounts[f] || 0) + 1;
        });

        res.json({
            success: true,
            totalVideos: videos.length,
            totalCategories: categories.filter(category => category.id !== 'all').length,
            totalSizeFormatted: (totalBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
            disk,
            folderCounts,
            feiniu
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

/**
 * 飞牛影视对接配置读取与保存
 */
router.get('/admin/feiniu/config', async (req, res) => {
    try {
        const data = await getPublicFeiniuConfig();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ error: err.message || '获取飞牛影视配置失败' });
    }
});

const handleSaveFeiniuConfig = async (req, res) => {
    try {
        const data = await updateFeiniuConfig(req.body || {});
        res.json({
            success: true,
            message: data.enabled
                ? `已成功对接飞牛影视「${data.serverName}」，共同步 ${data.totalVideos} 部视频`
                : '已关闭飞牛影视对接',
            data
        });
    } catch (err) {
        res.status(err.statusCode || 400).json({ error: err.message || '保存飞牛影视配置失败' });
    }
};

router.post('/admin/feiniu/config', handleSaveFeiniuConfig);
router.put('/admin/feiniu/config', handleSaveFeiniuConfig);

router.post('/admin/feiniu/sync', async (req, res) => {
    try {
        await syncFeiniuCatalog({ force: true, defaultMediaOrder: DEFAULT_MEDIA_ORDER });
        const data = await getPublicFeiniuConfig();
        if (!data.connected) {
            return res.status(400).json({ error: data.lastError || '同步飞牛影视失败' });
        }
        res.json({
            success: true,
            message: `已同步飞牛影视「${data.serverName}」，共 ${data.totalVideos} 部视频`,
            data
        });
    } catch (err) {
        res.status(500).json({ error: err.message || '同步飞牛影视失败' });
    }
});

/**
 * 获取分类/文件夹列表
 */
router.get('/admin/folders', async (req, res) => {
    try {
        const { categories, videos } = await scanMediaListAsync();
        const foldersWithStats = categories.filter(category => category.id !== 'all').map(cat => {
            const matching = videos.filter(v => v.category === cat.id || v.folder === cat.folder);
            const sizeBytes = matching.reduce((acc, v) => acc + (v.fileSize || 0), 0);
            return sanitizeCategory({
                ...cat,
                count: matching.length,
                sizeFormatted: (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB'
            });
        });
        res.json({ success: true, data: foldersWithStats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 创建新分类/文件夹
 */
router.post('/admin/folders', (req, res) => {
    try {
        const { name, icon, protected: shouldProtect, pin } = req.body || {};
        if (!name || !name.trim()) return res.status(400).json({ error: '分类名称不能为空' });
        const cleanName = name.trim();
        if (!validMediaFolder(cleanName)) return res.status(400).json({ error: '分类名称不能包含路径分隔符或特殊目录名称' });

        const manifest = readManifest();
        const exists = manifest.categories.some(c => c.name === cleanName || c.folder === cleanName);
        if (exists) return res.status(409).json({ error: '同名分类已存在' });
        const category = {
            id: `cat-${Date.now()}`,
            name: cleanName,
            icon: icon || '📁',
            folder: cleanName,
            order: nextMediaCategoryOrder(manifest.categories)
        };
        applyCategoryProtection(category, { protected: Boolean(shouldProtect), pin });

        // 实体目录创建
        const targetDir = path.join(VIDEOS_DIR, cleanName);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        manifest.categories.push(category);
        writeManifest(manifest);

        res.json({ success: true, message: `成功创建分类“${cleanName}”` });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

/**
 * 重命名分类
 */
router.put('/admin/folders/:oldName', (req, res) => {
    try {
        const { oldName } = req.params;
        const { newName, icon, protected: shouldProtect, pin, order } = req.body || {};
        if (!newName || !newName.trim()) return res.status(400).json({ error: '新名称不能为空' });
        const parsedOrder = Number(order);
        if (order !== undefined && !Number.isSafeInteger(parsedOrder)) {
            return res.status(400).json({ error: '分类优先级必须是整数' });
        }

        const manifest = readManifest();
        const cat = findMediaCategory(manifest.categories, oldName);
        if (!cat) return res.status(404).json({ error: '未找到指定分类' });
        if (!validMediaFolder(newName.trim())) return res.status(400).json({ error: '分类名称不能包含路径分隔符或特殊目录名称' });

        // 如果对应磁盘目录存在，执行目录重命名
        const oldDir = path.join(VIDEOS_DIR, cat.folder || oldName);
        const newDir = path.join(VIDEOS_DIR, newName.trim());
        if (fs.existsSync(oldDir) && oldDir !== newDir && cat.folder) {
            fs.renameSync(oldDir, newDir);
        }

        cat.name = newName.trim();
        if (cat.folder) cat.folder = newName.trim();
        if (icon) cat.icon = icon;
        if (order !== undefined) cat.order = parsedOrder;
        applyCategoryProtection(cat, { protected: shouldProtect, pin });
        writeManifest(manifest);

        res.json({ success: true, message: '分类设置保存成功' });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

/**
 * 删除分类/文件夹
 */
router.delete('/admin/folders/:folderName', (req, res) => {
    try {
        const { folderName } = req.params;
        if (!folderName || folderName === 'all') return res.status(400).json({ error: '系统默认分类不可删除' });

        const manifest = readManifest();
        const catIndex = manifest.categories.findIndex(c => c.name === folderName || c.folder === folderName);
        if (catIndex !== -1) {
            manifest.categories.splice(catIndex, 1);
            writeManifest(manifest);
        }

        const targetDir = path.join(VIDEOS_DIR, folderName);
        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }

        res.json({ success: true, message: `已彻底删除分类与目录“${folderName}”` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 获取完整视频列表（管理端视图）
 */
router.get('/admin/videos', async (req, res) => {
    try {
        const { categories, videos } = await scanMediaListAsync();
        res.json({ success: true, count: videos.length, categories: categories.map(category => sanitizeCategory(category)), data: videos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 编辑单个视频元数据
 */
router.put('/admin/videos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, category, tags, description, order } = req.body || {};
        const parsedOrder = Number(order);
        if (order !== undefined && !Number.isSafeInteger(parsedOrder)) {
            return res.status(400).json({ error: '优先级必须是整数' });
        }

        const manifest = readManifest();
        if (!manifest.videos) manifest.videos = {};

        const isFeiniuVideo = String(id || '').startsWith('feiniu___');
        if (isFeiniuVideo) {
            const { categories } = await scanMediaListAsync();
            let selectedCategory;
            if (category !== undefined) {
                selectedCategory = findMediaCategory(categories, category);
                if (!selectedCategory) return res.status(400).json({ error: '请选择有效的媒体分类' });
            }
            manifest.videos[id] = {
                ...(manifest.videos[id] || {}),
                ...(title !== undefined && { title: title.trim() }),
                ...(selectedCategory && { category: selectedCategory.id, categoryName: selectedCategory.name }),
                ...(tags !== undefined && { tags: Array.isArray(tags) ? tags : String(tags).split(',').map(s => s.trim()).filter(Boolean) }),
                ...(description !== undefined && { description: description.trim() }),
                ...(order !== undefined && { order: parsedOrder })
            };
            writeManifest(manifest);
            return res.json({
                success: true,
                message: '更新飞牛视频元数据成功',
                id,
                order: order !== undefined ? parsedOrder : undefined
            });
        }

        const decodedPath = decodeURIComponent(id).replace(/___/g, '/');
        const baseName = path.basename(decodedPath, path.extname(decodedPath));
        const manifestKey = [id, decodedPath, baseName].find(key => manifest.videos[key]) || id;
        let targetPath = decodedPath;
        let selectedCategory;
        if (category !== undefined) {
            selectedCategory = findMediaCategory(manifest.categories, category);
            if (!selectedCategory) return res.status(400).json({ error: '请选择有效的媒体分类' });
            targetPath = moveMediaAssetFiles(decodedPath, selectedCategory.folder || '');
        }

        const targetId = encodeURIComponent(targetPath.replace(/\//g, '___'));
        const savedMeta = {
            ...(manifest.videos[manifestKey] || {}),
            ...(title !== undefined && { title: title.trim() }),
            ...(selectedCategory && { category: selectedCategory.id, categoryName: selectedCategory.name }),
            ...(tags !== undefined && { tags: Array.isArray(tags) ? tags : String(tags).split(',').map(s => s.trim()).filter(Boolean) }),
            ...(description !== undefined && { description: description.trim() }),
            ...(order !== undefined && { order: parsedOrder })
        };
        if (targetPath !== decodedPath) delete savedMeta.poster;
        if (manifestKey !== targetId) delete manifest.videos[manifestKey];
        manifest.videos[targetId] = savedMeta;
        writeManifest(manifest);

        res.json({
            success: true,
            message: selectedCategory ? `视频已移动到“${selectedCategory.name}”` : '更新视频元数据成功',
            id: targetId,
            order: order !== undefined ? parsedOrder : undefined
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

/**
 * 删除单个视频
 */
router.delete('/admin/videos/:id', (req, res) => {
    try {
        const { id } = req.params;
        const decodedPath = decodeURIComponent(id).replace(/___/g, '/');
        const fullPath = path.join(VIDEOS_DIR, decodedPath);

        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }

        // 同时尝试清理海报
        const ext = path.extname(fullPath);
        const posterPath = fullPath.replace(ext, '_poster.jpg');
        if (fs.existsSync(posterPath)) fs.unlinkSync(posterPath);

        const manifest = readManifest();
        if (manifest.videos && manifest.videos[id]) {
            delete manifest.videos[id];
            writeManifest(manifest);
        }

        res.json({ success: true, message: '视频已成功删除' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 一键从本地目录导入视频资源
 */
router.post('/admin/upload', (req, res) => {
    mediaUpload.single('video')(req, res, async error => {
        const temporary = req.file?.path;
        try {
            if (error) return res.status(400).json({ error: error.message });
            const folder = String(req.body.folder || '').trim();
            const name = String(req.body.fileName || '').trim();
            if (!temporary || !validMediaFolder(folder) || !validMediaFolder(name) || !VIDEO_EXTS.has(path.extname(name).toLowerCase())) {
                return res.status(400).json({ error: '请选择有效的视频文件和分类名称' });
            }
            const destination = path.join(VIDEOS_DIR, folder);
            await fs.promises.mkdir(destination, { recursive: true });
            const real = await fs.promises.realpath(destination);
            const root = await fs.promises.realpath(VIDEOS_DIR);
            if (!real.startsWith(root + path.sep)) return res.status(400).json({ error: '无效的目标目录' });
            const ext = path.extname(name);
            let storedName = name;
            for (let index = 0; ; index++) {
                storedName = index ? `${path.basename(name, ext)} (${index})${ext}` : name;
                try {
                    await fs.promises.copyFile(temporary, path.join(real, storedName), fs.constants.COPYFILE_EXCL);
                    break;
                } catch (copyError) {
                    if (copyError.code !== 'EEXIST') throw copyError;
                }
            }
            res.json({ success: true, fileName: storedName });
        } catch (uploadError) {
            res.status(500).json({ error: uploadError.message });
        } finally {
            if (temporary) await fs.promises.unlink(temporary).catch(() => {});
        }
    });
});

router.post('/admin/import-local', async (req, res) => {
    try {
        const { sourcePath, targetFolder, mode } = req.body || {};
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            return res.status(400).json({ error: `源目录不存在或无法访问：${sourcePath}` });
        }

        const folderName = (targetFolder || path.basename(sourcePath)).trim();
        const destDir = path.join(VIDEOS_DIR, folderName);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        // 异步后台拷贝/同步
        const isCopy = mode !== 'link';
        const cmd = isCopy 
            ? `cp -r "${sourcePath}/"* "${destDir}/"`
            : `ln -s "${sourcePath}/"* "${destDir}/"`;

        exec(cmd, (err, stdout, stderr) => {
            if (err) {
                console.error('[Media Import] 后台导入错误:', err);
            } else {
                console.log(`[Media Import] 目录 ${sourcePath} 成功导入至 ${destDir}`);
            }
        });

        // 登记分类
        const manifest = readManifest();
        if (!manifest.categories.some(c => c.folder === folderName)) {
            manifest.categories.push({
                id: `cat-${Date.now()}`,
                name: folderName,
                icon: '📁',
                folder: folderName
            });
            writeManifest(manifest);
        }

        res.json({
            success: true,
            message: `已开始从 ${sourcePath} 导入资源至分类“${folderName}”，后台正在传输文件...`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 重新抽取封面帧
 */
router.post('/admin/extract-poster/:id', (req, res) => {
    try {
        const { id } = req.params;
        const timeOffset = req.body.timeOffset || '00:00:15';
        const decodedPath = decodeURIComponent(id).replace(/___/g, '/');
        const videoFullPath = path.join(VIDEOS_DIR, decodedPath);

        if (!fs.existsSync(videoFullPath)) {
            return res.status(404).json({ error: '视频文件不存在' });
        }

        const ext = path.extname(videoFullPath);
        const posterFullPath = videoFullPath.replace(ext, '_poster.jpg');
        const ffmpegCmd = `/opt/homebrew/bin/ffmpeg -y -ss ${timeOffset} -i "${videoFullPath}" -vframes 1 -q:v 2 "${posterFullPath}"`;

        exec(ffmpegCmd, (err) => {
            if (err) {
                return res.status(500).json({ error: '抽帧失败: ' + err.message });
            }
            res.json({ success: true, message: '封面重绘成功' });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    scanMediaList,
    scanMediaListAsync,
    DEFAULT_FEINIU_URL,
    VIDEOS_DIR,
    DEFAULT_MEDIA_ORDER,
    normalizeMediaOrder,
    compareMediaOrder,
    normalizeMediaCategoryOrder,
    sortMediaCategories,
    moveMediaAssetFiles,
    createCategoryPinRecord,
    verifyCategoryPin,
    verifyCategoryAccess,
    mediaAssetGuard
};
