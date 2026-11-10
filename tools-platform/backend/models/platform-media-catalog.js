const fs = require('node:fs');
const path = require('node:path');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const PROMOTIONS_DIR = path.join(FRONTEND_DIR, 'assets/promotions');
const DATACOM_DIR = path.join(PROMOTIONS_DIR, 'datacom');
const HOME_PROMO_JSON = path.resolve(__dirname, '../home-promo-videos.json');
const DATACOM_PROMO_JSON = path.resolve(__dirname, '../datacom-note-videos.json');
const DATACOM_MANIFEST_JSON = path.join(DATACOM_DIR, 'manifest.json');

const PLATFORM_CATEGORY = {
    id: 'platform',
    name: '平台类',
    icon: '🚀',
    order: 5,
    folder: ''
};

const KNOWLEDGE_CATEGORY = {
    id: 'knowledge',
    name: '知识类',
    icon: '📚',
    order: 8,
    folder: ''
};

// 循序渐进的学习顺序定义：平台类
const KNOWN_PLATFORM_SEQUENCE = [
    'platform-guide',
    'platform-guide-en',
    'eos-report-guide',
    'eos-report-guide-en',
    'operation-incentive-guide',
    'operation-incentive-guide-en',
    'netcare-rfc-ai-guide',
    'netcare-rfc-ai-guide-en',
    'ai-monthly-guide',
    'welink-cli-guide',
    'welink-sdk-guide',
    'digital-human-guide',
    'project-evolution-galaxy',
    'ai-native-explainer'
];

// 循序渐进的学习顺序定义：数通知识类（OSPF 体系从身份、报文、状态机到区域、LSA、高级选路）
const KNOWN_DATACOM_SEQUENCE = [
    'ospf-router-id',
    'ospf-packets',
    'ospf-fsm',
    'ospf-router-types',
    'ospf-dr-bdr',
    'ospf-areas',
    'ospf-lsa-handbook',
    'ospf-fa'
];

function readJsonSafe(filePath, fallback = {}) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (_) {}
    return fallback;
}

function formatDurationSeconds(seconds) {
    const sec = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h > 0) {
        return `${String(h).padStart(2, '0')}:${String(rm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    const num = Number(bytes);
    if (!Number.isFinite(num) || num <= 0) return '未知';
    if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
    return (num / (1024 * 1024)).toFixed(1) + ' MB';
}

function prettifyTitle(rawKey) {
    return String(rawKey || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b[a-z]/g, ch => ch.toUpperCase())
        .trim();
}

function formatEpisodeBadge(episode, isEnglish = false) {
    const pad = String(episode).padStart(2, '0');
    return isEnglish ? `EP${pad}` : `第${pad}集`;
}

function withEpisodeTitle(rawTitle, episodeBadge) {
    if (!episodeBadge) return rawTitle;
    const cleaned = String(rawTitle || '').replace(/^(?:第\s*\d+\s*集|EP\s*\d+)\s*[·\-:：]\s*/i, '').trim();
    return `${episodeBadge} · ${cleaned}`;
}

const KNOWN_PLATFORM_META = {
    'platform-guide': {
        title: 'Dragon 平台五站使用指南',
        englishTitle: 'Dragon Claw Five-Step Guide',
        description: '使用指南 · 从数据抓取、报表处理、SLA 测算到月报自动生成，全流程五站通关演示。',
        tags: ['平台指南', '官方教程', '通关攻略', '超清'],
        duration: 437
    },
    'platform-guide-en': {
        title: 'Dragon Claw Five-Step Guide (English)',
        englishTitle: 'Dragon Claw Five-Step Guide',
        description: 'Platform Guide · End-to-end walkthrough from automated data capture and SLA metrics to monthly reports.',
        tags: ['Platform Guide', 'Tutorial', 'English', 'HD'],
        duration: 520
    },
    'netcare-rfc-ai-guide': {
        title: 'NetCare RFC 方案与 AI 审计',
        englishTitle: 'NetCare RFC Plans & AI Audit',
        description: '新功能 · NetCare RFC 方案编制、变更风险评估与 AI 辅助智能审计操作演示。',
        tags: ['新功能', 'RFC方案', 'AI审计', '变更管理'],
        duration: 212
    },
    'netcare-rfc-ai-guide-en': {
        title: 'NetCare RFC Plans & AI Audit (English)',
        englishTitle: 'NetCare RFC Plans & AI Audit',
        description: 'New Feature · RFC planning workflow, compliance verification, and AI-powered audit guidance.',
        tags: ['RFC', 'AI Audit', 'Compliance', 'English'],
        duration: 226
    },
    'operation-incentive-guide': {
        title: '操作激励统计：怎么算准每一笔',
        englishTitle: 'Operation Incentive Statistics',
        description: '核算指南 · 操作激励统计规则全景解析，指标对账、多层校验与精准核算流程。',
        tags: ['核算指南', '操作激励', '规则解析', '精准核对'],
        duration: 388
    },
    'operation-incentive-guide-en': {
        title: 'Operation Incentive Statistics (English)',
        englishTitle: 'Operation Incentive Statistics',
        description: 'Accounting Guide · Verification rules, payout attribution, and end-to-end reconciliation.',
        tags: ['Incentive', 'Payout', 'Accounting', 'English'],
        duration: 462
    },
    'eos-report-guide': {
        title: 'EOS 风险收编：一键取数与自动月报',
        englishTitle: 'EOS Risk Incorporation & Monthly Report',
        description: '月报指南 · EOS 风险资产收编、目标测算与一键自动化生成高质量月报。',
        tags: ['月报指南', 'EOS风险', '一键取数', '自动月报'],
        duration: 473
    },
    'eos-report-guide-en': {
        title: 'EOS Risk Incorporation & Monthly Report (English)',
        englishTitle: 'EOS Risk Incorporation & Monthly Report',
        description: 'Report Guide · Automated data ingestion, forecast target calculation, and instant report generation.',
        tags: ['Monthly Report', 'EOS Risk', 'Forecasting', 'English'],
        duration: 556
    },
    'ai-monthly-guide': {
        title: 'AI 月报：这个月做好，下个月接着用',
        englishTitle: 'AI Monthly Reports',
        description: '功能介绍 · AI 驱动的月报体系构建，指标模版沉淀与跨周期一键复用方案。',
        tags: ['功能介绍', 'AI月报', '模版复用', '高效办公'],
        duration: 156
    },
    'welink-cli-guide': {
        title: 'WeLink CLI：把散落的办公信息找回来',
        englishTitle: 'WeLink CLI Assistant',
        description: '功能介绍 · 命令行一键穿透办公群聊与消息流，快速检索聚合散落的关键任务信息。',
        tags: ['功能介绍', '办公辅助', 'CLI工具', '效率神器'],
        duration: 160
    },
    'welink-sdk-guide': {
        title: 'WeLink SDK：把运营助手装进口袋',
        englishTitle: 'WeLink SDK Mobile Assistant',
        description: '功能介绍 · 移动端与平台深度打通，随时随地接收关键运营指标与自动化推送。',
        tags: ['功能介绍', '移动办公', 'SDK生态', '运营助手'],
        duration: 160
    },
    'digital-human-guide': {
        title: '数字人基座：从看不懂表，到查得清数据',
        englishTitle: 'Digital Human Platform Base',
        description: '功能介绍 · 结合数字人自然交互与数据基座，让复杂的运营报表一问即得、清晰直观。',
        tags: ['功能介绍', '数字人', '数据探索', '智能问答'],
        duration: 166
    },
    'ai-native-explainer': {
        title: 'AI 原生的 7 个层面',
        englishTitle: 'Seven Layers of AI Native',
        description: '科普动画 · 毛绒小龙用一个检验问题“把 AI 拿掉它还能成立吗”，拆解技术架构、产品、组织、用户、交互、商业模式与硬件七个层面，硬件部分重点讲解。',
        tags: ['科普动画', 'AI 原生', '硬件', '商业模式'],
        duration: 287
    },
    'project-evolution-galaxy': {
        title: '项目演进 · 银河之旅',
        englishTitle: 'Project Evolution: Galaxy Journey',
        description: '平台演进 · 探索工具平台的架构进化路线与里程碑历程，全景星图震撼呈现。',
        tags: ['平台演进', '全景星图', '发展历程', '震撼视觉'],
        duration: 88
    }
};

const KNOWN_DATACOM_META = {
    'ospf-router-id': {
        title: 'Router-ID 选举与生效',
        description: '数通协议知识 · 手工指定与自动选取规则、环回接口与物理接口优先级、重启生效机制。',
        tags: ['数通协议', 'OSPF', 'Router-ID', '选举机制'],
        duration: 109
    },
    'ospf-packets': {
        title: 'OSPF 五种报文：一次地图交接',
        description: '数通协议知识 · Hello、DD、LSR、LSU、LSAck 五类协议报文格式与交互时序全解析。',
        tags: ['数通协议', 'OSPF', '五种报文', '协议交互'],
        duration: 290
    },
    'ospf-fsm': {
        title: 'OSPF 邻居状态机',
        description: '数通协议知识 · 从单端邻居视角追踪状态变化，解析 Init、2-Way、ExStart、Exchange、Loading 到 Full 状态跃迁全流程。',
        tags: ['数通协议', 'OSPF', '状态机', '邻接关系'],
        duration: 118
    },
    'ospf-router-types': {
        title: 'OSPF 路由器角色',
        description: '数通协议知识 · 详解 Internal Router、ABR、ASBR、Backbone Router 角色划分与职责。',
        tags: ['数通协议', 'OSPF', '路由器类型', '区域边界'],
        duration: 120
    },
    'ospf-dr-bdr': {
        title: 'DR / BDR：路由器班会与三幅图',
        description: '数通协议知识 · 广播网络中的邻接关系优化、224.0.0.5 与 224.0.0.6 组播监听分工与选举机制。',
        tags: ['数通协议', 'OSPF', 'DR/BDR', '广播网络'],
        duration: 247
    },
    'ospf-areas': {
        title: 'OSPF 区域：哪些路标可以进来',
        description: '数通协议知识 · 骨干区域 Area 0、普通区域、Stub 区域、Totally Stub、NSSA 区域划分与 LSA 过滤规则。',
        tags: ['数通协议', 'OSPF', '多区域', 'LSA过滤'],
        duration: 291
    },
    'ospf-lsa-handbook': {
        title: 'LSA：从资料卡到路由地图',
        description: '数通协议知识 · 1类 Router、2类 Network、3类 Network Summary、4类 ASBR Summary、5类 AS-External LSA 深度手册。',
        tags: ['数通协议', 'OSPF', 'LSA全解', '路由地图'],
        duration: 353
    },
    'ospf-fa': {
        title: 'Forwarding Address：消息来源与数据方向',
        description: '数通协议知识 · Type-5 / Type-7 LSA 中的 Forwarding Address 字段解析，防止次优路径与环路的关键机制。',
        tags: ['数通协议', 'OSPF', 'FA地址', '路由选路'],
        duration: 267
    },
    'ospf-filter': {
        title: 'OSPF 为什么只能在边界过滤',
        description: '数通协议知识 · 区域内泛洪一致性与数据库完整性解析，为什么路由过滤只能在 ABR / ASBR 边界执行。',
        tags: ['数通协议', 'OSPF', '路由过滤', 'ABR边界'],
        duration: 117
    },
    'ospf-lsa-philosophy': {
        title: '区域内给地图，区域间只给路标',
        description: '数通协议知识 · 链路状态与距离矢量设计的结合：区域内 SPF 拓扑地图计算，区域间纯网络汇总路标。',
        tags: ['数通协议', 'OSPF', 'LSA设计', '区域架构'],
        duration: 126
    },
    'ospf-network-types': {
        title: '为什么要选 DR：从共享电缆到点到点',
        description: '数通协议知识 · 从早期以太网同轴电缆共享介质到全双工交换机时代，网络类型演进与 DR 机制的来龙去脉。',
        tags: ['数通协议', 'OSPF', '网络类型', 'DR选举'],
        duration: 139
    }
};

function resolvePosterUrl(subFolder, baseKey) {
    const folderPath = subFolder ? path.join(PROMOTIONS_DIR, subFolder) : PROMOTIONS_DIR;
    const urlPrefix = subFolder ? `/assets/promotions/${subFolder}` : '/assets/promotions';

    const candidates = [
        `${baseKey}-poster.jpg`,
        `${baseKey}.jpg`,
        `${baseKey}-poster.png`,
        `${baseKey}.png`
    ];

    if (baseKey.endsWith('-en')) {
        const zhKey = baseKey.slice(0, -3);
        candidates.push(`${zhKey}-poster.jpg`, `${zhKey}.jpg`);
    }

    for (const name of candidates) {
        if (fs.existsSync(path.join(folderPath, name))) {
            return `${urlPrefix}/${name}`;
        }
    }
    return '/assets/videos/龙餐馆_poster.jpg';
}

function parseVideoGroups(assetsMap, localFiles = [], prefix = '') {
    const allFileNames = new Set(Object.keys(assetsMap || {}));
    for (const f of localFiles) {
        if (f.endsWith('.mp4')) {
            const relKey = prefix ? `${prefix}/${f}` : f;
            allFileNames.add(relKey);
        }
    }

    const groups = new Map();
    for (const rawName of allFileNames) {
        const withoutPrefix = prefix && rawName.startsWith(`${prefix}/`)
            ? rawName.slice(prefix.length + 1)
            : rawName;
        if (!withoutPrefix.endsWith('.mp4')) continue;

        const baseNoExt = withoutPrefix.slice(0, -4);
        const isHd = baseNoExt.endsWith('-hd');
        const itemKey = isHd ? baseNoExt.slice(0, -3) : baseNoExt;

        if (!groups.has(itemKey)) {
            groups.set(itemKey, {
                itemKey,
                prefix,
                files: new Set(),
                hasHd: false
            });
        }
        const grp = groups.get(itemKey);
        grp.files.add(rawName);
        if (isHd) grp.hasHd = true;
    }
    return Array.from(groups.values());
}

function sortVideoGroups(groups, sequenceList) {
    const sequenceMap = new Map(sequenceList.map((key, idx) => [key, idx + 1]));
    const known = [];
    const unknown = [];

    for (const grp of groups) {
        if (sequenceMap.has(grp.itemKey)) {
            known.push(grp);
        } else {
            unknown.push(grp);
        }
    }

    known.sort((a, b) => sequenceMap.get(a.itemKey) - sequenceMap.get(b.itemKey));
    unknown.sort((a, b) => a.itemKey.localeCompare(b.itemKey, 'zh-CN', { numeric: true }));

    return { sortedGroups: [...known, ...unknown], sequenceMap, knownBaseCount: sequenceList.length };
}

function buildPlatformVideos(homePromoManifest) {
    const assets = homePromoManifest?.assets || {};
    let localFiles = [];
    try {
        if (fs.existsSync(PROMOTIONS_DIR)) {
            localFiles = fs.readdirSync(PROMOTIONS_DIR).filter(f => f.endsWith('.mp4'));
        }
    } catch (_) {}

    const rawGroups = parseVideoGroups(assets, localFiles, '');
    const { sortedGroups, sequenceMap, knownBaseCount } = sortVideoGroups(rawGroups, KNOWN_PLATFORM_SEQUENCE);
    const videos = [];
    let unknownCounter = 0;

    sortedGroups.forEach(grp => {
        const itemKey = grp.itemKey;
        const streamFileName = grp.hasHd ? `${itemKey}-hd.mp4` : `${itemKey}.mp4`;
        const assetInfo = assets[streamFileName] || assets[`${itemKey}.mp4`] || {};
        const localPath = path.join(PROMOTIONS_DIR, streamFileName);
        let statSize = assetInfo.size || 0;
        let statMtime = Date.now();
        try {
            if (fs.existsSync(localPath)) {
                const stat = fs.statSync(localPath);
                statSize = stat.size || statSize;
                statMtime = stat.mtimeMs || statMtime;
            }
        } catch (_) {}

        const known = KNOWN_PLATFORM_META[itemKey] || {};
        const isEnglish = itemKey.endsWith('-en');
        const rawTitle = known.title || prettifyTitle(itemKey);
        const englishTitle = known.englishTitle || (isEnglish ? prettifyTitle(itemKey.slice(0, -3)) : undefined);
        const description = known.description || `平台功能与视频介绍：${rawTitle}`;
        const tags = known.tags || [isEnglish ? 'English' : '平台介绍', '超清', '官方'];
        const durationSec = known.duration || 180;
        const posterUrl = resolvePosterUrl('', itemKey);

        // 计算剧集短序号：已有项目按既定顺序，后续新增项目自动递增
        const episode = sequenceMap.has(itemKey)
            ? sequenceMap.get(itemKey)
            : (knownBaseCount + (++unknownCounter));
        const episodeFormatted = formatEpisodeBadge(episode, isEnglish);
        const displayTitle = withEpisodeTitle(rawTitle, episodeFormatted);

        videos.push({
            id: `promo___${itemKey}`,
            source: 'platform-promo',
            episode,
            episodeFormatted,
            title: displayTitle,
            rawTitle,
            ...(englishTitle && { englishTitle }),
            fileName: streamFileName,
            relPath: `promotions/${streamFileName}`,
            folder: '',
            category: PLATFORM_CATEGORY.id,
            categoryName: PLATFORM_CATEGORY.name,
            fileSize: statSize,
            fileSizeFormatted: formatFileSize(statSize),
            format: 'MP4',
            src: `/assets/promotions/${streamFileName}`,
            poster: posterUrl,
            backdrop: posterUrl,
            duration: durationSec,
            durationFormatted: formatDurationSeconds(durationSec),
            resolution: grp.hasHd ? '1080P Full HD' : '720P HD',
            codec: 'H.264 (AVC)',
            audioCodec: 'AAC Stereo 44.1kHz',
            rating: '9.9',
            year: '2026',
            tags,
            description,
            order: 100 + episode,
            mtime: statMtime
        });
    });

    return videos;
}

function buildKnowledgeVideos(datacomPromoManifest) {
    const assets = datacomPromoManifest?.assets || {};
    const datacomMeta = readJsonSafe(DATACOM_MANIFEST_JSON, {});
    let localFiles = [];
    try {
        if (fs.existsSync(DATACOM_DIR)) {
            localFiles = fs.readdirSync(DATACOM_DIR).filter(f => f.endsWith('.mp4'));
        }
    } catch (_) {}

    const rawGroups = parseVideoGroups(assets, localFiles, 'datacom');
    const { sortedGroups, sequenceMap, knownBaseCount } = sortVideoGroups(rawGroups, KNOWN_DATACOM_SEQUENCE);
    const videos = [];
    let unknownCounter = 0;

    sortedGroups.forEach(grp => {
        const itemKey = grp.itemKey;
        const streamFileName = grp.hasHd ? `${itemKey}-hd.mp4` : `${itemKey}.mp4`;
        const fullRelAsset = `datacom/${streamFileName}`;
        const assetInfo = assets[fullRelAsset] || assets[`datacom/${itemKey}.mp4`] || {};
        const localPath = path.join(DATACOM_DIR, streamFileName);
        let statSize = assetInfo.size || 0;
        let statMtime = Date.now();
        try {
            if (fs.existsSync(localPath)) {
                const stat = fs.statSync(localPath);
                statSize = stat.size || statSize;
                statMtime = stat.mtimeMs || statMtime;
            }
        } catch (_) {}

        const known = KNOWN_DATACOM_META[itemKey] || {};
        const metaEntry = datacomMeta[itemKey] || {};
        const rawTitle = metaEntry.title || known.title || prettifyTitle(itemKey);
        const description = known.description || `数通协议知识精选：${rawTitle}。`;
        const tags = known.tags || ['数通协议', 'OSPF', '知识精讲'];
        const durationSec = metaEntry.duration ? Math.round(metaEntry.duration) : (known.duration || 200);
        const posterUrl = resolvePosterUrl('datacom', itemKey);

        // 计算剧集短序号：按 OSPF 认知进阶递进，新增协议视频自动累加
        const episode = sequenceMap.has(itemKey)
            ? sequenceMap.get(itemKey)
            : (knownBaseCount + (++unknownCounter));
        const episodeFormatted = formatEpisodeBadge(episode, false);
        const displayTitle = withEpisodeTitle(rawTitle, episodeFormatted);

        videos.push({
            id: `datacom___${itemKey}`,
            source: 'datacom-knowledge',
            episode,
            episodeFormatted,
            title: displayTitle,
            rawTitle,
            fileName: streamFileName,
            relPath: `promotions/datacom/${streamFileName}`,
            folder: '',
            category: KNOWLEDGE_CATEGORY.id,
            categoryName: KNOWLEDGE_CATEGORY.name,
            fileSize: statSize,
            fileSizeFormatted: formatFileSize(statSize),
            format: 'MP4',
            src: `/assets/promotions/datacom/${streamFileName}`,
            poster: posterUrl,
            backdrop: posterUrl,
            duration: durationSec,
            durationFormatted: formatDurationSeconds(durationSec),
            resolution: grp.hasHd ? '1080P Full HD' : '720P HD',
            codec: 'H.264 (AVC)',
            audioCodec: 'AAC Stereo 44.1kHz',
            rating: '9.9',
            year: '2026',
            tags,
            description,
            order: 200 + episode,
            mtime: statMtime
        });
    });

    return videos;
}

function getPlatformMediaCatalog() {
    const homePromoManifest = readJsonSafe(HOME_PROMO_JSON, {});
    const datacomPromoManifest = readJsonSafe(DATACOM_PROMO_JSON, {});

    const platformVideos = buildPlatformVideos(homePromoManifest);
    const knowledgeVideos = buildKnowledgeVideos(datacomPromoManifest);

    return {
        categories: [PLATFORM_CATEGORY, KNOWLEDGE_CATEGORY],
        videos: [...platformVideos, ...knowledgeVideos]
    };
}

module.exports = {
    PLATFORM_CATEGORY,
    KNOWLEDGE_CATEGORY,
    KNOWN_PLATFORM_SEQUENCE,
    KNOWN_DATACOM_SEQUENCE,
    getPlatformMediaCatalog,
    buildPlatformVideos,
    buildKnowledgeVideos,
    formatDurationSeconds,
    formatFileSize,
    formatEpisodeBadge,
    withEpisodeTitle
};
