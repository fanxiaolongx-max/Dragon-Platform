// 运营素材：生成运营内容时拼进提示词或模板变量。
// - highlights：内置功能亮点库（如 AI 月报亮点）随机抽取，并随机/指定一种运营角度（见 ops-library.js）；
// - features：平台近期新功能，取自本仓库 git 提交里的 feat:（部署环境没有 git 时为空）；
// - videos：「媒体资源」里的视频（跳过 PIN 保护分类，可按分类筛选，最新优先，同一计划不重复推送）；
// - chat：运营群近期在助理里的对话与进行中的跟进任务。
// 指标/报表数据不在这里取：AI 生成时 Dragon Claw 自带只读数据能力，按提示词自行查询。
const path = require('path');
const { execFile } = require('child_process');
const opsRepo = require('./ops-repository');
const opsLibrary = require('./ops-library');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FEATURE_CACHE_MS = 10 * 60 * 1000;
const MAX_FEATURES = 15;
let featureCache = { key: '', at: 0, items: [] };

function gitLog(days) {
    return new Promise(resolve => {
        execFile('git', ['-C', REPO_ROOT, 'log', `--since=${days}.days`, '--no-merges', '--pretty=format:%cI%x09%s'], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
            resolve(error ? '' : String(stdout || ''));
        });
    });
}

/** 近 days 天的新功能（feat 提交），新的在前。 */
async function recentFeatures(days = 7) {
    const key = String(days);
    if (featureCache.key === key && Date.now() - featureCache.at < FEATURE_CACHE_MS) return featureCache.items;
    const items = [];
    const seen = new Set();
    for (const line of (await gitLog(days)).split('\n')) {
        const [date, subject = ''] = line.split('\t');
        const match = /^feat(?:\(([^)]*)\))?!?:\s*(.+)$/i.exec(subject.trim());
        if (!match || seen.has(match[2])) continue;
        seen.add(match[2]);
        items.push({ date: date.slice(0, 10), scope: match[1] || '', summary: match[2].trim() });
        if (items.length >= MAX_FEATURES) break;
    }
    featureCache = { key, at: Date.now(), items };
    return items;
}

function mediaModule() {
    // routes/media.js 体量大，按需加载
    return require('../../routes/media');
}

function videoLink(video, baseUrl) {
    return baseUrl ? `${baseUrl}${video.src}` : video.src;
}

/** 可推送的视频（公开分类），最新在前；category 可填分类 id 或名称。 */
function listVideos({ category = '', limit = 30 } = {}) {
    const { categories, videos } = mediaModule().scanMediaList();
    const protectedIds = new Set(categories.filter(item => item.protected).map(item => item.id));
    const wanted = String(category || '').trim();
    return videos
        .filter(video => !protectedIds.has(video.category))
        .filter(video => !wanted || video.category === wanted || video.categoryName === wanted || video.folder === wanted)
        .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
        .slice(0, limit)
        .map(video => ({ id: video.id, title: video.title, category: video.categoryName || video.category || '', description: video.description || '', src: video.src, mtime: video.mtime ? new Date(video.mtime).toISOString() : '' }));
}

/** 为某个计划挑一个还没推送过的视频（都推过时从最新的重新开始）。 */
async function pickVideo(plan) {
    let videos = [];
    try {
        videos = listVideos({ category: plan.options?.videoCategory, limit: 200 });
    } catch {
        return null;
    }
    if (!videos.length) return null;
    const sent = plan.id ? await opsRepo.sentVideoIds(plan.id) : new Set();
    return videos.find(video => !sent.has(video.id)) || videos[0];
}

async function chatContext(targets) {
    const followups = require('./channel-followups-repository');
    const blocks = [];
    for (const target of targets.slice(0, 5)) {
        try {
            const page = await followups.listThreadMessages(target.channel, target.kind, target.id, { limit: 12 });
            const lines = page.items.map(item => `${item.role === 'model' ? '助理' : (item.sender || '成员')}：${String(item.content || '').replace(/\s+/g, ' ').slice(0, 160)}`);
            const tasks = target.channel === 'welink' ? (await followups.listTasks('welink', { kind: target.kind, id: target.id, limit: 10 })).filter(task => task.status === 'open') : [];
            if (lines.length || tasks.length) {
                blocks.push(`【${target.name || target.id}】\n${lines.join('\n') || '（暂无对话）'}${tasks.length ? `\n进行中的跟进：${tasks.map(task => task.title).join('；')}` : ''}`);
            }
        } catch {
            // 单个群读取失败不影响其他群
        }
    }
    return blocks.join('\n\n');
}

/**
 * 收集计划需要的素材。
 * @returns {Promise<{highlights:Array, highlightTopic:object|null, angle:object|null, features:Array, video:object|null, chat:string, settings:object}>}
 */
async function collect(plan, targets) {
    const settings = await opsRepo.getSettings();
    const sources = new Set(plan.sources || []);
    const usesVar = name => plan.contentMode === 'template' && String(plan.template || '').includes(`{{${name}`);
    const features = sources.has('features') || usesVar('feature') ? await recentFeatures(plan.options?.featureDays || 7) : [];
    const video = sources.has('videos') || usesVar('video') ? await pickVideo(plan) : null;
    const chat = sources.has('chat') ? await chatContext(targets) : '';
    let highlights = [];
    let highlightTopic = null;
    let angle = null;
    if (sources.has('highlights') || usesVar('highlight') || usesVar('angle')) {
        const picked = await opsLibrary.pickHighlights(plan);
        highlightTopic = picked.topic ? { id: picked.topic.id, name: picked.topic.name, summary: picked.topic.summary, link: `${settings.publicBaseUrl}${picked.topic.entry}` } : null;
        highlights = picked.items;
        angle = await opsLibrary.pickAngle(plan);
    }
    return { highlights, highlightTopic, angle, features, video: video ? { ...video, link: videoLink(video, settings.publicBaseUrl) } : null, chat, settings };
}

function resetCache() {
    featureCache = { key: '', at: 0, items: [] };
}

module.exports = { recentFeatures, listVideos, pickVideo, collect, resetCache };
