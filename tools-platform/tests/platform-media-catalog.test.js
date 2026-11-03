const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const {
    PLATFORM_CATEGORY,
    KNOWLEDGE_CATEGORY,
    getPlatformMediaCatalog,
    buildPlatformVideos,
    buildKnowledgeVideos,
    formatDurationSeconds,
    formatFileSize
} = require('../backend/models/platform-media-catalog');

const { router, scanMediaList } = require('../backend/routes/media');

test('平台与知识类视频清单包含平台类与知识类两个主分类', () => {
    const catalog = getPlatformMediaCatalog();
    assert.ok(catalog.categories.some(c => c.id === 'platform' && c.name === '平台类' && c.icon === '🚀'));
    assert.ok(catalog.categories.some(c => c.id === 'knowledge' && c.name === '知识类' && c.icon === '📚'));
});

test('平台类视频包含中英文平台指南、功能介绍及项目演进，并自带缩略图与媒体仓库链接', () => {
    const catalog = getPlatformMediaCatalog();
    const platformVideos = catalog.videos.filter(v => v.category === 'platform');

    assert.ok(platformVideos.length >= 13, `期望至少 13 个平台视频，实际: ${platformVideos.length}`);

    const titles = platformVideos.map(v => v.title);
    assert.ok(titles.some(t => t.includes('Dragon 平台五站使用指南')), '缺少 Dragon 平台五站使用指南');
    assert.ok(titles.some(t => t.includes('Dragon Claw Five-Step Guide')), '缺少英文版 Dragon 平台指南');
    assert.ok(titles.some(t => t.includes('NetCare RFC 方案与 AI 审计')), '缺少 NetCare RFC 方案与 AI 审计');
    assert.ok(titles.some(t => t.includes('NetCare RFC Plans & AI Audit')), '缺少英文版 NetCare RFC');
    assert.ok(titles.some(t => t.includes('操作激励统计')), '缺少操作激励统计');
    assert.ok(titles.some(t => t.includes('EOS 风险收编')), '缺少 EOS 风险收编');
    assert.ok(titles.some(t => t.includes('AI 月报')), '缺少 AI 月报');
    assert.ok(titles.some(t => t.includes('WeLink CLI')), '缺少 WeLink CLI');
    assert.ok(titles.some(t => t.includes('WeLink SDK')), '缺少 WeLink SDK');
    assert.ok(titles.some(t => t.includes('数字人基座')), '缺少数字人基座');
    assert.ok(titles.some(t => t.includes('项目演进')), '缺少项目演进');

    for (const video of platformVideos) {
        assert.ok(video.src.startsWith('/assets/promotions/'), `视频播放链接应从媒体仓库引入: ${video.src}`);
        assert.ok(video.poster.startsWith('/assets/promotions/'), `视频缩略图应自带并从资源路径引入: ${video.poster}`);
        assert.equal(video.category, 'platform');
        assert.equal(video.categoryName, '平台类');
        assert.ok(video.resolution.includes('HD'), `分辨率应为高清或超清: ${video.resolution}`);
    }
});

test('知识类视频包含数通协议全套精讲，自带缩略图并分类到知识类', () => {
    const catalog = getPlatformMediaCatalog();
    const knowledgeVideos = catalog.videos.filter(v => v.category === 'knowledge');

    assert.ok(knowledgeVideos.length >= 8, `期望至少 8 个数通知识视频，实际: ${knowledgeVideos.length}`);

    const titles = knowledgeVideos.map(v => v.title);
    assert.ok(titles.some(t => t.includes('OSPF 邻居状态机')), '缺少 OSPF 邻居状态机');
    assert.ok(titles.some(t => t.includes('OSPF 路由器角色')), '缺少 OSPF 路由器角色');
    assert.ok(titles.some(t => t.includes('Router-ID 选举与生效')), '缺少 Router-ID 选举与生效');
    assert.ok(titles.some(t => t.includes('DR / BDR')), '缺少 DR / BDR');
    assert.ok(titles.some(t => t.includes('Forwarding Address')), '缺少 Forwarding Address');
    assert.ok(titles.some(t => t.includes('OSPF 五种报文')), '缺少 OSPF 五种报文');
    assert.ok(titles.some(t => t.includes('OSPF 区域')), '缺少 OSPF 区域');
    assert.ok(titles.some(t => t.includes('LSA：从资料卡到路由地图')), '缺少 LSA 全解');

    for (const video of knowledgeVideos) {
        assert.ok(video.src.startsWith('/assets/promotions/datacom/'), `知识类视频链接应从媒体仓库引入: ${video.src}`);
        assert.ok(video.poster.startsWith('/assets/promotions/datacom/'), `知识类视频应自带缩略图: ${video.poster}`);
        assert.equal(video.category, 'knowledge');
        assert.equal(video.categoryName, '知识类');
    }
});

test('无需配置：当媒体库引入新远端视频时，目录自动引入并归类', () => {
    const mockHomeManifest = {
        assets: {
            'new-feature-guide.mp4': { size: 1000000 },
            'new-feature-guide-hd.mp4': { size: 2000000 }
        }
    };
    const platformResult = buildPlatformVideos(mockHomeManifest);
    const addedPlatform = platformResult.find(v => v.id === 'promo___new-feature-guide');
    assert.ok(addedPlatform, '新加入的远端平台视频应自动发现并引入');
    assert.equal(addedPlatform.category, 'platform');
    assert.equal(addedPlatform.src, '/assets/promotions/new-feature-guide-hd.mp4');

    const mockDatacomManifest = {
        assets: {
            'datacom/bgp-fundamentals.mp4': { size: 1500000 },
            'datacom/bgp-fundamentals-hd.mp4': { size: 3000000 }
        }
    };
    const knowledgeResult = buildKnowledgeVideos(mockDatacomManifest);
    const addedKnowledge = knowledgeResult.find(v => v.id === 'datacom___bgp-fundamentals');
    assert.ok(addedKnowledge, '新加入的远端数通知识视频应自动发现并引入');
    assert.equal(addedKnowledge.category, 'knowledge');
    assert.equal(addedKnowledge.src, '/assets/promotions/datacom/bgp-fundamentals-hd.mp4');
});

test('公开点播接口按平台类和知识类精准筛选，分类计数准确无交叉污染', async () => {
    const app = express();
    app.use('/api/media', router);

    const listRes = await request(app).get('/api/media/public/list').expect(200);
    assert.equal(listRes.body.success, true);

    const platCat = listRes.body.categories.find(c => c.id === 'platform');
    assert.ok(platCat, '分类列表中应有平台类');
    assert.equal(platCat.name, '平台类');
    assert.ok(platCat.count >= 13, `平台类视频计数应不少于 13，实际: ${platCat.count}`);

    const knowCat = listRes.body.categories.find(c => c.id === 'knowledge');
    assert.ok(knowCat, '分类列表中应有知识类');
    assert.equal(knowCat.name, '知识类');
    assert.ok(knowCat.count >= 8, `知识类视频计数应不少于 8，实际: ${knowCat.count}`);

    const filterPlatform = await request(app).get('/api/media/public/list?category=platform').expect(200);
    assert.equal(filterPlatform.body.count, platCat.count);
    assert.ok(filterPlatform.body.data.every(v => v.category === 'platform'), '筛选平台类时不应混入其他分类视频');

    const filterKnowledge = await request(app).get('/api/media/public/list?category=knowledge').expect(200);
    assert.equal(filterKnowledge.body.count, knowCat.count);
    assert.ok(filterKnowledge.body.data.every(v => v.category === 'knowledge'), '筛选知识类时不应混入其他分类视频');
});

test('字幕接口对于平台和知识类内置媒体优雅返回无需字幕，不报错', async () => {
    const app = express();
    app.use('/api/media', router);

    const subRes = await request(app).get('/api/media/public/subtitles/promo___platform-guide').expect(200);
    assert.equal(subRes.body.success, true);
    assert.deepEqual(subRes.body.tracks, []);
});

test('管理接口保护平台与知识类远端资源，禁止从磁盘物理删除', async () => {
    const authSessionsRepo = require('../backend/models/auth-sessions-repository');
    const adminToken = 'admin-test-token-' + Date.now();
    await authSessionsRepo.saveSession(adminToken, 'admin', 'admin', Date.now() + 60000);

    const app = express();
    app.use('/api/media', router);

    const delPlatform = await request(app)
        .delete('/api/media/admin/videos/promo___platform-guide')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    assert.match(delPlatform.body.error, /不支持直接从磁盘删除/);

    const delKnowledge = await request(app)
        .delete('/api/media/admin/videos/datacom___ospf-areas')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    assert.match(delKnowledge.body.error, /不支持直接从磁盘删除/);

    await authSessionsRepo.deleteSession(adminToken);
});

test('server.js 配置支持 /cinema 与 /cinama 双重公开路由别名', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    assert.match(serverSource, /'\/cinama'/);
    assert.match(serverSource, /'\/cinema'/);
    assert.match(serverSource, /app\.get\(\['\/cinema', '\/cinema\.html', '\/cinama', '\/cinama\.html'\]/);
});

test('平台类与知识类视频自动附带循序渐进短序号/第几集标识，后续新视频自动递增', () => {
    const catalog = getPlatformMediaCatalog();
    const platformVideos = catalog.videos.filter(v => v.category === 'platform');
    const knowledgeVideos = catalog.videos.filter(v => v.category === 'knowledge');

    // 平台类 13 集顺序校验
    assert.equal(platformVideos.length, 13);
    for (let i = 0; i < 13; i++) {
        const v = platformVideos[i];
        assert.equal(v.episode, i + 1, `平台视频索引 ${i} 的 episode 应为 ${i + 1}`);
        assert.ok(v.episodeFormatted, `平台视频应有 episodeFormatted`);
        assert.match(v.title, /^(?:第\s*\d+\s*集|EP\s*\d+)\s*·/, `标题应带有剧集序号前缀: ${v.title}`);
    }
    assert.equal(platformVideos[0].title, '第01集 · Dragon 平台五站使用指南');
    assert.equal(platformVideos[1].title, 'EP02 · Dragon Claw Five-Step Guide (English)');

    // 知识类 11 集循序渐进学习顺序校验（从身份 Router-ID 到五种报文、状态机、角色、DR/BDR、区域、LSA、FA 及新增精讲）
    assert.equal(knowledgeVideos.length, 11);
    const expectedKnowledgeOrder = [
        '第01集 · Router-ID 选举与生效',
        '第02集 · OSPF 五种报文：一次地图交接',
        '第03集 · OSPF 邻居状态机',
        '第04集 · OSPF 路由器角色',
        '第05集 · DR / BDR：路由器班会与三幅图',
        '第06集 · OSPF 区域：哪些路标可以进来',
        '第07集 · LSA：从资料卡到路由地图',
        '第08集 · Forwarding Address：消息来源与数据方向',
        '第09集 · OSPF 为什么只能在边界过滤',
        '第10集 · 区域内给地图，区域间只给路标',
        '第11集 · 为什么要选 DR：从共享电缆到点到点'
    ];
    for (let i = 0; i < 11; i++) {
        const v = knowledgeVideos[i];
        assert.equal(v.episode, i + 1);
        assert.equal(v.episodeFormatted, `第${String(i + 1).padStart(2, '0')}集`);
        assert.equal(v.title, expectedKnowledgeOrder[i]);
    }

    // 新增视频自动在已有序号之后叠加递增
    const mockHomeManifest = {
        assets: {
            'platform-guide.mp4': { size: 1000 },
            'brand-new-tool.mp4': { size: 3000 }
        }
    };
    const platRes = buildPlatformVideos(mockHomeManifest);
    const brandNew = platRes.find(v => v.id === 'promo___brand-new-tool');
    assert.equal(brandNew.episode, 14, '新平台视频应自动获得第 14 集');
    assert.equal(brandNew.episodeFormatted, '第14集');
    assert.match(brandNew.title, /^第14集 · /);

    const mockDatacomManifest = {
        assets: {
            'datacom/ospf-router-id.mp4': { size: 1000 },
            'datacom/bgp-evpn.mp4': { size: 3000 }
        }
    };
    const knowRes = buildKnowledgeVideos(mockDatacomManifest);
    const brandNewKnow = knowRes.find(v => v.id === 'datacom___bgp-evpn');
    assert.equal(brandNewKnow.episode, 9, '新数通知识视频应自动获得第 09 集');
    assert.equal(brandNewKnow.episodeFormatted, '第09集');
    assert.match(brandNewKnow.title, /^第09集 · /);

    // 页面卡片支持渲染 episodeFormatted 标签徽章
    const cinemaHtml = fs.readFileSync(path.join(__dirname, '../frontend/pages/cinema.html'), 'utf8');
    assert.match(cinemaHtml, /card-badge-ep/);
    assert.match(cinemaHtml, /item\.episodeFormatted/);
});
