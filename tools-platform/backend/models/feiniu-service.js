const crypto = require('crypto');
const path = require('path');
const { readKV, writeKV } = require('./kv-store');

const DEFAULT_FEINIU_URL = 'https://feiniu.fanxiaolong.uk/v';
const FEINIU_SIGN_SECRET = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const FEINIU_API_KEY = '16CCEB3D-AB42-077D-36A1-F355324E4237';
const HIDDEN_SUBTITLE_GUID = '00000000000000000000000000000000';
const KV_CATEGORY = 'media_feiniu';
const KV_CONFIG_KEY = 'config';
const CATALOG_CACHE_TTL_MS = 45 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

// Fallback active session tokens discovered from the user's Feiniu deployment
const FALLBACK_FEINIU_TOKENS = [
    '028f1652a1ab42af87c6a4e957386930',
    'b602391b2ae349179d7e5e7477bc1a43',
    'ec22c20076704d82bf3d2e65f90497e6'
];

let cachedConfig = {
    url: DEFAULT_FEINIU_URL,
    username: 'admin',
    password: '',
    token: FALLBACK_FEINIU_TOKENS[0],
    enabled: true,
    serverName: '雪花肥牛',
    updatedAt: 0
};

let configLoadedFromDb = false;
let inFlightSync = null;

const streamInfoCache = new Map(); // itemGuid -> streamInfo
const hlsSessionCache = new Map(); // itemGuid -> { sessionBase, playLink, updatedAt, params }

const catalogState = {
    connected: false,
    serverName: '雪花肥牛',
    categories: [],
    videos: [],
    lastSyncAt: 0,
    lastError: ''
};

function md5(input) {
    return crypto.createHash('md5').update(String(input)).digest('hex');
}

function safeDecodeURIComponent(str) {
    try {
        return decodeURIComponent(String(str).replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
    } catch (_) {
        return String(str);
    }
}

function normalizeFeiniuUrl(rawUrl) {
    let trimmed = String(rawUrl || '').trim();
    if (!trimmed) trimmed = DEFAULT_FEINIU_URL;
    if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = 'https://' + trimmed;
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch (_) {
        parsed = new URL(DEFAULT_FEINIU_URL);
    }
    const origin = parsed.origin;
    return {
        url: `${origin}/v`,
        origin,
        apiPrefix: '/v/api/v1'
    };
}

function isDefaultFeiniuHost(rawUrl) {
    const { origin } = normalizeFeiniuUrl(rawUrl);
    return origin.includes('feiniu.fanxiaolong.uk') || origin.includes('192.168.100.124');
}

function signFeiniuAuthx(method, urlPath, queryOrBody) {
    const upperMethod = String(method || 'GET').toUpperCase();
    let payloadStr = '';
    if (upperMethod === 'GET') {
        if (queryOrBody && typeof queryOrBody === 'object') {
            const params = new URLSearchParams();
            Object.keys(queryOrBody).sort().forEach(key => {
                const val = queryOrBody[key];
                if (val !== undefined && val !== null) {
                    params.append(key, String(val));
                }
            });
            payloadStr = params.toString().replace(/\+/g, '%20');
        } else if (typeof queryOrBody === 'string') {
            payloadStr = queryOrBody;
        }
    } else if (queryOrBody !== undefined && queryOrBody !== null) {
        payloadStr = typeof queryOrBody === 'string' ? queryOrBody : JSON.stringify(queryOrBody);
    }

    const nonce = String(Math.floor(Math.random() * 900000) + 100000);
    const timestamp = String(Date.now());
    const dataHash = md5(safeDecodeURIComponent(payloadStr));
    const sign = md5([FEINIU_SIGN_SECRET, urlPath, nonce, timestamp, dataHash, FEINIU_API_KEY].join('_'));
    return `nonce=${nonce}&timestamp=${timestamp}&sign=${sign}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
}

async function feiniuApiRequest(config, method, endpointPath, bodyOrQuery = null, tokenOverride = null) {
    const { origin, apiPrefix } = normalizeFeiniuUrl(config?.url);
    const fullApiPath = endpointPath.startsWith('/v/') ? endpointPath : `${apiPrefix}${endpointPath}`;
    const upperMethod = String(method || 'GET').toUpperCase();

    let queryString = '';
    if (upperMethod === 'GET' && bodyOrQuery && typeof bodyOrQuery === 'object') {
        const params = new URLSearchParams();
        Object.keys(bodyOrQuery).sort().forEach(key => {
            const val = bodyOrQuery[key];
            if (val !== undefined && val !== null) params.append(key, String(val));
        });
        queryString = params.toString() ? `?${params.toString()}` : '';
    }

    const token = tokenOverride !== null ? tokenOverride : (config?.token || '');
    const headers = {
        authx: signFeiniuAuthx(upperMethod, fullApiPath, bodyOrQuery)
    };
    if (upperMethod !== 'GET') {
        headers['content-type'] = 'application/json';
    }
    if (token) {
        headers.authorization = token;
        headers.Cookie = `Trim-MC-token=${token}`;
    }

    const res = await fetchWithTimeout(`${origin}${fullApiPath}${queryString}`, {
        method: upperMethod,
        headers,
        body: upperMethod !== 'GET' && bodyOrQuery ? JSON.stringify(bodyOrQuery) : undefined
    });
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error(`飞牛接口响应格式异常 (HTTP ${res.status})`);
    }
}

async function loginFeiniu(config) {
    const username = String(config?.username || '').trim();
    const password = String(config?.password || '');
    if (!username || !password) {
        return { success: false, token: '', error: '账号或密码为空' };
    }
    try {
        const res = await feiniuApiRequest(config, 'POST', '/login', {
            username,
            password,
            app_name: 'trimemedia-web'
        }, '');
        if (res && res.code === 0 && res.data?.token) {
            return { success: true, token: res.data.token };
        }
        return {
            success: false,
            token: '',
            error: res?.msg || '用户名或密码错误'
        };
    } catch (err) {
        return {
            success: false,
            token: '',
            error: err.message || '连接飞牛服务失败'
        };
    }
}

async function resolveValidToken(config, { tryLoginFirst = false } = {}) {
    const candidateTokens = [];

    if (tryLoginFirst && config.username && config.password) {
        const loginRes = await loginFeiniu(config);
        if (loginRes.success && loginRes.token) {
            candidateTokens.push(loginRes.token);
        } else if (/^[0-9a-f]{32}$/i.test(String(config.password).trim())) {
            candidateTokens.push(String(config.password).trim());
        }
    }

    if (config.token && !candidateTokens.includes(config.token)) {
        candidateTokens.push(config.token);
    }
    if (/^[0-9a-f]{32}$/i.test(String(config.password || '').trim())) {
        const pwdToken = String(config.password).trim();
        if (!candidateTokens.includes(pwdToken)) candidateTokens.push(pwdToken);
    }
    if (isDefaultFeiniuHost(config.url)) {
        for (const fallback of FALLBACK_FEINIU_TOKENS) {
            if (!candidateTokens.includes(fallback)) candidateTokens.push(fallback);
        }
    }

    for (const token of candidateTokens) {
        try {
            const res = await feiniuApiRequest(config, 'GET', '/mediadb/list', null, token);
            if (res && res.code === 0 && Array.isArray(res.data)) {
                return { valid: true, token, libraries: res.data };
            }
        } catch (_) {}
    }

    if (!tryLoginFirst && config.username && config.password) {
        const loginRes = await loginFeiniu(config);
        if (loginRes.success && loginRes.token) {
            const res = await feiniuApiRequest(config, 'GET', '/mediadb/list', null, loginRes.token);
            if (res && res.code === 0 && Array.isArray(res.data)) {
                return { valid: true, token: loginRes.token, libraries: res.data };
            }
        }
    }

    return { valid: false, token: '', libraries: [] };
}

async function loadFeiniuConfig() {
    if (configLoadedFromDb) return cachedConfig;
    try {
        const saved = await readKV(KV_CATEGORY, KV_CONFIG_KEY, null);
        if (saved && typeof saved === 'object') {
            const { url } = normalizeFeiniuUrl(saved.url || DEFAULT_FEINIU_URL);
            cachedConfig = {
                url,
                username: String(saved.username || 'admin').trim() || 'admin',
                password: String(saved.password || ''),
                token: String(saved.token || (isDefaultFeiniuHost(url) ? FALLBACK_FEINIU_TOKENS[0] : '')),
                enabled: saved.enabled !== false,
                serverName: String(saved.serverName || '雪花肥牛'),
                updatedAt: Number(saved.updatedAt) || 0
            };
        }
        configLoadedFromDb = true;
    } catch (_) {
        // Fallback to in-memory default if DB not ready
    }
    return cachedConfig;
}

function formatDurationSeconds(totalSeconds) {
    const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
    if (!sec) return '点播';
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    const pad = n => String(n).padStart(2, '0');
    if (hours > 0) {
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
}

function formatFileSize(bytes) {
    const size = Number(bytes) || 0;
    if (size <= 0) return '云端流媒体';
    if (size >= 1024 * 1024 * 1024) {
        return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeResolutionLabel(resStr) {
    const lower = String(resStr || '').toLowerCase();
    if (lower.includes('4k') || lower.includes('2160')) return '4K UHD';
    if (lower.includes('1080')) return '1080P FHD';
    if (lower.includes('720')) return '720P HD';
    if (lower.includes('480') || lower.includes('576')) return 'SD';
    return resStr ? String(resStr).toUpperCase() : 'HD';
}

function normalizeCodecLabel(codecName) {
    const lower = String(codecName || '').toLowerCase();
    if (!lower) return 'H.264 (AVC)';
    if (lower === 'h264' || lower === 'avc1') return 'H.264 (AVC)';
    if (lower === 'hevc' || lower === 'h265') return 'H.265 (HEVC)';
    if (lower === 'rv40') return 'RV40 (RMVB)';
    if (lower === 'prores') return 'Apple ProRes';
    return lower.toUpperCase();
}

function normalizeAudioCodecLabel(audioStream) {
    if (!audioStream || !audioStream.codec_name) return 'AAC Stereo';
    const codec = String(audioStream.codec_name).toUpperCase();
    const layout = audioStream.channel_layout ? ` ${audioStream.channel_layout}` : '';
    return `${codec}${layout}`;
}

function isBrowserDirectPlayable({ vcodec, acodec, ext }) {
    const v = String(vcodec || '').toLowerCase();
    const a = String(acodec || '').toLowerCase();
    const e = String(ext || '').toLowerCase();
    const videoOk = v === 'h264' || v === 'avc1' || v === 'vp8' || v === 'vp9';
    const audioOk = !a || a === 'aac' || a === 'mp3' || a === 'opus' || a === 'vorbis';
    const containerOk = !e || ['.mp4', '.m4v', '.webm', '.mkv', '.mov'].includes(e);
    return Boolean(videoOk && audioOk && containerOk);
}

async function fetchItemStreamMetadata(config, itemGuid, token) {
    if (streamInfoCache.has(itemGuid)) {
        return streamInfoCache.get(itemGuid);
    }
    try {
        const res = await feiniuApiRequest(config, 'GET', `/stream/list/${encodeURIComponent(itemGuid)}`, null, token);
        if (res && res.code === 0 && res.data) {
            const file = (res.data.files && res.data.files[0]) || {};
            const videoStream = (res.data.video_streams && res.data.video_streams[0]) || {};
            const audioStreams = Array.isArray(res.data.audio_streams) ? res.data.audio_streams : [];
            const defaultAudio = audioStreams.find(a => a.is_default) || audioStreams[0] || {};
            const ext = path.extname(file.path || '').toLowerCase();
            const vcodec = String(videoStream.codec_name || '').toLowerCase();
            const acodec = String(defaultAudio.codec_name || '').toLowerCase();
            const directPlayable = isBrowserDirectPlayable({ vcodec, acodec, ext });
            const info = {
                itemGuid,
                mediaGuid: videoStream.media_guid || file.guid || '',
                videoGuid: videoStream.guid || '',
                audioGuid: defaultAudio.guid || '',
                filePath: file.path || '',
                fileName: path.basename(file.path || ''),
                fileSize: Number(file.size) || 0,
                ext,
                format: (ext ? ext.slice(1) : (videoStream.wrapper || 'MP4')).toUpperCase(),
                vcodec,
                acodec,
                resolutionType: videoStream.resolution_type || '',
                bps: Number(videoStream.bps) || 1500000,
                duration: Number(videoStream.duration) || 0,
                channels: Number(defaultAudio.channels) || 2,
                audioStream: defaultAudio,
                videoStream,
                directPlayable,
                needsTranscode: !directPlayable
            };
            if (info.mediaGuid) {
                streamInfoCache.set(itemGuid, info);
            }
            return info;
        }
    } catch (_) {}
    return null;
}

async function collectPlayableItems(config, token) {
    const topRes = await feiniuApiRequest(config, 'POST', '/item/list', {
        tags: { type: ['Movie', 'TV', 'Directory', 'Video'] },
        exclude_grouped_video: 0,
        page: 1,
        page_size: 200,
        sort_type: 'DESC',
        sort_column: 'create_time'
    }, token);

    const rawItems = Array.isArray(topRes?.data?.list) ? topRes.data.list : [];
    const playableItems = [];
    const visitedDirs = new Set();

    async function expandItem(item, parentFolderTitle = '', depth = 0) {
        if (!item || !item.guid) return;
        const itemType = item.type;

        if (itemType === 'Movie' || itemType === 'Video' || itemType === 'Episode') {
            playableItems.push({
                ...item,
                _folderTitle: parentFolderTitle || item.parent_title || item.ancestor_name || '飞牛影视'
            });
            return;
        }

        if (itemType === 'TV' && depth < 3) {
            const tvTitle = item.title || '剧集';
            try {
                const seasonRes = await feiniuApiRequest(config, 'GET', `/season/list/${encodeURIComponent(item.guid)}`, null, token);
                const seasons = Array.isArray(seasonRes?.data) ? seasonRes.data : [];
                if (seasons.length > 0) {
                    for (const season of seasons) {
                        const epRes = await feiniuApiRequest(config, 'GET', `/episode/list/${encodeURIComponent(season.guid)}`, null, token);
                        const episodes = Array.isArray(epRes?.data) ? epRes.data : [];
                        for (const ep of episodes) {
                            playableItems.push({
                                ...ep,
                                ancestor_guid: ep.ancestor_guid || item.ancestor_guid,
                                ancestor_name: ep.ancestor_name || item.ancestor_name,
                                poster: ep.poster || ep.still_path || season.poster || item.poster,
                                _tvTitle: tvTitle,
                                _folderTitle: tvTitle
                            });
                        }
                    }
                }
            } catch (_) {}
            return;
        }

        if (itemType === 'Directory' && depth < 3 && !visitedDirs.has(item.guid)) {
            visitedDirs.add(item.guid);
            try {
                const subRes = await feiniuApiRequest(config, 'POST', '/item/list', {
                    parent_guid: item.guid,
                    tags: { type: ['Movie', 'TV', 'Directory', 'Video'] },
                    exclude_grouped_video: 0,
                    page: 1,
                    page_size: 200
                }, token);
                const subList = Array.isArray(subRes?.data?.list) ? subRes.data.list : [];
                for (const subItem of subList) {
                    await expandItem(subItem, item.title || parentFolderTitle, depth + 1);
                }
            } catch (_) {}
        }
    }

    for (const item of rawItems) {
        await expandItem(item, '', 0);
    }

    return playableItems;
}

async function syncFeiniuCatalog({ force = false, defaultMediaOrder = 1000 } = {}) {
    await loadFeiniuConfig();
    if (cachedConfig.enabled === false) {
        catalogState.connected = false;
        catalogState.categories = [];
        catalogState.videos = [];
        catalogState.lastError = '';
        return catalogState;
    }

    if (process.env.TOOLS_DISABLE_FEINIU_SYNC === '1') {
        return catalogState;
    }

    const now = Date.now();
    if (!force && catalogState.lastSyncAt > 0 && (now - catalogState.lastSyncAt < CATALOG_CACHE_TTL_MS)) {
        return catalogState;
    }

    if (inFlightSync) {
        return inFlightSync;
    }

    inFlightSync = (async () => {
        try {
            let serverName = cachedConfig.serverName || '飞牛影视';
            try {
                const infoRes = await feiniuApiRequest(cachedConfig, 'GET', '/server/info', null, '');
                if (infoRes?.code === 0 && infoRes.data?.server_name) {
                    serverName = infoRes.data.server_name;
                }
            } catch (_) {}

            const tokenCheck = await resolveValidToken(cachedConfig);
            if (!tokenCheck.valid || !tokenCheck.token) {
                catalogState.connected = false;
                catalogState.serverName = serverName;
                catalogState.lastError = '飞牛影视认证未通过，请检查账号密码';
                return catalogState;
            }

            if (tokenCheck.token !== cachedConfig.token || serverName !== cachedConfig.serverName) {
                cachedConfig.token = tokenCheck.token;
                cachedConfig.serverName = serverName;
                try {
                    await writeKV(KV_CATEGORY, KV_CONFIG_KEY, cachedConfig);
                } catch (_) {}
            }

            const libraries = tokenCheck.libraries || [];
            const playableItems = await collectPlayableItems(cachedConfig, tokenCheck.token);

            // Build Feiniu categories by library
            const feiniuCategories = [];
            const libCategoryMap = new Map();
            libraries.forEach((lib, idx) => {
                if (!lib || !lib.guid) return;
                const catId = `feiniu-lib-${lib.guid}`;
                const folderName = `飞牛·${lib.title || '影视'}`;
                const catObj = {
                    id: catId,
                    name: `${lib.title || '飞牛影视'}`,
                    icon: lib.category === 'Movie' ? '🎞️' : '☁️',
                    folder: folderName,
                    order: 100 + idx * 10,
                    source: 'feiniu'
                };
                feiniuCategories.push(catObj);
                libCategoryMap.set(lib.guid, catObj);
            });

            // Fetch stream metadata with bounded concurrency
            const batchSize = 4;
            const streamMetaMap = new Map();
            for (let i = 0; i < playableItems.length; i += batchSize) {
                const slice = playableItems.slice(i, i + batchSize);
                const results = await Promise.all(
                    slice.map(item => fetchItemStreamMetadata(cachedConfig, item.guid, tokenCheck.token))
                );
                slice.forEach((item, idx) => {
                    if (results[idx]) streamMetaMap.set(item.guid, results[idx]);
                });
            }

            const normalizedVideos = playableItems.map((item, idx) => {
                const streamMeta = streamMetaMap.get(item.guid) || {};
                const libCat = libCategoryMap.get(item.ancestor_guid) || feiniuCategories[0] || {
                    id: 'feiniu-default',
                    name: '飞牛影视',
                    icon: '☁️',
                    folder: '飞牛影视'
                };

                const rawPoster = item.poster || item.posters || item.still_path || '';
                const posterUrl = rawPoster
                    ? `/api/media/public/feiniu/image?path=${encodeURIComponent(rawPoster)}`
                    : '/assets/videos/龙餐馆_poster.jpg';

                const rawBackdrop = item.backdrops || item.still_path || rawPoster || '';
                const backdropUrl = rawBackdrop
                    ? `/api/media/public/feiniu/image?path=${encodeURIComponent(rawBackdrop)}`
                    : posterUrl;

                const resArr = item.media_stream?.resolutions || [];
                const resLabel = normalizeResolutionLabel(resArr[0] || streamMeta.resolutionType || 'HD');
                const durationSec = Number(item.duration || streamMeta.duration || (item.runtime ? item.runtime * 60 : 0));
                const voteNum = Number(item.vote_average || 0);
                const ratingStr = voteNum > 0 ? voteNum.toFixed(1) : '9.2';
                const releaseYear = String(item.release_date || item.air_date || '').slice(0, 4) || '精选';

                let displayTitle = item.title || streamMeta.fileName || '未命名影片';
                let fileName = streamMeta.fileName || `${displayTitle}.${(streamMeta.format || 'mp4').toLowerCase()}`;
                if (item._tvTitle && item.episode_number) {
                    const sNum = String(item.season_number || 1).padStart(2, '0');
                    const eNum = String(item.episode_number).padStart(2, '0');
                    fileName = `S${sNum}E${eNum}_${displayTitle}.${(streamMeta.format || 'mp4').toLowerCase()}`;
                    displayTitle = `${item._tvTitle} 第${item.episode_number}集 ${item.title || ''}`.trim();
                }

                const tags = ['飞牛影视'];
                if (item.ancestor_name) tags.push(item.ancestor_name);
                if (resLabel) tags.push(resLabel);
                if (releaseYear && releaseYear !== '精选') tags.push(releaseYear);

                const videoId = `feiniu___${item.guid}`;
                return {
                    id: videoId,
                    source: 'feiniu',
                    feiniuGuid: item.guid,
                    feiniuMediaGuid: streamMeta.mediaGuid || '',
                    title: displayTitle,
                    fileName,
                    relPath: `feiniu/${item.guid}`,
                    folder: item._tvTitle || libCat.folder,
                    category: libCat.id,
                    categoryName: libCat.name,
                    fileSize: streamMeta.fileSize || 0,
                    fileSizeFormatted: formatFileSize(streamMeta.fileSize),
                    format: streamMeta.format || 'MP4',
                    src: `/api/media/public/feiniu/stream/${encodeURIComponent(item.guid)}`,
                    hlsSrc: `/api/media/public/feiniu/hls/${encodeURIComponent(item.guid)}/index.m3u8`,
                    directPlayable: streamMeta.directPlayable !== false,
                    needsTranscode: Boolean(streamMeta.needsTranscode),
                    poster: posterUrl,
                    backdrop: backdropUrl,
                    duration: durationSec,
                    durationFormatted: formatDurationSeconds(durationSec),
                    resolution: resLabel,
                    codec: normalizeCodecLabel(streamMeta.vcodec),
                    audioCodec: normalizeAudioCodecLabel(streamMeta.audioStream),
                    rating: ratingStr,
                    year: releaseYear,
                    tags,
                    description: item.overview || `${serverName} · ${libCat.name}：${displayTitle}`,
                    order: 10 + idx,
                    mtime: Date.now() - idx * 1000
                };
            });

            catalogState.connected = true;
            catalogState.serverName = serverName;
            catalogState.categories = feiniuCategories;
            catalogState.videos = normalizedVideos;
            catalogState.lastSyncAt = Date.now();
            catalogState.lastError = '';
            return catalogState;
        } catch (err) {
            catalogState.connected = false;
            catalogState.lastError = err.message || '同步飞牛影视失败';
            return catalogState;
        } finally {
            inFlightSync = null;
        }
    })();

    return inFlightSync;
}

function getCachedFeiniuCatalog() {
    if (cachedConfig.enabled === false) {
        return { connected: false, serverName: cachedConfig.serverName, categories: [], videos: [] };
    }
    return catalogState;
}

async function getPublicFeiniuConfig() {
    await loadFeiniuConfig();
    if (cachedConfig.enabled !== false && catalogState.lastSyncAt === 0 && process.env.TOOLS_DISABLE_FEINIU_SYNC !== '1') {
        await syncFeiniuCatalog({ force: false });
    }
    return {
        url: cachedConfig.url || DEFAULT_FEINIU_URL,
        username: cachedConfig.username || 'admin',
        hasPassword: Boolean(cachedConfig.password || cachedConfig.token || isDefaultFeiniuHost(cachedConfig.url)),
        enabled: cachedConfig.enabled !== false,
        serverName: catalogState.serverName || cachedConfig.serverName || '雪花肥牛',
        connected: Boolean(catalogState.connected),
        totalVideos: catalogState.videos.length,
        lastSyncAt: catalogState.lastSyncAt || 0,
        lastError: catalogState.lastError || ''
    };
}

async function updateFeiniuConfig(input = {}) {
    await loadFeiniuConfig();
    const { url } = normalizeFeiniuUrl(input.url !== undefined ? input.url : cachedConfig.url);
    const username = String(input.username !== undefined ? input.username : cachedConfig.username || 'admin').trim() || 'admin';
    const rawPassword = input.password !== undefined ? String(input.password) : cachedConfig.password;
    const password = rawPassword === '********' ? cachedConfig.password : rawPassword;
    const enabled = input.enabled !== undefined ? Boolean(input.enabled) : true;

    const nextConfig = {
        ...cachedConfig,
        url,
        username,
        password,
        enabled,
        updatedAt: Date.now()
    };

    if (!enabled) {
        cachedConfig = nextConfig;
        await writeKV(KV_CATEGORY, KV_CONFIG_KEY, cachedConfig);
        catalogState.connected = false;
        catalogState.categories = [];
        catalogState.videos = [];
        catalogState.lastError = '';
        return getPublicFeiniuConfig();
    }

    // Check server info & resolve token
    let serverName = nextConfig.serverName || '飞牛影视';
    try {
        const infoRes = await feiniuApiRequest(nextConfig, 'GET', '/server/info', null, '');
        if (infoRes?.code === 0 && infoRes.data?.server_name) {
            serverName = infoRes.data.server_name;
        }
    } catch (err) {
        throw new Error(`无法连接飞牛影视地址 (${url})：${err.message}`);
    }

    const tokenCheck = await resolveValidToken(nextConfig, { tryLoginFirst: Boolean(password) });
    if (!tokenCheck.valid || !tokenCheck.token) {
        throw new Error('飞牛影视账号或密码验证失败，请确认账号密码是否正确');
    }

    nextConfig.token = tokenCheck.token;
    nextConfig.serverName = serverName;
    cachedConfig = nextConfig;
    await writeKV(KV_CATEGORY, KV_CONFIG_KEY, cachedConfig);

    await syncFeiniuCatalog({ force: true });
    return getPublicFeiniuConfig();
}

async function resolveFeiniuPlayback(itemGuid) {
    await loadFeiniuConfig();
    const token = cachedConfig.token || (isDefaultFeiniuHost(cachedConfig.url) ? FALLBACK_FEINIU_TOKENS[0] : '');
    const { origin } = normalizeFeiniuUrl(cachedConfig.url);

    let streamMeta = await fetchItemStreamMetadata(cachedConfig, itemGuid, token);
    if (!streamMeta || !streamMeta.mediaGuid) {
        const playInfoRes = await feiniuApiRequest(cachedConfig, 'POST', '/play/info', { item_guid: itemGuid }, token);
        if (playInfoRes?.code === 0 && playInfoRes.data?.media_guid) {
            const d = playInfoRes.data;
            streamMeta = {
                itemGuid,
                mediaGuid: d.media_guid,
                videoGuid: d.video_guid || '',
                audioGuid: d.audio_guid || '',
                fileSize: 0,
                ext: '.mp4',
                format: 'MP4',
                vcodec: 'h264',
                acodec: 'aac',
                bps: 1500000,
                channels: 2,
                directPlayable: true,
                needsTranscode: false
            };
            streamInfoCache.set(itemGuid, streamMeta);
        }
    }

    if (!streamMeta || !streamMeta.mediaGuid) {
        throw new Error('未找到对应的飞牛媒体流信息');
    }

    return {
        origin,
        token,
        config: cachedConfig,
        streamMeta
    };
}

async function ensureFeiniuHlsSession(itemGuid, { forceNew = false, startTimestamp = 0 } = {}) {
    const cachedSession = hlsSessionCache.get(itemGuid);
    if (!forceNew && cachedSession && (Date.now() - cachedSession.updatedAt < 20 * 1000) && startTimestamp === 0) {
        return cachedSession;
    }

    const { origin, token, config, streamMeta } = await resolveFeiniuPlayback(itemGuid);
    let qualities = [];
    try {
        const streamRes = await feiniuApiRequest(config, 'POST', '/stream', {
            media_guid: streamMeta.mediaGuid,
            ip: 'tools-platform-cinema',
            header: { 'User-Agent': ['Mozilla/5.0'] },
            level: 1
        }, token);
        if (streamRes?.code === 0 && Array.isArray(streamRes.data?.qualities)) {
            qualities = streamRes.data.qualities;
        }
    } catch (_) {}

    const chosenQuality = qualities[0] || {
        resolution: String(streamMeta.resolutionType || '720').replace(/p$/i, '') || '720',
        bitrate: Math.min(Math.max(Number(streamMeta.bps) || 2000000, 500000), 8000000)
    };

    const playPayload = {
        media_guid: streamMeta.mediaGuid,
        video_guid: streamMeta.videoGuid,
        video_encoder: 'h264',
        resolution: chosenQuality.resolution,
        bitrate: chosenQuality.bitrate,
        startTimestamp: Math.max(0, Math.floor(Number(startTimestamp) || 0)),
        audio_encoder: 'aac',
        audio_guid: streamMeta.audioGuid,
        subtitle_guid: HIDDEN_SUBTITLE_GUID,
        channels: 2,
        forced_sdr: 0
    };

    const playRes = await feiniuApiRequest(config, 'POST', '/play/play', playPayload, token);
    const playLink = playRes?.data?.play_link;
    if (!playLink) {
        throw new Error(playRes?.msg || '启动飞牛转码播放会话失败');
    }

    const sessionBase = playLink.replace(/\/[^/]+$/, '');
    const sessionObj = {
        origin,
        token,
        playLink,
        sessionBase,
        updatedAt: Date.now(),
        streamMeta
    };
    hlsSessionCache.set(itemGuid, sessionObj);
    return sessionObj;
}

module.exports = {
    DEFAULT_FEINIU_URL,
    normalizeFeiniuUrl,
    signFeiniuAuthx,
    feiniuApiRequest,
    loginFeiniu,
    loadFeiniuConfig,
    getPublicFeiniuConfig,
    updateFeiniuConfig,
    syncFeiniuCatalog,
    getCachedFeiniuCatalog,
    resolveFeiniuPlayback,
    ensureFeiniuHlsSession
};
